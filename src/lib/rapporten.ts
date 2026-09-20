import type { RapportAntwoord, RapportDefinitie, RapportFilters, RapportRij } from '../../shared/rapporten/types';
import { bestandsPeriode, filtersNaarQuery } from '../../shared/rapporten/filters';
import { csvRijen, isGetalKolom } from '../../shared/rapporten/opmaak';
import { apiFetch } from './api';
import { csvCel } from './csv';

/**
 * Clientkant van de rapporten: ophalen, de print-URL en de CSV. Het register
 * en de opmaak staan in shared/rapporten (zod-vrij); dit bestand voegt alleen
 * toe wat een browser nodig heeft.
 */

export type { RapportAntwoord };

export class RapportFout extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** GET /api/rapporten/:id met de filters als querystring. */
export async function laadRapport(def: RapportDefinitie, filters: RapportFilters): Promise<RapportAntwoord> {
  const res = await apiFetch(`/api/rapporten/${encodeURIComponent(def.id)}?${filtersNaarQuery(def, filters).toString()}`);
  if (!res.ok) {
    let data: { error?: string; details?: string } | null = null;
    try { data = await res.json(); } catch { /* geen json */ }
    throw new RapportFout(data?.details || data?.error || `Het rapport kon niet geladen worden (code ${res.status}).`, res.status);
  }
  return (await res.json()) as RapportAntwoord;
}

/** Parameter waarmee App.tsx het printblad afvangt (zoals ?print-gele-boek=…). */
export const PRINT_PARAM = 'print-rapport';

/** De zoekterm in de tabel is ook een filter: hij staat in de URL (`?zoek=`), op het blad en in de CSV. */
export const ZOEK_PARAM = 'zoek';

/**
 * URL van het printblad: `?print-rapport=<id>` plus dezelfde filterparameters
 * als het scherm, voluit, en de zoekterm als die er is. `basis` = origin + pad
 * van het huidige venster.
 */
export const printUrlVoor = (def: RapportDefinitie, filters: RapportFilters, basis: string, zoek = ''): string => {
  const uit = new URLSearchParams({ [PRINT_PARAM]: def.id });
  filtersNaarQuery(def, filters).forEach((waarde, naam) => uit.set(naam, waarde));
  if (zoek.trim()) uit.set(ZOEK_PARAM, zoek.trim());
  return `${basis}?${uit.toString()}`;
};

/** 'vhb-verlofsaldo-2026.csv' of 'vhb-ziekte-2026-09-01_2026-09-30.csv'. */
export const csvBestandsnaam = (def: RapportDefinitie, filters: RapportFilters): string =>
  ['vhb', def.id, bestandsPeriode(def, filters)].filter(Boolean).join('-') + '.csv';

/** Zuiver getal ('-12', '7,5') of duur ('-0:30', '27:05') zoals opmaak.ts ze schrijft. */
const IS_GETAL = /^-?\d+(,\d+)?$|^-?\d+:\d{2}$/;

/**
 * De CSV van een rapport: dezelfde kolommen en rijen als de tabel, puntkomma
 * als scheidingsteken en een BOM vooraan zodat Excel (NL) hem rechtstreeks
 * opent met de juiste tekens. Escapen en de formule-guard komen uit csv.ts;
 * alleen een cel in een getal- of duurkolom die aantoonbaar een getal is gaat
 * er ongemoeid door, anders zou de guard van elke negatieve waarde ('-30')
 * tekst maken ("'-30") en kan Excel er niet meer mee rekenen.
 */
export const rapportCsv = (def: RapportDefinitie, rijen: readonly RapportRij[], totalen?: Record<string, number> | null): string => {
  const getalKolom = def.kolommen.map(isGetalKolom);
  const regels = csvRijen(def, rijen, totalen).map((rij) =>
    rij.map((cel, i) => (getalKolom[i] && IS_GETAL.test(cel) ? `"${cel}"` : csvCel(cel))).join(';'));
  return '\uFEFF' + regels.join('\r\n');
};
