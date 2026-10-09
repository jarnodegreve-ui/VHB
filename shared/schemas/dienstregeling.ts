import { z } from './zod.js';
import { isoDatum, optioneel } from './basis.js';

/**
 * Dienstregelingversies (fase 1, 08-10): de body van het aanmaken en het
 * bijwerken van een versie. De regels over de datum (niet in het verleden,
 * uniek) toetst de server tegen de bestaande versies.
 */
export const DIENSTREGELING_NAAM_MAX = 80;
export const DIENSTREGELING_OPMERKING_MAX = 300;

const naam = optioneel(z.string().trim().max(DIENSTREGELING_NAAM_MAX, `Hoogstens ${DIENSTREGELING_NAAM_MAX} tekens`));
const opmerking = optioneel(z.string().trim().max(DIENSTREGELING_OPMERKING_MAX, `Hoogstens ${DIENSTREGELING_OPMERKING_MAX} tekens`));

export const dienstregelingBodySchema = z.object({
  geldigVanaf: isoDatum('Kies de dag vanaf wanneer de dienstregeling geldt'),
  naam,
  opmerking,
  /** Versie waarvan de diensten gekopieerd worden; leeg = de versie die op de dag ervoor geldt. */
  kopieVan: optioneel(z.string().trim().max(80)),
  /** Chauffeurs een melding sturen dat er vanaf die dag een nieuwe dienstregeling geldt (standaard wel). */
  melden: optioneel(z.boolean()),
});
export type DienstregelingBody = z.output<typeof dienstregelingBodySchema>;

export const dienstregelingPatchSchema = z.object({
  geldigVanaf: optioneel(isoDatum('Kies een geldige dag')),
  naam,
  opmerking,
});
export type DienstregelingPatch = z.output<typeof dienstregelingPatchSchema>;
