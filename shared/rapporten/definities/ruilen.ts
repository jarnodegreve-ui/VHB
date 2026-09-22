import type { KolomToon, RapportDefinitie } from '../types.js';
import { keuzeUit } from './bouwstenen.js';

/**
 * Domein ruilen. Bron: `swaps` plus de logregels van de ruilen in het
 * activiteitenlog (`entity_type = 'swap'`), want alleen daar staat WANNEER een
 * wissel doorgevoerd is en WIE weigerde; `decidedat` op de ruil wordt door een
 * latere terugdraai overschreven. Die logregels ruimt de nachtcron nooit op.
 * Laders: api/_lib/rapporten/ruilen.ts.
 */

/** Soort wissel. Een handmatige wissel is door de planning rechtstreeks in de planning gezet, zonder aanvraag. */
export const RUIL_SOORTEN = ['ruil', 'overname', 'handmatig'] as const;
export type RuilSoort = (typeof RUIL_SOORTEN)[number];
export const RUIL_SOORT_LABEL: Record<RuilSoort, string> = { ruil: 'Ruil', overname: 'Overname', handmatig: 'Handmatig' };

/**
 * Waar een ruil vandaag staat, in de woorden van het rapport. Rijker dan de
 * kolom `status`: "geannuleerd" valt uiteen in ingetrokken (door de aanvrager),
 * geannuleerd (door de planning, vóór de doorvoer) en teruggedraaid (ná de
 * doorvoer), en "afgewezen" in geweigerd (de collega weigerde) en afgewezen
 * (de planning wees af, of niet geregistreerd door wie: zie `ruilStand` in
 * shared/ruilUitkomst.ts). Korte labels: het filterveld is op de telefoon een halve regel breed.
 */
export const RUIL_STANDEN = ['bij-collega', 'bij-planning', 'goedgekeurd', 'afgehandeld', 'geweigerd', 'afgewezen', 'ingetrokken', 'geannuleerd', 'teruggedraaid'] as const;
export type RuilStand = (typeof RUIL_STANDEN)[number];
export const RUIL_STAND_LABEL: Record<RuilStand, string> = {
  'bij-collega': 'Bij collega',
  'bij-planning': 'Bij planning',
  goedgekeurd: 'Goedgekeurd',
  afgehandeld: 'Afgehandeld',
  geweigerd: 'Geweigerd',
  afgewezen: 'Afgewezen',
  ingetrokken: 'Ingetrokken',
  geannuleerd: 'Geannuleerd',
  teruggedraaid: 'Teruggedraaid',
};

/**
 * Alleen "bij planning" is een pil: daar moet de lezer (staf) zelf iets doen.
 * De rest is een rusttoestand; een teruggedraaide wissel krijgt het amber
 * puntje, zodat hij in een lijst van doorgevoerde wissels te vinden is.
 */
const STAND_TONEN: Record<string, KolomToon> = {
  [RUIL_STAND_LABEL['bij-collega']]: 'aandacht',
  [RUIL_STAND_LABEL['bij-planning']]: 'waarschuwing',
  [RUIL_STAND_LABEL.goedgekeurd]: 'goed',
  [RUIL_STAND_LABEL.afgehandeld]: 'rust',
  [RUIL_STAND_LABEL.geweigerd]: 'rust',
  [RUIL_STAND_LABEL.afgewezen]: 'rust',
  [RUIL_STAND_LABEL.ingetrokken]: 'rust',
  [RUIL_STAND_LABEL.geannuleerd]: 'rust',
  [RUIL_STAND_LABEL.teruggedraaid]: 'aandacht',
};

/** Wat de collega op de aanvraag antwoordde, uit het verloop (shared/ruilVerloop.ts). */
export const COLLEGA_ANTWOORD_LABEL = {
  geaccepteerd: 'Geaccepteerd',
  geweigerd: 'Geweigerd',
  'niet-afgewacht': 'Niet afgewacht',
  wacht: 'Wacht',
  geen: 'Geen antwoord',
  'niet-nodig': 'Niet nodig',
} as const;

