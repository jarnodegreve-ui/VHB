import { useEffect, useMemo, useState } from 'react';
import { useOptioneleAppData } from '../../app/AppDataContext';
import { AlertTriangle, CalendarDays, Mail, Plus, Thermometer, ChevronDown } from 'lucide-react';
import type { LeaveRequest, Shift, User } from '../../types';
import { isoDate } from '../../lib/availability';
import { cn, notify } from '../../lib/ui';
import { navigeer } from '../../app/router';
import { adminMailto, maandplanningParams, ziekmeldMailTekst } from '../../lib/uitweg';
import { kandidaatLabel, nietBeschikbaarUitMatrix, rangschikKandidaten, vrijOpDatum, werkdagenUitShifts } from '../../lib/vervangers';
import { daysBetween } from '../../lib/leaveBalance';
import { formatDatumDMJ, formatDayLong, formatShortDay, serviceNumberOf } from '../../lib/format';
import { ConfirmationModal, EmptyState, ModalHeader, PageHeader, PageShell } from '../../components/ui';
import { apiFetch } from '../../lib/api';
import { bulkUitvoeren, meldBulkResultaat } from '../../lib/bulk';
import { adviesSleutel, haalBatchAdvies, vulVervangersVoor, type BatchAdvies } from '../../lib/herverdeel';
import { Button, MicroLabel, microLabelClass } from '../../components/primitives';
import { Uitklap, uitklapChevron } from '../../components/Uitklap';
import { Card } from '../../components/Card';
import { OpsStat } from '../../components/ops';
import { DateInput, Field, Select, Textarea } from '../../components/Field';
import { Formulier } from '../../components/Formulier';
import { Modal } from '../../components/Modal';
import { useVuil } from '../../lib/formulier';
import { ZiekteInzicht } from '../../components/ZiekteInzicht';
import { ZiekteMeldingen } from '../../components/ZiekteMeldingen';
import { openZiekteDiensten } from '../../lib/ziekteInzicht';
import { ZiekteReeksRij, ziekteReeksSleutel, type ZiekteReeks } from '../../components/planningSignalen';

/**
 * Ziekte — eigen blad, bewust gescheiden van het verlofbeheer (keuze Jarno
 * 15-08: "dit moet gescheiden blijven van elkaar"). Verlof is gepland en
 * doorloopt een aanvraag/goedkeuring; ziekte is onvoorzien en al geregistreerd
 * op het moment dat je het hier ziet. Eén scherm voor: wie is er nú ziek, wat
 * staat er nog op hun naam, melding registreren, einddatum bijstellen
 * (hersteld / langer ziek) en een foutieve melding intrekken.
 *
 * De data blijft in de bestaande leave-tabel (type 'ziekte') — alleen de
 * plek in de app is gescheiden, niet de opslag.
 */
