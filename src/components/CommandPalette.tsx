import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  LayoutDashboard,
  Calendar,
  MapPin,
  Bell,
  Settings,
  Users,
  FileText,
  Activity,
  Search,
  Repeat,
  Plus,
  RefreshCw,
} from 'lucide-react';
import type { View, Role } from '../types';
import { cn } from '../lib/ui';

type Command = {
  id: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  keywords: string;
  roles?: Role[];
  action: () => void;
};

/**
 * Cmd+K palette — spotlight-style quick action menu.
 *
 * - ⌘K / Ctrl+K opent het palette
 * - Type om te zoeken
 * - Pijl up/down om te navigeren, Enter om te kiezen, Esc om te sluiten
 * - Recent gebruikte items komen bovenaan
 */
export function CommandPalette({
  open,
  onClose,
  onNavigate,
  role,
}: {
  open: boolean;
  onClose: () => void;
  onNavigate: (view: View) => void;
  role: Role;
}) {
  const [query, setQuery] = useState('');
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands = useMemo<Command[]>(
    () => [
      {
        id: 'goto-dashboard',
        label: 'Dashboard',
        icon: <LayoutDashboard size={16} />,
        keywords: 'dashboard home overzicht start',
        action: () => onNavigate('dashboard'),
      },
      {
        id: 'goto-rooster',
        label: 'Mijn Rooster',
        icon: <Calendar size={16} />,
        keywords: 'rooster mijn diensten schedule',
        action: () => onNavigate('rooster'),
      },
      {
        id: 'goto-omleidingen',
        label: 'Omleidingen',
        icon: <MapPin size={16} />,
        keywords: 'omleidingen hinder route diversion',
        action: () => onNavigate('omleidingen'),
      },
      {
        id: 'goto-updates',
        label: 'Updates',
        icon: <Bell size={16} />,
        keywords: 'updates nieuws meldingen',
        action: () => onNavigate('updates'),
      },
      {
        id: 'goto-verlof',
        label: 'Verlof',
        icon: <Calendar size={16} />,
        keywords: 'verlof vakantie afwezig',
        action: () => onNavigate('verlof'),
      },
      {
        id: 'goto-ruil',
        label: 'Dienstruil',
        icon: <Repeat size={16} />,
        keywords: 'ruil swap dienst tauschen',
        action: () => onNavigate('ruil-verzoeken'),
      },
      {
        id: 'goto-contacten',
        label: 'Contactlijst',
        icon: <Users size={16} />,
        keywords: 'contact collega telefoon',
        action: () => onNavigate('contacten'),
      },
      {
        id: 'goto-dienstoverzicht',
        label: 'Dienstoverzicht',
        icon: <FileText size={16} />,
        keywords: 'dienst overzicht service nummers',
        action: () => onNavigate('dienstoverzicht'),
      },
      {
        id: 'goto-ritblaadjes',
        label: 'Ritblaadjes',
        icon: <FileText size={16} />,
        keywords: 'rit blaadjes pdf',
        action: () => onNavigate('ritblaadjes'),
      },
      // === Planner/admin only ===
      {
        id: 'goto-verlof-beheer',
        label: 'Verlofbeheer',
        hint: 'Aanvragen goedkeuren of weigeren',
        icon: <Calendar size={16} />,
        keywords: 'verlof beheer goedkeur weiger approve',
        roles: ['planner', 'admin'],
        action: () => onNavigate('verlof-beheer'),
      },
      {
        id: 'goto-verlof-kalender',
        label: 'Verlof-kalender',
        icon: <Calendar size={16} />,
        keywords: 'kalender maandoverzicht verlof',
        roles: ['planner', 'admin'],
        action: () => onNavigate('verlof-kalender'),
      },
      {
        id: 'goto-beheer-roosters',
        label: 'Beheer Roosters',
        hint: 'Matrix importeren',
        icon: <Settings size={16} />,
        keywords: 'beheer roosters import matrix excel xlsx',
        roles: ['planner', 'admin'],
        action: () => onNavigate('beheer-roosters'),
      },
      {
        id: 'goto-planning-matrix',
        label: 'Planning Overzicht',
        icon: <FileText size={16} />,
        keywords: 'planning matrix overzicht',
        roles: ['planner', 'admin'],
        action: () => onNavigate('planning-matrix'),
      },
      {
        id: 'goto-planning-codes',
        label: 'Planningscodes',
        icon: <Settings size={16} />,
        keywords: 'codes vrij F bv ziek planning',
        roles: ['planner', 'admin'],
        action: () => onNavigate('planning-codes'),
      },
      {
        id: 'goto-beheer-updates',
        label: 'Beheer Updates',
        icon: <Plus size={16} />,
        keywords: 'updates publiceer nieuw beheer',
        roles: ['planner', 'admin'],
        action: () => onNavigate('beheer-updates'),
      },
      {
        id: 'goto-beheer-omleidingen',
        label: 'Beheer Omleidingen',
        icon: <Settings size={16} />,
        keywords: 'beheer omleidingen toevoegen',
        roles: ['planner', 'admin'],
        action: () => onNavigate('beheer-omleidingen'),
      },
      {
        id: 'goto-beheer-dienstoverzicht',
        label: 'Beheer Dienstoverzicht',
        icon: <Settings size={16} />,
        keywords: 'beheer dienstoverzicht service',
        roles: ['planner', 'admin'],
        action: () => onNavigate('beheer-dienstoverzicht'),
      },
      // === Admin only ===
      {
        id: 'goto-gebruikers',
        label: 'Gebruikers',
        icon: <Users size={16} />,
        keywords: 'gebruikers user account beheer',
        roles: ['admin'],
        action: () => onNavigate('gebruikers'),
      },
      {
        id: 'goto-activiteit',
        label: 'Activiteit',
        icon: <Activity size={16} />,
        keywords: 'activiteit audit log historiek',
        roles: ['admin'],
        action: () => onNavigate('activiteit'),
      },
      {
        id: 'goto-beheer-contactlijst',
        label: 'Beheer Contactlijst',
        icon: <Users size={16} />,
        keywords: 'beheer contact medewerkers',
        roles: ['admin'],
        action: () => onNavigate('beheer-contactlijst'),
      },
      {
        id: 'goto-beheer-debug',
        label: 'Systeem Status',
        icon: <RefreshCw size={16} />,
        keywords: 'debug status health check',
        roles: ['admin'],
        action: () => onNavigate('beheer-debug'),
      },
    ],
    [onNavigate],
  );

  // Filter on role + query
  const filtered = useMemo(() => {
    const scoped = commands.filter((c) => !c.roles || c.roles.includes(role));
    const q = query.trim().toLowerCase();
    if (!q) return scoped;
    return scoped.filter((c) =>
      `${c.label} ${c.keywords} ${c.hint ?? ''}`.toLowerCase().includes(q),
    );
  }, [commands, role, query]);

  // Reset selection bij query-wijziging
  useEffect(() => {
    setSelectedIdx(0);
  }, [query]);

  // Focus input + reset bij open
  useEffect(() => {
    if (open) {
      setQuery('');
      setSelectedIdx(0);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Keyboard shortcuts: arrows, enter, escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const cmd = filtered[selectedIdx];
        if (cmd) {
          cmd.action();
          onClose();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, filtered, selectedIdx, onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[120] flex items-start justify-center pt-[10vh] px-4"
          onClick={onClose}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0"
            style={{
              background: 'rgba(15, 23, 42, 0.35)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
            }}
          />

          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, y: -16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="relative w-full max-w-xl rounded-[24px] overflow-hidden"
            style={{
              background:
                'linear-gradient(180deg, rgba(255, 255, 255, 0.85) 0%, rgba(255, 255, 255, 0.7) 100%)',
              backdropFilter: 'blur(36px) saturate(165%)',
              WebkitBackdropFilter: 'blur(36px) saturate(165%)',
              border: '1px solid rgba(255, 255, 255, 0.92)',
              boxShadow:
                'inset 0 1px 0 rgba(255, 255, 255, 0.98), inset 0 -1px 0 rgba(255, 255, 255, 0.4), 0 28px 80px rgba(15, 23, 42, 0.18)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Search input */}
            <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-200/60">
              <Search size={18} className="text-slate-400 shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Zoek scherm of actie…"
                className="flex-1 bg-transparent outline-none text-base font-medium text-slate-900 placeholder:text-slate-400"
              />
              <kbd className="hidden sm:inline-flex items-center gap-0.5 px-2 py-1 rounded-md border border-slate-200 bg-white/60 text-[10px] font-bold text-slate-500">
                ESC
              </kbd>
            </div>

            {/* Results */}
            <div className="max-h-[55vh] overflow-y-auto py-2">
              {filtered.length === 0 ? (
                <div className="px-5 py-8 text-center">
                  <p className="text-sm font-medium text-slate-500">Geen resultaten voor "{query}"</p>
                </div>
              ) : (
                filtered.map((cmd, i) => {
                  const isActive = i === selectedIdx;
                  return (
                    <button
                      key={cmd.id}
                      onClick={() => {
                        cmd.action();
                        onClose();
                      }}
                      onMouseEnter={() => setSelectedIdx(i)}
                      className={cn(
                        'w-full flex items-center gap-3 px-5 py-2.5 text-left transition-colors',
                        isActive ? 'bg-oker-50/80' : 'hover:bg-slate-50/60',
                      )}
                    >
                      <div
                        className={cn(
                          'w-8 h-8 rounded-lg flex items-center justify-center shrink-0',
                          isActive ? 'bg-oker-500 text-white shadow-sm' : 'bg-slate-100 text-slate-500',
                        )}
                      >
                        {cmd.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className={cn('text-sm font-semibold', isActive ? 'text-oker-900' : 'text-slate-800')}>
                          {cmd.label}
                        </p>
                        {cmd.hint && (
                          <p className="text-xs text-slate-500 mt-0.5 truncate">{cmd.hint}</p>
                        )}
                      </div>
                      {isActive && (
                        <kbd className="hidden sm:inline-flex items-center px-2 py-1 rounded-md border border-oker-300/50 bg-white/80 text-[10px] font-bold text-oker-700">
                          ↵
                        </kbd>
                      )}
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between px-5 py-2.5 border-t border-slate-200/60 bg-white/40 text-[10px] font-medium text-slate-500">
              <div className="flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 rounded border border-slate-200 bg-white">↑</kbd>
                  <kbd className="px-1.5 py-0.5 rounded border border-slate-200 bg-white">↓</kbd>
                  Navigeer
                </span>
                <span className="flex items-center gap-1">
                  <kbd className="px-1.5 py-0.5 rounded border border-slate-200 bg-white">↵</kbd>
                  Kies
                </span>
              </div>
              <span className="font-bold tracking-widest uppercase">{filtered.length} resultaten</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

/**
 * Hook die ⌘K / Ctrl+K globaal afvangt en de palette opent.
 */
export function useCommandPaletteShortcut(onOpen: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        // Niet triggeren als gebruiker in een input typt? Wel — overal werken
        // is power-user verwacht gedrag.
        e.preventDefault();
        onOpen();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onOpen]);
}
