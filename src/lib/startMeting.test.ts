import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Startmeting (ronde 6, punt 21a). De module houdt haar toestand op
 * moduleniveau (één meting per paginalading), dus elke test laadt haar vers
 * na `vi.resetModules()`. De klok van `performance.now()` en de animatieframe
 * staan in de hand van de test.
 */
type Module = typeof import('./startMeting');

const SLEUTEL = 'vhb-startmeting';
let klok = 0;
let frames: Array<() => void> = [];

const laad = async (release = 'lokaal-1.2.3'): Promise<Module> => {
  vi.resetModules();
  vi.doMock('./appVersion', () => ({ RELEASE: release }));
  return import('./startMeting');
};

const bewaard = () => {
  const ruw = window.localStorage.getItem(SLEUTEL);
  return ruw ? (JSON.parse(ruw) as { t: number; m: Record<string, unknown> }) : null;
};

const zetZichtbaarheid = (waarde: DocumentVisibilityState) => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => waarde });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => waarde === 'hidden' });
};

/** Een gewone start tot en met `gegevens`, met vaste tijden. */
const totGegevens = (m: Module, view = 'mijn-dag', uitCache: boolean | null = false) => {
  klok = 420.4; m.markeerSessie();
  klok = 780.6; m.markeerProfiel('chauffeur');
  klok = 1130; m.markeerGegevens(view, uitCache);
};

const draaiFrames = () => { const nu = frames; frames = []; nu.forEach((f) => f()); };

beforeEach(() => {
  window.localStorage.clear();
  zetZichtbaarheid('visible');
  window.history.replaceState(null, '', '/mijn-dag');
  klok = 380.2;
  frames = [];
  vi.spyOn(performance, 'now').mockImplementation(() => klok);
  vi.stubGlobal('requestAnimationFrame', (f: () => void) => { frames.push(f); return frames.length; });
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15');
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.doUnmock('./appVersion');
});

describe('een gewone warme start', () => {
  it('bewaart de fasen in volgorde bij het beeld, met de context en zonder persoonsgegevens', async () => {
    const m = await laad();
    totGegevens(m);
    expect(bewaard()).toBeNull();
    const h1 = document.createElement('h1');
    klok = 1300; m.markeerBeeld(h1);
    // Zolang de frame niet gelopen heeft, is er nog geen beeld.
    expect(bewaard()).toBeNull();
    klok = 1490.2; draaiFrames();
    const opgeslagen = bewaard()!;
    expect(opgeslagen.m).toEqual({
      js: 380, sessie: 420, profiel: 781, gegevens: 1130, beeld: 1490,
      rol: 'chauffeur', scherm: 'mijn-dag', bron: 'vers', toestel: 'ios', weergave: 'browser',
    });
    expect(Date.now() - opgeslagen.t).toBeLessThan(5000);
    // Geen URL, user agent, id of naam in de opgeslagen tekst.
    const tekst = window.localStorage.getItem(SLEUTEL)!;
    expect(tekst).not.toMatch(/mozilla|iphone os|localhost|http|mijn-dag\//i);
  });

  it('een antwoord uit de cache in de poort geeft bron cache', async () => {
    const m = await laad();
    totGegevens(m, 'dashboard', true);
    m.markeerBeeld(document.createElement('h1'));
    draaiFrames();
    expect(bewaard()?.m).toMatchObject({ scherm: 'dashboard', bron: 'cache' });
  });

  it('een ander startscherm bewaart bij gegevens, zonder beeld', async () => {
    const m = await laad();
    totGegevens(m, 'rooster');
    expect(bewaard()?.m).toMatchObject({ scherm: 'ander', gegevens: 1130 });
    expect(bewaard()?.m.beeld).toBeUndefined();
    // Een h1 later verandert niets meer.
    m.markeerBeeld(document.createElement('h1'));
    draaiFrames();
    expect(bewaard()?.m.beeld).toBeUndefined();
  });

  it('komt het beeld niet binnen 10 s na gegevens, dan bewaard zonder beeld', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const m = await laad();
    totGegevens(m);
    vi.advanceTimersByTime(9999);
    expect(bewaard()).toBeNull();
    vi.advanceTimersByTime(1);
    expect(bewaard()?.m).toMatchObject({ gegevens: 1130, scherm: 'mijn-dag' });
    expect(bewaard()?.m.beeld).toBeUndefined();
    // Het beeld dat daarna nog komt, telt niet meer.
    m.markeerBeeld(document.createElement('h1'));
    draaiFrames();
    expect(bewaard()?.m.beeld).toBeUndefined();
  });

  it('alleen de eerste h1 na gegevens telt; een ref met null of vóór gegevens niet', async () => {
    const m = await laad();
    klok = 400; m.markeerSessie();
    m.markeerBeeld(document.createElement('h1')); // vóór gegevens: telt niet
    expect(frames).toHaveLength(0);
    klok = 700; m.markeerProfiel('admin');
    klok = 900; m.markeerGegevens('dashboard', false);
    m.markeerBeeld(null);
    expect(frames).toHaveLength(0);
    m.markeerBeeld(document.createElement('h1'));
    // Een tweede kop (een andere frame) verandert niets meer: de eerste frame
    // zette het beeld en sloot de meting.
    klok = 950; draaiFrames();
    m.markeerBeeld(document.createElement('h1'));
    klok = 1200; draaiFrames();
    expect(frames).toHaveLength(0);
    expect(bewaard()?.m).toMatchObject({ rol: 'admin', gegevens: 900, beeld: 950 });
  });

  it('een release van een Vercel-build gaat mee, een lokale of te lange niet', async () => {
    for (const [release, verwacht] of [['1a2b3c4', '1a2b3c4'], ['1a2b3c4d5e6f7', undefined], ['lokaal-1.2.3', undefined]] as const) {
      window.localStorage.clear();
      const m = await laad(release);
      totGegevens(m, 'rooster');
      expect(bewaard()?.m.release).toBe(verwacht);
    }
  });

  it('toestel en weergave komen grof uit de user agent en de weergavemodus', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Linux; Android 14) Chrome/150');
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(display-mode: standalone)' }));
    let m = await laad();
    totGegevens(m, 'rooster');
    expect(bewaard()?.m).toMatchObject({ toestel: 'android', weergave: 'app' });

    window.localStorage.clear();
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/150');
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    m = await laad();
    totGegevens(m, 'rooster');
    expect(bewaard()?.m).toMatchObject({ toestel: 'desktop', weergave: 'browser' });
  });
});

