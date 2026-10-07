/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useState, useEffect, useRef } from 'react';
import { useRoute, routeUitUrl } from './app/router';
import { isBreed, magView, routeVan, sectieLabel } from './app/routes';
import { useAppData } from './app/useAppData';
import { useLaag } from './lib/lagen';
import { RITBLAD_BUNDEL_EVENT } from './lib/ritblad';
import { View, isStaf } from './types';
import { type ToastEventDetail } from './lib/ui';
import { useToasts } from './app/useToasts';
import { useSessie, type SessieKoppelingen } from './app/useSessie';
import { kiesVoorscherm } from './app/Voorschermen';
import { useLiveUpdates } from './app/useLiveUpdates';
import { useNieuweVersie } from './app/useNieuweVersie';
import { useMeldingNavigatie, usePush } from './app/usePush';
import { useAppBadge, useBadges, useWerkvoorraad } from './app/useBadges';
import { WARMUP_VIEWS, warmViews } from './app/viewLoaders';
import { addBreadcrumb } from './lib/monitoring';
import { useAanwezigheid } from './lib/presence';
import { usePullToRefresh } from './lib/usePullToRefresh';
import { useThema } from './app/useThema';
import { abonneerOnline, isOnlineNu, useOnline } from './lib/useOnline';
import { useOnderhoud } from './app/useOnderhoud';
import { AppSchil, laadWerkvoorraadMenu, laadAccountOverlays } from './app/AppSchil';


