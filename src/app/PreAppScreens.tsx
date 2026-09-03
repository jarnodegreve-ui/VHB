import { useEffect, type ReactNode } from 'react';
import { ShieldAlert, Smartphone } from 'lucide-react';
import { BrandLogo } from '../components/BrandLogo';
import { BrandSpinner } from '../components/BrandSpinner';
import { Button } from '../components/primitives';
import { cn } from '../lib/ui';

/**
 * Schermen vóór de app zelf: sessie/profiel laden, toestel wacht op
 * goedkeuring, print-laadscherm, ontbrekende configuratie. Allemaal op de
 * carbon-achtergrond van de login (html.login-donker zodat Safari zijn
 * balken meekleurt — zelfde fix als LoginView, 01-09).
 */
function CarbonAchtergrond() {
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add('login-donker');
    return () => html.classList.remove('login-donker');
  }, []);
  return null;
}

function CarbonScherm({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('login-bg-dark min-h-screen flex flex-col items-center justify-center gap-5', className)}>
      <CarbonAchtergrond />
      <BrandLogo tone="donker" naamregelAfstand={70} className="w-36 sm:w-44 h-auto select-none" />
      {children}
    </div>
  );
}

function LaadRegel({ tekst }: { tekst: string }) {
  return (
    <div className="flex items-center gap-2.5 text-slate-300">
      {/* 26 px: bewuste maat (PR #411), iets boven de icoonladder. */}
      <BrandSpinner size={26} tone="donker" />
      <span className="text-sm font-medium">{tekst}</span>
    </div>
  );
}

/** Tekstlink op carbon: Button ghost hovert met een licht vlak dat hier als vlek opvalt. */
function CarbonLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    // rauw: tekstlink op het carbon pre-app-scherm.
    <button type="button" onClick={onClick} className="text-xs font-semibold text-slate-500 hover:text-white transition-colors">
      {children}
    </button>
  );
}

export function SessieLaden() {
  return <CarbonScherm><LaadRegel tekst="Sessie laden…" /></CarbonScherm>;
}

export function ProfielLaden() {
  return (
    <CarbonScherm>
      <LaadRegel tekst="Profiel laden…" />
      <CarbonLink onClick={() => window.location.reload()}>Duurt het te lang? Vernieuw de pagina</CarbonLink>
    </CarbonScherm>
  );
}

export function PrintLaden() {
  return <div className="min-h-screen bg-surface-white flex items-center justify-center text-slate-500">Print-weergave laden…</div>;
}

export function ConfigOntbreekt() {
  return (
    <div className="min-h-screen bg-oker-50 flex items-center justify-center p-6 text-center text-slate-700 font-bold">
      Supabase client-configuratie ontbreekt. Voeg `VITE_SUPABASE_URL` en `VITE_SUPABASE_ANON_KEY` toe in Vercel en lokaal.
    </div>
  );
}

export function ToestelGeblokkeerd({ revoked, onRetry, onLogout }: { revoked: boolean; onRetry: () => void; onLogout: () => void }) {
  return (
    <CarbonScherm className="gap-6 p-6 text-center">
      <div className="max-w-sm">
        <div className={cn(
          'mx-auto w-14 h-14 rounded-2xl flex items-center justify-center ring-1 ring-white/10',
          revoked ? 'bg-red-500/15 text-red-300' : 'bg-oker-500/15 text-oker-400',
        )}>
          {revoked ? <ShieldAlert size={24} /> : <Smartphone size={24} />}
        </div>
        <h1 className="mt-4 text-xl font-black text-white tracking-tight">
          {revoked ? 'Dit toestel is geblokkeerd' : 'Toestel wacht op goedkeuring'}
        </h1>
        <p className="mt-2 text-sm font-medium leading-6 text-slate-300">
          {revoked
            ? 'De toegang voor dit toestel is ingetrokken. Neem contact op met de planning als dit niet klopt.'
            : 'Je login werkt, maar dit toestel is nog niet goedgekeurd. De planning heeft een melding gekregen — zodra het toestel is goedgekeurd kun je verder. Tip: zet je de app op je beginscherm, dan kan die één keer apart goedgekeurd moeten worden.'}
        </p>
        {!revoked && (
          <Button variant="primary" className="mt-5" onClick={onRetry}>Opnieuw controleren</Button>
        )}
        <div className="mt-4"><CarbonLink onClick={onLogout}>Afmelden</CarbonLink></div>
      </div>
    </CarbonScherm>
  );
}
