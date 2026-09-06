import { deviceHeaders } from './device';
import { markeerEigenSchrijfactie } from './liveSignaal';
import { supabase } from './supabase';

/**
 * Dé geauthenticeerde fetch voor `/api/*` — zelfde signatuur als `fetch`
 * (plus een optioneel `accessToken` in init), geeft de Response terug. Eén
 * implementatie i.p.v. drie: App.tsx had een eigen apiFetch (retry + stille
 * token-refresh), hier stond een JSON-variant met window-events, en ±50 call
 * sites deden een rauwe fetch met getSupabaseAuthHeaders() — zonder retry en
 * zonder centrale afhandeling van een verlopen sessie (controle-ronde 27-08,
 * bevinding 19).
 *
 * Gedrag — de vereniging van wat er was:
 *  - Authorization uit de huidige Supabase-sessie (of `accessToken`, bv. vlak
 *    na inloggen vóór de sessie-state is bijgewerkt), toestel-headers, en
 *    Content-Type: application/json zodra er een body is — behalve bij
 *    FormData (de browser zet dan zelf de multipart-boundary). Eigen headers
 *    in init winnen altijd; AbortSignal en de rest van init gaan ongemoeid door.
 *  - Eén stille herkansing (600 ms) bij een netwerkfout of een 5xx, alleen
 *    voor GET's: een POST/PUT opnieuw sturen kan dubbel wegschrijven. Zonder
 *    dit gaf één deploy-hik vier rode meldingen (gemeten 07-08).
 *  - 401: één stille token-refresh, gedeeld door alle parallelle calls, en
 *    daarna één keer opnieuw. Faalt dát, dan is de sessie écht op:
 *    `vhb-auth-expired` (App logt uit met uitleg op het inlogscherm) + Error.
 *  - 403 "gedeactiveerd": `vhb-auth-expired` met reden 'account'. 403 met een
 *    device_*-code: `vhb-device-blocked` (App toont het toestel-wachtscherm).
 *    Andere 403's zijn alleen een fout op díe actie (Error met de
 *    servermelding), nooit een uitlog.
 *  - 503 (o.a. code auth_unavailable: Supabase-auth tijdelijk onbereikbaar)
 *    is géén reden om uit te loggen: na de ene herkansing komt de Response
 *    gewoon terug en beslist de aanroeper.
 *
 * Twee aparte herkansings-vlaggen i.p.v. één: een 5xx-retry en een 401-refresh
 * zijn losse gebeurtenissen. Met één vlag sloeg een GET die eerst 5xx kreeg en
 * daarna 401 de token-refresh over en logde de gebruiker onnodig uit.
 */
export type ApiFetchInit = RequestInit & {
  /** Expliciet token i.p.v. de huidige sessie (bv. direct na inloggen). */
  accessToken?: string;
};

export async function apiFetch(input: RequestInfo | URL, init: ApiFetchInit = {}): Promise<Response> {
  const { accessToken, ...rest } = init;
  return verstuur(input, rest, accessToken ?? (await huidigToken()), false, false);
}

/** apiFetch + JSON: gooit bij een niet-ok respons een Error met de
 *  servermelding, geeft undefined bij 204. Voor lib-helpers en losse
 *  componenten die alleen de data willen. */
