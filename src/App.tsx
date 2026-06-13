/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Suspense, lazy, useState, useEffect, useMemo, useRef } from 'react';
import { 
  LayoutDashboard, 
  MapPin, 
  Calendar, 
  Bell, 
  LogOut, 
  Bus, 
  AlertTriangle, 





  FileText,

  Plus,
  Settings,
  Users,


  RotateCcw,
  Menu,
  X,
  Map as MapIcon,

  Search,
  Phone,
  Activity,
  KeyRound,
  Moon,
  Sun,
  ShieldCheck,
  BarChart3,
  BellRing,
  BellOff
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { Session } from '@supabase/supabase-js';
import { View, User, Shift, Update, Diversion, Service, SwapRequest, LeaveRequest, PlanningMatrixRow, PlanningCode, PlanningMatrixImportHistory, ActivityLogEntry, Role } from './types';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { cn } from './lib/ui';
import { reportHandledError, setMonitoringUser } from './lib/monitoring';
import { fetchPushPublicKey, getExistingSubscription, isPushSupported, subscribeToPush, unsubscribeFromPush } from './lib/push';
import { fetchCoverageGaps, type DayGap } from './lib/coverage';
import { addDays, isoDate } from './lib/availability';
import { ViewLoader } from './components/ui';
import { Toast, ToastStack } from './components/ToastStack';
import { OfflineBanner, InstallPrompt } from './components/PwaChrome';
import { NavItem } from './components/Navigation';
import { BottomNav } from './components/BottomNav';
import { CommandPalette, useCommandPaletteShortcut } from './components/CommandPalette';
import { ChangePasswordModal } from './components/ChangePasswordModal';
import { LoginView } from './views/LoginView';
import { ContactsView } from './views/ContactsView';
import { ServicesView } from './views/ServicesView';
import { DashboardView } from './views/DashboardView';
import { PlannerDashboardWidgets } from './views/PlannerDashboardWidgets';
import { useParallaxScroll } from './lib/interactive';
import { useRealtimeSync } from './lib/realtime';
import { DiversionsView } from './views/DiversionsView';
import { ScheduleView } from './views/ScheduleView';
import { UpdatesView } from './views/UpdatesView';
import { SwapRequestsView } from './views/SwapRequestsView';
import { ActivityLogView } from './views/admin/ActivityLogView';
import { ManageSchedulesView } from './views/admin/ManageSchedulesView';
import { PlanningMatrixView } from './views/admin/PlanningMatrixView';
import { PlanningCodesView } from './views/admin/PlanningCodesView';
import { ManageDiversionsView } from './views/admin/ManageDiversionsView';
import { ManageServicesView } from './views/admin/ManageServicesView';
import { VerlofKalenderView } from './views/admin/VerlofKalenderView';
import { RitblaadjesView } from './views/RitblaadjesView';
import { CapacityView } from './views/CapacityView';
import { CoverageView } from './views/CoverageView';
import { ComplianceView } from './views/admin/ComplianceView';
import { ReportsView } from './views/admin/ReportsView';
import { analyzeCompliance } from './lib/compliance';
const LazyDebugView = lazy(() => import('./views/admin/DebugView').then((module) => ({ default: module.DebugView })));
const LazyManageUpdatesView = lazy(() => import('./views/admin/ManageUpdatesView').then((module) => ({ default: module.ManageUpdatesView })));
const LazyManageUsersView = lazy(() => import('./views/admin/ManageUsersView').then((module) => ({ default: module.ManageUsersView })));
const LazyLeaveManagementView = lazy(() => import('./views/LeaveManagementView').then((module) => ({ default: module.LeaveManagementView })));
const LazyPrintMonthlyScheduleView = lazy(() => import('./views/PrintMonthlyScheduleView').then((module) => ({ default: module.PrintMonthlyScheduleView })));


const ALLOWED_VIEWS_BY_ROLE: Record<Role, View[]> = {
  chauffeur: ['dashboard', 'rooster', 'omleidingen', 'ritblaadjes', 'contacten', 'updates', 'ruil-verzoeken', 'bezetting', 'verlof'],
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
    'rusttijden',
    'rapportage',
    'verlof',
    'verlof-beheer',
    'verlof-kalender',
    'beheer-roosters',
    'planning-matrix',
    'planning-codes',
    'beheer-updates',
    'beheer-omleidingen',
    'beheer-dienstoverzicht',
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
    'rusttijden',
    'rapportage',
    'verlof',
    'verlof-beheer',
    'verlof-kalender',
    'beheer-roosters',
    'planning-matrix',
    'planning-codes',
    'beheer-updates',
    'beheer-omleidingen',
    'beheer-dienstoverzicht',
    'beheer-contactlijst',
    'gebruikers',
    'activiteit',
    'beheer-debug',
  ],
};




