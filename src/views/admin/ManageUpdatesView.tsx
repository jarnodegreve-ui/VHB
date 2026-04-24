import React, { useState } from 'react';
import { AlertTriangle, Bell, CalendarDays, Pencil, Trash2 } from 'lucide-react';
import type { Update } from '../../types';
import { cn, notify } from '../../lib/ui';
import { PageHeader, PageShell } from '../../components/ui';

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
      <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">{label}</label>
      {type === 'select' ? (
        <select value={value} onChange={onChange} className="control-input w-full px-4 py-3 rounded-2xl font-bold text-sm outline-none transition-all bg-white/60">
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
          className="control-input w-full px-4 py-3 rounded-2xl font-bold text-sm outline-none transition-all"
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
      <PageHeader eyebrow="Beheer" title="Beheer Updates" />
      <div className="surface-card p-6 md:p-8 rounded-[32px]">
        <h3 className="text-lg font-black mb-8 flex items-center gap-3 tracking-tight">
          <Bell size={24} className="text-emerald-500" />
          {editingId ? 'Update Bewerken' : 'Nieuwe Update Publiceren'}
        </h3>
        <form onSubmit={handlePublish} className="space-y-6">
          <Input label="Titel" type="text" placeholder="Onderwerp van de update" value={updateForm.title} onChange={(e) => setUpdateForm({ ...updateForm, title: e.target.value })} />
          <Input
            label="Categorie"
            type="select"
            options={[
              { label: 'Algemeen', value: 'algemeen' },
              { label: 'Veiligheid', value: 'veiligheid' },
              { label: 'Technisch', value: 'technisch' },
            ]}
            value={updateForm.category}
            onChange={(e) => setUpdateForm({ ...updateForm, category: e.target.value })}
          />

          <div className="rounded-2xl border border-red-100 bg-red-50 p-4">
            {canSendUrgentEmail ? (
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="isUrgent"
                  className="w-5 h-5 rounded border-red-300 text-red-600 focus:ring-red-500"
                  checked={updateForm.isUrgent}
                  onChange={(e) => setUpdateForm({ ...updateForm, isUrgent: e.target.checked })}
                />
                <label htmlFor="isUrgent" className="text-sm font-black text-red-700 uppercase tracking-widest cursor-pointer flex items-center gap-2">
                  <AlertTriangle size={16} /> Markeer als DRINGEND (verstuurt automatische e-mail)
                </label>
              </div>
            ) : (
              <div>
                <p className="text-sm font-black uppercase tracking-widest text-red-700 flex items-center gap-2">
                  <AlertTriangle size={16} /> Dringende verzending admin-only
                </p>
                <p className="mt-2 text-sm font-medium text-red-700/80">
                  Planners kunnen updates publiceren, maar geen dringende e-mails uitsturen naar alle gebruikers.
                </p>
              </div>
            )}
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Inhoud van het bericht</label>
            <textarea
              className="w-full px-6 py-4 rounded-2xl border border-slate-200 focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all min-h-[180px] bg-slate-50/50 font-medium text-slate-700"
              placeholder="Schrijf hier het bericht voor de chauffeurs..."
              value={updateForm.content}
              onChange={(e) => setUpdateForm({ ...updateForm, content: e.target.value })}
            />
          </div>

          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button
              type="submit"
              disabled={isPublishing}
              className={cn(
                'w-full font-black px-8 py-4 rounded-2xl transition-all shadow-xl uppercase tracking-widest text-xs active:scale-95',
                isPublishing ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-emerald-500/20'
              )}
            >
              {isPublishing ? (editingId ? 'Bijwerken...' : 'Publiceren...') : (editingId ? 'Update Bijwerken' : 'Update Publiceren')}
            </button>
            {editingId ? (
              <button
                type="button"
                onClick={handleCancelEdit}
                className="w-full rounded-2xl border border-white/70 bg-white/55 px-8 py-4 text-xs font-black uppercase tracking-widest text-slate-500 transition-all hover:bg-white/80 sm:w-auto"
              >
                Annuleren
              </button>
            ) : null}
          </div>
        </form>
      </div>

      <div className="surface-card p-6 md:p-8 rounded-[32px]">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-lg font-black tracking-tight">Bestaande Updates</h3>
            <p className="mt-1 text-sm font-medium text-slate-500">
              Beheer gepubliceerde berichten en verwijder updates die niet meer zichtbaar mogen zijn.
            </p>
          </div>
          <div className="rounded-full border border-white/70 bg-white/55 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">
            {updates.length} zichtbaar
          </div>
        </div>

        <div className="mt-6 space-y-3">
          {updates.length > 0 ? updates.map((update) => (
            <div key={update.id} className="rounded-[24px] border border-white/70 bg-white/45 p-5">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn(
                      'rounded-full px-3 py-1.5 text-[10px] font-black uppercase tracking-widest',
                      update.isUrgent ? 'bg-red-100 text-red-700 border border-red-200' : 'bg-white/80 text-slate-500 border border-white/70'
                    )}>
                      {update.isUrgent ? 'Dringend' : update.category}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-black uppercase tracking-widest text-slate-400">
                      <CalendarDays size={13} />
                      {update.date}
                    </span>
                  </div>
                  <h4 className="mt-3 text-lg font-black tracking-tight text-slate-900">{update.title}</h4>
                  <p className="mt-2 whitespace-pre-wrap text-sm font-medium leading-7 text-slate-600">
                    {update.content}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleEdit(update)}
                    className="glass-button inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-600 transition-all hover:text-oker-600"
                  >
                    <Pencil size={14} />
                    Bewerk
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(update.id)}
                    disabled={deletingId === update.id}
                    className={cn(
                      'inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-widest transition-all',
                      deletingId === update.id
                        ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                        : 'glass-button text-red-500 hover:text-red-600'
                    )}
                  >
                    <Trash2 size={14} />
                    {deletingId === update.id ? 'Verwijderen...' : 'Verwijder'}
                  </button>
                </div>
              </div>
            </div>
          )) : (
            <div className="rounded-[24px] border border-white/70 bg-white/45 p-6 text-sm font-medium text-slate-500">
              Er zijn nog geen updates gepubliceerd.
            </div>
          )}
        </div>
      </div>
    </PageShell>
  );
}
