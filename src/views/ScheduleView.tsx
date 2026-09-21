import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeftRight, Clock, CalendarPlus, ChevronDown, FileText, Phone } from 'lucide-react';
import { isStaf, type LeaveRequest, type Shift, type SwapRequest, type User } from '../types';
import { isoWeekOf } from '../lib/week';
import { typedagLabel } from '../lib/typedag';
import { leaveChip, leaveDayTint, leaveDot } from '../lib/statusColors';
import { formatLeaveType, serviceNumberOf } from '../lib/format';
import { geruildeDiensten, ruilBadgeLabel, ruilSleutel, type RuilBadge } from '../lib/ruilBadge';
import { EmptyState, PageHeader, PageShell } from '../components/ui';
import { Badge, Button, Chip, MicroLabel, microLabelClass, Segmented, TableShell, Td, Th } from '../components/primitives';
import { Uitklap, uitklapChevron } from '../components/Uitklap';
import { Card } from '../components/Card';
import { MaandNavigatie, MaandWissel } from '../components/MaandNavigatie';
import { useMaandVeeg } from '../lib/useMaandVeeg';
import { CalendarSubscribeModal } from '../components/CalendarSubscribeModal';
import { ActieMenu } from '../components/ActieMenu';
import { SkeletonRow } from '../components/Skeleton';
import { cn, telHref } from '../lib/ui';
import { shiftIdsWithConflict } from '../lib/conflicts';
import { isoDate } from '../lib/availability';
import { formatDuration } from '../lib/shiftTime';
import { berekenRoosterUren, formatUren, minutenPerDag } from '../lib/roosterUren';
import { spiegelStartscherm } from '../lib/dashboardVoorkeuren';
import { formatShortDayPadded, formatSyncedTime, WEEKDAY_SHORT_MON } from '../lib/format';
import { downloadRoosterIcs } from '../lib/roosterIcs';
import { openHuidigRitblad } from '../lib/ritblad';
import { useMinWidth } from '../lib/useMinWidth';
import { navigeer, useRouteParam } from '../app/router';
import { LegeLijst } from '../components/illustraties';

/** Maand in de URL (`/rooster/2026-10`, maandweergave) — spiegel van de
 *  kalendermaand; een ongeldige waarde wordt genegeerd. */
const MAAND_PARAM = /^\d{4}-(0[1-9]|1[0-2])$/;
const maandUitParam = (p: string | null): Date | null =>
  p && MAAND_PARAM.test(p) ? new Date(Number(p.slice(0, 4)), Number(p.slice(5, 7)) - 1, 1) : null;
const maandNaarParam = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

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
  /** Doorgevoerde ruil die deze dienst bij de chauffeur bracht ("Geruild met X"). */
  geruild?: RuilBadge;
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
  if (swap.status === 'accepted') return 'Collega akkoord, wacht op planner';
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

/**
 * Uitweg bij een verlof-conflict (punt 15): "bel de planner" stond er als
 * zin zonder knop. Nu een belknop naar het planningsnummer (de eerste planner,
 * anders beheerder, met een nummer in de contacten) of, zonder nummer, de
 * weg naar Contacten, plus de dienstruil zodat een collega de dienst kan
 * overnemen.
 */
function ConflictUitweg({ planningTel, onRuil }: { planningTel?: string; onRuil: () => void }) {
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      {planningTel ? (
        <Button variant="secondary" size="sm" icon={<Phone size={14} />} onClick={() => { window.location.href = planningTel; }}>
          Bel de planning
        </Button>
      ) : (
        <Button variant="secondary" size="sm" icon={<Phone size={14} />} onClick={() => navigeer('contacten')}>
          Contacten
        </Button>
      )}
      <Button variant="ghost" size="sm" icon={<ArrowLeftRight size={14} />} onClick={onRuil}>
        Open dienstruil
      </Button>
    </div>
  );
}

/** tel:-link naar de planning: eerste planner met nummer, anders beheerder. */
const planningTelefoon = (users: User[]): string | undefined => {
  const kandidaat = users.find((u) => u.role === 'planner' && u.phone?.trim()) ?? users.find((u) => u.role === 'admin' && u.phone?.trim());
  return telHref(kandidaat?.phone);
};

