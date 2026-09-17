import { lijnLabel } from "../../shared/lijnen.js";
import { PERIODE_DMJ } from "../helpers.js";
import crypto from "node:crypto";
import type { AppUser, AuthenticatedRequest, IncomingUser } from "../types.js";
import { supabaseAdmin } from "../db.js";
import { sendWelcomeEmail } from "../email.js";
import { deletePushSubscriptionsForUser, sendPushToUsers } from "../push.js";
import { recordUrl } from "./meldingen.js";
import { isMissingTableError } from "../deviceGate.js";
import { invalidateUsersCache } from "../userCache.js";
import {
  deleteAllDocumentsForUser,
  diffDiversionChanges,
  diffUpdateChanges,
  diffUserChanges,
  getUsersData,
  kopieerOnthaalDocumentenNaar,
  logActivity,
  revokeAllDevices,
  saveDiversionsData,
  saveUpdatesData,
  saveUsersData,
  summarizeDiversionChanges,
  summarizeUpdateChanges,
  summarizeUserChanges,
} from "../storage.js";

/**
 * Gedeelde schrijfkern voor de "rij-voor-rij"-collecties (gebruikers,
 * omleidingen, updates). De collectie-POST's ("hele lijst opslaan") en de
 * per-record-routes (PUT/POST one/DELETE, sinds 03-09) roepen dezelfde
 * functies aan, zodat álle bijwerkingen — Auth-account + welkomstmail,
 * onthaal-documenten, documenten opruimen bij verwijderen, activity-log met
 * diff, users-cache-invalidatie, push bij een nieuwe update — op één plek
 * staan en niet uit elkaar kunnen groeien.
 *
 * Per-record-concurrency: de records hebben geen updatedAt-kolom, dus de
 * revisie is een stabiele hash van het record zoals de server het serveert
 * (`_rev` in de GET-respons). De client stuurt hem terug in de header
 * `X-Record-Revision`; wijkt hij af van de huidige serverstaat, dan is het
 * record intussen door iemand anders gewijzigd → 409 mét het actuele record.
 */

export const RECORD_REVISION_HEADER = "x-record-revision";

/** Opaque, stabiele hash van één record (zelfde vorm als de collectie-
 *  revisie). Sleutelvolgorde is stabiel omdat de normalizers (toPublicUser
 *  e.d.) het object altijd in dezelfde volgorde opbouwen. */
export const recordRevisionOf = (record: unknown): string =>
  crypto.createHash("sha256").update(JSON.stringify(record ?? null)).digest("base64url").slice(0, 22);

/** Gebruikersrevisie ZONDER de sessie-velden — die muteren bij elke login
 *  (zelfde reden als usersRevisionOf voor de hele lijst). */
export const userRecordRevisionOf = (user: AppUser): string =>
  recordRevisionOf({ ...user, lastLogin: undefined, activeSessions: undefined });

/** Record + `_rev` voor de respons. */
export const withRecordRevision = <T extends object>(record: T, rev: string): T & { _rev: string } =>
  ({ ...record, _rev: rev });

/** Leest de meegestuurde record-revisie; null = niet meegegeven. */
export const requestedRecordRevision = (req: AuthenticatedRequest): string | null => {
  const value = req.headers[RECORD_REVISION_HEADER];
  return typeof value === "string" && value.length > 0 ? value : null;
};

type WriteOpts = {
  /** Collectie-samenvatting ("N gebruikers verwerkt …") meeloggen. De
   *  per-record-routes zetten dit uit: de per-entity regel zegt al alles. */
  samenvatting?: boolean;
  /** Herstel na "Ongedaan maken": zelfde record terug — geen push, en het
   *  auditspoor zegt "hersteld" i.p.v. "toegevoegd" (controle 05-09). */
  herstel?: boolean;
};

// --- Gebruikers ---

/** Wat er bij een deactivering naast de Auth-ban nog ingetrokken werd. */
export type ToegangIngetrokken = {
  toestellen: number;
  push: number;
  /** Stappen die mislukten (best-effort: de deactivering zelf staat al). */
  fouten: Array<"toestellen" | "push">;
};

/**
 * Toegang van een gedeactiveerd account intrekken: toestellen op 'revoked'
 * en push-abonnementen weg. De Auth-ban zelf zet saveUsersData (reconciliatie
 * op isActive). Eén functie voor élk schrijfpad dat isActive true→false kan
 * zetten (PUT /api/users/:id, collectie-POST, uitdienst), zodat "pauzeren"
 * in gebruikersbeheer niet stil een ingelogd toestel liet doorwerken
 * (controle-ronde 16-09, bevinding 2). Best-effort en herhaalbaar: een tweede
 * aanroep geeft nullen.
 */
