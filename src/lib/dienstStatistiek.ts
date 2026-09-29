import type { Service } from '../types';
import { deelMinuten, parseHHMMStrikt } from '../../shared/busvakTijd';

/**
 * Kerncijfers van het dienstoverzicht voor het zijvak (Dienstoverzicht en
 * Beheer dienstoverzicht): aantal diensten, aantal verschillende loops en
 * de langste/kortste dienst (som van de geldige delen, met dezelfde regel als
 * de rest van het portaal: `deelMinuten`, einde vóór de start = over
 * middernacht, busvak-uren zoals ze er staan).
 */
export type DienstStatistiek = {
  diensten: number;
  loops: number;
  langste: { serviceNumber: string; minuten: number } | null;
  kortste: { serviceNumber: string; minuten: number } | null;
};

/** Gewerkte minuten van één dienst: som van de geldige delen; null als geen
 *  enkel deel geldig is (dan telt de dienst niet mee).
 *
 *  De duur van een deel is de gedeelde `deelMinuten` (Jarno 29-09): 22:00 tot
 *  06:00 telt als 8 uur, een deel zonder venster (gelijke begin- en
 *  eindtijd, of een einde dat ook na +24 u niet na de start ligt) is
 *  ongeldig en telt niet mee. Keuren blijft strikt (`parseHHMMStrikt`, zoals de
 *  planningsopbouw): een tijd met seconden maakt geen geldig deel. */
export function dienstMinuten(s: Service): number | null {
  const delen: Array<[string | undefined, string | undefined]> = [
    [s.startTime, s.endTime],
    [s.startTime2, s.endTime2],
    [s.startTime3, s.endTime3],
  ];
  let totaal = 0;
  let geldig = false;
  for (const [van, tot] of delen) {
    if (parseHHMMStrikt(van) === null || parseHHMMStrikt(tot) === null) continue;
    const duur = deelMinuten(van, tot);
    if (duur === null) continue;
    totaal += duur;
    geldig = true;
  }
  return geldig ? totaal : null;
}

export function dienstStatistiek(services: Service[]): DienstStatistiek {
  const loops = new Set<string>();
  let langste: DienstStatistiek['langste'] = null;
  let kortste: DienstStatistiek['kortste'] = null;
  for (const s of services) {
    for (const l of [s.loopnr, s.loopnr2, s.loopnr3]) {
      const v = (l ?? '').trim();
      if (v) loops.add(v);
    }
    const minuten = dienstMinuten(s);
    if (minuten === null) continue;
    if (!langste || minuten > langste.minuten) langste = { serviceNumber: s.serviceNumber, minuten };
    if (!kortste || minuten < kortste.minuten) kortste = { serviceNumber: s.serviceNumber, minuten };
  }
  return { diensten: services.length, loops: loops.size, langste, kortste };
}

/** "9u 28min" — zelfde vorm als de resterende-tijd-teksten in Mijn dag. */
export function formatDienstDuur(minuten: number): string {
  const u = Math.floor(minuten / 60);
  const m = minuten % 60;
  if (u === 0) return `${m}min`;
  if (m === 0) return `${u}u`;
  return `${u}u ${String(m).padStart(2, '0')}min`;
}
