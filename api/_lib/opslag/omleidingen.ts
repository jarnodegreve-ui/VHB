import { MAX_OMLEIDING_BIJLAGEN } from "../../../shared/schemas/diversion.js";
import type { ActivityLogRow } from "../../types.js";
import { toDatabaseDiversion, toPublicDiversion } from "../../helpers.js";
import { uploadMoment } from "../bijlagenActies.js";
import { db, supabaseAdmin } from "../../db.js";
import { verwijderInStukken } from "./activiteit.js";
import { paginatedFetch, requireDb } from "./basis.js";
import { isMissingColumnError } from "./fouten.js";

// --- Diversions ---

// PDF-bijlagen (2026-09-25_diversions_bijlagen.sql): zelfde afspraak als bij
// de updates. Het bestand staat in de privé bucket op een vaste sleutel
// (`<id>-<slot>.pdf`, slot 1 tot 5) en de kolom `bijlagen` zegt alleen wát er
// hangt; de URL wordt per request ondertekend. Vóór 25-09 hing er hoogstens
// één PDF op `<id>.pdf` (marker in "pdfUrl"): die sleutel blijft slot 1
// zolang de rij geen `bijlagen` heeft (zie omleidingBijlagen in helpers).
export const DIVERSIONS_BUCKET = "diversions";

export const diversionBijlagePad = (diversionId: string, slot: number) => `${diversionId}-${slot}.pdf`;
/** De sleutel van vóór 25-09: één PDF zonder slot. */
export const diversionLegacyPad = (diversionId: string) => `${diversionId}.pdf`;

/** PDF wegschrijven op de vaste plek van deze omleiding en dit slot; opnieuw
 *  uploaden vervangt het vorige bestand. */
export const uploadDiversionBijlage = async (diversionId: string, slot: number, buffer: Buffer): Promise<void> => {
  if (!supabaseAdmin) throw new Error("SUPABASE_SERVICE_ROLE_KEY ontbreekt.");
  const { error } = await supabaseAdmin.storage
    .from(DIVERSIONS_BUCKET)
    .upload(diversionBijlagePad(diversionId, slot), buffer, { contentType: "application/pdf", upsert: true });
  if (error) throw error;
};

/** Eén bijlage weghalen; met `legacy` ook de oude `<id>.pdf`. "Not found" is
 *  geen fout: dan stond er al niets. */
export const verwijderDiversionBijlage = async (diversionId: string, slot: number, opts: { legacy?: boolean } = {}): Promise<void> => {
  if (!supabaseAdmin) throw new Error("SUPABASE_SERVICE_ROLE_KEY ontbreekt.");
  const paden = [diversionBijlagePad(diversionId, slot), ...(opts.legacy ? [diversionLegacyPad(diversionId)] : [])];
  const { error } = await supabaseAdmin.storage.from(DIVERSIONS_BUCKET).remove(paden);
  if (error && !/not.?found/i.test(String(error.message || ""))) throw error;
};

/** Alleen de oude sleutel `<id>.pdf` weghalen (slot 1 is net vervangen door
 *  `<id>-1.pdf`); "not found" is geen fout. */
export const verwijderDiversionLegacyBijlage = async (diversionId: string): Promise<void> => {
  if (!supabaseAdmin) throw new Error("SUPABASE_SERVICE_ROLE_KEY ontbreekt.");
  const { error } = await supabaseAdmin.storage.from(DIVERSIONS_BUCKET).remove([diversionLegacyPad(diversionId)]);
  if (error && !/not.?found/i.test(String(error.message || ""))) throw error;
};

/** De PDF van vóór 25-09 (`<id>.pdf`) naar de sleutel van slot 1 verhuizen,
 *  zodra de rij een lijst krijgt: vanaf dan leest de API alleen nog
 *  `<id>-<slot>.pdf`. Faalt de verhuis, dan gooien we: liever geen lijst
 *  schrijven dan een lijst die naar een bestand wijst dat er niet hangt. */
export const verplaatsDiversionLegacyBijlage = async (diversionId: string): Promise<void> => {
  if (!supabaseAdmin) throw new Error("SUPABASE_SERVICE_ROLE_KEY ontbreekt.");
  const { error } = await supabaseAdmin.storage
    .from(DIVERSIONS_BUCKET)
    .move(diversionLegacyPad(diversionId), diversionBijlagePad(diversionId, 1));
  if (error) throw error;
};

