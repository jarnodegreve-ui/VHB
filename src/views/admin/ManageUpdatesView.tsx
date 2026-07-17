import React, { useState } from 'react';
import { AlertTriangle, Bell, CalendarDays, History, Pencil, Trash2 } from 'lucide-react';
import type { Update } from '../../types';
import { notify } from '../../lib/ui';
import { ConfirmationModal, PageHeader, PageShell } from '../../components/ui';
import { Badge, Button, MicroLabel } from '../../components/primitives';
import { EntityHistoryModal } from '../../components/EntityHistoryModal';

const CATEGORY_BADGE_TONE: Record<string, 'amber' | 'blue' | 'slate'> = {
  veiligheid: 'amber',
  technisch: 'blue',
  algemeen: 'slate',
};

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
        <select value={value} onChange={onChange} className="control-input w-full px-4 py-3 rounded-2xl font-semibold text-sm outline-none transition-all bg-white/60">
          {options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type={type}
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
  const [historyUpdate, setHistoryUpdate] = useState<Update | null>(null);

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
      notify(editingId ? 'Update succesvol bijgewerkt!' : 'Update succesvol gepubliceerd!', 'success');
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
      <div className="surface-card p-5 md:p-6 rounded-3xl">
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
                  className="w-5 h-5 rounded border-red-300 dark:border-red-500/60 text-red-600 focus:ring-red-500"
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
                <p className="mt-2 text-sm font-medium text-red-700/80 dark:text-red-300/80">
                  Planners kunnen updates publiceren, maar geen dringende e-mails uitsturen naar alle gebruikers.
                </p>
              </div>
            )}
          </div>

          <div>
            <MicroLabel className="mb-3">Inhoud van het bericht</MicroLabel>
            <textarea
              className="w-full px-6 py-4 rounded-2xl border border-slate-200 focus:outline-none focus:ring-4 focus:ring-oker-500/10 focus:border-oker-500 transition-all min-h-[180px] bg-slate-50/50 font-medium text-slate-700"
              placeholder="Schrijf hier het bericht voor de chauffeurs..."
              value={updateForm.content}
              onChange={(e) => setUpdateForm({ ...updateForm, content: e.target.value })}
            />
          </div>

          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Button type="submit" variant="primary" size="lg" full disabled={isPublishing}>
              {isPublishing ? (editingId ? 'Bijwerken...' : 'Publiceren...') : (editingId ? 'Update Bijwerken' : 'Update Publiceren')}
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

        <div className="mt-6 space-y-3">
          {updates.length > 0 ? updates.map((update) => (
            <div key={update.id} className="rounded-3xl border border-white/70 bg-white/45 p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    {update.isUrgent ? (
                      <Badge tone="red" dot>Dringend</Badge>
                    ) : (
                      <Badge tone={CATEGORY_BADGE_TONE[update.category] ?? 'slate'} className="capitalize">{update.category}</Badge>
                    )}
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 tabular-nums">
                      <CalendarDays size={13} />
                      {update.date}
                    </span>
                  </div>
                  <h4 className="mt-3 text-lg font-bold tracking-tight text-slate-900">{update.title}</h4>
                  <p className="mt-2 whitespace-pre-wrap text-sm font-medium leading-7 text-slate-600">
                    {update.content}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<History size={14} />}
                    aria-label="Wijzigingsgeschiedenis"
                    title="Wijzigingsgeschiedenis"
                    onClick={() => setHistoryUpdate(update)}
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={<Pencil size={14} />}
                    onClick={() => handleEdit(update)}
                  >
                    Bewerk
                  </Button>
                  <Button
                    variant="danger"
                    size="sm"
                    icon={<Trash2 size={14} />}
                    disabled={deletingId === update.id}
                    onClick={() => setConfirmDeleteId(update.id)}
                  >
                    {deletingId === update.id ? 'Verwijderen...' : 'Verwijder'}
                  </Button>
                </div>
              </div>
            </div>
          )) : (
            <div className="rounded-3xl border border-white/70 bg-white/45 p-6 text-sm font-medium text-slate-500">
              Er zijn nog geen updates gepubliceerd.
            </div>
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
