import { useEffect, useRef, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { Button } from '../components/primitives';
import { TweeStapsCode, TweeStapsInschrijving } from '../components/TweeStapsInschrijving';
import { leesTweeStapsStatus } from '../lib/tweeStaps';
import { CarbonScherm } from './PreAppScreens';

type Lezing = 'lezen' | 'fout' | { factorId: string | null };

const standUitProps = (stap: 'code' | 'inschrijven', factorId: string | null): Lezing =>
  stap === 'inschrijven' ? { factorId: null } : factorId ? { factorId } : 'lezen';

/**
 * Pre-app-scherm voor twee-stapsverificatie (verbeterronde 07-09, nr. 8):
 * 'code' = ingeschreven staf die na het wachtwoord de code moet invoeren,
 * 'inschrijven' = staf zonder authenticator terwijl de server hem verplicht
 * (MFA_STAF=aan). Zelfde carbon-recept als het toestel-wachtscherm.
 *
 * 'code' zonder factor-id (07-10, "niets laden vóór aal2"): de server eist de
 * code, maar de status van de client was niet leesbaar (beslisTweeStaps). Het
 * scherm leest ze dan zelf: met een factor het codeformulier, zonder factor
 * inschrijven, en lukt het lezen niet, dan een uitleg met "Opnieuw proberen".
 * De app laadt intussen niets (useSessie, App).
 */
export function TweeStapsScherm({ stap, factorId, onKlaar, onLogout }: {
  stap: 'code' | 'inschrijven';
  factorId: string | null;
  onKlaar: () => void;
  onLogout: () => void;
}) {
  const [lezing, setLezing] = useState<Lezing>(() => standUitProps(stap, factorId));
  // Elke lezing krijgt een beurtnummer: een late uitkomst van een vorige
  // lezing mag een intussen aangeleverde factor (nieuwe props) niet overschrijven.
  const beurtRef = useRef(0);
  const lees = () => {
    const beurt = ++beurtRef.current;
    setLezing('lezen');
    void leesTweeStapsStatus().then((status) => {
      if (beurtRef.current !== beurt) return;
      setLezing(status ? { factorId: status.factorId } : 'fout');
    });
  };
  useEffect(() => {
    const stand = standUitProps(stap, factorId);
    if (stand === 'lezen') {
      lees();
      return;
    }
    beurtRef.current += 1;
    setLezing(stand);
  }, [stap, factorId]);

  const factor = typeof lezing === 'object' ? lezing.factorId : null;
  const toon: 'code' | 'inschrijven' | 'lezen' | 'fout' = typeof lezing === 'object' ? (factor ? 'code' : 'inschrijven') : lezing;
  const codeKop = toon !== 'inschrijven';

  return (
    <CarbonScherm className="gap-6 p-6">
      <div className="w-full max-w-sm">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 text-slate-300 ring-1 ring-white/10">
          <ShieldCheck size={24} />
        </div>
        <h1 className="mt-4 text-center text-xl font-black tracking-[-0.015em] text-white">
          {codeKop ? 'Code uit je authenticator' : 'Twee-stapsverificatie instellen'}
        </h1>
        <p className="mt-2 text-center text-sm font-medium leading-6 text-slate-300">
          {codeKop
            ? 'Je account is beveiligd met twee stappen. Vul de code in die je authenticator-app nu toont.'
            : 'Planners en beheerders melden zich voortaan aan met wachtwoord én een code van hun telefoon. Dit stel je één keer in, daarna vraagt het portaal de code bij elke aanmelding.'}
        </p>
        <div className="mt-6 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/10">
          {toon === 'code' && factor ? (
            <TweeStapsCode factorId={factor} donker onKlaar={onKlaar} />
          ) : toon === 'inschrijven' ? (
            <TweeStapsInschrijving donker onKlaar={onKlaar} />
          ) : toon === 'lezen' ? (
            <p role="status" className="text-center text-sm font-medium text-slate-300">Status van je tweede stap lezen…</p>
          ) : (
            <div className="flex flex-col items-center gap-4 text-center">
              <p className="text-sm font-medium leading-6 text-slate-300">De status van je tweede stap kon niet gelezen worden. Controleer je verbinding en probeer opnieuw.</p>
              <Button variant="primary" onClick={lees}>Opnieuw proberen</Button>
            </div>
          )}
        </div>
        <div className="mt-5 text-center">
          <Button variant="ghost" size="sm" onClick={onLogout} className="!text-white/60 hover:!text-white">Afmelden</Button>
        </div>
      </div>
    </CarbonScherm>
  );
}
