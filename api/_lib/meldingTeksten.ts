/**
 * De tekst van de meldingen over een dienstruil en een toegewezen dienst
 * (ronde 6, punt 11): titel en tekst van de push, en dus ook van de rij in
 * het meldingencentrum, want `sendPushToUsers` bewaart elke push als melding.
 *
 * Tot nu toe zei een ruilmelding niet waarover ze ging ("X wil een dienst met
 * je ruilen."), las een beslissing als "Dienstruil van X: accepted → approved."
 * en heette een weigering van de collega "afgewezen". Hier staat per ontvanger
 * wat er voor hem op het spel staat: welke dienst, welke dag, wie rijdt.
 *
 * Puur: geen opslag en geen verzending. De routes beslissen wie een melding
 * krijgt, met welke soort en naar welk scherm; dit bestand alleen wat erin
 * staat. Drie regels:
 *
 *  1. Wie wat krijgt komt uit het verloop per persoon (`persoonsVerloop`,
 *     shared/ruilVerloop.ts), dezelfde lezing als "Krijgt dienst 4101 op
 *     wo 11 nov" in het scherm. Dat is het VOORSTEL van de ruil: bij een vrije
 *     dag als tegenprestatie verhuist er op die dag niets in de planning
 *     (`swapHasReturnShift`), dus dat gegeven staat alleen in de aanvraag.
 *  2. "Je rijdt dienst X op dag Y" staat er alleen bij wie dat na de
 *     beslissing aantoonbaar waar is: de route geeft mee welke benen ze in de
 *     planning verplaatste (of er al zo vond). Niets aangetoond (een oude
 *     ruil zonder dienst-info, een terugdienst die niet verhuisde) = een
 *     kortere zin die naar het rooster verwijst. Dat iemand vrij is staat er
 *     nooit: de routes tonen aan welke dienst verhuisde, niet wat iemand die
 *     dag verder op zijn naam heeft (een tweede dienst uit de Excel, een
 *     schoolrit op het bord), en de regel tegen dubbele inplanning toetst
 *     alleen wie een dienst krijgt. Wie zijn dienst afgeeft leest wie ze rijdt.
 *  3. Ontbreekt een dienstnummer, een dag of een naam, dan valt de zin terug
 *     op een kortere, juiste vorm. Deze bouwers lopen ná de geschreven
 *     beslissing en gooien dus nooit: een fout in de tekst geeft de algemene
 *     vorm, geen mislukte beslissing.
 *
 * Geen "hij" of "zijn": de tekst kent het geslacht van de collega niet.
 * Statuswoorden volgen shared/status.ts: de planning wijst af, de collega
 * weigert. Een wissel die de planning zelf in de planning zette
 * (`isHandmatigeRuil`) heet "de wissel": niemand vroeg er een ruil of een
 * overname voor aan en niemand keurde iets goed.
 */
import { DAG_DMJ } from "./helpers.js";
import { isHandmatigeRuil, persoonsVerloop } from "../../shared/ruilVerloop.js";
import { normaliseerTijd } from "../../shared/tijdNotatie.js";

export type MeldingTekst = { titel: string; body: string };

/** Wat de tekst van een ruil leest, zoals de opslag het geeft. */
export type RuilVoorMelding = {
  requesterId?: unknown;
  targetDriverId?: unknown;
  swapType?: unknown;
  shiftDate?: unknown;
  shiftLine?: unknown;
  returnDate?: unknown;
  returnCode?: unknown;
  /** Alleen gelezen om een handmatige wissel van de planning te herkennen
   *  (`isHandmatigeRuil`); de reden zelf komt nooit in de tekst. */
  reason?: unknown;
};

/** Namen van de twee chauffeurs van de ruil; leeg of onbekend mag. */
export type RuilNamen = { aanvrager?: string | null; collega?: string | null };

/**
 * Wat een beslissing aantoonbaar in de planning zette: de richting, en per
 * been of de dienst nu staat waar die richting hem zet (`aangeboden` = de
 * dienst van de aanvrager, `terug` = de dienst die hij ervoor terugkrijgt).
 * Dezelfde vorm als de `PlanningBeweging` van de ruilroutes.
 */
export type RuilPlanningStand = {
  richting: "doorgevoerd" | "teruggedraaid";
  benen: { aangeboden: boolean; terug: boolean };
};

// ---------------------------------------------------------------------------
// Bouwstenen
// ---------------------------------------------------------------------------

