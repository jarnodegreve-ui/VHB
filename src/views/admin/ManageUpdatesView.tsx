import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bell, ChevronDown, Eye, History, Pencil, Trash2 } from 'lucide-react';
import type { Update } from '../../types';
import { notify } from '../../lib/ui';
import { formatUpdateDate } from '../../lib/format';
import { fetchUpdateReadCounts } from '../../lib/updateReads';
import { ConfirmationModal, EmptyState, PageHeader, PageShell } from '../../components/ui';
import { Badge, Button, IconButton } from '../../components/primitives';
import { Card, CardHeader } from '../../components/Card';
import { Field, Input, Textarea } from '../../components/Field';
import { EntityHistoryModal } from '../../components/EntityHistoryModal';

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
      {/* Wrapper-div voor de scroll-ref: Card geeft (nog) geen ref door. */}
      <div ref={formRef} className="scroll-mt-4">
      <Card>
        <CardHeader
          icon={<Bell size={16} />}
          title={editingId ? 'Update bewerken' : 'Nieuwe update publiceren'}
        />
        <form onSubmit={handlePublish} className="mt-6 space-y-6">
          <Field label="Titel" htmlFor="update-titel">
            <Input id="update-titel" type="text" placeholder="Onderwerp van de update" value={updateForm.title} onChange={(e) => setUpdateForm({ ...updateForm, title: e.target.value })} />
          </Field>

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

          <Field label="Inhoud van het bericht" htmlFor="update-inhoud">
            <Textarea
              id="update-inhoud"
              rows={7}
              className="min-h-[180px]"
              placeholder="Schrijf hier het bericht voor de chauffeurs…"
              value={updateForm.content}
              onChange={(e) => setUpdateForm({ ...updateForm, content: e.target.value })}
            />
          </Field>

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
      </Card>
      </div>

      <Card>
        <CardHeader
          title="Bestaande updates"
          description="Beheer gepubliceerde berichten en verwijder updates die niet meer zichtbaar mogen zijn."
          aside={<Badge tone="slate" className="shrink-0 tabular-nums">{updates.length} zichtbaar</Badge>}
        />

        <div className="mt-5 max-h-[480px] overflow-y-auto overscroll-contain space-y-2 -mx-1 px-1">
          {updates.length > 0 ? updates.map((update) => {
            const open = expandedIds.includes(update.id);
            return (
            <Card key={update.id} padding="none" className="rounded-2xl overflow-hidden">
              <div className="flex items-center justify-between gap-2 p-3 pl-4">
                {/* rauw: hele uitklaprij is de knop (titel + badge + datum + chevron) */}
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
                  <IconButton label="Wijzigingsgeschiedenis" variant="ghost" onClick={() => setHistoryUpdate(update)}><History size={14} /></IconButton>
                  <IconButton label="Bewerk" variant="ghost" onClick={() => handleEdit(update)}><Pencil size={14} /></IconButton>
                  <IconButton label="Verwijder" variant="danger" disabled={deletingId === update.id} onClick={() => setConfirmDeleteId(update.id)}><Trash2 size={14} /></IconButton>
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
            </Card>
            );
          }) : (
            <EmptyState
              title="Nog geen updates"
              message="Publiceer hierboven je eerste nieuwsbericht of veiligheidsmelding — chauffeurs zien het meteen op hun dashboard."
            />
          )}
        </div>
      </Card>

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
