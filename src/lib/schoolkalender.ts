import type { CoverageOverride } from './coverage';
import { addDagen } from './datum';
import { feestdagenVanJaar, VLAAMSE_SCHOOLVAKANTIES } from './typedag';

/**
 * Belgische feestdagen + Vlaamse schoolvakanties als kant-en-klare
 * dekking-uitzonderingen. De data komt uit typedag.ts — feestdagen berekend
 * (vaste data + Gauss-computus), schoolvakanties uit dé dataset — zodat de
 * dekking en de typedag-markering in het rooster nooit meer uiteenlopen (hier
 * stond eerst een tweede, handmatige kopie; controle-ronde 27-08, bevinding
 * 20). Zonder deze voorzet moest de planner elke vakantie en feestdag
 * handmatig als uitzondering intikken — één vergeten krokusvakantie = wéér
 * fantoomgaten.
 *
 * De zomervakantie zit hier bewust NIET in: die loopt via een weekdagperiode
 * (zoals het schooljaar-regime vanaf 01-09-2026), niet via uitzonderingen.
 */

export type KalenderFeestdag = { datum: string; naam: string };
export type KalenderVakantie = { naam: string; van: string; tot: string };

/** De jaren waarin de vakantiedataset een schooljaar laat beginnen: zo ver
 *  lopen de feestdagen mee (2028 dus pas zodra de 2028-vakanties er staan). */
const JAREN = [...new Set(VLAAMSE_SCHOOLVAKANTIES.map((v) => Number(v.van.slice(0, 4))))];

/** Wettelijke feestdagen van die jaren, chronologisch. Op een feestdag rijdt
 *  De Lijn een zondagsdienst, óók als hij op zaterdag valt — alleen feestdagen
 *  die al op zondag vallen worden bij het voorzetten overgeslagen. */
export const FEESTDAGEN: KalenderFeestdag[] = JAREN
  .flatMap((jaar) => Object.entries(feestdagenVanJaar(jaar)).map(([datum, naam]) => ({ datum, naam })))
  .sort((a, b) => a.datum.localeCompare(b.datum));

/** Vlaamse schoolvakanties zonder de zomer (elke reeks loopt maandag t/m zondag). */
export const SCHOOLVAKANTIES: KalenderVakantie[] = VLAAMSE_SCHOOLVAKANTIES.filter((v) => v.naam !== 'Zomervakantie');

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
