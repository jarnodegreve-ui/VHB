import type { Service } from '../types';

/**
 * Kerncijfers van het dienstoverzicht voor het zijvak (Dienstoverzicht en
 * Beheer dienstoverzicht): aantal diensten, aantal verschillende loops en
 * de langste/kortste dienst (som van de geldige delen, busvak-notatie —
 * "26:16" = 02:16 de volgende nacht, dus geen middernacht-omslag nodig).
 */
export type DienstStatistiek = {
  diensten: number;
  loops: number;
  langste: { serviceNumber: string; minuten: number } | null;
  kortste: { serviceNumber: string; minuten: number } | null;
};

const parseMinuten = (t?: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? '').trim());
  if (!m) return null;
  const u = Number(m[1]);
  const min = Number(m[2]);
  if (u > 47 || min > 59) return null;
  return u * 60 + min;
};

/** Gewerkte minuten van één dienst: som van de delen met geldige tijden;
 *  null als geen enkel deel te lezen is (dan telt de dienst niet mee). */
export function dienstMinuten(s: Service): number | null {
  const delen: Array<[string | undefined, string | undefined]> = [
    [s.startTime, s.endTime],
    [s.startTime2, s.endTime2],
    [s.startTime3, s.endTime3],
  ];
  let totaal = 0;
  let geldig = false;
  for (const [van, tot] of delen) {
    const a = parseMinuten(van);
    const b = parseMinuten(tot);
    if (a === null || b === null || b < a) continue;
    totaal += b - a;
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
