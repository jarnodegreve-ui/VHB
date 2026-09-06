import { useRoute } from '../app/router';
import { useAanwezigen } from '../lib/presence';
import { Badge } from './primitives';

const voornaam = (naam: string) => naam.trim().split(/\s+/)[0] || naam;

/**
 * Stille chip in de PageHeader-acties van beheerschermen die hele collecties
 * opslaan: "Pieter bekijkt dit ook" zodra een andere staf-gebruiker op
 * hetzelfde scherm zit. Eén gedeelde component — de views geven alleen
 * `<AanwezigOpScherm />` mee; welk scherm "dit" is, komt uit de router.
 * Rendert niets als er niemand is (geen lege plek in de kop).
 */
export function AanwezigOpScherm() {
  const { view } = useRoute();
  const hier = useAanwezigen().filter((a) => a.view === view);
  if (hier.length === 0) return null;
  const tekst = hier.length === 1
    ? `${voornaam(hier[0].naam)} bekijkt dit ook`
    : hier.length === 2
      ? `${voornaam(hier[0].naam)} en ${voornaam(hier[1].naam)} bekijken dit ook`
      : `${hier.length} collega's bekijken dit ook`;
  return (
    <Badge tone="oker" stil title={hier.map((a) => a.naam).join(', ')} className="whitespace-nowrap">
      {tekst}
    </Badge>
  );
}
