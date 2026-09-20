import type { RapportDefinitie, RapportDomein } from './types.js';

/**
 * Dé lijst van rapporten. Nieuw rapport:
 *  1. een definitie hier (id, domein, filters, kolommen, sortering, print),
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
    { id: 'sectie', titel: 'Sectie', type: 'tekst' },
    { id: 'budget', titel: 'Budget', type: 'getal', totaal: true },
    { id: 'opgenomen', titel: 'Opgenomen', type: 'getal', totaal: true },
    { id: 'aangevraagd', titel: 'Aangevraagd', type: 'getal', totaal: true },
    { id: 'vrij', titel: 'Vrij', type: 'getal', totaal: true },
    { id: 'kleinVerlet', titel: 'Klein verlet', type: 'getal', totaal: true },
  ],
  sortering: { kolom: 'naam', richting: 'asc' },
  print: 'staand',
  bronNaam: 'verlofgegevens',
};

export const RAPPORTEN: readonly RapportDefinitie[] = [VERLOFSALDO];

const PER_ID = new Map(RAPPORTEN.map((r) => [r.id, r]));

export const rapportVan = (id: string | null | undefined): RapportDefinitie | undefined => (id ? PER_ID.get(id) : undefined);

export const rapportenVanDomein = (domein: RapportDomein): RapportDefinitie[] => RAPPORTEN.filter((r) => r.domein === domein);
