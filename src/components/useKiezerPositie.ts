import { useLayoutEffect, useRef, useState } from 'react';

const MOBIEL_BREEDTE = 640;
const RAND = 8;
const AFSTAND = 6;

type Positie = { top: number; left: number; boven: boolean; gemeten: boolean };

/** Houd de dag- en maandkiezer bij hun veld, ook wanneer een open scherm vouwt. */
export function useKiezerPositie(open: boolean, periode: string) {
  const wortelRef = useRef<HTMLDivElement>(null);
  const dialoogRef = useRef<HTMLDivElement>(null);
  const [mobiel, setMobiel] = useState(false);
  const [positie, setPositie] = useState<Positie | null>(null);

  // Geef de popover bij het invoegen al de plek van het veld. De cursor
  // krijgt pas focus nadat de echte afmetingen voor de eerste keer zijn gemeten.
  function bereidPlaatsVoor() {
    const smal = window.innerWidth < MOBIEL_BREEDTE;
    const r = wortelRef.current?.getBoundingClientRect();
    setMobiel(smal);
    setPositie(!smal && r
      ? { top: r.bottom + AFSTAND, left: Math.max(RAND, r.left), boven: false, gemeten: false }
      : null);
  }

  useLayoutEffect(() => {
    if (!open) return;
    const plaats = () => {
      if (mobiel !== (window.innerWidth < MOBIEL_BREEDTE)) {
        bereidPlaatsVoor();
        return; // De nieuwe layout meten zodra die in de DOM staat.
      }
      const d = dialoogRef.current;
      const r = wortelRef.current?.getBoundingClientRect();
      if (mobiel || !d || !r) return;
      const laagsteTop = window.innerHeight - RAND - d.offsetHeight;
      const bovenVeld = r.top - AFSTAND - d.offsetHeight;
      const onderVeld = r.bottom + AFSTAND;
      const boven = onderVeld > laagsteTop && bovenVeld >= RAND;
      const top = Math.max(RAND, Math.min(boven ? bovenVeld : onderVeld, laagsteTop));
      const left = Math.max(RAND, Math.min(r.left, window.innerWidth - d.offsetWidth - RAND));
      setPositie(p => p?.gemeten && p.top === top && p.left === left && p.boven === boven
        ? p : { top, left, boven, gemeten: true });
    };
    plaats();
    window.addEventListener('resize', plaats);
    if (!mobiel) window.addEventListener('scroll', plaats, true);
    return () => {
      window.removeEventListener('resize', plaats);
      window.removeEventListener('scroll', plaats, true);
    };
  }, [open, mobiel, periode]);

  return { wortelRef, dialoogRef, mobiel, positie, bereidPlaatsVoor };
}
