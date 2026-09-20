import { Fragment, useEffect, useMemo, useState } from 'react';
import { typedagLabel } from '../../lib/typedag';
import { ArrowLeft, CalendarOff, ChevronLeft, ChevronRight, Printer } from 'lucide-react';
import { teltInVerlofbezetting } from '../../types';
import type { LeaveRequest, Shift, User } from '../../types';
import { leaveSolid } from '../../lib/statusColors';
import { cn, notify, openPdfInNewTab } from '../../lib/ui';
import { isoDate } from '../../lib/availability';
import { EmptyState, PageHeader, PageShell } from '../../components/ui';
import { Card } from '../../components/Card';
import { Badge, Button, FilterChip, IconButton, MicroLabel, microLabelClass, StatusBadge, TableShell, Td, Th } from '../../components/primitives';
import { SortTh, TableToolbar, useSort } from '../../components/Table';
import { Avatar } from '../../components/Avatar';
import { DetailPaneel } from '../../components/DetailPaneel';
import { EntityHistoryModal } from '../../components/EntityHistoryModal';
import { aanvragerNaam, useVerlofLimieten, VerlofBeoordelingInhoud, VerlofBeoordelingKnoppen } from '../../components/VerlofBeoordeling';
import { formatDateHuman, formatDayLong, formatPeriodeDMJ, MONTH_NAMES, LEAVE_TYPE_LABELS, WEEKDAY_LETTER_MON } from '../../lib/format';
import { useRouteParam } from '../../app/router';
import { limietVoorDag } from '../../../shared/schemas/verlofLimieten';

/** Maand in de URL (`/beheer/verlofkalender/2026-10`) — spiegel van `viewMonth`;
 *  een ongeldige waarde wordt genegeerd. */
const MAAND_PARAM = /^\d{4}-(0[1-9]|1[0-2])$/;
const maandUitParam = (p: string | null): Date | null =>
  p && MAAND_PARAM.test(p) ? new Date(Number(p.slice(0, 4)), Number(p.slice(5, 7)) - 1, 1) : null;
const maandNaarParam = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Statuswoord in de cel-tooltip — Nederlands, zoals StatusBadge. */
const STATUS_TEKST: Record<LeaveRequest['status'], string> = {
  approved: 'goedgekeurd', pending: 'in behandeling', cancelled: 'geannuleerd', rejected: 'afgewezen',
};

/** Volgorde in het dagpaneel: eerst wat een beslissing vraagt, dan wie echt weg is. */
const DAG_VOLGORDE: Record<LeaveRequest['status'], number> = { pending: 0, approved: 1, cancelled: 2, rejected: 3 };

// Kleuren uit de gedeelde statuskleurtaal (src/lib/statusColors.ts) — deze
// view bepaalt alleen nog de vorm (vol kleurvlak).
const cellColor = leaveSolid;

/**
 * Verlofkalender: het maandoverzicht van alle afwezigheden. Sinds punt 16
 * een doe-scherm: een dagkop of cel aantikken opent het dagpaneel (wie is
 * die dag weg, met soort en status, en de verloflimiet van die dag), en een
 * wachtende aanvraag toont meteen de beoordeling met de beslisknoppen,
 * dezelfde component als in Verlof (src/components/VerlofBeoordeling.tsx).
 * `onDecide` is de callback van App.tsx (delta-PATCH met seenStatus); zonder
 * die prop is het paneel alleen-lezen.
 */
