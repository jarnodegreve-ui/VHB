import { ChevronRight } from 'lucide-react';
import { WEEKDAY_SHORT_MON, formatDayLong } from '../lib/format';
import { weekDagZin, type WeekDag } from '../lib/mijnWeek';
import { cn } from '../lib/ui';
import { Card } from './Card';
import { Button } from './primitives';

/**
 * Mijn week (verbeterronde 4, punt 3): de komende zeven dagen als één strook
 * op Mijn dag, zodat "wanneer rijd ik deze week" geen tik naar het rooster
 * meer kost. Per dag: weekdag, datum, dienstnummer en startuur; verlof, ziek
 * en vrij als gedempt woord, buiten de planning een streepje.
 *
 * De cellen zijn bewust geen knoppen: de detailweergave van een dag is het
 * rooster, en daar gaat de ene knop in de kop naartoe. Schermlezers krijgen
 * per dag één zin (`weekDagZin`), de opmaak erbinnen is decoratief.
 */
export function MijnWeek({ dagen, vandaag, gekozen, onRooster, className }: {
  dagen: WeekDag[];
  vandaag: string;
  /** De dag die het scherm erboven toont (vandaag of morgen): stil gemarkeerd. */
  gekozen?: string;
  onRooster?: () => void;
  className?: string;
}) {
  return (
    <section aria-label="Mijn week" className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between gap-3 px-1">
        <h2 className="text-card-title">Mijn week</h2>
        {onRooster && (
          <Button variant="ghost" size="sm" iconRechts={<ChevronRight size={14} />} onClick={onRooster}>
            Rooster
          </Button>
        )}
      </div>
      <Card padding="none" className="overflow-hidden">
        <ol className="grid grid-cols-7 divide-x divide-hairline-subtle">
          {dagen.map((dag) => {
            const d = new Date(`${dag.datum}T00:00:00`);
            const isVandaag = dag.datum === vandaag;
            const dienst = dag.soort === 'dienst';
            const extra = dag.dienstnummers.length - 1;
            return (
              <li
                key={dag.datum}
                aria-label={`${formatDayLong(dag.datum)}: ${weekDagZin(dag)}`}
                className={cn('flex min-w-0 flex-col items-center px-0.5 py-2.5 text-center', dag.datum === gekozen && 'bg-surface-muted')}
              >
                <span aria-hidden="true" className="text-micro">{WEEKDAY_SHORT_MON[(d.getDay() + 6) % 7]}</span>
                {/* Vandaag = goud dagcijfer, hetzelfde stille signaal als in de dagstrip. */}
                <span aria-hidden="true" className={cn('mt-0.5 text-sm font-bold leading-tight', isVandaag ? 'text-oker-700' : 'text-slate-800')}>
                  {d.getDate()}
                </span>
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-1.5 max-w-full truncate text-xs leading-tight',
                    dienst ? 'font-mono font-bold text-slate-900' : 'font-medium text-slate-500',
                    dag.soort === 'verlof' && 'text-blue-700',
                    dag.soort === 'ziek' && 'text-amber-700',
                  )}
                >
                  {dienst ? `${dag.dienstnummers[0] ?? 'dienst'}${extra > 0 ? `+${extra}` : ''}` : dag.soort === 'onbekend' ? '—' : dag.soort}
                </span>
                <span aria-hidden="true" className="mt-0.5 h-4 font-mono text-xs leading-4 text-slate-500">
                  {dienst ? dag.start : ''}
                </span>
              </li>
            );
          })}
        </ol>
      </Card>
    </section>
  );
}