// Bijlage-URL's zijn kortlevend ondertekend (bucket is privé, zie
// supabase/2026-07-26_diversions_private.sql): een gedeelde link vervalt,
// i.p.v. eeuwig te blijven werken voor ex-medewerkers.
export const DIVERSION_URL_TTL_SEC = 60 * 60 * 12;
/** Tijdelijke, ondertekende URL van één bijlage; undefined als het bestand er
 *  niet (meer) is. `legacy` leest de oude sleutel `<id>.pdf`. */
export const ondertekenDiversionBijlage = async (diversionId: string, slot: number, legacy = false): Promise<string | undefined> => {
  if (!db) return undefined;
  try {
    const { data } = await db.storage
      .from(DIVERSIONS_BUCKET)
      .createSignedUrl(legacy ? diversionLegacyPad(diversionId) : diversionBijlagePad(diversionId, slot), DIVERSION_URL_TTL_SEC);
    return data?.signedUrl || undefined;
  } catch {
    return undefined;
  }
};

/** De PDF zelf ophalen (voor de mailknop op een omleiding, PR 4); null als
 *  het bestand er niet (meer) hangt. `legacy` leest de oude sleutel. */
export const downloadDiversionBijlage = async (diversionId: string, slot: number, legacy = false): Promise<Buffer | null> => {
  if (!supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin.storage
    .from(DIVERSIONS_BUCKET)
    .download(legacy ? diversionLegacyPad(diversionId) : diversionBijlagePad(diversionId, slot));
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
};

/** De bijlagenlijst van één omleiding bijwerken. Wist meteen de oude marker
 *  "pdfUrl": vanaf nu is de lijst de waarheid, ook als ze leeg is. */
export const zetDiversionBijlagen = async (
  diversionId: string,
  bijlagen: Array<{ slot: number; filename: string; sizeBytes?: number; uploadedAt?: string }>,
): Promise<void> => {
  const client = requireDb();
  const { error } = await client
    .from('diversions')
    .update({ bijlagen: bijlagen.length > 0 ? bijlagen : null, pdfUrl: null })
    .eq('id', String(diversionId));
  if (error) throw error;
};

/** De bestanden van één record in een bijlagen-bucket: naam → grootte en
 *  uploadmoment. Eén lijst-aanroep met het id als zoekterm; de zoekterm is
 *  ruim (ook andere namen waarin het id voorkomt), de aanroeper kijkt daarom
 *  alleen naar de exacte namen die hij zelf uit id en slot opbouwt, nooit naar
 *  een pad van de client. Het uploadmoment is wat Storage bij het bestand
 *  bijhoudt (`updated_at`, anders `created_at`); zonder leesbaar tijdstip
 *  blijft het weg. Gooit bij een fout: "niet te controleren" is niet "bestaat
 *  niet". */
export const bestandenVanRecord = async (bucket: string, recordId: string): Promise<Map<string, { sizeBytes?: number; uploadedAt?: string }>> => {
  if (!supabaseAdmin) throw new Error("SUPABASE_SERVICE_ROLE_KEY ontbreekt.");
  const { data, error } = await supabaseAdmin.storage
    .from(bucket)
    .list("", { limit: 1000, search: recordId, sortBy: { column: "name", order: "asc" } });
  if (error) throw error;
  const uit = new Map<string, { sizeBytes?: number; uploadedAt?: string }>();
  for (const rij of data ?? []) {
    // Mappen hebben geen id; die slaan we over.
    if (!rij?.id || !rij.name) continue;
    const grootte = Number((rij.metadata as { size?: unknown } | null | undefined)?.size);
    const uploadedAt = uploadMoment(rij.updated_at ?? rij.created_at);
    uit.set(String(rij.name), {
      ...(Number.isFinite(grootte) && grootte >= 0 ? { sizeBytes: grootte } : {}),
      ...(uploadedAt ? { uploadedAt } : {}),
    });
  }
  return uit;
};

/**
 * Welke PDF's van deze omleiding hangen er nu echt in Storage? Voor het
 * herstel na "Ongedaan maken": de server hangt alleen terug wat hij hier zelf
 * terugvindt. `oudeSleutel` = er hangt nog een `<id>.pdf` van vóór 25-09.
 */
export const bestaandeDiversionBijlagen = async (
  diversionId: string,
): Promise<{ slots: Array<{ slot: number; sizeBytes?: number; uploadedAt?: string }>; oudeSleutel: boolean }> => {
  const bestanden = await bestandenVanRecord(DIVERSIONS_BUCKET, diversionId);
  const nummers = Array.from({ length: MAX_OMLEIDING_BIJLAGEN }, (_, i) => i + 1);
  return {
    slots: nummers.flatMap((slot) => {
      const gevonden = bestanden.get(diversionBijlagePad(diversionId, slot));
      return gevonden ? [{ slot, ...gevonden }] : [];
    }),
    oudeSleutel: bestanden.has(diversionLegacyPad(diversionId)),
  };
};

// --- Uitgestelde opruiming van bijlagen (29-09) ---
// Een verwijderde omleiding of update nam haar PDF's vroeger meteen mee uit
// Storage. "Ongedaan maken" bracht het record dan terug zonder bijlagen: de
// bestanden waren al weg. Nu blijven ze staan tot de nachtcron ze opruimt
// (api/_lib/bijlagenOpruim.ts): alleen bestanden waarvan het record niet meer
// bestaat, en pas na een veilige marge. De lezingen waar ze op steunt
// (bestaandeRecordIds, logregelsVanEntiteiten) staan verderop.

/** Eén bestand in een bucket, zoals de opruiming het nodig heeft. */
export type BijlageBestand = { naam: string; gewijzigdOp: string | null; sizeBytes?: number };

const BIJLAGE_LIJST_PAGINA = 1000;
const BIJLAGE_LIJST_MAX_PAGINAS = 200;

/**
 * Alle bestanden in de wortel van een bijlagen-bucket, met de zekerheid dat
 * het er ook echt allemaal zijn. De lijst loopt door tot een LEGE pagina en
 * schuift op met het aantal rijen dat echt terugkwam: geeft de server minder
 * dan gevraagd (een eigen plafond), dan valt er niets tussen de pagina's.
 * `volledig` is alleen waar als de lijst op zo'n lege pagina eindigde. Gooit
 * bij een fout: een halve lijst is geen basis om iets weg te gooien.
 */
export const lijstBijlageBestandenVolledig = async (bucket: string): Promise<{ bestanden: BijlageBestand[]; volledig: boolean }> => {
  if (!supabaseAdmin) throw new Error("SUPABASE_SERVICE_ROLE_KEY ontbreekt.");
  const uit: BijlageBestand[] = [];
  let gelezen = 0;
  for (let pagina = 0; pagina < BIJLAGE_LIJST_MAX_PAGINAS; pagina += 1) {
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .list("", { limit: BIJLAGE_LIJST_PAGINA, offset: gelezen, sortBy: { column: "name", order: "asc" } });
    if (error) throw error;
    const rijen = data ?? [];
    if (rijen.length === 0) return { bestanden: uit, volledig: true };
    gelezen += rijen.length;
    for (const rij of rijen) {
      // Mappen hebben geen id; die slaan we over.
      if (!rij?.id || !rij.name) continue;
      const grootte = Number((rij.metadata as { size?: unknown } | null | undefined)?.size);
      uit.push({
        naam: String(rij.name),
        gewijzigdOp: rij.updated_at ?? rij.created_at ?? null,
        ...(Number.isFinite(grootte) && grootte >= 0 ? { sizeBytes: grootte } : {}),
      });
    }
  }
  return { bestanden: uit, volledig: false };
};

/** Zoals hierboven, zonder de zekerheid: voor de opruiming, die alleen
 *  bestanden raakt die ze gezien heeft. */
export const lijstBijlageBestanden = async (bucket: string): Promise<BijlageBestand[]> =>
  (await lijstBijlageBestandenVolledig(bucket)).bestanden;

/** Het exacte aantal rijen in een tabel, los van elke paginering. null = de
 *  server gaf geen telling. */
export const telRijen = async (tabel: "diversions" | "updates"): Promise<number | null> => {
  const client = requireDb();
  const { count, error } = await client.from(tabel).select("id", { count: "exact", head: true });
  if (error) throw error;
  return typeof count === "number" && Number.isFinite(count) ? count : null;
};

/** Bestanden weghalen uit een bijlagen-bucket; "not found" is geen fout. */
export const verwijderBijlageBestanden = async (bucket: string, paden: string[]): Promise<void> => {
  if (paden.length === 0) return;
  if (!supabaseAdmin) throw new Error("SUPABASE_SERVICE_ROLE_KEY ontbreekt.");
  const { error } = await supabaseAdmin.storage.from(bucket).remove(paden);
  if (error && !/not.?found/i.test(String(error.message || ""))) throw error;
};

/** Hoogstens zoveel id's per gerichte lezing (de lijst reist in de URL). */
export const GERICHTE_LEZING_MAX = 100;

/**
 * Gerichte lezing: welke van deze id's bestaan als rij in de tabel? Anders dan
 * de brede lijst (getDiversionsData, gepagineerd) kan dit antwoord niet
 * afgekapt zijn: hoogstens 100 rijen op een primaire sleutel. Gooit bij een
 * fout of een antwoord dat niet past bij de vraag: "niet te controleren" is
 * nooit "bestaat niet".
 */
export const bestaandeRecordIds = async (tabel: "diversions" | "updates", ids: string[]): Promise<Set<string>> => {
  const gevraagd = [...new Set(ids.map((id) => String(id)).filter(Boolean))];
  if (gevraagd.length === 0) return new Set();
  if (gevraagd.length > GERICHTE_LEZING_MAX) throw new Error(`Gerichte lezing: hoogstens ${GERICHTE_LEZING_MAX} id's per keer.`);
  const client = requireDb();
  const { data, error } = await client.from(tabel).select("id").in("id", gevraagd);
  if (error) throw error;
  if (!Array.isArray(data)) throw new Error("Gerichte lezing: onverwacht antwoord.");
  const mag = new Set(gevraagd);
  const uit = new Set<string>();
  for (const rij of data as Array<{ id?: unknown }>) {
    const id = String(rij?.id ?? "");
    if (!id || !mag.has(id)) throw new Error("Gerichte lezing: onverwacht antwoord.");
    uit.add(id);
  }
  return uit;
};

const LOGREGELS_MAX = 5000;

/**
 * De logregels van deze omleidingen of updates, NIEUWSTE EERST. Die volgorde
 * is de vangrail: geeft de server minder rijen terug dan gevraagd, dan vallen
 * de oudste weg en blijft de laatste regel per id de juiste. Een id zonder
 * regels in het antwoord heeft dan gewoon geen bewijs.
 */
export const logregelsVanEntiteiten = async (
  entityType: "diversion" | "update",
  ids: string[],
): Promise<Array<{ entityId: string; action: string; createdAt: string }>> => {
  const gevraagd = [...new Set(ids.map((id) => String(id)).filter(Boolean))];
  if (gevraagd.length === 0) return [];
  if (gevraagd.length > GERICHTE_LEZING_MAX) throw new Error(`Logregels: hoogstens ${GERICHTE_LEZING_MAX} id's per keer.`);
  const client = requireDb();
  const rows = await paginatedFetch<Pick<ActivityLogRow, "id" | "entity_id" | "action" | "created_at">>((from, to) =>
    client
      .from("activity_log")
      .select("id, entity_id, action, created_at")
      .eq("entity_type", entityType)
      .in("entity_id", gevraagd)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to),
  LOGREGELS_MAX);
  return rows.map((r) => ({ entityId: String(r.entity_id ?? ""), action: String(r.action ?? ""), createdAt: String(r.created_at ?? "") }));
};

