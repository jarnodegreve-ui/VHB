import { useEffect, useState } from 'react';
import { Clock, History } from 'lucide-react';
import type { ActivityEntityType, ActivityLogEntry } from '../types';
import { apiJson } from '../lib/api';
import { cn } from '../lib/ui';
import { Modal } from './Modal';
import { EmptyState, ModalHeader } from './ui';
import { MicroLabel, microLabelClass } from './primitives';

/**
 * Toon de volledige wijzigingsgeschiedenis van één specifieke entity
 * (dienst, verlofaanvraag, dienstruil, ...). Werkt alleen voor entries die
 * NA de entity-id migratie zijn gelogd — oudere entries hebben geen entity_id
 * en verschijnen niet hier. Wel beschikbaar via de globale Activiteit-view
 * voor admin.
 *
 * Vereist `entityType` + `entityId`. Sluit met onClose. Op de gedeelde Modal
 * met `boven`: kan bovenop een formulier-modal openen (Gebruikersbeheer,
 * Dienstbeheer) en krijgt zo ook ESC, focus-trap en scroll-lock.
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
    apiJson<ActivityLogEntry[]>(`/api/activity/${entityType}/${encodeURIComponent(entityId)}`)
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

  return (
    <Modal open={open} onClose={onClose} maxWidth="lg" ariaLabel="Wijzigingsgeschiedenis" boven>
      <div className="flex max-h-[80dvh] flex-col overflow-hidden">
            <ModalHeader
              leading={<div className="w-10 h-10 rounded-2xl bg-oker-50 text-oker-600 flex items-center justify-center"><History size={18} /></div>}
              title="Wijzigingsgeschiedenis"
              description={title}
              onClose={onClose}
            />

            <div className="p-6 md:p-7 overflow-y-auto flex-1">
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
                <EmptyState mascotte={false} title="Nog geen wijzigingen geregistreerd." message="Geschiedenis wordt vanaf nu bijgehouden bij elke wijziging." />
              )}

              {entries && entries.length > 0 && (
                <ol className="relative space-y-3 border-l-2 border-slate-200/60 pl-5">
                  {entries.map((entry, i) => (
                    <li key={entry.id} className="relative">
                      <span className={cn(
                        'absolute -left-[1.65rem] top-2 w-3 h-3 rounded-full ring-4 ring-white',
                        i === 0 ? 'bg-oker-500' : 'bg-slate-300',
                      )} />
                      <div className="rounded-2xl border border-slate-100 bg-surface-field p-3.5">
                        <div className="flex items-baseline justify-between gap-3">
                          <p className="text-sm font-semibold text-slate-800">{entry.action}</p>
                          <span className={cn(microLabelClass, 'shrink-0')}>
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
                        <MicroLabel className="mt-2">
                          {entry.actorName} · {entry.actorRole}
                        </MicroLabel>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>
      </div>
    </Modal>
  );
}
