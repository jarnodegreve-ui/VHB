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
    try {
      const json = await response.json();
      detail = json?.error || json?.details || '';
    } catch {
      // negeer parse-fouten — gebruik standaard message
    }
    throw new Error(detail || `Er ging iets mis (code ${response.status}). Probeer het opnieuw.`);
  }

  // Voor 204 en lege body
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
