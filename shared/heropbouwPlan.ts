
/**
 * Droge run van "Planning opnieuw opbouwen" (verbeterronde 09-10, punt 10,
 * keuze Jarno): wat zou de heropbouw veranderen, en welke handmatige
 * wijzigingen verdwijnen daarbij? Zelfde recept als het herstelplan uit een
 * back-up: eerst tonen, dan pas bevestigen. Puur: planning vóór en ná, de
 * namen, en de samenvatting van de opbouw gaan erin, een plan komt eruit.
 */

type Rij = {
  date?: unknown; startTime?: unknown; endTime?: unknown; line?: unknown; loopnr?: unknown; driverId?: unknown;
};

export type HeropbouwPlanDag = {
  dag: string;
  /** Diensten die de chauffeur op die dag NU heeft (leeg = had niets). */
  was: string[];
  /** Diensten die hij na de heropbouw heeft (leeg = heeft dan niets). */
  wordt: string[];
  soort: "erbij" | "weg" | "gewijzigd";
};

export type HeropbouwPlanChauffeur = {
  id: string;
  naam: string;
  dagen: HeropbouwPlanDag[];
};

export type HeropbouwPlan = {
  /** Diensten die de heropbouw uit de matrix haalt, en over hoeveel dagen. */
  diensten: number;
  dagenInMatrix: number;
  periode: { van: string | null; tot: string | null };
  ruilen: { toegepast: number; nietToepasbaar: number };
  /** Alleen chauffeurs met minstens één gewijzigde dag, op naam gesorteerd. */
  chauffeurs: HeropbouwPlanChauffeur[];
  totaal: { chauffeurs: number; dagen: number; erbij: number; weg: number; gewijzigd: number };
};

const tekst = (v: unknown) => String(v ?? "");

/** "dienst 12, 06:00 tot 14:00 (loop 3)" */
const dienstLabel = (r: Rij) => {
  const loop = tekst(r.loopnr).trim();
  return `dienst ${tekst(r.line)}, ${tekst(r.startTime)} tot ${tekst(r.endTime)}${loop ? ` (loop ${loop})` : ""}`;
};

const perChauffeurPerDag = (rows: ReadonlyArray<Rij>): Map<string, Map<string, string[]>> => {
  const uit = new Map<string, Map<string, string[]>>();
  for (const r of rows) {
    const id = tekst(r.driverId);
    const dag = tekst(r.date);
    if (!id || !dag) continue;
    const dagen = uit.get(id) ?? new Map<string, string[]>();
    dagen.set(dag, [...(dagen.get(dag) ?? []), dienstLabel(r)].sort());
    uit.set(id, dagen);
  }
  return uit;
};

const gelijk = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export const bouwHeropbouwPlan = (invoer: {
  vorige: ReadonlyArray<Rij>;
  nieuw: ReadonlyArray<Rij>;
  namen: ReadonlyMap<string, string>;
  dagenInMatrix: number;
  periode: { van: string | null; tot: string | null };
  ruilen: { toegepast: number; nietToepasbaar: number };
}): HeropbouwPlan => {
  const was = perChauffeurPerDag(invoer.vorige);
  const wordt = perChauffeurPerDag(invoer.nieuw);
  const chauffeurs: HeropbouwPlanChauffeur[] = [];
  const totaal = { chauffeurs: 0, dagen: 0, erbij: 0, weg: 0, gewijzigd: 0 };
  for (const id of new Set([...was.keys(), ...wordt.keys()])) {
    const oud = was.get(id) ?? new Map<string, string[]>();
    const nw = wordt.get(id) ?? new Map<string, string[]>();
    const dagen: HeropbouwPlanDag[] = [];
    for (const dag of [...new Set([...oud.keys(), ...nw.keys()])].sort()) {
      const a = oud.get(dag) ?? [];
      const b = nw.get(dag) ?? [];
      if (gelijk(a, b)) continue;
      const soort = a.length === 0 ? "erbij" : b.length === 0 ? "weg" : "gewijzigd";
      dagen.push({ dag, was: a, wordt: b, soort });
      totaal[soort] += 1;
    }
    if (dagen.length === 0) continue;
    chauffeurs.push({ id, naam: invoer.namen.get(id) ?? `Onbekend (${id})`, dagen });
    totaal.chauffeurs += 1;
    totaal.dagen += dagen.length;
  }
  chauffeurs.sort((x, y) => x.naam.localeCompare(y.naam, "nl"));
  return {
    diensten: invoer.nieuw.length,
    dagenInMatrix: invoer.dagenInMatrix,
    periode: invoer.periode,
    ruilen: invoer.ruilen,
    chauffeurs,
    totaal,
  };
};

/** Korte regel voor het logboek en de toast: "3 chauffeurs, 5 dagen (2 erbij, 1 weg, 2 gewijzigd)". */
export const planSamenvatting = (plan: HeropbouwPlan): string => {
  if (plan.totaal.chauffeurs === 0) return "geen wijzigingen";
  const delen = [
    plan.totaal.erbij > 0 ? `${plan.totaal.erbij} erbij` : "",
    plan.totaal.weg > 0 ? `${plan.totaal.weg} weg` : "",
    plan.totaal.gewijzigd > 0 ? `${plan.totaal.gewijzigd} gewijzigd` : "",
  ].filter(Boolean);
  return `${plan.totaal.chauffeurs} chauffeur(s), ${plan.totaal.dagen} dag(en) (${delen.join(", ")})`;
};

