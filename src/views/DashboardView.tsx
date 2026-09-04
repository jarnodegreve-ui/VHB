import { Fragment, useEffect, useState } from 'react';
import { AlertTriangle, Calendar, CalendarDays, Clock, MapPin, Plane, FileText, RefreshCw, Users } from 'lucide-react';
import { activeDiversions } from '../lib/diversions';
import type { Diversion, LeaveRequest, Shift, User, View } from '../types';
import { getDaypartGreeting } from '../lib/interactive';
import { cn, openPdfInNewTab } from '../lib/ui';
import { formatDateHuman, formatDayLong, formatShortDay, formatShortDayPadded, serviceNumberOf } from '../lib/format';
import { isoDate } from '../lib/availability';
import { hasShiftEnded, isShiftActiveAt } from '../lib/shiftTime';
import { verlofBalans } from '../lib/leaveBalance';
import { Skeleton, SkeletonRow, SkeletonTile } from '../components/Skeleton';
import { SlideOver } from '../components/SlideOver';
import { OpsPanel, OpsRow, OpsStat, QuickAction } from '../components/ops';
import { Badge, Button, MicroLabel } from '../components/primitives';
import { Card } from '../components/Card';
import { WatIsNieuwKaart } from '../components/WatIsNieuwKaart';
import { ServiceChip } from '../components/ServiceChip';
import { DienstBalk } from '../components/DienstBalk';

/**
 * Chauffeursdashboard — zelfde Operations Center-taal als het planner/admin-
 * scherm (gedeelde bouwstenen uit components/ops), maar met de gegevens van
 * de ingelogde chauffeur: zijn dienst van vandaag, de volgende dienst met
 * dienstnummer/loopnummer, verlofsaldo, omleidingen en snelle acties.
 */
