import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import App from './App.tsx';
import './index.css';
import { initMonitoring } from './lib/monitoring';

initMonitoring();

/** Vriendelijk vangscherm als de hele app crasht. */
function CrashFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 text-center">
      <div className="max-w-sm">
        <h1 className="text-xl font-black text-slate-900 tracking-tight">Er ging iets mis</h1>
        <p className="mt-2 text-sm font-medium text-slate-500">
          De pagina kon niet correct geladen worden. Probeer het opnieuw.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="btn-primary ios-pressable mt-5 px-5 py-3 text-xs uppercase tracking-[0.08em]"
        >
          Pagina herladen
        </button>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<CrashFallback />}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
