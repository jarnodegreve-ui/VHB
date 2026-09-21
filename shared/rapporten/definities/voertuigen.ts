import type { KolomToon, RapportDefinitie, RapportFilter } from '../types.js';
import {
  AANDRIJVINGEN, AANDRIJVING_LABEL, DEFECT_STATUSSEN, DEFECT_STATUS_LABEL, VOERTUIG_CATEGORIEEN, VOERTUIG_CATEGORIE_LABEL,
  VOERTUIG_STATUS_LABEL, VOERTUIG_VERVAL_LABEL, VOERTUIG_VERVAL_SOORTEN, WERKCODES, WERKCODE_LABEL, WERKTYPES, WERKTYPE_LABEL,
} from '../../techniek.js';
import { GELDIG_TOT_KOLOM, RESTEREND_KOLOM, TERMIJN_FILTER, VERVAL_STATUS_KOLOM, keuzeUit } from './bouwstenen.js';

/**
 * De rapporten van het domein Voertuigen (stap 3, 21-09): het wagenpark zoals
 * in het Access-menu (overzicht, gemiddelde leeftijd, technische gegevens,
 * samenvatting), plus vervaldata, het gele boek en de uitgevoerde werken.
 * De laders staan in api/_lib/rapporten/voertuigen.ts.
 */

/** Wat uit dienst is staat standaard niet in de lijst; wie het wil zien kiest het zelf. */
const STATUS_FILTER: RapportFilter = {
  soort: 'keuze',
  id: 'status',
  label: 'Status',
  opties: [
    { waarde: 'in_dienst', label: 'In dienst (actief en reserve)' },
    { waarde: 'actief', label: VOERTUIG_STATUS_LABEL.actief },
    { waarde: 'reserve', label: VOERTUIG_STATUS_LABEL.reserve },
    { waarde: 'uit_dienst', label: VOERTUIG_STATUS_LABEL.uit_dienst },
    { waarde: 'alle', label: 'Alle, ook uit dienst' },
  ],
};
const CATEGORIE_FILTER = keuzeUit('categorie', 'Categorie', VOERTUIG_CATEGORIEEN, VOERTUIG_CATEGORIE_LABEL);
const AANDRIJVING_FILTER = keuzeUit('aandrijving', 'Aandrijving', AANDRIJVINGEN, AANDRIJVING_LABEL);

const WAGENPARK_FILTERS = [STATUS_FILTER, CATEGORIE_FILTER, AANDRIJVING_FILTER] as const;

/** Rusttoestand = puntje, alleen "Uit dienst" valt op. */
const STATUS_TONEN: Record<string, KolomToon> = {
  [VOERTUIG_STATUS_LABEL.actief]: 'goed',
  [VOERTUIG_STATUS_LABEL.reserve]: 'rust',
  [VOERTUIG_STATUS_LABEL.uit_dienst]: 'waarschuwing',
};

const DEFECT_TONEN: Record<string, KolomToon> = {
  // Open is in het gele boek de gewone toestand: een amber puntje, geen pil op elke rij.
  [DEFECT_STATUS_LABEL.open]: 'aandacht',
  [DEFECT_STATUS_LABEL.uitgevoerd]: 'goed',
  [DEFECT_STATUS_LABEL.geannuleerd]: 'rust',
};

const WAGENPARK_GEEN_BRON = { tekst: 'Voertuigen voeg je toe op het scherm Voertuigen.', actie: { label: 'Naar Voertuigen', view: 'voertuigen' } } as const;

