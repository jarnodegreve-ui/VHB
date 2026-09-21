/**
 * Gedeelde vangrails van de collectie- en record-routes: collectie-revisie
 * (X-Collection-Revision), de massa-verwijder-rem, de 409/428-antwoorden voor
 * per-record-schrijven, en een paar kleine helpers die elk domein nodig heeft.
 * Stond tot 21-09 midden in api/index.ts.
 *
 * Verhuisd uit api/index.ts (21-09, verbeterronde 4, G1): dat bestand was
 * 6.344 regels en elke wijziging raakte dezelfde importkop. De code is
 * verplaatst, niet herschreven; api/index.ts bouwt de app op en mount de
 * domeinen in dezelfde volgorde als voorheen.
 */

import crypto from "node:crypto";
import type { AuthenticatedRequest } from "../types.js";
// Gedeelde API-contracten (zod) — zelfde schemas als de formulieren in src/.
import { RECORD_REVISION_HEADER } from "./recordWrites.js";
// Excel-werk (xlsx lui geladen, daarom async): zie api/_lib/matrixXlsx.ts.

// Wachtwoordminimum (WACHTWOORD_MIN) komt uit shared/schemas/user.ts — één
// bron voor client én server.

/** Deeplink-URL voor een push-melding: de app opent op die pagina i.p.v. op
 *  het dashboard. De router leest de view uit de URL (src/app/router.ts);
 *  api/_lib/meldingen.ts vertaalt hem naar het pad in de app. */
export const viewUrl = (view: string) => `/?view=${view}`;

// --- Dienstnotities: kort bericht van de planner bij één dienstdag ---
export const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Vangrail tegen bulk-wipes: het write-model vervangt de hele collectie,
 *  dus een client die opslaat vanuit een niet-geladen staat zou álles als
 *  "verwijderd" aanbieden. Een POST die meer dan de helft van een bestaande
 *  collectie (≥ 5 records) schrapt, is vrijwel zeker zo'n vergissing.
 *  Retourneert het aantal te verwijderen records als de save geblokkeerd
 *  moet worden, anders null. */
export const detectMassDelete = (
  previous: any[],
  incoming: any[],
  idOf: (x: any) => string = (x) => String(x?.id),
): number | null => {
  if (previous.length < 5) return null;
  const incomingIds = new Set(incoming.map(idOf));
  const removed = previous.filter((p) => !incomingIds.has(idOf(p))).length;
  return removed > previous.length / 2 ? removed : null;
};

export const massDeleteResponse = (res: any, removed: number, total: number, label: string) =>
  res.status(409).json({
    error: "Bulk-verwijdering geblokkeerd",
    details: `Deze opslag zou ${removed} van de ${total} ${label} verwijderen. Vermoedelijk was je scherm niet volledig geladen, vernieuw de pagina en probeer opnieuw, of verwijder in kleinere stappen.`,
  });

/**
 * Optimistic-concurrency voor de "hele lijst opslaan"-collecties (diensten,
 * omleidingen, updates, planningscodes). Twee beheerders die tegelijk
 * dezelfde lijst bewerken konden elkaar stil overschrijven; nu krijgt de
 * tweede een 409.
 *
 * De revisie is een hash van de huidige collectie. GET zet 'm als header;
 * de client stuurt 'm bij POST terug in x-base-revision. Omdat zowel GET als
 * POST de revisie over dezelfde getX()-output berekenen (identieke
 * normalisatie + sortering op id/code), is de vergelijking stabiel. De client
 * behandelt de waarde als ondoorzichtig en hasht zelf niets.
 */
export const COLLECTION_REVISION_HEADER = "x-collection-revision";

export const revisionOf = (rows: any[]): string => {
  const sorted = [...(Array.isArray(rows) ? rows : [])].sort((a, b) =>
    String(a?.id ?? a?.code ?? "").localeCompare(String(b?.id ?? b?.code ?? "")),
  );
  return crypto.createHash("sha256").update(JSON.stringify(sorted)).digest("base64url").slice(0, 22);
};

