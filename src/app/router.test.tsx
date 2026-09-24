import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { registreerSchermWachter, useRecordParam, useRoute } from './router';
import { useHistoryDismiss } from '../lib/useHistoryDismiss';

/**
 * Navigeren vanuit de mobiele zijbalk (melding Jarno 11-09: "wat ik ook
 * aantik in het menu, ik kom steeds op dezelfde pagina terecht").
 *
 * De zijbalk is op mobiel een overlay met een eigen history-entry
 * (useHistoryDismiss), zodat de systeem-terugknop hem sluit; bij
 * programmatisch sluiten ruimt hij die entry op met een uitgestelde back().
 * Een tik op een menu-item wisselt de route én sluit de lade in één commit.
 * Wisselde de historiek pas in de view-transition-callback — een
 * rendering-stap later — dan was de lade eerder klaar met opruimen dan de
 * router met navigeren, en at die back() de verse pagina op.
 *
 * Vandaar de twee eigenschappen hieronder: de historiek wisselt synchroon in
 * de tik zelf, en een tik vanuit een open lade laat geen extra stap achter.
 * De echte volgorde van browser-traversals rijdt e2e/zijbalk.spec.ts.
 */

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Start = (cb: () => void) => { finished: Promise<void> };
const doc = document as unknown as { startViewTransition?: Start };

/** Nep-view-transitie waarvan wíj bepalen wanneer de update draait — zo staat
 *  het gaatje tussen tik en schilderen open, net als in de browser. */
function handmatigeOvergang() {
  const wachtrij: Array<() => void> = [];
  doc.startViewTransition = (cb) => {
    wachtrij.push(cb);
    return { finished: Promise.resolve() };
  };
  return { schilder: () => wachtrij.splice(0).forEach((cb) => cb()) };
}

async function monteer(ui: React.ReactElement): Promise<Root> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(ui); });
  return root;
}

const tikken = () => new Promise((r) => setTimeout(r, 20));

/** Schil-attrap: een zijbalk-overlay met één menu-item, zoals App.tsx. */
function Schil() {
  const { view, navigeer } = useRoute();
  const [ladeOpen, setLadeOpen] = useState(false);
  useHistoryDismiss(ladeOpen, () => setLadeOpen(false));
  return (
    <>
      {/* rauw: testattrap */}
      <button type="button" data-knop="open-lade" onClick={() => setLadeOpen(true)} />
      {/* rauw: testattrap */}
      <button type="button" data-knop="naar-rooster" onClick={() => { navigeer('rooster'); setLadeOpen(false); }} />
      <span data-view={view} />
    </>
  );
}

const klik = (naam: string) => {
  document.querySelector<HTMLButtonElement>(`[data-knop="${naam}"]`)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
};
const zichtbareView = () => document.querySelector('[data-view]')?.getAttribute('data-view');

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined,
  }));
  window.history.pushState(null, '', '/verlof');
});

afterEach(async () => {
  delete doc.startViewTransition;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  await tikken();
});

