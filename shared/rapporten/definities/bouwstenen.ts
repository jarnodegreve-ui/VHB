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

/** "Vervalt binnen 30 / 60 / 90 dagen", standaard alles. Wat al vervallen is hoort bij elke termijn. */
export const TERMIJN_FILTER: Keuze = {
  soort: 'keuze',
  id: 'termijn',
  label: 'Vervalt',
  opties: [
    { waarde: 'alles', label: 'Alles' },
    { waarde: '30', label: 'Binnen 30 dagen' },
    { waarde: '60', label: 'Binnen 60 dagen' },
    { waarde: '90', label: 'Binnen 90 dagen' },
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

/** De status in woorden: op papier (zwart-wit) draagt de tekst wat op het scherm de kleur doet. */
export const VERVAL_STATUS_KOLOM: RapportKolom = { id: 'status', titel: 'Status', type: 'tekst', tonen: VERVAL_TONEN, smal: 'achteraan' };