export function ScheduleView({ notes = [], user, shifts: allShifts, users = [], leaveRequests = [], swaps = [], isInitialLoad = false, lastSyncedAt = null, onRequestSwap }: { user: User; shifts: Shift[]; users: User[]; notes?: Array<{ date: string; note: string }>; leaveRequests?: LeaveRequest[]; swaps?: SwapRequest[]; isInitialLoad?: boolean; lastSyncedAt?: number | null; onRequestSwap?: (shiftId: string) => void }) {
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
  // Doorgevoerde ruilen per (datum, dienstnummer): de badge "Geruild met X"
  // op de dienst die je van een collega overnam (vraag Jarno 12-09). Bewust
  // op datum + dienst, niet op shift-id: die verandert bij elke import.
  const geruild = useMemo(() => geruildeDiensten(user.id, swaps, users), [swaps, users, user.id]);

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
          geruild: geruild.get(ruilSleutel(s.date, serviceNumberOf(s))),
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
  }, [myShifts, conflictIds, openSwapByShiftId, geruild]);

  // Splits toekomst / vandaag / verleden — chauffeur wil toekomst zien.
  // isoDate = lokale tijd; toISOString() gaf in BE 's nachts de UTC-dag
  // (off-by-one), waardoor 'vandaag' soms in 'verleden' belandde.
  const today = isoDate(new Date());
  const upcoming = grouped.filter((g) => g.date >= today);
  const past = grouped.filter((g) => g.date < today).reverse();

  // Geplande uren deze week/maand (punt 15): afgeleid uit de dienstvensters,
  // geen loonberekening (src/lib/roosterUren.ts); de strook zegt dat ook.
  // Alleen voor staf: chauffeurs zagen hier een weektotaal dat als
  // gepresteerde tijd gelezen werd, terwijl het de geplande dienstvensters
  // zijn. Planner/admin houden het (ook per chauffeur in Planning →
  // maandoverzicht).
  const uren = useMemo(() => berekenRoosterUren(myShifts, today), [myShifts, today]);
  const toonUren = isStaf(user.role);
  const planningTel = useMemo(() => planningTelefoon(users), [users]);
  // Startscherm-voorkeur naar de lokale kopie (router leest die bij de start).
  useEffect(() => { spiegelStartscherm(user); }, [user]);

  // Gedeelde export (src/lib/roosterIcs.ts) — ook gebruikt door Instellingen.
  const exportToICS = () => downloadRoosterIcs(user.name, myShifts);

  return (
    <PageShell>
      <PageHeader
        title="Mijn rooster"
        description={
          upcoming.length > 0
            ? `${upcoming.length} ${upcoming.length === 1 ? 'aankomende dienst' : 'aankomende diensten'}.`
            : 'Persoonlijk overzicht van je komende diensten.'
        }
        actions={
          /* Geen kopknop voor de agenda-koppeling: dat is een eenmalige
             instelling, geen dagelijkse handeling — ze zit in het actiemenu,
             samen met het ritblad van vandaag (afwerking 04-09, nr. 7). */
          <ActieMenu
            label="Meer acties"
            // ml-auto: op mobiel staat de kop-actie links onder de titel en
            // klapte het menu (rechts uitgelijnd) buiten beeld.
            className="ml-auto"
            items={[

              ...(upcoming.some((g) => g.date === today)
                ? [{ label: 'Ritblad van vandaag', icon: <FileText size={16} />, onClick: () => void openHuidigRitblad() }]
                : []),
              { label: 'Aan agenda toevoegen', icon: <CalendarPlus size={16} />, onClick: () => setCalendarOpen(true) },
            ]}
          />
        }
      />

      <div className="-mt-2 flex flex-wrap items-center justify-between gap-3 xl:justify-end">
        {/* Weergave-wissel: lijst (default) of persoonlijk maandgrid — alleen
            onder xl; daarboven staan beide naast elkaar. */}
        {/* Gedeelde .glass-segmented-rail, zoals Dienstoverzicht,
            Gebruikersbeheer en Planningscodes. Stond hier als eigen witte
            variant met een andere radius en padding — de enige toggle in de
            app die er anders uitzag. */}
        <Segmented
          label="Weergave"
          className="xl:hidden"
          itemClassName="capitalize"
          waarde={weergave}
          opties={[{ waarde: 'lijst' as const, label: 'lijst' }, { waarde: 'maand' as const, label: 'maand' }]}
          onChange={setWeergave}
        />
        {lastSyncedAt && (
          <p className="text-xs font-medium text-slate-500 tabular-nums">Bijgewerkt om {formatSyncedTime(lastSyncedAt)}{/* De sleep-hint alleen waar je kán slepen: met een muis stond hier een instructie die niet werkt. */}<span className="pointer-fine:hidden"> · sleep naar beneden om te vernieuwen</span></p>
        )}
      </div>

      {/* Stille urenstrook: geen kaart, één regel micro-tekst. Het label
          "geplande uren, geen loonberekening" is verplicht: dit zijn de
          dienstvensters uit de planning, geen gepresteerde of betaalde uren. */}
      {toonUren && !isInitialLoad && myShifts.length > 0 && (
        <p className="-mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-0.5" aria-label="Geplande uren">
          <span className="text-xs font-semibold text-slate-600 tabular-nums">
            deze week {formatUren(uren.weekMinuten)} · deze maand {formatUren(uren.maandMinuten)} · {uren.maandDienstdagen} {uren.maandDienstdagen === 1 ? 'dag' : 'dagen'} met dienst
          </span>
          <span className="sr-only">, </span>
          {/* Gewone metatekst: in hoofdletters schreeuwde deze voetnoot harder dan de uren zelf. */}
          <span className="text-xs font-medium text-slate-500">geplande uren, geen loonberekening</span>
        </p>
      )}

      <CalendarSubscribeModal open={calendarOpen} onClose={() => setCalendarOpen(false)} onDownload={exportToICS} />

      {isInitialLoad ? (
        <Card padding="none" className="overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i}>
              <SkeletonRow className="border-b border-hairline-subtle last:border-0" />
            </div>
          ))}
        </Card>
      ) : upcoming.length === 0 && past.length === 0 ? (
        <EmptyState illustratie={<LegeLijst />} title="Nog geen diensten gepland" message="Zodra de planner het rooster publiceert, verschijnen je diensten hier, je krijgt er een melding van." />
      ) : (
        /* xl+: lijst links, maandkalender rechts (elk 50 %). De lijst gebruikt
           dan de compacte kaartvorm — de brede tabel past niet in een halve
           kolom. Daaronder: één van beide, via de schakelaar hierboven. */
        <div className={cn(xl && 'grid grid-cols-2 items-start gap-5')}>
          {toonLijst && (
            <div>
              {/* Toekomst */}
              {upcoming.length > 0 && (
                <ShiftList shifts={upcoming} today={today} noteFor={(d) => notes.find((n) => n.date === d)?.note} onRequestSwap={onRequestSwap} compact={xl} planningTel={planningTel} />
              )}

              {/* Verleden — collapsed by default */}
              {past.length > 0 && (
                <div className="mt-6">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="-ml-3"
                    onClick={() => setShowPast((v) => !v)}
                    icon={<ChevronDown size={14} className={uitklapChevron(showPast)} />}
                  >
                    {showPast ? 'Verberg' : 'Toon'} verleden ({past.length})
                  </Button>
                  <Uitklap open={showPast}>
                    <div className="mt-4 opacity-60">
                      <ShiftList shifts={past} today={today} compact={xl} planningTel={planningTel} />
                    </div>
                  </Uitklap>
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
              planningTel={planningTel}
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
  planningTel,
}: {
  groups: GroupedShift[];
  today: string;
  leaves: LeaveRequest[];
  noteFor: (date: string) => string | undefined;
  onRequestSwap?: (shiftId: string) => void;
  /** Maand uit de URL (`YYYY-MM` of null) en de schrijver ervan (replace). */
  maandParam: string | null;
  onMaandParam: (waarde: string | null) => void;
  /** tel:-link naar de planning voor de verlof-conflict-uitweg. */
  planningTel?: string;
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
  // Veeg en pijltjes wisselen de maand met richting (golf 4, punt 11): het
  // raster beweegt op touch met de vinger mee en de nieuwe maand schuift in
  // van de kant waar hij vandaan komt (MaandWissel hieronder).
  const veeg = useMaandVeeg({
    onVorige: () => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1)),
    onVolgende: () => setViewMonth((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1)),
  });

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
  // Geplande minuten per dag voor de tooltip van de dagcel en het detail.
  const minutenOpDag = useMemo(() => minutenPerDag(groups.flatMap((g) => g.segments)), [groups]);

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
        <MaandNavigatie className="justify-between" label={monthName} veeg={veeg} />

        {/* Grid: wisselt van maand met richting en veegt op touch (MaandWissel;
            mt-2 + de 4 px speling van de knip = de oude mt-3). */}
        <MaandWissel sleutel={monthParam} veeg={veeg} className="mt-2">
        <div className="grid grid-cols-7 gap-0.5 md:gap-1">
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
                aria-label={`${iso}${dayGroups.length > 0 ? `, dienst, ${formatDuration(minutenOpDag.get(iso) ?? 0)} gepland` : ''}${leave ? ', verlof' : ''}`}
                title={dayGroups.length > 0 ? `${formatDuration(minutenOpDag.get(iso) ?? 0)} gepland` : undefined}
                className={cn(
                  'flex min-h-[52px] flex-col items-center gap-0.5 rounded-xl px-0.5 py-1.5 transition-colors',
                  !isSelected && 'hover:bg-surface-soft-hover',
                  // Gekozen dag = neutraal (punt 4); "vandaag" houdt de gouden ring, ook als hij gekozen is.
                  // De gouden labels in de cel staan op oker-800: op het neutrale
                  // vlak haalt oker-700 de 4,5 niet (het haalde die op het oude
                  // gouden vlak trouwens ook niet, axe kon het daar alleen niet
                  // meten door de transparantie).
                  isSelected && 'bg-surface-muted ring-1 ring-hairline-strong',
                  isToday && 'ring-1 ring-oker-300',
                  !isSelected && leave && leaveDayTint(leave.status, leave.type),
                )}
              >
                <span className={cn('text-xs font-semibold tabular-nums leading-none', isToday ? 'text-oker-800' : 'text-slate-700')}>
                  {day}
                </span>
                {td && td.kort === 'F' && (
                  <span className="text-xs font-bold leading-none text-oker-800" title={td.titel}>
                    {td.kort}
                  </span>
                )}
                {dayGroups.length > 0 ? (
                  <span className={cn('max-w-full truncate text-xs font-mono font-bold tabular-nums leading-none', conflict ? 'text-red-700' : 'text-oker-800')}>
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
                  <span className="text-xs font-bold lowercase leading-none text-slate-500" title="Vrij, geen dienst ingepland">
                    v
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
        </MaandWissel>

        {/* Legende */}
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-hairline-subtle pt-3 text-xs font-medium text-slate-500">
          <span className="inline-flex items-center gap-1.5"><span className="text-xs font-mono font-bold tabular-nums text-oker-800">2101</span> dienst</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> verlof</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-amber-400" /> aangevraagd</span>
          <span className="inline-flex items-center gap-1.5"><span className="text-xs font-bold text-oker-800">F</span> feestdag</span>
          <span className="inline-flex items-center gap-1.5"><span className="text-xs font-bold text-slate-500">v</span> vrij</span>
        </div>
      </Card>

      {/* Detail van de geselecteerde dag */}
      <Card padding="sm">
        <MicroLabel className={cn('tabular-nums', selected === today && 'text-oker-700')}>
          {selected === today ? 'Vandaag' : `Wk ${isoWeekOf(selected)}`}
        </MicroLabel>
        <p className="mt-0.5 text-md font-semibold capitalize text-slate-900">{formatShiftDate(selected)}</p>
        {selectedTypedag && (
          <p className={cn('mt-0.5 text-xs font-semibold', selectedTypedag.kort === 'F' ? 'text-oker-700' : 'text-slate-500')}>
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
            {selectedLeave.status === 'pending' && ', aangevraagd, wacht op de planner'}
          </p>
        )}

        {selectedGroups.length === 0 && !selectedLeave ? (
          <p className="mt-2.5 text-body-sm text-slate-500">Geen dienst gepland.</p>
        ) : (
          selectedGroups.map((g) => (
            <div key={g.key} className="mt-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-base font-mono font-semibold tabular-nums text-oker-700">{g.line}</span>
                {g.hasConflict && (
                  <Badge tone="red" icon={<AlertTriangle size={12} />}>Verlof-conflict</Badge>
                )}
                {g.openSwap && (
                  <Badge tone={openSwapTone(g.openSwap)} stil icon={<ArrowLeftRight size={12} />}>{openSwapLabel(g.openSwap)}</Badge>
                )}
                {g.geruild && (
                  <Badge tone="amber" stil icon={<ArrowLeftRight size={12} />}>{ruilBadgeLabel(g.geruild)}</Badge>
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
              {g.hasConflict && (
                <ConflictUitweg planningTel={planningTel} onRuil={() => (onRequestSwap ? onRequestSwap(g.segments[0].id) : navigeer('ruil-verzoeken'))} />
              )}
            </div>
          ))
        )}
        {selectedGroups.length > 0 && (
          <p className="mt-2 text-xs font-medium text-slate-500 tabular-nums">{formatDuration(minutenOpDag.get(selected) ?? 0)} gepland</p>
        )}

        {selectedNote && (
          <p className="mt-2.5 rounded-xl bg-oker-500/10 px-3 py-2 text-xs font-medium leading-snug text-oker-800">
            {selectedNote}
          </p>
        )}

        {selected === today && selectedGroups.length > 0 && (
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => void openHuidigRitblad()} icon={<FileText size={14} />}>
            Ritblad van vandaag
          </Button>
        )}
        {onRequestSwap && selected >= today && selectedGroups.length > 0 && !selectedGroups.some((g) => g.hasConflict || g.openSwap) && (
          <Button variant="secondary" size="sm" className="mt-3" onClick={() => onRequestSwap(selectedGroups[0].segments[0].id)} icon={<ArrowLeftRight size={14} />}>
            Deze dienst ruilen
          </Button>
        )}
      </Card>
    </div>
  );
}

// --- Subcomponent: gedeelde lijst voor toekomst en verleden ---

function ShiftList({ shifts, today, noteFor, onRequestSwap, compact = false, planningTel }: { shifts: GroupedShift[]; today: string; noteFor?: (date: string) => string | undefined; onRequestSwap?: (shiftId: string) => void; /** Altijd de kaartvorm (halve kolom naast de maandkalender op xl). */ compact?: boolean; /** tel:-link naar de planning (verlof-conflict-uitweg). */ planningTel?: string }) {
  const ruilUitweg = (g: GroupedShift) => () => (onRequestSwap ? onRequestSwap(g.segments[0].id) : navigeer('ruil-verzoeken'));
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

              return (
                <tr
                  key={g.key}
                  className={cn(
                    'hover:bg-surface-soft-hover transition-colors group border-t border-hairline-subtle',
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
                          <Badge tone={openSwapTone(g.openSwap)} stil icon={<ArrowLeftRight size={12} />}>{openSwapLabel(g.openSwap)}</Badge>
                        )}
                        {g.geruild && (
                          <Badge tone="amber" stil icon={<ArrowLeftRight size={12} />}>{ruilBadgeLabel(g.geruild)}</Badge>
                        )}
                      </div>
                      {g.hasConflict && (
                        <>
                          <p className="text-xs font-medium text-red-700">Je hebt hier verlof, bel de planner.</p>
                          <ConflictUitweg planningTel={planningTel} onRuil={ruilUitweg(g)} />
                        </>
                      )}
                    </div>
                  </Td>
                  <Td className="px-6 py-4">
                    <div className="inline-flex items-center gap-2">
                      <span className="text-lg font-mono font-semibold text-oker-700 tabular-nums">{g.line}</span>
                      {g.segments.length > 1 && (
                        <span className="text-xs font-medium text-slate-500 tabular-nums">
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
                  <p className="text-md font-semibold text-slate-900 mt-0.5">
                    {formatShortDayPadded(g.date).split(' ').slice(1).join(' ')}
                  </p>
                  {g.hasConflict && (
                    <div className="mt-1">
                      <Badge tone="red" icon={<AlertTriangle size={12} />}>
                        Verlof-conflict
                      </Badge>
                      <p className="text-xs font-medium text-red-700 mt-1">Je hebt hier verlof, bel de planner.</p>
                      <ConflictUitweg planningTel={planningTel} onRuil={ruilUitweg(g)} />
                    </div>
                  )}
                  {g.openSwap && (
                    <div className="mt-1">
                      <Badge tone={openSwapTone(g.openSwap)} stil icon={<ArrowLeftRight size={12} />}>{openSwapLabel(g.openSwap)}</Badge>
                    </div>
                  )}
                  {g.geruild && (
                    <div className="mt-1">
                      <Badge tone="amber" stil icon={<ArrowLeftRight size={12} />}>{ruilBadgeLabel(g.geruild)}</Badge>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
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
                  <Button variant="secondary" size="sm" onClick={() => onRequestSwap(g.segments[0].id)} icon={<ArrowLeftRight size={14} />}>
                    Deze dienst ruilen
                  </Button>
                )}
                {/* Alleen bij vandaag: er is één actueel ritblad, geen blad
                    per dienst — bij een dienst van volgende week zou deze knop
                    suggereren dat het dát blad is. */}
                {isToday && (
                  <Button variant="secondary" size="sm" onClick={() => void openHuidigRitblad()} icon={<FileText size={14} />}>
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
