/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { Suspense, lazy, useState, useEffect } from 'react';
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
  Map,
  Pencil,
  Search,
  Phone,
  Activity
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import type { Session } from '@supabase/supabase-js';
import { View, User, Shift, Update, Diversion, Service, SwapRequest, LeaveRequest } from './types';
import { MOCK_DIVERSIONS, MOCK_SHIFTS, MOCK_UPDATES, MOCK_USERS, MOCK_SERVICES } from './constants';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { cn, getSupabaseAuthHeaders, notify } from './lib/ui';
import { ConfirmationModal, EmptyState, ViewLoader } from './components/ui';
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
      await Promise.all([
        fetchCurrentUser(accessToken),
        fetchPlanning(accessToken),
        fetchUsers(accessToken),
        fetchDiversions(accessToken),
        fetchServices(accessToken),
        fetchUpdates(accessToken),
        fetchSwaps(accessToken),
        fetchLeave(accessToken),
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
      if (response.ok) setUpdates(newUpdates);
      return response.ok;
    } catch (error) {
      console.error('Error saving updates:', error);
      showToast('Opslaan van updates is mislukt.', 'error');
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
    const user = await response.json();
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
  const viewMeta: Record<string, { title: string; subtitle: string }> = {
    dashboard: { title: 'Dashboard', subtitle: 'Overzicht van planning, updates en operationele status.' },
    omleidingen: { title: 'Omleidingen', subtitle: 'Actuele hinder en routewijzigingen voor chauffeurs.' },
    rooster: { title: 'Mijn Rooster', subtitle: 'Je komende diensten en export naar agenda.' },
    dienstoverzicht: { title: 'Dienstoverzicht', subtitle: 'Alle diensten, uren en blokken in een compact overzicht.' },
    contacten: { title: 'Contactlijst', subtitle: 'Bereik collega’s en planners sneller vanuit een centrale lijst.' },
    updates: { title: 'Updates', subtitle: 'Nieuws, veiligheidsmeldingen en technische mededelingen.' },
    'ruil-verzoeken': { title: 'Dienstwissels', subtitle: 'Beheer openstaande ruilverzoeken en aanbiedingen.' },
    verlof: { title: 'Verlof', subtitle: 'Vraag verlof aan en volg je aanvragen op.' },
    'verlof-beheer': { title: 'Verlofbeheer', subtitle: 'Bekijk aanvragen en beheer afwezigheden per dag.' },
    'beheer-roosters': { title: 'Beheer Roosters', subtitle: 'Importeer, synchroniseer en beheer planning centraal.' },
    'beheer-updates': { title: 'Nieuwe Update', subtitle: 'Publiceer updates en stuur dringende meldingen uit.' },
    gebruikers: { title: 'Gebruikers', subtitle: 'Beheer accounts, rollen en toegangsrechten.' },
    'beheer-omleidingen': { title: 'Beheer Omleidingen', subtitle: 'Voeg routewijzigingen en bijlagen toe voor chauffeurs.' },
    'beheer-dienstoverzicht': { title: 'Beheer Dienstoverzicht', subtitle: 'Onderhoud het dienstschema en importeer uit Excel.' },
    'beheer-contactlijst': { title: 'Beheer Contactlijst', subtitle: 'Werk medewerkers, rollen en gegevens bij.' },
    'beheer-debug': { title: 'Systeem Status', subtitle: 'Controleer koppelingen, tabellen en health checks.' },
  };
  const currentMeta = viewMeta[currentView] || { title: 'VHB Portaal', subtitle: 'Interne operationele omgeving.' };

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
        "fixed inset-y-0 left-0 w-80 panel-dark m-3 mr-0 rounded-[34px] flex flex-col z-50 transition-transform duration-300 transform lg:relative lg:translate-x-0 overflow-hidden",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="pointer-events-none absolute inset-x-5 top-0 h-24 rounded-b-[32px] bg-white/35 blur-2xl opacity-90" />
        <div className="pointer-events-none absolute -right-10 top-20 h-48 w-48 rounded-full bg-oker-200/20 blur-3xl" />
        <div className="p-8 flex flex-col items-start border-b border-white/8 relative">
          <button 
            onClick={() => setIsSidebarOpen(false)}
            className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 lg:hidden"
          >
            <X size={20} />
          </button>
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-14 items-center justify-center rounded-[20px] bg-white/75 text-oker-600 ring-1 ring-white/80 shadow-sm">
              <Bus size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-black tracking-tight text-slate-900">VHB <span className="text-oker-500">PORTAAL</span></h1>
              <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.24em] mt-1">Van Hoorebeke en Zoon</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-2 overflow-y-auto">
          <NavItem 
            icon={<LayoutDashboard size={20} />} 
            label="Dashboard" 
            active={currentView === 'dashboard'} 
            onClick={() => { setCurrentView('dashboard'); setIsSidebarOpen(false); }} 
          />
          <NavItem 
            icon={<MapPin size={20} />} 
            label="Omleidingen" 
            active={currentView === 'omleidingen'} 
            onClick={() => { setCurrentView('omleidingen'); setIsSidebarOpen(false); }} 
          />
          <NavItem 
            icon={<Calendar size={20} />} 
            label="Mijn Rooster" 
            active={currentView === 'rooster'} 
            onClick={() => { setCurrentView('rooster'); setIsSidebarOpen(false); }} 
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
            label="Dienstwissels" 
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
              <div className="pt-6 pb-2 px-4 text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Beheer</div>
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
                icon={<Plus size={20} />} 
                label="Nieuwe Update" 
                active={currentView === 'beheer-updates'} 
                onClick={() => { setCurrentView('beheer-updates'); setIsSidebarOpen(false); }} 
              />
              <NavItem 
                icon={<Map size={20} />} 
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
              <NavItem 
                icon={<Phone size={20} />} 
                label="Beheer Contactlijst" 
                active={currentView === 'beheer-contactlijst'} 
                onClick={() => { setCurrentView('beheer-contactlijst'); setIsSidebarOpen(false); }} 
              />
            </>
          )}

          {isAdmin && (
            <>
              <div className="pt-6 pb-2 px-4 text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Admin</div>
              <NavItem 
                icon={<Users size={20} />} 
                label="Gebruikers" 
                active={currentView === 'gebruikers'} 
                onClick={() => { setCurrentView('gebruikers'); setIsSidebarOpen(false); }} 
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

        <div className="p-6 border-t border-white/8">
          <button 
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-4 py-3 text-slate-500 hover:text-red-500 hover:bg-white/65 rounded-2xl transition-all duration-300 font-bold text-sm"
          >
            <LogOut size={20} />
            <span>Uitloggen</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {/* Header */}
        <header className="mx-3 mt-3 rounded-[30px] panel h-20 md:h-24 flex items-center justify-between px-4 md:px-8 shrink-0 z-30 overflow-hidden relative">
          <div className="pointer-events-none absolute inset-x-10 top-0 h-12 rounded-b-[28px] bg-white/40 blur-2xl" />
          <div className="pointer-events-none absolute right-8 top-2 h-16 w-28 rounded-full bg-oker-200/20 blur-2xl" />
          <div className="flex items-center gap-3">
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="p-2 text-slate-500 hover:bg-slate-100 rounded-xl lg:hidden transition-colors"
            >
              <Menu size={24} />
            </button>
            <div className="flex flex-col">
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-[0.24em]">Operations</p>
              <h2 className="text-xl md:text-2xl font-black tracking-tight">
                {currentMeta.title}
              </h2>
              <p className="hidden md:block text-sm font-medium text-slate-500">{currentMeta.subtitle}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 md:gap-4">
            <div className="hidden xl:flex items-center gap-3 rounded-[22px] bg-white/52 px-4 py-3 ring-1 ring-white/80 shadow-[inset_0_1px_0_rgba(255,255,255,0.9),0_10px_24px_rgba(15,23,42,0.06)] backdrop-blur-xl">
              <div className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
              <div>
                <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">Systeem</p>
                <p className="text-sm font-black text-slate-700">Online en gesynchroniseerd</p>
              </div>
            </div>
            <div className="text-right hidden sm:block">
              <p className="text-sm font-black text-slate-800">{currentUser.name}</p>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-[0.16em]">{currentUser.role} • {currentUser.employeeId}</p>
            </div>
            <div className="w-11 h-11 md:w-12 md:h-12 bg-white/58 rounded-2xl flex items-center justify-center text-oker-700 shadow-[inset_0_1px_0_rgba(255,255,255,0.95),0_10px_22px_rgba(245,158,11,0.12)] border border-white/85 backdrop-blur-xl">
              <UserIcon size={20} />
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto px-4 pb-24 pt-5 md:px-8 lg:pb-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentView}
              initial={{ opacity: 0, y: 18, scale: 0.985, filter: 'blur(8px)' }}
              animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0, y: -12, scale: 0.99, filter: 'blur(6px)' }}
              transition={{ duration: 0.34, ease: [0.22, 1, 0.36, 1] }}
              className="mx-auto max-w-[1440px]"
            >
              {currentView === 'dashboard' && <DashboardView user={currentUser!} shifts={shifts} diversions={diversions} users={users} />}
              {currentView === 'omleidingen' && <DiversionsView diversions={diversions} />}
              {currentView === 'rooster' && <ScheduleView user={currentUser!} shifts={shifts} users={users} />}
              {currentView === 'dienstoverzicht' && <ServicesView services={services} />}
              {currentView === 'updates' && <UpdatesView updates={updates} />}
              {currentView === 'contacten' && <ContactsView users={users} currentUser={currentUser!} />}
              {currentView === 'beheer-roosters' && <ManageSchedulesView shifts={shifts} onSave={savePlanning} users={users} />}
              {currentView === 'beheer-updates' && (
                <Suspense fallback={<ViewLoader />}>
                  <LazyManageUpdatesView updates={updates} onSave={saveUpdates} onSendUrgentEmail={sendUrgentEmail} />
                </Suspense>
              )}
              {currentView === 'gebruikers' && (
                <Suspense fallback={<ViewLoader />}>
                  <LazyManageUsersView users={users} onSave={saveUsers} currentUser={currentUser!} />
                </Suspense>
              )}
              {currentView === 'beheer-omleidingen' && <ManageDiversionsView diversions={diversions} onSave={saveDiversions} />}
              {currentView === 'beheer-dienstoverzicht' && <ManageServicesView services={services} onSave={saveServices} />}
              {currentView === 'beheer-contactlijst' && (
                <Suspense fallback={<ViewLoader />}>
                  <LazyManageUsersView users={users} onSave={saveUsers} title="Beheer Contactlijst" currentUser={currentUser!} />
                </Suspense>
              )}
              {currentView === 'ruil-verzoeken' && <SwapRequestsView user={currentUser} swaps={swaps} shifts={shifts} users={users} onSave={saveSwaps} />}
              {(currentView === 'verlof' || currentView === 'verlof-beheer') && (
                <Suspense fallback={<ViewLoader />}>
                  <LazyLeaveManagementView user={currentUser} leaveRequests={leaveRequests} users={users} onSave={saveLeave} />
                </Suspense>
              )}
              {currentView === 'beheer-debug' && (
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
            className="p-3 text-slate-400 hover:text-oker-500 transition-colors"
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
        "p-3 rounded-2xl transition-all duration-300 relative",
        active ? "text-oker-600 bg-oker-50 shadow-inner" : "text-slate-400 hover:text-slate-600"
      )}
    >
      {active && (
        <motion.div 
          layoutId="activeTab"
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
        "flex items-center gap-3 w-full px-4 py-3.5 rounded-2xl transition-all duration-300 group relative overflow-hidden text-left",
        active 
          ? "bg-white text-slate-900 shadow-lg shadow-black/10 font-bold" 
          : "text-slate-500 hover:text-slate-900 hover:bg-white/55 font-medium"
      )}
    >
      <span className={cn(
        "relative z-10 transition-transform duration-300 group-hover:scale-110",
        active ? "text-oker-600" : "text-slate-400 group-hover:text-oker-600"
      )}>
        {icon}
      </span>
      <span className="relative z-10">{label}</span>
      {active && <div className="ml-auto h-2.5 w-2.5 rounded-full bg-oker-500" />}
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
    <div className="min-h-screen bg-oker-50 flex items-center justify-center p-6 relative overflow-hidden">
      {/* Decorative background elements */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-oker-200/20 rounded-full blur-3xl animate-pulse" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-oker-300/20 rounded-full blur-3xl animate-pulse delay-1000" />

      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-md glass rounded-[40px] shadow-2xl overflow-hidden relative z-10"
      >
        <div className="p-10 text-center flex flex-col items-center">
          <h1 className="text-4xl font-black tracking-tighter text-slate-900 mb-2">VHB <span className="text-oker-500">PORTAAL</span></h1>
          <p className="w-full text-center text-slate-500 font-bold uppercase text-xs tracking-[0.2em]">Van Hoorebeke en Zoon</p>
        </div>
        
        <form onSubmit={handleSubmit} className="p-10 pt-0 space-y-6">
          <div className="space-y-2">
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest ml-1">E-mailadres</label>
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setError('');
              }}
              className="w-full px-6 py-4 rounded-2xl border border-slate-100 focus:outline-none focus:ring-4 focus:ring-oker-500/10 focus:border-oker-400 transition-all bg-white/80 backdrop-blur-sm shadow-inner font-bold text-slate-700"
              required
              placeholder="naam@bedrijf.be"
            />
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Wachtwoord</label>
            <input 
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError('');
              }}
              placeholder="••••••"
              className="w-full px-6 py-4 rounded-2xl border border-slate-100 focus:outline-none focus:ring-4 focus:ring-oker-500/10 focus:border-oker-400 transition-all bg-white/80 backdrop-blur-sm shadow-inner font-bold text-slate-700"
              required
            />
          </div>

          {error && (
            <motion.p 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-red-500 text-xs font-bold text-center"
            >
              {error}
            </motion.p>
          )}

          <button 
            type="submit"
            disabled={isSubmitting}
            className={cn(
              "w-full font-black py-5 rounded-2xl transition-all shadow-xl relative group overflow-hidden",
              isSubmitting
                ? "bg-slate-300 text-white cursor-not-allowed shadow-none"
                : "bg-oker-500 text-white hover:bg-oker-600 shadow-oker-500/30"
            )}
          >
            <div className="absolute inset-0 glass-oker opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none rounded-2xl" />
            <span className="relative z-10">{isSubmitting ? 'BEZIG...' : 'INLOGGEN'}</span>
          </button>
        </form>
      </motion.div>
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
                    ) : (
                      <span className="text-slate-300 text-xs">-</span>
                    )}
                  </td>
                  <td className="px-8 py-5">
                    {s.startTime3 ? (
                      <div className="flex items-center gap-2 text-slate-600 font-bold text-sm">
                        <Clock size={14} className="text-oker-500" />
                        {s.startTime3} - {s.endTime3}
                      </div>
                    ) : (
                      <span className="text-slate-300 text-xs">-</span>
                    )}
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
  const totalDrivers = users.filter((candidate) => candidate.role === 'chauffeur' && candidate.isActive).length;
  
  const nextShift = myShifts
    .map(s => {
      const [year, month, day] = s.date.split('-').map(Number);
      const [hours, minutes] = s.startTime.split(':').map(Number);
      return { ...s, startDateTime: new Date(year, month - 1, day, hours, minutes) };
    })
    .filter(s => s.startDateTime > now)
    .sort((a, b) => a.startDateTime.getTime() - b.startDateTime.getTime())[0];

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
      {/* Prominent Next Shift Card */}
      {nextShift && user.role === 'chauffeur' && (
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="panel-dark relative overflow-hidden rounded-[40px] p-8 md:p-12 text-white"
        >
          {/* Decorative background elements */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-oker-500/10 rounded-full -mr-32 -mt-32 blur-3xl" />
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-oker-500/5 rounded-full -ml-32 -mb-32 blur-3xl" />
          
          <div className="relative flex flex-col md:flex-row items-center justify-between gap-8">
            <div className="space-y-4 text-center md:text-left">
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 backdrop-blur-md rounded-full border border-white/10">
                <div className="w-2 h-2 bg-oker-500 rounded-full animate-pulse" />
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-oker-500">Volgende Dienst</span>
              </div>
              <h3 className="text-4xl md:text-6xl font-black tracking-tighter">
                Over <span className="text-oker-500">{getCountdown(nextShift.startDateTime)}</span>
              </h3>
              <p className="text-slate-400 font-medium text-lg">
                Je begint op {nextShift.startDateTime.toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' })} om {nextShift.startTime}u.
              </p>
            </div>

            <div className="flex gap-4">
              <div className="bg-white/5 backdrop-blur-xl p-6 rounded-[32px] border border-white/10 text-center min-w-[120px]">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Lijn</p>
                <p className="text-3xl font-black text-oker-500">{nextShift.line}</p>
              </div>
              <div className="bg-white/5 backdrop-blur-xl p-6 rounded-[32px] border border-white/10 text-center min-w-[120px]">
                <p className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Bus</p>
                <p className="text-3xl font-black text-white font-mono">{nextShift.busNumber}</p>
              </div>
            </div>
          </div>
        </motion.div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <StatCard 
          icon={<Clock className="text-oker-600" />} 
          label="Vandaag" 
          value={todaysShift?.startTime || '--:--'} 
          subValue={todaysShift?.line ? `Lijn ${todaysShift.line}` : 'Geen dienst vandaag'} 
        />
        <StatCard 
          icon={<AlertTriangle className="text-red-500" />} 
          label="Actieve Omleidingen" 
          value={diversions.length.toString()} 
          subValue="Totaal aantal" 
        />
        <StatCard 
          icon={<Users className="text-oker-500" />} 
          label="Beschikbare Chauffeurs" 
          value={totalDrivers.toString()} 
          subValue="Actieve medewerkers in het systeem" 
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-8">
        <section className="panel p-8 rounded-[32px]">
          <div className="flex items-center justify-between mb-8">
            <h3 className="font-black text-xl tracking-tight">Planning voor vandaag</h3>
            <span className="text-[10px] font-black bg-oker-50 text-oker-700 px-4 py-1.5 rounded-full uppercase tracking-widest">
              {now.toLocaleDateString('nl-BE', { day: '2-digit', month: 'short' })}
            </span>
          </div>
          <div className="space-y-4">
            {shifts.filter(s => {
              const isMe = s.driverId === user.id;
              const isPlanner = user.role !== 'chauffeur';
              
              if (isMe) return true;
              if (!isPlanner) return false;

              // If planner, check if driver is beheerder
              const driver = users.find(u => u.id === s.driverId);
              const isBeheerder = driver?.name.toLowerCase() === 'beheerder';
              
              if (isBeheerder) return false;
              
              return true;
            }).slice(0, 2).map(shift => (
              <div key={shift.id} className="flex items-center gap-5 p-5 bg-slate-50/50 rounded-2xl border border-slate-100 group hover:bg-white hover:shadow-md transition-all duration-300">
                <div className="w-14 h-14 bg-white rounded-2xl flex items-center justify-center font-black text-xl text-oker-600 shadow-sm border border-slate-50 group-hover:scale-110 transition-transform">
                  {shift.line}
                </div>
                <div className="flex-1">
                  <p className="font-black text-lg text-slate-800">{shift.startTime} - {shift.endTime}</p>
                  <p className="text-sm text-slate-400 font-medium">Loopnr: {shift.loopnr}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Bus</p>
                  <p className="text-sm font-bold text-slate-500 font-mono">{shift.busNumber}</p>
                </div>
              </div>
            ))}
            {shifts.filter(s => s.driverId === user.id).length === 0 && user.role === 'chauffeur' && (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Calendar className="text-slate-200" size={32} />
                </div>
                <p className="text-slate-400 font-medium italic">Geen diensten gepland voor vandaag.</p>
              </div>
            )}
          </div>
        </section>

        <section className="panel p-8 rounded-[32px]">
          <h3 className="font-black text-xl tracking-tight mb-8">Belangrijkste Omleidingen</h3>
          <div className="space-y-4">
            {diversions.slice(0, 3).map(div => (
              <div key={div.id} className="flex gap-5 p-5 border-l-4 border-oker-400 bg-oker-50/20 rounded-r-2xl group hover:bg-oker-50/40 transition-all">
                <div className="shrink-0 mt-1">
                  <AlertTriangle size={24} className="text-oker-600" />
                </div>
                <div>
                  <p className="font-black text-lg text-slate-900">{div.title}</p>
                  <p className="text-sm text-slate-500 mt-1 line-clamp-2 font-medium leading-relaxed">{div.description}</p>
                  <div className="flex items-center gap-2 mt-3">
                    <span className="px-2 py-0.5 bg-oker-100 text-oker-700 rounded text-[10px] font-black uppercase">{div.line}</span>
                  </div>
                </div>
              </div>
            ))}
            {diversions.length === 0 && (
              <EmptyState
                icon={<MapPin size={28} />}
                title="Geen actieve hinder"
                message="Er zijn momenteel geen omleidingen geregistreerd."
              />
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
        `SUMMARY:VHB Dienst - Lijn ${shift.line}`,
        `DESCRIPTION:Bus: ${shift.busNumber}\\nLoopnr: ${shift.loopnr}`,
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
      <div className="flex items-center justify-between">
        <h3 className="text-2xl font-black tracking-tight">Mijn Werkrooster</h3>
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
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Tijd</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Dienst</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Loopnr</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Bus</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {shifts.map(shift => (
                <tr key={shift.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-8 py-6 font-black text-slate-800">{shift.date}</td>
                  <td className="px-8 py-6">
                    <div className="flex items-center gap-3 text-slate-600 font-bold">
                      <Clock size={16} className="text-oker-400" />
                      {shift.startTime} - {shift.endTime}
                    </div>
                  </td>
                  <td className="px-8 py-6">
                    <span className="px-4 py-1.5 bg-oker-50 text-oker-700 rounded-xl font-black text-xs uppercase tracking-wider">
                      Lijn {shift.line}
                    </span>
                  </td>
                  <td className="px-8 py-6">
                    <span className="px-4 py-1.5 bg-slate-100 text-slate-600 rounded-xl font-black text-xs uppercase tracking-wider">
                      #{shift.loopnr}
                    </span>
                  </td>
                  <td className="px-8 py-6 font-mono text-xs font-bold text-slate-400">{shift.busNumber}</td>
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
            <div className="flex justify-between items-start">
              <div>
                <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest mb-1">Datum</p>
                <p className="font-black text-slate-800">{shift.date}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest mb-1">Bus</p>
                <p className="font-mono text-xs font-bold text-slate-400">{shift.busNumber}</p>
              </div>
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

            <div className="grid grid-cols-2 gap-3">
              <div className="p-4 bg-oker-50 rounded-2xl border border-oker-100">
                <p className="text-[10px] font-black text-oker-400 uppercase tracking-widest mb-1">Lijn</p>
                <p className="font-black text-oker-700">{shift.line}</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Loopnr</p>
                <p className="font-black text-slate-700">#{shift.loopnr}</p>
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

  const filteredUpdates = updates.filter(u => filter === 'all' || u.category === filter);

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
          filteredUpdates.map(update => (
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
              <p className="text-slate-600 leading-relaxed font-medium text-sm md:text-base">{update.content}</p>
              
              <div className="mt-6 pt-6 border-t border-slate-50 flex justify-end">
                <button className="text-[10px] font-black text-oker-500 uppercase tracking-widest hover:text-oker-600 transition-colors flex items-center gap-2">
                  Lees meer <ChevronRight size={14} />
                </button>
              </div>
            </div>
          ))
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

function ManageSchedulesView({ shifts, onSave, users }: { shifts: Shift[], onSave: (s: Shift[]) => void, users: User[] }) {
  const [jsonInput, setJsonInput] = useState('');
  const [showExcelInfo, setShowExcelInfo] = useState(false);
  const [confirmSyncOpen, setConfirmSyncOpen] = useState(false);

  const handleImport = () => {
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
    <div className="max-w-4xl space-y-6 md:space-y-8">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <h3 className="text-2xl font-black tracking-tight">Beheer Roosters</h3>
        <button 
          onClick={() => setConfirmSyncOpen(true)}
          disabled={isSyncing}
          className="w-full sm:w-auto bg-emerald-500 text-white px-6 py-3 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 active:scale-95"
          title="Synchroniseer lokale JSON data naar Supabase"
        >
          <RotateCcw size={18} className={isSyncing ? "animate-spin" : ""} />
          {isSyncing ? 'SYNCHRONISEREN...' : 'SYNC NAAR DB'}
        </button>
      </div>
      <div className="surface-card p-6 md:p-8 rounded-[32px]">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-lg font-black flex items-center gap-3 tracking-tight">
            <FileText size={24} className="text-oker-500" />
            Excel / JSON Import
          </h3>
          <button 
            onClick={() => setShowExcelInfo(!showExcelInfo)}
            className="text-[10px] font-black text-oker-600 hover:underline uppercase tracking-widest"
          >
            Info
          </button>
        </div>

        {showExcelInfo && (
          <div className="mb-6 p-6 glass-oker rounded-2xl text-sm space-y-3">
            <p className="font-bold text-oker-800">Koppeling met Excel:</p>
            <ol className="list-decimal list-inside space-y-2 text-oker-700">
              <li>Gebruik een Excel-script of Power Automate om je Excel-data om te zetten naar JSON.</li>
              <li>Plak de JSON hieronder om de planning direct bij te werken.</li>
              <li>Voor automatische synchronisatie kan je Excel-bestand direct naar de API pushen op: <code className="bg-white/80 px-2 py-0.5 rounded border border-white/80 break-all">{window.location.origin}/api/planning</code></li>
            </ol>
          </div>
        )}

        <textarea 
          className="control-input w-full px-4 py-3 rounded-xl focus:outline-none transition-all min-h-[150px] font-mono text-sm mb-4"
          placeholder='Plak hier de JSON data uit Excel... e.g. [{"id": "1", "line": "12", ...}]'
          value={jsonInput}
          onChange={(e) => setJsonInput(e.target.value)}
        />
        
        <button 
          onClick={handleImport}
          className="bg-oker-500 text-white font-bold px-8 py-3 rounded-xl hover:bg-oker-600 transition-colors shadow-lg shadow-oker-500/20"
        >
          Importeer Planning
        </button>
      </div>

      <div className="surface-card p-6 md:p-8 rounded-[32px]">
        <h3 className="text-lg font-black mb-8 flex items-center gap-3 tracking-tight">
          <Plus size={24} className="text-emerald-500" />
          Handmatig Toevoegen
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 md:gap-6">
          <Input label="Datum" type="date" />
          <Input label="Chauffeur" type="select" options={[...users].filter(u => u.role === 'chauffeur' && u.isActive !== false).sort((a, b) => a.name.localeCompare(b.name)).map(u => ({ label: u.name, value: u.id }))} />
          <Input label="Start Tijd" type="time" />
          <Input label="Eind Tijd" type="time" />
          <Input label="Dienst" type="text" placeholder="Bijv. 12" />
          <Input label="Loopnr" type="text" placeholder="Bijv. L-101" />
          <Input label="Bus Nummer" type="text" placeholder="Bijv. 8421" />
        </div>
        <button className="w-full mt-8 bg-emerald-500 text-white font-black px-8 py-4 rounded-2xl hover:bg-emerald-600 transition-all shadow-xl shadow-emerald-500/20 active:scale-95 uppercase tracking-widest text-xs">
          Dienst Opslaan
        </button>
      </div>

      <div className="surface-card p-8 rounded-3xl">
        <h3 className="text-xl font-bold mb-6">Huidige Planning</h3>
        <ScheduleView user={{ id: '0', name: 'Admin', role: 'admin', employeeId: 'ADMIN' }} shifts={shifts} users={users} />
      </div>

      <ConfirmationModal
        isOpen={confirmSyncOpen}
        onClose={() => setConfirmSyncOpen(false)}
        onConfirm={handleSync}
        title="Planning synchroniseren"
        message="Deze actie schrijft de lokale planning weg naar de database en kan bestaande records met dezelfde ID overschrijven."
        confirmText="Synchroniseren"
        variant="warning"
      />
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

function ManageDiversionsView({ diversions, onSave }: { diversions: Diversion[], onSave: (d: Diversion[]) => void }) {
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [confirmSyncOpen, setConfirmSyncOpen] = useState(false);

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
        <button 
          onClick={() => setConfirmSyncOpen(true)}
          disabled={isSyncing}
          className="w-full sm:w-auto bg-emerald-500 text-white px-6 py-3 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center justify-center gap-3 hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20 disabled:opacity-50 active:scale-95"
          title="Synchroniseer lokale JSON data naar Supabase"
        >
          <RotateCcw size={18} className={isSyncing ? "animate-spin" : ""} />
          {isSyncing ? 'SYNCHRONISEREN...' : 'SYNC NAAR DB'}
        </button>
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

      <ConfirmationModal
        isOpen={confirmSyncOpen}
        onClose={() => setConfirmSyncOpen(false)}
        onConfirm={handleSync}
        title="Omleidingen synchroniseren"
        message="Deze actie schrijft de lokale omleidingen weg naar de database en kan bestaande records met dezelfde ID overschrijven."
        confirmText="Synchroniseren"
        variant="warning"
      />
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

function ManageServicesView({ services, onSave }: { services: Service[], onSave: (s: Service[]) => void }) {
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
    setConfirmDeleteId(id);
  };

  const handleConfirmDelete = () => {
    if (!confirmDeleteId) return;
    onSave(services.filter(s => s.id !== confirmDeleteId));
    setConfirmDeleteId(null);
  };

  const handleConfirmImport = () => {
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
                      <button onClick={() => handleDelete(s.id)} className="p-2 text-slate-400 hover:text-red-500 transition-colors"><Trash2 size={18} /></button>
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
                  <button onClick={() => handleDelete(s.id)} className="p-2 text-slate-400 hover:text-red-500 transition-colors"><Trash2 size={18} /></button>
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
    <div className="panel p-6 md:p-7 rounded-[30px] flex items-center gap-4 md:gap-5 group transition-all duration-500 relative overflow-hidden hover:-translate-y-0.5">
      <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-oker-300 via-oker-500 to-amber-200 opacity-70" />
      <div className="p-3 md:p-4 bg-oker-50 rounded-2xl relative z-10 group-hover:scale-105 transition-transform ring-1 ring-oker-100">
        {icon}
      </div>
      <div className="relative z-10">
        <p className="text-[10px] md:text-xs font-black text-slate-400 uppercase tracking-[0.22em]">{label}</p>
        <p className="text-2xl md:text-3xl font-black text-slate-900 mt-1 tracking-tight">{value}</p>
        <p className="text-[11px] md:text-xs text-slate-500 mt-1.5 font-medium">{subValue}</p>
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
        <h3 className="text-2xl font-black tracking-tight">Dienstwissels</h3>
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
                    <p className="font-black text-slate-800">{shift?.line} - {shift?.date}</p>
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
                      <p className="font-black text-slate-800">{shift?.line} - {shift?.date}</p>
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
                      <td className="px-6 py-4 text-xs font-medium">{shift?.line} ({shift?.date})</td>
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
                      <option key={s.id} value={s.id}>{s.date} - {s.line} ({s.startTime})</option>
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
