import { AlertTriangle, Moon } from 'lucide-react';
import { MIN_RUST_UREN, formatRust, type RuilRustRegel } from '../../shared/ruilRust';
import { formatShortDay } from '../lib/format';
import { cn } from '../lib/ui';
import { MicroLabel } from './primitives';

/** Twee tonen die elkaar uitsluiten: de waarschuwing draagt een amber vlak met
 *  amber tekst, de gewone regel heeft geen vlak en gedempte tekst. */
const TOON_WAARSCHUWING = 'bg-amber-500/10 text-amber-800 ring-1 ring-amber-500/25';
const TOON_IN_ORDE = 'text-slate-600';

/**
 * Rusttijd bij een dienstruil (wens Jarno 20-09): voor wie door de ruil een
 * dienst krijgt, hoeveel rust er overblijft t.o.v. de dienst van de dag ervoor
 * en de dag erna. De server rekent het na (shared/ruilRust.ts) zolang de ruil
 * nog beslist moet worden; dit bestand tekent alleen.
 *
 * Te weinig rust is een waarschuwing (amber, met icoon en tekst: nooit kleur
 * alleen), geen blokkade: de planner beslist. Genoeg rust is een stille regel,
 * zodat de planner ziet dát het nagekeken is. Staat er geen dienst de dag
 * ervoor of erna, dan legt de regel niets op en staat er ook niets.
 */
export function RuilRust({ regels, naamVan, kijkerId, requesterId, targetDriverId, className }: {
  regels: RuilRustRegel[] | undefined;
  naamVan: (userId: string) => string | undefined;
  kijkerId?: string;
  requesterId: string;
  targetDriverId?: string;
  className?: string;
}) {
  if (!regels || regels.length === 0) return null;
  const grens = MIN_RUST_UREN * 60;

  return (
    <section className={className} aria-label="Rusttijd">
      <MicroLabel>Rusttijd</MicroLabel>
      <ul className="mt-1 space-y-1.5">
        {regels.map((r) => {
          const id = r.wie === 'aanvrager' ? requesterId : targetDriverId ?? '';
          const wie = String(id) === String(kijkerId ?? '') ? 'Jij' : naamVan(id) ?? 'Onbekend';
          const delen: Array<{ tekst: string; kort: boolean }> = [];
          if (r.rustVoor !== null) delen.push({ tekst: `${formatRust(r.rustVoor)} na de dienst van de dag ervoor`, kort: r.rustVoor < grens });
          if (r.rustNa !== null) delen.push({ tekst: `${formatRust(r.rustNa)} tot de dienst van de dag erna`, kort: r.rustNa < grens });
          const Icoon = r.teKort ? AlertTriangle : Moon;
          return (
            <li
              key={`${r.wie}-${r.datum}`}
              className={cn('flex items-start gap-2.5 rounded-2xl px-3 py-2 text-body-sm', r.teKort ? TOON_WAARSCHUWING : TOON_IN_ORDE)}
            >
              <Icoon size={16} className={cn('mt-0.5 shrink-0', r.teKort ? 'text-amber-700' : 'text-slate-400')} aria-hidden="true" />
              <span className="min-w-0">
                <span className="font-semibold">
                  {r.teKort ? 'Te weinig rust: ' : ''}{wie}, dienst {r.dienst} op {formatShortDay(r.datum)}
                </span>
                <span className="block">
                  {delen.length === 0
                    ? 'Geen dienst de dag ervoor of erna.'
                    : delen.map((d, i) => (
                      <span key={d.tekst} className={cn(d.kort && 'font-semibold')}>
                        {i > 0 ? ', ' : ''}{d.tekst}
                      </span>
                    ))}
                  {r.teKort ? ` (minimum ${MIN_RUST_UREN}u).` : '.'}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
