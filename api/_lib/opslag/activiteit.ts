import type { ActivityLogRecord, ActivityLogRow, AuthenticatedRequest } from "../../types.js";
import { RUIL_BEKEKEN_ACTIE } from "../../../shared/ruilVerloop.js";
import { hoortBijSessie, type AanwezigheidLocatie } from "../aanwezigheid.js";
import { paginatedFetch, requireDb } from "./basis.js";
import { isMissingColumnError } from "./fouten.js";

// --- Activity log ---

const toPublicActivityLog = (row: ActivityLogRow | ActivityLogRecord): ActivityLogRecord => ({
  id: row.id,
  createdAt: "createdAt" in row ? row.createdAt : row.created_at,
  actorName: "actorName" in row ? row.actorName : row.actor_name,
  actorRole: "actorRole" in row ? row.actorRole : row.actor_role,
  category: row.category,
  action: row.action,
  details: row.details,
  entityType:
    "entityType" in row ? row.entityType ?? null : (row as ActivityLogRow).entity_type ?? null,
  entityId:
    "entityId" in row ? row.entityId ?? null : (row as ActivityLogRow).entity_id ?? null,
});

export const getActivityLog = async (
  opts?: { sinceIso?: string | null; max?: number; metRuilBekeken?: boolean },
): Promise<ActivityLogRecord[]> => {
  const client = requireDb();
  // Aanwezigheids-events ('auth' / 'Aangemeld' + 'Actief') worden bewust uit
  // het auditspoor gefilterd: ze zijn hoog-volume en zouden het venster
  // vullen, waardoor de echte beheeracties verdwijnen. Ze komen via
  // getLoginActivity() in een eigen overzicht.
  //
  // sinceIso/max i.p.v. een vaste .limit(100): de UI beloofde "30 dagen" en
  // "Alles" terwijl de server nooit meer dan 100 rijen gaf — filters en
  // CSV-export logen daarmee stil (en de back-up bevatte max 100 regels).
  //
  // Zelfde redenering voor "Dienstruil bekeken" (de collega kreeg een aanvraag
  // in beeld): een waarneming, geen beheeractie. Ze voedt het verloop van de
  // ruil (getSwapVerloopRegels) en hoort niet als ruis tussen de handelingen
  // op het scherm Activiteit. Alleen de back-up vraagt ze wél mee op.
  const sinceIso = opts?.sinceIso ?? null;
  const max = Math.max(1, opts?.max ?? 100);
  const rows = await paginatedFetch<ActivityLogRow>((from, to) => {
    let q = client
      .from("activity_log")
      .select("*")
      .or("category.neq.auth,and(action.neq.Aangemeld,action.neq.Actief)");
    if (!opts?.metRuilBekeken) q = q.neq("action", RUIL_BEKEKEN_ACTIE);
    q = q
      .order("created_at", { ascending: false })
      .range(from, Math.min(to, max - 1));
    if (sinceIso) q = q.gte("created_at", sinceIso);
    return q;
  }, max);
  return rows.map(toPublicActivityLog);
};

/** Aanwezigheids-events sinds een ISO-tijdstip — voor het overzicht "wie
 *  wanneer + per-dag actieve gebruikers". Omvat zowel echte aanmeldingen
 *  ('Aangemeld') als het dagelijkse sessie-herstel-event ('Actief'), zodat
 *  ook gebruikers met een lopende PWA-sessie meetellen als actief. */
export const getLoginActivity = async (sinceIso: string, limit = 3000): Promise<ActivityLogRecord[]> => {
  const client = requireDb();
  // Gepagineerd, net als getActivityLog: PostgREST kapt élke select op
  // 1.000 rijen, dus .limit(3000) leverde er nooit meer dan 1.000 — de
  // oudste dagen van het aanwezigheidsoverzicht vielen dan stil weg
  // (controle-ronde 27-08, bevinding 24). Fouten gooien i.p.v. [] — een lege
  // lijst is niet te onderscheiden van "niemand meldde zich aan".
  const rows = await paginatedFetch<ActivityLogRow>((from, to) =>
    client
      .from("activity_log")
      .select("*")
      .eq("category", "auth")
      .in("action", ["Aangemeld", "Actief"])
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .range(from, Math.min(to, limit - 1)),
  limit);
  return rows.map(toPublicActivityLog);
};

