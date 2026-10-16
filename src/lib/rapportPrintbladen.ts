import type { RapportDomein } from '../../shared/rapporten/types';
import { ruilOverzichtQuery, ruilPeriodeFout } from './ruilOverzicht';

/**
 * De vier printbladen die al bestonden vóór de pagina Rapporten. Ze staan in
 * de catalogus tussen de rapporten van hun domein, maar blijven wat ze waren:
 * een eigen printscherm achter een eigen URL-parameter (App.tsx). De catalogus
 * vraagt alleen hun parameters en opent die URL; ze zijn bewust NIET omgebouwd
 * naar het register (wel staan ze sinds 03-10 op dezelfde `PrintBlad`-kop).
 */
export type PrintbladParameter = 'maand' | 'chauffeur' | 'chauffeur-of-alle' | 'jaar' | 'periode' | 'omvang';

/** `van`/`tot` = de periode van het ruiloverzicht (dienstdatum, sinds 16-10; was één week). */
export type PrintbladWaarden = { maand: string; chauffeur: string; jaar: number; van: string; tot: string; omvang: 'open' | 'alles' };

export type PrintbladDef = {
  id: string;
  domein: RapportDomein;
  titel: string;
  omschrijving: string;
  parameters: readonly PrintbladParameter[];
  /** Querystring van het bestaande printscherm. */
  query: (w: PrintbladWaarden) => URLSearchParams;
};

export const PRINTBLADEN: readonly PrintbladDef[] = [
  {
    id: 'maandrooster',
    domein: 'planning',
    titel: 'Maandrooster per chauffeur',
    omschrijving: 'Het rooster van één maand op één blad, voor één chauffeur of voor iedereen.',
    parameters: ['maand', 'chauffeur-of-alle'],
    query: (w) => new URLSearchParams({ 'print-driver': w.chauffeur || 'alle', 'print-month': w.maand }),
  },
  {
    id: 'verlofjaar',
    domein: 'verlof',
    titel: 'Verlofjaar per chauffeur',
    omschrijving: 'Jaarkalender met al het verlof van één medewerker.',
    parameters: ['chauffeur', 'jaar'],
    query: (w) => new URLSearchParams({ 'print-verlof-driver': w.chauffeur, 'print-verlof-jaar': String(w.jaar) }),
  },
  {
    id: 'ruiloverzicht',
    domein: 'ruilen',
    titel: 'Ruiloverzicht',
    omschrijving: 'De doorgevoerde dienstwissels van de diensten in een periode, per dag.',
    parameters: ['periode'],
    query: (w) => ruilOverzichtQuery({ van: w.van, tot: w.tot }),
  },
  {
    id: 'gele-boek',
    domein: 'voertuigen',
    titel: 'Gele boek, openstaande werken',
    omschrijving: 'De aangevraagde werken per bus, zoals in de map van de garage.',
    parameters: ['omvang'],
    query: (w) => new URLSearchParams({ 'print-gele-boek': w.omvang }),
  },
];

export const printbladenVanDomein = (domein: RapportDomein): PrintbladDef[] => PRINTBLADEN.filter((p) => p.domein === domein);

/** Kan dit blad open met deze waarden? (de chauffeur is bij het verlofjaar verplicht, de periode moet kloppen) */
export const printbladKlaar = (def: PrintbladDef, w: PrintbladWaarden): boolean =>
  def.parameters.every((p) => (p === 'chauffeur' ? w.chauffeur !== '' : p === 'periode' ? ruilPeriodeFout({ van: w.van, tot: w.tot }) === null : true));

export const printbladUrl = (def: PrintbladDef, w: PrintbladWaarden, basis: string): string => `${basis}?${def.query(w).toString()}`;
