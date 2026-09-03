import { useEffect, useRef, useState } from 'react';
import { Bell, ChevronRight, Clock } from 'lucide-react';
import type { Update } from '../types';
import { cn } from '../lib/ui';
import { markUpdatesRead } from '../lib/updateReads';
import { formatUpdateDate } from '../lib/format';
import { EmptyState, PageHeader, PageShell } from '../components/ui';
import { Badge } from '../components/primitives';
import { Card } from '../components/Card';
import { DetailPaneel, MasterDetail, useInlinePaneel } from '../components/DetailPaneel';

/**
 * Titels links, het volledige bericht in het gedeelde DetailPaneel: op
 * desktop rechts naast de lijst, op mobiel in een SlideOver.
 */
export function UpdatesView({ updates }: { updates: Update[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const inline = useInlinePaneel();

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

  // Desktop: het nieuwste bericht staat standaard open; verdwijnt de keuze
  // (bericht verwijderd), dan valt het paneel terug op het eerste. Mobiel:
  // alleen wat de chauffeur zelf opentikte.
  const gekozen = updates.find((u) => u.id === selectedId) ?? null;
  const detail = inline ? gekozen ?? updates[0] ?? null : gekozen;

  return (
    <PageShell>
      <PageHeader
        title="Updates & nieuws"
        description="Berichten en mededelingen."
      />

      {updates.length === 0 ? (
        <EmptyState
          title="Geen updates"
          message="Er zijn nog geen berichten geplaatst."
        />
      ) : (
        <MasterDetail
          lijst={(
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
                    {/* rauw: lijstrij van het master-detail (kaart als knop: titel + datum + dringend-badge + eerste regel) */}
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
                        {/* Eerste regel als voorproef — op mobiel scan je zo de
                            lijst zonder elk bericht te openen. */}
                        <p className="mt-1 truncate text-xs font-normal text-slate-500">{update.content}</p>
                      </div>
                      <ChevronRight size={20} className={cn('shrink-0', isCurrent ? 'text-oker-500' : 'text-slate-300')} />
                    </button>
                  </Card>
                );
              })}
            </ul>
          )}
          paneel={(
            <DetailPaneel
              open={!!detail}
              onClose={() => setSelectedId(null)}
              title={detail?.title ?? 'Bericht'}
              subtitle={detail ? formatUpdateDate(detail.date) : undefined}
              sleutel={detail?.id}
              leegTekst="Kies een bericht."
              icon={(
                <span className={cn('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', detail?.isUrgent ? 'bg-red-500/12 text-red-700' : 'bg-slate-500/12 text-slate-600')}>
                  <Bell size={16} />
                </span>
              )}
            >
              {detail && (
                <article className="space-y-4" aria-label={detail.title}>
                  {detail.isUrgent && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="red" dot>Dringend</Badge>
                    </div>
                  )}
                  <p className="max-w-2xl text-sm font-normal leading-relaxed text-slate-600 whitespace-pre-wrap">{detail.content}</p>
                </article>
              )}
            </DetailPaneel>
          )}
        />
      )}
    </PageShell>
  );
}
