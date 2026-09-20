import crypto from "node:crypto";
import type { AuthenticatedRequest } from "../types.js";
import { DAG_DMJ, toLookupToken } from "../helpers.js";
import { sendPushToUsers } from "../push.js";
import { ROOSTER_MELDING_RUST_MINUTEN } from "../../shared/roosterMelding.js";
import {
  applySwapsToPlanningRows, buildPlanningFromMatrix, getAppSetting, getPlanningData, getPlanningVersion, getSwapsData,
  logActivity, replacePlanningData, setAppSetting, summarizeTokens, swapRaaktBereik,
} from "../storage.js";

/**
 * Planning heropbouwen uit de opgeslagen matrix: de ENE kern achter
 *  - de knop "Planning opnieuw opbouwen" (POST /api/planning/sync-from-matrix,
 *    bron "handmatig"), en
 *  - het automatisch bijwerken na een inhoudelijke wijziging in het
 *    dienstoverzicht (POST /api/services, bron "dienstoverzicht").
 *
 * Gedeeld: opbouw uit de matrix, replay van goedgekeurde ruilen, de blokkade
 * op onbekende codes en niet-gematchte chauffeurs, de atomaire vervanging, de
 * log en de push-diff per chauffeur.
 *
 * De automatische weg is bewust STRENGER, want niemand kijkt naar een
 * bevestigingsvenster: zij mag alleen tijden, delen en loopnummers van
 * bestaande diensten bijwerken. Zou de heropbouw ook veranderen WIE welke
 * dienst op welke dag rijdt (een dienst erbij of weg, bv. door een gewiste
 * planning, een testdienst of een ruil die niet meer toepasbaar is), dan
 * gebeurt er niets en krijgt de planner de reden plus de weg naar de knop.
 */

export type HeropbouwBron = "handmatig" | "dienstoverzicht";

type PlanningRij = {
  id?: unknown; date?: unknown; startTime?: unknown; endTime?: unknown; line?: unknown;
  loopnr?: unknown; busNumber?: unknown; driverId?: unknown;
};

type OpbouwSamenvatting = Awaited<ReturnType<typeof buildPlanningFromMatrix>>["summary"];
type ReplayTelling = { applied: number; skipped: number; alVerwerkt: number };

export type HeropbouwUitkomst =
  | {
    status: "bijgewerkt";
    summary: OpbouwSamenvatting;
    reapplied: ReplayTelling;
    /** Chauffeurs van wie het rooster door déze heropbouw wijzigde. */
    gewijzigdeChauffeurs: number;
    /** Aantal chauffeurs dat NU een push kreeg (handmatig); 0 bij uitstel. */
    gemeld: number;
    /** true = de melding wacht op rust (automatische weg). */
    meldingUitgesteld: boolean;
  }
  /** Alleen automatisch: de verse opbouw is identiek aan wat er stond. */
  | { status: "ongewijzigd"; summary: OpbouwSamenvatting }
  /** Alleen automatisch: er valt niets bij te werken. */
  | { status: "overgeslagen"; reden: "geen-matrix" | "lege-planning"; melding: string }
  | {
    status: "geblokkeerd";
    reden: "onbekende-codes" | "toewijzing";
    melding: string;
    unknownCodes: string[];
    unmatchedDrivers: string[];
  }
  /** De planning werd twee keer op rij tijdens het rekenen door iemand anders gewijzigd. */
  | { status: "bezet"; melding: string };

/** Uitkomst voor het antwoord van POST /api/services. */
export type AutoHeropbouwUitkomst = HeropbouwUitkomst | { status: "mislukt"; melding: string };

const ROOSTER_URL = "/?view=rooster";
const ROOSTER_PUSH = {
  title: "Rooster bijgewerkt",
  soort: "planning" as const,
  body: "Je rooster is gewijzigd, bekijk je diensten.",
  url: ROOSTER_URL,
};

/** Heropbouw-replay: goedgekeurde ruilen opnieuw toepassen op een vers
 *  gegenereerde planning. De matrix (Excel) kent de ruilen immers niet —
 *  zonder deze stap veegde elke import/heropbouw alle doorgevoerde wissels
 *  weer weg (en moest de planner ze in Excel overtypen). Volgorde op
 *  decidedAt zodat een latere ruil op het resultaat van een eerdere werkt. */
