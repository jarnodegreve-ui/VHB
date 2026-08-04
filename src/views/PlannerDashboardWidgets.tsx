import { Fragment, useEffect, useState, type ReactNode } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  Bus,
  CalendarClock,
  CalendarDays,
  Inbox,
  KeyRound,
  MapPin,
  Phone,
  Repeat,
  Settings,
  CheckCircle2,
  UserCheck,
  Users,
  Smartphone,
  X,
} from 'lucide-react';
import type {
  ActivityLogEntry,
  Diversion,
  LeaveRequest,
  PlanningMatrixImportHistory,
  Shift,
  SwapRequest,
  Update,
  User,
  View,
} from '../types';
import type { DayGap } from '../lib/coverage';
import { getDaypartGreeting } from '../lib/interactive';
import { isoDate } from '../lib/availability';
import { activeDiversions as activeDiversionsOf } from '../lib/diversions';
import { formatRemaining, formatStartsIn, isShiftActiveAt, minutesUntilShiftEnd, minutesUntilShiftStart } from '../lib/shiftTime';
import { fetchMonthPlanning } from '../lib/monthPlanning';
import { Skeleton, SkeletonRow, SkeletonTile } from '../components/Skeleton';
import { Modal } from '../components/Modal';
import { PreviewToggle } from '../components/PreviewToggle';
import { ServiceChip } from '../components/ServiceChip';
import { OpsPanel, OpsRow, OpsStat, relTime } from '../components/ops';
import { cn, getSupabaseAuthHeaders, telHref } from '../lib/ui';

/**
 * Operations Center — het planner/admin-dashboard als operationele cockpit.
 *
 * Eén scherm beantwoordt: wie rijdt er, wat staat er open, wat vraagt
 * aandacht en wat is de actuele status van de operatie. Alle cijfers komen
 * uit echte portaaldata (planning, dekking, verlof, ruilen, imports,
 * omleidingen, activiteit) — niets is decoratief.
 */