const WEEKDAGEN = ["zo", "ma", "di", "wo", "do", "vr", "za"] as const;

/**
 * ISO-dag → "wo 11/11": korte weekdag met dag/maand, voor een melding die op
 * een vergrendeld scherm in één regel moet passen. Dag en maand komen uit
 * `DAG_DMJ`; de weekdag is gerekend, niet opgevraagd bij de taalinstelling van
 * de server. Null voor alles wat geen echte kalenderdag is (30/02 rolt in
 * `Date` stil door naar maart): dan laat de zin de dag weg.
 */
export const dagKort = (iso: unknown): string | null => {
  const s = String(iso ?? "").trim().slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [jaar, maand, dag] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(Date.UTC(jaar, maand - 1, dag));
  if (d.getUTCFullYear() !== jaar || d.getUTCMonth() !== maand - 1 || d.getUTCDate() !== dag) return null;
  return `${WEEKDAGEN[d.getUTCDay()]} ${DAG_DMJ(s).slice(0, 5)}`;
};

/** Tekst uit een veld van onbekende vorm: getrimd en begrensd, leeg als er
 *  niets bruikbaars staat (ook geen object of lijst als "[object Object]"). */
export const schoon = (waarde: unknown, max = 40): string =>
  typeof waarde === "string" || typeof waarde === "number" ? String(waarde).trim().slice(0, max) : "";

const naamOf = (naam: unknown, anders: string): string => schoon(naam, 80) || anders;

const op = (dag: string | null): string => (dag ? ` op ${dag}` : "");

/** "a", "a en b", "a, b en c". */
export const opsomming = (delen: readonly string[]): string =>
  delen.length <= 1 ? delen.join("") : `${delen.slice(0, -1).join(", ")} en ${delen[delen.length - 1]}`;

/**
 * De uren van de delen van een dienst als tijdvakken ("06:45–10:00", en-dash
 * zonder spaties), in de gegeven volgorde. Null zonder delen of zodra één deel
 * geen leesbaar tijdvak is: een halve lijst leest als de hele dienst. Gedeeld
 * door "Dienst toegewezen" en "Rooster bijgewerkt" (roosterMelding.ts).
 */
export const tijdvakken = (delen: ReadonlyArray<{ startTime?: unknown; endTime?: unknown }>): string[] | null => {
  const vakken = delen.map((deel) => {
    const van = normaliseerTijd(deel?.startTime);
    const tot = normaliseerTijd(deel?.endTime);
    return van && tot ? `${van}–${tot}` : null;
  });
  return vakken.length > 0 && vakken.every((v): v is string => v !== null) ? vakken : null;
};

type Partij = "aanvrager" | "collega";

type Gelezen = {
  aanvragerId: string;
  collegaId: string;
  overname: boolean;
  /** Door de planning rechtstreeks in de planning gezet: geen aanvraag, geen
   *  goedkeuring (zelfde toets als het verloop per persoon). */
  handmatig: boolean;
  /** "ruil" of "overname", voor midden in een zin; "wissel" voor een
   *  handmatige wissel van de planning. */
  woord: string;
  /** De aangeboden dienst zoals de ruil ze draagt, ook zonder collega: zo heet de ruil in een zin. */
  dienst: string;
  dag: string | null;
  /** Wat de collega krijgt (verloop per persoon): de aangeboden dienst. */
  aangeboden: { dienst: string; iso: string; dag: string | null } | null;
  /** Wat de aanvrager krijgt (verloop per persoon): een dienst van de collega,
   *  of een vrije dag (`dienst` is dan null). */
  terug: { dienst: string | null; iso: string; dag: string | null } | null;
};

/**
 * Eén lezing van de ruil voor alle teksten. Wie wat krijgt komt uit
 * `persoonsVerloop`, gezocht op rol en niet op plaats: een ruil zonder
 * aangezochte collega heeft geen collega-regel.
 */
