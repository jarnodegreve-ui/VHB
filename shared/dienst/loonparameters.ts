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

/** Nachtminuten van één ritdeel (Access-formule: ≤ 06:00 en ≥ 20:00, klok loopt door na middernacht). */
export const nachtMinuten = (start: number, einde: number): number => {
  let n = 0;
  if (einde <= NACHT_EINDE && start <= NACHT_EINDE) n += einde - start;
  else if (start <= NACHT_EINDE && einde > NACHT_EINDE) n += NACHT_EINDE - start;
  if (start >= NACHT_BEGIN && einde >= NACHT_BEGIN) n += einde - start;
  else if (start < NACHT_BEGIN && einde >= NACHT_BEGIN) n += einde - NACHT_BEGIN;
  return n;
};

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
