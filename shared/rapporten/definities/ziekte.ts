import type { RapportDefinitie } from '../types.js';

/**
 * Domein ziekte. Bron: de goedgekeurde ziekmeldingen in `leave`; de telling
 * staat in shared/ziekteInzicht.ts en is dezelfde als het jaaroverzicht van
 * het Ziekte-scherm (kalenderdagen, weekends inbegrepen, alleen t/m vandaag,
 * een dag telt per chauffeur één keer). Laders: api/_lib/rapporten/ziekte.ts.
 *
 * Standaard "dit jaar": ziekte lees je per jaar, zoals het scherm, en een
 * lopende maand is bijna altijd te weinig om iets te zien.
 */

const ZIEKTE_KALENDERDAGEN: RapportDefinitie = {
  id: 'ziekte-kalenderdagen',
  domein: 'ziekte',
  titel: 'Ziekte in kalenderdagen',
  omschrijving: 'Per chauffeur: aantal meldingen, ziektedagen in kalenderdagen en de langste periode, tot en met vandaag.',
  filters: [{ soort: 'periode', standaard: 'dit-jaar' }, { soort: 'chauffeur' }],
  kolommen: [
    { id: 'naam', titel: 'Chauffeur', type: 'tekst' },
    // Telefoon: het personeelsnummer onder de naam; meldingen, dagen en de
    // langste periode staan zonder scrollen in beeld, de datum erachter.
    { id: 'personeelsnr', titel: 'Personeelsnr.', type: 'tekst', smal: 'onderEerste' },
    { id: 'meldingen', titel: 'Meldingen', kort: 'Meld.', type: 'getal', totaal: true },
    { id: 'kalenderdagen', titel: 'Kalenderdagen', kort: 'Dagen', type: 'getal', totaal: true },
    { id: 'langstePeriode', titel: 'Langste periode (dagen)', kort: 'Langste', type: 'getal' },
    { id: 'laatsteMelding', titel: 'Laatste melding', kort: 'Laatste', type: 'datum', smal: 'achteraan' },
  ],
  sortering: { kolom: 'kalenderdagen', richting: 'desc' },
  print: 'staand',
  bronNaam: 'ziektegegevens',
};

const ZIEKTE_DETAILS: RapportDefinitie = {
  id: 'ziekte-details',
  domein: 'ziekte',
  titel: 'Details ziekte',
  omschrijving: 'Eén rij per ziekteperiode: van, tot en de kalenderdagen die binnen de gekozen periode vallen, tot en met vandaag.',
  filters: [{ soort: 'periode', standaard: 'dit-jaar' }, { soort: 'chauffeur' }],
  kolommen: [
    { id: 'naam', titel: 'Chauffeur', type: 'tekst' },
    // Telefoon: naam, van en tot in beeld (twee datums vullen de breedte); de
    // dagen volgen uit die twee en schuiven met de opmerking naar achteren.
    { id: 'personeelsnr', titel: 'Personeelsnr.', type: 'tekst', smal: 'onderEerste' },
    { id: 'van', titel: 'Van', type: 'datum' },
    { id: 'tot', titel: 'Tot', type: 'datum' },
    { id: 'kalenderdagen', titel: 'Kalenderdagen', kort: 'Dagen', type: 'getal', smal: 'achteraan' },
    { id: 'opmerking', titel: 'Opmerking', type: 'tekst', lang: true, smal: 'achteraan' },
  ],
  sortering: { kolom: 'van', richting: 'desc' },
  print: 'staand',
  bronNaam: 'ziektegegevens',
};

const ZIEKTE_PER_MAAND: RapportDefinitie = {
  id: 'ziekte-per-maand',
  domein: 'ziekte',
  titel: 'Ziekte per maand',
  omschrijving: 'Per maand: meldingen, kalenderdagen en hoeveel chauffeurs ziek waren, tot en met vandaag.',
  filters: [{ soort: 'periode', standaard: 'dit-jaar' }],
  kolommen: [
    { id: 'maand', titel: 'Maand', type: 'tekst', sorteerOp: 'maandSleutel' },
    // Alleen de kalenderdagen zijn een som van de maanden. Een melding over
    // twee maanden telt in beide, en een chauffeur die twee maanden ziek was is
    // één chauffeur: die twee totalen geeft de lader zelf mee.
    { id: 'meldingen', titel: 'Meldingen', kort: 'Meld.', type: 'getal' },
    { id: 'kalenderdagen', titel: 'Kalenderdagen', kort: 'Dagen', type: 'getal', totaal: true },
    { id: 'chauffeurs', titel: 'Aantal chauffeurs', kort: 'Chauff.', type: 'getal' },
  ],
  sortering: { kolom: 'maand', richting: 'asc' },
  print: 'staand',
  bronNaam: 'ziektegegevens',
};

export const ZIEKTE_RAPPORTEN: readonly RapportDefinitie[] = [ZIEKTE_KALENDERDAGEN, ZIEKTE_DETAILS, ZIEKTE_PER_MAAND];