const lees = (ruil: RuilVoorMelding): Gelezen => {
  const aanvragerId = schoon(ruil.requesterId, 200);
  const collegaId = schoon(ruil.targetDriverId, 200);
  // Zelfde regel als normalizeSwapType: alles wat geen overname is, is een ruil.
  const overname = schoon(ruil.swapType).toLowerCase() === "overname";
  const regels = persoonsVerloop({
    status: "pending",
    requesterId: aanvragerId,
    targetDriverId: collegaId || null,
    swapType: overname ? "overname" : "ruil",
    shiftDate: schoon(ruil.shiftDate) || undefined,
    shiftLine: schoon(ruil.shiftLine) || undefined,
    returnDate: schoon(ruil.returnDate) || undefined,
    returnCode: schoon(ruil.returnCode) || undefined,
  });
  const krijgt = (rol: Partij) => regels.find((r) => r.rol === rol)?.krijgt;
  const collegaKrijgt = krijgt("collega");
  const aanvragerKrijgt = krijgt("aanvrager");
  // Alleen een tekst kan een reden zijn; al het andere is geen handmatige wissel.
  const handmatig = typeof ruil.reason === "string" && isHandmatigeRuil({ reason: ruil.reason });
  return {
    aanvragerId,
    collegaId,
    overname,
    handmatig,
    woord: handmatig ? "wissel" : overname ? "overname" : "ruil",
    dienst: schoon(ruil.shiftLine),
    dag: dagKort(ruil.shiftDate),
    aangeboden: collegaKrijgt
      ? { dienst: collegaKrijgt.code, iso: collegaKrijgt.datum, dag: dagKort(collegaKrijgt.datum) }
      : null,
    terug: aanvragerKrijgt
      ? {
          // Zelfde toets als het scherm (`krijgtTekst` in RuilVerloop.tsx): 'vrij', in welke hoofdletters ook.
          dienst: aanvragerKrijgt.code.toLowerCase() === "vrij" ? null : aanvragerKrijgt.code,
          iso: aanvragerKrijgt.datum,
          dag: dagKort(aanvragerKrijgt.datum),
        }
      : null,
  };
};

/**
 * Hoe de ruil in een zin heet: "de ruil van wo 11/11 (dienst 4101)", en korter
 * naarmate er minder bekend is ("de ruil van wo 11/11", "de ruil voor dienst
 * 4101", "de ruil").
 */
const noem = (r: Gelezen, lidwoordEnWoord: string, voorzetsel: "van" | "voor" = "van"): string => {
  if (r.dag && r.dienst) return `${lidwoordEnWoord} ${voorzetsel} ${r.dag} (dienst ${r.dienst})`;
  if (r.dag) return `${lidwoordEnWoord} ${voorzetsel} ${r.dag}`;
  if (r.dienst) return `${lidwoordEnWoord} voor dienst ${r.dienst}`;
  return lidwoordEnWoord;
};

/** Vangnet rond een bouwer: een fout in de tekst mag een geschreven
 *  beslissing nooit doen mislukken. */
export const veilig = <T>(wat: string, bouw: () => T, terugval: T): T => {
  try {
    return bouw();
  } catch (err) {
    console.error(`Tekst van de melding (${wat}) bouwen is mislukt, de algemene tekst gaat mee.`, err);
    return terugval;
  }
};

// ---------------------------------------------------------------------------
// Nieuwe aanvraag → de aangezochte collega
// ---------------------------------------------------------------------------

/**
 * De aanvraag, voor de collega aan wie ze gevraagd wordt: wat hij krijgt, en
 * wat de aanvrager daarvoor van hem neemt (een dienst of een vrije dag).
 */
export const ruilAanvraagMelding = (ruil: RuilVoorMelding, namen: RuilNamen = {}): MeldingTekst =>
  veilig("nieuwe ruilaanvraag", () => {
    const r = lees(ruil);
    const aanvrager = naamOf(namen.aanvrager, "Een collega");
    if (r.overname) {
      return {
        titel: "Vraag om een dienst over te nemen",
        body: r.aangeboden
          ? `${aanvrager} vraagt of je dienst ${r.aangeboden.dienst}${r.aangeboden.dag ? ` van ${r.aangeboden.dag}` : ""} wil overnemen, zonder tegenprestatie.`
          : `${aanvrager} vraagt of je een dienst wil overnemen, zonder tegenprestatie.`,
      };
    }
    if (!r.aangeboden) return { titel: "Nieuwe dienstruil-aanvraag", body: `${aanvrager} wil een dienst met je ruilen.` };
    const tegen = !r.terug
      ? ""
      : r.terug.dienst
        ? `, in ruil voor jouw dienst ${r.terug.dienst}${op(r.terug.dag)}`
        : `, in ruil voor jouw vrije dag${op(r.terug.dag)}`;
    return {
      titel: "Nieuwe dienstruil-aanvraag",
      body: `${aanvrager} vraagt een ruil: jij krijgt dienst ${r.aangeboden.dienst}${op(r.aangeboden.dag)}${tegen}.`,
    };
  }, { titel: "Nieuwe dienstruil-aanvraag", body: "Een collega vraagt je een dienstruil. Open de aanvraag om ze te bekijken." });

