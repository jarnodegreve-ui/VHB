import { useEffect, useMemo, useState } from 'react';
import { AanwezigOpScherm } from '../../components/AanwezigOpScherm';
import { Calendar, ChevronRight, FileText, History, Mail, MapPin, Plus, Trash2, X } from 'lucide-react';
import { LijnTegel } from '../../components/LijnTegel';
import { isAlleLijnen, lijnLabel, lijnenNaarTekst, lijnenVan } from '../../../shared/lijnen';
import type { Diversion } from '../../types';
import { cn } from '../../lib/ui';
import { EmptyState, PageHeader, PageShell } from '../../components/ui';
import { OmleidingBijlagen, uploadWachtrij } from '../../components/OmleidingBijlagen';
import { OmleidingMailPaneel } from './OmleidingMail';
import { Badge, Button, IconButton, TOON_NAAR_BADGE } from '../../components/primitives';
import { SluitKnop } from '../../components/Modal';
import { OMLEIDING_FASE } from '../../../shared/status';
import { Card } from '../../components/Card';
import { DateInput, Field, Input, Textarea } from '../../components/Field';
import { useVeldfouten, useVuil } from '../../lib/formulier';
import { Formulier } from '../../components/Formulier';
import { diversionSchema } from '../../../shared/schemas/diversion';
import { EntityHistoryModal } from '../../components/EntityHistoryModal';
import { DetailPaneel, MasterDetail, useDetailPoort, useStandaardKeuze } from '../../components/DetailPaneel';
import { ActieMenu } from '../../components/ActieMenu';
import { LijstAnimatie, LijstRij } from '../../components/LijstRij';
import { useRecordParam } from '../../app/router';

/** Verlopen = einddatum vóór vandaag; zonder einddatum blijft een omleiding
 *  actief tot hij verwijderd wordt. */
import { isExpiredDiversion as isExpired, omleidingsFase, omleidingsPeriode, pdfLabel, sorteerOmleidingen } from '../../lib/diversions';
// isoDate = lokale dag. toISOString() is UTC en gaf tussen 00:00 en 02:00
// Belgische zomertijd de dag ervóór: een omleiding die om 00:30 werd
// aangemaakt kreeg standaard gisteren als startdatum. Zelfde reden als de
// expliciete waarschuwing in ScheduleView.
import { isoDate } from '../../lib/availability';

const FORM_ID = 'omleiding-form';

