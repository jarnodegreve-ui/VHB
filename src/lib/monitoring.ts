/**
 * Foutmonitoring via eigen rapportage naar `POST /api/client-errors` — werkt
 * altijd, zonder externe accounts. Komt terecht in de Vercel-functielogs en
 * (optioneel, als de tabel bestaat) in de `client_errors`-tabel in Supabase.
 *
 * Belangrijk: óók afgehandelde fouten (catch → fout-toast) worden gemeld via
 * `reportHandledError`, en render-crashes via `reportBoundaryError` (vanuit de
 * ErrorBoundary). De stack-overflow-bug van juni 2026 zat volledig binnen
 * try/catch en was daardoor onzichtbaar voor window.onerror.
 */

import { getSupabaseAuthHeaders } from './ui';
import { RELEASE } from './appVersion';

const MAX_REPORTS_PER_SESSION = 20;
const MAX_FEEDBACK_PER_SESSION = 10;
const seenMessages = new Set<string>();
let reportCount = 0;
let feedbackCount = 0;
let currentUserId: string | null = null;
let currentRole: string | null = null;
let currentView: string | null = null;

/** Wie is ingelogd — alleen id en rol, geen naam/e-mail; null bij uitloggen. */
export function setMonitoringUser(userId: string | null, role?: string | null) {
  currentUserId = userId;
  currentRole = userId ? (role ?? null) : null;
}

// --- Broodkruimels: de laatste 10 navigaties/acties vóór een fout ---
// Ringbuffer, alleen in het geheugen. Route-wissels komen uit App.tsx (één
// regel), fout-toasts uit reportHandledError. Geen PII: alleen view-namen en
// de (al gedeelde) tekst van een fout-toast.
export type BreadcrumbSoort = 'navigatie' | 'fout-toast' | 'actie';
export type Breadcrumb = { t: string; soort: BreadcrumbSoort; tekst: string };
export const MAX_BREADCRUMBS = 10;
const breadcrumbs: Breadcrumb[] = [];

export function addBreadcrumb(soort: BreadcrumbSoort, tekst: string) {
  breadcrumbs.push({ t: new Date().toISOString(), soort, tekst: String(tekst).slice(0, 120) });
  if (breadcrumbs.length > MAX_BREADCRUMBS) breadcrumbs.splice(0, breadcrumbs.length - MAX_BREADCRUMBS);
  if (soort === 'navigatie') currentView = tekst;
}

export function getBreadcrumbs(): Breadcrumb[] {
  return [...breadcrumbs];
}

// --- Foutreferentie: de korte code die de server per rapport teruggeeft ---
// POST /api/client-errors antwoordt met { ok, referentie } (eerste tekens van
// de foutgroep-fingerprint, api/_lib/foutgroepen.ts). De foutschermen tonen
// de laatst ontvangen code ("Referentie A7F3C1, geef deze door aan de
// planning") zodat een admin de groep in Systeemstatus › Fouten terugvindt.
// Alleen automatische rapporten zetten hem; een gebruikersmelding niet (die
// neemt hem juist mee). Niet verstuurd of offline = geen referentie.
let laatsteReferentie: string | null = null;
const referentieListeners = new Set<() => void>();
const zetReferentie = (referentie: string | null) => {
  if (laatsteReferentie === referentie) return;
  laatsteReferentie = referentie;
  for (const l of referentieListeners) l();
};
export const getLaatsteReferentie = (): string | null => laatsteReferentie;
/** Voor useSyncExternalStore (src/app/FoutReferentie.tsx). */
export function subscribeReferentie(listener: () => void): () => void {
  referentieListeners.add(listener);
  return () => { referentieListeners.delete(listener); };
}
/** Na "Opnieuw proberen": een oude code hoort niet bij een nieuwe fout. */
export const wisReferentie = () => zetReferentie(null);

/** Alleen voor tests. */
export function resetMonitoring() {
  breadcrumbs.length = 0;
  currentView = null;
  currentRole = null;
  currentUserId = null;
  seenMessages.clear();
  reportCount = 0;
  feedbackCount = 0;
  laatsteReferentie = null;
  referentieListeners.clear();
  prestatieGemeld.clear();
}

/** Context die met élk rapport meegaat: release (build-SHA), huidig scherm,
 *  rol, online-status en de broodkruimels. Geen naam of e-mail. */
function rapportContext() {
  return {
    release: RELEASE,
    view: currentView ?? undefined,
    role: currentRole ?? undefined,
    online: typeof navigator === 'undefined' ? undefined : navigator.onLine,
    breadcrumbs: getBreadcrumbs(),
  };
}

