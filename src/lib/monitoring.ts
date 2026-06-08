import * as Sentry from '@sentry/react';

/**
 * Error monitoring via Sentry. Volledig optioneel: zonder een
 * `VITE_SENTRY_DSN` env-var doet dit niets (geen netwerk, geen ruis).
 *
 * Setup (later): maak een project op sentry.io, kopieer de DSN en zet
 * `VITE_SENTRY_DSN` als environment-variable in Vercel (Production +
 * Preview). Daarna worden client-side errors automatisch gerapporteerd.
 *
 * Bewust minimaal: geen tracing/session-replay → kleine bundle, geen PII.
 */
export function initMonitoring() {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) return;

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0,
    sendDefaultPii: false,
  });
}
