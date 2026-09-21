import type { RapportDefinitie, RapportFilter, RapportFilters } from './types.js';
import { isIsoDag, jaarPeriode, opHeleMaanden, periodeVoor, type Periode } from './periode.js';

/**
 * De filters van een rapport tussen URL en definitie (zod-vrij, voor de
 * client). De URL is de bron: het scherm leest zijn filters uit de
 * querystring, het printblad leest dezelfde parameters en de API krijgt ze
 * ongewijzigd door. De server valideert streng met zod
 * (shared/rapporten/filterSchema.ts); deze lezer is vergevingsgezind en valt
 * bij rommel terug op de standaard, zodat een half ingetikte link nooit een
 * foutscherm geeft.
 */

export const JAAR_MIN = 2000;
export const JAAR_MAX = 2100;

/** Vaste parameternamen; een keuzelijst of vinkje mag deze niet als `id` gebruiken. */
export const VASTE_PARAMS = ['van', 'tot', 'jaar', 'chauffeur', 'voertuig'] as const;

/** Een vinkje dat aan staat in de URL (`?bovenLimiet=1`); uit = de parameter ontbreekt. */
export const VINKJE_AAN = '1';

const keuzeStandaard = (f: Extract<RapportFilter, { soort: 'keuze' }>): string => f.standaard ?? f.opties[0]?.waarde ?? '';

/** Alle parameternamen die dit rapport in de URL gebruikt. */
export const filterParams = (def: RapportDefinitie): string[] => def.filters.flatMap((f) => {
  switch (f.soort) {
    case 'periode': return ['van', 'tot'];
    case 'jaar': return ['jaar'];
    case 'chauffeur': return ['chauffeur'];
    case 'voertuig': return ['voertuig'];
    case 'keuze': return [f.id];
    case 'vinkje': return [f.id];
  }
});

/** De filters zonder enige keuze: deze maand, dit jaar, iedereen, elke eerste optie. */
export const standaardFilters = (def: RapportDefinitie, vandaag: string): RapportFilters => {
  const uit: RapportFilters = { keuzes: {} };
  for (const f of def.filters) {
    if (f.soort === 'periode') Object.assign(uit, periodeVoor(f.standaard ?? 'deze-maand', vandaag));
    else if (f.soort === 'jaar') uit.jaar = Number(vandaag.slice(0, 4));
    else if (f.soort === 'keuze') uit.keuzes[f.id] = keuzeStandaard(f);
    else if (f.soort === 'vinkje') (uit.vinkjes ??= {})[f.id] = false;
  }
  return uit;
};

type Lezer = { get: (naam: string) => string | null };

/** Querystring → filters; wat ontbreekt of niet klopt wordt de standaard. */
export const leesFilters = (def: RapportDefinitie, query: Lezer, vandaag: string): RapportFilters => {
  const uit = standaardFilters(def, vandaag);
  for (const f of def.filters) {
    if (f.soort === 'periode') {
      const van = query.get('van');
      const tot = query.get('tot');
      // Alleen als paar: een halve periode uit de URL zegt niets. Een rapport per
      // hele maand rondt af (een link met 15/09 toont september), de server is streng.
      if (isIsoDag(van) && isIsoDag(tot)) Object.assign(uit, f.heleMaanden && van <= tot ? opHeleMaanden({ van, tot }) : { van, tot });
    } else if (f.soort === 'jaar') {
      const jaar = Number(query.get('jaar'));
      if (Number.isInteger(jaar) && jaar >= JAAR_MIN && jaar <= JAAR_MAX) uit.jaar = jaar;
    } else if (f.soort === 'chauffeur' || f.soort === 'voertuig') {
      const waarde = (query.get(f.soort) ?? '').trim();
      if (waarde) uit[f.soort] = waarde;
    } else if (f.soort === 'vinkje') {
      (uit.vinkjes ??= {})[f.id] = query.get(f.id) === VINKJE_AAN;
    } else {
      const waarde = query.get(f.id);
      if (waarde && f.opties.some((o) => o.waarde === waarde)) uit.keuzes[f.id] = waarde;
    }
  }
  return uit;
};

/** Filters → querystring, altijd voluit (ook de standaarden): een gedeelde
 *  link of een printblad mag morgen niet iets anders tonen dan vandaag. */
