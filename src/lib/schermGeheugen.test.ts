import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AFGEMELD, LAATSTE_AUTH_KEY, WIS_PRIVE_GEBEURTENIS, wisPriveCaches } from './afmelden';
import { markeerEigenSchrijfactie, resetLiveSignaal } from './liveSignaal';
import { MAX_LEEFTIJD_MS, MAX_SLEUTELS, begin, bewaar, lees } from './schermGeheugen';

/** In-memory localStorage (zoals afmelden.test.ts): Node >= 22 zet zelf een
 *  functieloze `localStorage`-global die die van jsdom verdringt. */
const maakOpslag = () => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: vi.fn((k: string) => data.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => { data.set(k, String(v)); }),
    removeItem: vi.fn((k: string) => { data.delete(k); }),
    clear: vi.fn(() => data.clear()),
  };
};
let opslag = maakOpslag();
const zetOpslag = (waarde: unknown) => {
  vi.stubGlobal('localStorage', waarde);
  if (window !== (globalThis as unknown as Window)) Object.defineProperty(window, 'localStorage', { value: waarde, configurable: true });
};
const wieIsHet = (id: string | null) => {
  if (id === null) opslag.data.delete(LAATSTE_AUTH_KEY);
  else opslag.data.set(LAATSTE_AUTH_KEY, id);
};
const wis = () => window.dispatchEvent(new Event(WIS_PRIVE_GEBEURTENIS));
/** Eén volledige lezing: vertrek, (iets), antwoord. */
const lezing = (sleutel: string, antwoord: unknown) => bewaar(begin(sleutel), antwoord);

