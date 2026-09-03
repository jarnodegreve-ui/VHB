import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, Clock, CalendarPlus, ChevronDown, FileText } from 'lucide-react';
import type { LeaveRequest, Shift, SwapRequest, User } from '../types';
import { isoWeekOf } from '../lib/week';
import { typedagLabel } from '../lib/typedag';
import { leaveChip, leaveDayTint, leaveDot } from '../lib/statusColors';
import { formatLeaveType, serviceNumberOf } from '../lib/format';
import { EmptyState, PageHeader, PageShell } from '../components/ui';
import { Badge, Button, Chip, MicroLabel, microLabelClass, segItemClass, TableShell, Td, Th } from '../components/primitives';
import { Card } from '../components/Card';
import { MaandNavigatie } from '../components/MaandNavigatie';
import { CalendarSubscribeModal } from '../components/CalendarSubscribeModal';
import { SkeletonRow } from '../components/Skeleton';
import { cn } from '../lib/ui';
import { shiftIdsWithConflict } from '../lib/conflicts';
import { isoDate } from '../lib/availability';
import { shiftCategory } from '../lib/shiftTime';
import { formatShortDayPadded, formatSyncedTime, WEEKDAY_SHORT_MON } from '../lib/format';
import { downloadRoosterIcs } from '../lib/roosterIcs';
import { openHuidigRitblad } from '../lib/ritblad';
import { useMinWidth } from '../lib/useMinWidth';
import { useRouteParam } from '../app/router';

/** Maand in de URL (`/rooster/2026-10`, maandweergave) — spiegel van de
 *  kalendermaand; een ongeldige waarde wordt genegeerd. */
const MAAND_PARAM = /^\d{4}-(0[1-9]|1[0-2])$/;
const maandUitParam = (p: string | null): Date | null =>
  p && MAAND_PARAM.test(p) ? new Date(Number(p.slice(0, 4)), Number(p.slice(5, 7)) - 1, 1) : null;
const maandNaarParam = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/**
 * Dagdeel-chip. Stond met alle drie op 'slate': dezelfde grijze badge voor
 * Vroeg, Middag en Laat, dus de kleur droeg geen informatie en kostte alleen
 * breedte. De tinten volgen nu het moment van de dag — gedempt, want het is
 * een terzijde naast het dienstnummer, geen statusmelding.
 */
const CATEGORY_PILL: Record<string, { label: string; tone: 'amber' | 'emerald' | 'slate' }> = {
  ochtend: { label: 'Vroeg', tone: 'amber' },
  middag: { label: 'Middag', tone: 'slate' },
  avond: { label: 'Laat', tone: 'emerald' },
};

/**
 * Breekpunt als React-state (Tailwind `xl` = 1280 px). Onder `xl` kiest de
 * chauffeur lijst óf maand; daarboven staan ze naast elkaar. Lokaal — een
 * gedeelde useMediaQuery ontbreekt nog in src/lib.
 */

type GroupedShift = {
  key: string;
  date: string;
  line: string;
  segments: Shift[];
  earliestStart: string;
  hasConflict: boolean;
  /** Eigen openstaande ruilaanvraag (pending/accepted) voor deze dienst. */
  openSwap?: SwapRequest;
};

const formatShiftDate = (date: string) =>
  new Date(`${date}T00:00:00`).toLocaleDateString('nl-BE', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });


/** Badge-tekst voor een dienst waarvoor een eigen ruilaanvraag loopt. */
const openSwapLabel = (swap: SwapRequest) => {
  if (swap.status === 'accepted') return 'Collega akkoord — wacht op planner';
  return swap.swapType === 'overname' ? 'Overname aangevraagd' : 'Ruil aangevraagd';
};

/**
 * Toon van diezelfde badge, volgens de kleurtaal van StatusBadge: amber =
 * wacht op de collega, blauw = collega akkoord en wacht op de planner.
 * Stond hardgecodeerd op amber, waardoor één en dezelfde ruil hier amber was
 * en in de ruillijst blauw. Amber betekent elders "wacht op collega", dus de
 * chauffeur las de verkeerde fase.
 */
const openSwapTone = (swap: SwapRequest) => (swap.status === 'accepted' ? 'blue' : 'amber');

