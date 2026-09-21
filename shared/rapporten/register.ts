import type { RapportDefinitie, RapportDomein } from './types.js';
import { VERLOF_RAPPORTEN } from './definities/verlof.js';
import { ZIEKTE_RAPPORTEN } from './definities/ziekte.js';
import { VOERTUIG_RAPPORTEN } from './definities/voertuigen.js';
import { PERSONEEL_RAPPORTEN } from './definities/personeel.js';
import { RUIL_RAPPORTEN } from './definities/ruilen.js';
import { INZET_PER_VOERTUIG, PLANNING_RAPPORTEN } from './definities/planning.js';

/**
 * Dé lijst van rapporten. Nieuw rapport:
 *  1. een definitie in definities/<domein>.ts (id, domein, filters, kolommen,
 *     sortering, print), hieronder samengevoegd,
 *  2. een laadfunctie in api/_lib/rapporten/<id>.ts (puur: bron + filters →
 *     rijen + bereik) en één regel in de LADERS-tabel van
 *     api/_lib/rapportRoutes.ts,
 *  3. een unit-test op vaste cijfers.
 * Scherm, filters, tabel, CSV en printblad volgen vanzelf uit de definitie.
 */

export type DomeinDef = {
  id: RapportDomein;
  titel: string;
  omschrijving: string;
  /** Nog geen rapporten: in de catalogus uitgegrijsd als "volgt later". */
  volgtLater?: boolean;
};

/** Volgorde = volgorde in de catalogus. */
export const DOMEINEN: readonly DomeinDef[] = [
  { id: 'planning', titel: 'Planning', omschrijving: 'Roosters, diensten per dag en wat er nog open staat.' },
  { id: 'verlof', titel: 'Verlof', omschrijving: 'Saldo, aanvragen, bezetting en jaaroverzichten.' },
  { id: 'ziekte', titel: 'Ziekte', omschrijving: 'Ziekmeldingen in kalenderdagen, per chauffeur en per maand.' },
  { id: 'ruilen', titel: 'Ruilen', omschrijving: 'Uitgevoerde wissels, aanvragen en hun verloop.' },
  { id: 'voertuigen', titel: 'Voertuigen', omschrijving: 'Werken, defecten en het wagenpark.' },
  { id: 'personeel', titel: 'Personeel', omschrijving: 'Contactgegevens, de lijst van actieven en vervaldata per chauffeur.' },
  { id: 'uren', titel: 'Gewerkte uren', omschrijving: 'Prestaties per chauffeur en per periode.', volgtLater: true },
];

/**
 * De definities staan per domein in een eigen bestand (shared/rapporten/
 * definities/<domein>.ts), zodat twee mensen die elk aan een domein werken
 * elkaar hier niet in de weg zitten: dit bestand voegt ze alleen samen.
 * Volgorde = volgorde binnen het domein in de catalogus.
 */
export const RAPPORTEN: readonly RapportDefinitie[] = [
  ...PLANNING_RAPPORTEN, ...VERLOF_RAPPORTEN, ...ZIEKTE_RAPPORTEN, ...RUIL_RAPPORTEN,
  // Inzet per voertuig draait op de lader van Diensten per dag (definities/planning.ts) maar staat bij Voertuigen.
  ...VOERTUIG_RAPPORTEN, INZET_PER_VOERTUIG, ...PERSONEEL_RAPPORTEN,
];

const PER_ID = new Map(RAPPORTEN.map((r) => [r.id, r]));

export const rapportVan = (id: string | null | undefined): RapportDefinitie | undefined => (id ? PER_ID.get(id) : undefined);

export const rapportenVanDomein = (domein: RapportDomein): RapportDefinitie[] => RAPPORTEN.filter((r) => r.domein === domein);
