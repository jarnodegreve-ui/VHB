import { deviceHeaders } from './device';
import { supabase } from './supabase';

/**
 * Lichtgewicht fetch-wrapper voor authenticated calls naar `/api/*`. Pakt
 * automatisch het Supabase access-token uit de huidige sessie, voegt
 * Content-Type toe wanneer er een body is, en parst JSON.
 *
 * Voor de meeste app-state gebruikt `App.tsx` z'n eigen `apiFetch` (omdat die
 * direct toegang heeft tot session-state via React). Deze helper is voor
 * stand-alone componenten zoals modals die hun eigen data ophalen.
 */
export async function apiFetch<T = unknown>(url: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers || {});
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }

  if (supabase) {
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (accessToken && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${accessToken}`);
    }
  }
  for (const [key, value] of Object.entries(deviceHeaders())) {
    if (!headers.has(key)) headers.set(key, value);
  }

  const response = await fetch(url, { ...init, headers });
  if (!response.ok) {
    let detail = '';
    let code = '';
    try {
      const json = await response.json();
      detail = json?.error || json?.details || '';
      code = json?.code || '';
    } catch {
      // negeer parse-fouten — gebruik standaard message
    }
    // Auth-afhandeling gelijk aan App.apiFetch: deze stand-alone helper heeft
    // geen React-state, dus we signaleren een verlopen sessie / gedeactiveerd
    // account / geblokkeerd toestel via window-events die App oppikt (relogin
    // resp. het toestel-wachtscherm) i.p.v. enkel een losse foutmelding.
    if (typeof window !== 'undefined') {
      if (response.status === 401 || (response.status === 403 && /gedeactiveerd/i.test(detail))) {
        window.dispatchEvent(new CustomEvent('vhb-auth-expired'));
      } else if (response.status === 403 && (code === 'device_pending' || code === 'device_unknown' || code === 'device_revoked')) {
        window.dispatchEvent(new CustomEvent('vhb-device-blocked', { detail: { code } }));
      }
    }
    throw new Error(detail || `Er ging iets mis (code ${response.status}). Probeer het opnieuw.`);
  }

  // Voor 204 en lege body
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
