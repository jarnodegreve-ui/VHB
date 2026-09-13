/**
 * Techniek: zod-vrije constanten en labels (voertuigen, gele boek,
 * werkprestaties, vervaldata). Los van shared/schemas/techniek.ts zodat de
 * chauffeursschermen (Mijn dag, dashboard) een knop "Defect melden" kunnen
 * tonen zonder zod in hun chunk te trekken; de schema's importeren ze hier.
 * De codes zijn die van garage.accdb, zodat de techniekers hun werkwijze
 * herkennen (werktype T/C/I/L, werkcode H/O/G/Kb/Kv/D/E/L/A).
 */

export const VOERTUIG_TYPES = ['lijnbus', 'schoolbus', 'sprinter', 'privevoertuig', 'ander'] as const;
export type VoertuigType = (typeof VOERTUIG_TYPES)[number];
export const VOERTUIG_TYPE_LABEL: Record<VoertuigType, string> = {
  lijnbus: 'Lijnbus',
  schoolbus: 'Schoolbus',
  sprinter: 'Sprinter',
  privevoertuig: 'Privévoertuig',
  ander: 'Ander',
};

export const AANDRIJVINGEN = ['elektrisch', 'diesel', 'hybride', 'ander'] as const;
export type Aandrijving = (typeof AANDRIJVINGEN)[number];
export const AANDRIJVING_LABEL: Record<Aandrijving, string> = {
  elektrisch: 'Elektrisch',
  diesel: 'Diesel',
  hybride: 'Hybride',
  ander: 'Ander',
};

export const VOERTUIG_STATUSSEN = ['actief', 'reserve', 'uit_dienst'] as const;
export type VoertuigStatus = (typeof VOERTUIG_STATUSSEN)[number];
export const VOERTUIG_STATUS_LABEL: Record<VoertuigStatus, string> = {
  actief: 'Actief',
  reserve: 'Reserve',
  uit_dienst: 'Uit dienst',
};

/** Soort melding in het gele boek (tblWerktype in Access). */
export const WERKTYPES = ['T', 'C', 'I', 'L'] as const;
export type Werktype = (typeof WERKTYPES)[number];
export const WERKTYPE_LABEL: Record<Werktype, string> = {
  T: 'Technisch',
  C: 'Carrosserie',
  I: 'Interieur',
  L: 'Voor De Lijn',
};

export const DEFECT_STATUSSEN = ['open', 'uitgevoerd', 'geannuleerd'] as const;
export type DefectStatus = (typeof DEFECT_STATUSSEN)[number];
export const DEFECT_STATUS_LABEL: Record<DefectStatus, string> = {
  open: 'Open',
  uitgevoerd: 'Uitgevoerd',
  geannuleerd: 'Geannuleerd',
};

/** Werkcodes van de dagprestaties (tblWerkcodes in Access). */
export const WERKCODES = ['H', 'O', 'G', 'Kb', 'Kv', 'D', 'E', 'L', 'A'] as const;
export type Werkcode = (typeof WERKCODES)[number];
export const WERKCODE_LABEL: Record<Werkcode, string> = {
  H: 'Herstelling',
  O: 'Onderhoud',
  G: 'Garantieherstelling',
  Kb: 'Keuring, bezoek SBAT',
  Kv: 'Keuring, voorbereiding',
  D: 'Depannage',
  E: 'Externe herstelling',
  L: 'Stukken leveren of afhalen',
  A: 'Administratie',
};

/** Vervaldata per voertuig (tblVervaldatumTypes, alleen de drie die nog leven). */
export const VOERTUIG_VERVAL_SOORTEN = ['keuring', 'brandblussers', 'tachograaf'] as const;
export type VoertuigVervalSoort = (typeof VOERTUIG_VERVAL_SOORTEN)[number];
export const VOERTUIG_VERVAL_LABEL: Record<VoertuigVervalSoort, string> = {
  keuring: 'Keuring SBAT',
  brandblussers: 'Brandblussers',
  tachograaf: 'Tachograaf en snelheidsbegrenzer',
};

export const DEFECT_OMSCHRIJVING_MAX = 500;
export const WERK_OMSCHRIJVING_MAX = 1000;

/** Korte, herkenbare naam van een voertuig: "Bus 26" of het busnummer. */
export const voertuigNaam = (v: { busnr: string; kortNr?: number | null }): string =>
  v.kortNr !== null && v.kortNr !== undefined ? `Bus ${v.kortNr}` : v.busnr;