const T0 = new Date('2026-11-14T10:00:00').getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  opslag = maakOpslag();
  zetOpslag(opslag);
  wieIsHet('auth-a');
  resetLiveSignaal();
  wis();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('schermGeheugen', () => {
  it('geeft het bewaarde antwoord met het vertrektijdstip terug', () => {
    const l = begin('vervaldata');
    vi.advanceTimersByTime(300);
    bewaar(l, [{ id: 1 }]);
    expect(lees('vervaldata')).toEqual({ antwoord: [{ id: 1 }], om: T0 });
    expect(lees('iets-anders')).toBeNull();
  });

  it('een laat antwoord, na een nieuwere begin voor dezelfde sleutel, schrijft niets', () => {
    const oud = begin('vervaldata');
    const nieuw = begin('vervaldata');
    bewaar(oud, 'oud');
    expect(lees('vervaldata')).toBeNull();
    bewaar(nieuw, 'nieuw');
    // Komt het oude antwoord pas ná het nieuwe binnen: nog altijd het nieuwe.
    bewaar(oud, 'oud');
    expect(lees('vervaldata')?.antwoord).toBe('nieuw');
  });

  it('een nieuwere begin voor een andere sleutel stoort niet', () => {
    const a = begin('a');
    begin('b');
    bewaar(a, 'A');
    expect(lees('a')?.antwoord).toBe('A');
  });

  it('een eigen schrijfactie tussen begin en bewaar maakt de lezing ongeldig, ook op dezelfde milliseconde als begin', () => {
    const l = begin('vervaldata');
    markeerEigenSchrijfactie(); // zelfde Date.now() als het vertrek
    bewaar(l, 'x');
    expect(lees('vervaldata')).toBeNull();

    const l2 = begin('later');
    vi.advanceTimersByTime(40);
    markeerEigenSchrijfactie();
    bewaar(l2, 'y');
    expect(lees('later')).toBeNull();
  });

  it('een eigen schrijfactie na het bewaren maakt de lezing ook ongeldig', () => {
    lezing('vervaldata', 'x');
    expect(lees('vervaldata')).not.toBeNull();
    vi.advanceTimersByTime(1000);
    markeerEigenSchrijfactie();
    expect(lees('vervaldata')).toBeNull();
  });

  it('een begin ná de schrijfactie is geldig, ook op dezelfde milliseconde (de verversing na een eigen opslag)', () => {
    markeerEigenSchrijfactie();
    lezing('zelfde-ms', 'na opslag');
    expect(lees('zelfde-ms')?.antwoord).toBe('na opslag');

    vi.advanceTimersByTime(5);
    markeerEigenSchrijfactie();
    vi.advanceTimersByTime(1);
    lezing('later', 'ook');
    expect(lees('later')?.antwoord).toBe('ook');
  });

  it('ouder dan vijf minuten is ongeldig, gerekend vanaf het vertrek', () => {
    const l = begin('vervaldata');
    vi.advanceTimersByTime(2000);
    bewaar(l, 'x');
    vi.setSystemTime(T0 + MAX_LEEFTIJD_MS - 1);
    expect(lees('vervaldata')?.antwoord).toBe('x');
    vi.setSystemTime(T0 + MAX_LEEFTIJD_MS);
    expect(lees('vervaldata')).toBeNull();
  });

  it('een andere eigenaar bij het lezen krijgt niets', () => {
    lezing('vervaldata', 'van a');
    wieIsHet('auth-b');
    expect(lees('vervaldata')).toBeNull();
    wieIsHet(AFGEMELD);
    expect(lees('vervaldata')).toBeNull();
    wieIsHet(null);
    expect(lees('vervaldata')).toBeNull();
  });

  it('een eigenaar die wisselt tussen begin en bewaar: niets bewaard', () => {
    const l = begin('vervaldata');
    wieIsHet('auth-b');
    bewaar(l, 'van a');
    expect(lees('vervaldata')).toBeNull();
    wieIsHet('auth-a');
    expect(lees('vervaldata')).toBeNull();
  });

  it('AFGEMELD of geen bewaard id: niets bewaard', () => {
    wieIsHet(AFGEMELD);
    lezing('vervaldata', 'x');
    wieIsHet('auth-a');
    expect(lees('vervaldata')).toBeNull();

    wieIsHet(null);
    lezing('vervaldata', 'y');
    wieIsHet('auth-a');
    expect(lees('vervaldata')).toBeNull();
  });

  it('geblokkeerde opslag: niets bewaard en niets gelezen', () => {
    lezing('al-bewaard', 'x');
    zetOpslag({ getItem: () => { throw new Error('geblokkeerd'); }, setItem: () => { throw new Error('geblokkeerd'); } });
    expect(lees('al-bewaard')).toBeNull();
    lezing('vervaldata', 'y');
    zetOpslag(opslag);
    expect(lees('vervaldata')).toBeNull();
  });

  it('de wisgebeurtenis wist alles, ook voor dezelfde persoon die daarna opnieuw aanmeldt', () => {
    lezing('a', 'A');
    lezing('b', 'B');
    const onderweg = begin('c');
    wis();
    expect(lees('a')).toBeNull();
    expect(lees('b')).toBeNull();
    // Een antwoord dat vóór de wis vertrok, landt er niet meer in.
    bewaar(onderweg, 'C');
    expect(lees('c')).toBeNull();
  });

  it('wisPriveCaches (afmelden, andere gebruiker, geblokkeerd toestel) wist het geheugen', async () => {
    lezing('vervaldata', 'x');
    await wisPriveCaches();
    expect(lees('vervaldata')).toBeNull();
  });

  it('zet niets in localStorage of Cache Storage', () => {
    const caches = { open: vi.fn(), keys: vi.fn(), match: vi.fn(), delete: vi.fn(), has: vi.fn() };
    vi.stubGlobal('caches', caches);
    const voor = [...opslag.data.entries()];
    lezing('vervaldata', [{ id: 1 }]);
    lees('vervaldata');
    expect(opslag.setItem).not.toHaveBeenCalled();
    expect(opslag.removeItem).not.toHaveBeenCalled();
    expect([...opslag.data.entries()]).toEqual(voor);
    for (const f of Object.values(caches)) expect(f).not.toHaveBeenCalled();
  });

  it('hoogstens tien sleutels: de oudste gaat eerst weg', () => {
    const sleutels = Array.from({ length: MAX_SLEUTELS }, (_, i) => `s${i}`);
    for (const s of sleutels) lezing(s, s);
    expect(sleutels.every((s) => lees(s)?.antwoord === s)).toBe(true);
    lezing('elfde', 'elfde');
    expect(lees('s0')).toBeNull();
    expect(sleutels.slice(1).every((s) => lees(s)?.antwoord === s)).toBe(true);
    expect(lees('elfde')?.antwoord).toBe('elfde');

    // Opnieuw bewaren telt als jongste: dan gaat de volgende oudste weg.
    lezing('s1', 's1 opnieuw');
    lezing('twaalfde', 'twaalfde');
    expect(lees('s2')).toBeNull();
    expect(lees('s1')?.antwoord).toBe('s1 opnieuw');
  });
});