const UITGEVOERDE_WISSELS: RapportDefinitie = {
  id: 'uitgevoerde-wissels',
  domein: 'ruilen',
  titel: 'Uitgevoerde wissels',
  omschrijving: 'Elke wissel op de dag dat hij in de planning is doorgevoerd: goedgekeurde ruilen en overnames, en wat de planning zelf wisselde. Een teruggedraaide wissel blijft staan.',
  filters: [{ soort: 'periode' }, { soort: 'chauffeur' }],
  kolommen: [
    { id: 'uitgevoerdOp', titel: 'Uitgevoerd', kort: 'Uitgev.', type: 'datum', sorteerOp: 'uitgevoerdMoment' },
    // Telefoon: de soort onder de dag, daarnaast wie de dienst afgaf en welke
    // dienst; naar wie, de dienstdag en de rest staan achter het scrollen.
    // Breed: de status staat vóór de tegendienst en de uitvoerder, zodat ze op
    // 1440 px in beeld blijft als de namen lang zijn.
    { id: 'van', titel: 'Van', type: 'tekst' },
    { id: 'naar', titel: 'Naar', type: 'tekst', smal: 'achteraan' },
    { id: 'dienstdatum', titel: 'Dienstdatum', kort: 'Dienstdag', type: 'datum', smal: 'achteraan' },
    { id: 'dienst', titel: 'Dienst', type: 'tekst', code: true },
    { id: 'soort', titel: 'Soort', type: 'tekst', smal: 'onderEerste' },
    { id: 'status', titel: 'Status', type: 'tekst', tonen: STAND_TONEN, smal: 'achteraan' },
    { id: 'tegenDatum', titel: 'Tegendatum', kort: 'Tegen op', type: 'datum', smal: 'achteraan' },
    { id: 'tegenDienst', titel: 'Tegendienst', kort: 'Tegen', type: 'tekst', code: true, smal: 'achteraan' },
    { id: 'door', titel: 'Uitgevoerd door', kort: 'Door', type: 'tekst', smal: 'achteraan' },
  ],
  sortering: { kolom: 'uitgevoerdOp', richting: 'desc' },
  print: 'liggend',
  bronNaam: 'uitgevoerde wissels',
  geenBron: { tekst: 'Een wissel komt hier zodra de planning een ruil goedkeurt of zelf een dienst overzet.', actie: { label: 'Naar Dienstruil', view: 'ruil-verzoeken' } },
};

const RUILEN_PER_CHAUFFEUR: RapportDefinitie = {
  id: 'ruilen-per-chauffeur',
  domein: 'ruilen',
  titel: 'Ruilen per chauffeur',
  omschrijving: 'Per chauffeur: hoeveel ruilen hij aanvroeg en ontving in de periode, en hoe ze afliepen (geweigerd door de collega, afgewezen door de planning). Wat de planning zelf wisselde staat apart.',
  filters: [{ soort: 'periode', standaard: 'dit-jaar' }],
  kolommen: [
    { id: 'naam', titel: 'Chauffeur', type: 'tekst' },
    // Telefoon: aangevraagd, ontvangen en goedgekeurd in beeld, de rest achter het scrollen.
    { id: 'aangevraagd', titel: 'Aangevraagd', kort: 'Aangevr.', type: 'getal', totaal: true },
    { id: 'ontvangen', titel: 'Ontvangen', kort: 'Ontv.', type: 'getal', totaal: true },
    { id: 'goedgekeurd', titel: 'Goedgekeurd', kort: 'Goedg.', type: 'getal', totaal: true },
    // Geweigerd = de collega weigerde; Afgewezen = de planning wees af (of niet geregistreerd door wie).
    { id: 'geweigerd', titel: 'Geweigerd', kort: 'Geweig.', type: 'getal', totaal: true, smal: 'achteraan' },
    { id: 'afgewezen', titel: 'Afgewezen', kort: 'Afgew.', type: 'getal', totaal: true, smal: 'achteraan' },
    { id: 'ingetrokken', titel: 'Ingetrokken', kort: 'Ingetr.', type: 'getal', totaal: true, smal: 'achteraan' },
    { id: 'teruggedraaid', titel: 'Teruggedraaid', kort: 'Terug', type: 'getal', totaal: true, smal: 'achteraan' },
    { id: 'open', titel: 'Nog open', kort: 'Open', type: 'getal', totaal: true, smal: 'achteraan' },
    { id: 'doorPlanning', titel: 'Door planning', kort: 'Planning', type: 'getal', totaal: true, smal: 'achteraan' },
  ],
  sortering: { kolom: 'naam', richting: 'asc' },
  print: 'liggend',
  bronNaam: 'ruilaanvragen',
  geenBron: { tekst: 'Een ruil komt hier zodra een chauffeur er één aanvraagt.', actie: { label: 'Naar Dienstruil', view: 'ruil-verzoeken' } },
};

