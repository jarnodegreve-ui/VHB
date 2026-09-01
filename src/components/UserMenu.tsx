import { BellOff, BellRing, ChevronDown, KeyRound, LifeBuoy, LogOut, Moon, Sun } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { cn } from '../lib/ui';
import type { User } from '../types';
import { useDropdown } from './useDropdown';

/**
 * Avatar-menu in de topbar (mock Jarno 30-08): goud cirkeltje met initialen
 * + chevron, uitklapbaar naar de accountacties die eerst onderaan de sidebar
 * stonden (thema, pushmeldingen, wachtwoord, probleem melden, uitloggen).
 * De sidebar-voet met het gebruikerskaartje is daarmee vervallen.
 *
 * Eigen lichtgewicht dropdown (geen lib): sluit op buiten-klik en Escape;
 * items zijn gewone buttons met role="menuitem".
 */
export function UserMenu({
  user,
  initials,
  theme,
  onToggleTheme,
  pushBeschikbaar,
  pushEnabled,
  onTogglePush,
  onChangePassword,
  onProbleem,
  onLogout,
}: {
  user: User;
  initials: string;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  pushBeschikbaar: boolean;
  pushEnabled: boolean;
  onTogglePush: () => void;
  onChangePassword: () => void;
  onProbleem: () => void;
  onLogout: () => void;
}) {
  const { open, setOpen, wortel } = useDropdown();

  const sluitEn = (fn: () => void) => () => { setOpen(false); fn(); };

  const item =
    'flex items-center gap-3 w-full px-3 py-2.5 text-slate-600 hover:text-slate-900 hover:bg-slate-100/70 rounded-xl transition-colors duration-150 font-medium text-sm';

  return (
    <div ref={wortel} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Accountmenu"
        className="flex items-center gap-1 rounded-full py-1 pl-1 pr-1.5 hover:bg-slate-100/80 transition-colors"
      >
        {/* Huisstijl-pairing: op goud altijd carbon-tekst, geen wit. */}
        <span className="w-8 h-8 rounded-full bg-oker-500 text-slate-950 flex items-center justify-center text-2xs font-bold select-none">
          {initials}
        </span>
        <ChevronDown size={14} className={cn('text-slate-400 transition-transform duration-200', open && 'rotate-180')} />
      </button>

      <AnimatePresence>
      {open && (
        <motion.div
          role="menu"
          aria-label="Account"
          initial={{ opacity: 0, scale: 0.97, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: -4 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          style={{ transformOrigin: 'top right' }}
          className="absolute right-0 top-full mt-2 w-64 rounded-2xl bg-surface-white backdrop-blur-xl ring-1 ring-hairline shadow-xl p-1.5 z-50"
        >
          {/* Identiteit bovenaan — het kaartje dat eerst in de sidebar-voet stond. */}
          <div className="flex items-center gap-2.5 px-3 py-2.5 mb-1 border-b fine-divider">
            <span className="w-8 h-8 rounded-full bg-oker-100 text-oker-700 flex items-center justify-center text-2xs font-bold shrink-0">
              {initials}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-800 truncate leading-tight">{user.name}</span>
              <span className="block text-2xs text-slate-500 font-medium">
                {{ admin: 'Beheerder', planner: 'Planner', chauffeur: 'Chauffeur' }[user.role] ?? user.role}
              </span>
            </span>
          </div>
          <button role="menuitem" onClick={sluitEn(onToggleTheme)} className={item}>
            <span className="text-slate-400 shrink-0">{theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}</span>
            <span>{theme === 'light' ? 'Donkere modus' : 'Lichte modus'}</span>
          </button>
          {pushBeschikbaar && (
            <button role="menuitem" onClick={sluitEn(onTogglePush)} className={item}>
              <span className="text-slate-400 shrink-0">{pushEnabled ? <BellOff size={16} /> : <BellRing size={16} />}</span>
              <span>{pushEnabled ? 'Meldingen uitschakelen' : 'Meldingen inschakelen'}</span>
            </button>
          )}
          <button role="menuitem" onClick={sluitEn(onChangePassword)} className={item}>
            <span className="text-slate-400 shrink-0"><KeyRound size={16} /></span>
            <span>Wachtwoord wijzigen</span>
          </button>
          <button role="menuitem" onClick={sluitEn(onProbleem)} aria-haspopup="dialog" className={item}>
            <span className="text-slate-400 shrink-0"><LifeBuoy size={16} /></span>
            <span>Meld een probleem</span>
          </button>
          <button
            role="menuitem"
            onClick={sluitEn(onLogout)}
            className="flex items-center gap-3 w-full px-3 py-2.5 text-slate-600 hover:text-red-600 hover:bg-red-50/70 rounded-xl transition-colors duration-150 font-medium text-sm"
          >
            <span className="text-slate-400 shrink-0"><LogOut size={16} /></span>
            <span>Uitloggen</span>
          </button>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}
