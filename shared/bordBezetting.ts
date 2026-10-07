/**
 * Wat doet een chauffeur die dag volgens het BORD? (controle 29-09)
 *
 * Het bord is de cel van de maandplanning: de matrixcel met de doorgevoerde
 * ruilen en wissels erover (api/_lib/celWaarheid.ts). Voor een code-dienst
 * (schoolrit, bureau, garage) bestaan er geen rijen in `planning`; wie alleen
 * de planning-rijen of de rauwe matrixcel leest, ziet zo'n dienst dus niet
 * meer zodra hij via een wissel van eigenaar veranderde. Deze twee regels zijn
 * de ene lezing van een bordcel, voor de server (conflictcontroles,
 * beschikbaarheid, advies) en voor de vervangerlijsten in de client. Puur,
 * zonder zod en zonder imports.
 */

export type BordCel = { code: string; kind: string; hiddenService?: string; /** Omschrijving uit de planningscodes of "Dienst X" (OverlayCel). */ label?: string };

/** De codes waarop iemand een dienst mag overnemen (zelfde lijst als
 *  TAKEOVER_CODES in api/helpers.ts; de drift-test houdt ze gelijk). */
export const OVERNAME_CODES = ['vrij', 'bv', 'tk', 'ta'] as const;

const token = (v: unknown) =>
  String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

/** De dienst die deze cel draagt: wat de chauffeur zelf rijdt, of wat onder
 *  zijn afwezigheid nog op zijn naam staat. Null = geen dienst. */
export const dienstOpBord = (cel: BordCel | null | undefined): string | null => {
  if (!cel) return null;
  if (cel.kind === 'service') return cel.code || null;
  return cel.hiddenService || null;
};

/** Vrij volgens het bord: een lege cel of een overname-code, zonder dienst
 *  eronder. Elke andere code (ziek, opl, kv, een dienst) is niet vrij. */
export const vrijOpBord = (cel: BordCel | null | undefined): boolean =>
  !cel || (!dienstOpBord(cel) && (!token(cel.code) || (OVERNAME_CODES as readonly string[]).includes(token(cel.code))));

/** Wat de ruilwizard onder de naam zet bij een afwezigheid uit de verlofmodule
 *  (Jarno 07-10: de reden, niet "Bezet"). */
export const VERLOF_REDEN: Record<string, string> = { ziekte: 'Ziek', betaald_verlof: 'Verlof', klein_verlet: 'Klein verlet' };

/** Waarom iemand die dag niet kiesbaar is als vrije collega: goedgekeurd
 *  portaalverlof op soort (ziekte wint bij overlap, zoals op het bord), anders
 *  de bordcel met haar omschrijving ('Opleiding', of "Dienst 2104" voor een
 *  dienst die alleen op het bord leeft). Null = vrij volgens alles wat we
 *  weten. */
export const afwezigheidsReden = (verlofSoorten: readonly string[], cel: BordCel | null | undefined): string | null => {
  if (verlofSoorten.includes('ziekte')) return VERLOF_REDEN.ziekte;
  const soort = verlofSoorten.find((s) => VERLOF_REDEN[s]);
  if (soort) return VERLOF_REDEN[soort];
  if (verlofSoorten.length > 0) return 'Verlof';
  if (!cel || vrijOpBord(cel)) return null;
  const dienst = dienstOpBord(cel);
  const code = token(cel.code);
  if (cel.kind === 'service' || !code || (OVERNAME_CODES as readonly string[]).includes(code)) return `Dienst ${dienst ?? cel.code}`;
  return cel.label || cel.code.toUpperCase();
};