// ---------------------------------------------------------------------------
// De collega accepteerde → de planning (wacht op validatie)
// ---------------------------------------------------------------------------

/** Voor de planners en admins: wie akkoord ging, met welke ruil. */
export const ruilValidatieMelding = (ruil: RuilVoorMelding, namen: RuilNamen = {}): MeldingTekst =>
  veilig("ruil wacht op validatie", () => {
    const r = lees(ruil);
    const titel = "Dienstruil wacht op validatie";
    const collega = naamOf(namen.collega, "De collega");
    const aanvrager = schoon(namen.aanvrager, 80);
    const vanAanvrager = aanvrager ? ` van ${aanvrager}` : "";
    if (!r.aangeboden) return { titel, body: `${collega} accepteerde de ${r.woord}${vanAanvrager}, rij- en rusttijden checken.` };
    const dienst = `dienst ${r.aangeboden.dienst}`;
    if (r.overname) {
      return {
        titel,
        body: `${collega} wil ${dienst}${r.aangeboden.dag ? ` van ${r.aangeboden.dag}` : ""} overnemen${vanAanvrager}, zonder tegenprestatie. Rij- en rusttijden checken.`,
      };
    }
    const tegen = !r.terug
      ? ""
      : r.terug.dienst
        ? ` tegen dienst ${r.terug.dienst}${op(r.terug.dag)}`
        : ` tegen een vrije dag${op(r.terug.dag)}`;
    return {
      titel,
      body: `${collega} accepteerde de ruil${vanAanvrager}: ${dienst}${op(r.aangeboden.dag)}${tegen}. Rij- en rusttijden checken.`,
    };
  }, { titel: "Dienstruil wacht op validatie", body: "Een collega accepteerde een dienstruil, rij- en rusttijden checken." });

// ---------------------------------------------------------------------------
// Een beslissing → de twee chauffeurs van de ruil
// ---------------------------------------------------------------------------

/**
 * Wie een stap zette, met dezelfde regel als het verloop per persoon (`doorVoor`
 * in shared/ruilVerloop.ts, die de rol van de actor uit het log leest): een
 * planner of admin beslist altijd als "de planning"; wie geen staf is en
 * weigert is de collega, wie geen staf is en annuleert de aanvrager.
 * src/meldingTeksten.test.ts houdt deze regel gelijk aan die van het verloop.
 */
export const ruilBeslisser = (naar: string, doorStaf: boolean): Partij | "planner" => {
  if (naar === "accepted") return "collega";
  if (naar === "rejected") return doorStaf ? "planner" : "collega";
  if (naar === "cancelled") return doorStaf ? "planner" : "aanvrager";
  return "planner";
};

export type RuilBeslissing = {
  ruil: RuilVoorMelding;
  namen?: RuilNamen;
  /** Status vóór en na de stap (één stap uit `ruilLogStappen`). */
  van: string;
  naar: string;
  /** Zette een planner of admin de stap? */
  doorStaf: boolean;
  /** Wat deze beslissing aantoonbaar in de planning zette; zonder = niets
   *  aangetoond, en dan zegt de tekst niet wie welke dienst rijdt. */
  planning?: RuilPlanningStand | null;
};

type Been = { dienst: string; iso: string; dag: string | null; rijder: Partij };

/**
 * Wie welk been rijdt na deze beweging, alleen voor de benen die aantoonbaar
 * verhuisden. Doorgevoerd: de aangeboden dienst bij de collega, de terugdienst
 * bij de aanvrager. Teruggedraaid: omgekeerd.
 */
const benenNa = (r: Gelezen, planning: RuilPlanningStand): Been[] => {
  const door = planning.richting === "doorgevoerd";
  const uit: Been[] = [];
  if (planning.benen.aangeboden && r.aangeboden) uit.push({ ...r.aangeboden, rijder: door ? "collega" : "aanvrager" });
  if (planning.benen.terug && r.terug?.dienst) uit.push({ dienst: r.terug.dienst, iso: r.terug.iso, dag: r.terug.dag, rijder: door ? "aanvrager" : "collega" });
  return uit;
};

/**
 * De melding van één stap voor één ontvanger. De rol van de ontvanger volgt
 * uit de ruil zelf: wie daarin aanvrager noch collega is (of allebei) krijgt
 * de neutrale zin, nooit een zin over zijn eigen diensten.
 */
