import { useCallback, useEffect, useMemo, useState } from 'react';
import { ROUTE_EVENT } from './router';
import { meldUrl } from '../lib/lagen';

// Eigen module (tranche 3B, 23-09): router.ts zit in de startbundel en alleen
// Rapporten leest de hele querystring; met de sorteerstap erbij ging index
// anders over het budget van 74 kB.

/**
 * De hele querystring lezen en in één keer bijwerken (replace, behalve met `stap`), voor
 * schermen met meerdere parameters die samen horen: de filters van een
 * rapport (`?van=&tot=&chauffeur=`). Twee losse `useQueryParam`-zetters na
 * elkaar werken ook, maar geven twee history-vervangingen en twee renders met
 * een halve periode ertussen. `null` of '' wist een parameter.
 */
export function useQueryParams(): [URLSearchParams, (wijziging: Record<string, string | null>, opties?: { stap?: string }) => void] {
  const [, force] = useState(0);
  useEffect(() => {
    const sync = () => force((n) => n + 1);
    window.addEventListener('popstate', sync);
    window.addEventListener(ROUTE_EVENT, sync);
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener(ROUTE_EVENT, sync); };
  }, []);
  const zoekdeel = typeof window === 'undefined' ? '' : window.location.search;
  const huidig = useMemo(() => new URLSearchParams(zoekdeel), [zoekdeel]);
  const zet = useCallback((wijziging: Record<string, string | null>, opties: { stap?: string } = {}) => {
    const url = new URL(window.location.href);
    for (const [naam, waarde] of Object.entries(wijziging)) {
      if (waarde) url.searchParams.set(naam, waarde); else url.searchParams.delete(naam);
    }
    const doel = url.pathname + url.search + url.hash;
    // Een stap zonder verschil pusht niets (een klik op dezelfde toestand is geen terugstap waard).
    if (opties.stap !== undefined && doel === window.location.pathname + window.location.search + window.location.hash) return;
    // `stap`: de eerste wijziging van dit soort krijgt één eigen terugstap
    // (pushState, gemerkt), elke volgende vervangt die entry zolang je erop
    // staat. Zo brengt "terug" de toestand van vóór de eerste wijziging terug
    // zonder dat elke klik een entry wordt (rapport: de sortering).
    const opStap = opties.stap !== undefined && (window.history.state as { vhbQueryStap?: unknown } | null)?.vhbQueryStap === opties.stap;
    if (opties.stap !== undefined && !opStap) window.history.pushState({ vhbQueryStap: opties.stap }, '', doel);
    else window.history.replaceState(window.history.state, '', doel);
    meldUrl();
    window.dispatchEvent(new CustomEvent(ROUTE_EVENT));
  }, []);
  return [huidig, zet];
}
