import webpush from "web-push";
import { db } from "./db.js";
import type { MeldingSoort } from "../shared/schemas/meldingen.js";
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

/**
 * Stuurt een notificatie naar alle abonnementen van de gegeven gebruikers —
 * en bewaart de melding eerst per gebruiker in public.meldingen (het
 * meldingencentrum in de app), óók voor wie geen push-abonnement heeft: de
 * melding is de bron, push is het kanaal.
 * Best-effort en nooit blokkerend voor de hoofdflow: fouten worden gelogd,
 * verlopen abonnementen (404/410) worden opgeruimd.
 */
export const sendPushToUsers = async (userIds: string[], payload: PushPayload): Promise<void> => {
  const ontvangers = [...new Set(userIds.map(String).filter(Boolean))];
  if (ontvangers.length === 0) return;

  try {
    await bewaarMeldingen(ontvangers, meldingUitPayload(payload));
  } catch (err: any) {
    // Vóór migratie 2026-09-06_meldingen.sql bestaat de tabel niet: één keer
    // melden, verder stil — de push zelf gaat gewoon door.
    if (!meldingFoutGemeld) {
      meldingFoutGemeld = true;
      console.error("[meldingen] bewaren mislukt (migratie 2026-09-06_meldingen.sql gedraaid?):", err?.message ?? err);
    }
  }

  if (!ensureConfigured()) return;
  const subscriptions = await getSubscriptionsForUsers(ontvangers);
  if (subscriptions.length === 0) return;

  // De client-SW kent alleen title/body/url; soort/doel blijven server-side.
  const body = JSON.stringify({ title: payload.title, body: payload.body, url: payload.url });
  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body,
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