describe('schermGeheugen: lezingen die aan de planning hangen (Maandplanning)', () => {
  const planningGewijzigd = () => window.dispatchEvent(new Event('vhb-planning-changed'));
  const metPlanning = (sleutel: string, antwoord: unknown) => bewaar(begin(sleutel, { planning: true }), antwoord);

  it('een planningswijziging tussen vertrek en aankomst: niet geldig, ook op dezelfde milliseconde als het vertrek', () => {
    const l = begin('maandplanning:2026-11', { planning: true });
    planningGewijzigd(); // zelfde Date.now() als het vertrek
    bewaar(l, 'bord');
    expect(lees('maandplanning:2026-11')).toBeNull();

    const l2 = begin('maandplanning:2026-12', { planning: true });
    vi.advanceTimersByTime(800);
    planningGewijzigd();
    vi.advanceTimersByTime(400);
    bewaar(l2, 'bord');
    expect(lees('maandplanning:2026-12')).toBeNull();
  });

  it('een planningswijziging vóór het vertrek: geldig, ook op dezelfde milliseconde (de stille verversing na een salvo)', () => {
    planningGewijzigd();
    metPlanning('maandplanning:2026-11', 'na de wijziging');
    expect(lees('maandplanning:2026-11')).toEqual({ antwoord: 'na de wijziging', om: T0 });

    vi.advanceTimersByTime(1200);
    planningGewijzigd();
    planningGewijzigd();
    vi.advanceTimersByTime(1);
    metPlanning('maandplanning:2026-12', 'ook');
    expect(lees('maandplanning:2026-12')?.antwoord).toBe('ook');
  });

  it('een planningswijziging na het bewaren maakt de lezing ongeldig, ook terwijl geen scherm open staat', () => {
    metPlanning('maandplanning:2026-11', 'bord');
    expect(lees('maandplanning:2026-11')).not.toBeNull();
    vi.advanceTimersByTime(60_000);
    planningGewijzigd();
    expect(lees('maandplanning:2026-11')).toBeNull();
    // Een nieuwe lezing na de wijziging is weer geldig.
    metPlanning('maandplanning:2026-11', 'vers');
    expect(lees('maandplanning:2026-11')?.antwoord).toBe('vers');
  });

  it('een lezing zonder de planning-optie (Vervaldata) merkt niets van een planningswijziging', () => {
    const onderweg = begin('vervaldata');
    planningGewijzigd();
    bewaar(onderweg, 'x');
    expect(lees('vervaldata')?.antwoord).toBe('x');
    planningGewijzigd();
    expect(lees('vervaldata')?.antwoord).toBe('x');
  });

  it('de andere regels gelden ook: een eigen schrijfactie, vijf minuten, een andere eigenaar en de wisgebeurtenis', () => {
    metPlanning('a', 'A');
    markeerEigenSchrijfactie();
    expect(lees('a')).toBeNull();

    vi.advanceTimersByTime(1);
    metPlanning('b', 'B');
    vi.setSystemTime(T0 + 1 + MAX_LEEFTIJD_MS);
    expect(lees('b')).toBeNull();

    metPlanning('c', 'C');
    wieIsHet('auth-b');
    expect(lees('c')).toBeNull();
    wieIsHet('auth-a');
    expect(lees('c')?.antwoord).toBe('C');
    wis();
    expect(lees('c')).toBeNull();
  });
});
