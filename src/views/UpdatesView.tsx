import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Clock, Info } from 'lucide-react';
import type { Update } from '../types';
import { cn } from '../lib/ui';
import { markUpdatesRead } from '../lib/updateReads';
import { formatUpdateDate } from '../lib/format';
import { EmptyState, PageHeader, PageShell } from '../components/ui';
import { Badge, Button, MicroLabel } from '../components/primitives';
import { Card, CardHeader } from '../components/Card';
import { useMinWidth } from '../lib/useMinWidth';

/**
 * Breekpunt als React-state (Tailwind `lg` = 1024 px). Onder `lg` de
 * kaartlijst met "Lees meer"; daarboven master-detail (titels links, volledige
 * tekst rechts). Lokaal — een gedeelde useMediaQuery ontbreekt nog in src/lib.
 */

export function UpdatesView({ updates }: { updates: Update[] }) {
  const [expandedUpdateIds, setExpandedUpdateIds] = useState<string[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const lg = useMinWidth(1024);

  // Openen van de Updates-weergave = gelezen. Markeer elke nog niet gemelde
  // update (los van het actieve filter) zodat de planner 'X/Y gelezen' ziet.
  // Faalt stil; bij een fout blijft de id ongemarkeerd zodat het later opnieuw
  // geprobeerd wordt.
  const markedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const fresh = updates.map((u) => u.id).filter((id) => !markedRef.current.has(id));
    if (fresh.length === 0) return;
    fresh.forEach((id) => markedRef.current.add(id));
    markUpdatesRead(fresh).catch(() => {
      fresh.forEach((id) => markedRef.current.delete(id));
    });
  }, [updates]);

  const toggleExpanded = (id: string) => {
    setExpandedUpdateIds((current) => (
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    ));
  };

  // Desktop: het nieuwste bericht staat standaard open; verdwijnt de keuze
  // (bericht verwijderd), dan valt het paneel terug op het eerste.
  const detail = lg ? updates.find((u) => u.id === selectedId) ?? updates[0] ?? null : null;

  return (
    <PageShell>
      <PageHeader
        title="Updates & nieuws"
        description="Berichten en mededelingen."
      />

      {updates.length === 0 ? (
        <EmptyState
          icon={<Info size={24} />}
          title="Geen updates"
          message="Er zijn nog geen berichten geplaatst."
        />
      ) : lg ? (
        /* Master-detail vanaf lg: lijst met titels/datum links (38 %), het
           volledige bericht rechts. */
        <div className="lg:grid lg:grid-cols-[minmax(0,38%)_1fr] lg:items-start lg:gap-5">
          <ul className="space-y-2" aria-label="Berichten">
            {updates.map((update) => {
              const isCurrent = detail?.id === update.id;
              return (
                <Card
                  key={update.id}
                  as="li"
                  padding="none"
                  interactive
                  aria-current={isCurrent ? 'true' : undefined}
                  className={cn('relative overflow-hidden', isCurrent && 'ring-1 ring-oker-400 bg-oker-50/40')}
                >
                  <div className={cn('absolute top-0 left-0 w-1 h-full', update.isUrgent ? 'bg-red-500' : 'bg-slate-300')} />
                  {/* rauw: lijstrij van het master-detail (kaart als knop: titel + datum + dringend-badge) */}
                  <button
                    type="button"
                    onClick={() => setSelectedId(update.id)}
                    className="flex w-full items-center justify-between gap-3 px-4 py-3 pl-5 text-left transition-colors hover:bg-slate-50/50"
                  >
                    <div className="min-w-0">
                      <p className="text-card-title truncate">{update.title}</p>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 text-2xs font-medium text-slate-500 tabular-nums">
                          <Clock size={12} className="text-slate-300" />
                          {formatUpdateDate(update.date)}
                        </span>
                        {update.isUrgent && <Badge tone="red" dot>Dringend</Badge>}
                      </div>
                    </div>
                    <ChevronRight size={20} className={cn('shrink-0', isCurrent ? 'text-oker-500' : 'text-slate-300')} />
                  </button>
                </Card>
              );
            })}
          </ul>

          {/* Detailpaneel: blijft in beeld terwijl de lijst scrolt. */}
          <div className="lg:sticky lg:top-16" aria-live="polite">
            {detail ? (
              <Card key={detail.id} as="article" padding="lg" className="relative overflow-hidden" aria-label={detail.title}>
                <div className={cn('absolute top-0 left-0 w-1 h-full', detail.isUrgent ? 'bg-red-500' : 'bg-slate-300')} />
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <MicroLabel>Bericht</MicroLabel>
                    {detail.isUrgent && <Badge tone="red" dot>Dringend</Badge>}
                  </div>
                  <div className="flex items-center gap-1.5 text-2xs font-medium text-slate-500 tabular-nums">
                    <Clock size={12} className="text-slate-300" />
                    {formatUpdateDate(detail.date)}
                  </div>
                </div>
                <h2 className="mt-3 text-section-title">{detail.title}</h2>
                <p className="mt-4 max-w-2xl text-sm font-normal leading-relaxed text-slate-600 whitespace-pre-wrap">{detail.content}</p>
              </Card>
            ) : (
              <Card tone="dashed" padding="lg" className="text-center">
                <p className="text-sm text-slate-500">Kies een bericht</p>
              </Card>
            )}
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5">
          {updates.map(update => {
            const isExpanded = expandedUpdateIds.includes(update.id);
            const shouldTruncate = update.content.length > 220;
            const visibleContent = shouldTruncate && !isExpanded
              ? `${update.content.slice(0, 220).trimEnd()}…`
              : update.content;

            return (
            <Card key={update.id} interactive className="relative overflow-hidden group duration-300">
              <div className={cn(
                "absolute top-0 left-0 w-1 h-full",
                update.isUrgent ? "bg-red-500" : "bg-slate-300"
              )} />

              <div className="flex justify-between items-center mb-4 gap-3">
                {/* Lege wrapper wanneer niet dringend: houdt de datum rechts
                    (justify-between) zonder categorie-badge. */}
                <div className="flex flex-wrap gap-2">
                  {update.isUrgent && <Badge tone="red" dot>Dringend</Badge>}
                </div>
                <div className="flex items-center gap-1.5 text-2xs font-medium text-slate-500 tabular-nums">
                  <Clock size={12} className="text-slate-300" />
                  {formatUpdateDate(update.date)}
                </div>
              </div>

              <CardHeader title={update.title} className="mb-3" />
              <p className="text-sm font-normal text-slate-600 leading-relaxed whitespace-pre-wrap">{visibleContent}</p>

              {shouldTruncate ? (
                <div className="mt-4 pt-4 border-t border-slate-100 flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleExpanded(update.id)}
                    className="-mr-3 text-oker-700 hover:text-oker-700"
                  >
                    {isExpanded ? 'Toon minder' : 'Lees meer'}
                    <ChevronRight size={14} className={cn("transition-transform", isExpanded && "rotate-90")} />
                  </Button>
                </div>
              ) : null}
            </Card>
          );
          })}
        </div>
      )}
    </PageShell>
  );
}
