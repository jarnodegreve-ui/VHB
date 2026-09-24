import { navigeer, routeUitPad, routeUitUrl } from './router';

/**
 * Terug naar de oorspronkelijke bestemming na het inloggen (tranche 3C, 23-09).
 * Alleen een pad op deze origin dat naar een bekend scherm wijst mag een
 * terugkeerdoel zijn: geen volledige URL, geen `//host` of `/\\host`, geen
 * stuurtekens; de hash valt weg. Wat niet voldoet geeft null, en dan gaat het
 * zoals vroeger naar het dashboard. De rol-guard en de server beslissen daarna
 * nog altijd of je het scherm en het record mag zien.
 */
export function veiligInternPad(invoer: unknown): string | null {
  if (typeof invoer !== 'string' || invoer.length > 2048 || !/^\/(?![/\\])/.test(invoer) || /[\u0000-\u001f\\]/.test(invoer)) return null;
  let u: URL;
  try { u = new URL(invoer, 'https://vhb.invalid'); } catch { return null; }
  if (u.origin !== 'https://vhb.invalid') return null;
  const route = routeUitPad(u.pathname);
  return route && route.view !== 'dashboard' ? u.pathname + u.search : null;
}

/** Het ruwe startdoel keuren en er (zonder extra history-entry) heen gaan; false = geen geldig doel. */
export function naarStartDoel(ruw: string): boolean {
  const doel = veiligInternPad(ruw);
  const route = doel ? routeUitUrl(doel) : null;
  if (!doel || !route) return false;
  // De state blijft: een recordlink van een koude start draagt de lijst
  // eronder (router.ts, zetOuderStap), ook na het inloggen.
  window.history.replaceState(window.history.state, '', doel);
  navigeer(route.view, { params: route.params, replace: true });
  return true;
}