export const trekToegangIn = async (userId: string): Promise<ToegangIngetrokken> => {
  const resultaat: ToegangIngetrokken = { toestellen: 0, push: 0, fouten: [] };
  try {
    resultaat.toestellen = await revokeAllDevices(userId);
  } catch (err: any) {
    // Zonder toestel-tabel valt er niets in te trekken.
    if (!isMissingTableError(err)) {
      console.error("Toegang intrekken: toestellen intrekken is mislukt.", err?.message || err);
      resultaat.fouten.push("toestellen");
    }
  }
  try {
    resultaat.push = await deletePushSubscriptionsForUser(userId);
  } catch (err: any) {
    console.error("Toegang intrekken: push-abonnementen wissen is mislukt.", err?.message || err);
    resultaat.fouten.push("push");
  }
  return resultaat;
};

/** Ids van gebruikers die in deze save van actief naar inactief gaan. */
export const gedeactiveerdeIds = (previousUsers: AppUser[], newData: IncomingUser[]): string[] => {
  const nieuwById = new Map(newData.map((u) => [String(u.id), u]));
  return previousUsers
    .filter((u) => u.isActive !== false)
    .map((u) => String(u.id))
    .filter((id) => nieuwById.get(id)?.isActive === false);
};

export const verwerkUsersOpslag = async (
  req: AuthenticatedRequest,
  previousUsers: AppUser[],
  newData: IncomingUser[],
  opts: WriteOpts = {},
): Promise<{ createdAccounts: Array<{ email: string; name: string }>; ingetrokken: Record<string, ToegangIngetrokken> }> => {
  const { createdAccounts } = (await saveUsersData(newData)) ?? { createdAccounts: [] };
  // Auth-cache verversen: rol/isActive/e-mail-wijzigingen moeten meteen
  // doorwerken, niet pas na de TTL.
  invalidateUsersCache();

  // Gedeactiveerd (actief → inactief)? Dan ook toestellen en push intrekken,
  // net als bij "Uit dienst": de Auth-ban uit saveUsersData stopt nieuwe
  // logins, maar een goedgekeurd toestel met een lopende sessie werkte anders
  // door tot tokenverloop en bleef pushes krijgen.
  const ingetrokken: Record<string, ToegangIngetrokken> = {};
  for (const id of gedeactiveerdeIds(previousUsers, newData)) {
    const naam = previousUsers.find((u) => String(u.id) === id)?.name ?? id;
    const r = await trekToegangIn(id);
    ingetrokken[id] = r;
    await logActivity(
      req,
      "users",
      "Toegang ingetrokken",
      `${naam}: Auth-account geblokkeerd, ${r.toestellen} toestel${r.toestellen === 1 ? "" : "len"} ingetrokken, ${r.push} push-abonnement${r.push === 1 ? "" : "en"} gewist.${r.fouten.length ? ` Mislukt: ${r.fouten.join(", ")}.` : ""}`,
      { type: "user", id },
    );
  }
  if (opts.samenvatting !== false) {
    await logActivity(
      req,
      "users",
      "Gebruikers opgeslagen",
      `${newData.length} gebruikers verwerkt in gebruikersbeheer. ${summarizeUserChanges(previousUsers, newData)}.`,
    );
  }

  // Per-user audit entries
  const userDiff = diffUserChanges(previousUsers, newData);
  for (const u of userDiff.added) {
    await logActivity(req, "users", "Gebruiker toegevoegd", `${u.name} (${u.role}, ${u.employeeId || '—'}).`, { type: "user", id: u.id });
    // Nieuwe chauffeur? Zet de Onthaal-documenten (brochure e.d.) meteen
    // klaar in "Mijn documenten". Best-effort — mag de save nooit breken.
    if (u.role === "chauffeur") {
      try {
        const klaargezet = await kopieerOnthaalDocumentenNaar(String(u.id));
        if (klaargezet > 0) {
          await logActivity(req, "users", "Onthaal-documenten klaargezet", `${klaargezet} document(en) automatisch toegevoegd voor ${u.name}.`, { type: "user", id: u.id });
        }
      } catch (err) {
        console.error(`[onthaal-docs] klaarzetten voor ${u.name} mislukt:`, err);
      }
    }
  }
  for (const { user: u, fields } of userDiff.changed) {
    await logActivity(req, "users", "Gebruiker gewijzigd", `${u.name}, ${fields.join(', ')}.`, { type: "user", id: u.id });
  }
  for (const u of userDiff.removed) {
    await logActivity(req, "users", "Gebruiker verwijderd", `${u.name} (${u.role}).`, { type: "user", id: u.id });
    // Wees-documenten opruimen: verwijder de bijhorende storage-bestanden +
    // metadata-rijen zodat er niets van de ex-medewerker achterblijft.
    const removedDocs = await deleteAllDocumentsForUser(String(u.id));
    if (removedDocs > 0) {
      await logActivity(req, "users", "Documenten opgeruimd", `${removedDocs} document(en) van ${u.name} verwijderd.`, { type: "user", id: u.id });
    }
  }

  // Welkomstmail voor élk nieuw aangemaakt Auth-account: met een
  // recovery-link stelt de nieuwe collega direct een eigen wachtwoord in
  // (i.p.v. een doorgefluisterd Excel-wachtwoord). Best-effort — een
  // mailfout mag de save niet laten falen.
  for (const account of createdAccounts ?? []) {
    try {
      let actionLink: string | null = null;
      if (supabaseAdmin) {
        const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
          type: "recovery",
          email: account.email,
          options: { redirectTo: process.env.APP_URL || "https://vhbportaal.com" },
        });
        if (!linkError) actionLink = linkData?.properties?.action_link ?? null;
      }
      await sendWelcomeEmail({ to: account.email, name: account.name, actionLink });
    } catch (err) {
      console.error(`[welcome-mail] versturen naar ${account.email} mislukt:`, err);
    }
  }

  return { createdAccounts: createdAccounts ?? [], ingetrokken };
};

