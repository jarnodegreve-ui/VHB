import { TYPPRE_PER_TYPE, TYPPRE_STAT_100_NAT, TYPPRE_STAT_50_NAT, type Segment } from '../dienst.js';
import { formatEasypayTijd, formatHHMM, naMiddernacht } from './tijd.js';

/**
 * Van ritdelen naar de looncomponenten per dienst voor Easypay, letterlijk
 * naar de Access-keten qry-LoonDienstFormEasypayDeel1..3 + Union + Xport
 * (tblLoondienstCSVeasypay):
 *
 * - elk ritdeel geeft één rij met zijn typeprestatie (RIT 20101, LED 20201,
 *   AVO 20301, ANA 20401, ATU/AFL/ANW 20112, ONE 30201, ONV 30202);
 * - stationnement (STA/ONS) wordt gesplitst: de eerste 15 minuten als 30300
 *   (100 % arbeidstijd), minuten 16 tot 45 als 30301 (100 % niet-arbeidstijd,
 *   hooguit 30), de rest als 30302 (50 %);
 * - Decimal1 = 1 bij een onderbreking (ONE), JD/JA = 1 als start/einde na
 *   23:59 valt, Service = laatste 5 tekens van het dienstnummer.
 */
export type LoonComponent = {
  activiteit: 'LIJN';
  hd: string;
  ha: string;
  duree: string;
  typprest: number;
  nbplace: 0;
  alpha1: 0;
  decimal1: 0 | 1;
  alpha2: ' ';
  decimal2: 0;
  typeinfo: 'PRT';
  service: string;
  jd: 0 | 1;
  ja: 0 | 1;
};

/** Stationnement-splitsing in minuten: (≤15 → 100 % AT), (16-45 → 100 % NAT, max 30), (>45 → 50 % NAT). */
export const splitsStationnement = (duur: number): { at: number; nat100: number; nat50: number } => ({
  at: duur > 15 ? 15 : duur,
  nat100: duur >= 45 ? 30 : duur > 15 ? duur - 15 : 0,
  nat50: duur > 45 ? duur - 45 : 0,
});

export function looncomponentenVanSegmenten(segments: Segment[]): LoonComponent[] {
  const uit: LoonComponent[] = [];
  for (const s of segments) {
    const stat = s.type === 'STA' || s.type === 'ONS';
    const { nat100, nat50 } = stat ? splitsStationnement(s.duurMin) : { nat100: 0, nat50: 0 };
    const einde1 = nat100 > 0 ? s.startMin + 15 : s.eindeMin;
    const einde2 = nat100 > 0 ? einde1 + nat100 : s.eindeMin;
    const basis = {
      activiteit: 'LIJN' as const, nbplace: 0 as const, alpha1: 0 as const, decimal1: (s.type === 'ONE' ? 1 : 0) as 0 | 1, alpha2: ' ' as const, decimal2: 0 as const,
      typeinfo: 'PRT' as const, service: s.serviceNumber.slice(-5), jd: naMiddernacht(s.startMin), ja: naMiddernacht(einde1),
    };
    uit.push({ ...basis, hd: formatEasypayTijd(s.startMin), ha: formatEasypayTijd(einde1), duree: stat && s.duurMin > 15 ? '00:15' : formatHHMM(s.duurMin), typprest: TYPPRE_PER_TYPE[s.type] });
    if (nat100 > 0) uit.push({ ...basis, hd: formatEasypayTijd(einde1), ha: formatEasypayTijd(einde2), duree: `00:${String(nat100).padStart(2, '0')}`, typprest: TYPPRE_STAT_100_NAT });
    if (nat50 > 0) uit.push({ ...basis, hd: formatEasypayTijd(einde2), ha: formatEasypayTijd(s.eindeMin), duree: formatHHMM(nat50), typprest: TYPPRE_STAT_50_NAT });
  }
  return uit.sort((a, b) => a.service.localeCompare(b.service, 'nl', { numeric: true }) || a.hd.localeCompare(b.hd));
}

/** CSV zoals Access hem exporteert (qry-LoonDienstFormEasypayXport). */
export const looncomponentenCsv = (rijen: LoonComponent[], sep = ';'): string => {
  const kop = ['Activiteit', 'HD', 'HA', 'Duree', 'TYPPREST', 'NBPlace', 'Alpha1', 'Decimal1', 'Alpha2', 'Decimal2', 'TYPEinfo', 'Service', 'JD', 'JA'];
  const regels = [kop.join(sep)];
  for (const r of rijen) regels.push([r.activiteit, r.hd, r.ha, r.duree, r.typprest, r.nbplace, r.alpha1, r.decimal1, r.alpha2, r.decimal2, r.typeinfo, r.service, r.jd, r.ja].join(sep));
  return regels.join('\r\n') + '\r\n';
};