export async function apiJson<T = unknown>(url: string, init: ApiFetchInit = {}): Promise<T> {
  const response = await apiFetch(url, init);
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
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/** Verlopen token stil vernieuwen. Supabase ververst zelf op een timer, maar
 *  die staat stil zolang de PWA in de app-switcher zit: bij hervatten is het
 *  token verlopen en gaf de eerstvolgende call een 401 → uitgelogd. Eén
 *  poging tegelijk, gedeeld door alle parallelle 401's (dezelfde belofte);
 *  App.tsx roept hem ook preventief aan bij het terugkeren naar de voorgrond.
 *  De React-sessie-state loopt mee via onAuthStateChange(TOKEN_REFRESHED).
 *  Geeft het nieuwe access-token, of null als vernieuwen niet lukte. */
let refreshPromise: Promise<string | null> | null = null;
export const vernieuwSessie = async (): Promise<string | null> => {
  if (!supabase) return null;
  if (!refreshPromise) {
    // Tijdslimiet: refreshSession() kan blijven hangen op de interne lock
    // (zelfde Supabase-fenomeen waarvoor de bootstrap al een watchdog heeft).
    // Zonder limiet bleef de app dan op "Profiel laden…" staan i.p.v. terug
    // te vallen op opnieuw inloggen.
    const metLimiet = <T,>(p: Promise<T>, ms: number): Promise<T | null> =>
      Promise.race([p, new Promise<null>((resolve) => window.setTimeout(() => resolve(null), ms))]);
    refreshPromise = metLimiet(supabase.auth.refreshSession(), 5000)
      .then((res) => (!res || res.error || !res.data.session ? null : res.data.session.access_token))
      .catch(() => null)
      .finally(() => {
        // Pas ná deze tick vrijgeven, zodat gelijktijdige 401's dezelfde
        // poging delen en er niet alsnog vijf refresh-calls vertrekken.
        window.setTimeout(() => { refreshPromise = null; }, 0);
      });
  }
  return refreshPromise;
};

const huidigToken = async (): Promise<string | undefined> => {
  if (!supabase) return undefined;
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token;
};

const wacht = (ms: number) => new Promise((r) => window.setTimeout(r, ms));

const meld = (naam: 'vhb-auth-expired' | 'vhb-device-blocked', detail: Record<string, string>) => {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(naam, { detail }));
};

async function verstuur(
  input: RequestInfo | URL,
  init: RequestInit,
  token: string | undefined,
  netwerkAlGeprobeerd: boolean,
  authAlGeprobeerd: boolean,
): Promise<Response> {
  const headers = new Headers(init.headers || {});
  const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData;
  if (init.body && !isFormData && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  for (const [key, value] of Object.entries(deviceHeaders())) {
    if (!headers.has(key)) headers.set(key, value);
  }

  const isLezen = !init.method || init.method.toUpperCase() === 'GET';
  let response: Response;
  try {
    response = await fetch(input, { ...init, headers });
  } catch (netwerkfout) {
    if (!isLezen || netwerkAlGeprobeerd) throw netwerkfout;
    await wacht(600);
    return verstuur(input, init, token, true, authAlGeprobeerd);
  }
  if (response.status >= 500 && isLezen && !netwerkAlGeprobeerd) {
    await wacht(600);
    return verstuur(input, init, token, true, authAlGeprobeerd);
  }
  if (response.status === 401) {
    if (!authAlGeprobeerd) {
      const versToken = await vernieuwSessie();
      if (versToken) return verstuur(input, init, versToken, netwerkAlGeprobeerd, true);
    }
    meld('vhb-auth-expired', { reden: 'sessie' });
    throw new Error('Je sessie is verlopen.');
  }
  if (response.status === 403) {
    const body = await response.clone().json().catch(() => ({} as any));
    const detail: string = body?.error || body?.details || '';
    if (/gedeactiveerd/i.test(detail)) {
      meld('vhb-auth-expired', { reden: 'account' });
      throw new Error('Je account is gedeactiveerd.');
    }
    // Toestel-whitelist: het toestel is (intussen) niet meer goedgekeurd →
    // App toont het geblokkeerd-scherm i.p.v. losse fout-toasts per call.
    if (body?.code === 'device_pending' || body?.code === 'device_unknown' || body?.code === 'device_revoked') {
      meld('vhb-device-blocked', { code: body.code });
      throw new Error(detail || 'Dit toestel heeft geen toegang.');
    }
    throw new Error(detail || 'Je hebt geen toegang tot deze actie.');
  }
  // Eigen schrijfactie: de realtime-echo daarvan hoort geen "bijgewerkt"-toast
  // te geven (src/lib/liveSignaal.ts).
  if (!isLezen && response.ok) markeerEigenSchrijfactie();
  return response;
}