export const filtersNaarQuery = (def: RapportDefinitie, filters: RapportFilters): URLSearchParams => {
  const q = new URLSearchParams();
  for (const f of def.filters) {
    if (f.soort === 'periode') {
      if (filters.van) q.set('van', filters.van);
      if (filters.tot) q.set('tot', filters.tot);
    } else if (f.soort === 'jaar') {
      if (filters.jaar != null) q.set('jaar', String(filters.jaar));
    } else if (f.soort === 'chauffeur' || f.soort === 'voertuig') {
      const waarde = filters[f.soort];
      if (waarde) q.set(f.soort, waarde);
    } else if (f.soort === 'vinkje') {
      // Uit = afwezig: een vinkje heeft geen "standaard aan", dus de link blijft ook zo volledig.
      if (filters.vinkjes?.[f.id]) q.set(f.id, VINKJE_AAN);
    } else if (filters.keuzes[f.id]) {
      q.set(f.id, filters.keuzes[f.id]);
    }
  }
  return q;
};

/** Wijken deze filters af van de standaard? (voor "Filters wissen") */
export const heeftEigenFilters = (def: RapportDefinitie, filters: RapportFilters, vandaag: string): boolean =>
  filtersNaarQuery(def, filters).toString() !== filtersNaarQuery(def, standaardFilters(def, vandaag)).toString();

/** De periode waarover het rapport gaat (periode-filter, anders het jaar), of null. */
export const periodeVanFilters = (def: RapportDefinitie, filters: RapportFilters): Periode | null => {
  if (def.filters.some((f) => f.soort === 'periode') && filters.van && filters.tot) return { van: filters.van, tot: filters.tot };
  if (def.filters.some((f) => f.soort === 'jaar') && filters.jaar != null) return jaarPeriode(filters.jaar);
  return null;
};

const dmj = (iso: string): string => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

/** Onbekende of verwijderde persoon: de rij blijft staan, met zijn id. */
export const onbekendLabel = (id: string): string => `Onbekend (${id})`;

/**
 * De gekozen filters in woorden, voor de kop van het printblad en de
 * bestandsnaam-loze samenvatting op het scherm: ["Jaar 2026", "Medewerker: Jan
 * Peeters"]. `namen` zet een id om naar een naam; zonder treffer blijft het id
 * zichtbaar als "Onbekend (<id>)". Een rapport dat tegenover vandaag rekent
 * sluit af met zijn peildatum.
 */
export const filtersInWoorden = (
  def: RapportDefinitie,
  filters: RapportFilters,
  namen: { chauffeur?: (id: string) => string | undefined; voertuig?: (id: string) => string | undefined; /** Peildatum van de server (ISO), voor een rapport met `peildatum`. */ peildatum?: string } = {},
): string[] => [...def.filters.map((f): string | null => {
  switch (f.soort) {
    case 'periode': return filters.van && filters.tot ? `Periode ${dmj(filters.van)} t/m ${dmj(filters.tot)}` : 'Periode niet gekozen';
    case 'jaar': return `Jaar ${filters.jaar ?? ''}`.trim();
    case 'chauffeur': {
      const label = f.label ?? 'Chauffeur';
      return filters.chauffeur ? `${label}: ${namen.chauffeur?.(filters.chauffeur) ?? onbekendLabel(filters.chauffeur)}` : `${label}: alle`;
    }
    case 'voertuig': return filters.voertuig ? `Voertuig: ${namen.voertuig?.(filters.voertuig) ?? onbekendLabel(filters.voertuig)}` : 'Voertuig: alle';
    case 'keuze': {
      const waarde = filters.keuzes[f.id];
      return `${f.label}: ${f.opties.find((o) => o.waarde === waarde)?.label ?? waarde}`;
    }
    // Een vinkje dat uit staat zegt niets: het staat alleen op het blad als het aan staat.
    case 'vinkje': return filters.vinkjes?.[f.id] ? f.label : null;
  }
}).filter((woord): woord is string => woord !== null), ...(def.peildatum && namen.peildatum ? [`Peildatum ${dmj(namen.peildatum)}`] : [])];

/** Stuk voor de bestandsnaam: de periode of het jaar, machineleesbaar (ISO). */
export const bestandsPeriode = (def: RapportDefinitie, filters: RapportFilters): string => {
  if (def.filters.some((f) => f.soort === 'periode') && filters.van && filters.tot) return `${filters.van}_${filters.tot}`;
  if (def.filters.some((f) => f.soort === 'jaar') && filters.jaar != null) return String(filters.jaar);
  return '';
};
