import { useEffect, useState } from 'react';
import { AanwezigOpScherm } from '../../components/AanwezigOpScherm';
import { Bell, ChevronRight, History, Plus, Trash2 } from 'lucide-react';
import type { Update } from '../../types';
import { cn, notify } from '../../lib/ui';
import { formatUpdateDate } from '../../lib/format';
import { fetchUpdateReadCounts } from '../../lib/updateReads';
import { EmptyState, PageHeader, PageShell } from '../../components/ui';
import { Badge, Button, Switch } from '../../components/primitives';
import { Card, CardHeader } from '../../components/Card';
import { Field, Input, Textarea } from '../../components/Field';
import { useVeldfouten, useVuil } from '../../lib/formulier';
import { meldSchrijffout } from '../../lib/fouten';
import { Formulier } from '../../components/Formulier';
import { SluitKnop } from '../../components/Modal';
import { updateSchema } from '../../../shared/schemas/update';
import { InfoTip } from '../../components/InfoTip';
import { EntityHistoryModal } from '../../components/EntityHistoryModal';
import { DetailPaneel, MasterDetail, useStandaardKeuze } from '../../components/DetailPaneel';
import { UpdateBijlagen } from '../../components/UpdateBijlagen';
import { ActieMenu } from '../../components/ActieMenu';
import { LijstAnimatie, LijstRij } from '../../components/LijstRij';
import { useRecordParam } from '../../app/router';

const FORM_ID = 'update-form';

