import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useReducedMotion } from 'motion/react';
import { DUR } from './motion';

export const VEEG_DREMPEL = 56; // px horizontaal slepen om van maand te wisselen
const DIR_SLOP = 6; // px voor de richting bepaald wordt (axis-lock, zoals usePullToRefresh)
const CAP = 0.4; // meebewegen maximaal 40 % van de breedte
const DEMPING = 0.6; // de inhoud volgt de vinger getemperd
const DOORVEER = 24; // px die de inhoud na loslaten nog doorschiet

/** 1 = volgende (inhoud schuift naar links), −1 = vorige. */
export type VeegRichting = 1 | -1;

export type MaandVeeg = {
  /** Op de container die met de vinger meebeweegt (alleen de maandinhoud, niet de kop). */
  ref: RefObject<HTMLDivElement | null>;
  /** Richting van de laatste wissel, voor `RichtingWissel`/AnimatePresence `custom`. */
  richting: VeegRichting;
  /** Kwam de laatste wissel van een veeg? Dan is de oude inhoud al weggeschoven
   *  en mag de uitgang van de wissel-animatie overgeslagen worden. */
  viaVeeg: boolean;
  /** Voor de pijltjes: zetten de richting en roepen de callback aan. */
  vorige: () => void;
  volgende: () => void;
};

/**
 * Maand-veeg voor maandrasters (golf 4, punt 11). Sleep horizontaal over de
 * container: de inhoud beweegt getemperd mee (cap ±40 % van de breedte);
 * boven de drempel (56 px) veert hij door in de veegrichting (EASE_SPRING,
 * DUR.fast) en wisselt de maand, anders veert hij terug (EASE). De hook
 * schrijft de transform rechtstreeks op het element (geen React-state per
 * frame) en geeft `richting`/`viaVeeg` terug zodat de aanroeper de nieuwe
 * maand met `RichtingWissel` van de juiste kant laat binnenkomen, ook bij
 * de pijltjes (`vorige`/`volgende`).
 *
 * Axis-lock exact zoals usePullToRefresh: pas na 6 px beweging wordt de
 * richting bepaald, en alleen een duidelijk horizontale beweging wordt
 * gekaapt (preventDefault). Verticaal → meteen loslaten, zodat de gewone
 * scroll en de pull-to-refresh op de scroll-container ongemoeid blijven
 * (die laat op haar beurt horizontale bewegingen los). Alleen op touch.
 * Reduced motion: geen meebewegen, wel de actie op de drempel.
 */
export function useMaandVeeg({ onVorige, onVolgende, enabled = true }: {
  onVorige: () => void;
  onVolgende: () => void;
  enabled?: boolean;
}): MaandVeeg {
  const ref = useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotion() ?? false;
  const [wissel, setWissel] = useState<{ richting: VeegRichting; viaVeeg: boolean }>({ richting: 1, viaVeeg: false });
  const callbacks = useRef({ onVorige, onVolgende });
  callbacks.current = { onVorige, onVolgende };

  // Richting en callback in dezelfde tick: React bundelt beide updates, dus
  // de wissel-animatie ziet de nieuwe richting in dezelfde render als de
  // nieuwe maand.
  const wisselNaar = useCallback((richting: VeegRichting, viaVeeg: boolean) => {
    setWissel({ richting, viaVeeg });
    if (richting === 1) callbacks.current.onVolgende();
    else callbacks.current.onVorige();
  }, []);
  const vorige = useCallback(() => wisselNaar(-1, false), [wisselNaar]);
  const volgende = useCallback(() => wisselNaar(1, false), [wisselNaar]);

  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el || typeof window === 'undefined' || !('ontouchstart' in window)) return;

    let startX = 0;
    let startY = 0;
    let tracking = false; // vinger staat erop, richting nog niet bepaald
    let slepen = false; // horizontale beweging bevestigd → wij kapen
    let offset = 0; // huidige (getemperde) verschuiving in px
    let dx = 0;
    let timer: number | undefined;

    const paint = (px: number, transitie = 'none') => {
      el.style.transition = transitie;
      el.style.transform = px ? `translateX(${px}px)` : '';
      el.style.opacity = '';
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || timer !== undefined) {
        tracking = false;
        return;
      }
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      tracking = true;
      slepen = false;
      dx = 0;
    };

    const onMove = (e: TouchEvent) => {
      if (!tracking) return;
      dx = e.touches[0].clientX - startX;
      const dy = e.touches[0].clientY - startY;
      if (!slepen) {
        // Axis-lock: pas kapen als de beweging duidelijk horizontaal is.
        // Verticaal (scrollen, pull-to-refresh) → loslaten, geen kaping.
        if (Math.abs(dx) < DIR_SLOP && Math.abs(dy) < DIR_SLOP) return;
        if (Math.abs(dy) >= Math.abs(dx)) {
          tracking = false;
          return;
        }
        slepen = true;
      }
      const cap = el.clientWidth * CAP;
      offset = Math.sign(dx) * Math.min(cap, Math.abs(dx) * DEMPING);
      if (!reduced) paint(offset);
      if (e.cancelable) e.preventDefault();
    };

    const onEnd = () => {
      if (!slepen) {
        tracking = false;
        return;
      }
      tracking = false;
      slepen = false;
      const richting: VeegRichting = dx < 0 ? 1 : -1;
      if (Math.abs(dx) < VEEG_DREMPEL) {
        // Terugveren: ease uit, niets dat nazwaait.
        paint(0, 'transform var(--duration-fast) var(--ease-standard)');
        offset = 0;
        return;
      }
      if (reduced) {
        offset = 0;
        wisselNaar(richting, true);
        return;
      }
      // Doorveren voorbij de loslaatpositie en vervagen; daarna wisselt de
      // maand en komt de nieuwe inhoud via RichtingWissel van de andere kant.
      el.style.transition = 'transform var(--duration-fast) var(--ease-spring), opacity var(--duration-fast) var(--ease-standard)';
      el.style.transform = `translateX(${offset - richting * DOORVEER}px)`;
      el.style.opacity = '0';
      timer = window.setTimeout(() => {
        timer = undefined;
        offset = 0;
        paint(0);
        wisselNaar(richting, true);
      }, DUR.fast * 1000);
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd, { passive: true });
    el.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      window.clearTimeout(timer);
      el.style.transform = '';
      el.style.transition = '';
      el.style.opacity = '';
    };
  }, [enabled, reduced, wisselNaar]);

  return { ref, richting: wissel.richting, viaVeeg: wissel.viaVeeg, vorige, volgende };
}