export const reapplyApprovedSwaps = async (
  shifts: Array<{ date: string; line: string; driverId: string }>,
  bereik?: { van: string | null; tot: string | null },
) => {
  // Ook 'completed': een voltooide ruil is gereden zoals gewisseld (zelfde
  // regel als de maandplanning-weergave). Zonder 'completed' draaide een
  // heropbouw die wissel stil terug en spraken rooster en maandplanning
  // elkaar tegen.
  const approved = (await getSwapsData())
    .filter((sw) => sw.status === "approved" || sw.status === "completed")
    .sort((a, b) => String(a.decidedAt ?? "").localeCompare(String(b.decidedAt ?? "")));
  // Alleen ruilen binnen het geïmporteerde bereik meetellen. Zonder deze filter
  // telde élke historische ruil buiten het bereik als "niet toepasbaar", zodat
  // de import-log een almaar groeiend "(x niet toepasbaar)" meldde terwijl er
  // niets mis was — en een échte mismatch (dienst intussen handmatig verlegd)
  // daarin verdronk.
  // Beide benen tellen (swapRaaktBereik): een maandoverschrijdende 1-op-1-
  // ruil met het terugbeen ín de periode moest anders stil terug.
  const relevant = bereik?.van && bereik?.tot
    ? approved.filter((sw) => swapRaaktBereik(sw, { van: bereik.van!, tot: bereik.tot! }))
    : approved;
  return applySwapsToPlanningRows(shifts, relevant);
};

// --- Wat telt als "het dienstoverzicht wijzigde" ---------------------------

const DIENST_VELDEN = [
  "startTime", "endTime", "loopnr", "startTime2", "endTime2", "loopnr2", "startTime3", "endTime3", "loopnr3",
] as const;

/**
 * Afdruk van alles in het dienstoverzicht waar de planning-opbouw naar kijkt:
 * per dienstnummer de schrijfwijze, de drie tijdsblokken en de loopnummers.
 * Bewust NIET op id: de Excel-import van het dienstoverzicht geeft elke dienst
 * een verse id, ook als er inhoudelijk niets wijzigde. Dubbele nummers: de
 * laatste wint, net als in de opbouw zelf.
 */
export const dienstenAfdruk = (services: ReadonlyArray<Record<string, unknown>>): string => {
  const perNummer = new Map<string, string>();
  for (const s of services) {
    const nummer = String(s?.serviceNumber ?? "").trim();
    perNummer.set(toLookupToken(nummer), [nummer, ...DIENST_VELDEN.map((veld) => String(s?.[veld] ?? "").trim())].join("|"));
  }
  return [...perNummer].sort(([a], [b]) => a.localeCompare(b)).map(([sleutel, waarde]) => `${sleutel}=${waarde}`).join("\n");
};

/** Verschilt het opgeslagen dienstoverzicht inhoudelijk van wat er stond? */
export const dienstenVerschillenVoorPlanning = (
  vorige: ReadonlyArray<Record<string, unknown>>,
  volgende: ReadonlyArray<Record<string, unknown>>,
): boolean => dienstenAfdruk(vorige) !== dienstenAfdruk(volgende);

// --- Afdrukken van de planning ----------------------------------------------

const tekst = (v: unknown) => String(v ?? "");
const dienstSleutel = (r: PlanningRij) =>
  `${tekst(r.date)}|${tekst(r.startTime)}|${tekst(r.endTime)}|${tekst(r.line)}|${tekst(r.loopnr)}|${tekst(r.busNumber)}`;
const hash = (s: string) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 32);

/**
 * Per chauffeur één afdruk van zijn volledige rooster. Twee gelijke afdrukken
 * = voor die chauffeur is er niets gewijzigd. Dit is de push-diff van de
 * heropbouw ("alleen wie echt iets ziet veranderen krijgt een melding") én de
 * basis van de meldingswachtrij hieronder.
 */
export const roosterAfdrukken = (rows: ReadonlyArray<PlanningRij>): Map<string, string> => {
  const lijsten = new Map<string, string[]>();
  for (const r of rows) {
    const id = tekst(r.driverId);
    if (!id) continue;
    const lijst = lijsten.get(id) ?? [];
    lijst.push(dienstSleutel(r));
    lijsten.set(id, lijst);
  }
  return new Map([...lijsten].map(([id, sleutels]) => [id, hash(sleutels.sort().join("\n"))] as const));
};

const gewijzigdeChauffeurs = (oud: Map<string, string>, nieuw: Map<string, string>) =>
  [...new Set([...oud.keys(), ...nieuw.keys()])].filter((id) => oud.get(id) !== nieuw.get(id));