export function VerlofKalenderView({ users, leaveRequests, shifts = [], onDecide }: {
  users: User[];
  leaveRequests: LeaveRequest[];
  shifts?: Shift[];
  onDecide?: (id: string, status: LeaveRequest['status'], seenStatus?: string) => Promise<boolean>;
}) {
  const [maandParam, zetMaandParam] = useRouteParam(0);
  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return maandUitParam(maandParam) ?? new Date(now.getFullYear(), now.getMonth(), 1);
  });
  // Maand → URL (replace, geen extra history-entry); de state blijft de bron.
  // De huidige maand geeft een schone URL zonder parameter.
  const monthParam = maandNaarParam(viewMonth);
  useEffect(() => {
    const gewenst = monthParam === maandNaarParam(new Date()) ? null : monthParam;
    if ((maandParam ?? null) !== gewenst) zetMaandParam(gewenst);
  }, [monthParam, maandParam, zetMaandParam]);

  const year = viewMonth.getFullYear();
  const monthIndex = viewMonth.getMonth();
  const monthName = MONTH_NAMES[monthIndex];
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const todayIso = isoDate(new Date()); // lokale datum (niet UTC → geen dag-verschuiving 's nachts)

  const goToPrev = () => setViewMonth(new Date(year, monthIndex - 1, 1));
  const goToNext = () => setViewMonth(new Date(year, monthIndex + 1, 1));
  const goToToday = () => {
    const now = new Date();
    setViewMonth(new Date(now.getFullYear(), now.getMonth(), 1));
  };

  // Toon enkel actieve chauffeurs en planners (niet de admin/beheerder).
  const alleUsers = users
    .filter((u) => u.isActive !== false && u.name.toLowerCase() !== 'beheerder' && (u.role === 'chauffeur' || u.role === 'planner'))
    .sort((a, b) => a.name.localeCompare(b.name, 'nl'));
  // Zoeken op naam + "alleen met afwezigheid deze maand"; de naamkolom
  // sorteert op- of aflopend (standaard oplopend, zoals voorheen).
  const [zoek, setZoek] = useState('');
  const [alleenAfwezig, setAlleenAfwezig] = useState(false);
  const sort = useSort<'naam'>('naam');

  const dateIso = (day: number) => `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const weekdayLetter = (day: number) => {
    const jsDay = new Date(year, monthIndex, day).getDay();
    const mondayIndex = jsDay === 0 ? 6 : jsDay - 1;
    return WEEKDAY_LETTER_MON[mondayIndex];
  };
  const isWeekend = (day: number) => {
    const jsDay = new Date(year, monthIndex, day).getDay();
    return jsDay === 0 || jsDay === 6;
  };
  const isToday = (day: number) => dateIso(day) === todayIso;

  // Nieuw tabblad met het print-jaaroverzicht van deze chauffeur, voor het
  // jaar dat nu in beeld staat (zelfde print-modus-patroon als het
  // maandrooster in ManageSchedulesView).
  const openJaaroverzicht = (userId: string) => {
    // openPdfInNewTab i.p.v. rauwe window.open: in iOS-standalone geeft
    // window.open geregeld null terug — dan deed de knop niets, of belandde je
    // buiten de PWA in Safari zonder weg terug. De helper navigeert in dat
    // geval in hetzelfde venster.
    openPdfInNewTab(
      `${window.location.origin}${window.location.pathname}?print-verlof-driver=${encodeURIComponent(userId)}&print-verlof-jaar=${year}`,
    );
  };

  // Build a lookup: userId -> day-number -> matching leave record (highest priority status)
  const leaveByUserDay = new Map<string, Map<number, LeaveRequest>>();
  const monthStart = dateIso(1);
  const monthEnd = dateIso(daysInMonth);
  const statusPriority: Record<LeaveRequest['status'], number> = {
    approved: 4, pending: 3, cancelled: 2, rejected: 1,
  };
  for (const leave of leaveRequests) {
    // Ziekte hoort niet bij verlof (Jarno 08-09): ziekmeldingen staan in
    // Beheer › Ziekte en blijven hier buiten beeld.
    if (leave.type === 'ziekte') continue;
    if (leave.endDate < monthStart || leave.startDate > monthEnd) continue;
    const start = leave.startDate < monthStart ? monthStart : leave.startDate;
    const end = leave.endDate > monthEnd ? monthEnd : leave.endDate;
    const startDay = parseInt(start.slice(-2), 10);
    const endDay = parseInt(end.slice(-2), 10);
    let userMap = leaveByUserDay.get(leave.userId);
    if (!userMap) {
      userMap = new Map();
      leaveByUserDay.set(leave.userId, userMap);
    }
    for (let d = startDay; d <= endDay; d++) {
      const existing = userMap.get(d);
      if (!existing || statusPriority[leave.status] > statusPriority[existing.status]) {
        userMap.set(d, leave);
      }
    }
  }

  // Aggregeren voor de top-rij: hoeveel afwezigen (approved) per dag
  const absenceCountPerDay: Record<number, number> = {};
  for (const [, userMap] of leaveByUserDay) {
    for (const [day, leave] of userMap) {
      if (leave.status === 'approved') {
        absenceCountPerDay[day] = (absenceCountPerDay[day] || 0) + 1;
      }
    }
  }

  // --- Dagpaneel + beoordeling (punt 16) ------------------------------------
  // Lokale selectie (geen URL-segment): het maandsegment ontbreekt voor de
  // huidige maand, waardoor een dagsegment erachter niet stabiel te schrijven
  // is; de maand blijft wél deelbaar.
  const [gekozenDag, setGekozenDag] = useState<string | null>(null);
  // Id van de aanvraag die binnen het dagpaneel open staat (beoordeling).
  const [beoordeelId, setBeoordeelId] = useState<string | null>(null);
  const [historyLeave, setHistoryLeave] = useState<LeaveRequest | null>(null);
  const limieten = useVerlofLimieten();
  const magBeslissen = !!onDecide;

  const openDag = (iso: string, aanvraagId: string | null = null) => {
    setGekozenDag(iso);
    setBeoordeelId(aanvraagId);
  };
  const sluitPaneel = () => { setGekozenDag(null); setBeoordeelId(null); };
  // Een cel met een wachtende aanvraag opent meteen de beoordeling; elke
  // andere cel (of de dagkop) opent het dagoverzicht.
  const openCel = (iso: string, leave: LeaveRequest | undefined) => openDag(iso, leave?.status === 'pending' ? leave.id : null);

  /** Alle verlofrijen (geen ziekte) die deze dag raken, beslissing eerst. */
  const aanvragenOp = (iso: string) =>
    leaveRequests
      .filter((r) => r.type !== 'ziekte' && r.startDate <= iso && r.endDate >= iso)
      .sort((a, b) => DAG_VOLGORDE[a.status] - DAG_VOLGORDE[b.status] || aanvragerNaam(users, a).localeCompare(aanvragerNaam(users, b), 'nl'));
  const dagAanvragen = gekozenDag ? aanvragenOp(gekozenDag) : [];
  // Bezetting voor de limiet: goedgekeurd én rijdend personeel dat een dienst
  // bezet (een flexi-job vult in en maakt de dag niet voller, Jarno 14-09).
  const dagBezet = dagAanvragen.filter((r) => {
    if (r.status !== 'approved') return false;
    const u = users.find((x) => String(x.id) === String(r.userId));
    return !u || teltInVerlofbezetting(u);
  }).length;
  const dagLimiet = gekozenDag ? limietVoorDag(limieten, gekozenDag) : 0;
  const dagBezetting: 'vrij' | 'deels' | 'volzet' = dagBezet <= 0 ? 'vrij' : dagBezet < dagLimiet ? 'deels' : 'volzet';
  const beoordeel = useMemo(
    () => (beoordeelId ? leaveRequests.find((r) => r.id === beoordeelId) ?? null : null),
    [beoordeelId, leaveRequests],
  );
  // Verdwijnt de aanvraag (ingetrokken, andere maand geladen), dan terug naar de dag.
  useEffect(() => { if (beoordeelId && !beoordeel) setBeoordeelId(null); }, [beoordeelId, beoordeel]);

  const beslis = (id: string, status: 'approved' | 'rejected', seenStatus: LeaveRequest['status']) => {
    if (!onDecide) return;
    // Zelfde delta-pad als Verlof: seenStatus = wat de beslisser zag, zodat
    // de server een tweede beoordelaar netjes met een conflict afwijst.
    void onDecide(id, status, seenStatus).then((ok) => {
      if (ok) notify(status === 'approved' ? 'Verlof goedgekeurd.' : 'Verlof afgewezen.', 'success');
    });
    setBeoordeelId(null);
  };

  const zoekTerm = zoek.trim().toLowerCase();
  const visibleUsers = sort.sorteer(
    alleUsers
      .filter((u) => !zoekTerm || u.name.toLowerCase().includes(zoekTerm))
      .filter((u) => !alleenAfwezig || (leaveByUserDay.get(u.id)?.size ?? 0) > 0),
    (u) => u.name,
  );
  const wisFilters = () => { setZoek(''); setAlleenAfwezig(false); };
  const legeStaat = alleUsers.length === 0
    ? <EmptyState title="Geen actieve chauffeurs" message="Zodra er chauffeurs of planners in het systeem staan, verschijnen ze hier." />
    : (
      <EmptyState
        variant={zoekTerm ? 'leeg' : 'klaar'}
        title={zoekTerm ? `Geen resultaten voor “${zoek.trim()}”` : 'Niemand afwezig deze maand'}
        message={zoekTerm ? 'Pas de zoekterm aan.' : 'Zet het filter uit om iedereen te zien.'}
        action={<Button variant="secondary" onClick={wisFilters}>Zoekterm en filter wissen</Button>}
      />
    );

  const dagTitel = gekozenDag ? formatDayLong(gekozenDag).replace(/^./, (c) => c.toUpperCase()) : '';

  return (
    <PageShell>
      <PageHeader
        view="verlof-kalender"
        title="Verlofkalender"
        actions={(
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm" className="min-h-11 min-w-11 justify-center"
              onClick={goToPrev}
              aria-label="Vorige maand"
              icon={<ChevronLeft size={16} />}
            />
            <span className="px-3 text-base font-semibold tracking-tight capitalize min-w-[150px] text-center text-slate-800 tabular-nums">{monthName} {year}</span>
            <Button
              variant="ghost"
              size="sm" className="min-h-11 min-w-11 justify-center"
              onClick={goToNext}
              aria-label="Volgende maand"
              icon={<ChevronRight size={16} />}
            />
            <Button variant="secondary" size="sm" className="ml-1" onClick={goToToday}>
              Vandaag
            </Button>
          </div>
        )}
      />

      <TableToolbar
        zoek={zoek}
        onZoek={setZoek}
        placeholder="Zoek chauffeur…"
        telling={`${visibleUsers.length} van ${alleUsers.length}`}
        filters={(
          <FilterChip active={alleenAfwezig} onClick={() => setAlleenAfwezig((v) => !v)} icon={<CalendarOff size={14} />}>
            Alleen met afwezigheid
          </FilterChip>
        )}
      />

      {/* Dagpaneel: op desktop boven de kalender (de 31 kolommen hebben de
          volle breedte nodig), op mobiel een SlideOver. Alleen zichtbaar
          zolang er een dag open staat. Binnenin wisselt de inhoud tussen het
          dagoverzicht en de beoordeling van één aanvraag. */}
      <DetailPaneel
        open={!!gekozenDag}
        onClose={sluitPaneel}
        plakkend={false}
        verbergLeeg
        sleutel={gekozenDag ? `${gekozenDag}|${beoordeel?.id ?? ''}` : undefined}
        title={beoordeel ? aanvragerNaam(users, beoordeel) : dagTitel || 'Dag'}
        subtitle={beoordeel
          ? `Aangevraagd op ${formatDateHuman(beoordeel.createdAt)}`
          : gekozenDag ? `${dagBezet} van ${dagLimiet} afwezig volgens de verloflimiet` : undefined}
        icon={beoordeel ? <Avatar naam={aanvragerNaam(users, beoordeel)} size="lg" /> : undefined}
        chip={!beoordeel && gekozenDag ? (
          <Badge tone={dagBezetting === 'volzet' ? 'red' : dagBezetting === 'deels' ? 'amber' : 'emerald'} stil={dagBezetting !== 'volzet'} dot={dagBezetting === 'volzet'}>
            {dagBezetting === 'volzet' ? 'Volzet' : dagBezetting === 'deels' ? 'Deels vrij' : 'Vrij'}
          </Badge>
        ) : undefined}
        footer={beoordeel ? (
          <VerlofBeoordelingKnoppen
            aanvraag={beoordeel}
            today={todayIso}
            isPlanner={magBeslissen}
            onDecide={beslis}
            onHistoriek={setHistoryLeave}
            onClose={() => setBeoordeelId(null)}
            links={(
              <IconButton label="Terug naar de dag" variant="ghost" onClick={() => setBeoordeelId(null)}>
                <ArrowLeft size={16} />
              </IconButton>
            )}
          />
        ) : gekozenDag ? (
          <Button variant="secondary" size="lg" full onClick={sluitPaneel}>Sluiten</Button>
        ) : undefined}
      >
        {beoordeel ? (
          <VerlofBeoordelingInhoud aanvraag={beoordeel} users={users} shifts={shifts} leaveRequests={leaveRequests} limieten={limieten} />
        ) : gekozenDag ? (
          <div className="space-y-4">
            {dagAanvragen.length === 0 ? (
              <p className="text-body-sm text-slate-500">Niemand afwezig op deze dag.</p>
            ) : (
              <ul className="space-y-1.5">
                {dagAanvragen.map((r) => {
                  const naam = aanvragerNaam(users, r);
                  const pending = r.status === 'pending';
                  const stil = r.status === 'cancelled' || r.status === 'rejected';
                  return (
                    // Naam + soort krijgen minstens 10 rem; status en knop
                    // lopen op een smal scherm om naar een tweede regel i.p.v.
                    // de naam af te knijpen.
                    <li key={r.id} className={cn('flex min-h-11 flex-wrap items-center gap-x-3 gap-y-2 rounded-xl px-3 py-2 ring-1 ring-hairline', pending ? 'bg-amber-50/60' : 'bg-surface-row', stil && 'opacity-60')}>
                      <div className="flex min-w-0 flex-1 basis-40 items-center gap-3">
                        <Avatar naam={naam} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-semibold text-slate-800">{naam}</p>
                          <p className="truncate text-xs font-medium text-slate-500">
                            {LEAVE_TYPE_LABELS[r.type] || r.type} · {formatPeriodeDMJ(r.startDate, r.endDate)}
                          </p>
                        </div>
                      </div>
                      <div className="ml-auto flex shrink-0 items-center gap-2">
                        <StatusBadge status={r.status} stil />
                        <Button variant={pending && magBeslissen ? 'primary' : 'ghost'} size="sm" onClick={() => setBeoordeelId(r.id)}>
                          {pending && magBeslissen ? 'Beoordelen' : 'Bekijk'}
                        </Button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
            <Card tone={dagBezetting === 'volzet' ? 'danger' : 'muted'} padding="none" className="px-4 py-3">
              <MicroLabel className={dagBezetting === 'volzet' ? 'text-red-700' : 'text-slate-600'}>Verloflimiet op deze dag</MicroLabel>
              <p className="mt-1 text-xs font-normal text-slate-600">
                Maximaal {dagLimiet} {dagLimiet === 1 ? 'chauffeur' : 'chauffeurs'} tegelijk met verlof; er {dagBezet === 1 ? 'is' : 'zijn'} er nu {dagBezet} goedgekeurd. Een flexi-job of technieker telt niet mee.
              </p>
            </Card>
          </div>
        ) : null}
      </DetailPaneel>

      {visibleUsers.length === 0 ? legeStaat : (
      <>
      {/* Desktop: volle 31-koloms kalender. Op mobile is dit onbruikbaar
          (~6px per dag-cel), dus tonen we hieronder een per-chauffeur
          stacked list. De kalender blijft in TableShell (horizontaal
          scrollen bij 31 kolommen); een sticky kolomkop kan daar niet bij
          omdat de scrollcontainer de sticky-context wordt. */}
      <TableShell className="hidden md:block">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/60 border-b border-hairline-subtle">
                <SortTh kolom="naam" sort={sort} className="sticky left-0 z-10 bg-surface-soft min-w-[180px]">
                  Chauffeur
                </SortTh>
                {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => (
                  <Fragment key={day}>
                    <Th
                      title={typedagLabel(dateIso(day))?.titel}
                      className={cn(
                        'p-0 text-center border-l border-hairline-subtle',
                        isWeekend(day) && 'bg-slate-100/50',
                        isToday(day) && 'bg-oker-50',
                        gekozenDag === dateIso(day) && 'bg-oker-100/60',
                      )}
                    >
                      {/* Drie vaste rijen (letter · dag · markering) met vaste
                          hoogte, zodat de koppen niet verspringen als een dag
                          geen dagtype of geen afwezigen heeft (Jarno 09-09).
                          Feestdag kleurt het dagnummer goud; in de derde rij
                          wint het aantal afwezigen (dat telt voor de
                          bezetting) van de dagtype-code, die in de tooltip
                          blijft staan. */}
                      {(() => {
                        const typedag = typedagLabel(dateIso(day));
                        const feest = typedag?.kort === 'F';
                        const afwezig = absenceCountPerDay[day] ?? 0;
                        return (
                          // rauw: dagkop-als-knop in een dichte 31-koloms matrix (opent het dagpaneel), geen knopvorm
                          <button
                            type="button"
                            onClick={() => openDag(dateIso(day))}
                            aria-label={`${formatDayLong(dateIso(day))} openen`}
                            aria-pressed={gekozenDag === dateIso(day)}
                            className="ios-pressable flex w-full flex-col items-center gap-0.5 px-1 py-2 transition-colors hover:bg-oker-50"
                          >
                            <div className={cn(microLabelClass, 'h-3.5 leading-3.5')}>{weekdayLetter(day)}</div>
                            <div className={cn('h-4 text-xs font-semibold leading-4', isToday(day) || feest ? 'text-oker-700' : 'text-slate-700')}>{day}</div>
                            <div className="flex h-4 items-center justify-center">
                              {afwezig > 0 ? (
                                <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500/15 px-1 text-2xs font-semibold leading-none text-emerald-700">{afwezig}</span>
                              ) : typedag ? (
                                <span className={cn('text-xs font-bold leading-none', feest ? 'text-oker-700' : 'text-slate-500')}>{typedag.kort}</span>
                              ) : null}
                            </div>
                          </button>
                        );
                      })()}
                    </Th>
                  </Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map((u) => {
                const userMap = leaveByUserDay.get(u.id);
                return (
                  <tr key={u.id} className="border-b border-hairline-subtle hover:bg-surface-soft-hover transition-colors">
                    <Td className="sticky left-0 z-10 bg-surface-white py-2 text-sm font-semibold text-slate-800 min-w-[180px] truncate">
                      {/* rauw: naam-als-link in een dichte tabelcel (tekst + printer-icoon,
                          geen knopvorm) — een Button zou de rijhoogte van het grid oprekken */}
                      <button
                        type="button"
                        onClick={() => openJaaroverzicht(u.id)}
                        title={`Verlof-jaaroverzicht ${year} openen (print)`}
                        className="group inline-flex max-w-full items-center gap-1.5 text-left transition-colors hover:text-oker-700"
                      >
                        <span className="truncate">{u.name}</span>
                        <Printer size={12} className="shrink-0 text-slate-300 transition-colors group-hover:text-oker-500" />
                      </button>
                    </Td>
                    {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
                      const leave = userMap?.get(day);
                      const iso = dateIso(day);
                      const title = leave
                        ? `${LEAVE_TYPE_LABELS[leave.type] || leave.type}, ${STATUS_TEKST[leave.status] ?? leave.status} (${formatPeriodeDMJ(leave.startDate, leave.endDate)})`
                        : undefined;
                      return (
                        <td
                          key={day}
                          title={title}
                          className={cn(
                            'border-l border-hairline-subtle h-9 p-0',
                            isWeekend(day) && !leave && 'bg-slate-50/40',
                            isToday(day) && !leave && 'bg-oker-50/30',
                            gekozenDag === iso && 'bg-oker-100/40',
                          )}
                        >
                          {/* rauw: dagcel in een dichte 31-koloms matrix (opent dag of beoordeling), geen knopvorm */}
                          <button
                            type="button"
                            onClick={() => openCel(iso, leave)}
                            aria-label={leave
                              ? `${u.name}, ${title}: ${leave.status === 'pending' ? 'beoordelen' : 'dag openen'}`
                              : `${u.name}, ${formatDayLong(iso)}: dag openen`}
                            className="ios-pressable flex h-9 w-full items-center px-1 transition-colors hover:bg-oker-50/60"
                          >
                            {leave && (
                              <span className={cn('block h-6 w-full rounded-md', cellColor(leave.status, leave.type))} />
                            )}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
      </TableShell>

      {/* Mobile: per-chauffeur lijst met afwezigheden in deze maand.
          Veel compacter dan een mini-grid; meest relevante info eerst.
          Een rij aantikken opent het dagpaneel op de eerste dag van die
          aanvraag in deze maand (wachtend = meteen de beoordeling). */}
      <Card padding="none" className="md:hidden overflow-hidden divide-y divide-hairline-subtle">
        {visibleUsers.map((u) => {
          const userMap = leaveByUserDay.get(u.id);
          // userMap heeft één entry per dag van een leave — dedup naar
          // unieke leave-aanvragen om die als items te tonen.
          const uniqueLeaves = userMap
            ? Array.from(new Map(Array.from(userMap.values()).map((l) => [l.id, l])).values())
                .sort((a, b) => a.startDate.localeCompare(b.startDate))
            : [];
          return (
            <div key={u.id} className="p-4">
              <div className="flex items-baseline justify-between gap-2">
                {/* rauw: naam-als-link in de lijstkop (tekst + printer-icoon, geen knopvorm) */}
                <button
                  type="button"
                  onClick={() => openJaaroverzicht(u.id)}
                  className="group inline-flex min-w-0 items-center gap-1.5 text-left text-sm font-semibold text-slate-800"
                >
                  <span className="truncate">{u.name}</span>
                  <Printer size={12} className="shrink-0 text-slate-300" />
                </button>
                {uniqueLeaves.length > 0 && (
                  <MicroLabel className="shrink-0">
                    {uniqueLeaves.length} {uniqueLeaves.length === 1 ? 'aanvraag' : 'aanvragen'}
                  </MicroLabel>
                )}
              </div>
              {uniqueLeaves.length === 0 ? (
                <div className="mt-2 text-sm text-slate-500">Geen afwezigheden deze maand.</div>
              ) : (
                <ul className="mt-2 space-y-1">
                  {uniqueLeaves.map((leave) => {
                    const startDay = parseInt(leave.startDate.slice(-2), 10);
                    const endDay = parseInt(leave.endDate.slice(-2), 10);
                    const sameMonthAsStart = leave.startDate.startsWith(`${year}-${String(monthIndex + 1).padStart(2, '0')}`);
                    const sameMonthAsEnd = leave.endDate.startsWith(`${year}-${String(monthIndex + 1).padStart(2, '0')}`);
                    const eersteDag = sameMonthAsStart ? leave.startDate : monthStart;
                    return (
                      <li key={leave.id}>
                        {/* rauw: aanvraagregel-als-knop in een dichte lijst (kleurstip + tekst, geen knopvorm) */}
                        <button
                          type="button"
                          onClick={() => openCel(eersteDag, leave)}
                          className="ios-pressable -mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center gap-2.5 rounded-lg px-2 text-left text-xs"
                        >
                          <span className={cn('shrink-0 w-2.5 h-2.5 rounded-full', cellColor(leave.status, leave.type))} />
                          <span className="font-semibold text-slate-700 tabular-nums">
                            {sameMonthAsStart ? startDay : '←'}
                            {leave.startDate !== leave.endDate && `, ${sameMonthAsEnd ? endDay : '→'}`}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-slate-500">
                            {LEAVE_TYPE_LABELS[leave.type] || leave.type}
                            {leave.status === 'pending' && ' · in behandeling'}
                            {leave.status === 'cancelled' && ' · geannuleerd'}
                            {leave.status === 'rejected' && ' · afgewezen'}
                          </span>
                          {leave.status === 'pending' && magBeslissen && (
                            <Badge tone="amber" className="shrink-0">Beoordelen</Badge>
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          );
        })}
      </Card>
      </>
      )}

      {/* Legende */}
      <Card padding="md" className="flex flex-wrap items-center gap-x-6 gap-y-3 text-xs">
        <MicroLabel className="text-slate-500">Legende</MicroLabel>
        <div className="flex items-center gap-2">
          <div className="w-4 h-3 rounded bg-emerald-500" />
          <span className="font-medium text-slate-600">Betaald verlof goedgekeurd</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-3 rounded bg-blue-400" />
          <span className="font-medium text-slate-600">Klein verlet goedgekeurd</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-3 rounded bg-amber-400" />
          <span className="font-medium text-slate-600">In behandeling</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-3 rounded bg-slate-300" />
          <span className="font-medium text-slate-600">Geannuleerd</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-500/15 px-1 text-2xs font-semibold leading-none text-emerald-700">3</span>
          <span className="font-medium text-slate-600">Aantal afwezig die dag</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-oker-700">F</span>
          <span className="font-medium text-slate-600">Feestdag</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-slate-500">V</span>
          <span className="font-medium text-slate-600">Schoolvakantie</span>
        </div>
        <span className="text-slate-500">Tik een dag of cel aan om te zien wie weg is en om te beoordelen.</span>
      </Card>

      <EntityHistoryModal
        open={!!historyLeave}
        onClose={() => setHistoryLeave(null)}
        entityType="leave"
        entityId={historyLeave?.id ?? ''}
        title={historyLeave ? `${aanvragerNaam(users, historyLeave)}, ${formatPeriodeDMJ(historyLeave.startDate, historyLeave.endDate)}` : undefined}
      />
    </PageShell>
  );
}
