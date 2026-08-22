import type { CoverageOverride } from './coverage';

/**
 * Belgische feestdagen + Vlaamse schoolvakanties als kant-en-klare
 * dekking-uitzonderingen. Bron van de datums: officiële schoolkalender
 * Vlaanderen 2026-2027 en de wettelijke feestdagen (geverifieerd 21-08-2026).
 * Zonder deze voorzet moest de planner elke vakantie en feestdag handmatig
 * als uitzondering intikken — één vergeten krokusvakantie = wéér fantoomgaten.
 *
 * De zomervakantie zit hier bewust NIET in: die loopt via een weekdagperiode
 * (zoals het schooljaar-regime vanaf 01-09-2026), niet via uitzonderingen.
 */

export type KalenderFeestdag = { datum: string; naam: string };
export type KalenderVakantie = { naam: string; van: string; tot: string };

/** Wettelijke feestdagen nov 2026 t/m dec 2027. Op een feestdag rijdt De Lijn
 *  een zondagsdienst, óók als hij op zaterdag valt — alleen feestdagen die al
 *  op zondag vallen worden bij het voorzetten overgeslagen. */
export const FEESTDAGEN: KalenderFeestdag[] = [
  { datum: '2026-11-01', naam: 'Allerheiligen' },
  { datum: '2026-11-11', naam: 'Wapenstilstand' },
  { datum: '2026-12-25', naam: 'Kerstmis' },
  { datum: '2027-01-01', naam: 'Nieuwjaar' },
  { datum: '2027-03-29', naam: 'Paasmaandag' },
  { datum: '2027-05-01', naam: 'Dag van de Arbeid' },
  { datum: '2027-05-06', naam: 'O.L.H.-Hemelvaart' },
  { datum: '2027-05-17', naam: 'Pinkstermaandag' },
  { datum: '2027-07-21', naam: 'Nationale feestdag' },
  { datum: '2027-08-15', naam: 'O.L.V.-Hemelvaart' },
  { datum: '2027-11-01', naam: 'Allerheiligen' },
  { datum: '2027-11-11', naam: 'Wapenstilstand' },
  { datum: '2027-12-25', naam: 'Kerstmis' },
];

/** Vlaamse schoolvakanties 2026-2027 (elke reeks loopt maandag t/m zondag). */
export const SCHOOLVAKANTIES: KalenderVakantie[] = [
  { naam: 'Herfstvakantie', van: '2026-11-02', tot: '2026-11-08' },
  { naam: 'Kerstvakantie', van: '2026-12-21', tot: '2027-01-03' },
  { naam: 'Krokusvakantie', van: '2027-02-08', tot: '2027-02-14' },
  { naam: 'Paasvakantie', van: '2027-03-29', tot: '2027-04-11' },
];

const addDagen = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const isZondag = (iso: string): boolean => new Date(`${iso}T00:00:00Z`).getUTCDay() === 0;

/** Dekt een bestaande uitzondering dit hele bereik al (ongeacht dag-type)? */
const alGedekt = (bestaande: CoverageOverride[], from: string, to: string): boolean =>
  bestaande.some((o) => o.from && o.to && o.from <= from && to <= o.to);

/**
 * Zet de kalender om naar uitzonderingen, klaar om aan de editor-lijst toe te
 * voegen. Volgorde is betekenisvol: feestdagen éérst, want bij overlappende
 * uitzonderingen wint de eerste match (resolveDayType) — kerstdag middenin de
 * kerstvakantie moet het feestdag-type krijgen, niet het vakantie-type.
 * Vakantieweken worden gesplitst per weekdag-groep (ma-wo / do / vr) omdat
 * één uitzondering maar één dag-type kan dragen; za/zo volgen de basis.
 */
export function bouwKalenderUitzonderingen(opts: {
  /** Dag-type voor feestdagen (meestal "zondag"); leeg = feestdagen overslaan. */
  feestdagType?: string;
  /** Dag-types voor vakantieweken; ontbrekende groep = die dagen overslaan. */
  vakantieTypes?: { maDiWo?: string; donderdag?: string; vrijdag?: string };
  /** Al ingestelde uitzonderingen: wat daardoor gedekt is, wordt niet dubbel voorgezet. */
  bestaande: CoverageOverride[];
  /** Suggesties vóór deze datum weglaten (het verleden is geen actiepunt). */
  vanafDatum?: string;
}): { uitzonderingen: CoverageOverride[]; overgeslagen: number } {
  const { feestdagType, vakantieTypes, bestaande, vanafDatum } = opts;
  const uitzonderingen: CoverageOverride[] = [];
  let overgeslagen = 0;

  const voegToe = (from: string, to: string, dayType: string) => {
    const vanForm = vanafDatum && from < vanafDatum ? vanafDatum : from;
    if (to < vanForm) return; // volledig in het verleden
    if (alGedekt(bestaande, vanForm, to)) {
      overgeslagen += 1;
      return;
    }
    uitzonderingen.push({ from: vanForm, to, dayType });
  };

  if (feestdagType) {
    for (const f of FEESTDAGEN) {
      if (isZondag(f.datum)) continue; // is al een zondag
      voegToe(f.datum, f.datum, feestdagType);
    }
  }

  for (const vak of SCHOOLVAKANTIES) {
    // Elke vakantie start op maandag; per week drie segmenten.
    for (let maandag = vak.van; maandag <= vak.tot; maandag = addDagen(maandag, 7)) {
      if (vakantieTypes?.maDiWo) voegToe(maandag, addDagen(maandag, 2), vakantieTypes.maDiWo);
      if (vakantieTypes?.donderdag) voegToe(addDagen(maandag, 3), addDagen(maandag, 3), vakantieTypes.donderdag);
      if (vakantieTypes?.vrijdag) voegToe(addDagen(maandag, 4), addDagen(maandag, 4), vakantieTypes.vrijdag);
    }
  }

  return { uitzonderingen, overgeslagen };
}
