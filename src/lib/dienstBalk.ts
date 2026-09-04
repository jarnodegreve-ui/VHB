/**
 * Geometrie van de dienstbalk (Mijn dag + dashboard-tegel): één horizontale
 * "wijzerplaat" van de eerste start tot het laatste einde van de dag. Alle
 * posities in procenten van die span; tijden in minuten t.o.v. middernacht
 * (busvak-notatie: 25:20 = 1520). Pauzes zijn de gaten tussen de delen.
 */
export type BalkDeel = { start: number; end: number; loopnr?: string };

export type BalkSegment = {
  links: number;
  breedte: number;
  /** 0–100: hoeveel van dit deel al gereden is (op basis van `nuMin`). */
  gevuld: number;
  bezig: boolean;
  gereden: boolean;
};

export type BalkGeometrie = {
  start: number;
  end: number;
  segmenten: BalkSegment[];
  /** Pauzes als [links, breedte] in %. */
  gaten: Array<[number, number]>;
  /** Uurstreepjes: positie in % + of het een "groot" streepje is (elke 3 u). */
  streepjes: Array<{ pct: number; groot: boolean }>;
  /** Positie van "nu" in %, of null als nu buiten de dag valt. */
  nuPct: number | null;
  /** Gereden deel van de hele dag in %. */
  voortgang: number;
};

export const minNaarTijd = (m: number): string => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;

export function balkGeometrie(delen: BalkDeel[], nuMin: number | null): BalkGeometrie | null {
  const gesorteerd = [...delen].filter((d) => d.end > d.start).sort((a, b) => a.start - b.start);
  if (gesorteerd.length === 0) return null;
  const start = gesorteerd[0].start;
  const end = Math.max(...gesorteerd.map((d) => d.end));
  const span = Math.max(1, end - start);
  const pct = (m: number) => ((m - start) / span) * 100;

  const segmenten: BalkSegment[] = gesorteerd.map((d) => {
    const gevuld = nuMin === null ? 0 : Math.max(0, Math.min(100, ((nuMin - d.start) / Math.max(1, d.end - d.start)) * 100));
    return {
      links: pct(d.start),
      breedte: pct(d.end) - pct(d.start),
      gevuld,
      bezig: nuMin !== null && nuMin >= d.start && nuMin < d.end,
      gereden: nuMin !== null && nuMin >= d.end,
    };
  });

  const gaten: Array<[number, number]> = [];
  for (let i = 1; i < gesorteerd.length; i += 1) {
    const vorige = gesorteerd[i - 1];
    const dit = gesorteerd[i];
    if (dit.start > vorige.end) gaten.push([pct(vorige.end), pct(dit.start) - pct(vorige.end)]);
  }

  const streepjes: Array<{ pct: number; groot: boolean }> = [];
  for (let uur = Math.ceil(start / 60) * 60; uur <= end; uur += 60) {
    // Streepjes op de uiterste randen vallen samen met de eindlabels — overslaan.
    if (uur - start < 15 || end - uur < 15) continue;
    streepjes.push({ pct: pct(uur), groot: (uur / 60) % 3 === 0 });
  }

  const nuPct = nuMin === null || nuMin < start || nuMin > end ? null : pct(nuMin);
  const geredenMin = nuMin === null ? 0 : gesorteerd.reduce((som, d) => som + Math.max(0, Math.min(d.end, nuMin) - d.start), 0);
  const totaalMin = gesorteerd.reduce((som, d) => som + (d.end - d.start), 0);
  return { start, end, segmenten, gaten, streepjes, nuPct, voortgang: Math.round((geredenMin / Math.max(1, totaalMin)) * 100) };
}
