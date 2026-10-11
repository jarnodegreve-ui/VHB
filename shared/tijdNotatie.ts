/**
 * Eén tijdnotatie voor alles wat een mens intypt (controle-ronde 10-10, punt
 * 1): "6:30", "06:30", "630", "0630", "6.30" en "6u30" worden "06:30"; busvak
 * tot 47:59 ("26:16" = 02:16 de dag erna). Het cijferklavier van een iPhone
 * heeft geen dubbelpunt, dus vier cijfers moeten volstaan. null = geen tijd.
 *
 * Eigen bestand zonder imports: src/lib/shiftTime.ts (in de warmup van elk
 * startscherm) leent deze regel, en mag daarmee niet de hele dagtype-module
 * (lijst, afleiding, varianten) in de warmup-sets trekken.
 */
export function normaliseerTijd(raw: unknown): string | null {
  const t = String(raw ?? '').trim();
  const m = /^(\d{1,2})(?:[:.hHuU]|(?=\d{2}$))(\d{2})$/.exec(t);
  if (!m) return null;
  const uur = Number(m[1]);
  const minuten = Number(m[2]);
  if (uur > 47 || minuten > 59) return null;
  return `${String(uur).padStart(2, '0')}:${m[2]}`;
}