describe('onderbroken starts bewaren niets', () => {
  it('startOnderbroken (inlogformulier, codescherm, wachtscherm, mislukt profiel) sluit de meting voorgoed', async () => {
    const m = await laad();
    klok = 400; m.markeerSessie();
    klok = 700; m.markeerProfiel('planner');
    m.startOnderbroken();
    // De herkansing na de code of na "Opnieuw controleren" zet niets meer.
    m.markeerProfiel('planner');
    m.markeerGegevens('dashboard', false);
    m.markeerBeeld(document.createElement('h1'));
    draaiFrames();
    expect(bewaard()).toBeNull();
  });

  it('een mislukte poort (null) sluit de meting; een latere laadbeurt telt niet', async () => {
    const m = await laad();
    totGegevens(m, 'mijn-dag', null);
    m.markeerGegevens('mijn-dag', false);
    m.markeerBeeld(document.createElement('h1'));
    draaiFrames();
    expect(bewaard()).toBeNull();
  });

  it('een geslaagde latere laadbeurt verandert een lopende meting niet', async () => {
    const m = await laad();
    totGegevens(m);
    klok = 5000; m.markeerGegevens('mijn-dag', true);
    m.markeerGegevens('mijn-dag', null);
    m.markeerBeeld(document.createElement('h1'));
    klok = 1400; draaiFrames();
    expect(bewaard()?.m).toMatchObject({ gegevens: 1130, bron: 'vers', beeld: 1400 });
  });

  it('een tabblad dat even verborgen was vóór het einde', async () => {
    const m = await laad();
    totGegevens(m);
    m.markeerBeeld(document.createElement('h1'));
    zetZichtbaarheid('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    zetZichtbaarheid('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    draaiFrames();
    expect(bewaard()).toBeNull();
  });

  it('verborgen na het bewaren laat de meting staan', async () => {
    const m = await laad();
    totGegevens(m);
    m.markeerBeeld(document.createElement('h1'));
    draaiFrames();
    zetZichtbaarheid('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(bewaard()?.m.beeld).toBeDefined();
  });

  it('een tabblad dat verborgen opent, het printblad en een uitnodiging meten niet', async () => {
    zetZichtbaarheid('hidden');
    let m = await laad();
    totGegevens(m, 'rooster');
    expect(bewaard()).toBeNull();

    zetZichtbaarheid('visible');
    window.history.replaceState(null, '', '/?print-driver=42&print-month=2026-11');
    m = await laad();
    totGegevens(m, 'rooster');
    expect(bewaard()).toBeNull();

    window.history.replaceState(null, '', '/#uitnodiging=abc.def');
    m = await laad();
    totGegevens(m, 'rooster');
    expect(bewaard()).toBeNull();
  });

  it('het printblad Ruiloverzicht (periode en oude week) meet ook niet', async () => {
    for (const pad of ['/?ruiloverzicht-van=2026-11-01&ruiloverzicht-tot=2026-11-07', '/?ruiloverzicht-week=2026-11-04']) {
      window.history.replaceState(null, '', pad);
      const m = await laad();
      totGegevens(m, 'dashboard');
      m.markeerBeeld(document.createElement('h1'));
      draaiFrames();
      expect(bewaard(), pad).toBeNull();
    }
  });

  it('fasen buiten volgorde zetten niets (geen geraden waarde)', async () => {
    const m = await laad();
    m.markeerProfiel('chauffeur'); // zonder sessie
    m.markeerSessie();
    m.markeerGegevens('rooster', false); // profiel ontbreekt
    expect(bewaard()).toBeNull();
  });
});

describe('de meting breekt nooit een start', () => {
  it('localStorage die gooit: geen meting, geen fout', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('QuotaExceededError'); });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('SecurityError'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('SecurityError'); });
    const m = await laad();
    expect(() => {
      totGegevens(m);
      m.markeerBeeld(document.createElement('h1'));
      draaiFrames();
    }).not.toThrow();
    expect(m.vorigeStart()).toBeUndefined();
  });

  it('geen performance: geen meting, geen fout', async () => {
    vi.restoreAllMocks();
    vi.stubGlobal('performance', undefined);
    const m = await laad();
    expect(() => {
      totGegevens(m, 'rooster');
      m.markeerBeeld(document.createElement('h1'));
    }).not.toThrow();
    vi.unstubAllGlobals();
    expect(bewaard()).toBeNull();
  });

  it('een klok die na het laden gooit: geen fout in de start, niets bewaard', async () => {
    const m = await laad();
    vi.spyOn(performance, 'now').mockImplementation(() => { throw new Error('kapot'); });
    expect(() => {
      totGegevens(m);
      m.markeerBeeld(document.createElement('h1'));
      draaiFrames();
    }).not.toThrow();
    expect(bewaard()).toBeNull();
  });

  it('geen requestAnimationFrame: de meting sluit, de start loopt door', async () => {
    vi.stubGlobal('requestAnimationFrame', undefined);
    const m = await laad();
    totGegevens(m);
    expect(() => m.markeerBeeld(document.createElement('h1'))).not.toThrow();
    expect(bewaard()).toBeNull();
  });
});

