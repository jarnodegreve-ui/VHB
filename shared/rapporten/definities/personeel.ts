import type { RapportDefinitie, RapportFilter } from '../types.js';
import { ROLLEN, ROL_LABELS } from '../../schemas/constanten.js';
import { RESTEREND_KOLOM, TERMIJN_FILTER, VERVAL_STATUS_KOLOM, keuzeUit } from './bouwstenen.js';

/**
 * De rapporten van het domein Personeel (stap 3, 21-09): de contactlijst, de
 * volledige lijst van actieve medewerkers, en de twee vervaldata per
 * chauffeur (medische schifting en vakbekwaamheid). De laders staan in
 * api/_lib/rapporten/personeel.ts; de twee vervalrapporten delen één lader
 * met een vaste soort.
 */

/** De secties van de maandplanning (zelfde lijst als in Gebruikersbeheer). */
export const SECTIES = ['Reguliere', 'Nacht', 'Flexi', 'Schoolvervoer'] as const;
/** Filterwaarde voor wie geen sectie heeft (staf, techniekers). */
export const ZONDER_SECTIE = 'geen';

const ROL_FILTER = keuzeUit('rol', 'Rol', ROLLEN, ROL_LABELS);
const SECTIE_FILTER: RapportFilter = {
  soort: 'keuze',
  id: 'sectie',
  label: 'Sectie',
  opties: [
    { waarde: 'alle', label: 'Alle' },
    ...SECTIES.map((s) => ({ waarde: s, label: s })),
    { waarde: ZONDER_SECTIE, label: 'Zonder sectie' },
  ],
};

const CONTACTLIJST: RapportDefinitie = {
  id: 'contactlijst',
  domein: 'personeel',
  titel: 'Contactlijst',
  omschrijving: 'Telefoon en e-mail van elke actieve medewerker, ook wie niet in de gedeelde contactlijst van de chauffeurs staat.',
  filters: [ROL_FILTER, SECTIE_FILTER],
  kolommen: [
    { id: 'naam', titel: 'Naam', type: 'tekst' },
    // Telefoon: rol en sectie onder de naam, het nummer ernaast; de rest schuift erachter.
    { id: 'rol', titel: 'Rol', type: 'tekst', smal: 'onderEerste' },
    { id: 'sectie', titel: 'Sectie', type: 'tekst', smal: 'onderEerste' },
    { id: 'telefoon', titel: 'Telefoon', type: 'tekst' },
    { id: 'email', titel: 'E-mail', type: 'tekst', smal: 'achteraan' },
    // Het vlagje regelt wat chauffeurs van elkaar zien; dit rapport toont iedereen en zegt wie daar ontbreekt.
    { id: 'gedeeld', titel: 'In gedeelde contactlijst', kort: 'Gedeeld', type: 'janee', smal: 'achteraan' },
  ],
  sortering: { kolom: 'naam', richting: 'asc' },
  print: 'staand',
  bronNaam: 'medewerkers',
};

const ACTIEVEN: RapportDefinitie = {
  id: 'actieve-medewerkers',
  domein: 'personeel',
  titel: 'Volledige lijst actieven',
  omschrijving: 'Elke actieve medewerker met personeelsnummer, rol, sectie, datum in dienst en anciënniteit.',
  filters: [ROL_FILTER, SECTIE_FILTER],
  kolommen: [
    { id: 'naam', titel: 'Naam', type: 'tekst' },
    { id: 'personeelsnr', titel: 'Personeelsnr.', type: 'tekst', smal: 'onderEerste' },
    { id: 'rol', titel: 'Rol', type: 'tekst', smal: 'achteraan' },
    { id: 'sectie', titel: 'Sectie', type: 'tekst', smal: 'onderEerste' },
    { id: 'inDienst', titel: 'In dienst sinds', kort: 'In dienst', type: 'datum' },
    // De totaalrij telt de mensen ("Totaal (41)") en geeft de gemiddelde anciënniteit.
    { id: 'ancienniteit', titel: 'Anciënniteit (jaar)', kort: 'Anc.', type: 'getal', decimalen: 1, totaal: 'gemiddelde' },
    { id: 'telefoon', titel: 'Telefoon', type: 'tekst', smal: 'achteraan' },
  ],
  sortering: { kolom: 'naam', richting: 'asc' },
  print: 'staand',
  bronNaam: 'medewerkers',
  peildatum: true,
};

/** De soorten in `user_expiries` die een eigen rapport hebben. */
export const PERSONEEL_VERVAL_RAPPORTEN = { 'medische-schiftingen': 'medische_schifting', vakbekwaamheden: 'code95' } as const;
export type PersoneelVervalRapport = keyof typeof PERSONEEL_VERVAL_RAPPORTEN;

const vervalRapport = (id: PersoneelVervalRapport, titel: string, omschrijving: string, bronNaam: string): RapportDefinitie => ({
  id,
  domein: 'personeel',
  titel,
  omschrijving,
  filters: [TERMIJN_FILTER, { soort: 'chauffeur' }],
  kolommen: [
    { id: 'naam', titel: 'Naam', type: 'tekst' },
    { id: 'personeelsnr', titel: 'Personeelsnr.', type: 'tekst', smal: 'onderEerste' },
    { id: 'geldigTot', titel: 'Geldig tot', type: 'datum' },
    RESTEREND_KOLOM,
    VERVAL_STATUS_KOLOM,
    { id: 'bijgewerktOp', titel: 'Bijgewerkt op', type: 'datum', smal: 'achteraan' },
  ],
  // Dringendste eerst; wie geen datum heeft sorteert vanzelf onderaan (leeg komt altijd laatst).
  sortering: { kolom: 'resterend', richting: 'asc' },
  print: 'staand',
  bronNaam,
  peildatum: true,
  geenBron: { tekst: 'Je vult ze in op het scherm Vervaldata.', actie: { label: 'Naar Vervaldata', view: 'vervaldata' } },
});

export const PERSONEEL_RAPPORTEN: readonly RapportDefinitie[] = [
  CONTACTLIJST,
  ACTIEVEN,
  vervalRapport('medische-schiftingen', 'Medische schiftingen', 'Tot wanneer de medische schifting van elke chauffeur geldt, het dringendste eerst. Wie geen datum heeft staat onderaan.', 'medische schiftingen'),
  vervalRapport('vakbekwaamheden', 'Vakbekwaamheden (code 95)', 'Tot wanneer de code 95 van elke chauffeur geldt, het dringendste eerst. Wie geen datum heeft staat onderaan.', 'vakbekwaamheden'),
];
