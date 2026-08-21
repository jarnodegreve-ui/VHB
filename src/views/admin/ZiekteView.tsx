import { useEffect, useMemo, useState } from 'react';
import { Plus, Thermometer } from 'lucide-react';
import type { LeaveRequest, Shift, User } from '../../types';
import { isoDate } from '../../lib/availability';
import { getSupabaseAuthHeaders, notify } from '../../lib/ui';
import { kandidaatLabel, rangschikKandidaten, vrijOpDatum, werkdagenUitShifts } from '../../lib/vervangers';
import { daysBetween } from '../../lib/leaveBalance';
import { formatDayLong, formatShortDay, serviceNumberOf } from '../../lib/format';
import { EmptyState, ModalHeader, PageHeader, PageShell } from '../../components/ui';
import { Button, MicroLabel } from '../../components/primitives';
import { Modal } from '../../components/Modal';

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
  const today = isoDate(new Date());
  const naamVan = (id: string) => users.find((u) => String(u.id) === String(id))?.name ?? 'Onbekend';
  const isAdmin = user.role === 'admin';
  const dagNa = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    d.setDate(d.getDate() + 1);
    return isoDate(d);
  };

  const ziektes = useMemo(
    () => leaveRequests.filter((r) => r.type === 'ziekte'),
    [leaveRequests],
  );
  const nuZiek = ziektes
    .filter((r) => r.status === 'approved' && r.startDate <= today && r.endDate >= today)
    .sort((a, b) => a.endDate.localeCompare(b.endDate));
  const aangekondigd = ziektes
    .filter((r) => r.status === 'approved' && r.startDate > today)
    .sort((a, b) => a.startDate.localeCompare(b.startDate));
  const historiek = ziektes
    .filter((r) => (r.status === 'approved' && r.endDate < today) || r.status === 'cancelled')
    .sort((a, b) => b.startDate.localeCompare(a.startDate))
    .slice(0, 25);

  /** Diensten die binnen de ziekteperiode (vanaf vandaag) nog op naam staan —
   *  dát is het werk dat dit scherm zichtbaar moet maken. */
  const openDienstenLijst = (r: LeaveRequest) =>
    shifts
      .filter((s) =>
        String(s.driverId) === String(r.userId) &&
        s.date >= (r.startDate > today ? r.startDate : today) &&
        s.date <= r.endDate,
      )
      .sort((a, b) => a.date.localeCompare(b.date));
  const openDienstenVan = (r: LeaveRequest) => openDienstenLijst(r).length;

  /** Ziektedagen per chauffeur dit jaar (goedgekeurde meldingen, afgekapt op
   *  de jaargrens) — voor loonadministratie en verzuimgesprekken. */
  const jaar = Number(today.slice(0, 4));
  const clip = (iso: string, kant: 'start' | 'eind') => {
    const grens = kant === 'start' ? `${jaar}-01-01` : `${jaar}-12-31`;
    if (kant === 'start') return iso < grens ? grens : iso;
    return iso > grens ? grens : iso;
  };
  const dagenDitJaar = useMemo(() => {
    const per = new Map<string, number>();
    for (const r of ziektes) {
      if (r.status !== 'approved') continue;
      if (r.endDate < `${jaar}-01-01` || r.startDate > `${jaar}-12-31`) continue;
      const dagen = daysBetween(clip(r.startDate, 'start'), clip(r.endDate, 'eind'));
      per.set(String(r.userId), (per.get(String(r.userId)) ?? 0) + dagen);
    }
    return [...per.entries()]
      .map(([userId, dagen]) => ({ userId, dagen }))
      .sort((a, b) => b.dagen - a.dagen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ziektes, jaar]);

  // --- Herverdelen vanuit het detail (admin): zelfde wissel als overal -------
  const werkdagen = werkdagenUitShifts(shifts);
  const [vervangerPerDienst, setVervangerPerDienst] = useState<Record<string, string>>({});
  const [wisselBezig, setWisselBezig] = useState<string | null>(null);
  const [overgezet, setOvergezet] = useState<Record<string, string>>({});
  const zetOver = async (r: LeaveRequest, dienst: Shift) => {
    const naarId = vervangerPerDienst[dienst.id];
    if (!naarId || wisselBezig) return;
    setWisselBezig(dienst.id);
    try {
      const res = await fetch('/api/admin/shift-swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getSupabaseAuthHeaders()) },
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
      setOvergezet((cur) => ({ ...cur, [dienst.id]: naamVan(naarId) }));
      await onShiftSwapped?.();
    } catch {
      notify('Overzetten is mislukt — controleer je verbinding en probeer opnieuw.', 'error');
    } finally {
      setWisselBezig(null);
    }
  };

  // --- Ziek melden (zelfde flow als het dashboard: onSickReport) ------------
  const [meldOpen, setMeldOpen] = useState(false);
  const [meldForm, setMeldForm] = useState({ userId: '', startDate: '', endDate: '', comment: '' });
  const [meldFout, setMeldFout] = useState('');
  const [isMelden, setIsMelden] = useState(false);
  const sluitMelden = () => { setMeldOpen(false); setMeldForm({ userId: '', startDate: '', endDate: '', comment: '' }); setMeldFout(''); };
  const verstuurMelding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isMelden) return;
    if (!meldForm.userId) { setMeldFout('Kies de chauffeur die ziek is.'); return; }
    const startDate = meldForm.startDate || today;
    const endDate = meldForm.endDate || startDate;
    if (endDate < startDate) { setMeldFout('De einddatum ligt vóór de startdatum.'); return; }
    setMeldFout('');
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
  const [excelZiekte, setExcelZiekte] = useState<Array<{ userId: string | null; naam: string; van: string; tot: string; dagen: number }>>([]);
  const [excelZiekteBusy, setExcelZiekteBusy] = useState<string | null>(null);
  const laadExcelZiekte = async () => {
    try {
      const res = await fetch('/api/ziekte-zonder-registratie', { headers: await getSupabaseAuthHeaders() });
      if (!res.ok) return;
      const body = await res.json().catch(() => ({} as any));
      if (Array.isArray(body?.reeksen)) setExcelZiekte(body.reeksen);
    } catch { /* zonder data geen banner */ }
  };
  useEffect(() => { void laadExcelZiekte(); }, []);
  const registreerUitExcel = async (r: { userId: string | null; van: string; tot: string }) => {
    if (!r.userId || excelZiekteBusy) return;
    setExcelZiekteBusy(`${r.userId}|${r.van}`);
    const ok = await onSickReport({ userId: r.userId, startDate: r.van, endDate: r.tot, comment: 'Stond als "ziek" in de planning-Excel.' })
      .finally(() => setExcelZiekteBusy(null));
    if (ok) await laadExcelZiekte();
  };

  // --- Detail: einddatum bijstellen of intrekken ----------------------------
  const [detail, setDetail] = useState<LeaveRequest | null>(null);
  const [nieuwEinde, setNieuwEinde] = useState('');
  const [isOpslaan, setIsOpslaan] = useState(false);
  const openDetail = (r: LeaveRequest) => { setDetail(r); setNieuwEinde(r.endDate); };
  const bewaarEinde = async (endDate: string) => {
    if (!detail || isOpslaan) return;
    if (endDate < detail.startDate) { return; }
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

  const Rij = ({ r, toonOpen }: { r: LeaveRequest; toonOpen?: boolean }) => {
    const open = toonOpen ? openDienstenVan(r) : 0;
    return (
      <button
        type="button"
        onClick={() => openDetail(r)}
        className="group flex w-full items-center gap-3 rounded-xl bg-surface-row px-3.5 py-2.5 min-h-11 text-left ring-1 ring-hairline transition-all hover:bg-surface-row-hover hover:ring-hairline-strong"
      >
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-slate-800">{naamVan(r.userId)}</span>
            {r.status === 'cancelled' && (
              <span className="shrink-0 rounded-md bg-surface-muted px-1.5 py-0.5 text-2xs font-semibold text-slate-500">ingetrokken</span>
            )}
          </span>
          <span className="mt-px block truncate text-xs font-normal text-slate-500 tabular-nums">
            {formatShortDay(r.startDate)}{r.startDate !== r.endDate ? ` → ${formatShortDay(r.endDate)}` : ''}
            {' · '}{daysBetween(r.startDate, r.endDate)} {daysBetween(r.startDate, r.endDate) === 1 ? 'dag' : 'dagen'}
            {/* Mensentaal bij lopende/komende periodes: wanneer is hij terug? */}
            {r.status === 'approved' && r.startDate <= today && r.endDate >= today && (
              ` · terug ${formatShortDay(dagNa(r.endDate))} · nog ${daysBetween(today, r.endDate)} ${daysBetween(today, r.endDate) === 1 ? 'dag' : 'dagen'}`
            )}
            {r.status === 'approved' && r.startDate > today && ` · start over ${daysBetween(today, r.startDate) - 1 || 1} ${daysBetween(today, r.startDate) - 1 === 1 ? 'dag' : 'dagen'}`}
            {r.comment ? ` · ${r.comment}` : ''}
          </span>
        </span>
        {toonOpen && open > 0 && (
          <span className="shrink-0 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-2xs font-semibold text-amber-700 dark:text-amber-400 tabular-nums">
            {open} {open === 1 ? 'dienst' : 'diensten'} op naam
          </span>
        )}
      </button>
    );
  };

  const Sectie = ({ titel, items, leeg, toonOpen }: { titel: string; items: LeaveRequest[]; leeg: string; toonOpen?: boolean }) => (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between px-1">
        <MicroLabel className="text-slate-500">{titel}</MicroLabel>
        <MicroLabel className="tabular-nums">{items.length}</MicroLabel>
      </div>
      {items.length === 0 ? (
        <p className="rounded-xl bg-surface-soft px-3.5 py-3 text-xs font-medium text-slate-400">{leeg}</p>
      ) : (
        <div className="space-y-1.5">{items.map((r) => <Rij key={r.id} r={r} toonOpen={toonOpen} />)}</div>
      )}
    </div>
  );

  return (
    <PageShell width="3xl">
      <PageHeader
        title="Ziekte"
        description="Wie is er ziek gemeld, en welke diensten staan daardoor nog open. Gescheiden van het verlofbeheer — ziekte is geen aanvraag."
        actions={(
          <Button variant="primary" size="md" icon={<Plus size={15} />} onClick={() => setMeldOpen(true)}>
            Ziek melden
          </Button>
        )}
      />

      {/* Excel zegt ziek, portaal weet van niets — vóór de secties, want dit
          is precies het geval waarin de secties hieronder leeg blijven. */}
      {excelZiekte.length > 0 && (
        <div className="rounded-3xl border border-amber-200 bg-amber-50/70 p-5 dark:border-amber-500/30 dark:bg-amber-500/10">
          <MicroLabel className="text-amber-700 dark:text-amber-400">In de planning als ziek, hier niet geregistreerd</MicroLabel>
          <p className="mt-1 text-sm font-medium text-amber-900 dark:text-amber-200">
            Deze chauffeurs staan in de geïmporteerde planning als "ziek", maar hebben geen ziekteperiode in het portaal — meldingen, dekking en dit blad kennen die afwezigheid dan niet.
          </p>
          <ul className="mt-3 space-y-2">
            {excelZiekte.map((r) => {
              const sleutel = `${r.userId}|${r.van}`;
              return (
                <li key={`${r.naam}|${r.van}`} className="flex min-h-11 flex-wrap items-center gap-2 rounded-xl bg-surface-white ring-1 ring-amber-200/70 px-3 py-2 dark:ring-amber-500/30">
                  <span className="min-w-0 flex-1 text-xs font-medium text-slate-700">
                    <span className="font-bold">{r.naam}</span>
                    {' — '}
                    <span className="tabular-nums">{formatShortDay(r.van)}{r.tot !== r.van ? ` → ${formatShortDay(r.tot)}` : ''}</span>
                    <span className="text-slate-400 tabular-nums"> · {r.dagen} {r.dagen === 1 ? 'dag' : 'dagen'}</span>
                  </span>
                  {r.userId ? (
                    <Button variant="secondary" size="sm" className="shrink-0" disabled={!!excelZiekteBusy} onClick={() => registreerUitExcel(r)}>
                      {excelZiekteBusy === sleutel ? 'Bezig…' : 'Registreer'}
                    </Button>
                  ) : (
                    <span className="shrink-0 rounded-md bg-surface-muted px-1.5 py-0.5 text-2xs font-semibold text-slate-500" title="Deze Excel-naam is niet aan een account te koppelen — maak of corrigeer eerst het account.">geen account</span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {ziektes.length === 0 ? (
        <EmptyState title="Nog geen ziekmeldingen" message="Registreer een ziekmelding met de knop rechtsboven — de dagen staan dan meteen als onbeschikbaar in de planning." />
      ) : (
        <div className="space-y-6">
          <Sectie titel="Nu ziek" items={nuZiek} leeg="Niemand ziek gemeld op dit moment." toonOpen />
          {aangekondigd.length > 0 && <Sectie titel="Aangekondigd" items={aangekondigd} leeg="" toonOpen />}
          <Sectie titel="Historiek" items={historiek} leeg="Nog geen afgelopen ziekteperiodes." />

          {/* Ziektedagen per chauffeur dit jaar — voor loonadministratie en
              verzuimgesprekken. Alleen chauffeurs met minstens één dag. */}
          {dagenDitJaar.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-baseline justify-between px-1">
                <MicroLabel className="text-slate-500">Ziektedagen in {jaar}</MicroLabel>
                <MicroLabel className="tabular-nums">{dagenDitJaar.reduce((n, d) => n + d.dagen, 0)} totaal</MicroLabel>
              </div>
              <div className="surface-card rounded-2xl divide-y divide-slate-100">
                {dagenDitJaar.map((d) => (
                  <div key={d.userId} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                    <span className="min-w-0 truncate text-sm font-medium text-slate-700">{naamVan(d.userId)}</span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-slate-800">{d.dagen} {d.dagen === 1 ? 'dag' : 'dagen'}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Ziek melden — zelfde velden en flow als het dashboard. */}
      <Modal open={meldOpen} onClose={sluitMelden} maxWidth="md" className="flex max-h-[88dvh] flex-col !overflow-hidden !p-0">
        <ModalHeader title="Ziekmelding registreren" description="De dag(en) staan meteen als onbeschikbaar in de planning; de andere planners krijgen een melding." onClose={sluitMelden} />
        <form onSubmit={verstuurMelding} className="flex-1 space-y-4 overflow-y-auto overscroll-contain p-6">
          <div className="space-y-1.5">
            <label className="text-2xs font-semibold text-slate-400 uppercase tracking-[0.08em] ml-1">Chauffeur</label>
            <select
              aria-label="Chauffeur"
              value={meldForm.userId}
              onChange={(e) => { setMeldForm({ ...meldForm, userId: e.target.value }); setMeldFout(''); }}
              className="control-input w-full rounded-2xl bg-surface-field px-4 py-3 text-base font-bold outline-none sm:text-sm"
            >
              <option value="">Kies een chauffeur…</option>
              {users
                .filter((u) => u.role === 'chauffeur' && u.isActive !== false)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((d) => <option key={d.id} value={String(d.id)}>{d.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-2xs font-semibold text-slate-400 uppercase tracking-[0.08em] ml-1">Van</label>
              <input
                type="date"
                aria-label="Startdatum ziekmelding"
                value={meldForm.startDate}
                onChange={(e) => setMeldForm({ ...meldForm, startDate: e.target.value, endDate: meldForm.endDate && meldForm.endDate < e.target.value ? e.target.value : meldForm.endDate })}
                className="control-input w-full rounded-2xl bg-surface-field px-4 py-3 text-base font-bold outline-none sm:text-sm"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-2xs font-semibold text-slate-400 uppercase tracking-[0.08em] ml-1">Tot en met</label>
              <input
                type="date"
                aria-label="Einddatum ziekmelding"
                value={meldForm.endDate}
                min={meldForm.startDate || undefined}
                onChange={(e) => setMeldForm({ ...meldForm, endDate: e.target.value })}
                className="control-input w-full rounded-2xl bg-surface-field px-4 py-3 text-base font-bold outline-none sm:text-sm"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-2xs font-semibold text-slate-400 uppercase tracking-[0.08em] ml-1">Opmerking (optioneel)</label>
            <textarea
              aria-label="Opmerking ziekmelding"
              value={meldForm.comment}
              onChange={(e) => setMeldForm({ ...meldForm, comment: e.target.value })}
              placeholder="bv. gemeld via telefoon om 6u"
              className="control-input h-20 w-full resize-none rounded-2xl bg-surface-field px-4 py-3 text-base font-bold outline-none sm:text-sm"
            />
          </div>
          {meldFout && <p role="alert" className="text-xs font-semibold text-red-600 dark:text-red-400">{meldFout}</p>}
          <Button type="submit" variant="primary" size="lg" full disabled={isMelden}>
            {isMelden ? 'Registreren…' : 'Ziekmelding registreren'}
          </Button>
        </form>
      </Modal>

      {/* Detail: hersteld melden, einddatum bijstellen of intrekken. */}
      <Modal open={!!detail} onClose={() => setDetail(null)} maxWidth="md" className="flex max-h-[88dvh] flex-col !overflow-hidden !p-0">
        {detail && (
          <>
            <ModalHeader
              eyebrow="Ziekteperiode"
              title={naamVan(detail.userId)}
              description={`${formatDayLong(detail.startDate)} t/m ${formatDayLong(detail.endDate)} · ${daysBetween(detail.startDate, detail.endDate)} ${daysBetween(detail.startDate, detail.endDate) === 1 ? 'dag' : 'dagen'}${detail.comment ? ` · "${detail.comment}"` : ''}`}
              onClose={() => setDetail(null)}
            />
            <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain p-6">
              {detail.status === 'cancelled' ? (
                <p className="rounded-2xl bg-surface-soft px-3.5 py-3 text-sm font-medium text-slate-500">Deze melding is ingetrokken.</p>
              ) : (
                <>
                  {/* Diensten die in deze periode nog op naam staan: meteen
                      herverdelen (admin), zonder omweg via de Maandplanning. */}
                  {openDienstenLijst(detail).length > 0 && (
                    <div className="space-y-2">
                      <label className="text-2xs font-semibold text-slate-400 uppercase tracking-[0.08em] ml-1">
                        Nog op naam ({openDienstenLijst(detail).length})
                      </label>
                      <div className="space-y-2.5">
                        {openDienstenLijst(detail).map((dienst) => {
                          const klaar = overgezet[dienst.id];
                          return (
                            <div key={dienst.id} className="rounded-2xl bg-surface-soft px-3.5 py-3 space-y-2.5">
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-sm font-semibold text-slate-800 tabular-nums">Dienst {serviceNumberOf(dienst)}</span>
                                <span className="text-2xs font-semibold uppercase tracking-[0.08em] text-slate-500 tabular-nums">{formatShortDay(dienst.date)}</span>
                              </div>
                              {klaar ? (
                                <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">Overgezet naar {klaar}</p>
                              ) : isAdmin ? (
                                <div className="flex flex-col gap-2 sm:flex-row">
                                  <select
                                    aria-label={`Vervanger voor dienst ${serviceNumberOf(dienst)} op ${dienst.date}`}
                                    value={vervangerPerDienst[dienst.id] ?? ''}
                                    onChange={(e) => setVervangerPerDienst((cur) => ({ ...cur, [dienst.id]: e.target.value }))}
                                    className="control-input min-w-0 flex-1 rounded-2xl bg-surface-field px-3.5 py-2.5 text-base font-semibold outline-none sm:text-sm"
                                  >
                                    <option value="">Kies een chauffeur…</option>
                                    {rangschikKandidaten(
                                      users.filter((u) => u.role === 'chauffeur' && u.isActive !== false && String(u.id) !== String(dienst.driverId)),
                                      vrijOpDatum(shifts, dienst.date),
                                      werkdagen,
                                      dienst.date,
                                    ).map((k) => <option key={k.user.id} value={String(k.user.id)}>{kandidaatLabel(k)}</option>)}
                                  </select>
                                  <Button variant="primary" size="md" disabled={!vervangerPerDienst[dienst.id] || wisselBezig === dienst.id} onClick={() => void zetOver(detail, dienst)}>
                                    {wisselBezig === dienst.id ? 'Bezig…' : 'Zet over'}
                                  </Button>
                                </div>
                              ) : (
                                <p className="text-xs font-medium text-slate-500">Een admin kan deze dienst overzetten.</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-2xs font-semibold text-slate-400 uppercase tracking-[0.08em] ml-1">Ziek tot en met</label>
                    <div className="flex gap-2">
                      <input
                        type="date"
                        aria-label="Nieuwe einddatum"
                        value={nieuwEinde}
                        min={detail.startDate}
                        onChange={(e) => setNieuwEinde(e.target.value)}
                        className="control-input min-w-0 flex-1 rounded-2xl bg-surface-field px-4 py-3 text-base font-bold outline-none sm:text-sm"
                      />
                      <Button variant="primary" size="md" disabled={isOpslaan || nieuwEinde === detail.endDate || nieuwEinde < detail.startDate} onClick={() => void bewaarEinde(nieuwEinde)}>
                        Opslaan
                      </Button>
                    </div>
                    <p className="ml-1 text-2xs font-medium text-slate-400">Langer ziek: schuif de datum op. Eerder hersteld: zet hem terug.</p>
                  </div>
                  {detail.endDate >= today && detail.startDate <= today && (
                    <Button variant="secondary" size="md" full icon={<Thermometer size={14} />} disabled={isOpslaan} onClick={() => void bewaarEinde(today)}>
                      Hersteld — vandaag was de laatste ziektedag
                    </Button>
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
    </PageShell>
  );
}
