import type { DayGap } from "../../../shared/coverageGaps.js";
import { OPEN_STATUS_LABEL } from "../../../shared/rapporten/definities/planning.js";
import { maandenInPeriode } from "../../../shared/rapporten/periode.js";
import type { RapportBereik, RapportFilters, RapportResultaat, RapportRij } from "../../../shared/rapporten/types.js";
import { berekenMaandoverzicht, dienstMinuten, telMaandoverzichtenOp, type Maandoverzicht } from "../../helpers.js";
import { berekenCelWaarheid, type CelWaarheidInvoer } from "../celWaarheid.js";
import { persoonZoeker, weekdagKort, type RapportGebruiker } from "./gedeeld.js";

/**
 * De rapporten van het domein planning. Pure functies (bron + filters → rijen
 * + bereik). Het portaal houdt geen bus per dienst bij en toont bewust ook geen
 * geplande bus (beslissing Jarno 21-09): `planning.busNumber` wordt hier niet
 * gelezen.
 */

// === Overzicht per chauffeur ===

export type OverzichtBron = CelWaarheidInvoer & {
  /** Eerste en laatste dag van de geïmporteerde maandplanning; null = nog niets geïmporteerd. */
  grenzen: { eerste: string | null; laatste: string | null };
};

type PlanningCode = { code: string; countsAsShift?: boolean; isPaidAbsence?: boolean; isDayOff?: boolean };

/**
 * Het maandoverzicht van één maand, precies zoals GET /api/month-planning
 * ?format=summary het rekent: de cel-waarheid van het bord (matrix +
 * goedgekeurde ruilen + afwezigheden) door `berekenMaandoverzicht`. Hier en
 * in de gelijkheidstest gebruikt, zodat "gelijk aan het Maandoverzicht" een
 * test is en geen belofte.
 */
export const maandoverzichtVan = (maand: string, bron: CelWaarheidInvoer): Maandoverzicht => {
  const { dates, chauffeurs, cells } = berekenCelWaarheid(maand, bron);
  return berekenMaandoverzicht(dates, chauffeurs.map((c) => ({ id: c.id, name: c.name })), cells, bron.services, bron.codes as PlanningCode[]);
};

/**
 * Rapport "Overzicht per chauffeur": de maandoverzichten van de gekozen
 * maanden, opgeteld (`telMaandoverzichtenOp`). Wie er in staat volgt het bord:
 * de actieve chauffeurs, in de bordvolgorde. Eén maand geeft cijfer voor cijfer
 * het Maandoverzicht van de maandplanning (src/rapportPlanning.test.ts).
 */
export function bouwOverzichtPerChauffeur(bron: OverzichtBron, filters: RapportFilters): RapportResultaat {
  const maanden = maandenInPeriode({ van: filters.van ?? "", tot: filters.tot ?? "" });
  const som = telMaandoverzichtenOp(maanden.map((maand) => maandoverzichtVan(maand, bron)));
  const sectieVan = new Map(bron.users.map((u) => [String(u.id), String(u.section ?? "").trim()]));
  const rijen: RapportRij[] = som.rijen
    .filter((r) => !filters.chauffeur || r.driverId === filters.chauffeur)
    .map((r) => ({
      id: r.driverId,
      naam: r.naam,
      sectie: sectieVan.get(r.driverId) || null,
      diensten: r.diensten,
      minuten: r.minuten,
      anderWerk: r.anderWerk,
      ziek: r.ziek,
      betaald: r.betaald,
      vrij: r.vrij,
      overig: r.overig.reduce((n, o) => n + o.keren, 0),
      dagen: r.dagen,
    }));
  const { eerste, laatste } = bron.grenzen;
  return { rijen, bereik: eerste && laatste ? { van: eerste, tot: laatste } : null };
}

// === Diensten per dag ===

/** Een rij uit `planning`: één dienst-DEEL. */
export type PlanningDeel = { id: string | number; date: string; startTime?: string | null; endTime?: string | null; line?: string | number | null; loopnr?: string | number | null; driverId?: string | number | null };

export type DienstenBron = {
  planning: readonly PlanningDeel[];
  users: readonly RapportGebruiker[];
};

const tekst = (v: unknown): string => String(v ?? "").trim();
/** 'UU:MM' → minuten, voor de volgorde van de delen (een busdag loopt tot 47:59). */
const minutenVan = (tijd: string): number => {
  const m = /^(\d{1,2}):(\d{2})/.exec(tijd);
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number.MAX_SAFE_INTEGER;
};
const ISO_DAG = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Eén rij per dienst-deel, gesorteerd op datum, dienst en deel. Het deelnummer
 * volgt uit de starttijd binnen dezelfde chauffeur, dag en dienst: een
 * gesplitste dienst (2109 met 06:53-08:23 en 13:10-19:15) is deel 1 en deel 2.
 * De duur is die van dit deel (`dienstMinuten`: einde vóór start = over
 * middernacht).
 */
