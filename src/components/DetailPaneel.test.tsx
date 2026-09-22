import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { fireEvent, screen } from '@testing-library/react';
import { DetailPaneel, MasterDetail, useDetailPoort, useStandaardKeuze } from './DetailPaneel';
import { SluitKnop } from './Modal';
import { useVuil } from '../lib/formulier';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** matchMedia ontbreekt in jsdom; `desktop` bepaalt of lg+ (inline paneel) geldt. */
let desktop = true;
beforeEach(() => {
  desktop = true;
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: desktop,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }));
});
// jsdom kent geen scrollIntoView (DetailPaneel brengt zich in beeld).
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
let gemonteerd: Root[] = [];
afterEach(() => {
  for (const r of gemonteerd) act(() => r.unmount());
  gemonteerd = [];
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function monteer(ui: React.ReactElement): Promise<{ root: Root; container: HTMLElement }> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(ui); });
  gemonteerd.push(root);
  return { root, container };
}

const klik = async (naam: string) => {
  const el = document.querySelector<HTMLButtonElement>(`[data-knop="${naam}"]`);
  if (!el) throw new Error(`knop ${naam} ontbreekt`);
  await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};
const gekozenNu = () => document.querySelector('[data-gekozen]')!.getAttribute('data-gekozen');

type Item = { id: string };
const ALLE: Item[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

/** Master-detail-attrap: lijst in state, keuze in state, knoppen om items
 *  weg te halen / terug te zetten (optimistische DELETE + refetch/undo) en
 *  om zelf te kiezen. */
function Harnas() {
  const [items, setItems] = useState<Item[]>(ALLE);
  const [gekozen, setGekozen] = useState<string | null>(null);
  useStandaardKeuze({
    items,
    sleutelVan: (i) => i.id,
    gekozen,
    kies: (i) => setGekozen(i.id),
    wis: () => setGekozen(null),
  });
  return (
    <div data-gekozen={gekozen ?? ''}>
      {/* rauw: testattrap zonder design-primitieven */}
      {ALLE.map((i) => (
        <span key={i.id}>
          <button type="button" data-knop={`weg-${i.id}`} onClick={() => setItems((p) => p.filter((x) => x.id !== i.id))} />
          <button type="button" data-knop={`terug-${i.id}`} onClick={() => setItems(() => ALLE.filter((x) => x.id === i.id || items.some((y) => y.id === x.id)))} />
          <button type="button" data-knop={`kies-${i.id}`} onClick={() => setGekozen(i.id)} />
        </span>
      ))}
    </div>
  );
}

describe('useStandaardKeuze', () => {
  it('desktop: eerste item staat standaard open; verdwijnt het, dan schuift de keuze naar de buur', async () => {
    await monteer(<Harnas />);
    expect(gekozenNu()).toBe('a');
    await klik('weg-a');
    expect(gekozenNu()).toBe('b');
  });

  it('komt het weggeschoven item kort daarna terug (409/404 na DELETE, of ongedaan maken), dan gaat de keuze weer naar dat item', async () => {
    await monteer(<Harnas />);
    await klik('kies-b');
    expect(gekozenNu()).toBe('b');
    await klik('weg-b');
    expect(gekozenNu()).toBe('c'); // buur op dezelfde plek
    await klik('terug-b');
    expect(gekozenNu()).toBe('b');
  });

  it('springt niet terug als de gebruiker intussen zelf iets anders koos', async () => {
    await monteer(<Harnas />);
    await klik('weg-a');
    expect(gekozenNu()).toBe('b');
    await klik('kies-c');
    await klik('terug-a');
    expect(gekozenNu()).toBe('c');
  });

  it('springt niet terug als het item pas na de terugkeertermijn weer opduikt', async () => {
    const nu = Date.now();
    const klok = vi.spyOn(Date, 'now').mockReturnValue(nu);
    await monteer(<Harnas />);
    await klik('weg-a');
    expect(gekozenNu()).toBe('b');
    klok.mockReturnValue(nu + 16_000);
    await klik('terug-a');
    expect(gekozenNu()).toBe('b');
  });

  it('mobiel: geen preselectie, en een verdwenen keuze wordt gewist i.p.v. doorgeschoven', async () => {
    desktop = false;
    await monteer(<Harnas />);
    expect(gekozenNu()).toBe('');
    await klik('kies-a');
    await klik('weg-a');
    expect(gekozenNu()).toBe('');
    await klik('terug-a');
    expect(gekozenNu()).toBe('');
  });
});

/** Master-detail met een bewerkformulier in het paneel, zoals Beheer
 *  updates en Beheer omleidingen: rijkeuze via de poort, voorselectie met
 *  `vuil`, Annuleren als SluitKnop in de footer. */
function Bewerkharnas({ startItems = ALLE }: { startItems?: Item[] }) {
  const [items, setItems] = useState<Item[]>(startItems);
  const [gekozen, setGekozen] = useState<string | null>(null);
  const [tekst, setTekst] = useState('');
  const [vulling, setVulling] = useState(0);
  const open = (i: Item) => { setGekozen(i.id); setTekst(`tekst ${i.id}`); setVulling((n) => n + 1); };
  const { vuil } = useVuil(tekst, gekozen !== null, vulling);
  const poort = useDetailPoort(vuil);
  useStandaardKeuze({ items, sleutelVan: (i) => i.id, gekozen, kies: open, wis: () => setGekozen(null), vuil });
  const huidig = items.find((i) => i.id === gekozen) ?? null;
  return (
    <div data-gekozen={gekozen ?? ''}>
      <MasterDetail
        lijst={(
          <div>
            {/* rauw: testattrap zonder design-primitieven */}
            {items.map((i) => <button key={i.id} type="button" data-knop={`rij-${i.id}`} onClick={() => poort.via(() => open(i))} />)}
            <button type="button" data-knop="ververs-zonder-a" onClick={() => setItems((p) => p.filter((x) => x.id !== 'a'))} />
          </div>
        )}
        paneel={(
          <DetailPaneel
            open={gekozen !== null}
            onClose={() => setGekozen(null)}
            title={`Item ${gekozen ?? ''}`}
            sleutel={gekozen ?? undefined}
            vuil={vuil}
            poort={poort}
            footer={<SluitKnop onClose={() => huidig && open(huidig)}>Annuleren</SluitKnop>}
          >
            <label>
              Tekst
              <input value={tekst} onChange={(e) => setTekst(e.target.value)} />
            </label>
          </DetailPaneel>
        )}
      />
    </div>
  );
}

const tekstveld = () => screen.getByLabelText('Tekst') as HTMLInputElement;
const typ = async (waarde: string) => { await act(async () => { fireEvent.change(tekstveld(), { target: { value: waarde } }); }); };
const knopMetTekst = async (naam: string) => {
  const knop = screen.getAllByRole('button').find((b) => b.textContent?.trim() === naam);
  if (!knop) throw new Error(`knop ${naam} ontbreekt`);
  await act(async () => { knop.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};
const vraagOpen = () => screen.queryByRole('dialog', { name: 'Wijzigingen niet bewaren?' }) !== null;

describe('DetailPaneel op desktop: onbewaarde invoer', () => {
  it('een andere rij kiezen vraagt eerst; Verder bewerken houdt record en invoer, Niet bewaren wisselt', async () => {
    await monteer(<Bewerkharnas />);
    expect(gekozenNu()).toBe('a');
    await typ('half getypt');
    await klik('rij-b');
    expect(vraagOpen()).toBe(true);
    expect(gekozenNu()).toBe('a');

    await knopMetTekst('Verder bewerken');
    expect(vraagOpen()).toBe(false);
    expect(gekozenNu()).toBe('a');
    expect(tekstveld().value).toBe('half getypt');

    await klik('rij-b');
    await knopMetTekst('Niet bewaren');
    expect(gekozenNu()).toBe('b');
    expect(tekstveld().value).toBe('tekst b');
  });

  it('een schoon formulier wisselt zonder vraag', async () => {
    await monteer(<Bewerkharnas />);
    await klik('rij-c');
    expect(vraagOpen()).toBe(false);
    expect(gekozenNu()).toBe('c');
  });

  it('Annuleren (SluitKnop in de footer) gaat door dezelfde vraag', async () => {
    await monteer(<Bewerkharnas />);
    await typ('iets nieuws');
    await knopMetTekst('Annuleren');
    expect(vraagOpen()).toBe(true);
    expect(tekstveld().value).toBe('iets nieuws');
    await knopMetTekst('Niet bewaren');
    expect(tekstveld().value).toBe('tekst a');
  });

  it('de voorselectie wisselt nooit weg van een vuil formulier, ook niet als het item uit de lijst valt', async () => {
    await monteer(<Bewerkharnas />);
    await typ('niet kwijtraken');
    await klik('ververs-zonder-a');
    expect(gekozenNu()).toBe('a');
    expect(tekstveld().value).toBe('niet kwijtraken');
    expect(vraagOpen()).toBe(false);
  });

  it('mobiel: de poort laat door (de SlideOver heeft zijn eigen sluitvraag)', async () => {
    desktop = false;
    await monteer(<Bewerkharnas />);
    await klik('rij-a');
    await typ('mobiel');
    await klik('rij-b');
    expect(gekozenNu()).toBe('b');
  });
});
