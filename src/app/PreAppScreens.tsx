import { useEffect, useState, type ReactNode } from 'react';
import { BrandLogo } from '../components/BrandLogo';
import { applyThemeColorMeta, cn } from '../lib/ui';

/**
 * Schermen vóór de app zelf: sessie/profiel laden, toestel wacht op
 * goedkeuring, print-laadscherm, ontbrekende configuratie. Allemaal op de
 * carbon-achtergrond van de login (html.login-donker zodat Safari zijn
 * balken meekleurt — zelfde fix als LoginView, 01-09).
 */
function CarbonAchtergrond() {
  useEffect(() => {
    const html = document.documentElement;
    // Zelfde recept als LoginView: de carbon-schermen zijn altijd-donker met
    // hun eigen kleuren, dus `.dark` (omgekeerde schalen) moet even uit —
    // anders werd slate-300 er onleesbaar op (controle 05-09).
    const wasDark = html.classList.contains('dark');
    html.classList.remove('dark');
    html.classList.add('login-donker');
    applyThemeColorMeta(true);
    return () => {
      if (wasDark) html.classList.add('dark');
      html.classList.remove('login-donker');
      applyThemeColorMeta(wasDark);
    };
  }, []);
  return null;
}

export function CarbonScherm({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('login-bg-dark min-h-screen flex flex-col items-center justify-center gap-5', className)}>
      <CarbonAchtergrond />
      <BrandLogo tone="donker" className="w-44 sm:w-56 h-auto select-none" />
      {children}
    </div>
  );
}

/** Tekst pas na een korte stilte: bij een normale start (< 1,5 s) zie je
 *  alleen het logo; na 8 s de uitweg. */
function useLaadFases() {
  const [fase, setFase] = useState<0 | 1 | 2>(0);
  useEffect(() => {
    const t1 = window.setTimeout(() => setFase(1), 1500);
    const t2 = window.setTimeout(() => setFase(2), 8000);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, []);
  return fase;
}

/** Tekstlink op carbon: Button ghost hovert met een licht vlak dat hier als vlek opvalt. */
export function CarbonLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    // rauw: tekstlink op het carbon pre-app-scherm.
    <button type="button" onClick={onClick} className="text-xs font-semibold text-white/60 hover:text-white transition-colors">
      {children}
    </button>
  );
}

/**
 * Het laadscherm (koude start, profiel laden): het logo zelf is de spinner
 * — geen tweede lus en geen systeemtaal. Tekst verschijnt pas na 1,5 s,
 * de uitweg na 8 s (verbeterronde laadscherm 03-09, nrs. 1 + 2).
 */
export function LaadScherm({ tekst = 'Even je gegevens ophalen…' }: { tekst?: string }) {
  const fase = useLaadFases();
  return (
    <div className="login-bg-dark min-h-screen flex flex-col items-center justify-center gap-6" role="status" aria-busy="true" aria-label="Portaal wordt geladen">
      <CarbonAchtergrond />
      <BrandLogo tone="donker" laden className="w-44 sm:w-56 h-auto select-none" />
      <div className="flex min-h-10 flex-col items-center gap-3">
        <p className={cn('text-sm font-medium text-white/60 transition-opacity duration-slow', fase >= 1 ? 'opacity-100' : 'opacity-0')} aria-hidden={fase < 1 || undefined}>
          {tekst}
        </p>
        {fase >= 2 && <CarbonLink onClick={() => window.location.reload()}>Duurt het te lang? Vernieuw de pagina</CarbonLink>}
      </div>
    </div>
  );
}

export function SessieLaden() {
  return <LaadScherm />;
}

export function ProfielLaden() {
  return <LaadScherm tekst="Je profiel ophalen…" />;
}

export function PrintLaden() {
  return (
    <div className="min-h-screen bg-surface-white flex flex-col items-center justify-center gap-5" role="status" aria-busy="true" aria-label="Print-weergave wordt geladen">
      <BrandLogo tone="licht" laden className="w-44 h-auto select-none" />
    </div>
  );
}

export function ConfigOntbreekt() {
  return (
    <div className="min-h-screen bg-oker-50 flex items-center justify-center p-6 text-center text-slate-700 font-bold">
      Supabase client-configuratie ontbreekt. Voeg `VITE_SUPABASE_URL` en `VITE_SUPABASE_ANON_KEY` toe in Vercel en lokaal.
    </div>
  );
}