/** Wie rijdt welke dienst op welke dag, los van tijden, delen en loopnummers. */
const toewijzingen = (rows: ReadonlyArray<PlanningRij>) =>
  new Map(rows.map((r) => [`${tekst(r.date)}|${toLookupToken(tekst(r.line))}|${tekst(r.driverId)}`, r] as const));

const rijAfdruk = (r: PlanningRij) => `${tekst(r.id)}|${tekst(r.driverId)}|${dienstSleutel(r)}`;
const zelfdeRijen = (a: ReadonlyArray<PlanningRij>, b: ReadonlyArray<PlanningRij>) => {
  if (a.length !== b.length) return false;
  const links = a.map(rijAfdruk).sort();
  const rechts = b.map(rijAfdruk).sort();
  return links.every((waarde, i) => waarde === rechts[i]);
};

// --- Meldingswachtrij: één melding per chauffeur per reeks wijzigingen ------
//
// Het dienstoverzicht slaat per dienst op: wie een nieuwe dienstregeling
// invoert, bewaart tien tot twintig keer kort na elkaar, en elke save herbouwt
// de planning. Zou elke heropbouw meteen pushen, dan krijgt een chauffeur die
// drie van die diensten rijdt drie keer "Rooster bijgewerkt".
//
// Daarom pusht de automatische weg niet zelf. Ze noteert per geraakte
// chauffeur de afdruk van zijn rooster van VÓÓR de eerste wijziging (de
// basis) en het moment van de laatste wijziging. De cron
// /api/cron/rooster-meldingen (elke 5 minuten) verstuurt pas na
// ROOSTER_MELDING_RUST_MS zonder nieuwe wijziging, en alleen naar wie zijn
// rooster dan nog van de basis verschilt. Gevolg: één melding per chauffeur
// per reeks, over de EINDtoestand; wie na een vergissing weer bij zijn oude
// rooster uitkomt, krijgt niets. De handmatige knop pusht meteen (zoals
// altijd) en neemt de wachtrij mee, zodat niemand twee keer hetzelfde hoort.
// Geen migratie: de wachtrij is één rij in app_settings.

export const ROOSTER_MELDING_WACHTRIJ_KEY = "rooster_melding_wachtrij";
export const ROOSTER_MELDING_RUST_MS = ROOSTER_MELDING_RUST_MINUTEN * 60 * 1000;
export { ROOSTER_MELDING_RUST_MINUTEN };

type Wachtrij = {
  /** ISO-moment van de laatste automatische heropbouw die iets wijzigde. */
  laatsteWijziging: string;
  /** Per chauffeur: afdruk van zijn rooster vóór de eerste wijziging ("" = had geen diensten). */
  basis: Record<string, string>;
};

const LEGE_WACHTRIJ = { laatsteWijziging: null, basis: {} };

const leesWachtrij = async (): Promise<Wachtrij | null> => {
  const ruw = await getAppSetting<{ laatsteWijziging?: unknown; basis?: unknown }>(ROOSTER_MELDING_WACHTRIJ_KEY);
  if (!ruw || typeof ruw !== "object") return null;
  const basis = ruw.basis && typeof ruw.basis === "object" && !Array.isArray(ruw.basis) ? ruw.basis as Record<string, unknown> : {};
  const laatsteWijziging = typeof ruw.laatsteWijziging === "string" ? ruw.laatsteWijziging : "";
  if (!laatsteWijziging || Object.keys(basis).length === 0) return null;
  return { laatsteWijziging, basis: Object.fromEntries(Object.entries(basis).map(([id, afdruk]) => [id, tekst(afdruk)])) };
};

const isRijp = (wachtrij: Wachtrij, nu: number) => {
  const sinds = Date.parse(wachtrij.laatsteWijziging);
  return !Number.isFinite(sinds) || nu - sinds >= ROOSTER_MELDING_RUST_MS;
};

/** Wie uit de wachtrij heeft nu een ander rooster dan zijn basis? */
const teMeldenUitWachtrij = (wachtrij: Wachtrij, huidig: Map<string, string>) =>
  Object.keys(wachtrij.basis).filter((id) => wachtrij.basis[id] !== (huidig.get(id) ?? ""));

/**
 * Automatische weg, ná het vervangen: de geraakte chauffeurs in de wachtrij
 * zetten. Een wachtrij die al rijp was (de cron liep nog niet, of draait niet
 * in deze omgeving) hoort bij de VORIGE reeks: die gaat eerst de deur uit,
 * tegen de stand van vóór deze heropbouw.
 */
