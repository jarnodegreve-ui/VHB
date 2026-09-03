import { BellOff, BellRing, ChevronDown, KeyRound, LifeBuoy, LogOut, Moon, Settings, Sun } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/ui';
import type { User } from '../types';
import { useDropdown } from './useDropdown';
import { DUR } from '../lib/motion';

/**
 * Avatar-menu in de topbar (mock Jarno 30-08): goud cirkeltje met initialen
 * + chevron, uitklapbaar naar de accountacties die eerst onderaan de sidebar
 * stonden (thema, pushmeldingen, wachtwoord, probleem melden, uitloggen).
 * De sidebar-voet met het gebruikerskaartje is daarmee vervallen.
 *
 * Eigen lichtgewicht dropdown (geen lib): sluit op buiten-klik en Escape;
 * items zijn gewone buttons met role="menuitem".
 */

/** Menurij: icoon-slot links, label, links uitgelijnd. Eén rauwe knop voor
 *  alle vijf de items i.p.v. vijf kopieën van het recept. */
function MenuItem({ icon, danger, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { icon: ReactNode; danger?: boolean }) {
  return (
    // rauw: dropdown-menurij (role=menuitem) met eigen rij-layout — links uitgelijnd,
    // font-medium, 40 px hoog; Button centreert en dwingt min-h-11/semibold af.
    <button
      type="button"
      role="menuitem"
      className={cn(
        'flex items-center gap-3 w-full px-3 py-2.5 text-slate-600 rounded-xl transition-colors duration-150 font-medium text-sm',
        danger ? 'hover:text-red-700 hover:bg-red-50/70' : 'hover:text-slate-900 hover:bg-slate-100/70',
        className,
      )}
      {...rest}
    >
      <span className="text-slate-400 shrink-0">{icon}</span>
      <span>{children}</span>
    </button>
  );
}
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
  onInstellingen,
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
  onInstellingen: () => void;
}) {
  const { open, setOpen, wortel } = useDropdown();

  const sluitEn = (fn: () => void) => () => { setOpen(false); fn(); };

  return (
    <div ref={wortel} className="relative">
      {/* rauw: avatar-trigger (goud cirkel + chevron, rounded-full) — geen knop die
          eruitziet als een knop; IconButton/Button hebben geen avatar-vorm. */}
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
          transition={{ duration: DUR.fast, ease: 'easeOut' }}
          style={{ transformOrigin: 'top right' }}
          className="absolute right-0 top-full mt-2 w-64 rounded-2xl bg-surface-white ring-1 ring-hairline shadow-xl p-1.5 z-50"
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
          <MenuItem icon={theme === 'light' ? <Moon size={16} /> : <Sun size={16} />} onClick={sluitEn(onToggleTheme)}>
            {theme === 'light' ? 'Donkere modus' : 'Lichte modus'}
          </MenuItem>
          {pushBeschikbaar && (
            <MenuItem icon={pushEnabled ? <BellOff size={16} /> : <BellRing size={16} />} onClick={sluitEn(onTogglePush)}>
              {pushEnabled ? 'Meldingen uitschakelen' : 'Meldingen inschakelen'}
            </MenuItem>
          )}
          <MenuItem icon={<KeyRound size={16} />} onClick={sluitEn(onChangePassword)}>
            Wachtwoord wijzigen
          </MenuItem>
          <MenuItem icon={<Settings size={16} />} onClick={sluitEn(onInstellingen)}>
            Instellingen
          </MenuItem>
          <MenuItem icon={<LifeBuoy size={16} />} onClick={sluitEn(onProbleem)} aria-haspopup="dialog">
            Meld een probleem
          </MenuItem>
          <MenuItem icon={<LogOut size={16} />} onClick={sluitEn(onLogout)} danger>
            Uitloggen
          </MenuItem>
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}
