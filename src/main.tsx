import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Button } from './components/primitives';
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
        <Button variant="primary" className="mt-5" onClick={() => window.location.reload()}>
          Pagina herladen
        </Button>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary fallback={<CrashFallback />}>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
