import { KEUZE_ALLE } from "../../../shared/rapporten/definities/verlof.js";
import { COLLEGA_ANTWOORD_LABEL, RUIL_SOORT_LABEL, RUIL_STAND_LABEL, type RuilSoort } from "../../../shared/rapporten/definities/ruilen.js";
import { dagenTussen } from "../../../shared/rapporten/peildatum.js";
import type { RapportBereik, RapportFilters, RapportResultaat, RapportRij } from "../../../shared/rapporten/types.js";
import { isHandmatigeRuil, verloopUitLog, type RuilLogRegel, type RuilVoorVerloop } from "../../../shared/ruilVerloop.js";
import { collegaAntwoord, ruilBeslissing, ruilStand } from "../../../shared/ruilUitkomst.js";
import { brusselseDagVan, uitvoeringenOpDagen } from "../ruilUitvoeringen.js";
import { persoonZoeker, type RapportGebruiker } from "./gedeeld.js";

/**
 * De rapporten van het domein ruilen. Pure functies (bron + filters → rijen +
 * bereik). De bron is telkens dezelfde: de ruilen, de medewerkers en de
 * logregels per ruil (`getSwapVerloopRegels`, alle ruilen in één query). Het
 * uitvoeringsmoment en wie weigerde komen uit die logregels, nooit uit
 * `decidedAt` alleen. Elke dag is een Brusselse kalenderdag.
 */

/** Een ruil zoals `getSwapsData` ze geeft (toPublicSwap). */
export type RuilRij = {
  id: string;
  requesterId: string;
  targetDriverId?: string | null;
  status: string;
  createdAt?: string;
  decidedAt?: string;
  reason?: string;
  swapType?: string;
  shiftDate?: string;
  shiftLine?: string;
  returnDate?: string;
  returnCode?: string;
  targetSeenAt?: string;
};

export type RuilBron = {
  swaps: readonly RuilRij[];
  users: readonly RapportGebruiker[];
  /** Logregels per ruil-id, oudste eerst. */
  logPerRuil: Readonly<Record<string, readonly RuilLogRegel[]>>;
  /** De log-acties die een wissel in de planning doorvoeren (`SWAP_UITVOERING_ACTIES`). */
  uitvoeringActies: readonly string[];
};

const soortVan = (swap: RuilRij): RuilSoort => (isHandmatigeRuil(swap) ? "handmatig" : swap.swapType === "overname" ? "overname" : "ruil");

/** De ruil met zijn verloop erin, zoals staf het leest (met de naam van de planner). */
const metVerloop = (swap: RuilRij, bron: RuilBron): RuilVoorVerloop => ({
  ...swap,
  verloop: verloopUitLog(bron.logPerRuil[swap.id] ?? [], { metStafNaam: true }),
});

const betrokken = (swap: RuilRij, chauffeur: string | undefined): boolean =>
  !chauffeur || String(swap.requesterId) === chauffeur || String(swap.targetDriverId ?? "") === chauffeur;

const bereikUit = (dagen: Array<string | null>): RapportBereik => {
  const echte = dagen.filter((d): d is string => Boolean(d)).sort();
  return echte.length > 0 ? { van: echte[0], tot: echte[echte.length - 1] } : null;
};

// === Uitgevoerde wissels ===

type Uitvoering = { swapId: string; createdAt: string; action: string; actorName: string | null };

const alleUitvoeringen = (bron: RuilBron): Uitvoering[] => {
  const acties = new Set(bron.uitvoeringActies);
  const uit: Uitvoering[] = [];
  for (const [swapId, regels] of Object.entries(bron.logPerRuil)) {
    for (const r of regels) if (acties.has(r.action) && r.createdAt) uit.push({ swapId, createdAt: r.createdAt, action: r.action, actorName: r.actorName ?? null });
  }
  return uit;
};

/**
 * Rapport "Uitgevoerde wissels": één rij per doorvoer in de planning, op de
 * Brusselse kalenderdag van de logregel (zelfde kern als het wekelijkse
 * ruiloverzicht, api/_lib/ruilUitvoeringen.ts). Een wissel die later
 * teruggedraaid werd blijft staan in de periode van zijn doorvoer, met zijn
 * huidige status; een wissel die twee keer doorgevoerd is staat er twee keer
 * in. Een verwijderde ruil heeft nog een logspoor maar geen record meer: die
 * valt weg, zoals op het weekblad.
 */
