import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Clock, Info } from 'lucide-react';
import type { Update } from '../types';
import { cn } from '../lib/ui';
import { markUpdatesRead } from '../lib/updateReads';
import { EmptyState, PageHeader, PageShell } from '../components/ui';
import { Badge } from '../components/primitives';

const CATEGORY_TONES: Record<string, 'amber' | 'blue' | 'slate'> = {
  veiligheid: 'amber',
  technisch: 'blue',
  algemeen: 'slate',
};

const CATEGORY_ACCENTS: Record<string, string> = {
  veiligheid: 'bg-amber-500',
  technisch: 'bg-blue-500',
  algemeen: 'bg-slate-300',
};

export function UpdatesView({ updates }: { updates: Update[] }) {
  const [filter, setFilter] = useState<'all' | 'algemeen' | 'veiligheid' | 'technisch'>('all');
  const [expandedUpdateIds, setExpandedUpdateIds] = useState<string[]>([]);

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

  const filteredUpdates = updates.filter(u => filter === 'all' || u.category === filter);
  const toggleExpanded = (id: string) => {
    setExpandedUpdateIds((current) => (
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    ));
  };

  return (
    <PageShell width="6xl">
      <PageHeader
        title="Updates & nieuws"
        description="Berichten en mededelingen van de planning."
        actions={(
          <div className="glass-segmented flex p-1 rounded-xl">
            {(['all', 'algemeen', 'veiligheid', 'technisch'] as const).map(cat => (
              <button
                key={cat}
                onClick={() => setFilter(cat)}
                className={cn(
                  "px-4 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all",
                  filter === cat ? "glass-chip text-oker-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
                )}
              >
                {cat === 'all' ? 'Alles' : cat}
              </button>
            ))}
          </div>
        )}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {filteredUpdates.length > 0 ? (
          filteredUpdates.map(update => {
            const isExpanded = expandedUpdateIds.includes(update.id);
            const shouldTruncate = update.content.length > 220;
            const visibleContent = shouldTruncate && !isExpanded
              ? `${update.content.slice(0, 220).trimEnd()}...`
              : update.content;

            return (
            <div key={update.id} className="surface-card surface-card-hover p-5 md:p-6 rounded-3xl relative overflow-hidden group duration-300">
              <div className={cn(
                "absolute top-0 left-0 w-1 h-full",
                update.isUrgent ? "bg-red-500" : (CATEGORY_ACCENTS[update.category] ?? "bg-slate-300")
              )} />

              <div className="flex justify-between items-center mb-4 gap-3">
                <div className="flex flex-wrap gap-2">
                  <Badge tone={CATEGORY_TONES[update.category] ?? 'slate'} className="capitalize">
                    {update.category}
                  </Badge>
                  {update.isUrgent && (
                    <Badge tone="red" dot>Dringend</Badge>
                  )}
                </div>
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400 tabular-nums">
                  <Clock size={12} className="text-slate-300" />
                  {update.date}
                </div>
              </div>

              <h4 className="text-lg font-bold tracking-tight text-slate-800 mb-3 leading-tight">{update.title}</h4>
              <p className="text-sm font-normal text-slate-600 leading-relaxed whitespace-pre-wrap">{visibleContent}</p>

              {shouldTruncate ? (
                <div className="mt-4 pt-4 border-t border-slate-100 flex justify-end">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(update.id)}
                    className="ios-pressable flex items-center gap-1.5 text-xs font-semibold text-oker-600 hover:text-oker-700 transition-colors"
                  >
                    {isExpanded ? 'Toon minder' : 'Lees meer'}
                    <ChevronRight size={14} className={cn("transition-transform", isExpanded && "rotate-90")} />
                  </button>
                </div>
              ) : null}
            </div>
          );
          })
        ) : (
          <div className="lg:col-span-2">
            <EmptyState
              icon={<Info size={28} />}
              title="Geen updates"
              message="Geen updates gevonden in deze categorie."
            />
          </div>
        )}
      </div>
    </PageShell>
  );
}
