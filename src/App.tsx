/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, lazy, useState, useEffect, useDeferredValue, useMemo, useRef } from 'react';
import { 
  LayoutDashboard, 
  MapPin, 
  Calendar, 
  Bell, 
  LogOut, 
  Bus, 
  AlertTriangle, 
  Clock, 
  ChevronRight,
  ChevronUp,
  ChevronDown,
  User as UserIcon,
  Info,
  FileText,
  Download,
  Plus,
  Settings,
  Users,
  Upload,
  Trash2,
  RotateCcw,
  Menu,
  X,
  Map as MapIcon,
  Pencil,
  Search,
  Phone,
  Activity,
  KeyRound,
  Moon,
  Sun
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { Session } from '@supabase/supabase-js';
import { View, User, Shift, Update, Diversion, Service, SwapRequest, LeaveRequest, PlanningMatrixRow, PlanningCode, PlanningMatrixImportHistory, ActivityLogEntry, Role } from './types';
import { MOCK_DIVERSIONS, MOCK_SHIFTS, MOCK_UPDATES, MOCK_USERS, MOCK_SERVICES } from './constants';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { cn, getSupabaseAuthHeaders, notify } from './lib/ui';
import { AdminPageHeader, AdminSubsectionHeader, ConfirmationModal, EmptyState, ViewLoader } from './components/ui';
import { Toast, ToastStack } from './components/ToastStack';
import { MobileNavItem, NavItem } from './components/Navigation';
import { Input } from './components/Input';
import { StatCard } from './components/StatCard';
import { ChangePasswordModal } from './components/ChangePasswordModal';
import { LoginView } from './views/LoginView';
import { ContactsView } from './views/ContactsView';
import { ServicesView } from './views/ServicesView';
import { DashboardView } from './views/DashboardView';
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
import { RitblaadjesView } from './views/RitblaadjesView';
const LazyDebugView = lazy(() => import('./views/admin/DebugView').then((module) => ({ default: module.DebugView })));
const LazyManageUpdatesView = lazy(() => import('./views/admin/ManageUpdatesView').then((module) => ({ default: module.ManageUpdatesView })));
const LazyManageUsersView = lazy(() => import('./views/admin/ManageUsersView').then((module) => ({ default: module.ManageUsersView })));
const LazyLeaveManagementView = lazy(() => import('./views/LeaveManagementView').then((module) => ({ default: module.LeaveManagementView })));


const ALLOWED_VIEWS_BY_ROLE: Record<Role, View[]> = {
  chauffeur: ['dashboard', 'rooster', 'omleidingen', 'ritblaadjes', 'contacten', 'updates', 'ruil-verzoeken', 'verlof'],
  planner: [
    'dashboard',
    'rooster',
    'omleidingen',
    'dienstoverzicht',
    'ritblaadjes',
    'contacten',
    'updates',
    'ruil-verzoeken',
    'verlof',
    'verlof-beheer',
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
    'verlof',
    'verlof-beheer',
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
  const [shifts, setShifts] = useState<Shift[]>(MOCK_SHIFTS);
  const [users, setUsers] = useState<User[]>(MOCK_USERS);
  const [diversions, setDiversions] = useState<Diversion[]>(MOCK_DIVERSIONS);
  const [services, setServices] = useState<Service[]>(MOCK_SERVICES);
  const [updates, setUpdates] = useState<Update[]>(MOCK_UPDATES);
  const [swaps, setSwaps] = useState<SwapRequest[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [lastSeenLeaveDecisionAt, setLastSeenLeaveDecisionAt] = useState<string | null>(null);
  const [planningMatrixRows, setPlanningMatrixRows] = useState<PlanningMatrixRow[]>([]);
  const [planningCodes, setPlanningCodes] = useState<PlanningCode[]>([]);
  const [planningMatrixHistory, setPlanningMatrixHistory] = useState<PlanningMatrixImportHistory[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const isPasswordRecoveryRef = useRef(false);
  const setRecoveryMode = (v: boolean) => {
    isPasswordRecoveryRef.current = v;
    setIsPasswordRecovery(v);
  };

  // Initialize theme from localStorage, falling back to system preference.
  useEffect(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem('vhb-theme') : null;
    const initial: 'light' | 'dark' = stored === 'dark' || stored === 'light'
      ? stored
      : typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light';
    setTheme(initial);
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', initial === 'dark');
    }
  }, []);

  const toggleTheme = () => {
    setTheme((current) => {
      const next = current === 'light' ? 'dark' : 'light';
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('vhb-theme', next);
        document.documentElement.classList.toggle('dark', next === 'dark');
      }
      return next;
    });
  };

  const dismissToast = (id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  };

  const showToast = (message: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4200);
  };

  useEffect(() => {
    let isMounted = true;

    const bootstrap = async () => {
      if (!supabase) {
        setAuthReady(true);
        return;
      }

      const { data } = await supabase.auth.getSession();
      if (!isMounted) return;

      setSession(data.session);
      if (data.session) {
        await initializeAuthenticatedApp(data.session.access_token);
      }
      setAuthReady(true);
    };

    bootstrap();

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
      if (nextSession) {
        await initializeAuthenticatedApp(nextSession.access_token);
      } else {
        setRecoveryMode(false);
        setCurrentUser(null);
        setUsers(MOCK_USERS);
        setShifts(MOCK_SHIFTS);
        setDiversions(MOCK_DIVERSIONS);
        setServices(MOCK_SERVICES);
        setUpdates(MOCK_UPDATES);
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
    const data = await response.json();
    setCurrentUser(data);
    return data as User;
  };

  const initializeAuthenticatedApp = async (accessToken: string) => {
    try {
      setIsLoading(true);
      const appUser = await fetchCurrentUser(accessToken);
      await Promise.all([
        fetchPlanning(accessToken),
        fetchUsers(accessToken),
        fetchDiversions(accessToken),
        fetchServices(accessToken),
        fetchUpdates(accessToken),
        fetchSwaps(accessToken),
        fetchLeave(accessToken),
        ...(appUser.role === 'planner' || appUser.role === 'admin' ? [fetchPlanningMatrix(accessToken)] : []),
        ...(appUser.role === 'planner' || appUser.role === 'admin' ? [fetchPlanningCodes(accessToken)] : []),
        ...(appUser.role === 'planner' || appUser.role === 'admin' ? [fetchPlanningMatrixHistory(accessToken)] : []),
        ...(appUser.role === 'admin' ? [fetchActivityLog(accessToken)] : []),
      ]);
    } catch (error) {
      console.error('Error initializing app:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchUpdates = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/updates', {}, accessToken);
      const data = await response.json();
      if (data && Array.isArray(data)) setUpdates(data);
    } catch (error) {
      console.error('Error fetching updates:', error);
    }
  };

  const saveUpdates = async (newUpdates: Update[]) => {
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
      const data = await response.json();
      if (data.success) {
        showToast(data.mocked ? `E-mail gelogd: ${data.message}` : 'E-mails succesvol verzonden naar alle chauffeurs!', 'success');
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
      if (data && Array.isArray(data)) setSwaps(data);
    } catch (error) {
      console.error('Error fetching swaps:', error);
    }
  };

  const saveSwaps = async (newSwaps: SwapRequest[]) => {
    try {
      const response = await apiFetch('/api/swaps', {
        method: 'POST',
        body: JSON.stringify(newSwaps),
      });
      if (response.ok) {
        setSwaps(newSwaps);
        showToast('Ruilverzoek bijgewerkt.', 'success');
      }
    } catch (error) {
      console.error('Error saving swaps:', error);
      showToast('Opslaan van ruilverzoeken is mislukt.', 'error');
    }
  };

  const fetchLeave = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/leave', {}, accessToken);
      const data = await response.json();
      if (data && Array.isArray(data)) setLeaveRequests(data);
    } catch (error) {
      console.error('Error fetching leave:', error);
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
    try {
      setIsLoading(true);
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
      setIsLoading(false);
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

  const saveLeave = async (newLeave: LeaveRequest[]) => {
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
      }
    } catch (error) {
      console.error('Error saving leave:', error);
      showToast('Opslaan van verlofaanvragen is mislukt.', 'error');
    }
  };

  const fetchServices = async (accessToken = session?.access_token) => {
    try {
      setIsLoading(true);
      const response = await apiFetch('/api/services', {}, accessToken);
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setServices(data);
      }
    } catch (error) {
      console.error('Error fetching services:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const saveServices = async (newServices: Service[]) => {
    try {
      setIsLoading(true);
      const response = await apiFetch('/api/services', {
        method: 'POST',
        body: JSON.stringify(newServices),
      });
      if (response.ok) {
        setServices(newServices);
        if (currentUser?.role === 'admin') {
          await fetchActivityLog();
        }
        showToast('Diensten succesvol opgeslagen.', 'success');
      }
    } catch (error) {
      console.error('Error saving services:', error);
      showToast('Opslaan van diensten is mislukt.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchUsers = async (accessToken = session?.access_token) => {
    try {
      console.log('Fetching users...');
      const response = await apiFetch('/api/users', {}, accessToken);
      const data = await response.json();
      console.log('Users fetched:', data?.length);
      if (data && Array.isArray(data)) {
        setUsers(data);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  };

  const saveUsers = async (newUsers: Array<User & { password?: string }>) => {
    try {
      console.log('Saving users, count:', newUsers.length);
      setIsLoading(true);
      const response = await apiFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify(newUsers),
      });
      if (response.ok) {
        console.log('Users saved successfully');
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
      setIsLoading(false);
    }
  };

  const fetchPlanning = async (accessToken = session?.access_token) => {
    try {
      setIsLoading(true);
      const response = await apiFetch('/api/planning', {}, accessToken);
      const data = await response.json();
      if (data && data.length > 0) {
        setShifts(data);
      }
    } catch (error) {
      console.error('Error fetching planning:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const savePlanning = async (newShifts: Shift[]) => {
    try {
      setIsLoading(true);
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
      }
    } catch (error) {
      console.error('Error saving planning:', error);
      showToast('Opslaan van planning is mislukt.', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchDiversions = async (accessToken = session?.access_token) => {
    try {
      setIsLoading(true);
      const response = await apiFetch('/api/diversions', {}, accessToken);
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setDiversions(data);
      }
    } catch (error) {
      console.error('Error fetching diversions:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const saveDiversions = async (newDiversions: Diversion[]) => {
    try {
      setIsLoading(true);
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
      }
    } catch (error) {
      console.error('Error saving diversions:', error);
      showToast('Opslaan van omleidingen is mislukt.', 'error');
    } finally {
      setIsLoading(false);
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
      await supabase?.auth.signOut();
      setSession(null);
      setCurrentUser(null);
    }
  };

  if (!authReady) {
    return <div className="min-h-screen bg-oker-50 flex items-center justify-center text-slate-600 font-bold">Sessie laden...</div>;
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

  if (!session || !currentUser) {
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
    'ruil-verzoeken': { title: 'Wissel-Verzoeken', subtitle: 'Beheer openstaande ruilverzoeken en aanbiedingen.' },
    verlof: { title: 'Verlof', subtitle: 'Vraag verlof aan en volg je aanvragen op.' },
    'verlof-beheer': { title: 'Verlofbeheer', subtitle: 'Bekijk aanvragen en beheer afwezigheden per dag.' },
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

  return (
    <>
      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      <ChangePasswordModal
        isOpen={showChangePassword}
        onClose={() => setShowChangePassword(false)}
        email={currentUser?.email || session?.user?.email || ''}
      />
      <AnimatePresence>
        {isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-900/20 backdrop-blur-[2px]"
          >
            <div className="rounded-[28px] border border-white/60 bg-white/95 px-6 py-5 shadow-2xl">
              <div className="flex items-center gap-4">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-slate-200 border-t-oker-500" />
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.2em] text-slate-400">Bezig</p>
                  <p className="text-sm font-bold text-slate-800">Gegevens verwerken...</p>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="flex h-screen bg-transparent text-slate-900 font-sans overflow-hidden">
      {/* Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 w-[19rem] panel-dark ios-soft-panel m-3 mr-0 rounded-[30px] flex flex-col z-50 transition-transform duration-500 transform lg:relative lg:translate-x-0 overflow-hidden",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
        style={{ transitionTimingFunction: 'cubic-bezier(0.34, 1.28, 0.64, 1)' }}
      >
        <div className="pointer-events-none absolute inset-x-5 top-0 h-20 rounded-b-[28px] bg-white/30 blur-2xl opacity-80" />
        <div className="pointer-events-none absolute -right-10 top-20 h-40 w-40 rounded-full bg-oker-200/18 blur-3xl" />
        <div className="p-6 flex items-center justify-center border-b fine-divider relative text-center">
          <button
            type="button"
            onClick={() => { setCurrentView('dashboard'); setIsSidebarOpen(false); }}
            className="w-full rounded-2xl py-1 transition-all active:scale-[0.98] hover:opacity-80"
            title="Naar dashboard"
          >
            <h1 className="brand-wordmark section-title text-[1.25rem] text-slate-900 leading-none">VHB <span className="text-oker-500">PORTAAL</span></h1>
            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-0.5">Van Hoorebeke en Zoon</p>
          </button>
          <button
            onClick={() => setIsSidebarOpen(false)}
            className="absolute right-6 p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100/60 rounded-xl transition-colors lg:hidden"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 px-4 py-5 space-y-1.5 overflow-y-auto">
          <NavItem 
            icon={<LayoutDashboard size={20} />} 
            label="Dashboard" 
            active={currentView === 'dashboard'} 
            onClick={() => { setCurrentView('dashboard'); setIsSidebarOpen(false); }} 
          />
          <NavItem 
            icon={<Calendar size={20} />} 
            label="Mijn Rooster" 
            active={currentView === 'rooster'} 
            onClick={() => { setCurrentView('rooster'); setIsSidebarOpen(false); }} 
          />
          <NavItem 
            icon={<MapPin size={20} />} 
            label="Omleidingen" 
            active={currentView === 'omleidingen'} 
            onClick={() => { setCurrentView('omleidingen'); setIsSidebarOpen(false); }} 
          />
          <NavItem
            icon={<FileText size={20} />}
            label="Ritblaadjes"
            active={currentView === 'ritblaadjes'}
            onClick={() => { setCurrentView('ritblaadjes'); setIsSidebarOpen(false); }}
          />
          <NavItem
            icon={<Phone size={20} />}
            label="Contactlijst"
            active={currentView === 'contacten'}
            onClick={() => { setCurrentView('contacten'); setIsSidebarOpen(false); }}
          />
          <NavItem 
            icon={<Bell size={20} />} 
            label="Updates" 
            active={currentView === 'updates'} 
            onClick={() => { setCurrentView('updates'); setIsSidebarOpen(false); }} 
          />
          <NavItem 
            icon={<RotateCcw size={20} />} 
            label="Wissel Aanvragen" 
            active={currentView === 'ruil-verzoeken'} 
            onClick={() => { setCurrentView('ruil-verzoeken'); setIsSidebarOpen(false); }} 
          />
          <NavItem
            icon={<Calendar size={20} />}
            label="Verlof Aanvragen"
            active={currentView === 'verlof'}
            onClick={() => { setCurrentView('verlof'); setIsSidebarOpen(false); }}
            badge={unseenLeaveDecisionCount}
          />

          {isPlanner && (
            <>
              <div className="pt-5 pb-2 px-4 text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Beheer</div>
              <NavItem 
                icon={<Calendar size={20} />} 
                label="Verlofbeheer" 
                active={currentView === 'verlof-beheer'} 
                onClick={() => { setCurrentView('verlof-beheer'); setIsSidebarOpen(false); }} 
              />
              <NavItem 
                icon={<Settings size={20} />} 
                label="Beheer Roosters" 
                active={currentView === 'beheer-roosters'} 
                onClick={() => { setCurrentView('beheer-roosters'); setIsSidebarOpen(false); }} 
              />
              <NavItem 
                icon={<FileText size={20} />} 
                label="Planning Overzicht" 
                active={currentView === 'planning-matrix'} 
                onClick={() => { setCurrentView('planning-matrix'); setIsSidebarOpen(false); }} 
              />
              <NavItem 
                icon={<Settings size={20} />} 
                label="Planningscodes" 
                active={currentView === 'planning-codes'} 
                onClick={() => { setCurrentView('planning-codes'); setIsSidebarOpen(false); }} 
              />
              <NavItem 
                icon={<Plus size={20} />} 
                label="Beheer Updates" 
                active={currentView === 'beheer-updates'} 
                onClick={() => { setCurrentView('beheer-updates'); setIsSidebarOpen(false); }} 
              />
              <NavItem 
                icon={<MapIcon size={20} />} 
                label="Beheer Omleidingen" 
                active={currentView === 'beheer-omleidingen'} 
                onClick={() => { setCurrentView('beheer-omleidingen'); setIsSidebarOpen(false); }} 
              />
              <NavItem
                icon={<Bus size={20} />}
                label="Dienstoverzicht"
                active={currentView === 'dienstoverzicht'}
                onClick={() => { setCurrentView('dienstoverzicht'); setIsSidebarOpen(false); }}
              />
              <NavItem
                icon={<Bus size={20} />}
                label="Beheer Dienstoverzicht"
                active={currentView === 'beheer-dienstoverzicht'}
                onClick={() => { setCurrentView('beheer-dienstoverzicht'); setIsSidebarOpen(false); }}
              />
            </>
          )}

          {isAdmin && (
            <>
              <div className="pt-5 pb-2 px-4 text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Admin</div>
              <NavItem 
                icon={<Users size={20} />} 
                label="Gebruikers" 
                active={currentView === 'gebruikers'} 
                onClick={() => { setCurrentView('gebruikers'); setIsSidebarOpen(false); }} 
              />
              <NavItem 
                icon={<Activity size={20} />} 
                label="Activiteit" 
                active={currentView === 'activiteit'} 
                onClick={() => { setCurrentView('activiteit'); setIsSidebarOpen(false); }} 
              />
              <NavItem 
                icon={<Activity size={20} />} 
                label="Systeem Status" 
                active={currentView === 'beheer-debug'} 
                onClick={() => { setCurrentView('beheer-debug'); setIsSidebarOpen(false); }} 
              />
            </>
          )}
        </nav>

        <div className="p-4 border-t fine-divider space-y-2">
          {/* User profile card */}
          <div className="flex items-center gap-3 px-3 py-2.5 rounded-2xl bg-white/40">
            <div className="w-8 h-8 rounded-xl bg-oker-100 flex items-center justify-center text-oker-700 shrink-0">
              <UserIcon size={16} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-slate-800 truncate leading-tight">{currentUser.name}</p>
              <p className="text-[10px] text-slate-400 font-medium uppercase tracking-wide">{currentUser.role}</p>
            </div>
          </div>
          <button
            onClick={toggleTheme}
            className="flex items-center gap-3 w-full px-3 py-2.5 text-slate-400 hover:text-oker-600 hover:bg-oker-50/70 rounded-2xl transition-all duration-200 font-medium text-sm"
          >
            {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
            <span>{theme === 'light' ? 'Donkere modus' : 'Lichte modus'}</span>
          </button>
          <button
            onClick={() => setShowChangePassword(true)}
            className="flex items-center gap-3 w-full px-3 py-2.5 text-slate-400 hover:text-oker-600 hover:bg-oker-50/70 rounded-2xl transition-all duration-200 font-medium text-sm"
          >
            <KeyRound size={16} />
            <span>Wachtwoord wijzigen</span>
          </button>
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-3 py-2.5 text-slate-400 hover:text-red-500 hover:bg-red-50/70 rounded-2xl transition-all duration-200 font-medium text-sm"
          >
            <LogOut size={16} />
            <span>Uitloggen</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {/* Header */}
        <header className={cn(
          "mx-3 mt-3 rounded-[24px] panel ios-soft-panel flex items-center justify-between px-5 md:px-6 py-4 shrink-0 z-30 relative transition-shadow duration-500",
          isScrolled && "shadow-[0_10px_30px_rgba(15,23,42,0.08)] ring-1 ring-white/60"
        )}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setIsSidebarOpen(true)}
              className="p-2 text-slate-400 hover:bg-slate-100/70 rounded-xl lg:hidden transition-colors"
            >
              <Menu size={22} />
            </button>
            <div>
              <h2 className="section-title text-xl md:text-2xl font-black tracking-tight text-slate-900 leading-tight">
                {currentMeta.title}
              </h2>
              <p className="hidden md:block text-xs font-medium text-slate-400 mt-0.5 max-w-xl">{currentMeta.subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-emerald-50/80 border border-emerald-100">
              <div className="h-2 w-2 rounded-full bg-emerald-500" />
              <p className="text-xs font-semibold text-emerald-700">Online</p>
            </div>
            <div className="hidden sm:flex items-center gap-2.5 pl-3 border-l border-slate-100">
              <div className="w-9 h-9 bg-oker-50 rounded-xl flex items-center justify-center text-oker-600 border border-oker-100/60">
                <UserIcon size={17} />
              </div>
              <div className="text-left">
                <p className="text-sm font-bold text-slate-800 leading-tight">{currentUser.name}</p>
                <p className="text-[10px] text-slate-400 uppercase tracking-wide">{currentUser.role}</p>
              </div>
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div
          className="flex-1 overflow-y-auto px-4 pb-24 pt-4 md:px-7 lg:pb-8"
          onScroll={(e) => {
            const next = (e.currentTarget.scrollTop ?? 0) > 8;
            setIsScrolled((current) => (current === next ? current : next));
          }}
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={resolvedCurrentView}
              initial={{ opacity: 0, y: 18, scale: 0.985, filter: 'blur(8px)' }}
              animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -12, scale: 0.99, filter: 'blur(6px)' }}
              transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
              className="mx-auto max-w-[1360px]"
            >
              {resolvedCurrentView === 'dashboard' && <DashboardView user={currentUser!} shifts={shifts} diversions={diversions} users={users} />}
              {resolvedCurrentView === 'omleidingen' && <DiversionsView diversions={diversions} />}
              {resolvedCurrentView === 'rooster' && <ScheduleView user={currentUser!} shifts={shifts} users={users} />}
              {resolvedCurrentView === 'dienstoverzicht' && <ServicesView services={services} />}
              {resolvedCurrentView === 'ritblaadjes' && <RitblaadjesView currentUser={currentUser!} />}
              {resolvedCurrentView === 'updates' && <UpdatesView updates={updates} />}
              {resolvedCurrentView === 'contacten' && <ContactsView users={users} currentUser={currentUser!} />}
              {resolvedCurrentView === 'beheer-roosters' && <ManageSchedulesView shifts={shifts} onSave={savePlanning} users={users} history={planningMatrixHistory} canAdminOverride={isAdmin} onMatrixImported={async () => {
                await Promise.all([
                  fetchPlanningMatrix(),
                  fetchPlanning(),
                  fetchPlanningMatrixHistory(),
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
                  <LazyManageUsersView users={users} onSave={saveUsers} currentUser={currentUser!} />
                </Suspense>
              )}
              {resolvedCurrentView === 'activiteit' && <ActivityLogView entries={activityLog} />}
              {resolvedCurrentView === 'beheer-omleidingen' && <ManageDiversionsView diversions={diversions} onSave={saveDiversions} />}
              {resolvedCurrentView === 'beheer-dienstoverzicht' && <ManageServicesView services={services} onSave={saveServices} canAdminOverride={isAdmin} />}
              {resolvedCurrentView === 'beheer-contactlijst' && (
                <Suspense fallback={<ViewLoader />}>
                  <LazyManageUsersView users={users} onSave={saveUsers} title="Beheer Contactlijst" currentUser={currentUser!} />
                </Suspense>
              )}
              {resolvedCurrentView === 'ruil-verzoeken' && <SwapRequestsView user={currentUser} swaps={swaps} shifts={shifts} users={users} onSave={saveSwaps} />}
              {(resolvedCurrentView === 'verlof' || resolvedCurrentView === 'verlof-beheer') && (
                <Suspense fallback={<ViewLoader />}>
                  <LazyLeaveManagementView
                    user={currentUser}
                    leaveRequests={leaveRequests}
                    users={users}
                    onSave={saveLeave}
                    lastSeenDecisionAt={lastSeenLeaveDecisionAt}
                    onMarkDecisionsSeen={markLeaveDecisionsSeen}
                  />
                </Suspense>
              )}
              {resolvedCurrentView === 'beheer-debug' && (
                <Suspense fallback={<ViewLoader />}>
                  <LazyDebugView />
                </Suspense>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Mobile Bottom Navigation */}
        <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white/80 backdrop-blur-xl border-t border-slate-200 px-6 py-3 flex justify-between items-center z-40 shadow-[0_-8px_30px_rgba(0,0,0,0.04)]">
          <MobileNavItem 
            icon={<LayoutDashboard size={20} />} 
            active={currentView === 'dashboard'} 
            onClick={() => setCurrentView('dashboard')} 
          />
          <MobileNavItem 
            icon={<MapPin size={20} />} 
            active={currentView === 'omleidingen'} 
            onClick={() => setCurrentView('omleidingen')} 
          />
          <MobileNavItem 
            icon={<Calendar size={20} />} 
            active={currentView === 'rooster'} 
            onClick={() => setCurrentView('rooster')} 
          />
          {isPlanner && (
            <MobileNavItem
              icon={<Bus size={20} />}
              active={currentView === 'dienstoverzicht'}
              onClick={() => setCurrentView('dienstoverzicht')}
            />
          )}
          <MobileNavItem 
            icon={<Phone size={20} />} 
            active={currentView === 'contacten'} 
            onClick={() => setCurrentView('contacten')} 
          />
          <MobileNavItem 
            icon={<Calendar size={20} />} 
            active={currentView === 'verlof'} 
            onClick={() => setCurrentView('verlof')} 
          />
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="ios-pressable p-3 text-slate-400 hover:text-oker-500 transition-colors"
          >
            <Menu size={20} />
          </button>
        </div>
      </main>
      </div>
    </>
  );
}




