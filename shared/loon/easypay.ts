import { EASYPAY_KOLOMMEN, TYPPRE_OVERMIN_NEGATIEF, TYPPRE_OVERMIN_POSITIEF, loonCodeSleutel } from '../loon.js';

/**
 * Easypay-export (fase B Access-migratie): de vertaling van de bevestigde
 * dagprestaties naar de rijen van het maandbestand voor het sociaal
 * secretariaat. Letterlijk naar de Access-query
 * `-frmloonadmEasyPayExportVorigeMaand-union LB+Overmin`:
 *
 * - per persoon per dag één rij: matricule, datum, activiteit en typeprestatie
 *   van de loondienstcode, HD = eerste gevulde tiktijd (1, 3 of 5), HA = laatste
 *   gevulde (6, 4 of 2), duree 0 (de dagduur-velden zijn sinds 2024 leeg) dus
 *   Type Info 'TH', Prime 12 bij de onvoorziene-dienst-premie, Service = de code;
 * - per dag met overminuten (som van gewoon + nacht + extra ≠ 0) een tweede rij
 *   met typeprestatie 40945 (positief) of 40946 (negatief), duree = minuten als
 *   dagfractie (min / 1440) en Type Info 'PRT'.
 *
 * Pure functie, zod-vrij; golden test in easypay.test.ts tegen augustus 2026
 * uit Access.
 */

export type EasypayCode = {
  code: string;
  inExport: boolean;
  easypayActiviteit: string;
  easypayTypePrest: number;
  tik1?: string | null; tik2?: string | null; tik3?: string | null;
  tik4?: string | null; tik5?: string | null; tik6?: string | null;
};

export type EasypayMedewerker = { userId: string; easypayNr: number | null | undefined; inExport: boolean };

export type EasypayPrestatie = {
  userId: string;
  datum: string;
  geredenCode: string | null | undefined;
  overmin: number;
  overminNacht: number;
  overminExtra: number;
  onvPremie: boolean;
};

export type EasypayRij = {
  soc: 1;
  matric: number;
  date: string;
  composant: 1;
  activit: string;
  hd: string | null;
  ha: string | null;
  duree: number;
  typpre: number;
  nbpl: 0;
  alpha1: 0;
  dec1: 0;
  alphal2: number;
  deci2: 0;
  typeInfo: 'PRT' | 'TH';
  prime: '' | '12';
  vrijveld: '';
  service: string;
  version: '';
  periode: string;
  jd: 0;
  ja: 0;
};

export type EasypayIssue =
  | { soort: 'geen_matricule'; userId: string }
  | { soort: 'onbekende_code'; userId: string; datum: string; code: string }
  | { soort: 'geen_code'; userId: string; datum: string };

export const tiktijdenVan = (c: Pick<EasypayCode, 'tik1' | 'tik2' | 'tik3' | 'tik4' | 'tik5' | 'tik6'>): { hd: string | null; ha: string | null } => ({
  hd: c.tik1 || c.tik3 || c.tik5 || null,
  ha: c.tik6 || c.tik4 || c.tik2 || null,
});

