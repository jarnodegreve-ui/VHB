import { useEffect, useState } from 'react';

/**
 * Hoogte (px) die het software-toetsenbord onderaan het scherm inneemt.
 *
 * iOS krimpt de layout-viewport níet als het toetsenbord opkomt (ook `dvh`
 * niet) en kan een `position: fixed`-element niet in beeld scrollen: het
 * onderste deel van een gecentreerde modal — vaak net de opslaan-knop —
 * verdwijnt dan achter het toetsenbord. visualViewport vertelt wél hoeveel
 * ruimte er echt over is; die waarde gebruiken we als extra bodem-padding.
 *
 * Geeft 0 op desktop, zonder visualViewport-ondersteuning en bij een
 * gesloten toetsenbord.
 */
export function useKeyboardInset(active = true): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const vv = typeof window !== 'undefined' ? window.visualViewport : undefined;
    if (!active || !vv) {
      setInset(0);
      return;
    }
    const update = () => {
      // Wat er onderaan wegvalt: totale hoogte − (zichtbare hoogte + offset).
      const hidden = window.innerHeight - vv.height - vv.offsetTop;
      // Kleine afwijkingen (adresbalk, afrondingen) negeren.
      setInset(hidden > 80 ? Math.round(hidden) : 0);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, [active]);

  return inset;
}