/** Tijdstip (ISO) van het meest recente auth-event ('Aangemeld' of 'Actief')
 *  van één gebruiker — voor de éénmaal-per-dag-dedup van het 'Actief'-event
 *  bij sessie-herstel. null = nog geen auth-event bekend. */
/** Laatste aanmeldingen van één gebruiker (Instellingen › Beveiliging). */
export const getRecentLogins = async (userId: string, max = 8): Promise<Array<{ at: string; action: string }>> => {
  const client = requireDb();
  const { data, error } = await client
    .from("activity_log")
    .select("created_at, action")
    .eq("category", "auth")
    .in("action", ["Aangemeld", "Actief"])
    .eq("entity_type", "user")
    .eq("entity_id", userId)
    .order("created_at", { ascending: false })
    .limit(max);
  if (error || !data) return [];
  return (data as Array<{ created_at: string; action: string }>).map((r) => ({ at: r.created_at, action: r.action }));
};

export const getLatestAuthEventAt = async (userId: string): Promise<string | null> => {
  const client = requireDb();
  const { data, error } = await client
    .from("activity_log")
    .select("created_at")
    .eq("category", "auth")
    .in("action", ["Aangemeld", "Actief"])
    .eq("entity_type", "user")
    .eq("entity_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error || !data?.length) return null;
  return (data[0] as { created_at: string }).created_at;
};

/** Zoveel id's gaan hoogstens in één `in.(...)`-filter (100 uuid's is ±4 kB querystring). */
export const IN_FILTER_MAX = 100;
export const inStukken = <T,>(lijst: readonly T[], grootte: number): T[][] =>
  Array.from({ length: Math.ceil(lijst.length / grootte) }, (_, i) => lijst.slice(i * grootte, (i + 1) * grootte));

/**
 * Rijen verwijderen op een sleutel, in stukken van IN_FILTER_MAX (01-10). De
 * replace-saves stuurden álle overtollige id's in één `in.(...)`, en dat
 * filter staat in de URL: een herstel dat een mislukte maandimport terugdraait
 * (±600 planning-id's van 40 tekens) strandde daarop, telkens opnieuw, met de
 * upsert al gedaan en de rest van het herstel niet. Serieel, zodat één
 * mislukt stuk de volgende tegenhoudt. `verfijn` zet een extra voorwaarde op
 * elk stuk (het alleenPending-pad van verlof en ruilen).
 */
export const verwijderInStukken = async (
  client: ReturnType<typeof requireDb>, tabel: string, kolom: string, waarden: readonly string[],
  verfijn?: (q: any) => any,
) => {
  for (const stuk of inStukken(waarden, IN_FILTER_MAX)) {
    let q: any = client.from(tabel).delete().in(kolom, stuk);
    if (verfijn) q = verfijn(q);
    const { error } = await q;
    if (error) throw error;
  }
};

/**
 * Lege groepering per ruil-id, zonder prototype (beveiligingsscan 01-10). Het
 * id van een ruil kiest de aanvrager zelf (`RECORD_ID_RE` laat ook
 * `constructor`, `toString` en `__proto__` door). In een gewoon object is
 * `perSwap["constructor"]` de functie Object: `??= []` slaat dan niets op en
 * `.push` gooit, voor elke lezer van elke ruil. Zonder prototype bestaat er
 * alleen wat hier zelf in gezet is.
 */
const perRuilId = <T,>(): Record<string, T[]> => Object.create(null) as Record<string, T[]>;

/** Activiteitenlog van een reeks dienstruilen, oudste eerst — het verloop
 *  dat het weekoverzicht per wissel afdrukt. Eén query i.p.v. één per wissel:
 *  een drukke week telt al snel 20 wissels. Zonder "Dienstruil bekeken": het
 *  blad is een bewijsstuk van wat er gedaan is, niet van wie wanneer keek. */
export const getSwapHistories = async (
  swapIds: string[],
): Promise<Record<string, ActivityLogRecord[]>> => {
  const ids = [...new Set(swapIds.map((id) => String(id)).filter(Boolean))];
  if (ids.length === 0) return perRuilId<ActivityLogRecord>();
  const client = requireDb();
  // In stukken van 100 id's: PostgREST zet `in.(...)` in de querystring, en
  // sinds het overzicht een jaar mag beslaan (rapportgrens) past een drukke
  // periode niet meer in één URL. Per stuk oudste eerst; de groepering per
  // wissel hieronder houdt die volgorde.
  const stukken = await Promise.all(inStukken(ids, IN_FILTER_MAX).map((deel) =>
    paginatedFetch<ActivityLogRow>((from, to) =>
      client
        .from("activity_log")
        .select("*")
        .eq("entity_type", "swap")
        .in("entity_id", deel)
        .neq("action", RUIL_BEKEKEN_ACTIE)
        .order("created_at", { ascending: true })
        .range(from, to),
    deel.length * 40)));
  const rows = stukken.flat();
  const perSwap = perRuilId<ActivityLogRecord>();
  for (const id of ids) perSwap[id] = [];
  for (const row of rows) {
    const entry = toPublicActivityLog(row);
    const id = String(entry.entityId ?? "");
    if (perSwap[id]) perSwap[id].push(entry);
  }
  return perSwap;
};

/** Boven dit aantal ruilen gaat het id-filter niet meer in de URL (PostgREST
 *  zet `in.(...)` in de querystring; 100 uuid's is ±4 kB) en lezen we alle
 *  ruil-logregels in één keer. Dat zijn er enkele per ruil. */
const VERLOOP_ID_FILTER_MAX = 100;

export type SwapVerloopLogRegel = Pick<ActivityLogRecord, "createdAt" | "action" | "actorRole" | "actorName" | "details">;

/**
 * De logregels waaruit het verloop per persoon wordt afgeleid
 * (shared/ruilVerloop.ts), voor ALLE gevraagde ruilen in één query, gegroepeerd
 * per ruil-id en oudste eerst. `swapIds` weglaten = elke ruil (staf). Alleen
 * de kolommen die de afleiding nodig heeft.
 */
export const getSwapVerloopRegels = async (swapIds?: string[]): Promise<Record<string, SwapVerloopLogRegel[]>> => {
  const ids = swapIds ? [...new Set(swapIds.map((id) => String(id)).filter(Boolean))] : null;
  if (ids && ids.length === 0) return perRuilId<SwapVerloopLogRegel>();
  const metFilter = !!ids && ids.length <= VERLOOP_ID_FILTER_MAX;
  const client = requireDb();
  type Rij = Pick<ActivityLogRow, "id" | "created_at" | "action" | "actor_role" | "actor_name" | "details" | "entity_id">;
  const rows = await paginatedFetch<Rij>((from, to) => {
    let q = client
      .from("activity_log")
      .select("id, created_at, action, actor_role, actor_name, details, entity_id")
      .eq("entity_type", "swap");
    if (metFilter) q = q.in("entity_id", ids!);
    // Unieke sortering (created_at + id), anders kan een paginagrens een regel
    // overslaan of dubbel geven.
    return q.order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to);
  });
  const gevraagd = ids ? new Set(ids) : null;
  const perSwap = perRuilId<SwapVerloopLogRegel>();
  for (const row of rows) {
    const id = String(row.entity_id ?? "");
    if (!id || (gevraagd && !gevraagd.has(id))) continue;
    (perSwap[id] ??= []).push({
      createdAt: row.created_at,
      action: row.action,
      actorRole: row.actor_role,
      actorName: row.actor_name,
      details: row.details,
    });
  }
  return perSwap;
};

