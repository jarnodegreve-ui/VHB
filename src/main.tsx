import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import App from './App.tsx';
import './index.css';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Button } from './components/primitives';
import { initMonitoring } from './lib/monitoring';
import { FoutReferentie } from './app/FoutReferentie';

initMonitoring();

/** Vriendelijk vangscherm als de hele app crasht. */
function CrashFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center p-6 text-center">
      <div className="max-w-sm">
        <h1 className="text-xl font-black text-slate-900 tracking-[-0.015em]">Er ging iets mis</h1>
        <p className="mt-2 text-sm font-medium text-slate-500">
          De pagina kon niet correct geladen worden. Probeer het opnieuw.
        </p>
        <Button variant="primary" className="mt-5" onClick={() => window.location.reload()}>
          Pagina herladen
        </Button>
        <FoutReferentie className="mt-4" />
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {/* reducedMotion="user" (fase 2): de CSS-regel in index.css zet alleen
        CSS-animaties op 0, niet de motion-animaties; tien componenten
        (login, topbar-menu's, InfoTip, installatiehint, …) luisterden dus
        niet naar prefers-reduced-motion. MotionConfig doet dat centraal:
        transform- en layout-animaties vallen weg, opacity blijft. */}
    <MotionConfig reducedMotion="user">
      <ErrorBoundary fallback={<CrashFallback />}>
        <App />
      </ErrorBoundary>
    </MotionConfig>
  </StrictMode>,
);