const WAGENPARK_OVERZICHT: RapportDefinitie = {
  id: 'wagenpark-overzicht',
  domein: 'voertuigen',
  titel: 'Wagenpark, overzicht',
  omschrijving: 'Elk voertuig met nummerplaat, merk, aandrijving, zitplaatsen, datum in dienst en leeftijd.',
  filters: WAGENPARK_FILTERS,
  kolommen: [
    { id: 'busnr', titel: 'Busnr.', type: 'tekst' },
    // Telefoon: de nummerplaat onder het busnummer; merk en leeftijd staan
    // zonder scrollen in beeld, de rest schuift erachter.
    { id: 'nummerplaat', titel: 'Nummerplaat', type: 'tekst', smal: 'onderEerste' },
    { id: 'merk', titel: 'Merk', type: 'tekst', breed: true },
    { id: 'type', titel: 'Type', type: 'tekst', smal: 'achteraan' },
    { id: 'aandrijving', titel: 'Aandrijving', type: 'tekst', smal: 'achteraan' },
    { id: 'categorie', titel: 'Categorie', type: 'tekst', smal: 'achteraan' },
    { id: 'zitplaatsen', titel: 'Zitplaatsen', kort: 'Zitpl.', type: 'getal', totaal: 'som', smal: 'achteraan' },
    { id: 'inDienst', titel: 'In dienst', type: 'datum', smal: 'achteraan' },
    { id: 'leeftijd', titel: 'Leeftijd (jaar)', kort: 'Leeft.', type: 'getal', decimalen: 1, totaal: 'gemiddelde' },
    { id: 'status', titel: 'Status', type: 'tekst', tonen: STATUS_TONEN, smal: 'achteraan' },
  ],
  sortering: { kolom: 'busnr', richting: 'asc' },
  print: 'liggend',
  bronNaam: 'voertuigen',
  peildatum: true,
  geenBron: WAGENPARK_GEEN_BRON,
};

const WAGENPARK_LEEFTIJD: RapportDefinitie = {
  id: 'wagenpark-leeftijd',
  domein: 'voertuigen',
  titel: 'Wagenpark, gemiddelde leeftijd',
  omschrijving: 'Aantal, gemiddelde leeftijd, oudste en jongste per groep, met de hele vloot als totaal. Zonder wat uit dienst is.',
  filters: [
    {
      soort: 'keuze',
      id: 'groep',
      label: 'Groeperen per',
      opties: [
        { waarde: 'categorie', label: 'Categorie' },
        { waarde: 'type', label: 'Type' },
        { waarde: 'merk', label: 'Merk' },
        { waarde: 'aandrijving', label: 'Aandrijving' },
      ],
    },
    CATEGORIE_FILTER,
  ],
  kolommen: [
    { id: 'groep', titel: 'Groep', type: 'tekst' },
    { id: 'aantal', titel: 'Aantal', type: 'getal', totaal: 'som' },
    // Gewogen met het aantal voertuigen mét een datum in dienst: het gemiddelde
    // van de vloot is niet het gemiddelde van de groepsgemiddelden.
    { id: 'gemiddeld', titel: 'Gemiddelde leeftijd (jaar)', kort: 'Gem.', type: 'getal', decimalen: 1, totaal: 'gemiddelde', totaalGewicht: 'metLeeftijd' },
    { id: 'oudste', titel: 'Oudste (jaar)', kort: 'Oudste', type: 'getal', decimalen: 1, totaal: 'max' },
    { id: 'jongste', titel: 'Jongste (jaar)', kort: 'Jongste', type: 'getal', decimalen: 1, totaal: 'min', smal: 'achteraan' },
  ],
  sortering: { kolom: 'groep', richting: 'asc' },
  print: 'staand',
  bronNaam: 'voertuigen',
  peildatum: true,
  geenBron: WAGENPARK_GEEN_BRON,
};

const WAGENPARK_TECHNISCH: RapportDefinitie = {
  id: 'wagenpark-technisch',
  domein: 'voertuigen',
  titel: 'Wagenpark, technische gegevens',
  omschrijving: 'Nummerplaat, chassisnummer, merk, type, aandrijving, zitplaatsen en opmerking per voertuig.',
  filters: WAGENPARK_FILTERS,
  kolommen: [
    { id: 'busnr', titel: 'Busnr.', type: 'tekst' },
    { id: 'nummerplaat', titel: 'Nummerplaat', type: 'tekst', smal: 'onderEerste' },
    // Het chassisnummer is waarvoor dit rapport dient: op de telefoon meteen naast het busnummer.
    { id: 'chassisnr', titel: 'Chassisnr.', type: 'tekst' },
    { id: 'merk', titel: 'Merk', type: 'tekst', breed: true, smal: 'achteraan' },
    { id: 'type', titel: 'Type', type: 'tekst', smal: 'achteraan' },
    { id: 'aandrijving', titel: 'Aandrijving', type: 'tekst', smal: 'achteraan' },
    { id: 'zitplaatsen', titel: 'Zitplaatsen', kort: 'Zitpl.', type: 'getal', totaal: 'som', smal: 'achteraan' },
    { id: 'inDienst', titel: 'In dienst', type: 'datum', smal: 'achteraan' },
    { id: 'opmerking', titel: 'Opmerking', type: 'tekst', breed: true, smal: 'achteraan' },
  ],
  sortering: { kolom: 'busnr', richting: 'asc' },
  print: 'liggend',
  bronNaam: 'voertuigen',
  geenBron: WAGENPARK_GEEN_BRON,
};