export function bouwDienstenPerDag(bron: DienstenBron, filters: RapportFilters): RapportResultaat {
  const van = filters.van ?? "";
  const tot = filters.tot ?? "";
  const persoon = persoonZoeker(bron.users);
  const geldig = bron.planning.filter((p) => ISO_DAG.test(tekst(p.date)));

  let bereik: RapportBereik = null;
  for (const p of geldig) {
    const dag = tekst(p.date);
    bereik = bereik ? { van: dag < bereik.van ? dag : bereik.van, tot: dag > bereik.tot ? dag : bereik.tot } : { van: dag, tot: dag };
  }

  // Deelnummer per (chauffeur, dag, dienst), over de hele dag en vóór de filters: een filter mag van deel 2 geen deel 1 maken.
  const groepen = new Map<string, PlanningDeel[]>();
  for (const p of geldig) {
    const dag = tekst(p.date);
    if (dag < van || dag > tot) continue;
    const sleutel = `${tekst(p.driverId)}|${dag}|${tekst(p.line)}`;
    if (!groepen.has(sleutel)) groepen.set(sleutel, []);
    groepen.get(sleutel)!.push(p);
  }

  const rijen: RapportRij[] = [];
  for (const delen of groepen.values()) {
    delen.sort((a, b) => minutenVan(tekst(a.startTime)) - minutenVan(tekst(b.startTime)) || tekst(a.id).localeCompare(tekst(b.id)));
    delen.forEach((p, i) => {
      if (filters.chauffeur && tekst(p.driverId) !== filters.chauffeur) return;
      const dag = tekst(p.date);
      const dienst = tekst(p.line);
      rijen.push({
        id: tekst(p.id),
        datum: dag,
        dag: weekdagKort(dag),
        dienst: dienst || null,
        deel: i + 1,
        start: tekst(p.startTime) || null,
        einde: tekst(p.endTime) || null,
        duur: dienstMinuten({ startTime: tekst(p.startTime), endTime: tekst(p.endTime) }),
        loop: tekst(p.loopnr) || null,
        chauffeur: tekst(p.driverId) ? persoon(tekst(p.driverId)).naam : null,
        // Datum, dienst (numeriek waar het kan) en deel in één sorteersleutel.
        volgorde: `${dag}|${dienst.padStart(8, "0")}|${i + 1}|${tekst(p.driverId)}`,
      });
    });
  }
  rijen.sort((a, b) => String(a.volgorde).localeCompare(String(b.volgorde)));
  return { rijen, bereik };
}

// === Openstaande diensten ===

export type OpenstaandeBron = {
  /** De dekking van de gevraagde periode (`berekenDekkingsGaten`). */
  gaten: readonly DayGap[];
  grenzen: { eerste: string | null; laatste: string | null };
};

const REDEN_LABEL: Record<string, string> = { ziek: "Ziek", verlof: "Verlof", "klein verlet": "Klein verlet" };
const redenTekst = (info: { name: string; reason: string } | undefined): string =>
  (info ? `${REDEN_LABEL[info.reason] ?? info.reason}: ${info.name}` : "Niet toegewezen");

/**
 * Rapport "Openstaande diensten": wat de dekking-kern vandaag als gat ziet,
 * één rij per dienst, plus de diensten van een afwezige die een collega
 * intussen overnam ("ingevuld door"). Voorbije dagen staan er niet in: de
 * dekking is een vooruitkijk-instrument (een achteraf ingevoerd ziektebriefje
 * maakt van een gereden dag geen gat), dus het bereik begint vandaag. Het is
 * de toestand van NU, geen historiek van wanneer een gat ontstond.
 */
export function bouwOpenstaandeDiensten(bron: OpenstaandeBron, _filters: RapportFilters, vandaag: string): RapportResultaat {
  const norm = (code: string) => code.trim().toLowerCase();
  const rijen: RapportRij[] = [];
  for (const dag of bron.gaten) {
    if (dag.date < vandaag) continue;
    const basis = { datum: dag.date, dag: weekdagKort(dag.date), dagtype: dag.dayType || null };
    for (const dienst of dag.missing) {
      rijen.push({
        id: `${dag.date}|${norm(dienst)}`,
        ...basis,
        dienst,
        reden: redenTekst(dag.uitval?.[norm(dienst)]),
        ingevuldDoor: null,
        status: OPEN_STATUS_LABEL.open,
        volgorde: `${dag.date}|0|${dienst.padStart(8, "0")}`,
      });
    }
    for (const [code, info] of Object.entries(dag.opgevangen ?? {})) {
      rijen.push({
        id: `${dag.date}|${code}|ingevuld`,
        ...basis,
        dienst: code.toUpperCase(),
        reden: redenTekst(info),
        ingevuldDoor: info.door || "Onbekend",
        status: OPEN_STATUS_LABEL.ingevuld,
        volgorde: `${dag.date}|1|${code.padStart(8, "0")}`,
      });
    }
  }
  rijen.sort((a, b) => String(a.volgorde).localeCompare(String(b.volgorde)));
  const { eerste, laatste } = bron.grenzen;
  if (!eerste || !laatste) return { rijen: [], peildatum: vandaag, bereik: null };
  // De planning loopt tot `laatste`; wat vóór vandaag ligt telt niet meer mee.
  const van = vandaag > laatste ? laatste : vandaag > eerste ? vandaag : eerste;
  return { rijen, peildatum: vandaag, bereik: { van, tot: laatste } };
}