describe('navigeren vanuit de mobiele zijbalk', () => {
  it('zet de nieuwe pagina meteen in de historiek, ook al schildert de overgang later', async () => {
    const overgang = handmatigeOvergang();
    const root = await monteer(<Schil />);
    await act(async () => { klik('open-lade'); });

    // Eén commit: route wisselen én de lade sluiten.
    await act(async () => { klik('naar-rooster'); });
    // Nog vóór de overgang schildert staat de pagina al in de historiek —
    // anders kan de opruim-back() van de lade haar opeten.
    expect(window.location.pathname).toBe('/rooster');
    expect(zichtbareView()).toBe('verlof');

    await act(async () => { overgang.schilder(); await tikken(); });
    expect(zichtbareView()).toBe('rooster');
    expect(window.location.pathname).toBe('/rooster');
    await act(async () => { root.unmount(); });
  });

  it('laat geen lege ladestap achter: één keer terug is één pagina terug', async () => {
    const overgang = handmatigeOvergang();
    const root = await monteer(<Schil />);
    await act(async () => { klik('open-lade'); });
    await act(async () => { klik('naar-rooster'); });
    await act(async () => { overgang.schilder(); await tikken(); });
    expect(zichtbareView()).toBe('rooster');

    await act(async () => { window.history.back(); await tikken(); });
    expect(window.location.pathname).toBe('/verlof');
    expect(zichtbareView()).toBe('verlof');
    await act(async () => { root.unmount(); });
  });

  it('wacht met schilderen tot de code van het nieuwe scherm klaar is, maar nooit met de historiek', async () => {
    // Zonder dit toonde React bij elk eerste bezoek zijn Suspense-fallback, en
    // die houdt hij ±300 ms vast: een skeletflits op elke schermwissel (21-09).
    let klaar: () => void = () => {};
    const gewacht: string[] = [];
    registreerSchermWachter({
      isGeladen: () => false,
      wacht: (view) => { gewacht.push(view); return new Promise<void>((los) => { klaar = los; }); },
    });
    try {
      const overgang = handmatigeOvergang();
      const root = await monteer(<Schil />);
      await act(async () => { klik('naar-rooster'); await tikken(); });
      // De URL is al gewisseld (terugknop en overlays rekenen daarop)…
      expect(window.location.pathname).toBe('/rooster');
      expect(gewacht).toEqual(['rooster']);
      // …maar het oude scherm staat er nog: er is nog niets geschilderd.
      expect(zichtbareView()).toBe('verlof');

      await act(async () => { klaar(); await tikken(); });
      await act(async () => { overgang.schilder(); await tikken(); });
      expect(zichtbareView()).toBe('rooster');
      await act(async () => { root.unmount(); });
    } finally {
      registreerSchermWachter(null);
    }
  });

  it('een scherm waarvan de code er al is wisselt meteen', async () => {
    const wacht = vi.fn(() => Promise.resolve());
    registreerSchermWachter({ isGeladen: () => true, wacht });
    try {
      const overgang = handmatigeOvergang();
      const root = await monteer(<Schil />);
      await act(async () => { klik('naar-rooster'); });
      await act(async () => { overgang.schilder(); await tikken(); });
      expect(zichtbareView()).toBe('rooster');
      expect(wacht).not.toHaveBeenCalled();
      await act(async () => { root.unmount(); });
    } finally {
      registreerSchermWachter(null);
    }
  });

  it('navigeert gewoon door zonder open lade', async () => {
    const overgang = handmatigeOvergang();
    const root = await monteer(<Schil />);
    await act(async () => { klik('naar-rooster'); });
    await act(async () => { overgang.schilder(); await tikken(); });
    expect(window.location.pathname).toBe('/rooster');
    expect(zichtbareView()).toBe('rooster');

    await act(async () => { window.history.back(); await tikken(); });
    expect(zichtbareView()).toBe('verlof');
    await act(async () => { root.unmount(); });
  });
});

/** Master-detail-attrap: een lijst die het record in de URL kiest (punt 13). */
function Lijst({ view }: { view: 'omleidingen' | 'updates' }) {
  const [id, zetId] = useRecordParam(0, { view });
  return (
    <>
      {/* rauw: testattrap */}
      <button type="button" data-knop="kies-a" onClick={() => zetId('a')} />
      {/* rauw: testattrap */}
      <button type="button" data-knop="kies-b" onClick={() => zetId('b 1')} />
      {/* rauw: testattrap */}
      <button type="button" data-knop="wis" onClick={() => zetId(null)} />
      <span data-record={id ?? ''} />
    </>
  );
}
const gekozenRecord = () => document.querySelector('[data-record]')?.getAttribute('data-record');

