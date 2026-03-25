import React, { useState } from 'react';
import { AlertTriangle, Bell, CalendarDays, Trash2 } from 'lucide-react';
import type { Update } from '../../types';
import { cn, notify } from '../../lib/ui';

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
  const [newUpdate, setNewUpdate] = useState({ title: '', category: 'algemeen', content: '', isUrgent: false });
  const [isPublishing, setIsPublishing] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUpdate.title || !newUpdate.content) return;

    setIsPublishing(true);
    const updateToAdd: Update = {
      id: Date.now().toString(),
      date: new Date().toLocaleDateString('nl-BE'),
      title: newUpdate.title,
      category: newUpdate.category as any,
      content: newUpdate.content,
      isUrgent: newUpdate.isUrgent,
    };

    const success = await onSave([updateToAdd, ...updates]);
    if (success) {
      if (newUpdate.isUrgent && canSendUrgentEmail) {
        await onSendUrgentEmail(updateToAdd);
      }
      setNewUpdate({ title: '', category: 'algemeen', content: '', isUrgent: false });
      notify('Update succesvol gepubliceerd!', 'success');
    } else {
      notify('Update kon niet worden opgeslagen. Controleer de foutmelding hierboven en probeer opnieuw.', 'error');
    }
    setIsPublishing(false);
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
    <div className="space-y-6 md:space-y-8">
      <div className="max-w-3xl">
        <h3 className="text-2xl font-black tracking-tight">Beheer Updates</h3>
      </div>
      <div className="surface-card p-6 md:p-8 rounded-[32px]">
        <h3 className="text-lg font-black mb-8 flex items-center gap-3 tracking-tight">
          <Bell size={24} className="text-emerald-500" />
          Nieuwe Update Publiceren
        </h3>
        <form onSubmit={handlePublish} className="space-y-6">
          <Input label="Titel" type="text" placeholder="Onderwerp van de update" value={newUpdate.title} onChange={(e) => setNewUpdate({ ...newUpdate, title: e.target.value })} />
          <Input
            label="Categorie"
            type="select"
            options={[
              { label: 'Algemeen', value: 'algemeen' },
              { label: 'Veiligheid', value: 'veiligheid' },
              { label: 'Technisch', value: 'technisch' },
            ]}
            value={newUpdate.category}
            onChange={(e) => setNewUpdate({ ...newUpdate, category: e.target.value })}
          />

          <div className="rounded-2xl border border-red-100 bg-red-50 p-4">
            {canSendUrgentEmail ? (
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  id="isUrgent"
                  className="w-5 h-5 rounded border-red-300 text-red-600 focus:ring-red-500"
                  checked={newUpdate.isUrgent}
                  onChange={(e) => setNewUpdate({ ...newUpdate, isUrgent: e.target.checked })}
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
              value={newUpdate.content}
              onChange={(e) => setNewUpdate({ ...newUpdate, content: e.target.value })}
            />
          </div>

          <button
            type="submit"
            disabled={isPublishing}
            className={cn(
              'w-full mt-8 font-black px-8 py-4 rounded-2xl transition-all shadow-xl uppercase tracking-widest text-xs active:scale-95',
              isPublishing ? 'bg-slate-200 text-slate-400 cursor-not-allowed' : 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-emerald-500/20'
            )}
          >
            {isPublishing ? 'Publiceren...' : 'Update Publiceren'}
          </button>
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
          )) : (
            <div className="rounded-[24px] border border-white/70 bg-white/45 p-6 text-sm font-medium text-slate-500">
              Er zijn nog geen updates gepubliceerd.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
