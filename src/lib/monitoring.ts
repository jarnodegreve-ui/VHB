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

/** Alleen voor tests. */
export function resetMonitoring() {
  breadcrumbs.length = 0;
  currentView = null;
  currentRole = null;
  currentUserId = null;
  seenMessages.clear();
  reportCount = 0;
  feedbackCount = 0;
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
  source: 'window.onerror' | 'unhandledrejection' | 'error-toast' | 'react-boundary' | 'gebruikersmelding';
};

/** Eén plek voor de POST zelf (stond drie keer uitgeschreven). Met
 *  `auth: true` gaan de sessie-headers mee zodat de server de afzender
 *  verifieert; zonder sessie (loginscherm, crash vóór init) valt hij terug
 *  op een anonieme melding. Geeft terug of de server hem accepteerde. */
async function postClientError(body: Record<string, unknown>, opts: { auth?: boolean } = {}): Promise<boolean> {
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
    return res.ok;
  } catch {
    // Rapportage mag zelf nooit een nieuwe fout veroorzaken.
    return false;
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

  void postClientError({
    message: report.message,
    stack: report.stack,
    source: report.source,
    url: window.location.pathname,
    userAgent: navigator.userAgent,
    userId: currentUserId ?? undefined,
    ...rapportContext(),
  });
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
  return postClientError({
    message: `Melding gebruiker${context.view ? ` (scherm: ${context.view})` : ''}: ${message}`,
    source: 'gebruikersmelding',
    url: window.location.pathname,
    userAgent: navigator.userAgent,
    userId: currentUserId ?? undefined,
    ...rapportContext(),
  }, { auth: true });
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

export function initMonitoring() {
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
