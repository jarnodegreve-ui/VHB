import type { KolomToon, RapportDefinitie } from '../types.js';

/**
 * Domein planning. Twee bronnen, elk met hun eigen waarheid:
 *  - het maandbord (planningsmatrix + goedgekeurde ruilen + afwezigheden), via
 *    dezelfde kern als het Maandoverzicht in de maandplanning
 *    (`berekenCelWaarheid` + `berekenMaandoverzicht`): Overzicht per chauffeur
 *    en, via de dekking-kern, Openstaande diensten;
 *  - de tabel `planning` (één rij per dienst-DEEL, met uren): Diensten per dag.
 * Het portaal houdt geen bus per dienst bij en toont bewust ook geen geplande
 * bus (beslissing Jarno 21-09): geen kolom Bus, geen voertuigfilter, geen
 * rapport per voertuig op de planning.
 * Laders: api/_lib/rapporten/planning.ts.
 */

const OVERZICHT_PER_CHAUFFEUR: RapportDefinitie = {
  id: 'overzicht-per-chauffeur',
  domein: 'planning',
  titel: 'Overzicht per chauffeur',
  omschrijving: 'Het maandoverzicht van de maandplanning over de maanden die je kiest: dagen met dienst, geplande uren (geen loonberekening), ziekte en betaalde afwezigheid.',
  // Hele maanden: het maandbord telt per kalendermaand, en alleen zo is één
  // maand hier cijfer voor cijfer het Maandoverzicht van die maand.
  filters: [{ soort: 'periode', heleMaanden: true }, { soort: 'chauffeur' }],
  kolommen: [
    { id: 'naam', titel: 'Chauffeur', type: 'tekst' },
    // Telefoon: de sectie onder de naam; dagen met dienst, uren en ziekte in beeld.
    { id: 'sectie', titel: 'Sectie', type: 'tekst', smal: 'onderEerste' },
    { id: 'diensten', titel: 'Dagen met dienst', kort: 'Dienst', type: 'getal', totaal: true },
    { id: 'minuten', titel: 'Geplande uren', kort: 'Uren', type: 'duur', totaal: true },
    { id: 'anderWerk', titel: 'Ander werk', kort: 'Ander', type: 'getal', totaal: true, smal: 'achteraan' },
    { id: 'ziek', titel: 'Ziektedagen', kort: 'Ziek', type: 'getal', totaal: true },
    { id: 'betaald', titel: 'Betaald afwezig', kort: 'Bet. afw.', type: 'getal', totaal: true, smal: 'achteraan' },
    { id: 'vrij', titel: 'Vrij', type: 'getal', totaal: true, smal: 'achteraan' },
    { id: 'overig', titel: 'Overig', type: 'getal', totaal: true, smal: 'achteraan' },
    { id: 'dagen', titel: 'Dagen ingepland', kort: 'Dagen', type: 'getal', totaal: true, smal: 'achteraan' },
  ],
  sortering: { kolom: 'naam', richting: 'asc' },
  print: 'liggend',
  bronNaam: 'planningsgegevens',
  geenBron: { tekst: 'De planning komt uit de import van de maandplanning.', actie: { label: 'Naar Beheer roosters', view: 'beheer-roosters' } },
};

const DIENSTEN_PER_DAG: RapportDefinitie = {
  id: 'diensten-per-dag',
  domein: 'planning',
  titel: 'Diensten per dag',
  omschrijving: 'De planning rij per rij: elk deel van elke dienst met start, einde, duur, loop en chauffeur. Een gesplitste dienst staat er met elk deel in.',
  filters: [{ soort: 'periode', standaard: 'deze-week', snelkeuze: 'dagen' }, { soort: 'chauffeur' }],
  kolommen: [
    { id: 'datum', titel: 'Datum', type: 'datum', sorteerOp: 'volgorde' },
    // Telefoon: dag en chauffeur onder de datum; dienst, start en einde in beeld.
    // Deel, duur en loop staan samen achter het scrollen: drie smalle kolommen
    // die na één veeg naast de vaste datum volledig in beeld staan.
    { id: 'dag', titel: 'Dag', type: 'tekst', sorteerOp: 'volgorde', smal: 'onderEerste' },
    { id: 'dienst', titel: 'Dienst', type: 'tekst', code: true },
    // Links: het deelnummer hoort bij de dienst ervoor, niet bij de starttijd erna.
    { id: 'deel', titel: 'Deel', type: 'getal', uitlijning: 'links', smal: 'achteraan' },
    { id: 'start', titel: 'Start', type: 'tijd' },
    { id: 'einde', titel: 'Einde', type: 'tijd' },
    { id: 'duur', titel: 'Duur', type: 'duur', smal: 'achteraan' },
    { id: 'loop', titel: 'Loop', type: 'tekst', code: true, smal: 'achteraan' },
    { id: 'chauffeur', titel: 'Chauffeur', type: 'tekst', smal: 'onderEerste' },
  ],
  sortering: { kolom: 'datum', richting: 'asc' },
  print: 'liggend',
  bronNaam: 'planningsgegevens',
  geenBron: { tekst: 'De planning komt uit de import van de maandplanning.', actie: { label: 'Naar Beheer roosters', view: 'beheer-roosters' } },
};

/** Wat er met een openstaande dienst aan de hand is. */
export const OPEN_STATUS_LABEL = { open: 'Open', ingevuld: 'Ingevuld' } as const;
const OPEN_TONEN: Record<string, KolomToon> = { [OPEN_STATUS_LABEL.open]: 'aandacht', [OPEN_STATUS_LABEL.ingevuld]: 'goed' };

const OPENSTAANDE_DIENSTEN: RapportDefinitie = {
  id: 'openstaande-diensten',
  domein: 'planning',
  titel: 'Openstaande diensten',
  omschrijving: 'Verwachte diensten zonder chauffeur, met de reden en wie een dienst intussen overnam. De toestand van nu, geen historiek van wanneer een gat ontstond; voorbije dagen staan er niet in.',
  peildatum: true,
  filters: [{ soort: 'periode', standaard: 'komende-4-weken', snelkeuze: 'vooruit' }],
  kolommen: [
    { id: 'datum', titel: 'Datum', type: 'datum', sorteerOp: 'volgorde' },
    // Telefoon: dag en status onder de datum (open of ingevuld mag niet achter het
    // scrollen verdwijnen); de dienst en de reden in beeld, het dagtype erachter.
    { id: 'dag', titel: 'Dag', type: 'tekst', sorteerOp: 'volgorde', smal: 'onderEerste' },
    { id: 'dagtype', titel: 'Dagtype', type: 'tekst', smal: 'achteraan' },
    { id: 'dienst', titel: 'Dienst', type: 'tekst', code: true },
    { id: 'reden', titel: 'Reden', type: 'tekst', lang: true },
    { id: 'ingevuldDoor', titel: 'Ingevuld door', kort: 'Ingevuld', type: 'tekst', smal: 'achteraan' },
    { id: 'status', titel: 'Status', type: 'tekst', tonen: OPEN_TONEN, smal: 'onderEerste' },
  ],
  sortering: { kolom: 'datum', richting: 'asc' },
  print: 'staand',
  bronNaam: 'openstaande diensten',
  geenBron: { tekst: 'Ze volgen uit de planning, en die komt uit de import van de maandplanning.', actie: { label: 'Naar Beheer roosters', view: 'beheer-roosters' } },
};

export const PLANNING_RAPPORTEN: readonly RapportDefinitie[] = [OVERZICHT_PER_CHAUFFEUR, DIENSTEN_PER_DAG, OPENSTAANDE_DIENSTEN];
