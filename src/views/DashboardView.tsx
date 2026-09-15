import { Fragment, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { Calendar, CalendarDays, Clock, MapPin, Plane, FileText, RefreshCw, SlidersHorizontal, Users, Wrench } from 'lucide-react';
import { activeDiversions, omleidingsPeriode, omleidingsTijdshint, sorteerOmleidingen } from '../lib/diversions';
import { OmleidingDetail } from '../components/OmleidingDetail';
import { isRijdend } from '../types';
import { telDienstdagen } from '../lib/dienstTelling';
import { LijnTegel } from '../components/LijnTegel';
import { lijnLabel } from '../../shared/lijnen';
import type { Diversion, LeaveRequest, Shift, User, View } from '../types';
import { getDaypartGreeting } from '../lib/interactive';
import { cn } from '../lib/ui';
import { formatDayLong, formatShortDay, formatShortDayPadded, serviceNumberOf } from '../lib/format';
import { isoDate } from '../lib/availability';
import { relatieveDag } from '../lib/datum';
import { warmRitbladCache } from '../lib/ritbladCache';
import { formatDuration, hasShiftEnded, isShiftActiveAt, parseHHMM, shiftWindowMinutes } from '../lib/shiftTime';
import { verlofBalans } from '../lib/leaveBalance';
import { SkeletonTile } from '../components/Skeleton';
import { DashboardSkelet } from '../components/ui';
import { SlideOver } from '../components/SlideOver';
import { OpsPanel, OpsRow, OpsStat, QuickAction } from '../components/ops';
import { Badge } from '../components/primitives';
import { WatIsNieuwKaart } from '../components/WatIsNieuwKaart';
import { ServiceChip } from '../components/ServiceChip';
import { DienstBalk } from '../components/DienstBalk';
import { ActieMenu } from '../components/ActieMenu';
import { DashboardAanpassen } from '../components/DashboardAanpassen';
import { kleineTegelSpan, pasVoorkeurenToe, tegelsVoorRol, useDashboardVoorkeuren } from '../lib/dashboardVoorkeuren';

// Techniek (13-09): de defectmelding en de gele-boek-tegel laden pas bij
// gebruik, zodat de chauffeurschunk niets van de techniekmodule draagt.
const LazyDefectMeldenModal = lazy(() => import('../components/DefectMeldenModal').then((m) => ({ default: m.DefectMeldenModal })));
const LazyGeleBoekTegel = lazy(() => import('../components/GeleBoekTegel').then((m) => ({ default: m.GeleBoekTegel })));

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
  leaveRequests = [],
  isInitialLoad = false,
  onNavigate,
}: {
  user: User;
  shifts: Shift[];
  diversions: Diversion[];
  notes?: Array<{ date: string; note: string }>;
  leaveRequests?: LeaveRequest[];
  isInitialLoad?: boolean;
  onNavigate?: (view: View) => void;
}) {
  const [now, setNow] = useState(new Date());
  // Detailvenster voor een omleiding — opent als side panel, geen paginawissel.
  const [openDiversion, setOpenDiversion] = useState<Diversion | null>(null);
  // Dashboard op maat (06-09): verborgen tegels + volgorde per gebruiker.
  const { voorkeuren, opslaan: bewaarVoorkeuren } = useDashboardVoorkeuren(user);
  const [aanpassen, setAanpassen] = useState(false);
  const [defectMelden, setDefectMelden] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  const myShifts = shifts.filter((s) => s.driverId === user.id);
  // Lokale dag (isoDate) i.p.v. toISOString(): die laatste gaf 's nachts in
  // BE de UTC-dag terug, waardoor 'Vandaag' de verkeerde/geen dienst toonde.
  const today = isoDate(now);
  // Ritblad van vandaag/morgen alvast offline beschikbaar maken (zelfde
  // regel als Mijn dag; de service worker bewaart de bundel).
  const morgenDate = new Date(now);
  morgenDate.setDate(morgenDate.getDate() + 1);
  const heeftDienstBinnenkort = myShifts.some((s) => s.date === today || s.date === isoDate(morgenDate));
  useEffect(() => {
    if (isInitialLoad || !heeftDienstBinnenkort || (typeof navigator !== 'undefined' && !navigator.onLine)) return;
    void warmRitbladCache();
  }, [isInitialLoad, heeftDienstBinnenkort]);
  // Nachtdienst over middernacht: zolang de dienst van gisteren nog loopt, is
  // dát de "dienstdag" van de tegel en telt "nu" door in busvak-tijd
  // (controle 05-09).
  const gisterenDate = new Date(now);
  gisterenDate.setDate(gisterenDate.getDate() - 1);
  const gisteren = isoDate(gisterenDate);
  const nachtdienstLoopt = myShifts.some((s) => s.date === gisteren && isShiftActiveAt(s, now));
  const dienstDag = nachtdienstLoopt ? gisteren : today;
  const todaysShift = myShifts.find((shift) => shift.date === dienstDag);
  // Alle delen van de dienst van vandaag (een gesplitste dienst = meerdere
  // planning-rijen), op starttijd. Al gereden delen blijven staan maar
  // worden gedempt getoond — zo zie je in één oogopslag wat nog komt.
  const todayParts = myShifts
    .filter((s) => s.date === dienstDag)
    .sort((a, b) => a.startTime.localeCompare(b.startTime));
  const todayLines = todayParts.map((p) => ({
    left: `${p.startTime}–${p.endTime}`,
    right: p.loopnr ? `loop ${p.loopnr}` : undefined,
    done: hasShiftEnded(p, now),
    active: isShiftActiveAt(p, now),
  }));
  // Dienstbalk-delen in minuten (eind ≤ start = nachtdienst, +24u) — zelfde
  // venster-regel als Mijn dag (shiftWindowMinutes); een deel met vuile tijden
  // valt weg uit de balk.
  const balkDelen = todayParts.flatMap((p) => {
    const venster = shiftWindowMinutes(p);
    return venster ? [{ ...venster, loopnr: p.loopnr }] : [];
  });
  const nowMin = now.getHours() * 60 + now.getMinutes() + (nachtdienstLoopt ? 1440 : 0);
  const nowLabel = now.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
  // Statusregel van de Vandaag-tegel: hoelang nog (bezig), wanneer het begint, of klaar.
  const activeBlok = balkDelen.find((d) => nowMin >= d.start && nowMin < d.end);
  const volgendBlok = balkDelen.find((d) => d.start > nowMin);
  const todayStatus = todayParts.length === 0
    ? 'geen dienst gepland'
    : activeBlok
      ? `nog ${formatDuration(activeBlok.end - nowMin)}`
      : volgendBlok
        ? `start over ${formatDuration(volgendBlok.start - nowMin)}`
        : 'dienst gereden';
  // Dienstnummers van vandaag, gededupliceerd (meestal één dienst).
  const todayServices = [...new Set(todayParts.map((p) => String(p.line || '').trim()).filter(Boolean))];
  const todayNote = notes.find((n) => n.date === today)?.note;

  const nextShift = myShifts
    .map((s) => {
      const [year, month, day] = s.date.split('-').map(Number);
      const startMin = parseHHMM(s.startTime) ?? 0;
      return { ...s, startDateTime: new Date(year, month - 1, day, 0, startMin) };
    })
    // Ná vandaag: de delen van vandaag staan al in de Vandaag-tegel, dus
    // "volgende dienst" is de eerstvolgende andere dag (zoals op Mijn dag).
    .filter((s) => s.date > dienstDag)
    .sort((a, b) => a.startDateTime.getTime() - b.startDateTime.getTime())[0];
  // Alle delen van die volgende dag, voor de regels in de tegel.
  const nextParts = nextShift
    ? myShifts.filter((s) => s.date === nextShift.date).sort((a, b) => a.startTime.localeCompare(b.startTime))
    : [];

  // Verlopen omleidingen horen niet in tegel/paneel: "actief" moet actief zijn
  // (zelfde regel als het beheer-dashboard sinds #251).
  const liveDiversions = activeDiversions(diversions);
  // Zelfde volgorde als het tabblad Omleidingen: lopend eerst, dan komend.
  const newestDiversions = sorteerOmleidingen(liveDiversions).slice(0, 3);

  // Verlofsaldo + 'deze maand' voor de extra dashboard-kaarten.
  const balans = verlofBalans(leaveRequests, user.id, now.getFullYear(), user.verlofBudget);
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  // Dagen met dienst, niet rijen: een gesplitste dienst is twee rijen
  // (melding Jarno 14-09: "27 diensten" waar het 15 dagen waren).
  const thisMonthShiftCount = telDienstdagen(myShifts.filter((s) => s.date.startsWith(monthPrefix)));

  // Volgende geplande diensten (toekomst, oplopend gesorteerd) — voor de
  // Planning-panel bij chauffeurs.
  const upcomingShifts = myShifts
    .map((s) => {
      const [year, month, day] = s.date.split('-').map(Number);
      const startMin = parseHHMM(s.startTime) ?? 0;
      return { ...s, startDateTime: new Date(year, month - 1, day, 0, startMin) };
    })
    .filter((s) => s.startDateTime > now)
    .sort((a, b) => a.startDateTime.getTime() - b.startDateTime.getTime())
    .slice(0, 3);



  const firstName = user.name.split(' ')[0];
  const greeting = getDaypartGreeting(now);

  // Skeleton-mode: eerste fetch nog niet rond. Zelfde skelet als AppSkeleton
  // (koude start), zodat de keten skelet → skelet → dashboard niet verspringt.
  if (isInitialLoad) return <DashboardSkelet />;

  // Statuspil rechtsboven, zelfde taal als het Operations Center: iets in
  // behandeling (amber) of alles rustig (emerald).
  const pendingLeaveMine = leaveRequests.filter((l) => l.userId === user.id && l.status === 'pending');
  const needsAttention = pendingLeaveMine.length > 0;

  // --- Dashboard op maat: tegels op id, in de volgorde van de voorkeuren ---
  // Catalogus per rol: een technieker heeft geen diensten, dus die tegels
  // bestaan voor hem niet.
  const tegelCatalogus = tegelsVoorRol(user.role);
  const zichtbareTegels = pasVoorkeurenToe(tegelCatalogus, voorkeuren);
  const toon = (id: string) => zichtbareTegels.some((t) => t.id === id);
  const stripZichtbaar = zichtbareTegels.filter((t) => t.groep === 'tegels');
  const GROOT = new Set(['vandaag', 'volgende-dienst']);
  const kleineTegels = stripZichtbaar.filter((t) => !GROOT.has(t.id));
  // Op xl (6 kolommen) vullen de kleine tegels samen één rij; op de telefoon
  // (2 kolommen) spant een oneven laatste kleine tegel de volle breedte.
  const kleinSpan = kleineTegelSpan(kleineTegels.length);
  const laatsteKlein = kleineTegels.length % 2 === 1 ? kleineTegels[kleineTegels.length - 1]?.id : undefined;
  const kleinKlassen = (id: string) => cn(kleinSpan, id === laatsteKlein && 'col-span-2 md:col-span-1');
  const STRIP_TEGEL: Record<string, ReactNode> = {
    // Vandaag: het dienstnummer als kop, hoelang nog als boodschap, de
    // delen als regels en de dienstbalk (wijzerplaat) eronder — dezelfde
    // taal als Mijn dag. Op mobiel over de volle breedte.
    vandaag: (
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
    ),
    // Volgende dienst: dienstnummer groot, eronder de dag en de delen.
    'volgende-dienst': (
      <OpsStat
        icon={<Calendar size={16} />}
        tone="slate"
        className="col-span-2 md:col-span-1 xl:col-span-3"
        label="Volgende dienst"
        // Dienstnummer groot, net als in de Vandaag-tegel (Jarno 04-09:
        // het nummer is het belangrijkste); dag + afstand op de subregel.
        text={nextShift ? serviceNumberOf(nextShift) : '—'}
        subClassName="text-sm font-semibold text-slate-600"
        sub={nextShift ? `${formatShortDay(nextShift.date)} · ${relatieveDag(nextShift.date, today)}` : 'niets ingepland'}
        lines={nextParts.map((p) => ({ left: `${p.startTime}–${p.endTime}`, right: p.loopnr ? `loop ${p.loopnr}` : undefined }))}
        onClick={onNavigate ? () => onNavigate('rooster') : undefined}
      />
    ),
    'gele-boek': (
      <Suspense fallback={<SkeletonTile />}>
        <LazyGeleBoekTegel className={kleinKlassen('gele-boek')} onClick={onNavigate ? () => onNavigate('defecten') : undefined} />
      </Suspense>
    ),
    verlofsaldo: (
      <OpsStat
        icon={<Plane size={16} />}
        tone="slate"
        className={kleinKlassen('verlofsaldo')}
        label="Verlofsaldo"
        // Zelfde hoofdgetal als de verlofbalans-kaart: vrij aan te vragen
        // (budget min opgenomen én aangevraagd). Het toonde betaaldResterend
        // (zonder aftrek van aangevraagd), waardoor dashboard en verlofscherm
        // twee verschillende getallen gaven voor hetzelfde saldo.
        value={balans.betaaldVrij}
        suffix={` / ${balans.betaaldBudget}`}
        sub={balans.betaaldAangevraagd > 0 ? `dagen vrij, ${balans.betaaldAangevraagd} aangevraagd` : 'dagen vrij aan te vragen'}
        meter={balans.betaaldBudget > 0 ? Math.round(((balans.betaaldGebruikt + balans.betaaldAangevraagd) / balans.betaaldBudget) * 100) : 0}
        onClick={onNavigate ? () => onNavigate('verlof') : undefined}
      />
    ),
    'deze-maand': (
      <OpsStat
        icon={<CalendarDays size={16} />}
        tone="slate"
        className={kleinKlassen('deze-maand')}
        label="Deze maand"
        value={thisMonthShiftCount}
        sub="dagen met dienst"
        onClick={onNavigate ? () => onNavigate('rooster') : undefined}
      />
    ),
    omleidingen: (
      <OpsStat
        icon={<MapPin size={16} />}
        tone={liveDiversions.length > 0 ? 'amber' : 'slate'}
        className={kleinKlassen('omleidingen')}
        label="Omleidingen"
        value={liveDiversions.length}
        sub={liveDiversions.length === 1 ? 'actieve omleiding' : 'actieve omleidingen'}
        onClick={onNavigate ? () => onNavigate('omleidingen') : undefined}
      />
    ),
  };

  // Panelen: Komende diensten (breed) en Omleidingen; staat er maar één,
  // dan krijgt die de volle breedte.
  const panelenZichtbaar = zichtbareTegels.filter((t) => t.groep === 'panelen' && t.id !== 'snelle-acties');
  const alleenPaneel = panelenZichtbaar.length === 1;
  const PANEEL: Record<string, ReactNode> = {
    'komende-diensten': (
      <OpsPanel
        className={alleenPaneel ? 'lg:col-span-3' : 'lg:col-span-2'}
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
              <p className="text-md font-semibold text-slate-800">Geen komende diensten</p>
              <p className="text-xs font-normal text-slate-600">Er staat op dit moment niets ingepland.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {/* Alleen de eerstvolgende dienst krijgt goud; de rest blijft
                neutraal — hooguit twee gouden accenten per scherm (naam in de
                groet + Vandaag-tegel), controle 05-09 nr. 20. */}
            {upcomingShifts.map((shift, i) => (
              <Fragment key={shift.id}>
                <OpsRow
                  tone={i === 0 ? 'oker' : 'slate'}
                  icon={<Calendar size={16} />}
                  primary={formatShortDayPadded(shift.date)}
                  secondary={`${shift.startTime}–${shift.endTime}${shift.loopnr ? ` · loop ${shift.loopnr}` : ''}`}
                  trailing={<ServiceChip serviceNumber={serviceNumberOf(shift)} tone={i === 0 ? 'oker' : 'slate'} />}
                  onClick={() => onNavigate?.('rooster')}
                />
              </Fragment>
            ))}
          </div>
        )}
      </OpsPanel>
    ),
    'omleidingen-paneel': (
      <OpsPanel
        className={alleenPaneel ? 'lg:col-span-3' : undefined}
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
              <p className="text-md font-semibold text-slate-800">Vrije baan</p>
              <p className="text-xs font-normal text-slate-500">Geen omleidingen op het netwerk.</p>
            </div>
          </div>
        ) : (
          <div className="space-y-1.5">
            {newestDiversions.map((div) => (
              <Fragment key={div.id}>
                <OpsRow
                  tone="amber"
                  leading={<LijnTegel line={div.line} size="sm" />}
                  primary={[div.location, div.title].filter(Boolean).join(' · ')}
                  secondary={[omleidingsPeriode(div), omleidingsTijdshint(div)].filter(Boolean).join(' · ')}
                  onClick={() => setOpenDiversion(div)}
                />
              </Fragment>
            ))}
          </div>
        )}
      </OpsPanel>
    ),
  };

  return (
    <div className="space-y-5">
      {/* Na een release: één dismissbare kaart met wat er nieuw is (src/app/watIsNieuw.ts). */}
      <WatIsNieuwKaart rol={user.role} onNavigate={onNavigate} />

      {/* === Persoonlijke header ===
          Zelfde kop-raster als PageHeader (flex-wrap, actie rechts via
          ml-auto, zakt onder de kop als hij niet past). */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-1 pt-1 md:items-end">
        <div className="min-w-0 flex-1 basis-[14rem] max-w-3xl">
          <h1 className="text-greeting">
            {greeting}, <span className="text-oker-700">{firstName}</span>
          </h1>
          <p className="mt-0.5 text-md font-normal text-slate-500">
            {formatDayLong(isoDate(now))} ·{' '}
            {now.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}
          </p>
        </div>
        {/* Stille chip met gekleurd puntje: "Dienst vandaag" en "in
            behandeling" zijn informatie, geen alarm (afwerking 04-09, nr. 6).
            De stip staat stil — beweging voor "alles is normaal" maakt van
            rust een alarm. Ernaast de enige actie van de kop: "…" met
            Dashboard aanpassen (geen extra gouden knop). */}
        <div className="ml-auto flex items-center gap-2">
          {/* "Vrij/Dienst vandaag" gaat over rijden; voor een technieker
              blijft alleen de verlofstatus over (Jarno 09-09). */}
          {(needsAttention || isRijdend(user.role)) && (
            <Badge tone={needsAttention ? 'amber' : 'emerald'} stil className="w-fit tabular-nums">
              {needsAttention
                ? `${pendingLeaveMine.length} aanvraag${pendingLeaveMine.length === 1 ? '' : 'en'} in behandeling`
                : todaysShift ? 'Dienst vandaag' : 'Vrij vandaag'}
            </Badge>
          )}
          <ActieMenu
            size="sm"
            label="Meer acties"
            items={[{ label: 'Dashboard aanpassen', icon: <SlidersHorizontal size={16} />, onClick: () => setAanpassen(true) }]}
          />
        </div>
      </div>

      {/* === Status-strip ===
          Zelfde raster als het Operations Center: mobiel 2 kolommen, breed
          6 — de 'volgende dienst' krijgt dubbele breedte omdat daar het
          dienstnummer, de tijden en de loopnummers in passen. */}
      {/* Twee rijen op breed: Vandaag + Volgende dienst (elk de helft), daaronder
          de drie kleine tegels (elk een derde). Op één rij van zeven kolommen
          werden de kleine tegels smal en zo hoog als de Vandaag-tegel, met
          afgeknipte labels (Jarno 04-09). Volgorde en zichtbaarheid volgen
          de voorkeuren van de gebruiker (Dashboard aanpassen). */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {stripZichtbaar.map((t) => (
          <Fragment key={t.id}>{STRIP_TEGEL[t.id]}</Fragment>
        ))}
      </div>

      {/* === Panelen === */}
      {panelenZichtbaar.length > 0 && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {panelenZichtbaar.map((t) => (
            <Fragment key={t.id}>{PANEEL[t.id]}</Fragment>
          ))}
        </div>
      )}

      {/* === Snelle acties (alleen zonder zijbalk: op desktop staan dezelfde
          schermen al links, dus daar zijn ze dubbel) === */}
      {onNavigate && toon('snelle-acties') && (
        <div className="grid grid-cols-2 gap-3 lg:hidden">
          {isRijdend(user.role) && <QuickAction icon={<Calendar size={16} />} label="Mijn rooster" sub="Diensten en agenda" onClick={() => onNavigate('rooster')} />}
          <QuickAction icon={<Plane size={16} />} label="Verlof aanvragen" sub="Saldo en aanvragen" onClick={() => onNavigate('verlof')} />
          {isRijdend(user.role) && <QuickAction icon={<Wrench size={16} />} label="Defect melden" sub="Iets mis met de bus?" onClick={() => setDefectMelden(true)} />}
          {isRijdend(user.role) && <QuickAction icon={<RefreshCw size={16} />} label="Dienstruil" sub="Ruilen met een collega" onClick={() => onNavigate('ruil-verzoeken')} />}
          <QuickAction icon={<FileText size={16} />} label="Documenten" sub="Wat de planning klaarzet" onClick={() => onNavigate('documenten')} />
          {isRijdend(user.role) && <QuickAction icon={<Users size={16} />} label="Maandplanning" sub="Wie rijdt wanneer" onClick={() => onNavigate('bezetting')} />}
        </div>
      )}

      {/* Omleiding-detail als premium side panel */}
      <SlideOver
        open={!!openDiversion}
        onClose={() => setOpenDiversion(null)}
        title={openDiversion?.title ?? 'Omleiding'}
        subtitle={openDiversion ? [lijnLabel(openDiversion.line), openDiversion.location].filter(Boolean).join(' · ') : undefined}
        icon={openDiversion ? <LijnTegel line={openDiversion.line} /> : undefined}
      >
        {openDiversion && <OmleidingDetail diversion={openDiversion} />}
      </SlideOver>

      <DashboardAanpassen
        open={aanpassen}
        onClose={() => setAanpassen(false)}
        tegels={tegelCatalogus}
        voorkeuren={voorkeuren}
        onChange={bewaarVoorkeuren}
      />
      {defectMelden && (
        <Suspense fallback={null}>
          <LazyDefectMeldenModal open onClose={() => setDefectMelden(false)} currentUser={user} />
        </Suspense>
      )}
    </div>
  );
}
