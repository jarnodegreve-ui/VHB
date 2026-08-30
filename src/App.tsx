/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, Suspense, useState, useEffect, useRef } from 'react';
import { viewUitUrl, zoekdeelVan } from './lib/deeplink';
import {
  LayoutDashboard,
  MapPin,
  Calendar,
  Bell,
  LogOut,
  Bus,
  AlertTriangle,
  FileText,
  FolderOpen,
  Plus,
  Users,
  RotateCcw,
  Menu,
  CalendarCheck,
  X,
  Map as MapIcon,
  Phone,
  Activity,
  KeyRound,
  IdCard,
  LifeBuoy,
  Moon,
  ShieldAlert,
  Smartphone,
  Sun,
  BellRing,
  BellOff,
  RefreshCw,
  WifiOff,
  Zap,
  CalendarCog,
  Hash,
  ClipboardList,
  HeartPulse,
  Thermometer,
  Sparkles
} from 'lucide-react';
import { formatSyncedTime } from './lib/format';
import { motion, AnimatePresence } from 'motion/react';
import type { Session } from '@supabase/supabase-js';
import { View, User, Shift, Update, Diversion, Service, SwapRequest, LeaveRequest, PlanningMatrixRow, PlanningCode, PlanningMatrixImportHistory, ActivityLogEntry, Role } from './types';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { applyThemeColorMeta, cn, LOGIN_MELDING_KEY, notify } from './lib/ui';
import { apiFetch, vernieuwSessie } from './lib/api';
import { lazyWithRetry } from './lib/lazyRetry';
import { reportHandledError, reportUserFeedback, setMonitoringUser } from './lib/monitoring';
import { fetchPushPublicKey, getExistingSubscription, isPushSupported, subscribeToPush, unsubscribeFromPush } from './lib/push';
import { fetchCoverageGaps, type DayGap } from './lib/coverage';
import { addDays, isoDate } from './lib/availability';
import { deriveDeviceName, deviceHeaders } from './lib/device';
import { usePullToRefresh } from './lib/usePullToRefresh';
import { ViewLoader } from './components/ui';
import { Button, MicroLabel } from './components/primitives';
import { Toast, ToastStack } from './components/ToastStack';
import { OfflineBanner, InstallPrompt } from './components/PwaChrome';
import { NavItem, NavSection, NavSubLabel } from './components/Navigation';
import { BottomNav } from './components/BottomNav';
import { BrandLogo } from './components/BrandLogo';
import { CommandPalette, useCommandPaletteShortcut } from './components/CommandPalette';
import { ChangePasswordModal } from './components/ChangePasswordModal';
import { Modal } from './components/Modal';
import { LoginView } from './views/LoginView';
import { ContactsView } from './views/ContactsView';
import { DashboardView } from './views/DashboardView';
import { useRealtimeSync } from './lib/realtime';
import { DiversionsView } from './views/DiversionsView';
import { ScheduleView } from './views/ScheduleView';
import { UpdatesView } from './views/UpdatesView';
import { SwapRequestsView } from './views/SwapRequestsView';
import { RitblaadjesView } from './views/RitblaadjesView';
import { DocumentsView } from './views/DocumentsView';
import { CapacityView } from './views/CapacityView';
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
const LazyPlannerDashboardWidgets = lazyWithRetry(() => import('./views/PlannerDashboardWidgets').then((module) => ({ default: module.PlannerDashboardWidgets })));
const LazyServicesView = lazyWithRetry(() => import('./views/ServicesView').then((module) => ({ default: module.ServicesView })));
const LazyPrintMonthlyScheduleView = lazyWithRetry(() => import('./views/PrintMonthlyScheduleView').then((module) => ({ default: module.PrintMonthlyScheduleView })));
const LazyPrintLeaveYearView = lazyWithRetry(() => import('./views/PrintLeaveYearView').then((module) => ({ default: module.PrintLeaveYearView })));


// Alle views die voor minstens één rol bestaan — de whitelist voor deeplinks
// (`?view=…`); de rol-guard doet daarna de fijne check.
let ALLE_VIEWS: readonly string[] = [];
const ALLOWED_VIEWS_BY_ROLE: Record<Role, View[]> = {
  chauffeur: ['dashboard', 'rooster', 'omleidingen', 'ritblaadjes', 'documenten', 'contacten', 'updates', 'ruil-verzoeken', 'bezetting', 'verlof'],
  planner: [
    'dashboard',
    'rooster',
    'omleidingen',
    'dienstoverzicht',
    'ritblaadjes',
    'contacten',
    'updates',
    'ruil-verzoeken',
    'bezetting',
    'dekking',
    'assistent',
    'verlof',
    'verlof-kalender',
    'beheer-roosters',
    'planning-matrix',
    'planning-codes',
    'beheer-updates',
    'beheer-omleidingen',
    'beheer-dienstoverzicht',
    'vervaldata',
    'ziekte',
  ],
  admin: [
    'dashboard',
    'rooster',
    'omleidingen',
    'dienstoverzicht',
    'ritblaadjes',
    'contacten',
    'updates',
    'ruil-verzoeken',
    'bezetting',
    'dekking',
    'assistent',
    'verlof',
    'verlof-kalender',
    'beheer-roosters',
    'planning-matrix',
    'planning-codes',
    'beheer-updates',
    'beheer-omleidingen',
    'beheer-dienstoverzicht',
    'vervaldata',
    'ziekte',
    'gebruikers',
    'toestellen',
    'activiteit',
    'ocpi-monitoring',
    'beheer-debug',
  ],
};
ALLE_VIEWS = [...new Set(Object.values(ALLOWED_VIEWS_BY_ROLE).flat())];