export function ScheduleView({ notes = [], user, shifts: allShifts, leaveRequests = [], swaps = [], isInitialLoad = false, lastSyncedAt = null, onRequestSwap }: { user: User; shifts: Shift[]; users: User[]; notes?: Array<{ date: string; note: string }>; leaveRequests?: LeaveRequest[]; swaps?: SwapRequest[]; isInitialLoad?: boolean; lastSyncedAt?: number | null; onRequestSwap?: (shiftId: string) => void }) {
  const [showPast, setShowPast] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  // Lijst of maandgrid — de keuze blijft bewaard (localStorage kan in
  // privacy-modus geblokkeerd zijn, vandaar de try/catch).
  // Maand in de URL: een gedeelde link (`/rooster/2026-10`) opent meteen de
  // maandweergave op die maand, ook als de bewaarde keuze "lijst" is.
  const [maandParam, zetMaandParam] = useRouteParam(0);
  const [weergave, setWeergaveState] = useState<'lijst' | 'maand'>(() => {
    if (maandUitParam(maandParam)) return 'maand';
    try {
      return window.localStorage.getItem('vhb-rooster-weergave') === 'maand' ? 'maand' : 'lijst';
    } catch {
      return 'lijst';
    }
  });
  const setWeergave = (w: 'lijst' | 'maand') => {
    setWeergaveState(w);
    try { window.localStorage.setItem('vhb-rooster-weergave', w); } catch { /* niet erg */ }
  };
  // Vanaf xl staan lijst en maandkalender naast elkaar; de schakelaar is dan
  // overbodig (de bewaarde keuze blijft gelden zodra het scherm weer smaller is).
  const xl = useMinWidth(1280);
  const toonLijst = xl || weergave === 'lijst';
  const toonMaand = xl || weergave === 'maand';

  // Strict eigen diensten; voor het overzicht van alle chauffeurs gaat
  // planner/admin naar Beheer Roosters.
  const myShifts = useMemo(
    () => allShifts.filter((s) => s.driverId === user.id),
    [allShifts, user.id],
  );

  // Set van shift-IDs met een verlofconflict (chauffeur staat ingepland
  // op een dag waarop hij goedgekeurd verlof heeft). Rendert als rode flag.
  const conflictIds = useMemo(
    () => shiftIdsWithConflict(myShifts, leaveRequests),
    [myShifts, leaveRequests],
  );

  // Eigen openstaande ruilaanvragen per shift-id: de chauffeur ziet zo in het
  // rooster meteen welke dienst al "te ruil" staat (en de knop verdwijnt —
  // de server weigert een tweede verzoek voor dezelfde dienst toch met 409).
  const openSwapByShiftId = useMemo(() => {
    const map = new Map<string, SwapRequest>();
    for (const s of swaps) {
      if (s.requesterId !== user.id) continue;
      if (s.status !== 'pending' && s.status !== 'accepted') continue;
      map.set(s.shiftId, s);
    }
    return map;
  }, [swaps, user.id]);

  // Groepeer per (datum + dienstnummer) zodat multi-segment diensten
  // (bv. dienst 2304 met 3 blokken) als één kaart met meerdere
  // tijdsvensters tonen i.p.v. drie aparte cards.
  const grouped = useMemo<GroupedShift[]>(() => {
    const byKey = new Map<string, GroupedShift>();
    for (const s of myShifts) {
      const key = `${s.date}__${serviceNumberOf(s)}`;
      const hasConflict = conflictIds.has(s.id);
      const openSwap = openSwapByShiftId.get(s.id);
      const existing = byKey.get(key);
      if (existing) {
        existing.segments.push(s);
        if (s.startTime.localeCompare(existing.earliestStart) < 0) {
          existing.earliestStart = s.startTime;
        }
        if (hasConflict) existing.hasConflict = true;
        if (openSwap && !existing.openSwap) existing.openSwap = openSwap;
      } else {
        byKey.set(key, {
          key,
          date: s.date,
          line: serviceNumberOf(s),
          segments: [s],
          earliestStart: s.startTime,
          hasConflict,
          openSwap,
        });
      }
    }
    // Sorteer segmenten chronologisch binnen elke groep
    for (const g of byKey.values()) {
      g.segments.sort((a, b) => a.startTime.localeCompare(b.startTime));
    }
    return Array.from(byKey.values()).sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.earliestStart.localeCompare(b.earliestStart),
    );
    // conflictIds zit in de body: zonder deze dep blijven de verlof-conflict-
    // vlaggen stale wanneer alleen leaveRequests (en dus conflictIds) wijzigt.
  }, [myShifts, conflictIds, openSwapByShiftId]);

  // Splits toekomst / vandaag / verleden — chauffeur wil toekomst zien.
  // isoDate = lokale tijd; toISOString() gaf in BE 's nachts de UTC-dag
  // (off-by-one), waardoor 'vandaag' soms in 'verleden' belandde.
  const today = isoDate(new Date());
  const upcoming = grouped.filter((g) => g.date >= today);
  const past = grouped.filter((g) => g.date < today).reverse();

  // Gedeelde export (src/lib/roosterIcs.ts) — ook gebruikt door Instellingen.
  const exportToICS = () => downloadRoosterIcs(user.name, myShifts);

  return (
    <PageShell>
      <PageHeader
        title="Mijn rooster"
        description={
          upcoming.length > 0
            ? `${upcoming.length} ${upcoming.length === 1 ? 'aankomende dienst' : 'aankomende diensten'}.`
            : 'Overzicht van je komende diensten.'
        }
        actions={
          <Button
            variant="secondary"
            icon={<CalendarPlus size={16} className="text-oker-500" />}
            onClick={() => setCalendarOpen(true)}
          >
            Aan agenda toevoegen
          </Button>
        }
      />

      <div className="-mt-2 flex flex-wrap items-center justify-between gap-3 xl:justify-end">
        {/* Weergave-wissel: lijst (default) of persoonlijk maandgrid — alleen
            onder xl; daarboven staan beide naast elkaar. */}
        {/* Gedeelde .glass-segmented-rail, zoals Dienstoverzicht,
            Gebruikersbeheer en Planningscodes. Stond hier als eigen witte
            variant met een andere radius en padding — de enige toggle in de
            app die er anders uitzag. */}
        <div className="glass-segmented inline-flex rounded-2xl p-1 xl:hidden">
          {(['lijst', 'maand'] as const).map((w) => (
            /* rauw: segmented control op de glass-rail, klassen via segItemClass */
            <button
              key={w}
              type="button"
              onClick={() => setWeergave(w)}
              className={segItemClass(weergave === w, 'capitalize')}
            >
              {w}
            </button>
          ))}
        </div>
        {lastSyncedAt && (
          <p className="text-2xs font-medium text-slate-500 tabular-nums">Bijgewerkt om {formatSyncedTime(lastSyncedAt)} · sleep omlaag om te verversen</p>
        )}
      </div>

      <CalendarSubscribeModal open={calendarOpen} onClose={() => setCalendarOpen(false)} onDownload={exportToICS} />

      {isInitialLoad ? (
        <Card padding="none" className="overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i}>
              <SkeletonRow className="border-b border-slate-100 last:border-0" />
            </div>
          ))}
        </Card>
      ) : upcoming.length === 0 && past.length === 0 ? (
        <EmptyState title="Nog geen diensten gepland" message="Zodra de planner het rooster publiceert, verschijnen je diensten hier — je krijgt er een melding van." />
      ) : (
        /* xl+: lijst links, maandkalender rechts (elk 50 %). De lijst gebruikt
           dan de compacte kaartvorm — de brede tabel past niet in een halve
           kolom. Daaronder: één van beide, via de schakelaar hierboven. */
        <div className={cn(xl && 'grid grid-cols-2 items-start gap-5')}>
          {toonLijst && (
            <div>
              {/* Toekomst */}
              {upcoming.length > 0 && (
                <ShiftList shifts={upcoming} today={today} noteFor={(d) => notes.find((n) => n.date === d)?.note} onRequestSwap={onRequestSwap} compact={xl} />
              )}

              {/* Verleden — collapsed by default */}
              {past.length > 0 && (
                <div className="mt-6">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-3"
                    onClick={() => setShowPast((v) => !v)}
                    icon={<ChevronDown size={14} className={cn('transition-transform', showPast && 'rotate-180')} />}
                  >
                    {showPast ? 'Verberg' : 'Toon'} verleden ({past.length})
                  </Button>
                  {showPast && (
                    <div className="mt-4 opacity-60">
                      <ShiftList shifts={past} today={today} compact={xl} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
          {toonMaand && (
            <MonthCalendar
              groups={grouped}
              today={today}
              leaves={leaveRequests.filter((l) => l.userId === user.id)}
              noteFor={(d) => notes.find((n) => n.date === d)?.note}
              onRequestSwap={onRequestSwap}
              maandParam={maandParam}
              onMaandParam={zetMaandParam}
            />
          )}
        </div>
      )}
    </PageShell>
  );
}

// --- Subcomponent: persoonlijk maandgrid (diensten + verlof + typedagen) ---

function MonthCalendar({
  groups,
  today,
  leaves,
  noteFor,
  onRequestSwap,
  maandParam,
  onMaandParam,
}: {
  groups: GroupedShift[];
  today: string;
  leaves: LeaveRequest[];
  noteFor: (date: string) => string | undefined;
  onRequestSwap?: (shiftId: string) => void;
  /** Maand uit de URL (`YYYY-MM` of null) en de schrijver ervan (replace). */
  maandParam: string | null;
  onMaandParam: (waarde: string | null) => void;
}) {
  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return maandUitParam(maandParam) ?? new Date(now.getFullYear(), now.getMonth(), 1);
  });
  // Maand → URL (replace, geen extra history-entry); de state blijft de bron.
  // De huidige maand geeft een schone URL zonder parameter.
  const monthParam = maandNaarParam(viewMonth);
  useEffect(() => {
    const gewenst = monthParam === maandNaarParam(new Date()) ? null : monthParam;
    if ((maandParam ?? null) !== gewenst) onMaandParam(gewenst);
  }, [monthParam, maandParam, onMaandParam]);
  const [selected, setSelected] = useState<string>(today);

  // Planning-horizon: de periode waarvoor er überhaupt planning voor deze
  // chauffeur is ingelezen. Daarbuiten weten we niets — een maand die nog niet
  // geïmporteerd is mag er niet uitzien als één grote vrije maand, dus daar
  // markeren we niets. Bínnen de horizon betekent "geen dienst en geen verlof"
  // gewoon vrij, precies zoals het bord in het chauffeurslokaal het toont.
  const planningRange = useMemo(() => {
    if (groups.length === 0) return null;
    let van = groups[0].date;
    let tot = groups[0].date;
    for (const g of groups) {
      if (g.date < van) van = g.date;
      if (g.date > tot) tot = g.date;
    }
    return { van, tot };
  }, [groups]);
  const isVrijeDag = (iso: string) => !!planningRange && iso >= planningRange.van && iso <= planningRange.tot;

  const year = viewMonth.getFullYear();
  const monthIndex = viewMonth.getMonth();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const monthName = viewMonth.toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' });
  const dateIso = (day: number) => `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  // Maandag-eerst: JS-zondag (0) wordt kolom 7.
  const leadingBlanks = (new Date(year, monthIndex, 1).getDay() + 6) % 7;

  const groupsByDate = useMemo(() => {
    const map = new Map<string, GroupedShift[]>();
    for (const g of groups) {
      const list = map.get(g.date);
      if (list) list.push(g);
      else map.set(g.date, [g]);
    }
    return map;
  }, [groups]);

  // Verlof per dag; goedgekeurd wint van aangevraagd als beide de dag raken.
  const leaveFor = (iso: string): LeaveRequest | undefined => {
    const hits = leaves.filter(
      (l) => (l.status === 'approved' || l.status === 'pending') && l.startDate <= iso && l.endDate >= iso,
    );
    return hits.find((l) => l.status === 'approved') ?? hits[0];
  };

  const selectedGroups = groupsByDate.get(selected) ?? [];
  const selectedLeave = leaveFor(selected);
  const selectedNote = noteFor(selected);
  const selectedTypedag = typedagLabel(selected);

  return (
    <div className="space-y-4">
      {/* p-3 op mobiel i.p.v. p-4: op 375px kwamen de dagcellen anders op ~41px
          breed uit — hoog genoeg (52px) maar te smal voor een betrouwbare tik
          met een duim, en net boven de 40px-drempel van het auditscript, dus
          het glipte er structureel doorheen. Met de kleinere gap erbij zitten
          ze op ~44px. */}
      <Card padding="none" className="p-3 md:p-4">
        <MaandNavigatie
          className="justify-between"
          label={monthName}
          onVorige={() => setViewMonth(new Date(year, monthIndex - 1, 1))}
          onVolgende={() => setViewMonth(new Date(year, monthIndex + 1, 1))}
        />

        {/* Grid */}
        <div className="mt-3 grid grid-cols-7 gap-0.5 md:gap-1">
          {WEEKDAY_SHORT_MON.map((d) => (
            <div key={d} className={cn(microLabelClass, 'py-1 text-center')}>
              {d}
            </div>
          ))}
          {Array.from({ length: leadingBlanks }).map((_, i) => (
            <div key={`blank-${i}`} />
          ))}
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map((day) => {
            const iso = dateIso(day);
            const dayGroups = groupsByDate.get(iso) ?? [];
            const leave = leaveFor(iso);
            const td = typedagLabel(iso);
            const isSelected = iso === selected;
            const isToday = iso === today;
            const conflict = dayGroups.some((g) => g.hasConflict);

            return (
              /* rauw: kalender-dagcel (dagnummer + dienst/verlof-markering) */
              <button
                key={day}
                type="button"
                onClick={() => setSelected(iso)}
                aria-label={`${iso}${dayGroups.length > 0 ? ', dienst' : ''}${leave ? ', verlof' : ''}`}
                className={cn(
                  'flex min-h-[52px] flex-col items-center gap-0.5 rounded-xl px-0.5 py-1.5 transition-colors',
                  !isSelected && 'hover:bg-surface-soft-hover',
                  isSelected && 'bg-oker-500/15 ring-1 ring-oker-400',
                  !isSelected && isToday && 'ring-1 ring-oker-300',
                  !isSelected && leave && leaveDayTint(leave.status, leave.type),
                )}
              >
                <span className={cn('text-xs font-semibold tabular-nums leading-none', isToday ? 'text-oker-700' : 'text-slate-700')}>
                  {day}
                </span>
                {td && td.kort === 'F' && (
                  <span className="text-2xs font-bold leading-none text-oker-700" title={td.titel}>
                    {td.kort}
                  </span>
                )}
                {dayGroups.length > 0 ? (
                  <span className={cn('max-w-full truncate text-2xs font-mono font-bold tabular-nums leading-none', conflict ? 'text-red-700' : 'text-oker-700')}>
                    {dayGroups[0].line}
                    {dayGroups.length > 1 && '+'}
                  </span>
                ) : leave ? (
                  <span
                    className={cn(
                      'h-1.5 w-1.5 rounded-full',
                      leaveDot(leave.status, leave.type),
                    )}
                  />
                ) : isVrijeDag(iso) ? (
                  <span className="text-2xs font-bold lowercase leading-none text-slate-500" title="Vrij — geen dienst ingepland">
                    v
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        {/* Legende */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-2xs font-medium text-slate-500">
          <span className="inline-flex items-center gap-1.5"><span className="text-2xs font-mono font-bold tabular-nums text-oker-700">2101</span> dienst</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> verlof</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> aangevraagd</span>
          <span className="inline-flex items-center gap-1.5"><span className="text-2xs font-bold text-oker-700">F</span> feestdag</span>
          <span className="inline-flex items-center gap-1.5"><span className="text-2xs font-bold text-slate-500">v</span> vrij</span>
        </div>
      </Card>

      {/* Detail van de geselecteerde dag */}
      <Card padding="sm">
        <MicroLabel className={cn('tabular-nums', selected === today && 'text-oker-700')}>
          {selected === today ? 'Vandaag' : `Wk ${isoWeekOf(selected)}`}
        </MicroLabel>
        <p className="mt-0.5 text-sm font-semibold capitalize text-slate-900">{formatShiftDate(selected)}</p>
        {selectedTypedag && (
          <p className={cn('mt-0.5 text-2xs font-semibold', selectedTypedag.kort === 'F' ? 'text-oker-700' : 'text-slate-500')}>
            {selectedTypedag.titel}
          </p>
        )}

        {selectedLeave && (
          <p
            className={cn(
              'mt-2.5 rounded-xl px-3 py-2 text-xs font-semibold',
              leaveChip(selectedLeave.status, selectedLeave.type),
            )}
          >
            {formatLeaveType(selectedLeave.type)}
            {selectedLeave.status === 'pending' && ' — aangevraagd, wacht op de planner'}
          </p>
        )}

        {selectedGroups.length === 0 && !selectedLeave ? (
          <p className="mt-2.5 text-sm text-slate-500">Geen dienst gepland.</p>
        ) : (
          selectedGroups.map((g) => (
            <div key={g.key} className="mt-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-mono font-semibold tabular-nums text-oker-700">{g.line}</span>
                {g.hasConflict && (
                  <Badge tone="red" icon={<AlertTriangle size={12} />}>Verlof-conflict</Badge>
                )}
                {g.openSwap && (
                  <Badge tone={openSwapTone(g.openSwap)} icon={<ArrowLeftRight size={12} />}>{openSwapLabel(g.openSwap)}</Badge>
                )}
              </div>
              <div className="mt-1.5 space-y-1.5 pl-1">
                {g.segments.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 text-sm">
                    <Clock size={12} className="shrink-0 text-slate-400" />
                    <span className="font-mono font-medium tabular-nums text-slate-700">
                      {s.startTime} – {s.endTime}
                    </span>
                    {s.loopnr && <Chip>loop {s.loopnr}</Chip>}
                  </div>
                ))}
              </div>
            </div>
          ))
        )}

        {selectedNote && (
          <p className="mt-2.5 rounded-xl bg-oker-500/10 px-3 py-2 text-xs font-medium leading-snug text-oker-800">
            {selectedNote}
          </p>
        )}

        {selected === today && selectedGroups.length > 0 && (
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => void openHuidigRitblad()} icon={<FileText size={14} className="text-oker-500" />}>
            Ritblad van vandaag
          </Button>
        )}
        {onRequestSwap && selected >= today && selectedGroups.length > 0 && !selectedGroups.some((g) => g.hasConflict || g.openSwap) && (
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => onRequestSwap(selectedGroups[0].segments[0].id)} icon={<ArrowLeftRight size={14} className="text-oker-500" />}>
            Deze dienst ruilen
          </Button>
        )}
      </Card>
    </div>
  );
}

// --- Subcomponent: gedeelde lijst voor toekomst en verleden ---

function ShiftList({ shifts, today, noteFor, onRequestSwap, compact = false }: { shifts: GroupedShift[]; today: string; noteFor?: (date: string) => string | undefined; onRequestSwap?: (shiftId: string) => void; /** Altijd de kaartvorm (halve kolom naast de maandkalender op xl). */ compact?: boolean }) {
  return (
    <>
      {/* Desktop tabel */}
      <TableShell className={compact ? 'hidden' : 'hidden md:block'}>
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-slate-50/50">
              <Th className="px-6 py-4">Datum</Th>
              <Th className="px-6 py-4">Dienst</Th>
              <Th className="px-6 py-4">Uren</Th>
              {onRequestSwap && <Th className="px-6 py-4 text-right">Actie</Th>}
            </tr>
          </thead>
          <tbody>
            {shifts.map((g) => {
              const isToday = g.date === today;
              const cat = shiftCategory(g.earliestStart);
              const pill = CATEGORY_PILL[cat];

              return (
                <tr
                  key={g.key}
                  className={cn(
                    'hover:bg-slate-50/60 transition-colors group border-t border-slate-100',
                    isToday && 'bg-oker-50/30',
                    g.hasConflict && 'bg-red-50/40 hover:bg-red-50/60',
                  )}
                >
                  <Td className="px-6 py-4">
                    <div className="space-y-1">
                      <p className={cn('font-semibold tabular-nums', isToday ? 'text-oker-700' : 'text-slate-800')}>
                        {formatShiftDate(g.date)}
                      </p>
                      <div className="flex items-center gap-2 flex-wrap">
                        {isToday && <Badge tone="oker">Vandaag</Badge>}
                        {g.hasConflict && (
                          <span title="Je staat ingepland terwijl je verlof goedgekeurd is. Neem contact op met de planner.">
                            <Badge tone="red" icon={<AlertTriangle size={12} />}>Verlof-conflict</Badge>
                          </span>
                        )}
                        {g.openSwap && (
                          <Badge tone={openSwapTone(g.openSwap)} icon={<ArrowLeftRight size={12} />}>{openSwapLabel(g.openSwap)}</Badge>
                        )}
                      </div>
                    </div>
                  </Td>
                  <Td className="px-6 py-4">
                    <div className="inline-flex items-center gap-2">
                      <Badge tone={pill.tone}>{pill.label}</Badge>
                      <span className="text-lg font-mono font-semibold text-oker-700 tabular-nums">{g.line}</span>
                      {g.segments.length > 1 && (
                        <span className="text-2xs font-medium text-slate-500 tabular-nums">
                          ({g.segments.length} blokken)
                        </span>
                      )}
                    </div>
                  </Td>
                  <Td className="px-6 py-4">
                    <div className="space-y-1">
                      {g.segments.map((s) => (
                        <div key={s.id} className="flex items-center gap-3 font-medium text-slate-700">
                          <Clock size={14} className="text-oker-400 shrink-0" />
                          <span className="font-mono tabular-nums">
                            {s.startTime} – {s.endTime}
                          </span>
                          {s.loopnr && <Chip>loop {s.loopnr}</Chip>}
                        </div>
                      ))}
                    </div>
                  </Td>
                  {onRequestSwap && (
                    <Td className="px-6 py-4 text-right">
                      {/* Loopt er al een aanvraag, dan geen tweede knop — de
                          server weigert die toch (één open ruil per dienst). */}
                      {!g.openSwap && (
                        <Button variant="ghost" size="sm" icon={<ArrowLeftRight size={14} />} onClick={() => onRequestSwap(g.segments[0].id)}>
                          Ruilen
                        </Button>
                      )}
                    </Td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableShell>

      {/* Mobile cards — compacter (en de lijstvorm naast de kalender op xl) */}
      <div className={cn('space-y-3', !compact && 'md:hidden')}>
        {shifts.map((g) => {
          const isToday = g.date === today;
          const cat = shiftCategory(g.earliestStart);
          const pill = CATEGORY_PILL[cat];

          return (
            <Card
              key={g.key}
              padding="sm"
              className={cn(
                isToday && 'ring-2 ring-oker-300',
                g.hasConflict && 'ring-2 ring-red-300 bg-red-50/30',
              )}
            >
              {/* Datum + dienst-pill */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                  <MicroLabel className={cn(isToday && 'text-oker-700')}>
                    {isToday ? 'Vandaag' : formatShortDayPadded(g.date).split(' ')[0]}
                  </MicroLabel>
                  <p className="text-sm font-semibold text-slate-900 mt-0.5 tabular-nums">
                    {formatShortDayPadded(g.date).split(' ').slice(1).join(' ')}
                  </p>
                  {g.hasConflict && (
                    <div className="mt-1">
                      <Badge tone="red" icon={<AlertTriangle size={12} />}>
                        Verlof-conflict
                      </Badge>
                      <p className="text-2xs font-medium text-red-700 mt-1">Je hebt hier verlof — bel de planner.</p>
                    </div>
                  )}
                  {g.openSwap && (
                    <div className="mt-1">
                      <Badge tone={openSwapTone(g.openSwap)} icon={<ArrowLeftRight size={12} />}>{openSwapLabel(g.openSwap)}</Badge>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge tone={pill.tone}>{pill.label}</Badge>
                  <span className="text-base font-mono font-semibold text-oker-700 tabular-nums">{g.line}</span>
                </div>
              </div>

              {/* Segmenten */}
              <div className="space-y-1.5 pl-1">
                {g.segments.map((s) => (
                  <div key={s.id} className="flex items-center gap-2 text-sm">
                    <Clock size={12} className="text-slate-400 shrink-0" />
                    <span className="font-mono font-medium text-slate-700 tabular-nums">
                      {s.startTime} – {s.endTime}
                    </span>
                    {s.loopnr && <Chip>loop {s.loopnr}</Chip>}
                  </div>
                ))}
              </div>

              {noteFor?.(g.date) && (
                <p className="mt-2.5 rounded-xl bg-oker-500/10 px-3 py-2 text-xs font-medium leading-snug text-oker-800">
                  {noteFor(g.date)}
                </p>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {onRequestSwap && !g.hasConflict && !g.openSwap && (
                  <Button variant="secondary" size="sm" onClick={() => onRequestSwap(g.segments[0].id)} icon={<ArrowLeftRight size={14} className="text-oker-500" />}>
                    Deze dienst ruilen
                  </Button>
                )}
                {/* Alleen bij vandaag: er is één actueel ritblad, geen blad
                    per dienst — bij een dienst van volgende week zou deze knop
                    suggereren dat het dát blad is. */}
                {isToday && (
                  <Button variant="secondary" size="sm" onClick={() => void openHuidigRitblad()} icon={<FileText size={14} className="text-oker-500" />}>
                    Ritblad van vandaag
                  </Button>
                )}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