export const ruilBeslisMelding = (b: RuilBeslissing, ontvangerId: unknown): MeldingTekst =>
  veilig("beslissing over een ruil", () => {
    const r = lees(b.ruil);
    const ontvanger = schoon(ontvangerId, 200);
    const rol: Partij | "ander" = !ontvanger || r.aanvragerId === r.collegaId
      ? "ander"
      : ontvanger === r.aanvragerId ? "aanvrager" : ontvanger === r.collegaId ? "collega" : "ander";
    const door = ruilBeslisser(b.naar, b.doorStaf);
    // De naam van de andere partij, midden in een zin; zonder naam "je collega".
    const anderePartij = (wie: Partij) => naamOf(wie === "aanvrager" ? b.namen?.aanvrager : b.namen?.collega, "je collega");
    const deRuil = noem(r, `de ${r.woord}`);
    const metTerugDienst = !!r.terug?.dienst;
    const stand = b.planning ?? null;
    const benen = stand && rol !== "ander" ? benenNa(r, stand) : [];
    const eigen = benen.find((x) => x.rijder === rol);
    const ander = benen.find((x) => x.rijder !== rol);
    // Staat alles wat de ruil verplaatst aantoonbaar zo? Anders verwijst de zin naar het rooster.
    const rooster = benen.length === (metTerugDienst ? 2 : 1) ? "" : " Bekijk je rooster.";
    /** "…, <naam> rijdt dienst X op dag", zonder de dag als die al in de zin staat. */
    const enDeAnder = (naVan: Been | undefined) =>
      ander ? `, ${anderePartij(ander.rijder)} rijdt dienst ${ander.dienst}${naVan && naVan.iso === ander.iso ? "" : op(ander.dag)}` : "";

    if (b.naar === "accepted") {
      const titel = "Dienstruil geaccepteerd";
      const nogGoedkeuren = "de planning moet nog goedkeuren";
      if (rol === "aanvrager") {
        const collega = naamOf(b.namen?.collega, "Je collega");
        return {
          titel,
          body: r.overname
            ? `${collega} wil je dienst${r.dienst ? ` ${r.dienst}` : ""}${r.dag ? ` van ${r.dag}` : ""} overnemen, ${nogGoedkeuren}.`
            : `${collega} accepteerde ${noem(r, "je ruil")}, ${nogGoedkeuren}.`,
        };
      }
      if (rol === "collega") return { titel, body: `Je accepteerde ${deRuil}, ${nogGoedkeuren}.` };
      return { titel, body: `${naamOf(b.namen?.collega, "De collega")} accepteerde ${deRuil}, ${nogGoedkeuren}.` };
    }

    if (b.naar === "approved") {
      const titel = "Dienstruil goedgekeurd";
      if (stand?.richting === "doorgevoerd" && rol === "collega" && eigen) {
        return { titel, body: `Goedgekeurd: je rijdt dienst ${eigen.dienst}${op(eigen.dag)}${enDeAnder(eigen)}.${rooster}` };
      }
      if (stand?.richting === "doorgevoerd" && rol === "aanvrager" && ander) {
        if (eigen) return { titel, body: `Goedgekeurd: je rijdt dienst ${eigen.dienst}${op(eigen.dag)}${enDeAnder(eigen)}.${rooster}` };
        // Geen dienst terug (overname of vrije dag), of de terugdienst staat
        // (nog) niet aantoonbaar bij de aanvrager: alleen wie de afgegeven
        // dienst rijdt. Nooit "je bent vrij": aangetoond is dat die ene dienst
        // verhuisde, niet wat de aanvrager die dag verder op zijn naam heeft.
        return { titel, body: `Goedgekeurd: ${anderePartij(ander.rijder)} rijdt dienst ${ander.dienst}${op(ander.dag)}.${rooster}` };
      }
      return { titel, body: `De planning keurde ${deRuil} goed. Bekijk je rooster.` };
    }

    if (b.naar === "rejected" || b.naar === "cancelled") {
      const titel = b.naar === "cancelled" ? "Dienstruil geannuleerd" : door === "collega" ? "Dienstruil geweigerd" : "Dienstruil afgewezen";
      if (door === "collega") {
        const wie = rol === "collega" ? "Je" : naamOf(b.namen?.collega, rol === "aanvrager" ? "Je collega" : "De collega");
        return { titel, body: `${wie} weigerde ${deRuil}.` };
      }
      if (door === "aanvrager") {
        const wie = rol === "aanvrager" ? "Je" : naamOf(b.namen?.aanvrager, rol === "collega" ? "Je collega" : "De aanvrager");
        return { titel, body: `${wie} trok ${noem(r, "de aanvraag", "voor")} in.` };
      }
      // De planning. Was de ruil al goedgekeurd, dan stond de wissel in de
      // planning en is hij nu teruggedraaid: zeg wie welke dienst weer rijdt.
      if (b.van === "approved") {
        if (stand?.richting === "teruggedraaid" && eigen) {
          return { titel, body: `De planning draaide de ${r.woord} terug: je rijdt dienst ${eigen.dienst}${op(eigen.dag)} weer zelf${enDeAnder(eigen)}.${rooster}` };
        }
        if (stand?.richting === "teruggedraaid" && ander) {
          return { titel, body: `De planning draaide de ${r.woord} terug: ${anderePartij(ander.rijder)} rijdt dienst ${ander.dienst}${op(ander.dag)} weer zelf.${rooster}` };
        }
        // Een handmatige wissel is nooit goedgekeurd: de planning zette hem zelf.
        return { titel, body: `De planning draaide ${noem(r, r.handmatig ? "de wissel" : `de goedgekeurde ${r.woord}`)} terug. Bekijk je rooster.` };
      }
      return { titel, body: b.naar === "cancelled" ? `De planning annuleerde ${deRuil}.` : `De planning wees ${deRuil} af.` };
    }

    if (b.naar === "completed") return { titel: "Dienstruil afgehandeld", body: `De planning handelde ${deRuil} af.` };
    return { titel: "Dienstruil bijgewerkt", body: `Er is een wijziging aan ${deRuil}.` };
  }, { titel: "Dienstruil bijgewerkt", body: "Er is beslist over een dienstruil waar je bij betrokken bent. Open de ruil om ze te bekijken." });