export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentView, setCurrentViewRaw] = useState<View>(() => {
    // Onthoud de laatst geopende pagina over een refresh heen. Een view die niet
    // (meer) mag voor deze rol wordt door de allowedViews-guard hieronder alsnog
    // teruggezet naar 'dashboard', en bij uitloggen wordt hij sowieso gereset.
    try {
      // Deeplink (`?view=…` uit een push-melding of externe link) wint van de
      // onthouden pagina; de URL wordt daarna schoongemaakt zodat een refresh
      // niet opnieuw "navigeert" (controle-ronde 27-08, voorstel 44).
      if (typeof window !== 'undefined') {
        const uitUrl = viewUitUrl(window.location.search, ALLE_VIEWS);
        if (uitUrl) {
          window.history.replaceState(null, '', window.location.pathname);
          return uitUrl;
        }
      }
      const stored = typeof window !== 'undefined' ? window.localStorage.getItem('vhb-current-view') : null;
      return (stored as View) || 'dashboard';
    } catch {
      return 'dashboard';
    }
  });
  // Start leeg (geen mock-data): tot de eerste fetch klaar is gate't
  // isInitialLoad de skeleton-staat. Geen risico meer dat mock-diensten/
  // gebruikers stilletjes als echte data getoond worden.
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [diversions, setDiversions] = useState<Diversion[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [updates, setUpdates] = useState<Update[]>([]);
  const [swaps, setSwaps] = useState<SwapRequest[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [lastSeenLeaveDecisionAt, setLastSeenLeaveDecisionAt] = useState<string | null>(null);
  const [unseenDocuments, setUnseenDocuments] = useState(0);
  const [myNotes, setMyNotes] = useState<Array<{ date: string; note: string }>>([]);
  const [planningMatrixRows, setPlanningMatrixRows] = useState<PlanningMatrixRow[]>([]);
  const [planningCodes, setPlanningCodes] = useState<PlanningCode[]>([]);
  const [planningMatrixHistory, setPlanningMatrixHistory] = useState<PlanningMatrixImportHistory[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [loginActivity, setLoginActivity] = useState<ActivityLogEntry[]>([]);
  // Dekkingsgaten (vandaag + 6 dagen = 7-daags venster) voor het Operations
  // Center van planner/admin. null = (nog) niet geladen — de cockpit toont
  // dan 'onbekend' i.p.v. een vals-groen 'volledig gedekt'.
  const [coverageDays, setCoverageDays] = useState<DayGap[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // Eerste data-fetch nog niet rond? Views kunnen dit gebruiken om
  // skeleton-loaders te tonen i.p.v. lege/mock-data.
  const [isInitialLoad, setIsInitialLoad] = useState(true);
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
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  // "Meld een probleem" (testfase): vrije tekst → client_errors met bron
  // 'gebruikersmelding', zichtbaar in Systeem Status en de dagoverzicht-mail.
  const [showProbleemMelder, setShowProbleemMelder] = useState(false);
  const [probleemTekst, setProbleemTekst] = useState('');
  const [probleemVerstuurd, setProbleemVerstuurd] = useState(false);
  const [probleemBezig, setProbleemBezig] = useState(false);
  const [probleemFout, setProbleemFout] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
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
  const setCurrentView = useCallback((next: View | ((prev: View) => View)) => {
    scrollContainerRef.current?.scrollTo({ top: 0 });
    setCurrentViewRaw(next);
  }, []);
  // Deeplink terwijl het portaal al open staat: de service worker stuurt bij
  // een tik op een melding een NAVIGATE-bericht i.p.v. het venster te
  // herladen (zie sw.js notificationclick) — een open formulier blijft zo
  // staan. Onbekende views negeren; de rol-guard doet de rest.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'NAVIGATE') return;
      const view = viewUitUrl(zoekdeelVan(String(event.data.url ?? '')), ALLE_VIEWS);
      if (view) setCurrentView(view);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [setCurrentView]);
  const ptrIndicatorRef = useRef<HTMLDivElement>(null);
  // Tijdstip van de laatste geslaagde dataload — chauffeurs zien zo hoe vers
  // hun rooster/omleidingen zijn (vooral offline of na een tijd weg).
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
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
  // Vangrail tegen dataverlies: het write-model POST telkens de volledige
  // collectie — opslaan vanuit een nooit-geladen staat zou de server alle
  // "ontbrekende" records laten verwijderen. Een collectie is pas
  // beschrijfbaar nadat haar GET aantoonbaar geslaagd is.
  const loadedCollectionsRef = useRef<Set<string>>(new Set());
  const markCollectionLoaded = (key: string) => {
    loadedCollectionsRef.current.add(key);
  };
  const guardCollectionLoaded = (key: string, label: string): boolean => {
    if (loadedCollectionsRef.current.has(key)) return true;
    showToast(`${label} is nog niet geladen — opslaan is geblokkeerd om dataverlies te voorkomen. Vernieuw de pagina en probeer het opnieuw.`, 'error');
    return false;
  };
  // Optimistic-concurrency: per collectie de laatst geladen revisie bewaren
  // (ondoorzichtige token uit de X-Collection-Revision-header). Bij opslaan
  // sturen we 'm mee; matcht hij niet meer met de serverstaat, dan heeft een
  // collega ondertussen opgeslagen → 409, wij verversen i.p.v. te overschrijven.
  const REVISION_HEADER = 'x-collection-revision';
  const collectionRevisionsRef = useRef<Record<string, string>>({});
  const captureRevision = (key: string, response: Response) => {
    const rev = response.headers.get(REVISION_HEADER);
    if (rev) collectionRevisionsRef.current[key] = rev;
  };
  const revisionHeader = (key: string): Record<string, string> => {
    const rev = collectionRevisionsRef.current[key];
    return rev ? { [REVISION_HEADER]: rev } : {};
  };
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

  // ⌘K / Ctrl+K opent het command palette
  useCommandPaletteShortcut(() => setIsCommandPaletteOpen(true));

  // Supabase Realtime: live sync van leave/swaps/diversions/updates/planning.
  // Activeert pas wanneer gebruiker is ingelogd (session present) — anders
  // gebeurt er niets.
  useRealtimeSync(!!session && !!currentUser, {
    refetchLeave: () => fetchLeave(),
    refetchSwaps: () => fetchSwaps(),
    refetchDiversions: () => fetchDiversions(undefined, { silent: true }),
    refetchUpdates: () => fetchUpdates(),
    refetchNotes: () => fetchMyNotes(),
    refetchPlanning: () => {
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
    try {
      stored = typeof window !== 'undefined' ? window.localStorage.getItem('vhb-theme') : null;
    } catch {
      // localStorage geblokkeerd (privacy-modus) — val terug op licht.
    }
    themaGekozenRef.current = stored === 'dark' || stored === 'light';
    const initial: 'light' | 'dark' = stored === 'dark' || stored === 'light' ? stored : 'light';
    setTheme(initial);
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', initial === 'dark');
      applyThemeColorMeta(initial === 'dark');
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
      }
      return next;
    });
  };

  const dismissToast = (id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  };

  const showToast = (message: string, tone: Toast['tone'] = 'info', action?: Toast['action']) => {
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
    setToasts((current) => {
      // Dezelfde melding niet stapelen: twee schermen die dezelfde bron
      // ophalen gaven anders twee identieke toasts onder elkaar.
      if (current.some((t) => t.message === message && t.tone === tone)) return current;
      return [...current, { id, message, tone, action }];
    });
    // Fout-toasts bevatten vaak instructies ("probeer opnieuw") — die moeten
    // lang genoeg blijven staan om rustig te lezen. Succes/info mag snel weg.
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, tone === 'error' ? 10000 : 4200);
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
      // laden...' blijven staan — dan liever terugvallen op het loginscherm.
      try {
        const { data } = await supabase.auth.getSession();
        if (!isMounted) return;

        setSession(data.session);
        if (data.session) {
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
        loadedCollectionsRef.current.clear();
        setUsers([]);
        setShifts([]);
        setDiversions([]);
        setServices([]);
        setUpdates([]);
        setSwaps([]);
        setLeaveRequests([]);
        setPlanningMatrixRows([]);
        setPlanningCodes([]);
        setPlanningMatrixHistory([]);
        setActivityLog([]);
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
      const customEvent = event as CustomEvent<{ message: string; tone?: Toast['tone'] }>;
      showToast(customEvent.detail.message, customEvent.detail.tone);
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
    };
    window.addEventListener('vhb-auth-expired', onExpired);
    window.addEventListener('vhb-device-blocked', onDeviceBlocked as EventListener);
    return () => {
      window.removeEventListener('vhb-auth-expired', onExpired);
      window.removeEventListener('vhb-device-blocked', onDeviceBlocked as EventListener);
    };
  }, []);

  useEffect(() => {
    if (currentView === 'activiteit' && currentUser?.role === 'admin') {
      fetchActivityLog();
      fetchLoginActivity();
    }
  }, [currentView, currentUser?.role]);

  useEffect(() => {
    if (!currentUser) {
      return;
    }

    const allowedViews = ALLOWED_VIEWS_BY_ROLE[currentUser.role] || ['dashboard'];
    if (!allowedViews.includes(currentView)) {
      setCurrentView('dashboard');
      showToast('Dit scherm is niet beschikbaar voor jouw rol.', 'info');
    }
  }, [currentUser, currentView]);

  // Onthoud de huidige pagina zodat een refresh op dezelfde plek blijft
  // (i.p.v. terug naar het dashboard te springen).
  useEffect(() => {
    try {
      window.localStorage.setItem('vhb-current-view', currentView);
    } catch {
      // localStorage geblokkeerd (privacy-modus) — dan geen herinnering, geen probleem.
    }
  }, [currentView]);

  useEffect(() => {
    if (!currentUser) {
      setLastSeenLeaveDecisionAt(null);
      return;
    }
    try {
      setLastSeenLeaveDecisionAt(localStorage.getItem(`planx-leave-lastseen-${currentUser.id}`));
    } catch {
      setLastSeenLeaveDecisionAt(null);
    }
  }, [currentUser?.id]);

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
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch { /* cache-API geblokkeerd — geen blocker */ }
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
    setMonitoringUser(String(data.id));
    forceSignOutRef.current = false; // geldige sessie → her-arm de auto-logout
    return data as User;
  };

  /** Achtergrond-dataload ná het profiel: blokkeert de eerste render niet —
   *  de views tonen intussen skeletons (isInitialLoad). */
  const loadAppData = async (appUser: User, accessToken: string) => {
    try {
      // Chauffeur: enkel eigen shifts ophalen (50× minder data op mobile).
      // Planner/admin: alle shifts (nodig voor beheer-views).
      const planningFilter = appUser.role === 'chauffeur' ? { driverId: String(appUser.id) } : undefined;
      await Promise.all([
        fetchPlanning(accessToken, planningFilter),
        fetchUsers(accessToken),
        fetchDiversions(accessToken),
        // Dienstoverzicht is planner/admin-only (view + beheer) — chauffeurs
        // hebben de services-collectie nergens nodig, dus niet ophalen.
        ...(appUser.role === 'planner' || appUser.role === 'admin' ? [fetchServices(accessToken)] : []),
        fetchUpdates(accessToken),
        fetchSwaps(accessToken),
        fetchLeave(accessToken),
        ...(appUser.role === 'planner' || appUser.role === 'admin' ? [fetchPlanningMatrix(accessToken)] : []),
        ...(appUser.role === 'planner' || appUser.role === 'admin' ? [fetchPlanningCodes(accessToken)] : []),
        ...(appUser.role === 'planner' || appUser.role === 'admin' ? [fetchPlanningMatrixHistory(accessToken)] : []),
        ...(appUser.role === 'planner' || appUser.role === 'admin' ? [refreshCoverageGaps()] : []),
        ...(appUser.role === 'admin' ? [fetchActivityLog(accessToken)] : []),
        ...(appUser.role === 'chauffeur' ? [fetchUnseenDocuments(appUser.id, accessToken)] : []),
      ]);
      setLastSyncedAt(Date.now());
    } catch (error) {
      console.error('Error loading app data:', error);
      meldLaadfout('de gegevens');
    } finally {
      setIsInitialLoad(false);
    }
  };

  // Pull-to-refresh (PWA): sleep omlaag bovenaan → alle data opnieuw ophalen.
  // `enabled` op !!currentUser zodat de hook (her)bindt zodra de scroll-
  // container gemonteerd is (bij de koude start bestaat die nog niet).
  const refreshAll = () =>
    currentUser && session?.access_token ? loadAppData(currentUser, session.access_token) : Promise.resolve();
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
        if (previous && previous !== current && 'caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
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

  const fetchUpdates = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/updates', { accessToken });
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setUpdates(data);
        markCollectionLoaded('updates');
        captureRevision('updates', response);
      }
    } catch (error) {
      console.error('Error fetching updates:', error);
      meldLaadfout('de updates');
    }
  };

  const saveUpdates = async (newUpdates: Update[]) => {
    if (!guardCollectionLoaded('updates', 'De updates zijn')) return false;
    try {
      const response = await apiFetch('/api/updates', {
        method: 'POST',
        headers: revisionHeader('updates'),
        body: JSON.stringify(newUpdates),
      });
      if (response.status === 409) {
        showToast('De updates zijn intussen door iemand anders gewijzigd — ik ververs ze, probeer je wijziging opnieuw.', 'info');
        await fetchUpdates();
        return false;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.details || data?.error || 'Opslaan mislukt.');
      }
      setUpdates(newUpdates);
      captureRevision('updates', response);
      if (currentUser?.role === 'admin') {
        await fetchActivityLog();
      }
      return true;
    } catch (error) {
      console.error('Error saving updates:', error);
      showToast(`Opslaan van updates is mislukt: ${error instanceof Error ? error.message : 'Onbekende fout'}`, 'error');
      return false;
    }
  };

  const sendUrgentEmail = async (update: Update) => {
    try {
      const response = await apiFetch('/api/send-urgent-update-email', {
        method: 'POST',
        body: JSON.stringify({
          update,
          recipients: users.filter(u => u.email)
        }),
      });
      const data = await response.json().catch(() => ({} as any));
      if (response.ok && data.success) {
        showToast(data.mocked ? `E-mail gelogd: ${data.message}` : 'E-mails verzonden naar alle chauffeurs.', 'success');
      } else {
        showToast(data.details || data.error || 'Verzenden van de e-mailupdate is mislukt.', 'error');
      }
    } catch (error) {
      console.error('Error sending urgent email:', error);
      showToast('Verzenden van de e-mailupdate is mislukt.', 'error');
    }
  };

  const fetchSwaps = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/swaps', { accessToken });
      captureRevision('swaps', response);
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setSwaps(data);
        markCollectionLoaded('swaps');
      }
    } catch (error) {
      console.error('Error fetching swaps:', error);
      meldLaadfout('de dienstruilen');
    }
  };

  const saveSwaps = async (newSwaps: SwapRequest[]): Promise<boolean> => {
    if (!guardCollectionLoaded('swaps', 'De dienstruilen zijn')) return false;
    // Nieuw verzoek vs. wijziging: andere boodschap, zodat de aanvrager weet
    // dat de collega eerst moet accepteren (anders lijkt de ruil al rond).
    const isNewRequest = newSwaps.length > swaps.length;
    try {
      const response = await apiFetch('/api/swaps', {
        method: 'POST',
        headers: revisionHeader('swaps'),
        body: JSON.stringify(newSwaps),
      });
      if (response.status === 409) {
        showToast('De dienstruilen zijn intussen door iemand anders gewijzigd — ik ververs ze, probeer je wijziging opnieuw.', 'info');
        await fetchSwaps();
        return false;
      }
      if (response.ok) {
        // Bewust opnieuw ophalen i.p.v. setSwaps(newSwaps): de server vult bij
        // het opslaan shiftDate/shiftLine aan — de dienst-info die de
        // ruilkaarten tonen zodra de dienst niet (meer) in de eigen planning
        // zit. Schreven we de client-array terug, dan bleef het dienstlabel
        // leeg tot de volgende fetch. fetchSwaps legt zelf de revisie vast.
        await fetchSwaps();
        if (currentUser?.role === 'admin') {
          await fetchActivityLog();
        }
        showToast(isNewRequest ? 'Ruilverzoek verstuurd — je collega moet eerst accepteren.' : 'Dienstruil bijgewerkt.', 'success');
        return true;
      }
      const err = await response.json().catch(() => ({} as any));
      showToast(err.error || 'Opslaan van dienstruilen is mislukt.', 'error');
      return false;
    } catch (error) {
      console.error('Error saving swaps:', error);
      showToast('Opslaan van dienstruilen is mislukt.', 'error');
      return false;
    }
  };

  const fetchLeave = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/leave', { accessToken });
      captureRevision('leave', response);
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setLeaveRequests(data);
        markCollectionLoaded('leave');
      }
    } catch (error) {
      console.error('Error fetching leave:', error);
      meldLaadfout('de verlofaanvragen');
    }
  };

  // 'Nieuw'-badge op Mijn documenten: telt de eigen documenten die nieuwer zijn
  // dan het moment waarop de chauffeur de documentenweergave het laatst opende.
  const fetchUnseenDocuments = async (userId: string, accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/documents', { accessToken });
      const data = await response.json();
      if (!Array.isArray(data)) return;
      let lastSeen: string | null = null;
      try { lastSeen = localStorage.getItem(`planx-documents-lastseen-${userId}`); } catch { /* privacy-modus */ }
      const unseen = lastSeen ? data.filter((d: any) => String(d.uploadedAt) > lastSeen).length : data.length;
      setUnseenDocuments(unseen);
    } catch (error) {
      console.error('Error fetching documents badge:', error);
    }
  };

  const markDocumentsSeen = () => {
    setUnseenDocuments(0);
    if (!currentUser) return;
    try { localStorage.setItem(`planx-documents-lastseen-${currentUser.id}`, new Date().toISOString()); } catch { /* privacy-modus */ }
  };

  const fetchPlanningMatrix = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/planning-matrix', { accessToken });
      const data = await response.json();
      if (data && Array.isArray(data)) setPlanningMatrixRows(data);
    } catch (error) {
      console.error('Error fetching planning matrix:', error);
    }
  };

  const fetchPlanningCodes = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/planning-codes', { accessToken });
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setPlanningCodes(data);
        markCollectionLoaded('planningCodes');
        captureRevision('planningCodes', response);
      }
    } catch (error) {
      console.error('Error fetching planning codes:', error);
    }
  };

  const fetchPlanningMatrixHistory = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/planning-matrix/history', { accessToken });
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setPlanningMatrixHistory(data);
      }
    } catch (error) {
      console.error('Error fetching planning matrix history:', error);
    }
  };

  const refreshCoverageGaps = async () => {
    try {
      const from = isoDate(new Date());
      const to = isoDate(addDays(new Date(), 6));
      const res = await fetchCoverageGaps(from, to);
      setCoverageDays(res.days);
    } catch (error) {
      // State blijft null (of houdt de vorige succesvolle fetch) — de
      // cockpit toont dan 'onbekend' i.p.v. vals-groen.
      console.error('Error fetching coverage gaps:', error);
    }
  };

  const fetchActivityLog = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/activity', { accessToken });
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setActivityLog(data);
      }
    } catch (error) {
      console.error('Error fetching activity log:', error);
    }
  };

  const fetchLoginActivity = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/activity/logins', { accessToken });
      const data = await response.json();
      if (data && Array.isArray(data.logins)) {
        setLoginActivity(data.logins);
      }
    } catch (error) {
      console.error('Error fetching login activity:', error);
    }
  };

  const savePlanningCodes = async (newCodes: PlanningCode[]) => {
    if (!guardCollectionLoaded('planningCodes', 'De planningscodes zijn')) return false;
    try {
      beginLoading();
      const response = await apiFetch('/api/planning-codes', {
        method: 'POST',
        headers: revisionHeader('planningCodes'),
        body: JSON.stringify(newCodes),
      });
      if (response.status === 409) {
        showToast('De planningscodes zijn intussen door iemand anders gewijzigd — ik ververs ze, probeer je wijziging opnieuw.', 'info');
        await fetchPlanningCodes();
        return false;
      }
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.details || data?.error || 'Opslaan mislukt.');
      }
      setPlanningCodes(newCodes);
      captureRevision('planningCodes', response);
      if (currentUser?.role === 'admin') {
        await fetchActivityLog();
      }
      showToast('Planningscodes succesvol opgeslagen.', 'success');
      return true;
    } catch (error: any) {
      console.error('Error saving planning codes:', error);
      showToast(`Opslaan van planningscodes is mislukt: ${error.message}`, 'error');
      return false;
    } finally {
      endLoading();
    }
  };

  const markLeaveDecisionsSeen = () => {
    if (!currentUser) return;
    const now = new Date().toISOString();
    setLastSeenLeaveDecisionAt(now);
    try {
      localStorage.setItem(`planx-leave-lastseen-${currentUser.id}`, now);
    } catch {
      // ignore quota / unavailable storage
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

  // Badge op het app-icoon (iOS 16.4+ PWA, Chromium-desktop): wat op jou
  // wacht, zichtbaar zonder de app te openen. Chauffeur: ruilverzoeken aan
  // hem + ongelezen documenten; planner/admin: de open werkvoorraad.
  const appBadgeCount = !currentUser
    ? 0
    : currentUser.role === 'chauffeur'
      ? targetedSwapsCount + unseenDocuments
      : pendingLeaveCount + pendingSwapsCount;
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
      void import('./views/LeaveManagementView');
      if (currentUser.role !== 'chauffeur') void import('./views/admin/VerlofKalenderView');
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

  const saveLeave = async (newLeave: LeaveRequest[]): Promise<boolean> => {
    if (!guardCollectionLoaded('leave', 'De verlofaanvragen zijn')) return false;
    try {
      const response = await apiFetch('/api/leave', {
        method: 'POST',
        headers: revisionHeader('leave'),
        body: JSON.stringify(newLeave),
      });
      if (response.status === 409) {
        showToast('De verlofaanvragen zijn intussen door iemand anders gewijzigd — ik ververs ze, probeer je wijziging opnieuw.', 'info');
        await fetchLeave();
        return false;
      }
      if (response.ok) {
        setLeaveRequests(newLeave);
        captureRevision('leave', response);
        if (currentUser?.role === 'admin') {
          await fetchActivityLog();
        }
        const isNewRequest = newLeave.some((r) => !leaveRequests.some((p) => p.id === r.id));
        showToast(isNewRequest ? 'Aanvraag ingediend — de planner beoordeelt ze.' : 'Verlofaanvraag bijgewerkt.', 'success');
        return true;
      }
      const err = await response.json().catch(() => ({} as any));
      showToast(err.details || err.error || 'Opslaan van verlofaanvragen is mislukt.', 'error');
      return false;
    } catch (error) {
      console.error('Error saving leave:', error);
      showToast('Opslaan van verlofaanvragen is mislukt.', 'error');
      return false;
    }
  };

  /** Ziekmelding: aparte, directe flow (geen goedkeuring). POST → verse
   *  verloflijst ophalen zodat de ziekte-dag meteen zichtbaar is. */
  const reportSick = async (payload: { userId: string; startDate?: string; endDate?: string; comment?: string }): Promise<boolean> => {
    try {
      const response = await apiFetch('/api/leave/sick-report', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (response.ok) {
        // Dekking meteen mee verversen: het gat dat deze ziekmelding slaat
        // moet direct in "Open taken" en Openstaande diensten staan — dít is
        // het moment waarop de planner een vervanger zoekt, niet na een
        // harde refresh. Best-effort naast de leave-fetch.
        await Promise.all([fetchLeave(), refreshCoverageGaps()]);
        showToast('Ziekmelding doorgegeven — de planning is verwittigd.', 'success');
        return true;
      }
      const err = await response.json().catch(() => ({} as any));
      showToast(err.error || 'Ziekmelding is mislukt.', 'error');
      return false;
    } catch (error) {
      console.error('Error reporting sick:', error);
      showToast('Ziekmelding is mislukt.', 'error');
      return false;
    }
  };

  /** Delta-beslissing op één record (PATCH) met optimistic-concurrency:
   *  bij een 409/404 is een collega ons voor geweest — verse lijst ophalen
   *  i.p.v. stilletjes overschrijven. Geldt voor verlof én dienstruil. */
  const decideViaPatch = async (
    kind: 'leave' | 'swaps',
    id: string,
    status: string,
    ifStatus: string | undefined,
    refetch: () => Promise<void> | void,
    applyLocal: (updated: any) => void,
  ): Promise<boolean> => {
    try {
      const response = await apiFetch(`/api/${kind}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, ifStatus }),
      });
      const data = await response.json().catch(() => ({} as any));
      if (response.ok) {
        captureRevision(kind, response);
        applyLocal(data?.leave ?? data?.swap ?? { status });
        if (currentUser?.role === 'admin') void fetchActivityLog();
        return true;
      }
      if (response.status === 409 || response.status === 404) {
        showToast(data.error || 'Dit is intussen al behandeld door een collega — de lijst is ververst.', 'info');
        void refetch();
        return false;
      }
      showToast(data.details || data.error || 'Beslissing opslaan is mislukt.', 'error');
      return false;
    } catch (error) {
      console.error(`Error deciding ${kind}:`, error);
      showToast('Beslissing opslaan is mislukt.', 'error');
      return false;
    }
  };

  const decideLeave = (id: string, status: LeaveRequest['status'], seenStatus?: string): Promise<boolean> => {
    const current = leaveRequests.find((r) => r.id === id);
    // Record niet (meer) lokaal → onze lijst is stale; ifStatus is server-
    // side verplicht, dus eerst verversen i.p.v. een kansloze PATCH.
    if (!current) { void fetchLeave(); return Promise.resolve(false); }
    // ifStatus = wat de beslisser ZAG (seenStatus uit de view), niet de live
    // state: realtime kan de lijst intussen ververst hebben met de beslissing
    // van een collega — met de live status als referentie keurt de check dan
    // altijd goed en is de guard feitelijk uitgeschakeld (controleronde 30/07).
    return decideViaPatch('leave', id, status, seenStatus ?? current.status, fetchLeave, (updated) => {
      setLeaveRequests((curr) => curr.map((r) => (r.id === id ? { ...r, ...updated } : r)));
    });
  };

  const decideSwap = (id: string, status: SwapRequest['status'], seenStatus?: string): Promise<boolean> => {
    const current = swaps.find((s) => s.id === id);
    if (!current) { void fetchSwaps(); return Promise.resolve(false); }
    // Zelfde seenStatus-principe als decideLeave.
    return decideViaPatch('swaps', id, status, seenStatus ?? current.status, fetchSwaps, (updated) => {
      setSwaps((curr) => curr.map((s) => (s.id === id ? { ...s, ...updated } : s)));
    });
  };

  // Chauffeur bevestigt een doorgevoerde wissel ("gezien") — eigen endpoint,
  // want targetSeenAt is bewust niet schrijfbaar via de array-route.
  const confirmSwapSeen = async (id: string): Promise<boolean> => {
    try {
      const response = await apiFetch(`/api/swaps/${id}/gezien`, { method: 'POST' });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        notify(data?.error || 'Bevestigen mislukt. Probeer het opnieuw.', 'error');
        void fetchSwaps();
        return false;
      }
      // Endpoint geeft { success: true } terug; lokaal direct markeren en de
      // echte timestamp via de refresh binnenhalen.
      setSwaps((curr) => curr.map((s) => (s.id === id ? { ...s, targetSeenAt: new Date().toISOString() } : s)));
      void fetchSwaps();
      notify('Bevestigd — de planner ziet dat je de wissel gezien hebt.', 'success');
      return true;
    } catch {
      notify('Bevestigen mislukt. Controleer je verbinding.', 'error');
      return false;
    }
  };

  // Dienstnotities van de ingelogde chauffeur (planner leest ze in het
  // Maandrooster zelf). Venster: gisteren t/m +45 dagen.
  const fetchMyNotes = async (accessToken = session?.access_token) => {
    try {
      if (currentUser?.role !== 'chauffeur') return;
      const from = new Date(); from.setDate(from.getDate() - 1);
      const to = new Date(); to.setDate(to.getDate() + 45);
      const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const response = await apiFetch(`/api/planning-notes?from=${iso(from)}&to=${iso(to)}`, { accessToken });
      const data = await response.json();
      if (Array.isArray(data)) setMyNotes(data.map((n: any) => ({ date: String(n.date), note: String(n.note) })));
    } catch { /* notities zijn nice-to-have */ }
  };

  useEffect(() => {
    if (currentUser?.role === 'chauffeur') void fetchMyNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, currentUser?.role]);

  const fetchServices = async (accessToken = session?.access_token) => {
    try {
      beginLoading();
      const response = await apiFetch('/api/services', { accessToken });
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setServices(data);
        markCollectionLoaded('services');
        captureRevision('services', response);
      }
    } catch (error) {
      console.error('Error fetching services:', error);
      meldLaadfout('het dienstoverzicht');
    } finally {
      endLoading();
    }
  };

  // Promise<boolean> zodat het beheerformulier pas sluit/wist ná succes —
  // dit was de enige mutatie-view die fire-and-forget opsloeg (controleronde).
  const saveServices = async (newServices: Service[], opts?: { bulkReplace?: boolean }): Promise<boolean> => {
    if (!guardCollectionLoaded('services', 'Het dienstoverzicht is')) return false;
    try {
      beginLoading();
      const response = await apiFetch('/api/services', {
        method: 'POST',
        // Import vervangt legitiem de hele collectie; de header laat de
        // server z'n bulk-wipe-vangrail voor deze save overslaan. Bij een
        // gewone bewerking sturen we de revisie mee voor conflictdetectie.
        headers: opts?.bulkReplace ? { 'x-bulk-replace': '1' } : revisionHeader('services'),
        body: JSON.stringify(newServices),
      });
      if (response.status === 409) {
        showToast('Het dienstoverzicht is intussen door iemand anders gewijzigd — ik ververs het, probeer je wijziging opnieuw.', 'info');
        await fetchServices();
        return false;
      }
      if (response.ok) {
        setServices(newServices);
        captureRevision('services', response);
        if (currentUser?.role === 'admin') {
          await fetchActivityLog();
        }
        showToast('Diensten succesvol opgeslagen.', 'success');
        return true;
      }
      const err = await response.json().catch(() => ({} as any));
      showToast(err.details || err.error || 'Opslaan van diensten is mislukt.', 'error');
      return false;
    } catch (error) {
      console.error('Error saving services:', error);
      showToast('Opslaan van diensten is mislukt.', 'error');
      return false;
    } finally {
      endLoading();
    }
  };

  const fetchUsers = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/users', { accessToken });
      captureRevision('users', response);
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setUsers(data);
        markCollectionLoaded('users');
      }
    } catch (error) {
      console.error('Error fetching users:', error);
      meldLaadfout('de gebruikerslijst');
    }
  };

  const saveUsers = async (newUsers: Array<User & { password?: string }>) => {
    if (!guardCollectionLoaded('users', 'De gebruikerslijst is')) return false;
    try {
      beginLoading();
      const response = await apiFetch('/api/users', {
        method: 'POST',
        headers: revisionHeader('users'),
        body: JSON.stringify(newUsers),
      });
      if (response.status === 409) {
        showToast('De gebruikerslijst is intussen door iemand anders gewijzigd — ik ververs ze, probeer je wijziging opnieuw.', 'info');
        await fetchUsers();
        return false;
      }
      if (response.ok) {
        await fetchUsers();
        if (currentUser?.role === 'admin') {
          await fetchActivityLog();
        }
        showToast('Gebruikers succesvol opgeslagen.', 'success');
        return true;
      } else {
        const text = await response.text();
        console.error('Server error saving users. Status:', response.status, 'Body:', text);
        
        let errorMsg = `Server fout (${response.status})`;
        try {
          const errorData = JSON.parse(text);
          errorMsg = errorData.details || errorData.error || errorMsg;
        } catch (e) {
          // If not JSON, maybe it's a Vercel error page
          if (text.includes('500') || text.includes('Internal Server Error')) {
            errorMsg = "Interne Server Fout (500). Controleer de Vercel logs of de tabelstructuur in Supabase.";
          } else if (text.length > 0) {
            errorMsg = `Server fout: ${text.slice(0, 100)}`;
          }
        }
        throw new Error(errorMsg);
      }
    } catch (error: any) {
      console.error('Error saving users:', error);
      showToast('Fout bij het opslaan van gebruikers: ' + error.message, 'error');
      return false;
    } finally {
      endLoading();
    }
  };

  const fetchPlanning = async (accessToken = session?.access_token, filters?: { driverId?: string; month?: string }, opts?: { silent?: boolean }) => {
    try {
      if (!opts?.silent) beginLoading();
      // Chauffeurs krijgen alleen hun eigen shifts — 50x minder data
      // dan het volledige rooster. Planner/admin krijgt alles.
      const params = new URLSearchParams();
      if (filters?.driverId) params.set('driverId', filters.driverId);
      if (filters?.month) params.set('month', filters.month);
      const qs = params.toString();
      const url = qs ? `/api/planning?${qs}` : '/api/planning';
      const response = await apiFetch(url, { accessToken });
      // Revisie alleen bij een ongefilterde fetch (de server zet 'm ook
      // alleen dan) — een subset-revisie zou valse conflicten geven.
      if (!qs) captureRevision('planning', response);
      const data = await response.json();
      // Een lege lijst is een geldig resultaat (chauffeur zonder diensten, of
      // planning gewist) → die moet ook écht leeg tonen. Vroeger hield
      // `length > 0` de oude/mock-data staan; nu enkel guarden op array-vorm.
      if (Array.isArray(data)) {
        setShifts(data);
        markCollectionLoaded('planning');
      }
    } catch (error) {
      console.error('Error fetching planning:', error);
      meldLaadfout('de planning');
    } finally {
      if (!opts?.silent) endLoading();
    }
  };

  const savePlanning = async (newShifts: Shift[]): Promise<boolean> => {
    if (!guardCollectionLoaded('planning', 'De planning is')) return false;
    try {
      beginLoading();
      const response = await apiFetch('/api/planning', {
        method: 'POST',
        headers: revisionHeader('planning'),
        body: JSON.stringify(newShifts),
      });
      if (response.status === 409) {
        showToast('De planning is intussen door iemand anders gewijzigd — ik ververs ze, probeer je wijziging opnieuw.', 'info');
        await fetchPlanning();
        return false;
      }
      if (response.ok) {
        setShifts(newShifts);
        captureRevision('planning', response);
        if (currentUser?.role === 'admin') {
          await fetchActivityLog();
        }
        showToast('Planning succesvol opgeslagen.', 'success');
        return true;
      }
      const err = await response.json().catch(() => ({} as any));
      showToast(err.details || err.error || 'Opslaan van planning is mislukt.', 'error');
      return false;
    } catch (error) {
      console.error('Error saving planning:', error);
      showToast('Opslaan van planning is mislukt.', 'error');
      return false;
    } finally {
      endLoading();
    }
  };

  const fetchDiversions = async (accessToken = session?.access_token, opts?: { silent?: boolean }) => {
    try {
      if (!opts?.silent) beginLoading();
      const response = await apiFetch('/api/diversions', { accessToken });
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setDiversions(data);
        markCollectionLoaded('diversions');
        captureRevision('diversions', response);
      }
    } catch (error) {
      console.error('Error fetching diversions:', error);
    } finally {
      if (!opts?.silent) endLoading();
    }
  };

  const saveDiversions = async (newDiversions: Diversion[]) => {
    if (!guardCollectionLoaded('diversions', 'De omleidingen zijn')) return;
    try {
      beginLoading();
      const response = await apiFetch('/api/diversions', {
        method: 'POST',
        headers: revisionHeader('diversions'),
        body: JSON.stringify(newDiversions),
      });
      if (response.status === 409) {
        showToast('De omleidingen zijn intussen door iemand anders gewijzigd — ik ververs ze, probeer je wijziging opnieuw.', 'info');
        await fetchDiversions(undefined, { silent: true });
        return;
      }
      if (response.ok) {
        setDiversions(newDiversions);
        captureRevision('diversions', response);
        if (currentUser?.role === 'admin') {
          await fetchActivityLog();
        }
        showToast('Omleidingen succesvol opgeslagen.', 'success');
      } else {
        const err = await response.json().catch(() => ({} as any));
        showToast(err.details || err.error || 'Opslaan van omleidingen is mislukt.', 'error');
      }
    } catch (error) {
      console.error('Error saving diversions:', error);
      showToast('Opslaan van omleidingen is mislukt.', 'error');
    } finally {
      endLoading();
    }
  };

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
      try {
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
      } catch {
        // cache-API geblokkeerd — geen blocker voor uitloggen
      }
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

  if (!authReady) {
    return (
      <div className="login-bg-dark min-h-screen flex flex-col items-center justify-center gap-5">
        <BrandLogo tone="donker" naamregelAfstand={26} className="w-56 h-auto select-none" />
        <div className="flex items-center gap-2.5 text-slate-300">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-oker-500" />
          <span className="text-sm font-medium">Sessie laden…</span>
        </div>
      </div>
    );
  }

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
        return <div className="min-h-screen bg-surface-white flex items-center justify-center text-slate-500">Print-weergave laden…</div>;
      }
      const bulkDrivers = users
        .filter((u) => u.isActive !== false && u.name.toLowerCase() !== 'beheerder')
        .sort((a, b) => a.name.localeCompare(b.name));
      return (
        <Suspense fallback={<div className="min-h-screen bg-surface-white flex items-center justify-center text-slate-500">Print-weergave laden…</div>}>
          <LazyPrintMonthlyScheduleView drivers={bulkDrivers} monthIso={printMonth} shifts={shifts} />
        </Suspense>
      );
    }
    const driver = users.find((u) => String(u.id) === String(printDriverId)) || null;
    return (
      <Suspense fallback={<div className="min-h-screen bg-surface-white flex items-center justify-center text-slate-500">Print-weergave laden…</div>}>
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
        return <div className="min-h-screen bg-surface-white flex items-center justify-center text-slate-500">Print-weergave laden…</div>;
      }
      const driver = isSelf ? currentUser : users.find((u) => String(u.id) === String(printVerlofDriverId)) || null;
      return (
        <Suspense fallback={<div className="min-h-screen bg-surface-white flex items-center justify-center text-slate-500">Print-weergave laden…</div>}>
          <LazyPrintLeaveYearView driver={driver} year={printVerlofJaar} leaves={leaveRequests} />
        </Suspense>
      );
    }
  }

  if (!isSupabaseConfigured || !supabase) {
    return <div className="min-h-screen bg-oker-50 flex items-center justify-center p-6 text-center text-slate-700 font-bold">Supabase client-configuratie ontbreekt. Voeg `VITE_SUPABASE_URL` en `VITE_SUPABASE_ANON_KEY` toe in Vercel en lokaal.</div>;
  }

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
    const revoked = deviceBlocked === 'revoked';
    return (
      <div className="login-bg-dark min-h-screen flex flex-col items-center justify-center gap-6 p-6 text-center">
        <BrandLogo tone="donker" naamregelAfstand={26} className="w-56 h-auto select-none" />
        <div className="max-w-sm">
          <div className={cn(
            'mx-auto w-14 h-14 rounded-2xl flex items-center justify-center ring-1 ring-white/10',
            revoked ? 'bg-red-500/15 text-red-300' : 'bg-oker-500/15 text-oker-400',
          )}>
            {revoked ? <ShieldAlert size={26} /> : <Smartphone size={26} />}
          </div>
          <h1 className="mt-4 text-xl font-black text-white tracking-tight">
            {revoked ? 'Dit toestel is geblokkeerd' : 'Toestel wacht op goedkeuring'}
          </h1>
          <p className="mt-2 text-sm font-medium leading-6 text-slate-300">
            {revoked
              ? 'De toegang voor dit toestel is ingetrokken. Neem contact op met de planning als dit niet klopt.'
              : 'Je login werkt, maar dit toestel is nog niet goedgekeurd. De planning heeft een melding gekregen — zodra het toestel is goedgekeurd kun je verder. Tip: zet je de app op je beginscherm, dan kan die één keer apart goedgekeurd moeten worden.'}
          </p>
          {!revoked && (
            <Button
              variant="primary"
              className="mt-5"
              onClick={async () => {
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
            >
              Opnieuw controleren
            </Button>
          )}
          <div className="mt-4">
            <button
              type="button"
              onClick={handleLogout}
              className="text-xs font-semibold text-slate-400 hover:text-white transition-colors"
            >
              Afmelden
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    // Wél een sessie maar (nog) geen profiel: toon een laadscherm met
    // retry i.p.v. het loginformulier aan een al-ingelogde gebruiker
    // (de 8s-watchdog kon hier anders een login-flits veroorzaken).
    if (session) {
      return (
        <div className="login-bg-dark min-h-screen flex flex-col items-center justify-center gap-5">
          <BrandLogo tone="donker" naamregelAfstand={26} className="w-56 h-auto select-none" />
          <div className="flex items-center gap-2.5 text-slate-300">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-oker-500" />
            <span className="text-sm font-medium">Profiel laden…</span>
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="text-xs font-semibold text-slate-400 hover:text-white transition-colors"
          >
            Duurt het te lang? Vernieuw de pagina
          </button>
        </div>
      );
    }
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
  const allowedViews = ALLOWED_VIEWS_BY_ROLE[currentUser.role] || ['dashboard'];
  const resolvedCurrentView = allowedViews.includes(currentView) ? currentView : 'dashboard';
  const viewMeta: Record<string, { title: string; subtitle: string }> = {
    // Bewust zonder subtitle (verzoek Jarno): de begroeting + statuspill op
    // het dashboard zelf zeggen al wat dit scherm is.
    dashboard: { title: 'Dashboard', subtitle: '' },
    omleidingen: { title: 'Omleidingen', subtitle: 'Actuele omleidingen.' },
    rooster: { title: 'Mijn rooster', subtitle: 'Je komende diensten en export naar agenda.' },
    dienstoverzicht: { title: 'Dienstoverzicht', subtitle: 'Alle diensten, uren en blokken in een compact overzicht.' },
    ritblaadjes: { title: 'Ritbladen', subtitle: 'Actuele rit-informatie als PDF voor alle chauffeurs.' },
    documenten: { title: 'Mijn documenten', subtitle: 'Documenten die de planning voor jou klaarzet vind je hier terug.' },
    contacten: { title: 'Contactlijst', subtitle: 'Bereik collega’s en planners sneller vanuit een centrale lijst.' },
    updates: { title: 'Updates', subtitle: 'Nieuws, veiligheidsmeldingen en technische mededelingen.' },
    'ruil-verzoeken': { title: 'Dienstruil', subtitle: 'Beheer openstaande dienstruilen en aanbiedingen.' },
    bezetting: { title: 'Maandplanning', subtitle: 'Wie rijdt welke dienst en wie heeft verlof — handig voor wissels.' },
    dekking: { title: 'Openstaande diensten', subtitle: 'Niet-ingevulde diensten per dag t.o.v. de verwachte diensten.' },
    assistent: { title: 'Planner-assistent', subtitle: 'Stel je planningsvraag — advies op basis van de actuele planning.' },
    verlof: { title: 'Verlof', subtitle: 'Vraag verlof aan en volg je aanvragen op.' },
    ziekte: { title: 'Ziekte', subtitle: 'Ziekmeldingen en de diensten die daardoor open staan.' },
    'verlof-kalender': { title: 'Verlof-kalender', subtitle: 'Maandoverzicht van alle afwezigheden in één tabel.' },
    'beheer-roosters': { title: 'Beheer roosters', subtitle: 'Importeer, synchroniseer en beheer planning centraal.' },
    'planning-matrix': { title: 'Planningsoverzicht', subtitle: 'Controleer de actuele geüploade matrixplanning per dag en chauffeur.' },
    'planning-codes': { title: 'Planningscodes', subtitle: 'Beheer de betekenis van matrixcodes zonder SQL of handmatige scripts.' },
    activiteit: { title: 'Activiteit', subtitle: 'Recente beheeracties en wijzigingen in het portaal.' },
    'beheer-updates': { title: 'Beheer updates', subtitle: 'Publiceer, controleer en verwijder updates en dringende meldingen.' },
    gebruikers: { title: 'Gebruikers', subtitle: 'Beheer accounts, rollen en toegangsrechten.' },
    toestellen: { title: 'Toestellen', subtitle: 'Keur toestellen goed of blokkeer ze — logins werken alleen op goedgekeurde toestellen.' },
    'beheer-omleidingen': { title: 'Beheer Omleidingen', subtitle: 'Voeg routewijzigingen en bijlagen toe voor chauffeurs.' },
    'beheer-dienstoverzicht': { title: 'Beheer Dienstoverzicht', subtitle: 'Onderhoud het dienstschema en importeer uit Excel.' },
    'ocpi-monitoring': { title: 'Laadpalen (OCPI)', subtitle: 'Status, sessies en verbruik van de Kempower-laadpalen.' },
    'beheer-debug': { title: 'Systeem Status', subtitle: 'Controleer koppelingen, tabellen en health checks.' },
  };
  const currentMeta = viewMeta[resolvedCurrentView] || { title: 'VHB Portaal', subtitle: 'Interne operationele omgeving.' };
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
    <>
      {/* Parallax-laag: fixed gekleurde blobs die trager scrollen dan content */}
      <div className="parallax-bg" aria-hidden="true" />

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      <OfflineBanner />
      <InstallPrompt />
      <ChangePasswordModal
        isOpen={showChangePassword}
        onClose={() => setShowChangePassword(false)}
        email={currentUser?.email || session?.user?.email || ''}
      />
      {/* Probleem-melder (testfase): tekst + scherm-context → client_errors,
          bron 'gebruikersmelding'. Geen aparte tabel of mailstroom nodig —
          het komt in Systeem Status en het dagoverzicht terecht. */}
      <Modal open={showProbleemMelder} onClose={() => setShowProbleemMelder(false)} maxWidth="sm" ariaLabel="Meld een probleem">
        <div className="p-6">
          {probleemVerstuurd ? (
            <div className="text-center py-4">
              <p className="text-sm font-bold text-slate-800">Bedankt — je melding is verstuurd.</p>
              <p className="mt-1.5 text-xs text-slate-500">De planning ziet hem in het systeemoverzicht.</p>
              <Button variant="primary" className="mt-5" onClick={() => setShowProbleemMelder(false)}>
                Sluiten
              </Button>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const tekst = probleemTekst.trim();
                if (!tekst || probleemBezig) return;
                // Pas "verstuurd" tonen als de server de melding écht heeft:
                // een stil weggevallen POST kreeg voorheen ook een "Bedankt!".
                setProbleemBezig(true);
                setProbleemFout(false);
                void reportUserFeedback(tekst, { view: currentView }).then((ok) => {
                  setProbleemBezig(false);
                  if (ok) setProbleemVerstuurd(true);
                  else setProbleemFout(true);
                });
              }}
            >
              <h3 className="text-base font-bold text-slate-800">Meld een probleem</h3>
              <p className="mt-1 text-xs text-slate-500">
                Beschrijf kort wat er misging of niet klopte. Het scherm waar je nu bent sturen we automatisch mee.
              </p>
              <label htmlFor="probleem-tekst" className="mt-4 block text-2xs font-semibold uppercase tracking-[0.08em] text-slate-500">
                Wat ging er mis?
              </label>
              <textarea
                id="probleem-tekst"
                value={probleemTekst}
                onChange={(e) => setProbleemTekst(e.target.value)}
                maxLength={900}
                rows={4}
                placeholder="Bijv. de aftelling bij Chris klopt niet — hij is al klaar…"
                className="control-input mt-1.5 w-full rounded-2xl bg-surface-field px-4 py-3 text-base font-medium outline-none sm:text-sm"
              />
              {probleemFout && (
                <p className="mt-2 text-xs font-semibold text-red-600">Versturen lukte niet — controleer je verbinding en probeer opnieuw.</p>
              )}
              <div className="mt-4 flex justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowProbleemMelder(false)}
                  className="ios-pressable rounded-2xl px-4 py-2.5 text-sm font-semibold text-slate-500 hover:text-slate-700"
                >
                  Annuleren
                </button>
                <Button type="submit" variant="primary" disabled={!probleemTekst.trim() || probleemBezig}>
                  {probleemBezig ? 'Versturen…' : 'Versturen'}
                </Button>
              </div>
            </form>
          )}
        </div>
      </Modal>
      <AnimatePresence>
        {isLoading && !isInitialLoad && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/20"
          >
            <div className="rounded-2xl border border-slate-200/80 bg-white/95 px-5 py-4 shadow-xl">
              <div className="flex items-center gap-4">
                <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-oker-500" />
                <div>
                  <MicroLabel>Bezig</MicroLabel>
                  <p className="text-sm font-semibold text-slate-800">Gegevens verwerken...</p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* h-dvh i.p.v. h-screen (100vh): vóór installatie in een Safari-tab is
          100vh de hoogte mét uitgeklapte toolbar, waardoor de onderrand achter
          de balk viel. dvh volgt de zichtbare viewport. */}
      <div className="flex h-dvh w-full bg-transparent text-slate-900 font-sans overflow-hidden">
      {/* Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-slate-900/35 backdrop-blur-sm z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar — vaste rail, full-height, haarlijn rechts */}
      <aside
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
        <div className="shrink-0 px-5 pt-5 pb-4 flex items-center justify-center relative text-center">
          {/* Géén transform/transition-all op de logoknop: Safari rastert een
              element met schaal-animatie als bitmap-laag en schaalt die —
              dat maakte de logo-randen kartelig op retina (melding Jarno). */}
          <button
            type="button"
            onClick={() => { setCurrentView('dashboard'); setIsSidebarOpen(false); }}
            className="rounded-xl py-1 px-2 transition-opacity hover:opacity-80"
            title="Naar dashboard"
          >
            {/* Volledig logo mét naamregel op w-36 = 144 px — bewuste keuze
                Jarno (30-08): op 192 px (richtlijn-minimum 180 px) te groot,
                het beeldmerk zonder naamregel wilde hij niet. Naamregel 1,2×
                en 26 eenheden lager (ook Jarno) voor leesbaarheid op deze maat. */}
            <BrandLogo tone="licht" naamregelSchaal={1.2} naamregelAfstand={26} className="w-36 h-auto mx-auto select-none block dark:hidden" />
            <BrandLogo tone="donker" naamregelSchaal={1.2} naamregelAfstand={26} className="w-36 h-auto mx-auto select-none hidden dark:block" />
          </button>
          <button
            onClick={() => setIsSidebarOpen(false)}
            aria-label="Menu sluiten"
            className="absolute right-3 top-1/2 -translate-y-1/2 w-11 h-11 flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-slate-100/80 rounded-xl transition-colors lg:hidden"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 min-h-0 px-3 py-3 space-y-0.5 overflow-y-auto overscroll-contain">
          {isPlanner && <MicroLabel className="mb-1 px-3 pt-0.5">Algemeen</MicroLabel>}
          <NavItem
            icon={<LayoutDashboard size={18} />}
            label="Dashboard"
            active={currentView === 'dashboard'} 
            onClick={() => { setCurrentView('dashboard'); setIsSidebarOpen(false); }} 
          />
          <NavItem 
            icon={<Calendar size={18} />} 
            label="Rooster" 
            active={currentView === 'rooster'} 
            onClick={() => { setCurrentView('rooster'); setIsSidebarOpen(false); }} 
          />
          <NavItem 
            icon={<MapPin size={18} />} 
            label="Omleidingen" 
            active={currentView === 'omleidingen'} 
            onClick={() => { setCurrentView('omleidingen'); setIsSidebarOpen(false); }} 
          />
          <NavItem
            icon={<FileText size={18} />}
            label="Ritbladen"
            active={currentView === 'ritblaadjes'}
            onClick={() => { setCurrentView('ritblaadjes'); setIsSidebarOpen(false); }}
          />
          {!isPlanner && (
            <NavItem
              icon={<FolderOpen size={18} />}
              label="Documenten"
              active={currentView === 'documenten'}
              badge={unseenDocuments}
              onClick={() => { setCurrentView('documenten'); setIsSidebarOpen(false); markDocumentsSeen(); }}
            />
          )}
          <NavItem
            icon={<RotateCcw size={18} />}
            label="Dienstruil"
            active={currentView === 'ruil-verzoeken'}
            onClick={() => { setCurrentView('ruil-verzoeken'); setIsSidebarOpen(false); }}
            badge={isPlanner ? pendingSwapsCount : (targetedSwapsCount || undefined)}
          />
          <NavItem
            icon={<CalendarCheck size={18} />}
            label="Verlof"
            active={currentView === 'verlof'}
            onClick={() => { setCurrentView('verlof'); setIsSidebarOpen(false); }}
            badge={isPlanner ? pendingLeaveCount : unseenLeaveDecisionCount}
          />
          <NavItem 
            icon={<Bell size={18} />} 
            label="Updates" 
            active={currentView === 'updates'} 
            onClick={() => { setCurrentView('updates'); setIsSidebarOpen(false); }} 
          />
          <NavItem
            icon={<Phone size={18} />}
            label="Contacten"
            active={currentView === 'contacten'}
            onClick={() => { setCurrentView('contacten'); setIsSidebarOpen(false); }}
          />
          {/* "Maandplanning" — zelfde term als de paginatitel; de nav zei
              eerst "Maandrooster" en dat waren twee namen voor één scherm. */}
          <NavItem
            icon={<Users size={18} />}
            label="Maandplanning"
            active={currentView === 'bezetting'}
            onClick={() => { setCurrentView('bezetting'); setIsSidebarOpen(false); }}
          />

          {isPlanner && (
            <NavSection
              title="Beheer"
              count={11}
              active={['beheer-roosters', 'planning-matrix', 'planning-codes', 'dienstoverzicht', 'beheer-dienstoverzicht', 'dekking', 'assistent', 'verlof-kalender', 'ziekte', 'vervaldata', 'beheer-updates', 'beheer-omleidingen'].includes(currentView)}
            >
              {/* Drie subgroepen + uniek icoon per item: Settings/Bus stonden
                  elk 2× in deze lijst en dat sloopte de scanbaarheid van juist
                  de langste sectie. */}
              <NavSubLabel>Planning</NavSubLabel>
              <NavItem icon={<CalendarCog size={18} />} label="Beheer roosters" active={currentView === 'beheer-roosters'} onClick={() => { setCurrentView('beheer-roosters'); setIsSidebarOpen(false); }} />
              <NavItem icon={<FileText size={18} />} label="Planningsoverzicht" active={currentView === 'planning-matrix'} onClick={() => { setCurrentView('planning-matrix'); setIsSidebarOpen(false); }} />
              <NavItem icon={<Hash size={18} />} label="Planningscodes" active={currentView === 'planning-codes'} onClick={() => { setCurrentView('planning-codes'); setIsSidebarOpen(false); }} />
              <NavItem icon={<Bus size={18} />} label="Dienstoverzicht" active={currentView === 'dienstoverzicht'} onClick={() => { setCurrentView('dienstoverzicht'); setIsSidebarOpen(false); }} />
              <NavItem icon={<ClipboardList size={18} />} label="Beheer dienstoverzicht" active={currentView === 'beheer-dienstoverzicht'} onClick={() => { setCurrentView('beheer-dienstoverzicht'); setIsSidebarOpen(false); }} />
              <NavItem icon={<AlertTriangle size={18} />} label="Openstaande diensten" active={currentView === 'dekking'} onClick={() => { setCurrentView('dekking'); setIsSidebarOpen(false); }} />
              <NavItem icon={<Sparkles size={18} />} label="Assistent" active={currentView === 'assistent'} onClick={() => { setCurrentView('assistent'); setIsSidebarOpen(false); }} />
              <NavSubLabel>Mensen</NavSubLabel>
              <NavItem icon={<Calendar size={18} />} label="Verlof-kalender" active={currentView === 'verlof-kalender'} onClick={() => { setCurrentView('verlof-kalender'); setIsSidebarOpen(false); }} />
              {/* Eigen blad, bewust los van Verlof: ziekte is geen aanvraag
                  (keuze Jarno 15-08). */}
              <NavItem icon={<Thermometer size={18} />} label="Ziekte" active={currentView === 'ziekte'} onClick={() => { setCurrentView('ziekte'); setIsSidebarOpen(false); }} />
              <NavItem icon={<IdCard size={18} />} label="Vervaldata" active={currentView === 'vervaldata'} onClick={() => { setCurrentView('vervaldata'); setIsSidebarOpen(false); }} />
              <NavSubLabel>Communicatie</NavSubLabel>
              <NavItem icon={<Plus size={18} />} label="Beheer updates" active={currentView === 'beheer-updates'} onClick={() => { setCurrentView('beheer-updates'); setIsSidebarOpen(false); }} />
              <NavItem icon={<MapIcon size={18} />} label="Beheer omleidingen" active={currentView === 'beheer-omleidingen'} onClick={() => { setCurrentView('beheer-omleidingen'); setIsSidebarOpen(false); }} />
            </NavSection>
          )}

          {isAdmin && (
            <NavSection title="Systeem" count={5} active={['gebruikers', 'toestellen', 'activiteit', 'ocpi-monitoring', 'beheer-debug'].includes(currentView)}>
              <NavItem icon={<Users size={18} />} label="Gebruikers" active={currentView === 'gebruikers'} onClick={() => { setCurrentView('gebruikers'); setIsSidebarOpen(false); }} />
              <NavItem icon={<Smartphone size={18} />} label="Toestellen" active={currentView === 'toestellen'} onClick={() => { setCurrentView('toestellen'); setIsSidebarOpen(false); }} />
              <NavItem icon={<Activity size={18} />} label="Activiteit" active={currentView === 'activiteit'} onClick={() => { setCurrentView('activiteit'); setIsSidebarOpen(false); }} />
              <NavItem icon={<Zap size={18} />} label="Laadpalen (OCPI)" active={currentView === 'ocpi-monitoring'} onClick={() => { setCurrentView('ocpi-monitoring'); setIsSidebarOpen(false); }} />
              <NavItem icon={<HeartPulse size={18} />} label="Systeemstatus" active={currentView === 'beheer-debug'} onClick={() => { setCurrentView('beheer-debug'); setIsSidebarOpen(false); }} />
            </NavSection>
          )}
        </nav>

        {/* Safe-area onderaan: als mobiele "Meer"-sheet valt de onderrij
            ("Uitloggen") anders deels in de home-indicator-zone van de
            iPhone — tikken triggerde daar makkelijk de swipe-gesture. */}
        <div
          className="shrink-0 p-3 border-t fine-divider space-y-0.5"
          style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
        >
          {/* User profile card */}
          <div className="flex items-center gap-2.5 px-3 py-2 mb-1.5 rounded-xl bg-slate-100/60">
            <div className="w-8 h-8 rounded-lg bg-oker-100 flex items-center justify-center text-oker-700 shrink-0 text-2xs font-bold">
              {userInitials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-800 truncate leading-tight">{currentUser.name}</p>
              <p className="text-2xs text-slate-500 font-medium capitalize">{currentUser.role}</p>
            </div>
          </div>
          <button
            onClick={toggleTheme}
            className="flex items-center gap-3 w-full px-3 py-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 rounded-xl transition-colors duration-150 font-medium text-sm"
          >
            <span className="text-slate-400 shrink-0">
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </span>
            <span>{theme === 'light' ? 'Donkere modus' : 'Lichte modus'}</span>
          </button>
          {pushPublicKey && isPushSupported() && (
            <button
              onClick={togglePush}
              className="flex items-center gap-3 w-full px-3 py-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 rounded-xl transition-colors duration-150 font-medium text-sm"
            >
              <span className="text-slate-400 shrink-0">
                {pushEnabled ? <BellOff size={16} /> : <BellRing size={16} />}
              </span>
              <span>{pushEnabled ? 'Meldingen uitschakelen' : 'Meldingen inschakelen'}</span>
            </button>
          )}
          <button
            onClick={() => setShowChangePassword(true)}
            className="flex items-center gap-3 w-full px-3 py-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 rounded-xl transition-colors duration-150 font-medium text-sm"
          >
            <span className="text-slate-400 shrink-0">
              <KeyRound size={16} />
            </span>
            <span>Wachtwoord wijzigen</span>
          </button>
          <button
            onClick={() => { setProbleemTekst(''); setProbleemVerstuurd(false); setShowProbleemMelder(true); setIsSidebarOpen(false); }}
            aria-haspopup="dialog"
            className="flex items-center gap-3 w-full px-3 py-2 text-slate-600 hover:text-slate-900 hover:bg-surface-soft-hover rounded-xl transition-colors duration-150 font-medium text-sm"
          >
            <span className="text-slate-400 shrink-0">
              <LifeBuoy size={16} />
            </span>
            <span>Meld een probleem</span>
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2 text-slate-600 hover:text-red-600 hover:bg-red-50/70 rounded-xl transition-colors duration-150 font-medium text-sm"
          >
            <span className="text-slate-400 shrink-0">
              <LogOut size={16} />
            </span>
            <span>Uitloggen</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden relative">
        {/* Scroll container met sticky-header — header zit BINNEN de scroll
            zodat content er onderdoor schuift en de panel-blur natuurlijk
            werkt (echte iOS-vibe i.p.v. harde rand). */}
        {/* Pull-to-refresh-indicator: altijd in de DOM (de hook stuurt opacity/
            transform rechtstreeks aan via ptrIndicatorRef); animate-spin volgt
            de refreshing-state. */}
        <div
          ref={ptrIndicatorRef}
          className="pointer-events-none absolute inset-x-0 top-0 z-40 flex justify-center opacity-0"
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
          <div className="sticky top-0 z-30 -mx-[max(1rem,env(safe-area-inset-left),env(safe-area-inset-right))] md:-mx-7 mb-5">
            <header className={cn("topbar px-[max(1rem,env(safe-area-inset-left),env(safe-area-inset-right))] md:px-7", isScrolled && "topbar--scrolled")}>
              <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between gap-3 py-2.5 min-h-12">
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    onClick={() => setIsSidebarOpen(true)}
                    aria-label="Menu openen"
                    className="p-2 -ml-1 text-slate-500 hover:bg-slate-100/80 hover:text-slate-800 rounded-lg hidden md:block lg:hidden transition-colors"
                  >
                    <Menu size={18} />
                  </button>
                  {/* Topbar is puur context: alleen de compacte titel. De
                      subtitel dupliceerde de PageHeader-description eronder,
                      en het identiteitsblok stond al in de sidebar-footer —
                      dubbele titeling boven de vouw is weg. */}
                  <h2 className="text-sm font-semibold tracking-tight text-slate-900 leading-tight truncate">
                    {currentMeta.title}
                  </h2>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {/* Zoekknop bewust weg (Jarno: "vrij zinloos") — het
                      command palette blijft bereikbaar via ⌘K. */}
                  {/* Geen permanente "Online"-pill meer: rust is de standaard.
                      Alleen een storing verdient een signaal — de offline-
                      banner hieronder dekt dat op elk formaat. */}
                </div>
              </div>
            </header>
          </div>
          {/* Offline-banner: de topbar-pill is desktop-only (hidden lg:flex),
              dus op de iPhone — hét toestel — was een uitval onzichtbaar en
              keek je zonder het te weten naar verouderde data. */}
          {!isOnline && (
            <div className="mx-auto w-full max-w-[1200px]">
              <div className="mb-4 flex items-center gap-2.5 rounded-2xl border border-amber-200/70 bg-amber-50/90 px-4 py-3 text-sm font-semibold text-amber-800 dark:border-amber-400/25 dark:bg-amber-500/10 dark:text-amber-300">
                <WifiOff size={14} className="shrink-0" />
                <span>
                  Offline — wijzigingen komen niet door
                  {lastSyncedAt ? ` · laatst bijgewerkt ${formatSyncedTime(lastSyncedAt)}` : ''}
                </span>
              </div>
            </div>
          )}
          {/* Directe view-wissel — geen AnimatePresence/motion. Een in/uit-
              animatie op de hele view (mode="wait" = exit + enter, ~0.56s op
              een grote DOM) veroorzaakte hapering bij het wisselen van pagina's
              op tragere Windows-pc's. Instant = sneller en jank-vrij. */}
          <div className="mx-auto w-full max-w-[1200px]">
              {resolvedCurrentView === 'dashboard' && (
                isPlanner ? (
                  /* Planner/admin: Operations Center — één operationele cockpit
                     i.p.v. een dubbel dashboard. */
                  <Suspense fallback={<ViewLoader />}>
                  <LazyPlannerDashboardWidgets
                    currentUser={currentUser!}
                    users={users}
                    shifts={shifts}
                    diversions={diversions}
                    updates={updates}
                    leaveRequests={leaveRequests}
                    swaps={swaps}
                    matrixHistory={planningMatrixHistory}
                    activityLog={activityLog}
                    coverageDays={coverageDays}
                    onNavigate={(view) => setCurrentView(view)}
                    onSickReport={reportSick}
                    onShiftSwapped={async () => {
                      // Wissel vanuit de ziekmeld-flow: planning, ruilen en
                      // dekking meteen mee verversen zodat het dashboard niet
                      // een oude "nog te herverdelen"-rij blijft tonen.
                      await Promise.all([
                        // Planner/admin-scherm: altijd de volledige planning.
                        fetchPlanning(undefined, undefined, { silent: true }),
                        fetchSwaps(),
                        refreshCoverageGaps(),
                      ]);
                    }}
                    isInitialLoad={isInitialLoad}
                    canPreview={isRealAdmin}
                    previewActive={previewChauffeur}
                    onTogglePreview={() => setPreviewChauffeur((v) => !v)}
                  />
                  </Suspense>
                ) : (
                  <DashboardView user={previewingChauffeur ? { ...currentUser!, role: 'chauffeur' } : currentUser!} notes={myNotes} shifts={shifts} diversions={diversions} users={users} leaveRequests={leaveRequests} isInitialLoad={isInitialLoad} onNavigate={setCurrentView} canPreview={isRealAdmin} previewActive={previewChauffeur} onTogglePreview={() => setPreviewChauffeur((v) => !v)} onChangePassword={() => setShowChangePassword(true)} />
                )
              )}
              {resolvedCurrentView === 'omleidingen' && (isInitialLoad ? <ViewLoader /> : <DiversionsView diversions={diversions} lastSyncedAt={lastSyncedAt} />)}
              {resolvedCurrentView === 'rooster' && <ScheduleView user={currentUser!} notes={myNotes} shifts={shifts} users={users} leaveRequests={leaveRequests} swaps={swaps} isInitialLoad={isInitialLoad} lastSyncedAt={lastSyncedAt} onRequestSwap={(shiftId) => { setSwapPreselectShiftId(shiftId); setCurrentView('ruil-verzoeken'); }} />}
              {resolvedCurrentView === 'dienstoverzicht' && (isInitialLoad ? <ViewLoader /> : <Suspense fallback={<ViewLoader />}><LazyServicesView services={services} /></Suspense>)}
              {resolvedCurrentView === 'ritblaadjes' && <RitblaadjesView currentUser={currentUser!} />}
              {resolvedCurrentView === 'documenten' && <DocumentsView currentUser={currentUser!} onSeen={markDocumentsSeen} />}
              {resolvedCurrentView === 'updates' && (isInitialLoad ? <ViewLoader /> : <UpdatesView updates={updates} />)}
              {resolvedCurrentView === 'contacten' && (isInitialLoad ? <ViewLoader /> : <ContactsView users={users} currentUser={currentUser!} />)}
              {resolvedCurrentView === 'beheer-roosters' && (
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
              )}
              {resolvedCurrentView === 'planning-matrix' && (
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
              )}
              {resolvedCurrentView === 'planning-codes' && <Suspense fallback={<ViewLoader />}><LazyPlanningCodesView codes={planningCodes} onSave={savePlanningCodes} canAdminDelete={isAdmin} /></Suspense>}
              {resolvedCurrentView === 'beheer-updates' && (
                <Suspense fallback={<ViewLoader />}>
                  <LazyManageUpdatesView updates={updates} onSave={saveUpdates} onSendUrgentEmail={sendUrgentEmail} canSendUrgentEmail={isAdmin} />
                </Suspense>
              )}
              {resolvedCurrentView === 'gebruikers' && (
                <Suspense fallback={<ViewLoader />}>
                  <LazyManageUsersView users={users} onSave={saveUsers} currentUser={currentUser!} shifts={shifts} leaveRequests={leaveRequests} swaps={swaps} />
                </Suspense>
              )}
              {resolvedCurrentView === 'toestellen' && (
                <Suspense fallback={<ViewLoader />}>
                  <LazyDevicesView users={users} currentUserId={currentUser!.id} />
                </Suspense>
              )}
              {resolvedCurrentView === 'activiteit' && <Suspense fallback={<ViewLoader />}><LazyActivityLogView entries={activityLog} logins={loginActivity} /></Suspense>}
              {resolvedCurrentView === 'ocpi-monitoring' && <Suspense fallback={<ViewLoader />}><LazyOcpiDashboardView /></Suspense>}
              {resolvedCurrentView === 'vervaldata' && <Suspense fallback={<ViewLoader />}><LazyVervaldataView users={users} /></Suspense>}
              {resolvedCurrentView === 'beheer-omleidingen' && <Suspense fallback={<ViewLoader />}><LazyManageDiversionsView diversions={diversions} onSave={saveDiversions} /></Suspense>}
              {resolvedCurrentView === 'beheer-dienstoverzicht' && <Suspense fallback={<ViewLoader />}><LazyManageServicesView services={services} onSave={saveServices} canAdminOverride={isAdmin} /></Suspense>}
              {resolvedCurrentView === 'ruil-verzoeken' && (isInitialLoad ? <ViewLoader /> : <SwapRequestsView user={currentUser} swaps={swaps} shifts={shifts} users={users} leaveRequests={leaveRequests} onSave={saveSwaps} onDecide={decideSwap} onConfirmSeen={confirmSwapSeen} preselectShiftId={swapPreselectShiftId} onPreselectConsumed={() => setSwapPreselectShiftId(null)} />)}
              {resolvedCurrentView === 'bezetting' && <CapacityView currentUser={currentUser!} />}
              {resolvedCurrentView === 'dekking' && <Suspense fallback={<ViewLoader />}><LazyCoverageView /></Suspense>}
              {resolvedCurrentView === 'assistent' && <Suspense fallback={<ViewLoader />}><LazyAssistentView /></Suspense>}
              {resolvedCurrentView === 'verlof-kalender' && <Suspense fallback={<ViewLoader />}><LazyVerlofKalenderView users={users} leaveRequests={leaveRequests} /></Suspense>}
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
              {resolvedCurrentView === 'beheer-debug' && (
                <Suspense fallback={<ViewLoader />}>
                  <LazyDebugView currentUser={currentUser!} shifts={shifts} services={services} onSaveShifts={savePlanning} />
                </Suspense>
              )}
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
      <CommandPalette
        open={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onNavigate={(v) => { setCurrentView(v); setIsSidebarOpen(false); }}
        role={currentUser.role}
      />
    </>
  );
}