const zetInWachtrij = async (gewijzigd: string[], oud: Map<string, string>, nu: number) => {
  let wachtrij = await leesWachtrij();
  if (wachtrij && isRijp(wachtrij, nu)) {
    const ontvangers = teMeldenUitWachtrij(wachtrij, oud);
    if (ontvangers.length > 0) await sendPushToUsers(ontvangers, ROOSTER_PUSH);
    wachtrij = null;
  }
  const basis = { ...(wachtrij?.basis ?? {}) };
  for (const id of gewijzigd) if (!(id in basis)) basis[id] = oud.get(id) ?? "";
  await setAppSetting(ROOSTER_MELDING_WACHTRIJ_KEY, { laatsteWijziging: new Date(nu).toISOString(), basis });
};

/**
 * Cron: verstuur de wachtrij zodra het lang genoeg stil is. Faalt het
 * versturen, dan blijft de wachtrij staan en probeert de volgende beurt het
 * opnieuw. Kwam er tijdens het versturen een wijziging bij, dan blijft de
 * wachtrij bestaan met als nieuwe basis het rooster waarover net gemeld is.
 */
export const verstuurRoosterMeldingen = async (nu = Date.now()): Promise<{ status: "leeg" | "wacht" | "verstuurd"; ontvangers: number }> => {
  const wachtrij = await leesWachtrij();
  if (!wachtrij) return { status: "leeg", ontvangers: 0 };
  if (!isRijp(wachtrij, nu)) return { status: "wacht", ontvangers: 0 };
  const huidig = roosterAfdrukken(await getPlanningData() as PlanningRij[]);
  const ontvangers = teMeldenUitWachtrij(wachtrij, huidig);
  if (ontvangers.length > 0) await sendPushToUsers(ontvangers, ROOSTER_PUSH);
  const later = await leesWachtrij();
  if (later && later.laatsteWijziging !== wachtrij.laatsteWijziging) {
    const basis = { ...later.basis };
    for (const id of Object.keys(wachtrij.basis)) basis[id] = huidig.get(id) ?? "";
    await setAppSetting(ROOSTER_MELDING_WACHTRIJ_KEY, { laatsteWijziging: later.laatsteWijziging, basis });
  } else {
    await setAppSetting(ROOSTER_MELDING_WACHTRIJ_KEY, LEGE_WACHTRIJ);
  }
  return { status: "verstuurd", ontvangers: ontvangers.length };
};

// --- De kern ------------------------------------------------------------------

const replayTekst = (reapplied: ReplayTelling) =>
  `${reapplied.applied} goedgekeurde ruil(en) opnieuw doorgevoerd${reapplied.alVerwerkt > 0 ? `, ${reapplied.alVerwerkt} al in de Excel verwerkt` : ""}${reapplied.skipped > 0 ? ` (${reapplied.skipped} niet toepasbaar)` : ""}`;

const dienstLabel = (r: PlanningRij) => `${DAG_DMJ(tekst(r.date))} dienst ${tekst(r.line)}`;

const NAAR_DE_KNOP = "Controleer dit en bouw de planning zelf opnieuw op in Beheer roosters.";

/**
 * Bouwt de planning opnieuw op uit de opgeslagen matrix en het huidige
 * dienstoverzicht. Gooit bij een technische fout; de aanroeper beslist wat
 * dat betekent (de knop: 500, de automatische weg: nooit de save laten falen).
 */