describe('meesturen met de aanwezigheidsping', () => {
  const zet = (waarde: unknown) => window.localStorage.setItem(SLEUTEL, typeof waarde === 'string' ? waarde : JSON.stringify(waarde));

  it('geeft de bewaarde meting; wissen alleen als er nog exact dezelfde tekst staat', async () => {
    const m = await laad();
    const meting = { js: 1, sessie: 2, profiel: 3, gegevens: 4, rol: 'chauffeur', scherm: 'ander' };
    zet({ t: Date.now(), m: meting });
    const vorige = m.vorigeStart()!;
    expect(vorige.start).toEqual(meting);
    vorige.wis();
    expect(window.localStorage.getItem(SLEUTEL)).toBeNull();
  });

  it('een nieuwere meting (van deze start) blijft staan na het antwoord op de ping', async () => {
    const m = await laad();
    zet({ t: Date.now() - 1000, m: { js: 1, gegevens: 4 } });
    const vorige = m.vorigeStart()!;
    // Intussen bewaarde deze start zijn eigen meting.
    totGegevens(m, 'rooster');
    const nieuw = window.localStorage.getItem(SLEUTEL);
    vorige.wis();
    expect(window.localStorage.getItem(SLEUTEL)).toBe(nieuw);
  });

  it('ouder dan 7 dagen: weg zonder meesturen', async () => {
    const m = await laad();
    zet({ t: Date.now() - 7 * 864e5 - 1, m: { gegevens: 4 } });
    expect(m.vorigeStart()).toBeUndefined();
    expect(window.localStorage.getItem(SLEUTEL)).toBeNull();
    zet({ t: 'gisteren', m: { gegevens: 4 } });
    expect(m.vorigeStart()).toBeUndefined();
    expect(window.localStorage.getItem(SLEUTEL)).toBeNull();
  });

  it('onleesbaar: niets mee, en de volgende meting overschrijft het', async () => {
    const m = await laad();
    for (const onzin of ['{kapot', 'null', JSON.stringify({ t: Date.now() })]) {
      zet(onzin);
      expect(m.vorigeStart()).toBeUndefined();
    }
    totGegevens(m, 'rooster');
    expect(bewaard()?.m).toMatchObject({ gegevens: 1130 });
  });

  it('een te diepe of te lange waarde (vreemde code, met de hand gezet) reist niet mee', async () => {
    const m = await laad();
    // Diep genest en met een tijd in de toekomst: zou de 7 dagen ontlopen en
    // JSON.stringify van de ping laten gooien.
    const diep = `{"t":${Date.now() + 365 * 864e5},"m":${'['.repeat(200_000)}${']'.repeat(200_000)}}`;
    // Plat maar groot: zou de ping een 413 geven en dus nooit gewist worden.
    const lang = JSON.stringify({ t: Date.now(), m: { gegevens: 4, rol: 'x'.repeat(5000) } });
    for (const waarde of [diep, lang]) {
      zet(waarde);
      expect(m.vorigeStart()).toBeUndefined();
    }
    // De eigen meting van deze start overschrijft de sleutel.
    totGegevens(m, 'rooster');
    expect(bewaard()?.m).toMatchObject({ gegevens: 1130 });
    expect(window.localStorage.getItem(SLEUTEL)!.length).toBeLessThan(2000);
  });

  it('niets bewaard: niets mee', async () => {
    const m = await laad();
    expect(m.vorigeStart()).toBeUndefined();
  });
});
