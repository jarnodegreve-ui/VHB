import crypto from "node:crypto";
import { DAG_DMJ } from "./helpers.js";
import { dagKort, opsomming, schoon, tijdvakken, veilig } from "./meldingTeksten.js";
import { sendPushToUsers } from "./push.js";
import { normaliseerTijd } from "../../shared/tijdNotatie.js";

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
 *
 * Sinds ronde 6 (punt 11, stap 2) zegt de tekst ook de nieuwe stand: wat er op
 * een gewijzigde dag NU staat, zodat de chauffeur de app niet hoeft te openen
 * om dat te weten. Welke dag gewijzigd is blijft de zaak van de afdrukken; de
 * tekst leest alleen de rijen die de aanroeper op het moment van verzenden in
 * handen heeft (`rijen`), nooit een eigen lezing.
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

/** Langer dan dit en de zin valt terug op een kortere vorm (een melding op een vergrendeld scherm). */
export const ROOSTER_TEKST_MAX = 170;

/** Zonder dagen (een wachtrij van vóór 09-10): de algemene tekst. */
const ALGEMEEN = "Je rooster is gewijzigd, bekijk je diensten.";

/** De gewijzigde dagen, elk één keer, oplopend. */
const uniekeDagen = (dagen: readonly string[]): string[] => [...new Set(dagen.filter(Boolean))].sort();

/**
 * De zin van vóór ronde 6, met volledige datums. Alleen nog het vangnet voor
 * een dag die geen echte kalenderdag is en dus geen korte vorm heeft.
 */
const zinVoluit = (uniek: readonly string[]): string =>
  uniek.length <= 3
    ? `Je rooster is gewijzigd op ${opsomming(uniek.map(DAG_DMJ))}. Bekijk je diensten.`
    : `Je rooster is gewijzigd op ${uniek.length} dagen tussen ${DAG_DMJ(uniek[0])} en ${DAG_DMJ(uniek[uniek.length - 1])}. Bekijk je diensten.`;

/**
 * Alleen de dagen, zonder de stand: tot drie dagen bij naam ("vr 13/11"),
 * daarboven het aantal met de eerste en de laatste dag.
 */
const zinMetDagen = (uniek: readonly string[]): string => {
  if (uniek.length === 0) return ALGEMEEN;
  const kort = uniek.map(dagKort);
  if (!kort.every((dag): dag is string => dag !== null)) return zinVoluit(uniek);
  if (kort.length <= 3) return `Je rooster is gewijzigd op ${opsomming(kort)}. Bekijk je diensten.`;
  return `Je rooster is gewijzigd op ${kort.length} dagen tussen ${kort[0]} en ${kort[kort.length - 1]}. Bekijk je diensten.`;
};

/** Eén dienst op een dag: het nummer en de uren van al zijn delen (null = niet leesbaar). */
type DagDienst = { nummer: string; uren: string[] | null };

const LAATST = "99:99";
/** Een langer "dienstnummer" is geen nummer: afgekapt zou de zin een dienst noemen die niet bestaat. */
const NUMMER_MAX = 40;

/**
 * De diensten van één dag uit de rijen van de chauffeur, in een vaste
 * volgorde: de delen op starttijd, de diensten op hun eerste deel. Dezelfde
 * sleutel voor de dag als de afdrukken (`tekst(r.date)`): met een andere
 * sleutel zou een gewijzigde dag leeg lijken. Null zodra een rij geen
 * bruikbaar dienstnummer draagt: dan valt er over die dag niets zeker te zeggen.
 */
const dienstenOpDag = (rijen: ReadonlyArray<Rij>, dag: string): DagDienst[] | null => {
  const delen = rijen
    .filter((r) => tekst(r.date) === dag)
    .map((r) => ({
      rij: r,
      nummer: schoon(r.line, NUMMER_MAX + 1),
      sorteer: `${normaliseerTijd(r.startTime) ?? LAATST}|${normaliseerTijd(r.endTime) ?? LAATST}|${schoon(r.line, NUMMER_MAX + 1)}`,
    }))
    .sort((a, b) => (a.sorteer < b.sorteer ? -1 : a.sorteer > b.sorteer ? 1 : 0));
  if (delen.some((d) => !d.nummer || d.nummer.length > NUMMER_MAX)) return null;
  const perNummer = new Map<string, Rij[]>();
  for (const d of delen) perNummer.set(d.nummer, [...(perNummer.get(d.nummer) ?? []), d.rij]);
  return [...perNummer].map(([nummer, rijenVanDienst]) => ({ nummer, uren: tijdvakken(rijenVanDienst) }));
};

/** "dienst 2116", of "diensten 2116 en 4101" bij meer dan één dienst op de dag. */
const nummers = (diensten: readonly DagDienst[]): string =>
  `${diensten.length === 1 ? "dienst" : "diensten"} ${opsomming(diensten.map((d) => d.nummer))}`;

