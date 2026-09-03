import { useEffect, useRef } from 'react';

let teller = 0;

/**
 * Laat een overlay (modal, slide-over, mobiele zijbalk) meedoen met de
 * browser-historiek: bij openen komt er een history-entry bij, de systeem-
 * terugknop of swipe-back sluit de overlay i.p.v. de app te verlaten, en
 * programmatisch sluiten haalt die entry weer weg zodat de historiek schoon
 * blijft. Werkt gestapeld (bevestiging boven een formulier-modal): alleen
 * de bovenste sluit bij één keer terug.
 *
 * De router (src/app/router.ts) negeert deze entries omdat het pad niet
 * verandert.
 */
export function useHistoryDismiss(open: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const idRef = useRef<string>('');

  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    const id = `overlay-${++teller}`;
    idRef.current = id;
    const vorige = window.history.state;
    window.history.pushState({ ...(vorige && typeof vorige === 'object' ? vorige : {}), vhbOverlay: id }, '');
    let doorTerugknop = false;
    const onPop = () => {
      // Eigen entry nog bovenaan? Dan is er iets bóven ons gesloten — blijven.
      if (window.history.state?.vhbOverlay === id) return;
      doorTerugknop = true;
      onCloseRef.current();
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      // Programmatisch gesloten (knop, Escape, opslaan): onze entry weghalen.
      if (!doorTerugknop && window.history.state?.vhbOverlay === id) window.history.back();
    };
  }, [open]);
}
