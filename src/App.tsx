/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, lazy, useState, useEffect, useDeferredValue, useMemo } from 'react';
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
  Activity
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { Session } from '@supabase/supabase-js';
import { View, User, Shift, Update, Diversion, Service, SwapRequest, LeaveRequest, PlanningMatrixRow, PlanningCode, PlanningMatrixImportHistory, ActivityLogEntry, Role } from './types';
import { MOCK_DIVERSIONS, MOCK_SHIFTS, MOCK_UPDATES, MOCK_USERS, MOCK_SERVICES } from './constants';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { cn, getSupabaseAuthHeaders, notify } from './lib/ui';
import { AdminPageHeader, AdminSubsectionHeader, ConfirmationModal, EmptyState, ViewLoader } from './components/ui';
const DiversionMap = lazy(() => import('./components/DiversionMap').then((module) => ({ default: module.DiversionMap })));
const LazyDebugView = lazy(() => import('./views/admin/DebugView').then((module) => ({ default: module.DebugView })));
const LazyManageUpdatesView = lazy(() => import('./views/admin/ManageUpdatesView').then((module) => ({ default: module.ManageUpdatesView })));
const LazyManageUsersView = lazy(() => import('./views/admin/ManageUsersView').then((module) => ({ default: module.ManageUsersView })));
const LazyLeaveManagementView = lazy(() => import('./views/LeaveManagementView').then((module) => ({ default: module.LeaveManagementView })));

type Toast = {
  id: number;
  message: string;
  tone?: 'success' | 'error' | 'info';
};

const ALLOWED_VIEWS_BY_ROLE: Record<Role, View[]> = {
  chauffeur: ['dashboard', 'rooster', 'omleidingen', 'dienstoverzicht', 'contacten', 'updates', 'ruil-verzoeken', 'verlof'],
  planner: [
    'dashboard',
    'rooster',
    'omleidingen',
    'dienstoverzicht',
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


function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="fixed top-4 right-4 z-[120] w-[calc(100vw-2rem)] max-w-sm space-y-3">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: -12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.96 }}
            className={cn(
              'rounded-3xl border px-5 py-4 shadow-2xl backdrop-blur-sm',
              toast.tone === 'success' && 'border-emerald-200 bg-emerald-50/95 text-emerald-900',
              toast.tone === 'error' && 'border-red-200 bg-red-50/95 text-red-900',
              (!toast.tone || toast.tone === 'info') && 'border-slate-200 bg-white/95 text-slate-900'
            )}
          >
            <div className="flex items-start gap-3">
              <div className={cn(
                'mt-0.5 h-2.5 w-2.5 rounded-full',
                toast.tone === 'success' && 'bg-emerald-500',
                toast.tone === 'error' && 'bg-red-500',
                (!toast.tone || toast.tone === 'info') && 'bg-oker-500'
              )} />
              <p className="flex-1 text-sm font-bold leading-5">{toast.message}</p>
              <button
                onClick={() => onDismiss(toast.id)}
                className="rounded-full p-1 text-slate-400 transition-colors hover:bg-black/5 hover:text-slate-700"
                aria-label="Sluit melding"
              >
                <X size={16} />
              </button>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

type ResolvedPlanningAssignment = {
  driver: string;
  code: string;
  kind: 'service' | 'leave' | 'absence' | 'training' | 'unknown';
  label: string;
  details: string;
  segments: string[];
};

const normalizePlanningToken = (value: unknown) => String(value ?? '').trim().toLowerCase();

const getServiceSegments = (service: Service) => (
  [
    service.startTime && service.endTime ? `${service.startTime} - ${service.endTime}` : '',
    service.startTime2 && service.endTime2 ? `${service.startTime2} - ${service.endTime2}` : '',
    service.startTime3 && service.endTime3 ? `${service.startTime3} - ${service.endTime3}` : '',
  ].filter(Boolean)
);

const resolvePlanningAssignment = (
  driver: string,
  rawCode: string,
  services: Service[],
  planningCodes: PlanningCode[],
): ResolvedPlanningAssignment => {
  const normalizedCode = normalizePlanningToken(rawCode);
  const matchedService = services.find((service) => normalizePlanningToken(service.serviceNumber) === normalizedCode);
  if (matchedService) {
    const segments = getServiceSegments(matchedService);
    return {
      driver,
      code: rawCode,
      kind: 'service',
      label: `Dienst ${matchedService.serviceNumber}`,
      details: segments.length > 0 ? segments.join(' | ') : 'Dienst herkend, maar zonder uren.',
      segments,
    };
  }

  const matchedCode = planningCodes.find((planningCode) => normalizePlanningToken(planningCode.code) === normalizedCode);
  if (matchedCode) {
    return {
      driver,
      code: rawCode,
      kind: matchedCode.category,
      label: matchedCode.description || matchedCode.code.toUpperCase(),
      details:
        matchedCode.category === 'leave'
          ? 'Gekoppeld als verlofcode.'
          : matchedCode.category === 'training'
            ? 'Gekoppeld als opleidingscode.'
            : matchedCode.category === 'absence'
              ? 'Gekoppeld als afwezigheid.'
              : matchedCode.category === 'service'
                ? 'Gemarkeerd als dienstcode zonder uren in Dienstoverzicht.'
                : 'Code bestaat in Planningscodes, maar is nog niet verder verfijnd.',
      segments: [],
    };
  }

  return {
    driver,
    code: rawCode,
    kind: 'unknown',
    label: 'Onbekende code',
    details: 'Geen match gevonden in Dienstoverzicht of Planningscodes.',
    segments: [],
  };
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
  const [planningMatrixRows, setPlanningMatrixRows] = useState<PlanningMatrixRow[]>([]);
  const [planningCodes, setPlanningCodes] = useState<PlanningCode[]>([]);
  const [planningMatrixHistory, setPlanningMatrixHistory] = useState<PlanningMatrixImportHistory[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);

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

    const { data: authListener } = supabase?.auth.onAuthStateChange(async (_event, nextSession) => {
      if (!isMounted) return;

      setSession(nextSession);
      if (nextSession) {
        await initializeAuthenticatedApp(nextSession.access_token);
      } else {
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
      if (data && Array.isArray(data)) setUpdates(data.length > 0 ? data : MOCK_UPDATES);
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

  const saveLeave = async (newLeave: LeaveRequest[]) => {
    try {
      const response = await apiFetch('/api/leave', {
        method: 'POST',
        body: JSON.stringify(newLeave),
      });
      if (response.ok) {
        setLeaveRequests(newLeave);
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
        setDiversions(data.length > 0 ? data : MOCK_DIVERSIONS);
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
      <aside className={cn(
        "fixed inset-y-0 left-0 w-[19rem] panel-dark ios-soft-panel m-3 mr-0 rounded-[30px] flex flex-col z-50 transition-transform duration-500 transform lg:relative lg:translate-x-0 overflow-hidden",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="pointer-events-none absolute inset-x-5 top-0 h-20 rounded-b-[28px] bg-white/30 blur-2xl opacity-80" />
        <div className="pointer-events-none absolute -right-10 top-20 h-40 w-40 rounded-full bg-oker-200/18 blur-3xl" />
        <div className="p-6 flex items-center justify-center border-b fine-divider relative text-center">
          <div className="flex items-center justify-center gap-3">
            <div className="w-full">
              <h1 className="brand-wordmark section-title text-[1.25rem] text-slate-900 leading-none">VHB <span className="text-oker-500">PORTAAL</span></h1>
              <p className="text-[9px] font-bold text-slate-400 uppercase tracking-[0.2em] mt-0.5">Van Hoorebeke en Zoon</p>
            </div>
          </div>
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
            icon={<Bus size={20} />} 
            label="Dienstoverzicht" 
            active={currentView === 'dienstoverzicht'} 
            onClick={() => { setCurrentView('dienstoverzicht'); setIsSidebarOpen(false); }} 
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
        <header className="mx-3 mt-3 rounded-[24px] panel ios-soft-panel flex items-center justify-between px-5 md:px-6 py-4 shrink-0 z-30 relative">
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
        <div className="flex-1 overflow-y-auto px-4 pb-24 pt-4 md:px-7 lg:pb-8">
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
              {resolvedCurrentView === 'planning-matrix' && <PlanningMatrixView rows={planningMatrixRows} services={services} planningCodes={planningCodes} users={users} />}
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
              {resolvedCurrentView === 'beheer-omleidingen' && <ManageDiversionsView diversions={diversions} onSave={saveDiversions} canAdminSync={isAdmin} />}
              {resolvedCurrentView === 'beheer-dienstoverzicht' && <ManageServicesView services={services} onSave={saveServices} canAdminOverride={isAdmin} />}
              {resolvedCurrentView === 'beheer-contactlijst' && (
                <Suspense fallback={<ViewLoader />}>
                  <LazyManageUsersView users={users} onSave={saveUsers} title="Beheer Contactlijst" currentUser={currentUser!} />
                </Suspense>
              )}
              {resolvedCurrentView === 'ruil-verzoeken' && <SwapRequestsView user={currentUser} swaps={swaps} shifts={shifts} users={users} onSave={saveSwaps} />}
              {(resolvedCurrentView === 'verlof' || resolvedCurrentView === 'verlof-beheer') && (
                <Suspense fallback={<ViewLoader />}>
                  <LazyLeaveManagementView user={currentUser} leaveRequests={leaveRequests} users={users} onSave={saveLeave} />
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
          <MobileNavItem 
            icon={<Bus size={20} />} 
            active={currentView === 'dienstoverzicht'} 
            onClick={() => setCurrentView('dienstoverzicht')} 
          />
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

function MobileNavItem({ icon, active, onClick }: { icon: React.ReactNode, active: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "ios-pressable p-3 rounded-2xl transition-all duration-300 relative",
        active ? "text-oker-600 bg-oker-50 shadow-inner" : "text-slate-400 hover:text-slate-600"
      )}
    >
      {active && (
        <motion.div 
          layoutId="activeTab"
          transition={{ type: 'spring', stiffness: 380, damping: 30, mass: 0.8 }}
          className="absolute inset-0 bg-oker-500/10 rounded-2xl -z-10"
        />
      )}
      {icon}
    </button>
  );
}

function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "ios-pressable flex items-center gap-3 w-full px-3 py-2.5 rounded-2xl transition-all duration-300 group text-left",
        active
          ? "bg-white/90 text-slate-900 shadow-sm font-semibold"
          : "text-slate-500 hover:text-slate-800 hover:bg-white/50 font-medium"
      )}
    >
      <span className={cn(
        "w-8 h-8 rounded-xl flex items-center justify-center shrink-0 transition-colors duration-200",
        active ? "bg-oker-500 text-white shadow-sm shadow-oker-500/30" : "text-slate-400 group-hover:text-oker-500"
      )}>
        {icon}
      </span>
      <span className="text-[14px] leading-none">{label}</span>
    </button>
  );
}

function LoginView({ onLogin }: { onLogin: (accessToken?: string) => Promise<void> }) {
  const [email, setEmail] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setError('');

    if (!supabase) {
      setError('Supabase is niet geconfigureerd.');
      setIsSubmitting(false);
      return;
    }

    const { data, error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (signInError) {
      setError('Inloggen mislukt. Controleer je e-mailadres en wachtwoord.');
      setIsSubmitting(false);
      return;
    }

    try {
      await onLogin(data.session?.access_token);
    } catch (loginError: any) {
      setError(loginError.message || 'Je account is aangemeld, maar het portaalprofiel kon niet geladen worden.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #f8f6f0 0%, #f1ede4 100%)' }}>
      {/* Left brand panel — hidden on mobile */}
      <div className="hidden lg:flex lg:w-1/2 xl:w-[55%] relative flex-col justify-between p-14 overflow-hidden rounded-r-[44px] shadow-[18px_0_50px_rgba(217,119,6,0.08)]" style={{ background: 'linear-gradient(160deg, #fff7e6 0%, #fdf1cf 52%, #f7e7be 100%)' }}>
        {/* Decorative glows */}
        <div className="absolute top-0 right-0 w-[60%] h-[50%] rounded-full blur-3xl opacity-40" style={{ background: 'radial-gradient(circle, rgba(245,158,11,0.28) 0%, transparent 72%)' }} />
        <div className="absolute bottom-0 left-0 w-[50%] h-[40%] rounded-full blur-3xl opacity-25" style={{ background: 'radial-gradient(circle, rgba(217,119,6,0.18) 0%, transparent 72%)' }} />
        {/* Grid pattern overlay */}
        <div className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: 'linear-gradient(rgba(180,83,9,0.12) 1px, transparent 1px), linear-gradient(90deg, rgba(180,83,9,0.12) 1px, transparent 1px)', backgroundSize: '48px 48px' }} />

        {/* Brand */}
        <div className="relative z-10">
          <h1 className="brand-wordmark text-4xl text-slate-900">VHB <span className="text-oker-500">PORTAAL</span></h1>
          <p className="mt-2 text-slate-500 font-medium text-sm tracking-wide">Van Hoorebeke en Zoon</p>
        </div>

        {/* Feature list */}
        <div className="relative z-10 space-y-5">
          {[
            { icon: <Calendar size={18} />, label: 'Roosters & Planning', desc: 'Bekijk je diensten en planning.' },
            { icon: <MapPin size={18} />, label: 'Omleidingen', desc: 'Realtime routewijzigingen voor chauffeurs.' },
            { icon: <Bell size={18} />, label: 'Updates & Meldingen', desc: 'Nieuws, veiligheid en technische info.' },
          ].map(f => (
            <div key={f.label} className="flex items-start gap-4">
              <div className="w-9 h-9 rounded-xl bg-white/55 border border-white/75 flex items-center justify-center text-oker-500 shadow-sm shrink-0">{f.icon}</div>
              <div>
                <p className="text-sm font-bold text-slate-900">{f.label}</p>
                <p className="text-xs text-slate-500 mt-0.5">{f.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <p className="relative z-10 text-xs text-slate-500">© {new Date().getFullYear()} Van Hoorebeke en Zoon. Intern gebruik.</p>
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex items-center justify-center p-8">
        <motion.div
          initial={{ opacity: 0, y: 16, scale: 0.985, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
          transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
          className="w-full max-w-sm lg:pl-6"
        >
          {/* Mobile-only brand */}
          <div className="lg:hidden text-center mb-10">
            <h1 className="brand-wordmark text-3xl text-slate-900">VHB <span className="text-oker-500">PORTAAL</span></h1>
            <p className="mt-1 text-slate-400 text-xs font-medium tracking-widest uppercase">Van Hoorebeke en Zoon</p>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-black text-slate-900 tracking-tight">Welkom terug</h2>
            <p className="mt-1 text-sm text-slate-500 font-medium">Meld je aan om verder te gaan.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest">E-mailadres</label>
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(''); }}
                className="w-full px-4 py-3.5 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-oker-400/40 focus:border-oker-400 transition-all bg-white shadow-sm font-medium text-slate-800 placeholder:text-slate-300"
                required
                placeholder="naam@bedrijf.be"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-widest">Wachtwoord</label>
              <input
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(''); }}
                placeholder="••••••••"
                className="w-full px-4 py-3.5 rounded-2xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-oker-400/40 focus:border-oker-400 transition-all bg-white shadow-sm font-medium text-slate-800 placeholder:text-slate-300"
                required
              />
            </div>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-100 rounded-2xl"
              >
                <AlertTriangle size={14} className="text-red-400 shrink-0" />
                <p className="text-red-600 text-sm font-medium">{error}</p>
              </motion.div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className={cn(
                "ios-pressable w-full font-bold py-4 rounded-2xl transition-all mt-2 text-sm tracking-wide",
                isSubmitting
                  ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                  : "bg-oker-500 text-white hover:bg-oker-600 shadow-lg shadow-oker-500/25 hover:shadow-oker-500/35"
              )}
            >
              {isSubmitting ? 'Bezig met inloggen...' : 'Inloggen'}
            </button>
          </form>
        </motion.div>
      </div>
    </div>
  );
}

function ContactsView({ users, currentUser }: { users: User[], currentUser: User }) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredUsers = users.filter(u => {
    // Hide 'beheerder' from others, but let 'beheerder' see themselves
    const isBeheerder = u.name.toLowerCase() === 'beheerder';
    const isMe = u.id === currentUser.id;
    
    if (isBeheerder && !isMe) return false;
    
    return u.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
           (u.phone && u.phone.includes(searchQuery));
  }).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-2xl font-black tracking-tight">Contactlijst</h3>
          <p className="text-sm text-slate-500 font-medium">Contactgegevens van alle medewerkers.</p>
        </div>
        <div className="relative w-full md:w-72 group">
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <Search size={18} className="text-slate-400 group-focus-within:text-oker-500 transition-colors" />
          </div>
          <input
            type="text"
            placeholder="Zoek op naam of nummer..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="control-input w-full pl-11 pr-4 py-3 rounded-2xl focus:outline-none transition-all font-medium text-sm"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {filteredUsers.map(u => (
          <div key={u.id} className="surface-card surface-card-hover p-6 rounded-[32px] flex items-center justify-between group">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-oker-50 rounded-2xl flex items-center justify-center text-oker-600 font-black text-lg">
                {u.name.charAt(0)}
              </div>
              <div>
                <h4 className="font-black text-slate-800 tracking-tight">{u.name}</h4>
                <p className="text-[10px] text-slate-400 font-black uppercase tracking-widest">{u.role}</p>
              </div>
            </div>
            {u.phone ? (
              <a 
                href={`tel:${u.phone.replace(/\s/g, '')}`}
                className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-xl flex items-center justify-center hover:bg-emerald-500 hover:text-white transition-all active:scale-90"
                title={`Bel ${u.name}`}
              >
                <Phone size={18} />
              </a>
            ) : (
              <div className="text-[10px] text-slate-300 font-bold italic">Geen nummer</div>
            )}
          </div>
        ))}
        {filteredUsers.length === 0 && (
          <div className="col-span-full">
            <EmptyState
              icon={<Users size={28} />}
              title="Geen contacten gevonden"
              message="Pas je zoekopdracht aan om medewerkers terug te vinden."
            />
          </div>
        )}
      </div>
    </div>
  );
}