/**
 * De zin met de nieuwe stand, of null als die vorm hier niet past (geen of
 * meer dan drie dagen, een dag zonder korte vorm, een rij zonder dienstnummer,
 * of een zin die te lang wordt): de aanroeper valt dan terug op de dagen.
 *
 * Dat iemand vrij is staat er nooit. Een schoolrit of bureaudag staat op het
 * bord zonder rijen in de planning, dus een dag zonder rijen is alleen "geen
 * dienst meer in de planning". Die zin klopt altijd: een dag zonder rijen is
 * alleen gewijzigd als er vóór de wijziging wel rijen stonden.
 */
const zinMetStand = (uniek: readonly string[], rijen: ReadonlyArray<Rij>): string | null => {
  if (uniek.length === 0 || uniek.length > 3) return null;
  const dagen: Array<{ kort: string; diensten: DagDienst[] }> = [];
  for (const dag of uniek) {
    const kort = dagKort(dag);
    const diensten = dienstenOpDag(rijen, dag);
    if (!kort || !diensten) return null;
    dagen.push({ kort, diensten });
  }
  const past = (zin: string) => (zin.length <= ROOSTER_TEKST_MAX ? zin : null);

  if (dagen.length === 1) {
    const [{ kort, diensten }] = dagen;
    const begin = `Je rooster is gewijzigd op ${kort}: `;
    if (diensten.length === 0) return `${begin}je hebt die dag geen dienst meer in de planning. Bekijk je rooster.`;
    // Alle uren of geen: is één deel niet leesbaar, dan vallen de uren weg en
    // verwijst de zin naar het rooster.
    const metUren = diensten.every((d) => d.uren !== null)
      ? past(`${begin}${diensten.map((d) => `dienst ${d.nummer}, ${opsomming(d.uren ?? [])}`).join(" en ")}.`)
      : null;
    return metUren ?? past(`${begin}${nummers(diensten)}. Bekijk je rooster.`);
  }

  // Twee of drie dagen: per dag kort, alleen het dienstnummer.
  const perDag = dagen.map(({ kort, diensten }) => `${kort} ${diensten.length === 0 ? "geen dienst meer" : nummers(diensten)}`);
  return past(`Je rooster is gewijzigd: ${perDag.join(", ")}. Bekijk je rooster.`);
};

/**
 * De tekst van de melding. `rijen` = de rijen van DEZE chauffeur zoals ze op
 * het moment van verzenden in de planning staan (de zojuist geschreven
 * planning, of wat de cron net las); de bouwer leest er alleen de gewijzigde
 * dagen uit. Met rijen:
 *
 *  - één dag: "… op vr 13/11: dienst 2116, 06:45–10:00 en 15:45–19:35." (alle
 *    delen; twee diensten op één dag allebei), of "… je hebt die dag geen
 *    dienst meer in de planning. Bekijk je rooster.";
 *  - twee of drie dagen: per dag het dienstnummer of "geen dienst meer";
 *  - meer dan drie dagen: het aantal met de eerste en de laatste dag.
 *
 * Zonder rijen (de aanroeper kent de stand op dat moment niet zeker) alleen
 * de dagen. Zonder dagen (een wachtrij van vóór 09-10) de algemene tekst.
 *
 * Gooit nooit: de melding vertrekt ná de geschreven planning, en een fout in
 * de tekst mag die niet doen mislukken. Bij een fout de zin met alleen de
 * dagen, en als ook die niet lukt de algemene tekst.
 */
export const roosterPushTekst = (dagen: readonly string[], rijen?: ReadonlyArray<Rij> | null): string => {
  const zonderStand = veilig("rooster bijgewerkt, de dagen", () => zinMetDagen(uniekeDagen(dagen)), ALGEMEEN);
  if (rijen === undefined || rijen === null) return zonderStand;
  return veilig("rooster bijgewerkt, de nieuwe stand", () => zinMetStand(uniekeDagen(dagen), rijen) ?? zonderStand, zonderStand);
};

/**
 * De tekst na een matrix-import. Wie in de geïmporteerde periode nog geen
 * enkele dienst had (een verse maand) hoort dat de planning klaarstaat; wie er
 * al diensten had, hoort welke dagen verschillen en wat er nu staat (`rijen`,
 * zie `roosterPushTekst`).
 */
export const importPushTekst = (opties: {
  hadDiensten: boolean; dagen: readonly string[]; van: string | null; tot: string | null;
  rijen?: ReadonlyArray<Rij> | null;
}): string => {
  if (!opties.hadDiensten) {
    const periode = opties.van && opties.tot ? ` van ${DAG_DMJ(opties.van)} t/m ${DAG_DMJ(opties.tot)}` : "";
    return `Je planning${periode} staat klaar. Bekijk je rooster.`;
  }
  return roosterPushTekst(opties.dagen, opties.rijen);
};

/**
 * De rijen per chauffeur, alleen voor wie een melding krijgt. Dezelfde sleutel
 * als de afdrukken: de kolom `driverId`, nooit de id van de rij (die blijft na
 * een ruil de chauffeur uit de matrix dragen).
 */
