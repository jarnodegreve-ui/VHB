import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Search } from 'lucide-react';
import { ROUTES } from '../app/routes';
// Ook 'verborgen' routes (Instellingen) zijn via het palette bereikbaar.
const paletteRoutes = () => ROUTES;
import type { View, Role } from '../types';
import { cn } from '../lib/ui';
import { DUR, EASE } from '../lib/motion';

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

  // Navigatie-commando's komen uit de routetabel: elk scherm dat een rol
  // mag zien is vindbaar, mét zoekwoorden. Eerder stond hier een handlijst
  // die acht views miste.
  const commands = useMemo<Command[]>(
    () => paletteRoutes().map((r) => {
      const Icoon = r.icoon;
      return {
        id: `goto-${r.view}`,
        label: r.label,
        hint: r.omschrijving,
        icon: <Icoon size={16} />,
        keywords: `${r.zoek ?? ''} ${r.pad}`,
        roles: [...r.rollen],
        action: () => onNavigate(r.view),
      };
    }),
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
          transition={{ duration: DUR.fast, ease: EASE }}
          className="fixed inset-0 z-[120] flex items-start justify-center px-4"
          onClick={onClose}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" />

          {/* Panel */}
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: DUR.base, ease: EASE }}
            role="dialog"
            aria-modal="true"
            aria-label="Zoek scherm of actie"
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
                role="combobox"
                aria-expanded="true"
                aria-controls="palette-resultaten"
                aria-activedescendant={filtered[selectedIdx] ? `palette-${filtered[selectedIdx].id}` : undefined}
                aria-autocomplete="list"
                className="no-focus-ring flex-1 bg-transparent outline-none text-base text-slate-900 placeholder:text-slate-400"
              />
              <kbd className="hidden sm:inline-flex items-center rounded-md border border-slate-200 bg-surface-soft px-1.5 py-0.5 text-2xs font-semibold text-slate-400">
                esc
              </kbd>
            </div>

            {/* Results */}
            <div id="palette-resultaten" role="listbox" aria-label="Resultaten" className="max-h-[50vh] overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-500">
                  Geen resultaten voor "{query}"
                </div>
              ) : (
                filtered.map((cmd, i) => {
                  const isActive = i === selectedIdx;
                  return (
                    // rauw: resultaatrij van het command palette (icoon + label + hint,
                    // toetsenbord-actieve staat) — navigatie-item, geen knop-uiterlijk.
                    <button
                      key={cmd.id}
                      id={`palette-${cmd.id}`}
                      role="option"
                      aria-selected={isActive}
                      onClick={() => {
                        cmd.action();
                        onClose();
                      }}
                      onMouseEnter={() => setSelectedIdx(i)}
                      className={cn(
                        'w-full flex items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-surface-muted text-slate-900'
                          : 'text-slate-700 hover:bg-surface-soft-hover',
                      )}
                    >
                      <span
                        className={cn(
                          'shrink-0 flex items-center justify-center',
                          isActive ? 'text-oker-700' : 'text-slate-400',
                        )}
                      >
                        {cmd.icon}
                      </span>
                      <span className="flex-1 min-w-0 truncate">{cmd.label}</span>
                      {cmd.hint && (
                        <span className="hidden sm:block shrink-0 max-w-[45%] truncate text-xs font-normal text-slate-400">
                          {cmd.hint}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-3 border-t border-slate-200/70 px-4 py-2 text-2xs text-slate-400">
              <span className="flex items-center gap-1">
                <kbd className="inline-flex items-center rounded-md border border-slate-200 bg-surface-soft px-1.5 py-0.5 text-2xs font-semibold text-slate-400">
                  ↑
                </kbd>
                <kbd className="inline-flex items-center rounded-md border border-slate-200 bg-surface-soft px-1.5 py-0.5 text-2xs font-semibold text-slate-400">
                  ↓
                </kbd>
                navigeren
              </span>
              <span aria-hidden="true">·</span>
              <span className="flex items-center gap-1">
                <kbd className="inline-flex items-center rounded-md border border-slate-200 bg-surface-soft px-1.5 py-0.5 text-2xs font-semibold text-slate-400">
                  ↵
                </kbd>
                openen
              </span>
              <span aria-hidden="true">·</span>
              <span className="flex items-center gap-1">
                <kbd className="inline-flex items-center rounded-md border border-slate-200 bg-surface-soft px-1.5 py-0.5 text-2xs font-semibold text-slate-400">
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