function ServicesView({ services }: { services: Service[] }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'number' | 'time'>('number');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  const filteredServices = services.filter(s => 
    s.serviceNumber.toLowerCase().includes(searchQuery.toLowerCase())
  ).sort((a, b) => {
    let comparison = 0;
    if (sortBy === 'number') {
      comparison = a.serviceNumber.localeCompare(b.serviceNumber, undefined, { numeric: true });
    } else {
      comparison = a.startTime.localeCompare(b.startTime);
    }
    return sortOrder === 'asc' ? comparison : -comparison;
  });

  const toggleSort = (field: 'number' | 'time') => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const downloadCSV = () => {
    const headers = ['Dienstnummer', 'Start 1', 'Eind 1', 'Start 2', 'Eind 2', 'Start 3', 'Eind 3'];
    const rows = filteredServices.map(s => [
      `"${s.serviceNumber}"`, 
      `"${s.startTime}"`, 
      `"${s.endTime}"`,
      `"${s.startTime2 || ''}"`,
      `"${s.endTime2 || ''}"`,
      `"${s.startTime3 || ''}"`,
      `"${s.endTime3 || ''}"`
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `dienstoverzicht_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-2xl font-black tracking-tight">Dienstoverzicht</h3>
          <p className="text-sm text-slate-500 font-medium">Overzicht van alle diensten en bijbehorende uren.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
          <div className="glass-segmented flex p-1 rounded-xl">
            <button
              onClick={() => toggleSort('number')}
              className={cn(
                "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2",
                sortBy === 'number' ? "glass-chip text-oker-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              Dienst #
              {sortBy === 'number' && (sortOrder === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
            </button>
            <button
              onClick={() => toggleSort('time')}
              className={cn(
                "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2",
                sortBy === 'time' ? "glass-chip text-oker-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              Starttijd
              {sortBy === 'time' && (sortOrder === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
            </button>
          </div>
          <button
            onClick={downloadCSV}
            className="control-button-soft flex items-center gap-2 px-4 py-3 rounded-2xl text-slate-600 font-bold text-sm transition-all active:scale-95"
            title="Download als CSV"
          >
            <Download size={18} className="text-oker-500" />
            <span className="hidden sm:inline">CSV</span>
          </button>
          <div className="relative flex-1 md:w-64 group">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <Search size={18} className="text-slate-400 group-focus-within:text-oker-500 transition-colors" />
            </div>
            <input
              type="text"
              placeholder="Zoek..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="control-input w-full pl-11 pr-4 py-3 rounded-2xl focus:outline-none transition-all font-medium text-sm"
            />
          </div>
        </div>
      </div>

      <div className="surface-table rounded-[40px] overflow-hidden">
        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50">
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Dienst</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Deel 1</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Deel 2</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Deel 3</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredServices.map(s => (
                <tr key={s.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-8 py-5">
                    <span className="font-black text-slate-800 tracking-tight">{s.serviceNumber}</span>
                  </td>
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-2 text-slate-600 font-bold text-sm">
                      <Clock size={14} className="text-oker-500" />
                      {s.startTime} - {s.endTime}
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    {s.startTime2 ? (
                      <div className="flex items-center gap-2 text-slate-600 font-bold text-sm">
                        <Clock size={14} className="text-oker-500" />
                        {s.startTime2} - {s.endTime2}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-8 py-5">
                    {s.startTime3 ? (
                      <div className="flex items-center gap-2 text-slate-600 font-bold text-sm">
                        <Clock size={14} className="text-oker-500" />
                        {s.startTime3} - {s.endTime3}
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile Card View */}
        <div className="md:hidden divide-y divide-slate-50">
          {filteredServices.map(s => (
            <div key={s.id} className="p-6 space-y-4 hover:bg-slate-50/50 transition-colors">
              <div className="flex justify-between items-center">
                <span className="text-lg font-black text-slate-800 tracking-tight">{s.serviceNumber}</span>
                <div className="glass-chip px-3 py-1 text-oker-600 rounded-full text-[10px] font-black uppercase tracking-widest">
                  Dienst
                </div>
              </div>
              
              <div className="grid grid-cols-1 gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Deel 1</span>
                  <div className="flex items-center gap-2 text-slate-700 font-bold text-sm">
                    <Clock size={14} className="text-oker-500" />
                    {s.startTime} - {s.endTime}
                  </div>
                </div>

                {s.startTime2 && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Deel 2</span>
                    <div className="flex items-center gap-2 text-slate-700 font-bold text-sm">
                      <Clock size={14} className="text-oker-500" />
                      {s.startTime2} - {s.endTime2}
                    </div>
                  </div>
                )}

                {s.startTime3 && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Deel 3</span>
                    <div className="flex items-center gap-2 text-slate-700 font-bold text-sm">
                      <Clock size={14} className="text-oker-500" />
                      {s.startTime3} - {s.endTime3}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {filteredServices.length === 0 && (
          <div className="px-6 py-6">
            <EmptyState
              icon={<Clock size={28} />}
              title="Geen diensten gevonden"
              message={searchQuery ? `Geen diensten gevonden voor "${searchQuery}".` : 'Er zijn nog geen diensten beschikbaar.'}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function DashboardView({ user, shifts, diversions, users }: { user: User, shifts: Shift[], diversions: Diversion[], users: User[] }) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000); // Update every minute
    return () => clearInterval(timer);
  }, []);

  const myShifts = shifts.filter(s => s.driverId === user.id);
  const today = now.toISOString().split('T')[0];
  const todaysShift = myShifts.find((shift) => shift.date === today);
  
  const nextShift = myShifts
    .map(s => {
      const [year, month, day] = s.date.split('-').map(Number);
      const [hours, minutes] = s.startTime.split(':').map(Number);
      return { ...s, startDateTime: new Date(year, month - 1, day, hours, minutes) };
    })
    .filter(s => s.startDateTime > now)
    .sort((a, b) => a.startDateTime.getTime() - b.startDateTime.getTime())[0];
  const newestDiversions = [...diversions].reverse().slice(0, 3);
  const visibleShifts = shifts.filter(s => {
    const isMe = s.driverId === user.id;
    const isPlanner = user.role !== 'chauffeur';

    if (isMe) return true;
    if (!isPlanner) return false;

    const driver = users.find(u => u.id === s.driverId);
    return driver?.name.toLowerCase() !== 'beheerder';
  }).slice(0, 2);

  const formatShiftDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('nl-BE', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
  });

  const getServiceNumber = (shift: Shift) => String(shift.line || '--').trim() || '--';

  const getCountdown = (target: Date) => {
    const diff = target.getTime() - now.getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 24) return `${Math.floor(hours / 24)} dagen`;
    if (hours > 0) return `${hours}u ${minutes}m`;
    return `${minutes} minuten`;
  };

  return (
    <div className="space-y-8">
      {/* Next Shift Hero */}
      {nextShift && user.role === 'chauffeur' && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative overflow-hidden rounded-[28px] p-7 md:p-9"
          style={{ background: 'linear-gradient(135deg, #1e293b 0%, #0f172a 60%, #231509 100%)' }}
        >
          <div className="absolute top-0 right-0 w-80 h-80 rounded-full -mr-40 -mt-40 blur-3xl" style={{ background: 'radial-gradient(circle, rgba(245,158,11,0.18) 0%, transparent 70%)' }} />
          <div className="absolute bottom-0 left-0 w-48 h-48 rounded-full -ml-24 -mb-24 blur-3xl" style={{ background: 'radial-gradient(circle, rgba(245,158,11,0.08) 0%, transparent 70%)' }} />

          <div className="relative flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-oker-500/15 border border-oker-500/20 rounded-full mb-4">
                <div className="w-1.5 h-1.5 bg-oker-400 rounded-full animate-pulse" />
                <span className="text-[11px] font-bold text-oker-400 uppercase tracking-widest">Volgende dienst</span>
              </div>
              <h3 className="text-3xl md:text-4xl font-black tracking-tight text-white">
                Over <span className="text-oker-400">{getCountdown(nextShift.startDateTime)}</span>
              </h3>
              <p className="text-slate-400 text-sm font-medium mt-2">
                {nextShift.startDateTime.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' })} · aanvang {nextShift.startTime}
              </p>
            </div>

            <div className="flex gap-3 shrink-0">
              <div className="bg-white/6 border border-white/10 rounded-2xl px-6 py-4 text-center">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-1">Start</p>
                <p className="text-2xl font-black text-oker-400">{nextShift.startTime}</p>
              </div>
              <div className="bg-white/6 border border-white/10 rounded-2xl px-6 py-4 text-center">
                <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-widest mb-1">Einde</p>
                <p className="text-2xl font-black text-white">{nextShift.endTime}</p>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <StatCard 
          icon={<Clock className="text-oker-600" />} 
          label="Vandaag" 
          value={todaysShift?.startTime || '--:--'} 
          subValue={todaysShift ? `${todaysShift.startTime} - ${todaysShift.endTime}` : 'Geen dienst vandaag'} 
        />
        <StatCard 
          icon={<AlertTriangle className="text-red-500" />} 
          label="Actieve Omleidingen" 
          value={diversions.length.toString()} 
          subValue="Totaal aantal" 
        />
      </div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.2fr_0.8fr] lg:items-stretch">
        <section className="panel flex h-full min-h-[31rem] flex-col rounded-[32px] p-8">
          <div className="mb-8 flex items-center justify-between">
            <h3 className="font-black text-xl tracking-tight">Planning voor vandaag</h3>
            <span className="text-[10px] font-black bg-oker-50 text-oker-700 px-4 py-1.5 rounded-full uppercase tracking-widest">
              {now.toLocaleDateString('nl-BE', { day: '2-digit', month: 'short' })}
            </span>
          </div>
          <div className="flex flex-1 flex-col gap-4">
            {visibleShifts.map(shift => (
              <div key={shift.id} className="grid min-h-[8.25rem] grid-cols-[5.25rem_minmax(0,1fr)] items-center gap-5 rounded-[28px] border border-slate-100 bg-slate-50/55 p-5 transition-all duration-300 hover:bg-white hover:shadow-md">
                <div className="flex h-20 flex-col items-center justify-center rounded-[24px] border border-white/80 bg-white shadow-sm">
                  <p className="text-[9px] font-black uppercase tracking-[0.18em] text-slate-400">Dienst</p>
                  <p className="mt-1 text-xl font-black text-oker-500">{getServiceNumber(shift)}</p>
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{formatShiftDate(shift.date)}</p>
                    <span className="rounded-full border border-white/80 bg-white/80 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                      {shift.startTime} - {shift.endTime}
                    </span>
                  </div>
                  <p className="mt-3 text-xl font-black tracking-tight text-slate-900">{shift.startTime} - {shift.endTime}</p>
                  <p className="mt-1 text-sm font-medium text-slate-500">
                    {user.role === 'chauffeur'
                      ? 'Jouw eerstvolgende zichtbare inzet.'
                      : `Chauffeur: ${users.find(u => u.id === shift.driverId)?.name || 'Onbekend'}`}
                  </p>
                </div>
              </div>
            ))}
            {shifts.filter(s => s.driverId === user.id).length === 0 && user.role === 'chauffeur' && (
              <div className="flex flex-1 items-center justify-center text-center py-12">
                <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Calendar className="text-slate-200" size={32} />
                </div>
                <p className="text-slate-400 font-medium italic">Geen diensten gepland voor vandaag.</p>
              </div>
            )}
          </div>
        </section>

        <section className="panel flex h-full min-h-[31rem] flex-col rounded-[32px] p-8">
          <div className="mb-8 flex items-center justify-between">
            <h3 className="font-black text-xl tracking-tight">Nieuwe Omleidingen</h3>
            <span className="text-[10px] font-black bg-slate-100 text-slate-500 px-4 py-1.5 rounded-full uppercase tracking-widest">
              {Math.min(newestDiversions.length, 3)} getoond
            </span>
          </div>
          <div className="flex flex-1 flex-col gap-4">
            {newestDiversions.map(div => (
              <div key={div.id} className="flex min-h-[8.25rem] gap-5 rounded-[28px] border border-oker-100/80 bg-oker-50/25 p-5 transition-all group hover:bg-oker-50/45">
                <div className="shrink-0 mt-1">
                  <AlertTriangle size={24} className="text-oker-600" />
                </div>
                <div className="flex min-w-0 flex-1 flex-col justify-between">
                  <p className="font-black text-lg text-slate-900">{div.title}</p>
                  <p className="text-sm text-slate-500 mt-1 line-clamp-2 font-medium leading-relaxed">{div.description}</p>
                  <div className="flex items-center gap-2 mt-3">
                    <span className="px-2 py-0.5 bg-oker-100 text-oker-700 rounded text-[10px] font-black uppercase">{div.line}</span>
                  </div>
                </div>
              </div>
            ))}
            {diversions.length === 0 && (
              <div className="flex flex-1 items-center justify-center">
                <EmptyState
                  icon={<MapPin size={28} />}
                  title="Geen actieve hinder"
                  message="Er zijn momenteel geen omleidingen geregistreerd."
                />
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function DiversionsView({ diversions }: { diversions: Diversion[] }) {
  const [selectedDiversion, setSelectedDiversion] = useState<Diversion | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLine, setSelectedLine] = useState<string>('all');

  // Get unique line numbers for the filter
  const uniqueLines = Array.from(new Set(diversions.map(div => div.line))).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const filteredDiversions = diversions.filter(div => {
    const matchesSearch = div.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      div.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      div.line.toLowerCase().includes(searchQuery.toLowerCase());
    
    const matchesLine = selectedLine === 'all' || div.line === selectedLine;
    
    return matchesSearch && matchesLine;
  });

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h3 className="text-2xl font-black tracking-tight">Actuele Omleidingen</h3>
        <div className="flex flex-col sm:flex-row gap-3 w-full md:w-auto">
          <div className="relative group">
            <select
              value={selectedLine}
              onChange={(e) => setSelectedLine(e.target.value)}
              className="control-input appearance-none w-full sm:w-40 pl-4 pr-10 py-3 rounded-2xl focus:outline-none transition-all font-bold text-sm cursor-pointer"
            >
              <option value="all">Alle Lijnen</option>
              {uniqueLines.map(line => (
                <option key={line} value={line}>Lijn {line}</option>
              ))}
            </select>
            <div className="absolute inset-y-0 right-0 pr-4 flex items-center pointer-events-none text-slate-400">
              <ChevronDown size={16} />
            </div>
          </div>
          <div className="relative flex-1 md:w-72 group">
            <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
              <Search size={18} className="text-slate-400 group-focus-within:text-oker-500 transition-colors" />
            </div>
            <input
              type="text"
              placeholder="Zoek..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="control-input w-full pl-11 pr-4 py-3 rounded-2xl focus:outline-none transition-all font-medium text-sm"
            />
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-300 hover:text-slate-500"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
      
      <div className="space-y-4">
        {filteredDiversions.length > 0 ? (
          filteredDiversions.map(div => (
            <div key={div.id} className="surface-card surface-card-hover rounded-[32px] overflow-hidden group duration-300">
            <div 
              onClick={() => setSelectedDiversion(selectedDiversion?.id === div.id ? null : div)}
              className="p-6 md:p-8 cursor-pointer hover:bg-slate-50/50 transition-colors flex items-start justify-between gap-4"
            >
              <div className="flex gap-4 md:gap-6">
                <div className={cn(
                  "w-12 h-12 md:w-16 md:h-16 rounded-2xl flex items-center justify-center shrink-0 transition-transform duration-500 group-hover:scale-110",
                  div.severity === 'high' ? "bg-red-50 text-red-600 border border-red-100" : 
                  div.severity === 'medium' ? "bg-amber-50 text-amber-600 border border-amber-100" : "bg-blue-50 text-blue-600 border border-blue-100"
                )}>
                  <MapPin size={24} className="md:size-8" />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    <h4 className="font-black text-lg md:text-xl text-slate-800 tracking-tight">{div.title}</h4>
                    <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-[10px] font-black uppercase tracking-widest">{div.line}</span>
                  </div>
                  <p className="text-slate-400 text-xs md:text-sm font-bold uppercase tracking-widest">
                    {selectedDiversion?.id === div.id ? 'Tik om te sluiten' : 'Tik voor meer info'}
                  </p>
                </div>
              </div>
              <motion.div 
                animate={{ rotate: selectedDiversion?.id === div.id ? 90 : 0 }}
                className="p-2 text-slate-300 mt-1"
              >
                <ChevronRight size={24} />
              </motion.div>
            </div>

            <AnimatePresence>
              {selectedDiversion?.id === div.id && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  className="overflow-hidden bg-white/35 border-t border-white/60"
                >
                  <div className="p-6 md:p-8 space-y-6">
                    <div className="grid md:grid-cols-2 gap-8">
                      <div className="space-y-6">
                        <div className="prose prose-slate max-w-none">
                          <p className="text-slate-700 leading-relaxed font-medium text-sm md:text-base">{div.description}</p>
                        </div>
                        
                        <div className="flex flex-wrap items-center gap-4 md:gap-8">
                          <div className="flex items-center gap-2 text-[10px] md:text-xs text-slate-400 font-black uppercase tracking-widest">
                            <Calendar size={14} className="text-oker-400" />
                            <span>Start: {div.startDate}</span>
                          </div>
                          {div.endDate && (
                            <div className="flex items-center gap-2 text-[10px] md:text-xs text-slate-400 font-black uppercase tracking-widest">
                              <Calendar size={14} className="text-oker-400" />
                              <span>Eind: {div.endDate}</span>
                            </div>
                          )}
                        </div>
                        
                        {div.pdfUrl ? (
                          <div className="pt-2 flex flex-col sm:flex-row gap-3">
                            <a 
                              href={div.pdfUrl} 
                              target="_blank" 
                              rel="noopener noreferrer"
                              className="control-button-soft flex-1 flex items-center justify-center gap-3 px-6 py-4 rounded-2xl text-sm font-black text-slate-700 transition-all active:scale-95"
                            >
                              <FileText size={18} className="text-red-500" />
                              BEKIJK PDF
                            </a>
                            <a 
                              href={div.pdfUrl} 
                              download
                              className="flex-1 flex items-center justify-center gap-3 px-6 py-4 bg-emerald-500 rounded-2xl text-sm font-black text-white hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20 active:scale-95"
                            >
                              <Download size={18} />
                              DOWNLOAD PDF
                            </a>
                          </div>
                        ) : (
                          <div className="p-4 bg-slate-100/50 rounded-2xl border border-dashed border-slate-200 text-center">
                            <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Geen PDF bijlage beschikbaar</p>
                          </div>
                        )}
                      </div>

                      {div.mapCoordinates && (
                        <div className="space-y-2">
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Visuele Omleiding</p>
                          <div className="h-64 rounded-3xl overflow-hidden border border-slate-100 shadow-inner z-0">
                            <Suspense
                              fallback={
                                <div className="flex h-full items-center justify-center bg-white/60 text-sm font-bold text-slate-500">
                                  Kaart laden...
                                </div>
                              }
                            >
                              <DiversionMap
                                coordinates={JSON.parse(div.mapCoordinates)}
                                severity={div.severity}
                              />
                            </Suspense>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))
      ) : (
        <div className="text-center py-20 surface-card rounded-[40px] border border-dashed border-white/80">
          <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-6">
            <Search size={32} className="text-slate-300" />
          </div>
          <h4 className="text-xl font-black text-slate-800 tracking-tight">Geen resultaten</h4>
          <p className="text-slate-400 font-medium mt-2">Geen omleidingen gevonden voor "{searchQuery}"</p>
          <button 
            onClick={() => setSearchQuery('')}
            className="mt-6 text-oker-500 font-black uppercase tracking-widest text-xs hover:text-oker-600 transition-colors"
          >
            Wis zoekopdracht
          </button>
        </div>
      )}
    </div>
  </div>
);
}

function ScheduleView({ user, shifts: allShifts, users }: { user: User, shifts: Shift[], users: User[] }) {
  const shifts = allShifts.filter(s => {
    const isMe = s.driverId === user.id;
    const isPlanner = user.role !== 'chauffeur';
    
    if (isMe) return true;
    if (!isPlanner) return false;

    const driver = users.find(u => u.id === s.driverId);
    if (driver?.name.toLowerCase() === 'beheerder') return false;
    
    return true;
  });
  const formatShiftDate = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('nl-BE', {
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
  const getServiceNumber = (shift: Shift) => String(shift.line || '--').trim() || '--';

  const exportToICS = () => {
    const calendarHeader = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//VHB Portaal//NL',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH'
    ].join('\r\n');

    const calendarFooter = 'END:VCALENDAR';

    const events = shifts.map(shift => {
      const [year, month, day] = shift.date.split('-').map(Number);
      const [startH, startM] = shift.startTime.split(':').map(Number);
      const [endH, endM] = shift.endTime.split(':').map(Number);

      const startDate = new Date(year, month - 1, day, startH, startM);
      const endDate = new Date(year, month - 1, day, endH, endM);

      const formatICSDate = (date: Date) => {
        return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      };

      return [
        'BEGIN:VEVENT',
        `UID:${shift.id}@vhb-portaal.be`,
        `DTSTAMP:${formatICSDate(new Date())}`,
        `DTSTART:${formatICSDate(startDate)}`,
        `DTEND:${formatICSDate(endDate)}`,
        `SUMMARY:VHB Dienst`,
        `DESCRIPTION:Dienst ${shift.startTime} - ${shift.endTime}`,
        'END:VEVENT'
      ].join('\r\n');
    }).join('\r\n');

    const fullCalendar = `${calendarHeader}\r\n${events}\r\n${calendarFooter}`;
    const blob = new Blob([fullCalendar], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    link.setAttribute('download', `VHB_Rooster_${user.name.replace(/\s+/g, '_')}.ics`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h3 className="text-2xl font-black tracking-tight">Mijn Werkrooster</h3>
          <p className="mt-1 text-sm font-medium text-slate-500">Overzicht van je komende diensten, met dienstnummer en tijdsvenster.</p>
        </div>
        <button 
          onClick={exportToICS}
          className="control-button-soft flex items-center gap-2 px-6 py-3 rounded-2xl font-black text-xs uppercase tracking-widest text-slate-600 transition-all active:scale-95"
        >
          <Download size={16} className="text-oker-500" />
          Export naar Agenda
        </button>
      </div>

      {/* Desktop Table */}
      <div className="hidden md:block surface-table rounded-[32px] overflow-hidden">
        {shifts.length > 0 ? (
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Datum</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Dienst</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Tijd</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {shifts.map(shift => (
                <tr key={shift.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-8 py-6">
                    <div className="space-y-1">
                      <p className="font-black text-slate-800">{formatShiftDate(shift.date)}</p>
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{shift.date}</p>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <div className="inline-flex min-w-[7rem] flex-col rounded-[22px] border border-white/80 bg-white/80 px-4 py-3 shadow-sm">
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Dienstnummer</p>
                      <p className="mt-1 font-black text-oker-700">{getServiceNumber(shift)}</p>
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <div className="space-y-1">
                      <div className="flex items-center gap-3 text-slate-700 font-bold">
                        <Clock size={16} className="text-oker-400" />
                        {shift.startTime} - {shift.endTime}
                      </div>
                      <p className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">Geplande inzet</p>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="p-6">
            <EmptyState
              icon={<Calendar size={28} />}
              title="Geen diensten gepland"
              message="Zodra er planning beschikbaar is, verschijnt die hier."
            />
          </div>
        )}
      </div>

      {/* Mobile Cards */}
      <div className="md:hidden space-y-4">
        {shifts.map(shift => (
          <div key={shift.id} className="surface-card p-6 rounded-[32px] space-y-4">
            <div>
              <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest mb-1">Datum</p>
              <p className="font-black text-slate-800">{formatShiftDate(shift.date)}</p>
              <p className="mt-1 text-[10px] font-black uppercase tracking-[0.16em] text-slate-400">{shift.date}</p>
            </div>

            <div className="rounded-[24px] border border-white/80 bg-white/75 px-4 py-4">
              <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest mb-1">Dienstnummer</p>
              <p className="font-black text-oker-700">{getServiceNumber(shift)}</p>
            </div>
            
            <div className="flex items-center gap-4 p-4 surface-muted rounded-2xl">
              <div className="w-12 h-12 bg-white/80 rounded-xl flex items-center justify-center shadow-sm ring-1 ring-white/80">
                <Clock size={20} className="text-oker-500" />
              </div>
              <div>
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tijdstip</p>
                <p className="font-black text-slate-800">{shift.startTime} - {shift.endTime}</p>
              </div>
            </div>
          </div>
        ))}
        {shifts.length === 0 && (
          <EmptyState
            icon={<Calendar size={28} />}
            title="Geen diensten gepland"
            message="Zodra er planning beschikbaar is, verschijnt die hier."
          />
        )}
      </div>
    </div>
  );
}

function ActivityLogView({ entries }: { entries: ActivityLogEntry[] }) {
  const categoryLabels: Record<ActivityLogEntry['category'], string> = {
    users: 'Gebruikers',
    planning: 'Planning',
    planning_codes: 'Planningscodes',
    services: 'Diensten',
    diversions: 'Omleidingen',
    updates: 'Updates',
    auth: 'Authenticatie',
  };
  const [activeCategory, setActiveCategory] = useState<'all' | ActivityLogEntry['category']>('all');
  const [dateWindow, setDateWindow] = useState<'all' | 'today' | '7d' | '30d'>('7d');
  const [searchTerm, setSearchTerm] = useState('');

  const filteredEntries = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const now = Date.now();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    return entries.filter((entry) => {
      const categoryMatch = activeCategory === 'all' || entry.category === activeCategory;
      if (!categoryMatch) {
        return false;
      }

      const createdAt = new Date(entry.createdAt).getTime();
      const dateMatch = dateWindow === 'all'
        ? true
        : dateWindow === 'today'
          ? createdAt >= startOfToday.getTime()
          : dateWindow === '7d'
            ? createdAt >= now - (7 * 24 * 60 * 60 * 1000)
            : createdAt >= now - (30 * 24 * 60 * 60 * 1000);
      if (!dateMatch) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const haystack = [entry.action, entry.details, entry.actorName, categoryLabels[entry.category]]
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [activeCategory, categoryLabels, dateWindow, entries, searchTerm]);

  const exportFilteredActivity = () => {
    const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const rows = filteredEntries.map((entry) => [
      entry.createdAt,
      categoryLabels[entry.category],
      entry.action,
      entry.actorName,
      entry.actorRole,
      entry.details,
    ]);
    const csv = [
      ['tijdstip', 'categorie', 'actie', 'actor', 'rol', 'details'],
      ...rows,
    ]
      .map((row) => row.map((cell) => escapeCsv(String(cell ?? ''))).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateSuffix = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `vhb-activiteit-${dateWindow}-${dateSuffix}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-5xl space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard icon={<Activity className="text-oker-600" />} label="Acties" value={entries.length.toString()} subValue="Laatste 100 wijzigingen" />
        <StatCard icon={<Users className="text-slate-600" />} label="Gebruikersacties" value={entries.filter((entry) => entry.category === 'users').length.toString()} subValue="Accounts en rollen" />
        <StatCard icon={<Calendar className="text-emerald-600" />} label="Planning" value={entries.filter((entry) => entry.category === 'planning' || entry.category === 'planning_codes').length.toString()} subValue="Imports, sync en codes" />
      </div>

      <section className="surface-card rounded-[32px] p-6 md:p-8">
        <AdminSubsectionHeader
          eyebrow="Auditspoor"
          title="Recente activiteit"
          description="Alleen admins zien hier recente beheeracties en belangrijke wijzigingen."
          aside={<div className="rounded-full border border-white/70 bg-white/55 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">{filteredEntries.length} items</div>}
        />

        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
          <div className="space-y-4">
            <label className="surface-muted flex items-center gap-3 rounded-[24px] px-4 py-3">
              <Search size={18} className="text-slate-400" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Zoek op actie, details of actor..."
                className="w-full bg-transparent text-sm font-semibold text-slate-700 outline-none placeholder:text-slate-400"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setDateWindow('today')}
                className={cn(
                  'rounded-full border px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] transition-colors',
                  dateWindow === 'today'
                    ? 'border-oker-200 bg-oker-50 text-oker-700'
                    : 'border-white/80 bg-white/70 text-slate-500 hover:text-slate-700',
                )}
              >
                Vandaag
              </button>
              <button
                onClick={() => setDateWindow('7d')}
                className={cn(
                  'rounded-full border px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] transition-colors',
                  dateWindow === '7d'
                    ? 'border-oker-200 bg-oker-50 text-oker-700'
                    : 'border-white/80 bg-white/70 text-slate-500 hover:text-slate-700',
                )}
              >
                7 dagen
              </button>
              <button
                onClick={() => setDateWindow('30d')}
                className={cn(
                  'rounded-full border px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] transition-colors',
                  dateWindow === '30d'
                    ? 'border-oker-200 bg-oker-50 text-oker-700'
                    : 'border-white/80 bg-white/70 text-slate-500 hover:text-slate-700',
                )}
              >
                30 dagen
              </button>
              <button
                onClick={() => setDateWindow('all')}
                className={cn(
                  'rounded-full border px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] transition-colors',
                  dateWindow === 'all'
                    ? 'border-oker-200 bg-oker-50 text-oker-700'
                    : 'border-white/80 bg-white/70 text-slate-500 hover:text-slate-700',
                )}
              >
                Alles
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 lg:max-w-[32rem] lg:justify-end">
            <button
              onClick={() => setActiveCategory('all')}
              className={cn(
                'rounded-full border px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] transition-colors',
                activeCategory === 'all'
                  ? 'border-oker-200 bg-oker-50 text-oker-700'
                  : 'border-white/80 bg-white/70 text-slate-500 hover:text-slate-700',
              )}
            >
              Alles
            </button>
            {(Object.keys(categoryLabels) as ActivityLogEntry['category'][]).map((category) => (
              <button
                key={category}
                onClick={() => setActiveCategory(category)}
                className={cn(
                  'rounded-full border px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] transition-colors',
                  activeCategory === category
                    ? 'border-oker-200 bg-oker-50 text-oker-700'
                    : 'border-white/80 bg-white/70 text-slate-500 hover:text-slate-700',
                )}
              >
                {categoryLabels[category]}
              </button>
            ))}
            <button
              onClick={exportFilteredActivity}
              disabled={filteredEntries.length === 0}
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] transition-colors',
                filteredEntries.length === 0
                  ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-300'
                  : 'border-white/80 bg-white/80 text-slate-600 hover:text-slate-900',
              )}
            >
              <Download size={14} />
              Exporteer CSV
            </button>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          {filteredEntries.length > 0 ? filteredEntries.map((entry) => (
            <div key={entry.id} className="rounded-[26px] border border-white/70 bg-white/50 p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-white/80 bg-white/80 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                      {categoryLabels[entry.category]}
                    </span>
                    <p className="text-sm font-black text-slate-900">{entry.action}</p>
                  </div>
                  <p className="mt-2 text-sm font-medium leading-6 text-slate-500">{entry.details}</p>
                </div>
                <div className="shrink-0 text-left md:text-right">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{entry.actorRole}</p>
                  <p className="mt-1 text-sm font-bold text-slate-800">{entry.actorName}</p>
                  <p className="mt-1 text-xs font-medium text-slate-400">
                    {new Date(entry.createdAt).toLocaleString('nl-BE', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>
            </div>
          )) : (
            <EmptyState
              icon={<Activity size={28} />}
              title={entries.length > 0 ? 'Geen resultaten voor deze filter' : 'Nog geen activiteit gelogd'}
              message={entries.length > 0 ? 'Pas je categorie of zoekterm aan om andere activiteiten te tonen.' : 'Zodra admins beheeracties uitvoeren, verschijnen ze hier automatisch.'}
            />
          )}
        </div>
      </section>
    </div>
  );
}