export function ManageDiversionsView({ diversions, onSave, onSaveDiversion, onCreateDiversion, onDeleteDiversion, onHerlaad }: {
  diversions: Diversion[];
  /** Collectie-saver (hele lijst) — alleen nog de terugval als de
   *  per-record-savers hieronder niet doorgegeven zijn. */
  onSave: (d: Diversion[]) => void;
  /** Per record (PUT/POST one/DELETE, useAppData). Optioneel tot App ze doorgeeft. */
  onSaveDiversion?: (d: Diversion, opVeldfouten?: (fouten: Record<string, string>) => void) => Promise<boolean>;
  onCreateDiversion?: (d: Diversion, opVeldfouten?: (fouten: Record<string, string>) => void) => Promise<boolean>;
  onDeleteDiversion?: (id: string) => Promise<boolean>;
  /** Omleidingen opnieuw ophalen na een bijlage-actie (die schrijft server-side). */
  onHerlaad?: () => void;
}) {
  // Het bewerkformulier leeft in het DetailPaneel: desktop naast de lijst,
  // mobiel als SlideOver. "Nieuw" opent hetzelfde paneel leeg.
  const [paneelOpen, setPaneelOpen] = useState(false);
  // Zelfde chronologische volgorde als de chauffeurslijst: lopend, komend,
  // verlopen onderaan (sorteerOmleidingen).
  const sortedDiversions = useMemo(() => sorteerOmleidingen(diversions), [diversions]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [historyDiversion, setHistoryDiversion] = useState<Diversion | null>(null);
  // Mailknop (mailtranche PR 4): de omleiding met haar PDF's naar verzendlijsten en adressen.
  const [mailDiversion, setMailDiversion] = useState<Diversion | null>(null);

  const [formData, setFormData] = useState<Partial<Diversion>>({
    line: '',
    title: '',
    location: '',
    description: '',
    startDate: isoDate(new Date()),
  });
  // PDF's voor een nieuwe omleiding wachten tot het record bestaat
  // (OmleidingBijlagen); bij een bestaande gaan ze meteen naar de server.
  const [wachtrij, setWachtrij] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [bezig, setBezig] = useState(false);
  // Veldfouten: gedeeld schema vóór submit + server-veldfouten van een 400.
  const veld = useVeldfouten();
  const fouten = veld.fouten;
  // Elke keer dat het formulier (opnieuw) gevuld wordt, telt als vers: ook
  // na een geslaagde save op desktop, waar het paneel op hetzelfde record
  // blijft staan (zelfde editingId). Zo neemt useVuil een nieuwe momentopname.
  const [vulling, setVulling] = useState(0);
  const { vuil, markeerSchoon } = useVuil({ formData, pdf: wachtrij.map((f) => f.name).join('|') }, paneelOpen, vulling);
  // Desktop: rij kiezen, Nieuw, Annuleren en een recordwissel via de URL
  // vragen eerst bevestiging zolang het formulier vuil is.
  const poort = useDetailPoort(vuil);

  // De expliciet gekozen omleiding staat in de URL (/beheer/omleidingen/<id>):
  // deelbaar met een collega, en een refresh houdt het formulier open. De
  // desktop-voorselectie (useStandaardKeuze) schrijft níét, alleen een klik.
  const [recordParam, zetRecordParam] = useRecordParam(0, { view: 'beheer-omleidingen' });

  const handleOpenAdd = () => poort.via(openNieuw);
  // Annuleren sluit het paneel, ook op desktop (polish P2b, regel Jarno
  // 24-09); daarna kiest de voorselectie niet meteen weer het eerste item,
  // anders was sluiten op desktop onmogelijk. Elke nieuwe keuze heft dat op.
  const [handDicht, setHandDicht] = useState(false);
  const openNieuw = () => {
    setHandDicht(false);
    setEditingId(null);
    setFormData({
      line: '',
      title: '',
      location: '',
      description: '',
      startDate: isoDate(new Date()),
    });
    setWachtrij([]);
    veld.wis();
    setVulling((n) => n + 1);
    setPaneelOpen(true);
    // Het lege formulier hoort bij geen record: anders zou een refetch de
    // URL-keuze hieronder opnieuw openen en het nieuwe formulier kapen.
    zetRecordParam(null);
  };

  const handleOpenEdit = (div: Diversion) => {
    setHandDicht(false);
    setEditingId(div.id);
    setFormData({
      line: div.line,
      location: div.location ?? '',
      title: div.title,
      description: div.description,
      startDate: div.startDate,
      endDate: div.endDate,
    });
    setWachtrij([]);
    veld.wis();
    setVulling((n) => n + 1);
    setPaneelOpen(true);
  };

  const sluitPaneel = () => { setPaneelOpen(false); zetRecordParam(null); };

  // Klik in de lijst: formulier openen én de keuze in de URL zetten.
  const kiesOmleiding = (div: Diversion) => { poort.via(() => { handleOpenEdit(div); zetRecordParam(div.id); }); };

  // Desktop: de eerste omleiding staat standaard open in het paneel; na
  // verwijderen schuift de keuze door naar de buur, of sluit het paneel als
  // de lijst leeg is. Het lege "nieuw"-formulier (paneel open zonder
  // editingId) wordt niet gekaapt.
  // Chip-invoer voor de lijnen: `formData.line` blijft de canonieke tekst,
  // de chips zijn er de weergave van; `lijnDraft` is wat nog niet bevestigd is.
  const [lijnDraft, setLijnDraft] = useState('');
  const lijnen = lijnenVan(formData.line);
  const voegLijnToe = (tekst: string) => {
    const nieuw = lijnenNaarTekst([...lijnen, ...lijnenVan(tekst)]);
    setFormData((f) => ({ ...f, line: nieuw }));
    setLijnDraft('');
    // De sleutel weghalen, niet op undefined zetten: `fouten` is een
    // Record<string, string> en een lege waarde is geen fouttekst.
    veld.wisVeld('line');
  };
  const verwijderLijn = (l: string) => {
    setFormData((f) => ({ ...f, line: lijnenNaarTekst(lijnen.filter((x) => x !== l)) }));
  };

  const inline = useStandaardKeuze({
    items: sortedDiversions,
    sleutelVan: (d) => d.id,
    gekozen: paneelOpen ? editingId : null,
    actief: !(paneelOpen && editingId === null) && !handDicht,
    kies: handleOpenEdit,
    wis: sluitPaneel,
    vuil,
  });

  const bewerkte = editingId ? diversions.find((d) => d.id === editingId) ?? null : null;

  // URL → paneel (deeplink, refresh, melding): alleen als de URL iets anders
  // zegt dan wat al open staat; een onbekend id doet niets (lijst zonder
  // selectie, desktop kiest dan gewoon het eerste item). Een refetch terwijl
  // hetzelfde record open staat raakt het formulier niet aan. Bewust ná
  // useStandaardKeuze: beide effecten draaien in dezelfde commit en de
  // laatste schrijver wint, anders kaapte de desktop-voorselectie de link.
  useEffect(() => {
    if (!recordParam || (paneelOpen && editingId === recordParam)) return;
    const div = diversions.find((d) => d.id === recordParam);
    // Vuil formulier: eerst vragen; "Verder bewerken" zet de URL terug op
    // wat er open staat.
    if (div) poort.via(() => handleOpenEdit(div), () => zetRecordParam(paneelOpen ? editingId : null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordParam, diversions]);

  // Annuleren = het paneel sluiten, op elke breedte (polish P2b, regel Jarno
  // 24-09); met onbewaarde invoer vraagt de poort eerst (SluitKnop).
  const annuleer = () => {
    setHandDicht(true);
    sluitPaneel();
  };

  const handleSubmit = async () => {
    if (bezig || isUploading) return;
    setBezig(true);
    try {
      await verstuur();
    } finally {
      setBezig(false);
    }
  };

  const verstuur = async () => {
    // UUID i.p.v. Date.now() zodat de Storage-sleutel (<id>-<slot>.pdf) niet
    // te raden is voor wie het URL-patroon kent.
    const generateId = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `d-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const targetId = editingId || generateId();

    // Gedeeld contract (shared/schemas/diversion.ts): fouten bij het veld,
    // en geen PDF naar Storage voor een omleiding die afketst.
    const huidige = editingId ? diversions.find((d) => d.id === editingId) : undefined;
    if (!veld.controleer(diversionSchema, { ...huidige, ...formData, id: targetId })) return;

    if (editingId) {
      const bestaande = diversions.find((d) => d.id === editingId);
      // Bijlagen gaan niet mee: de server houdt wat er in Storage hangt.
      const bijgewerkt = { ...bestaande, ...formData, location: formData.location?.trim() || undefined, id: editingId } as Diversion;
      if (onSaveDiversion) {
        // Per record: het paneel blijft open als het misging (409 → de lijst
        // is ververst; de gebruiker ziet de nieuwe staat en kan opnieuw).
        if (!(await onSaveDiversion(bijgewerkt, veld.zet))) return;
      } else {
        onSave(diversions.map((d) => (d.id === editingId ? bijgewerkt : d)));
      }
      // Desktop blijft op het opgeslagen item staan (vers formulier).
      if (inline) return handleOpenEdit(bijgewerkt);
    } else {
      const diversionToAdd: Diversion = {
        id: targetId,
        line: formData.line || 'Alle',
        location: formData.location?.trim() || undefined,
        title: formData.title || '',
        description: formData.description || '',
        startDate: formData.startDate || '',
        endDate: formData.endDate,
      };
      if (onCreateDiversion) {
        if (!(await onCreateDiversion(diversionToAdd, veld.zet))) return;
      } else {
        onSave([...diversions, diversionToAdd]);
      }
      // De omleiding staat er; nu pas de wachtende PDF's, naar de slots 1, 2, …
      // Een mislukte upload meldt zichzelf; de omleiding blijft staan en de
      // planner kan de PDF in het bewerkpaneel opnieuw proberen.
      if (wachtrij.length > 0) {
        setIsUploading(true);
        try {
          if ((await uploadWachtrij(targetId, wachtrij)) > 0) onHerlaad?.();
        } finally {
          setIsUploading(false);
          setWachtrij([]);
        }
      }
      // Desktop opent meteen de nieuwe omleiding in het paneel.
      if (inline) return handleOpenEdit(diversionToAdd);
    }

    sluitPaneel();
  };

  // Geen bevestigingsmodal: meteen verwijderen, de datalaag toont 6 s een
  // toast met "Ongedaan maken" (idee 1 Jarno, 03-09).
  const handleDelete = async (id: string) => {
    // Wie de open omleiding verwijdert, gooit de invoer bewust weg: anders
    // hield de dirty-bewaking de keuze op het verwijderde record vast.
    if (paneelOpen && editingId === id) markeerSchoon();
    if (onDeleteDiversion) {
      if (!(await onDeleteDiversion(id))) return;
    } else {
      onSave(diversions.filter((d) => d.id !== id));
    }
    // De URL mag niet op een verwijderd record blijven wijzen.
    if (recordParam === id) zetRecordParam(null);
    // Stond het item open, dan regelt useStandaardKeuze de rest: desktop
    // schuift door naar de buur, en zonder buur (of op mobiel) sluit het
    // paneel — het formulier mag niet op een verwijderd record blijven
    // staan. Komt het item terug via "Ongedaan maken", dan staat het op
    // desktop meteen weer open.
  };

  const lijst = sortedDiversions.length > 0 ? (
    <ul className="space-y-2" aria-label="Omleidingen">
      {/* Verwijderen is optimistisch met undo-toast: de rij klapt dicht en komt
          na "Ongedaan maken" op zijn eigen plek terug (LijstRij, key = id). */}
      <LijstAnimatie aantal={sortedDiversions.length}>
      {sortedDiversions.map(div => {
        const expired = isExpired(div);
        const isCurrent = paneelOpen && editingId === div.id;
        return (
          <LijstRij key={div.id}>
          <Card
            padding="none"
            interactive
            aria-current={isCurrent ? 'true' : undefined}
            className={cn('overflow-hidden', isCurrent && 'bg-surface-muted ring-1 ring-hairline-strong')}
          >
            {/* rauw: lijstrij van het master-detail (kaart als knop: icoontegel + titel + badges + periode + chevron) — opent het bewerkpaneel */}
            <button
              type="button"
              onClick={() => kiesOmleiding(div)}
              className="flex w-full items-center justify-between gap-3 px-3.5 py-3 text-left transition-colors hover:bg-surface-soft-hover md:px-4"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="min-w-0 space-y-2">
                  <LijnTegel line={div.line} size="sm" layout="rij" tone={expired ? 'muted' : 'accent'} />
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {/* data-vt-record: DetailPaneel leest er de richting van een wissel uit. */}
                    <h3 className="text-row-title" data-vt-record={div.id}>{div.location && <span className="text-oker-800">{div.location} · </span>}{div.title}</h3>
                    {expired && <Badge tone="slate">Verlopen</Badge>}
                    {(div.bijlagen?.length ?? 0) > 0 && <Badge tone="slate" icon={<FileText size={12} />}>{pdfLabel(div.bijlagen!.length)}</Badge>}
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs font-medium text-slate-500 tabular-nums">
                    <Calendar size={12} className="text-slate-400" />
                    {omleidingsPeriode(div)}{!div.endDate && ', geen einddatum'}
                  </div>
                </div>
              </div>
              <ChevronRight size={20} className={cn('shrink-0', isCurrent ? 'text-slate-700' : 'text-slate-300')} />
            </button>
          </Card>
          </LijstRij>
        );
      })}
      </LijstAnimatie>
    </ul>
  ) : (
    <EmptyState
      icon={<MapPin size={24} />}
      title="Nog geen omleidingen"
      message="Chauffeurs zien een omleiding meteen op hun dashboard en onder Omleidingen."
      action={<Button variant="secondary" icon={<Plus size={16} />} onClick={handleOpenAdd}>Nieuwe omleiding</Button>}
    />
  );

  const paneel = (
    <DetailPaneel
      open={paneelOpen}
      onClose={sluitPaneel}
      title={editingId ? 'Omleiding bewerken' : 'Nieuwe omleiding'}
      subtitle={bewerkte ? `${bewerkte.title}, ${lijnLabel(bewerkte.line).toLowerCase()}` : 'Vul de details in en voeg eventueel een PDF toe.'}
      sleutel={editingId ?? 'nieuw'}
      vuil={vuil}
      poort={poort}
      leegTekst="Kies een omleiding om te bewerken, of maak een nieuwe."
      leegActie={<Button variant="secondary" size="sm" icon={<Plus size={16} />} onClick={handleOpenAdd}>Nieuwe omleiding</Button>}
      chip={bewerkte ? <FaseChip fase={omleidingsFase(bewerkte)} /> : undefined}
      acties={bewerkte ? (
        <ActieMenu
          size="sm"
          label="Meer acties"
          items={[
            { label: 'Mailen…', icon: <Mail size={16} />, onClick: () => setMailDiversion(bewerkte) },
            { label: 'Wijzigingsgeschiedenis', icon: <History size={16} />, onClick: () => setHistoryDiversion(bewerkte) },
            { label: 'Verwijderen', icon: <Trash2 size={16} />, gevaarlijk: true, scheiding: true, onClick: () => { void handleDelete(bewerkte.id); } },
          ]}
        />
      ) : undefined}
      footer={(
        <div className="flex items-center gap-2">
          <SluitKnop onClose={annuleer} variant="secondary" size="lg" className="flex-1" disabled={bezig}>
            Annuleren
          </SluitKnop>
          <Button type="submit" form={FORM_ID} variant="primary" size="lg" className="flex-1" bezig={bezig}>
            {isUploading ? 'PDF uploaden…' : editingId ? 'Opslaan' : 'Toevoegen'}
          </Button>
        </div>
      )}
    >
      {/* De opslaan-knop staat in de footer (buiten het formulier) en koppelt
          via form={FORM_ID}; Enter in een veld dient dus ook gewoon in. */}
      <Formulier id={FORM_ID} onVerstuur={handleSubmit} className="space-y-5">
        {/* Lijnen als chips: één per keer toevoegen met Enter of een komma,
            verwijderen met het kruisje. Opgeslagen als "883, 884" (zie
            shared/lijnen.ts), dus bestaande omleidingen blijven werken.
            Leeg = alle lijnen (zoals voorheen). */}
        <Field label="Lijn(en)" htmlFor="omleiding-lijn" error={fouten.line} hint={lijnen.length === 0 ? 'Leeg laten betekent: geldt voor alle lijnen.' : undefined}>
          <div className={cn('flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border bg-surface-white px-2 py-1.5 focus-within:focus-ring', fouten.line ? 'border-red-400' : 'border-hairline')}>
            {lijnen.map((l) => (
              <span key={l} className="inline-flex items-center gap-0.5">
                {isAlleLijnen(l) ? <Badge tone="slate">Alle lijnen</Badge> : <LijnTegel line={l} size="sm" />}
                <IconButton label={`Lijn ${l} verwijderen`} size="sm" variant="ghost" onClick={() => verwijderLijn(l)}>
                  <X size={12} />
                </IconButton>
              </span>
            ))}
            {/* rauw: kaal invoerveld binnen de chip-rand (de rand zit op de wrapper, anders een dubbele kader) */}
            <input
              id="omleiding-lijn"
              type="text"
              inputMode="numeric"
              autoComplete="off"
              enterKeyHint="done"
              value={lijnDraft}
              onChange={(e) => {
                // Een komma typen sluit de lijn meteen af.
                if (/[,;]/.test(e.target.value)) voegLijnToe(e.target.value);
                else setLijnDraft(e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Tab') {
                  if (lijnDraft.trim()) { e.preventDefault(); voegLijnToe(lijnDraft); }
                } else if (e.key === 'Backspace' && !lijnDraft && lijnen.length > 0) {
                  verwijderLijn(lijnen[lijnen.length - 1]);
                }
              }}
              onBlur={() => { if (lijnDraft.trim()) voegLijnToe(lijnDraft); }}
              placeholder={lijnen.length === 0 ? 'bv. 883, dan Enter' : 'nog een lijn…'}
              className="focus-stil min-w-[7rem] flex-1 bg-transparent px-1.5 py-1 text-base text-slate-900 placeholder:text-slate-400 sm:text-sm"
            />
          </div>
        </Field>

        <Field label="Plaats" hint="Gemeente of plek, bv. Eeklo of Zottegem Markt. Staat vet vóór de titel in de chauffeurslijst." htmlFor="omleiding-plaats" error={fouten.location}>
          <Input
            id="omleiding-plaats"
            invalid={!!fouten.location}
            type="text"
            maxLength={80}
            value={formData.location ?? ''}
            onChange={(e) => { setFormData({...formData, location: e.target.value}); veld.wisVeld('location'); }}
            placeholder="bv. Eeklo"
          />
        </Field>

        <Field label="Titel" htmlFor="omleiding-titel" error={fouten.title}>
          <Input
            id="omleiding-titel"
            invalid={!!fouten.title}
            type="text"
            required
            value={formData.title}
            onChange={(e) => { setFormData({...formData, title: e.target.value}); veld.wisVeld('title'); }}
            placeholder="bv. Wegwerkzaamheden N70"
          />
        </Field>

        <Field label="Omschrijving" htmlFor="omleiding-omschrijving" error={fouten.description}>
          <Textarea
            id="omleiding-omschrijving"
            invalid={!!fouten.description}
            required
            rows={3}
            value={formData.description}
            onChange={(e) => { setFormData({...formData, description: e.target.value}); veld.wisVeld('description'); }}
            placeholder="Beschrijf de omleiding…"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Startdatum" htmlFor="omleiding-start" error={fouten.startDate}>
            <DateInput
              invalid={Boolean(fouten.startDate)}
              id="omleiding-start"
              required
              value={formData.startDate ?? ''}
              max={formData.endDate || undefined}
              onChange={(v) => { setFormData({...formData, startDate: v}); veld.wisVeld('startDate'); }}
            />
          </Field>
          <Field label="Einddatum" hint="Leeg = tot hij verwijderd wordt." htmlFor="omleiding-eind" error={fouten.endDate}>
            <DateInput
              invalid={Boolean(fouten.endDate)}
              id="omleiding-eind"
              value={formData.endDate || ''}
              min={formData.startDate || undefined}
              onChange={(v) => { setFormData({...formData, endDate: v}); veld.wisVeld('endDate'); }}
            />
          </Field>
        </div>

        <OmleidingBijlagen
          diversion={bewerkte}
          wachtrij={wachtrij}
          onWachtrij={setWachtrij}
          onGewijzigd={() => onHerlaad?.()}
        />
      </Formulier>
    </DetailPaneel>
  );

  return (
    <PageShell>
      {/* De enige primaire actie staat in de paginakop; ze opent hetzelfde
          paneel als een rij, maar leeg. */}
      <PageHeader
        view="beheer-omleidingen"
        title="Beheer omleidingen"
        actions={(
          <>
            <AanwezigOpScherm />
            <Button variant="primary" icon={<Plus size={16} />} onClick={handleOpenAdd}>
              Nieuwe omleiding
            </Button>
          </>
        )}
      />

      {/* Zonder omleidingen (en zonder open "nieuw"-formulier) vult de lege
          staat van de lijst de volle breedte — geen leeg paneel ernaast. */}
      <MasterDetail lijst={lijst} paneel={sortedDiversions.length === 0 && !paneelOpen ? undefined : paneel} />

      <OmleidingMailPaneel diversion={mailDiversion} onClose={() => setMailDiversion(null)} />

      <EntityHistoryModal
        open={!!historyDiversion}
        onClose={() => setHistoryDiversion(null)}
        entityType="diversion"
        entityId={historyDiversion?.id ?? ''}
        title={historyDiversion ? `${historyDiversion.title}, ${lijnLabel(historyDiversion.line).toLowerCase()}` : undefined}
      />

    </PageShell>
  );
}

/** Fase-chip in het paneel, uit OMLEIDING_FASE. Verlopen is een volle
 *  (grijze) chip, lopend en komend een stille. */
function FaseChip({ fase }: { fase: keyof typeof OMLEIDING_FASE }) {
  const f = OMLEIDING_FASE[fase];
  return <Badge tone={TOON_NAAR_BADGE[f.toon]} stil={fase !== 'verlopen'}>{f.label}</Badge>;
}
