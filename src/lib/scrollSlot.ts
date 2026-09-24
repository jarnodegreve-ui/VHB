/**
 * Eén scroll-lock voor het hele portaal (hotfix 24-09).
 *
 * Modal, SlideOver, Sheet en de mobiele zijbalk zetten elk zelf
 * `overflow: hidden` op <body> en op de scroll-root ([data-scroll-root] in
 * App.tsx), onthielden "de vorige waarde" en zetten die bij het sluiten
 * terug. Sluiten twee lagen in dezelfde commit (bevestiging of geschiedenis
 * boven een zijpaneel, "Niet bewaren", Escape die beide sluit), dan ruimt
 * React eerst de ouder op (zet '' terug) en daarna het kind, dat bij het
 * openen 'hidden' had onthouden en dát terugzette: de pagina bleef op slot
 * tot een herlaad, terwijl er geen enkele overlay meer open stond.
 *
 * Nu houdt dit ene mechanisme bij wie een lock heeft (een token per
 * vergrendeling, dus ook een dubbele effect-run in Strict Mode telt juist).
 * De eerste lock onthoudt de oorspronkelijke waarden, pas de láátste
 * vrijgave zet ze terug, in welke volgorde de lagen ook sluiten. De actieve
 * eigenaars staan op <body data-scroll-locks> voor diagnose.
 */

type Oorspronkelijk = { body: string; root: HTMLElement | null; rootWaarde: string };

const actief = new Map<symbol, string>();
let oorspronkelijk: Oorspronkelijk | null = null;

const scrollRoot = () => document.querySelector<HTMLElement>('[data-scroll-root]');

function schrijfDiagnose() {
  if (actief.size === 0) delete document.body.dataset.scrollLocks;
  else document.body.dataset.scrollLocks = [...actief.values()].join(' ');
}

/** Zet de scroll-lock voor `eigenaar` (bv. 'modal', 'slideover') en geeft de
 *  vrijgave terug; die mag vaker aangeroepen worden, alleen de eerste telt. */
export function vergrendelScroll(eigenaar: string): () => void {
  if (typeof document === 'undefined') return () => {};
  const token = Symbol(eigenaar);
  if (actief.size === 0) {
    const root = scrollRoot();
    oorspronkelijk = { body: document.body.style.overflow, root, rootWaarde: root?.style.overflow ?? '' };
  }
  actief.set(token, eigenaar);
  document.body.style.overflow = 'hidden';
  // De scroll-root opnieuw zoeken: na een schermwissel kan het een ander
  // element zijn dan bij de eerste lock.
  const root = scrollRoot();
  if (root) root.style.overflow = 'hidden';
  schrijfDiagnose();
  return () => {
    if (!actief.delete(token)) return;
    if (actief.size === 0 && oorspronkelijk) {
      document.body.style.overflow = oorspronkelijk.body;
      if (oorspronkelijk.root) oorspronkelijk.root.style.overflow = oorspronkelijk.rootWaarde;
      const nu = scrollRoot();
      if (nu && nu !== oorspronkelijk.root) nu.style.overflow = '';
      oorspronkelijk = null;
    }
    schrijfDiagnose();
  };
}

/** Voor tests en diagnose: de eigenaars van de actieve locks. */
export const actieveScrollLocks = (): string[] => [...actief.values()];
