import crypto from "node:crypto";
import { DAG_DMJ } from "../helpers.js";
import { sendPushToUsers } from "../push.js";

/**
 * Gerichte roostermeldingen (verbeterronde 09-10, punt 2, keuze Jarno).
 *
 * "Planning bijgewerkt" naar iedereen riep vragen op: wie niets zag veranderen
 * belde toch, en wie wél iets zag wist niet welke dag. Daarom per chauffeur
 * per dag één afdruk van zijn diensten; het verschil tussen twee roosters is
 * dan een lijst van dagen per chauffeur, en de melding noemt die dagen. Wie
 * geen gewijzigde dag heeft, krijgt niets. Gedeeld door de knop "Planning
 * opnieuw opbouwen", het automatisch bijwerken na het dienstoverzicht (via de
 * wachtrij en de cron) en de matrix-import.
 */

type Rij = {
  date?: unknown; startTime?: unknown; endTime?: unknown; line?: unknown;
  loopnr?: unknown; busNumber?: unknown; driverId?: unknown;
};

const tekst = (v: unknown) => String(v ?? "");
const dienstSleutel = (r: Rij) =>
  `${tekst(r.date)}|${tekst(r.startTime)}|${tekst(r.endTime)}|${tekst(r.line)}|${tekst(r.loopnr)}|${tekst(r.busNumber)}`;
const hash = (s: string, lengte: number) => crypto.createHash("sha256").update(s).digest("hex").slice(0, lengte);

/** Per dag (yyyy-mm-dd) één afdruk van alle diensten van die dag. */
export type DagAfdrukken = Record<string, string>;

/** Per chauffeur zijn dag-afdrukken. Twee gelijke afdrukken voor een dag = die dag is ongewijzigd. */
export const roosterDagAfdrukken = (rows: ReadonlyArray<Rij>): Map<string, DagAfdrukken> => {
  const perChauffeur = new Map<string, Map<string, string[]>>();
  for (const r of rows) {
    const id = tekst(r.driverId);
    const dag = tekst(r.date);
    if (!id || !dag) continue;
    const dagen = perChauffeur.get(id) ?? new Map<string, string[]>();
    const sleutels = dagen.get(dag) ?? [];
    sleutels.push(dienstSleutel(r));
    dagen.set(dag, sleutels);
    perChauffeur.set(id, dagen);
  }
  return new Map([...perChauffeur].map(([id, dagen]) => [
    id,
    Object.fromEntries([...dagen].map(([dag, sleutels]) => [dag, hash(sleutels.sort().join("\n"), 16)])),
  ] as const));
};

/**
 * Eén afdruk van het hele rooster per chauffeur, zoals de meldingswachtrij ze
 * tot 09-10 bewaarde. Blijft bestaan om een wachtrij van vóór die dag nog
 * juist te vergelijken; nieuwe wachtrijen dragen dag-afdrukken.
 */
export const roosterAfdrukken = (rows: ReadonlyArray<Rij>): Map<string, string> => {
  const lijsten = new Map<string, string[]>();
  for (const r of rows) {
    const id = tekst(r.driverId);
    if (!id) continue;
    const lijst = lijsten.get(id) ?? [];
    lijst.push(dienstSleutel(r));
    lijsten.set(id, lijst);
  }
  return new Map([...lijsten].map(([id, sleutels]) => [id, hash(sleutels.sort().join("\n"), 32)] as const));
};

/** De dagen waarop twee afdrukken van één chauffeur verschillen, gesorteerd; leeg = niets gewijzigd. */
export const gewijzigdeDagen = (oud: DagAfdrukken | undefined, nieuw: DagAfdrukken | undefined): string[] => {
  const dagen = new Set([...Object.keys(oud ?? {}), ...Object.keys(nieuw ?? {})]);
  return [...dagen].filter((dag) => (oud?.[dag] ?? "") !== (nieuw?.[dag] ?? "")).sort();
};

/** Per chauffeur de gewijzigde dagen; wie niets ziet veranderen staat er niet in. */
export const gewijzigdeDagenPerChauffeur = (
  oud: ReadonlyMap<string, DagAfdrukken>,
  nieuw: ReadonlyMap<string, DagAfdrukken>,
): Map<string, string[]> => {
  const uit = new Map<string, string[]>();
  for (const id of new Set([...oud.keys(), ...nieuw.keys()])) {
    const dagen = gewijzigdeDagen(oud.get(id), nieuw.get(id));
    if (dagen.length > 0) uit.set(id, dagen);
  }
  return uit;
};

export const ROOSTER_URL = "/?view=rooster";
export const ROOSTER_PUSH_TITEL = "Rooster bijgewerkt";

const opsomming = (dagen: readonly string[]) =>
  dagen.length === 1
    ? DAG_DMJ(dagen[0])
    : `${dagen.slice(0, -1).map(DAG_DMJ).join(", ")} en ${DAG_DMJ(dagen[dagen.length - 1])}`;

/**
 * De tekst van de melding. Tot drie dagen worden genoemd; daarboven het
 * aantal met de eerste en de laatste dag. Zonder dagen (een wachtrij van vóór
 * 09-10) de oude algemene tekst.
 */
export const roosterPushTekst = (dagen: readonly string[]): string => {
  const uniek = [...new Set(dagen.filter(Boolean))].sort();
  if (uniek.length === 0) return "Je rooster is gewijzigd, bekijk je diensten.";
  if (uniek.length <= 3) return `Je rooster is gewijzigd op ${opsomming(uniek)}. Bekijk je diensten.`;
  return `Je rooster is gewijzigd op ${uniek.length} dagen tussen ${DAG_DMJ(uniek[0])} en ${DAG_DMJ(uniek[uniek.length - 1])}. Bekijk je diensten.`;
};

/**
 * De tekst na een matrix-import. Wie in de geïmporteerde periode nog geen
 * enkele dienst had (een verse maand) hoort dat de planning klaarstaat; wie er
 * al diensten had, hoort welke dagen verschillen.
 */
export const importPushTekst = (opties: { hadDiensten: boolean; dagen: readonly string[]; van: string | null; tot: string | null }): string => {
  if (!opties.hadDiensten) {
    const periode = opties.van && opties.tot ? ` van ${DAG_DMJ(opties.van)} t/m ${DAG_DMJ(opties.tot)}` : "";
    return `Je planning${periode} staat klaar. Bekijk je rooster.`;
  }
  return roosterPushTekst(opties.dagen);
};

/**
 * Eén push per unieke tekst: chauffeurs met dezelfde gewijzigde dagen (na een
 * dienstoverzicht-wijziging bijna iedereen) gaan samen in één verzending.
 * Geeft het aantal chauffeurs terug dat een melding kreeg.
 */
export const verstuurRoosterPushes = async (
  dagenPerChauffeur: ReadonlyMap<string, readonly string[]>,
  opties: { titel?: string; tekst?: (id: string, dagen: readonly string[]) => string } = {},
): Promise<number> => {
  const groepen = new Map<string, string[]>();
  for (const [id, dagen] of dagenPerChauffeur) {
    const body = opties.tekst ? opties.tekst(id, dagen) : roosterPushTekst(dagen);
    groepen.set(body, [...(groepen.get(body) ?? []), id]);
  }
  for (const [body, ids] of groepen) {
    await sendPushToUsers(ids, { title: opties.titel ?? ROOSTER_PUSH_TITEL, soort: "planning", body, url: ROOSTER_URL });
  }
  return dagenPerChauffeur.size;
};