type ClientErrorReport = {
  message: string;
  stack?: string;
  source: 'window.onerror' | 'unhandledrejection' | 'error-toast' | 'react-boundary' | 'gebruikersmelding' | 'prestatie';
};

/** Eén plek voor de POST zelf (stond drie keer uitgeschreven). Met
 *  `auth: true` gaan de sessie-headers mee zodat de server de afzender
 *  verifieert; zonder sessie (loginscherm, crash vóór init) valt hij terug
 *  op een anonieme melding. Geeft terug of de server hem accepteerde, plus
 *  de korte referentie van de foutgroep als die meekwam. */
async function postClientError(body: Record<string, unknown>, opts: { auth?: boolean } = {}): Promise<{ ok: boolean; referentie?: string }> {
  try {
    let headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (opts.auth) {
      try {
        headers = { ...headers, ...(await getSupabaseAuthHeaders()) };
      } catch {
        // Zonder sessie: de server markeert de melding dan als onbevestigd.
      }
    }
    const res = await fetch('/api/client-errors', { method: 'POST', headers, keepalive: true, body: JSON.stringify(body) });
    if (!res.ok) return { ok: false };
    // Oudere server (204) of een mock zonder body: dan gewoon geen referentie.
    const json = typeof res.json === 'function' ? await res.json().catch(() => null) : null;
    const referentie = json && typeof json.referentie === 'string' && /^[0-9A-Z]{4,16}$/.test(json.referentie) ? json.referentie : undefined;
    return { ok: true, referentie };
  } catch {
    // Rapportage mag zelf nooit een nieuwe fout veroorzaken.
    return { ok: false };
  }
}

function send(report: ClientErrorReport) {
  // Dedupe + plafond: één kapotte render-loop mag geen duizenden requests
  // afvuren. Het patroon is in de server-logs ook zichtbaar met één melding
  // per uniek bericht.
  if (reportCount >= MAX_REPORTS_PER_SESSION) return;
  const key = `${report.source}:${report.message}`;
  if (seenMessages.has(key)) return;
  seenMessages.add(key);
  reportCount += 1;

  // Eerst wissen: mislukt de verzending (offline), dan blijft er geen oude
  // code van een eerdere fout op het scherm staan.
  zetReferentie(null);
  void postClientError({
    message: report.message,
    stack: report.stack,
    source: report.source,
    url: window.location.pathname,
    userAgent: navigator.userAgent,
    userId: currentUserId ?? undefined,
    ...rapportContext(),
  }).then((r) => { if (r.referentie) zetReferentie(r.referentie); });
}

/** Handmatige melding via de "Meld een probleem"-knop: de tekst van de
 *  gebruiker + waar die op dat moment was. Bewust búiten de dedupe — twee
 *  verschillende meldingen met dezelfde strekking zijn allebei welkom.
 *  Mét sessie-headers: zo staat de melding op naam van de échte afzender
 *  (voorheen was élke melding "onbevestigd" en kon iedereen andermans id
 *  invullen). Geeft terug of de melding is aangekomen, zodat de UI geen
 *  "Bedankt!" toont voor een melding die de server nooit zag. Eigen plafond
 *  als vangnet tegen scripted spam vanaf één sessie. */
export async function reportUserFeedback(message: string, context: { view?: string } = {}): Promise<boolean> {
  if (feedbackCount >= MAX_FEEDBACK_PER_SESSION) return false;
  feedbackCount += 1;
  const r = await postClientError({
    message: `Melding gebruiker${context.view ? ` (scherm: ${context.view})` : ''}: ${message}`,
    source: 'gebruikersmelding',
    url: window.location.pathname,
    userAgent: navigator.userAgent,
    userId: currentUserId ?? undefined,
    ...rapportContext(),
  }, { auth: true });
  return r.ok;
}

/** Voor fouten die de app zelf al afving maar wel aan de gebruiker toonde
 *  (fout-toasts): die zijn per definitie een gebroken flow. */
export function reportHandledError(message: string) {
  // Eerst als broodkruimel: een volgende crash toont dan ook déze toast in
  // zijn aanloop. Het rapport zelf bevat de kruimel dus ook.
  addBreadcrumb('fout-toast', message);
  send({ message, source: 'error-toast' });
}

/** Render-crash opgevangen door de ErrorBoundary. */
export function reportBoundaryError(error: Error, componentStack?: string) {
  send({ message: error.message || 'Render-crash', stack: componentStack ?? error.stack, source: 'react-boundary' });
}