export function ManageUpdatesView({
  updates,
  onSave,
  onSaveUpdate,
  onCreateUpdate,
  onDeleteUpdate,
  onSendUrgentEmail,
  canSendUrgentEmail,
  onHerlaad,
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
  /** Updates opnieuw ophalen na een bijlage-actie (die schrijft server-side). */
  onHerlaad: () => void;
}) {
  const emptyUpdateForm = { title: '', category: 'algemeen', content: '', isUrgent: false, bijlagenTonen: false };
  const [updateForm, setUpdateForm] = useState(emptyUpdateForm);
  const [isPublishing, setIsPublishing] = useState(false);
  // Veldfouten: gedeeld schema vóór submit + server-veldfouten van een 400.
  const veld = useVeldfouten();
  const fouten = veld.fouten;
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // Het bewerkformulier leeft in het DetailPaneel: desktop naast de lijst,
  // mobiel als SlideOver. "Nieuwe update" opent hetzelfde paneel leeg.
  const [paneelOpen, setPaneelOpen] = useState(false);
  // Elke (her)vulling van het formulier is een verse momentopname voor
  // useVuil, ook na een geslaagde save op desktop (zelfde editingId).
  const [vulling, setVulling] = useState(0);
  const { vuil } = useVuil(updateForm, paneelOpen, vulling);
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
        // Defensief: een onverwacht antwoord (bv. een lege lijst i.p.v. een
        // object) mag het hele scherm niet laten crashen op readCounts[id].
        const counts = data && typeof data === 'object' && !Array.isArray(data) && data.counts && typeof data.counts === 'object' ? data.counts : {};
        setReadCounts(counts);
        setTotalChauffeurs(Number(data?.totalChauffeurs) || 0);
      })
      .catch(() => {/* stil: geen teller tonen */});
    return () => { alive = false; };
  }, []);

  const handlePublish = async () => {
    if (isPublishing) return;
    setIsPublishing(true);
    try {
      await publiceer();
    } finally {
      setIsPublishing(false);
    }
  };

  const publiceer = async () => {
    const updateToSave: Update = {
      id: editingId || Date.now().toString(),
      date: editingId
        ? (updates.find((update) => update.id === editingId)?.date || new Date().toLocaleDateString('nl-BE'))
        : new Date().toLocaleDateString('nl-BE'),
      title: updateForm.title,
      category: updateForm.category as any,
      content: updateForm.content,
      isUrgent: updateForm.isUrgent,
      bijlagenTonen: updateForm.bijlagenTonen,
    };

    // Gedeeld contract (shared/schemas/update.ts): fouten bij het veld.
    if (!veld.controleer(updateSchema, updateToSave)) return;

    // Per record als App de savers doorgeeft; anders de hele lijst (terugval).
    const perRecord = editingId ? onSaveUpdate : onCreateUpdate;
    const success = perRecord
      ? await perRecord(updateToSave, veld.zet)
      : await onSave(
        editingId
          ? updates.map((update) => update.id === editingId ? updateToSave : update)
          : [updateToSave, ...updates]
      );
    if (success) {
      if (updateForm.isUrgent && canSendUrgentEmail) {
        await onSendUrgentEmail(updateToSave);
      }
      notify(editingId ? 'Update bijgewerkt.' : 'Update gepubliceerd.', 'success');
      if (inline) {
        // Desktop: het paneel blijft naast de lijst en toont de (nieuwe) update.
        handleEdit(updateToSave);
      } else {
        setUpdateForm(emptyUpdateForm);
        setEditingId(null);
        setPaneelOpen(false);
      }
    } else if (!perRecord) {
      // De per-record-saver meldt zelf wat er misging (409 → ververst).
      // Terugval via de hele lijst: geen PUT op een id, dus geen "Opnieuw proberen".
      meldSchrijffout('Opslaan');
    }
  };

  // De expliciet gekozen update staat in de URL (/beheer/updates/<id>):
  // deelbaar met een collega, en een refresh houdt het formulier open. De
  // desktop-voorselectie (useStandaardKeuze) schrijft níét, alleen een klik.
  const [recordParam, zetRecordParam] = useRecordParam(0, { view: 'beheer-updates' });

  const handleOpenAdd = () => {
    setEditingId(null);
    setUpdateForm(emptyUpdateForm);
    veld.wis();
    setVulling((n) => n + 1);
    setPaneelOpen(true);
    // Het lege formulier hoort bij geen record: anders zou een refetch de
    // URL-keuze hieronder opnieuw openen en het nieuwe formulier kapen.
    zetRecordParam(null);
  };

  const handleEdit = (update: Update) => {
    setEditingId(update.id);
    setUpdateForm({
      title: update.title,
      category: update.category ?? 'algemeen',
      content: update.content,
      isUrgent: Boolean(update.isUrgent),
      bijlagenTonen: Boolean(update.bijlagenTonen),
    });
    veld.wis();
    setVulling((n) => n + 1);
    setPaneelOpen(true);
  };

  const handleCancelEdit = () => {
    setPaneelOpen(false);
    setEditingId(null);
    setUpdateForm(emptyUpdateForm);
    veld.wis();
    zetRecordParam(null);
  };

  // Klik in de lijst: formulier openen én de keuze in de URL zetten.
  const kiesUpdate = (update: Update) => { handleEdit(update); zetRecordParam(update.id); };

  // Desktop: de nieuwste update staat standaard open in het paneel; na
  // verwijderen schuift de keuze door naar de buur, of sluit het paneel als
  // de lijst leeg is. Het lege "nieuw"-formulier (paneel open zonder
  // editingId) wordt niet gekaapt.
  const inline = useStandaardKeuze({
    items: updates,
    sleutelVan: (u) => u.id,
    gekozen: paneelOpen ? editingId : null,
    actief: !(paneelOpen && editingId === null),
    kies: handleEdit,
    wis: handleCancelEdit,
  });
  const bewerkte = editingId ? updates.find((u) => u.id === editingId) ?? null : null;

  // URL → paneel (deeplink, refresh, melding): alleen als de URL iets anders
  // zegt dan wat al open staat; een onbekend id doet niets (lijst zonder
  // selectie, desktop kiest dan gewoon het eerste item). Een refetch terwijl
  // dezelfde update open staat raakt het formulier niet aan. Bewust ná
  // useStandaardKeuze: beide effecten draaien in dezelfde commit en de
  // laatste schrijver wint, anders kaapte de desktop-voorselectie de link.
  useEffect(() => {
    if (!recordParam || (paneelOpen && editingId === recordParam)) return;
    const update = updates.find((u) => u.id === recordParam);
    if (update) handleEdit(update);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordParam, updates]);

  // Annuleren: desktop zet het formulier terug op het item (het paneel blijft
  // naast de lijst staan); mobiel sluit de SlideOver.
  const annuleer = () => {
    if (inline && bewerkte) handleEdit(bewerkte);
    else handleCancelEdit();
  };

  // Geen bevestigingsmodal meer: verwijderen gaat meteen en de datalaag
  // toont 6 s een toast met "Ongedaan maken" (idee 1 Jarno, 03-09). Alleen
  // de collectie-terugval (zonder onDeleteUpdate) meldt hier nog zelf.
  const handleDelete = async (id: string) => {
    setDeletingId(id);
    const success = onDeleteUpdate ? await onDeleteUpdate(id) : await onSave(updates.filter((update) => update.id !== id));
    if (success) {
      if (!onDeleteUpdate) notify('Update verwijderd.', 'success');
      // De URL mag niet op een verwijderd record blijven wijzen.
      if (recordParam === id) zetRecordParam(null);
      // Stond de update open, dan regelt useStandaardKeuze de rest: desktop
      // schuift door naar de buur, en zonder buur (of op mobiel) sluit het
      // paneel — het formulier mag niet op een verwijderd record blijven
      // staan. Komt de update terug via "Ongedaan maken", dan staat ze op
      // desktop meteen weer open.
    } else if (!onDeleteUpdate) {
      notify('Update kon niet worden verwijderd.', 'error');
    }
    setDeletingId(null);
  };

  const urgentCount = updates.filter((u) => u.isUrgent).length;

  // Stille chip (neutraal vlak, puntje groen zodra iedereen ze las) — de
  // vroegere eigen pil is één Badge geworden (afwerking 04-09, nr. 6).
  // Eerlijk label (golf 3, 15-09): de teller telt sinds dan alleen chauffeurs
  // die in het bericht zelf op "Gelezen en begrepen" tikten; vroeger telde
  // het openen van het Updates-scherm al mee, dus oudere cijfers zijn ruimer.
  const gelezenBadge = (update: Update) => {
    if (!update.isUrgent || totalChauffeurs === 0) return null;
    const gelezen = readCounts[update.id] ?? 0;
    return (
      <Badge tone={gelezen >= totalChauffeurs ? 'emerald' : 'slate'} stil className="tabular-nums" title="Aantal chauffeurs dat in dit bericht op “Gelezen en begrepen” tikte">
        {gelezen} van {totalChauffeurs} bevestigd
      </Badge>
    );
  };

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
        {updates.length > 0 ? <LijstAnimatie aantal={updates.length}>{updates.map((update) => {
          const isCurrent = paneelOpen && editingId === update.id;
          return (
            <LijstRij as="div" key={update.id}>
            <Card
              padding="none"
              interactive
              aria-current={isCurrent ? 'true' : undefined}
              className={cn('rounded-2xl overflow-hidden', isCurrent && 'bg-surface-muted ring-1 ring-hairline-strong')}
            >
              {/* rauw: hele rij is de knop (titel + badges + datum + chevron) — opent het bewerkpaneel */}
              <button
                type="button"
                onClick={() => kiesUpdate(update)}
                className="flex min-h-11 w-full items-center justify-between gap-3 p-3 pl-4 text-left"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 truncate text-sm font-semibold text-slate-800" data-vt-record={update.id}>{update.title}</span>
                    {update.isUrgent && <Badge tone="red" dot>Dringend</Badge>}
                    {gelezenBadge(update)}
                  </span>
                  <span className="mt-0.5 block text-xs font-medium text-slate-500 tabular-nums">{formatUpdateDate(update.date)}</span>
                </span>
                <ChevronRight size={16} className={cn('shrink-0', isCurrent ? 'text-oker-500' : 'text-slate-300')} />
              </button>
            </Card>
            </LijstRij>
          );
        })}</LijstAnimatie> : (
          <EmptyState
            title="Nog geen updates"
            message="Publiceer je eerste nieuwsbericht of veiligheidsmelding, chauffeurs zien het meteen op hun dashboard."
            action={<Button variant="secondary" icon={<Plus size={16} />} onClick={handleOpenAdd}>Nieuwe update</Button>}
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
      vuil={vuil}
      leegTekst="Kies een update om te bewerken, of maak een nieuwe."
      leegActie={<Button variant="secondary" size="sm" icon={<Plus size={16} />} onClick={handleOpenAdd}>Nieuwe update</Button>}
      chip={bewerkte ? (
        <>
          {bewerkte.isUrgent && <Badge tone="red" dot>Dringend</Badge>}
          {gelezenBadge(bewerkte)}
        </>
      ) : undefined}
      acties={bewerkte ? (
        <ActieMenu
          size="sm"
          label="Meer acties"
          items={[
            { label: 'Wijzigingsgeschiedenis', icon: <History size={16} />, onClick: () => setHistoryUpdate(bewerkte) },
            { label: 'Verwijderen', icon: <Trash2 size={16} />, gevaarlijk: true, scheiding: true, disabled: deletingId === bewerkte.id, onClick: () => { void handleDelete(bewerkte.id); } },
          ]}
        />
      ) : undefined}
      icon={(
        <span className={cn('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', updateForm.isUrgent ? 'bg-red-500/12 text-red-700' : 'bg-oker-500/15 text-oker-700')}>
          <Bell size={16} />
        </span>
      )}
      footer={(
        <div className="flex items-center gap-2">
          <SluitKnop onClose={annuleer} variant="secondary" size="lg" className="flex-1" disabled={isPublishing}>
            Annuleren
          </SluitKnop>
          <Button type="submit" form={FORM_ID} variant="primary" size="lg" className="flex-1" bezig={isPublishing} disabled={!updateForm.title || !updateForm.content}>
            {editingId ? 'Update bijwerken' : 'Update publiceren'}
          </Button>
        </div>
      )}
    >
      {/* De publiceer-knop staat in de footer (buiten het formulier) en
          koppelt via form={FORM_ID}. */}
      <Formulier id={FORM_ID} onVerstuur={handlePublish} className="space-y-5">
        <Field label="Titel" htmlFor="update-titel" error={fouten.title}>
          <Input id="update-titel" invalid={!!fouten.title} type="text" placeholder="Onderwerp van de update" value={updateForm.title} onChange={(e) => { setUpdateForm({ ...updateForm, title: e.target.value }); veld.wisVeld('title'); }} />
        </Field>

        <Field label="Inhoud" htmlFor="update-inhoud" error={fouten.content}>
          <Textarea
            id="update-inhoud"
            invalid={!!fouten.content}
            rows={7}
            className="min-h-[180px]"
            placeholder="Schrijf hier het bericht voor de chauffeurs…"
            value={updateForm.content}
            onChange={(e) => { setUpdateForm({ ...updateForm, content: e.target.value }); veld.wisVeld('content'); }}
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

        {/* PDF's hangen aan het opgeslagen record (de bucket-sleutel is het
            id), dus bij een nieuwe update staat hier eerst "publiceer eerst". */}
        <UpdateBijlagen
          update={editingId ? updates.find((u) => u.id === editingId) ?? null : null}
          tonen={updateForm.bijlagenTonen}
          onTonenChange={(v) => setUpdateForm({ ...updateForm, bijlagenTonen: v })}
          onGewijzigd={onHerlaad}
        />
      </Formulier>
    </DetailPaneel>
  );

  return (
    <PageShell>
      <PageHeader
        view="beheer-updates"
        title="Beheer updates"
        actions={(
          <>
            <AanwezigOpScherm />
            <Button variant="primary" icon={<Plus size={16} />} onClick={handleOpenAdd}>
              Nieuwe update
            </Button>
          </>
        )}
      />

      {/* Zonder updates (en zonder open "nieuw"-formulier) vult de lijstkaart
          met haar lege staat de volle breedte — geen leeg paneel ernaast. */}
      <MasterDetail lijst={lijst} paneel={updates.length === 0 && !paneelOpen ? undefined : paneel} />

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
