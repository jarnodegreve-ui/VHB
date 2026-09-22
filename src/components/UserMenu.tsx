import { BellOff, BellRing, ChevronDown, KeyRound, LifeBuoy, LogOut, Moon, Settings, Sun } from 'lucide-react';
import { cn } from '../lib/ui';
import { ROL_LABELS } from '../../shared/schemas/constanten';
import type { User } from '../types';
import { useDropdown } from './useDropdown';
import { MenuItem, Popover } from './Popover';

/**
 * Avatar-menu in de topbar (mock Jarno 30-08): goud cirkeltje met initialen
 * + chevron, uitklapbaar naar de accountacties die eerst onderaan de sidebar
 * stonden (thema, pushmeldingen, wachtwoord, probleem melden, uitloggen).
 * De sidebar-voet met het gebruikerskaartje is daarmee vervallen.
 *
 * Popover + MenuItem uit Popover.tsx (ronde 5, F2): sluit op buiten-klik en
 * Escape (useDropdown), pijltjes tussen de items.
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
        className="flex items-center gap-1 rounded-full py-1 pl-1 pr-1.5 hover:bg-surface-soft-hover transition-colors"
      >
        {/* Huisstijl-pairing: op goud altijd carbon-tekst, geen wit. */}
        <span className="w-8 h-8 rounded-full bg-oker-500 text-slate-950 flex items-center justify-center text-xs font-bold select-none">
          {initials}
        </span>
        <ChevronDown size={14} className={cn('text-slate-400 transition-transform duration-base', open && 'rotate-180')} />
      </button>

      <Popover open={open} rol="menu" label="Account" laag="menu" breedte="md">
          {/* Identiteit bovenaan — het kaartje dat eerst in de sidebar-voet stond. */}
          <div className="flex items-center gap-2.5 px-3 py-2.5 mb-1 border-b fine-divider">
            <span className="w-8 h-8 rounded-full bg-oker-500 text-slate-950 flex items-center justify-center text-xs font-bold shrink-0">
              {initials}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-slate-800 truncate leading-tight">{user.name}</span>
              <span className="block text-xs text-slate-500 font-medium">
                {ROL_LABELS[user.role as keyof typeof ROL_LABELS] ?? user.role}
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
          <MenuItem icon={<LogOut size={16} />} onClick={sluitEn(onLogout)} gevaarlijk>
            Uitloggen
          </MenuItem>
      </Popover>
    </div>
  );
}