/** Op mobiel koppelt DetailPaneel dezelfde URL-selectie aan een overlay. */
function MobieleLijst() {
  const [id, zetId] = useRecordParam(0, { view: 'omleidingen' });
  useHistoryDismiss(id !== null, () => zetId(null));
  return (
    <>
      {/* rauw: testattrap */}
      <button type="button" data-knop="kies-a" onClick={() => zetId('a')} />
      {/* rauw: testattrap */}
      <button type="button" data-knop="kies-b" onClick={() => zetId('b')} />
      {/* rauw: testattrap */}
      <button type="button" data-knop="wis" onClick={() => zetId(null)} />
      <span data-record={id ?? ''} />
    </>
  );
}

describe('useRecordParam: selectie in de URL', () => {
  it('werkt de gesloten URL bij vóór eerder geregistreerde popstate-luisteraars het record lezen', async () => {
    // Chromium behandelt popstate op Window in registratievolgorde, ook
    // voor een later toegevoegde capture-listener. Laat jsdom dezelfde
    // volgorde gebruiken; anders maskeert zijn capture-fase de vastloper.
    const voegToe = window.addEventListener.bind(window);
    const registratie = vi.spyOn(window, 'addEventListener').mockImplementation((naam, luisteraar, opties) => {
      voegToe(naam, luisteraar, naam === 'popstate' && typeof opties === 'object' ? { ...opties, capture: false } : opties);
    });
    window.history.pushState(null, '', '/omleidingen');
    const root = await monteer(<MobieleLijst />);
    try {
      await act(async () => { klik('kies-a'); await tikken(); });
      await act(async () => { klik('wis'); await tikken(); });
      expect(window.location.pathname).toBe('/omleidingen');
      expect(gekozenRecord()).toBe('');
      expect(window.history.state?.vhbOverlay).toBeUndefined();
    } finally {
      await act(async () => { root.unmount(); await tikken(); });
      registratie.mockRestore();
    }
  });

  it.each([
    { naam: 'vanuit de lijst', pad: '/omleidingen', keuzes: ['kies-a'] },
    { naam: 'vanuit een directe link', pad: '/omleidingen/a', keuzes: [] },
    { naam: 'na een recordwissel', pad: '/omleidingen', keuzes: ['kies-a', 'kies-b'] },
  ])('mobiel sluiten $naam ruimt de detailstap op, zodat terug niets heropent', async ({ pad, keuzes }) => {
    window.history.pushState(null, '', pad);
    const root = await monteer(<MobieleLijst />);
    try {
      for (const keuze of keuzes) await act(async () => { klik(keuze); await tikken(); });
      expect(gekozenRecord()).not.toBe('');
      await act(async () => { klik('wis'); await tikken(); });
      expect(gekozenRecord()).toBe('');
      expect(window.location.pathname).toBe('/omleidingen');

      await act(async () => { window.history.back(); await tikken(); });
      expect(window.location.pathname).toBe('/verlof');
      expect(gekozenRecord()).toBe('');
    } finally {
      await act(async () => { root.unmount(); await tikken(); });
    }
  });

  it('mobiele terugknop sluit een gewisseld record en blijft op de lijst', async () => {
    window.history.pushState(null, '', '/omleidingen');
    const root = await monteer(<MobieleLijst />);
    try {
      await act(async () => { klik('kies-a'); await tikken(); });
      await act(async () => { klik('kies-b'); await tikken(); });
      await act(async () => { window.history.back(); await tikken(); });
      expect(window.location.pathname).toBe('/omleidingen');
      expect(gekozenRecord()).toBe('');

      await act(async () => { window.history.back(); await tikken(); });
      expect(window.location.pathname).toBe('/verlof');
    } finally {
      await act(async () => { root.unmount(); await tikken(); });
    }
  });

  it('een opnieuw gemonteerd detail sluit ook na een recordwissel zonder de oude keuze te heropenen', async () => {
    window.history.pushState(null, '', '/omleidingen');
    const root = await monteer(<MobieleLijst />);
    try {
      await act(async () => { klik('kies-a'); await tikken(); });
      await act(async () => { klik('kies-b'); await tikken(); });
      await act(async () => { root.render(<MobieleLijst key="opnieuw" />); await tikken(); });
      expect(gekozenRecord()).toBe('b');
      await act(async () => { klik('wis'); await tikken(); });
      expect(window.location.pathname).toBe('/omleidingen');
      expect(gekozenRecord()).toBe('');
      await act(async () => { window.history.back(); await tikken(); });
      expect(window.location.pathname).toBe('/verlof');
    } finally {
      await act(async () => { root.unmount(); await tikken(); });
    }
  });

  it('leest het record uit het pad en schrijft met replace (geen extra stap per wissel)', async () => {
    window.history.replaceState(null, '', '/omleidingen/x');
    const lengte = window.history.length;
    const root = await monteer(<Lijst view="omleidingen" />);
    expect(gekozenRecord()).toBe('x');

    await act(async () => { klik('kies-a'); await tikken(); });
    expect(window.location.pathname).toBe('/omleidingen/a');
    expect(gekozenRecord()).toBe('a');
    await act(async () => { klik('kies-b'); await tikken(); });
    expect(window.location.pathname).toBe('/omleidingen/b%201');
    expect(gekozenRecord()).toBe('b 1');
    expect(window.history.length).toBe(lengte);

    await act(async () => { klik('wis'); await tikken(); });
    expect(window.location.pathname).toBe('/omleidingen');
    expect(gekozenRecord()).toBe('');
    await act(async () => { root.unmount(); });
  });

  it('valt terug op lokale state als het scherm niet op zijn route staat', async () => {
    window.history.replaceState(null, '', '/verlof');
    const root = await monteer(<Lijst view="updates" />);
    await act(async () => { klik('kies-a'); await tikken(); });
    expect(gekozenRecord()).toBe('a');
    expect(window.location.pathname).toBe('/verlof');
    await act(async () => { root.unmount(); });
  });
});

