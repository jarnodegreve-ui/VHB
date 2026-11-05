import type { Segment } from '../dienst.js';
import { formatHHMM } from './tijd.js';
import { splitsStationnement } from './looncomponenten.js';

/**
 * Van ritdelen naar de loonparameters van een loondienstcode
 * (tblDienstNummerGegevens): rijtijd, stationnement in drie categorieën,
 * onderbrekingen, ander werk, administratietijd, nacht en de tiktijden per
 * dienstdeel. Regels uit qry-rap LoonDiensten (Access):
 * - rijtijd = RIT + LED + AFL; stationnement gesplitst zoals de looncomponenten;
 * - onderbrekingen = aantal ONE/ONV; ander werk = ANW; administratietijd = AVO + ANA + ATU;
 * - nacht = minuten vóór 06:00 en vanaf 20:00;
 * - dienstdelen = aaneengesloten stukken tussen onderbrekingen (ONE/ONV),
 *   tiktijd 1/2 = begin/einde deel 1, 3/4 = deel 2, 5/6 = deel 3.
 */
export type LoonParameters = {
  lbRijtijd: number;
  lbStat100At: number;
  lbStat100Nat: number;
  lbStat50Nat: number;
  lbOnd: number;
  lbAndWrk: number;
  lbAdmT: number;
  lbNacht: number;
  lbArbTijd: number;
  tiktijden: Array<{ begin: string; einde: string }>;
  teVeelDelen: boolean;
};

const NACHT_EINDE = 6 * 60;
const NACHT_BEGIN = 20 * 60;
const ETMAAL = 24 * 60;

/** De nachtvensters in minuten van de dienstdag: 00:00-06:00, 20:00-06:00 de
 *  nacht erna en nog eens voor de tweede nacht (ritdelen lopen tot 47:59). */
const NACHT_VENSTERS: ReadonlyArray<readonly [number, number]> = [
  [0, NACHT_EINDE],
  [NACHT_BEGIN, NACHT_EINDE + ETMAAL],
  [NACHT_BEGIN + ETMAAL, NACHT_EINDE + 2 * ETMAAL],
];

/** Nachtminuten van één ritdeel: de doorsnede van [start, einde) met de
 *  nachtvensters (Access-formule qry-rap LoonDiensten: ≤ 06:00 en ≥ 20:00, de
 *  klok loopt door na middernacht). De letterlijke vertaling van die formule
 *  telde een ritdeel ná 06:00 de volgende dag (29:30-30:30) volledig als
 *  nacht, want start en einde lagen allebei ≥ 20:00 (controle-ronde 04-11,
 *  punt 38). */
export const nachtMinuten = (start: number, einde: number): number =>
  NACHT_VENSTERS.reduce((n, [van, tot]) => n + Math.max(0, Math.min(einde, tot) - Math.max(start, van)), 0);

export function loonParametersVanSegmenten(segments: Segment[]): LoonParameters {
  const gesorteerd = [...segments].sort((a, b) => a.volgorde - b.volgorde);
  const p: LoonParameters = { lbRijtijd: 0, lbStat100At: 0, lbStat100Nat: 0, lbStat50Nat: 0, lbOnd: 0, lbAndWrk: 0, lbAdmT: 0, lbNacht: 0, lbArbTijd: 0, tiktijden: [], teVeelDelen: false };
  let deel: { begin: number; einde: number } | null = null;
  const delen: Array<{ begin: number; einde: number }> = [];
  for (const s of gesorteerd) {
    if (s.type === 'RIT' || s.type === 'LED' || s.type === 'AFL') p.lbRijtijd += s.duurMin;
    if (s.type === 'STA' || s.type === 'ONS') {
      const { at, nat100, nat50 } = splitsStationnement(s.duurMin);
      p.lbStat100At += at; p.lbStat100Nat += nat100; p.lbStat50Nat += nat50;
    }
    if (s.type === 'ONE' || s.type === 'ONV') {
      p.lbOnd += 1;
      if (deel) { delen.push(deel); deel = null; }
      continue;
    }
    if (s.type === 'ANW') p.lbAndWrk += s.duurMin;
    if (s.type === 'AVO' || s.type === 'ANA' || s.type === 'ATU') p.lbAdmT += s.duurMin;
    p.lbNacht += nachtMinuten(s.startMin, s.eindeMin);
    if (!deel) deel = { begin: s.startMin, einde: s.eindeMin };
    else { deel.begin = Math.min(deel.begin, s.startMin); deel.einde = Math.max(deel.einde, s.eindeMin); }
  }
  if (deel) delen.push(deel);
  p.lbArbTijd = p.lbRijtijd + p.lbStat100At + p.lbAdmT + p.lbAndWrk;
  p.teVeelDelen = delen.length > 3;
  p.tiktijden = delen.slice(0, 3).map((d) => ({ begin: formatHHMM(d.begin), einde: formatHHMM(d.einde) }));
  return p;
}