/** Log-regels die een dienstwissel écht doorvoeren, binnen [vanIso, totIso).
 *  Dit is het antwoord op "welke wissels zijn die week uitgevoerd": niet de
 *  wissels die díe week in de planning stonden, maar de wissels die in dat
 *  venster in het portaal zijn doorgevoerd — goedkeuring van een ruil én de
 *  handmatige wissels van de planning. Oudste eerst (chronologisch, zoals het
 *  klassement ze wil). */
export const getSwapExecutions = async (
  vanIso: string,
  totIso: string,
  acties: string[],
): Promise<ActivityLogRecord[]> => {
  const client = requireDb();
  const rows = await paginatedFetch<ActivityLogRow>((from, to) =>
    client
      .from("activity_log")
      .select("*")
      .eq("entity_type", "swap")
      .in("action", acties)
      .gte("created_at", vanIso)
      .lt("created_at", totIso)
      .order("created_at", { ascending: true })
      .range(from, to),
  // Vangnet, geen verwachting: het venster is hoogstens 366 dagen en VHB voert
  // enkele wissels per week door.
  5000);
  return rows.map(toPublicActivityLog);
};

/**
 * Per-entity geschiedenis: alle activity-log entries voor één specifieke
 * entity (bv. één service, één swap). Wordt gebruikt door de "Geschiedenis"-
 * modal vanuit admin-views.
 */