describe('recordlink van een koude start (polish P2b)', () => {
  /** Zoals normaliseerStartUrl het zet: de lijst eronder, het record gemerkt erboven. */
  const koudeStart = (lijst: string, record: string) => {
    window.history.pushState(null, '', lijst);
    window.history.pushState({ vhbOuderStap: true, vhbOverlayTerug: lijst }, '', record);
  };

  it('inline: sluiten gaat terug naar de lijst i.p.v. een tweede lijst-entry', async () => {
    koudeStart('/omleidingen', '/omleidingen/a');
    const root = await monteer(<Lijst view="omleidingen" />);
    try {
      expect(gekozenRecord()).toBe('a');
      await act(async () => { klik('wis'); await tikken(); });
      expect(window.location.pathname).toBe('/omleidingen');
      expect(gekozenRecord()).toBe('');
      await act(async () => { window.history.back(); await tikken(); });
      expect(window.location.pathname).toBe('/verlof');
    } finally {
      await act(async () => { root.unmount(); await tikken(); });
    }
  });

  it('overlay: sluiten ruimt de overlay én de recordstap op', async () => {
    koudeStart('/omleidingen', '/omleidingen/a');
    const root = await monteer(<MobieleLijst />);
    try {
      await act(async () => { klik('wis'); await tikken(); });
      expect(window.location.pathname).toBe('/omleidingen');
      expect(window.history.state?.vhbOverlay).toBeUndefined();
      expect(window.history.state?.vhbOuderStap).toBeUndefined();
      await act(async () => { window.history.back(); await tikken(); });
      expect(window.location.pathname).toBe('/verlof');
    } finally {
      await act(async () => { root.unmount(); await tikken(); });
    }
  });

  it('overlay: terug sluit het record en toont de lijst; nog eens terug = de vorige pagina', async () => {
    koudeStart('/omleidingen', '/omleidingen/a');
    const root = await monteer(<MobieleLijst />);
    try {
      await act(async () => { window.history.back(); await tikken(); await tikken(); });
      expect(window.location.pathname).toBe('/omleidingen');
      expect(gekozenRecord()).toBe('');
      await act(async () => { window.history.back(); await tikken(); });
      expect(window.location.pathname).toBe('/verlof');
    } finally {
      await act(async () => { root.unmount(); await tikken(); });
    }
  });
});

