// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  RUIL_EINDSTATUSSEN, RUIL_OVERGANGEN, RUIL_STATUSSEN, RUIL_WEIGERING, STAF_BESLIS_STATUSSEN,
  beoordeelStafOvergang, isRuilDoorgevoerd, magRuilOvergang, ruilLogStappen, ruilVoertDoor,
  type RuilPartij, type RuilStatus,
} from './ruilOvergangen';

const PARTIJEN: RuilPartij[] = ['aanvrager', 'collega', 'planner', 'admin'];
/** Alle overgangen die de tabel voor een partij toelaat, als "van>naar". */
const toegelaten = (partij: RuilPartij) => RUIL_STATUSSEN.flatMap((van) =>
  RUIL_STATUSSEN.filter((naar) => magRuilOvergang(partij, van, naar)).map((naar) => `${van}>${naar}`));

describe('de overgangstabel van een dienstruil', () => {
  it('de hele tabel, per partij (wijzigt hier iets, dan wijzigt wie wat mag)', () => {
    expect(toegelaten('aanvrager')).toEqual(['pending>cancelled', 'accepted>cancelled']);
    expect(toegelaten('collega')).toEqual(['pending>accepted', 'pending>rejected']);
    expect(toegelaten('planner')).toEqual([
      'pending>rejected', 'pending>cancelled',
      'accepted>approved', 'accepted>rejected', 'accepted>cancelled',
      'approved>rejected', 'approved>cancelled', 'approved>completed',
    ]);
    expect(toegelaten('admin')).toEqual([
      'pending>approved', 'pending>rejected', 'pending>cancelled', 'pending>completed',
      'accepted>approved', 'accepted>rejected', 'accepted>cancelled', 'accepted>completed',
      'approved>rejected', 'approved>cancelled', 'approved>completed',
    ]);
  });

  it('uit een eindstatus gaat niemand nog ergens heen', () => {
    for (const partij of PARTIJEN) {
      for (const van of RUIL_EINDSTATUSSEN) expect(RUIL_OVERGANGEN[partij][van as RuilStatus]).toBeUndefined();
    }
  });

  it("niemand zet een ruil terug op 'pending', en alleen de collega schrijft 'accepted'", () => {
    for (const partij of PARTIJEN) {
      for (const van of RUIL_STATUSSEN) {
        expect(magRuilOvergang(partij, van, 'pending')).toBe(false);
        if (partij !== 'collega') expect(magRuilOvergang(partij, van, 'accepted')).toBe(false);
      }
    }
  });

  it('geen overgang naar dezelfde status, en onbekende waarden zijn nooit toegelaten', () => {
    for (const partij of PARTIJEN) {
      for (const status of RUIL_STATUSSEN) expect(magRuilOvergang(partij, status, status)).toBe(false);
      expect(magRuilOvergang(partij, undefined, 'approved')).toBe(false);
      expect(magRuilOvergang(partij, 'pending', undefined)).toBe(false);
      expect(magRuilOvergang(partij, 'pending', 'toString')).toBe(false);
      expect(magRuilOvergang(partij, 'constructor', 'approved')).toBe(false);
    }
  });

  it('een chauffeur keurt nooit goed en handelt nooit af', () => {
    for (const partij of ['aanvrager', 'collega'] as const) {
      for (const van of RUIL_STATUSSEN) {
        expect(magRuilOvergang(partij, van, 'approved')).toBe(false);
        expect(magRuilOvergang(partij, van, 'completed')).toBe(false);
      }
    }
  });

  it("afhandelen: de planner alleen vanuit 'approved', een admin ook vanuit 'pending' en 'accepted'", () => {
    expect(RUIL_STATUSSEN.filter((van) => magRuilOvergang('planner', van, 'completed'))).toEqual(['approved']);
    expect(RUIL_STATUSSEN.filter((van) => magRuilOvergang('admin', van, 'completed'))).toEqual(['pending', 'accepted', 'approved']);
  });

  it('goedkeuren zonder de instemming van de collega: alleen een admin', () => {
    expect(magRuilOvergang('planner', 'pending', 'approved')).toBe(false);
    expect(magRuilOvergang('admin', 'pending', 'approved')).toBe(true);
    expect(magRuilOvergang('planner', 'accepted', 'approved')).toBe(true);
  });
});

