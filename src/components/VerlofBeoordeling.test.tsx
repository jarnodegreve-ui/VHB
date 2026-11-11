import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afwezigenInPeriode, BESLIS_SLOT_MS, VerlofBeoordeling, VerlofBeoordelingInhoud, VerlofBeoordelingKnoppen, type VerlofBeoordelingActies } from './VerlofBeoordeling';
import { DetailPaneel } from './DetailPaneel';
import { STANDAARD_VERLOF_LIMIETEN } from '../../shared/schemas/verlofLimieten';
import type { LeaveRequest, Shift, User } from '../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// jsdom kent geen scrollIntoView (DetailPaneel brengt zich in beeld).
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

/** matchMedia ontbreekt in jsdom; `desktop` bepaalt of lg+ (inline paneel) geldt. */
let desktop = false;
let wortels: Root[] = [];
beforeEach(() => {
  desktop = false;
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: desktop, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
});
afterEach(() => {
  for (const r of wortels) act(() => r.unmount());
  wortels = [];
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const AANVRAAG: LeaveRequest = { id: 'l-1', userId: '3', startDate: '2026-10-05', endDate: '2026-10-07', type: 'betaald_verlof', status: 'pending', createdAt: '2026-09-20T08:00:00Z' };
const VOLGENDE: LeaveRequest = { id: 'l-2', userId: '4', startDate: '2026-10-06', endDate: '2026-10-06', type: 'betaald_verlof', status: 'pending', createdAt: '2026-09-21T08:00:00Z' };

const knop = (tekst: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === tekst);
/** Het element (kopje, regel) met precies deze tekst. */
const metTekst = (tekst: string) => [...document.querySelectorAll<HTMLElement>('p')].find((p) => p.textContent === tekst);
const klik = async (tekst: string) => {
  const el = knop(tekst);
  if (!el) throw new Error(`knop ${tekst} ontbreekt`);
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};
const typ = async (tekst: string) => {
  const vak = document.querySelector<HTMLTextAreaElement>('textarea');
  if (!vak) throw new Error('het tekstvak ontbreekt');
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(vak, tekst);
    vak.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

/** Tekent `ui` in een eigen container; `teken` tekent er later iets anders in (zelfde boom, dus zelfde toestand). */
async function monteerUi(ui: ReactElement) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  wortels.push(root);
  const teken = async (volgende: ReactElement) => { await act(async () => { root.render(volgende); }); };
  await teken(ui);
  return { container, teken };
}

const knoppen = (aanvraag: LeaveRequest, onDecide: VerlofBeoordelingActies['onDecide']) => (
  <VerlofBeoordelingKnoppen aanvraag={aanvraag} onDecide={onDecide} onClose={() => undefined} today="2026-09-22" isPlanner />
);
const monteer = (onDecide: VerlofBeoordelingActies['onDecide']) => monteerUi(knoppen(AANVRAAG, onDecide));

describe('VerlofBeoordelingKnoppen: afwijzen met reden', () => {
  it('opent bij Afwijzen eerst een tekstvak en beslist pas na de tweede klik, mét de getrimde reden', async () => {
    const onDecide = vi.fn<VerlofBeoordelingActies['onDecide']>();
    await monteer(onDecide);
    expect(document.querySelector('textarea')).toBeNull();

    await klik('Afwijzen');
    expect(onDecide).not.toHaveBeenCalled();
    const vak = document.querySelector<HTMLTextAreaElement>('textarea');
    expect(vak).not.toBeNull();
    // Goedkeuren is in de weigerstap weg: één beslissing tegelijk.
    expect(knop('Goedkeuren')).toBeUndefined();

    await typ('  Te veel collega\'s al vrij.  ');
    await klik('Afwijzen');
    expect(onDecide).toHaveBeenCalledWith('l-1', 'rejected', 'pending', "Te veel collega's al vrij.");
  });

  it('beslist zonder reden als het vak leeg blijft, en Terug sluit de weigerstap zonder beslissing', async () => {
    const onDecide = vi.fn<VerlofBeoordelingActies['onDecide']>();
    await monteer(onDecide);
    await klik('Afwijzen');
    await klik('Terug');
    expect(document.querySelector('textarea')).toBeNull();
    expect(knop('Goedkeuren')).toBeDefined();
    expect(onDecide).not.toHaveBeenCalled();

    await klik('Afwijzen');
    await klik('Afwijzen');
    expect(onDecide).toHaveBeenCalledWith('l-1', 'rejected', 'pending', undefined);
  });
});

// Het desktoppaneel is begrensd (ronde 6): de voet groeit naar boven en de
// onderste rij blijft staan. De rij van de stap met de reden heeft daarom
// dezelfde indeling als de gewone rij, zodat de verzendknop nooit onder
// Afwijzen ligt (de tweede klik van een dubbelklik wees anders meteen af,
// zonder reden). De plaatsen zelf meet de e2e-spec; hier de opbouw.
describe('VerlofBeoordelingKnoppen: de rij van de stap met de reden', () => {
  const dubbel = async (tekst: string, detail: number) => {
    await act(async () => { knop(tekst)!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail })); });
  };

  it('de tweede klik van een dubbelklik (klikteller 2) op Terug sluit de stap niet; een gewone klik wel', async () => {
    const onDecide = vi.fn<VerlofBeoordelingActies['onDecide']>();
    await monteer(onDecide);
    await klik('Afwijzen');
    await dubbel('Terug', 2);
    expect(document.querySelector('textarea')).not.toBeNull();
    await dubbel('Terug', 3);
    expect(document.querySelector('textarea')).not.toBeNull();
    expect(onDecide).not.toHaveBeenCalled();
    await dubbel('Terug', 1);
    expect(document.querySelector('textarea')).toBeNull();
    expect(knop('Goedkeuren')).toBeDefined();
  });

  it('de vaste knoppen (links, historiek) houden hun plaats, onzichtbaar en inert; de twee knoppen delen de rest zoals in de gewone rij', async () => {
    const onHistoriek = vi.fn();
    await monteerUi(
      <VerlofBeoordelingKnoppen
        aanvraag={AANVRAAG}
        onDecide={() => undefined}
        onHistoriek={onHistoriek}
        onClose={() => undefined}
        today="2026-09-22"
        isPlanner
        // rauw: testattrap zonder design-primitieven
        links={<button type="button" aria-label="Terug naar de dag" />}
      />,
    );
    // De gewone rij: links, historiek, het blok met de twee beslisknoppen.
    const gewoon = knop('Goedkeuren')!.parentElement!.parentElement!;
    expect([...gewoon.children].map((el) => el.getAttribute('aria-label') ?? el.textContent)).toEqual(['Terug naar de dag', 'Wijzigingsgeschiedenis', 'AfwijzenGoedkeuren']);

    await klik('Afwijzen');
    // De rij van de stap: de plaatshouder, dan Terug en de verzendknop.
    const rij = knop('Terug')!.parentElement!;
    expect(rij.children).toHaveLength(3);
    const [plaatshouder, ...beslis] = [...rij.children];
    expect(plaatshouder.hasAttribute('inert')).toBe(true);
    expect(plaatshouder.className).toContain('invisible');
    // Alleen op desktop (lg, de grens van DetailPaneel): op de telefoon neemt
    // de plaatshouder geen plaats in en blijft de rij zoals ze was.
    expect(plaatshouder.className.split(' ')).toEqual(expect.arrayContaining(['hidden', 'lg:flex']));
    expect(plaatshouder.className.split(' ')).not.toContain('flex');
    expect([...plaatshouder.children].map((el) => el.getAttribute('aria-label'))).toEqual(['Terug naar de dag', 'Wijzigingsgeschiedenis']);
    expect(beslis.map((b) => `${b.textContent}:${(b as HTMLButtonElement).type}`)).toEqual(['Terug:button', 'Afwijzen:submit']);
  });

  it('zonder vaste knoppen is er geen plaatshouder: twee helften over de volle breedte, zoals de gewone rij dan ook', async () => {
    await monteer(() => undefined);
    await klik('Afwijzen');
    const rij = knop('Terug')!.parentElement!;
    expect([...rij.children].map((b) => b.textContent)).toEqual(['Terug', 'Afwijzen']);
    expect(rij.querySelector('[inert]')).toBeNull();
  });
});

