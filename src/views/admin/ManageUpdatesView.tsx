import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bell, ChevronDown, Eye, History, Pencil, Trash2 } from 'lucide-react';
import type { Update } from '../../types';
import { notify } from '../../lib/ui';
import { formatUpdateDate } from '../../lib/format';
import { fetchUpdateReadCounts } from '../../lib/updateReads';
import { ConfirmationModal, EmptyState, PageHeader, PageShell } from '../../components/ui';
import { Badge, Button, MicroLabel } from '../../components/primitives';
import { EntityHistoryModal } from '../../components/EntityHistoryModal';

function Input({
  label,
  type,
  placeholder,
  options,
  value,
  onChange,
}: {
  label: string;
  type: string;
  placeholder?: string;
  options?: { label: string; value: string }[];
  value?: any;
  onChange?: (e: any) => void;
}) {
  return (
    <div className="space-y-2">
      <MicroLabel className="ml-1">{label}</MicroLabel>
      {type === 'select' ? (
        <select aria-label={label} value={value} onChange={onChange} className="control-input w-full px-4 py-3 rounded-2xl font-semibold text-sm outline-none transition-all bg-surface-field">
          {options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={type}
          aria-label={label}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          className="control-input w-full px-4 py-3 rounded-2xl font-semibold text-sm outline-none transition-all"
        />
      )}
    </div>
  );
}

export function ManageUpdatesView({
  updates,
  onSave,
  onSendUrgentEmail,
  canSendUrgentEmail,
}: {
  updates: Update[];
  onSave: (u: Update[]) => Promise<boolean>;
  onSendUrgentEmail: (u: Update) => Promise<void>;
  canSendUrgentEmail: boolean;
}) {
  const emptyUpdateForm = { title: '', category: 'algemeen', content: '', isUrgent: false };
  const [updateForm, setUpdateForm] = useState(emptyUpdateForm);
  const [isPublishing, setIsPublishing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Het bewerk-formulier staat bovenaan, de updatelijst eronder. Zonder
  // scrollen lijkt 'Bewerk' (onderaan) niks te doen — het formulier vult
  // zich buiten beeld. Deze ref brengt het formulier in beeld.
  const formRef = useRef<HTMLDivElement>(null);
  // Compacte uitklaprijen (vast lijstpatroon): dicht = titel + status,
  // open = volledige inhoud. Vol uitgeschreven werd dit scherm meters lang.
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const toggleExpanded = (id: string) => setExpandedIds((cur) => (
    cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
  ));
  const [historyUpdate, setHistoryUpdate] = useState<Update | null>(null);

  // Leesbevestigingen: hoeveel chauffeurs elke urgente update gelezen hebben.
  // Best-effort — faalt het laden, dan tonen we simpelweg geen teller.
  const [readCounts, setReadCounts] = useState<Record<string, number>>({});
  const [totalChauffeurs, setTotalChauffeurs] = useState(0);
  useEffect(() => {
    let alive = true;
    fetchUpdateReadCounts()
      .then((data) => {
        if (!alive) return;
        setReadCounts(data.counts);
        setTotalChauffeurs(data.totalChauffeurs);
      })
      .catch(() => {/* stil: geen teller tonen */});
    return () => { alive = false; };
  }, []);

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!updateForm.title || !updateForm.content) return;

    setIsPublishing(true);
    const updateToSave: Update = {
      id: editingId || Date.now().toString(),
      date: editingId
        ? (updates.find((update) => update.id === editingId)?.date || new Date().toLocaleDateString('nl-BE'))
        : new Date().toLocaleDateString('nl-BE'),
      title: updateForm.title,
      category: updateForm.category as any,
      content: updateForm.content,
      isUrgent: updateForm.isUrgent,
    };

    const success = await onSave(
      editingId
        ? updates.map((update) => update.id === editingId ? updateToSave : update)
        : [updateToSave, ...updates]
    );
    if (success) {
      if (updateForm.isUrgent && canSendUrgentEmail) {
        await onSendUrgentEmail(updateToSave);
      }
      setUpdateForm(emptyUpdateForm);
      setEditingId(null);
      notify(editingId ? 'Update bijgewerkt.' : 'Update gepubliceerd.', 'success');
    } else {
      notify('Update kon niet worden opgeslagen. Controleer de foutmelding hierboven en probeer opnieuw.', 'error');
    }
    setIsPublishing(false);
  };

  const handleEdit = (update: Update) => {
    setEditingId(update.id);
    setUpdateForm({
      title: update.title,
      category: update.category,
      content: update.content,
      isUrgent: Boolean(update.isUrgent),
    });
    // Naar het formulier scrollen zodat de bewerking zichtbaar is.
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setUpdateForm(emptyUpdateForm);
  };

  // Eén misklik naast 'Bewerk' verwijderde een update direct en definitief —
  // nu eerst bevestigen, zoals in alle andere beheer-views.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    const success = await onSave(updates.filter((update) => update.id !== id));
    if (success) {
      notify('Update verwijderd.', 'success');
    } else {
      notify('Update kon niet worden verwijderd.', 'error');
    }
    setDeletingId(null);
  };

  return (
    <PageShell>
      <PageHeader eyebrow="Beheer" title="Beheer updates" />
      <div ref={formRef} className="surface-card p-5 md:p-6 rounded-3xl scroll-mt-4">
        <h3 className="text-lg font-bold mb-6 flex items-center gap-3 tracking-tight">
          <Bell size={24} className="text-oker-500" />
          {editingId ? 'Update bewerken' : 'Nieuwe update publiceren'}
        </h3>
        <form onSubmit={handlePublish} className="space-y-6">
          <Input label="Titel" type="text" placeholder="Onderwerp van de update" value={updateForm.title} onChange={(e) => setUpdateForm({ ...updateForm, title: e.target.value })} />

          <div className="rounded-2xl border border-red-100 bg-red-50 p-4">
            {canSendUrgentEmail ? (
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="isUrgent"
                  className="w-5 h-5 rounded border-red-300 text-red-700 focus:ring-red-500"
                  checked={updateForm.isUrgent}
                  onChange={(e) => setUpdateForm({ ...updateForm, isUrgent: e.target.checked })}
                />
                <label htmlFor="isUrgent" className="text-sm font-semibold text-red-700 cursor-pointer flex items-center gap-2">
                  <AlertTriangle size={16} /> Markeer als dringend (verstuurt automatische e-mail)
                </label>
              </div>
            ) : (
              <div>
                <p className="text-sm font-semibold text-red-700 flex items-center gap-2">
                  <AlertTriangle size={16} /> Dringende verzending admin-only
                </p>
                <p className="mt-2 text-sm font-medium text-red-700/80">
                  Planners kunnen updates publiceren, maar geen dringende e-mails uitsturen naar alle gebruikers.
                </p>
              </div>
            )}
          </div>

          <div>
            <MicroLabel className="mb-3">Inhoud van het bericht</MicroLabel>
            <textarea
              className="w-full px-6 py-4 rounded-2xl border border-slate-200 focus:outline-none focus:ring-4 focus:ring-oker-500/10 focus:border-oker-500 transition-all min-h-[180px] bg-slate-50/50 font-medium text-slate-700"
              placeholder="Schrijf hier het bericht voor de chauffeurs…"
              value={updateForm.content}
              onChange={(e) => setUpdateForm({ ...updateForm, content: e.target.value })}
            />
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button type="submit" variant="primary" size="lg" full disabled={isPublishing}>
              {isPublishing ? (editingId ? 'Bijwerken…' : 'Publiceren…') : (editingId ? 'Update bijwerken' : 'Update publiceren')}
            </Button>
            {editingId ? (
              <Button variant="secondary" size="lg" className="w-full sm:w-auto" onClick={handleCancelEdit}>
                Annuleren
              </Button>
            ) : null}
          </div>
        </form>
      </div>

      <div className="surface-card p-5 md:p-6 rounded-3xl">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold tracking-tight">Bestaande updates</h3>
            <p className="mt-1 text-sm font-medium text-slate-500">
              Beheer gepubliceerde berichten en verwijder updates die niet meer zichtbaar mogen zijn.
            </p>
          </div>
          <Badge tone="slate" className="shrink-0 tabular-nums">{updates.length} zichtbaar</Badge>
        </div>

        <div className="mt-5 max-h-[480px] overflow-y-auto overscroll-contain space-y-2 -mx-1 px-1">
          {updates.length > 0 ? updates.map((update) => {
            const open = expandedIds.includes(update.id);
            return (
            <div key={update.id} className="surface-card rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between gap-2 p-3 pl-4">
                <button
                  type="button"
                  onClick={() => toggleExpanded(update.id)}
                  aria-expanded={open}
                  className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                >
                  <span className="min-w-0 truncate text-sm font-bold tracking-tight text-slate-800">{update.title}</span>
                  {update.isUrgent && <Badge tone="red" dot>Dringend</Badge>}
                  <span className="shrink-0 text-2xs font-medium text-slate-400 tabular-nums">{formatUpdateDate(update.date)}</span>
                  <ChevronDown size={16} className={`shrink-0 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
                </button>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button variant="ghost" size="sm" className="h-11 w-11 sm:pointer-fine:h-9 sm:pointer-fine:w-9 justify-center" icon={<History size={14} />} aria-label="Wijzigingsgeschiedenis" title="Wijzigingsgeschiedenis" onClick={() => setHistoryUpdate(update)} />
                  <Button variant="ghost" size="sm" className="h-11 w-11 sm:pointer-fine:h-9 sm:pointer-fine:w-9 justify-center" icon={<Pencil size={14} />} aria-label="Bewerk" title="Bewerk" onClick={() => handleEdit(update)} />
                  <Button variant="ghost" size="sm" className="h-11 w-11 sm:pointer-fine:h-9 sm:pointer-fine:w-9 justify-center text-red-500" icon={<Trash2 size={14} />} aria-label="Verwijder" title="Verwijder" disabled={deletingId === update.id} onClick={() => setConfirmDeleteId(update.id)} />
                </div>
              </div>
              {open && (
                <div className="px-4 pb-4 pt-0.5">
                  {update.isUrgent && totalChauffeurs > 0 && (
                    <span className="mb-2 inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-2xs font-semibold text-slate-500 tabular-nums" title="Aantal chauffeurs dat deze update geopend heeft">
                      <Eye size={12} />
                      {readCounts[update.id] ?? 0}/{totalChauffeurs} gelezen
                    </span>
                  )}
                  <p className="whitespace-pre-wrap text-sm font-medium leading-7 text-slate-600">{update.content}</p>
                </div>
              )}
            </div>
            );
          }) : (
            <EmptyState
              title="Nog geen updates"
              message="Publiceer hierboven je eerste nieuwsbericht of veiligheidsmelding — chauffeurs zien het meteen op hun dashboard."
            />
          )}
        </div>
      </div>

      <EntityHistoryModal
        open={!!historyUpdate}
        onClose={() => setHistoryUpdate(null)}
        entityType="update"
        entityId={historyUpdate?.id ?? ''}
        title={historyUpdate?.title}
      />

      <ConfirmationModal
        isOpen={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={() => { if (confirmDeleteId) handleDelete(confirmDeleteId); }}
        title="Update verwijderen?"
        message="Deze update verdwijnt definitief voor alle chauffeurs. Dit kan niet ongedaan gemaakt worden."
        confirmText="Verwijderen"
      />
    </PageShell>
  );
}
