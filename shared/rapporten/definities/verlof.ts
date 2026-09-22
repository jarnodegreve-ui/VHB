import type { RapportDefinitie, RapportKolom } from '../types.js';
import { AANVRAAG_STATUS } from '../../status.js';

/**
 * Domein verlof. Bron: `leave` zonder de ziekmeldingen (die staan in dezelfde
 * tabel maar horen bij het domein ziekte). Laders: api/_lib/rapporten/
 * verlofsaldo.ts en verlof.ts.
 */

/**
 * De verloftypes die een chauffeur kan aanvragen, met hun label. Bewust een
 * derde kopie naast api/helpers.ts (LEAVE_TYPE_LABEL) en src/lib/format.ts
 * (LEAVE_TYPE_LABELS): shared/ mag uit geen van beide importeren. De
 * drift-test in src/rapportVerlof.test.ts houdt ze gelijk.
 */
export const VERLOF_TYPE_LABEL: Readonly<Record<string, string>> = {
  betaald_verlof: 'Betaald verlof',
  klein_verlet: 'Klein verlet',
};

/** Korte kolomkop per type voor de telefoon. */
const VERLOF_TYPE_KORT: Readonly<Record<string, string>> = {
  betaald_verlof: 'Betaald',
  klein_verlet: 'Kl. verlet',
};

/** Label van een type; een type dat het portaal niet (meer) kent houdt zijn ruwe naam, zodat de rij niet verdwijnt. */
export const verlofTypeLabel = (type: string): string => VERLOF_TYPE_LABEL[type] ?? type;

/** Zelfde woorden als de statuspil in Verlof: de labels komen uit de gedeelde
 *  statuswoordenschat (shared/status.ts); de volgorde is die van de keuzelijst. */
export const VERLOF_STATUS_LABEL: Readonly<Record<string, string>> = {
  approved: AANVRAAG_STATUS.approved.label,
  pending: AANVRAAG_STATUS.pending.label,
  rejected: AANVRAAG_STATUS.rejected.label,
  cancelled: AANVRAAG_STATUS.cancelled.label,
};

export const verlofStatusLabel = (status: string): string => VERLOF_STATUS_LABEL[status] ?? status;

/** "Alle" als eerste optie van een keuzelijst: geen filter. */
export const KEUZE_ALLE = 'alle';

/** De kolom van één verloftype in "Verlof per type per maand" (de lader bouwt er één per type dat voorkomt). */
export const verlofTypeKolom = (type: string): RapportKolom => ({
  id: `type_${type}`,
  titel: verlofTypeLabel(type),
  kort: VERLOF_TYPE_KORT[type],
  type: 'getal',
  totaal: true,
});

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

const VERLOFAANVRAGEN: RapportDefinitie = {
  id: 'verlofaanvragen',
  domein: 'verlof',
  titel: 'Verlofaanvragen',
  omschrijving: 'Elke aanvraag die de periode raakt, met type, status, verlofdagen en wanneer ze aangevraagd en beslist is.',
  filters: [
    { soort: 'periode' },
    { soort: 'chauffeur', label: 'Medewerker' },
    {
      soort: 'keuze',
      id: 'type',
      label: 'Type',
      opties: [{ waarde: KEUZE_ALLE, label: 'Alle' }, ...Object.entries(VERLOF_TYPE_LABEL).map(([waarde, label]) => ({ waarde, label }))],
    },
    {
      soort: 'keuze',
      id: 'status',
      label: 'Status',
      opties: [{ waarde: KEUZE_ALLE, label: 'Alle' }, ...Object.entries(VERLOF_STATUS_LABEL).map(([waarde, label]) => ({ waarde, label }))],
    },
  ],
  kolommen: [
    { id: 'naam', titel: 'Medewerker', type: 'tekst' },
    // Telefoon: de status onder de naam, van en tot in beeld; al de rest staat
    // achter het scrollen (en voluit op het blad en in de CSV).
    { id: 'type', titel: 'Type', type: 'tekst', smal: 'achteraan' },
    { id: 'van', titel: 'Van', type: 'datum' },
    { id: 'tot', titel: 'Tot', type: 'datum' },
    { id: 'dagen', titel: 'Dagen', type: 'getal', totaal: true, smal: 'achteraan' },
    { id: 'status', titel: 'Status', type: 'tekst', smal: 'onderEerste' },
    { id: 'aangevraagdOp', titel: 'Aangevraagd op', kort: 'Aangevr.', type: 'datum', smal: 'achteraan' },
    { id: 'beslistOp', titel: 'Beslist op', kort: 'Beslist', type: 'datum', smal: 'achteraan' },
    { id: 'opmerking', titel: 'Opmerking', type: 'tekst', lang: true, smal: 'achteraan' },
  ],
  sortering: { kolom: 'van', richting: 'desc' },
  print: 'liggend',
  bronNaam: 'verlofgegevens',
};

const VERLOFBEZETTING: RapportDefinitie = {
  id: 'verlofbezetting',
  domein: 'verlof',
  titel: 'Verlofbezetting per dag',
  omschrijving: 'Per dag: hoeveel chauffeurs met goedgekeurd verlof afwezig zijn, tegenover de verloflimiet, en wie.',
  filters: [{ soort: 'periode' }, { soort: 'vinkje', id: 'bovenLimiet', label: 'Alleen boven de limiet' }],
  kolommen: [
    { id: 'datum', titel: 'Datum', type: 'datum' },
    // Telefoon: de weekdag onder de datum; afwezig, limiet en "boven" in beeld,
    // de namen achter het scrollen. "Boven limiet: ja" is waarvoor je dit
    // rapport opent, dus die waarde valt op (rode pil, op het blad vet).
    { id: 'dag', titel: 'Dag', type: 'tekst', sorteerOp: 'datum', smal: 'onderEerste' },
    { id: 'afwezig', titel: 'Afwezig', type: 'getal' },
    { id: 'limiet', titel: 'Limiet', type: 'getal' },
    { id: 'bovenLimiet', titel: 'Boven limiet', kort: 'Boven', type: 'janee', nadruk: { ja: 'gevaar' } },
    { id: 'namen', titel: 'Namen', type: 'tekst', lang: true, smal: 'achteraan' },
  ],
  sortering: { kolom: 'datum', richting: 'asc' },
  print: 'staand',
  bronNaam: 'verlofgegevens',
};

const VERLOF_PER_TYPE: RapportDefinitie = {
  id: 'verlof-per-type',
  domein: 'verlof',
  titel: 'Verlof per type per maand',
  omschrijving: 'Goedgekeurde verlofdagen per maand, met één kolom per verloftype dat in het jaar voorkomt.',
  filters: [{ soort: 'jaar' }],
  // De vaste kolommen; de lader zet er per verloftype dat in het jaar voorkomt
  // een kolom tussen (verlofTypeKolom) en geeft de volledige lijst mee.
  kolommen: [
    { id: 'maand', titel: 'Maand', type: 'tekst', sorteerOp: 'maandSleutel' },
    { id: 'totaal', titel: 'Totaal', type: 'getal', totaal: true },
  ],
  sortering: { kolom: 'maand', richting: 'asc' },
  print: 'staand',
  bronNaam: 'verlofgegevens',
};

export const VERLOF_RAPPORTEN: readonly RapportDefinitie[] = [VERLOFSALDO, VERLOFAANVRAGEN, VERLOFBEZETTING, VERLOF_PER_TYPE];