const WAGENPARK_SAMENVATTING: RapportDefinitie = {
  id: 'wagenpark-samenvatting',
  domein: 'voertuigen',
  titel: 'Wagenpark, samenvatting technische data',
  omschrijving: 'Telling per merk, type en aandrijving: aantal, totaal zitplaatsen en gemiddelde leeftijd. Zonder wat uit dienst is.',
  filters: [CATEGORIE_FILTER],
  kolommen: [
    { id: 'merk', titel: 'Merk', type: 'tekst' },
    // Telefoon: type en aandrijving samen onder het merk, de drie cijfers ernaast.
    { id: 'type', titel: 'Type', type: 'tekst', smal: 'onderEerste' },
    { id: 'aandrijving', titel: 'Aandrijving', type: 'tekst', smal: 'onderEerste' },
    { id: 'aantal', titel: 'Aantal', type: 'getal', totaal: 'som' },
    { id: 'zitplaatsen', titel: 'Zitplaatsen', kort: 'Zitpl.', type: 'getal', totaal: 'som' },
    { id: 'gemiddeld', titel: 'Gemiddelde leeftijd (jaar)', kort: 'Gem.', type: 'getal', decimalen: 1, totaal: 'gemiddelde', totaalGewicht: 'metLeeftijd' },
  ],
  sortering: { kolom: 'merk', richting: 'asc' },
  print: 'staand',
  bronNaam: 'voertuigen',
  peildatum: true,
  geenBron: WAGENPARK_GEEN_BRON,
};

const VERVALDATA_VOERTUIGEN: RapportDefinitie = {
  id: 'vervaldata-voertuigen',
  domein: 'voertuigen',
  titel: 'Vervaldata voertuigen',
  omschrijving: 'Keuring, brandblussers en tachograaf per voertuig, het dringendste eerst.',
  filters: [TERMIJN_FILTER, keuzeUit('soort', 'Soort', VOERTUIG_VERVAL_SOORTEN, VOERTUIG_VERVAL_LABEL), { soort: 'voertuig' }],
  kolommen: [
    { id: 'busnr', titel: 'Busnr.', type: 'tekst' },
    { id: 'nummerplaat', titel: 'Nummerplaat', type: 'tekst', smal: 'verberg' },
    // Drie soorten per bus: op de telefoon staat de soort onder het busnummer.
    { id: 'soort', titel: 'Soort', type: 'tekst', smal: 'onderEerste' },
    GELDIG_TOT_KOLOM,
    RESTEREND_KOLOM,
    VERVAL_STATUS_KOLOM,
    { id: 'opmerking', titel: 'Opmerking', type: 'tekst', breed: true, smal: 'achteraan' },
  ],
  sortering: { kolom: 'resterend', richting: 'asc' },
  print: 'staand',
  bronNaam: 'vervaldata van voertuigen',
  peildatum: true,
  geenBron: { tekst: 'Je vult ze in op de fiche van een voertuig, onder Vervaldata.', actie: { label: 'Naar Voertuigen', view: 'voertuigen' } },
};

