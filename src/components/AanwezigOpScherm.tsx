import { useRoute } from '../app/router';
import { useAanwezigen } from '../lib/presence';
import { cn } from '../lib/ui';
import { Badge } from './primitives';

const voornaam = (naam: string) => naam.trim().split(/\s+/)[0] || naam;

/**
 * Stille chip in de PageHeader-acties van beheerschermen die hele collecties
 * opslaan: "Pieter bekijkt dit ook" zodra een andere staf-gebruiker op
 * hetzelfde scherm zit. Eén gedeelde component — de views geven alleen
 * `<AanwezigOpScherm />` mee; welk scherm "dit" is, komt uit de router.
 * Rendert niets als er niemand is (geen lege plek in de kop).
 *
 * `className` (ronde 6, punt 20) komt op de chip zelf, na zijn eigen klassen.
 * Verlof en Dienstruil geven er een vaste grootste breedte en een breekpunt
 * mee: de chip verschijnt live en mag daar de kop niet hoger maken of een
 * knop verplaatsen. De tekst staat daarom in een eigen span die afkapt (een
 * `max-w` op de chip alleen kapt kale tekst in een inline-flex niet af); de
 * volledige namen blijven in `title`. De stip krimpt niet mee
 * (`[&>span:first-child]:shrink-0`: de stip van een stille Badge is zijn
 * eerste kind en heeft zelf geen shrink-0, anders wordt ze een ovaal zodra de
 * tekst afkapt). Zonder `className` is de chip zo breed als zijn tekst.
 */
export function AanwezigOpScherm({ className }: { className?: string } = {}) {
  const { view } = useRoute();
  const hier = useAanwezigen().filter((a) => a.view === view);
  if (hier.length === 0) return null;
  const tekst = hier.length === 1
    ? `${voornaam(hier[0].naam)} bekijkt dit ook`
    : hier.length === 2
      ? `${voornaam(hier[0].naam)} en ${voornaam(hier[1].naam)} bekijken dit ook`
      : `${hier.length} collega's bekijken dit ook`;
  return (
    <Badge tone="oker" stil title={hier.map((a) => a.naam).join(', ')} className={cn('whitespace-nowrap [&>span:first-child]:shrink-0', className)}>
      <span className="min-w-0 truncate">{tekst}</span>
    </Badge>
  );
}