export function ZiekteView({
  user,
  users,
  leaveRequests,
  shifts,
  onSickReport,
  onSave,
  onShiftSwapped,
}: {
  user: User;
  users: User[];
  leaveRequests: LeaveRequest[];
  shifts: Shift[];
  onSickReport: (payload: { userId: string; startDate?: string; endDate?: string; comment?: string }) => Promise<boolean>;
  onSave: (requests: LeaveRequest[]) => Promise<boolean> | boolean;
  /** Ververst planning + ruilen na een dienstwissel vanuit dit blad. */
  onShiftSwapped?: () => Promise<void> | void;
}) {
  // Matrixrijen voor de vervangerlijst: wie in de Excel op ZIEK/OPL/... staat
  // telt niet als vrij (props blijven zoals ze waren, dit is extra context).
  const planningMatrixRows = useOptioneleAppData()?.planningMatrixRows ?? [];
  // De matrix laadt ná de poort (useAppData); zonder context (tests) = klaar.
  const planningMatrixGeladen = useOptioneleAppData()?.planningMatrixGeladen ?? true;
  const today = isoDate(new Date());
  const naamVan = (id: string) => users.find((u) => String(u.id) === String(id))?.name ?? 'Onbekend';
  const isAdmin = user.role === 'admin';

  const ziektes = useMemo(
    () => leaveRequests.filter((r) => r.type === 'ziekte'),
    [leaveRequests],
  );
  const nuZiek = ziektes
    .filter((r) => r.status === 'approved' && r.startDate <= today && r.endDate >= today)
    .sort((a, b) => a.endDate.localeCompare(b.endDate));
  const historiek = ziektes
    .filter((r) => (r.status === 'approved' && r.endDate < today) || r.status === 'cancelled')
    .sort((a, b) => b.startDate.localeCompare(a.startDate));

  const actueleMeldingen = ziektes.filter((r) => r.status === 'approved' && r.endDate >= today);
  const openDienstenLijst = (r: LeaveRequest) => openZiekteDiensten(r, shifts, today);
  const openDienstenVan = (r: LeaveRequest) => openDienstenLijst(r).length;
  // Een gesplitste dienst of overlappende ziekteperiode telt maar één keer.
  const dienstenOpNaam = new Set(actueleMeldingen.flatMap((r) => openDienstenLijst(r)
    .map((d) => `${d.driverId}|${d.date}|${serviceNumberOf(d).trim().toLowerCase()}`))).size;
  const personenNuZiek = new Set(nuZiek.map((r) => String(r.userId))).size;
  const looptVandaagAf = nuZiek.filter((r) => r.endDate === today).length;

  // --- Herverdelen vanuit het detail (admin): zelfde wissel als overal -------
  const werkdagen = werkdagenUitShifts(shifts);
  const [vervangerPerDienst, setVervangerPerDienst] = useState<Record<string, string>>({});
  const [wisselBezig, setWisselBezig] = useState<string | null>(null);
  const zetOver = async (r: LeaveRequest, dienst: Shift) => {
    const naarId = vervangerPerDienst[dienst.id];
    if (!naarId || wisselBezig) return;
    setWisselBezig(dienst.id);
    try {
      const res = await apiFetch('/api/admin/shift-swap', {
        method: 'POST',
        body: JSON.stringify({
          date: dienst.date,
          line: serviceNumberOf(dienst),
          fromDriverId: String(dienst.driverId),
          toDriverId: naarId,
          reason: 'Ziekte',
        }),
      });
      const body = await res.json().catch(() => ({} as any));
      if (!res.ok) { notify(body.error || 'Overzetten is mislukt.', 'error'); return; }
      // Bevestiging als toast: de refetch hieronder haalt de dienst uit de
      // open lijst, dus een rij-status zou nooit zichtbaar zijn (controle 16-09, nr. 19).
      notify(`Dienst ${serviceNumberOf(dienst)} overgezet naar ${naamVan(naarId)}.`, 'success');
      await onShiftSwapped?.();
    } catch {
      notify('Overzetten is mislukt, controleer je verbinding en probeer opnieuw.', 'error');
    } finally {
      setWisselBezig(null);
    }
  };

  // --- Herverdeel-wizard (verbeterronde 22-08, nr. 1) -----------------------
  // Alle open diensten van deze afwezige in één keer: het batch-advies vult
  // per gat de beste pássende kandidaat voor (zelfde regels als het advies op
  // Openstaande diensten), de planner corrigeert waar nodig, en één knop
  // voert alles door. Sequentieel, niet parallel: elke wissel hercheckt
  // dubbele inplanning tegen de stand mét de vorige wissels.
  const [batchAdvies, setBatchAdvies] = useState<Record<string, BatchAdvies>>({});
  const [batchLaden, setBatchLaden] = useState(false);
  const [verdeelBezig, setVerdeelBezig] = useState(false);
  const [verdeelConfirm, setVerdeelConfirm] = useState(false);
  const [verdeelFouten, setVerdeelFouten] = useState<Record<string, string>>({});
  // Batch-advies en dag-bewust voorinvullen zijn gedeeld met Openstaande
  // diensten (src/lib/herverdeel.ts); de bulk-lus met src/lib/bulk.ts.
  const adviesSleutelVan = (d: Shift) => adviesSleutel(d.date, serviceNumberOf(d));
  const haalKandidatenVoorstel = async (r: LeaveRequest) => {
    const diensten = openDienstenLijst(r);
    if (diensten.length === 0 || batchLaden) return;
    setBatchLaden(true);
    try {
      const per = await haalBatchAdvies(diensten.map((d) => ({ date: d.date, code: serviceNumberOf(d) })));
      setBatchAdvies(per);
      // Alleen vooraf invullen waar nog geen keuze staat, de planner blijft
      // de baas over elke rij.
      setVervangerPerDienst((cur) => vulVervangersVoor(diensten, {
        sleutelVan: (d) => d.id,
        dagVan: (d) => d.date,
        adviesVan: (d) => per[adviesSleutelVan(d)],
        huidig: cur,
      }));
    } catch (e) {
      notify(e instanceof Error ? e.message : 'Kandidaten voorstellen is mislukt.', 'error');
    } finally {
      setBatchLaden(false);
    }
  };
  const verdeelAlles = async (r: LeaveRequest) => {
    if (verdeelBezig) return;
    const diensten = openDienstenLijst(r).filter((d) => vervangerPerDienst[d.id]);
    if (diensten.length === 0) return;
    setVerdeelBezig(true);
    const resultaat = await bulkUitvoeren(diensten, async (dienst) => {
      const naarId = vervangerPerDienst[dienst.id];
      let res: Response;
      try {
        res = await apiFetch('/api/admin/shift-swap', {
          method: 'POST',
          body: JSON.stringify({
            date: dienst.date,
            line: serviceNumberOf(dienst),
            fromDriverId: String(dienst.driverId),
            toDriverId: naarId,
            reason: 'Ziekte',
          }),
        });
      } catch {
        return { fout: 'Netwerkfout, deze dienst is niet overgezet.' };
      }
      const body = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) return { fout: body.error || 'Overzetten is mislukt.' };
      // Geen rij-status: de refetch na de bulk haalt de overgezette diensten
      // uit de open lijst; meldBulkResultaat bevestigt (controle 16-09, nr. 19).
    });
    setVerdeelBezig(false);
    setVerdeelFouten(Object.fromEntries(resultaat.mislukt.map((m) => [m.item.id, m.fout])));
    meldBulkResultaat(notify, resultaat, {
      item: ['dienst', 'diensten'],
      gedaan: 'herverdeeld',
      allesGelukt: `${resultaat.gelukt.length} van ${resultaat.totaal} diensten herverdeeld.`,
      rest: (f) => `, ${f.length} mislukt, zie de rijen`,
    });
    if (resultaat.gelukt.length > 0) await onShiftSwapped?.();
  };

  // --- Ziek melden (zelfde flow als het dashboard: onSickReport) ------------
  const [meldOpen, setMeldOpen] = useState(false);
  const [meldForm, setMeldForm] = useState({ userId: '', startDate: '', endDate: '', comment: '' });
  // Validatiefouten per veld (fase C15): bij het veld, niet onderaan of in
  // een toast. Server-/netwerkfouten blijven via onSickReport → notify.
  const [meldFouten, setMeldFouten] = useState<{ userId?: string; endDate?: string }>({});
  const [isMelden, setIsMelden] = useState(false);
  // Onbewaarde invoer: sluiten vraagt eerst bevestiging (tranche 3A).
  const { vuil: meldVuil } = useVuil(meldForm, meldOpen);
  const sluitMelden = () => { setMeldOpen(false); setMeldForm({ userId: '', startDate: '', endDate: '', comment: '' }); setMeldFouten({}); };
  const verstuurMelding = async () => {
    if (isMelden) return;
    const startDate = meldForm.startDate || today;
    const endDate = meldForm.endDate || startDate;
    const fouten: { userId?: string; endDate?: string } = {};
    if (!meldForm.userId) fouten.userId = 'Kies de chauffeur die ziek is.';
    if (endDate < startDate) fouten.endDate = 'De einddatum ligt vóór de startdatum.';
    setMeldFouten(fouten);
    if (fouten.userId || fouten.endDate) return;
    setIsMelden(true);
    const ok = await onSickReport({ userId: meldForm.userId, startDate, endDate, comment: meldForm.comment })
      .finally(() => setIsMelden(false));
    if (ok) sluitMelden();
  };

  // --- "ziek" in de planning-Excel zonder registratie hier ------------------
  // De Excel en dit blad kunnen uiteenlopen: een chauffeur die in de planning
  // als "ziek" staat maar hier nooit gemeld is (case 20-08: hele maand ziek in
  // de Excel, onbekend voor digest en advisor). Best-effort geladen; per reeks
  // is registreren één klik via dezelfde flow als "Ziek melden".
  const [excelZiekte, setExcelZiekte] = useState<ZiekteReeks[]>([]);
  const [excelZiekteBusy, setExcelZiekteBusy] = useState<string | null>(null);
  const laadExcelZiekte = async () => {
    try {
      const res = await apiFetch('/api/ziekte-zonder-registratie');
      if (!res.ok) return;
      const body = await res.json().catch(() => ({} as any));
      if (Array.isArray(body?.reeksen)) setExcelZiekte(body.reeksen);
    } catch { /* zonder data geen banner */ }
  };
  useEffect(() => { void laadExcelZiekte(); }, []);
  const registreerUitExcel = async (r: ZiekteReeks) => {
    if (!r.userId || excelZiekteBusy) return;
    setExcelZiekteBusy(ziekteReeksSleutel(r));
    const ok = await onSickReport({ userId: r.userId, startDate: r.van, endDate: r.tot, comment: 'Stond als "ziek" in de planning-Excel.' })
      .finally(() => setExcelZiekteBusy(null));
    if (ok) await laadExcelZiekte();
  };

  // --- Detail: einddatum bijstellen of intrekken ----------------------------
  const [detail, setDetail] = useState<LeaveRequest | null>(null);
  const [nieuwEinde, setNieuwEinde] = useState('');
  const [isOpslaan, setIsOpslaan] = useState(false);
  const openDetail = (r: LeaveRequest) => { setDetail(r); setNieuwEinde(r.endDate); setBatchAdvies({}); setVerdeelFouten({}); };
  const bewaarEinde = async (endDate: string) => {
    if (!detail || isOpslaan) return;
    if (!endDate || endDate < detail.startDate) { return; }
    setIsOpslaan(true);
    const ok = await Promise.resolve(onSave(leaveRequests.map((r) => (r.id === detail.id ? { ...r, endDate } : r))))
      .finally(() => setIsOpslaan(false));
    if (ok) setDetail(null);
  };
  const trekIn = async () => {
    if (!detail || isOpslaan) return;
    setIsOpslaan(true);
    const ok = await Promise.resolve(onSave(leaveRequests.map((r) => (r.id === detail.id ? { ...r, status: 'cancelled' as const } : r))))
      .finally(() => setIsOpslaan(false));
    if (ok) setDetail(null);
  };

  const [toonExcel, setToonExcel] = useState(false);

  return (
    <PageShell>
      <PageHeader
        view="ziekte"
        title="Ziekte"
        description="Actuele meldingen, opvolging en inzicht in geregistreerde ziektedagen."
        actions={(
          <Button variant="primary" size="md" icon={<Plus size={16} />} onClick={() => setMeldOpen(true)}>
            Ziek melden
          </Button>
        )}
      />

      <section aria-label="Ziekte vandaag" className="space-y-3">
        <p className="text-body-sm text-slate-500">Stand van {formatDayLong(today)}</p>
        {/* kpi-raster (B4, ronde 5): op de telefoon één kaart met rijen zoals
            Vervaldata en Overzicht; drie losse tegels lieten een gat in het
            2-koloms raster. Vanaf sm drie tegels naast elkaar. */}
        <div className="kpi-raster grid grid-cols-2 gap-3 sm:grid-cols-3">
          <OpsStat icon={<Thermometer size={16} />} tone="slate" label="Nu ziek" value={personenNuZiek} sub="unieke chauffeurs vandaag" />
          <OpsStat icon={<CalendarDays size={16} />} tone={dienstenOpNaam > 0 ? 'oker' : 'slate'} label="Diensten op naam" value={dienstenOpNaam} sub="binnen geregistreerde ziekteperiodes" />
          <OpsStat icon={<AlertTriangle size={16} />} tone={looptVandaagAf > 0 ? 'oker' : 'slate'} label="Loopt vandaag af" value={looptVandaagAf} sub="meldingen waarvan de einddatum vandaag is" />
        </div>
      </section>

      {excelZiekte.length > 0 && (
        <Card as="section" aria-label="Ontbrekende registraties" tone="warning" padding="sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-start gap-2.5">
              <AlertTriangle size={18} className="mt-1 shrink-0 text-amber-700" />
              <div className="min-w-0">
                <h2 className="text-card-title">{excelZiekte.length} {excelZiekte.length === 1 ? 'periode mist' : 'periodes missen'} een registratie</h2>
                <p className="mt-1 text-body-sm text-amber-900">Wel als ziek in de planning, nog niet opgenomen in de cijfers hieronder.</p>
              </div>
            </div>
            <Button variant="secondary" size="sm" aria-expanded={toonExcel} aria-controls="ontbrekende-ziektemeldingen" onClick={() => setToonExcel((v) => !v)} iconRechts={<ChevronDown size={14} className={uitklapChevron(toonExcel)} />}>
              {toonExcel ? 'Verbergen' : 'Registraties bekijken'}
            </Button>
          </div>
          <Uitklap open={toonExcel} id="ontbrekende-ziektemeldingen">
            <ul className="mt-4 space-y-2">
              {excelZiekte.map((r) => (
                <ZiekteReeksRij key={ziekteReeksSleutel(r)} reeks={r} bezig={excelZiekteBusy === ziekteReeksSleutel(r)} disabled={!!excelZiekteBusy} onRegistreer={registreerUitExcel} />
              ))}
            </ul>
          </Uitklap>
        </Card>
      )}

      {ziektes.length === 0 ? (
        <EmptyState title="Nog geen ziekmeldingen" message="Registreer een ziekmelding met de knop rechtsboven. De periode verschijnt dan in de planning en in dit overzicht." />
      ) : (
        <>
          <ZiekteMeldingen meldingen={actueleMeldingen} users={users} vandaag={today} dienstenVan={openDienstenVan} onOpen={openDetail} />
          <ZiekteInzicht leaveRequests={leaveRequests} users={users} vandaag={today} />
          <ZiekteMeldingen meldingen={historiek} users={users} vandaag={today} dienstenVan={openDienstenVan} onOpen={openDetail} historiek />
        </>
      )}

      {/* Ziek melden — zelfde velden en flow als het dashboard. */}
      <Modal open={meldOpen} onClose={sluitMelden} vuil={meldVuil} maxWidth="md" className="flex max-h-overlay flex-col !overflow-hidden !p-0">
        <ModalHeader title="Ziekmelding registreren" description="De dag(en) staan meteen als onbeschikbaar in de planning; de andere planners krijgen een melding." onClose={sluitMelden} />
        <Formulier onVerstuur={verstuurMelding} noValidate className="flex-1 space-y-4 overflow-y-auto overscroll-contain p-6">
          <Field label="Chauffeur" required error={meldFouten.userId}>
            {({ id, describedBy, invalid }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                value={meldForm.userId}
                onChange={(e) => { setMeldForm({ ...meldForm, userId: e.target.value }); setMeldFouten((f) => ({ ...f, userId: undefined })); }}
              >
                <option value="">Kies een chauffeur…</option>
                {users
                  .filter((u) => u.role === 'chauffeur' && u.isActive !== false)
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((d) => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
              </Select>
            )}
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Van" hint="Leeg = vandaag.">
              {({ id, describedBy }) => (
                <DateInput
                  id={id}
                  aria-describedby={describedBy}
                  value={meldForm.startDate}
                  onChange={(v) => { setMeldForm({ ...meldForm, startDate: v, endDate: meldForm.endDate && meldForm.endDate < v ? v : meldForm.endDate }); setMeldFouten((f) => ({ ...f, endDate: undefined })); }}
                />
              )}
            </Field>
            <Field label="Tot en met" error={meldFouten.endDate} hint="Leeg = één dag.">
              {({ id, describedBy, invalid }) => (
                <DateInput
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  value={meldForm.endDate}
                  min={meldForm.startDate || undefined}
                  onChange={(v) => { setMeldForm({ ...meldForm, endDate: v }); setMeldFouten((f) => ({ ...f, endDate: undefined })); }}
                />
              )}
            </Field>
          </div>
          <Field label="Opmerking (optioneel)">
            {({ id }) => (
              <Textarea
                id={id}
                value={meldForm.comment}
                onChange={(e) => setMeldForm({ ...meldForm, comment: e.target.value })}
                placeholder="bv. gemeld via telefoon om 6u"
                className="h-20"
              />
            )}
          </Field>
          <Button type="submit" variant="primary" size="lg" full bezig={isMelden}>
            Ziekmelding registreren
          </Button>
        </Formulier>
      </Modal>

      {/* Detail: hersteld melden, einddatum bijstellen of intrekken. */}
      <Modal
        open={!!detail}
        onClose={() => setDetail(null)}
        // Onbewaarde einddatum (tranche 3A): sluiten vraagt eerst bevestiging.
        vuil={!!detail && detail.status !== 'cancelled' && !!nieuwEinde && nieuwEinde !== detail.endDate}
        maxWidth="md"
        className="flex max-h-overlay flex-col !overflow-hidden !p-0">
        {detail && (
          <>
            <ModalHeader
              eyebrow="Ziekteperiode"
              title={naamVan(detail.userId)}
              description={`${formatDayLong(detail.startDate)} t/m ${formatDayLong(detail.endDate)} · ${daysBetween(detail.startDate, detail.endDate)} ${daysBetween(detail.startDate, detail.endDate) === 1 ? 'kalenderdag' : 'kalenderdagen'}`}
              onClose={() => setDetail(null)}
            />
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain p-6">
              {detail.comment && <Card tone="muted" padding="sm"><MicroLabel>Opmerking</MicroLabel><p className="mt-2 whitespace-pre-wrap text-body-sm text-slate-600 [overflow-wrap:anywhere]">{detail.comment}</p></Card>}
              {detail.status === 'cancelled' ? (
                <p className="rounded-2xl bg-surface-soft px-3.5 py-3 text-sm font-medium text-slate-500">Deze melding is ingetrokken.</p>
              ) : (
                <>
                  {/* Formulier: Enter op het veld of de knop bewaart (tranche 3A). */}
                  <Formulier onVerstuur={() => bewaarEinde(nieuwEinde)} noValidate>
                    <Field
                      label="Ziek tot en met"
                      hint="Langer ziek: schuif de datum op. Eerder hersteld: zet hem terug."
                      error={nieuwEinde && nieuwEinde < detail.startDate ? `De einddatum ligt vóór de startdatum (${formatShortDay(detail.startDate)}).` : undefined}
                    >
                      {({ id, describedBy, invalid }) => (
                        <div className="flex gap-2">
                          <DateInput
                            id={id}
                            aria-describedby={describedBy}
                            invalid={invalid}
                            value={nieuwEinde}
                            min={detail.startDate}
                            onChange={(v) => setNieuwEinde(v)}
                            className="min-w-0 flex-1"
                          />
                          <Button type="submit" variant="primary" size="md" disabled={isOpslaan || !nieuwEinde || nieuwEinde === detail.endDate || nieuwEinde < detail.startDate}>
                            Opslaan
                          </Button>
                        </div>
                      )}
                    </Field>
                  </Formulier>
                  {detail.endDate >= today && detail.startDate <= today && (
                    <Button variant="secondary" size="md" full icon={<Thermometer size={14} />} disabled={isOpslaan} onClick={() => void bewaarEinde(today)}>
                      Hersteld, vandaag was de laatste ziektedag
                    </Button>
                  )}
                  {/* Diensten die in deze periode nog op naam staan: meteen
                      herverdelen (admin), zonder omweg via de Maandplanning. */}
                  {openDienstenLijst(detail).length > 0 && (
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <MicroLabel className="ml-1 tabular-nums">
                          Nog op naam ({openDienstenLijst(detail).length})
                        </MicroLabel>
                        {/* Wizard: batch-advies vult per gat de beste passende
                            kandidaat voor; "Verdeel alles" voert de gekozen
                            wissels in één keer door (met bevestiging). */}
                        {/* Planner zonder adminrecht: één mail naar de admins
                            met de open diensten en hun deeplink (punt 17). */}
                        {!isAdmin && (() => {
                          const open = openDienstenLijst(detail);
                          const href = open.length ? adminMailto(users, `Diensten overzetten na ziekmelding ${naamVan(detail.userId)}`, ziekmeldMailTekst(naamVan(detail.userId), open.map((d) => ({ date: d.date, nummer: serviceNumberOf(d) })), window.location.origin)) : undefined;
                          return href ? (
                            <Button variant="secondary" size="sm" className="shrink-0" icon={<Mail size={16} />} onClick={() => { window.location.href = href; }}>Vraag een admin</Button>
                          ) : null;
                        })()}
                        {isAdmin && (openDienstenLijst(detail).length > 1 || verdeelBezig) && (() => {
                          const teVerdelen = openDienstenLijst(detail).filter((d) => vervangerPerDienst[d.id]).length;
                          return (
                            <div className="flex shrink-0 flex-wrap gap-2">
                              <Button variant="secondary" size="sm" disabled={batchLaden || verdeelBezig} onClick={() => void haalKandidatenVoorstel(detail)}>
                                {batchLaden ? 'Advies berekenen…' : 'Stel kandidaten voor'}
                              </Button>
                              {/* Secundair: de enige gouden knop in dit detail is "Opslaan"
                                  bij de einddatum (afwerking 04-09, nr. 5). */}
                              <Button variant="secondary" size="sm" disabled={verdeelBezig || batchLaden || teVerdelen === 0} onClick={() => setVerdeelConfirm(true)}>
                                {verdeelBezig ? 'Bezig…' : `Verdeel alles (${teVerdelen})`}
                              </Button>
                            </div>
                          );
                        })()}
                      </div>
                      <div className="space-y-2.5">
                        {openDienstenLijst(detail).map((dienst) => {
                          return (
                            <Card key={dienst.id} tone="muted" padding="none" className="px-3.5 py-3 space-y-2.5">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <span className="text-sm font-semibold text-slate-800 tabular-nums">Dienst {serviceNumberOf(dienst)}</span>
                                <span className="flex flex-wrap items-center gap-2">
                                  <span className={cn(microLabelClass, 'tabular-nums')}>{formatShortDay(dienst.date)}</span>
                                  {/* Admin: rechtstreeks naar die dag in de Maandplanning. */}
                                  {isAdmin && (
                                    <Button variant="ghost" size="sm" icon={<CalendarDays size={14} />} onClick={() => { setDetail(null); navigeer('bezetting', { params: maandplanningParams(dienst.date) }); }}>
                                      Maandplanning
                                    </Button>
                                  )}
                                </span>
                              </div>
                              {isAdmin ? (
                                <>
                                {batchAdvies[adviesSleutelVan(dienst)]?.samenvatting && (
                                  <p className="text-xs font-medium text-slate-500">{batchAdvies[adviesSleutelVan(dienst)].samenvatting}</p>
                                )}
                                {verdeelFouten[dienst.id] && (
                                  // red, niet rose: rose is hier de zíekte-statuskleur;
                                  // dit is een fout en hoort de fouttaal te spreken.
                                  <p role="alert" className="text-xs font-semibold text-red-700">{verdeelFouten[dienst.id]}</p>
                                )}
                                <div className="flex flex-col gap-2 sm:flex-row">
                                  <Select
                                    aria-label={`Vervanger voor dienst ${serviceNumberOf(dienst)} op ${formatDatumDMJ(dienst.date)}`}
                                    value={vervangerPerDienst[dienst.id] ?? ''}
                                    onChange={(e) => setVervangerPerDienst((cur) => ({ ...cur, [dienst.id]: e.target.value }))}
                                    className="min-w-0 flex-1"
                                    disabled={!planningMatrixGeladen}
                                  >
                                    {/* Zonder matrix geen kandidaten: een afwezige
                                        stond anders even als vrij in de lijst. */}
                                    <option value="">{planningMatrixGeladen ? 'Kies een chauffeur…' : 'Kandidaten laden…'}</option>
                                    {planningMatrixGeladen && rangschikKandidaten(
                                      users.filter((u) => u.role === 'chauffeur' && u.isActive !== false && String(u.id) !== String(dienst.driverId)),
                                      vrijOpDatum(shifts, dienst.date, nietBeschikbaarUitMatrix(planningMatrixRows, users, dienst.date)),
                                      werkdagen,
                                      dienst.date,
                                    ).map((k) => <option key={k.user.id} value={String(k.user.id)}>{kandidaatLabel(k)}</option>)}
                                  </Select>
                                  <Button variant="secondary" size="md" disabled={!vervangerPerDienst[dienst.id] || wisselBezig === dienst.id || verdeelBezig} onClick={() => void zetOver(detail, dienst)}>
                                    {wisselBezig === dienst.id ? 'Bezig…' : 'Zet over'}
                                  </Button>
                                </div>
                                </>
                              ) : (
                                <p className="text-xs font-medium text-slate-500">Nog niet herverdeeld, een admin kan deze dienst overzetten.</p>
                              )}
                            </Card>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <Button variant="danger" size="md" full disabled={isOpslaan} onClick={() => void trekIn()}>
                    Melding intrekken (foutief geregistreerd)
                  </Button>
                </>
              )}
            </div>
          </>
        )}
      </Modal>
      <ConfirmationModal
        open={verdeelConfirm}
        onClose={() => setVerdeelConfirm(false)}
        onConfirm={() => {
          setVerdeelConfirm(false);
          if (detail) void verdeelAlles(detail);
        }}
        title="Alle diensten herverdelen?"
        message={detail
          ? `${openDienstenLijst(detail).filter((d) => vervangerPerDienst[d.id]).length} diensten van ${naamVan(detail.userId)} worden in één keer overgezet naar de gekozen vervangers. Elke chauffeur krijgt een melding; terugdraaien kan per dienst via de cel in de Maandplanning.`
          : ''}
        confirmText="Verdeel alles"
        cancelText="Annuleren"
        variant="warning"
      />

    </PageShell>
  );
}

