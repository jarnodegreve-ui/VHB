import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { Clock, History, X } from 'lucide-react';
import type { ActivityEntityType, ActivityLogEntry } from '../types';
import { apiFetch } from '../lib/api';
import { cn } from '../lib/ui';

/**
 * Toon de volledige wijzigingsgeschiedenis van één specifieke entity
 * (dienst, verlofaanvraag, dienstruil, ...). Werkt alleen voor entries die
 * NA de entity-id migratie zijn gelogd — oudere entries hebben geen entity_id
 * en verschijnen niet hier. Wel beschikbaar via de globale Activiteit-view
 * voor admin.
 *
 * Vereist `entityType` + `entityId`. Sluit met onClose. Modal-portal naar body
 * om z-index issues te vermijden.
 */
export function EntityHistoryModal({
  open,
  onClose,
  entityType,
  entityId,
  title,
}: {
  open: boolean;
  onClose: () => void;
  entityType: ActivityEntityType;
  entityId: string;
  title?: string;
}) {
  const [entries, setEntries] = useState<ActivityLogEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setEntries(null);
    setError(null);

    let cancelled = false;
    apiFetch<ActivityLogEntry[]>(`/api/activity/${entityType}/${encodeURIComponent(entityId)}`)
      .then((data) => {
        if (!cancelled) setEntries(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err?.message || 'Kon geschiedenis niet laden.');
      });

    return () => {
      cancelled = true;
    };
  }, [open, entityType, entityId]);

  if (!open) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="glass-modal rounded-3xl w-full max-w-lg max-h-[80vh] flex flex-col overflow-hidden"
          >
            <div className="p-6 border-b border-white/70 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-oker-50 text-oker-600 flex items-center justify-center">
                  <History size={18} />
                </div>
                <div>
                  <h4 className="text-base font-black text-slate-900 leading-none">Wijzigingsgeschiedenis</h4>
                  {title && <p className="text-xs font-medium text-slate-500 mt-1">{title}</p>}
                </div>
              </div>
              <button
                onClick={onClose}
                aria-label="Sluiten"
                className="w-11 h-11 inline-flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100/60 rounded-xl transition-colors"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1">
              {error && (
                <p className="text-sm text-red-600 font-medium">{error}</p>
              )}

              {entries === null && !error && (
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div key={i} className="h-16 rounded-2xl bg-slate-100/60 animate-pulse" />
                  ))}
                </div>
              )}

              {entries && entries.length === 0 && (
                <div className="text-center py-8">
                  <p className="text-sm font-bold text-slate-500">Nog geen wijzigingen geregistreerd.</p>
                  <p className="text-xs font-medium text-slate-400 mt-1">
                    Geschiedenis wordt vanaf nu bijgehouden bij elke wijziging.
                  </p>
                </div>
              )}

              {entries && entries.length > 0 && (
                <ol className="relative space-y-3 border-l-2 border-slate-200/60 pl-5">
                  {entries.map((entry, i) => (
                    <li key={entry.id} className="relative">
                      <span className={cn(
                        'absolute -left-[1.65rem] top-2 w-3 h-3 rounded-full ring-4 ring-white',
                        i === 0 ? 'bg-oker-500' : 'bg-slate-300',
                      )} />
                      <div className="rounded-2xl border border-slate-100 bg-white/60 p-3.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="text-sm font-black text-slate-800">{entry.action}</p>
                          <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400 shrink-0">
                            <Clock size={10} className="inline -mt-0.5 mr-1" />
                            {new Date(entry.createdAt).toLocaleString('nl-BE', {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-600 leading-relaxed">{entry.details}</p>
                        <p className="mt-2 text-[10px] font-bold uppercase tracking-[0.08em] text-slate-400">
                          {entry.actorName} · {entry.actorRole}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
