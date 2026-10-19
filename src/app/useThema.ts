import { useEffect, useRef, useState } from 'react';
import type { User } from '../types';
import { applyThemeColorMeta, onthoudEffectiefThema } from '../lib/ui';

/**
 * Thema van de app (licht of donker): de eigen keuze uit localStorage, anders
 * de rol-standaard (planner en admin donker, de rest licht), en de schakelaar.
 * Stond tot 21-09 verspreid over App.tsx (state, twee effects, de toggle);
 * de code is ongewijzigd verplaatst (G1).
 *
 * Het bootscript in index.html zet de klasse al vóór de eerste paint; deze
 * hook neemt het over zodra React draait.
 */
export function useThema(currentUser: User | null) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  // Initialize theme from localStorage. Eerste-bezoek default = LIGHT
  // (geen system-preference fallback meer — gebruikers die dark willen
  // klikken zelf de toggle).
  // themaGekozenRef: heeft de gebruiker ooit zelf een thema gekozen? Zo niet,
  // mag de rol-standaard hieronder (dispatch: planner = donker) hem invullen.
  const themaGekozenRef = useRef(false);
  useEffect(() => {
    let stored: string | null = null;
    let effectief: string | null = null;
    try {
      stored = typeof window !== 'undefined' ? window.localStorage.getItem('vhb-theme') : null;
      effectief = typeof window !== 'undefined' ? window.localStorage.getItem('vhb-theme-effectief') : null;
    } catch {
      // localStorage geblokkeerd (privacy-modus) — val terug op licht.
    }
    themaGekozenRef.current = stored === 'dark' || stored === 'light';
    // Zonder expliciete keuze: begin met wat er de vorige keer effectief
    // stond (de rol-standaard van planner/admin = donker). Het bootscript in
    // index.html zette dat al vóór de eerste paint; hier 'light' forceren
    // haalde de dark-klasse weer weg tot het profiel binnen was — vandaar de
    // lichte flits van skeleton naar dashboard (Jarno 04-09).
    const initial: 'light' | 'dark' = stored === 'dark' || stored === 'light' ? stored : effectief === 'dark' ? 'dark' : 'light';
    setTheme(initial);
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', initial === 'dark');
      applyThemeColorMeta(initial === 'dark');
      onthoudEffectiefThema(initial);
    }
  }, []);

  // Dispatch: zonder eigen keuze krijgt een planner/admin de donkere
  // control-room als standaard; chauffeurs blijven licht. Niet persisteren —
  // pas de toggle maakt er een eigen keuze van (en die wint dan altijd).
  useEffect(() => {
    if (themaGekozenRef.current || !currentUser) return;
    const donker = currentUser.role === 'planner' || currentUser.role === 'admin';
    setTheme(donker ? 'dark' : 'light');
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', donker);
      applyThemeColorMeta(donker);
      onthoudEffectiefThema(donker ? 'dark' : 'light');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  const toggleTheme = () => {
    setTheme((current) => {
      const next = current === 'light' ? 'dark' : 'light';
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem('vhb-theme', next);
        } catch {
          // opslag geblokkeerd — thema geldt dan alleen voor deze sessie
        }
        document.documentElement.classList.toggle('dark', next === 'dark');
        applyThemeColorMeta(next === 'dark');
        onthoudEffectiefThema(next);
      }
      return next;
    });
  };

  return { theme, toggleTheme };
}
