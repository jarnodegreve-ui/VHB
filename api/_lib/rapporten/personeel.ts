import { ROL_LABELS } from "../../../shared/schemas/constanten.js";
import { onbekendLabel } from "../../../shared/rapporten/filters.js";
import { ZONDER_SECTIE } from "../../../shared/rapporten/definities/personeel.js";
import { VERVAL_STATUS_LABEL, brusselseDag, dagenTussen, isoDagVan, jarenTussen, pastInTermijn, vervalStatus } from "../../../shared/rapporten/peildatum.js";
import type { RapportBereik, RapportFilters, RapportResultaat, RapportRij } from "../../../shared/rapporten/types.js";

/**
 * De rapporten van het domein Personeel, als pure functies (bron + filters +
 * peildatum → rijen + bereik). De bron is bewust smal: `RapportMedewerker`
 * bevat alleen wat een rapport toont, en de lader (personeelLaders.ts) vraagt
 * precies die kolommen op. Een wachtwoord- of auth-veld komt hier dus nooit
 * voorbij.
 */

export type RapportMedewerker = {
  id: string;
  name: string;
  role: string;
  phone?: string | null;
  email?: string | null;
  employeeId?: string | null;
  section?: string | null;
  startDate?: string | null;
  isActive?: boolean | null;
  showInContacts?: boolean | null;
};

const tekst = (waarde: string | null | undefined): string | null => waarde?.trim() || null;
const rolLabel = (rol: string): string => (ROL_LABELS as Record<string, string>)[rol] ?? rol;

/** Het systeemaccount "beheerder" is geen medewerker. */
const isMedewerker = (u: RapportMedewerker): boolean => u.name.trim().toLowerCase() !== "beheerder";
const isActief = (u: RapportMedewerker): boolean => u.isActive !== false;

/** Rol en sectie; "Zonder sectie" = wie er geen heeft (staf, techniekers). */
const pastBijKeuzes = (u: RapportMedewerker, filters: RapportFilters): boolean => {
  const rol = filters.keuzes.rol ?? "alle";
  if (rol !== "alle" && u.role !== rol) return false;
  const sectie = filters.keuzes.sectie ?? "alle";
  if (sectie === "alle") return true;
  return sectie === ZONDER_SECTIE ? !tekst(u.section) : tekst(u.section) === sectie;
};

/** Geen periode: het bereik zegt alleen óf er actieve medewerkers zijn (eerste datum in dienst tot vandaag). */
const personeelBereik = (actieven: readonly RapportMedewerker[], vandaag: string): RapportBereik => {
  if (actieven.length === 0) return null;
  const eerste = actieven.reduce<string>((min, u) => {
    const dag = isoDagVan(u.startDate);
    return dag && dag < min ? dag : min;
  }, vandaag);
  return { van: eerste, tot: vandaag };
};

export function bouwContactlijst(users: readonly RapportMedewerker[], filters: RapportFilters, vandaag: string): RapportResultaat {
  const actieven = users.filter((u) => isMedewerker(u) && isActief(u));
  const rijen: RapportRij[] = actieven.filter((u) => pastBijKeuzes(u, filters)).map((u) => ({
    id: u.id,
    naam: u.name,
    rol: rolLabel(u.role),
    sectie: tekst(u.section),
    telefoon: tekst(u.phone),
    email: tekst(u.email),
    // Het vlagje regelt wat chauffeurs van elkaar zien; staf ziet iedereen, met erbij wie daar ontbreekt.
    gedeeld: u.showInContacts !== false,
  }));
  return { rijen, bereik: personeelBereik(actieven, vandaag) };
}

export function bouwActieveMedewerkers(users: readonly RapportMedewerker[], filters: RapportFilters, vandaag: string): RapportResultaat {
  const actieven = users.filter((u) => isMedewerker(u) && isActief(u));
  const rijen: RapportRij[] = actieven.filter((u) => pastBijKeuzes(u, filters)).map((u) => ({
    id: u.id,
    naam: u.name,
    personeelsnr: tekst(u.employeeId),
    rol: rolLabel(u.role),
    sectie: tekst(u.section),
    inDienst: isoDagVan(u.startDate),
    ancienniteit: jarenTussen(u.startDate, vandaag),
    telefoon: tekst(u.phone),
  }));
  return { rijen, bereik: personeelBereik(actieven, vandaag), peildatum: vandaag };
}

// --- Vervaldata per chauffeur: medische schifting en code 95 op één lader ---

export type RapportPersoneelVerval = { userId: string; soort: string; validUntil: string; updatedAt?: string | null };

/**
 * Eén soort vervaldatum (medische schifting of code 95) voor elke actieve
 * chauffeur, dezelfde kring als het scherm Vervaldata. Wie GEEN datum heeft
 * staat er ook in, met een lege datum: een ontbrekende schifting is net wat
 * gezien moet worden, en ze hoort dus bij elke termijn. Met een chauffeur
 * gekozen komt die ene persoon, ook als hij uit dienst is; een verwijderd
 * account blijft "Onbekend (<id>)".
 */
export function bouwPersoneelVerval(
  bron: { users: readonly RapportMedewerker[]; vervaldata: readonly RapportPersoneelVerval[] },
  soort: string,
  filters: RapportFilters,
  vandaag: string,
): RapportResultaat {
  const vanSoort = bron.vervaldata.filter((e) => e.soort === soort && isoDagVan(e.validUntil));
  const perUser = new Map(vanSoort.map((e) => [String(e.userId), e]));

  let personen: RapportMedewerker[];
  if (filters.chauffeur) {
    const gevonden = bron.users.find((u) => u.id === filters.chauffeur);
    personen = [gevonden ?? { id: filters.chauffeur, name: onbekendLabel(filters.chauffeur), role: "chauffeur" }];
  } else {
    personen = bron.users.filter((u) => u.role === "chauffeur" && isActief(u) && isMedewerker(u));
  }

  const rijen: RapportRij[] = [];
  for (const u of personen) {
    const e = perUser.get(u.id);
    const geldigTot = e ? isoDagVan(e.validUntil) : null;
    const resterend = geldigTot ? dagenTussen(vandaag, geldigTot) : null;
    if (!pastInTermijn(resterend, filters.keuzes.termijn)) continue;
    rijen.push({
      id: u.id,
      naam: isActief(u) ? u.name : `${u.name} (uit dienst)`,
      personeelsnr: tekst(u.employeeId),
      geldigTot,
      resterend,
      status: VERVAL_STATUS_LABEL[vervalStatus(resterend)],
      bijgewerktOp: e ? brusselseDag(e.updatedAt) : null,
    });
  }

  // Bereik: is er van deze soort al iets geregistreerd? (van de vroegste tot de laatste datum)
  let van: string | null = null;
  let tot: string | null = null;
  for (const e of vanSoort) {
    const dag = e.validUntil.slice(0, 10);
    if (van === null || dag < van) van = dag;
    if (tot === null || dag > tot) tot = dag;
  }
  return { rijen, bereik: van !== null && tot !== null ? { van, tot } : null, peildatum: vandaag };
}
