/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, Suspense, useState, useEffect, useRef } from 'react';
import { useRoute, routeUitUrl } from './app/router';
import { magView, routeVan } from './app/routes';
import { SidebarNav } from './app/SidebarNav';
import { SessieLaden, ProfielLaden, PrintLaden, ConfigOntbreekt, ToestelGeblokkeerd } from './app/PreAppScreens';
import { AppSkeleton, heeftOpgeslagenSessie } from './app/AppSkeleton';
import { ProbleemMelder } from './app/ProbleemMelder';
import { useAppData } from './app/useAppData';
import { AppDataProvider } from './app/AppDataContext';
import { CalendarSubscribeModal } from './components/CalendarSubscribeModal';
import { downloadRoosterIcs } from './lib/roosterIcs';
import { ViewFout } from './app/ViewFout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useHistoryDismiss } from './lib/useHistoryDismiss';
import {
  Bell,
  Eye,
  Menu,
  RefreshCw,
  WifiOff,
  X,
} from 'lucide-react';
import { formatSyncedTime } from './lib/format';
import { motion, AnimatePresence } from 'motion/react';
import type { Session } from '@supabase/supabase-js';
import { View, User } from './types';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { applyThemeColorMeta, cn, LOGIN_MELDING_KEY, onthoudEffectiefThema, vergeetEffectiefThema, wisOfflineCaches, type ToastEventDetail } from './lib/ui';
import { apiFetch, vernieuwSessie } from './lib/api';
import { lazyWithRetry } from './lib/lazyRetry';
import { VIEW_LOADERS, prefetchView } from './app/viewLoaders';
import { addBreadcrumb, reportHandledError, setMonitoringUser } from './lib/monitoring';
import { useAanwezigheid } from './lib/presence';
import { meldLive } from './lib/liveSignaal';
import { AanwezigheidStack } from './components/AanwezigheidStack';
import { fetchPushPublicKey, getExistingSubscription, isPushSupported, subscribeToPush, unsubscribeFromPush } from './lib/push';
import { deriveDeviceName, deviceHeaders } from './lib/device';
import { usePullToRefresh } from './lib/usePullToRefresh';
import { ViewLoader } from './components/ui';
import { IconButton, MicroLabel } from './components/primitives';
import { Card } from './components/Card';
import { Toast, ToastOpties, ToastStack } from './components/ToastStack';
import { OfflineBanner, InstallPrompt } from './components/PwaChrome';
import { BottomNav } from './components/BottomNav';
import { BrandLogo } from './components/BrandLogo';
import { OmgevingLabel } from './components/OmgevingLabel';
import { UserMenu } from './components/UserMenu';
import { WerkvoorraadMenu } from './components/WerkvoorraadMenu';
import { berekenWerkvoorraad } from './lib/werkvoorraad';
import { BrandSpinner } from './components/BrandSpinner';
import { ChangePasswordModal } from './components/ChangePasswordModal';
import { LoginView } from './views/LoginView';
import { useRealtimeSync } from './lib/realtime';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { WatIsNieuwKaart } from './components/WatIsNieuwKaart';
// Planner/admin-views lazy: chauffeurs (de bulk van de gebruikers) laden zo
// géén beheer-code en vooral géén xlsx-bundel (~430 kB) bij het opstarten —
// die zit alleen in ManageSchedules/ManageServices/Reports/ManageUsers.
const LazyActivityLogView = lazyWithRetry(() => import('./views/admin/ActivityLogView').then((module) => ({ default: module.ActivityLogView })));
const LazyOcpiDashboardView = lazyWithRetry(() => import('./views/admin/OcpiDashboardView').then((module) => ({ default: module.OcpiDashboardView })));
const LazyVervaldataView = lazyWithRetry(() => import('./views/admin/VervaldataView').then((module) => ({ default: module.VervaldataView })));
const LazyZiekteView = lazyWithRetry(() => import('./views/admin/ZiekteView').then((module) => ({ default: module.ZiekteView })));
const LazyManageSchedulesView = lazyWithRetry(() => import('./views/admin/ManageSchedulesView').then((module) => ({ default: module.ManageSchedulesView })));
const LazyPlanningMatrixView = lazyWithRetry(() => import('./views/admin/PlanningMatrixView').then((module) => ({ default: module.PlanningMatrixView })));
const LazyPlanningCodesView = lazyWithRetry(() => import('./views/admin/PlanningCodesView').then((module) => ({ default: module.PlanningCodesView })));
const LazyManageDiversionsView = lazyWithRetry(() => import('./views/admin/ManageDiversionsView').then((module) => ({ default: module.ManageDiversionsView })));
const LazyManageServicesView = lazyWithRetry(() => import('./views/admin/ManageServicesView').then((module) => ({ default: module.ManageServicesView })));
const LazyVerlofKalenderView = lazyWithRetry(() => import('./views/admin/VerlofKalenderView').then((module) => ({ default: module.VerlofKalenderView })));
const LazyCoverageView = lazyWithRetry(() => import('./views/CoverageView').then((module) => ({ default: module.CoverageView })));
const LazyAssistentView = lazyWithRetry(() => import('./views/AssistentView').then((module) => ({ default: module.AssistentView })));
const LazyDebugView = lazyWithRetry(() => import('./views/admin/DebugView').then((module) => ({ default: module.DebugView })));
const LazyManageUpdatesView = lazyWithRetry(() => import('./views/admin/ManageUpdatesView').then((module) => ({ default: module.ManageUpdatesView })));
const LazyManageUsersView = lazyWithRetry(() => import('./views/admin/ManageUsersView').then((module) => ({ default: module.ManageUsersView })));
const LazyDevicesView = lazyWithRetry(() => import('./views/admin/DevicesView').then((module) => ({ default: module.DevicesView })));
const LazyLeaveManagementView = lazyWithRetry(() => import('./views/LeaveManagementView').then((module) => ({ default: module.LeaveManagementView })));
// Ook lazy (planner/admin-only, maar stond eager in de hoofdbundel): de
// ops-cockpit sleept ops/coverage/monthPlanning mee die een chauffeur nooit
// nodig heeft; het dienstoverzicht idem.
// Chauffeursviews ook lazy (nr. 12, 03-09): de startbundel is alleen nog de
// schil; SidebarNav/BottomNav prefetchen bij hover/aanraken (viewLoaders).
const LazyContactsView = lazyWithRetry(() => VIEW_LOADERS['contacten']().then((m) => ({ default: (m as typeof import('./views/ContactsView')).ContactsView })));
const LazyDashboardView = lazyWithRetry(() => VIEW_LOADERS['dashboard']().then((m) => ({ default: (m as typeof import('./views/DashboardView')).DashboardView })));
const LazyMijnDagView = lazyWithRetry(() => VIEW_LOADERS['mijn-dag']().then((m) => ({ default: (m as typeof import('./views/MijnDagView')).MijnDagView })));
const LazyDiversionsView = lazyWithRetry(() => VIEW_LOADERS['omleidingen']().then((m) => ({ default: (m as typeof import('./views/DiversionsView')).DiversionsView })));
const LazyScheduleView = lazyWithRetry(() => VIEW_LOADERS['rooster']().then((m) => ({ default: (m as typeof import('./views/ScheduleView')).ScheduleView })));
const LazyUpdatesView = lazyWithRetry(() => VIEW_LOADERS['updates']().then((m) => ({ default: (m as typeof import('./views/UpdatesView')).UpdatesView })));
const LazySwapRequestsView = lazyWithRetry(() => VIEW_LOADERS['ruil-verzoeken']().then((m) => ({ default: (m as typeof import('./views/SwapRequestsView')).SwapRequestsView })));
const LazyRitblaadjesView = lazyWithRetry(() => VIEW_LOADERS['ritblaadjes']().then((m) => ({ default: (m as typeof import('./views/RitblaadjesView')).RitblaadjesView })));
const LazyDocumentsView = lazyWithRetry(() => VIEW_LOADERS['documenten']().then((m) => ({ default: (m as typeof import('./views/DocumentsView')).DocumentsView })));
const LazyCapacityView = lazyWithRetry(() => VIEW_LOADERS['bezetting']().then((m) => ({ default: (m as typeof import('./views/CapacityView')).CapacityView })));
const LazyDesignsysteemView = lazyWithRetry(() => VIEW_LOADERS['designsysteem']().then((m) => ({ default: (m as typeof import('./views/admin/DesignsysteemView')).DesignsysteemView })));
const LazyInstellingenView = lazyWithRetry(() => VIEW_LOADERS['instellingen']().then((m) => ({ default: (m as typeof import('./views/InstellingenView')).InstellingenView })));
const LazyPlannerDashboardWidgets = lazyWithRetry(() => import('./views/PlannerDashboardWidgets').then((module) => ({ default: module.PlannerDashboardWidgets })));
const LazyServicesView = lazyWithRetry(() => import('./views/ServicesView').then((module) => ({ default: module.ServicesView })));
const LazyPrintMonthlyScheduleView = lazyWithRetry(() => import('./views/PrintMonthlyScheduleView').then((module) => ({ default: module.PrintMonthlyScheduleView })));
const LazyPrintLeaveYearView = lazyWithRetry(() => import('./views/PrintLeaveYearView').then((module) => ({ default: module.PrintLeaveYearView })));







