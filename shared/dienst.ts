/**
 * Dienstopbouw op rit-niveau (fase C Access-migratie, 13-09-2026): zod-vrije
 * constanten en types. De Access-tabel tbl-importDienstenET splitst elke
 * dienst per dagtype in ritdelen; hieruit volgen de ritbladen en de
 * looncomponenten voor Easypay. De rekenregels staan in shared/dienst/*.ts.
 */

/** Soorten ritdelen zoals de ET-export ze noemt. */
export const SEGMENT_TYPES = ['RIT', 'LED', 'STA', 'ONE', 'ONV', 'ONS', 'AVO', 'ANA', 'ATU', 'ANW', 'AFL'] as const;
export type SegmentType = (typeof SEGMENT_TYPES)[number];
export const SEGMENT_TYPE_LABEL: Record<SegmentType, string> = {
  RIT: 'Rit met reizigers',
  LED: 'Ledige rit',
  STA: 'Stationnement',
  ONE: 'Onderbreking (onbetaald)',
  ONV: 'Onderbreking (betaald)',
  ONS: 'Onderbreking stationnement',
  AVO: 'Controle bus (vooraf)',
  ANA: 'Tanken en administratie (na)',
  ATU: 'Wassen bus',
  ANW: 'Ander werk',
  AFL: 'Aflossing',
};

/** Easypay-typeprestatie per ritdeel (Access qry-LoonDienstFormEasypayDeel1..3). */
export const TYPPRE_PER_TYPE: Record<SegmentType, number> = {
  RIT: 20101, LED: 20201, AVO: 20301, ANA: 20401, ATU: 20112, AFL: 20112, ANW: 20112,
  STA: 30300, ONS: 30300, ONE: 30201, ONV: 30202,
};
/** Stationnement gesplitst: eerste 15 min (100 % arbeidstijd), minuten 16-45 (100 % niet-arbeidstijd), rest (50 %). */
export const TYPPRE_STAT_100_AT = 30300;
export const TYPPRE_STAT_100_NAT = 30301;
export const TYPPRE_STAT_50_NAT = 30302;

export type Segment = {
  serviceNumber: string;
  dagtypeCode: string;
  volgorde: number;
  type: SegmentType;
  /** Minuten sinds 00:00 van de dienstdag; > 1440 = na middernacht. */
  startMin: number;
  eindeMin: number;
  duurMin: number;
  loop: string | null;
  internLoop: string | null;
  lijn: string | null;
  variant: string | null;
  rit: string | null;
  voertuig: string | null;
  vertrek: string | null;
  vertrekCode: string | null;
  aankomst: string | null;
  aankomstCode: string | null;
  afstandKm: number | null;
  atTijd: string | null;
  vtTijd: string | null;
};

export const BEVINDING_SOORTEN = ['gat', 'overlap', 'einde_voor_start', 'zonder_dienstnummer', 'zonder_loop', 'snelheid', 'duur_klopt_niet', 'onbekend_type', 'te_veel_delen'] as const;
export type BevindingSoort = (typeof BEVINDING_SOORTEN)[number];
export const BEVINDING_LABEL: Record<BevindingSoort, string> = {
  gat: 'Gat tussen twee ritdelen',
  overlap: 'Ritdelen overlappen',
  einde_voor_start: 'Einde vóór start',
  zonder_dienstnummer: 'Ritdeel zonder dienstnummer',
  zonder_loop: 'Rit zonder loopnummer',
  snelheid: 'Onwaarschijnlijke snelheid',
  duur_klopt_niet: 'Duur wijkt af van einde min start',
  onbekend_type: 'Onbekend soort ritdeel',
  te_veel_delen: 'Meer dan drie dienstdelen',
};
export type Bevinding = { soort: BevindingSoort; ernst: 'fout' | 'waarschuwing'; serviceNumber: string; dagtypeCode: string; volgorde: number | null; tekst: string };
