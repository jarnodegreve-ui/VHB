import { useEffect, useRef } from 'react';

let teller = 0;
/** Ids van overlays die nú open zijn — een entry met een ander id is een wees. */
const levend = new Set<string>();
/** Ids waarvan de opruim-`back()` al is afgevuurd maar nog niet is afgewikkeld. */
const onderweg = new Set<string>();
/** URL-correcties voor een uitgestelde back() die nog moet aankomen. */
const herstelVoorRoute = new Set<() => void>();

/** De router doet dit vóór hij een popstate leest. Een later geregistreerde
 * capture-listener op Window komt in Chromium niet vóór eerdere listeners. */
export function herstelOverlayUrl() {
  for (const herstel of herstelVoorRoute) herstel();
}

/**
 * Laat een overlay (modal, slide-over, mobiele zijbalk, actiemenu) meedoen met
 * de browser-historiek: bij openen komt er een history-entry bij, de systeem-
 * terugknop of swipe-back sluit de overlay i.p.v. de app te verlaten, en
 * programmatisch sluiten haalt die entry weer weg zodat de historiek schoon
 * blijft. Werkt gestapeld (bevestiging boven een formulier-modal): alleen
 * de bovenste sluit bij één keer terug.
 *
 * Sluit een overlay in dezelfde commit als een andere opent (menu-item dat een
 * modal opent), dan mag de opruim-`back()` van de eerste de entry van de
 * tweede niet wegnemen: het opruimen wordt daarom een taak uitgesteld en
 * overgeslagen als er intussen iets anders bovenop staat; de nieuwe overlay
 * neemt op zijn beurt een verweesde entry over (replaceState) i.p.v. er een
 * tweede bovenop te zetten. Zo blijft één terugknop = één overlay.
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
    levend.add(id);
    const urlBijOpenen = window.location.pathname + window.location.search + window.location.hash;
    const vorige = window.history.state;
    const basis = vorige && typeof vorige === 'object' ? vorige : {};
    const bovenste = (basis as { vhbOverlay?: unknown }).vhbOverlay;
    // Wees-entry van een net gesloten overlay (zelfde commit): overnemen —
    // tenzij de back() ervan al loopt, dan zou de traversal ónze entry raken.
    const wees = typeof bovenste === 'string' && !levend.has(bovenste) && !onderweg.has(bovenste);
    // Bij overname (ander paneel of herladen) blijft ook de URL onder de
    // overlay dezelfde. Die kan een ouder record bevatten dan de huidige URL.
    const urlOnderOverlay = wees && typeof basis.vhbOverlayTerug === 'string' ? basis.vhbOverlayTerug : urlBijOpenen;
    const staat = { ...basis, vhbOverlay: id, vhbOverlayTerug: urlOnderOverlay };
    if (wees) window.history.replaceState(staat, '');
    else window.history.pushState(staat, '');
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
      levend.delete(id);
      if (doorTerugknop) return;
      // Programmatisch gesloten (knop, Escape, opslaan): onze entry weghalen —
      // uitgesteld, zodat een overlay die in dezelfde commit opent eerst onze
      // entry kan overnemen; staat er dan iets anders bovenaan, niets doen.
      window.setTimeout(() => {
        // Een echte paginawissel verwijdert de overlay-id in de router.
        // Een record sluiten of wisselen behoudt hem, ook al verandert het
        // pad: de entry behoort dan nog steeds aan dit paneel.
        if (window.history.state?.vhbOverlay !== id) return;
        const urlBijSluiten = window.location.pathname + window.location.search + window.location.hash;
        onderweg.add(id);
        const herstel = () => {
          // Recordselectie verving de lijst-URL vóór het paneel opende.
          // Na back() staat die oude detail-URL dus opnieuw bovenaan. Wis
          // dat record vóór de router zijn popstate verwerkt, zodat een
          // gesloten paneel niet meteen opnieuw opent. De router roept dit
          // expliciet vóór het lezen aan: listener-volgorde verschilt per browser.
          const urlNaTerug = window.location.pathname + window.location.search + window.location.hash;
          if (urlBijSluiten !== urlOnderOverlay && urlNaTerug === urlOnderOverlay) {
            window.history.replaceState(window.history.state, '', urlBijSluiten);
          }
        };
        herstelVoorRoute.add(herstel);
        window.addEventListener('popstate', () => {
          herstel();
          herstelVoorRoute.delete(herstel);
          onderweg.delete(id);
        }, { once: true });
        window.history.back();
      }, 0);
    };
  }, [open]);
}