export function bouwUitgevoerdeWissels(bron: RuilBron, filters: RapportFilters): RapportResultaat {
  const persoon = persoonZoeker(bron.users);
  const perId = new Map(bron.swaps.map((s) => [String(s.id), s]));
  const bestaand = alleUitvoeringen(bron).filter((u) => perId.has(u.swapId));
  const rijen: RapportRij[] = uitvoeringenOpDagen(bestaand, filters.van ?? "", filters.tot ?? "")
    .filter((u) => betrokken(perId.get(u.swapId)!, filters.chauffeur))
    .map((u) => {
      const swap = perId.get(u.swapId)!;
      const handmatig = u.action !== "Dienstruil goedgekeurd";
      const soort: RuilSoort = handmatig ? "handmatig" : swap.swapType === "overname" ? "overname" : "ruil";
      const metTegendienst = swap.swapType !== "overname" && Boolean(swap.returnDate) && Boolean(swap.returnCode);
      return {
        id: `${u.swapId}|${u.createdAt}`,
        uitgevoerdOp: brusselseDagVan(u.createdAt),
        // Sorteert op het moment zelf, niet op de dag: twee wissels van dezelfde dag blijven in volgorde.
        uitgevoerdMoment: u.createdAt,
        van: persoon(swap.requesterId).naam,
        naar: swap.targetDriverId ? persoon(String(swap.targetDriverId)).naam : null,
        dienstdatum: swap.shiftDate ?? null,
        dienst: swap.shiftLine ?? null,
        soort: RUIL_SOORT_LABEL[soort],
        tegenDatum: metTegendienst ? swap.returnDate! : null,
        tegenDienst: metTegendienst ? swap.returnCode! : null,
        door: u.actorName?.trim() || null,
        status: RUIL_STAND_LABEL[ruilStand(metVerloop(swap, bron))],
      };
    });
  return { rijen, bereik: bereikUit(bestaand.map((u) => brusselseDagVan(u.createdAt))) };
}

// === Ruilen per chauffeur ===

const TELLERS = ["aangevraagd", "ontvangen", "goedgekeurd", "geweigerd", "ingetrokken", "teruggedraaid", "open", "doorPlanning"] as const;
type Teller = (typeof TELLERS)[number];

/** In welke afloopkolom een ruil telt (los van wie hem aanvroeg of ontving). */
const afloopVan = (swap: RuilVoorVerloop): Teller => {
  switch (ruilStand(swap)) {
    case "bij-collega":
    case "bij-planning": return "open";
    case "goedgekeurd":
    case "afgehandeld": return "goedgekeurd";
    case "geweigerd": return "geweigerd";
    // Ingetrokken door de aanvrager of geannuleerd door de planning vóór de doorvoer: de aanvraag verviel.
    case "ingetrokken":
    case "geannuleerd": return "ingetrokken";
    case "teruggedraaid": return "teruggedraaid";
  }
};

/**
 * Rapport "Ruilen per chauffeur": ruilen waarvan de AANVRAAG in de periode
 * valt, per betrokken chauffeur. Aangevraagd en ontvangen zeggen aan welke
 * kant hij stond; de afloopkolommen tellen elke ruil waarbij hij betrokken was.
 * Een handmatige wissel van de planning is geen aanvraag: die telt alleen in
 * "Door planning gewisseld" (en in Teruggedraaid als hij ongedaan is gemaakt).
 * De totaalrij telt RUILEN, niet de som van de rijen: een goedgekeurde ruil
 * staat bij twee chauffeurs maar is één ruil.
 */