export default function App() {
  // Sessie en aanmeldketen (src/app/useSessie.ts, stap 6 van de splitsing). De
  // koppelingen naar toasts, push en datalaag worden verderop gezet; de hook
  // leest ze pas op het moment van gebruik.
  const koppelingen = useRef<SessieKoppelingen | null>(null);
  const sessie = useSessie(koppelingen);
  const { session, currentUser, deviceBlocked, tweeStaps, sessieBeeindigdRef, toestelGeblokkeerdRef, handleLogout } = sessie;
  // Niets laden vóór aal2 (07-10): zolang het codescherm van de tweede stap
  // of het toestel-wachtscherm staat, praat geen enkele hook met de API. Een
  // nieuwe hook die de API aanspreekt hangt aan `dataKlaar`, niet aan
  // `currentUser` alleen.
  const dataKlaar = !!session && !!currentUser && !deviceBlocked && !tweeStaps;
  // Waar we zijn = de URL (src/app/router.ts): terugknop, deeplinks en
  // refresh-op-dezelfde-plek werken daardoor vanzelf.
  const { view: currentView, navigeer } = useRoute();
  // Aanwezigheid (staf ziet elkaar in de topbar) + broodkruimel per schermwissel (foutrapporten).
  useAanwezigheid(!!session && !!currentUser, { userId: String(currentUser?.id ?? ''), naam: currentUser?.name ?? '', rol: currentUser?.role, view: currentView });
  useEffect(() => { addBreadcrumb('navigatie', currentView); }, [currentView]);
  // Aankomen op het scherm waar een melding naar wijst = die melding gelezen
  // (ook via een push-tik of deeplink); de bel- en app-badge zakken meteen
  // mee in plaats van te blijven staan tot iemand het meldingenscherm opent.
  useEffect(() => {
    if (!currentUser) return;
    markeerMeldingenGelezenVoorScherm(currentView, (doel) => routeUitUrl('/' + doel.replace(/^\/+/, ''))?.view ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, currentUser?.id]);
  // Netwerkstatus uit de online-store (src/lib/useOnline.ts): dezelfde
  // waarheid als Mijn dag en de ritbladviewer, mét ping-fallback voor
  // "wifi zonder internet". Bij terug-online meteen stil bijverversen; via
  // een ref, want het effect heeft lege deps en zou anders een verouderde
  // currentUser vasthouden.
  const isOnline = useOnline();
  const onlineCatchUpRef = useRef<() => void>(() => {});
  useEffect(() => {
    let vorige = isOnlineNu();
    return abonneerOnline(() => {
      const nu = isOnlineNu();
      if (nu && !vorige) onlineCatchUpRef.current();
      vorige = nu;
    });
  }, []);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  // Admin-only preview: toont het portaal (nav + dashboard) zoals een chauffeur
  // het ziet. Puur visueel — rechten/data blijven admin. Reset bij herladen.
  const [previewChauffeur, setPreviewChauffeur] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  // "Meld een probleem" (testfase): vrije tekst → client_errors met bron
  // 'gebruikersmelding', zichtbaar in Systeem Status en de dagoverzicht-mail.
  const [showProbleemMelder, setShowProbleemMelder] = useState(false);
  const [showAgenda, setShowAgenda] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [viewFoutReset, setViewFoutReset] = useState(0);
  const { theme, toggleTheme } = useThema(currentUser);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Navigeren = bovenaan beginnen; terug = de oude positie terug. Dat zit
  // sinds 15-09 (punt 19) in de router zelf (scrollgeheugen per route,
  // src/lib/scrollGeheugen.ts): vroeger scrolde deze wrapper vóór elke
  // navigeer naar 0 (controle-ronde 27-08, bevinding 10), maar dan was de
  // positie al weg voordat de router hem kon bewaren, en bij popstate
  // landde je willekeurig. De router scrolt nog steeds vóór de nieuwe view
  // rendert, zodat een view die bij het openen zelf scrolt het laatste
  // woord houdt; dezelfde tab nog eens kiezen = ook naar boven.
  const setCurrentView = useCallback((next: View) => {
    navigeer(next);
  }, [navigeer]);
  // Tik op een melding terwijl het portaal open staat (src/app/usePush.ts).
  useMeldingNavigatie(navigeer);
  const ptrIndicatorRef = useRef<HTMLDivElement>(null);
  // Ruil starten vanuit het rooster: de gekozen dienst wordt in de ruil-wizard
  // voorgeselecteerd.
  const [swapPreselectShiftId, setSwapPreselectShiftId] = useState<string | null>(null);
  // Datalaag (src/app/useAppData.ts, per domein in src/app/data/*).
  // showToast/meldLaadfout staan verderop als const — de wrappers roepen ze
  // pas aan op het moment van gebruik. `appData` gaat ook als geheel de
  // AppDataProvider in (rond de schil), zodat views het via
  // useAppDataContext() kunnen lezen i.p.v. via een stapel props.
  const appData = useAppData({
    session,
    currentUser,
    currentView,
    showToast: (m, t, a, o) => showToast(m, t, a, o),
    meldLaadfout: (b, f) => meldLaadfout(b, f),
  });
  const {
    shifts, users, swaps, leaveRequests, lastSeenLeaveDecisionAt, unseenDocuments,
    planningMatrixHistory, coverageDays, vervaldata, pendingDevices,
    isInitialLoad, setIsInitialLoad, lastSyncedAt, setLastSyncedAt,
    usersGeladen, swapsGeladen,
    loadAppData, refreshAll, resetAll,
    fetchUpdates, fetchSwaps, fetchLeave, markDocumentsSeen,
    fetchPlanningMatrix, fetchPlanningMatrixHistory, refreshCoverageGaps,
    fetchMyNotes,
    fetchUsers, fetchPlanning, fetchDiversions,
    fetchMeldingen, ongelezenMeldingen, markeerMeldingenGelezenVoorScherm,
  } = appData;
  // Toasts en de gebundelde laadfout (src/app/useToasts.ts). De twee vlaggen
  // hierboven blijven van de sessie; de hook leest ze alleen.
  const { toasts, showToast, dismissToast, meldLaadfout, meldOnderhoud, wisFouten, wisToasts } = useToasts({
    sessieBeeindigdRef,
    toestelGeblokkeerdRef,
    opnieuwLaden: () => { void refreshAll(); },
  });

  // Op mobiel is de dichte sidebar alleen visueel weggeschoven
  // (-translate-x-full): zonder `inert` bleef hij focusbaar en landde
  // Tab/VoiceOver onzichtbaar buiten beeld. Op lg+ staat hij altijd in
  // beeld en moet hij juist wél bereikbaar blijven.
  const [isDesktopNav, setIsDesktopNav] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const luister = (e: MediaQueryListEvent) => setIsDesktopNav(e.matches);
    mq.addEventListener('change', luister);
    return () => mq.removeEventListener('change', luister);
  }, []);

  // De mobiele zijbalk is een laag in de gedeelde stapel (src/lib/lagen.ts):
  // terugknop/swipe-back sluit hem i.p.v. de app te verlaten, Escape sluit
  // alleen hem, en de scroll-lock (src/lib/scrollSlot.ts) hangt aan dezelfde
  // levensloop, anders kan iOS Safari de aside-inhoud "rubber-banden" of de
  // hoofdpagina laten meebewegen.
  useLaag({ open: isSidebarOpen && !isDesktopNav, sluit: () => setIsSidebarOpen(false), soort: 'zijbalk', scrollSlot: 'zijbalk' });

  // openHuidigRitblad() vraagt met een gebeurtenis of de app de bundel zelf
  // kan tonen; zo blijft de PWA-schil staan en werkt het offline uit de
  // service-worker-cache (controle 16-09, nr. 10).
  const [bundelOpen, setBundelOpen] = useState(false);
  useEffect(() => {
    const onBundel = (e: Event) => {
      e.preventDefault(); // bevestigt aan openHuidigRitblad dat wij het doen
      setBundelOpen(true);
    };
    window.addEventListener(RITBLAD_BUNDEL_EVENT, onBundel);
    return () => window.removeEventListener(RITBLAD_BUNDEL_EVENT, onBundel);
  }, []);
  // Geen eigen history-entry: de Modal van de RitbladViewer is zelf een laag.
  // Een tweede entry hier liet na het kruisje een dode terugstap achter.

  // Live-updates via Supabase Realtime (src/app/useLiveUpdates.ts): de
  // refetchers per collectie; niet zolang het toestel-wachtscherm staat.
  useLiveUpdates(dataKlaar, currentUser, {
    fetchLeave, fetchSwaps, fetchDiversions, fetchUpdates, fetchMyNotes, fetchMeldingen,
    fetchPlanning, fetchPlanningMatrix, fetchPlanningMatrixHistory, refreshCoverageGaps, fetchUsers,
  });

  // Terug online (offline-banner verdwijnt): zelfde catch-up als realtime —
  // gemiste events zijn definitief weg — en daarna de sync-tijd verversen,
  // zodat "gegevens van HH:MM" bij een volgende uitval klopt.
  onlineCatchUpRef.current = () => {
    if (!currentUser || toestelGeblokkeerdRef.current || tweeStaps) return;
    const planningFilter = isStaf(currentUser.role) ? undefined : { driverId: String(currentUser.id) };
    void Promise.allSettled([
      fetchMyNotes(),
      fetchLeave(),
      fetchSwaps(),
      fetchDiversions(undefined, { silent: true }),
      fetchUpdates(),
      fetchPlanning(undefined, planningFilter, { silent: true }),
      ...(isStaf(currentUser.role)
        ? [refreshCoverageGaps(), fetchPlanningMatrix(), fetchPlanningMatrixHistory()]
        : []),
    ]).then(() => {
      if (typeof navigator === 'undefined' || navigator.onLine) setLastSyncedAt(Date.now());
    });
  };

  // Nieuwe versie van het portaal klaar (src/app/useNieuweVersie.ts).
  useNieuweVersie(showToast);

  // Push-notificaties (src/app/usePush.ts): sleutel, schakelaar en abonnement.
  const { pushPublicKey, pushEnabled, togglePush, resetPush } = usePush({ currentUser: dataKlaar ? currentUser : null, session, showToast });
  // De koppelingen van de sessiehook (zie useSessie): elke render de verse
  // functies, gelezen op het moment van gebruik.
  koppelingen.current = { showToast, wisToasts, wisFouten, resetPush, resetAll, setIsInitialLoad, loadAppData, fetchUsers, setCurrentView, currentView };


  // Onderhoudsmodus (src/app/useOnderhoud.ts): banner boven de inhoud zolang
  // actief; bij een geblokkeerde schrijfactie één info-toast.
  const onderhoud = useOnderhoud(dataKlaar, (tekst) => meldOnderhoud(tekst));


  useEffect(() => {
    const handler = (event: Event) => {
      const { detail } = event as CustomEvent<ToastEventDetail>;
      showToast(detail.message, detail.tone, detail.action, detail.opties);
    };

    window.addEventListener('vhb-toast', handler as EventListener);
    return () => window.removeEventListener('vhb-toast', handler as EventListener);
  }, []);


  useEffect(() => {
    if (!currentUser) {
      return;
    }

    if (!magView(currentUser, currentView)) {
      navigeer('dashboard', { replace: true });
      showToast('Dit scherm is niet beschikbaar voor jouw rol.', 'info');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, currentView]);


  // Pull-to-refresh (PWA): sleep omlaag bovenaan → alle data opnieuw ophalen.
  // `enabled` op !!currentUser zodat de hook (her)bindt zodra de scroll-
  // container gemonteerd is (bij de koude start bestaat die nog niet).
  const { refreshing: ptrRefreshing } = usePullToRefresh(scrollContainerRef, ptrIndicatorRef, refreshAll, !!currentUser);


  // Tellers voor de badges (src/app/useBadges.ts): verlofbeslissingen,
  // wachtende verlof- en ruilaanvragen, ruilen die op mij wachten.
  const { unseenLeaveDecisionCount, ruilDataKlaar, pendingLeaveCount, pendingSwapsCount, targetedSwapsCount } = useBadges(currentUser, {
    leaveRequests, lastSeenLeaveDecisionAt, swaps, swapsGeladen, usersGeladen,
  });

  // Werkvoorraad van de planner (src/app/useBadges.ts): één berekening voor
  // topbar-knop, app-icoon-badge en het Open taken-paneel.
  const { isStafRol, werkvoorraad } = useWerkvoorraad(currentUser, {
    users, shifts, leaveRequests, swaps, planningMatrixHistory, coverageDays, vervaldata, pendingDevices,
  });

  // Badge op het app-icoon (src/app/useBadges.ts).
  useAppBadge(currentUser, isStafRol, werkvoorraad, ongelezenMeldingen);

  // Stille warmup van de lazy views die hierna waarschijnlijk geopend worden,
  // zodat de eerste navigatie instant voelt zonder de startbundel te
  // vergroten. Sinds 14-09 (punt 18) niet meer bij de eerste idle-callback
  // maar pas ná de LCP + marge, en alleen dównloaden (prefetch-link via de
  // chunk-kaart van de build) in plaats van evalueren: de oude warmup legde
  // 75 kB brotli (>250 kB JS) aan evaluatiewerk midden in het meetvenster
  // (Lighthouse /mijn-dag 0,81 / LCP 4,5 s tegen 0,85 / 3,9 s zonder warmup;
  // CI-TBT 575-1037 ms). Lijsten per rol en de hele werkwijze: warmViews in
  // src/app/viewLoaders.ts. Bewust NIET de xlsx-views (500 kB) en niet
  // 'verlof' (schemas + zod, hover-prefetch dekt hem).
  useEffect(() => {
    if (!currentUser || isInitialLoad) return;
    return warmViews(WARMUP_VIEWS[currentUser.role === 'chauffeur' ? 'chauffeur' : 'staf']);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, currentUser?.role, isInitialLoad]);

  // Overlays voorladen op het moment dat ze waarschijnlijk worden: de
  // werkvoorraad-knop staat voor staf altijd in de topbar (meteen ophalen,
  // parallel met de data, zodat het plekje maar een oogwenk leeg is); de
  // account-overlays zodra Instellingen open staat (de knoppen zitten daar).
  useEffect(() => {
    if (currentUser && isStaf(currentUser.role)) void laadWerkvoorraadMenu();
  }, [currentUser?.role]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (currentView === 'instellingen') laadAccountOverlays();
  }, [currentView]);


  // Print-modus: voor wie de luie module het blad weigerde (rol mag het niet),
  // tonen we het portaal; per gebruiker, zodat een andere login opnieuw kijkt.
  const [printGeweigerdVoor, setPrintGeweigerdVoor] = useState<string | null>(null);
  const geenPrintblad = useCallback(() => setPrintGeweigerdVoor(currentUser?.id ?? null), [currentUser?.id]);


  // Voorschermen (src/app/Voorschermen.tsx, stap 5 van de splitsing): laden,
  // printblad, configuratie, uitnodiging, wachtwoordherstel, tweede stap,
  // toestel wacht, inlogscherm. Pas daarna de app zelf.
  const voorscherm = kiesVoorscherm({ sessie, users, shifts, leaveRequests, isInitialLoad, printGeweigerdVoor, geenPrintblad });
  if (voorscherm) return voorscherm;
  // Zonder gebruiker gaf kiesVoorscherm het inlogscherm terug; dit is alleen
  // de typevernauwing voor wat volgt.
  if (!currentUser) return null;

  const isRealAdmin = currentUser.role === 'admin';
  // In preview-modus rendert alles op chauffeur-niveau (nav-secties verdwijnen,
  // dashboard toont de chauffeursvariant). allowedViews/guard blijven bewust op
  // de échte rol zodat er niets wordt weg-geredirect.
  const previewingChauffeur = isRealAdmin && previewChauffeur;
  const effectiveRole = previewingChauffeur ? 'chauffeur' : currentUser.role;
  const isPlanner = effectiveRole === 'planner' || effectiveRole === 'admin';
  const isAdmin = effectiveRole === 'admin';
  const resolvedCurrentView: View = magView(currentUser, currentView) ? currentView : 'dashboard';
  // Titel in de topbar = het label uit de routetabel (één naam per scherm).
  const currentMeta = { title: routeVan(resolvedCurrentView).label };
  // Kolombreedte van de schil volgt de route (routes.tsx `breed`): topbar,
  // banners en #hoofdinhoud even breed als de PageShell van het scherm.
  const kolomClass = isBreed(resolvedCurrentView) ? 'max-w-[var(--content-max-breed)]' : 'max-w-[var(--content-max)]';
  const sectie = sectieLabel(resolvedCurrentView);
  // Volledige initialen ("Jarno De Greve" → JDG), gecapt op 4 voor extreem
  // lange namen (avatar is maar 32px breed).
  const userInitials = currentUser.name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 4)
    .join('')
    .toUpperCase() || '?';

  return (
    <AppSchil
      appData={appData}
      toasts={toasts}
      dismissToast={dismissToast}
      resolvedCurrentView={resolvedCurrentView}
      showChangePassword={showChangePassword}
      setShowChangePassword={setShowChangePassword}
      currentUser={currentUser}
      session={session}
      showProbleemMelder={showProbleemMelder}
      setShowProbleemMelder={setShowProbleemMelder}
      currentView={currentView}
      showAgenda={showAgenda}
      setShowAgenda={setShowAgenda}
      shifts={shifts}
      bundelOpen={bundelOpen}
      setBundelOpen={setBundelOpen}
      isSidebarOpen={isSidebarOpen}
      setIsSidebarOpen={setIsSidebarOpen}
      isDesktopNav={isDesktopNav}
      setCurrentView={setCurrentView}
      effectiveRole={effectiveRole}
      unseenDocuments={unseenDocuments}
      isPlanner={isPlanner}
      pendingSwapsCount={pendingSwapsCount}
      targetedSwapsCount={targetedSwapsCount}
      pendingLeaveCount={pendingLeaveCount}
      unseenLeaveDecisionCount={unseenLeaveDecisionCount}
      markDocumentsSeen={markDocumentsSeen}
      ptrIndicatorRef={ptrIndicatorRef}
      ptrRefreshing={ptrRefreshing}
      scrollContainerRef={scrollContainerRef}
      setIsScrolled={setIsScrolled}
      isScrolled={isScrolled}
      kolomClass={kolomClass}
      sectie={sectie}
      currentMeta={currentMeta}
      isRealAdmin={isRealAdmin}
      previewChauffeur={previewChauffeur}
      setPreviewChauffeur={setPreviewChauffeur}
      werkvoorraad={werkvoorraad}
      users={users}
      userInitials={userInitials}
      theme={theme}
      toggleTheme={toggleTheme}
      pushPublicKey={pushPublicKey}
      pushEnabled={pushEnabled}
      togglePush={togglePush}
      handleLogout={handleLogout}
      onderhoud={onderhoud}
      isOnline={isOnline}
      lastSyncedAt={lastSyncedAt}
      viewFoutReset={viewFoutReset}
      setViewFoutReset={setViewFoutReset}
      navigeer={navigeer}
      isAdmin={isAdmin}
      previewingChauffeur={previewingChauffeur}
      ruilDataKlaar={ruilDataKlaar}
      swapPreselectShiftId={swapPreselectShiftId}
      setSwapPreselectShiftId={setSwapPreselectShiftId}
    />
  );
}


