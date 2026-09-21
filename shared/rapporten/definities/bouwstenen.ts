import type { KolomToon, RapportFilter, RapportKolom } from '../types.js';
import { BINNENKORT_DAGEN, VERVAL_STATUS_LABEL } from '../peildatum.js';

/**
 * Bouwstenen die meer dan één domein gebruikt: het termijnfilter en de twee
 * kolommen van een vervaldatum (resterende dagen + status). Eén plek, zodat
 * "vervallen" en "binnenkort" in elk rapport hetzelfde betekenen.
 */

type Keuze = Extract<RapportFilter, { soort: 'keuze' }>;

/** Keuzelijst uit een vaste reeks waarden met hun labels, voorafgegaan door "Alle". */
export const keuzeUit = <T extends string>(id: string, label: string, waarden: readonly T[], labels: Record<T, string>, alle = 'Alle'): Keuze => ({
  soort: 'keuze',
  id,
  label,
  opties: [{ waarde: 'alle', label: alle }, ...waarden.map((w) => ({ waarde: w, label: labels[w] }))],
});

/**
 * "Vervalt binnen 30 / 60 / 90 dagen", standaard alles. Wat al vervallen is hoort bij elke termijn.
 * Het woord "binnen" staat in het veldlabel en de opties zijn kort: op de telefoon is het veld een
 * halve regel breed en werd "Binnen 30 dagen" afgekapt. Het blad leest "Vervalt binnen: 30 dagen".
 */
export const TERMIJN_FILTER: Keuze = {
  soort: 'keuze',
  id: 'termijn',
  label: 'Vervalt binnen',
  opties: [
    { waarde: 'alles', label: 'Alles' },
    { waarde: '30', label: '30 dagen' },
    { waarde: '60', label: '60 dagen' },
    { waarde: '90', label: '90 dagen' },
  ],
};

/** Resterende dagen: negatief = vervallen (danger), tot en met 90 dagen = binnenkort (amber). */
export const RESTEREND_KOLOM: RapportKolom = {
  id: 'resterend',
  titel: 'Resterende dagen',
  kort: 'Dagen',
  type: 'getal',
  signaal: { gevaarOnder: 0, waarschuwingTot: BINNENKORT_DAGEN },
};

const VERVAL_TONEN: Record<string, KolomToon> = {
  [VERVAL_STATUS_LABEL.vervallen]: 'gevaar',
  [VERVAL_STATUS_LABEL.binnenkort]: 'waarschuwing',
  [VERVAL_STATUS_LABEL.geen_datum]: 'waarschuwing',
  [VERVAL_STATUS_LABEL.in_orde]: 'goed',
};

/**
 * De status in woorden: op papier (zwart-wit) draagt de tekst wat op het scherm de kleur doet.
 * Op de telefoon valt de kolom weg: naam, Geldig tot en Dagen passen dan volledig in het kader
 * (geen half zichtbare pil aan de rand), het signaal zit in de kleur van Dagen en, voor wie
 * geen datum heeft, in "Geen datum" in de cel Geldig tot. Tablet, desktop, blad en CSV tonen ze.
 */
export const VERVAL_STATUS_KOLOM: RapportKolom = { id: 'status', titel: 'Status', type: 'tekst', tonen: VERVAL_TONEN, smal: 'verberg' };

/** Geldig tot: een ontbrekende datum is net wat gezien moet worden, dus "Geen datum" in amber in plaats van een streepje. */
export const GELDIG_TOT_KOLOM: RapportKolom = {
  id: 'geldigTot',
  titel: 'Geldig tot',
  type: 'datum',
  leeg: { tekst: VERVAL_STATUS_LABEL.geen_datum, toon: 'waarschuwing' },
};