export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentView, setCurrentView] = useState<View>('dashboard');
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
  const [planningMatrixRows, setPlanningMatrixRows] = useState<PlanningMatrixRow[]>([]);
  const [planningCodes, setPlanningCodes] = useState<PlanningCode[]>([]);
  const [planningMatrixHistory, setPlanningMatrixHistory] = useState<PlanningMatrixImportHistory[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  // Dekkingsgaten (vandaag + 6 dagen = 7-daags venster) voor het Operations
  // Center van planner/admin. null = (nog) niet geladen — de cockpit toont
  // dan 'onbekend' i.p.v. een vals-groen 'volledig gedekt'.
  const [coverageDays, setCoverageDays] = useState<DayGap[] | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // Eerste data-fetch nog niet rond? Views kunnen dit gebruiken om
  // skeleton-loaders te tonen i.p.v. lege/mock-data.
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const isPasswordRecoveryRef = useRef(false);
  // Overlay-logica: meerdere fetches kunnen parallel lopen — een boolean
  // zette de overlay uit zodra de éérste klaar was. Teller fixt dat.
  const loadingCountRef = useRef(0);
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
  // Toast-ids: Date.now()+random kon botsen (dubbele keys, dismiss
  // verwijderde dan twee meldingen tegelijk).
  const toastIdRef = useRef(0);
  // Dubbele-init-guard: bootstrap én het INITIAL_SESSION/SIGNED_IN-event
  // proberen allebei te initialiseren; per gebruiker doen we het één keer.
  const initializedUserIdRef = useRef<string | null>(null);
  const setRecoveryMode = (v: boolean) => {
    isPasswordRecoveryRef.current = v;
    setIsPasswordRecovery(v);
  };

  // Parallax-scroll: schrijft --scroll-y CSS-var voor de fixed bg-blobs
  useParallaxScroll();

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
    refetchPlanning: () => {
      // Chauffeur krijgt enkel eigen shifts (zelfde filter als initial)
      const planningFilter = currentUser?.role === 'chauffeur'
        ? { driverId: String(currentUser.id) }
        : undefined;
      fetchPlanning(undefined, planningFilter, { silent: true });
      // Dekking beweegt mee met de planning (Operations Center).
      if (currentUser && currentUser.role !== 'chauffeur') {
        refreshCoverageGaps();
      }
    },
  });

  // Initialize theme from localStorage. Eerste-bezoek default = LIGHT
  // (geen system-preference fallback meer — gebruikers die dark willen
  // klikken zelf de toggle).
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = typeof window !== 'undefined' ? window.localStorage.getItem('vhb-theme') : null;
    } catch {
      // localStorage geblokkeerd (privacy-modus) — val terug op licht.
    }
    const initial: 'light' | 'dark' = stored === 'dark' || stored === 'light' ? stored : 'light';
    setTheme(initial);
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', initial === 'dark');
    }
  }, []);

  // Push-notificaties: key=null betekent dat de server geen VAPID-keys heeft
  // (feature uit) — de knop verschijnt dan niet.
  const [pushPublicKey, setPushPublicKey] = useState<string | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);

  useEffect(() => {
    if (!currentUser || !session?.access_token || !isPushSupported()) return;
    let cancelled = false;
    (async () => {
      const key = await fetchPushPublicKey({ Authorization: `Bearer ${session.access_token}` });
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
    const headers = { Authorization: `Bearer ${session.access_token}` };
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
      }
      return next;
    });
  };

  const dismissToast = (id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  };

  const showToast = (message: string, tone: Toast['tone'] = 'info') => {
    // Elke fout-toast is een gebroken flow — meld die ook aan de monitoring,
    // anders blijven afgehandelde fouten (catch-blokken) onzichtbaar.
    if (tone === 'error') reportHandledError(message);
    const id = ++toastIdRef.current;
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4200);
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
        await initializeAuthenticatedApp(nextSession.access_token, nextSession.user.id);
      } else {
        setRecoveryMode(false);
        setCurrentUser(null);
        setMonitoringUser(null);
        initializedUserIdRef.current = null;
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

  useEffect(() => {
    if (currentView === 'activiteit' && currentUser?.role === 'admin') {
      fetchActivityLog();
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

  const apiFetch = async (url: string, init: RequestInit = {}, accessToken = session?.access_token) => {
    const headers = new Headers(init.headers || {});
    if (!headers.has('Content-Type') && init.body) {
      headers.set('Content-Type', 'application/json');
    }
    if (accessToken) {
      headers.set('Authorization', `Bearer ${accessToken}`);
    }

    const response = await fetch(url, { ...init, headers });
    if (response.status === 401 || response.status === 403) {
      throw new Error('Je sessie is verlopen of je hebt geen toegang.');
    }
    return response;
  };

  const fetchCurrentUser = async (accessToken = session?.access_token) => {
    const response = await apiFetch('/api/me', {}, accessToken);
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
        fetchServices(accessToken),
        fetchUpdates(accessToken),
        fetchSwaps(accessToken),
        fetchLeave(accessToken),
        ...(appUser.role === 'planner' || appUser.role === 'admin' ? [fetchPlanningMatrix(accessToken)] : []),
        ...(appUser.role === 'planner' || appUser.role === 'admin' ? [fetchPlanningCodes(accessToken)] : []),
        ...(appUser.role === 'planner' || appUser.role === 'admin' ? [fetchPlanningMatrixHistory(accessToken)] : []),
        ...(appUser.role === 'planner' || appUser.role === 'admin' ? [refreshCoverageGaps()] : []),
        ...(appUser.role === 'admin' ? [fetchActivityLog(accessToken)] : []),
      ]);
    } catch (error) {
      console.error('Error loading app data:', error);
      showToast('Kon de gegevens niet laden. Controleer je verbinding en vernieuw.', 'error');
    } finally {
      setIsInitialLoad(false);
    }
  };

  const initializeAuthenticatedApp = async (accessToken: string, authUserId?: string) => {
    // Progressieve boot: alleen het profiel (één snelle call) blokkeert de
    // eerste render; alle overige data streamt op de achtergrond binnen.
    if (authUserId) {
      if (initializedUserIdRef.current === authUserId) return;
      initializedUserIdRef.current = authUserId;
    }
    try {
      const appUser = await fetchCurrentUser(accessToken);
      void loadAppData(appUser, accessToken);
    } catch (error) {
      console.error('Error initializing app:', error);
      setIsInitialLoad(false);
      showToast('Kon je profiel niet laden. Vernieuw de pagina of log opnieuw in.', 'error');
    }
  };

  const fetchUpdates = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/updates', {}, accessToken);
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setUpdates(data);
        markCollectionLoaded('updates');
      }
    } catch (error) {
      console.error('Error fetching updates:', error);
      showToast('Kon de updates niet laden.', 'error');
    }
  };

  const saveUpdates = async (newUpdates: Update[]) => {
    if (!guardCollectionLoaded('updates', 'De updates zijn')) return false;
    try {
      const response = await apiFetch('/api/updates', {
        method: 'POST',
        body: JSON.stringify(newUpdates),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.details || data?.error || 'Opslaan mislukt.');
      }
      setUpdates(newUpdates);
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
        showToast(data.mocked ? `E-mail gelogd: ${data.message}` : 'E-mails succesvol verzonden naar alle chauffeurs!', 'success');
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
      const response = await apiFetch('/api/swaps', {}, accessToken);
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setSwaps(data);
        markCollectionLoaded('swaps');
      }
    } catch (error) {
      console.error('Error fetching swaps:', error);
      showToast('Kon de dienstruilen niet laden.', 'error');
    }
  };

  const saveSwaps = async (newSwaps: SwapRequest[]) => {
    if (!guardCollectionLoaded('swaps', 'De dienstruilen zijn')) return;
    try {
      const response = await apiFetch('/api/swaps', {
        method: 'POST',
        body: JSON.stringify(newSwaps),
      });
      if (response.ok) {
        setSwaps(newSwaps);
        if (currentUser?.role === 'admin') {
          await fetchActivityLog();
        }
        showToast('Dienstruil bijgewerkt.', 'success');
      } else {
        const err = await response.json().catch(() => ({} as any));
        showToast(err.error || 'Opslaan van dienstruilen is mislukt.', 'error');
      }
    } catch (error) {
      console.error('Error saving swaps:', error);
      showToast('Opslaan van dienstruilen is mislukt.', 'error');
    }
  };

  const fetchLeave = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/leave', {}, accessToken);
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setLeaveRequests(data);
        markCollectionLoaded('leave');
      }
    } catch (error) {
      console.error('Error fetching leave:', error);
      showToast('Kon de verlofaanvragen niet laden.', 'error');
    }
  };

  const fetchPlanningMatrix = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/planning-matrix', {}, accessToken);
      const data = await response.json();
      if (data && Array.isArray(data)) setPlanningMatrixRows(data);
    } catch (error) {
      console.error('Error fetching planning matrix:', error);
    }
  };

  const fetchPlanningCodes = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/planning-codes', {}, accessToken);
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setPlanningCodes(data);
        markCollectionLoaded('planningCodes');
      }
    } catch (error) {
      console.error('Error fetching planning codes:', error);
    }
  };

  const fetchPlanningMatrixHistory = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/planning-matrix/history', {}, accessToken);
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
      const response = await apiFetch('/api/activity', {}, accessToken);
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setActivityLog(data);
      }
    } catch (error) {
      console.error('Error fetching activity log:', error);
    }
  };

  const savePlanningCodes = async (newCodes: PlanningCode[]) => {
    if (!guardCollectionLoaded('planningCodes', 'De planningscodes zijn')) return false;
    try {
      beginLoading();
      const response = await apiFetch('/api/planning-codes', {
        method: 'POST',
        body: JSON.stringify(newCodes),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.details || data?.error || 'Opslaan mislukt.');
      }
      setPlanningCodes(newCodes);
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
  const complianceViolations = useMemo(
    () => (currentUser && currentUser.role !== 'chauffeur' ? analyzeCompliance(shifts).violations : 0),
    [shifts, currentUser?.role],
  );

  // Wachtende beslissingen voor planner/admin (sidebar badges op
  // Verlofbeheer en Dienstruil-tab).
  const pendingLeaveCount = leaveRequests.filter((r) => r.status === 'pending').length;
  // Zelfde definitie als de cockpit: 'accepted' wacht óók op de planner
  // (validatie), dus telt mee als open werkvoorraad.
  const pendingSwapsCount = swaps.filter((s) => s.status === 'pending' || s.status === 'accepted').length;

  const saveLeave = async (newLeave: LeaveRequest[]) => {
    if (!guardCollectionLoaded('leave', 'De verlofaanvragen zijn')) return;
    try {
      const response = await apiFetch('/api/leave', {
        method: 'POST',
        body: JSON.stringify(newLeave),
      });
      if (response.ok) {
        setLeaveRequests(newLeave);
        if (currentUser?.role === 'admin') {
          await fetchActivityLog();
        }
        showToast('Verlofaanvraag bijgewerkt.', 'success');
      } else {
        const err = await response.json().catch(() => ({} as any));
        showToast(err.details || err.error || 'Opslaan van verlofaanvragen is mislukt.', 'error');
      }
    } catch (error) {
      console.error('Error saving leave:', error);
      showToast('Opslaan van verlofaanvragen is mislukt.', 'error');
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

  const decideLeave = (id: string, status: LeaveRequest['status']): Promise<boolean> => {
    const current = leaveRequests.find((r) => r.id === id);
    return decideViaPatch('leave', id, status, current?.status, fetchLeave, (updated) => {
      setLeaveRequests((curr) => curr.map((r) => (r.id === id ? { ...r, ...updated } : r)));
    });
  };

  const decideSwap = (id: string, status: SwapRequest['status']): Promise<boolean> => {
    const current = swaps.find((s) => s.id === id);
    return decideViaPatch('swaps', id, status, current?.status, fetchSwaps, (updated) => {
      setSwaps((curr) => curr.map((s) => (s.id === id ? { ...s, ...updated } : s)));
    });
  };

  const fetchServices = async (accessToken = session?.access_token) => {
    try {
      beginLoading();
      const response = await apiFetch('/api/services', {}, accessToken);
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setServices(data);
        markCollectionLoaded('services');
      }
    } catch (error) {
      console.error('Error fetching services:', error);
      showToast('Kon het dienstoverzicht niet laden.', 'error');
    } finally {
      endLoading();
    }
  };

  const saveServices = async (newServices: Service[], opts?: { bulkReplace?: boolean }) => {
    if (!guardCollectionLoaded('services', 'Het dienstoverzicht is')) return;
    try {
      beginLoading();
      const response = await apiFetch('/api/services', {
        method: 'POST',
        // Import vervangt legitiem de hele collectie; de header laat de
        // server z'n bulk-wipe-vangrail voor deze save overslaan.
        headers: opts?.bulkReplace ? { 'x-bulk-replace': '1' } : undefined,
        body: JSON.stringify(newServices),
      });
      if (response.ok) {
        setServices(newServices);
        if (currentUser?.role === 'admin') {
          await fetchActivityLog();
        }
        showToast('Diensten succesvol opgeslagen.', 'success');
      } else {
        const err = await response.json().catch(() => ({} as any));
        showToast(err.details || err.error || 'Opslaan van diensten is mislukt.', 'error');
      }
    } catch (error) {
      console.error('Error saving services:', error);
      showToast('Opslaan van diensten is mislukt.', 'error');
    } finally {
      endLoading();
    }
  };

  const fetchUsers = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/users', {}, accessToken);
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setUsers(data);
        markCollectionLoaded('users');
      }
    } catch (error) {
      console.error('Error fetching users:', error);
      showToast('Kon de gebruikerslijst niet laden.', 'error');
    }
  };

  const saveUsers = async (newUsers: Array<User & { password?: string }>) => {
    if (!guardCollectionLoaded('users', 'De gebruikerslijst is')) return false;
    try {
      beginLoading();
      const response = await apiFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify(newUsers),
      });
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
      const response = await apiFetch(url, {}, accessToken);
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
      showToast('Kon de planning niet laden. Probeer te vernieuwen.', 'error');
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
        body: JSON.stringify(newShifts),
      });
      if (response.ok) {
        setShifts(newShifts);
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
      const response = await apiFetch('/api/diversions', {}, accessToken);
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setDiversions(data);
        markCollectionLoaded('diversions');
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
        body: JSON.stringify(newDiversions),
      });
      if (response.ok) {
        setDiversions(newDiversions);
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
    }, token);
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
      await supabase?.auth.signOut();
      setSession(null);
      setCurrentUser(null);
      setMonitoringUser(null);
      initializedUserIdRef.current = null;
    }
  };

  if (!authReady) {
    return (
      <div className="login-bg-light min-h-screen flex flex-col items-center justify-center gap-5">
        <img src="/vhb-logo.svg" alt="VHB — Van Hoorebeke & Zoon" className="h-14 w-auto select-none" draggable={false} />
        <div className="flex items-center gap-2.5 text-slate-500">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-oker-500" />
          <span className="text-[13px] font-medium">Sessie laden…</span>
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
    const driver = users.find((u) => String(u.id) === String(printDriverId)) || null;
    return (
      <Suspense fallback={<div className="min-h-screen bg-white flex items-center justify-center text-slate-500">Print-weergave laden…</div>}>
        <LazyPrintMonthlyScheduleView driver={driver} monthIso={printMonth} shifts={shifts} />
      </Suspense>
    );
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


  if (!currentUser) {
    // Wél een sessie maar (nog) geen profiel: toon een laadscherm met
    // retry i.p.v. het loginformulier aan een al-ingelogde gebruiker
    // (de 8s-watchdog kon hier anders een login-flits veroorzaken).
    if (session) {
      return (
        <div className="login-bg-light min-h-screen flex flex-col items-center justify-center gap-5">
          <img src="/vhb-logo.svg" alt="VHB — Van Hoorebeke & Zoon" className="h-14 w-auto select-none" draggable={false} />
          <div className="flex items-center gap-2.5 text-slate-500">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-oker-500" />
            <span className="text-[13px] font-medium">Profiel laden…</span>
          </div>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors"
          >
            Duurt het te lang? Vernieuw de pagina
          </button>
        </div>
      );
    }
    return <LoginView onLogin={handleLogin} />;
  }

  const isPlanner = currentUser.role === 'planner' || currentUser.role === 'admin';
  const isAdmin = currentUser.role === 'admin';
  const allowedViews = ALLOWED_VIEWS_BY_ROLE[currentUser.role] || ['dashboard'];
  const resolvedCurrentView = allowedViews.includes(currentView) ? currentView : 'dashboard';
  const viewMeta: Record<string, { title: string; subtitle: string }> = {
    dashboard: { title: 'Dashboard', subtitle: 'Overzicht van planning, updates en operationele status.' },
    omleidingen: { title: 'Omleidingen', subtitle: 'Actuele hinder en routewijzigingen voor chauffeurs.' },
    rooster: { title: 'Mijn Rooster', subtitle: 'Je komende diensten en export naar agenda.' },
    dienstoverzicht: { title: 'Dienstoverzicht', subtitle: 'Alle diensten, uren en blokken in een compact overzicht.' },
    ritblaadjes: { title: 'Ritblaadjes', subtitle: 'Actuele rit-informatie als PDF voor alle chauffeurs.' },
    contacten: { title: 'Contactlijst', subtitle: 'Bereik collega’s en planners sneller vanuit een centrale lijst.' },
    updates: { title: 'Updates', subtitle: 'Nieuws, veiligheidsmeldingen en technische mededelingen.' },
    'ruil-verzoeken': { title: 'Dienstruil', subtitle: 'Beheer openstaande dienstruilen en aanbiedingen.' },
    bezetting: { title: 'Maandrooster', subtitle: 'Wie rijdt welke dienst en wie heeft verlof — handig voor wissels.' },
    dekking: { title: 'Openstaande diensten', subtitle: 'Niet-ingevulde diensten per dag t.o.v. de verwachte diensten.' },
    verlof: { title: 'Verlof', subtitle: 'Vraag verlof aan en volg je aanvragen op.' },
    'verlof-beheer': { title: 'Verlofbeheer', subtitle: 'Bekijk aanvragen en beheer afwezigheden per dag.' },
    'verlof-kalender': { title: 'Verlof-kalender', subtitle: 'Maandoverzicht van alle afwezigheden in één tabel.' },
    'beheer-roosters': { title: 'Beheer Roosters', subtitle: 'Importeer, synchroniseer en beheer planning centraal.' },
    'planning-matrix': { title: 'Planning Overzicht', subtitle: 'Controleer de actuele geüploade matrixplanning per dag en chauffeur.' },
    'planning-codes': { title: 'Planningscodes', subtitle: 'Beheer de betekenis van matrixcodes zonder SQL of handmatige scripts.' },
    activiteit: { title: 'Activiteit', subtitle: 'Recente beheeracties en wijzigingen in het portaal.' },
    'beheer-updates': { title: 'Beheer Updates', subtitle: 'Publiceer, controleer en verwijder updates en dringende meldingen.' },
    gebruikers: { title: 'Gebruikers', subtitle: 'Beheer accounts, rollen en toegangsrechten.' },
    'beheer-omleidingen': { title: 'Beheer Omleidingen', subtitle: 'Voeg routewijzigingen en bijlagen toe voor chauffeurs.' },
    'beheer-dienstoverzicht': { title: 'Beheer Dienstoverzicht', subtitle: 'Onderhoud het dienstschema en importeer uit Excel.' },
    'beheer-contactlijst': { title: 'Beheer Contactlijst', subtitle: 'Werk medewerkers, rollen en gegevens bij.' },
    'beheer-debug': { title: 'Systeem Status', subtitle: 'Controleer koppelingen, tabellen en health checks.' },
  };
  const currentMeta = viewMeta[resolvedCurrentView] || { title: 'VHB Portaal', subtitle: 'Interne operationele omgeving.' };
  const userInitials = currentUser.name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 2)
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
      <AnimatePresence>
        {isLoading && !isInitialLoad && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/20 backdrop-blur-[2px]"
          >
            <div className="rounded-2xl border border-slate-200/80 bg-white/95 px-5 py-4 shadow-xl">
              <div className="flex items-center gap-4">
                <div className="h-7 w-7 animate-spin rounded-full border-[3px] border-slate-200 border-t-oker-500" />
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-slate-400">Bezig</p>
                  <p className="text-sm font-semibold text-slate-800">Gegevens verwerken...</p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex h-screen w-full bg-transparent text-slate-900 font-sans overflow-hidden">
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
        className={cn(
          "fixed inset-y-0 left-0 w-[17rem] max-w-[80vw] panel-dark flex flex-col z-50 transition-transform duration-500 transform lg:w-[17.5rem] lg:max-w-none lg:relative lg:translate-x-0",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
        style={{ transitionTimingFunction: 'cubic-bezier(0.34, 1.28, 0.64, 1)' }}
      >
        <div className="shrink-0 px-5 pt-5 pb-4 flex items-center justify-center relative text-center">
          <button
            type="button"
            onClick={() => { setCurrentView('dashboard'); setIsSidebarOpen(false); }}
            className="rounded-xl py-1 px-2 transition-all active:scale-[0.98] hover:opacity-80"
            title="Naar dashboard"
          >
            {/* Officieel VHB-logo (huisstijl): zwartetekst op licht,
                wittekst in dark mode. Strak bijgesneden SVG, ratio ~2.15. */}
            <img
              src="/vhb-logo.svg"
              alt="VHB — Van Hoorebeke & Zoon"
              className="h-16 w-auto mx-auto select-none block dark:hidden"
              draggable={false}
            />
            <img
              src="/vhb-logo-wit.svg"
              alt="VHB — Van Hoorebeke & Zoon"
              className="h-16 w-auto mx-auto select-none hidden dark:block"
              draggable={false}
            />
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
          <NavItem 
            icon={<LayoutDashboard size={18} />} 
            label="Dashboard" 
            active={currentView === 'dashboard'} 
            onClick={() => { setCurrentView('dashboard'); setIsSidebarOpen(false); }} 
          />
          <NavItem 
            icon={<Calendar size={18} />} 
            label="Mijn Rooster" 
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
            label="Ritblaadjes"
            active={currentView === 'ritblaadjes'}
            onClick={() => { setCurrentView('ritblaadjes'); setIsSidebarOpen(false); }}
          />
          <NavItem
            icon={<Phone size={18} />}
            label="Contactlijst"
            active={currentView === 'contacten'}
            onClick={() => { setCurrentView('contacten'); setIsSidebarOpen(false); }}
          />
          <NavItem 
            icon={<Bell size={18} />} 
            label="Updates" 
            active={currentView === 'updates'} 
            onClick={() => { setCurrentView('updates'); setIsSidebarOpen(false); }} 
          />
          <NavItem
            icon={<RotateCcw size={18} />}
            label="Dienstruil"
            active={currentView === 'ruil-verzoeken'}
            onClick={() => { setCurrentView('ruil-verzoeken'); setIsSidebarOpen(false); }}
            badge={isPlanner ? pendingSwapsCount : undefined}
          />
          <NavItem
            icon={<Users size={18} />}
            label="Maandrooster"
            active={currentView === 'bezetting'}
            onClick={() => { setCurrentView('bezetting'); setIsSidebarOpen(false); }}
          />
          <NavItem
            icon={<Calendar size={18} />}
            label="Verlof"
            active={currentView === 'verlof'}
            onClick={() => { setCurrentView('verlof'); setIsSidebarOpen(false); }}
            badge={unseenLeaveDecisionCount}
          />

          {isPlanner && (
            <>
              <div className="mt-6 mb-1.5 px-3 text-[10px] font-semibold text-slate-400 uppercase tracking-[0.08em]">Beheer</div>
              <NavItem
                icon={<AlertTriangle size={18} />}
                label="Openstaande diensten"
                active={currentView === 'dekking'}
                onClick={() => { setCurrentView('dekking'); setIsSidebarOpen(false); }}
              />
              <NavItem
                icon={<ShieldCheck size={18} />}
                label="Rij- & rusttijden"
                active={currentView === 'rusttijden'}
                onClick={() => { setCurrentView('rusttijden'); setIsSidebarOpen(false); }}
                badge={complianceViolations}
              />
              <NavItem
                icon={<BarChart3 size={18} />}
                label="Rapportage"
                active={currentView === 'rapportage'}
                onClick={() => { setCurrentView('rapportage'); setIsSidebarOpen(false); }}
              />
              <NavItem
                icon={<Calendar size={18} />}
                label="Verlofbeheer"
                active={currentView === 'verlof-beheer'}
                onClick={() => { setCurrentView('verlof-beheer'); setIsSidebarOpen(false); }}
                badge={pendingLeaveCount}
              />
              <NavItem
                icon={<Calendar size={18} />}
                label="Verlof-kalender"
                active={currentView === 'verlof-kalender'}
                onClick={() => { setCurrentView('verlof-kalender'); setIsSidebarOpen(false); }}
              />
              <NavItem 
                icon={<Settings size={18} />} 
                label="Beheer Roosters" 
                active={currentView === 'beheer-roosters'} 
                onClick={() => { setCurrentView('beheer-roosters'); setIsSidebarOpen(false); }} 
              />
              <NavItem 
                icon={<FileText size={18} />} 
                label="Planning Overzicht" 
                active={currentView === 'planning-matrix'} 
                onClick={() => { setCurrentView('planning-matrix'); setIsSidebarOpen(false); }} 
              />
              <NavItem 
                icon={<Settings size={18} />} 
                label="Planningscodes" 
                active={currentView === 'planning-codes'} 
                onClick={() => { setCurrentView('planning-codes'); setIsSidebarOpen(false); }} 
              />
              <NavItem 
                icon={<Plus size={18} />} 
                label="Beheer Updates" 
                active={currentView === 'beheer-updates'} 
                onClick={() => { setCurrentView('beheer-updates'); setIsSidebarOpen(false); }} 
              />
              <NavItem 
                icon={<MapIcon size={18} />} 
                label="Beheer Omleidingen" 
                active={currentView === 'beheer-omleidingen'} 
                onClick={() => { setCurrentView('beheer-omleidingen'); setIsSidebarOpen(false); }} 
              />
              <NavItem
                icon={<Bus size={18} />}
                label="Dienstoverzicht"
                active={currentView === 'dienstoverzicht'}
                onClick={() => { setCurrentView('dienstoverzicht'); setIsSidebarOpen(false); }}
              />
              <NavItem
                icon={<Bus size={18} />}
                label="Beheer Dienstoverzicht"
                active={currentView === 'beheer-dienstoverzicht'}
                onClick={() => { setCurrentView('beheer-dienstoverzicht'); setIsSidebarOpen(false); }}
              />
            </>
          )}

          {isAdmin && (
            <>
              <div className="mt-6 mb-1.5 px-3 text-[10px] font-semibold text-slate-400 uppercase tracking-[0.08em]">Admin</div>
              <NavItem 
                icon={<Users size={18} />} 
                label="Gebruikers" 
                active={currentView === 'gebruikers'} 
                onClick={() => { setCurrentView('gebruikers'); setIsSidebarOpen(false); }} 
              />
              <NavItem 
                icon={<Activity size={18} />} 
                label="Activiteit" 
                active={currentView === 'activiteit'} 
                onClick={() => { setCurrentView('activiteit'); setIsSidebarOpen(false); }} 
              />
              <NavItem 
                icon={<Activity size={18} />} 
                label="Systeem Status" 
                active={currentView === 'beheer-debug'} 
                onClick={() => { setCurrentView('beheer-debug'); setIsSidebarOpen(false); }} 
              />
            </>
          )}
        </nav>

        <div className="shrink-0 p-3 border-t fine-divider space-y-0.5">
          {/* User profile card */}
          <div className="flex items-center gap-2.5 px-3 py-2 mb-1.5 rounded-xl bg-slate-100/60">
            <div className="w-8 h-8 rounded-lg bg-oker-100 flex items-center justify-center text-oker-700 shrink-0 text-[11px] font-bold">
              {userInitials}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-semibold text-slate-800 truncate leading-tight">{currentUser.name}</p>
              <p className="text-[10px] text-slate-500 font-medium uppercase tracking-[0.08em]">{currentUser.role}</p>
            </div>
          </div>
          <button
            onClick={toggleTheme}
            className="flex items-center gap-3 w-full px-3 py-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 rounded-xl transition-colors duration-150 font-medium text-[13px]"
          >
            <span className="text-slate-400 shrink-0">
              {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            </span>
            <span>{theme === 'light' ? 'Donkere modus' : 'Lichte modus'}</span>
          </button>
          {pushPublicKey && isPushSupported() && (
            <button
              onClick={togglePush}
              className="flex items-center gap-3 w-full px-3 py-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 rounded-xl transition-colors duration-150 font-medium text-[13px]"
            >
              <span className="text-slate-400 shrink-0">
                {pushEnabled ? <BellOff size={16} /> : <BellRing size={16} />}
              </span>
              <span>{pushEnabled ? 'Meldingen uitschakelen' : 'Meldingen inschakelen'}</span>
            </button>
          )}
          <button
            onClick={() => setShowChangePassword(true)}
            className="flex items-center gap-3 w-full px-3 py-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 rounded-xl transition-colors duration-150 font-medium text-[13px]"
          >
            <span className="text-slate-400 shrink-0">
              <KeyRound size={16} />
            </span>
            <span>Wachtwoord wijzigen</span>
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2 text-slate-600 hover:text-red-600 hover:bg-red-50/70 rounded-xl transition-colors duration-150 font-medium text-[13px]"
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
        <div
          className="flex-1 w-full min-w-0 overflow-y-auto overflow-x-hidden px-4 md:px-7 pb-[calc(7rem+env(safe-area-inset-bottom))] lg:pb-8"
          onScroll={(e) => {
            const top = e.currentTarget.scrollTop ?? 0;
            const next = top > 8;
            setIsScrolled((current) => (current === next ? current : next));
            // Parallax-laag: het window scrolt nooit (interne container),
            // dus de --scroll-y-var moet hiér gezet worden.
            document.documentElement.style.setProperty('--scroll-y', `${top}px`);
          }}
        >
          {/* Sticky topbar — full-width werkbalk met haarlijn-onderrand */}
          <div className="sticky top-0 z-30 -mx-4 md:-mx-7 mb-5">
            <header className={cn("topbar px-4 md:px-7", isScrolled && "topbar--scrolled")}>
              <div className="mx-auto flex w-full max-w-[1360px] items-center justify-between gap-3 py-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    onClick={() => setIsSidebarOpen(true)}
                    aria-label="Menu openen"
                    className="p-2 -ml-1 text-slate-500 hover:bg-slate-100/80 hover:text-slate-800 rounded-lg lg:hidden transition-colors"
                  >
                    <Menu size={18} />
                  </button>
                  <div className="min-w-0">
                    <h2 className="text-[15px] font-bold tracking-tight text-slate-900 leading-tight truncate">
                      {currentMeta.title}
                    </h2>
                    <p className="hidden md:block text-[11.5px] font-normal text-slate-500 mt-px max-w-xl truncate">{currentMeta.subtitle}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => setIsCommandPaletteOpen(true)}
                    className="hidden md:flex items-center gap-2 rounded-lg border border-slate-200/90 bg-white/70 pl-2.5 pr-1.5 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 hover:border-slate-300 transition-colors"
                  >
                    <Search size={13} />
                    <span>Zoeken</span>
                    <kbd className="rounded-[5px] border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">⌘K</kbd>
                  </button>
                  <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-50/80 border border-emerald-100">
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    <p className="text-[11px] font-semibold text-emerald-700">Online</p>
                  </div>
                  <div className="hidden sm:flex items-center gap-2.5 pl-3 border-l border-slate-200/80">
                    <div className="w-8 h-8 bg-oker-100 rounded-lg flex items-center justify-center text-oker-700 text-[11px] font-bold">
                      {userInitials}
                    </div>
                    <div className="text-left">
                      <p className="text-[13px] font-semibold text-slate-800 leading-tight">{currentUser.name}</p>
                      <p className="text-[10px] text-slate-400 font-medium uppercase tracking-[0.08em]">{currentUser.role}</p>
                    </div>
                  </div>
                </div>
              </div>
            </header>
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={resolvedCurrentView}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
              className="mx-auto w-full max-w-[1360px]"
            >
              {resolvedCurrentView === 'dashboard' && (
                isPlanner ? (
                  /* Planner/admin: Operations Center — één operationele cockpit
                     i.p.v. een dubbel dashboard. */
                  <PlannerDashboardWidgets
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
                    isInitialLoad={isInitialLoad}
                  />
                ) : (
                  <DashboardView user={currentUser!} shifts={shifts} diversions={diversions} users={users} leaveRequests={leaveRequests} isInitialLoad={isInitialLoad} onNavigate={setCurrentView} />
                )
              )}
              {resolvedCurrentView === 'omleidingen' && <DiversionsView diversions={diversions} />}
              {resolvedCurrentView === 'rooster' && <ScheduleView user={currentUser!} shifts={shifts} users={users} leaveRequests={leaveRequests} isInitialLoad={isInitialLoad} />}
              {resolvedCurrentView === 'dienstoverzicht' && <ServicesView services={services} />}
              {resolvedCurrentView === 'ritblaadjes' && <RitblaadjesView currentUser={currentUser!} />}
              {resolvedCurrentView === 'updates' && <UpdatesView updates={updates} />}
              {resolvedCurrentView === 'contacten' && <ContactsView users={users} currentUser={currentUser!} />}
              {resolvedCurrentView === 'beheer-roosters' && <ManageSchedulesView shifts={shifts} onSave={savePlanning} users={users} history={planningMatrixHistory} canAdminOverride={isAdmin} onMatrixImported={async () => {
                await Promise.all([
                  fetchPlanningMatrix(),
                  fetchPlanning(),
                  fetchPlanningMatrixHistory(),
                  refreshCoverageGaps(),
                  ...(currentUser?.role === 'admin' ? [fetchActivityLog()] : []),
                ]);
              }} />}
              {resolvedCurrentView === 'planning-matrix' && (
                <PlanningMatrixView
                  rows={planningMatrixRows}
                  services={services}
                  planningCodes={planningCodes}
                  users={users}
                  canOpenUserManagement={isAdmin}
                  onOpenPlanningCodes={() => setCurrentView('planning-codes')}
                  onOpenServiceOverview={() => setCurrentView('beheer-dienstoverzicht')}
                  onOpenUserManagement={() => setCurrentView('gebruikers')}
                />
              )}
              {resolvedCurrentView === 'planning-codes' && <PlanningCodesView codes={planningCodes} onSave={savePlanningCodes} canAdminDelete={isAdmin} />}
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
              {resolvedCurrentView === 'activiteit' && <ActivityLogView entries={activityLog} />}
              {resolvedCurrentView === 'beheer-omleidingen' && <ManageDiversionsView diversions={diversions} onSave={saveDiversions} />}
              {resolvedCurrentView === 'beheer-dienstoverzicht' && <ManageServicesView services={services} onSave={saveServices} canAdminOverride={isAdmin} />}
              {resolvedCurrentView === 'beheer-contactlijst' && (
                <Suspense fallback={<ViewLoader />}>
                  <LazyManageUsersView users={users} onSave={saveUsers} title="Beheer Contactlijst" currentUser={currentUser!} shifts={shifts} leaveRequests={leaveRequests} swaps={swaps} />
                </Suspense>
              )}
              {resolvedCurrentView === 'ruil-verzoeken' && <SwapRequestsView user={currentUser} swaps={swaps} shifts={shifts} users={users} onSave={saveSwaps} onDecide={decideSwap} />}
              {resolvedCurrentView === 'bezetting' && <CapacityView currentUser={currentUser!} />}
              {resolvedCurrentView === 'dekking' && <CoverageView />}
              {resolvedCurrentView === 'rusttijden' && <ComplianceView shifts={shifts} users={users} />}
              {resolvedCurrentView === 'rapportage' && <ReportsView shifts={shifts} leaveRequests={leaveRequests} users={users} />}
              {resolvedCurrentView === 'verlof-kalender' && <VerlofKalenderView users={users} leaveRequests={leaveRequests} />}
              {(resolvedCurrentView === 'verlof' || resolvedCurrentView === 'verlof-beheer') && (
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
              )}
              {resolvedCurrentView === 'beheer-debug' && (
                <Suspense fallback={<ViewLoader />}>
                  <LazyDebugView currentUser={currentUser!} shifts={shifts} services={services} onSaveShifts={savePlanning} />
                </Suspense>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
      </div>

      {/* Mobile bottom-nav (alleen op klein scherm, alleen voor ingelogde gebruikers) */}
      <BottomNav
        currentView={resolvedCurrentView}
        onSelect={(v) => { setCurrentView(v); setIsSidebarOpen(false); }}
        unseenLeaveCount={unseenLeaveDecisionCount}
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