/** Revisiecontrole op collectie-saves. "ontbreekt": de client stuurde geen
 *  X-Collection-Revision mee (verplicht sinds 06-09 — zonder basisrevisie kan
 *  de server niet weten of de payload nog vers is). "conflict": de basisrevisie
 *  komt niet meer overeen met de serverstaat → iemand anders heeft intussen
 *  opgeslagen. null: in orde. */
type RevisieProbleem = "ontbreekt" | "conflict";

export const revisionCheck = (req: AuthenticatedRequest, current: any[], rev: (rows: any[]) => string = revisionOf): RevisieProbleem | null => {
  const base = req.headers[COLLECTION_REVISION_HEADER];
  if (typeof base !== "string" || base.length === 0) return "ontbreekt";
  return base === rev(current) ? null : "conflict";
};

export const revisionProbleemResponse = (res: any, label: string, probleem: RevisieProbleem) =>
  probleem === "ontbreekt"
    ? res.status(428).json({
        error: "Revisie ontbreekt",
        details: `${label} kan niet opgeslagen worden zonder de revisie van de geladen lijst (X-Collection-Revision). Ververs de lijst en probeer opnieuw.`,
        conflict: "revision-missing",
      })
    : res.status(409).json({
        error: "Gewijzigd door iemand anders",
        details: `${label} is intussen door iemand anders aangepast. De lijst wordt ververst, bekijk de wijziging en probeer je aanpassing opnieuw.`,
        conflict: "revision",
      });

// --- Gebruikers per record (PUT/POST one/DELETE) ---
// Eerste stap weg van "POST de hele collectie": het scherm bewerkt rij voor
// rij, dus de API ook. Zelfde schrijfkern (verwerkUsersOpslag) als de
// collectie-POST; concurrency per record via `_rev` (zie recordWrites.ts).

/** Gedeelde 409 voor een record dat intussen gewijzigd is: het actuele
 *  record gaat mee zodat de client kan verversen. */
export const recordConflictResponse = (res: any, label: string, record: unknown) =>
  res.status(409).json({
    error: "Gewijzigd door iemand anders",
    details: `${label} is intussen door iemand anders gewijzigd. De lijst wordt ververst, bekijk de wijziging en probeer je aanpassing opnieuw.`,
    conflict: "record",
    record,
  });

export const recordRevisionMissingResponse = (res: any) =>
  res.status(400).json({ error: `${RECORD_REVISION_HEADER} ontbreekt: stuur de revisie van het record dat je zag mee.` });

export const isPlainRecord = (body: unknown): body is Record<string, unknown> =>
  !!body && typeof body === "object" && !Array.isArray(body);

export const newRecordId = () => crypto.randomUUID();

/** Toegestane vorm van een client-gegenereerd record-id (UUID of de
 *  Date.now()-terugval uit de views). Sluit scheidingstekens uit: het id
 *  reist mee in Telegram-callback_data als `lv|<id>|<besluit>`, en een id
 *  met een pipe kon daar het doelrecord verleggen (security-audit 07-09,
 *  bevinding 9). */
export const RECORD_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

// Delta-endpoint voor verlofbeslissingen (zie PATCH /api/swaps/:id voor het
// waarom). Beslissen is planner/admin-werk; chauffeurs trekken in via de
// array-route (volledige verwijdering van eigen pending).
/** Actor van een beslissing die niet via een HTTP-request binnenkomt (de
 *  Telegram-bot). logActivity leest alleen req.appUser — een synthetisch
 *  request met dezelfde velden volstaat en houdt de auditlog eerlijk. */
export type BeslisActor = { id: string; name: string; role: "chauffeur" | "planner" | "admin" };

export const actorReq = (actor: BeslisActor) => ({ appUser: actor } as AuthenticatedRequest);
