import { CircleAlert, ClipboardCheck, FileWarning, Inbox, Search, WifiOff } from 'lucide-react';
import { cn } from '../../lib/ui';

/** Eén herkenbaar symbool per toestand, met dezelfde lijn en maat.
 * De Lucide-contouren blijven scherp in beide thema's. Alleen de betekenis
 * krijgt een accent: goud voor leeg/zoeken, groen voor klaar, rood bij fouten.
 *
 * Lijn 1,5 en slate-600 (punt 11, 16-09): op 0,75 in slate-400 was de
 * tekening in het donkere thema nauwelijks te zien, want slate-400 spiegelt
 * niet mee en blijft daar donkergrijs op een donkere canvas.
 */
export type IllustratieProps = { className?: string; compact?: boolean };
const LIJN = 'h-16 w-16 shrink-0 stroke-[1.5] text-slate-600';
const SVG_PROPS = { strokeWidth: 1, 'aria-hidden': true, focusable: false } as const;

export function LegeLijst({ className }: IllustratieProps) {
  return <Inbox {...SVG_PROPS} className={cn(LIJN, '[&_polyline]:stroke-oker-500', className)} />;
}

export function AllesGedaan({ className }: IllustratieProps) {
  return <ClipboardCheck {...SVG_PROPS} className={cn(LIJN, '[&_path:last-child]:stroke-emerald-700', className)} />;
}

export function GeenBereik({ className }: IllustratieProps) {
  return <WifiOff {...SVG_PROPS} className={cn(LIJN, '[&_path:last-child]:stroke-oker-500', className)} />;
}

export function Fout({ className, compact = false }: IllustratieProps) {
  const Icoon = compact ? CircleAlert : FileWarning;
  return <Icoon {...SVG_PROPS} className={cn(LIJN, compact ? 'text-red-700' : '[&_path:not(:first-child)]:stroke-red-700', className)} />;
}

export function NietGevonden({ className }: IllustratieProps) {
  return <Search {...SVG_PROPS} className={cn(LIJN, '[&_path]:stroke-oker-500', className)} />;
}

export const ILLUSTRATIES = { LegeLijst, AllesGedaan, GeenBereik, Fout, NietGevonden } as const;