export function bouwEasypayRijen(input: {
  maand: string;
  prestaties: EasypayPrestatie[];
  codes: EasypayCode[];
  medewerkers: EasypayMedewerker[];
  lidnr: number;
}): { rijen: EasypayRij[]; issues: EasypayIssue[] } {
  const codeMap = new Map(input.codes.map((c) => [loonCodeSleutel(c.code), c]));
  const medewerkerMap = new Map(input.medewerkers.map((m) => [String(m.userId), m]));
  const periode = input.maand.replace('-', '');
  const rijen: EasypayRij[] = [];
  const issues: EasypayIssue[] = [];
  const gemeld = new Set<string>();

  const gesorteerd = [...input.prestaties].sort((a, b) => a.userId.localeCompare(b.userId) || a.datum.localeCompare(b.datum));
  for (const p of gesorteerd) {
    if (!p.datum.startsWith(`${input.maand}-`)) continue;
    const m = medewerkerMap.get(String(p.userId));
    // Access: alleen personeel met functie like '*lijn*'; hier de vlag in_export.
    if (!m || !m.inExport) continue;
    if (!m.easypayNr) {
      if (!gemeld.has(`m:${p.userId}`)) { gemeld.add(`m:${p.userId}`); issues.push({ soort: 'geen_matricule', userId: p.userId }); }
      continue;
    }
    const sleutel = loonCodeSleutel(p.geredenCode);
    if (!sleutel) { issues.push({ soort: 'geen_code', userId: p.userId, datum: p.datum }); continue; }
    const c = codeMap.get(sleutel);
    // Access: inner join op tblDienstNummerGegevens, een onbekende code valt stil weg. Hier melden we hem.
    if (!c) { issues.push({ soort: 'onbekende_code', userId: p.userId, datum: p.datum, code: String(p.geredenCode) }); continue; }
    if (!c.inExport) continue;
    const { hd, ha } = tiktijdenVan(c);
    const basis: EasypayRij = {
      soc: 1, matric: m.easypayNr, date: p.datum, composant: 1, activit: c.easypayActiviteit,
      hd, ha, duree: 0, typpre: c.easypayTypePrest, nbpl: 0, alpha1: 0, dec1: 0, alphal2: input.lidnr, deci2: 0,
      typeInfo: 'TH', prime: p.onvPremie ? '12' : '', vrijveld: '', service: String(p.geredenCode ?? '').trim(), version: '', periode, jd: 0, ja: 0,
    };
    rijen.push(basis);
    const som = (p.overmin || 0) + (p.overminNacht || 0) + (p.overminExtra || 0);
    if (som !== 0) {
      rijen.push({ ...basis, duree: som / (24 * 60), typpre: som > 0 ? TYPPRE_OVERMIN_POSITIEF : TYPPRE_OVERMIN_NEGATIEF, typeInfo: 'PRT' });
    }
  }
  return { rijen, issues };
}

/** Instelbaar CSV-formaat; de standaard volgt de Access-export (puntkomma, dd/mm/jjjj, tijd uu:mm, komma als decimaal). */
export type EasypayCsvFormaat = {
  scheidingsteken: string;
  /** 'dd/mm/jjjj' | 'jjjj-mm-dd' | 'dd-mm-jjjj' */
  datum: 'dd/mm/jjjj' | 'jjjj-mm-dd' | 'dd-mm-jjjj';
  decimaal: ',' | '.';
  /** Aantal decimalen van duree (dagfractie). */
  dureeDecimalen: number;
  kop: boolean;
};

export const EASYPAY_CSV_STANDAARD: EasypayCsvFormaat = { scheidingsteken: ';', datum: 'dd/mm/jjjj', decimaal: ',', dureeDecimalen: 6, kop: true };

const formatDatum = (iso: string, vorm: EasypayCsvFormaat['datum']): string => {
  const [j, m, d] = iso.split('-');
  if (vorm === 'jjjj-mm-dd') return iso;
  if (vorm === 'dd-mm-jjjj') return `${d}-${m}-${j}`;
  return `${d}/${m}/${j}`;
};

export function easypayCsv(rijen: EasypayRij[], formaat: EasypayCsvFormaat = EASYPAY_CSV_STANDAARD): string {
  const sep = formaat.scheidingsteken;
  const cel = (v: string | number | null): string => {
    const s = v === null ? '' : String(v);
    return /["\n\r]/.test(s) || s.includes(sep) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const duree = (n: number) => n.toFixed(formaat.dureeDecimalen).replace('.', formaat.decimaal);
  const regels: string[] = [];
  if (formaat.kop) regels.push(EASYPAY_KOLOMMEN.join(sep));
  for (const r of rijen) {
    regels.push([
      r.soc, r.matric, formatDatum(r.date, formaat.datum), r.composant, r.activit, r.hd ?? '', r.ha ?? '', duree(r.duree), r.typpre, r.nbpl,
      r.alpha1, r.dec1, r.alphal2, r.deci2, r.typeInfo, r.prime, r.vrijveld, r.service, r.version, r.periode, r.jd, r.ja,
    ].map(cel).join(sep));
  }
  return regels.join('\r\n') + '\r\n';
}

/** Samenvatting voor het controlescherm: rijen, personen, overminuten-rijen, premies. */
export const easypaySamenvatting = (rijen: EasypayRij[]) => ({
  rijen: rijen.length,
  personen: new Set(rijen.map((r) => r.matric)).size,
  overminRijen: rijen.filter((r) => r.typpre === TYPPRE_OVERMIN_POSITIEF || r.typpre === TYPPRE_OVERMIN_NEGATIEF).length,
  premies: rijen.filter((r) => r.prime === '12' && r.typeInfo === 'TH').length,
});
