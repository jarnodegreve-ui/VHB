import { CircleHelp, ClipboardCheck, Clock } from 'lucide-react';
import { persoonsVerloop, type RuilVoorVerloop, type VerloopRegel } from '../../shared/ruilVerloop';
import { formatMomentKort, formatShortDay } from '../lib/format';
import { Avatar } from './Avatar';
import { Badge, MicroLabel } from './primitives';

/**
 * Verloop per persoon van één dienstruil (Jarno 20-09): per regel wie het is,
 * zijn rol in de ruil, waar hij staat en sinds wanneer. Eén blok voor elke
 * plek waar een ruil openklapt: de aanvrager, de collega, de staflijst en het
 * beoordelingspaneel. De afleiding zelf is puur en getest
 * (shared/ruilVerloop.ts); dit bestand tekent alleen.
 *
 * Toon volgt het palet: gebeurd en goed = stille pil met groen puntje,
 * geweigerd = rood (een signaal, dus gekleurd), wie nu aan zet is = pil met
 * klokje, al het andere = kale regel zonder pil. Goud komt hier niet voor:
 * dat is voor acties en "nu", niet voor status.
 */
export function RuilVerloop({ swap, naamVan, kijkerId, compact = false, className }: {
  swap: RuilVoorVerloop;
  /** Naam bij een gebruikers-id; onbekend = een verwijderde gebruiker. */
  naamVan: (userId: string) => string | undefined;
  /** De ingelogde gebruiker: zijn eigen regel krijgt "(jij)". */
  kijkerId?: string;
  /** Eén regel per persoon zonder avatar en moment, voor een tabelcel. De
   *  aanvrager valt weg: "Aangevraagd" staat al in de rij zelf. */
  compact?: boolean;
  className?: string;
}) {
  const regels = persoonsVerloop(swap);

  if (compact) {
    return (
      <ul className={className} aria-label="Verloop per persoon">
        {regels.filter((r) => r.rol !== 'aanvrager' || r.status !== 'Aangevraagd').map((r) => (
          <li key={r.rol} className="flex items-center gap-1.5 whitespace-nowrap text-xs font-medium text-slate-500">
            <span>{r.rol === 'planner' ? 'Planner' : r.rolLabel}</span>
            <StatusPil regel={r} kaal titel={r.op ? formatMomentKort(r.op) : undefined} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <section className={className} aria-label="Verloop per persoon">
      <MicroLabel>Verloop</MicroLabel>
      <ul className="mt-1 divide-y divide-hairline-subtle">
        {regels.map((r) => {
          const naam = naamVoor(r, naamVan);
          const krijgt = krijgtTekst(r);
          return (
            <li key={r.rol} className="flex items-start gap-3 py-2.5">
              {r.rol === 'aanvrager' || r.rol === 'collega' ? (
                <Avatar naam={naam} size="md" />
              ) : (
                <span aria-hidden className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-muted text-slate-600 ring-1 ring-hairline">
                  {r.rol === 'planner' ? <ClipboardCheck size={16} /> : <CircleHelp size={16} />}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="min-w-0 truncate text-sm font-semibold text-slate-800">
                    {naam}
                    {r.userId && r.userId === kijkerId && <span className="font-medium text-slate-500"> (jij)</span>}
                  </p>
                  <span className="shrink-0"><StatusPil regel={r} /></span>
                </div>
                <div className="mt-0.5 flex items-baseline justify-between gap-2 text-xs font-medium text-slate-500">
                  <span className="min-w-0">{r.rol === 'planner' && r.naam ? 'Planner' : r.rolLabel}</span>
                  {r.op && <time dateTime={r.op} className="shrink-0 whitespace-nowrap">{formatMomentKort(r.op)}</time>}
                </div>
                {krijgt && <p className="mt-0.5 text-xs font-medium text-slate-600">{krijgt}</p>}
                {r.extra && (
                  <p className="mt-0.5 text-xs font-medium text-slate-500">
                    {r.extra.label}{r.extra.op ? ` ${formatMomentKort(r.extra.op)}` : ''}
                  </p>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function naamVoor(r: VerloopRegel, naamVan: (userId: string) => string | undefined): string {
  // Een chauffeur krijgt geen naam van de server: voor hem is het "Planner".
  if (r.rol === 'planner') return r.naam || 'Planner';
  if (r.rol === 'onbekend') return 'Onbekend';
  return (r.userId && naamVan(r.userId)) || 'Onbekende gebruiker';
}

/** "Krijgt dienst 4101 op vr 10 jul" · "Krijgt vrij op vr 10 jul" · "Neemt dienst 2101 over op …".
 *  Ging de ruil niet door, dan staat er wat hij gekregen zou hebben. */
function krijgtTekst(r: VerloopRegel): string | null {
  if (!r.krijgt) return null;
  const dag = formatShortDay(r.krijgt.datum);
  const op = dag ? ` op ${dag}` : '';
  const wat = r.krijgt.code.toLowerCase() === 'vrij' ? 'vrij' : `dienst ${r.krijgt.code}`;
  if (r.krijgt.vervallen) return r.krijgt.overname ? `Zou ${wat} overnemen${op}` : `Zou ${wat} krijgen${op}`;
  return r.krijgt.overname ? `Neemt ${wat} over${op}` : `Krijgt ${wat}${op}`;
}

function StatusPil({ regel, kaal = false, titel }: { regel: VerloopRegel; kaal?: boolean; titel?: string }) {
  if (regel.toon === 'danger') return <Badge tone="red" dot={!kaal} kaal={kaal} title={titel}>{regel.status}</Badge>;
  if (regel.toon === 'succes') return <Badge tone="emerald" stil={!kaal} kaal={kaal} title={titel}>{regel.status}</Badge>;
  // Aan zet in een tabelcel (kaal): geen pil, wel het klokje en donkerder tekst.
  if (regel.aanZet) return <Badge tone="slate" kaal={kaal} icon={<Clock size={12} />} title={titel} className={kaal ? 'text-slate-800' : undefined}>{regel.status}</Badge>;
  return <Badge tone="slate" kaal title={titel}>{regel.status}</Badge>;
}
