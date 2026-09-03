import { useCallback, useEffect, useState } from 'react';
import type { View } from '../types';
import { ALLE_VIEWS, ROUTES, padVan, routeVanPad } from './routes';

/**
 * Lichtgewicht router op de History API — geen library, geen <Route>-boom.
 * "Waar ben ik" is de URL (`/verlof`, `/beheer/gebruikers/…`), niet langer
 * een useState in App.tsx. Daardoor werken de systeem-terugknop, swipe-back,
 * deelbare links en een refresh op dezelfde plek.
 *
 * - `useRoute()` geeft { view, params, navigeer }.
 * - `navigeer(view, { params, replace })` pusht een history-entry.
 * - `?view=x` (oude deeplinks uit push-meldingen/Telegram) wordt bij het
 *   opstarten omgezet naar het pad.
 * - Landt de PWA op `/` (start_url), dan herstellen we de laatst geopende
 *   pagina uit localStorage — zoals de app dat altijd deed.
 */
const OPGESLAGEN_VIEW = 'vhb-current-view';
const ROUTE_EVENT = 'vhb-route';

export type Route = { view: View; params: string[] };

/** Zet een pad om naar view + parameters; onbekend pad → null. */
export function routeUitPad(pathname: string): Route | null {
  const segmenten = pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean).map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  });
  // Langste bekende prefix wint: 'beheer/gebruikers' vóór 'beheer'.
  for (let n = segmenten.length; n >= 0; n--) {
    const r = routeVanPad(segmenten.slice(0, n).join('/'));
    if (r) return { view: r.view, params: segmenten.slice(n) };
  }
  return null;
}

/** View uit een volledige URL of alleen een pad/zoekdeel — voor deeplinks. */
export function routeUitUrl(url: string): Route | null {
  let u: URL;
  try { u = new URL(url, typeof window !== 'undefined' ? window.location.origin : 'http://localhost'); } catch { return null; }
  const v = u.searchParams.get('view');
  if (v && (ALLE_VIEWS as readonly string[]).includes(v)) return { view: v as View, params: [] };
  return routeUitPad(u.pathname);
}

const lees = (): Route => {
  if (typeof window === 'undefined') return { view: 'dashboard', params: [] };
  return routeUitPad(window.location.pathname) ?? { view: 'dashboard', params: [] };
};

const onthoud = (view: View) => {
  try { window.localStorage.setItem(OPGESLAGEN_VIEW, view); } catch { /* privémodus */ }
};

/** Eénmalige normalisatie bij het opstarten (vóór de eerste render). */
let genormaliseerd = false;
function normaliseerStartUrl() {
  if (genormaliseerd || typeof window === 'undefined') return;
  genormaliseerd = true;
  const { pathname, search, hash } = window.location;
  const params = new URLSearchParams(search);
  // Print-modus (?print-driver=…) en andere query's laten we staan.
  const oudeView = params.get('view');
  if (oudeView && (ALLE_VIEWS as readonly string[]).includes(oudeView)) {
    params.delete('view');
    const rest = params.toString();
    window.history.replaceState(null, '', padVan(oudeView as View) + (rest ? `?${rest}` : '') + hash);
    return;
  }
  if (pathname === '/' || pathname === '') {
    let opgeslagen: string | null = null;
    try { opgeslagen = window.localStorage.getItem(OPGESLAGEN_VIEW); } catch { /* privémodus */ }
    if (opgeslagen && opgeslagen !== 'dashboard' && (ALLE_VIEWS as readonly string[]).includes(opgeslagen)) {
      window.history.replaceState(null, '', padVan(opgeslagen as View) + search + hash);
    }
    return;
  }
  if (!routeUitPad(pathname)) {
    // Onbekend pad (typefout, oude link): naar het dashboard zonder entry.
    window.history.replaceState(null, '', '/' + search + hash);
  }
}

/** Navigeren buiten React om (service-worker-bericht, tests). */
export function navigeer(view: View, opts: { params?: readonly string[]; replace?: boolean } = {}) {
  if (typeof window === 'undefined') return;
  const pad = padVan(view, opts.params ?? []);
  const zelfde = window.location.pathname === pad;
  if (!zelfde) {
    if (opts.replace) window.history.replaceState(null, '', pad);
    else window.history.pushState(null, '', pad);
  }
  onthoud(view);
  window.dispatchEvent(new CustomEvent(ROUTE_EVENT));
}

export function useRoute() {
  const [route, setRoute] = useState<Route>(() => { normaliseerStartUrl(); return lees(); });

  useEffect(() => {
    const sync = () => {
      const volgende = lees();
      setRoute((huidig) => (huidig.view === volgende.view && huidig.params.join('/') === volgende.params.join('/') ? huidig : volgende));
    };
    // popstate: terugknop/swipe-back. Overlays (Modal/SlideOver) pushen eigen
    // entries zonder padwijziging — `sync` vergelijkt en doet dan niets.
    window.addEventListener('popstate', sync);
    window.addEventListener(ROUTE_EVENT, sync);
    return () => {
      window.removeEventListener('popstate', sync);
      window.removeEventListener(ROUTE_EVENT, sync);
    };
  }, []);

  useEffect(() => { onthoud(route.view); }, [route.view]);

  const navigeerNaar = useCallback((view: View, opts?: { params?: readonly string[]; replace?: boolean }) => navigeer(view, opts), []);
  return { view: route.view, params: route.params, navigeer: navigeerNaar };
}

/**
 * Eén route-parameter (positioneel segment na het pad) lezen én schrijven —
 * bv. de maand op /openstaande-diensten/2026-10. Schrijven vervangt de
 * history-entry (geen extra terugstap per maandwissel). `null` wist hem.
 */
export function useRouteParam(index = 0): [string | null, (waarde: string | null) => void] {
  const { view, params, navigeer } = useRoute();
  const huidig = params[index] ?? null;
  const zet = useCallback((waarde: string | null) => {
    const volgende = [...params];
    if (waarde == null) volgende.splice(index);
    else volgende[index] = waarde;
    navigeer(view, { params: volgende, replace: true });
  }, [index, navigeer, params, view]);
  return [huidig, zet];
}

/** Querystring-parameter (?zoek=jan) lezen/schrijven, replace-only. */
export function useQueryParam(naam: string): [string, (waarde: string) => void] {
  const [, force] = useState(0);
  useEffect(() => {
    const sync = () => force((n) => n + 1);
    window.addEventListener('popstate', sync);
    window.addEventListener(ROUTE_EVENT, sync);
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener(ROUTE_EVENT, sync); };
  }, []);
  const huidig = typeof window === 'undefined' ? '' : (new URLSearchParams(window.location.search).get(naam) ?? '');
  const zet = useCallback((waarde: string) => {
    const url = new URL(window.location.href);
    if (waarde) url.searchParams.set(naam, waarde); else url.searchParams.delete(naam);
    window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    window.dispatchEvent(new CustomEvent(ROUTE_EVENT));
  }, [naam]);
  return [huidig, zet];
}

/** Routes die in het command palette horen (alles behalve verborgen). */
export const paletteRoutes = () => ROUTES.filter((r) => !r.verborgen);