export const heropbouwPlanning = async (req: AuthenticatedRequest, bron: HeropbouwBron): Promise<HeropbouwUitkomst> => {
  const automatisch = bron === "dienstoverzicht";
  // Hooguit twee pogingen: schreef iemand anders (import, ruil-doorvoer)
  // tijdens het rekenen in planning of matrix, dan is de verse set al
  // verouderd. Eén keer opnieuw rekenen op de nieuwe stand; gebeurt het weer,
  // dan stoppen we zonder te schrijven.
  for (let poging = 1; poging <= 2; poging++) {
    const versieVoor = await getPlanningVersion();
    const [generatedPlanning, vorigePlanning] = await Promise.all([buildPlanningFromMatrix(), getPlanningData()]);
    const { summary, shifts } = generatedPlanning;

    if (automatisch && summary.importedDays === 0) {
      return { status: "overgeslagen", reden: "geen-matrix", melding: "er is nog geen planning geïmporteerd, er valt niets bij te werken." };
    }

    // Goedgekeurde ruilen opnieuw toepassen — de matrix kent ze niet.
    const reapplied = await reapplyApprovedSwaps(shifts);

    // Zelfde vangrails als /import: zonder deze guard liet een naamswijziging
    // in gebruikersbeheer ("unmatched driver") hier stilletjes alle diensten
    // van die chauffeur uit de planning vallen bij het heropbouwen.
    if (summary.unknownCodes.length > 0 || summary.unmatchedDrivers.length > 0) {
      const uitkomst: HeropbouwUitkomst = {
        status: "geblokkeerd",
        reden: "onbekende-codes",
        melding: automatisch
          ? `er zijn onbekende codes of niet-gematchte chauffeurs (codes: ${summarizeTokens(summary.unknownCodes)}; chauffeurs: ${summarizeTokens(summary.unmatchedDrivers)}). Los dit op (planningscodes, dienstnummers of gebruikersnamen) en bouw de planning daarna opnieuw op in Beheer roosters.`
          : "Opnieuw opbouwen geblokkeerd: er zijn onbekende codes of niet-gematchte chauffeurs. Los deze eerst op (planningscodes/gebruikersnamen) en probeer opnieuw.",
        unknownCodes: summary.unknownCodes,
        unmatchedDrivers: summary.unmatchedDrivers,
      };
      if (automatisch) await logNietBijgewerkt(req, uitkomst.melding);
      return uitkomst;
    }

    if (automatisch) {
      if (vorigePlanning.length === 0) {
        const melding = `de actieve planning is leeg (gewist of nog niet opgebouwd), automatisch vullen doet het portaal niet. ${NAAR_DE_KNOP}`;
        await logNietBijgewerkt(req, melding);
        return { status: "overgeslagen", reden: "lege-planning", melding };
      }
      // Alleen bijwerken, nooit herverdelen: dezelfde chauffeur, dezelfde
      // dienst, dezelfde dag, vóór en na.
      const voor = toewijzingen(vorigePlanning as PlanningRij[]);
      const na = toewijzingen(shifts);
      const erbij = [...na].filter(([sleutel]) => !voor.has(sleutel)).map(([, rij]) => rij);
      const weg = [...voor].filter(([sleutel]) => !na.has(sleutel)).map(([, rij]) => rij);
      if (erbij.length > 0 || weg.length > 0) {
        const delen: string[] = [];
        if (erbij.length > 0) delen.push(`${erbij.length} dienst(en) erbij of bij iemand anders (${summarizeTokens(erbij.map(dienstLabel), 3)})`);
        if (weg.length > 0) delen.push(`${weg.length} dienst(en) weg bij de huidige chauffeur (${summarizeTokens(weg.map(dienstLabel), 3)})`);
        const melding = `de heropbouw zou niet alleen tijden bijwerken maar ook wijzigen wie welke dienst rijdt: ${delen.join(", ")}. ${NAAR_DE_KNOP}`;
        await logNietBijgewerkt(req, melding);
        return { status: "geblokkeerd", reden: "toewijzing", melding, unknownCodes: [], unmatchedDrivers: [] };
      }
      // Niets te doen (bv. een dienst gewijzigd die niemand rijdt): geen
      // schrijfactie, dus ook geen planning_version-tik en geen refetch bij
      // elke verbonden client.
      if (zelfdeRijen(vorigePlanning as PlanningRij[], shifts)) return { status: "ongewijzigd", summary };
    }

    // Diff vóór het vervangen: alleen chauffeurs van wie het rooster écht
    // wijzigt krijgen een push. Iedereen elke keer pingen traint mensen om
    // meldingen te negeren, en dan mist iemand de wijziging die wél telt.
    const oud = roosterAfdrukken(vorigePlanning as PlanningRij[]);
    const nieuw = roosterAfdrukken(shifts); // ruilen zijn in-place toegepast
    const gewijzigd = gewijzigdeChauffeurs(oud, nieuw);

    const versieNu = await getPlanningVersion();
    if (versieVoor !== null && versieNu !== null && versieVoor !== versieNu) continue;

    await replacePlanningData(shifts);

    if (automatisch) {
      // Vanaf hier IS de planning bijgewerkt. Wat nog volgt (log, wachtrij)
      // mag die uitkomst niet meer in een "mislukt" veranderen.
      try {
        await logActivity(
          req,
          "planning",
          "Planning automatisch bijgewerkt",
          `Na een wijziging in het dienstoverzicht: ${summary.generatedShifts} diensten opgebouwd vanuit de actuele matrix, ${replayTekst(reapplied)}. Het rooster van ${gewijzigd.length} chauffeur(s) wijzigde, zij krijgen één melding zodra het ${ROOSTER_MELDING_RUST_MINUTEN} minuten stil is in het dienstoverzicht.`,
        );
      } catch (err) {
        console.error("Automatische heropbouw loggen mislukt.", err);
      }
      // De wachtrij is een gemak, geen voorwaarde: lukt ze niet (app_settings
      // onbereikbaar), dan liever nu een melding dan geen melding.
      let uitgesteld = gewijzigd.length > 0;
      if (gewijzigd.length > 0) {
        try {
          await zetInWachtrij(gewijzigd, oud, Date.now());
        } catch (err) {
          console.error("Meldingswachtrij bijwerken mislukt, de melding gaat nu meteen uit.", err);
          uitgesteld = false;
          try { await sendPushToUsers(gewijzigd, ROOSTER_PUSH); } catch (pushErr) { console.error("Rooster-melding versturen mislukt.", pushErr); }
        }
      }
      return {
        status: "bijgewerkt", summary, reapplied, gewijzigdeChauffeurs: gewijzigd.length,
        gemeld: uitgesteld ? 0 : gewijzigd.length, meldingUitgesteld: uitgesteld,
      };
    }

    await logActivity(
      req,
      "planning",
      "Planning opnieuw opgebouwd",
      `${summary.generatedShifts} diensten opgebouwd vanuit de actuele matrix, ${replayTekst(reapplied)}. Onbekende codes: ${summarizeTokens(summary.unknownCodes)}.`,
    );
    // "Staat mijn rooster er al op?" is dé vraag van personeel — beantwoord
    // hem proactief, maar alleen bij wie er iets veranderde. Wie nog in de
    // wachtrij van de automatische weg stond, wordt tegen zíjn basis
    // beoordeeld en gaat nu mee: daarna is de wachtrij leeg.
    let ontvangers = gewijzigd;
    try {
      const wachtrij = await leesWachtrij();
      if (wachtrij) {
        ontvangers = [...new Set([
          ...gewijzigd.filter((id) => !(id in wachtrij.basis)),
          ...teMeldenUitWachtrij(wachtrij, nieuw),
        ])];
        await setAppSetting(ROOSTER_MELDING_WACHTRIJ_KEY, LEGE_WACHTRIJ);
      }
    } catch (err) {
      console.error("Meldingswachtrij lezen mislukt, de knop meldt alleen zijn eigen wijzigingen.", err);
    }
    if (ontvangers.length > 0) await sendPushToUsers(ontvangers, ROOSTER_PUSH);
    return { status: "bijgewerkt", summary, reapplied, gewijzigdeChauffeurs: gewijzigd.length, gemeld: ontvangers.length, meldingUitgesteld: false };
  }

  const melding = automatisch
    ? "de planning werd op hetzelfde moment door iemand anders gewijzigd (import of dienstruil). Bouw de planning zo meteen zelf opnieuw op in Beheer roosters."
    : "De planning werd op hetzelfde moment door iemand anders gewijzigd (import of dienstruil). Probeer het zo meteen opnieuw.";
  if (automatisch) await logNietBijgewerkt(req, melding);
  return { status: "bezet", melding };
};

const logNietBijgewerkt = (req: AuthenticatedRequest, melding: string) =>
  logActivity(req, "planning", "Planning niet automatisch bijgewerkt", `Na een wijziging in het dienstoverzicht: ${melding}`);

/**
 * De automatische weg voor POST /api/services. Gooit NOOIT: het dienstoverzicht
 * is op dit punt al opgeslagen, en een heropbouw die struikelt mag die save
 * niet alsnog laten mislukken. Elke afloop komt terug als uitkomst, zodat de
 * planner leest wat er gebeurde.
 */
export const heropbouwNaDienstoverzicht = async (req: AuthenticatedRequest): Promise<AutoHeropbouwUitkomst> => {
  try {
    return await heropbouwPlanning(req, "dienstoverzicht");
  } catch (err) {
    console.error("Automatisch bijwerken van de planning na het dienstoverzicht is mislukt.", err);
    const melding = "er ging iets mis bij het opbouwen, de planning is niet gewijzigd. Bouw ze zelf opnieuw op in Beheer roosters.";
    try { await logNietBijgewerkt(req, melding); } catch { /* het antwoord meldt het al */ }
    return { status: "mislukt", melding };
  }
};
