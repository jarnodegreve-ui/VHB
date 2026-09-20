import type { RapportDomein } from '../../shared/rapporten/types';

/**
 * De vier printbladen die al bestonden vóór de pagina Rapporten. Ze staan in
 * de catalogus tussen de rapporten van hun domein, maar blijven wat ze waren:
 * een eigen printscherm achter een eigen URL-parameter (App.tsx). De catalogus
 * vraagt alleen hun parameters en opent die URL; ze zijn bewust NIET omgebouwd
 * naar het register.
 */
export type PrintbladParameter = 'maand' | 'chauffeur' | 'chauffeur-of-alle' | 'jaar' | 'week' | 'omvang';

export type PrintbladWaarden = { maand: string; chauffeur: string; jaar: number; dag: string; omvang: 'open' | 'alles' };

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
    titel: 'Ruiloverzicht per week',
    omschrijving: 'De dienstwissels die in één week zijn uitgevoerd, met hun verloop.',
    parameters: ['week'],
    query: (w) => new URLSearchParams({ 'ruiloverzicht-week': w.dag }),
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

/** Kan dit blad open met deze waarden? (de chauffeur is bij het verlofjaar verplicht) */
export const printbladKlaar = (def: PrintbladDef, w: PrintbladWaarden): boolean =>
  def.parameters.every((p) => (p === 'chauffeur' ? w.chauffeur !== '' : p === 'week' ? w.dag !== '' : true));

export const printbladUrl = (def: PrintbladDef, w: PrintbladWaarden, basis: string): string => `${basis}?${def.query(w).toString()}`;
