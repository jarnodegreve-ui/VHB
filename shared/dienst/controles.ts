import type { Bevinding, Segment } from '../dienst.js';
import { formatHHMM, metNachtwrap } from './tijd.js';

/**
 * De Access-controlequeries als bevindingen: gaten en overlap tussen
 * opeenvolgende ritdelen (qry-controle 05), einde vóór start (11), rit
 * zonder loopnummer, onwaarschijnlijke snelheid (09: km/h boven de drempel),
 * duur die niet klopt met einde min start. Fouten blokkeren het activeren
 * van een import, waarschuwingen niet.
 */
export const SNELHEID_DREMPEL_KMH = 90;

export function controleerSegmenten(segments: Segment[]): Bevinding[] {
  const uit: Bevinding[] = [];
  const groepen = new Map<string, Segment[]>();
  for (const s of segments) {
    const k = `${s.serviceNumber}|${s.dagtypeCode}`;
    const l = groepen.get(k) ?? [];
    l.push(s);
    groepen.set(k, l);
  }
  for (const lijst of groepen.values()) {
    const g = [...lijst].sort((a, b) => a.volgorde - b.volgorde);
    let vorige: Segment | null = null;
    for (const s of g) {
      const basis = { serviceNumber: s.serviceNumber, dagtypeCode: s.dagtypeCode, volgorde: s.volgorde };
      const start = metNachtwrap(s.startMin);
      const einde = metNachtwrap(s.eindeMin);
      if (einde < start) uit.push({ ...basis, soort: 'einde_voor_start', ernst: 'fout', tekst: `${s.type} ${formatHHMM(s.startMin)} tot ${formatHHMM(s.eindeMin)}: einde ligt vóór de start.` });
      else if (einde - start !== s.duurMin) uit.push({ ...basis, soort: 'duur_klopt_niet', ernst: 'waarschuwing', tekst: `${s.type} ${formatHHMM(s.startMin)} tot ${formatHHMM(s.eindeMin)} is ${einde - start} min, de duur zegt ${s.duurMin} min.` });
      if ((s.type === 'RIT' || s.type === 'LED') && !s.loop && !s.internLoop) uit.push({ ...basis, soort: 'zonder_loop', ernst: 'waarschuwing', tekst: `${s.type} ${formatHHMM(s.startMin)}: geen loopnummer.` });
      if (s.type === 'RIT' && s.afstandKm && s.duurMin > 0) {
        const kmh = (s.afstandKm / s.duurMin) * 60;
        if (kmh > SNELHEID_DREMPEL_KMH) uit.push({ ...basis, soort: 'snelheid', ernst: 'waarschuwing', tekst: `Rit ${s.rit ?? ''} ${formatHHMM(s.startMin)}: ${s.afstandKm} km in ${s.duurMin} min is ${Math.round(kmh)} km/u.` });
      }
      if (vorige) {
        const vorigEinde = metNachtwrap(vorige.eindeMin);
        if (start > vorigEinde) uit.push({ ...basis, soort: 'gat', ernst: 'fout', tekst: `Gat van ${start - vorigEinde} min tussen ${vorige.type} (tot ${formatHHMM(vorige.eindeMin)}) en ${s.type} (vanaf ${formatHHMM(s.startMin)}).` });
        else if (start < vorigEinde) uit.push({ ...basis, soort: 'overlap', ernst: 'fout', tekst: `${s.type} start ${formatHHMM(s.startMin)} vóór het einde van ${vorige.type} (${formatHHMM(vorige.eindeMin)}).` });
      }
      vorige = s;
    }
  }
  return uit.sort((a, b) => a.serviceNumber.localeCompare(b.serviceNumber, 'nl', { numeric: true }) || a.dagtypeCode.localeCompare(b.dagtypeCode) || (a.volgorde ?? 0) - (b.volgorde ?? 0));
}