const rijenPerChauffeur = (rijen: ReadonlyArray<Rij>, ontvangers: ReadonlyMap<string, unknown>): Map<string, Rij[]> => {
  const uit = new Map<string, Rij[]>();
  for (const r of rijen) {
    const id = tekst(r.driverId);
    if (!ontvangers.has(id)) continue;
    const lijst = uit.get(id) ?? [];
    lijst.push(r);
    uit.set(id, lijst);
  }
  return uit;
};

/**
 * Hoeveel verzendingen tegelijk onderweg zijn. Sinds de tekst de stand noemt
 * heeft bij één tot drie gewijzigde dagen elke chauffeur zijn eigen tekst, en
 * dus zijn eigen verzending: tot ±60 in plaats van 1 tot 3. Na elkaar wachtte
 * de planner (knop, import) of de cron op elke verzending apart, en een trage
 * pushdienst bracht de functie over haar limiet van 60 s.
 *
 * Waarom 10: een verzending duurt hoogstens ±8 s (`PUSH_DEADLINE_MS`) plus haar
 * databasebezoeken. Met 60 verzendingen is dat in het slechtste geval 6 rondes
 * van 8 s = 48 s (met 8 tegelijk 60 s, met 6 tegelijk 80 s); gemeten met de
 * databasebezoeken erbij ±49 s, gewoon ±2 s. Dat is alleen het versturen: het
 * werk ervoor (lezen, schrijven) komt erbovenop, en een databasebezoek heeft
 * geen eigen tijdslimiet, dus dit is geen harde bovengrens. Elke verzending
 * doet haar databasebezoeken na elkaar, dus er lopen er hoogstens 10 tegelijk:
 * de helft van de 20 gelijktijdige aanroepen die een opstart zwaar maakten.
 */
export const ROOSTER_GELIJKTIJDIG = 10;

/**
 * Verstuurt de groepen met hoogstens `ROOSTER_GELIJKTIJDIG` tegelijk. Ze
 * starten in de volgorde van de lijst; een verzending die traag is houdt
 * alleen haar eigen plaats bezet, de andere gaan door.
 *
 * Mislukt een verzending, dan start er geen nieuwe meer, loopt af wat al
 * onderweg is en krijgt de aanroeper de eerste fout, zoals toen ze na elkaar
 * vertrokken: de cron laat de wachtrij dan staan en probeert het opnieuw.
 */
const verstuurGroepen = async (groepen: ReadonlyArray<readonly [body: string, ids: string[]]>, titel: string): Promise<void> => {
  let volgende = 0;
  let fout = null as { oorzaak: unknown } | null;
  const werker = async () => {
    while (!fout && volgende < groepen.length) {
      const [body, ids] = groepen[volgende]!;
      volgende += 1;
      try {
        await sendPushToUsers(ids, { title: titel, soort: "planning", body, url: ROOSTER_URL });
      } catch (oorzaak) {
        fout ??= { oorzaak };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(ROOSTER_GELIJKTIJDIG, groepen.length) }, werker));
  if (fout) throw fout.oorzaak;
};

/**
 * Eén push per unieke tekst: chauffeurs met dezelfde tekst gaan samen in één
 * verzending. Geeft het aantal chauffeurs terug dat een melding kreeg.
 *
 * Met `rijen` leest bij één tot drie gewijzigde dagen elke chauffeur zijn
 * eigen dienst: de regel is dezelfde, maar het worden dan zoveel verzendingen
 * als er chauffeurs zijn. Ze vertrekken samen, niet na elkaar
 * (`verstuurGroepen`).
 *
 * `rijen` = de HELE planning zoals ze op het moment van verzenden staat; de
 * tekst van elke chauffeur noemt dan wat er op zijn gewijzigde dagen staat.
 * Laat `rijen` weg als die stand niet zeker vaststaat: dan noemt de tekst
 * alleen de dagen. Geen eigen lezing van de planning: de aanroeper geeft door
 * wat hij al in handen heeft.
 */
export const verstuurRoosterPushes = async (
  dagenPerChauffeur: ReadonlyMap<string, readonly string[]>,
  opties: {
    titel?: string;
    rijen?: ReadonlyArray<Rij> | null;
    tekst?: (id: string, dagen: readonly string[], rijen: ReadonlyArray<Rij> | undefined) => string;
  } = {},
): Promise<number> => {
  const stand = opties.rijen;
  // Lukt het indelen niet (een rij in een onverwachte vorm), dan de dagen alleen.
  const perChauffeur = stand ? veilig("rooster bijgewerkt, rijen per chauffeur", () => rijenPerChauffeur(stand, dagenPerChauffeur), null) : null;
  const groepen = new Map<string, string[]>();
  for (const [id, dagen] of dagenPerChauffeur) {
    const eigen = perChauffeur ? perChauffeur.get(id) ?? [] : undefined;
    const body = opties.tekst ? opties.tekst(id, dagen, eigen) : roosterPushTekst(dagen, eigen);
    groepen.set(body, [...(groepen.get(body) ?? []), id]);
  }
  await verstuurGroepen([...groepen], opties.titel ?? ROOSTER_PUSH_TITEL);
  return dagenPerChauffeur.size;
};
