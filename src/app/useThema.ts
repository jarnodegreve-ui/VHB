import { useEffect, useRef, useState } from 'react';
import type { User } from '../types';
import { applyThemeColorMeta, onthoudEffectiefThema } from '../lib/ui';

/** Wat de gebruiker koos: `auto` volgt de instelling van het toestel
 *  (prefers-color-scheme), `light`/`dark` staan vast. Geen keuze = de
 *  rol-standaard hieronder. Bewaard als `vhb-theme`. */
export type ThemaVoorkeur = 'auto' | 'light' | 'dark';

const SYSTEEM_DONKER = '(prefers-color-scheme: dark)';
const systeemDonker = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(SYSTEEM_DONKER).matches;
const leesVoorkeur = (waarde: string | null): ThemaVoorkeur | null => (waarde === 'auto' || waarde === 'light' || waarde === 'dark' ? waarde : null);

/**
 * Thema van de app (licht of donker): de eigen keuze uit localStorage, anders
 * de rol-standaard (planner en admin donker, de rest licht). Sinds de
 * Apple-review van 17-10 (nr. 8) kent de keuze drie standen in Instellingen ›
 * Weergave: Automatisch (volgt het toestel, ook als dat 's avonds naar donker
 * wisselt), Licht en Donker. De rol-standaard bleef zoals hij was (04-06:
 * standaard licht op vraag van Jarno; staf donker). Het accountmenu heeft
 * geen eigen schakelaar meer.
 *
 * Het bootscript in index.html zet de klasse al vóór de eerste paint (ook
 * voor `auto`); deze hook neemt het over zodra React draait.
 */
export function useThema(currentUser: User | null) {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [themaVoorkeur, setThemaVoorkeur] = useState<ThemaVoorkeur | null>(null);
  // Heeft de gebruiker ooit zelf een thema gekozen? Zo niet, mag de
  // rol-standaard (dispatch: planner = donker) hem invullen.
  const themaGekozenRef = useRef(false);

  const pasToe = (donker: boolean) => {
    setTheme(donker ? 'dark' : 'light');
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('dark', donker);
    applyThemeColorMeta(donker);
    onthoudEffectiefThema(donker ? 'dark' : 'light');
  };

  useEffect(() => {
    let opgeslagen: string | null = null;
    let effectief: string | null = null;
    try {
      opgeslagen = typeof window !== 'undefined' ? window.localStorage.getItem('vhb-theme') : null;
      effectief = typeof window !== 'undefined' ? window.localStorage.getItem('vhb-theme-effectief') : null;
    } catch {
      // localStorage geblokkeerd (privacy-modus) — val terug op licht.
    }
    const voorkeur = leesVoorkeur(opgeslagen);
    themaGekozenRef.current = voorkeur !== null;
    setThemaVoorkeur(voorkeur);
    // Zonder eigen keuze: wat er de vorige keer effectief stond (de
    // rol-standaard van planner/admin = donker), zoals het bootscript.
    pasToe(voorkeur === 'auto' ? systeemDonker() : voorkeur ? voorkeur === 'dark' : effectief === 'dark');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Dispatch: zonder eigen keuze krijgt een planner/admin de donkere
  // control-room als standaard; chauffeurs blijven licht. Niet persisteren.
  useEffect(() => {
    if (themaGekozenRef.current || !currentUser) return;
    pasToe(currentUser.role === 'planner' || currentUser.role === 'admin');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  // Automatisch: volg het toestel terwijl de app openstaat.
  useEffect(() => {
    if (themaVoorkeur !== 'auto' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(SYSTEEM_DONKER);
    const volg = () => pasToe(media.matches);
    media.addEventListener('change', volg);
    return () => media.removeEventListener('change', volg);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themaVoorkeur]);

  const kiesThema = (voorkeur: ThemaVoorkeur) => {
    themaGekozenRef.current = true;
    setThemaVoorkeur(voorkeur);
    try {
      window.localStorage.setItem('vhb-theme', voorkeur);
    } catch {
      // opslag geblokkeerd — thema geldt dan alleen voor deze sessie
    }
    pasToe(voorkeur === 'auto' ? systeemDonker() : voorkeur === 'dark');
  };

  return { theme, themaVoorkeur, kiesThema };
}