export function DashboardView({ notes = [],
  user,
  shifts,
  diversions,
  users,
  leaveRequests = [],
  isInitialLoad = false,
  onNavigate,
  onChangePassword,
}: {
  user: User;
  shifts: Shift[];
  diversions: Diversion[];
  notes?: Array<{ date: string; note: string }>;
  users: User[];
  leaveRequests?: LeaveRequest[];
  isInitialLoad?: boolean;
  onNavigate?: (view: View) => void;
  /** Opent de wachtwoord-wijzigen-modal (voor de eenmalige welkomstkaart). */
  onChangePassword?: () => void;
}) {
  const [now, setNow] = useState(new Date());
  // Eenmalige welkomstkaart bij de allereerste keer op het dashboard: nieuwe
  // chauffeurs krijgen een tijdelijk wachtwoord van de beheerder en hadden
  // verder geen enkele uitleg. Weggeklikt = weggeklikt (localStorage).
  const [showWelcome, setShowWelcome] = useState<boolean>(() => {
    try {
      return !window.localStorage.getItem(`vhb-welkom-gezien-${user.id}`);
    } catch {
      return false;
    }
  });
  const dismissWelcome = () => {
    setShowWelcome(false);
    try {
      window.localStorage.setItem(`vhb-welkom-gezien-${user.id}`, new Date().toISOString());
    } catch {
      // localStorage geblokkeerd — kaart komt dan gewoon nog eens terug.
    }
  };
  // Detailvenster voor een omleiding — opent als side panel, geen paginawissel.
  const [openDiversion, setOpenDiversion] = useState<Diversion | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const myShifts = shifts.filter((s) => s.driverId === user.id);
  // Lokale dag (isoDate) i.p.v. toISOString(): die laatste gaf 's nachts in
  // BE de UTC-dag terug, waardoor 'Vandaag' de verkeerde/geen dienst toonde.
  const today = isoDate(now);
  const todaysShift = myShifts.find((shift) => shift.date === today);
  // Alle delen van de dienst van vandaag (een gesplitste dienst = meerdere
  // planning-rijen), op starttijd. Al gereden delen blijven staan maar
  // worden gedempt getoond — zo zie je in één oogopslag wat nog komt.
  const todayParts = myShifts
    .filter((s) => s.date === today)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const todayLines = todayParts.map((p) => ({
    left: `${p.startTime}–${p.endTime}`,
    right: p.loopnr ? `loop ${p.loopnr}` : undefined,
    done: hasShiftEnded(p, now),
    active: isShiftActiveAt(p, now),
  }));
  const toMin = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return (h ?? 0) * 60 + (m ?? 0);
  };
  // Dienstbalk-delen in minuten (eind ≤ start = nachtdienst, +24u).
  const balkDelen = todayParts.map((p) => {
    const start = toMin(p.startTime);
    let end = toMin(p.endTime);
    if (end <= start) end += 1440;
    return { start, end, loopnr: p.loopnr };
  });
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const nowLabel = now.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
  const fmtDuur = (minuten: number) => {
    const u = Math.floor(minuten / 60);
    const m = minuten % 60;
    if (u === 0) return `${m}min`;
    if (m === 0) return `${u}u`;
    return `${u}u ${String(m).padStart(2, '0')}min`;
  };
  // Statusregel van de Vandaag-tegel: hoelang nog (bezig), wanneer het begint, of klaar.
  const activeBlok = balkDelen.find((d) => nowMin >= d.start && nowMin < d.end);
  const volgendBlok = balkDelen.find((d) => d.start > nowMin);
  const todayStatus = todayParts.length === 0
    ? 'geen dienst gepland'
    : activeBlok
      ? `nog ${fmtDuur(activeBlok.end - nowMin)}`
      : volgendBlok
        ? `start over ${fmtDuur(volgendBlok.start - nowMin)}`
        : 'dienst gereden';
  // Dienstnummers van vandaag, gededupliceerd (meestal één dienst).
  const todayServices = [...new Set(todayParts.map((p) => String(p.line || '').trim()).filter(Boolean))];
  const todayNote = notes.find((n) => n.date === today)?.note;

  const nextShift = myShifts
    .map((s) => {
      const [year, month, day] = s.date.split('-').map(Number);
      const [hours, minutes] = s.startTime.split(':').map(Number);
      return { ...s, startDateTime: new Date(year, month - 1, day, hours, minutes) };
    })
    // Ná vandaag: de delen van vandaag staan al in de Vandaag-tegel, dus
    // "volgende dienst" is de eerstvolgende andere dag (zoals op Mijn dag).
    .filter((s) => s.date > today)
    .sort((a, b) => a.startDateTime.getTime() - b.startDateTime.getTime())[0];
  // Alle delen van die volgende dag, voor de regels in de tegel.
  const nextParts = nextShift
    ? myShifts.filter((s) => s.date === nextShift.date).sort((a, b) => a.startTime.localeCompare(b.startTime))
    : [];

  // Verlopen omleidingen horen niet in tegel/paneel: "actief" moet actief zijn
  // (zelfde regel als het beheer-dashboard sinds #251).
  const liveDiversions = activeDiversions(diversions);
  const newestDiversions = [...liveDiversions].reverse().slice(0, 3);

  // Verlofsaldo + 'deze maand' voor de extra dashboard-kaarten.
  const balans = verlofBalans(leaveRequests, user.id, now.getFullYear(), user.verlofBudget);
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const thisMonthShiftCount = myShifts.filter((s) => s.date.startsWith(monthPrefix)).length;

  // Volgende geplande diensten (toekomst, oplopend gesorteerd) — voor de
  // Planning-panel bij chauffeurs.
  const upcomingShifts = myShifts
    .map((s) => {
      const [year, month, day] = s.date.split('-').map(Number);
      const [hours, minutes] = s.startTime.split(':').map(Number);
      return { ...s, startDateTime: new Date(year, month - 1, day, hours, minutes) };
    })
    .filter((s) => s.startDateTime > now)
    .sort((a, b) => a.startDateTime.getTime() - b.startDateTime.getTime())
    .slice(0, 3);


  // "Lijn 5 & 8" vs "5": prefix alleen wanneer 't nog niet in de data zit.
  const lineLabel = (line: string) =>
    line.trim().toLowerCase().startsWith('lijn') ? line.trim() : `Lijn ${line.trim()}`;

  // Wanneer is de volgende dienst, in dag-taal: chauffeurs denken in
  // "morgen/overmorgen", niet in een aftellend "17u 25m" (verzoek Jarno).
  // Kalenderdag-verschil, dus 's avonds klopt "morgen" ook al is het < 12u.
  const relativeDay = (dateIso: string): string => {
    const diff = Math.round(
      (new Date(`${dateIso}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000,
    );
    if (diff <= 0) return 'vandaag';
    if (diff === 1) return 'morgen';
    if (diff === 2) return 'overmorgen';
    return `over ${diff} dagen`;
  };

  const firstName = user.name.split(' ')[0];
  const greeting = getDaypartGreeting(now);

  // Skeleton-mode: eerste fetch nog niet rond
  if (isInitialLoad) {
    return (
      <div className="space-y-4">
        <div className="px-1 pt-1 space-y-2">
          <Skeleton className="h-8 w-72" />
          <Skeleton className="h-3 w-48" />
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-3xl h-44">
            <SkeletonTile className="h-full" />
          </div>
          <div className="flex flex-col gap-4">
            <SkeletonTile />
            <SkeletonTile />
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </Card>
          <Card>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </Card>
        </div>
      </div>
    );
  }

  // Statuspil rechtsboven, zelfde taal als het Operations Center: iets in
  // behandeling (amber) of alles rustig (emerald).
  const pendingLeaveMine = leaveRequests.filter((l) => l.userId === user.id && l.status === 'pending');
  const needsAttention = pendingLeaveMine.length > 0;

  return (
    <div className="space-y-5">
      {/* === Eenmalige welkomstkaart (eerste bezoek) ===
          Compact: één regel uitleg + de twee knoppen, zodat "de dienst van
          vandaag" ook op een telefoon boven de vouw blijft (productprincipe 1). */}
      {showWelcome && (
        <Card tone="accent" padding="sm" className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900">Welkom, {firstName}</p>
            <p className="mt-0.5 text-sm text-slate-600">
              {onChangePassword ? 'Kies eerst een eigen wachtwoord; daarna vind je hier je rooster, verlof, dienstruil en omleidingen.' : 'Hier vind je je rooster, verlof, dienstruil en omleidingen.'}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            {onChangePassword && (
              <Button variant="primary" size="sm" onClick={() => { dismissWelcome(); onChangePassword(); }}>
                Wachtwoord kiezen
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={dismissWelcome}>
              {onChangePassword ? 'Later' : 'Aan de slag'}
            </Button>
          </div>
        </Card>
      )}

      {/* Na een release: één dismissbare kaart met wat er nieuw is (src/app/watIsNieuw.ts). */}
      {!showWelcome && <WatIsNieuwKaart rol={user.role} onNavigate={onNavigate} />}

      {/* === Persoonlijke header === */}
      <div className="flex flex-col gap-3 px-1 pt-1 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-page-title">
            {greeting}, <span className="text-oker-700">{firstName}</span>
          </h1>
          <p className="mt-0.5 text-sm font-normal text-slate-500 tabular-nums">
            {formatDayLong(isoDate(now))} ·{' '}
            {now.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        {/* Stille chip met gekleurd puntje: "Dienst vandaag" en "in
            behandeling" zijn informatie, geen alarm (afwerking 04-09, nr. 6).
            De stip staat stil — beweging voor "alles is normaal" maakt van
            rust een alarm. */}
        <Badge tone={needsAttention ? 'amber' : 'emerald'} stil className="w-fit tabular-nums">
          {needsAttention
            ? `${pendingLeaveMine.length} aanvraag${pendingLeaveMine.length === 1 ? '' : 'en'} in behandeling`
            : todaysShift ? 'Dienst vandaag' : 'Vrij vandaag'}
        </Badge>
      </div>

      {/* === Status-strip ===
          Zelfde raster als het Operations Center: mobiel 2 kolommen, breed
          6 — de 'volgende dienst' krijgt dubbele breedte omdat daar het
          dienstnummer, de tijden en de loopnummers in passen. */}
      {/* Twee rijen op breed: Vandaag + Volgende dienst (elk de helft), daaronder
          de drie kleine tegels (elk een derde). Op één rij van zeven kolommen
          werden de kleine tegels smal en zo hoog als de Vandaag-tegel, met
          afgeknipte labels (Jarno 04-09). */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {/* Vandaag: het dienstnummer als kop, hoelang nog als boodschap, de
            delen als regels en de dienstbalk (wijzerplaat) eronder — dezelfde
            taal als Mijn dag. Op mobiel over de volle breedte. */}
        <OpsStat
          icon={<Clock size={16} />}
          // Mobiel volle breedte; breed altijd dubbel (balk + regels), op
          // md alleen bij meerdere delen.
          className={cn('col-span-2 md:col-span-1 xl:col-span-3', todayLines.length > 1 && 'md:col-span-2')}
          // Kleur alleen als er nú iets gebeurt (oker = lopende dienst);
          // een gewone geplande dag is rusttoestand en blijft slate.
          tone={activeBlok ? 'oker' : 'slate'}
          label="Vandaag"
          text={todayParts.length === 0 ? 'Vrij' : todayServices.join(' / ') || todayParts[0].startTime}
          sub={todayStatus}
          subClassName={activeBlok ? 'text-sm font-semibold text-oker-800' : 'text-sm font-semibold text-slate-600'}
          lines={todayLines}
          balk={todayParts.length > 0 ? <DienstBalk compact delen={balkDelen} nuMin={nowMin} nuLabel={nowLabel} className="mt-1" /> : undefined}
          note={todayNote}
          onClick={onNavigate ? () => onNavigate('mijn-dag') : undefined}
        />
        {/* Volgende dienst: dienstnummer groot, eronder de dag en de delen. */}
        <OpsStat
          icon={<Calendar size={16} />}
          tone="slate"
          className="col-span-2 md:col-span-1 xl:col-span-3"
          label="Volgende dienst"
          // Dienstnummer groot, net als in de Vandaag-tegel (Jarno 04-09:
          // het nummer is het belangrijkste); dag + afstand op de subregel.
          text={nextShift ? serviceNumberOf(nextShift) : '—'}
          subClassName="text-sm font-semibold text-slate-600"
          sub={nextShift ? `${formatShortDay(nextShift.date)} · ${relativeDay(nextShift.date)}` : 'niets ingepland'}
          lines={nextParts.map((p) => ({ left: `${p.startTime}–${p.endTime}`, right: p.loopnr ? `loop ${p.loopnr}` : undefined }))}
          onClick={onNavigate ? () => onNavigate('rooster') : undefined}
        />
        <OpsStat
          icon={<Plane size={16} />}
          tone="slate"
          className="xl:col-span-2"
          label="Verlofsaldo"
          value={balans.betaaldResterend}
          suffix={` / ${balans.betaaldBudget}`}
          sub="dagen over"
          meter={balans.betaaldBudget > 0 ? Math.round((balans.betaaldGebruikt / balans.betaaldBudget) * 100) : 0}
          onClick={onNavigate ? () => onNavigate('verlof') : undefined}
        />
        <OpsStat
          icon={<CalendarDays size={16} />}
          tone="slate"
          className="xl:col-span-2"
          label="Deze maand"
          value={thisMonthShiftCount}
          sub="diensten ingepland"
          onClick={onNavigate ? () => onNavigate('rooster') : undefined}
        />
        <OpsStat
          icon={<MapPin size={16} />}
          tone={liveDiversions.length > 0 ? 'amber' : 'slate'}
          className="xl:col-span-2"
          label="Omleidingen"
          value={liveDiversions.length}
          sub={liveDiversions.length === 1 ? 'actieve omleiding' : 'actieve omleidingen'}
          onClick={onNavigate ? () => onNavigate('omleidingen') : undefined}
        />
      </div>

      {/* === Panelen === */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <OpsPanel
          className="lg:col-span-2"
          icon={<Calendar size={16} />}
          title="Komende diensten"
          aside={thisMonthShiftCount > 0 ? `${thisMonthShiftCount} deze maand` : undefined}
          onSeeAll={onNavigate ? () => onNavigate('rooster') : undefined}
          seeAllLabel="Mijn rooster"
        >
          {upcomingShifts.length === 0 ? (
            /* Neutrale lege staat: geen groen vlak voor een rusttoestand. */
            <div className="flex items-center gap-3 rounded-xl bg-surface-row px-4 py-3.5 ring-1 ring-hairline">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-500/12 text-slate-500">
                <Clock size={16} />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-800">Geen komende diensten</p>
                <p className="text-xs font-normal text-slate-600">Er staat op dit moment niets ingepland.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              {upcomingShifts.map((shift) => (
                <Fragment key={shift.id}>
                  <OpsRow
                    tone="oker"
                    icon={<Calendar size={16} />}
                    primary={formatShortDayPadded(shift.date)}
                    secondary={`${shift.startTime}–${shift.endTime}${shift.loopnr ? ` · loop ${shift.loopnr}` : ''}`}
                    trailing={<ServiceChip serviceNumber={serviceNumberOf(shift)} tone="oker" />}
                    onClick={() => onNavigate?.('rooster')}
                  />
                </Fragment>
              ))}
            </div>
          )}
        </OpsPanel>

        <OpsPanel
          icon={<MapPin size={16} />}
          title="Omleidingen"
          aside={liveDiversions.length > 0 ? `${liveDiversions.length} actief` : undefined}
          onSeeAll={onNavigate ? () => onNavigate('omleidingen') : undefined}
        >
          {newestDiversions.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl bg-surface-row px-4 py-3.5 ring-1 ring-hairline">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-500/12 text-slate-500">
                <MapPin size={16} />
              </span>

              <div>
                <p className="text-sm font-semibold text-slate-800">Vrije baan</p>
                <p className="text-xs font-normal text-slate-500">Geen omleidingen op het netwerk.</p>
              </div>
            </div>
          ) : (
            <div className="space-y-1.5">
              {newestDiversions.map((div) => (
                <Fragment key={div.id}>
                  <OpsRow
                    tone="amber"
                    icon={<AlertTriangle size={16} />}
                    primary={div.title}
                    secondary={div.description}
                    meta={div.line}
                    onClick={() => setOpenDiversion(div)}
                  />
                </Fragment>
              ))}
            </div>
          )}
        </OpsPanel>
      </div>

      {/* === Snelle acties (alleen zonder zijbalk: op desktop staan dezelfde
          schermen al links, dus daar zijn ze dubbel) === */}
      {onNavigate && (
        <div className="grid grid-cols-2 gap-3 lg:hidden">
          <QuickAction icon={<Calendar size={16} />} label="Mijn rooster" sub="Diensten en agenda" onClick={() => onNavigate('rooster')} />
          <QuickAction icon={<Plane size={16} />} label="Verlof aanvragen" sub="Saldo en aanvragen" onClick={() => onNavigate('verlof')} />
          <QuickAction icon={<RefreshCw size={16} />} label="Dienstruil" sub="Ruilen met een collega" onClick={() => onNavigate('ruil-verzoeken')} />
          <QuickAction icon={<FileText size={16} />} label="Ritbladen" sub="Actuele rit-info" onClick={() => onNavigate('ritblaadjes')} />
          <QuickAction icon={<Users size={16} />} label="Maandplanning" sub="Wie rijdt wanneer" onClick={() => onNavigate('bezetting')} />
        </div>
      )}

      {/* Omleiding-detail als premium side panel */}
      <SlideOver
        open={!!openDiversion}
        onClose={() => setOpenDiversion(null)}
        title={openDiversion?.title ?? 'Omleiding'}
        subtitle={openDiversion ? lineLabel(openDiversion.line) : undefined}
        icon={
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-oker-500/15 text-oker-700">
            <MapPin size={16} />
          </span>
        }
      >
        {openDiversion && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="slate">{lineLabel(openDiversion.line)}</Badge>
            </div>
            <Card tone="muted" padding="sm">
              <MicroLabel>Periode</MicroLabel>
              <p className="mt-1.5 text-sm font-semibold text-slate-800 tabular-nums">
                {formatDateHuman(openDiversion.startDate)}
                {openDiversion.endDate ? ` → ${formatDateHuman(openDiversion.endDate)}` : ' → einde onbekend'}
              </p>
            </Card>
            <div>
              <MicroLabel>Omschrijving</MicroLabel>
              <p className="mt-2 whitespace-pre-wrap text-sm font-normal leading-relaxed text-slate-700">
                {openDiversion.description}
              </p>
            </div>
            {openDiversion.pdfUrl && (
              <Button variant="secondary" onClick={() => openPdfInNewTab(openDiversion.pdfUrl)} icon={<FileText size={16} />}>
                Bijlage openen (PDF)
              </Button>
            )}
          </div>
        )}
      </SlideOver>
    </div>
  );
}