export function PlannerDashboardWidgets({
  currentUser,
  users,
  shifts,
  diversions,
  updates,
  leaveRequests,
  swaps,
  matrixHistory,
  activityLog,
  coverageDays,
  onNavigate,
  onSickReport,
  isInitialLoad = false,
  canPreview = false,
  previewActive = false,
  onTogglePreview,
}: {
  currentUser: User;
  users: User[];
  shifts: Shift[];
  diversions: Diversion[];
  updates: Update[];
  leaveRequests: LeaveRequest[];
  swaps: SwapRequest[];
  matrixHistory: PlanningMatrixImportHistory[];
  activityLog: ActivityLogEntry[];
  /** null = dekking (nog) niet geladen — toon 'onbekend' i.p.v. vals-groen. */
  coverageDays: DayGap[] | null;
  onNavigate: (view: View) => void;
  /** Ziekmelding registreren — woont hier i.p.v. in de verlofview, zie de
   *  toelichting bij LeaveManagementView. */
  onSickReport?: (payload: { userId: string; startDate?: string; endDate?: string; comment?: string }) => Promise<boolean>;
  isInitialLoad?: boolean;
  /** Admin-only: toon de 'bekijk als chauffeur'-schakelaar. */
  canPreview?: boolean;
  previewActive?: boolean;
  onTogglePreview?: () => void;
}) {
  // Klok voor de header (60s-tick is ruim voldoende voor een dagdeel-groet).
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  // Afwezigheden uit de planning-matrix (Excel-codes bv/ziek/ta/tk…): de
  // verlof-module kent alleen aanvragen die vía het portaal liepen, dus
  // "Vandaag afwezig" stond onterecht op 0 wanneer het verlof alleen in de
  // geïmporteerde matrix zat. Fout → stil terugvallen op de module-data.
  const todayKey = isoDate(now);
  // `absent` voedt de tegel/popup "Vandaag afwezig"; `busyNames` is breder — élke
  // matrix-cel van vandaag die géén vrije dag is (opleiding, een dienst zonder
  // bruikbare tijden, onbekende code…). Zonder dat onderscheid gold "niet in
  // de planning én niet als afwezig gemeld" als beschikbaar, waardoor iemand
  // in opleiding als inzetbare vervanger verscheen.
  const [matrix, setMatrix] = useState<{
    absent: { name: string; label: string; isSick: boolean }[];
    busyNames: string[];
  }>({ absent: [], busyNames: [] });
  const matrixAbsent = matrix.absent;
  // Popups bij de tegels: wie is er vandaag vrij ("Beschikbaar"), wie is
  // er ingepland met welke dienst ("Vandaag ingepland") en wie rijdt er
  // op dit moment ("Chauffeurs actief").
  const [showAvailable, setShowAvailable] = useState(false);
  const [showAbsent, setShowAbsent] = useState(false);
  const [showScheduled, setShowScheduled] = useState(false);
  const [showDriving, setShowDriving] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchMonthPlanning(todayKey.slice(0, 7))
      .then((mp) => {
        if (cancelled || !Array.isArray(mp?.drivers)) return;
        const cells = mp.drivers
          .map((drv) => ({ drv, cell: mp.cells?.[drv.id]?.[todayKey] }))
          .filter((x) => !!x.cell);
        // "Geen dienst" = een gewone vrije dag, geen afwezigheid — die
        // hoort niet in dit paneel (Jarno) en telt wél als beschikbaar.
        const isFreeDay = (label: string) => /geen dienst/i.test(label);
        setMatrix({
          absent: cells
            .filter((x) => (x.cell!.kind === 'leave' || x.cell!.kind === 'absence') && !isFreeDay(x.cell!.label))
            .map(({ drv, cell }) => ({
              name: drv.name,
              label: cell!.label || (cell!.kind === 'leave' ? 'Verlof' : 'Afwezig'),
              isSick: /ziek/i.test(cell!.code) || /ziek/i.test(cell!.label),
            })),
          busyNames: cells.filter((x) => !isFreeDay(x.cell!.label)).map((x) => x.drv.name),
        });
      })
      // Bij een fout niets laten staan van een vorige dag/fetch: verouderde
      // afwezigheden zouden anders iemand blijven wegfilteren uit
      // "Beschikbaar" (en als afwezige blijven tonen).
      .catch(() => {
        if (!cancelled) setMatrix({ absent: [], busyNames: [] });
      });
    return () => { cancelled = true; };
  }, [todayKey]);

  // Wachtende toestellen horen in de werkvoorraad: een collega zit te
  // wachten tot hij de app in kan. Alleen voor admins (de devices-API is
  // admin-only; planners zouden een 403 krijgen).
  const [pendingDevices, setPendingDevices] = useState<Array<{ userId: string; name: string; createdAt: string }>>([]);
  useEffect(() => {
    if (currentUser.role !== 'admin') return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/devices', { headers: await getSupabaseAuthHeaders() });
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data)) {
          setPendingDevices(data.filter((d: any) => d.status === 'pending'));
        }
      } catch {
        // stil: dashboard mag niet breken op een toestellen-fetch
      }
    })();
    return () => { cancelled = true; };
  }, [currentUser.role]);

  // Ziekmelding registreren (planner/admin). Komt telefonisch binnen, dus de
  // planner moet hem vanuit de cockpit kunnen invoeren zonder van scherm te
  // wisselen. De server maakt er een direct goedgekeurd 'ziekte'-verlof van.
  const [showSickModal, setShowSickModal] = useState(false);
  const [sickForm, setSickForm] = useState({ userId: '', startDate: '', endDate: '', comment: '' });
  const [isSubmittingSick, setIsSubmittingSick] = useState(false);
  const [sickError, setSickError] = useState('');

  // LET OP: geen hooks meer onder deze regel — de skeleton-return hieronder
  // betekent dat álle hooks vóór dit punt moeten staan (React #310).
  if (isInitialLoad) {
    return (
      <section className="space-y-5">
        <div className="px-1 pt-1 space-y-2">
          <Skeleton className="h-7 w-72" />
          <Skeleton className="h-3 w-56" />
        </div>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <SkeletonTile /><SkeletonTile /><SkeletonTile /><SkeletonTile /><SkeletonTile /><SkeletonTile />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-3xl p-5 surface-card">
            <SkeletonRow /><SkeletonRow /><SkeletonRow />
          </div>
          <div className="rounded-3xl p-5 surface-card">
            <SkeletonRow /><SkeletonRow />
          </div>
        </div>
      </section>
    );
  }

  const today = isoDate(now);
  const firstName = currentUser.name.split(' ')[0];
  const greeting = getDaypartGreeting(now);
  const isAdmin = currentUser.role === 'admin';

  // === Operationele kerncijfers (alles uit echte data) ===
  const driversActiveToday = new Set(
    shifts.filter((s) => s.date === today).map((s) => String(s.driverId)),
  ).size;
  // Wie zit er nú effectief op de bus? Actuele tijd vs. de segmenttijden
  // (incl. nachtdiensten van gisteren die nog lopen); de 60s-klok hierboven
  // houdt dit cijfer live. Gesplitste diensten: pauze telt niet mee.
  const driversDrivingNow = new Set(
    shifts.filter((s) => isShiftActiveAt(s, now)).map((s) => String(s.driverId)),
  ).size;
  // Noemer van "Vandaag ingepland X / N": alleen inzetbare chauffeurs, zelfde
  // afbakening als /api/availability en de Beschikbaar-tegel — anders telt
  // "ingepland + beschikbaar" zichtbaar niet op tot N.
  const isRealDriver = (u: User) =>
    u.role === 'chauffeur' && u.isActive !== false && u.name.trim().toLowerCase() !== 'beheerder';
  const totalDrivers = users.filter(isRealDriver).length;

  // Dekking: null = niet geladen/fout — behandel als 'onbekend', nooit
  // als 'volledig gedekt' (vals-groen is erger dan geen data).
  const knownDays = coverageDays ?? [];
  // Dagen met een gat voeden de rijen in Open taken en de aandacht-teller.
  // De losse tegel "Open diensten" is er op verzoek uit (03-08); de dekking
  // zelf blijft dus gewoon meelopen.
  const gapDays = knownDays.filter((d) => d.missing.length > 0);

  // Verlopen omleidingen (einddatum in het verleden) tellen niet mee: de
  // tegel zegt "actieve omleidingen" en moet dat dan ook zijn (gedeelde
  // helper — chauffeursdashboard gebruikt dezelfde).
  const activeDiversions = activeDiversionsOf(diversions).length;

  const pendingLeave = leaveRequests.filter((r) => r.status === 'pending');
  const pendingSwaps = swaps.filter((s) => s.status === 'pending' || s.status === 'accepted');
  const openTasks = pendingLeave.length + pendingSwaps.length + pendingDevices.length;

  const lastImport = matrixHistory[0] || null;
  const importIssueCount = lastImport
    ? lastImport.unknownCodes.length + lastImport.unmatchedDrivers.length
    : 0;
  const daysSinceImport = lastImport
    ? Math.floor((now.getTime() - new Date(lastImport.createdAt).getTime()) / 86400000)
    : null;
  // Zachte herinnering: er wérd al eens geïmporteerd, maar al > een week niet
  // meer. (Nooit geïmporteerd = niet naggen — kan een niet-import-opzet zijn.)
  const STALE_PLANNING_DAYS = 7;
  const planningStale = daysSinceImport !== null && daysSinceImport > STALE_PLANNING_DAYS;

  // Eén bron van waarheid voor statuspil, teller én empty-state: alles wat
  // als rij in 'Open taken' verschijnt telt mee — niets anders.
  // (Omleidingen tellen bewust niet mee: een omleiding is informatief, geen
  // openstaande taak.)
  const attentionCount =
    (planningStale ? 1 : 0) + (importIssueCount > 0 ? 1 : 0) + gapDays.length + openTasks;
  const needsAttention = attentionCount > 0;
  // Het paneel toont per soort een top-N (3 dekkingsdagen, 4 verlof, 4 ruil,
  // 3 toestellen); dit is wat daarbuiten valt, zodat de teller in de kop
  // eerlijk blijft.
  const hiddenAttentionCount =
    Math.max(0, gapDays.length - 3) +
    Math.max(0, pendingLeave.length - 4) +
    Math.max(0, pendingSwaps.length - 4) +
    Math.max(0, pendingDevices.length - 3);
  const userNameById = (id: string) =>
    users.find((u) => String(u.id) === String(id))?.name || 'Onbekend';

  // Wie is er vandaag afwezig? Twee bronnen: goedgekeurde aanvragen uit de
  // verlof-module + de afwezigheidscodes uit de geïmporteerde matrix
  // (gededuped op naam — module-aanvraag wint, die heeft het rijkere label).
  const ABSENCE_LABEL: Record<string, string> = { betaald_verlof: 'Verlof', klein_verlet: 'Klein verlet', ziekte: 'Ziek' };
  const moduleAbsent = leaveRequests
    .filter((l) => l.status === 'approved' && l.startDate <= today && today <= l.endDate)
    .map((l) => ({ id: l.id, name: userNameById(l.userId), label: ABSENCE_LABEL[l.type] ?? l.type, isSick: l.type === 'ziekte' }));
  const seenNames = new Set(moduleAbsent.map((a) => a.name.trim().toLowerCase()));
  const todayAbsent = [
    ...moduleAbsent,
    ...matrixAbsent
      .filter((m) => !seenNames.has(m.name.trim().toLowerCase()))
      .map((m, i) => ({ id: `matrix-${i}`, ...m })),
  ].sort((a, b) => {
    // Eerst op soort afwezigheid (ziek bovenaan — daar moet de planner op
    // reageren; daarna de overige soorten alfabetisch), binnen elke soort
    // op naam (verzoek Jarno 30/07).
    if (a.isSick !== b.isSick) return a.isSick ? -1 : 1;
    const byLabel = a.label.localeCompare(b.label, 'nl');
    if (byLabel !== 0) return byLabel;
    return a.name.localeCompare(b.name, 'nl');
  });

  // Wie is er vandaag beschikbaar (vrij en inzetbaar als vervanging)?
  // Actieve chauffeurs die vandaag géén dienst hebben, niet afwezig zijn,
  // in de matrix geen bezette cel hebben (opleiding, dienst zonder tijden,
  // onbekende code) én niet op dit moment nog een dienst van gisteren
  // rijden. Matrix-namen matchen op naam (de matrix kent geen user-ids).
  const nameKey = (n: string) => n.trim().toLowerCase();
  const busyNameKeys = new Set([
    ...todayAbsent.map((a) => nameKey(a.name)),
    ...matrix.busyNames.map(nameKey),
  ]);
  const todayShifts = shifts.filter((s) => s.date === today);
  const workingTodayIds = new Set(todayShifts.map((s) => String(s.driverId)));
  // Ook wie nú nog op de bus zit met een dienst van gisteren is niet vrij.
  const drivingNowIds = new Set(
    shifts.filter((s) => isShiftActiveAt(s, now)).map((s) => String(s.driverId)),
  );

  // Popups "Vandaag ingepland" + "Chauffeurs actief": per chauffeur de
  // dienst(en) met tijden. Segmenten van een gesplitste dienst zijn aparte
  // planning-rijen → groepeer per chauffeur, dienstnummers gededuped,
  // segmenten op starttijd. Eindtijden kunnen busvak-notatie zijn
  // ("26:16" = 02:16) — bewust zo getoond, dat is de notatie die de
  // planning zelf hanteert. Gesorteerd op dienstnummer oplopend (Jarno:
  // overzichtelijker dan op naam).
  const timeMin = (t: string) => {
    const [h, m] = String(t).split(':');
    return (Number(h) || 0) * 60 + (Number(m) || 0);
  };
  const lineNum = (lines: string) => Number((/\d+/.exec(lines) || ['0'])[0]);
  // Busvak-notatie mag: "26:16" is een geldige eindtijd (= 02:16 de nacht erna).
  const tijdGeldig = (t: string) => /^\d{1,2}:[0-5]\d$/.test(String(t ?? ''));
  // Beide popups tellen af, maar "Vandaag ingepland" staat vol chauffeurs die
  // nog moeten beginnen of al klaar zijn. Vandaar drie toestanden per chauffeur
  // i.p.v. één: bezig → "nog 2u 36min", nog niet begonnen → "over 1u 20min",
  // klaar → "afgelopen". In "Chauffeurs actief" is per definitie iedereen
  // bezig, dus daar levert dezelfde berekening gewoon overal "nog …".
  const groupShiftsByDriver = (list: Shift[]) => {
    const byDriver = [...list]
      .sort((a, b) => timeMin(a.startTime) - timeMin(b.startTime))
      .reduce((acc, s) => {
        const id = String(s.driverId);
        let entry = acc.get(id);
        if (!entry) {
          entry = {
            id, name: userNameById(id), lineSet: new Set<string>(), segs: [] as string[],
            restMin: null as number | null, startMin: null as number | null, geldig: false,
          };
          acc.set(id, entry);
        }
        if (s.line) entry.lineSet.add(String(s.line));
        if (s.startTime && s.endTime) entry.segs.push(`${s.startTime}–${s.endTime}`);
        // Resterende rijtijd van het segment dat nú loopt. Bij een gesplitste
        // dienst is dat er hooguit één; de langste wint zodat een randgeval
        // (twee overlappende rijen) niet te vroeg afloopt.
        const rest = minutesUntilShiftEnd(s, now);
        if (rest !== null && (entry.restMin === null || rest > entry.restMin)) entry.restMin = rest;
        // Het eerstvolgende segment dat nog moet beginnen. Bij een gesplitste
        // dienst telt in de pauze dus af naar het tweede deel — precies wat je
        // op dat moment wil weten.
        const tot = minutesUntilShiftStart(s, now);
        if (tot !== null && (entry.startMin === null || tot < entry.startMin)) entry.startMin = tot;
        // "afgelopen" zeggen we alleen als er minstens één leesbaar tijdvak is;
        // bij rommel in de tijden weten we het niet en tonen we niets.
        if (tijdGeldig(s.startTime) && tijdGeldig(s.endTime)) entry.geldig = true;
        return acc;
      }, new Map<string, { id: string; name: string; lineSet: Set<string>; segs: string[]; restMin: number | null; startMin: number | null; geldig: boolean }>());
    return [...byDriver.values()]
      .map((d) => {
        const aftelling: { remaining: string; remainingTone: AftelTone } | undefined =
          d.restMin !== null ? { remaining: formatRemaining(d.restMin), remainingTone: 'bezig' }
          : d.startMin !== null ? { remaining: formatStartsIn(d.startMin), remainingTone: 'straks' }
          : d.geldig ? { remaining: 'afgelopen', remainingTone: 'klaar' }
          : undefined;
        return {
          id: d.id,
          name: d.name,
          lines: [...d.lineSet].join(' / ') || '•',
          // De losse blokken, niet één samengevoegde string: bij een dienst van
          // drie delen liep die tot tegen de dienstchip aan en las hij als één
          // grijze sliert. De rij zet ze nu apart met een scheidingsstip.
          segs: d.segs,
          ...aftelling,
        };
      })
      .sort((a, b) => lineNum(a.lines) - lineNum(b.lines) || a.lines.localeCompare(b.lines));
  };
  const scheduledToday = groupShiftsByDriver(todayShifts);
  // Wie rijdt er nú? Zelfde filter als de teller op de tegel — over álle
  // shifts, want een nachtdienst van gisteren kan nu nog bezig zijn. De
  // tijden tonen alleen de segmenten die op dit moment lopen.
  const drivingNow = groupShiftsByDriver(shifts.filter((s) => isShiftActiveAt(s, now)));
  const availableToday = users
    .filter(isRealDriver)
    .filter((u) =>
      !workingTodayIds.has(String(u.id)) &&
      !drivingNowIds.has(String(u.id)) &&
      !busyNameKeys.has(nameKey(u.name)))
    .sort((a, b) => a.name.localeCompare(b.name));

  const formatDay = (iso: string) => {
    const label = new Date(`${iso}T00:00:00`).toLocaleDateString('nl-BE', {
      weekday: 'short', day: 'numeric', month: 'short',
    });
    return iso === today ? `vandaag (${label})` : label;
  };

  return (
    <section className="space-y-5">
      {/* Admin-preview: zelfde schakelaar als op het chauffeursdashboard, zodat
          een admin de chauffeurs-weergave kán aanzetten (stond eerder alleen
          in die weergave zelf → alleen uit te zetten, nooit aan). */}
      {canPreview && onTogglePreview && <PreviewToggle active={previewActive} onToggle={onTogglePreview} />}

      {/* === Operationele header === */}
      <div className="flex flex-col gap-3 px-1 pt-1 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-[22px] md:text-[26px] font-bold tracking-[-0.02em] text-slate-900">
            {greeting}, <span className="text-oker-600">{firstName}</span>
          </h1>
          <p className="mt-0.5 text-[13px] font-normal text-slate-500">
            Actuele status op{' '}
            {now.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' })} ·{' '}
            {now.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        <div className="flex w-fit items-center gap-2">
        <div
          className={cn(
            'inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5',
            needsAttention
              ? 'border-amber-200 bg-amber-50'
              : 'border-emerald-100 bg-emerald-50',
          )}
        >
          <span className="relative flex h-2 w-2">
            <span className={cn(
              'absolute inline-flex h-full w-full animate-ping rounded-full opacity-60',
              needsAttention ? 'bg-amber-500' : 'bg-emerald-500',
            )} />
            <span className={cn(
              'relative inline-flex h-2 w-2 rounded-full',
              needsAttention ? 'bg-amber-500' : 'bg-emerald-500',
            )} />
          </span>
          <span className={cn(
            'text-[11px] font-semibold',
            needsAttention ? 'text-amber-700' : 'text-emerald-700',
          )}>
            {needsAttention ? 'Open taken' : 'Operationeel'}
          </span>
        </div>
        {/* Ziekmelding komt telefonisch binnen tijdens de rit, dus de planner
            moet er altijd bij kunnen — vandaar hier en niet achter een menu.
            Bewust ingetogen: zelfde pilvorm en hoogte als de statuspil, maar
            in slate. Het is een ingang, geen alarm; de rode toon hoort bij de
            melding zélf, niet bij de knop ernaartoe. */}
        {onSickReport && (
          <button
            type="button"
            onClick={() => {
              setSickForm({ userId: '', startDate: todayKey, endDate: todayKey, comment: '' });
              setSickError('');
              setShowSickModal(true);
            }}
            className="ios-pressable inline-flex w-fit items-center gap-1.5 rounded-full border border-slate-200 px-3 py-1.5 text-[11px] font-semibold text-slate-500 transition-colors hover:border-slate-300 hover:text-slate-700"
          >
            <AlertTriangle size={12} className="text-slate-400" />
            Ziek melden
          </button>
        )}
        </div>
      </div>

      {/* === Status-strip ===
          Gat-vrije verdeling van 7 tegels op elke breedte. Het aantal doet er
          echt toe: mobiel 2 kolommen (3 rijen van 2 + de laatste over de volle
          breedte), md 6 kolommen (2 rijen van 3 tegels à 2 + de laatste over
          6), xl 7 kolommen naast elkaar. Haal je hier een tegel weg of zet je
          er een bij, dan moeten deze drie tellingen mee — anders valt er een
          gat in de rij. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6 xl:grid-cols-7">
        <OpsStat
          className="md:col-span-2 xl:col-span-1"
          icon={<Bus size={16} />}
          tone="emerald"
          label="Chauffeurs actief"
          value={driversDrivingNow}
          sub="nu aan het rijden"
          onClick={() => setShowDriving(true)}
        />
        <OpsStat
          className="md:col-span-2 xl:col-span-1"
          icon={<Users size={16} />}
          tone="slate"
          label="Vandaag ingepland"
          value={driversActiveToday}
          suffix={totalDrivers > 0 ? ` / ${totalDrivers}` : undefined}
          sub="chauffeurs met dienst"
          onClick={() => setShowScheduled(true)}
        />
        <OpsStat
          className="md:col-span-2 xl:col-span-1"
          icon={<UserCheck size={16} />}
          tone="emerald"
          label="Beschikbaar"
          value={availableToday.length}
          sub="vrij en inzetbaar vandaag"
          onClick={() => setShowAvailable(true)}
        />
        <OpsStat
          className="md:col-span-3 xl:col-span-1"
          icon={<CalendarClock size={16} />}
          tone={todayAbsent.some((a) => a.isSick) ? 'amber' : 'slate'}
          label="Vandaag afwezig"
          value={todayAbsent.length}
          sub={todayAbsent.length === 0
            ? 'iedereen inzetbaar'
            : `${todayAbsent.filter((a) => a.isSick).length} ziek · ${todayAbsent.filter((a) => !a.isSick).length} verlof`}
          onClick={() => setShowAbsent(true)}
        />
        <OpsStat
          className="md:col-span-3 xl:col-span-1"
          icon={<Inbox size={16} />}
          tone={openTasks > 0 ? 'amber' : 'emerald'}
          label="Aanvragen"
          value={openTasks}
          sub={`${pendingLeave.length} verlof · ${pendingSwaps.length} dienstruil`}
          onClick={() => onNavigate(pendingSwaps.length > pendingLeave.length ? 'ruil-verzoeken' : 'verlof')}
        />
        <OpsStat
          className="md:col-span-3 xl:col-span-1"
          icon={<MapPin size={16} />}
          tone="slate"
          label="Omleidingen"
          value={activeDiversions}
          sub={activeDiversions === 1 ? 'actieve omleiding' : 'actieve omleidingen'}
          onClick={() => onNavigate('omleidingen')}
        />
        <OpsStat
          className="col-span-2 md:col-span-3 xl:col-span-1"
          icon={<CalendarClock size={16} />}
          tone={importIssueCount > 0 ? 'red' : planningStale ? 'amber' : 'slate'}
          label="Laatste import"
          text={daysSinceImport === null ? '—' : daysSinceImport === 0 ? 'Vandaag' : `${daysSinceImport}d`}
          sub={
            lastImport
              ? importIssueCount > 0
                ? `${importIssueCount} aandachtspunten`
                : `${lastImport.importedDays} dagen verwerkt`
              : 'nog geen import'
          }
          onClick={() => onNavigate('beheer-roosters')}
        />
      </div>

      {/* === Operations Center ===
          Geen items-start meer: beide kolommen rekken tot dezelfde hoogte,
          zodat er geen leeg gat onder de kortste kolom valt. */}
      {/* Gelijke helften. Ging in stappen: 2/3–1/3 was te scheef (Live
          activiteit kapte zijn regels af, "Chris Versluys — ziekte (2…"),
          60/40 hielp maar niet genoeg. Open taken heeft de breedte niet nodig
          — dat zijn korte rijen en er staan er meestal maar twee of drie. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Open taken — gecombineerde werkvoorraad */}
        <OpsPanel
          icon={<Inbox size={15} />}
          title="Open taken"
          aside={attentionCount > 0 ? `${attentionCount} ${attentionCount === 1 ? 'item' : 'items'}` : undefined}
        >
          <div className="space-y-1.5">
            {planningStale && (
              <OpsRow
                tone="amber"
                icon={<CalendarClock size={15} />}
                primary={`Planning al ${daysSinceImport} dagen niet bijgewerkt`}
                secondary="Upload je laatste Excel zodat de planning actueel blijft."
                onClick={() => onNavigate('beheer-roosters')}
              />
            )}
            {importIssueCount > 0 && lastImport && (
              <OpsRow
                tone="red"
                icon={<AlertTriangle size={15} />}
                primary="Laatste import heeft aandachtspunten"
                secondary={[
                  lastImport.unknownCodes.length > 0 ? `${lastImport.unknownCodes.length} onbekende codes` : null,
                  lastImport.unmatchedDrivers.length > 0 ? `${lastImport.unmatchedDrivers.length} niet-gematchte chauffeurs` : null,
                ].filter(Boolean).join(' · ')}
                onClick={() => onNavigate('beheer-roosters')}
              />
            )}
            {gapDays.slice(0, 3).map((d) => (
              <Fragment key={d.date}>
              <OpsRow
                tone="red"
                icon={<AlertTriangle size={15} />}
                primary={`${d.missing.length} open ${d.missing.length === 1 ? 'dienst' : 'diensten'} — ${formatDay(d.date)}`}
                secondary={`Dienst ${d.missing.slice(0, 6).join(', ')}${d.missing.length > 6 ? '…' : ''}`}
                onClick={() => onNavigate('dekking')}
              />
              </Fragment>
            ))}
            {pendingDevices.slice(0, 3).map((d) => (
              <Fragment key={`${d.userId}:${d.name}:${d.createdAt}`}>
              <OpsRow
                tone="amber"
                icon={<Smartphone size={15} />}
                primary={`Toestel wacht op goedkeuring · ${userNameById(d.userId)}`}
                secondary={d.name}
                meta={relTime(d.createdAt)}
                onClick={() => onNavigate('toestellen')}
              />
              </Fragment>
            ))}
            {pendingLeave.slice(0, 4).map((req) => (
              <Fragment key={req.id}>
              <OpsRow
                tone="amber"
                icon={<CalendarDays size={15} />}
                primary={`Verlofaanvraag · ${userNameById(req.userId)}`}
                secondary={`${req.startDate}${req.startDate !== req.endDate ? ` → ${req.endDate}` : ''} · ${req.type === 'betaald_verlof' ? 'betaald verlof' : 'klein verlet'}`}
                meta={relTime(req.createdAt)}
                onClick={() => onNavigate('verlof')}
              />
              </Fragment>
            ))}
            {pendingSwaps.slice(0, 4).map((swap) => (
              <Fragment key={swap.id}>
              <OpsRow
                tone="blue"
                icon={<Repeat size={15} />}
                primary={`${swap.swapType === 'overname' ? 'Overname' : 'Dienstruil'} · ${swap.targetDriverId
                  ? `${userNameById(swap.requesterId)} → ${userNameById(swap.targetDriverId)}`
                  : userNameById(swap.requesterId)}`}
                secondary={swap.status === 'accepted' ? 'Collega akkoord — wacht op validatie' : swap.reason || 'Wacht op een collega'}
                meta={relTime(swap.createdAt)}
                onClick={() => onNavigate('ruil-verzoeken')}
              />
              </Fragment>
            ))}
            {/* De lijst toont bewust een top-N; zonder deze regel suggereerde
                de teller in de kop dat je alles ziet. */}
            {hiddenAttentionCount > 0 && (
              <p className="px-4 pt-1 text-xs font-medium text-slate-500">
                +{hiddenAttentionCount} niet getoond — open Verlof, Dienstruil of Toestellen voor de volledige lijst.
              </p>
            )}
            {attentionCount === 0 && (
              <div className="flex items-center gap-3 rounded-xl bg-emerald-50 border border-emerald-100 px-4 py-3.5">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/12 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 size={16} />
                </span>
                <div>
                  <p className="text-[13.5px] font-semibold text-slate-800">Alles ok</p>
                  <p className="text-xs font-normal text-slate-500">Geen open taken of openstaande diensten.</p>
                </div>
              </div>
            )}
          </div>
        </OpsPanel>

        {/* Rechterflank: live activiteit. Het vroegere "Systeemstatus"-paneel
            is bewust weg: import-status en dekking staan al in de status-strip
            bovenaan, en "Portaal Online"/"Realtime Actief" waren hardcoded
            (decoratie) — tegen het eigen niets-is-decoratief-principe in. */}
        <div className="flex flex-col gap-4">
          {isAdmin && activityLog.length > 0 ? (
            <OpsPanel
              className="flex-1"
              icon={<Activity size={15} />}
              title="Live activiteit"
              aside="laatste acties"
              onSeeAll={() => onNavigate('activiteit')}
              seeAllLabel="Volledige log"
            >
              <div className="space-y-0.5">
                {activityLog.slice(0, 6).map((entry) => (
                  <Fragment key={entry.id}><FeedRow entry={entry} /></Fragment>
                ))}
              </div>
            </OpsPanel>
          ) : (
            updates.length > 0 && (
              <OpsPanel
                className="flex-1"
                icon={<Bell size={15} />}
                title="Recente updates"
                onSeeAll={() => onNavigate('updates')}
                seeAllLabel="Alle updates"
              >
                <div className="space-y-1.5">
                  {updates.slice(0, 3).map((u) => (
                    <OpsRow
                      tone={u.isUrgent ? 'red' : 'slate'}
                      icon={<Bell size={15} />}
                      primary={u.title}
                      secondary={u.date}
                      onClick={() => onNavigate('updates')}
                    />
                  ))}
                </div>
              </OpsPanel>
            )
          )}
        </div>
      </div>

      {/* === Popup: wie is er vandaag beschikbaar === */}
      <DashboardListModal
        open={showAvailable}
        onClose={() => setShowAvailable(false)}
        icon={<UserCheck size={17} />}
        iconClassName="bg-emerald-50 text-emerald-600"
        title="Beschikbare chauffeurs"
        subtitle={`${formatDay(today)} · ${availableToday.length} ${availableToday.length === 1 ? 'chauffeur' : 'chauffeurs'}`}
      >
        {availableToday.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm font-medium text-slate-500">
            Niemand beschikbaar vandaag — iedereen rijdt of is afwezig.
          </p>
        ) : (
          <ul className="space-y-0.5">
            {availableToday.map((u) => {
              // Naam + nummer als tel:-link: op iPhone opent dit meteen het
              // belscherm — beschikbare vervanger in één tik aan de lijn.
              const href = telHref(u.phone);
              const inner = (
                <>
                  <span className="inline-flex h-2 w-2 shrink-0 rounded-full bg-emerald-500" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-slate-800">{u.name}</span>
                    <span className="block text-[11.5px] font-medium text-slate-500 tabular-nums">
                      {u.phone || 'geen nummer bekend'}
                    </span>
                  </span>
                  {href && <Phone size={15} className="shrink-0 text-emerald-600" />}
                </>
              );
              return (
                <li key={u.id}>
                  {href ? (
                    <a
                      href={href}
                      aria-label={`Bel ${u.name}`}
                      className="ios-pressable flex items-center gap-3 rounded-xl px-3 py-2.5 hover:bg-slate-50 active:bg-slate-100"
                    >
                      {inner}
                    </a>
                  ) : (
                    <span className="flex items-center gap-3 rounded-xl px-3 py-2.5">{inner}</span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </DashboardListModal>

      {/* === Popup: wie is er vandaag afwezig (ziek/verlof) === */}
      <DashboardListModal
        open={showAbsent}
        onClose={() => setShowAbsent(false)}
        icon={<CalendarClock size={17} />}
        iconClassName="bg-amber-50 text-amber-600"
        title="Vandaag afwezig"
        subtitle={`${formatDay(today)} · ${todayAbsent.length} ${todayAbsent.length === 1 ? 'collega' : "collega's"}`}
      >
        {todayAbsent.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm font-medium text-slate-500">Iedereen inzetbaar vandaag.</p>
        ) : (
          <ul className="space-y-0.5">
            {todayAbsent.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5">
                <span className="min-w-0 truncate text-sm font-semibold text-slate-800">{a.name}</span>
                <span className={cn('shrink-0 inline-block rounded-md px-1.5 py-0.5 text-[11px] font-semibold', a.isSick ? 'bg-rose-500/12 text-rose-600 dark:text-rose-400' : 'bg-slate-100 text-slate-600')}>{a.label}</span>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={() => { setShowAbsent(false); onNavigate('verlof-kalender'); }}
          className="ios-pressable mt-2 w-full rounded-xl border border-slate-200 py-2.5 text-center text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          Volledige kalender openen
        </button>
      </DashboardListModal>

      {/* === Popup: wie is er vandaag ingepland, met hun dienst(en) === */}
      <DashboardListModal
        open={showScheduled}
        onClose={() => setShowScheduled(false)}
        icon={<Users size={17} />}
        iconClassName="bg-slate-100 text-slate-600"
        title="Vandaag ingepland"
        subtitle={`${formatDay(today)} · ${scheduledToday.length} ${scheduledToday.length === 1 ? 'chauffeur' : 'chauffeurs'}`}
      >
        <DriverShiftRows items={scheduledToday} emptyText="Niemand ingepland vandaag." />
      </DashboardListModal>

      {/* === Popup: wie rijdt er op dit moment === */}
      <DashboardListModal
        open={showDriving}
        onClose={() => setShowDriving(false)}
        icon={<Bus size={17} />}
        iconClassName="bg-emerald-50 text-emerald-600"
        title="Chauffeurs actief"
        subtitle={`nu aan het rijden · ${drivingNow.length} ${drivingNow.length === 1 ? 'chauffeur' : 'chauffeurs'}`}
      >
        <DriverShiftRows items={drivingNow} emptyText="Niemand aan het rijden op dit moment." />
      </DashboardListModal>

      {/* Ziekmelding registreren — chauffeur + periode. Formulier-modal, dus
          niet via DashboardListModal (die is voor lijsten). */}
      <Modal
        open={showSickModal}
        onClose={() => setShowSickModal(false)}
        maxWidth="sm"
        className="flex max-h-[80dvh] flex-col !overflow-hidden !p-0"
      >
        <div className="px-6 py-5 border-b border-white/70 flex items-center justify-between shrink-0 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-red-50 text-red-600">
              <AlertTriangle size={17} />
            </span>
            <div className="min-w-0">
              <h4 className="text-lg font-bold tracking-tight truncate">Ziekmelding registreren</h4>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">meteen onbeschikbaar</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowSickModal(false)}
            aria-label="Sluiten"
            className="ios-pressable inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-50 hover:text-slate-900 dark:hover:bg-white/5"
          >
            <X size={18} />
          </button>
        </div>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (isSubmittingSick || !onSickReport) return;
            if (!sickForm.userId) { setSickError('Kies de chauffeur die ziek is.'); return; }
            const startDate = sickForm.startDate || todayKey;
            const endDate = sickForm.endDate || startDate;
            if (endDate < startDate) { setSickError('De einddatum ligt vóór de startdatum.'); return; }
            setSickError('');
            setIsSubmittingSick(true);
            const ok = await onSickReport({ userId: sickForm.userId, startDate, endDate, comment: sickForm.comment })
              .finally(() => setIsSubmittingSick(false));
            if (ok) setShowSickModal(false);
          }}
          className="p-6 space-y-4 overflow-y-auto overscroll-contain flex-1"
        >
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.08em] ml-1">Chauffeur</label>
            <select
              aria-label="Chauffeur"
              value={sickForm.userId}
              onChange={(e) => { setSickForm({ ...sickForm, userId: e.target.value }); setSickError(''); }}
              className="control-input w-full px-4 py-3 rounded-2xl font-bold text-base sm:text-sm outline-none bg-white/60"
            >
              <option value="">Kies een chauffeur…</option>
              {users
                .filter((u) => u.role === 'chauffeur' && u.isActive !== false)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.08em] ml-1">Van</label>
              <input
                type="date"
                aria-label="Startdatum ziekmelding"
                value={sickForm.startDate}
                onChange={(e) => setSickForm({ ...sickForm, startDate: e.target.value, endDate: sickForm.endDate < e.target.value ? e.target.value : sickForm.endDate })}
                className="control-input w-full px-4 py-3 rounded-2xl font-bold text-base sm:text-sm outline-none bg-white/60"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.08em] ml-1">Tot en met</label>
              <input
                type="date"
                aria-label="Einddatum ziekmelding"
                value={sickForm.endDate}
                min={sickForm.startDate}
                onChange={(e) => setSickForm({ ...sickForm, endDate: e.target.value })}
                className="control-input w-full px-4 py-3 rounded-2xl font-bold text-base sm:text-sm outline-none bg-white/60"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-slate-400 uppercase tracking-[0.08em] ml-1">Opmerking (optioneel)</label>
            <textarea
              aria-label="Opmerking ziekmelding"
              value={sickForm.comment}
              onChange={(e) => setSickForm({ ...sickForm, comment: e.target.value })}
              className="control-input w-full px-4 py-3 rounded-2xl font-bold text-base sm:text-sm outline-none h-20 resize-none bg-white/60"
              placeholder="bv. gemeld via telefoon om 6u"
            />
          </div>
          {sickError && (
            <p role="alert" className="text-xs font-semibold text-red-600 dark:text-red-400">{sickError}</p>
          )}
          <p className="text-[11.5px] font-medium text-slate-500">
            De dag(en) komen meteen als onbeschikbaar in de planning; de andere planners krijgen een melding.
          </p>
          <button
            type="submit"
            disabled={!sickForm.userId || isSubmittingSick}
            className="btn-primary ios-pressable w-full py-4 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isSubmittingSick ? 'Registreren…' : 'Ziekmelding registreren'}
          </button>
        </form>
      </Modal>
    </section>
  );
}

/** Rijenlijst voor de dienst-popups: naam + tijden links, dienst-chip rechts.
 *  Bewust zónder hover-highlight: deze rijen zijn niet klikbaar, en in de
 *  Beschikbaar-popup betekent diezelfde highlight "tik = bellen". */
/** Waar in zijn dag zit deze chauffeur: bezig · moet nog beginnen · klaar. */
type AftelTone = 'bezig' | 'straks' | 'klaar';

/** Toon van de aftelling: amber blijft voorbehouden aan wie nú rijdt, zodat die
 *  kleur op het hele dashboard hetzelfde betekent. "over …" en "afgelopen" zijn
 *  bijschrift, geen signaal, en blijven dus grijs — steeds een tint lichter. */
const AFTEL_TOON: Record<AftelTone, string> = {
  bezig: 'text-oker-700',
  straks: 'text-slate-500',
  klaar: 'text-slate-400',
};

function DriverShiftRows({ items, emptyText }: { items: { id: string; name: string; lines: string; segs: string[]; remaining?: string; remainingTone?: AftelTone }[]; emptyText: string }) {
  if (items.length === 0) {
    return <p className="px-3 py-6 text-center text-sm font-medium text-slate-500">{emptyText}</p>;
  }
  return (
    <ul className="space-y-0.5">
      {items.map((d) => (
        <li key={d.id} className="flex items-center gap-3 rounded-xl px-3 py-2">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-slate-800">{d.name}</span>
            {/* Elk dienstblok als eigen element, met een stip ertussen en
                flex-wrap: bij één of twee blokken staat het op één regel zoals
                voorheen, bij drie wijkt het netjes uit naar een tweede regel
                in plaats van tegen de dienstchip te duwen. */}
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] font-medium text-slate-500 tabular-nums">
              {d.segs.map((seg, i) => (
                <Fragment key={seg}>
                  {i > 0 && <span aria-hidden className="h-1 w-1 shrink-0 rounded-full bg-slate-300" />}
                  <span className="whitespace-nowrap">{seg}</span>
                </Fragment>
              ))}
            </span>
          </span>
          <span className="flex shrink-0 flex-col items-end gap-1">
            <ServiceChip serviceNumber={d.lines} />
            {/* Aftelling onder de dienstchip, rechts uitgelijnd. Ververst mee
                met de minuut-klok van het dashboard. Dit staat alleen op het
                planner/admin-scherm: PlannerDashboardWidgets rendert niet voor
                een chauffeur. */}
            {d.remaining && (
              <span className={cn('whitespace-nowrap text-[11px] font-semibold tabular-nums', AFTEL_TOON[d.remainingTone ?? 'bezig'])}>
                {d.remaining}
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Popup-schil voor de dashboard-tegels. Bouwt op de gedeelde Modal (portal,
 *  Escape-handler, safe-area-padding, geen backdrop-nasleep) — de eerdere
 *  eigen kopie miste dat alles. */
function DashboardListModal({
  open,
  onClose,
  icon,
  iconClassName,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  icon: ReactNode;
  iconClassName: string;
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <Modal open={open} onClose={onClose} maxWidth="sm" className="flex max-h-[80dvh] flex-col !overflow-hidden">
      <div className="px-6 py-5 border-b border-white/70 flex items-center justify-between shrink-0 gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className={cn('inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', iconClassName)}>
            {icon}
          </span>
          <div className="min-w-0">
            <h4 className="text-lg font-bold tracking-tight truncate">{title}</h4>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{subtitle}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Sluiten"
          className="ios-pressable shrink-0 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
        >
          <X size={17} />
        </button>
      </div>
      {/* flex-1 + min-h-0: zonder die twee krimpt dit vak in de flex-kolom
          niet onder zijn inhoud (min-height:auto), dus was er niets te
          scrollen en werd een lange lijst gewoon afgekapt (iPhone-bug van
          Jarno). overscroll-contain: anders chained het scrollen door naar
          het document (rubber-band / pull-to-refresh in standalone iOS). */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-3 py-3">{children}</div>
    </Modal>
  );
}

// === Subcomponents ===

const FEED_ICONS: Partial<Record<ActivityLogEntry['category'], ReactNode>> = {
  users: <Users size={13} />,
  planning: <CalendarClock size={13} />,
  planning_codes: <Settings size={13} />,
  services: <CalendarClock size={13} />,
  diversions: <MapPin size={13} />,
  updates: <Bell size={13} />,
  auth: <KeyRound size={13} />,
  leave: <CalendarDays size={13} />,
  swaps: <Repeat size={13} />,
};

/** Activiteit-feedregel: wie deed wat, hoelang geleden. */
function FeedRow({ entry }: { entry: ActivityLogEntry }) {
  return (
    <div className="flex items-start gap-2.5 rounded-lg px-1.5 py-2">
      <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-slate-500/12 text-slate-500 dark:text-slate-300">
        {FEED_ICONS[entry.category] ?? <Activity size={13} />}
      </span>
      <div className="min-w-0 flex-1">
        {/* Twee regels i.p.v. truncate: de details zijn juist het interessante
            deel en die viel er structureel af ("Chris Versluys — ziekte (2…",
            "Systeem (cron) · 16 fouten gemeld aan 1 on…"). Nog steeds begrensd,
            zodat één lange regel de zes feed-items niet uit elkaar duwt; wie
            het volledige verhaal wil, klikt door naar de log. */}
        <p className="line-clamp-2 text-[12.5px] font-medium leading-snug text-slate-700">
          <span className="font-semibold text-slate-900">{entry.actorName}</span> · {entry.details || entry.action}
        </p>
        <p className="text-[11px] font-normal text-slate-400">{relTime(entry.createdAt)}</p>
      </div>
    </div>
  );
}