export const getEntityHistory = async (
  entityType: NonNullable<ActivityLogRecord["entityType"]>,
  entityId: string,
): Promise<ActivityLogRecord[]> => {
  const client = requireDb();
  const { data, error } = await client
    .from("activity_log")
    .select("*")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return ((data ?? []) as ActivityLogRow[]).map(toPublicActivityLog);
};

export const saveActivityLogEntry = async (entry: ActivityLogRecord) => {
  const client = requireDb();
  const row: ActivityLogRow = {
    id: entry.id,
    created_at: entry.createdAt,
    actor_name: entry.actorName,
    actor_role: entry.actorRole,
    category: entry.category,
    action: entry.action,
    details: entry.details,
    entity_type: entry.entityType ?? null,
    entity_id: entry.entityId ?? null,
  };
  const { error } = await client.from("activity_log").insert(row);
  if (error) console.error("Supabase error saving activity log:", error);
};

export const logActivity = async (
  req: AuthenticatedRequest,
  category: ActivityLogRecord["category"],
  action: string,
  details: string,
  entity?: { type: NonNullable<ActivityLogRecord["entityType"]>; id: string },
) => {
  if (!req.appUser) return;

  await saveActivityLogEntry({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    actorName: req.appUser.name,
    actorRole: req.appUser.role,
    category,
    action,
    details,
    entityType: entity?.type ?? null,
    entityId: entity?.id ?? null,
  });
};

// --- Aanwezigheid (wie was wanneer actief op het portaal) ---

/** Eén aaneengesloten periode waarin iemand het portaal in de voorgrond had. */
export type AanwezigheidSessie = {
  userId: string;
  rol: string | null;
  /** ISO-tijdstip waarop deze sessie begon. */
  van: string;
  /** ISO-tijdstip van het laatste teken van leven in deze sessie. */
  tot: string;
  /** Plaats van aanmelden (2026-09-20_user_presence_locatie.sql), afgeleid
   *  van het IP-adres; null = onbekend (lokaal, oude rij, migratie mist). */
  land: string | null;
  regio: string | null;
  stad: string | null;
  /** false = de rij heeft de plaatskolommen niet: de migratie moet nog. */
  locatieBekend: boolean;
};

const tekstOfNull = (w: unknown): string | null => (typeof w === 'string' && w.trim() ? w : null);

const toPublicAanwezigheid = (row: Record<string, unknown>): AanwezigheidSessie => ({
  userId: String(row.user_id ?? ''),
  rol: (row.role as string | null) ?? null,
  van: String(row.started_at ?? ''),
  tot: String(row.last_seen_at ?? ''),
  land: tekstOfNull(row.land),
  regio: tekstOfNull(row.regio),
  stad: tekstOfNull(row.stad),
  // select('*') levert de sleutel alleen wanneer de kolom bestaat.
  locatieBekend: 'land' in row,
});

// Per warme lambda onthouden dat de plaatskolommen ontbreken (zelfde patroon
// als clientErrorsUitgebreid), maar met een
// houdbaarheid: een instantie kan uren warm blijven, en Jarno draait de
// migratie wanneer het hem past. Na dit venster probeert ze het opnieuw, zodat
// de plaats vanzelf begint te lopen zonder nieuwe deploy. Kost in de tussentijd
// één mislukte schrijfactie per instantie per venster.
const LOCATIE_HERKANS_MS = 10 * 60 * 1000;
let presenceLocatieMistSinds: number | null = null;

/** Alleen voor tests: de onthouden kolomstand vergeten. */
export const vergeetPresenceLocatie = () => { presenceLocatieMistSinds = null; };

/**
 * Eén schrijfactie op user_presence, eerst mét en zo nodig zonder de plaats.
 *
 * De plaats is bijzaak, de aanwezigheid is de waarneming: wát er ook misgaat
 * met de plaatskolommen (migratie nog niet gedraaid, een waarde die de
 * check-constraint weigert), dezelfde schrijfactie gaat meteen opnieuw zonder
 * plaats. Alleen een ontbrekende kolom wordt onthouden; elke andere fout kan
 * aan die ene waarde liggen en mag de volgende poging niet uitschakelen.
 */