export function bouwRuilenPerChauffeur(bron: RuilBron, filters: RapportFilters): RapportResultaat {
  const van = filters.van ?? "";
  const tot = filters.tot ?? "";
  const persoon = persoonZoeker(bron.users);
  const leeg = (): Record<Teller, number> => ({ aangevraagd: 0, ontvangen: 0, goedgekeurd: 0, geweigerd: 0, ingetrokken: 0, teruggedraaid: 0, open: 0, doorPlanning: 0 });
  const perPersoon = new Map<string, Record<Teller, number>>();
  const totalen = leeg();
  const tel = (id: string | null | undefined, teller: Teller) => {
    if (!id) return;
    const sleutel = String(id);
    if (!perPersoon.has(sleutel)) perPersoon.set(sleutel, leeg());
    perPersoon.get(sleutel)![teller] += 1;
  };

  for (const swap of bron.swaps) {
    const dag = brusselseDagVan(swap.createdAt);
    if (!dag || dag < van || dag > tot) continue;
    const metLog = metVerloop(swap, bron);
    const collega = swap.targetDriverId ? String(swap.targetDriverId) : null;
    const beiden = [String(swap.requesterId), collega];
    if (isHandmatigeRuil(swap)) {
      const teruggedraaid = ruilStand(metLog) === "teruggedraaid";
      for (const id of beiden) { tel(id, "doorPlanning"); if (teruggedraaid) tel(id, "teruggedraaid"); }
      totalen.doorPlanning += 1;
      if (teruggedraaid) totalen.teruggedraaid += 1;
      continue;
    }
    tel(swap.requesterId, "aangevraagd");
    totalen.aangevraagd += 1;
    if (collega) { tel(collega, "ontvangen"); totalen.ontvangen += 1; }
    const afloop = afloopVan(metLog);
    for (const id of beiden) tel(id, afloop);
    totalen[afloop] += 1;
  }

  const rijen: RapportRij[] = [...perPersoon.entries()].map(([id, tellers]) => ({ id, naam: persoon(id).naam, ...tellers }));
  return { rijen, totalen: rijen.length > 0 ? totalen : undefined, bereik: bereikUit(bron.swaps.map((s) => brusselseDagVan(s.createdAt))) };
}

// === Ruilaanvragen ===

/**
 * Rapport "Ruilaanvragen": elke ruil waarvan de aanvraag (of, bij een
 * handmatige wissel, de invoer) in de periode valt. Het antwoord van de
 * collega, het beslismoment en wie besliste komen uit het verloop per persoon
 * (`shared/ruilUitkomst.ts`). De doorlooptijd loopt van de aanvraagdag tot de
 * dag van de beslissing, en voor een open aanvraag tot de peildatum; een
 * handmatige wissel heeft geen doorlooptijd (er was geen aanvraag).
 */
export function bouwRuilaanvragen(bron: RuilBron, filters: RapportFilters, vandaag: string): RapportResultaat {
  const van = filters.van ?? "";
  const tot = filters.tot ?? "";
  const status = filters.keuzes.status ?? KEUZE_ALLE;
  const soortKeuze = filters.keuzes.soort ?? KEUZE_ALLE;
  const persoon = persoonZoeker(bron.users);

  const rijen: RapportRij[] = [];
  for (const swap of bron.swaps) {
    const aangevraagdOp = brusselseDagVan(swap.createdAt);
    if (!aangevraagdOp || aangevraagdOp < van || aangevraagdOp > tot) continue;
    if (!betrokken(swap, filters.chauffeur)) continue;
    const soort = soortVan(swap);
    if (soortKeuze !== KEUZE_ALLE && soort !== soortKeuze) continue;
    const metLog = metVerloop(swap, bron);
    const stand = ruilStand(metLog);
    if (status !== KEUZE_ALLE && stand !== status) continue;

    const beslissing = ruilBeslissing(metLog);
    const beslistOp = beslissing ? brusselseDagVan(beslissing.op) : null;
    const antwoord = collegaAntwoord(metLog);
    const door = !beslissing ? null
      : beslissing.door === "planner" ? beslissing.naam || "Planning"
        : beslissing.door === "onbekend" ? "Niet geregistreerd"
          : beslissing.userId ? persoon(beslissing.userId).naam : null;
    rijen.push({
      id: swap.id,
      aangevraagdOp,
      aangevraagdMoment: swap.createdAt ?? aangevraagdOp,
      aanvrager: persoon(swap.requesterId).naam,
      collega: swap.targetDriverId ? persoon(String(swap.targetDriverId)).naam : null,
      dienstdatum: swap.shiftDate ?? null,
      dienst: swap.shiftLine ?? null,
      soort: RUIL_SOORT_LABEL[soort],
      status: RUIL_STAND_LABEL[stand],
      antwoord: antwoord ? COLLEGA_ANTWOORD_LABEL[antwoord] : null,
      beslistOp,
      door,
      doorlooptijd: soort === "handmatig" ? null : dagenTussen(aangevraagdOp, beslissing ? beslistOp : vandaag),
    });
  }
  return { rijen, peildatum: vandaag, bereik: bereikUit(bron.swaps.map((s) => brusselseDagVan(s.createdAt))) };
}
