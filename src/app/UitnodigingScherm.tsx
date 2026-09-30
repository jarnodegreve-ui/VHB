import React, { useEffect, useRef, useState } from 'react';
import { Lock } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { WACHTWOORD_HINT, WACHTWOORD_MIN } from '../lib/wachtwoord';
import { FeedbackBlock, FieldInput, LoginKop, LoginSchil, LoginTekstKnop, SubmitButton } from '../views/LoginView';

/**
 * Landing van een uitnodiging (30-09): de link in de mail is
 * `<portaal>/#uitnodiging=<code>` (shared/uitnodiging.ts). App.tsx haalt de
 * code uit de adresbalk en toont dit scherm zolang er niemand aangemeld is.
 *
 * Het scherm vraagt de server de uitnodiging te openen en krijgt een verse
 * herstel-token terug (POST /api/uitnodiging/openen). De sessie start pas bij
 * het opslaan van het wachtwoord: wie het scherm dichtdoet zonder te kiezen,
 * is nergens aangemeld en kan de link later opnieuw openen. Daarna meldt het
 * scherm af en weer aan met het nieuwe wachtwoord, zodat de app dezelfde weg
 * loopt als bij een gewone aanmelding (toestel, profiel, sessie).
 */

type Open = { naam: string; email: string; tokenHash: string };
type Fout = { titel: string; tekst: string; opnieuw?: boolean };
type Stand =
  | { soort: 'openen' }
  | { soort: 'kiezen'; open: Open }
  | { soort: 'fout'; fout: Fout }
  | { soort: 'ingesteld'; email: string };

/** Kop per reden die de server geeft; de uitleg zelf komt van de server. */
const TITEL: Record<string, string> = {
  ongeldig: 'Deze link werkt niet',
  verlopen: 'Uitnodiging verlopen',
  gebruikt: 'Uitnodiging al gebruikt',
  gepauzeerd: 'Account op pauze',
};

