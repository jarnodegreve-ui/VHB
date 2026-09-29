import { useEffect, useState, type ReactNode } from 'react';
import { Send } from 'lucide-react';
import { Modal, SluitKnop } from './Modal';
import { ModalHeader } from './ui';
import { Button } from './primitives';
import { Callout } from './Callout';
import { notify } from '../lib/ui';
import { meldSchrijffout } from '../lib/fouten';
import { aantal as tel } from '../lib/format';
import { beoordeelUitkomst, isZonderAntwoord, type MailUitkomst } from '../lib/mailUitkomst';

/**
 * De bevestiging vóór een mail vertrekt (nr. 34): wie hem krijgt, hoe hij
 * eruitziet, en dan pas versturen. Eén component voor "Mail versturen" in
 * Beheer › Mails en de mailknop op een omleiding; die hadden elk een eigen
 * kopie die al uit elkaar liep (12 namen tegenover 8 adressen).
 *
 * De afloop van de verzending zit hier ook (nr. 5): deels vertrokken = het
 * venster blijft open, zegt hoeveel er vertrokken zijn en verstuurt op vraag
 * ALLEEN de rest; geen antwoord van de server = geen knop om opnieuw te
 * versturen, wel de verwijzing naar het verzendlog. Een mail versturen is
 * niet te herhalen zonder gevolg: wie hem al heeft, krijgt hem nog eens.
 */
export type MailVoorbeeld = { aantal: number; ontvangers: Array<{ adres: string; naam: string }>; html: string };

const MAX_GENOEMD = 10;

export function MailBevestiging({ voorbeeld, naam, toon, werkwoord, extra, logVerwijzing, verstuur, onTerug, onKlaar }: {
  /** null = gesloten. */
  voorbeeld: MailVoorbeeld | null;
  /** Toegankelijke naam van het venster en titel van het voorbeeld. */
  naam: string;
  /** Wat de ontvangersregel noemt: de naam van de persoon, of het adres
   *  (extern gericht, waar de naam die van de verzendlijst is). */
  toon: 'naam' | 'adres';
  /** "Mail verstuurd" of "Omleiding gemaild", voor de melding na afloop. */
  werkwoord: string;
  /** Extra regel onder de ontvangers, bv. onderwerp en bijlagen. */
  extra?: ReactNode;
  /** Waar de gebruiker kan nakijken wat er vertrokken is. */
  logVerwijzing: string;
  /** Verstuurt de mail; met `alleen` enkel naar die adressen. */
  verstuur: (alleen?: string[]) => Promise<MailUitkomst>;
  /** Terug naar het formulier, er is niets verstuurd. */
  onTerug: () => void;
  /** Er is (minstens deels) verstuurd: formulier leeg en dicht. */
  onKlaar: () => void;
}) {
  const [bezig, setBezig] = useState(false);
  const [deels, setDeels] = useState<{ titel: string; regels: string[]; resterend: string[] } | null>(null);
  const [zonderAntwoord, setZonderAntwoord] = useState(false);
  const open = voorbeeld !== null;
  useEffect(() => {
    if (open) { setDeels(null); setZonderAntwoord(false); }
  }, [open]);

  const stuur = async (alleen?: string[]) => {
    if (bezig) return;
    setBezig(true);
    try {
      const b = beoordeelUitkomst(await verstuur(alleen), werkwoord);
      if (b.soort === 'klaar') {
        notify(b.tekst, b.toon);
        onKlaar();
      } else {
        setDeels(b);
      }
    } catch (err) {
      // Geen "Opnieuw proberen": dat zou de hele verzending herstarten.
      if (isZonderAntwoord(err)) setZonderAntwoord(true);
      else meldSchrijffout('Mail versturen', err);
    } finally {
      setBezig(false);
    }
  };

  // Na een (deels) gelukte verzending is er geen weg terug naar het formulier.
  const sluit = deels ? onKlaar : onTerug;
  const genoemd = voorbeeld ? voorbeeld.ontvangers.slice(0, MAX_GENOEMD).map((o) => (toon === 'naam' ? o.naam : o.adres)).join(', ') : '';

  return (
    <Modal open={open} onClose={sluit} maxWidth="2xl" ariaLabel={naam} boven vast={bezig}>
      {voorbeeld && (
        <>
          <ModalHeader
            title={`Naar ${tel(voorbeeld.aantal, 'ontvanger', 'ontvangers')}`}
            description={(
              <>
                <span className="block break-words">{genoemd}{voorbeeld.ontvangers.length > MAX_GENOEMD ? ` en nog ${voorbeeld.ontvangers.length - MAX_GENOEMD}` : ''}.</span>
                {extra && <span className="mt-0.5 block break-words">{extra}</span>}
              </>
            )}
          />
          <div className="space-y-4 p-6">
            {zonderAntwoord ? (
              <Callout tone="danger" role="alert" title="Geen antwoord van de server">
                <p>Mogelijk is een deel van de mails toch vertrokken. Verstuur niet opnieuw voor dat is nagekeken. {logVerwijzing}</p>
              </Callout>
            ) : deels ? (
              <Callout tone="warning" role="alert" title={deels.titel}>
                {deels.regels.map((r) => <p key={r} className="break-words">{r}</p>)}
              </Callout>
            ) : (
              <iframe title={naam} srcDoc={voorbeeld.html} sandbox="" className="h-[50vh] min-h-[320px] w-full rounded-xl bg-surface-white ring-1 ring-hairline" />
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              {zonderAntwoord ? (
                <SluitKnop onClose={onTerug} variant="secondary">Sluiten</SluitKnop>
              ) : deels ? (
                <>
                  <SluitKnop onClose={onKlaar} variant="secondary" disabled={bezig}>Sluiten</SluitKnop>
                  {deels.resterend.length > 0 && (
                    <Button variant="primary" icon={<Send size={16} />} bezig={bezig} onClick={() => void stuur(deels.resterend)}>
                      Alleen de resterende {deels.resterend.length} versturen
                    </Button>
                  )}
                </>
              ) : (
                <>
                  <SluitKnop onClose={onTerug} variant="secondary" disabled={bezig}>Terug</SluitKnop>
                  <Button variant="primary" icon={<Send size={16} />} bezig={bezig} onClick={() => void stuur()}>Versturen naar {voorbeeld.aantal}</Button>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </Modal>
  );
}
