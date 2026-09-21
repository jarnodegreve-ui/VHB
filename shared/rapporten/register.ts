import type { RapportDefinitie, RapportDomein } from './types.js';
import { VOERTUIG_RAPPORTEN } from './definities/voertuigen.js';
import { PERSONEEL_RAPPORTEN } from './definities/personeel.js';

/**
 * Dé lijst van rapporten. Nieuw rapport:
 *  1. een definitie (id, domein, filters, kolommen, sortering, print) in het
 *     bestand van haar domein, shared/rapporten/definities/<domein>.ts; dit
 *     bestand voegt de domeinen alleen samen,
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
  { id: 'planning', titel: 'Planning', omschrijving: 'Roosters en diensten per chauffeur.' },
  { id: 'verlof', titel: 'Verlof', omschrijving: 'Saldo, opgenomen dagen en jaaroverzichten.' },
  { id: 'ziekte', titel: 'Ziekte', omschrijving: 'Ziekmeldingen en afwezigheid.' },
  { id: 'ruilen', titel: 'Ruilen', omschrijving: 'Dienstwissels en hun verloop.' },
  { id: 'voertuigen', titel: 'Voertuigen', omschrijving: 'Werken, defecten en het wagenpark.' },
  { id: 'personeel', titel: 'Personeel', omschrijving: 'Contactgegevens, de lijst van actieven en vervaldata per chauffeur.' },
  { id: 'uren', titel: 'Gewerkte uren', omschrijving: 'Prestaties per chauffeur en per periode.', volgtLater: true },
];

const VERLOFSALDO: RapportDefinitie = {
  id: 'verlofsaldo',
  domein: 'verlof',
  titel: 'Verlofsaldo',
  omschrijving: 'Betaald verlof per medewerker: budget, opgenomen, aangevraagd en wat nog vrij is.',
  filters: [{ soort: 'jaar' }, { soort: 'chauffeur', label: 'Medewerker' }],
  kolommen: [
    { id: 'naam', titel: 'Naam', type: 'tekst' },
    // Telefoon: de sectie staat onder de naam, Aangevraagd en Klein verlet
    // schuiven naar achteren (in die volgorde), zodat Budget, Opgenomen en Vrij
    // zonder scrollen in beeld staan.
    { id: 'sectie', titel: 'Sectie', type: 'tekst', smal: 'onderEerste' },
    { id: 'budget', titel: 'Budget', type: 'getal', totaal: true },
    { id: 'opgenomen', titel: 'Opgenomen', kort: 'Opgen.', type: 'getal', totaal: true },
    { id: 'aangevraagd', titel: 'Aangevraagd', kort: 'Aangevr.', type: 'getal', totaal: true, smal: 'achteraan' },
    { id: 'vrij', titel: 'Vrij', type: 'getal', totaal: true },
    { id: 'kleinVerlet', titel: 'Klein verlet', kort: 'Kl. verlet', type: 'getal', totaal: true, smal: 'achteraan' },
  ],
  sortering: { kolom: 'naam', richting: 'asc' },
  print: 'staand',
  bronNaam: 'verlofgegevens',
};

export const RAPPORTEN: readonly RapportDefinitie[] = [VERLOFSALDO, ...VOERTUIG_RAPPORTEN, ...PERSONEEL_RAPPORTEN];

const PER_ID = new Map(RAPPORTEN.map((r) => [r.id, r]));

export const rapportVan = (id: string | null | undefined): RapportDefinitie | undefined => (id ? PER_ID.get(id) : undefined);

export const rapportenVanDomein = (domein: RapportDomein): RapportDefinitie[] => RAPPORTEN.filter((r) => r.domein === domein);