// --- Omleidingen ---

const fmtDiversion = (d: any) => `${d.title} (${lijnLabel(d.line).toLowerCase()}), ${PERIODE_DMJ(d.startDate, d.endDate)}.`;

export const verwerkDiversionsOpslag = async (
  req: AuthenticatedRequest,
  previousDiversions: any[],
  newData: any[],
  opts: WriteOpts = {},
): Promise<void> => {
  await saveDiversionsData(newData);
  if (opts.samenvatting !== false) {
    await logActivity(
      req,
      "diversions",
      "Omleidingen opgeslagen",
      `${newData.length} omleidingen opgeslagen. ${summarizeDiversionChanges(previousDiversions, newData)}.`,
    );
  }

  // Per-omleiding audit entries
  const divDiff = diffDiversionChanges(previousDiversions, newData);
  for (const d of divDiff.added) {
    await logActivity(req, "diversions", opts.herstel ? "Omleiding hersteld" : "Omleiding toegevoegd", fmtDiversion(d), { type: "diversion", id: d.id });
  }
  for (const d of divDiff.changed) {
    await logActivity(req, "diversions", "Omleiding gewijzigd", fmtDiversion(d), { type: "diversion", id: d.id });
  }
  for (const d of divDiff.removed) {
    await logActivity(req, "diversions", "Omleiding verwijderd", fmtDiversion(d), { type: "diversion", id: d.id });
  }
};

// --- Updates ---

// Categorieën zijn uit de UI verdwenen (#241) — niet meer in het
// auditspoor echoën; URGENT blijft betekenisvol.
const fmtUpdate = (u: any) => `${u.title}${u.isUrgent ? ' [URGENT]' : ''}.`;

export const verwerkUpdatesOpslag = async (
  req: AuthenticatedRequest,
  previousUpdates: any[],
  newData: any[],
  opts: WriteOpts & { pushUrl: string },
): Promise<void> => {
  await saveUpdatesData(newData);
  if (opts.samenvatting !== false) {
    await logActivity(
      req,
      "updates",
      "Updates opgeslagen",
      `${newData.length} updates opgeslagen. ${summarizeUpdateChanges(previousUpdates, newData)}.`,
    );
  }

  // Per-update audit entries
  const updDiff = diffUpdateChanges(previousUpdates, newData);
  for (const u of updDiff.added) {
    await logActivity(req, "updates", opts.herstel ? "Update hersteld" : "Update toegevoegd", fmtUpdate(u), { type: "update", id: u.id });
  }
  for (const u of updDiff.changed) {
    await logActivity(req, "updates", "Update gewijzigd", fmtUpdate(u), { type: "update", id: u.id });
  }
  for (const u of updDiff.removed) {
    await logActivity(req, "updates", "Update verwijderd", fmtUpdate(u), { type: "update", id: u.id });
  }

  // Nieuwe update → push naar alle actieve chauffeurs. Urgente updates mailen
  // al (aparte flow); een push zorgt dat óók gewone updates niet onopgemerkt
  // blijven tot iemand de app toevallig opent.
  if (updDiff.added.length > 0 && !opts.herstel) {
    const chauffeurIds = (await getUsersData()).filter((u) => u.role === "chauffeur" && u.isActive !== false).map((u) => String(u.id));
    for (const u of updDiff.added) {
      await sendPushToUsers(chauffeurIds, {
        title: u.isUrgent ? "Belangrijke update" : "Nieuwe update",
        soort: "update",
        body: u.title,
        // Naar het bericht zelf (/updates/<id>), niet naar het scherm: de
        // melding en de push-tik landen dan op dat item (useRecordParam).
        url: u.id ? recordUrl("updates", u.id) : opts.pushUrl,
      });
    }
  }
};