// --- Prestatiedrempels op Mijn dag (golf 4, punt 20) ---
// Speed Insights stuurt LCP/INP/CLS per scherm naar Vercel, maar zonder
// drempel of alarm: een regressie viel alleen op als iemand dat dashboard
// opende. Hier meten we zelf met de native PerformanceObserver (geen
// web-vitals-dependency; de beforeSend van @vercel/speed-insights geeft geen
// metriekwaarde mee, alleen type/url/route) en melden we hooguit één keer per
// sessie per metriek naar /api/client-errors met bron 'prestatie'. Zo wordt
// een trage Mijn dag een foutgroep in Systeemstatus › Fouten, mét release,
// rol, online-status en broodkruimels. Alleen Mijn dag: het scherm waar de
// chauffeur in de bus op wacht, en het scherm dat Lighthouse CI bewaakt.
//  - LCP > 4 s: elke kandidaat telt (kandidaten worden alleen groter, dus de
//    eerste boven de drempel is al een trage LCP). Alleen bij een koude start
//    op Mijn dag; een schermwissel in de SPA levert geen nieuwe LCP-entry.
//  - INP > 300 ms: één interactie (event-timing mét interactionId) op Mijn
//    dag die langer duurt. Bij minder dan 50 interacties per sessie ís de
//    traagste interactie de INP, dus dit is dezelfde maat als Speed Insights.
export const PRESTATIE_DREMPELS = { LCP: 4000, INP: 300 } as const;
export const PRESTATIE_SCHERM = 'mijn-dag';
type PrestatieMetriek = keyof typeof PRESTATIE_DREMPELS;
const prestatieGemeld = new Set<PrestatieMetriek>();

/** Zit de gebruiker op Mijn dag? Eerst de navigatie-kruimel (App.tsx zet die
 *  per schermwissel), anders het URL-pad (koude start vóór de eerste kruimel). */
const opPrestatieScherm = () =>
  currentView === PRESTATIE_SCHERM
  || (typeof window !== 'undefined' && window.location.pathname.replace(/^\/+/, '').split('/')[0] === PRESTATIE_SCHERM);

/** Eén melding per metriek per sessie; geeft terug of er gemeld is. Los van de
 *  observers zodat de drempellogica in vitest te testen is. */
export function beoordeelPrestatie(metriek: PrestatieMetriek, ms: number): boolean {
  if (!(ms > PRESTATIE_DREMPELS[metriek]) || prestatieGemeld.has(metriek) || !opPrestatieScherm()) return false;
  prestatieGemeld.add(metriek);
  send({
    message: `Trage ${metriek} op ${PRESTATIE_SCHERM}: ${Math.round(ms)} ms (drempel ${PRESTATIE_DREMPELS[metriek]} ms)`,
    source: 'prestatie',
  });
  return true;
}

function initPrestatieBewaking() {
  if (typeof PerformanceObserver === 'undefined') return;
  const ondersteund: readonly string[] = PerformanceObserver.supportedEntryTypes ?? [];
  try {
    if (ondersteund.includes('largest-contentful-paint')) {
      new PerformanceObserver((lijst) => {
        for (const entry of lijst.getEntries()) beoordeelPrestatie('LCP', entry.startTime);
      }).observe({ type: 'largest-contentful-paint', buffered: true });
    }
    if (ondersteund.includes('event')) {
      new PerformanceObserver((lijst) => {
        for (const entry of lijst.getEntries()) {
          // interactionId ontbreekt in oudere lib.dom-typen; 0 = geen interactie (bv. hover).
          const interactie = (entry as PerformanceEntry & { interactionId?: number }).interactionId;
          if (interactie) beoordeelPrestatie('INP', entry.duration);
        }
      }).observe({ type: 'event', buffered: true, durationThreshold: 200 } as PerformanceObserverInit);
    }
  } catch {
    // Browser zonder deze entry-types: geen bewaking, nooit een fout.
  }
}

export function initMonitoring() {
  initPrestatieBewaking();

  window.addEventListener('error', (event) => {
    send({
      message: String(event.message ?? 'Onbekende fout'),
      stack: event.error instanceof Error ? event.error.stack : undefined,
      source: 'window.onerror',
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    send({
      message: reason instanceof Error ? reason.message : String(reason ?? 'Onbekende rejection'),
      stack: reason instanceof Error ? reason.stack : undefined,
      source: 'unhandledrejection',
    });
  });
}
