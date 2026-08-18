import { apiFetch } from './api';

/**
 * Advies bij één openstaande dienst — antwoord van /api/coverage-advisor.
 * De server beoordeelt per vrije chauffeur of de dienst in zijn schema past:
 * minstens `minRustUren` uur rust t.o.v. de aansluitende werkdagen en
 * maximaal `maxDagenNaElkaar` gewerkte dagen na elkaar.
 */
export type KandidaatAdvies = {
  id: string;
  name: string;
  /** Rust in minuten t.o.v. de vorige/volgende werkdag; null = geen dienst die dag. */
  rustVoor: number | null;
  rustNa: number | null;
  /** Gewerkte dagen na elkaar mét deze toewijzing erbij. */
  dagenNaElkaar: number;
  /** Hoe vaak dit jaar al ingevallen (eerlijke verdeling). */
  keren: number;
  past: boolean;
  redenen: string[];
};

/** Ruil in één stap: `vanNaam` staat dienst `viaCode` af aan `naarNaam` en
 *  rijdt zelf het gat. Alleen berekend als niemand direct past. */
export type KettingVoorstel = {
  vanId: string;
  vanNaam: string;
  viaCode: string;
  viaTijden: string;
  naarId: string;
  naarNaam: string;
};

export type CoverageAdvies = {
  date: string;
  code: string;
  /** Tijdsblokken van de dienst zelf; leeg = onbekend in het dienstoverzicht. */
  segmenten: Array<{ startTime: string; endTime: string }>;
  tijdenOnbekend: boolean;
  minRustUren: number;
  maxDagenNaElkaar: number;
  kandidaten: KandidaatAdvies[];
  kettingen: KettingVoorstel[];
  /** De collega-zin: het advies in mensentaal, server-side opgebouwd. */
  samenvatting: string;
};

export function fetchCoverageAdvies(date: string, code: string): Promise<CoverageAdvies> {
  return apiFetch<CoverageAdvies>(`/api/coverage-advisor?date=${date}&code=${encodeURIComponent(code)}`);
}

/** "8u" / "7u53" — zelfde notatie als de redenen-teksten van de server. */
export const formatRustUren = (minuten: number): string => {
  const heel = Math.max(0, minuten);
  const u = Math.floor(heel / 60);
  const m = heel % 60;
  return m === 0 ? `${u}u` : `${u}u${String(m).padStart(2, '0')}`;
};

/**
 * Compacte metaregel onder een passende kandidaat:
 * "rust 11u30 · 4e werkdag op rij · 2× ingevallen". De krapste rust van de
 * twee kanten is de bindende en dus de getoonde; zonder aansluitende
 * diensten valt het rust-deel weg.
 */
export const kandidaatMeta = (k: KandidaatAdvies): string => {
  const delen: string[] = [];
  const rusten = [k.rustVoor, k.rustNa].filter((r): r is number => r !== null);
  if (rusten.length > 0) delen.push(`rust ${formatRustUren(Math.min(...rusten))}`);
  if (k.dagenNaElkaar > 1) delen.push(`${k.dagenNaElkaar}e werkdag op rij`);
  delen.push(k.keren > 0 ? `${k.keren}× ingevallen` : 'nog niet ingevallen');
  return delen.join(' · ');
};

/** "06:12–09:30 + 15:41–18:20" — de dienst-tijden als contextregel. */
export const segmentenLabel = (segmenten: Array<{ startTime: string; endTime: string }>): string =>
  segmenten.map((s) => `${s.startTime}–${s.endTime}`).join(' + ');
