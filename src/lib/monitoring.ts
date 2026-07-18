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

const MAX_REPORTS_PER_SESSION = 20;
const seenMessages = new Set<string>();
let reportCount = 0;
let currentUserId: string | null = null;

/** Wie is ingelogd — alleen het id, geen PII; null bij uitloggen. */
export function setMonitoringUser(userId: string | null) {
  currentUserId = userId;
}

type ClientErrorReport = {
  message: string;
  stack?: string;
  source: 'window.onerror' | 'unhandledrejection' | 'error-toast' | 'react-boundary';
};

function send(report: ClientErrorReport) {
  // Dedupe + plafond: één kapotte render-loop mag geen duizenden requests
  // afvuren. Het patroon is in de server-logs ook zichtbaar met één melding
  // per uniek bericht.
  if (reportCount >= MAX_REPORTS_PER_SESSION) return;
  const key = `${report.source}:${report.message}`;
  if (seenMessages.has(key)) return;
  seenMessages.add(key);
  reportCount += 1;

  try {
    void fetch('/api/client-errors', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      keepalive: true,
      body: JSON.stringify({
        message: report.message,
        stack: report.stack,
        source: report.source,
        url: window.location.pathname,
        userAgent: navigator.userAgent,
        userId: currentUserId ?? undefined,
      }),
    }).catch(() => {});
  } catch {
    // Rapportage mag zelf nooit een nieuwe fout veroorzaken.
  }
}

/** Voor fouten die de app zelf al afving maar wel aan de gebruiker toonde
 *  (fout-toasts): die zijn per definitie een gebroken flow. */
export function reportHandledError(message: string) {
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
