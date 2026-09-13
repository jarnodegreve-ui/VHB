/**
 * Loon (fase B Access-migratie, 13-09-2026): zod-vrije constanten en pure
 * types voor de dagafsluiting en de Easypay-export. De schema's staan in
 * shared/schemas/loon.ts, de exportlogica in shared/loon/easypay.ts.
 */

export const DIENST_TYPES = ['lijn', 'varia', 'ander'] as const;
export type DienstType = (typeof DIENST_TYPES)[number];
export const DIENST_TYPE_LABEL: Record<DienstType, string> = {
  lijn: 'Lijndienst',
  varia: 'Afwezigheid of andere code',
  ander: 'Niet in de loonexport',
};

export const LOON_CODE_BRONNEN = ['import', 'handmatig', 'segments'] as const;
export type LoonCodeBron = (typeof LOON_CODE_BRONNEN)[number];

export const DAG_STATUSSEN = ['open', 'afgesloten'] as const;
export type DagStatus = (typeof DAG_STATUSSEN)[number];

/** De acht kwaliteitsvlaggen van tblDagAdministratie, met NL-label. */
export const QUAL_VLAGGEN = [
  'qualOngeval', 'qualPanne', 'qualVerkeersovertreding', 'qualKlantklacht',
  'qualAdmfout', 'qualInterneklacht', 'qualVertragingDrSchuld', 'qualRitNtGeredenDrSchuld',
] as const;
export type QualVlag = (typeof QUAL_VLAGGEN)[number];
export const QUAL_VLAG_LABEL: Record<QualVlag, string> = {
  qualOngeval: 'Ongeval',
  qualPanne: 'Panne',
  qualVerkeersovertreding: 'Verkeersovertreding',
  qualKlantklacht: 'Klantenklacht',
  qualAdmfout: 'Administratieve fout',
  qualInterneklacht: 'Interne klacht',
  qualVertragingDrSchuld: 'Vertraging door schuld',
  qualRitNtGeredenDrSchuld: 'Rit niet gereden door schuld',
};

/** Easypay-typeprestatiecodes voor overminuten (Access-query). */
export const TYPPRE_OVERMIN_POSITIEF = 40945;
export const TYPPRE_OVERMIN_NEGATIEF = 40946;

export const OVERMIN_MIN = -600;
export const OVERMIN_MAX = 600;
export const OPMERKING_MAX = 200;

/** Loondienstcode normaliseren: trim + kleine letters ('BV' → 'bv', ' 2102' → '2102'). */
export const loonCodeSleutel = (code: string | null | undefined): string => String(code ?? '').trim().toLowerCase();

/** Kolommen van het Easypay-CSV-bestand, in vaste volgorde (Access: tblEasypayCSVloonopgave). */
export const EASYPAY_KOLOMMEN = [
  'soc', 'matric', 'Datum', 'composant', 'Activit', 'HD', 'HA', 'duree', 'Typpre', 'NBPL',
  'alpha1', 'dec1', 'alphal2', 'deci2', 'Type Info', 'Prime', 'VrijVeld', 'service', 'Version', 'periode', 'JD', 'ja',
] as const;
