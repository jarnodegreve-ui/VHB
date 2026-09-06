import { flushSync } from 'react-dom';

/**
 * View Transitions (document.startViewTransition) — de bewegingstaal tussen
 * schermen en tussen lijst en detail. Twee vormen:
 *
 * 1. `metOvergang(update)`: een route-wissel. De schil (sidebar, topbar,
 *    dock) staat stil; alleen `#hoofdinhoud` cross-fadet met een kleine
 *    verticale verschuiving (CSS in index.css, `::view-transition-*`).
 * 2. `kiesRecord(naar, van, update)`: gedeelde-element-overgang in een
 *    master-detail. De titel van de aangeklikte rij en de titel van het
 *    DetailPaneel delen kort dezelfde `view-transition-name`, zodat de
 *    titel van de lijst naar het paneel "schuift" (en de vorige terug).
 *    Rijen krijgen daarvoor `data-vt-record={id}` op hun titel-element;
 *    het paneel zet `recordNaam(sleutel)` op zijn h2 (DetailPaneel.tsx).
 *
 * Zonder browserondersteuning, bij `prefers-reduced-motion` of als er al een
 * overgang loopt, gebeurt de update gewoon meteen. `flushSync` zorgt dat
 * React de nieuwe staat synchroon in de DOM zet vóór de nieuwe snapshot.
 */
type StartViewTransition = (cb: () => void | Promise<void>) => { finished: Promise<void> };

function starter(): StartViewTransition | null {
  if (typeof document === 'undefined') return null;
  const d = document as Document & { startViewTransition?: StartViewTransition };
  if (typeof d.startViewTransition !== 'function') return null;
  if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return null;
  return d.startViewTransition.bind(d);
}

let bezig = false;

/** Soort overgang als klasse op <html>, zodat de CSS de juiste keyframes kiest. */
const markeer = (soort: 'vt-route' | 'vt-record') => {
  document.documentElement.classList.add(soort);
  return () => document.documentElement.classList.remove(soort);
};

/** Route-wissel met cross-fade van de inhoud; valt terug op een directe update. */
export function metOvergang(update: () => void) {
  const start = starter();
  if (!start || bezig) { update(); return; }
  bezig = true;
  const klaar = markeer('vt-route');
  let t: { finished: Promise<void> };
  try {
    t = start(() => { flushSync(update); });
  } catch {
    bezig = false;
    klaar();
    update();
    return;
  }
  t.finished.finally(() => { bezig = false; klaar(); });
}

/** Geldige CSS-ident uit een record-id (view-transition-name mag geen spaties/punten). */
export const recordNaam = (id: string) => `vt-record-${String(id).replace(/[^a-zA-Z0-9_-]/g, '_')}`;

const rijTitel = (id: string) => {
  if (typeof document === 'undefined' || typeof CSS === 'undefined' || typeof CSS.escape !== 'function') return null;
  return document.querySelector<HTMLElement>(`[data-vt-record="${CSS.escape(id)}"]`);
};
const zetNaam = (el: HTMLElement | null, naam: string) => { if (el) el.style.setProperty('view-transition-name', naam); };

/**
 * Een ander record kiezen in een master-detail. Alleen als lijst en paneel
 * naast elkaar staan (lg+): op mobiel opent de keuze een SlideOver met zijn
 * eigen inschuif-animatie, en een gedeeld element zou daar tegenin werken.
 */
export function kiesRecord(naar: string, van: string | null, update: () => void) {
  const start = starter();
  const inline = typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 1024px)').matches;
  if (!start || bezig || !inline || naar === van) { update(); return; }
  const rijNaar = rijTitel(naar);
  if (!rijNaar) { update(); return; }
  bezig = true;
  const klaar = markeer('vt-record');
  // Oude staat: de rij van `naar` draagt de naam; het paneel draagt `van`.
  zetNaam(rijNaar, recordNaam(naar));
  let rijVan: HTMLElement | null = null;
  let t: { finished: Promise<void> };
  try {
    t = start(() => {
      flushSync(update);
      // Nieuwe staat: het paneel draagt nu `naar` (React), dus de rij laat
      // de naam los (dubbele namen slaan de overgang over); de rij van
      // `van` neemt de naam van het oude paneel over voor de weg terug.
      rijNaar.style.removeProperty('view-transition-name');
      if (van) { rijVan = rijTitel(van); zetNaam(rijVan, recordNaam(van)); }
    });
  } catch {
    rijNaar.style.removeProperty('view-transition-name');
    bezig = false;
    klaar();
    update();
    return;
  }
  t.finished.finally(() => {
    bezig = false;
    klaar();
    rijNaar.style.removeProperty('view-transition-name');
    rijVan?.style.removeProperty('view-transition-name');
  });
}