// Ronde 6, punt 15: wisselt het paneel naar een andere aanvraag, dan staat
// Goedkeuren van de nieuwe precies waar de vorige klik viel. De knoppen zijn
// daarom eerst BESLIS_SLOT_MS inert. Hier met een stilgezette klok, zodat het
// bewijs niet van de snelheid van de machine afhangt (de e2e-spec doet het
// met echte invoer).
describe('VerlofBeoordelingKnoppen: slot na een wissel van aanvraag', () => {
  const slotOp = () => !!knop('Goedkeuren')?.closest('[inert]');
  const tik = async (ms: number) => { await act(async () => { vi.advanceTimersByTime(ms); }); };

  it('de afspraak is minstens 600 ms', () => {
    expect(BESLIS_SLOT_MS).toBeGreaterThanOrEqual(600);
  });

  it('bij het openen zit er geen slot op: de eerste klik beslist gewoon', async () => {
    const onDecide = vi.fn<VerlofBeoordelingActies['onDecide']>();
    await monteer(onDecide);
    expect(slotOp()).toBe(false);
    await klik('Goedkeuren');
    expect(onDecide).toHaveBeenCalledWith('l-1', 'approved', 'pending', undefined);
  });

  it('na de wissel zit het slot er BESLIS_SLOT_MS op; wie zolang wacht, beslist daarna over de nieuwe aanvraag', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const onDecide = vi.fn<VerlofBeoordelingActies['onDecide']>();
    const { teken } = await monteer(onDecide);
    await teken(knoppen(VOLGENDE, onDecide));

    // Vanaf de eerste keer dat de nieuwe aanvraag getekend is.
    expect(slotOp()).toBe(true);
    await tik(BESLIS_SLOT_MS - 1);
    expect(slotOp()).toBe(true);
    await tik(1);
    expect(slotOp()).toBe(false);
    await klik('Goedkeuren');
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith('l-2', 'approved', 'pending', undefined);
  });

  // Een vast venster hield wie blijft doorklikken niet tegen: de klik net na
  // het slot besliste de volgende aanvraag. Elke poging tijdens het slot
  // begint daarom opnieuw te tellen. jsdom kent geen inert, dus hier loopt
  // een klik via de handlers van de knoppen (de weg van een browser zonder
  // inert); de vanger op de rij staat in de test hieronder en in de e2e.
  for (const welke of ['Goedkeuren', 'Afwijzen']) {
    it(`een klik op ${welke} tijdens het slot doet niets en zet het slot opnieuw`, async () => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      const onDecide = vi.fn<VerlofBeoordelingActies['onDecide']>();
      const { teken } = await monteer(onDecide);
      await teken(knoppen(VOLGENDE, onDecide));

      await tik(BESLIS_SLOT_MS - 1);
      await klik(welke);
      expect(onDecide).not.toHaveBeenCalled();
      expect(document.querySelector('textarea')).toBeNull();
      // Zonder die klik was het slot er nu af.
      await tik(BESLIS_SLOT_MS - 1);
      expect(slotOp()).toBe(true);
      await klik(welke);
      expect(onDecide).not.toHaveBeenCalled();
      expect(document.querySelector('textarea')).toBeNull();
      await tik(BESLIS_SLOT_MS);
      expect(slotOp()).toBe(false);
    });
  }

  it('om de 300 ms blijven klikken beslist niets, drie seconden lang; 650 ms na de laatste klik werkt de knop', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const onDecide = vi.fn<VerlofBeoordelingActies['onDecide']>();
    const { teken } = await monteer(onDecide);
    await teken(knoppen(VOLGENDE, onDecide));

    for (let ms = 300; ms <= 3000; ms += 300) {
      await tik(300);
      await klik('Goedkeuren');
      expect(slotOp()).toBe(true);
    }
    expect(onDecide).not.toHaveBeenCalled();
    await tik(BESLIS_SLOT_MS - 1);
    expect(slotOp()).toBe(true);
    await tik(1);
    expect(slotOp()).toBe(false);
    await klik('Goedkeuren');
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith('l-2', 'approved', 'pending', undefined);
  });

  it('een aanwijzer op de knoppenrij tijdens het slot zet het opnieuw (de inerte knoppen geven hem door aan de rij)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const onDecide = vi.fn<VerlofBeoordelingActies['onDecide']>();
    const { teken } = await monteer(onDecide);
    await teken(knoppen(VOLGENDE, onDecide));
    // In een browser is de rij (de ouder van het inerte blok) het doel van de aanwijzer.
    const blok = knop('Goedkeuren')!.parentElement!;
    expect(blok.hasAttribute('inert')).toBe(true);
    const aanwijzer = async () => { await act(async () => { blok.parentElement!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); }); };

    await tik(BESLIS_SLOT_MS - 1);
    await aanwijzer();
    await tik(BESLIS_SLOT_MS - 1);
    expect(slotOp()).toBe(true);
    await tik(1);
    expect(slotOp()).toBe(false);
    // Zonder slot doet een aanwijzer op de rij niets: de knop werkt gewoon.
    await aanwijzer();
    expect(slotOp()).toBe(false);
    await klik('Goedkeuren');
    expect(onDecide).toHaveBeenCalledTimes(1);
  });

  it('een tweede wissel binnen het slot begint opnieuw te tellen, ook na een klik vlak ervoor', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const onDecide = vi.fn<VerlofBeoordelingActies['onDecide']>();
    const { teken } = await monteer(onDecide);
    await teken(knoppen(VOLGENDE, onDecide));
    // Wissel op 0, klik op 300 (het slot loopt nu tot 950), tweede wissel op 900.
    await tik(300);
    await klik('Goedkeuren');
    await tik(600);
    await teken(knoppen({ ...AANVRAAG, id: 'l-3' }, onDecide));
    // Op 950 zou de klok van de klik aflopen: die mag de tweede wissel niet van het slot halen.
    await tik(100);
    expect(slotOp()).toBe(true);
    await klik('Goedkeuren');
    expect(onDecide).not.toHaveBeenCalled();
    // Die klik (op 1000) telt zelf ook: het slot loopt tot 1650.
    await tik(BESLIS_SLOT_MS - 1);
    expect(slotOp()).toBe(true);
    await tik(1);
    expect(slotOp()).toBe(false);
  });

  it('dezelfde aanvraag opnieuw getekend (verse gegevens) zet er geen slot op', async () => {
    const onDecide = vi.fn<VerlofBeoordelingActies['onDecide']>();
    const { teken } = await monteer(onDecide);
    await teken(knoppen({ ...AANVRAAG, comment: 'intussen aangevuld' }, onDecide));
    expect(slotOp()).toBe(false);
    await klik('Goedkeuren');
    expect(onDecide).toHaveBeenCalledTimes(1);
  });

  it('de weigerstap en de getypte reden van de vorige aanvraag gaan niet mee', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const onDecide = vi.fn<VerlofBeoordelingActies['onDecide']>();
    const { teken } = await monteer(onDecide);
    await klik('Afwijzen');
    await typ('Reden voor de vorige');
    await teken(knoppen(VOLGENDE, onDecide));

    // Meteen de gewone knoppen, op slot; geen tekstvak met de oude reden.
    expect(document.querySelector('textarea')).toBeNull();
    expect(slotOp()).toBe(true);
    await tik(BESLIS_SLOT_MS);
    await klik('Afwijzen');
    expect(document.querySelector<HTMLTextAreaElement>('textarea')?.value).toBe('');
    await klik('Afwijzen');
    expect(onDecide).toHaveBeenCalledTimes(1);
    expect(onDecide).toHaveBeenCalledWith('l-2', 'rejected', 'pending', undefined);
  });

  it('terwijl een beslissing onderweg is, vertrekt er geen tweede (ook niet bij twee klikken in dezelfde tel)', async () => {
    let klaar = () => {};
    const onDecide = vi.fn<VerlofBeoordelingActies['onDecide']>(() => new Promise<void>((r) => { klaar = r; }));
    await monteer(onDecide);
    const el = knop('Goedkeuren')!;
    await act(async () => {
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onDecide).toHaveBeenCalledTimes(1);
    // De knop is nu uit (bezig); een klik die er toch langs komt doet niets.
    await act(async () => { knop('Goedkeuren')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
    expect(onDecide).toHaveBeenCalledTimes(1);
    // Na het antwoord (hier: het paneel bleef staan) werkt de knop weer.
    await act(async () => { klaar(); });
    await klik('Goedkeuren');
    expect(onDecide).toHaveBeenCalledTimes(2);
  });
});

describe('VerlofBeoordelingKnoppen: focus na een wissel van aanvraag', () => {
  /** Een paneel zoals DetailPaneel en SlideOver het opbouwen: kop met de titel, inhoud, blok met de knoppen. */
  const inPaneel = (aanvraag: LeaveRequest, als: 'section' | 'dialog' = 'section') => {
    const Schil = als === 'section' ? 'section' : 'div';
    return (
      <div>
        {/* rauw: testattrap zonder design-primitieven */}
        <button type="button" data-rij="">Rij in de lijst ernaast</button>
        <Schil {...(als === 'dialog' ? { role: 'dialog' } : {})}>
          <div><h2>{aanvraag.id}</h2></div>
          <div data-inhoud="" />
          <div>{knoppen(aanvraag, () => undefined)}</div>
        </Schil>
      </div>
    );
  };

  for (const als of ['section', 'dialog'] as const) {
    it(`de focus gaat van de beslisknop naar de titel van het paneel (${als === 'section' ? 'desktopkaart' : 'SlideOver'})`, async () => {
      const { teken } = await monteerUi(inPaneel(AANVRAAG, als));
      knop('Goedkeuren')!.focus();
      expect(document.activeElement).toBe(knop('Goedkeuren'));
      const inhoud = document.querySelector<HTMLElement>('[data-inhoud]')!;
      inhoud.scrollTop = 120;

      await teken(inPaneel(VOLGENDE, als));
      const titel = document.querySelector('h2')!;
      expect(titel.textContent).toBe('l-2');
      expect(document.activeElement).toBe(titel);
      // Nooit een beslisknop: Enter of spatie doet op de titel niets.
      expect(titel.getAttribute('tabindex')).toBe('-1');
      // De nieuwe aanvraag begint bovenaan.
      expect(inhoud.scrollTop).toBe(0);
    });
  }

  it('wie in de lijst ernaast een andere rij koos, houdt daar de focus', async () => {
    const { teken } = await monteerUi(inPaneel(AANVRAAG));
    const rij = document.querySelector<HTMLButtonElement>('[data-rij]')!;
    rij.focus();
    await teken(inPaneel(VOLGENDE));
    expect(document.activeElement).toBe(rij);
  });

  it('zonder paneel eromheen (losse knoppen) gebeurt er niets en crasht er niets', async () => {
    const { teken } = await monteer(() => undefined);
    knop('Goedkeuren')!.focus();
    await teken(knoppen(VOLGENDE, () => undefined));
    expect(knop('Goedkeuren')).toBeDefined();
  });
});

// De knoppen houden het desktoppaneel binnen het venster: ze meten de kaart
// van DetailPaneel en begrenzen haar hoogte. Die koppeling loopt over de
// opbouw van DetailPaneel (section > kop, inhoud, blok met de knoppen); deze
// tests tekenen het echte DetailPaneel, zodat een wijziging aan die opbouw
// hier omvalt en niet pas in de e2e.
describe('VerlofBeoordeling: de knoppen blijven op desktop in het venster', () => {
  const USERS = [{ id: '3', name: 'Bart De Smet', role: 'chauffeur' }, { id: '4', name: 'Marc Goossens', role: 'chauffeur' }] as User[];
  let vensterHoogte = 900;
  let kaartBoven = 188;

  /** jsdom rekent geen opmaak: de maten die pasPaneelIn leest komen hieruit. */
  beforeEach(() => {
    vensterHoogte = 900;
    kaartBoven = 188;
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return { top: this.tagName === 'SECTION' ? kaartBoven : 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    });
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) {
      return this.hasAttribute('data-scroll-root') ? vensterHoogte : 0;
    });
    // Kop 105 px, het blok met de knoppen 77 px (de maten van het echte paneel).
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      if (this.parentElement?.tagName !== 'SECTION') return 0;
      return this === this.parentElement.firstElementChild ? 105 : this === this.parentElement.lastElementChild ? 77 : 0;
    });
  });

  const paneel = (aanvraag: LeaveRequest | null) => (
    <div data-scroll-root="">
      <VerlofBeoordeling aanvraag={aanvraag} users={USERS} shifts={[]} leaveRequests={aanvraag ? [aanvraag] : []} limieten={STANDAARD_VERLOF_LIMIETEN} onDecide={() => undefined} onClose={() => undefined} today="2026-09-22" isPlanner />
    </div>
  );
  const kaart = () => document.querySelector<HTMLElement>('section[aria-label]');

  it('de kaart wordt nooit hoger dan wat er onder haar bovenkant in het venster past', async () => {
    desktop = true;
    await monteerUi(paneel(AANVRAAG));
    expect(kaart()).not.toBeNull();
    // 900 hoog, kaart begint op 188, 16 px vrije rand.
    expect(kaart()!.style.maxHeight).toBe('696px');
  });

  it('houdt afstand tot de bovenrand wanneer het in beeld gebracht wordt: daar plakt de topbar, en de naam mag er niet achter liggen', async () => {
    desktop = true;
    await monteerUi(paneel(AANVRAAG));
    // De wortel van DetailPaneel (die het paneel in beeld scrolt) draagt de marge.
    expect(kaart()!.closest('.scroll-mt-20')).not.toBeNull();
  });

  it('volgt het venster bij een andere maat', async () => {
    desktop = true;
    await monteerUi(paneel(AANVRAAG));
    vensterHoogte = 720;
    await act(async () => { window.dispatchEvent(new Event('resize')); });
    expect(kaart()!.style.maxHeight).toBe('516px');
  });

  it('een venster dat te laag is voor kop en knoppen samen knipt de knoppen niet weg', async () => {
    desktop = true;
    vensterHoogte = 300;
    await monteerUi(paneel(AANVRAAG));
    // Kop 105 + knoppen 77 + minstens 48 px inhoud, ook al past dat niet meer.
    expect(kaart()!.style.maxHeight).toBe('230px');
  });

  it('meet opnieuw bij een andere aanvraag en bij de stap met de reden', async () => {
    desktop = true;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { teken } = await monteerUi(paneel(AANVRAAG));
    kaartBoven = 240;
    await teken(paneel(VOLGENDE));
    expect(kaart()!.style.maxHeight).toBe('644px');
    kaartBoven = 188;
    await act(async () => { vi.advanceTimersByTime(BESLIS_SLOT_MS); });
    await klik('Afwijzen');
    expect(document.querySelector('textarea')).not.toBeNull();
    expect(kaart()!.style.maxHeight).toBe('696px');
  });

  it('gaan de knoppen weg terwijl de kaart blijft (verlofkalender: terug naar de dag), dan groeit de kaart weer vrij', async () => {
    desktop = true;
    const dagpaneel = (beoordeel: boolean) => (
      <div data-scroll-root="">
        <DetailPaneel open onClose={() => undefined} plakkend={false} verbergLeeg title="Dag" footer={beoordeel ? knoppen(AANVRAAG, () => undefined) : <span>Sluiten</span>}>
          inhoud
        </DetailPaneel>
      </div>
    );
    const { teken } = await monteerUi(dagpaneel(true));
    expect(kaart()!.style.maxHeight).toBe('696px');
    await teken(dagpaneel(false));
    expect(kaart()).not.toBeNull();
    expect(kaart()!.style.maxHeight).toBe('');
  });

  it('op de telefoon (SlideOver) wordt er niets begrensd', async () => {
    desktop = false;
    await monteerUi(paneel(AANVRAAG));
    expect(kaart()).toBeNull();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect([...document.querySelectorAll<HTMLElement>('*')].filter((el) => el.style.maxHeight !== '')).toEqual([]);
  });

  it('knoppen in een vreemd vak (geen DetailPaneel) begrenzen niets', async () => {
    await monteerUi(
      <div data-scroll-root="">
        <section data-vreemd="">
          <article><div>{knoppen(AANVRAAG, () => undefined)}</div></article>
        </section>
      </div>,
    );
    expect(document.querySelector<HTMLElement>('[data-vreemd]')!.style.maxHeight).toBe('');
  });
});