describe('wat een overgang in de planning doet', () => {
  it("doorgevoerd zijn 'approved' en 'completed', niets anders", () => {
    expect(RUIL_STATUSSEN.filter(isRuilDoorgevoerd)).toEqual(['approved', 'completed']);
    expect(isRuilDoorgevoerd(null)).toBe(false);
  });

  it('een overgang voert door als ze van niet-doorgevoerd naar doorgevoerd gaat', () => {
    expect(ruilVoertDoor('pending', 'approved')).toBe(true);
    expect(ruilVoertDoor('accepted', 'approved')).toBe(true);
    expect(ruilVoertDoor('pending', 'completed')).toBe(true);
    expect(ruilVoertDoor('accepted', 'completed')).toBe(true);
    // Afhandelen van wat al goedgekeurd is verplaatst niets meer.
    expect(ruilVoertDoor('approved', 'completed')).toBe(false);
    expect(ruilVoertDoor('approved', 'approved')).toBe(false);
    expect(ruilVoertDoor('completed', 'completed')).toBe(false);
    expect(ruilVoertDoor('accepted', 'rejected')).toBe(false);
    expect(ruilVoertDoor('approved', 'cancelled')).toBe(false);
    // Een nieuw record (geen vorige status) dat goedgekeurd binnenkomt.
    expect(ruilVoertDoor(undefined, 'approved')).toBe(true);
  });

  it('elke toegelaten overgang naar completed is een afhandeling van iets goedgekeurds, of voert zelf door', () => {
    // De invariant achter punt 4: geen weg naar 'completed' zonder doorvoer.
    for (const partij of PARTIJEN) {
      for (const van of RUIL_STATUSSEN) {
        if (!magRuilOvergang(partij, van, 'completed')) continue;
        expect(van === 'approved' || ruilVoertDoor(van, 'completed')).toBe(true);
      }
    }
  });

  it('de logstappen: rechtstreeks afhandelen is goedkeuren en dan afhandelen', () => {
    expect(ruilLogStappen('pending', 'completed')).toEqual([{ van: 'pending', naar: 'approved' }, { van: 'approved', naar: 'completed' }]);
    expect(ruilLogStappen('accepted', 'completed')).toEqual([{ van: 'accepted', naar: 'approved' }, { van: 'approved', naar: 'completed' }]);
    expect(ruilLogStappen('approved', 'completed')).toEqual([{ van: 'approved', naar: 'completed' }]);
    expect(ruilLogStappen('accepted', 'approved')).toEqual([{ van: 'accepted', naar: 'approved' }]);
    expect(ruilLogStappen('pending', 'rejected')).toEqual([{ van: 'pending', naar: 'rejected' }]);
  });
});

describe('het oordeel over een statuswissel door planner of admin', () => {
  it('wat in de tabel staat is goed, voor elke combinatie', () => {
    for (const rol of ['planner', 'admin'] as const) {
      for (const van of RUIL_STATUSSEN) {
        for (const naar of RUIL_STATUSSEN) {
          if (van === naar) continue;
          expect(beoordeelStafOvergang(rol, van, naar).ok, `${rol} ${van}>${naar}`).toBe(magRuilOvergang(rol, van, naar));
        }
      }
    }
  });

  it('de redenen, met de code en de zin van vóór de tabel', () => {
    // 'accepted' gaat voor alles, ook vanuit een eindstatus.
    expect(beoordeelStafOvergang('admin', 'pending', 'accepted')).toEqual({ ok: false, status: 403, error: RUIL_WEIGERING.accepteren });
    expect(beoordeelStafOvergang('planner', 'rejected', 'accepted')).toEqual({ ok: false, status: 403, error: RUIL_WEIGERING.accepteren });
    // Geen beslissing: 400.
    expect(beoordeelStafOvergang('admin', 'accepted', 'pending')).toEqual({ ok: false, status: 400, error: RUIL_WEIGERING.ongeldig });
    expect(beoordeelStafOvergang('admin', 'completed', 'pending')).toEqual({ ok: false, status: 400, error: RUIL_WEIGERING.ongeldig });
    expect(beoordeelStafOvergang('planner', 'pending', 'iets')).toEqual({ ok: false, status: 400, error: RUIL_WEIGERING.ongeldig });
    // Zonder de collega: alleen een admin.
    expect(beoordeelStafOvergang('planner', 'pending', 'approved')).toEqual({ ok: false, status: 403, error: RUIL_WEIGERING.zonderCollega });
    // Eindstatus: 409.
    for (const van of ['rejected', 'cancelled', 'completed']) {
      for (const naar of ['approved', 'rejected', 'cancelled', 'completed'].filter((n) => n !== van)) {
        expect(beoordeelStafOvergang('admin', van, naar)).toEqual({ ok: false, status: 409, error: RUIL_WEIGERING.afgehandeld });
      }
    }
    // Nieuw (01-10): een planner handelt alleen af wat goedgekeurd is.
    expect(beoordeelStafOvergang('planner', 'pending', 'completed')).toEqual({ ok: false, status: 403, error: RUIL_WEIGERING.afhandelen });
    expect(beoordeelStafOvergang('planner', 'accepted', 'completed')).toEqual({ ok: false, status: 403, error: RUIL_WEIGERING.afhandelen });
    // Een status die het portaal niet kent als vertrekpunt.
    expect(beoordeelStafOvergang('admin', 'vreemd', 'approved')).toEqual({ ok: false, status: 409, error: RUIL_WEIGERING.overig });
  });

  it('elke weigering is een zin die de app toont: kort, zonder em dash, en met een vervolgstap waar de app er geen bijzet', () => {
    for (const tekst of Object.values(RUIL_WEIGERING)) {
      expect(tekst.length).toBeLessThan(240);
      expect(tekst).not.toMatch(/ — /);
    }
    expect(RUIL_WEIGERING.afhandelen).toMatch(/Keur de ruil eerst goed\.$/);
    expect(RUIL_WEIGERING.overig).toMatch(/Vernieuw de lijst en beoordeel opnieuw\.$/);
  });

  it('de beslis-statussen van staf zijn alle statussen behalve pending', () => {
    expect([...STAF_BESLIS_STATUSSEN].sort()).toEqual(RUIL_STATUSSEN.filter((s) => s !== 'pending').sort());
  });
});
