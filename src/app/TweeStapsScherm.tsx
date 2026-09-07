import { ShieldCheck } from 'lucide-react';
import { Button } from '../components/primitives';
import { TweeStapsCode, TweeStapsInschrijving } from '../components/TweeStapsInschrijving';
import { CarbonScherm } from './PreAppScreens';

/**
 * Pre-app-scherm voor twee-stapsverificatie (verbeterronde 07-09, nr. 8):
 * 'code' = ingeschreven staf die na het wachtwoord de code moet invoeren,
 * 'inschrijven' = staf zonder authenticator terwijl de server hem verplicht
 * (MFA_STAF=aan). Zelfde carbon-recept als het toestel-wachtscherm.
 */
export function TweeStapsScherm({ stap, factorId, onKlaar, onLogout }: {
  stap: 'code' | 'inschrijven';
  factorId: string | null;
  onKlaar: () => void;
  onLogout: () => void;
}) {
  return (
    <CarbonScherm className="gap-6 p-6">
      <div className="w-full max-w-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-oker-500/15 text-oker-400 ring-1 ring-white/10">
          <ShieldCheck size={24} />
        </div>
        <h1 className="mt-4 text-center text-xl font-black tracking-tight text-white">
          {stap === 'code' ? 'Code uit je authenticator' : 'Twee-stapsverificatie instellen'}
        </h1>
        <p className="mt-2 text-center text-sm font-medium leading-6 text-slate-300">
          {stap === 'code'
            ? 'Je account is beveiligd met twee stappen. Vul de code in die je authenticator-app nu toont.'
            : 'Planners en beheerders melden zich voortaan aan met wachtwoord én een code van hun telefoon. Dit stel je één keer in, daarna vraagt het portaal de code bij elke aanmelding.'}
        </p>
        <div className="mt-6 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/10">
          {stap === 'code' && factorId
            ? <TweeStapsCode factorId={factorId} donker onKlaar={onKlaar} />
            : <TweeStapsInschrijving donker onKlaar={onKlaar} />}
        </div>
        <div className="mt-5 text-center">
          <Button variant="ghost" size="sm" onClick={onLogout} className="!text-white/60 hover:!text-white">Afmelden</Button>
        </div>
      </div>
    </CarbonScherm>
  );
}