describe('afwezigenInPeriode', () => {
  const verlof = (id: string, userId: string, van: string, tot: string, extra: Partial<LeaveRequest> = {}): LeaveRequest => ({
    id, userId, startDate: van, endDate: tot, type: 'betaald_verlof', status: 'approved', createdAt: '2026-09-01T08:00:00Z', ...extra,
  });
  const DEZE = verlof('deze', '3', '2026-10-05', '2026-10-09', { status: 'pending' });

  it('geeft per persoon zijn goedgekeurde periodes die de aanvraag raken, de vroegste eerst', () => {
    const lijst = [
      verlof('laat', '6', '2026-10-08', '2026-10-12'),
      verlof('vroeg', '5', '2026-10-01', '2026-10-05'),
      verlof('midden', '7', '2026-10-06', '2026-10-06'),
    ];
    expect(afwezigenInPeriode(lijst, DEZE).map((p) => p.map((r) => r.id))).toEqual([['vroeg'], ['midden'], ['laat']]);
  });

  it('twee periodes van dezelfde chauffeur zijn één regel, op de plaats van zijn vroegste', () => {
    const lijst = [verlof('a2', '5', '2026-10-09', '2026-10-09'), verlof('b', '6', '2026-10-06', '2026-10-07'), verlof('a1', '5', '2026-10-05', '2026-10-05')];
    expect(afwezigenInPeriode(lijst, DEZE).map((p) => p.map((r) => r.id))).toEqual([['a1', 'a2'], ['b']]);
  });

  it('telt niet mee: de aanvrager zelf, wat niet goedgekeurd is en wat de periode niet raakt', () => {
    const lijst = [
      verlof('eigen', '3', '2026-10-06', '2026-10-06'),
      verlof('wacht', '5', '2026-10-06', '2026-10-06', { status: 'pending' }),
      verlof('afgewezen', '6', '2026-10-06', '2026-10-06', { status: 'rejected' }),
      verlof('geannuleerd', '7', '2026-10-06', '2026-10-06', { status: 'cancelled' }),
      verlof('ervoor', '8', '2026-10-01', '2026-10-04'),
      verlof('erna', '9', '2026-10-10', '2026-10-11'),
    ];
    expect(afwezigenInPeriode(lijst, DEZE)).toEqual([]);
  });

  it('wijzigt de lijst van het scherm niet', () => {
    const lijst = [verlof('b', '6', '2026-10-08', '2026-10-08'), verlof('a', '5', '2026-10-05', '2026-10-05')];
    const kopie = [...lijst];
    afwezigenInPeriode(lijst, DEZE);
    expect(lijst).toEqual(kopie);
  });
});

