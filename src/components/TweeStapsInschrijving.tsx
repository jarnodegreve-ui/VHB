import { useEffect, useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { Button, IconButton } from './primitives';
import { Field, Input } from './Field';
import { BrandSpinner } from './BrandSpinner';
import { bevestigCode, startInschrijving, type Inschrijving } from '../lib/tweeStapsBeheer';
import { cn } from '../lib/ui';

/**
 * Inschrijfformulier voor twee-stapsverificatie: QR-code, geheime sleutel
 * als terugvaloptie, en het zescijferige codeveld. Eén component voor twee
 * plekken: het pre-app-scherm (verplicht, op carbon) en de modal in
 * Instellingen › Beveiliging (vrijwillig, op licht). `donker` schakelt de
 * tekstkleuren om; de QR blijft altijd op een wit vlak (scanbaar).
 */
export function TweeStapsInschrijving({ donker = false, onKlaar, onAnnuleer }: {
  donker?: boolean;
  onKlaar: () => void;
  onAnnuleer?: () => void;
}) {
  const [inschrijving, setInschrijving] = useState<Inschrijving | null>(null);
  const [fout, setFout] = useState('');
  const [code, setCode] = useState('');
  const [bezig, setBezig] = useState(false);
  const [gekopieerd, setGekopieerd] = useState(false);

  useEffect(() => {
    let actief = true;
    startInschrijving()
      .then((i) => { if (actief) setInschrijving(i); })
      .catch((e: unknown) => { if (actief) setFout(e instanceof Error ? e.message : 'Inschrijven is mislukt.'); });
    return () => { actief = false; };
  }, []);

  const bevestig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inschrijving) return;
    setBezig(true);
    setFout('');
    try {
      await bevestigCode(inschrijving.factorId, code);
      onKlaar();
    } catch (err) {
      setFout(err instanceof Error ? err.message : 'De code klopt niet.');
      setCode('');
    } finally {
      setBezig(false);
    }
  };

  const kopieer = async () => {
    if (!inschrijving) return;
    try {
      await navigator.clipboard.writeText(inschrijving.geheim);
      setGekopieerd(true);
      window.setTimeout(() => setGekopieerd(false), 2000);
    } catch {
      // geen klembord (oude WebView): de sleutel staat er sowieso leesbaar
    }
  };

  const tekst = donker ? 'text-slate-300' : 'text-slate-600';
  const kop = donker ? 'text-white' : 'text-slate-900';

  return (
    <form onSubmit={bevestig} className="space-y-5">
      <ol className={cn('space-y-1.5 text-body', tekst)}>
        <li><span className={cn('font-semibold', kop)}>1.</span> Open een authenticator-app op je telefoon (Google Authenticator, Microsoft Authenticator of 1Password).</li>
        <li><span className={cn('font-semibold', kop)}>2.</span> Scan de QR-code, of typ de sleutel over.</li>
        <li><span className={cn('font-semibold', kop)}>3.</span> Vul de zescijferige code in die de app toont.</li>
      </ol>

      <div className="flex flex-col items-center gap-3">
        {inschrijving ? (
          <img src={inschrijving.qr} alt="QR-code voor je authenticator-app" width={176} height={176} className="rounded-2xl bg-white p-2 ring-1 ring-black/10" />
        ) : fout ? null : (
          <div className="flex h-[176px] w-[176px] items-center justify-center"><BrandSpinner /></div>
        )}
        {inschrijving && (
          <div className={cn('flex max-w-full items-center gap-1.5 text-xs', tekst)}>
            <span className="truncate font-mono tracking-wider">{inschrijving.geheim}</span>
            <IconButton label={gekopieerd ? 'Gekopieerd' : 'Sleutel kopiëren'} size="sm" onClick={kopieer}>{gekopieerd ? <Check size={14} /> : <Copy size={14} />}</IconButton>
          </div>
        )}
      </div>

      <Field label="Code uit de app" error={fout || undefined}>
        <Input
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          placeholder="123456"
          invalid={!!fout}
          disabled={!inschrijving}
          className={cn('text-center text-lg tracking-[0.3em]', donker && 'control-input-dark')}
          autoFocus
        />
      </Field>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {onAnnuleer && <Button variant="ghost" type="button" onClick={onAnnuleer} disabled={bezig}>Annuleren</Button>}
        <Button variant="primary" type="submit" disabled={!inschrijving || code.length !== 6 || bezig}>{bezig ? 'Controleren…' : 'Bevestigen'}</Button>
      </div>
    </form>
  );
}

/** Alleen het codeveld: voor wie al ingeschreven is en de sessie moet ophogen. */
export function TweeStapsCode({ factorId, donker = false, onKlaar, onAnnuleer, annuleerLabel = 'Annuleren' }: {
  factorId: string;
  donker?: boolean;
  onKlaar: () => void;
  onAnnuleer?: () => void;
  annuleerLabel?: string;
}) {
  const [code, setCode] = useState('');
  const [fout, setFout] = useState('');
  const [bezig, setBezig] = useState(false);
  const bevestig = async (e: React.FormEvent) => {
    e.preventDefault();
    setBezig(true);
    setFout('');
    try {
      await bevestigCode(factorId, code);
      onKlaar();
    } catch (err) {
      setFout(err instanceof Error ? err.message : 'De code klopt niet.');
      setCode('');
    } finally {
      setBezig(false);
    }
  };
  return (
    <form onSubmit={bevestig} className="space-y-4">
      <Field label="Code uit je authenticator-app" error={fout || undefined}>
        <Input
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          placeholder="123456"
          invalid={!!fout}
          className={cn('text-center text-lg tracking-[0.3em]', donker && 'control-input-dark')}
          autoFocus
        />
      </Field>
      <div className="flex flex-wrap items-center justify-end gap-2">
        {onAnnuleer && <Button variant="ghost" type="button" onClick={onAnnuleer} disabled={bezig}>{annuleerLabel}</Button>}
        <Button variant="primary" type="submit" disabled={code.length !== 6 || bezig}>{bezig ? 'Controleren…' : 'Bevestigen'}</Button>
      </div>
    </form>
  );
}