export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  // Eén keer bij het opstarten bepaald: warme start = er is al een sessie.
  const [warmeStart] = useState(() => typeof window !== 'undefined' && heeftOpgeslagenSessie());
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  // Waar we zijn = de URL (src/app/router.ts): terugknop, deeplinks en
  // refresh-op-dezelfde-plek werken daardoor vanzelf.
  const { view: currentView, navigeer } = useRoute();
  // Aanwezigheid (staf ziet elkaar in de topbar) + broodkruimel per schermwissel (foutrapporten).
  useAanwezigheid(!!session && !!currentUser, { userId: String(currentUser?.id ?? ''), naam: currentUser?.name ?? '', rol: currentUser?.role, view: currentView });
  useEffect(() => { addBreadcrumb('navigatie', currentView); }, [currentView]);
  const [isLoading, setIsLoading] = useState(false);
  // Netwerkstatus voor de topbar-pill (was hardcoded "Online").
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));
  // Via een ref (het effect heeft lege deps en zou anders een verouderde
  // currentUser vasthouden): bij terug-online meteen stil bijverversen.
  const onlineCatchUpRef = useRef<() => void>(() => {});
  useEffect(() => {
    const on = () => { setIsOnline(true); onlineCatchUpRef.current(); };
    const off = () => setIsOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  // Admin-only preview: toont het portaal (nav + dashboard) zoals een chauffeur
  // het ziet. Puur visueel — rechten/data blijven admin. Reset bij herladen.
  const [previewChauffeur, setPreviewChauffeur] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  // "Meld een probleem" (testfase): vrije tekst → client_errors met bron
  // 'gebruikersmelding', zichtbaar in Systeem Status en de dagoverzicht-mail.
  const [showProbleemMelder, setShowProbleemMelder] = useState(false);
  const [showAgenda, setShowAgenda] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [viewFoutReset, setViewFoutReset] = useState(0);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const isPasswordRecoveryRef = useRef(false);
  // Overlay-logica: meerdere fetches kunnen parallel lopen — een boolean
  // zette de overlay uit zodra de éérste klaar was. Teller fixt dat.
  const loadingCountRef = useRef(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Navigeren = bovenaan beginnen. De scroll-root is één element voor alle
  // views, dus wie onderaan Rooster op de dock-tab Verlof tikte, landde
  // halverwege Verlof mét de topbar-schaduw al aan (controle-ronde 27-08,
  // bevinding 10). Reset hier, vóór de nieuwe view rendert, zodat een view
  // die bij het openen zelf scrolt (assistent naar het laatste bericht) het
  // laatste woord houdt. Dezelfde tab nog eens kiezen = ook naar boven.
  const setCurrentView = useCallback((next: View) => {
    scrollContainerRef.current?.scrollTo({ top: 0 });
    navigeer(next);
  }, [navigeer]);
  // Deeplink terwijl het portaal al open staat: de service worker stuurt bij
  // een tik op een melding een NAVIGATE-bericht i.p.v. het venster te
  // herladen (zie sw.js notificationclick) — een open formulier blijft zo
  // staan. Onbekende views negeren; de rol-guard doet de rest.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'NAVIGATE') return;
      const route = routeUitUrl(String(event.data.url ?? ''));
      if (route) { scrollContainerRef.current?.scrollTo({ top: 0 }); navigeer(route.view, { params: route.params }); }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigeer]);
  const ptrIndicatorRef = useRef<HTMLDivElement>(null);
  // Ruil starten vanuit het rooster: de gekozen dienst wordt in de ruil-wizard
  // voorgeselecteerd.
  const [swapPreselectShiftId, setSwapPreselectShiftId] = useState<string | null>(null);
  const beginLoading = () => {
    loadingCountRef.current += 1;
    setIsLoading(true);
  };
  const endLoading = () => {
    loadingCountRef.current = Math.max(0, loadingCountRef.current - 1);
    if (loadingCountRef.current === 0) setIsLoading(false);
  };
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
    meldLaadfout: (b) => meldLaadfout(b),
    beginLoading,
    endLoading,
  });
  const {
    shifts, users, diversions, services, updates, swaps, leaveRequests, lastSeenLeaveDecisionAt, unseenDocuments, myNotes,
    planningMatrixRows, planningCodes, planningMatrixHistory, activityLog, loginActivity, coverageDays, vervaldata, pendingDevices,
    isInitialLoad, setIsInitialLoad, lastSyncedAt, setLastSyncedAt,
    loadAppData, refreshAll, resetAll,
    fetchUpdates, saveUpdates, sendUrgentEmail, fetchSwaps, saveSwaps, fetchLeave, markDocumentsSeen,
    fetchPlanningMatrix, fetchPlanningMatrixHistory, refreshCoverageGaps, fetchActivityLog,
    savePlanningCodes, markLeaveDecisionsSeen, saveLeave, reportSick, decideLeave, decideSwap, confirmSwapSeen, fetchMyNotes,
    saveServices, fetchUsers, fetchPlanning, savePlanning, fetchDiversions, saveDiversions,
    saveDiversion, createDiversion, deleteDiversion, saveUpdate, createUpdate, deleteUpdate,
  } = appData;
  // Toast-ids: Date.now()+random kon botsen (dubbele keys, dismiss
  // verwijderde dan twee meldingen tegelijk).
  const toastIdRef = useRef(0);
  // Staat de sessie op uitloggen? Dan zijn alle lopende calls gedoemd en
  // onderdrukken we hun individuele fout-toasts (zie showToast/forceSignOut).
  const sessieBeeindigdRef = useRef(false);
  // Laadfouten van gelijktijdige calls verzamelen: bij een hik (netwerk,
  // uitrol) faalt de hele reeks tegelijk en kreeg je vier losse rode
  // meldingen. We bundelen ze tot één melding mét "Opnieuw proberen".
  const laadfoutenRef = useRef<Set<string>>(new Set());
  const laadfoutTimerRef = useRef<number | null>(null);
  // Reden van een gedwongen uitlog, door te geven aan het inlogscherm.
  const [uitlogMelding, setUitlogMelding] = useState<'sessie' | 'account' | ''>('');
  // Dubbele-init-guard: bootstrap én het INITIAL_SESSION/SIGNED_IN-event
  // proberen allebei te initialiseren; per gebruiker doen we het één keer.
  // `initialized` = klaar (blijft na succes); `initializing` = nú bezig, en
  // wordt SYNCHROON bij binnenkomst gezet. Zonder die tweede vlag passeerden
  // bij een koude start beide aanroepers de check vóór de vlag ná de awaits
  // gezet was → alles dubbel gefetcht (toestel-registratie, profiel, ±10
  // loadAppData-calls, aanwezigheids-ping).
  const initializedUserIdRef = useRef<string | null>(null);
  const initializingUserIdRef = useRef<string | null>(null);
  const setRecoveryMode = (v: boolean) => {
    isPasswordRecoveryRef.current = v;
    setIsPasswordRecovery(v);
  };

  // Body-scroll lock wanneer de mobiele sidebar open is — anders kan iOS
  // Safari de aside-inhoud "rubber-banden" of de hoofdpagina laten meebewegen.
  useEffect(() => {
    if (!isSidebarOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isSidebarOpen]);

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

  // Terugknop/swipe-back sluit de mobiele zijbalk i.p.v. de app te verlaten.
  useHistoryDismiss(isSidebarOpen && !isDesktopNav, () => setIsSidebarOpen(false));
  useEffect(() => {
    if (!isSidebarOpen || isDesktopNav) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setIsSidebarOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isSidebarOpen, isDesktopNav]);

  // ⌘K / Ctrl+K opent het command palette

  // Supabase Realtime: live sync van leave/swaps/diversions/updates/planning.
  // Activeert pas wanneer gebruiker is ingelogd (session present) — anders
  // gebeurt er niets.
  useRealtimeSync(!!session && !!currentUser, {
    // meldLive: stille "… bijgewerkt"-toast (max één per 10 s per collectie,
    // niet na een eigen schrijfactie) — src/lib/liveSignaal.ts.
    refetchLeave: () => { meldLive('verlof'); return fetchLeave(); },
    refetchSwaps: () => { meldLive('ruil'); return fetchSwaps(); },
    refetchDiversions: () => { meldLive('omleidingen'); return fetchDiversions(undefined, { silent: true }); },
    refetchUpdates: () => { meldLive('updates'); return fetchUpdates(); },
    refetchNotes: () => fetchMyNotes(),
    refetchPlanning: () => {
      meldLive('planning');
      // Chauffeur krijgt enkel eigen shifts (zelfde filter als initial)
      const planningFilter = currentUser?.role === 'chauffeur'
        ? { driverId: String(currentUser.id) }
        : undefined;
      fetchPlanning(undefined, planningFilter, { silent: true });
      // Maandplanning haalt haar eigen data (/api/month-planning); dit event
      // laat een open Maandplanning-scherm stil meeverversen zodra een
      // collega een wissel doorvoert of de planning herbouwt.
      window.dispatchEvent(new Event('vhb-planning-changed'));
      // Dekking beweegt mee met de planning (Operations Center).
      if (currentUser && currentUser.role !== 'chauffeur') {
        refreshCoverageGaps();
      }
    },
    refetchMatrix: () => {
      // Alleen planner/admin gebruiken het Planning-overzicht; chauffeurs
      // hebben deze data niet.
      if (currentUser && currentUser.role !== 'chauffeur') {
        void fetchPlanningMatrix();
        void fetchPlanningMatrixHistory();
      }
    },
    refetchAll: () => {
      void fetchMyNotes();
      // Catch-up na reconnect/heropenen: stil alles verversen — gemiste
      // realtime-events zijn definitief weg, dus opnieuw ophalen is de
      // enige manier om zeker in sync te komen.
      void fetchLeave();
      void fetchSwaps();
      void fetchDiversions(undefined, { silent: true });
      void fetchUpdates();
      const planningFilter = currentUser?.role === 'chauffeur'
        ? { driverId: String(currentUser.id) }
        : undefined;
      void fetchPlanning(undefined, planningFilter, { silent: true });
      if (currentUser && currentUser.role !== 'chauffeur') {
        refreshCoverageGaps();
        void fetchPlanningMatrix();
        void fetchPlanningMatrixHistory();
      }
    },
  });

  // Terug online (offline-banner verdwijnt): zelfde catch-up als realtime —
  // gemiste events zijn definitief weg — en daarna de sync-tijd verversen,
  // zodat "gegevens van HH:MM" bij een volgende uitval klopt.
  onlineCatchUpRef.current = () => {
    if (!currentUser) return;
    const planningFilter = currentUser.role === 'chauffeur' ? { driverId: String(currentUser.id) } : undefined;
    void Promise.allSettled([
      fetchMyNotes(),
      fetchLeave(),
      fetchSwaps(),
      fetchDiversions(undefined, { silent: true }),
      fetchUpdates(),
      fetchPlanning(undefined, planningFilter, { silent: true }),
      ...(currentUser.role !== 'chauffeur'
        ? [refreshCoverageGaps(), fetchPlanningMatrix(), fetchPlanningMatrixHistory()]
        : []),
    ]).then(() => {
      if (typeof navigator === 'undefined' || navigator.onLine) setLastSyncedAt(Date.now());
    });
  };

  // Initialize theme from localStorage. Eerste-bezoek default = LIGHT
  // (geen system-preference fallback meer — gebruikers die dark willen
  // klikken zelf de toggle).
  // themaGekozenRef: heeft de gebruiker ooit zelf een thema gekozen? Zo niet,
  // mag de rol-standaard hieronder (dispatch: planner = donker) hem invullen.
  const themaGekozenRef = useRef(false);
  useEffect(() => {
    let stored: string | null = null;
    let effectief: string | null = null;
    try {
      stored = typeof window !== 'undefined' ? window.localStorage.getItem('vhb-theme') : null;
      effectief = typeof window !== 'undefined' ? window.localStorage.getItem('vhb-theme-effectief') : null;
    } catch {
      // localStorage geblokkeerd (privacy-modus) — val terug op licht.
    }
    themaGekozenRef.current = stored === 'dark' || stored === 'light';
    // Zonder expliciete keuze: begin met wat er de vorige keer effectief
    // stond (de rol-standaard van planner/admin = donker). Het bootscript in
    // index.html zette dat al vóór de eerste paint; hier 'light' forceren
    // haalde de dark-klasse weer weg tot het profiel binnen was — vandaar de
    // lichte flits van skeleton naar dashboard (Jarno 04-09).
    const initial: 'light' | 'dark' = stored === 'dark' || stored === 'light' ? stored : effectief === 'dark' ? 'dark' : 'light';
    setTheme(initial);
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', initial === 'dark');
      applyThemeColorMeta(initial === 'dark');
      onthoudEffectiefThema(initial);
    }
  }, []);

  // Nieuwe versie klaar: de SW blijft wachten (geen auto-skipWaiting meer,
  // zie public/sw.js) — wij melden het met een "Vernieuw"-actie. Pas na die
  // klik activeert de nieuwe SW en herlaadt index.html de app; een deploy
  // gooit dus nooit meer een half ingevuld formulier weg. De melding komt
  // terug bij elke terugkeer naar de app zolang er een update klaarstaat
  // (de toast-dedupe voorkomt stapelen terwijl hij al in beeld staat).
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let gestopt = false;
    const meldUpdate = (reg: ServiceWorkerRegistration) => {
      const wachtend = reg.waiting;
      // Alleen bij een échte vervanging: zonder controller is dit de eerste
      // installatie en valt er niets te vernieuwen.
      if (!wachtend || !navigator.serviceWorker.controller || gestopt) return;
      // Niet aanbieden zonder netwerk: "Vernieuw" activeert de nieuwe SW en
      // herlaadt; offline was dat een wit scherm zodra de nieuwe cache leeg
      // bleek (controle-ronde 27-08, bevinding 6). Zodra het netwerk terug is,
      // meldt de online-listener hieronder het alsnog.
      if (!navigator.onLine) return;
      showToast('Er staat een nieuwe versie van het portaal klaar.', 'info', {
        label: 'Vernieuw',
        run: () => wachtend.postMessage({ type: 'SKIP_WAITING' }),
      });
    };
    let registratie: ServiceWorkerRegistration | null = null;
    const bijZichtbaar = () => {
      if (document.visibilityState === 'visible' && registratie) meldUpdate(registratie);
    };
    const bijOnline = () => {
      if (registratie) meldUpdate(registratie);
    };
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg || gestopt) return;
      registratie = reg;
      meldUpdate(reg);
      reg.addEventListener('updatefound', () => {
        const nieuwe = reg.installing;
        nieuwe?.addEventListener('statechange', () => {
          if (nieuwe.state === 'installed') meldUpdate(reg);
        });
      });
      document.addEventListener('visibilitychange', bijZichtbaar);
      window.addEventListener('online', bijOnline);
    });
    return () => {
      gestopt = true;
      document.removeEventListener('visibilitychange', bijZichtbaar);
      window.removeEventListener('online', bijOnline);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dispatch: zonder eigen keuze krijgt een planner/admin de donkere
  // control-room als standaard; chauffeurs blijven licht. Niet persisteren —
  // pas de toggle maakt er een eigen keuze van (en die wint dan altijd).
  useEffect(() => {
    if (themaGekozenRef.current || !currentUser) return;
    const donker = currentUser.role === 'planner' || currentUser.role === 'admin';
    setTheme(donker ? 'dark' : 'light');
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', donker);
      applyThemeColorMeta(donker);
      onthoudEffectiefThema(donker ? 'dark' : 'light');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  // Push-notificaties: key=null betekent dat de server geen VAPID-keys heeft
  // (feature uit) — de knop verschijnt dan niet.
  const [pushPublicKey, setPushPublicKey] = useState<string | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);
  // Toestel-whitelist: 'pending'/'revoked' → geblokkeerd-scherm i.p.v. de app.
  const [deviceBlocked, setDeviceBlocked] = useState<'pending' | 'revoked' | null>(null);

  useEffect(() => {
    if (!currentUser || !session?.access_token || !isPushSupported()) return;
    let cancelled = false;
    (async () => {
      const key = await fetchPushPublicKey({ Authorization: `Bearer ${session.access_token}`, ...deviceHeaders() });
      if (cancelled) return;
      setPushPublicKey(key);
      if (key) {
        const existing = await getExistingSubscription();
        if (!cancelled) setPushEnabled(Boolean(existing));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser?.id, session?.access_token]);

  const togglePush = async () => {
    if (!pushPublicKey || !session?.access_token) return;
    const headers = { Authorization: `Bearer ${session.access_token}`, ...deviceHeaders() };
    if (pushEnabled) {
      await unsubscribeFromPush(headers);
      setPushEnabled(false);
      showToast('Meldingen uitgeschakeld.', 'info');
      return;
    }
    const result = await subscribeToPush(pushPublicKey, headers);
    if (result === 'subscribed') {
      setPushEnabled(true);
      showToast('Meldingen ingeschakeld — je krijgt voortaan een seintje bij planning, verlof en dienstruil.', 'success');
    } else if (result === 'denied') {
      showToast('Meldingen geweigerd — sta notificaties toe in je browserinstellingen en probeer opnieuw.', 'info');
    } else {
      showToast('Meldingen inschakelen is mislukt.', 'error');
    }
  };

  const toggleTheme = () => {
    setTheme((current) => {
      const next = current === 'light' ? 'dark' : 'light';
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem('vhb-theme', next);
        } catch {
          // opslag geblokkeerd — thema geldt dan alleen voor deze sessie
        }
        document.documentElement.classList.toggle('dark', next === 'dark');
        applyThemeColorMeta(next === 'dark');
        onthoudEffectiefThema(next);
      }
      return next;
    });
  };

  const dismissToast = (id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  };

  const showToast = (message: string, tone: Toast['tone'] = 'info', action?: Toast['action'], opties?: ToastOpties) => {
    // Sessie loopt af: de catch-blokken van alle lopende calls komen hier
    // tegelijk binnen ("Kon de verlofaanvragen niet laden", "…de dienstruilen
    // niet laden", …). Dat waren vijf rode toasts én vijf regels in de
    // foutenlog voor één oorzaak — 142 meldingen in twee weken, waarvan het
    // leeuwendeel afgeleid. De sessie zelf is al gemeld op het inlogscherm.
    if (tone === 'error' && sessieBeeindigdRef.current) return;
    // Elke fout-toast is een gebroken flow — meld die ook aan de monitoring,
    // anders blijven afgehandelde fouten (catch-blokken) onzichtbaar.
    if (tone === 'error') reportHandledError(message);
    const id = ++toastIdRef.current;
    const ongedaan = opties?.ongedaan === true;
    setToasts((current) => {
      // Dezelfde melding niet stapelen: twee schermen die dezelfde bron
      // ophalen gaven anders twee identieke toasts onder elkaar. Ongedaan-
      // toasts wél: twee snel na elkaar verwijderde items hebben elk hun
      // eigen weg terug nodig.
      if (!ongedaan && current.some((t) => t.message === message && t.tone === tone)) return current;
      return [...current, { id, message, tone, action, ongedaan, duurMs: opties?.duurMs }];
    });
    // Ongedaan-toasts tellen zelf af in ToastStack (pauze bij hover/focus).
    if (ongedaan) return;
    // Fout-toasts bevatten vaak instructies ("probeer opnieuw") — die moeten
    // lang genoeg blijven staan om rustig te lezen. Succes/info mag snel weg.
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, opties?.duurMs ?? (tone === 'error' ? 10000 : 4200));
  };

  /**
   * Eén melding voor alles wat tegelijk misging. De app haalt bij het openen
   * (en bij elke verversing) een stuk of acht bronnen parallel op; bij een
   * netwerkhik of tijdens een uitrol faalt die hele reeks, en dan kreeg je
   * vier tot vijf losse rode toasts voor één oorzaak — gemeten op 07-08.
   * We verzamelen de namen kort en tonen daarna één melding met een knop die
   * alles opnieuw ophaalt, i.p.v. de gebruiker naar 'vernieuw de pagina' te
   * sturen.
   */
  const meldLaadfout = (bron: string) => {
    if (sessieBeeindigdRef.current) return;
    laadfoutenRef.current.add(bron);
    if (laadfoutTimerRef.current !== null) return;
    laadfoutTimerRef.current = window.setTimeout(() => {
      laadfoutTimerRef.current = null;
      const bronnen = [...laadfoutenRef.current];
      laadfoutenRef.current.clear();
      if (bronnen.length === 0 || sessieBeeindigdRef.current) return;
      const opsomming = bronnen.length === 1
        ? bronnen[0]
        : `${bronnen.slice(0, -1).join(', ')} en ${bronnen[bronnen.length - 1]}`;
      showToast(
        `Kon ${opsomming} niet laden. Controleer je verbinding.`,
        'error',
        { label: 'Opnieuw proberen', run: () => { void refreshAll(); } },
      );
    }, 400);
  };

  useEffect(() => {
    let isMounted = true;

    // Zonder client géén listener registreren: de destructure hieronder zou
    // op undefined crashen vóór het config-foutscherm ooit rendert.
    if (!supabase) {
      setAuthReady(true);
      return;
    }

    const bootstrap = async () => {
      if (!supabase) {
        setAuthReady(true);
        return;
      }

      // try/finally: wat er ook misgaat (netwerk, Supabase-lock-hang in een
      // ander tabblad, API-fout), de app mag NOOIT eeuwig op 'Sessie
      // laden…' blijven staan — dan liever terugvallen op het loginscherm.
      try {
        const { data } = await supabase.auth.getSession();
        if (!isMounted) return;

        setSession(data.session);
        if (data.session) {
          // Chunk van de landingsview alvast ophalen, parallel met /api/me —
          // anders begon die download pas ná het profiel (prestatiebudget
          // 09-2026). Niet op het loginscherm: daar zou hij het kritieke pad
          // beconcurreren. currentView = de view bij het opstarten (lege deps).
          prefetchView(currentView);
          await initializeAuthenticatedApp(data.session.access_token, data.session.user.id);
        }
      } catch (error) {
        console.error('Auth bootstrap error:', error);
      } finally {
        if (isMounted) setAuthReady(true);
      }
    };

    bootstrap();

    // Watchdog: mocht getSession() tóch blijven hangen (bekend Supabase-
    // fenomeen met meerdere open tabbladen), forceer dan na 8s een render
    // zodat de gebruiker kan inloggen i.p.v. naar een spinner te staren.
    const watchdog = window.setTimeout(() => {
      if (isMounted) setAuthReady(true);
    }, 8000);

    const { data: authListener } = supabase?.auth.onAuthStateChange(async (event, nextSession) => {
      if (!isMounted) return;

      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryMode(true);
        setSession(nextSession);
        setAuthReady(true);
        return;
      }

      // While user is completing a password reset, skip the normal profile
      // bootstrap — the recovery form handles sign-out itself when done.
      if (isPasswordRecoveryRef.current && nextSession) {
        setSession(nextSession);
        setAuthReady(true);
        return;
      }

      setSession(nextSession);
      // TOKEN_REFRESHED/USER_UPDATED: alleen de sessie verversen — een
      // volledige her-init (12 fetches + overlay) elk uur is onnodig en
      // stoort de gebruiker midden in z'n werk.
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        setAuthReady(true);
        return;
      }
      if (nextSession) {
        // Verse sessie: de onderdrukking van fout-toasts en de eenmalige
        // uitlog-guard weer vrijgeven, anders blijft de app na opnieuw
        // inloggen stil bij échte fouten.
        sessieBeeindigdRef.current = false;
        forceSignOutRef.current = false;
        await initializeAuthenticatedApp(nextSession.access_token, nextSession.user.id);
      } else {
        setRecoveryMode(false);
        setCurrentUser(null);
        setMonitoringUser(null);
        // Reactief uitloggen (sessie verlopen/elders afgemeld): zet het
        // browser-push-abonnement uit zodat een volgende gebruiker op dit
        // toestel geen meldingen van het vorige account erft. Best-effort —
        // de server-cleanup kan zonder geldig token mislukken (gedicht in
        // handleLogout), de lokale unsubscribe werkt sowieso.
        if (isPushSupported()) void unsubscribeFromPush({}).catch(() => {});
        setPushEnabled(false);
        setDeviceBlocked(null);
        initializedUserIdRef.current = null;
        initializingUserIdRef.current = null;
        resetAll();
        setCurrentView('dashboard');
      }
      setAuthReady(true);
    });

    return () => {
      isMounted = false;
      window.clearTimeout(watchdog);
      authListener?.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const { detail } = event as CustomEvent<ToastEventDetail>;
      showToast(detail.message, detail.tone, detail.action, detail.opties);
    };

    window.addEventListener('vhb-toast', handler as EventListener);
    return () => window.removeEventListener('vhb-toast', handler as EventListener);
  }, []);

  // Terug uit de achtergrond: de ververs-timer van Supabase staat stil zolang
  // de PWA in de app-switcher hangt, dus na een paar uur is het token bij
  // hervatten verlopen en liep de eerstvolgende call tegen een 401 — precies
  // het patroon achter de trosjes fouten in de log. Hier vernieuwen we vóór er
  // iets geladen wordt; de 401-retry in apiFetch blijft het vangnet.
  useEffect(() => {
    if (!supabase || !session) return;
    const controleer = () => {
      if (document.visibilityState !== 'visible') return;
      const verlooptOp = session.expires_at ? session.expires_at * 1000 : 0;
      // Marge van een minuut: een net-niet-verlopen token is tegen de tijd dat
      // de eerste fetch aankomt alsnog te oud.
      if (verlooptOp && verlooptOp - Date.now() > 60_000) return;
      void vernieuwSessie();
    };
    document.addEventListener('visibilitychange', controleer);
    return () => document.removeEventListener('visibilitychange', controleer);
  }, [session]);

  // Auth-events uit apiFetch (src/lib/api.ts) — die heeft geen toegang tot
  // deze React-state, dus een verlopen sessie, gedeactiveerd account of
  // geblokkeerd toestel komt via window-events hierheen; één plek voor álle
  // API-calls, ook die van App zelf.
  useEffect(() => {
    const onExpired = (event: Event) => {
      const reden = (event as CustomEvent<{ reden?: 'sessie' | 'account' }>).detail?.reden;
      void forceSignOut(reden === 'account'
        ? 'Je account is gedeactiveerd. Neem contact op met de planning.'
        : 'Je sessie is verlopen. Log opnieuw in.');
    };
    const onDeviceBlocked = (event: Event) => {
      const code = (event as CustomEvent<{ code?: string }>).detail?.code;
      setDeviceBlocked(code === 'device_revoked' ? 'revoked' : 'pending');
      void wisOfflineCaches(); // ingetrokken/wachtend toestel: geen offline rooster of ritblad meer
    };
    window.addEventListener('vhb-auth-expired', onExpired);
    window.addEventListener('vhb-device-blocked', onDeviceBlocked as EventListener);
    return () => {
      window.removeEventListener('vhb-auth-expired', onExpired);
      window.removeEventListener('vhb-device-blocked', onDeviceBlocked as EventListener);
    };
  }, []);


  useEffect(() => {
    if (!currentUser) {
      return;
    }

    if (!magView(currentUser.role, currentView)) {
      navigeer('dashboard', { replace: true });
      showToast('Dit scherm is niet beschikbaar voor jouw rol.', 'info');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, currentView]);



  // Idempotente harde logout vanuit een API-respons (verlopen sessie /
  // gedeactiveerd account). Eén keer per sessie: onAuthStateChange(SIGNED_OUT)
  // wist verder alle state en toont LoginView.
  const forceSignOutRef = useRef(false);
  const forceSignOut = async (msg: string, reden: 'sessie' | 'account' = 'sessie') => {
    if (forceSignOutRef.current) return;
    forceSignOutRef.current = true;
    // Vanaf hier is élke lopende fetch gedoemd: hun catch-blokken mogen geen
    // eigen fout-toast meer tonen (dat waren er vijf tegelijk) en ook niets
    // meer naar de foutenlog sturen. showToast leest deze vlag.
    sessieBeeindigdRef.current = true;
    // De melding hoort thuis op het inlogscherm, niet in een toast die
    // meteen daarna achter LoginView verdwijnt. Via state (LoginView kan al
    // gemonteerd zijn) én sessionStorage (overleeft een herlaadbeurt).
    setUitlogMelding(reden);
    try { sessionStorage.setItem(LOGIN_MELDING_KEY, reden); } catch { /* privémodus */ }
    if (reden === 'account') showToast(msg, 'error');
    // Gedeeld toestel (depot-tablet): net als bij de gewone uitlog mag de
    // stale-while-revalidate-cache (rooster, profiel, ritblad-PDF) en het
    // push-abonnement van deze gebruiker niet achterblijven na een gedwongen
    // uitlog (verlopen sessie / gedeactiveerd account). Vóór signOut, want de
    // push-afmelding heeft nog een geldig token nodig; alles best-effort zodat
    // het uitloggen nooit ophoudt.
    await wisOfflineCaches();
    vergeetEffectiefThema();
    try {
      if (session?.access_token && isPushSupported()) {
        await unsubscribeFromPush({ Authorization: `Bearer ${session.access_token}`, ...deviceHeaders() });
      }
    } catch { /* best-effort */ }
    setPushEnabled(false);
    try { await supabase?.auth.signOut(); } catch { /* val sowieso terug op login */ }
    // Zelf de sessie-state wissen i.p.v. te wachten op SIGNED_OUT: als de
    // signOut-call zelf faalt (offline, of de auth-server geeft een fout)
    // blijft dat event uit en bleef de app op "Profiel laden…" hangen met
    // een sessie die nergens meer geldig is. De listener doet hetzelfde werk
    // idempotent zodra hij alsnog binnenkomt.
    setSession(null);
    setCurrentUser(null);
    setAuthReady(true);
    initializedUserIdRef.current = null;
    initializingUserIdRef.current = null;
  };

  // apiFetch + vernieuwSessie staan in src/lib/api.ts: één implementatie voor
  // App én de losse views/lib-helpers (controle-ronde 27-08, bevinding 19).
  // Verlopen sessie / gedeactiveerd account / geblokkeerd toestel komen via
  // window-events terug (zie de listener hierboven).

  const fetchCurrentUser = async (accessToken = session?.access_token) => {
    const response = await apiFetch('/api/me', { accessToken });
    // Zonder deze checks werd een JSON-errorbody ({error: ...}) als
    // gebruiker gezet → crash op currentUser.name verderop.
    if (!response.ok) {
      throw new Error('Profiel kon niet geladen worden.');
    }
    const data = await response.json();
    if (!data?.id || !data?.role) {
      throw new Error('Ongeldig profiel-antwoord van de server.');
    }
    setCurrentUser(data);
    setMonitoringUser(String(data.id), data.role);
    forceSignOutRef.current = false; // geldige sessie → her-arm de auto-logout
    return data as User;
  };


  // Pull-to-refresh (PWA): sleep omlaag bovenaan → alle data opnieuw ophalen.
  // `enabled` op !!currentUser zodat de hook (her)bindt zodra de scroll-
  // container gemonteerd is (bij de koude start bestaat die nog niet).
  const { refreshing: ptrRefreshing } = usePullToRefresh(scrollContainerRef, ptrIndicatorRef, refreshAll, !!currentUser);

  /** Meldt dit toestel aan bij de server (toestel-whitelist). Faalt stil:
   *  bij een netwerk-/serverfout laten we de app gewoon door — de server-gate
   *  in de API blijft sowieso de autoriteit. */
  const registerThisDevice = async (accessToken: string): Promise<'approved' | 'pending' | 'revoked' | null> => {
    try {
      const res = await fetch('/api/devices/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, ...deviceHeaders() },
        body: JSON.stringify({ name: deriveDeviceName() }),
      });
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      return data?.status === 'approved' || data?.status === 'pending' || data?.status === 'revoked' ? data.status : null;
    } catch {
      return null;
    }
  };

  const initializeAuthenticatedApp = async (accessToken: string, authUserId?: string) => {
    // Progressieve boot: alleen het profiel (één snelle call) blokkeert de
    // eerste render; alle overige data streamt op de achtergrond binnen.
    if (authUserId && (initializedUserIdRef.current === authUserId || initializingUserIdRef.current === authUserId)) return;
    // Synchroon markeren dat we bezig zijn — vóór de eerste await, zodat een
    // vrijwel gelijktijdige tweede aanroeper meteen terugkeert.
    if (authUserId) initializingUserIdRef.current = authUserId;
    try {
      // Toestel-whitelist vóór al het andere: op een niet-goedgekeurd toestel
      // zou elke volgende call toch 403 geven — toon meteen het wachtscherm.
      const deviceStatus = await registerThisDevice(accessToken);
      if (deviceStatus === 'pending' || deviceStatus === 'revoked') {
        setDeviceBlocked(deviceStatus);
        void wisOfflineCaches();
        setIsInitialLoad(false);
        initializingUserIdRef.current = null; // "Opnieuw controleren" moet opnieuw kunnen initialiseren
        return; // dedup-vlag (initialized) bewust niet zetten
      }
      setDeviceBlocked(null);
      const appUser = await fetchCurrentUser(accessToken);
      // Gedeeld toestel (depot-tablet): logt er een ándere gebruiker in dan
      // de vorige keer, wis dan Cache Storage. Uitloggen doet dat al, maar
      // een sessie die verlóópt niet — en dan kon de offline-fallback van de
      // service worker het profiel/rooster van de vorige gebruiker tonen.
      try {
        const LAST_USER_KEY = 'vhb-last-user-id';
        const previous = window.localStorage.getItem(LAST_USER_KEY);
        const current = String(appUser.id);
        if (previous && previous !== current) await wisOfflineCaches();
        window.localStorage.setItem(LAST_USER_KEY, current);
      } catch {
        // localStorage/Cache API geblokkeerd — geen blocker voor de boot
      }
      // Pas NA een geslaagd profiel de dedup-vlag zetten — anders blijft de
      // gebruiker bij een transiente /api/me-fout vasthangen op 'Profiel
      // laden…' (een volgend auth-event werd door de vlag kortgesloten).
      if (authUserId) { initializedUserIdRef.current = authUserId; initializingUserIdRef.current = null; }
      // Aanwezigheids-ping: wie de app opent met een nog geldige sessie logt
      // niet opnieuw in en was daardoor onzichtbaar in "Actieve gebruikers
      // per dag". De server dedupliceert per dag. Best-effort, fire-and-forget.
      void apiFetch('/api/auth/session', {
        method: 'POST',
        body: JSON.stringify({ action: 'resume' }),
        accessToken,
      }).catch(() => {});
      void loadAppData(appUser, accessToken);
    } catch (error) {
      console.error('Error initializing app:', error);
      if (authUserId) { initializedUserIdRef.current = null; initializingUserIdRef.current = null; } // her-init toestaan bij een volgend auth-event
      setIsInitialLoad(false);
      showToast('Kon je profiel niet laden. Vernieuw de pagina of log opnieuw in.', 'error');
    }
  };


  const unseenLeaveDecisionCount = currentUser
    ? leaveRequests.filter((r) =>
        r.userId === currentUser.id &&
        !!r.decidedAt &&
        r.status !== 'pending' &&
        (!lastSeenLeaveDecisionAt || r.decidedAt > lastSeenLeaveDecisionAt),
      ).length
    : 0;

  // Rusttijd-overtredingen in de geladen planning (sidebar-badge) — alleen
  // relevant voor planner/admin; chauffeurs hebben enkel hun eigen shifts.

  // Wachtende beslissingen voor planner/admin (sidebar badges op
  // Verlofbeheer en Dienstruil-tab).
  const pendingLeaveCount = leaveRequests.filter((r) => r.status === 'pending').length;
  // Zelfde definitie als de cockpit: 'accepted' wacht óók op de planner
  // (validatie), dus telt mee als open werkvoorraad.
  const pendingSwapsCount = swaps.filter((s) => s.status === 'pending' || s.status === 'accepted').length;
  // Voor chauffeurs: ruilen die op míjn antwoord wachten (badge op het
  // nav-item + dot op de "Meer"-tab, anders mist de collega het verzoek).
  const targetedSwapsCount = currentUser && currentUser.role === 'chauffeur'
    ? swaps.filter((s) => s.status === 'pending' && s.targetDriverId === currentUser.id).length
    : 0;

  // Werkvoorraad van de planner — gedeelde berekening (lib/werkvoorraad) voor
  // de topbar-knop, de app-icoon-badge én het Open taken-paneel op het
  // dashboard, zodat die drie nooit uiteenlopen. Op de échte rol berekend
  // (data blijft kloppen in chauffeur-preview; de knop verdwijnt daar wel).
  const isStafRol = currentUser?.role === 'planner' || currentUser?.role === 'admin';
  const werkvoorraad = isStafRol
    ? berekenWerkvoorraad({
        users, shifts, leaveRequests, swaps,
        matrixHistory: planningMatrixHistory, coverageDays,
        vervaldata, pendingDevices, now: new Date(),
      })
    : null;

  // Badge op het app-icoon (iOS 16.4+ PWA, Chromium-desktop): wat op jou
  // wacht, zichtbaar zonder de app te openen. Chauffeur: ruilverzoeken aan
  // hem + ongelezen documenten; planner/admin: de volledige werkvoorraad
  // (zelfde teller als de topbar-knop — was alleen verlof+ruil).
  const appBadgeCount = !currentUser
    ? 0
    : currentUser.role === 'chauffeur'
      ? targetedSwapsCount + unseenDocuments
      : werkvoorraad?.attentionCount ?? 0;
  useEffect(() => {
    const nav = navigator as any;
    if (typeof nav?.setAppBadge !== 'function') return;
    try {
      if (appBadgeCount > 0) void Promise.resolve(nav.setAppBadge(appBadgeCount)).catch(() => {});
      else void Promise.resolve(nav.clearAppBadge?.()).catch(() => {});
    } catch { /* badging niet ondersteund — stil */ }
  }, [appBadgeCount]);

  // Stille prefetch bij idle: de lazy views die hierna waarschijnlijk geopend
  // worden alvast ophalen, zodat de eerste navigatie instant voelt zonder de
  // startbundel te vergroten. Bewust NIET de xlsx-views (500 kB) — die laden
  // pas bij echt gebruik.
  useEffect(() => {
    if (!currentUser || isInitialLoad) return;
    const w = window as any;
    const cb = () => {
      // De schermen die hierna het vaakst geopend worden (per rol), stil.
      // Dashboard/Mijn dag/Rooster voorop (prestatiebudget 09-2026): wie op
      // een deeplink landt heeft het dashboard nog niet, en Mijn dag is de
      // eerste tik van elke chauffeur. Al geladen = gratis (module-cache).
      const volgende: View[] = currentUser.role === 'chauffeur'
        ? ['dashboard', 'mijn-dag', 'rooster', 'verlof', 'omleidingen', 'ruil-verzoeken']
        : ['dashboard', 'mijn-dag', 'rooster', 'verlof', 'dekking', 'bezetting', 'verlof-kalender', 'ruil-verzoeken'];
      volgende.forEach((v) => prefetchView(v));
    };
    const idleId = typeof w.requestIdleCallback === 'function'
      ? w.requestIdleCallback(cb, { timeout: 5000 })
      : window.setTimeout(cb, 2500);
    return () => {
      if (typeof w.cancelIdleCallback === 'function') w.cancelIdleCallback(idleId);
      else window.clearTimeout(idleId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, currentUser?.role, isInitialLoad]);

  const handleLogin = async (accessToken?: string) => {
    const token = accessToken || session?.access_token;
    if (!token) return;

    const response = await apiFetch('/api/auth/session', {
      method: 'POST',
      body: JSON.stringify({ action: 'start' }),
      accessToken: token,
    });
    const text = await response.text();
    let user;
    try {
      user = JSON.parse(text);
    } catch {
      throw new Error('De server gaf geen geldig antwoord terug. Controleer of de nieuwste backend deploy actief is.');
    }
    if (!response.ok || !user?.id || !user?.role) {
      throw new Error(user?.error || 'Sessie kon niet gestart worden. Probeer opnieuw.');
    }
    setCurrentUser(user);
    await fetchUsers(token);
    setCurrentView('dashboard');
  };

  const handleLogout = async () => {
    try {
      if (session?.access_token) {
        await apiFetch('/api/auth/session', {
          method: 'POST',
          body: JSON.stringify({ action: 'end' }),
        });
      }
    } catch (error) {
      console.error('Error ending session:', error);
    } finally {
      // Gedeeld toestel (depot-tablet): het stale-while-revalidate-rooster
      // van deze gebruiker mag niet in Cache Storage achterblijven.
      await wisOfflineCaches();
      vergeetEffectiefThema();
      // Push-abonnement opruimen vóór signOut (vereist nog een geldig token):
      // op een gedeeld toestel mag de vorige gebruiker geen meldingen blijven
      // krijgen, en de DB-koppeling endpoint→user moet weg.
      try {
        if (session?.access_token && isPushSupported()) {
          await unsubscribeFromPush({ Authorization: `Bearer ${session.access_token}`, ...deviceHeaders() });
        }
      } catch {
        // best-effort — nooit het uitloggen blokkeren
      }
      setPushEnabled(false);
      setDeviceBlocked(null);
      await supabase?.auth.signOut();
      setSession(null);
      setCurrentUser(null);
      setMonitoringUser(null);
      initializedUserIdRef.current = null;
      initializingUserIdRef.current = null;
    }
  };

  // Warme start (opgeslagen sessie): meteen de skeleton-schil; koude start: het
  // carbon laadscherm — dat wordt zo het inlogscherm.
  if (!authReady) return warmeStart ? <AppSkeleton /> : <SessieLaden />;

  // Print-modus: kale weergave zonder sidebar/header. Vereist authenticated
  // planner/admin sessie zodat we de shifts kunnen lezen.
  const printParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
  const printDriverId = printParams?.get('print-driver');
  const printMonth = printParams?.get('print-month');
  if (printDriverId && printMonth && currentUser && (currentUser.role === 'planner' || currentUser.role === 'admin')) {
    // 'alle' = bulk: één stapel met een blad per chauffeur (paginawissel in
    // de print-CSS). Wacht op de collecties — de lijst chauffeurs en hun
    // shifts moeten er zijn vóór de auto-print afgaat.
    if (printDriverId === 'alle') {
      if (isInitialLoad) {
        return <PrintLaden />;
      }
      const bulkDrivers = users
        .filter((u) => u.isActive !== false && u.name.toLowerCase() !== 'beheerder')
        .sort((a, b) => a.name.localeCompare(b.name));
      return (
        <Suspense fallback={<PrintLaden />}>
          <LazyPrintMonthlyScheduleView drivers={bulkDrivers} monthIso={printMonth} shifts={shifts} />
        </Suspense>
      );
    }
    const driver = users.find((u) => String(u.id) === String(printDriverId)) || null;
    return (
      <Suspense fallback={<PrintLaden />}>
        <LazyPrintMonthlyScheduleView driver={driver} monthIso={printMonth} shifts={shifts} />
      </Suspense>
    );
  }

  // Verlof-jaaroverzicht: planner/admin voor iedereen, een chauffeur alleen
  // voor zichzelf (met zijn eigen currentUser en eigen verloflijst — de
  // users-collectie is voor chauffeurs niet volledig).
  const printVerlofDriverId = printParams?.get('print-verlof-driver');
  const printVerlofJaar = Number(printParams?.get('print-verlof-jaar'));
  if (printVerlofDriverId && Number.isInteger(printVerlofJaar) && printVerlofJaar > 2000 && currentUser) {
    const isPlannerRole = currentUser.role === 'planner' || currentUser.role === 'admin';
    const isSelf = String(currentUser.id) === String(printVerlofDriverId);
    if (isPlannerRole || isSelf) {
      // Pas renderen als de collecties er zijn: de view print automatisch,
      // en dat mag niet gebeuren met een nog lege verloflijst.
      if (isInitialLoad) {
        return <PrintLaden />;
      }
      const driver = isSelf ? currentUser : users.find((u) => String(u.id) === String(printVerlofDriverId)) || null;
      return (
        <Suspense fallback={<PrintLaden />}>
          <LazyPrintLeaveYearView driver={driver} year={printVerlofJaar} leaves={leaveRequests} />
        </Suspense>
      );
    }
  }

  if (!isSupabaseConfigured || !supabase) return <ConfigOntbreekt />;

  if (isPasswordRecovery) {
    return (
      <LoginView
        onLogin={handleLogin}
        recoveryMode
        onRecoveryComplete={async () => { setRecoveryMode(false); }}
      />
    );
  }

  // Toestel-whitelist: ingelogd, maar dit toestel is (nog) niet goedgekeurd.
  if (deviceBlocked && session) {
    return (
      <ToestelGeblokkeerd
        revoked={deviceBlocked === 'revoked'}
        onLogout={handleLogout}
        onRetry={async () => {
          if (!session?.access_token) return;
          const status = await registerThisDevice(session.access_token);
          if (status === 'approved' || status === null) {
            setDeviceBlocked(null);
            initializedUserIdRef.current = null;
            initializingUserIdRef.current = null;
            void initializeAuthenticatedApp(session.access_token, session.user?.id);
          } else {
            setDeviceBlocked(status);
            showToast('Nog niet goedgekeurd — vraag de planning om dit toestel goed te keuren.', 'info');
          }
        }}
      />
    );
  }

  if (!currentUser) {
    // Wél een sessie maar (nog) geen profiel: toon een laadscherm met
    // retry i.p.v. het loginformulier aan een al-ingelogde gebruiker
    // (de 8s-watchdog kon hier anders een login-flits veroorzaken).
    if (session) return warmeStart ? <AppSkeleton /> : <ProfielLaden />;
    // uitlogMelding als prop: sessionStorage alleen is niet genoeg, want bij
    // een gedwongen uitlog kan LoginView al gemonteerd zijn vóórdat de vlag
    // geschreven is — dan zou de uitleg nooit verschijnen (viel om in e2e).
    return <LoginView onLogin={handleLogin} melding={uitlogMelding} />;
  }

  const isRealAdmin = currentUser.role === 'admin';
  // In preview-modus rendert alles op chauffeur-niveau (nav-secties verdwijnen,
  // dashboard toont de chauffeursvariant). allowedViews/guard blijven bewust op
  // de échte rol zodat er niets wordt weg-geredirect.
  const previewingChauffeur = isRealAdmin && previewChauffeur;
  const effectiveRole = previewingChauffeur ? 'chauffeur' : currentUser.role;
  const isPlanner = effectiveRole === 'planner' || effectiveRole === 'admin';
  const isAdmin = effectiveRole === 'admin';
  const resolvedCurrentView: View = magView(currentUser.role, currentView) ? currentView : 'dashboard';
  // Titel in de topbar = het label uit de routetabel (één naam per scherm).
  const currentMeta = { title: routeVan(resolvedCurrentView).label };
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
    <AppDataProvider value={appData}>
      {/* Parallax-laag: fixed gekleurde blobs die trager scrollen dan content */}
      <div className="parallax-bg" aria-hidden="true" />

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      {/* Web-vitals (LCP/INP/CLS) per scherm naar Vercel Speed Insights; route = view-naam, niet de URL met parameters. */}
      <SpeedInsights route={`/${resolvedCurrentView}`} />
      <OfflineBanner />
      <InstallPrompt />
      <ChangePasswordModal
        isOpen={showChangePassword}
        onClose={() => setShowChangePassword(false)}
        email={currentUser?.email || session?.user?.email || ''}
      />
      <ProbleemMelder open={showProbleemMelder} onClose={() => setShowProbleemMelder(false)} view={currentView} />
      <CalendarSubscribeModal open={showAgenda} onClose={() => setShowAgenda(false)} onDownload={() => downloadRoosterIcs(currentUser.name, shifts.filter((s) => String(s.driverId) === String(currentUser.id)))} />
      <AnimatePresence>
        {isLoading && !isInitialLoad && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex items-center justify-center bg-ink/20"
          >
            <Card padding="sm" className="shadow-xl">
              <div className="flex items-center gap-4">
                <BrandSpinner size={24} />
                <div>
                  <MicroLabel>Bezig</MicroLabel>
                  <p className="text-sm font-semibold text-slate-800">Gegevens verwerken…</p>
                </div>
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
      {/* h-dvh i.p.v. h-screen (100vh): vóór installatie in een Safari-tab is
          100vh de hoogte mét uitgeklapte toolbar, waardoor de onderrand achter
          de balk viel. dvh volgt de zichtbare viewport. */}
      {/* rauw: skip-link voor toetsenbord/VoiceOver — springt langs de zijbalk naar de inhoud. */}
      <a
        href="#hoofdinhoud"
        onClick={(e) => { e.preventDefault(); document.getElementById('hoofdinhoud')?.focus(); }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[130] focus:rounded-xl focus:bg-oker-500 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-slate-950"
      >
        Naar de inhoud
      </a>
      <div className="flex h-dvh w-full bg-transparent text-slate-900 font-sans overflow-hidden">
      {/* Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-ink/35 backdrop-blur-sm z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar — vaste rail, full-height, haarlijn rechts */}
      <aside
        aria-label="Zijbalk"
        inert={!isSidebarOpen && !isDesktopNav}
        className={cn(
          "fixed inset-y-0 left-0 w-[17rem] max-w-[80vw] panel-dark flex flex-col z-50 transition-transform duration-500 transform lg:w-[17.5rem] lg:max-w-none lg:relative lg:translate-x-0",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
        // Zachte uitloop zonder overshoot — de bounce voelde gedateerd en
        // botste met de verder stille motion-taal.
        // Landscape: iOS negeert de portrait-lock, dus met de notch links
        // hoort de zijbalk de linker-inset te respecteren (dock en SlideOver
        // deden dat al) — anders vallen logo en menu-items deels onder de
        // notch (controle-ronde 27-08, nr. 35).
        style={{ transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)', paddingLeft: 'env(safe-area-inset-left)' }}
      >
        {/* Statusbalkzone donker houden zolang de lade open is (licht thema: de
            lade is licht, de statusbalktekens wit — controle 05-09, nr. 14). */}
        <div className="statusbalk-strook shrink-0 lg:hidden" aria-hidden="true" />
        <div className="shrink-0 px-5 pt-4 pb-3 flex items-center justify-center relative text-center">
          {/* Géén transform/transition-all op de logoknop: Safari rastert een
              element met schaal-animatie als bitmap-laag en schaalt die —
              dat maakte de logo-randen kartelig op retina (melding Jarno). */}
          {/* rauw: logoknop (eigen layout, bewust zonder ios-pressable/transform). */}
          <button
            type="button"
            onClick={() => { setCurrentView('dashboard'); setIsSidebarOpen(false); }}
            className="rounded-xl py-1 px-2 transition-opacity hover:opacity-80"
            title="Naar dashboard"
          >
            {/* Volledig logo mét naamregel op w-36 = 144 px — bewuste keuze
                Jarno (30-08): op 192 px (richtlijn-minimum 180 px) te groot,
                het beeldmerk zonder naamregel wilde hij niet. Naamregel 1,2×
                en 26 eenheden lager (ook Jarno) voor leesbaarheid op deze
                maat; op mobiel w-32 = 128 px ("iets kleiner", Jarno 30-08). */}
            <BrandLogo tone="licht" naamregelSchaal={1.2} naamregelAfstand={70} className="w-32 lg:w-36 h-auto mx-auto select-none block dark:hidden" />
            <BrandLogo tone="donker" naamregelSchaal={1.2} naamregelAfstand={70} className="w-32 lg:w-36 h-auto mx-auto select-none hidden dark:block" />
          </button>
          <IconButton
            label="Menu sluiten"
            variant="ghost"
            onClick={() => setIsSidebarOpen(false)}
            className="absolute right-3 top-1/2 -translate-y-1/2 lg:hidden"
          >
            <X size={18} />
          </IconButton>
        </div>

        <SidebarNav
          rol={effectiveRole}
          currentView={currentView}
          badges={{
            documenten: unseenDocuments,
            'ruil-verzoeken': isPlanner ? pendingSwapsCount : targetedSwapsCount,
            verlof: isPlanner ? pendingLeaveCount : unseenLeaveDecisionCount,
          }}
          onNavigate={(v) => { setCurrentView(v); setIsSidebarOpen(false); if (v === 'documenten') markDocumentsSeen(); }}
        />

        {/* Accountacties (thema, meldingen, wachtwoord, probleem, uitloggen)
            + het gebruikerskaartje verhuisden naar het avatar-menu in de
            topbar (mock Jarno 30-08). Hier alleen nog safe-area-lucht zodat
            het laatste nav-item op een iPhone boven de home-indicator blijft. */}
        <div className="shrink-0" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }} />
      </aside>

      {/* Main Content */}
      {/* Mobiele lade open: de inhoud is inert (focus blijft in de lade). */}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden relative" inert={isSidebarOpen && !isDesktopNav}>
        {/* Statusbalkstrook vast bovenaan (buiten de scroll-root): bij
            rubber-band/pull-to-refresh schoof hij anders mee omlaag en flitste
            de lichte achtergrond onder de witte statusbalktekens (controle 05-09, nr. 39). */}
        <div className="statusbalk-strook pointer-events-none absolute inset-x-0 top-0 z-40" aria-hidden="true" />
        {/* Scroll container met sticky-header — header zit BINNEN de scroll
            zodat content er onderdoor schuift en de panel-blur natuurlijk
            werkt (echte iOS-vibe i.p.v. harde rand). */}
        {/* Pull-to-refresh-indicator: altijd in de DOM (de hook stuurt opacity/
            transform rechtstreeks aan via ptrIndicatorRef); animate-spin volgt
            de refreshing-state. */}
        <div
          ref={ptrIndicatorRef}
          className="pointer-events-none absolute inset-x-0 top-[env(safe-area-inset-top,0px)] z-40 flex justify-center opacity-0"
        >
          <div className="mt-2 flex h-9 w-9 items-center justify-center rounded-full bg-surface-white shadow-md ring-1 ring-hairline">
            <RefreshCw size={18} data-ptr-icon className={cn('text-oker-500', ptrRefreshing && 'animate-spin')} />
          </div>
        </div>
        <div
          ref={scrollContainerRef}
          data-scroll-root
          className="flex-1 w-full min-w-0 overflow-y-auto overflow-x-hidden overscroll-y-contain px-[max(1rem,env(safe-area-inset-left),env(safe-area-inset-right))] md:px-7 pb-[calc(9.5rem+env(safe-area-inset-bottom))] md:pb-8"
          onScroll={(e) => {
            const top = e.currentTarget.scrollTop ?? 0;
            const next = top > 8;
            // Parallax is bewust weg (Windows-perf): de vorige versie schreef
            // hier elke scroll-frame een CSS-var op <html> → document-brede
            // style-invalidatie + hersamplen van de blurred achtergrondlaag.
            setIsScrolled((current) => (current === next ? current : next));
          }}
        >
          {/* Sticky topbar — full-width werkbalk met haarlijn-onderrand */}
          {/* Negatieve marge = scroll-root-padding, óók de safe-area: met een
              vaste -mx-4 stopte de sticky topbar + haarlijn in landscape met
              notch ~30px vóór de schermrand (de inset is dan ~47px). */}
          {/* Sticky topbar begint onder de statusbalkstrook (die staat buiten de
              scroll-root, zie <main>), zodat overscroll de strook niet meeneemt. */}
          <div className="sticky top-[env(safe-area-inset-top,0px)] z-30 -mx-[max(1rem,env(safe-area-inset-left),env(safe-area-inset-right))] md:-mx-7 mb-5">
            <header className={cn("topbar px-[max(1rem,env(safe-area-inset-left),env(safe-area-inset-right))] md:px-7", isScrolled && "topbar--scrolled")}>
              <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between gap-3 py-2.5 min-h-12">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="hidden md:inline-flex lg:hidden">
                    <IconButton label="Menu openen" variant="ghost" size="sm" className="-ml-1" onClick={() => setIsSidebarOpen(true)}>
                      <Menu size={18} />
                    </IconButton>
                  </span>
                  {/* Topbar is puur context: alleen de compacte titel. De
                      subtitel dupliceerde de PageHeader-description eronder,
                      en het identiteitsblok stond al in de sidebar-footer —
                      dubbele titeling boven de vouw is weg. */}
                  {/* Titel verschijnt pas zodra de paginakop (h1) weggescrold
                      is — anders stond dezelfde naam twee keer boven de vouw. */}
                  {/* Staging-label (alleen met VITE_OMGEVING=staging) — nooit een preview voor productie aanzien. */}
                  <OmgevingLabel className="shrink-0" />
                  <h2
                    aria-hidden={!isScrolled || undefined}
                    className={cn('text-sm font-semibold tracking-tight text-slate-900 leading-tight truncate transition-opacity duration-200', isScrolled ? 'opacity-100' : 'opacity-0')}
                  >
                    {currentMeta.title}
                  </h2>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Zoekknop bewust weg (Jarno: "vrij zinloos") — het
                      command palette blijft bereikbaar via ⌘K. Geen permanente
                      "Online"-pill: alleen een storing verdient een signaal
                      (offline-banner hieronder). */}
                  {/* Topbar-inrichting = mock Jarno 30-08: preview-toggle,
                      bel met attentie-stip, avatar-menu. De toggle stond
                      eerst op beide dashboards; één vaste plek is rustiger.
                      Op smal scherm een compacte oog-knop i.p.v. de pill. */}
                  {/* Alleen het oogje, op elk formaat (vraag Jarno 03-09): de
                      pill met tekst + schakelaar was op desktop het drukste
                      element van de balk. Actief = oker gevuld. */}
                  {isRealAdmin && (
                    <IconButton
                      label={previewChauffeur ? 'Chauffeurs-weergave uit' : 'Bekijk als chauffeur'}
                      title={previewChauffeur ? 'Chauffeurs-weergave uit' : 'Bekijk als chauffeur'}
                      variant="ghost"
                      size="sm"
                      aria-pressed={previewChauffeur}
                      onClick={() => setPreviewChauffeur((v) => !v)}
                      className={cn(previewChauffeur && 'bg-oker-500/15 text-oker-700 hover:bg-oker-500/15 hover:text-oker-700')}
                    >
                      <Eye size={16} />
                    </IconButton>
                  )}
                  {/* Werkvoorraad — tussen de preview-toggle en de bel (idee
                      Jarno 31-08): open taken vanuit elk scherm zichtbaar;
                      verving de statuspil op het planner-dashboard. */}
                  {isPlanner && werkvoorraad && (
                    <WerkvoorraadMenu
                      werkvoorraad={werkvoorraad}
                      userNaam={(id) => users.find((u) => String(u.id) === String(id))?.name || 'Onbekend'}
                      onNavigate={setCurrentView}
                    />
                  )}
                  <IconButton
                    label="Meldingen"
                    title="Updates en meldingen"
                    variant="ghost"
                    size="sm"
                    className="relative"
                    onClick={() => setCurrentView('updates')}
                  >
                    <Bell size={16} />
                    {/* Stip alleen voor chauffeurs: bij staf draagt de
                        werkvoorraad-knop hiernaast dit signaal al met een
                        teller — dubbel signaleren maakt beide zwakker. */}
                    {currentUser.role === 'chauffeur' && appBadgeCount > 0 && (
                      <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-oker-500 ring-2 ring-paper" aria-hidden="true" />
                    )}
                  </IconButton>
                  {isPlanner && <AanwezigheidStack />}
                  <UserMenu
                    user={currentUser}
                    initials={userInitials}
                    theme={theme}
                    onToggleTheme={toggleTheme}
                    pushBeschikbaar={!!pushPublicKey && isPushSupported()}
                    pushEnabled={pushEnabled}
                    onTogglePush={togglePush}
                    onChangePassword={() => setShowChangePassword(true)}
                    onProbleem={() => setShowProbleemMelder(true)}
                    onLogout={handleLogout}
                    onInstellingen={() => setCurrentView('instellingen')}
                  />
                </div>
              </div>
            </header>
          </div>
          {/* Offline-banner: de topbar-pill is desktop-only (hidden lg:flex),
              dus op de iPhone — hét toestel — was een uitval onzichtbaar en
              keek je zonder het te weten naar verouderde data. */}
          {!isOnline && (
            <div className="mx-auto w-full max-w-[1200px]">
              <Card tone="warning" padding="none" className="mb-4 flex items-center gap-2.5 px-4 py-3 text-sm font-semibold text-amber-800">
                <WifiOff size={14} className="shrink-0" />
                <span>
                  Offline — wijzigingen komen niet door
                  {lastSyncedAt ? ` · laatst bijgewerkt ${formatSyncedTime(lastSyncedAt)}` : ''}
                </span>
              </Card>
            </div>
          )}
          {/* Directe view-wissel — geen AnimatePresence/motion. Een in/uit-
              animatie op de hele view (mode="wait" = exit + enter, ~0.56s op
              een grote DOM) veroorzaakte hapering bij het wisselen van pagina's
              op tragere Windows-pc's. Instant = sneller en jank-vrij. */}
          <div id="hoofdinhoud" tabIndex={-1} className="mx-auto w-full max-w-[1200px] outline-none">
            {/* Foutgrens per view: een crash in één scherm laat sidebar,
                sessie en context staan; de key reset de grens bij een
                viewwissel of "Opnieuw proberen". */}
            <ErrorBoundary key={`${resolvedCurrentView}-${viewFoutReset}`} fallback={<ViewFout onRetry={() => setViewFoutReset((n) => n + 1)} />}>
            {/* Eén Suspense voor alle (lazy) views + een zachte inloop van 150 ms
                bij een viewwissel (view-in in index.css; respecteert reduced motion). */}
            <Suspense fallback={<ViewLoader />}>
            <div key={resolvedCurrentView} className="view-in">
              {resolvedCurrentView === 'dashboard' && (
                isPlanner ? (
                  /* Planner/admin: Operations Center — één operationele cockpit
                     i.p.v. een dubbel dashboard. */
                  <Suspense fallback={<ViewLoader />}>
                  <WatIsNieuwKaart rol={currentUser!.role} onNavigate={setCurrentView} className="mb-5" />
                  {/* Data (collecties, ziekmelding, verversen) leest de
                      cockpit zelf uit de AppDataContext. */}
                  <LazyPlannerDashboardWidgets
                    currentUser={currentUser!}
                    onNavigate={(view) => setCurrentView(view)}
                  />
                  </Suspense>
                ) : (
                  <LazyDashboardView user={previewingChauffeur ? { ...currentUser!, role: 'chauffeur' } : currentUser!} notes={myNotes} shifts={shifts} diversions={diversions} leaveRequests={leaveRequests} isInitialLoad={isInitialLoad} onNavigate={setCurrentView} onChangePassword={() => setShowChangePassword(true)} />
                )
              )}
              {resolvedCurrentView === 'mijn-dag' && <LazyMijnDagView user={previewingChauffeur ? { ...currentUser!, role: 'chauffeur' } : currentUser!} notes={myNotes} shifts={shifts} diversions={diversions} isInitialLoad={isInitialLoad} onNavigate={setCurrentView} />}
              {resolvedCurrentView === 'omleidingen' && (isInitialLoad ? <ViewLoader /> : <LazyDiversionsView diversions={diversions} lastSyncedAt={lastSyncedAt} />)}
              {resolvedCurrentView === 'rooster' && <LazyScheduleView user={currentUser!} notes={myNotes} shifts={shifts} users={users} leaveRequests={leaveRequests} swaps={swaps} isInitialLoad={isInitialLoad} lastSyncedAt={lastSyncedAt} onRequestSwap={(shiftId) => { setSwapPreselectShiftId(shiftId); setCurrentView('ruil-verzoeken'); }} />}
              {resolvedCurrentView === 'dienstoverzicht' && (isInitialLoad ? <ViewLoader /> : <Suspense fallback={<ViewLoader />}><LazyServicesView services={services} /></Suspense>)}
              {resolvedCurrentView === 'ritblaadjes' && <LazyRitblaadjesView currentUser={currentUser!} />}
              {resolvedCurrentView === 'documenten' && <LazyDocumentsView currentUser={currentUser!} onSeen={markDocumentsSeen} />}
              {resolvedCurrentView === 'updates' && (isInitialLoad ? <ViewLoader /> : <LazyUpdatesView updates={updates} />)}
              {resolvedCurrentView === 'contacten' && (isInitialLoad ? <ViewLoader /> : <LazyContactsView users={users} currentUser={currentUser!} />)}
              {resolvedCurrentView === 'beheer-roosters' && (isInitialLoad ? <ViewLoader /> : (
                <Suspense fallback={<ViewLoader />}>
                  <LazyManageSchedulesView shifts={shifts} onSave={savePlanning} users={users} history={planningMatrixHistory} canAdminOverride={isAdmin} onMatrixImported={async () => {
                    await Promise.all([
                      fetchPlanningMatrix(),
                      fetchPlanning(),
                      fetchPlanningMatrixHistory(),
                      refreshCoverageGaps(),
                      ...(currentUser?.role === 'admin' ? [fetchActivityLog()] : []),
                    ]);
                  }} />
                </Suspense>
              ))}
              {resolvedCurrentView === 'planning-matrix' && (isInitialLoad ? <ViewLoader /> : (
                <Suspense fallback={<ViewLoader />}>
                  <LazyPlanningMatrixView
                    rows={planningMatrixRows}
                    services={services}
                    planningCodes={planningCodes}
                    users={users}
                    canOpenUserManagement={isAdmin}
                    onOpenPlanningCodes={() => setCurrentView('planning-codes')}
                    onOpenServiceOverview={() => setCurrentView('beheer-dienstoverzicht')}
                    onOpenUserManagement={() => setCurrentView('gebruikers')}
                  />
                </Suspense>
              ))}
              {resolvedCurrentView === 'planning-codes' && (isInitialLoad ? <ViewLoader /> : <Suspense fallback={<ViewLoader />}><LazyPlanningCodesView codes={planningCodes} onSave={savePlanningCodes} canAdminDelete={isAdmin} /></Suspense>)}
              {resolvedCurrentView === 'beheer-updates' && (isInitialLoad ? <ViewLoader /> : (
                <Suspense fallback={<ViewLoader />}>
                  <LazyManageUpdatesView updates={updates} onSave={saveUpdates} onSaveUpdate={saveUpdate} onCreateUpdate={createUpdate} onDeleteUpdate={deleteUpdate} onSendUrgentEmail={sendUrgentEmail} canSendUrgentEmail={isAdmin} />
                </Suspense>
              ))}
              {resolvedCurrentView === 'gebruikers' && (isInitialLoad ? <ViewLoader /> : (
                <Suspense fallback={<ViewLoader />}>
                  <LazyManageUsersView currentUser={currentUser!} />
                </Suspense>
              ))}
              {resolvedCurrentView === 'toestellen' && (
                <Suspense fallback={<ViewLoader />}>
                  <LazyDevicesView users={users} currentUserId={currentUser!.id} />
                </Suspense>
              )}
              {resolvedCurrentView === 'activiteit' && (isInitialLoad ? <ViewLoader /> : <Suspense fallback={<ViewLoader />}><LazyActivityLogView entries={activityLog} logins={loginActivity} /></Suspense>)}
              {resolvedCurrentView === 'ocpi-monitoring' && <Suspense fallback={<ViewLoader />}><LazyOcpiDashboardView /></Suspense>}
              {resolvedCurrentView === 'vervaldata' && <Suspense fallback={<ViewLoader />}><LazyVervaldataView users={users} /></Suspense>}
              {resolvedCurrentView === 'beheer-omleidingen' && (isInitialLoad ? <ViewLoader /> : <Suspense fallback={<ViewLoader />}><LazyManageDiversionsView diversions={diversions} onSave={saveDiversions} onSaveDiversion={saveDiversion} onCreateDiversion={createDiversion} onDeleteDiversion={deleteDiversion} /></Suspense>)}
              {resolvedCurrentView === 'beheer-dienstoverzicht' && (isInitialLoad ? <ViewLoader /> : <Suspense fallback={<ViewLoader />}><LazyManageServicesView services={services} onSave={saveServices} canAdminOverride={isAdmin} /></Suspense>)}
              {resolvedCurrentView === 'ruil-verzoeken' && (isInitialLoad ? <ViewLoader /> : <LazySwapRequestsView user={currentUser} swaps={swaps} shifts={shifts} users={users} leaveRequests={leaveRequests} onSave={saveSwaps} onDecide={decideSwap} onConfirmSeen={confirmSwapSeen} preselectShiftId={swapPreselectShiftId} onPreselectConsumed={() => setSwapPreselectShiftId(null)} />)}
              {resolvedCurrentView === 'bezetting' && <LazyCapacityView currentUser={currentUser!} />}
              {resolvedCurrentView === 'dekking' && <Suspense fallback={<ViewLoader />}><LazyCoverageView /></Suspense>}
              {resolvedCurrentView === 'assistent' && <Suspense fallback={<ViewLoader />}><LazyAssistentView /></Suspense>}
              {resolvedCurrentView === 'verlof-kalender' && (isInitialLoad ? <ViewLoader /> : <Suspense fallback={<ViewLoader />}><LazyVerlofKalenderView users={users} leaveRequests={leaveRequests} /></Suspense>)}
              {resolvedCurrentView === 'verlof' && (isInitialLoad ? <ViewLoader /> : (
                <Suspense fallback={<ViewLoader />}>
                  <LazyLeaveManagementView
                    user={currentUser}
                    leaveRequests={leaveRequests}
                    users={users}
                    onSave={saveLeave}
                    onDecide={currentUser.role !== 'chauffeur' ? decideLeave : undefined}
                    lastSeenDecisionAt={lastSeenLeaveDecisionAt}
                    onMarkDecisionsSeen={markLeaveDecisionsSeen}
                    shifts={shifts}
                  />
                </Suspense>
              ))}
              {resolvedCurrentView === 'ziekte' && (isInitialLoad ? <ViewLoader /> : (
                <Suspense fallback={<ViewLoader />}>
                  <LazyZiekteView
                    user={currentUser}
                    users={users}
                    leaveRequests={leaveRequests}
                    shifts={shifts}
                    onSickReport={reportSick}
                    onSave={saveLeave}
                    onShiftSwapped={async () => {
                      await Promise.all([
                        fetchPlanning(undefined, undefined, { silent: true }),
                        fetchSwaps(),
                        refreshCoverageGaps(),
                      ]);
                    }}
                  />
                </Suspense>
              ))}
              {resolvedCurrentView === 'designsysteem' && <LazyDesignsysteemView />}
              {resolvedCurrentView === 'instellingen' && (
                <LazyInstellingenView
                  user={currentUser}
                  theme={theme}
                  onToggleTheme={toggleTheme}
                  pushBeschikbaar={!!pushPublicKey && isPushSupported()}
                  pushEnabled={pushEnabled}
                  onTogglePush={togglePush}
                  onChangePassword={() => setShowChangePassword(true)}
                  onAgenda={() => setShowAgenda(true)}
                  onProbleem={() => setShowProbleemMelder(true)}
                  onLogout={handleLogout}
                  onNavigate={setCurrentView}
                />
              )}
              {resolvedCurrentView === 'beheer-debug' && (isInitialLoad ? <ViewLoader /> : (
                <Suspense fallback={<ViewLoader />}>
                  <LazyDebugView currentUser={currentUser!} shifts={shifts} services={services} onSaveShifts={savePlanning} />
                </Suspense>
              ))}
            </div>
            </Suspense>
            </ErrorBoundary>
          </div>
        </div>
      </main>
      </div>

      {/* Mobile bottom-nav (alleen op klein scherm, alleen voor ingelogde gebruikers) */}
      <BottomNav
        currentView={resolvedCurrentView}
        onSelect={(v) => { setCurrentView(v); setIsSidebarOpen(false); }}
        role={effectiveRole}
        unseenLeaveCount={unseenLeaveDecisionCount}
        pendingLeaveCount={pendingLeaveCount}
        pendingSwapsCount={pendingSwapsCount}
        onMore={() => setIsSidebarOpen(true)}
        moreDot={isPlanner ? false : targetedSwapsCount > 0}
        hidden={isSidebarOpen}
      />

      {/* ⌘K Command Palette */}
    </AppDataProvider>
  );
}