describe('VerlofBeoordelingInhoud: Dekking deze periode noemt wie er al vrij is', () => {
  const DEZE: LeaveRequest = { id: 'deze', userId: '3', startDate: '2026-10-05', endDate: '2026-10-09', type: 'betaald_verlof', status: 'pending', createdAt: '2026-09-20T08:00:00Z' };
  const collega = (n: number): User => ({ id: String(10 + n), name: `Collega ${String.fromCharCode(65 + n)}`, role: 'chauffeur' } as User);
  const goedgekeurd = (n: number, van: string, tot: string): LeaveRequest => ({ id: `g${n}-${van}`, userId: String(10 + n), startDate: van, endDate: tot, type: 'betaald_verlof', status: 'approved', createdAt: '2026-09-01T08:00:00Z' });
  const inhoud = (anderen: LeaveRequest[], users: User[]) => (
    <VerlofBeoordelingInhoud aanvraag={DEZE} users={[{ id: '3', name: 'Bart De Smet', role: 'chauffeur' } as User, ...users]} shifts={[]} leaveRequests={[DEZE, ...anderen]} limieten={STANDAARD_VERLOF_LIMIETEN} />
  );
  /** De kaart "Dekking deze periode": de ouder van haar kopje. */
  const dekking = () => metTekst('Dekking deze periode')?.parentElement ?? null;

  it('namen met hun periode, één dag als die ene datum, twee periodes van dezelfde chauffeur op één regel', async () => {
    await monteerUi(inhoud(
      [goedgekeurd(0, '2026-10-06', '2026-10-08'), goedgekeurd(1, '2026-10-05', '2026-10-05'), goedgekeurd(1, '2026-10-09', '2026-10-12')],
      [collega(0), collega(1)],
    ));
    const blok = dekking()!;
    expect(blok.textContent).toContain('Er zijn al 2 andere chauffeurs met goedgekeurd verlof in deze periode');
    const regels = [...blok.querySelectorAll('li')].map((li) => li.textContent);
    // Het aantal en de namen komen uit dezelfde bron: twee chauffeurs, twee regels.
    expect(regels).toHaveLength(2);
    expect(regels[0]).toContain('Collega B');
    expect(regels[0]).toContain('05/10/2026, 09/10/2026 t/m 12/10/2026');
    expect(regels[1]).toContain('Collega A');
    expect(regels[1]).toContain('06/10/2026 t/m 08/10/2026');
    expect(blok.textContent).not.toContain('+ ');
  });

  it('hoogstens zes regels, daarna "+ n anderen"', async () => {
    const users = Array.from({ length: 8 }, (_, n) => collega(n));
    await monteerUi(inhoud(users.map((_, n) => goedgekeurd(n, '2026-10-06', '2026-10-07')), users));
    const blok = dekking()!;
    expect(blok.textContent).toContain('Er zijn al 8 andere chauffeurs');
    expect(blok.querySelectorAll('li')).toHaveLength(6);
    expect(blok.textContent).toContain('+ 2 anderen');
  });

  it('zeven chauffeurs: "+ 1 andere"; zes: geen regel erbij', async () => {
    const users = Array.from({ length: 7 }, (_, n) => collega(n));
    const { teken } = await monteerUi(inhoud(users.map((_, n) => goedgekeurd(n, '2026-10-06', '2026-10-07')), users));
    expect(dekking()!.textContent).toContain('+ 1 andere');
    expect(dekking()!.textContent).not.toContain('+ 1 anderen');
    await teken(inhoud(users.slice(0, 6).map((_, n) => goedgekeurd(n, '2026-10-06', '2026-10-07')), users));
    expect(dekking()!.querySelectorAll('li')).toHaveLength(6);
    expect(dekking()!.textContent).not.toContain('+ ');
  });

  it('niemand anders vrij: geen blok', async () => {
    await monteerUi(inhoud([], []));
    expect(document.body.textContent).not.toContain('Dekking deze periode');
  });

  it('het blok van het scherm ("Ook aangevraagd") staat na de limiet en vóór de conflicten', async () => {
    // Twee anderen al vrij op dezelfde dag (limiet 2) en één ingeplande dienst.
    const users = [collega(0), collega(1)];
    const dienst: Shift = { id: 's1', date: '2026-10-06', startTime: '06:00', endTime: '14:00', line: '2101', busNumber: '', loopnr: '4500', driverId: '3' };
    await monteerUi(
      <VerlofBeoordelingInhoud
        aanvraag={DEZE}
        users={[{ id: '3', name: 'Bart De Smet', role: 'chauffeur' } as User, ...users]}
        shifts={[dienst]}
        leaveRequests={[DEZE, goedgekeurd(0, '2026-10-06', '2026-10-06'), goedgekeurd(1, '2026-10-06', '2026-10-06')]}
        limieten={STANDAARD_VERLOF_LIMIETEN}
        wachtrij={<p>Ook aangevraagd voor deze periode</p>}
      />,
    );
    const volgorde = ['Dekking deze periode', 'Boven de verloflimiet', 'Ook aangevraagd voor deze periode', 'Conflict met planning'].map((t) => metTekst(t));
    expect(volgorde.every(Boolean)).toBe(true);
    for (let i = 1; i < volgorde.length; i++) {
      expect(volgorde[i - 1]!.compareDocumentPosition(volgorde[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  // De beslisknoppen staan altijd in beeld, de limietkaart vaak onder de vouw
  // van het paneel: het signaal staat daarom ook in de badgerij bovenaan.
  it('boven de limiet: een rode badge bovenaan, uit dezelfde uitkomst als de kaart met de dagen; anders geen van beide', async () => {
    const users = [collega(0), collega(1)];
    const badge = () => [...document.querySelectorAll<HTMLElement>('span')].find((s) => s.textContent === 'Boven de limiet');
    // Twee anderen al vrij op dezelfde dag (limiet 2): met deze aanvraag erbij drie.
    const { teken } = await monteerUi(inhoud([goedgekeurd(0, '2026-10-06', '2026-10-06'), goedgekeurd(1, '2026-10-06', '2026-10-06')], users));
    expect(badge()).toBeDefined();
    expect(metTekst('Boven de verloflimiet')).toBeDefined();
    // In de badgerij: vóór de periode, dus vóór alles wat onder de vouw kan vallen.
    expect(badge()!.compareDocumentPosition(metTekst('Periode')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    await teken(inhoud([goedgekeurd(0, '2026-10-06', '2026-10-06')], users));
    expect(badge()).toBeUndefined();
    expect(metTekst('Boven de verloflimiet')).toBeUndefined();
  });

  it('zonder blok van het scherm (verlofkalender) staat er niets extra', async () => {
    await monteerUi(inhoud([], []));
    expect(metTekst('Ook aangevraagd voor deze periode')).toBeUndefined();
  });
});
