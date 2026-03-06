/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
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
  Pencil
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import * as XLSX from 'xlsx';
import { View, User, Shift, Update, Diversion } from './types';
import { MOCK_DIVERSIONS, MOCK_SHIFTS, MOCK_UPDATES, MOCK_USERS } from './constants';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function ConfirmationModal({ 
  isOpen, 
  onClose, 
  onConfirm, 
  title, 
  message, 
  confirmText = "Verwijderen", 
  cancelText = "Annuleren",
  variant = "danger"
}: { 
  isOpen: boolean, 
  onClose: () => void, 
  onConfirm: () => void, 
  title: string, 
  message: string,
  confirmText?: string,
  cancelText?: string,
  variant?: "danger" | "warning"
}) {
  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="bg-white rounded-[40px] shadow-2xl w-full max-w-md overflow-hidden"
          >
            <div className="p-8 border-b border-slate-100">
              <div className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center mb-4",
                variant === 'danger' ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-600"
              )}>
                <AlertTriangle size={24} />
              </div>
              <h4 className="text-xl font-black">{title}</h4>
              <p className="text-sm text-slate-500 font-medium mt-2">{message}</p>
            </div>
            <div className="p-8 bg-slate-50 flex gap-3">
              <button 
                onClick={onClose}
                className="flex-1 px-4 py-4 rounded-2xl font-black text-slate-400 hover:bg-white transition-all uppercase tracking-widest text-xs border border-transparent hover:border-slate-200"
              >
                {cancelText}
              </button>
              <button 
                onClick={() => {
                  onConfirm();
                  onClose();
                }}
                className={cn(
                  "flex-1 px-4 py-4 rounded-2xl font-black text-white transition-all shadow-xl uppercase tracking-widest text-xs",
                  variant === 'danger' ? "bg-red-500 hover:bg-red-600 shadow-red-500/20" : "bg-amber-500 hover:bg-amber-600 shadow-amber-500/20"
                )}
              >
                {confirmText}
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [shifts, setShifts] = useState<Shift[]>(MOCK_SHIFTS);
  const [users, setUsers] = useState<User[]>(MOCK_USERS);
  const [diversions, setDiversions] = useState<Diversion[]>(MOCK_DIVERSIONS);
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    fetchPlanning();
    fetchUsers();
    fetchDiversions();
  }, []);

  const fetchUsers = async () => {
    try {
      const response = await fetch('/api/users');
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setUsers(data);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
    }
  };

  const saveUsers = async (newUsers: User[]) => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUsers),
      });
      if (response.ok) {
        setUsers(newUsers);
      }
    } catch (error) {
      console.error('Error saving users:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchPlanning = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/planning');
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
      const response = await fetch('/api/planning', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newShifts),
      });
      if (response.ok) {
        setShifts(newShifts);
      }
    } catch (error) {
      console.error('Error saving planning:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchDiversions = async () => {
    try {
      setIsLoading(true);
      const response = await fetch('/api/diversions');
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
      const response = await fetch('/api/diversions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newDiversions),
      });
      if (response.ok) {
        setDiversions(newDiversions);
      }
    } catch (error) {
      console.error('Error saving diversions:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogin = (user: User) => {
    const now = new Date().toLocaleString('nl-BE');
    const updatedUsers = users.map(u => 
      u.id === user.id 
        ? { ...u, lastLogin: now, activeSessions: (u.activeSessions || 0) + 1 } 
        : u
    );
    saveUsers(updatedUsers);
    
    const updatedUser = updatedUsers.find(u => u.id === user.id) || user;
    setCurrentUser(updatedUser);
    setIsLoggedIn(true);
    setCurrentView('dashboard');
  };

  const handleLogout = () => {
    if (currentUser) {
      const updatedUsers = users.map(u => 
        u.id === currentUser.id 
          ? { ...u, activeSessions: Math.max(0, (u.activeSessions || 1) - 1) } 
          : u
      );
      saveUsers(updatedUsers);
    }
    setIsLoggedIn(false);
    setCurrentUser(null);
  };

  if (!isLoggedIn || !currentUser) {
    return <LoginView onLogin={handleLogin} users={users} />;
  }

  const isPlanner = currentUser.role === 'planner' || currentUser.role === 'admin';
  const isAdmin = currentUser.role === 'admin';

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans overflow-hidden">
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
        "fixed inset-y-0 left-0 w-72 bg-white border-r border-slate-200 flex flex-col shadow-sm z-50 transition-transform duration-300 transform lg:relative lg:translate-x-0",
        isSidebarOpen ? "translate-x-0" : "-translate-x-full"
      )}>
        <div className="p-8 flex flex-col items-center border-b border-slate-100 relative">
          <button 
            onClick={() => setIsSidebarOpen(false)}
            className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 lg:hidden"
          >
            <X size={20} />
          </button>
          <div className="text-center">
            <h1 className="font-black text-2xl tracking-tighter text-slate-900">VHB <span className="text-oker-500">PORTAAL</span></h1>
            <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Van Hoorebeke en Zoon</p>
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
            icon={<Bell size={20} />} 
            label="Updates" 
            active={currentView === 'updates'} 
            onClick={() => { setCurrentView('updates'); setIsSidebarOpen(false); }} 
          />

          {isPlanner && (
            <>
              <div className="pt-6 pb-2 px-4 text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">Planning</div>
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
            </>
          )}

          {isAdmin && (
            <>
              <div className="pt-6 pb-2 px-4 text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">Admin</div>
              <NavItem 
                icon={<Users size={20} />} 
                label="Gebruikers" 
                active={currentView === 'gebruikers'} 
                onClick={() => { setCurrentView('gebruikers'); setIsSidebarOpen(false); }} 
              />
            </>
          )}
        </nav>

        <div className="p-6 border-t border-slate-100">
          <button 
            onClick={handleLogout}
            className="flex items-center gap-3 w-full px-4 py-3 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-2xl transition-all duration-300 font-bold text-sm"
          >
            <LogOut size={20} />
            <span>Uitloggen</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-4 md:px-8 shrink-0">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setIsSidebarOpen(true)}
              className="p-2 text-slate-500 hover:bg-slate-50 rounded-lg lg:hidden"
            >
              <Menu size={20} />
            </button>
            <h2 className="text-lg font-semibold capitalize truncate">{currentView.replace('-', ' ')}</h2>
          </div>
          <div className="flex items-center gap-2 md:gap-4">
            <div className="text-right hidden sm:block">
              <p className="text-sm font-medium">{currentUser.name}</p>
              <p className="text-xs text-slate-500 uppercase">{currentUser.role} • {currentUser.employeeId}</p>
            </div>
            <div className="w-10 h-10 bg-slate-100 rounded-full flex items-center justify-center text-slate-600">
              <UserIcon size={20} />
            </div>
          </div>
        </header>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentView}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {currentView === 'dashboard' && <DashboardView user={currentUser} shifts={shifts} diversions={diversions} />}
              {currentView === 'omleidingen' && <DiversionsView diversions={diversions} />}
              {currentView === 'rooster' && <ScheduleView user={currentUser} shifts={shifts} />}
              {currentView === 'updates' && <UpdatesView />}
              {currentView === 'beheer-roosters' && <ManageSchedulesView shifts={shifts} onSave={savePlanning} users={users} />}
              {currentView === 'beheer-updates' && <ManageUpdatesView />}
              {currentView === 'gebruikers' && <ManageUsersView users={users} onSave={saveUsers} />}
              {currentView === 'beheer-omleidingen' && <ManageDiversionsView diversions={diversions} onSave={saveDiversions} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

function NavItem({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 w-full px-4 py-3 rounded-2xl transition-all duration-300 group relative overflow-hidden",
        active 
          ? "bg-oker-400 text-white shadow-lg shadow-oker-400/30 font-bold" 
          : "text-slate-500 hover:text-oker-600 hover:bg-oker-50 font-medium"
      )}
    >
      {/* Liquid Glass Effect Overlay */}
      <div className={cn(
        "absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none rounded-2xl",
        active ? "glass-oker" : "glass"
      )} />
      
      <span className={cn(
        "relative z-10 transition-transform duration-300 group-hover:scale-110",
        active ? "text-white" : "text-slate-400 group-hover:text-oker-500"
      )}>
        {icon}
      </span>
      <span className="relative z-10">{label}</span>
    </button>
  );
}