const schrijfMetLocatie = async (
  locatie: AanwezigheidLocatie | null | undefined,
  schrijf: (plaats: Record<string, string | null>) => PromiseLike<{ error: unknown }>,
): Promise<void> => {
  const kolommenMissen = presenceLocatieMistSinds !== null && Date.now() - presenceLocatieMistSinds < LOCATIE_HERKANS_MS;
  if (locatie && !kolommenMissen) {
    const { error } = await schrijf({ land: locatie.land, regio: locatie.regio, stad: locatie.stad });
    if (!error) {
      presenceLocatieMistSinds = null;
      return;
    }
    if (isMissingColumnError(error)) presenceLocatieMistSinds = Date.now();
  }
  const { error } = await schrijf({});
  if (error) throw error;
};

/**
 * Teken van leven van één gebruiker vastleggen: de lopende sessie oprekken,
 * of er een nieuwe beginnen als het langer dan SESSIE_GAT_MS stil was.
 *
 * Best-effort en bewust stil: de aanroeper (auth-middleware) doet dit
 * fire-and-forget, dus een mislukking mag nooit een request raken. Ontbreekt
 * de tabel (migratie niet gedraaid), dan gebeurt er simpelweg niets.
 *
 * Twee queries, maar hoogstens één keer per gebruiker per 5 minuten: de rem
 * zit in magSchrijven() vóór deze functie wordt aangeroepen.
 *
 * `locatie` (stad, regio, land uit de Vercel-headers) reist mee op dezelfde
 * schrijfactie. Bestaan de kolommen nog niet, dan valt de schrijfactie stil
 * terug op het gedrag van vóór 20-09; zie schrijfMetLocatie.
 */
export const noteerAanwezigheid = async (
  userId: string,
  rol: string | null,
  opties: { nu?: Date; locatie?: AanwezigheidLocatie | null } = {},
): Promise<void> => {
  const client = requireDb();
  const nu = opties.nu ?? new Date();
  const { locatie } = opties;
  const nuIso = nu.toISOString();
  const { data, error } = await client
    .from('user_presence')
    .select('id, last_seen_at')
    .eq('user_id', String(userId))
    .order('last_seen_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const jongste = (data ?? [])[0] as { id: string; last_seen_at: string } | undefined;
  if (jongste && hoortBijSessie(jongste.last_seen_at, nu.getTime())) {
    // De plaats gaat mee in dezelfde update: wisselt iemand binnen een sessie
    // van netwerk, dan wint de laatste waarde. Zonder plaats (null) blijft
    // staan wat er stond; een ontbrekende header wist niets.
    await schrijfMetLocatie(locatie, (plaats) => client
      .from('user_presence')
      .update({ last_seen_at: nuIso, role: rol, ...plaats })
      .eq('id', jongste.id));
    return;
  }
  await schrijfMetLocatie(locatie, (plaats) => client
    .from('user_presence')
    .insert({ user_id: String(userId), role: rol, started_at: nuIso, last_seen_at: nuIso, ...plaats }));
};

/**
 * Alle sessies die ná `sinceIso` nog liepen, nieuwste eerst. Gepagineerd om
 * dezelfde reden als het auditlogboek: PostgREST kapt elke select op 1.000
 * rijen, en bij enkele tientallen sessies per dag zit een maand daar dicht bij.
 *
 * Gooit bij een échte fout (een lege lijst is niet te onderscheiden van
 * "niemand was actief"); de route vangt een ontbrekende tabel apart af en
 * meldt dan welke migratie nog moet draaien.
 */
export const getAanwezigheid = async (sinceIso: string, limit = 5000): Promise<AanwezigheidSessie[]> => {
  const client = requireDb();
  const rows = await paginatedFetch<Record<string, unknown>>((from, to) =>
    client
      .from('user_presence')
      .select('*')
      .gte('last_seen_at', sinceIso)
      .order('last_seen_at', { ascending: false })
      .range(from, Math.min(to, limit - 1)),
  limit);
  return rows.map(toPublicAanwezigheid);
};