export const getDiversionsData = async () => {
  const client = requireDb();
  const rows = await paginatedFetch((from, to) =>
    client.from('diversions').select('*').order('id', { ascending: true }).range(from, to),
  );
  return rows.map(toPublicDiversion);
};

const zonderLocation = ({ location: _l, ...rest }: ReturnType<typeof toDatabaseDiversion>) => rest;

export const saveDiversionsData = async (data: any) => {
  const client = requireDb();
  const normalized = Array.isArray(data) ? data.map(toPublicDiversion) : [];
  const incomingIds = new Set(normalized.map((d) => String(d.id)));

  const existing = await paginatedFetch((from, to) =>
    client.from('diversions').select('id').order('id', { ascending: true }).range(from, to),
  );

  const idsToDelete = (existing ?? [])
    .map((row: any) => String(row.id))
    .filter((id) => !incomingIds.has(id));

  // Eerst upserten, dan pas verwijderen: faalt de upsert, dan zijn er nog géén
  // rijen (en PDF's) onomkeerbaar weggegooid. Andersom verloor je bij een
  // upsert-fout de zojuist verwijderde records.
  if (normalized.length > 0) {
    const rows = normalized.map(toDatabaseDiversion);
    let { error: upsertError } = await client.from('diversions').upsert(rows);
    // Migratie 2026-09-10_diversions_location.sql nog niet gedraaid: opnieuw
    // zonder `location`. Bewust bij elke save opnieuw geprobeerd en niet per
    // warme lambda onthouden: dat liet de plaats na het draaien van de
    // migratie stil wegvallen tot de lambda koud werd (Jarno 28-09).
    if (upsertError && isMissingColumnError(upsertError)) {
      ({ error: upsertError } = await client.from('diversions').upsert(rows.map(zonderLocation)));
    }
    if (upsertError) throw upsertError;
  }

  // De PDF's blijven bewust staan: "Ongedaan maken" moet ze kunnen
  // terughangen. De nachtcron ruimt ze op (api/_lib/bijlagenOpruim.ts).
  await verwijderInStukken(client, 'diversions', 'id', idsToDelete);
};