const RUILAANVRAGEN: RapportDefinitie = {
  id: 'ruilaanvragen',
  domein: 'ruilen',
  titel: 'Ruilaanvragen',
  omschrijving: 'Elke ruil die in de periode is aangevraagd of door de planning ingevoerd: wat de collega antwoordde, wie besliste en de doorlooptijd in dagen (een open aanvraag telt door tot vandaag).',
  peildatum: true,
  filters: [
    { soort: 'periode', standaard: 'dit-jaar' },
    keuzeUit('status', 'Status', RUIL_STANDEN, RUIL_STAND_LABEL),
    { soort: 'chauffeur' },
    keuzeUit('soort', 'Soort', RUIL_SOORTEN, RUIL_SOORT_LABEL),
  ],
  kolommen: [
    { id: 'aangevraagdOp', titel: 'Aangevraagd op', kort: 'Aangevr.', type: 'datum', sorteerOp: 'aangevraagdMoment' },
    // Telefoon: de status onder de dag, de aanvrager en de dienst in beeld.
    { id: 'aanvrager', titel: 'Aanvrager', type: 'tekst' },
    { id: 'collega', titel: 'Collega', type: 'tekst', smal: 'achteraan' },
    { id: 'dienstdatum', titel: 'Dienstdatum', kort: 'Dienstdag', type: 'datum', smal: 'achteraan' },
    { id: 'dienst', titel: 'Dienst', type: 'tekst', code: true },
    { id: 'soort', titel: 'Soort', type: 'tekst', smal: 'achteraan' },
    { id: 'status', titel: 'Status', type: 'tekst', tonen: STAND_TONEN, smal: 'onderEerste' },
    { id: 'antwoord', titel: 'Antwoord collega', kort: 'Antwoord', type: 'tekst', smal: 'achteraan' },
    { id: 'beslistOp', titel: 'Beslist op', kort: 'Beslist', type: 'datum', smal: 'achteraan' },
    { id: 'door', titel: 'Door wie', type: 'tekst', smal: 'achteraan' },
    { id: 'doorlooptijd', titel: 'Doorlooptijd', kort: 'Dagen', type: 'getal', totaal: 'gemiddelde', smal: 'achteraan' },
  ],
  sortering: { kolom: 'aangevraagdOp', richting: 'desc' },
  print: 'liggend',
  bronNaam: 'ruilaanvragen',
  geenBron: { tekst: 'Een ruil komt hier zodra een chauffeur er één aanvraagt.', actie: { label: 'Naar Dienstruil', view: 'ruil-verzoeken' } },
};

export const RUIL_RAPPORTEN: readonly RapportDefinitie[] = [UITGEVOERDE_WISSELS, RUILEN_PER_CHAUFFEUR, RUILAANVRAGEN];