function DebugView() {
  const [healthData, setHealthData] = useState<any>(null);
  const [isCheckingHealth, setIsCheckingHealth] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);

  const checkHealth = async () => {
    try {
      setIsCheckingHealth(true);
      const response = await fetch('/api/health');
      const data = await response.json();
      setHealthData(data);
    } catch (error) {
      console.error('Health check error:', error);
    } finally {
      setIsCheckingHealth(false);
    }
  };

  const testWrite = async () => {
    try {
      setIsTesting(true);
      setTestResult(null);
      
      // First test general POST
      const testResponse = await fetch('/api/test', {
        method: 'POST',
        headers: await getSupabaseAuthHeaders(),
        body: JSON.stringify({ test: true })
      });
      
      if (!testResponse.ok) {
        setTestResult(`Algemene POST test mislukt (${testResponse.status}). Dit duidt op een server/Vercel configuratie probleem.`);
        return;
      }

      const response = await fetch('/api/users', {
        method: 'POST',
        headers: await getSupabaseAuthHeaders(),
        body: JSON.stringify([{
          id: 'test-' + Date.now(),
          name: 'Test Gebruiker',
          role: 'chauffeur',
          employeeId: 'TEST-000',
          email: `test-${Date.now()}@example.com`,
          password: 'Test1234!',
          isActive: false
        }])
      });
      
      const text = await response.text();
      if (response.ok) {
        setTestResult('Succes! Schrijven naar database werkt.');
      } else {
        setTestResult(`Fout (${response.status}): ${text}`);
      }
    } catch (error: any) {
      setTestResult(`Fout: ${error.message}`);
    } finally {
      setIsTesting(false);
    }
  };

  useEffect(() => {
    checkHealth();
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-2xl font-black tracking-tight">Systeem Status (Debug)</h3>
        <div className="flex items-center gap-3">
          <button 
            onClick={testWrite}
            disabled={isTesting}
            className="px-4 py-2 bg-oker-500 text-white rounded-xl font-bold text-sm hover:bg-oker-600 disabled:opacity-50"
          >
            {isTesting ? 'Testen...' : 'Test Schrijven'}
          </button>
          <button 
            onClick={checkHealth}
            disabled={isCheckingHealth}
            className="px-4 py-2 bg-slate-100 rounded-xl text-slate-600 font-bold text-sm hover:bg-slate-200 disabled:opacity-50"
          >
            {isCheckingHealth ? 'Controleren...' : 'Ververs Status'}
          </button>
        </div>
      </div>
      
      {testResult && (
        <div className={cn(
          "p-4 rounded-2xl text-sm font-bold",
          testResult.startsWith('Succes') ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-red-50 text-red-700 border border-red-100"
        )}>
          {testResult}
        </div>
      )}
      
              {healthData && (
                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="surface-card p-6 rounded-[32px]">
                      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Supabase Status</h4>
                      <div className="space-y-3">
                        <div className="flex justify-between items-center">
                          <span className="text-sm font-bold text-slate-600">Configuratie:</span>
                          <span className={cn("px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest", healthData.supabase === 'configured' ? "bg-emerald-50 text-emerald-500" : "bg-red-50 text-red-500")}>
                            {healthData.supabase}
                          </span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm font-bold text-slate-600">Omgeving:</span>
                          <span className="text-sm font-black text-slate-800">{healthData.env}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-sm font-bold text-slate-600">Server Tijd:</span>
                          <span className="text-xs font-mono text-slate-500">{new Date(healthData.time).toLocaleString()}</span>
                        </div>
                      </div>
                    </div>

                    <div className="surface-card p-6 rounded-[32px]">
                      <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-4">Tabel Status</h4>
                      <div className="space-y-3">
                        {Object.entries(healthData.tables || {}).map(([name, status]: [string, any]) => (
                          <div key={name} className="flex flex-col gap-1">
                            <div className="flex justify-between items-center">
                              <span className="text-sm font-bold text-slate-600 capitalize">{name}:</span>
                              <span className={cn("px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest", status === 'OK' ? "bg-emerald-50 text-emerald-500" : "bg-red-50 text-red-500")}>
                                {status === 'OK' ? 'OK' : 'ERROR'}
                              </span>
                            </div>
                            {status !== 'OK' && (
                              <p className="text-[10px] text-red-400 font-mono break-all bg-red-50 p-2 rounded-lg mt-1">
                                {status}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="bg-slate-900 p-6 rounded-[32px] text-slate-300 font-mono text-xs overflow-auto max-h-64">
                    <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-4">Raw Health Data</h4>
                    <pre>{JSON.stringify(healthData, null, 2)}</pre>
                  </div>
                </div>
              )}
      
      <div className="bg-oker-50 p-8 rounded-[40px] border border-oker-100">
        <div className="flex items-start gap-4">
          <div className="p-3 bg-oker-500 text-white rounded-2xl shadow-lg shadow-oker-500/20">
            <Activity size={24} />
          </div>
          <div>
            <h4 className="text-oker-900 font-black text-lg mb-2">Hulp bij problemen</h4>
            <p className="text-oker-800 text-sm leading-relaxed font-medium">
              Als de tabellen hierboven "Error" of "Exception" aangeven, betekent dit dat de tabel waarschijnlijk nog niet bestaat in Supabase of dat de rechten niet goed staan. 
              Zorg ervoor dat je de tabellen <code className="bg-oker-100 px-1 rounded font-black">users</code>, <code className="bg-oker-100 px-1 rounded font-black">planning</code>, <code className="bg-oker-100 px-1 rounded font-black">diversions</code> en <code className="bg-oker-100 px-1 rounded font-black">services</code> hebt aangemaakt in je Supabase project.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function UpdatesView({ updates }: { updates: Update[] }) {
  const [filter, setFilter] = useState<'all' | 'algemeen' | 'veiligheid' | 'technisch'>('all');
  const [expandedUpdateIds, setExpandedUpdateIds] = useState<string[]>([]);

  const filteredUpdates = updates.filter(u => filter === 'all' || u.category === filter);
  const toggleExpanded = (id: string) => {
    setExpandedUpdateIds((current) => (
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id]
    ));
  };

  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h3 className="text-2xl font-black tracking-tight">Updates & Nieuws</h3>
          <div className="glass-segmented flex p-1 rounded-xl">
          {(['all', 'algemeen', 'veiligheid', 'technisch'] as const).map(cat => (
            <button
              key={cat}
              onClick={() => setFilter(cat)}
              className={cn(
                "px-4 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all",
                filter === cat ? "glass-chip text-oker-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
              )}
            >
              {cat === 'all' ? 'Alles' : cat}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-6">
        {filteredUpdates.length > 0 ? (
          filteredUpdates.map(update => {
            const isExpanded = expandedUpdateIds.includes(update.id);
            const shouldTruncate = update.content.length > 220;
            const visibleContent = shouldTruncate && !isExpanded
              ? `${update.content.slice(0, 220).trimEnd()}...`
              : update.content;

            return (
            <div key={update.id} className="surface-card surface-card-hover p-6 md:p-8 rounded-[32px] relative overflow-hidden group duration-300">
              <div className={cn(
                "absolute top-0 left-0 w-1.5 h-full",
                update.isUrgent ? "bg-red-600" :
                update.category === 'veiligheid' ? "bg-red-500" : 
                update.category === 'technisch' ? "bg-blue-500" : "bg-emerald-500"
              )} />
              
              <div className="flex justify-between items-center mb-6">
                <div className="flex gap-2">
                  <span className={cn(
                    "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-[0.15em]",
                    update.category === 'veiligheid' ? "bg-red-50 text-red-600" : 
                    update.category === 'technisch' ? "bg-blue-50 text-blue-600" : "bg-emerald-50 text-emerald-600"
                  )}>
                    {update.category}
                  </span>
                  {update.isUrgent && (
                    <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-[0.15em] bg-red-600 text-white flex items-center gap-1">
                      <AlertTriangle size={10} /> DRINGEND
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 text-[10px] text-slate-400 font-black uppercase tracking-widest">
                  <Clock size={12} className="text-slate-300" />
                  {update.date}
                </div>
              </div>
              
              <h4 className="text-xl font-black text-slate-800 mb-4 group-hover:text-oker-500 transition-colors leading-tight">{update.title}</h4>
              <p className="text-slate-600 leading-relaxed font-medium text-sm md:text-base whitespace-pre-wrap">{visibleContent}</p>
              
              {shouldTruncate ? (
                <div className="mt-6 pt-6 border-t border-slate-50 flex justify-end">
                  <button
                    type="button"
                    onClick={() => toggleExpanded(update.id)}
                    className="text-[10px] font-black text-oker-500 uppercase tracking-widest hover:text-oker-600 transition-colors flex items-center gap-2"
                  >
                    {isExpanded ? 'Toon minder' : 'Lees meer'}
                    <ChevronRight size={14} className={cn("transition-transform", isExpanded && "rotate-90")} />
                  </button>
                </div>
              ) : null}
            </div>
          );
          })
        ) : (
          <div className="surface-card p-12 rounded-[32px] text-center">
            <Info size={48} className="mx-auto text-slate-200 mb-4" />
            <p className="text-slate-400 font-bold">Geen updates gevonden in deze categorie.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ManageSchedulesView({ shifts, onSave, users, history, canAdminOverride, onMatrixImported }: { shifts: Shift[], onSave: (s: Shift[]) => void, users: User[], history: PlanningMatrixImportHistory[], canAdminOverride: boolean, onMatrixImported: () => Promise<void> }) {
  const [jsonInput, setJsonInput] = useState('');
  const [showExcelInfo, setShowExcelInfo] = useState(false);
  const [confirmSyncOpen, setConfirmSyncOpen] = useState(false);
  const [isMatrixImporting, setIsMatrixImporting] = useState(false);
  const [matrixPreviewOpen, setMatrixPreviewOpen] = useState(false);
  const [pendingMatrixCsv, setPendingMatrixCsv] = useState('');
  const [matrixPreview, setMatrixPreview] = useState<null | {
    importedDays: number;
    detectedDrivers: number;
    generatedShifts: number;
    matchedServices: number;
    skippedAbsences: number;
    unknownCodes: string[];
    unmatchedDrivers: string[];
  }>(null);
  const matrixPreviewHasIssues = !!matrixPreview && (matrixPreview.unknownCodes.length > 0 || matrixPreview.unmatchedDrivers.length > 0);

  const handleImport = () => {
    if (!canAdminOverride) {
      notify('JSON fallback-import is alleen beschikbaar voor admins.', 'error');
      return;
    }
    try {
      const data = JSON.parse(jsonInput);
      if (Array.isArray(data)) {
        onSave(data);
        setJsonInput('');
        notify('Planning succesvol geïmporteerd!', 'success');
      } else {
        notify('Ongeldig formaat. Zorg dat het een array van diensten is.', 'error');
      }
    } catch (e) {
      notify('Fout bij het parsen van JSON. Controleer de syntax.', 'error');
    }
  };

  const [isSyncing, setIsSyncing] = useState(false);

  const handleMatrixFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setIsMatrixImporting(true);
      const csvContent = await file.text();
      const response = await fetch('/api/planning-matrix/preview', {
        method: 'POST',
        headers: await getSupabaseAuthHeaders(),
        body: JSON.stringify({ csvContent }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.details || data.error || 'Import mislukt.');
      }

      setPendingMatrixCsv(csvContent);
      setMatrixPreview({
        importedDays: data.importedDays || 0,
        detectedDrivers: data.detectedDrivers || 0,
        generatedShifts: data.generatedShifts || 0,
        matchedServices: data.matchedServices || 0,
        skippedAbsences: data.skippedAbsences || 0,
        unknownCodes: Array.isArray(data.unknownCodes) ? data.unknownCodes : [],
        unmatchedDrivers: Array.isArray(data.unmatchedDrivers) ? data.unmatchedDrivers : [],
      });
      setMatrixPreviewOpen(true);
    } catch (error: any) {
      notify(`CSV-preview mislukt: ${error.message}`, 'error');
    } finally {
      setIsMatrixImporting(false);
      if (event.target) event.target.value = '';
    }
  };

  const confirmMatrixImport = async () => {
    if (!pendingMatrixCsv.trim()) {
      notify('Er is geen matrixbestand klaar om te importeren.', 'error');
      return;
    }

    try {
      setIsMatrixImporting(true);
      const response = await fetch('/api/planning-matrix/import', {
        method: 'POST',
        headers: await getSupabaseAuthHeaders(),
        body: JSON.stringify({ csvContent: pendingMatrixCsv }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.details || data.error || 'Import mislukt.');
      }

      const syncNotes: string[] = [];
      if (Array.isArray(data.unknownCodes) && data.unknownCodes.length > 0) {
        syncNotes.push(`${data.unknownCodes.length} onbekende code${data.unknownCodes.length === 1 ? '' : 's'}`);
      }
      if (Array.isArray(data.unmatchedDrivers) && data.unmatchedDrivers.length > 0) {
        syncNotes.push(`${data.unmatchedDrivers.length} niet-gematchte chauffeur${data.unmatchedDrivers.length === 1 ? '' : 's'}`);
      }

      notify(
        `Matrixplanning geïmporteerd: ${data.importedDays || 0} dagen, ${data.generatedShifts || 0} roosterregels opgebouwd${syncNotes.length ? `, ${syncNotes.join(', ')}` : ''}.`,
        'success'
      );
      setMatrixPreviewOpen(false);
      setPendingMatrixCsv('');
      setMatrixPreview(null);
      await onMatrixImported();
    } catch (error: any) {
      notify(`CSV-import mislukt: ${error.message}`, 'error');
    } finally {
      setIsMatrixImporting(false);
    }
  };

  const handleSync = async () => {
    if (!canAdminOverride) {
      notify('Deze synchronisatie is alleen beschikbaar voor admins.', 'error');
      return;
    }
    try {
      setIsSyncing(true);
      const response = await fetch('/api/planning/sync-from-matrix', {
        method: 'POST',
        headers: await getSupabaseAuthHeaders(),
      });
      const text = await response.text();
      
      if (!response.ok && !text.startsWith('{')) {
        throw new Error(`Server fout (${response.status}): ${text.slice(0, 200) || 'Lege response'}`);
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.error('Failed to parse JSON. Response text:', text);
        throw new Error('Server gaf geen geldig JSON-antwoord terug. Controleer de console voor details.');
      }

      if (data.success) {
        const syncNotes: string[] = [];
        if (Array.isArray(data.unknownCodes) && data.unknownCodes.length > 0) {
          syncNotes.push(`${data.unknownCodes.length} onbekende code${data.unknownCodes.length === 1 ? '' : 's'}`);
        }
        if (Array.isArray(data.unmatchedDrivers) && data.unmatchedDrivers.length > 0) {
          syncNotes.push(`${data.unmatchedDrivers.length} niet-gematchte chauffeur${data.unmatchedDrivers.length === 1 ? '' : 's'}`);
        }
        notify(`Planning opnieuw opgebouwd: ${data.generatedShifts || 0} roosterregels${syncNotes.length ? `, ${syncNotes.join(', ')}` : ''}.`, 'success');
        await onMatrixImported();
      } else {
        notify('Synchronisatie mislukt: ' + (data.error || 'Onbekende fout'), 'error');
      }
    } catch (error: any) {
      console.error('Sync error:', error);
      notify('Er is een fout opgetreden bij het synchroniseren: ' + error.message, 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-6 md:space-y-8">
      <AdminPageHeader
        eyebrow="Planningbeheer"
        title="Beheer Roosters"
        description="Importeer matrixplanning, bouw de actieve planning opnieuw op en controleer recente imports op problemen voordat je iets overschrijft."
        actions={canAdminOverride ? (
          <button 
            onClick={() => setConfirmSyncOpen(true)}
            disabled={isSyncing}
            className="w-full sm:w-auto bg-emerald-500 text-white px-6 py-3 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 active:scale-95"
            title="Synchroniseer lokale JSON data naar Supabase"
          >
            <RotateCcw size={18} className={isSyncing ? "animate-spin" : ""} />
            {isSyncing ? 'Synchroniseren...' : 'Sync naar DB'}
          </button>
        ) : null}
      />
      <div className="grid gap-4 xl:grid-cols-[1.4fr_minmax(0,0.9fr)]">
        <div className="surface-card rounded-[32px] p-6 md:p-8">
          <AdminSubsectionHeader
            eyebrow="Importbronnen"
            title="Matrix en fallback-import"
            description="Gebruik matrix CSV als primaire bron. JSON-import blijft beschikbaar voor oudere rij-per-dienst exports."
            aside={showExcelInfo ? (
              <button
                onClick={() => setShowExcelInfo(false)}
                className="rounded-full border border-white/70 bg-white/60 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 transition hover:text-slate-800"
              >
                Info verbergen
              </button>
            ) : (
              <button
                onClick={() => setShowExcelInfo(true)}
                className="rounded-full border border-white/70 bg-white/60 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500 transition hover:text-slate-800"
              >
                Info tonen
              </button>
            )}
          />

          {showExcelInfo && (
            <div className="mt-5 rounded-[24px] border border-oker-100 bg-oker-50/80 p-5 text-sm">
              <p className="font-bold text-oker-800">Importvolgorde</p>
              <ol className="mt-3 list-decimal space-y-2 pl-5 text-oker-700">
                <li>Gebruik matrix CSV voor de originele dagplanning per chauffeur.</li>
                <li>Controleer eerst de preview op onbekende codes en niet-gematchte chauffeurs.</li>
                <li>Gebruik JSON alleen voor oudere exports in rij-per-dienst formaat.</li>
              </ol>
            </div>
          )}

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <div className="rounded-[28px] border border-emerald-100 bg-emerald-50/70 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-700">Primair</p>
                  <h4 className="mt-2 text-base font-black tracking-tight text-slate-900">Matrix CSV Upload</h4>
                  <p className="mt-2 text-sm font-medium text-slate-600">
                    Upload je originele dagmatrix. De app toont eerst een preview en vervangt daarna pas de planning.
                  </p>
                </div>
                <span className="rounded-full border border-emerald-200 bg-white/80 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-emerald-700">
                  Aangeraden
                </span>
              </div>
              <label
                className={cn(
                  "mt-5 inline-flex w-full cursor-pointer items-center justify-center gap-3 rounded-2xl px-6 py-4 text-xs font-black uppercase tracking-widest transition-all",
                  isMatrixImporting ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-slate-900 text-white hover:bg-slate-800"
                )}
              >
                <Upload size={18} />
                {isMatrixImporting ? 'Importeren...' : 'CSV Matrix Upload'}
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={handleMatrixFileUpload}
                  disabled={isMatrixImporting}
                />
              </label>
            </div>

            {canAdminOverride ? (
            <div className="rounded-[28px] border border-white/70 bg-white/45 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Fallback</p>
                  <h4 className="mt-2 text-base font-black tracking-tight text-slate-900">JSON Import</h4>
                  <p className="mt-2 text-sm font-medium text-slate-500">
                    Gebruik dit alleen als je planning al per dienst in JSON is geëxporteerd. Dit pad is bedoeld voor oudere dataflows.
                  </p>
                </div>
                <span className="rounded-full border border-white/70 bg-white/75 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Legacy
                </span>
              </div>
              <textarea
                className="control-input mt-5 min-h-[170px] w-full rounded-2xl px-4 py-3 font-mono text-sm transition-all focus:outline-none"
                placeholder='Plak hier de JSON data uit Excel... e.g. [{"id":"1","date":"2026-03-01",...}]'
                value={jsonInput}
                onChange={(e) => setJsonInput(e.target.value)}
              />
              <button
                onClick={handleImport}
                className="mt-4 inline-flex w-full items-center justify-center rounded-2xl bg-oker-500 px-6 py-4 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-oker-500/20 transition hover:bg-oker-600"
              >
                Importeer JSON Planning
              </button>
            </div>
            ) : (
            <div className="rounded-[28px] border border-white/70 bg-white/45 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Admin pad</p>
                  <h4 className="mt-2 text-base font-black tracking-tight text-slate-900">Fallback en sync</h4>
                  <p className="mt-2 text-sm font-medium text-slate-500">
                    JSON fallback-import, handmatige planning sync en directe overschrijvingen zijn afgeschermd voor admins. Gebruik als planner de matrix-upload hierboven.
                  </p>
                </div>
                <span className="rounded-full border border-white/70 bg-white/75 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Admin only
                </span>
              </div>
            </div>
            )}
          </div>
        </div>

        {canAdminOverride ? (
        <div className="surface-card rounded-[32px] p-6 md:p-8">
          <AdminSubsectionHeader
            eyebrow="Database"
            title="Actieve planning herschrijven"
            description="Gebruik sync alleen om de huidige lokale planning expliciet opnieuw naar Supabase te schrijven."
          />
          <div className="mt-5 rounded-[24px] border border-white/70 bg-white/45 p-5">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Handmatige actie</p>
            <p className="mt-2 text-sm font-medium text-slate-500">
              Dit pad overschrijft bestaande records met dezelfde ID. Gebruik het enkel wanneer je de actieve planning bewust wilt vervangen zonder matrix-preview.
            </p>
            <button
              onClick={() => setConfirmSyncOpen(true)}
              disabled={isSyncing}
              className="mt-5 inline-flex w-full items-center justify-center gap-3 rounded-2xl bg-emerald-500 px-6 py-4 text-xs font-black uppercase tracking-widest text-white shadow-lg shadow-emerald-500/20 transition-all hover:bg-emerald-600 disabled:opacity-50 active:scale-95"
              title="Synchroniseer lokale JSON data naar Supabase"
            >
              <RotateCcw size={18} className={isSyncing ? "animate-spin" : ""} />
              {isSyncing ? 'Synchroniseren...' : 'Sync naar DB'}
            </button>
          </div>
        </div>
        ) : null}
      </div>

      {canAdminOverride ? (
      <div className="surface-card p-6 md:p-8 rounded-[32px]">
        <AdminSubsectionHeader
          eyebrow="Correcties"
          title="Handmatig toevoegen"
          description="Gebruik dit alleen voor uitzonderingen of snelle correcties buiten de matrixflow."
        />
        <div className="mt-6 grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-5 md:gap-6">
          <Input label="Datum" type="date" />
          <Input label="Chauffeur" type="select" options={[...users].filter(u => u.role === 'chauffeur' && u.isActive !== false).sort((a, b) => a.name.localeCompare(b.name)).map(u => ({ label: u.name, value: u.id }))} />
          <Input label="Start Tijd" type="time" />
          <Input label="Eind Tijd" type="time" />
          <Input label="Dienst" type="text" placeholder="Bijv. 12" />
        </div>
        <div className="mt-6 flex justify-end">
          <button className="inline-flex w-full items-center justify-center rounded-2xl bg-emerald-500 px-8 py-4 text-xs font-black uppercase tracking-widest text-white shadow-xl shadow-emerald-500/20 transition-all hover:bg-emerald-600 active:scale-95 sm:w-auto">
            Dienst Opslaan
          </button>
        </div>
      </div>
      ) : null}

      <div className="surface-card p-6 md:p-8 rounded-[32px]">
        <AdminSubsectionHeader
          eyebrow="Historiek"
          title="Recente Matriximports"
          description="Laatste importmomenten met de belangrijkste controlecijfers."
          aside={<div className="rounded-full border border-white/70 bg-white/50 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">{history.length} logs</div>}
        />

        <div className="mt-6 space-y-3">
          {history.length > 0 ? history.slice(0, 8).map((entry) => {
            const hasIssues = entry.unknownCodes.length > 0 || entry.unmatchedDrivers.length > 0;
            return (
              <div key={entry.id} className="rounded-[24px] border border-white/70 bg-white/45 p-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className={cn(
                        "h-2.5 w-2.5 rounded-full",
                        hasIssues ? "bg-amber-500" : "bg-emerald-500"
                      )} />
                      <p className="text-sm font-black text-slate-800">
                        {new Date(entry.createdAt).toLocaleString('nl-BE', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                    <p className="mt-2 text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                      {hasIssues ? 'Controle nodig' : 'Volledig herkenbaar'}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
                    <span className="rounded-full border border-white/70 bg-white/70 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">
                      {entry.importedDays} dagen
                    </span>
                    <span className="rounded-full border border-white/70 bg-white/70 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-500">
                      {entry.generatedShifts} diensten
                    </span>
                    <span className={cn(
                      "rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-widest",
                      entry.unknownCodes.length > 0 ? "border-red-200 bg-red-50 text-red-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"
                    )}>
                      {entry.unknownCodes.length} onbekend
                    </span>
                    <span className={cn(
                      "rounded-full border px-3 py-1.5 text-[10px] font-black uppercase tracking-widest",
                      entry.unmatchedDrivers.length > 0 ? "border-amber-200 bg-amber-50 text-amber-700" : "border-emerald-200 bg-emerald-50 text-emerald-700"
                    )}>
                      {entry.unmatchedDrivers.length} chauffeur
                    </span>
                  </div>
                </div>
              </div>
            );
          }) : (
            <EmptyState
              icon={<Activity size={28} />}
              title="Nog geen importhistoriek"
              message="Na je eerste bevestigde matrix-import verschijnt hier automatisch een historiek."
            />
          )}
        </div>
      </div>

      <div className="surface-card p-8 rounded-3xl">
        <AdminSubsectionHeader
          eyebrow="Controle"
          title="Huidige Planning"
          description="Bekijk de actieve planning zoals die nu in het portaal beschikbaar is."
        />
        <div className="mt-6">
        <ScheduleView user={{ id: '0', name: 'Admin', role: 'admin', employeeId: 'ADMIN' }} shifts={shifts} users={users} />
        </div>
      </div>

      {canAdminOverride ? (
        <ConfirmationModal
          isOpen={confirmSyncOpen}
          onClose={() => setConfirmSyncOpen(false)}
          onConfirm={handleSync}
          title="Planning synchroniseren"
          message="Deze actie schrijft de lokale planning weg naar de database en kan bestaande records met dezelfde ID overschrijven."
          confirmText="Synchroniseren"
          variant="warning"
        />
      ) : null}

      <AnimatePresence>
        {matrixPreviewOpen && matrixPreview && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="glass-modal rounded-[36px] w-full max-w-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-white/70">
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-oker-600">Matrix Import Preview</p>
                <h4 className="mt-3 text-2xl font-black tracking-tight">Controleer voor je de planning vervangt</h4>
                <p className="mt-2 text-sm font-medium text-slate-500">
                  Deze stap schrijft nog niets weg. Bevestig pas als dagen, diensten en probleempunten correct ogen.
                </p>
              </div>

              <div className="p-8 space-y-6">
                <div className={cn(
                  "rounded-[24px] border p-5",
                  matrixPreviewHasIssues ? "border-amber-200 bg-amber-50/80" : "border-emerald-200 bg-emerald-50/80"
                )}>
                  <div className="flex items-start gap-3">
                    <div className={cn(
                      "mt-0.5 h-3 w-3 rounded-full shrink-0",
                      matrixPreviewHasIssues ? "bg-amber-500" : "bg-emerald-500"
                    )} />
                    <div>
                      <p className={cn(
                        "text-xs font-black uppercase tracking-[0.2em]",
                        matrixPreviewHasIssues ? "text-amber-700" : "text-emerald-700"
                      )}>
                        {matrixPreviewHasIssues ? 'Controle Nodig' : 'Klaar Voor Import'}
                      </p>
                      <p className={cn(
                        "mt-2 text-sm font-medium",
                        matrixPreviewHasIssues ? "text-amber-800" : "text-emerald-800"
                      )}>
                        {matrixPreviewHasIssues
                          ? 'Deze matrix bevat nog onbekende codes of niet-gematchte chauffeurs. Je kunt nog steeds importeren, maar controleer dit eerst.'
                          : 'Geen onbekende codes of niet-gematchte chauffeurs gevonden. Deze import is klaar om de planning te vervangen.'}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-4">
                  <div className="surface-muted rounded-2xl p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Dagen</p>
                    <p className="mt-2 text-2xl font-black text-slate-900">{matrixPreview.importedDays}</p>
                  </div>
                  <div className="surface-muted rounded-2xl p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Chauffeurs</p>
                    <p className="mt-2 text-2xl font-black text-slate-900">{matrixPreview.detectedDrivers}</p>
                  </div>
                  <div className="surface-muted rounded-2xl p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Diensten</p>
                    <p className="mt-2 text-2xl font-black text-slate-900">{matrixPreview.generatedShifts}</p>
                  </div>
                  <div className="surface-muted rounded-2xl p-4">
                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Afwezigheden</p>
                    <p className="mt-2 text-2xl font-black text-slate-900">{matrixPreview.skippedAbsences}</p>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-[24px] border border-red-200/70 bg-red-50/80 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-red-700">Onbekende Codes</p>
                      <span className="rounded-full border border-red-200 bg-white/80 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-red-700">
                        {matrixPreview.unknownCodes.length}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {matrixPreview.unknownCodes.length > 0 ? matrixPreview.unknownCodes.map((code) => (
                        <span key={code} className="rounded-full border border-red-200 bg-white/80 px-3 py-1.5 text-xs font-bold text-red-700">
                          {code}
                        </span>
                      )) : (
                        <span className="text-sm font-medium text-red-700">Geen onbekende codes.</span>
                      )}
                    </div>
                  </div>

                  <div className="rounded-[24px] border border-amber-200/70 bg-amber-50/80 p-5">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-700">Niet-Gematchte Chauffeurs</p>
                      <span className="rounded-full border border-amber-200 bg-white/80 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-amber-700">
                        {matrixPreview.unmatchedDrivers.length}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {matrixPreview.unmatchedDrivers.length > 0 ? matrixPreview.unmatchedDrivers.map((driver) => (
                        <span key={driver} className="rounded-full border border-amber-200 bg-white/80 px-3 py-1.5 text-xs font-bold text-amber-800">
                          {driver}
                        </span>
                      )) : (
                        <span className="text-sm font-medium text-amber-700">Alle chauffeurs werden herkend.</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-8 bg-white/40 flex gap-3 backdrop-blur-sm">
                <button
                  onClick={() => {
                    setMatrixPreviewOpen(false);
                    setPendingMatrixCsv('');
                    setMatrixPreview(null);
                  }}
                  className="flex-1 px-4 py-4 rounded-2xl font-black text-slate-500 hover:bg-white/70 transition-all uppercase tracking-widest text-xs border border-transparent hover:border-white/80"
                >
                  Annuleren
                </button>
                <button
                  onClick={confirmMatrixImport}
                  disabled={isMatrixImporting}
                  className={cn(
                    "flex-1 px-4 py-4 rounded-2xl font-black text-white transition-all shadow-xl uppercase tracking-widest text-xs disabled:opacity-50",
                    matrixPreviewHasIssues
                      ? "bg-amber-500 hover:bg-amber-600 shadow-amber-500/20"
                      : "bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/20"
                  )}
                >
                  {isMatrixImporting ? 'Importeren...' : matrixPreviewHasIssues ? 'Toch Importeren' : 'Planning Vervangen'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ManageUpdatesView({ updates, onSave, onSendUrgentEmail }: { updates: Update[], onSave: (u: Update[]) => Promise<boolean>, onSendUrgentEmail: (u: Update) => Promise<void> }) {
  const [newUpdate, setNewUpdate] = useState({ title: '', category: 'algemeen', content: '', isUrgent: false });
  const [isPublishing, setIsPublishing] = useState(false);

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUpdate.title || !newUpdate.content) return;

    setIsPublishing(true);
    const updateToAdd: Update = {
      id: Date.now().toString(),
      date: new Date().toLocaleDateString('nl-BE'),
      title: newUpdate.title,
      category: newUpdate.category as any,
      content: newUpdate.content,
      isUrgent: newUpdate.isUrgent
    };

    const success = await onSave([updateToAdd, ...updates]);
    if (success) {
      if (newUpdate.isUrgent) {
        await onSendUrgentEmail(updateToAdd);
      }
      setNewUpdate({ title: '', category: 'algemeen', content: '', isUrgent: false });
      notify('Update succesvol gepubliceerd!', 'success');
    }
    setIsPublishing(false);
  };

  return (
    <div className="max-w-3xl space-y-6 md:space-y-8">
      <h3 className="text-2xl font-black tracking-tight">Beheer Updates</h3>
      <div className="surface-card p-6 md:p-8 rounded-[32px]">
        <h3 className="text-lg font-black mb-8 flex items-center gap-3 tracking-tight">
          <Bell size={24} className="text-emerald-500" />
          Nieuwe Update Publiceren
        </h3>
        <form onSubmit={handlePublish} className="space-y-6">
          <Input 
            label="Titel" 
            type="text" 
            placeholder="Onderwerp van de update" 
            value={newUpdate.title}
            onChange={(e) => setNewUpdate({ ...newUpdate, title: e.target.value })}
          />
          <Input 
            label="Categorie" 
            type="select" 
            options={[
              { label: 'Algemeen', value: 'algemeen' },
              { label: 'Veiligheid', value: 'veiligheid' },
              { label: 'Technisch', value: 'technisch' }
            ]} 
            value={newUpdate.category}
            onChange={(e) => setNewUpdate({ ...newUpdate, category: e.target.value })}
          />
          
          <div className="flex items-center gap-3 p-4 bg-red-50 rounded-2xl border border-red-100">
            <input 
              type="checkbox" 
              id="isUrgent" 
              className="w-5 h-5 rounded border-red-300 text-red-600 focus:ring-red-500"
              checked={newUpdate.isUrgent}
              onChange={(e) => setNewUpdate({ ...newUpdate, isUrgent: e.target.checked })}
            />
            <label htmlFor="isUrgent" className="text-sm font-black text-red-700 uppercase tracking-widest cursor-pointer flex items-center gap-2">
              <AlertTriangle size={16} /> Markeer als DRINGEND (verstuurt automatische e-mail)
            </label>
          </div>

          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Inhoud van het bericht</label>
            <textarea 
              className="w-full px-6 py-4 rounded-2xl border border-slate-200 focus:outline-none focus:ring-4 focus:ring-emerald-500/10 focus:border-emerald-500 transition-all min-h-[180px] bg-slate-50/50 font-medium text-slate-700"
              placeholder="Schrijf hier het bericht voor de chauffeurs..."
              value={newUpdate.content}
              onChange={(e) => setNewUpdate({ ...newUpdate, content: e.target.value })}
            />
          </div>
          
          <button 
            type="submit"
            disabled={isPublishing}
            className={cn(
              "w-full mt-8 font-black px-8 py-4 rounded-2xl transition-all shadow-xl uppercase tracking-widest text-xs active:scale-95",
              isPublishing ? "bg-slate-200 text-slate-400 cursor-not-allowed" : "bg-emerald-500 text-white hover:bg-emerald-600 shadow-emerald-500/20"
            )}
          >
            {isPublishing ? 'Publiceren...' : 'Update Publiceren'}
          </button>
        </form>
      </div>
    </div>
  );
}

function PlanningMatrixView({ rows, services, planningCodes, users }: { rows: PlanningMatrixRow[]; services: Service[]; planningCodes: PlanningCode[]; users: User[] }) {
  const [selectedDate, setSelectedDate] = useState<string | null>(rows[0]?.source_date || null);
  const [showOnlyIssues, setShowOnlyIssues] = useState(false);
  const [highlightedCode, setHighlightedCode] = useState<string | null>(null);
  const [visibleDayCount, setVisibleDayCount] = useState(60);
  const safeRows = useMemo(
    () => rows.map((row) => ({
      ...row,
      source_date: String(row.source_date ?? ''),
      day_type: String(row.day_type ?? ''),
      assignments: row.assignments && typeof row.assignments === 'object' && !Array.isArray(row.assignments)
        ? Object.fromEntries(Object.entries(row.assignments).map(([driver, code]) => [String(driver), String(code ?? '')]))
        : {},
    })),
    [rows]
  );
  const deferredRows = useDeferredValue(safeRows);

  useEffect(() => {
    if (!selectedDate && safeRows[0]?.source_date) {
      setSelectedDate(safeRows[0].source_date);
    }
    if (selectedDate && !safeRows.some((row) => row.source_date === selectedDate) && safeRows[0]?.source_date) {
      setSelectedDate(safeRows[0].source_date);
    }
  }, [safeRows, selectedDate]);

  useEffect(() => {
    setVisibleDayCount(60);
  }, [showOnlyIssues]);

  try {
    const derived = useMemo(() => {
      const serviceCodeLookup = new Set(services.map((service) => normalizePlanningToken(service.serviceNumber)));
      const planningCodeLookup = new Set(planningCodes.map((code) => normalizePlanningToken(code.code)));
      const knownDriverLookup = new Set(
        users
          .map((user) => normalizePlanningToken(user.name))
          .filter((value) => value.length > 0)
      );

    const globalUnknownCodeSet = new Set<string>();
    const globalUnmatchedDriverSet = new Set<string>();
    const generatedServicesPerDay = new Map<string, number>();
    const daySummaryByDate = new Map<string, {
      assignmentCount: number;
      generatedServices: number;
      unknownCodeCount: number;
      unmatchedDriverCount: number;
      unmatchedDrivers: string[];
    }>();
    for (const row of deferredRows) {
      const assignmentsEntries = Object.entries(row.assignments || {}) as Array<[string, string]>;
      let generatedServices = 0;
      let unknownCodeCount = 0;
      let unmatchedDriverCount = 0;
      const unmatchedDrivers: string[] = [];

      for (const [driver, code] of assignmentsEntries) {
        const normalizedCode = normalizePlanningToken(code);
        const normalizedDriver = normalizePlanningToken(driver);
        const hasKnownDriver = normalizedDriver.length > 0 && knownDriverLookup.has(normalizedDriver);
        const isKnownService = normalizedCode.length > 0 && serviceCodeLookup.has(normalizedCode);
        const isKnownPlanningCode = normalizedCode.length > 0 && planningCodeLookup.has(normalizedCode);

        if (isKnownService) {
          generatedServices += 1;
        }

        if (normalizedCode.length > 0 && !isKnownService && !isKnownPlanningCode) {
          unknownCodeCount += 1;
          globalUnknownCodeSet.add(normalizedCode);
        }

        if (normalizedDriver.length > 0 && !hasKnownDriver) {
          unmatchedDriverCount += 1;
          unmatchedDrivers.push(driver);
          globalUnmatchedDriverSet.add(driver);
        }
      }

      generatedServicesPerDay.set(row.source_date, generatedServices);
      daySummaryByDate.set(row.source_date, {
        assignmentCount: assignmentsEntries.length,
        generatedServices,
        unknownCodeCount,
        unmatchedDriverCount,
        unmatchedDrivers: unmatchedDrivers.sort((a, b) => a.localeCompare(b)),
      });
    }

    const rowsWithAssignments = deferredRows.filter((row) => (daySummaryByDate.get(row.source_date)?.assignmentCount || 0) > 0);
    const rowsWithIssues = deferredRows.filter((row) => {
      const summary = daySummaryByDate.get(row.source_date);
      return !!summary && (summary.unknownCodeCount > 0 || summary.unmatchedDriverCount > 0);
    });

    return {
      serviceCodeLookup,
      planningCodeLookup,
      daySummaryByDate,
      generatedServicesPerDay,
      globalUnknownCodes: Array.from(globalUnknownCodeSet).sort((a, b) => a.localeCompare(b)),
      globalUnmatchedDrivers: Array.from(globalUnmatchedDriverSet).sort((a, b) => a.localeCompare(b)),
      rowsWithAssignments,
      rowsWithIssues,
      totalGeneratedServices: Array.from<number>(generatedServicesPerDay.values()).reduce<number>((sum, value) => sum + value, 0),
    };
    }, [deferredRows, services, planningCodes, users]);

    const selectedRow = deferredRows.find((row) => row.source_date === selectedDate) || null;
    const assignments = useMemo(
      () => selectedRow
        ? ((Object.entries(selectedRow.assignments) as Array<[string, string]>)
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([driver, code]) => resolvePlanningAssignment(driver, code, services, planningCodes)))
        : [],
      [selectedRow, services, planningCodes]
    );
    const visibleRows = showOnlyIssues ? derived.rowsWithIssues : deferredRows;
    const serviceAssignments = assignments.filter((assignment) => assignment.kind === 'service').length;
    const unknownAssignments = assignments.filter((assignment) => assignment.kind === 'unknown').length;
    const unmatchedDriversForSelectedDay = selectedRow ? (derived.daySummaryByDate.get(selectedRow.source_date)?.unmatchedDrivers || []) : [];
    const filteredAssignments = highlightedCode
      ? assignments.filter((assignment) => normalizePlanningToken(assignment.code) === highlightedCode)
      : assignments;
    const visibleDayRows = visibleRows.slice(0, visibleDayCount);

    const exportProblemReport = () => {
    const problemReportRows = deferredRows.flatMap((row) => {
      const formattedDate = new Date(row.source_date).toLocaleDateString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const unknownRows = (Object.entries(row.assignments || {}) as Array<[string, string]>)
        .filter(([, code]) => {
          const normalizedCode = normalizePlanningToken(code);
          return normalizedCode.length > 0 && !derived.serviceCodeLookup.has(normalizedCode) && !derived.planningCodeLookup.has(normalizedCode);
        })
        .map(([driver, code]) => ({
          date: formattedDate,
          dayType: row.day_type || '',
          type: 'onbekende_code',
          driver,
          code,
          details: 'Geen match in Dienstoverzicht of Planningscodes',
        }));
      const unmatchedRows = Object.keys(row.assignments || {})
        .filter((driver) => (derived.daySummaryByDate.get(row.source_date)?.unmatchedDrivers || []).includes(driver))
        .map((driver) => ({
          date: formattedDate,
          dayType: row.day_type || '',
          type: 'niet_gematchte_chauffeur',
          driver,
          code: row.assignments?.[driver] || '',
          details: 'Geen match met gebruikerslijst',
        }));
      return [...unknownRows, ...unmatchedRows];
    });

    if (problemReportRows.length === 0) {
      notify('Er zijn momenteel geen problemen om te exporteren.', 'info');
      return;
    }

    const header = ['datum', 'dagtype', 'type', 'chauffeur', 'code', 'details'];
    const csvRows = [
      header.join(';'),
      ...problemReportRows.map((row) => [
        row.date,
        row.dayType,
        row.type,
        row.driver,
        row.code,
        row.details,
      ].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(';')),
    ];

    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'planning-matrix-problemen.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

    return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard
          icon={<Clock className="text-emerald-600" />}
          label="Gegenereerde Diensten"
          value={derived.totalGeneratedServices.toString()}
          subValue="Gematcht vanuit Dienstoverzicht"
        />
        <StatCard
          icon={<AlertTriangle className="text-slate-600" />}
          label="Onbekende Codes"
          value={derived.globalUnknownCodes.length.toString()}
          subValue={derived.globalUnknownCodes.length === 0 ? 'Alles herkend' : derived.globalUnknownCodes.slice(0, 3).join(' • ')}
        />
        <StatCard
          icon={<Users className="text-oker-600" />}
          label="Niet-Gematchte Chauffeurs"
          value={derived.globalUnmatchedDrivers.length.toString()}
          subValue={derived.globalUnmatchedDrivers.length === 0 ? 'Alles gekoppeld' : derived.globalUnmatchedDrivers.slice(0, 2).join(' • ')}
        />
      </div>

      <section className="surface-card rounded-[32px] p-5 md:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h3 className="text-lg font-black tracking-tight">Controlefilters</h3>
            <p className="mt-1 text-sm font-medium text-slate-500">
              Filter op probleemdagen of klik een onbekende code om enkel die assignments te bekijken.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => setShowOnlyIssues((current) => !current)}
              className={cn(
                "rounded-2xl border px-4 py-2.5 text-xs font-black uppercase tracking-[0.18em] transition-all",
                showOnlyIssues ? "border-red-200 bg-red-50 text-red-700" : "border-white/70 bg-white/55 text-slate-500 hover:bg-white/80"
              )}
            >
              {showOnlyIssues ? 'Alleen Probleemdagen' : 'Toon Alle Dagen'}
            </button>
            {highlightedCode ? (
              <button
                onClick={() => setHighlightedCode(null)}
                className="rounded-2xl border border-oker-200 bg-oker-50 px-4 py-2.5 text-xs font-black uppercase tracking-[0.18em] text-oker-700 transition-all hover:bg-oker-100"
              >
                Reset Codefilter
              </button>
            ) : null}
            <button
              onClick={exportProblemReport}
              disabled={derived.globalUnknownCodes.length === 0 && derived.globalUnmatchedDrivers.length === 0}
              className={cn(
                "inline-flex items-center gap-2 rounded-2xl border px-4 py-2.5 text-xs font-black uppercase tracking-[0.18em] transition-all",
                derived.globalUnknownCodes.length === 0 && derived.globalUnmatchedDrivers.length === 0
                  ? "cursor-not-allowed border-slate-100 bg-slate-50 text-slate-300"
                  : "border-white/70 bg-white/55 text-slate-600 hover:bg-white/80"
              )}
            >
              <Download size={14} />
              Exporteer Problemen
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          {derived.globalUnknownCodes.length > 0 ? derived.globalUnknownCodes.map((code) => (
            <button
              key={code}
              onClick={() => setHighlightedCode(code)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-widest transition-all",
                highlightedCode === code ? "border-red-300 bg-red-100 text-red-800" : "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
              )}
            >
              {code}
            </button>
          )) : (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-xs font-black uppercase tracking-widest text-emerald-700">
              Geen onbekende codes
            </span>
          )}
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          <div className="rounded-[24px] border border-red-200/70 bg-red-50/80 p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-red-700">Onbekende Codes</p>
              <span className="rounded-full border border-red-200 bg-white/80 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-red-700">
                {derived.globalUnknownCodes.length}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {derived.globalUnknownCodes.length > 0 ? derived.globalUnknownCodes.map((code) => (
                <button
                  key={`list-${code}`}
                  onClick={() => setHighlightedCode(code)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs font-black uppercase tracking-widest transition-all",
                    highlightedCode === code ? "border-red-300 bg-red-100 text-red-800" : "border-red-200 bg-white/80 text-red-700 hover:bg-red-100"
                  )}
                >
                  {code}
                </button>
              )) : (
                <span className="text-sm font-medium text-red-700">Geen onbekende codes gevonden.</span>
              )}
            </div>
          </div>

          <div className="rounded-[24px] border border-amber-200/70 bg-amber-50/80 p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-700">Niet-Gematchte Chauffeurs</p>
              <span className="rounded-full border border-amber-200 bg-white/80 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-amber-700">
                {derived.globalUnmatchedDrivers.length}
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {derived.globalUnmatchedDrivers.length > 0 ? derived.globalUnmatchedDrivers.map((driver) => (
                <span key={driver} className="rounded-full border border-amber-200 bg-white/80 px-3 py-1.5 text-xs font-bold text-amber-800">
                  {driver}
                </span>
              )) : (
                <span className="text-sm font-medium text-amber-700">Alle chauffeurs zijn gekoppeld.</span>
              )}
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
        <section className="surface-card rounded-[32px] p-6">
          <div className="mb-5">
            <h3 className="text-lg font-black tracking-tight">Geuploade Dagen</h3>
            <p className="mt-1 text-sm font-medium text-slate-500">
              {visibleRows.length} getoond, {derived.rowsWithAssignments.length} met effectieve assignments en {derived.rowsWithIssues.length} met controlepunten.
            </p>
          </div>
          <div className="max-h-[70vh] space-y-3 overflow-y-auto pr-2">
            {visibleDayRows.length > 0 ? visibleDayRows.map((row) => {
              const summary = derived.daySummaryByDate.get(row.source_date);
              const assignmentCount = summary?.assignmentCount || 0;
              const generatedServices = summary?.generatedServices || 0;
              const rowUnknownCodes = summary?.unknownCodeCount || 0;
              const rowUnmatchedDrivers = summary?.unmatchedDriverCount || 0;
              const isActive = row.source_date === selectedDate;
              return (
                <button
                  key={row.id}
                  onClick={() => setSelectedDate(row.source_date)}
                  className={cn(
                    "w-full rounded-2xl border px-4 py-4 text-left transition-all",
                    isActive ? "border-oker-400 bg-oker-50 ring-2 ring-oker-500/10" : "border-white/70 bg-white/45 hover:bg-white/75"
                  )}
                >
                  <p className="text-sm font-black text-slate-800">
                    {new Date(row.source_date).toLocaleDateString('nl-BE', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}
                  </p>
                  <div className="mt-2 flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-400">
                    <span>Dagtype {row.day_type || '-'}</span>
                    <span>{assignmentCount} codes</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-[10px] font-black uppercase tracking-widest text-slate-400">
                    <span>{generatedServices} diensten</span>
                    {rowUnknownCodes > 0 || rowUnmatchedDrivers > 0 || (generatedServices === 0 && assignmentCount > 0)
                      ? <span>controle nodig</span>
                      : <span>&nbsp;</span>}
                  </div>
                  {(rowUnknownCodes > 0 || rowUnmatchedDrivers > 0) ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {rowUnknownCodes > 0 ? (
                        <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-red-700">
                          {rowUnknownCodes} onbekend
                        </span>
                      ) : null}
                      {rowUnmatchedDrivers > 0 ? (
                        <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-black uppercase tracking-widest text-amber-700">
                          {rowUnmatchedDrivers} chauffeur
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </button>
              );
            }) : (
              <EmptyState
                icon={<Calendar size={28} />}
                title={showOnlyIssues ? "Geen probleemdagen gevonden" : "Nog geen matrixplanning"}
                message={showOnlyIssues ? "Alle geüploade dagen zijn momenteel volledig herkenbaar." : "Upload eerst een matrix-CSV via Beheer Roosters om hier een overzicht te zien."}
              />
            )}
            {visibleRows.length > visibleDayRows.length ? (
              <button
                onClick={() => setVisibleDayCount((current) => current + 60)}
                className="w-full rounded-2xl border border-white/70 bg-white/55 px-4 py-3 text-xs font-black uppercase tracking-[0.18em] text-slate-500 transition-all hover:bg-white/80"
              >
                Toon Meer Dagen ({visibleRows.length - visibleDayRows.length} resterend)
              </button>
            ) : null}
          </div>
        </section>

        <section className="surface-card rounded-[32px] p-6">
          {selectedRow ? (
            <>
              <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                <div>
                  <h3 className="text-2xl font-black tracking-tight">
                    {new Date(selectedRow.source_date).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                  </h3>
                  <p className="mt-1 text-sm font-medium text-slate-500">
                    Dagtype {selectedRow.day_type || '-'} met {assignments.length} ingevulde chauffeurcodes.
                  </p>
                </div>
                <div className="glass-chip rounded-full px-4 py-2 text-[10px] font-black uppercase tracking-[0.18em] text-oker-700">
                  Matrix staging
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <StatCard
                  icon={<Users className="text-oker-600" />}
                  label="Chauffeurs"
                  value={assignments.length.toString()}
                  subValue="Met een ingevulde code"
                />
                <StatCard
                  icon={<Clock className="text-emerald-600" />}
                  label="Herkende Diensten"
                  value={serviceAssignments.toString()}
                  subValue="Gematcht met Dienstoverzicht"
                />
                <StatCard
                  icon={<AlertTriangle className="text-slate-600" />}
                  label="Onbekende Codes"
                  value={unknownAssignments.toString()}
                  subValue={unknownAssignments === 0 ? 'Alles herkend' : 'Nog te mappen'}
                />
              </div>

              {(unmatchedDriversForSelectedDay.length > 0 || highlightedCode) ? (
                <div className="mt-6 grid gap-4 lg:grid-cols-2">
                  <div className="rounded-[24px] border border-amber-200/70 bg-amber-50/80 p-5">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-amber-700">Niet-Gematchte Chauffeurs</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {unmatchedDriversForSelectedDay.length > 0 ? unmatchedDriversForSelectedDay.map((driver) => (
                        <span key={driver} className="rounded-full border border-amber-200 bg-white/80 px-3 py-1.5 text-xs font-bold text-amber-800">
                          {driver}
                        </span>
                      )) : (
                        <span className="text-sm font-medium text-amber-700">Geen niet-gematchte chauffeurs voor deze dag.</span>
                      )}
                    </div>
                  </div>
                  <div className="rounded-[24px] border border-red-200/70 bg-red-50/80 p-5">
                    <p className="text-xs font-black uppercase tracking-[0.2em] text-red-700">Codefilter</p>
                    <p className="mt-3 text-sm font-medium text-red-700">
                      {highlightedCode ? `Je bekijkt nu enkel assignments met code ${highlightedCode}.` : 'Geen actieve codefilter.'}
                    </p>
                  </div>
                </div>
              ) : null}

              <div className="mt-6 surface-table rounded-[28px] overflow-hidden">
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50/60">
                      <tr>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Chauffeur</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Code</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Interpretatie</th>
                        <th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Uren / status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {filteredAssignments.map((assignment) => (
                        <tr key={assignment.driver} className="hover:bg-slate-50/50 transition-colors">
                          <td className="px-6 py-4 text-sm font-bold text-slate-800">{assignment.driver}</td>
                          <td className="px-6 py-4">
                            <span className={cn(
                              'rounded-full px-3 py-1.5 text-xs font-black uppercase tracking-widest',
                              assignment.kind === 'service' && 'glass-chip text-emerald-700',
                              assignment.kind === 'leave' && 'glass-chip text-sky-700',
                              assignment.kind === 'training' && 'glass-chip text-violet-700',
                              assignment.kind === 'absence' && 'glass-chip text-amber-700',
                              assignment.kind === 'unknown' && 'border border-red-200 bg-red-50 text-red-700'
                            )}>
                              {assignment.code}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-sm font-bold text-slate-800">{assignment.label}</td>
                          <td className="px-6 py-4 text-sm font-medium text-slate-500">{assignment.details}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="divide-y divide-slate-50 md:hidden">
                  {filteredAssignments.map((assignment) => (
                    <div key={assignment.driver} className="p-5">
                      <p className="text-sm font-black text-slate-800">{assignment.driver}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <span className={cn(
                          'rounded-full px-3 py-1.5 text-xs font-black uppercase tracking-widest',
                          assignment.kind === 'service' && 'glass-chip text-emerald-700',
                          assignment.kind === 'leave' && 'glass-chip text-sky-700',
                          assignment.kind === 'training' && 'glass-chip text-violet-700',
                          assignment.kind === 'absence' && 'glass-chip text-amber-700',
                          assignment.kind === 'unknown' && 'border border-red-200 bg-red-50 text-red-700'
                        )}>
                          {assignment.code}
                        </span>
                        <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">{assignment.label}</span>
                      </div>
                      <p className="mt-3 text-sm font-medium text-slate-500">{assignment.details}</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <EmptyState
              icon={<FileText size={28} />}
              title="Geen dag geselecteerd"
              message="Kies links een geüploade dag om de actuele matrixplanning te bekijken."
            />
          )}
        </section>
      </div>
    </div>
    );
  } catch (error) {
    console.error('Planning Overzicht renderfout:', error);
    return (
      <div className="surface-card rounded-[32px] p-8">
        <div className="rounded-[24px] border border-red-200 bg-red-50/80 p-6">
          <p className="text-xs font-black uppercase tracking-[0.2em] text-red-700">Schermfout</p>
          <h3 className="mt-3 text-2xl font-black tracking-tight text-slate-900">Planning Overzicht kon niet geladen worden</h3>
          <p className="mt-2 text-sm font-medium text-slate-600">
            {error instanceof Error ? error.message : 'Onbekende renderfout'}
          </p>
        </div>
      </div>
    );
  }
}

function PlanningCodesView({ codes, onSave, canAdminDelete }: { codes: PlanningCode[]; onSave: (codes: PlanningCode[]) => Promise<boolean>; canAdminDelete: boolean }) {
  const [draftCodes, setDraftCodes] = useState<PlanningCode[]>(codes);
  const [isSaving, setIsSaving] = useState(false);
  const [filter, setFilter] = useState<'all' | PlanningCode['category']>('all');

  useEffect(() => {
    setDraftCodes(codes);
  }, [codes]);

  const updateCode = (index: number, patch: Partial<PlanningCode>) => {
    setDraftCodes((current) => current.map((code, currentIndex) => (
      currentIndex === index ? { ...code, ...patch } : code
    )));
  };

  const addCode = () => {
    setDraftCodes((current) => [
      ...current,
      {
        code: '',
        category: 'unknown',
        description: '',
        countsAsShift: false,
        isPaidAbsence: false,
        isDayOff: false,
      },
    ]);
  };

  const removeCode = (index: number) => {
    if (!canAdminDelete) {
      notify('Codes verwijderen is alleen beschikbaar voor admins.', 'error');
      return;
    }
    setDraftCodes((current) => current.filter((_, currentIndex) => currentIndex !== index));
  };

  const handleSave = async () => {
    const normalizedCodes = draftCodes
      .map((code) => ({
        ...code,
        code: code.code.trim().toLowerCase(),
        description: code.description.trim(),
      }))
      .filter((code) => code.code.length > 0);

    const duplicateCodes = normalizedCodes.filter((code, index) => normalizedCodes.findIndex((item) => item.code === code.code) !== index);
    if (duplicateCodes.length > 0) {
      notify(`Code ${duplicateCodes[0].code} komt meerdere keren voor.`, 'error');
      return;
    }

    setIsSaving(true);
    await onSave(normalizedCodes);
    setIsSaving(false);
  };

  const filteredCodes = draftCodes
    .filter((code) => filter === 'all' || code.category === filter)
    .sort((a, b) => a.code.localeCompare(b.code));

  const summary = {
    service: draftCodes.filter((code) => code.category === 'service').length,
    absence: draftCodes.filter((code) => code.category === 'absence').length,
    leave: draftCodes.filter((code) => code.category === 'leave').length,
    training: draftCodes.filter((code) => code.category === 'training').length,
    unknown: draftCodes.filter((code) => code.category === 'unknown').length,
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow="Planningsmatrix"
        title="Planningscodes"
        description="Beheer de betekenis van matrixcodes en bepaal welke codes als dienst, verlof of afwezigheid verwerkt mogen worden."
        actions={(
          <>
            <button onClick={addCode} className="glass-button rounded-[20px] px-5 py-3 text-sm font-black text-slate-800">
              <span className="inline-flex items-center gap-2"><Plus size={16} /> Code Toevoegen</span>
            </button>
            <button onClick={handleSave} disabled={isSaving} className="rounded-[20px] bg-oker-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-oker-500/20 transition hover:bg-oker-600 disabled:cursor-not-allowed disabled:opacity-60">
              {isSaving ? 'Opslaan...' : 'Opslaan'}
            </button>
          </>
        )}
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <StatCard icon={<FileText className="text-oker-600" />} label="Totaal" value={draftCodes.length.toString()} subValue="Actieve mappings" />
        <StatCard icon={<Bus className="text-slate-600" />} label="Diensten" value={summary.service.toString()} subValue="Codes met shiftstatus" />
        <StatCard icon={<Calendar className="text-emerald-600" />} label="Verlof" value={summary.leave.toString()} subValue="Afwezigheidsperiodes" />
        <StatCard icon={<AlertTriangle className="text-amber-600" />} label="Afwezigheid" value={summary.absence.toString()} subValue="Geen inzetbare dienst" />
        <StatCard icon={<Info className="text-sky-600" />} label="Onbekend" value={summary.unknown.toString()} subValue="Nog te verfijnen" />
      </div>

      <section className="surface-card rounded-[32px] p-6">
        <AdminSubsectionHeader
          eyebrow="Werkset"
          title="Codebeheer"
          description="Voeg matrixcodes toe, wijzig hun betekenis en bepaal of ze als dienst, verlof of afwezigheid tellen."
          aside={
            <div className="flex flex-wrap items-center gap-2">
              <div className="rounded-full border border-white/70 bg-white/55 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">{filteredCodes.length} zichtbaar</div>
              {!canAdminDelete ? (
                <div className="rounded-full border border-white/70 bg-white/55 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">Delete admin-only</div>
              ) : null}
            </div>
          }
        />

        <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_auto]">
          <div className="rounded-[24px] border border-white/70 bg-white/45 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Filter</p>
            <div className="mt-3 glass segmented-control inline-flex p-1">
              {[
                { key: 'all', label: 'Alles' },
                { key: 'service', label: 'Dienst' },
                { key: 'leave', label: 'Verlof' },
                { key: 'absence', label: 'Afwezig' },
                { key: 'training', label: 'Opleiding' },
                { key: 'unknown', label: 'Onbekend' },
              ].map((option) => (
                <button
                  key={option.key}
                  onClick={() => setFilter(option.key as 'all' | PlanningCode['category'])}
                  className={cn(
                    'rounded-[18px] px-4 py-2 text-xs font-black uppercase tracking-[0.16em] transition-all',
                    filter === option.key ? 'bg-white text-oker-700 shadow-sm' : 'text-slate-500 hover:text-slate-800'
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="rounded-[24px] border border-white/70 bg-white/45 p-4">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">Interpretatie</p>
            <p className="mt-3 text-sm font-medium text-slate-500">
              Dienstcodes worden doorgegeven aan de roosteropbouw. Verlof-, afwezigheids- en opleidingscodes blijven buiten de dienstgeneratie.
            </p>
          </div>
        </div>

        <div className="mt-6 surface-table overflow-hidden rounded-[28px]">
          {filteredCodes.length > 0 ? (
            <>
              <div className="hidden xl:block overflow-x-auto">
                <table className="w-full min-w-[980px] text-left">
                  <thead className="bg-slate-50/60">
                    <tr>
                      <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Code</th>
                      <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Categorie</th>
                      <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Beschrijving</th>
                      <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Dienst</th>
                      <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Betaald</th>
                      <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Vrij</th>
                      <th className="px-5 py-4 text-[10px] font-black uppercase tracking-widest text-slate-400">Acties</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredCodes.map((code) => {
                      const index = draftCodes.findIndex((draft) => draft === code);
                      return (
                        <tr key={`${code.code || 'new'}-${index}`} className="hover:bg-white/55">
                          <td className="px-5 py-4">
                            <input
                              value={code.code}
                              onChange={(event) => updateCode(index, { code: event.target.value })}
                              className="control-input w-full rounded-2xl px-4 py-3 text-sm font-black uppercase tracking-[0.16em]"
                              placeholder="bv"
                            />
                          </td>
                          <td className="px-5 py-4">
                            <select
                              value={code.category}
                              onChange={(event) => updateCode(index, { category: event.target.value as PlanningCode['category'] })}
                              className="control-input w-full rounded-2xl px-4 py-3 text-sm font-bold"
                            >
                              <option value="service">Dienst</option>
                              <option value="absence">Afwezigheid</option>
                              <option value="leave">Verlof</option>
                              <option value="training">Opleiding</option>
                              <option value="unknown">Onbekend</option>
                            </select>
                          </td>
                          <td className="px-5 py-4">
                            <input
                              value={code.description}
                              onChange={(event) => updateCode(index, { description: event.target.value })}
                              className="control-input w-full rounded-2xl px-4 py-3 text-sm font-medium"
                              placeholder="Beschrijving"
                            />
                          </td>
                          <td className="px-5 py-4">
                            <label className="flex items-center justify-center">
                              <input type="checkbox" checked={code.countsAsShift} onChange={(event) => updateCode(index, { countsAsShift: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-oker-500 focus:ring-oker-500" />
                            </label>
                          </td>
                          <td className="px-5 py-4">
                            <label className="flex items-center justify-center">
                              <input type="checkbox" checked={code.isPaidAbsence} onChange={(event) => updateCode(index, { isPaidAbsence: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-oker-500 focus:ring-oker-500" />
                            </label>
                          </td>
                          <td className="px-5 py-4">
                            <label className="flex items-center justify-center">
                              <input type="checkbox" checked={code.isDayOff} onChange={(event) => updateCode(index, { isDayOff: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-oker-500 focus:ring-oker-500" />
                            </label>
                          </td>
                          <td className="px-5 py-4">
                            {canAdminDelete ? (
                              <button onClick={() => removeCode(index)} className="glass-button rounded-2xl p-3 text-red-500 hover:text-red-600" aria-label="Verwijder code">
                                <Trash2 size={16} />
                              </button>
                            ) : (
                              <span className="rounded-full border border-white/70 bg-white/55 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-300">
                                Admin
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="divide-y divide-slate-100 xl:hidden">
                {filteredCodes.map((code) => {
                  const index = draftCodes.findIndex((draft) => draft === code);
                  return (
                    <div key={`${code.code || 'new-mobile'}-${index}`} className="space-y-4 p-5">
                      <div className="grid gap-4 md:grid-cols-2">
                        <input
                          value={code.code}
                          onChange={(event) => updateCode(index, { code: event.target.value })}
                          className="control-input rounded-2xl px-4 py-3 text-sm font-black uppercase tracking-[0.16em]"
                          placeholder="Code"
                        />
                        <select
                          value={code.category}
                          onChange={(event) => updateCode(index, { category: event.target.value as PlanningCode['category'] })}
                          className="control-input rounded-2xl px-4 py-3 text-sm font-bold"
                        >
                          <option value="service">Dienst</option>
                          <option value="absence">Afwezigheid</option>
                          <option value="leave">Verlof</option>
                          <option value="training">Opleiding</option>
                          <option value="unknown">Onbekend</option>
                        </select>
                      </div>
                      <input
                        value={code.description}
                        onChange={(event) => updateCode(index, { description: event.target.value })}
                        className="control-input w-full rounded-2xl px-4 py-3 text-sm font-medium"
                        placeholder="Beschrijving"
                      />
                      <div className="grid gap-3 sm:grid-cols-3">
                        <label className="glass-chip flex items-center justify-between rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-slate-600">
                          Dienst
                          <input type="checkbox" checked={code.countsAsShift} onChange={(event) => updateCode(index, { countsAsShift: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-oker-500 focus:ring-oker-500" />
                        </label>
                        <label className="glass-chip flex items-center justify-between rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-slate-600">
                          Betaald
                          <input type="checkbox" checked={code.isPaidAbsence} onChange={(event) => updateCode(index, { isPaidAbsence: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-oker-500 focus:ring-oker-500" />
                        </label>
                        <label className="glass-chip flex items-center justify-between rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-slate-600">
                          Vrij
                          <input type="checkbox" checked={code.isDayOff} onChange={(event) => updateCode(index, { isDayOff: event.target.checked })} className="h-4 w-4 rounded border-slate-300 text-oker-500 focus:ring-oker-500" />
                        </label>
                      </div>
                      {canAdminDelete ? (
                        <button onClick={() => removeCode(index)} className="glass-button rounded-2xl px-4 py-3 text-sm font-black text-red-500 hover:text-red-600">
                          Verwijder Code
                        </button>
                      ) : (
                        <div className="rounded-2xl border border-white/70 bg-white/55 px-4 py-3 text-sm font-black uppercase tracking-[0.16em] text-slate-300">
                          Verwijderen admin-only
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="p-8">
              <EmptyState
                icon={<Settings size={28} />}
                title="Nog geen planningscodes"
                message="Voeg hier de eerste matrixcodes toe zodat planners en admins hun betekenis centraal kunnen beheren."
              />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

type UserDraft = User & { password?: string };

function ManageUsersView({ users, onSave, title = "Gebruikersbeheer", currentUser }: { users: User[], onSave: (u: UserDraft[]) => Promise<boolean>, title?: string, currentUser: User }) {
  const [isImporting, setIsImporting] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserDraft | null>(null);
  const [newUser, setNewUser] = useState({ name: '', role: 'chauffeur', employeeId: '', password: '', phone: '', email: '' });
  const [roleFilter, setRoleFilter] = useState<'all' | 'chauffeur' | 'planner' | 'admin'>('all');
  
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmResetUser, setConfirmResetUser] = useState<User | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [confirmSyncOpen, setConfirmSyncOpen] = useState(false);
  const [pendingImportUsers, setPendingImportUsers] = useState<UserDraft[] | null>(null);
  const [pendingImportMessage, setPendingImportMessage] = useState('');
  const activeAdmins = users.filter(u => u.role === 'admin' && u.isActive !== false);
  const isProtectedAdmin = (user: User) => user.role === 'admin' && user.isActive !== false && activeAdmins.length === 1;

  const filteredUsers = users
    .filter(u => {
      const isBeheerder = u.name.toLowerCase() === 'beheerder';
      const isMe = u.id === currentUser.id;
      if (isBeheerder && !isMe) return false;
      return true;
    })
    .filter(u => roleFilter === 'all' || u.role === roleFilter)
    .sort((a, b) => a.name.localeCompare(b.name));

  const handleAddUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.name) return;
    if (!newUser.email) {
      notify('Een e-mailadres is verplicht voor Supabase login.', 'error');
      return;
    }
    if (newUser.password.length < 8) {
      notify('Gebruik een tijdelijk wachtwoord van minstens 8 tekens.', 'error');
      return;
    }

    const userToAdd: UserDraft = {
      id: Date.now().toString(),
      name: newUser.name,
      role: newUser.role as any,
      employeeId: newUser.employeeId || `VHB-${Math.floor(1000 + Math.random() * 9000)}`,
      password: newUser.password,
      phone: newUser.phone,
      email: newUser.email,
      isActive: true
    };

    onSave([...users, userToAdd]);
    setShowAddModal(false);
    setNewUser({ name: '', role: 'chauffeur', employeeId: '', password: '', phone: '', email: '' });
  };

  const handleUpdateUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    if (!editingUser.email) {
      notify('Een e-mailadres is verplicht voor Supabase login.', 'error');
      return;
    }
    if (editingUser.password && editingUser.password.length < 8) {
      notify('Een nieuw wachtwoord moet minstens 8 tekens hebben.', 'error');
      return;
    }
    const originalUser = users.find(u => u.id === editingUser.id);
    const isOnlyActiveAdmin = originalUser?.role === 'admin' && originalUser.isActive !== false && activeAdmins.length === 1;
    const adminWouldBeRemoved = editingUser.role !== 'admin' || editingUser.isActive === false;
    if (isOnlyActiveAdmin && adminWouldBeRemoved) {
      notify('Je kunt de laatste actieve admin niet degraderen of deactiveren.', 'error');
      return;
    }

    const updatedUsers = users.map(u => u.id === editingUser.id ? editingUser : u);
    onSave(updatedUsers);
    setEditingUser(null);
  };

  const handleDeleteUser = () => {
    if (confirmDeleteId) {
      const userToDelete = users.find(u => u.id === confirmDeleteId);
      const isOnlyActiveAdmin = userToDelete?.role === 'admin' && userToDelete.isActive !== false && activeAdmins.length === 1;
      if (isOnlyActiveAdmin) {
        notify('Je kunt de laatste actieve admin niet verwijderen.', 'error');
        setConfirmDeleteId(null);
        return;
      }
      onSave(users.filter(u => u.id !== confirmDeleteId));
      if (editingUser?.id === confirmDeleteId) setEditingUser(null);
      setConfirmDeleteId(null);
    }
  };

  const handleResetPassword = async () => {
    if (!confirmResetUser) return;
    if (resetPasswordValue.length < 8) {
      notify('Gebruik minstens 8 tekens.', 'error');
      return;
    }

    try {
      setIsResettingPassword(true);
      const response = await fetch('/api/admin/users/reset-password', {
        method: 'POST',
        headers: await getSupabaseAuthHeaders(),
        body: JSON.stringify({ userId: confirmResetUser.id, password: resetPasswordValue }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        notify(data.details || data.error || 'Reset mislukt.', 'error');
        return;
      }

      notify(`Wachtwoord voor ${confirmResetUser.name} is bijgewerkt.`, 'success');
      setConfirmResetUser(null);
      setResetPasswordValue('');
    } finally {
      setIsResettingPassword(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const XLSX = await import('xlsx');
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Try to get headers first to see what we're working with
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

        if (!jsonData || !Array.isArray(jsonData) || jsonData.length === 0) {
          notify('Het Excel-bestand lijkt leeg te zijn of heeft geen herkenbare gegevens.', 'error');
          setIsImporting(false);
          return;
        }

        // Get keys from the first row to check column names
        const firstRow = jsonData[0] as any;
        const keys = Object.keys(firstRow);
        
        console.log('Excel Headers found:', keys);

        // Map Excel columns to User type
        const importedUsers: UserDraft[] = jsonData.map((row: any, index) => {
          const rowKeys = Object.keys(row);
          
          // Helper to find key by partial match
          const findValue = (patterns: string[]) => {
            const foundKey = rowKeys.find(k => {
              const cleanK = k.toString().trim().toLowerCase();
              return patterns.some(p => cleanK.includes(p));
            });
            return foundKey ? row[foundKey] : undefined;
          };

          const userName = findValue(['naam', 'name', 'voornaam', 'achternaam', 'medewerker', 'chauffeur', 'gebruiker', 'user']);
          const rawRole = (findValue(['rol', 'role', 'functie', 'type']) || 'chauffeur').toString().toLowerCase();
          const employeeId = findValue(['id', 'employee', 'personeel', 'nummer', 'code', 'nr']);
          const password = findValue(['wachtwoord', 'password', 'pass', 'wacht', 'pw']);
          const phone = findValue(['gsm', 'telefoon', 'phone', 'mobiel', 'gsm-nummer', 'tel']);
          const email = findValue(['email', 'mail', 'e-mail', 'adres']);
          
          // Normalize role
          let role: 'admin' | 'planner' | 'chauffeur' = 'chauffeur';
          if (rawRole.includes('admin') || rawRole.includes('beheer')) role = 'admin';
          else if (rawRole.includes('plan') || rawRole.includes('dispo')) role = 'planner';
          else role = 'chauffeur';

          const generatedId = (Date.now() + index).toString();
          return {
            id: generatedId, // Always generate a fresh ID for imports to avoid conflicts
            name: userName?.toString().trim() || '',
            role: role,
            employeeId: employeeId?.toString().trim() || `VHB-${generatedId.slice(-4)}`,
            password: password?.toString() || '',
            phone: phone?.toString().trim() || undefined,
            email: email?.toString().trim() || undefined,
            isActive: true
          };
        }).filter(u => u.name && u.name.length > 1);

        if (importedUsers.length === 0) {
          const detectedHeaders = keys.join(', ');
          notify(`Geen geldige gebruikers gevonden. Gevonden kolommen: ${detectedHeaders}`, 'error');
        } else {
          // Smart merge: update existing users by name, add new ones
          const newUsersList: UserDraft[] = [...users];
          let updatedCount = 0;
          let addedCount = 0;

          importedUsers.forEach(impUser => {
            const existingIdx = newUsersList.findIndex(u => u.name.toLowerCase() === impUser.name.toLowerCase());
            if (existingIdx !== -1) {
              // Update existing user
              newUsersList[existingIdx] = {
                ...newUsersList[existingIdx],
                phone: impUser.phone || newUsersList[existingIdx].phone,
                email: impUser.email || newUsersList[existingIdx].email,
                role: impUser.role || newUsersList[existingIdx].role,
                employeeId: impUser.employeeId || newUsersList[existingIdx].employeeId,
                password: impUser.password || newUsersList[existingIdx].password
              };
              updatedCount++;
            } else {
              // Add as new user
              newUsersList.push(impUser);
              addedCount++;
            }
          });

          if (addedCount === 0 && updatedCount === 0) {
            notify('Geen nieuwe gegevens of wijzigingen gevonden in het bestand.', 'info');
          } else {
            const confirmMsg = updatedCount > 0 
              ? `Er zijn ${addedCount} nieuwe gebruikers gevonden en ${updatedCount} bestaande gebruikers die worden bijgewerkt. Wilt u doorgaan?`
              : `Er zijn ${addedCount} nieuwe gebruikers gevonden. Wilt u deze toevoegen?`;

            setPendingImportUsers(newUsersList);
            setPendingImportMessage(confirmMsg);
          }
        }
      } catch (error) {
        console.error('Error parsing Excel:', error);
        notify('Fout bij het verwerken van het Excel-bestand. Controleer of het een geldig Excel-bestand is.', 'error');
      } finally {
        setIsImporting(false);
        if (e.target) e.target.value = '';
      }
    };
    reader.onerror = () => {
      notify('Fout bij het lezen van het bestand.', 'error');
      setIsImporting(false);
    };
    reader.readAsArrayBuffer(file);
  };

  const [isSyncing, setIsSyncing] = useState(false);

  const handleConfirmImport = async () => {
    if (!pendingImportUsers) return;
    const success = await onSave(pendingImportUsers);
    if (success) {
      notify('Import succesvol verwerkt.', 'success');
    }
    setPendingImportUsers(null);
    setPendingImportMessage('');
  };

  const handleSync = async () => {
    try {
      setIsSyncing(true);
      const response = await fetch('/api/admin/sync', {
        method: 'POST',
        headers: await getSupabaseAuthHeaders(),
      });
      const text = await response.text();
      
      if (!response.ok && !text.startsWith('{')) {
        throw new Error(`Server fout (${response.status}): ${text.slice(0, 200) || 'Lege response'}`);
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.error('Failed to parse JSON. Response text:', text);
        throw new Error('Server gaf geen geldig JSON-antwoord terug. Controleer de console voor details.');
      }

      if (data.success) {
        notify('Synchronisatie voltooid.', 'success');
      } else {
        notify('Synchronisatie mislukt: ' + (data.error || 'Onbekende fout'), 'error');
      }
    } catch (error: any) {
      console.error('Sync error:', error);
      notify('Er is een fout opgetreden bij het synchroniseren: ' + error.message, 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="max-w-4xl space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-2xl font-bold">{title}</h3>
          <p className="text-sm text-slate-500 font-medium">Beheer medewerkers en hun toegangsrechten.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button 
            onClick={() => setConfirmSyncOpen(true)}
            disabled={isSyncing}
            className="bg-emerald-500 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-emerald-600 transition-colors shadow-lg shadow-emerald-500/20 disabled:opacity-50"
            title="Synchroniseer lokale JSON data naar Supabase"
          >
            <RotateCcw size={18} className={isSyncing ? "animate-spin" : ""} />
            {isSyncing ? 'Synchroniseren...' : 'Sync naar DB'}
          </button>
          <div className="flex bg-slate-100 p-1 rounded-xl mr-2">
            {(['all', 'chauffeur', 'planner', 'admin'] as const).map(role => (
              <button
                key={role}
                onClick={() => setRoleFilter(role)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold transition-all capitalize",
                  roleFilter === role ? "bg-white/85 text-oker-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                )}
              >
                {role === 'all' ? 'Alles' : role}
              </button>
            ))}
          </div>
          <label className="bg-oker-500 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 cursor-pointer hover:bg-oker-600 transition-colors shadow-lg shadow-oker-500/20">
            <Upload size={18} /> 
            {isImporting ? 'Bezig...' : 'Excel Upload'}
            <input type="file" accept=".xlsx, .xls" className="hidden" onChange={handleFileUpload} disabled={isImporting} />
          </label>
          <button 
            onClick={() => setShowAddModal(true)}
            className="bg-slate-900 text-white px-4 py-2 rounded-xl text-sm font-bold flex items-center gap-2 hover:bg-slate-800 transition-colors"
          >
            <Plus size={18} /> Gebruiker Toevoegen
          </button>
        </div>
      </div>

      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="glass-modal rounded-[32px] w-full max-w-md max-h-[90vh] overflow-y-auto"
            >
              <div className="p-8 border-b border-white/70">
                <h4 className="text-xl font-bold">Nieuwe Gebruiker</h4>
                <p className="text-sm text-slate-500">Voeg handmatig een medewerker toe.</p>
              </div>
              <form onSubmit={handleAddUser} className="p-8 space-y-5">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Volledige Naam</label>
                  <input 
                    type="text" 
                    required
                    value={newUser.name}
                    onChange={(e) => setNewUser({...newUser, name: e.target.value})}
                    className="control-input w-full px-4 py-3 rounded-xl outline-none transition-all"
                    placeholder="bijv. Jan Janssen"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Rol</label>
                  <select 
                    value={newUser.role}
                    onChange={(e) => setNewUser({...newUser, role: e.target.value})}
                    className="control-input w-full px-4 py-3 rounded-xl outline-none transition-all bg-white/60"
                  >
                    <option value="chauffeur">Chauffeur</option>
                    <option value="planner">Planner</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Personeelsnummer (Optioneel)</label>
                  <input 
                    type="text" 
                    value={newUser.employeeId}
                    onChange={(e) => setNewUser({...newUser, employeeId: e.target.value})}
                    className="control-input w-full px-4 py-3 rounded-xl outline-none transition-all"
                    placeholder="bijv. VHB-1234"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Tijdelijk Wachtwoord</label>
                  <input 
                    type="password" 
                    value={newUser.password}
                    onChange={(e) => setNewUser({...newUser, password: e.target.value})}
                    className="control-input w-full px-4 py-3 rounded-xl outline-none transition-all"
                    placeholder="Minstens 8 tekens"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">GSM Nummer (Optioneel)</label>
                  <input 
                    type="text" 
                    value={newUser.phone}
                    onChange={(e) => setNewUser({...newUser, phone: e.target.value})}
                    className="control-input w-full px-4 py-3 rounded-xl outline-none transition-all"
                    placeholder="bijv. 0470 12 34 56"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">E-mailadres</label>
                  <input 
                    type="email" 
                    required
                    value={newUser.email}
                    onChange={(e) => setNewUser({...newUser, email: e.target.value})}
                    className="control-input w-full px-4 py-3 rounded-xl outline-none transition-all"
                    placeholder="bijv. jan@voorbeeld.be"
                  />
                </div>
                <div className="flex gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 px-4 py-3 rounded-xl font-bold text-slate-500 hover:bg-slate-50 transition-colors"
                  >
                    Annuleren
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 px-4 py-3 rounded-xl font-bold bg-oker-500 text-white hover:bg-oker-600 transition-colors shadow-lg shadow-oker-500/20"
                  >
                    Toevoegen
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="glass-modal rounded-[32px] w-full max-w-md max-h-[90vh] overflow-y-auto"
            >
              <div className="p-8 border-b border-white/70 flex justify-between items-center">
                <div>
                  <h4 className="text-xl font-bold">Gebruiker Bewerken</h4>
                  <p className="text-sm text-slate-500">Pas de gegevens van {editingUser.name} aan.</p>
                </div>
                <button 
                  onClick={() => !isProtectedAdmin(editingUser) && setConfirmDeleteId(editingUser.id)}
                  disabled={isProtectedAdmin(editingUser)}
                  className={cn(
                    "p-2 rounded-lg transition-colors",
                    isProtectedAdmin(editingUser)
                      ? "text-slate-300 cursor-not-allowed"
                      : "text-red-500 hover:bg-red-50"
                  )}
                  title={isProtectedAdmin(editingUser) ? "Laatste actieve admin kan niet verwijderd worden" : "Verwijder gebruiker"}
                >
                  <Trash2 size={20} />
                </button>
              </div>
              <form onSubmit={handleUpdateUser} className="p-8 space-y-5">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Volledige Naam</label>
                  <input 
                    type="text" 
                    required
                    value={editingUser.name}
                    onChange={(e) => setEditingUser({...editingUser, name: e.target.value})}
                    className="control-input w-full px-4 py-3 rounded-xl outline-none transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Rol</label>
                  <select 
                    value={editingUser.role}
                    onChange={(e) => setEditingUser({...editingUser, role: e.target.value as any})}
                    className="control-input w-full px-4 py-3 rounded-xl outline-none transition-all bg-white/60"
                  >
                    <option value="chauffeur">Chauffeur</option>
                    <option value="planner">Planner</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Personeelsnummer</label>
                  <input 
                    type="text" 
                    value={editingUser.employeeId}
                    onChange={(e) => setEditingUser({...editingUser, employeeId: e.target.value})}
                    className="control-input w-full px-4 py-3 rounded-xl outline-none transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Nieuw Wachtwoord (Optioneel)</label>
                  <input 
                    type="password" 
                    value={editingUser.password || ''}
                    onChange={(e) => setEditingUser({...editingUser, password: e.target.value})}
                    className="control-input w-full px-4 py-3 rounded-xl outline-none transition-all"
                    placeholder="Leeg laten om niet te wijzigen"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">GSM Nummer</label>
                  <input 
                    type="text" 
                    value={editingUser.phone || ''}
                    onChange={(e) => setEditingUser({...editingUser, phone: e.target.value})}
                    className="control-input w-full px-4 py-3 rounded-xl outline-none transition-all"
                    placeholder="bijv. 0470 12 34 56"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">E-mailadres</label>
                  <input 
                    type="email" 
                    value={editingUser.email || ''}
                    onChange={(e) => setEditingUser({...editingUser, email: e.target.value})}
                    className="control-input w-full px-4 py-3 rounded-xl outline-none transition-all"
                    placeholder="bijv. jan@voorbeeld.be"
                  />
                </div>

                <div className="flex items-center justify-between p-4 surface-muted rounded-2xl">
                  <div>
                    <p className="text-sm font-bold text-slate-700">Account Actief</p>
                    <p className="text-[10px] text-slate-400 font-medium">Inactieve gebruikers kunnen niet inloggen.</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingUser({...editingUser, isActive: editingUser.isActive === false ? true : false})}
                    className={cn(
                      "w-12 h-6 rounded-full transition-all relative",
                      editingUser.isActive !== false ? "bg-emerald-500" : "bg-slate-300"
                    )}
                  >
                    <div className={cn(
                      "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                      editingUser.isActive !== false ? "left-7" : "left-1"
                    )} />
                  </button>
                </div>

                <div className="pt-2 grid grid-cols-2 gap-4">
                  <div className="p-3 surface-muted rounded-xl">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Laatst Ingelogd</p>
                    <p className="text-xs font-bold text-slate-700 mt-1">{editingUser.lastLogin || 'Nooit'}</p>
                  </div>
                  <div className="p-3 surface-muted rounded-xl">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Actieve Sessies</p>
                    <p className="text-xs font-bold text-slate-700 mt-1">{editingUser.activeSessions || 0}</p>
                  </div>
                </div>
                <div className="flex gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => setEditingUser(null)}
                    className="flex-1 px-4 py-3 rounded-xl font-bold text-slate-500 hover:bg-slate-50 transition-colors"
                  >
                    Annuleren
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 px-4 py-3 rounded-xl font-bold bg-slate-900 text-white hover:bg-slate-800 transition-colors shadow-lg"
                  >
                    Opslaan
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <div className="glass-oker p-6 rounded-3xl text-sm">
        <p className="font-bold text-oker-800 mb-2">Excel Instructies:</p>
        <p className="text-oker-700">Gebruik bij voorkeur de kolommen <span className="font-mono font-bold">Naam, E-mail, Rol</span>. Voor nieuwe accounts kun je optioneel ook <span className="font-mono font-bold">Wachtwoord</span> toevoegen zodat Supabase meteen een login kan aanmaken.</p>
      </div>

      <div className="surface-table rounded-[32px] overflow-hidden">
        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Medewerker</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Status</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Laatst Actief</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] text-center">Sessies</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] text-right">Acties</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredUsers.map(u => (
                <tr key={u.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-8 py-6">
                    <div className="font-black text-slate-800 tracking-tight text-lg">{u.name}</div>
                    <div className="text-[10px] text-oker-500 font-black uppercase tracking-widest mt-0.5">{u.role}</div>
                  </td>
                  <td className="px-8 py-6">
                    <span className={cn(
                      "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
                      u.isActive !== false ? "bg-emerald-50 text-emerald-600 border border-emerald-100" : "bg-red-50 text-red-600 border border-red-100"
                    )}>
                      {u.isActive !== false ? 'Actief' : 'Inactief'}
                    </span>
                  </td>
                  <td className="px-8 py-6 text-sm font-bold text-slate-500">
                    {u.lastLogin ? u.lastLogin : <span className="text-slate-300 italic font-medium">Nooit</span>}
                  </td>
                  <td className="px-8 py-6 text-center">
                    <span className={cn(
                      "w-8 h-8 inline-flex items-center justify-center rounded-xl text-xs font-black",
                      (u.activeSessions || 0) > 0 ? "bg-emerald-50 text-emerald-600 border border-emerald-100" : "bg-slate-50 text-slate-400 border border-slate-100"
                    )}>
                      {u.activeSessions || 0}
                    </span>
                  </td>
                  <td className="px-8 py-6 text-right">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => setConfirmResetUser(u)}
                        className="p-2 text-slate-400 hover:text-oker-600 hover:bg-oker-50 rounded-xl transition-all"
                        title="Stel nieuw tijdelijk wachtwoord in"
                      >
                        <RotateCcw size={18} />
                      </button>
                      <button 
                        onClick={() => setEditingUser(u)}
                        className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-oker-500 transition-all active:scale-95"
                      >
                        Bewerken
                      </button>
                      <button 
                        onClick={() => !isProtectedAdmin(u) && setConfirmDeleteId(u.id)}
                        disabled={isProtectedAdmin(u)}
                        className={cn(
                          "p-2 rounded-xl transition-all",
                          isProtectedAdmin(u)
                            ? "text-slate-300 cursor-not-allowed"
                            : "text-red-500 hover:bg-red-50"
                        )}
                        title={isProtectedAdmin(u) ? "Laatste actieve admin kan niet verwijderd worden" : "Verwijder gebruiker"}
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile Card View */}
        <div className="md:hidden divide-y divide-slate-100">
          {filteredUsers.map(u => (
            <div key={u.id} className="p-6 space-y-4 active:bg-slate-50 transition-colors">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-black text-slate-800 tracking-tight text-lg leading-tight">{u.name}</div>
                  <div className="text-[10px] text-oker-500 font-black uppercase tracking-widest mt-1">{u.role}</div>
                </div>
                <span className={cn(
                  "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
                  u.isActive !== false ? "bg-emerald-50 text-emerald-600 border border-emerald-100" : "bg-red-50 text-red-600 border border-red-100"
                )}>
                  {u.isActive !== false ? 'Actief' : 'Inactief'}
                </span>
              </div>
              
              <div className="grid grid-cols-2 gap-4 pt-2">
                <div className="p-3 bg-slate-50 rounded-2xl">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Laatst Actief</p>
                  <p className="text-xs font-bold text-slate-700 mt-1">{u.lastLogin || 'Nooit'}</p>
                </div>
                <div className="p-3 bg-slate-50 rounded-2xl">
                  <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Sessies</p>
                  <p className="text-xs font-bold text-slate-700 mt-1">{u.activeSessions || 0}</p>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button 
                  onClick={() => setEditingUser(u)}
                  className="flex-1 bg-slate-900 text-white py-4 rounded-2xl text-xs font-black uppercase tracking-widest active:scale-95 transition-all"
                >
                  Bewerken
                </button>
                <button 
                  onClick={() => !isProtectedAdmin(u) && setConfirmDeleteId(u.id)}
                  disabled={isProtectedAdmin(u)}
                  className={cn(
                    "px-4 rounded-2xl active:scale-95 transition-all",
                    isProtectedAdmin(u)
                      ? "bg-slate-50 text-slate-300 cursor-not-allowed"
                      : "bg-red-50 text-red-500"
                  )}
                  title={isProtectedAdmin(u) ? "Laatste actieve admin kan niet verwijderd worden" : "Verwijder gebruiker"}
                >
                  <Trash2 size={20} />
                </button>
                <button 
                  onClick={() => setConfirmResetUser(u)}
                  className="px-4 bg-slate-100 text-slate-500 rounded-2xl active:scale-95 transition-all"
                  title="Stel nieuw tijdelijk wachtwoord in"
                >
                  <RotateCcw size={20} />
                </button>
              </div>
            </div>
          ))}
        </div>
        {filteredUsers.length === 0 && (
          <div className="p-6">
            <EmptyState
              icon={<Users size={28} />}
              title="Geen gebruikers gevonden"
              message="Pas je filter aan of voeg een nieuwe gebruiker toe."
            />
          </div>
        )}
      </div>

      <ConfirmationModal 
        isOpen={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={handleDeleteUser}
        title="Gebruiker Verwijderen"
        message="Weet je zeker dat je deze gebruiker wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt."
      />

      <AnimatePresence>
        {confirmResetUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="glass-modal rounded-[32px] w-full max-w-md overflow-hidden"
            >
              <div className="p-8 border-b border-white/70">
                <h4 className="text-xl font-black">Wachtwoord resetten</h4>
                <p className="mt-2 text-sm text-slate-500 font-medium">
                  Stel een nieuw tijdelijk wachtwoord in voor {confirmResetUser.name}.
                </p>
              </div>
              <div className="p-8 space-y-5">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Tijdelijk wachtwoord</label>
                  <input
                    type="password"
                    value={resetPasswordValue}
                    onChange={(e) => setResetPasswordValue(e.target.value)}
                    className="control-input w-full px-4 py-3 rounded-xl outline-none transition-all"
                    placeholder="Minstens 8 tekens"
                    autoFocus
                  />
                </div>
                <p className="text-xs text-slate-400 font-medium">
                  De gebruiker logt daarna in met dit nieuwe wachtwoord.
                </p>
                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setConfirmResetUser(null);
                      setResetPasswordValue('');
                    }}
                    className="flex-1 px-4 py-3 rounded-xl font-bold text-slate-500 hover:bg-slate-50 transition-colors"
                  >
                    Annuleren
                  </button>
                  <button
                    type="button"
                    onClick={handleResetPassword}
                    disabled={isResettingPassword}
                    className={cn(
                      "flex-1 px-4 py-3 rounded-xl font-bold text-white shadow-lg transition-colors",
                      isResettingPassword ? "bg-amber-300 cursor-not-allowed" : "bg-amber-500 hover:bg-amber-600 shadow-amber-500/20"
                    )}
                  >
                    {isResettingPassword ? 'Bezig...' : 'Resetten'}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmationModal
        isOpen={confirmSyncOpen}
        onClose={() => setConfirmSyncOpen(false)}
        onConfirm={handleSync}
        title="Gebruikers synchroniseren"
        message="Deze actie schrijft de lokale gebruikersgegevens weg naar de database en kan bestaande records met dezelfde ID overschrijven."
        confirmText="Synchroniseren"
        variant="warning"
      />

      <ConfirmationModal
        isOpen={!!pendingImportUsers}
        onClose={() => {
          setPendingImportUsers(null);
          setPendingImportMessage('');
        }}
        onConfirm={handleConfirmImport}
        title="Gebruikers importeren"
        message={pendingImportMessage || 'Wil je deze import toepassen?'}
        confirmText="Importeren"
        variant="warning"
      />
    </div>
  );
}

function ManageDiversionsView({ diversions, onSave, canAdminSync }: { diversions: Diversion[], onSave: (d: Diversion[]) => void, canAdminSync: boolean }) {
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [confirmSyncOpen, setConfirmSyncOpen] = useState(false);

  const handleSync = async () => {
    if (!canAdminSync) {
      notify('Deze synchronisatie is alleen beschikbaar voor admins.', 'error');
      return;
    }
    try {
      setIsSyncing(true);
      const response = await fetch('/api/admin/sync', {
        method: 'POST',
        headers: await getSupabaseAuthHeaders(),
      });
      const text = await response.text();
      
      if (!response.ok && !text.startsWith('{')) {
        throw new Error(`Server fout (${response.status}): ${text.slice(0, 200) || 'Lege response'}`);
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (e) {
        console.error('Failed to parse JSON. Response text:', text);
        throw new Error('Server gaf geen geldig JSON-antwoord terug. Controleer de console voor details.');
      }

      if (data.success) {
        notify('Synchronisatie voltooid.', 'success');
      } else {
        notify('Synchronisatie mislukt: ' + (data.error || 'Onbekende fout'), 'error');
      }
    } catch (error: any) {
      console.error('Sync error:', error);
      notify('Er is een fout opgetreden bij het synchroniseren: ' + error.message, 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  const [formData, setFormData] = useState<Partial<Diversion>>({
    line: '',
    title: '',
    description: '',
    startDate: new Date().toISOString().split('T')[0],
    severity: 'medium',
    mapCoordinates: ''
  });
  const [pdfFile, setPdfFile] = useState<File | null>(null);

  const handleOpenAdd = () => {
    setEditingId(null);
    setFormData({
      line: '',
      title: '',
      description: '',
      startDate: new Date().toISOString().split('T')[0],
      severity: 'medium',
      mapCoordinates: ''
    });
    setPdfFile(null);
    setShowModal(true);
  };

  const handleOpenEdit = (div: Diversion) => {
    setEditingId(div.id);
    setFormData({
      line: div.line,
      title: div.title,
      description: div.description,
      startDate: div.startDate,
      endDate: div.endDate,
      severity: div.severity,
      mapCoordinates: div.mapCoordinates || ''
    });
    setPdfFile(null);
    setShowModal(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    let pdfUrl = '';
    if (pdfFile) {
      pdfUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result as string);
        reader.readAsDataURL(pdfFile);
      });
    }

    if (editingId) {
      const updatedDiversions = diversions.map(d => 
        d.id === editingId 
          ? { 
              ...d, 
              ...formData, 
              pdfUrl: pdfUrl || d.pdfUrl 
            } as Diversion 
          : d
      );
      onSave(updatedDiversions);
    } else {
      const diversionToAdd: Diversion = {
        id: Date.now().toString(),
        line: formData.line || 'Alle',
        title: formData.title || '',
        description: formData.description || '',
        startDate: formData.startDate || '',
        endDate: formData.endDate,
        severity: formData.severity as any || 'medium',
        pdfUrl: pdfUrl || undefined,
        mapCoordinates: formData.mapCoordinates || undefined
      };
      onSave([...diversions, diversionToAdd]);
    }

    setShowModal(false);
  };

  const handleDelete = () => {
    if (confirmDeleteId) {
      onSave(diversions.filter(d => d.id !== confirmDeleteId));
      setConfirmDeleteId(null);
    }
  };

  return (
    <div className="max-w-4xl space-y-6 md:space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h3 className="text-2xl font-black tracking-tight">Beheer Omleidingen</h3>
        {canAdminSync ? (
          <button 
            onClick={() => setConfirmSyncOpen(true)}
            disabled={isSyncing}
            className="w-full sm:w-auto bg-emerald-500 text-white px-6 py-3 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 active:scale-95"
            title="Synchroniseer lokale JSON data naar Supabase"
          >
            <RotateCcw size={18} className={isSyncing ? "animate-spin" : ""} />
            {isSyncing ? 'SYNCHRONISEREN...' : 'SYNC NAAR DB'}
          </button>
        ) : null}
      </div>

      <div className="surface-card p-6 md:p-8 rounded-[32px] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h4 className="text-lg font-black text-slate-800 tracking-tight">Nieuwe Omleiding</h4>
          <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Voeg een omleiding toe voor de chauffeurs</p>
        </div>
        <button 
          onClick={handleOpenAdd}
          className="w-full sm:w-auto bg-oker-500 text-white px-8 py-4 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-oker-600 transition-all shadow-xl shadow-oker-500/20 active:scale-95"
        >
          <Plus size={20} /> TOEVOEGEN
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {diversions.map(div => (
          <div key={div.id} className="surface-card surface-card-hover p-6 md:p-8 rounded-[32px] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 group">
            <div className="flex items-start gap-5">
              <div className={cn(
                "w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 transition-transform duration-500 group-hover:scale-110",
                div.severity === 'high' ? "bg-red-50 text-red-600 border border-red-100" : 
                div.severity === 'medium' ? "bg-amber-50 text-amber-600 border border-amber-100" : "bg-blue-50 text-blue-600 border border-blue-100"
              )}>
                <MapPin size={28} />
              </div>
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-1">
                  <h4 className="font-black text-slate-800 text-lg tracking-tight leading-tight">{div.title}</h4>
                  <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-[10px] font-black uppercase tracking-widest">Lijn {div.line}</span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-slate-400 font-black uppercase tracking-widest">
                  <Calendar size={12} className="text-oker-400" />
                  {div.startDate} {div.endDate ? `t/m ${div.endDate}` : '(Geen einddatum)'}
                </div>
              </div>
            </div>
            
            <div className="w-full sm:w-auto flex items-center justify-between sm:justify-end gap-3 pt-4 sm:pt-0 border-t sm:border-t-0 border-slate-50">
              <div className="flex items-center gap-2">
                {div.pdfUrl && (
                  <div className="w-10 h-10 flex items-center justify-center text-emerald-500 bg-emerald-50 border border-emerald-100 rounded-xl" title="PDF Beschikbaar">
                    <FileText size={20} />
                  </div>
                )}
                <button 
                  onClick={() => handleOpenEdit(div)}
                  className="w-10 h-10 flex items-center justify-center text-slate-400 hover:text-oker-600 hover:bg-oker-50 border border-slate-100 rounded-xl transition-all active:scale-90"
                  title="Bewerken"
                >
                  <Pencil size={20} />
                </button>
              </div>
              <button 
                onClick={() => setConfirmDeleteId(div.id)}
                className="w-10 h-10 flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 border border-slate-100 rounded-xl transition-all active:scale-90"
                title="Verwijderen"
              >
                <Trash2 size={20} />
              </button>
            </div>
          </div>
        ))}
        {diversions.length === 0 && (
          <EmptyState
            icon={<MapPin size={28} />}
            title="Geen actieve omleidingen"
            message="Er staan momenteel geen omleidingen in het systeem."
          />
        )}
      </div>

      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="glass-modal rounded-[40px] w-full max-w-lg overflow-hidden"
            >
              <div className="p-8 border-b border-white/70 flex items-center justify-between">
                <div>
                  <h4 className="text-xl font-black">{editingId ? 'Omleiding Bewerken' : 'Nieuwe Omleiding'}</h4>
                  <p className="text-sm text-slate-500 font-medium">Vul de details in en upload eventueel een PDF.</p>
                </div>
                <button onClick={() => setShowModal(false)} className="p-2 text-slate-400 hover:bg-slate-50 rounded-xl">
                  <X size={24} />
                </button>
              </div>
              <form onSubmit={handleSubmit} className="p-8 space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Lijn(en)</label>
                    <input 
                      type="text" 
                      required
                      value={formData.line}
                      onChange={(e) => setFormData({...formData, line: e.target.value})}
                      className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-oker-500/10 focus:border-oker-400 outline-none transition-all font-bold text-sm"
                      placeholder="bijv. 1, 2 of Alle"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Ernst</label>
                    <select 
                      value={formData.severity}
                      onChange={(e) => setFormData({...formData, severity: e.target.value as any})}
                      className="control-input w-full px-4 py-3 rounded-2xl outline-none transition-all font-bold text-sm bg-white/60"
                    >
                      <option value="low">Laag (Informatief)</option>
                      <option value="medium">Medium (Vertraging)</option>
                      <option value="high">Hoog (Blokkade)</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Titel</label>
                  <input 
                    type="text" 
                    required
                    value={formData.title}
                    onChange={(e) => setFormData({...formData, title: e.target.value})}
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-oker-500/10 focus:border-oker-400 outline-none transition-all font-bold text-sm"
                    placeholder="bijv. Wegwerkzaamheden N70"
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Omschrijving</label>
                  <textarea 
                    required
                    rows={3}
                    value={formData.description}
                    onChange={(e) => setFormData({...formData, description: e.target.value})}
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-oker-500/10 focus:border-oker-400 outline-none transition-all font-bold text-sm resize-none"
                    placeholder="Beschrijf de omleiding..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Startdatum</label>
                    <input 
                      type="date" 
                      required
                      value={formData.startDate}
                      onChange={(e) => setFormData({...formData, startDate: e.target.value})}
                      className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-oker-500/10 focus:border-oker-400 outline-none transition-all font-bold text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Einddatum (Optioneel)</label>
                    <input 
                      type="date" 
                      value={formData.endDate || ''}
                      onChange={(e) => setFormData({...formData, endDate: e.target.value})}
                      className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-oker-500/10 focus:border-oker-400 outline-none transition-all font-bold text-sm"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Kaart Coördinaten (JSON Array)</label>
                  <textarea 
                    rows={2}
                    value={formData.mapCoordinates}
                    onChange={(e) => setFormData({...formData, mapCoordinates: e.target.value})}
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-oker-500/10 focus:border-oker-400 outline-none transition-all font-bold text-sm resize-none"
                    placeholder='[[lat, lng], [lat, lng], ...]'
                  />
                  <p className="text-[9px] text-slate-400 font-medium px-1">Plak hier een JSON array van coördinaten om de route op de kaart te tonen.</p>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">PDF Bestand {editingId && '(Optioneel)'}</label>
                  <div className="relative">
                    <input 
                      type="file" 
                      accept=".pdf"
                      onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
                      className="hidden"
                      id="pdf-upload"
                    />
                    <label 
                      htmlFor="pdf-upload"
                      className="w-full px-4 py-4 rounded-2xl border-2 border-dashed border-slate-200 hover:border-oker-400 hover:bg-oker-50 transition-all flex flex-col items-center justify-center gap-2 cursor-pointer group"
                    >
                      <Upload className="text-slate-300 group-hover:text-oker-500 transition-colors" size={24} />
                      <span className="text-xs font-bold text-slate-400 group-hover:text-oker-600">
                        {pdfFile ? pdfFile.name : (editingId ? 'Klik om PDF te vervangen' : 'Klik om PDF te selecteren')}
                      </span>
                    </label>
                  </div>
                </div>

                <div className="pt-4 flex gap-3">
                  <button 
                    type="button"
                    onClick={() => setShowModal(false)}
                    className="flex-1 px-4 py-4 rounded-2xl font-black text-slate-400 hover:bg-slate-50 transition-all uppercase tracking-widest text-xs"
                  >
                    Annuleren
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 px-4 py-4 rounded-2xl font-black bg-oker-500 text-white hover:bg-oker-600 transition-all shadow-xl shadow-oker-500/20 uppercase tracking-widest text-xs"
                  >
                    {editingId ? 'Opslaan' : 'Toevoegen'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmationModal 
        isOpen={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={handleDelete}
        title="Omleiding Verwijderen"
        message="Weet je zeker dat je deze omleiding wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt."
      />

      {canAdminSync ? (
        <ConfirmationModal
          isOpen={confirmSyncOpen}
          onClose={() => setConfirmSyncOpen(false)}
          onConfirm={handleSync}
          title="Omleidingen synchroniseren"
          message="Deze actie schrijft de lokale omleidingen weg naar de database en kan bestaande records met dezelfde ID overschrijven."
          confirmText="Synchroniseren"
          variant="warning"
        />
      ) : null}
    </div>
  );
}

function Input({ label, type, placeholder, options, value, onChange }: { label: string, type: string, placeholder?: string, options?: { label: string, value: string }[], value?: any, onChange?: (e: any) => void }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700 mb-2">{label}</label>
      {type === 'select' ? (
        <select 
          value={value}
          onChange={onChange}
          className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all bg-white"
        >
          {options?.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
      ) : (
        <input 
          type={type} 
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
        />
      )}
    </div>
  );
}

function ManageServicesView({ services, onSave, canAdminOverride }: { services: Service[], onSave: (s: Service[]) => void, canAdminOverride: boolean }) {
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [pendingImportedServices, setPendingImportedServices] = useState<Service[] | null>(null);
  const [pendingImportCount, setPendingImportCount] = useState(0);
  const [formData, setFormData] = useState({
    serviceNumber: '', 
    startTime: '', 
    endTime: '',
    startTime2: '',
    endTime2: '',
    startTime3: '',
    endTime3: ''
  });
  const [isImporting, setIsImporting] = useState(false);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canAdminOverride) {
      notify('Excel-import is alleen beschikbaar voor admins.', 'error');
      if (e.target) e.target.value = '';
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const XLSX = await import('xlsx');
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

        if (!jsonData || !Array.isArray(jsonData) || jsonData.length === 0) {
          notify('Het Excel-bestand lijkt leeg te zijn.', 'error');
          setIsImporting(false);
          return;
        }

        const formatExcelTime = (val: any) => {
          if (val === undefined || val === null || val === "") return "";
          if (typeof val === 'number') {
            // Excel stores time as a fraction of 24 hours (0.5 = 12:00)
            const totalSeconds = Math.round(val * 24 * 3600);
            const hours = Math.floor(totalSeconds / 3600);
            const minutes = Math.floor((totalSeconds % 3600) / 60);
            return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
          }
          return val.toString().trim();
        };

        const importedServices: Service[] = jsonData.map((row: any, index) => {
          const rowKeys = Object.keys(row);
          const findValue = (patterns: string[]) => {
            const foundKey = rowKeys.find(k => {
              const cleanK = k.toString().trim().toLowerCase();
              return patterns.some(p => cleanK.includes(p));
            });
            return foundKey ? row[foundKey] : undefined;
          };

          const serviceNumber = findValue(['dienst', 'nummer', 'service', 'nr']);
          
          // Part 1
          const startTime = findValue(['start 1', 'begin 1', 'van 1', 'starttijd 1', 'start (deel 1)']);
          const endTime = findValue(['eind 1', 'stop 1', 'tot 1', 'eindtijd 1', 'einde (deel 1)']);
          
          // Part 2
          const startTime2 = findValue(['start 2', 'begin 2', 'van 2', 'starttijd 2', 'start (deel 2)']);
          const endTime2 = findValue(['eind 2', 'stop 2', 'tot 2', 'eindtijd 2', 'einde (deel 2)']);
          
          // Part 3
          const startTime3 = findValue(['start 3', 'begin 3', 'van 3', 'starttijd 3', 'start (deel 3)']);
          const endTime3 = findValue(['eind 3', 'stop 3', 'tot 3', 'eindtijd 3', 'einde (deel 3)']);

          // Fallback for simple start/end if part 1 is missing
          const finalStart = startTime || findValue(['start', 'begin', 'van']);
          const finalEnd = endTime || findValue(['eind', 'stop', 'tot']);

          return {
            id: (Date.now() + index).toString(),
            serviceNumber: serviceNumber?.toString().trim() || '',
            startTime: formatExcelTime(finalStart),
            endTime: formatExcelTime(finalEnd),
            startTime2: formatExcelTime(startTime2),
            endTime2: formatExcelTime(endTime2),
            startTime3: formatExcelTime(startTime3),
            endTime3: formatExcelTime(endTime3)
          };
        }).filter(s => s.serviceNumber);

        if (importedServices.length > 0) {
          setPendingImportedServices(importedServices);
          setPendingImportCount(importedServices.length);
        } else {
          notify('Geen geldige diensten gevonden in het bestand. Controleer de kolommen Dienst, Start en Eind.', 'error');
        }
      } catch (error) {
        console.error('Error parsing Excel:', error);
        notify('Fout bij het verwerken van het Excel-bestand.', 'error');
      } finally {
        setIsImporting(false);
        if (e.target) e.target.value = '';
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const downloadCSV = () => {
    const headers = ['Dienstnummer', 'Start 1', 'Eind 1', 'Start 2', 'Eind 2', 'Start 3', 'Eind 3'];
    const rows = services.map(s => [
      `"${s.serviceNumber}"`, 
      `"${s.startTime}"`, 
      `"${s.endTime}"`,
      `"${s.startTime2 || ''}"`,
      `"${s.endTime2 || ''}"`,
      `"${s.startTime3 || ''}"`,
      `"${s.endTime3 || ''}"`
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `beheer_dienstoverzicht_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleEdit = (service: Service) => {
    setEditingId(service.id);
    setFormData({ 
      serviceNumber: service.serviceNumber, 
      startTime: service.startTime, 
      endTime: service.endTime,
      startTime2: service.startTime2 || '',
      endTime2: service.endTime2 || '',
      startTime3: service.startTime3 || '',
      endTime3: service.endTime3 || ''
    });
    setShowModal(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingId) {
      onSave(services.map(s => s.id === editingId ? { ...s, ...formData } : s));
    } else {
      onSave([...services, { id: Date.now().toString(), ...formData }]);
    }
    setShowModal(false);
    setEditingId(null);
    setFormData({ 
      serviceNumber: '', 
      startTime: '', 
      endTime: '',
      startTime2: '',
      endTime2: '',
      startTime3: '',
      endTime3: ''
    });
  };

  const handleDelete = (id: string) => {
    if (!canAdminOverride) {
      notify('Diensten verwijderen is alleen beschikbaar voor admins.', 'error');
      return;
    }
    setConfirmDeleteId(id);
  };

  const handleConfirmDelete = () => {
    if (!confirmDeleteId) return;
    onSave(services.filter(s => s.id !== confirmDeleteId));
    setConfirmDeleteId(null);
  };

  const handleConfirmImport = () => {
    if (!canAdminOverride) {
      notify('Excel-import is alleen beschikbaar voor admins.', 'error');
      setPendingImportedServices(null);
      setPendingImportCount(0);
      return;
    }
    if (!pendingImportedServices) return;
    onSave(pendingImportedServices);
    setPendingImportedServices(null);
    setPendingImportCount(0);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-2xl font-black tracking-tight">Beheer Dienstoverzicht</h3>
          <p className="text-sm text-slate-500 font-medium">Voeg diensten toe, bewerk of verwijder ze.</p>
        </div>
        <div className="flex items-center gap-3">
          {canAdminOverride ? (
            <>
              <input
                type="file"
                accept=".xlsx, .xls"
                className="hidden"
                id="services-upload"
                onChange={handleFileUpload}
                disabled={isImporting}
              />
              <label
                htmlFor="services-upload"
                className={cn(
                  "control-button-soft flex items-center gap-2 px-6 py-3 rounded-2xl text-slate-600 font-bold text-sm transition-all cursor-pointer active:scale-95",
                  isImporting && "opacity-50 cursor-not-allowed"
                )}
                title="Importeer vanuit Excel"
              >
                <Upload size={20} className="text-oker-500" />
                {isImporting ? 'Importeren...' : 'Excel Import'}
              </label>
            </>
          ) : (
            <div className="rounded-2xl border border-white/70 bg-white/55 px-4 py-3 text-[10px] font-black uppercase tracking-[0.18em] text-slate-400">
              Excel import admin-only
            </div>
          )}
          <button
            onClick={downloadCSV}
            className="control-button-soft flex items-center gap-2 px-6 py-3 rounded-2xl text-slate-600 font-bold text-sm transition-all active:scale-95"
            title="Download als CSV"
          >
            <Download size={20} className="text-oker-500" />
            Download CSV
          </button>
          <button 
            onClick={() => { 
              setEditingId(null); 
              setFormData({ 
                serviceNumber: '', 
                startTime: '', 
                endTime: '',
                startTime2: '',
                endTime2: '',
                startTime3: '',
                endTime3: ''
              }); 
              setShowModal(true); 
            }}
            className="bg-oker-500 text-white font-black px-6 py-3 rounded-2xl hover:bg-oker-600 transition-all shadow-lg shadow-oker-500/20 active:scale-95 flex items-center gap-2"
          >
            <Plus size={20} />
            Nieuwe Dienst
          </button>
        </div>
      </div>

      <div className="surface-table rounded-[40px] overflow-hidden">
        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50">
                <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Dienst</th>
                <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Deel 1</th>
                <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Deel 2</th>
                <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Deel 3</th>
                <th className="px-6 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100 text-right">Acties</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {services.map(s => (
                <tr key={s.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-6 py-5 font-black text-slate-800">{s.serviceNumber}</td>
                  <td className="px-6 py-5 text-slate-600 font-bold text-xs">
                    {s.startTime} - {s.endTime}
                  </td>
                  <td className="px-6 py-5 text-slate-600 font-bold text-xs">
                    {s.startTime2 ? `${s.startTime2} - ${s.endTime2}` : '-'}
                  </td>
                  <td className="px-6 py-5 text-slate-600 font-bold text-xs">
                    {s.startTime3 ? `${s.startTime3} - ${s.endTime3}` : '-'}
                  </td>
                  <td className="px-6 py-5 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => handleEdit(s)} className="p-2 text-slate-400 hover:text-oker-500 transition-colors"><Pencil size={18} /></button>
                      {canAdminOverride ? <button onClick={() => handleDelete(s.id)} className="p-2 text-slate-400 hover:text-red-500 transition-colors"><Trash2 size={18} /></button> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile Card View */}
        <div className="md:hidden divide-y divide-slate-50">
          {services.map(s => (
            <div key={s.id} className="p-6 space-y-4 hover:bg-slate-50/50 transition-colors">
              <div className="flex justify-between items-center">
                <span className="text-lg font-black text-slate-800 tracking-tight">{s.serviceNumber}</span>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleEdit(s)} className="p-2 text-slate-400 hover:text-oker-500 transition-colors"><Pencil size={18} /></button>
                  {canAdminOverride ? <button onClick={() => handleDelete(s.id)} className="p-2 text-slate-400 hover:text-red-500 transition-colors"><Trash2 size={18} /></button> : null}
                </div>
              </div>
              
              <div className="grid grid-cols-1 gap-3">
                <div className="flex flex-col gap-1">
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Deel 1</span>
                  <div className="flex items-center gap-2 text-slate-700 font-bold text-sm">
                    <Clock size={14} className="text-oker-500" />
                    {s.startTime} - {s.endTime}
                  </div>
                </div>

                {s.startTime2 && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Deel 2</span>
                    <div className="flex items-center gap-2 text-slate-700 font-bold text-sm">
                      <Clock size={14} className="text-oker-500" />
                      {s.startTime2} - {s.endTime2}
                    </div>
                  </div>
                )}

                {s.startTime3 && (
                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Deel 3</span>
                    <div className="flex items-center gap-2 text-slate-700 font-bold text-sm">
                      <Clock size={14} className="text-oker-500" />
                      {s.startTime3} - {s.endTime3}
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {services.length === 0 && (
          <div className="p-6">
            <EmptyState
              icon={<Clock size={28} />}
              title="Geen diensten geconfigureerd"
              message="Voeg handmatig een dienst toe of importeer een Excel-bestand."
            />
          </div>
        )}
      </div>

      <AnimatePresence>
        {showModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="glass-modal rounded-[40px] w-full max-w-lg overflow-hidden"
            >
              <div className="p-8 border-b border-white/70 flex items-center justify-between">
                <h4 className="text-xl font-black">{editingId ? 'Dienst Bewerken' : 'Nieuwe Dienst'}</h4>
                <button onClick={() => setShowModal(false)} className="p-2 text-slate-400 hover:bg-slate-50 rounded-xl"><X size={24} /></button>
              </div>
              <form onSubmit={handleSubmit} className="p-8 space-y-5">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Dienstnummer</label>
                  <input 
                    type="text" required value={formData.serviceNumber}
                    onChange={(e) => setFormData({...formData, serviceNumber: e.target.value})}
                    className="control-input w-full px-4 py-3 rounded-2xl outline-none transition-all font-bold text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Starttijd (Deel 1)</label>
                    <input 
                      type="time" required value={formData.startTime}
                      onChange={(e) => setFormData({...formData, startTime: e.target.value})}
                      className="control-input w-full px-4 py-3 rounded-2xl outline-none transition-all font-bold text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Eindtijd (Deel 1)</label>
                    <input 
                      type="time" required value={formData.endTime}
                      onChange={(e) => setFormData({...formData, endTime: e.target.value})}
                      className="control-input w-full px-4 py-3 rounded-2xl outline-none transition-all font-bold text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Starttijd (Deel 2)</label>
                    <input 
                      type="time" value={formData.startTime2}
                      onChange={(e) => setFormData({...formData, startTime2: e.target.value})}
                      className="control-input w-full px-4 py-3 rounded-2xl outline-none transition-all font-bold text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Eindtijd (Deel 2)</label>
                    <input 
                      type="time" value={formData.endTime2}
                      onChange={(e) => setFormData({...formData, endTime2: e.target.value})}
                      className="control-input w-full px-4 py-3 rounded-2xl outline-none transition-all font-bold text-sm"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Starttijd (Deel 3)</label>
                    <input 
                      type="time" value={formData.startTime3}
                      onChange={(e) => setFormData({...formData, startTime3: e.target.value})}
                      className="control-input w-full px-4 py-3 rounded-2xl outline-none transition-all font-bold text-sm"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Eindtijd (Deel 3)</label>
                    <input 
                      type="time" value={formData.endTime3}
                      onChange={(e) => setFormData({...formData, endTime3: e.target.value})}
                      className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-oker-500/10 focus:border-oker-400 outline-none transition-all font-bold text-sm"
                    />
                  </div>
                </div>
                <button type="submit" className="w-full bg-oker-500 text-white font-black py-4 rounded-2xl hover:bg-oker-600 transition-all shadow-xl shadow-oker-500/20 mt-4">
                  {editingId ? 'Dienst Bijwerken' : 'Dienst Toevoegen'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <ConfirmationModal
        isOpen={!!pendingImportedServices}
        onClose={() => {
          setPendingImportedServices(null);
          setPendingImportCount(0);
        }}
        onConfirm={handleConfirmImport}
        title="Diensten importeren"
        message={`Er zijn ${pendingImportCount} diensten gevonden. De huidige lijst wordt vervangen door deze import.`}
        confirmText="Importeren"
        variant="warning"
      />

      <ConfirmationModal
        isOpen={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={handleConfirmDelete}
        title="Dienst verwijderen"
        message="Weet je zeker dat je deze dienst wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt."
      />
    </div>
  );
}

function StatCard({ icon, label, value, subValue }: { icon: React.ReactNode, label: string, value: string, subValue: string }) {
  return (
    <div className="panel relative flex items-center gap-4 overflow-hidden rounded-[22px] p-5 transition-all duration-200 group hover:-translate-y-0.5 md:p-6">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-white/0 via-white/80 to-white/0" />
      <div className="p-3 bg-slate-50/90 rounded-2xl relative z-10 ring-1 ring-slate-100 shadow-sm shrink-0">
        {icon}
      </div>
      <div className="relative z-10 min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-widest">{label}</p>
        <p className="section-title text-2xl md:text-[1.75rem] font-black text-slate-900 mt-1 tracking-tight leading-none">{value}</p>
        <p className="text-xs text-slate-500 mt-1.5 font-medium">{subValue}</p>
      </div>
    </div>
  );
}

function SwapRequestsView({ user, swaps, shifts, users, onSave }: { user: User, swaps: SwapRequest[], shifts: Shift[], users: User[], onSave: (s: SwapRequest[]) => void }) {
  const [showOfferModal, setShowOfferModal] = useState(false);
  const [selectedShift, setSelectedShift] = useState<string>('');
  const [reason, setReason] = useState('');

  const isPlanner = user.role === 'planner' || user.role === 'admin';
  const myShifts = shifts.filter(s => s.driverId === user.id);
  const mySwaps = swaps.filter(s => s.requesterId === user.id);
  const availableSwaps = swaps.filter(s => {
    if (s.status !== 'pending' || s.requesterId === user.id) return false;
    
    const requester = users.find(u => u.id === s.requesterId);
    const isBeheerder = requester?.name.toLowerCase() === 'beheerder';
    const isMe = s.requesterId === user.id; // Already covered by s.requesterId !== user.id but for clarity

    if (isBeheerder && !isMe) return false;
    return true;
  });

  const handleOfferShift = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedShift) return;

    const newSwap: SwapRequest = {
      id: Date.now().toString(),
      shiftId: selectedShift,
      requesterId: user.id,
      status: 'pending',
      createdAt: new Date().toISOString(),
      reason
    };

    onSave([...swaps, newSwap]);
    setShowOfferModal(false);
    setSelectedShift('');
    setReason('');
  };

  const handleStatusUpdate = (swapId: string, newStatus: SwapRequest['status']) => {
    const updatedSwaps = swaps.map(s => s.id === swapId ? { ...s, status: newStatus } : s);
    onSave(updatedSwaps);
  };

  return (
    <div className="max-w-4xl space-y-8">
      <div className="flex items-center justify-between">
        <h3 className="text-2xl font-black tracking-tight">Wissel Aanvragen</h3>
        {!isPlanner && (
          <button 
            onClick={() => setShowOfferModal(true)}
            className="px-6 py-3 bg-oker-500 text-white rounded-2xl font-black text-sm hover:bg-oker-600 transition-all shadow-lg shadow-oker-500/20"
          >
            Dienst Aanbieden
          </button>
        )}
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <div className="space-y-4">
          <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Mijn Verzoeken</h4>
          {mySwaps.length > 0 ? (
            mySwaps.map(swap => {
              const shift = shifts.find(s => s.id === swap.shiftId);
              return (
                <div key={swap.id} className="surface-card p-6 rounded-[32px] flex items-center justify-between">
                  <div>
                    <p className="font-black text-slate-800">{shift?.date}</p>
                    <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{shift?.startTime} - {shift?.endTime}</p>
                  </div>
                  <span className={cn(
                    "px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest",
                    swap.status === 'pending' ? "bg-amber-50 text-amber-600" :
                    swap.status === 'approved' ? "bg-green-50 text-green-600" : "bg-red-50 text-red-600"
                  )}>
                    {swap.status}
                  </span>
                </div>
              );
            })
          ) : (
            <p className="text-slate-400 font-medium italic p-4">Geen actieve verzoeken.</p>
          )}
        </div>

        <div className="space-y-4">
          <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Openstaande Wissels</h4>
          {availableSwaps.length > 0 ? (
            availableSwaps.map(swap => {
              const shift = shifts.find(s => s.id === swap.shiftId);
              const requester = users.find(u => u.id === swap.requesterId);
              return (
                <div key={swap.id} className="surface-card p-6 rounded-[32px] space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-black text-slate-800">{shift?.date}</p>
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">{shift?.startTime} - {shift?.endTime}</p>
                      <p className="text-xs font-bold text-slate-400 uppercase tracking-widest">Door: {requester?.name}</p>
                    </div>
                    <button className="px-4 py-2 bg-oker-50 text-oker-600 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-oker-100 transition-all">
                      Overnemen
                    </button>
                  </div>
                  {swap.reason && <p className="text-xs text-slate-500 italic">"{swap.reason}"</p>}
                </div>
              );
            })
          ) : (
            <p className="text-slate-400 font-medium italic p-4">Geen openstaande wissels.</p>
          )}
        </div>
      </div>

      {isPlanner && (
        <div className="space-y-4 pt-8">
          <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Goedkeuring Planner</h4>
          <div className="surface-table rounded-[32px] overflow-hidden">
            <table className="w-full text-left">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Chauffeur</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Dienst</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Status</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Acties</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {swaps.filter(s => {
                  if (s.status !== 'pending') return false;
                  const requester = users.find(u => u.id === s.requesterId);
                  const isBeheerder = requester?.name.toLowerCase() === 'beheerder';
                  const isMe = s.requesterId === user.id;
                  if (isBeheerder && !isMe) return false;
                  return true;
                }).map(swap => {
                  const shift = shifts.find(s => s.id === swap.shiftId);
                  const requester = users.find(u => u.id === swap.requesterId);
                  return (
                    <tr key={swap.id}>
                      <td className="px-6 py-4 font-bold text-sm">{requester?.name}</td>
                      <td className="px-6 py-4 text-xs font-medium">{shift?.date} ({shift?.startTime} - {shift?.endTime})</td>
                      <td className="px-6 py-4">
                        <span className="px-2 py-1 bg-amber-50 text-amber-600 rounded-full text-[10px] font-black uppercase tracking-widest">Pending</span>
                      </td>
                      <td className="px-6 py-4 flex gap-2">
                        <button onClick={() => handleStatusUpdate(swap.id, 'approved')} className="p-2 text-green-600 hover:bg-green-50 rounded-lg transition-colors"><Plus size={18} /></button>
                        <button onClick={() => handleStatusUpdate(swap.id, 'rejected')} className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"><X size={18} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <AnimatePresence>
        {showOfferModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="glass-modal rounded-[40px] w-full max-w-md overflow-hidden">
              <div className="p-8 border-b border-white/70 flex items-center justify-between">
                <h4 className="text-xl font-black">Dienst Aanbieden</h4>
                <button onClick={() => setShowOfferModal(false)} className="p-2 text-slate-400 hover:bg-slate-50 rounded-xl"><X size={24} /></button>
              </div>
              <form onSubmit={handleOfferShift} className="p-8 space-y-6">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Selecteer Dienst</label>
                  <select 
                    value={selectedShift} 
                    onChange={(e) => setSelectedShift(e.target.value)}
                    className="control-input w-full px-4 py-3 rounded-2xl font-bold text-sm outline-none"
                    required
                  >
                    <option value="">Kies een dienst...</option>
                    {myShifts.map(s => (
                      <option key={s.id} value={s.id}>{s.date} ({s.startTime} - {s.endTime})</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Reden (optioneel)</label>
                  <textarea 
                    value={reason} 
                    onChange={(e) => setReason(e.target.value)}
                    className="control-input w-full px-4 py-3 rounded-2xl font-bold text-sm outline-none h-24 resize-none"
                    placeholder="Waarom wil je ruilen?"
                  />
                </div>
                <button type="submit" className="w-full bg-oker-500 text-white font-black py-4 rounded-2xl hover:bg-oker-600 transition-all shadow-xl shadow-oker-500/20">
                  Aanbieden
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function LeaveManagementView({ user, leaveRequests, users, onSave }: { user: User, leaveRequests: LeaveRequest[], users: User[], onSave: (l: LeaveRequest[]) => void }) {
  const [showRequestModal, setShowRequestModal] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [formData, setFormData] = useState({ startDate: '', endDate: '', type: 'vakantie' as LeaveRequest['type'], comment: '' });
  const [viewMonth, setViewMonth] = useState(new Date(2026, 2, 1)); // Maart 2026

  const isPlanner = user.role === 'planner' || user.role === 'admin';
  const myRequests = leaveRequests.filter(r => r.userId === user.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const handleRequestLeave = (e: React.FormEvent) => {
    e.preventDefault();
    const newRequest: LeaveRequest = {
      id: Date.now().toString(),
      userId: user.id,
      ...formData,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    onSave([...leaveRequests, newRequest]);
    setShowRequestModal(false);
    setFormData({ startDate: '', endDate: '', type: 'vakantie', comment: '' });
  };

  const handleStatusUpdate = (requestId: string, newStatus: LeaveRequest['status']) => {
    const updated = leaveRequests.map(r => r.id === requestId ? { ...r, status: newStatus } : r);
    onSave(updated);
  };

  const getRequestsForDate = (dateStr: string) => {
    return leaveRequests.filter(r => {
      const start = new Date(r.startDate);
      const end = new Date(r.endDate);
      const current = new Date(dateStr);
      const isApproved = r.status === 'approved';
      
      if (!isApproved) return false;
      if (current < start || current > end) return false;

      // Hide 'beheerder' requests from others
      const requester = users.find(u => u.id === r.userId);
      const isBeheerder = requester?.name.toLowerCase() === 'beheerder';
      const isMe = r.userId === user.id;

      if (isBeheerder && !isMe) return false;

      return true;
    });
  };

  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();
  const firstDayOfMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1).getDay();
  const monthName = viewMonth.toLocaleString('nl-BE', { month: 'long', year: 'numeric' });

  const calendarDays = [];
  // Add empty slots for days before the first day of the month
  const startOffset = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1; // Adjust for Monday start
  for (let i = 0; i < startOffset; i++) {
    calendarDays.push(null);
  }
  for (let i = 1; i <= daysInMonth; i++) {
    calendarDays.push(i);
  }

  return (
    <div className="max-w-6xl space-y-8 pb-20">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-2xl font-black tracking-tight">Verlof & Afwezigheid</h3>
          <p className="text-sm text-slate-500 font-medium">Beheer verlofaanvragen en bekijk de bezetting.</p>
        </div>
        {!isPlanner && (
          <button 
            onClick={() => setShowRequestModal(true)}
            className="px-8 py-4 bg-oker-500 text-white rounded-2xl font-black text-sm hover:bg-oker-600 transition-all shadow-xl shadow-oker-500/20 active:scale-95 flex items-center gap-2"
          >
            <Plus size={20} /> Verlof Aanvragen
          </button>
        )}
      </div>

      <div className="grid lg:grid-cols-12 gap-8">
        {/* Left Column: Calendar & Occupancy */}
        <div className="lg:col-span-8 space-y-6">
          <div className="surface-card p-8 rounded-[40px]">
            <div className="flex items-center justify-between mb-8">
              <h4 className="text-lg font-black tracking-tight capitalize">{monthName}</h4>
              <div className="flex gap-4">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-emerald-500 rounded-full" />
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Voldoende</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-amber-500 rounded-full" />
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Krap</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-red-500 rounded-full" />
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Onderbezet</span>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-7 gap-3">
              {['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo'].map(d => (
                <div key={d} className="text-center text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] mb-2">{d}</div>
              ))}
              {calendarDays.map((day, i) => {
                if (day === null) return <div key={`empty-${i}`} />;
                
                const dateStr = `${viewMonth.getFullYear()}-${(viewMonth.getMonth() + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
                const dayRequests = getRequestsForDate(dateStr);
                const occupancyCount = dayRequests.length;
                
                const statusColor = occupancyCount >= 3 ? 'bg-red-500' : occupancyCount >= 2 ? 'bg-amber-500' : occupancyCount >= 1 ? 'bg-emerald-500' : 'bg-slate-100';
                const isSelected = selectedDate === dateStr;

                return (
                  <button 
                    key={day}
                    onClick={() => setSelectedDate(isSelected ? null : dateStr)}
                    className={cn(
                      "aspect-square rounded-2xl border transition-all flex flex-col items-center justify-center relative group",
                      isSelected ? "border-oker-500 bg-oker-50 ring-4 ring-oker-500/10" : "border-slate-50 hover:border-slate-200 bg-white"
                    )}
                  >
                    <span className={cn(
                      "text-sm font-black transition-colors",
                      isSelected ? "text-oker-600" : "text-slate-400 group-hover:text-slate-600"
                    )}>{day}</span>
                    {occupancyCount > 0 && (
                      <div className={cn("w-1.5 h-1.5 rounded-full mt-1.5", statusColor)} />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {selectedDate && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="surface-card p-8 rounded-[40px]"
            >
              <div className="flex items-center justify-between mb-6">
                <h4 className="font-black text-slate-800">Afwezigheid op {new Date(selectedDate).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long' })}</h4>
                <button onClick={() => setSelectedDate(null)} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
              </div>
              <div className="space-y-3">
                {getRequestsForDate(selectedDate).length > 0 ? (
                  getRequestsForDate(selectedDate).map(req => {
                    const requester = users.find(u => u.id === req.userId);
                    return (
                      <div key={req.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center text-slate-400 border border-slate-100">
                            <UserIcon size={20} />
                          </div>
                          <div>
                            <p className="font-black text-slate-800 text-sm">{requester?.name}</p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{req.type}</p>
                          </div>
                        </div>
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{req.startDate} - {req.endDate}</span>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-center py-4 text-slate-400 font-medium italic">Geen afwezigen op deze dag.</p>
                )}
              </div>
            </motion.div>
          )}
        </div>

        {/* Right Column: My Requests or Planner Actions */}
        <div className="lg:col-span-4 space-y-8">
          {isPlanner && (
            <div className="space-y-4">
              <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">Wachtend op Goedkeuring</h4>
              <div className="space-y-4">
                {leaveRequests.filter(r => {
                  if (r.status !== 'pending') return false;
                  const requester = users.find(u => u.id === r.userId);
                  const isBeheerder = requester?.name.toLowerCase() === 'beheerder';
                  const isMe = r.userId === user.id;
                  if (isBeheerder && !isMe) return false;
                  return true;
                }).length > 0 ? (
                  leaveRequests.filter(r => {
                    if (r.status !== 'pending') return false;
                    const requester = users.find(u => u.id === r.userId);
                    const isBeheerder = requester?.name.toLowerCase() === 'beheerder';
                    const isMe = r.userId === user.id;
                    if (isBeheerder && !isMe) return false;
                    return true;
                  }).map(req => {
                    const requester = users.find(u => u.id === req.userId);
                    return (
                      <div key={req.id} className="surface-card p-6 rounded-[32px] space-y-4">
                        <div className="flex items-center gap-3">
                          <div className="w-12 h-12 bg-slate-50 rounded-2xl flex items-center justify-center text-oker-500">
                            <UserIcon size={24} />
                          </div>
                          <div>
                            <p className="font-black text-slate-800">{requester?.name}</p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{req.type} • {req.createdAt.split('T')[0]}</p>
                          </div>
                        </div>
                        <div className="bg-slate-50 p-4 rounded-2xl space-y-2">
                          <div className="flex justify-between text-[10px] font-black text-slate-400 uppercase tracking-widest">
                            <span>Periode</span>
                            <span className="text-slate-800">{req.startDate} t/m {req.endDate}</span>
                          </div>
                          {req.comment && (
                            <p className="text-xs text-slate-500 italic mt-2">"{req.comment}"</p>
                          )}
                        </div>
                        <div className="flex gap-2">
                          <button 
                            onClick={() => handleStatusUpdate(req.id, 'approved')}
                            className="flex-1 py-3 bg-emerald-500 text-white rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20"
                          >
                            Goedkeuren
                          </button>
                          <button 
                            onClick={() => handleStatusUpdate(req.id, 'rejected')}
                            className="flex-1 py-3 bg-white border border-slate-200 text-red-500 rounded-xl font-black text-[10px] uppercase tracking-widest hover:bg-red-50 transition-all"
                          >
                            Afwijzen
                          </button>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="surface-card p-8 rounded-[32px] text-center">
                    <p className="text-slate-400 font-bold text-sm">Geen openstaande aanvragen.</p>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="space-y-4">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-2">Mijn Verlof Historie</h4>
            <div className="space-y-4">
              {myRequests.length > 0 ? (
                myRequests.map(req => (
                  <div key={req.id} className="surface-card p-6 rounded-[32px] relative overflow-hidden">
                    <div className={cn(
                      "absolute top-0 left-0 w-1 h-full",
                      req.status === 'approved' ? "bg-emerald-500" : req.status === 'rejected' ? "bg-red-500" : "bg-amber-500"
                    )} />
                    <div className="flex justify-between items-start mb-4">
                      <span className="px-3 py-1 bg-slate-100 text-slate-600 rounded-full text-[8px] font-black uppercase tracking-widest">{req.type}</span>
                      <span className={cn(
                        "text-[10px] font-black uppercase tracking-widest",
                        req.status === 'approved' ? "text-emerald-500" : req.status === 'rejected' ? "text-red-500" : "text-amber-500"
                      )}>{req.status}</span>
                    </div>
                    <p className="font-black text-slate-800 text-sm mb-1">{new Date(req.startDate).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })} - {new Date(req.endDate).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Aangevraagd op {req.createdAt.split('T')[0]}</p>
                  </div>
                ))
              ) : (
                <div className="surface-card p-8 rounded-[32px] text-center">
                  <p className="text-slate-400 font-bold text-sm">Nog geen verlof aangevraagd.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {showRequestModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="glass-modal rounded-[40px] w-full max-w-md overflow-hidden"
            >
              <div className="p-8 border-b border-white/70 flex items-center justify-between">
                <h4 className="text-xl font-black">Verlof Aanvragen</h4>
                <button onClick={() => setShowRequestModal(false)} className="p-2 text-slate-400 hover:bg-slate-50 rounded-xl"><X size={24} /></button>
              </div>
              <form onSubmit={handleRequestLeave} className="p-8 space-y-5">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Startdatum</label>
                    <input 
                      type="date" required value={formData.startDate} 
                      onChange={(e) => setFormData({...formData, startDate: e.target.value})} 
                      className="w-full px-4 py-3 rounded-2xl border border-slate-200 font-bold text-sm outline-none focus:ring-4 focus:ring-oker-500/10 focus:border-oker-400 transition-all" 
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Einddatum</label>
                    <input 
                      type="date" required value={formData.endDate} 
                      onChange={(e) => setFormData({...formData, endDate: e.target.value})} 
                      className="w-full px-4 py-3 rounded-2xl border border-slate-200 font-bold text-sm outline-none focus:ring-4 focus:ring-oker-500/10 focus:border-oker-400 transition-all" 
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Type Verlof</label>
                  <select 
                    value={formData.type} 
                    onChange={(e) => setFormData({...formData, type: e.target.value as any})} 
                    className="control-input w-full px-4 py-3 rounded-2xl font-bold text-sm outline-none transition-all bg-white/60"
                  >
                    <option value="vakantie">Vakantie</option>
                    <option value="ziekte">Ziekte</option>
                    <option value="persoonlijk">Persoonlijk</option>
                    <option value="overig">Overig</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Opmerking</label>
                  <textarea 
                    value={formData.comment} 
                    onChange={(e) => setFormData({...formData, comment: e.target.value})} 
                    className="w-full px-4 py-3 rounded-2xl border border-slate-200 font-bold text-sm outline-none focus:ring-4 focus:ring-oker-500/10 focus:border-oker-400 transition-all h-24 resize-none" 
                    placeholder="Optionele toelichting..." 
                  />
                </div>
                <button type="submit" className="w-full bg-oker-500 text-white font-black py-4 rounded-2xl hover:bg-oker-600 transition-all shadow-xl shadow-oker-500/20 active:scale-[0.98]">
                  Aanvraag Indienen
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
