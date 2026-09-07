import { useEffect, useRef } from 'react';

/**
 * Automatisch afmelden op een gedeeld toestel (verbeterronde 07-09, nr. 12).
 * Schakelaar per toestel (localStorage), zodat de tablet in het lokaal na
 * een half uur zonder aanraking terug naar het loginscherm gaat en de
 * telefoon van een chauffeur er nooit last van heeft.
 */
export const GEDEELD_TOESTEL_KEY = 'vhb-gedeeld-toestel';
export const GEDEELD_TOESTEL_EVENT = 'vhb-gedeeld-toestel';
export const INACTIVITEIT_MS = 30 * 60 * 1000;

export const isGedeeldToestel = (): boolean => {
  try {
    return window.localStorage.getItem(GEDEELD_TOESTEL_KEY) === '1';
  } catch {
    return false;
  }
};

export const zetGedeeldToestel = (aan: boolean): void => {
  try {
    if (aan) window.localStorage.setItem(GEDEELD_TOESTEL_KEY, '1');
    else window.localStorage.removeItem(GEDEELD_TOESTEL_KEY);
  } catch {
    // privémodus: dan geen instelling
  }
  window.dispatchEvent(new CustomEvent(GEDEELD_TOESTEL_EVENT, { detail: { aan } }));
};

const ACTIVITEIT: Array<keyof WindowEventMap> = ['pointerdown', 'keydown', 'touchstart', 'scroll'];

/**
 * Roept `onUitlog` aan na `ms` zonder gebruikersactiviteit. Werkt ook als de
 * tab in de achtergrond stond: bij terugkomst wordt de verstreken tijd
 * vergeleken met de laatste activiteit (timers staan stil in een slapende
 * PWA). Alleen actief wanneer `enabled`.
 */
export function useInactiviteitsUitlog(enabled: boolean, onUitlog: () => void, ms = INACTIVITEIT_MS): void {
  const cbRef = useRef(onUitlog);
  cbRef.current = onUitlog;
  useEffect(() => {
    if (!enabled) return;
    let laatste = Date.now();
    let timer: number | null = null;
    let gevuurd = false;
    const vuur = () => {
      if (gevuurd) return;
      gevuurd = true;
      cbRef.current();
    };
    const plan = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (Date.now() - laatste >= ms) vuur();
        else plan();
      }, Math.max(1000, ms - (Date.now() - laatste)));
    };
    const activiteit = () => {
      if (document.visibilityState === 'hidden') return;
      // Terug uit de achtergrond na een lange stilte: meteen afmelden.
      if (Date.now() - laatste >= ms) { vuur(); return; }
      laatste = Date.now();
      plan();
    };
    for (const e of ACTIVITEIT) window.addEventListener(e, activiteit, { passive: true });
    document.addEventListener('visibilitychange', activiteit);
    plan();
    return () => {
      for (const e of ACTIVITEIT) window.removeEventListener(e, activiteit);
      document.removeEventListener('visibilitychange', activiteit);
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [enabled, ms]);
}