async function openUitnodiging(code: string): Promise<Open | { fout: Fout }> {
  try {
    const res = await fetch('/api/uitnodiging/openen', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const body = await res.json().catch(() => null);
    if (res.ok && typeof body?.tokenHash === 'string') return body as Open;
    if (res.status === 410) {
      return { fout: { titel: TITEL[body?.reden] ?? TITEL.ongeldig, tekst: typeof body?.error === 'string' ? body.error : 'Vraag de planning om een nieuwe uitnodiging.' } };
    }
    if (res.status === 429) return { fout: { titel: 'Even wachten', tekst: 'Te veel pogingen na elkaar. Probeer het over een paar minuten opnieuw.', opnieuw: true } };
    return { fout: { titel: 'Dat lukte niet', tekst: 'De uitnodiging kon niet geopend worden. Probeer het zo meteen opnieuw.', opnieuw: true } };
  } catch {
    return { fout: { titel: 'Geen verbinding', tekst: 'Controleer je internetverbinding en probeer opnieuw.', opnieuw: true } };
  }
}

/** Foutcodes van Supabase bij het zetten van het wachtwoord → wat de genodigde kan doen. */
const wachtwoordFout = (code: string | undefined) =>
  code === 'same_password'
    ? 'Kies een ander wachtwoord dan je vorige.'
    : code === 'weak_password'
      ? `Dit wachtwoord is te zwak. Kies er een van minstens ${WACHTWOORD_MIN} tekens.`
      : 'Je wachtwoord opslaan lukte niet. Probeer opnieuw.';

export function UitnodigingScherm({ code, onLogin, onKlaar }: {
  code: string;
  /** Dezelfde afhandeling als na een gewone aanmelding (App.handleLogin). */
  onLogin: (accessToken?: string) => Promise<void>;
  /** Uitnodiging afgehandeld of afgebroken: terug naar de gewone app of het loginscherm. */
  onKlaar: () => void;
}) {
  const [stand, setStand] = useState<Stand>({ soort: 'openen' });
  const [wachtwoord, setWachtwoord] = useState('');
  const [fout, setFout] = useState('');
  const [bezig, setBezig] = useState(false);
  // De herstel-token is eenmalig: na een geslaagde verifyOtp is er een sessie
  // en mag een tweede poging (ander wachtwoord) hem niet opnieuw gebruiken.
  const sessieGestart = useRef(false);

  // De code staat nog in de adresbalk (App laat haar staan tot hier): weg
  // ermee, zodat herladen of terug de uitnodiging niet opnieuw opent.
  useEffect(() => {
    if (window.location.hash) window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
  }, []);

  const laad = async () => {
    setStand({ soort: 'openen' });
    const r = await openUitnodiging(code);
    setStand('fout' in r ? { soort: 'fout', fout: r.fout } : { soort: 'kiezen', open: r });
  };
  useEffect(() => {
    void laad();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]);

  // Weg van dit scherm: een halverwege gestarte herstelsessie eerst afsluiten,
  // anders toont App het oude herstelscherm in plaats van het loginscherm.
  const sluit = async () => {
    if (sessieGestart.current && supabase) {
      sessieGestart.current = false;
      await supabase.auth.signOut().catch(() => undefined);
    }
    onKlaar();
  };

  const kies = async (e: React.FormEvent) => {
    e.preventDefault();
    if (stand.soort !== 'kiezen' || bezig || !supabase) return;
    if (wachtwoord.length < WACHTWOORD_MIN) {
      setFout(`Kies een wachtwoord van minstens ${WACHTWOORD_MIN} tekens.`);
      return;
    }
    const { email } = stand.open;
    setBezig(true);
    setFout('');
    try {
      if (!sessieGestart.current) {
        let { error } = await supabase.auth.verifyOtp({ token_hash: stand.open.tokenHash, type: 'recovery' });
        if (error) {
          // De token werkt een uur: stond het scherm langer open, dan een verse.
          const opnieuw = await openUitnodiging(code);
          if ('fout' in opnieuw) {
            setStand({ soort: 'fout', fout: opnieuw.fout });
            return;
          }
          ({ error } = await supabase.auth.verifyOtp({ token_hash: opnieuw.tokenHash, type: 'recovery' }));
          if (error) {
            setFout('Je wachtwoord kiezen lukte niet. Vraag de planning om een nieuwe uitnodiging.');
            return;
          }
        }
        sessieGestart.current = true;
      }
      const { error: zetFout } = await supabase.auth.updateUser({ password: wachtwoord });
      if (zetFout) {
        setFout(wachtwoordFout((zetFout as { code?: string }).code));
        return;
      }
      // Het wachtwoord staat: de link is vanaf nu geen herstellink meer, ook
      // als het toestel nog op goedkeuring wacht. Best-effort; lukt het niet,
      // dan vervalt de link bij de eerste aanmelding of na zeven dagen.
      await fetch('/api/uitnodiging/afronden', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      }).catch(() => undefined);
      await supabase.auth.signOut();
      sessieGestart.current = false;
      const { data, error: aanmeldFout } = await supabase.auth.signInWithPassword({ email, password: wachtwoord });
      if (aanmeldFout || !data.session) {
        setStand({ soort: 'ingesteld', email });
        return;
      }
      try {
        await onLogin(data.session.access_token);
      } catch {
        setStand({ soort: 'ingesteld', email });
        return;
      }
      onKlaar();
    } catch {
      setFout('Er ging iets mis. Controleer je verbinding en probeer opnieuw.');
    } finally {
      setBezig(false);
    }
  };

  if (stand.soort === 'openen') {
    return (
      <LoginSchil>
        <LoginKop sleutel="openen" title="Uitnodiging openen" description="Even geduld, we zoeken je uitnodiging op." />
      </LoginSchil>
    );
  }

  if (stand.soort === 'fout') {
    return (
      <LoginSchil>
        <LoginKop sleutel="fout" title={stand.fout.titel} description={stand.fout.tekst} />
        {stand.fout.opnieuw && (
          <form onSubmit={(e) => { e.preventDefault(); void laad(); }}>
            <SubmitButton loading={false}>Opnieuw proberen</SubmitButton>
          </form>
        )}
        <LoginTekstKnop onClick={() => { void sluit(); }}>Naar inloggen</LoginTekstKnop>
      </LoginSchil>
    );
  }

  if (stand.soort === 'ingesteld') {
    return (
      <LoginSchil>
        <LoginKop sleutel="ingesteld" title="Wachtwoord ingesteld" description={`Log nu in met ${stand.email} en je nieuwe wachtwoord.`} />
        <form onSubmit={(e) => { e.preventDefault(); void sluit(); }}>
          <SubmitButton loading={false}>Naar inloggen</SubmitButton>
        </form>
      </LoginSchil>
    );
  }

  const { naam, email } = stand.open;
  return (
    <LoginSchil>
      <LoginKop
        sleutel="kiezen"
        title={`Welkom, ${naam}`}
        description={<>Kies een wachtwoord voor het VHB Portaal. Je logt voortaan in met <span className="font-semibold text-white">{email}</span>.</>}
      />
      <form onSubmit={kies} className="space-y-4">
        {/* Voor de wachtwoordbeheerder (iCloud-sleutelhanger, Google): zo
            bewaart hij het nieuwe wachtwoord bij het juiste e-mailadres. */}
        <input type="email" name="email" autoComplete="username" value={email} readOnly tabIndex={-1} aria-hidden="true" className="sr-only" />
        <FieldInput
          icon={<Lock size={16} />}
          label="Kies een wachtwoord"
          type="password"
          value={wachtwoord}
          onChange={(v) => { setWachtwoord(v); setFout(''); }}
          placeholder={WACHTWOORD_HINT}
          required
          minLength={WACHTWOORD_MIN}
          autoComplete="new-password"
          autoFocus
        />
        <FeedbackBlock error={fout} info="" />
        <SubmitButton loading={bezig}>Wachtwoord opslaan</SubmitButton>
        <LoginTekstKnop onClick={() => { void sluit(); }}>Ik heb al een wachtwoord</LoginTekstKnop>
      </form>
    </LoginSchil>
  );
}
