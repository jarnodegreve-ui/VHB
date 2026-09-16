import webpush from "web-push";
import { db } from "./db.js";
import type { MeldingSoort } from "../shared/schemas/meldingen.js";
import { filterPushOntvangers } from "../shared/schemas/dashboardVoorkeuren.js";
import { meldingUitPayload } from "./_lib/meldingen.js";
import { bewaarMeldingen } from "./storage.js";

/**
 * Web-push notificaties. Volledig optioneel: zonder de drie VAPID env-vars
 * (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT) doet dit niets en
 * meldt de API aan de client dat push uitstaat. Abonnementen leven in de
 * `push_subscriptions`-tabel (zie SQL in de PR); zonder tabel werkt
 * abonneren niet maar breekt er ook niets.
 */

let vapidConfigured = false;

const ensureConfigured = () => {
  if (vapidConfigured) return true;
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT || "mailto:info@vanhoorebeke.be";
  if (!publicKey || !privateKey) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  vapidConfigured = true;
  return true;
};

export const getVapidPublicKey = () => (ensureConfigured() ? process.env.VAPID_PUBLIC_KEY ?? null : null);

export type PushSubscriptionRecord = {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

/** Plafond per gebruiker (controle-ronde 16-09, nr. 18): een browser maakt bij
 *  elke herinstallatie/SW-vernieuwing een nieuw endpoint, en de oude worden
 *  pas opgeruimd als een push er 404/410 op krijgt. Zonder plafond kon één
 *  account de tabel onbeperkt laten groeien. Toestellen weigeren met 429
 *  (MAX_DEVICES_PER_USER, de gebruiker kan er zelf een verwijderen); een
 *  push-abonnement kan de gebruiker niet zelf beheren, dus hier vervalt het
 *  oudste. */
export const MAX_PUSH_ABONNEMENTEN_PER_USER = 10;

export const savePushSubscription = async (record: PushSubscriptionRecord) => {
  if (!db) throw new Error("Database niet geconfigureerd.");
  // Expliciete handoff op een gedeeld toestel: eerst een eventuele registratie
  // van een ánder account op ditzelfde endpoint verwijderen, dán pas de eigen
  // registratie opslaan — zo hangt één endpoint nooit stil aan het verkeerde
  // account (i.p.v. een blinde upsert die de user_id herwees).
  await db.from("push_subscriptions").delete().eq("endpoint", record.endpoint).neq("user_id", record.userId);
  const { error } = await db.from("push_subscriptions").upsert(
    {
      user_id: record.userId,
      endpoint: record.endpoint,
      p256dh: record.p256dh,
      auth: record.auth,
    },
    { onConflict: "endpoint" },
  );
  if (error) throw new Error(`Abonnement opslaan mislukt: ${error.message}`);
  await snoeiPushAbonnementen(record.userId);
};

/** Houdt hooguit MAX_PUSH_ABONNEMENTEN_PER_USER abonnementen per gebruiker
 *  over: de oudste (created_at) gaan weg. Geeft het aantal gewiste rijen. */
export const snoeiPushAbonnementen = async (userId: string): Promise<number> => {
  if (!db) return 0;
  const { data, error } = await db
    .from("push_subscriptions")
    .select("endpoint")
    .eq("user_id", String(userId))
    .order("created_at", { ascending: false });
  if (error || !data) return 0;
  const teVeel = (data as Array<{ endpoint: string }>).slice(MAX_PUSH_ABONNEMENTEN_PER_USER).map((r) => r.endpoint);
  if (teVeel.length === 0) return 0;
  const { error: wisFout } = await db.from("push_subscriptions").delete().eq("user_id", String(userId)).in("endpoint", teVeel);
  if (wisFout) throw new Error(`Oude push-abonnementen opruimen mislukt: ${wisFout.message}`);
  return teVeel.length;
};

export const deletePushSubscription = async (endpoint: string) => {
  if (!db) return;
  await db.from("push_subscriptions").delete().eq("endpoint", endpoint);
};

/** Verwijdert een abonnement alleen als het van de gegeven gebruiker is —
 *  voor de publieke unsubscribe-route (voorkomt dat iemand andermans
 *  endpoint kan afmelden). De user-agnostische variant blijft voor de
 *  interne 404/410-opruiming in sendPushToUsers. */
export const deletePushSubscriptionForUser = async (endpoint: string, userId: string) => {
  if (!db) return;
  await db.from("push_subscriptions").delete().eq("endpoint", endpoint).eq("user_id", String(userId));
};

/** Álle abonnementen van één gebruiker wissen (uitdienst-flow): een
 *  gedeactiveerd account mag geen pushes meer krijgen, ook niet van de
 *  digest-cron. Geeft het aantal gewiste rijen terug. */
export const deletePushSubscriptionsForUser = async (userId: string): Promise<number> => {
  if (!db) return 0;
  const { data, error } = await db.from("push_subscriptions").delete().eq("user_id", String(userId)).select("endpoint");
  if (error) throw new Error(`Push-abonnementen wissen mislukt: ${error.message}`);
  return (data ?? []).length;
};

/** Wie heeft er meldingen aanstaan? Alleen gebruikers-ids — geen endpoints of
 *  sleutels, want dit voedt enkel een badge in Gebruikersbeheer. Nodig bij de
 *  uitrol: zonder dit overzicht is niet te zien wie de meldingen die de app
 *  verstuurt überhaupt kán ontvangen. */
export const getUsersMetPush = async (): Promise<string[]> => {
  if (!db) return [];
  const { data, error } = await db.from("push_subscriptions").select("user_id");
  if (error) return [];
  return [...new Set((data ?? []).map((r: any) => String(r.user_id)))];
};

/**
 * Meldingsvoorkeuren van de ontvangers (users.dashboardvoorkeuren, jsonb):
 * één select, id → ruwe jsonb. Fout of ontbrekende kolom (migratie
 * 2026-09-06_meldingen.sql nog niet gedraaid) = lege kaart, en dan krijgt
 * iedereen de push zoals voorheen; filteren is nooit een reden om niets te
 * sturen. De pure regel zelf staat in shared/schemas/dashboardVoorkeuren.ts
 * (`pushSoortToegestaan`, getest in dashboardVoorkeuren.test.ts).
 */
const getVoorkeurenVoorUsers = async (userIds: string[]): Promise<Map<string, unknown>> => {
  const kaart = new Map<string, unknown>();
  if (!db || userIds.length === 0) return kaart;
  const { data, error } = await db.from("users").select("id, dashboardvoorkeuren").in("id", userIds.map(String));
  if (error) return kaart;
  for (const r of (data ?? []) as Array<{ id: string | number; dashboardvoorkeuren: unknown }>) kaart.set(String(r.id), r.dashboardvoorkeuren);
  return kaart;
};

const getSubscriptionsForUsers = async (userIds: string[]): Promise<Array<{ endpoint: string; p256dh: string; auth: string }>> => {
  if (!db || userIds.length === 0) return [];
  const { data, error } = await db
    .from("push_subscriptions")
    .select("endpoint, p256dh, auth")
    .in("user_id", userIds.map(String));
  if (error) return [];
  return data ?? [];
};

export type PushPayload = {
  title: string;
  body: string;
  /** Relatief pad waar een klik op de notificatie heen navigeert. */
  url?: string;
  /** Filterchip in het meldingencentrum; zonder: afgeleid uit `url`
   *  (api/_lib/meldingen.ts). */
  soort?: MeldingSoort;
  /** Pad in de app voor de melding-rij; zonder: afgeleid uit `url`. */
  doel?: string;
};

let meldingFoutGemeld = false;

/** Socket-timeout voor één push-aanroep (web-push `timeout`-optie). */
export const PUSH_TIMEOUT_MS = 5_000;
/** Harde deadline op de hele aanroep, ook als het endpoint blijft druppelen. */
export const PUSH_DEADLINE_MS = 8_000;

/** Wacht hooguit `ms` op `p`; daarna een fout, de onderliggende request loopt
 *  door maar houdt de aanroeper niet meer vast. */
export const metDeadline = <T,>(p: Promise<T>, ms: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`push-deadline (${ms} ms) verstreken`)), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });

/**
 * Stuurt een notificatie naar alle abonnementen van de gegeven gebruikers —
 * en bewaart de melding eerst per gebruiker in public.meldingen (het
 * meldingencentrum in de app), óók voor wie geen push-abonnement heeft: de
 * melding is de bron, push is het kanaal.
 * Best-effort en nooit blokkerend voor de hoofdflow: fouten worden gelogd,
 * verlopen abonnementen (404/410) worden opgeruimd.
 *
 * Meldingsvoorkeuren (punt 15, 15-09): wie een soort in Instellingen heeft
 * uitgezet (users.dashboardvoorkeuren.meldingssoortenUit) krijgt voor die
 * soort géén push, maar de rij in public.meldingen wordt altijd bewaard: de
 * melding is de bron, alleen het kanaal filtert. 'systeem' is niet uit te
 * zetten; een push zonder expliciete soort krijgt de soort die ook de
 * melding-rij krijgt (afgeleid uit de deeplink).
 */
export const sendPushToUsers = async (userIds: string[], payload: PushPayload): Promise<void> => {
  const ontvangers = [...new Set(userIds.map(String).filter(Boolean))];
  if (ontvangers.length === 0) return;

  const melding = meldingUitPayload(payload);
  try {
    await bewaarMeldingen(ontvangers, melding);
  } catch (err: any) {
    // Vóór migratie 2026-09-06_meldingen.sql bestaat de tabel niet: één keer
    // melden, verder stil — de push zelf gaat gewoon door.
    if (!meldingFoutGemeld) {
      meldingFoutGemeld = true;
      console.error("[meldingen] bewaren mislukt (migratie 2026-09-06_meldingen.sql gedraaid?):", err?.message ?? err);
    }
  }

  if (!ensureConfigured()) return;
  const pushOntvangers = filterPushOntvangers(ontvangers, await getVoorkeurenVoorUsers(ontvangers), melding.soort);
  if (pushOntvangers.length === 0) return;
  const subscriptions = await getSubscriptionsForUsers(pushOntvangers);
  if (subscriptions.length === 0) return;

  // De client-SW kent alleen title/body/url; soort/doel blijven server-side.
  const body = JSON.stringify({ title: payload.title, body: payload.body, url: payload.url });
  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        // Het endpoint is door de gebruiker gekozen (elke publieke https-host
        // passeert de subscribe-check). Zonder deadline hield één traag of
        // eindeloos antwoordend endpoint de hele hoofdactie (verlofbeslissing,
        // ruil) vast tot de Vercel-limiet. Socket-timeout in web-push plus een
        // harde deadline op de await (security-audit 07-09, bevinding 3).
        await metDeadline(
          webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            body,
            { timeout: PUSH_TIMEOUT_MS },
          ),
          PUSH_DEADLINE_MS,
        );
      } catch (err: any) {
        const status = err?.statusCode;
        if (status === 404 || status === 410) {
          await deletePushSubscription(sub.endpoint);
        } else {
          console.warn("Push verzenden mislukt:", status ?? err?.message ?? err);
        }
      }
    }),
  );
};
