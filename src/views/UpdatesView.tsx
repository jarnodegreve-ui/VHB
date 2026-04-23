import { useState } from 'react';
import { AlertTriangle, ChevronRight, Clock, Info } from 'lucide-react';
import type { Update } from '../types';
import { cn } from '../lib/ui';

export function UpdatesView({ updates }: { updates: Update[] }) {
  const [filter, setFilter] = useState<'all' | 'algemeen' | 'veiligheid' | 'technisch'>('all');
  const [expandedUpdateIds, setExpandedUpdateIds] = useState<string[]>([]);

  const filteredUpdates = updates.filter(u => filter === 'all' || u.category === filter);
  const toggleExpanded = (id: string) => {
    setExpandedUpdateIds((current) => (
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    ));
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h3 className="text-2xl font-black tracking-tight">Updates & Nieuws</h3>
          <div className="glass-segmented flex p-1 rounded-xl">
          {(['all', 'algemeen', 'veiligheid', 'technisch'] as const).map(cat => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={cn(
                "px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                filter === cat ? "glass-chip text-oker-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              {cat === 'all' ? 'Alles' : cat}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-6">
        {filteredUpdates.length > 0 ? (
          filteredUpdates.map(update => {
            const isExpanded = expandedUpdateIds.includes(update.id);
            const shouldTruncate = update.content.length > 220;
            const visibleContent = shouldTruncate && !isExpanded
              ? `${update.content.slice(0, 220).trimEnd()}...`
              : update.content;

            return (
            <div key={update.id} className="surface-card surface-card-hover p-6 md:p-8 rounded-[32px] relative overflow-hidden group duration-300">
              <div className={cn(
                "absolute top-0 left-0 w-1.5 h-full",
                update.isUrgent ? "bg-red-600" :
                update.category === 'veiligheid' ? "bg-red-500" : 
                update.category === 'technisch' ? "bg-blue-500" : "bg-emerald-500"
              )} />
              
              <div className="flex justify-between items-center mb-6">
                <div className="flex gap-2">
                  <span className={cn(
                    "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-[0.15em]",
                    update.category === 'veiligheid' ? "bg-red-50 text-red-600" : 
                    update.category === 'technisch' ? "bg-blue-50 text-blue-600" : "bg-emerald-50 text-emerald-600"
                  )}>
                    {update.category}
                  </span>
                  {update.isUrgent && (
                    <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-[0.15em] bg-red-600 text-white flex items-center gap-1">
                      <AlertTriangle size={10} /> DRINGEND
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-slate-400 font-black uppercase tracking-widest">
                  <Clock size={12} className="text-slate-300" />
                  {update.date}
                </div>
              </div>
              
              <h4 className="text-xl font-black text-slate-800 mb-4 group-hover:text-oker-500 transition-colors leading-tight">{update.title}</h4>
              <p className="text-slate-600 leading-relaxed font-medium text-sm md:text-base whitespace-pre-wrap">{visibleContent}</p>
              
              {shouldTruncate ? (
                <div className="mt-6 pt-6 border-t border-slate-50 flex justify-end">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(update.id)}
                    className="text-[10px] font-black text-oker-500 uppercase tracking-widest hover:text-oker-600 transition-colors flex items-center gap-2"
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
          <div className="surface-card p-12 rounded-[32px] text-center">
            <Info size={48} className="mx-auto text-slate-200 mb-4" />
            <p className="text-slate-400 font-bold">Geen updates gevonden in deze categorie.</p>
          </div>
        )}
      </div>
    </div>
  );
}

