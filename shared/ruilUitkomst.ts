/**
 * Hoe een dienstruil afliep, voor de rapporten: waar hij vandaag staat, wat de
 * collega antwoordde en wie wanneer besliste. Alles komt uit het verloop per
 * persoon (`persoonsVerloop` in shared/ruilVerloop.ts), dus uit het
 * activiteitenlog en niet uit `decidedAt` alleen: die kolom wordt door een
 * latere terugdraai overschreven en zegt niet WIE weigerde. Puur, zonder zod.
 */
import { isHandmatigeRuil, persoonsVerloop, type RuilVoorVerloop, type VerloopRegel } from './ruilVerloop.js';
import type { RuilStand } from './rapporten/definities/ruilen.js';

export type { RuilStand };
export type CollegaAntwoord = 'geaccepteerd' | 'geweigerd' | 'niet-afgewacht' | 'wacht' | 'geen' | 'niet-nodig';

/** Is deze ruil ooit in de planning doorgevoerd? (goedgekeurd of door de planning ingevoerd) */
export const isOoitDoorgevoerd = (swap: RuilVoorVerloop): boolean => {
  if (swap.status === 'approved' || swap.status === 'completed') return true;
  const stappen = Array.isArray(swap.verloop) ? swap.verloop : [];
  if (stappen.some((s) => s.soort === 'goedgekeurd' || s.soort === 'ingevoerd')) return true;
  // Zonder log: een handmatige wissel bestaat alleen doordat hij doorgevoerd is.
  return isHandmatigeRuil(swap);
};

/**
 * Waar de ruil vandaag staat. Een afgewezen of geannuleerde ruil die eerst
 * doorgevoerd was, is teruggedraaid; een annulering door de aanvrager zelf is
 * ingetrokken; de rest van de annuleringen deed de planning.
 */
export const ruilStand = (swap: RuilVoorVerloop): RuilStand => {
  switch (String(swap.status)) {
    case 'pending': return 'bij-collega';
    case 'accepted': return 'bij-planning';
    case 'approved': return 'goedgekeurd';
    case 'completed': return 'afgehandeld';
    default: break;
  }
  if (isOoitDoorgevoerd(swap)) return 'teruggedraaid';
  if (swap.status === 'rejected') return 'geweigerd';
  const stappen = Array.isArray(swap.verloop) ? swap.verloop : [];
  const annulering = [...stappen].reverse().find((s) => s.soort === 'geannuleerd');
  return annulering?.door === 'aanvrager' ? 'ingetrokken' : 'geannuleerd';
};

/** De statusteksten van de collega-regel in `persoonsVerloop`, elk op zijn antwoord. Een drift-test houdt ze gelijk. */
export const COLLEGA_STATUS_NAAR_ANTWOORD: Readonly<Record<string, CollegaAntwoord>> = {
  Geaccepteerd: 'geaccepteerd',
  Geweigerd: 'geweigerd',
  'Antwoord niet afgewacht': 'niet-afgewacht',
  'Wacht op antwoord': 'wacht',
  'Bekeken, nog geen antwoord': 'wacht',
  'Nog niet bekeken': 'wacht',
  'Geen antwoord gegeven': 'geen',
  'Antwoord niet geregistreerd': 'geen',
  // Handmatige wissel: de planning zette hem rechtstreeks in de planning.
  'Geen akkoord nodig': 'niet-nodig',
  'Nog niet bevestigd': 'niet-nodig',
  Bevestigd: 'niet-nodig',
};

/** Wat de collega antwoordde; null als er geen collega aangezocht is. */
export const collegaAntwoord = (swap: RuilVoorVerloop): CollegaAntwoord | null => {
  const regel = persoonsVerloop(swap).find((r) => r.rol === 'collega');
  if (!regel) return null;
  return COLLEGA_STATUS_NAAR_ANTWOORD[regel.status] ?? 'geen';
};

export type RuilBeslissing = {
  /** ISO-moment van de beslissing, of null als het nergens geregistreerd is. */
  op: string | null;
  door: 'aanvrager' | 'collega' | 'planner' | 'onbekend';
  /** Gebruiker achter de beslissing (aanvrager of collega). */
  userId?: string;
  /** Naam van de planner, als het verloop met stafnamen is opgebouwd. */
  naam?: string;
};

const PLANNER_BESLISTE = new Set(['Goedgekeurd', 'Geweigerd', 'Geannuleerd', 'Teruggedraaid', 'Ingevoerd door de planner']);

/**
 * De laatste beslissing over de ruil, of null zolang hij open staat. Voor een
 * doorgevoerde ruil is dat de goedkeuring (niet het latere afhandelen), voor
 * een teruggedraaide de terugdraai.
 */
export const ruilBeslissing = (swap: RuilVoorVerloop): RuilBeslissing | null => {
  if (swap.status === 'pending' || swap.status === 'accepted') return null;
  const regels = persoonsVerloop(swap);
  const van = (rol: VerloopRegel['rol']) => regels.find((r) => r.rol === rol);
  const planner = van('planner');
  if (planner && PLANNER_BESLISTE.has(planner.status)) return { op: planner.op ?? null, door: 'planner', ...(planner.naam ? { naam: planner.naam } : {}) };
  const collega = van('collega');
  if (collega?.status === 'Geweigerd') return { op: collega.op ?? null, door: 'collega', userId: collega.userId };
  const aanvrager = van('aanvrager');
  if (aanvrager?.status === 'Ingetrokken') return { op: aanvrager.op ?? null, door: 'aanvrager', userId: aanvrager.userId };
  return { op: van('onbekend')?.op ?? swap.decidedAt ?? null, door: 'onbekend' };
};