// ---------------------------------------------------------------------------
// Verzenden per tekst
// ---------------------------------------------------------------------------

/**
 * De ontvangers gegroepeerd per tekst, in de volgorde van de lijst: wie
 * dezelfde titel en tekst krijgt gaat samen in één verzending (zoals
 * `verstuurRoosterPushes`), wie een eigen tekst krijgt apart. Elke ontvanger
 * staat in precies één groep, een dubbel of leeg id telt niet: de lijst van
 * ontvangers zelf verandert er niet door.
 */
export const meldingenPerTekst = (
  ontvangers: readonly unknown[],
  tekstVoor: (userId: string) => MeldingTekst,
): Array<MeldingTekst & { userIds: string[] }> => {
  const groepen: Array<MeldingTekst & { userIds: string[] }> = [];
  for (const id of new Set(ontvangers.map((o) => String(o ?? "")).filter(Boolean))) {
    const tekst = tekstVoor(id);
    const groep = groepen.find((g) => g.titel === tekst.titel && g.body === tekst.body);
    if (groep) groep.userIds.push(id);
    else groepen.push({ titel: tekst.titel, body: tekst.body, userIds: [id] });
  }
  return groepen;
};

// ---------------------------------------------------------------------------
// Dienst toegewezen → de chauffeur
// ---------------------------------------------------------------------------

/**
 * "Je rijdt dienst 2116 op vr 13/11: 06:45–10:00 en 15:45–19:35." De uren zijn
 * de blokken die de route op naam van de chauffeur in de planning zet, alle
 * delen van een gesplitste dienst. Is één blok geen leesbaar tijdvak, dan
 * vallen de uren helemaal weg (een halve lijst leest als de hele dienst) en
 * verwijst de zin naar het rooster.
 */
export const dienstToegewezenTekst = (toewijzing: {
  dienst: unknown;
  datum: unknown;
  delen: ReadonlyArray<{ startTime?: unknown; endTime?: unknown }>;
}): string =>
  veilig("dienst toegewezen", () => {
    const dienst = schoon(toewijzing.dienst);
    const dag = dagKort(toewijzing.datum);
    const vakken = tijdvakken(Array.isArray(toewijzing.delen) ? toewijzing.delen : []);
    const uren = vakken ? opsomming(vakken) : "";
    const wat = `Je rijdt ${dienst ? `dienst ${dienst}` : "een dienst"}${op(dag)}`;
    return uren ? `${wat}: ${uren}.` : `${wat}. Bekijk je rooster.`;
  }, "Je kreeg een dienst toegewezen. Bekijk je rooster.");
