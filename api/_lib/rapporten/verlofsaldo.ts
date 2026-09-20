import { verlofBalans, type VerlofAanvraagKern } from "../../../shared/verlofSaldo.js";
import { onbekendLabel } from "../../../shared/rapporten/filters.js";
import type { RapportFilters, RapportResultaat, RapportRij } from "../../../shared/rapporten/types.js";

/**
 * Rapport Verlofsaldo: per medewerker het betaald verlof van één jaar. Pure
 * functie (bron + filters → rijen + bereik), dus te testen op vaste cijfers.
 *
 * Dezelfde telling en dezelfde kring als het saldo-overzicht in Verlof
 * (src/components/VerlofSaldoModal.tsx via src/lib/verlofSaldoRijen.ts):
 * `verlofBalans` uit shared/verlofSaldo.ts, en zonder medewerkerfilter
 * iedereen die verlof opneemt: chauffeurs en techniekers, actief, niet het
 * beheerdersaccount. De cijfers moeten gelijk zijn; src/rapportVerlofsaldo.test.ts
 * bewaakt dat.
 */

type SaldoGebruiker = { id: string | number; name: string; role: string; isActive?: boolean; section?: string; verlofBudget?: number };

export type VerlofsaldoBron = {
  users: readonly SaldoGebruiker[];
  leave: readonly VerlofAanvraagKern[];
  /** Extra vrije dagen van de beheerder (ISO), bovenop de wettelijke feestdagen. */
  extraFeestdagen: ReadonlySet<string>;
};

const isStaf = (rol: string) => rol === "planner" || rol === "admin";
/** Wie in het saldo-overzicht staat (zelfde regel als de modal). */
export const neemtVerlofOp = (u: SaldoGebruiker): boolean =>
  !isStaf(u.role) && u.isActive !== false && u.name.trim().toLowerCase() !== "beheerder";

/** Aanvragen die in een saldo meetellen: verlof en klein verlet, lopend of goedgekeurd. */
const teltMee = (l: VerlofAanvraagKern) =>
  (l.type === "betaald_verlof" || l.type === "klein_verlet") && (l.status === "approved" || l.status === "pending");

export function bouwVerlofsaldo(bron: VerlofsaldoBron, filters: RapportFilters): RapportResultaat {
  const jaar = filters.jaar ?? new Date().getUTCFullYear();

  let personen: SaldoGebruiker[];
  if (filters.chauffeur) {
    // Eén medewerker: ook wie uit dienst is, en een verwijderd account blijft
    // als "Onbekend (<id>)" staan met wat er van zijn verlof nog in de tabel zit.
    const gevonden = bron.users.find((u) => String(u.id) === filters.chauffeur);
    personen = [gevonden ?? { id: filters.chauffeur, name: onbekendLabel(filters.chauffeur), role: "chauffeur" }];
  } else {
    personen = bron.users.filter(neemtVerlofOp);
  }

  const rijen: RapportRij[] = personen.map((u) => {
    const b = verlofBalans(bron.leave, String(u.id), jaar, u.verlofBudget, bron.extraFeestdagen);
    return {
      id: String(u.id),
      naam: u.isActive === false ? `${u.name} (uit dienst)` : u.name,
      sectie: u.section?.trim() || null,
      budget: b.betaaldBudget,
      opgenomen: b.betaaldGebruikt,
      aangevraagd: b.betaaldAangevraagd,
      vrij: b.betaaldVrij,
      kleinVerlet: b.kleinVerletDagen,
    };
  });

  // Bereik: de eerste en de laatste dag waarvoor er verlof geregistreerd staat.
  let van: string | null = null;
  let tot: string | null = null;
  for (const l of bron.leave) {
    if (!teltMee(l) || !l.startDate || !l.endDate) continue;
    if (van === null || l.startDate < van) van = l.startDate;
    if (tot === null || l.endDate > tot) tot = l.endDate;
  }

  return { rijen, bereik: van !== null && tot !== null ? { van, tot } : null };
}
