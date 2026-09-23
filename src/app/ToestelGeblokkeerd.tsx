import { ShieldAlert, Smartphone } from 'lucide-react';
import { Button } from '../components/primitives';
import { cn } from '../lib/ui';
import { CarbonLink, CarbonScherm } from './PreAppScreens';

/**
 * Toestel wacht op goedkeuring of is geblokkeerd. Eigen chunk (tranche 3C,
 * 23-09): een zeldzaam scherm met lange teksten hoort niet in de startbundel
 * (budget 74 kB); App laadt het lui met SessieLaden als tussenstap.
 */
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
        <h1 className="mt-4 text-xl font-black text-white tracking-[-0.015em]">
          {revoked ? 'Dit toestel is geblokkeerd' : 'Toestel wacht op goedkeuring'}
        </h1>
        <p className="mt-2 text-sm font-medium leading-6 text-slate-300">
          {revoked
            ? 'De toegang voor dit toestel is ingetrokken. Neem contact op met de planning als dit niet klopt.'
            : 'Je login werkt, maar dit toestel is nog niet goedgekeurd. De planning heeft een melding gekregen, zodra het toestel is goedgekeurd kun je verder. Tip: zet je de app op je beginscherm, dan kan die één keer apart goedgekeurd moeten worden.'}
        </p>
        {!revoked && (
          <Button variant="primary" className="mt-5" onClick={onRetry}>Opnieuw controleren</Button>
        )}
        <div className="mt-4"><CarbonLink onClick={onLogout}>Afmelden</CarbonLink></div>
      </div>
    </CarbonScherm>
  );
}