const DEFECTEN: RapportDefinitie = {
  id: 'defecten',
  domein: 'voertuigen',
  titel: 'Defecten (gele boek)',
  omschrijving: 'Elke melding uit het gele boek met status, uitvoering, manuren en doorlooptijd in dagen.',
  filters: [
    { soort: 'periode' },
    { soort: 'voertuig' },
    keuzeUit('werktype', 'Werktype', WERKTYPES, WERKTYPE_LABEL),
    keuzeUit('status', 'Status', DEFECT_STATUSSEN, DEFECT_STATUS_LABEL),
  ],
  kolommen: [
    { id: 'gemeldOp', titel: 'Gemeld op', type: 'datum' },
    // Telefoon: bus en werktype onder de datum, daarnaast de omschrijving en de
    // doorlooptijd; wie, wanneer uitgevoerd en de manuren schuiven erachter.
    { id: 'bus', titel: 'Bus', type: 'tekst', smal: 'onderEerste' },
    { id: 'werktype', titel: 'Werktype', type: 'tekst', smal: 'onderEerste' },
    { id: 'omschrijving', titel: 'Omschrijving', type: 'tekst', breed: true },
    { id: 'status', titel: 'Status', type: 'tekst', tonen: DEFECT_TONEN, smal: 'achteraan' },
    // In dagen (staat in de omschrijving; de kop blijft kort). Open = tot de peildatum; het totaal is
    // de gemiddelde doorlooptijd. Bewust vóór wie en wanneer: op een scherm waar elf kolommen niet
    // passen schuift het detail weg, niet het cijfer waar het rapport om draait.
    { id: 'doorlooptijd', titel: 'Doorlooptijd', kort: 'Dagen', type: 'getal', totaal: 'gemiddelde', decimalen: 0 },
    { id: 'gemeldDoor', titel: 'Gemeld door', type: 'tekst', smal: 'achteraan' },
    { id: 'uitgevoerdOp', titel: 'Uitgevoerd op', type: 'datum', smal: 'achteraan' },
    { id: 'uitgevoerdDoor', titel: 'Uitvoerder', type: 'tekst', smal: 'achteraan' },
    { id: 'manuren', titel: 'Manuren', type: 'getal', totaal: 'som', smal: 'achteraan' },
  ],
  sortering: { kolom: 'gemeldOp', richting: 'desc' },
  print: 'liggend',
  bronNaam: 'meldingen in het gele boek',
  peildatum: true,
  geenBron: { tekst: 'Een defect melden kan vanaf Mijn dag of in het gele boek.', actie: { label: 'Naar het gele boek', view: 'defecten' } },
};

const UITGEVOERDE_WERKEN: RapportDefinitie = {
  id: 'uitgevoerde-werken',
  domein: 'voertuigen',
  titel: 'Uitgevoerde werken',
  omschrijving: 'De werkprestaties van de garage per dag, bus en mecanicien, met het totaal aan werkuren.',
  filters: [
    { soort: 'periode' },
    { soort: 'voertuig' },
    { soort: 'chauffeur', label: 'Mecanicien', rollen: ['technieker', 'planner', 'admin'] },
    keuzeUit('werkcode', 'Werkcode', WERKCODES, WERKCODE_LABEL),
  ],
  kolommen: [
    { id: 'datum', titel: 'Datum', type: 'datum' },
    { id: 'bus', titel: 'Bus', type: 'tekst', smal: 'onderEerste' },
    { id: 'werkcode', titel: 'Werkcode', type: 'tekst', smal: 'onderEerste' },
    { id: 'omschrijving', titel: 'Omschrijving', type: 'tekst', breed: true },
    { id: 'mecanicien', titel: 'Mecanicien', type: 'tekst', smal: 'achteraan' },
    { id: 'begin', titel: 'Begin', type: 'tekst', smal: 'achteraan' },
    { id: 'einde', titel: 'Einde', type: 'tekst', smal: 'achteraan' },
    // Werkuren staan als uren met twee decimalen in de tabel (numeric(5,2)) en het
    // portaal toont ze overal zo ("1,5 u"); omrekenen naar minuten zou afronden.
    { id: 'werkuren', titel: 'Werkuren', kort: 'Uren', type: 'getal', totaal: 'som' },
  ],
  sortering: { kolom: 'datum', richting: 'desc' },
  print: 'liggend',
  bronNaam: 'werkprestaties',
  geenBron: { tekst: 'De techniekers vullen ze in op het scherm Werkprestaties.', actie: { label: 'Naar Werkprestaties', view: 'werkprestaties' } },
};

export const VOERTUIG_RAPPORTEN: readonly RapportDefinitie[] = [
  WAGENPARK_OVERZICHT, WAGENPARK_LEEFTIJD, WAGENPARK_TECHNISCH, WAGENPARK_SAMENVATTING, VERVALDATA_VOERTUIGEN, DEFECTEN, UITGEVOERDE_WERKEN,
];
