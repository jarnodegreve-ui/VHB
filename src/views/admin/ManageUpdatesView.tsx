import React, { useEffect, useState } from 'react';
import { Bell, ChevronRight, Eye, History, Plus, Trash2 } from 'lucide-react';
import type { Update } from '../../types';
import { cn, notify } from '../../lib/ui';
import { formatUpdateDate } from '../../lib/format';
import { fetchUpdateReadCounts } from '../../lib/updateReads';
import { EmptyState, PageHeader, PageShell } from '../../components/ui';
import { Badge, Button, IconButton, Switch } from '../../components/primitives';
import { Card, CardHeader } from '../../components/Card';
import { Field, Input, Textarea } from '../../components/Field';
import { valideer } from '../../lib/valideer';
import { updateSchema } from '../../../shared/schemas/update';
import { InfoTip } from '../../components/InfoTip';
import { EntityHistoryModal } from '../../components/EntityHistoryModal';
import { DetailPaneel, MasterDetail } from '../../components/DetailPaneel';

const FORM_ID = 'update-form';

export function ManageUpdatesView({
  updates,
  onSave,
  onSaveUpdate,
  onCreateUpdate,
  onDeleteUpdate,
  onSendUrgentEmail,
  canSendUrgentEmail,
}: {
  updates: Update[];
  /** Collectie-saver (hele lijst) — alleen nog de terugval als de
   *  per-record-savers hieronder niet doorgegeven zijn. */
  onSave: (u: Update[]) => Promise<boolean>;
  /** Per record (PUT/POST one/DELETE, useAppData). Optioneel tot App ze doorgeeft. */
  onSaveUpdate?: (u: Update, opVeldfouten?: (fouten: Record<string, string>) => void) => Promise<boolean>;
  onCreateUpdate?: (u: Update, opVeldfouten?: (fouten: Record<string, string>) => void) => Promise<boolean>;
  onDeleteUpdate?: (id: string) => Promise<boolean>;
  onSendUrgentEmail: (u: Update) => Promise<void>;
  canSendUrgentEmail: boolean;
}) {
  const emptyUpdateForm = { title: '', category: 'algemeen', content: '', isUrgent: false };
  const [updateForm, setUpdateForm] = useState(emptyUpdateForm);
  const [isPublishing, setIsPublishing] = useState(false);
  // Veldfouten: gedeeld schema vóór submit + server-veldfouten van een 400.
  const [fouten, setFouten] = useState<Record<string, string>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Het bewerkformulier leeft in het DetailPaneel: desktop naast de lijst,
  // mobiel als SlideOver. "Nieuwe update" opent hetzelfde paneel leeg.
  const [paneelOpen, setPaneelOpen] = useState(false);
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

    // Gedeeld contract (shared/schemas/update.ts): fouten bij het veld.
    const check = valideer(updateSchema, updateToSave);
    if (check.ok === false) {
      setFouten(check.fouten);
      setIsPublishing(false);
      return;
    }
    setFouten({});

    // Per record als App de savers doorgeeft; anders de hele lijst (terugval).
    const perRecord = editingId ? onSaveUpdate : onCreateUpdate;
    const success = perRecord
      ? await perRecord(updateToSave, setFouten)
      : await onSave(
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
      setPaneelOpen(false);
      notify(editingId ? 'Update bijgewerkt.' : 'Update gepubliceerd.', 'success');
    } else if (!perRecord) {
      // De per-record-saver meldt zelf wat er misging (409 → ververst).
      notify('Update kon niet worden opgeslagen. Controleer de foutmelding hierboven en probeer opnieuw.', 'error');
    }
    setIsPublishing(false);
  };

  const handleOpenAdd = () => {
    setEditingId(null);
    setUpdateForm(emptyUpdateForm);
    setFouten({});
    setPaneelOpen(true);
  };

  const handleEdit = (update: Update) => {
    setEditingId(update.id);
    setUpdateForm({
      title: update.title,
      category: update.category,
      content: update.content,
      isUrgent: Boolean(update.isUrgent),
    });
    setFouten({});
    setPaneelOpen(true);
  };

  const handleCancelEdit = () => {
    setPaneelOpen(false);
    setEditingId(null);
    setUpdateForm(emptyUpdateForm);
    setFouten({});
  };

  // Geen bevestigingsmodal meer: verwijderen gaat meteen en de datalaag
  // toont 6 s een toast met "Ongedaan maken" (idee 1 Jarno, 03-09). Alleen
  // de collectie-terugval (zonder onDeleteUpdate) meldt hier nog zelf.
  const handleDelete = async (id: string) => {
    setDeletingId(id);
    const success = onDeleteUpdate ? await onDeleteUpdate(id) : await onSave(updates.filter((update) => update.id !== id));
    if (success) {
      if (!onDeleteUpdate) notify('Update verwijderd.', 'success');
      if (id === editingId) handleCancelEdit();
    } else if (!onDeleteUpdate) {
      notify('Update kon niet worden verwijderd.', 'error');
    }
    setDeletingId(null);
  };

  const urgentCount = updates.filter((u) => u.isUrgent).length;
  const bewerkte = editingId ? updates.find((u) => u.id === editingId) ?? null : null;

  const gelezenBadge = (update: Update) => (
    update.isUrgent && totalChauffeurs > 0 ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-2xs font-semibold text-slate-500 tabular-nums" title="Aantal chauffeurs dat deze update geopend heeft">
        <Eye size={12} />
        {readCounts[update.id] ?? 0}/{totalChauffeurs} gelezen
      </span>
    ) : null
  );

  const lijst = (
    <Card>
      <CardHeader
        title="Gepubliceerde updates"
        aside={(
          <>
            {urgentCount > 0 ? <Badge tone="red" className="tabular-nums">{urgentCount} dringend</Badge> : null}
            <Badge tone="slate" className="shrink-0 tabular-nums">{updates.length} updates</Badge>
          </>
        )}
      />

      <div className="mt-5 max-h-[480px] overflow-y-auto overscroll-contain space-y-2 -mx-1 px-1">
        {updates.length > 0 ? updates.map((update) => {
          const isCurrent = paneelOpen && editingId === update.id;
          return (
            <Card
              key={update.id}
              padding="none"
              interactive
              aria-current={isCurrent ? 'true' : undefined}
              className={cn('rounded-2xl overflow-hidden', isCurrent && 'ring-1 ring-oker-400 bg-oker-50/40')}
            >
              {/* rauw: hele rij is de knop (titel + badges + datum + chevron) — opent het bewerkpaneel */}
              <button
                type="button"
                onClick={() => handleEdit(update)}
                className="flex min-h-11 w-full items-center justify-between gap-3 p-3 pl-4 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 truncate text-sm font-semibold text-slate-800">{update.title}</span>
                    {update.isUrgent && <Badge tone="red" dot>Dringend</Badge>}
                    {gelezenBadge(update)}
                  </span>
                  <span className="mt-0.5 block text-2xs font-medium text-slate-500 tabular-nums">{formatUpdateDate(update.date)}</span>
                </span>
                <ChevronRight size={16} className={cn('shrink-0', isCurrent ? 'text-oker-500' : 'text-slate-300')} />
              </button>
            </Card>
          );
        }) : (
          <EmptyState
            title="Nog geen updates"
            message="Publiceer je eerste nieuwsbericht of veiligheidsmelding — chauffeurs zien het meteen op hun dashboard."
            action={<Button variant="primary" icon={<Plus size={16} />} onClick={handleOpenAdd}>Nieuwe update</Button>}
          />
        )}
      </div>
    </Card>
  );

  const paneel = (
    <DetailPaneel
      open={paneelOpen}
      onClose={handleCancelEdit}
      title={editingId ? 'Update bewerken' : 'Nieuwe update'}
      subtitle={bewerkte ? `Gepubliceerd ${formatUpdateDate(bewerkte.date)}` : 'Chauffeurs zien de update meteen op hun dashboard.'}
      sleutel={editingId ?? 'nieuw'}
      leegTekst="Kies een update om te bewerken, of maak een nieuwe."
      leegActie={<Button variant="primary" icon={<Plus size={16} />} onClick={handleOpenAdd}>Nieuwe update</Button>}
      icon={(
        <span className={cn('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', updateForm.isUrgent ? 'bg-red-500/12 text-red-700' : 'bg-oker-500/15 text-oker-700')}>
          <Bell size={16} />
        </span>
      )}
      footer={(
        <div className="flex items-center gap-2">
          {bewerkte && (
            <>
              <IconButton label="Wijzigingsgeschiedenis" variant="ghost" onClick={() => setHistoryUpdate(bewerkte)}><History size={16} /></IconButton>
              <IconButton label="Verwijder" variant="danger" disabled={deletingId === bewerkte.id} onClick={() => { void handleDelete(bewerkte.id); }}><Trash2 size={16} /></IconButton>
            </>
          )}
          <Button variant="secondary" size="lg" className="flex-1" onClick={handleCancelEdit}>
            Annuleren
          </Button>
          <Button type="submit" form={FORM_ID} variant="primary" size="lg" className="flex-1" disabled={isPublishing || !updateForm.title || !updateForm.content}>
            {isPublishing ? (editingId ? 'Bijwerken…' : 'Publiceren…') : (editingId ? 'Update bijwerken' : 'Update publiceren')}
          </Button>
        </div>
      )}
    >
      {/* De publiceer-knop staat in de footer (buiten het formulier) en
          koppelt via form={FORM_ID}. */}
      <form id={FORM_ID} onSubmit={handlePublish} className="space-y-5">
        {bewerkte && gelezenBadge(bewerkte) ? <div>{gelezenBadge(bewerkte)}</div> : null}

        <Field label="Titel" htmlFor="update-titel" error={fouten.title}>
          <Input id="update-titel" invalid={!!fouten.title} type="text" placeholder="Onderwerp van de update" value={updateForm.title} onChange={(e) => setUpdateForm({ ...updateForm, title: e.target.value })} />
        </Field>

        <Field label="Inhoud" htmlFor="update-inhoud" error={fouten.content}>
          <Textarea
            id="update-inhoud"
            invalid={!!fouten.content}
            rows={7}
            className="min-h-[180px]"
            placeholder="Schrijf hier het bericht voor de chauffeurs…"
            value={updateForm.content}
            onChange={(e) => setUpdateForm({ ...updateForm, content: e.target.value })}
          />
        </Field>

        {/* Neutraal ingezonken vlak met één schakelaar — het vroegere rode
            paneel schreeuwde nog vóór er iets dringend was. */}
        <Card tone="muted" padding="sm" className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <p className="text-sm font-semibold text-slate-800">Dringend</p>
              <InfoTip label="Uitleg bij dringende updates">
                <p>Een dringende update krijgt een rode markering op het dashboard en verstuurt meteen een e-mail naar alle gebruikers; je ziet achteraf hoeveel chauffeurs ze geopend hebben.</p>
                {!canSendUrgentEmail ? <p className="mt-2">Dringend verzenden is voorbehouden aan admins; planners kunnen gewone updates publiceren.</p> : null}
              </InfoTip>
            </div>
            <p className="mt-0.5 text-xs text-slate-500">
              {canSendUrgentEmail ? 'Verstuurt meteen een e-mail naar alle gebruikers.' : 'Alleen een admin kan een update dringend versturen.'}
            </p>
          </div>
          {canSendUrgentEmail ? (
            <Switch label="Markeer als dringend" checked={updateForm.isUrgent} onChange={(v) => setUpdateForm({ ...updateForm, isUrgent: v })} />
          ) : (
            <Badge tone="slate">Alleen admin</Badge>
          )}
        </Card>
      </form>
    </DetailPaneel>
  );

  return (
    <PageShell>
      <PageHeader
        eyebrow="Communicatie"
        title="Beheer updates"
        description="Nieuws en dringende meldingen voor de chauffeurs."
        actions={(
          <Button variant="primary" icon={<Plus size={16} />} onClick={handleOpenAdd}>
            Nieuwe update
          </Button>
        )}
      />

      <MasterDetail lijst={lijst} paneel={paneel} />

      <EntityHistoryModal
        open={!!historyUpdate}
        onClose={() => setHistoryUpdate(null)}
        entityType="update"
        entityId={historyUpdate?.id ?? ''}
        title={historyUpdate?.title}
      />
    </PageShell>
  );
}
