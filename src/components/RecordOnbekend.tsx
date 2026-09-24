import { Callout } from './Callout';
import { Button } from './primitives';

/**
 * Nette staat voor een record-URL die naar niets wijst (tranche 3C, 23-09):
 * een oude melding, een verwijderde aanvraag, een getypte of doorgestuurde
 * link naar iets van een collega. De tekst is voor al die gevallen dezelfde,
 * zodat ze niet verraadt of het record bestaat (zie src/lib/recordLink.ts).
 * Sluiten haalt het id uit de URL; de lijst eronder blijft gewoon staan.
 */
export function RecordOnbekend({ soort, onzijdig = false, onSluit }: {
  soort: string;
  /** Het-woord (voertuig): "Dit … Het bestaat" in plaats van "Deze … Ze bestaat". */
  onzijdig?: boolean;
  onSluit: () => void;
}) {
  return (
    <Callout
      tone="info"
      role="status"
      title={`${onzijdig ? 'Dit' : 'Deze'} ${soort} is niet beschikbaar`}
      action={<Button variant="secondary" size="sm" onClick={onSluit}>Sluiten</Button>}
    >
      <p className="text-body-sm">{onzijdig ? 'Het' : 'Ze'} bestaat niet meer, of je hebt er geen toegang toe.</p>
    </Callout>
  );
}
