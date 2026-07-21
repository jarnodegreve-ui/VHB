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
        roles: ['planner', 'admin'],
        action: () => onNavigate('dienstoverzicht'),
      },
      {
        id: 'goto-ritblaadjes',
        label: 'Ritbladen',
        icon: <FileText size={16} />,
        keywords: 'rit bladen blaadjes ritblaadjes pdf',
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
          className="fixed inset-0 z-[120] flex items-start justify-center px-4"
          onClick={onClose}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" />

          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className="glass-modal relative mt-[12vh] w-full max-w-xl rounded-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Search input */}
            <div className="flex items-center gap-3 px-4 py-3.5 border-b border-slate-200/70">
              <Search size={16} className="text-slate-400 shrink-0" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Zoek scherm of actie…"
                className="no-focus-ring flex-1 bg-transparent outline-none text-[15px] text-slate-900 placeholder:text-slate-400"
              />
              <kbd className="hidden sm:inline-flex items-center rounded-[5px] border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-400">
                esc
              </kbd>
            </div>

            {/* Results */}
            <div className="max-h-[50vh] overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <div className="py-8 text-center text-[13px] text-slate-500">
                  Geen resultaten voor "{query}"
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
                        'w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left text-[13.5px] font-medium transition-colors',
                        isActive
                          ? 'bg-slate-100 text-slate-900'
                          : 'text-slate-700 hover:bg-slate-50',
                      )}
                    >
                      <span
                        className={cn(
                          'shrink-0 flex items-center justify-center',
                          isActive ? 'text-oker-600' : 'text-slate-400',
                        )}
                      >
                        {cmd.icon}
                      </span>
                      <span className="flex-1 min-w-0 truncate">{cmd.label}</span>
                      {cmd.hint && (
                        <span className="hidden sm:block shrink-0 max-w-[45%] truncate text-[12px] font-normal text-slate-400">
                          {cmd.hint}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-3 border-t border-slate-200/70 px-4 py-2 text-[11px] text-slate-400">
              <span className="flex items-center gap-1">
                <kbd className="inline-flex items-center rounded-[5px] border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-400">
                  ↑
                </kbd>
                <kbd className="inline-flex items-center rounded-[5px] border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-400">
                  ↓
                </kbd>
                navigeren
              </span>
              <span aria-hidden="true">·</span>
              <span className="flex items-center gap-1">
                <kbd className="inline-flex items-center rounded-[5px] border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-400">
                  ↵
                </kbd>
                openen
              </span>
              <span aria-hidden="true">·</span>
              <span className="flex items-center gap-1">
                <kbd className="inline-flex items-center rounded-[5px] border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[11px] font-semibold text-slate-400">
                  esc
                </kbd>
                sluiten
              </span>
              <span className="ml-auto">{filtered.length} resultaten</span>
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