function LoginView({ onLogin, users }: { onLogin: (user: User) => void, users: User[] }) {
  const [selectedUser, setSelectedUser] = useState<string>('');
  const [password, setPassword] = useState<string>('');
  const [error, setError] = useState<string>('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const user = users.find(u => u.id === selectedUser);
    if (user) {
      if (user.isActive === false) {
        setError('Dit account is inactief');
        return;
      }
      if (user.password === password || (!user.password && password === '123')) {
        onLogin(user);
      } else {
        setError('Onjuist wachtwoord');
      }
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
        <div className="p-10 text-center">
          <h1 className="text-4xl font-black tracking-tighter text-slate-900 mb-2">VHB <span className="text-oker-500">PORTAAL</span></h1>
          <p className="text-slate-500 font-bold uppercase text-xs tracking-[0.2em]">Van Hoorebeke en Zoon</p>
        </div>
        
        <form onSubmit={handleSubmit} className="p-10 pt-0 space-y-6">
          <div className="space-y-2">
            <label className="block text-xs font-black text-slate-400 uppercase tracking-widest ml-1">Gebruiker</label>
            <select 
              value={selectedUser}
              onChange={(e) => {
                setSelectedUser(e.target.value);
                setError('');
              }}
              className="w-full px-6 py-4 rounded-2xl border border-slate-100 focus:outline-none focus:ring-4 focus:ring-oker-500/10 focus:border-oker-400 transition-all bg-white/80 backdrop-blur-sm shadow-inner appearance-none cursor-pointer font-bold text-slate-700"
              required
            >
              <option value="">Selecteer medewerker...</option>
              {[...users].filter(u => u.isActive !== false).sort((a, b) => a.name.localeCompare(b.name)).map(u => (
                <option key={u.id} value={u.id}>{u.name}</option>
              ))}
            </select>
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
            className="w-full bg-oker-500 text-white font-black py-5 rounded-2xl hover:bg-oker-600 transition-all shadow-xl shadow-oker-500/30 relative group overflow-hidden"
          >
            <div className="absolute inset-0 glass-oker opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none rounded-2xl" />
            <span className="relative z-10">INLOGGEN</span>
          </button>
        </form>
      </motion.div>
    </div>
  );
}

function DashboardView({ user, shifts, diversions }: { user: User, shifts: Shift[], diversions: Diversion[] }) {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <StatCard 
          icon={<Clock className="text-oker-600" />} 
          label="Volgende Dienst" 
          value={shifts.find(s => s.driverId === user.id)?.startTime || '--:--'} 
          subValue={shifts.find(s => s.driverId === user.id)?.line ? `Dienst ${shifts.find(s => s.driverId === user.id)?.line}` : 'Geen dienst'} 
        />
        <StatCard 
          icon={<AlertTriangle className="text-red-500" />} 
          label="Actieve Omleidingen" 
          value={diversions.length.toString()} 
          subValue="Totaal aantal" 
        />
        <StatCard 
          icon={<Bell className="text-oker-500" />} 
          label="Nieuwe Updates" 
          value="2" 
          subValue="Sinds gisteren" 
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section className="bg-white p-8 rounded-[32px] shadow-sm border border-slate-100">
          <div className="flex items-center justify-between mb-8">
            <h3 className="font-black text-xl tracking-tight">Planning voor vandaag</h3>
            <span className="text-[10px] font-black bg-oker-50 text-oker-700 px-4 py-1.5 rounded-full uppercase tracking-widest">5 Maart 2024</span>
          </div>
          <div className="space-y-4">
            {shifts.filter(s => s.driverId === user.id || user.role !== 'chauffeur').slice(0, 2).map(shift => (
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

        <section className="bg-white p-8 rounded-[32px] shadow-sm border border-slate-100">
          <h3 className="font-black text-xl tracking-tight mb-8">Belangrijke Omleidingen</h3>
          <div className="space-y-4">
            {MOCK_DIVERSIONS.slice(0, 2).map(div => (
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
          </div>
        </section>
      </div>
    </div>
  );
}

function DiversionsView({ diversions }: { diversions: Diversion[] }) {
  const [selectedDiversion, setSelectedDiversion] = useState<Diversion | null>(null);

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-2xl font-bold">Actuele Omleidingen</h3>
      </div>
      
      <div className="space-y-4">
        {diversions.map(div => (
          <div key={div.id} className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-hidden">
            <div 
              onClick={() => setSelectedDiversion(selectedDiversion?.id === div.id ? null : div)}
              className="p-6 cursor-pointer hover:bg-slate-50 transition-colors flex items-start justify-between gap-4"
            >
              <div className="flex gap-4">
                <div className={cn(
                  "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0",
                  div.severity === 'high' ? "bg-red-100 text-red-600" : 
                  div.severity === 'medium' ? "bg-amber-100 text-amber-600" : "bg-blue-100 text-blue-600"
                )}>
                  <MapPin size={24} />
                </div>
                <div>
                  <div className="flex items-center gap-3">
                    <h4 className="font-bold text-lg">{div.title}</h4>
                    <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded text-[10px] font-bold uppercase">{div.line}</span>
                  </div>
                  <p className="text-slate-500 text-sm mt-1">Klik voor omschrijving en PDF</p>
                </div>
              </div>
              <motion.div
                animate={{ rotate: selectedDiversion?.id === div.id ? 90 : 0 }}
                className="p-2 text-slate-300"
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
                  className="overflow-hidden bg-slate-50 border-t border-slate-100"
                >
                  <div className="p-6 space-y-4">
                    <p className="text-slate-700 leading-relaxed">{div.description}</p>
                    <div className="flex items-center gap-4 text-xs text-slate-400 font-medium">
                      <span className="flex items-center gap-1"><Calendar size={14} /> Start: {div.startDate}</span>
                      {div.endDate && <span className="flex items-center gap-1"><Calendar size={14} /> Eind: {div.endDate}</span>}
                    </div>
                    
                    {div.pdfUrl ? (
                      <div className="pt-4 flex gap-3">
                        <a 
                          href={div.pdfUrl} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="flex items-center gap-2 px-4 py-2 bg-white border border-slate-200 rounded-xl text-sm font-bold text-slate-700 hover:bg-slate-50 transition-colors"
                        >
                          <FileText size={16} className="text-red-500" />
                          Bekijk PDF
                        </a>
                        <a 
                          href={div.pdfUrl} 
                          download
                          className="flex items-center gap-2 px-4 py-2 bg-emerald-500 rounded-xl text-sm font-bold text-white hover:bg-emerald-600 transition-colors shadow-sm"
                        >
                          <Download size={16} />
                          Download PDF
                        </a>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-400 italic pt-2">Geen PDF bijlage beschikbaar voor deze omleiding.</p>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>
    </div>
  );
}

function ScheduleView({ user, shifts: allShifts }: { user: User, shifts: Shift[] }) {
  const shifts = allShifts.filter(s => s.driverId === user.id || user.role !== 'chauffeur');

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h3 className="text-2xl font-bold">Mijn Werkrooster</h3>
      </div>

      <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[600px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Datum</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Tijd</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Dienst</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Loopnr</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Bus</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {shifts.map(shift => (
              <tr key={shift.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-6 py-5 font-bold text-slate-900">{shift.date}</td>
                <td className="px-6 py-5">
                  <div className="flex items-center gap-2 text-slate-700 font-medium">
                    <Clock size={16} className="text-slate-400" />
                    {shift.startTime} - {shift.endTime}
                  </div>
                </td>
                <td className="px-6 py-5">
                  <span className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-lg font-bold text-sm">
                    {shift.line}
                  </span>
                </td>
                <td className="px-6 py-5">
                  <span className="px-3 py-1 bg-blue-100 text-blue-700 rounded-lg font-bold text-sm">
                    {shift.loopnr}
                  </span>
                </td>
                <td className="px-6 py-5 font-mono text-xs text-slate-400">{shift.busNumber}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function UpdatesView() {
  return (
    <div className="max-w-3xl space-y-6">
      <h3 className="text-2xl font-bold">Updates & Nieuws</h3>
      <div className="space-y-6">
        {MOCK_UPDATES.map(update => (
          <div key={update.id} className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100 relative overflow-hidden group">
            <div className={cn(
              "absolute top-0 left-0 w-1 h-full",
              update.category === 'veiligheid' ? "bg-red-500" : 
              update.category === 'technisch' ? "bg-blue-500" : "bg-emerald-500"
            )} />
            
            <div className="flex justify-between items-start mb-4">
              <span className={cn(
                "px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                update.category === 'veiligheid' ? "bg-red-50 text-red-600" : 
                update.category === 'technisch' ? "bg-blue-50 text-blue-600" : "bg-emerald-50 text-emerald-600"
              )}>
                {update.category}
              </span>
              <span className="text-xs text-slate-400 font-medium">{update.date}</span>
            </div>
            
            <h4 className="text-xl font-bold text-slate-900 mb-3 group-hover:text-emerald-600 transition-colors">{update.title}</h4>
            <p className="text-slate-600 leading-relaxed">{update.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ManageSchedulesView({ shifts, onSave, users }: { shifts: Shift[], onSave: (s: Shift[]) => void, users: User[] }) {
  const [jsonInput, setJsonInput] = useState('');
  const [showExcelInfo, setShowExcelInfo] = useState(false);

  const handleImport = () => {
    try {
      const data = JSON.parse(jsonInput);
      if (Array.isArray(data)) {
        onSave(data);
        setJsonInput('');
        alert('Planning succesvol geïmporteerd!');
      } else {
        alert('Ongeldig formaat. Zorg dat het een array van diensten is.');
      }
    } catch (e) {
      alert('Fout bij het parsen van JSON. Controleer de syntax.');
    }
  };

  return (
    <div className="max-w-4xl space-y-8">
      <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-xl font-bold flex items-center gap-2">
            <FileText size={24} className="text-oker-500" />
            Excel / JSON Import
          </h3>
          <button 
            onClick={() => setShowExcelInfo(!showExcelInfo)}
            className="text-sm font-bold text-oker-600 hover:underline"
          >
            Hoe werkt dit?
          </button>
        </div>

        {showExcelInfo && (
          <div className="mb-6 p-6 bg-oker-50 rounded-2xl border border-oker-100 text-sm space-y-3">
            <p className="font-bold text-oker-800">Koppeling met Excel:</p>
            <ol className="list-decimal list-inside space-y-2 text-oker-700">
              <li>Gebruik een Excel-script of Power Automate om je Excel-data om te zetten naar JSON.</li>
              <li>Plak de JSON hieronder om de planning direct bij te werken.</li>
              <li>Voor automatische synchronisatie kan je Excel-bestand direct naar de API pushen op: <code className="bg-white px-2 py-0.5 rounded border break-all">{window.location.origin}/api/planning</code></li>
            </ol>
          </div>
        )}

        <textarea 
          className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-oker-500/20 focus:border-oker-500 transition-all min-h-[150px] font-mono text-sm mb-4"
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

      <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
        <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
          <Plus size={24} className="text-emerald-500" />
          Handmatig Dienst Toevoegen
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Input label="Datum" type="date" />
          <Input label="Chauffeur" type="select" options={[...users].filter(u => u.role === 'chauffeur' && u.isActive !== false).sort((a, b) => a.name.localeCompare(b.name)).map(u => ({ label: u.name, value: u.id }))} />
          <Input label="Start Tijd" type="time" />
          <Input label="Eind Tijd" type="time" />
          <Input label="Dienst" type="text" placeholder="Bijv. 12" />
          <Input label="Loopnr" type="text" placeholder="Bijv. L-101" />
          <Input label="Bus Nummer" type="text" placeholder="Bijv. 8421" />
        </div>
        <button className="mt-8 bg-emerald-500 text-white font-bold px-8 py-3 rounded-xl hover:bg-emerald-600 transition-colors shadow-lg shadow-emerald-500/20">
          Dienst Opslaan
        </button>
      </div>

      <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
        <h3 className="text-xl font-bold mb-6">Huidige Planning</h3>
        <ScheduleView user={{ id: '0', name: 'Admin', role: 'admin', employeeId: 'ADMIN' }} shifts={shifts} />
      </div>
    </div>
  );
}

function ManageUpdatesView() {
  return (
    <div className="max-w-3xl space-y-8">
      <div className="bg-white p-8 rounded-3xl shadow-sm border border-slate-100">
        <h3 className="text-xl font-bold mb-6 flex items-center gap-2">
          <Bell size={24} className="text-emerald-500" />
          Nieuwe Update Publiceren
        </h3>
        <div className="space-y-6">
          <Input label="Titel" type="text" placeholder="Onderwerp van de update" />
          <Input label="Categorie" type="select" options={[
            { label: 'Algemeen', value: 'algemeen' },
            { label: 'Veiligheid', value: 'veiligheid' },
            { label: 'Technisch', value: 'technisch' }
          ]} />
          <div>
            <label className="block text-sm font-semibold text-slate-700 mb-2">Inhoud</label>
            <textarea 
              className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all min-h-[150px]"
              placeholder="Schrijf hier het bericht voor de chauffeurs..."
            />
          </div>
        </div>
        <button className="mt-8 bg-emerald-500 text-white font-bold px-8 py-3 rounded-xl hover:bg-emerald-600 transition-colors shadow-lg shadow-emerald-500/20">
          Update Publiceren
        </button>
      </div>
    </div>
  );
}

function ManageUsersView({ users, onSave }: { users: User[], onSave: (u: User[]) => void }) {
  const [isImporting, setIsImporting] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [newUser, setNewUser] = useState({ name: '', role: 'chauffeur', employeeId: '', password: '' });
  const [roleFilter, setRoleFilter] = useState<'all' | 'chauffeur' | 'planner' | 'admin'>('all');
  
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmResetUser, setConfirmResetUser] = useState<User | null>(null);

  const filteredUsers = users
    .filter(u => roleFilter === 'all' || u.role === roleFilter)
    .sort((a, b) => a.name.localeCompare(b.name));

  const handleAddUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.name) return;

    const userToAdd: User = {
      id: Date.now().toString(),
      name: newUser.name,
      role: newUser.role as any,
      employeeId: newUser.employeeId || `VHB-${Math.floor(1000 + Math.random() * 9000)}`,
      password: newUser.password || '123',
      isActive: true
    };

    onSave([...users, userToAdd]);
    setShowAddModal(false);
    setNewUser({ name: '', role: 'chauffeur', employeeId: '', password: '' });
  };

  const handleUpdateUser = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;

    const updatedUsers = users.map(u => u.id === editingUser.id ? editingUser : u);
    onSave(updatedUsers);
    setEditingUser(null);
  };

  const handleDeleteUser = () => {
    if (confirmDeleteId) {
      onSave(users.filter(u => u.id !== confirmDeleteId));
      if (editingUser?.id === confirmDeleteId) setEditingUser(null);
      setConfirmDeleteId(null);
    }
  };

  const handleResetPassword = () => {
    if (confirmResetUser) {
      const updatedUsers = users.map(u => 
        u.id === confirmResetUser.id ? { ...u, password: '123' } : u
      );
      onSave(updatedUsers);
      setConfirmResetUser(null);
      alert(`Wachtwoord voor ${confirmResetUser.name} is gereset naar '123'`);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsImporting(true);
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Try to get headers first to see what we're working with
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

        if (!jsonData || !Array.isArray(jsonData) || jsonData.length === 0) {
          alert('Het Excel-bestand lijkt leeg te zijn of heeft geen herkenbare gegevens.');
          return;
        }

        // Get keys from the first row to check column names
        const firstRow = jsonData[0] as any;
        const keys = Object.keys(firstRow);
        
        console.log('Excel Headers found:', keys);

        // Map Excel columns to User type
        const importedUsers: User[] = jsonData.map((row: any, index) => {
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
            password: password?.toString() || '123',
            isActive: true
          };
        }).filter(u => u.name && u.name.length > 1);

        if (importedUsers.length === 0) {
          const detectedHeaders = keys.join(', ');
          alert(`Geen geldige gebruikers gevonden. \n\nGevonden kolommen: ${detectedHeaders}\n\nZorg dat er een kolom is met "Naam", "Wachtwoord" en "Rol".`);
        } else {
          // Merge with existing users, avoiding duplicates by name
          const existingUserNames = new Set(users.map(u => u.name.toLowerCase()));
          
          const uniqueNewUsers = importedUsers.filter(u => 
            !existingUserNames.has(u.name.toLowerCase())
          );

          if (uniqueNewUsers.length === 0) {
            alert('Alle gebruikers uit dit bestand bestaan al in het systeem (gecontroleerd op naam).');
          } else {
            onSave([...users, ...uniqueNewUsers]);
            alert(`${uniqueNewUsers.length} nieuwe gebruikers succesvol toegevoegd!`);
          }
        }
      } catch (error) {
        console.error('Error parsing Excel:', error);
        alert('Fout bij het verwerken van het Excel-bestand. Zorg dat het een geldig Excel-bestand (.xlsx of .xls) is.');
      } finally {
        setIsImporting(false);
        if (e.target) e.target.value = '';
      }
    };
    reader.onerror = () => {
      alert('Fout bij het lezen van het bestand.');
      setIsImporting(false);
    };
    reader.readAsArrayBuffer(file);
  };

  return (
    <div className="max-w-4xl space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-2xl font-bold">Gebruikersbeheer</h3>
          <p className="text-sm text-slate-500 font-medium">Beheer medewerkers en hun toegangsrechten.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex bg-slate-100 p-1 rounded-xl mr-2">
            {(['all', 'chauffeur', 'planner', 'admin'] as const).map(role => (
              <button
                key={role}
                onClick={() => setRoleFilter(role)}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold transition-all capitalize",
                  roleFilter === role ? "bg-white text-oker-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
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
              className="bg-white rounded-[32px] shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-8 border-b border-slate-100">
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
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-oker-500/20 focus:border-oker-500 outline-none transition-all"
                    placeholder="bijv. Jan Janssen"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Rol</label>
                  <select 
                    value={newUser.role}
                    onChange={(e) => setNewUser({...newUser, role: e.target.value})}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-oker-500/20 focus:border-oker-500 outline-none transition-all bg-white"
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
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-oker-500/20 focus:border-oker-500 outline-none transition-all"
                    placeholder="bijv. VHB-1234"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Wachtwoord</label>
                  <input 
                    type="password" 
                    value={newUser.password}
                    onChange={(e) => setNewUser({...newUser, password: e.target.value})}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-oker-500/20 focus:border-oker-500 outline-none transition-all"
                    placeholder="Standaard: 123"
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
              className="bg-white rounded-[32px] shadow-2xl w-full max-w-md overflow-hidden"
            >
              <div className="p-8 border-b border-slate-100 flex justify-between items-center">
                <div>
                  <h4 className="text-xl font-bold">Gebruiker Bewerken</h4>
                  <p className="text-sm text-slate-500">Pas de gegevens van {editingUser.name} aan.</p>
                </div>
                <button 
                  onClick={() => setConfirmDeleteId(editingUser.id)}
                  className="p-2 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                  title="Verwijder gebruiker"
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
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-oker-500/20 focus:border-oker-500 outline-none transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Rol</label>
                  <select 
                    value={editingUser.role}
                    onChange={(e) => setEditingUser({...editingUser, role: e.target.value as any})}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-oker-500/20 focus:border-oker-500 outline-none transition-all bg-white"
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
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-oker-500/20 focus:border-oker-500 outline-none transition-all"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Wachtwoord</label>
                  <input 
                    type="password" 
                    value={editingUser.password || ''}
                    onChange={(e) => setEditingUser({...editingUser, password: e.target.value})}
                    className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:ring-2 focus:ring-oker-500/20 focus:border-oker-500 outline-none transition-all"
                    placeholder="Wachtwoord ongewijzigd laten indien leeg"
                  />
                </div>

                <div className="flex items-center justify-between p-4 bg-slate-50 rounded-2xl">
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
                  <div className="p-3 bg-slate-50 rounded-xl">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Laatst Ingelogd</p>
                    <p className="text-xs font-bold text-slate-700 mt-1">{editingUser.lastLogin || 'Nooit'}</p>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-xl">
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

      <div className="bg-white p-6 rounded-3xl border border-oker-100 bg-oker-50/30 text-sm">
        <p className="font-bold text-oker-800 mb-2">Excel Instructies:</p>
        <p className="text-oker-700">Zorg dat je Excel de volgende kolommen heeft: <span className="font-mono font-bold">Naam, Rol, Wachtwoord</span>. De rollen kunnen zijn: chauffeur, planner, admin. De ID's worden automatisch gegenereerd als ze ontbreken.</p>
      </div>

      <div className="bg-white rounded-3xl shadow-sm border border-slate-100 overflow-x-auto">
        <table className="w-full text-left border-collapse min-w-[800px]">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-100">
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Naam</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Status</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider">Laatst Ingelogd</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider text-center">Sessies</th>
              <th className="px-6 py-4 text-xs font-bold text-slate-400 uppercase tracking-wider text-right">Acties</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {filteredUsers.map(u => (
              <tr key={u.id} className="hover:bg-slate-50/50 transition-colors">
                <td className="px-6 py-5">
                  <div className="font-bold text-slate-900">{u.name}</div>
                  <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">{u.role}</div>
                </td>
                <td className="px-6 py-5">
                  <span className={cn(
                    "px-2 py-1 rounded-lg text-[10px] font-black uppercase tracking-wider",
                    u.isActive !== false ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                  )}>
                    {u.isActive !== false ? 'Actief' : 'Inactief'}
                  </span>
                </td>
                <td className="px-6 py-5 text-sm text-slate-500">
                  {u.lastLogin ? u.lastLogin : <span className="text-slate-300 italic">Nooit</span>}
                </td>
                <td className="px-6 py-5 text-center">
                  <span className={cn(
                    "px-2 py-1 rounded-lg text-[10px] font-black",
                    (u.activeSessions || 0) > 0 ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-400"
                  )}>
                    {u.activeSessions || 0}
                  </span>
                </td>
                <td className="px-6 py-5 text-right flex items-center justify-end gap-3">
                  <button 
                    onClick={() => setConfirmResetUser(u)}
                    className="p-2 text-slate-400 hover:text-oker-600 hover:bg-oker-50 rounded-lg transition-all"
                    title="Reset wachtwoord naar 123"
                  >
                    <RotateCcw size={16} />
                  </button>
                  <button 
                    onClick={() => setEditingUser(u)}
                    className="text-sm font-bold text-oker-600 hover:text-oker-700 transition-colors"
                  >
                    Bewerken
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ConfirmationModal 
        isOpen={!!confirmDeleteId}
        onClose={() => setConfirmDeleteId(null)}
        onConfirm={handleDeleteUser}
        title="Gebruiker Verwijderen"
        message="Weet je zeker dat je deze gebruiker wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt."
      />

      <ConfirmationModal 
        isOpen={!!confirmResetUser}
        onClose={() => setConfirmResetUser(null)}
        onConfirm={handleResetPassword}
        title="Wachtwoord Resetten"
        message={`Weet je zeker dat je het wachtwoord van ${confirmResetUser?.name} wilt resetten naar '123'?`}
        confirmText="Resetten"
        variant="warning"
      />
    </div>
  );
}

function ManageDiversionsView({ diversions, onSave }: { diversions: Diversion[], onSave: (d: Diversion[]) => void }) {
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<Diversion>>({
    line: '',
    title: '',
    description: '',
    startDate: new Date().toISOString().split('T')[0],
    severity: 'medium'
  });
  const [pdfFile, setPdfFile] = useState<File | null>(null);

  const handleOpenAdd = () => {
    setEditingId(null);
    setFormData({
      line: '',
      title: '',
      description: '',
      startDate: new Date().toISOString().split('T')[0],
      severity: 'medium'
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
      severity: div.severity
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
        pdfUrl: pdfUrl || undefined
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
    <div className="max-w-4xl space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h3 className="text-2xl font-bold text-slate-900">Beheer Omleidingen</h3>
          <p className="text-sm text-slate-500 font-medium">Voeg omleidingen toe en upload PDF-bestanden voor chauffeurs.</p>
        </div>
        <button 
          onClick={handleOpenAdd}
          className="bg-oker-500 text-white px-6 py-3 rounded-2xl text-sm font-bold flex items-center gap-2 hover:bg-oker-600 transition-all shadow-lg shadow-oker-500/20"
        >
          <Plus size={18} /> Omleiding Toevoegen
        </button>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {diversions.map(div => (
          <div key={div.id} className="bg-white p-6 rounded-[32px] border border-slate-100 shadow-sm flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className={cn(
                "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0",
                div.severity === 'high' ? "bg-red-100 text-red-600" : 
                div.severity === 'medium' ? "bg-amber-100 text-amber-600" : "bg-blue-100 text-blue-600"
              )}>
                <MapPin size={24} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h4 className="font-bold text-slate-900">{div.title}</h4>
                  <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded text-[10px] font-bold uppercase">Lijn {div.line}</span>
                </div>
                <p className="text-xs text-slate-400 font-medium mt-0.5">{div.startDate} {div.endDate ? `t/m ${div.endDate}` : ''}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {div.pdfUrl && (
                <div className="p-2 text-emerald-500 bg-emerald-50 rounded-lg" title="PDF Beschikbaar">
                  <FileText size={18} />
                </div>
              )}
              <button 
                onClick={() => handleOpenEdit(div)}
                className="p-2 text-slate-400 hover:text-oker-600 hover:bg-oker-50 rounded-lg transition-all"
                title="Bewerken"
              >
                <Pencil size={18} />
              </button>
              <button 
                onClick={() => setConfirmDeleteId(div.id)}
                className="p-2 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                title="Verwijderen"
              >
                <Trash2 size={18} />
              </button>
            </div>
          </div>
        ))}
        {diversions.length === 0 && (
          <div className="text-center py-12 bg-white rounded-[32px] border border-dashed border-slate-200">
            <p className="text-slate-400 font-medium">Geen actieve omleidingen.</p>
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
              className="bg-white rounded-[40px] shadow-2xl w-full max-w-lg overflow-hidden"
            >
              <div className="p-8 border-b border-slate-100 flex items-center justify-between">
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
                      className="w-full px-4 py-3 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-oker-500/10 focus:border-oker-400 outline-none transition-all font-bold text-sm bg-white"
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
    </div>
  );
}

function Input({ label, type, placeholder, options }: { label: string, type: string, placeholder?: string, options?: { label: string, value: string }[] }) {
  return (
    <div>
      <label className="block text-sm font-semibold text-slate-700 mb-2">{label}</label>
      {type === 'select' ? (
        <select className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all bg-white">
          {options?.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
      ) : (
        <input 
          type={type} 
          placeholder={placeholder}
          className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all"
        />
      )}
    </div>
  );
}

function StatCard({ icon, label, value, subValue }: { icon: React.ReactNode, label: string, value: string, subValue: string }) {
  return (
    <div className="bg-white p-6 md:p-8 rounded-[32px] shadow-sm border border-slate-100 flex items-center gap-4 md:gap-6 group hover:shadow-xl hover:shadow-oker-500/5 transition-all duration-500 relative overflow-hidden">
      <div className="absolute top-0 right-0 w-32 h-32 bg-oker-50 rounded-full -mr-16 -mt-16 opacity-50 group-hover:scale-150 transition-transform duration-700" />
      <div className="p-3 md:p-4 bg-oker-50 rounded-2xl relative z-10 group-hover:scale-110 transition-transform">
        {icon}
      </div>
      <div className="relative z-10">
        <p className="text-[10px] md:text-xs font-black text-slate-500 uppercase tracking-widest">{label}</p>
        <p className="text-xl md:text-3xl font-black text-slate-900 mt-0.5 md:mt-1 tracking-tight">{value}</p>
        <p className="text-[10px] md:text-xs text-slate-500 mt-0.5 md:mt-1 font-medium">{subValue}</p>
      </div>
    </div>
  );
}

