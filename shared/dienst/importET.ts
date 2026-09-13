import { SEGMENT_TYPES, type Segment, type SegmentType } from '../dienst.js';
import { parseUurNotatie } from './tijd.js';

/**
 * Van de ET-export (kolomkoppen exact als tbl-importDienstenET) naar
 * segmenten. Kolommen: typedag, dienstnummer et, type, duur, start, einde,
 * loop, intern loopnummer, lijn, var, rit, voertuig, vertrek, vertrek
 * plaatscode, aankomst, aankomst plaatscode, afstand, AT, VT, dienstnummer.
 * Volgorde binnen een dienst = op starttijd (de export is niet gesorteerd).
 */
export type ImportETWaarschuwing = { rij: number; tekst: string };

const kop = (k: string) => k.trim().toLowerCase().replace(/\s+/g, ' ');
const tekst = (v: unknown): string | null => {
  const s = String(v ?? '').trim();
  return s ? s : null;
};

export function parseImportET(rows: Array<Record<string, unknown>>): { segments: Segment[]; waarschuwingen: ImportETWaarschuwing[]; dagtypes: string[] } {
  const waarschuwingen: ImportETWaarschuwing[] = [];
  const ruw: Array<Omit<Segment, 'volgorde'> & { rij: number }> = [];
  rows.forEach((r, i) => {
    const rij = i + 2; // Excel-rijnummer (kop = 1)
    const g = new Map(Object.entries(r).map(([k, v]) => [kop(k), v]));
    const veld = (k: string) => tekst(g.get(k));
    const dienst = veld('dienstnummer');
    const type = (veld('type') ?? '').toUpperCase();
    const duur = parseUurNotatie(veld('duur'));
    const start = parseUurNotatie(veld('start'));
    const einde = parseUurNotatie(veld('einde'));
    if (!dienst && !type && start === null) return; // lege rij
    if (!dienst) { waarschuwingen.push({ rij, tekst: 'Ritdeel zonder dienstnummer, overgeslagen.' }); return; }
    if (!SEGMENT_TYPES.includes(type as SegmentType)) { waarschuwingen.push({ rij, tekst: `Onbekend soort ritdeel “${type || 'leeg'}”, overgeslagen.` }); return; }
    if (start === null || einde === null) { waarschuwingen.push({ rij, tekst: `Dienst ${dienst}: start of einde ontbreekt, overgeslagen.` }); return; }
    const afstand = veld('afstand');
    const afstandKm = afstand === null ? null : Number(String(afstand).replace(',', '.'));
    ruw.push({
      rij,
      serviceNumber: dienst,
      dagtypeCode: veld('typedag') ?? '0',
      type: type as SegmentType,
      startMin: start,
      eindeMin: einde,
      duurMin: duur ?? Math.max(0, einde - start),
      loop: veld('loop'),
      internLoop: veld('intern loopnummer'),
      lijn: veld('lijn'),
      variant: veld('var'),
      rit: veld('rit'),
      voertuig: veld('voertuig'),
      vertrek: veld('vertrek'),
      vertrekCode: veld('vertrek plaatscode'),
      aankomst: veld('aankomst'),
      aankomstCode: veld('aankomst plaatscode'),
      afstandKm: afstandKm !== null && Number.isFinite(afstandKm) ? afstandKm : null,
      atTijd: veld('at'),
      vtTijd: veld('vt'),
    });
  });
  // Volgorde per (dienst, dagtype) op starttijd; gelijke start: kortste eerst (AVO vóór LED).
  const groepen = new Map<string, typeof ruw>();
  for (const s of ruw) {
    const k = `${s.serviceNumber}|${s.dagtypeCode}`;
    const l = groepen.get(k) ?? [];
    l.push(s);
    groepen.set(k, l);
  }
  const segments: Segment[] = [];
  for (const lijst of groepen.values()) {
    lijst.sort((a, b) => a.startMin - b.startMin || a.eindeMin - b.eindeMin || a.rij - b.rij);
    lijst.forEach((s, i) => {
      const { rij: _r, ...rest } = s;
      segments.push({ ...rest, volgorde: i + 1 });
    });
  }
  segments.sort((a, b) => a.dagtypeCode.localeCompare(b.dagtypeCode) || a.serviceNumber.localeCompare(b.serviceNumber, 'nl', { numeric: true }) || a.volgorde - b.volgorde);
  return { segments, waarschuwingen, dagtypes: [...new Set(segments.map((s) => s.dagtypeCode))].sort() };
}
