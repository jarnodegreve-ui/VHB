import webpush from "web-push";
import { db } from "./db.js";

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

export const isPushConfigured = () => ensureConfigured();

export const getVapidPublicKey = () => (ensureConfigured() ? process.env.VAPID_PUBLIC_KEY ?? null : null);

export type PushSubscriptionRecord = {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

export const savePushSubscription = async (record: PushSubscriptionRecord) => {
  if (!db) throw new Error("Database niet geconfigureerd.");
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
};

/**
 * Stuurt een notificatie naar alle abonnementen van de gegeven gebruikers.
 * Best-effort en nooit blokkerend voor de hoofdflow: fouten worden gelogd,
 * verlopen abonnementen (404/410) worden opgeruimd.
 */
export const sendPushToUsers = async (userIds: string[], payload: PushPayload): Promise<void> => {
  if (!ensureConfigured()) return;
  const subscriptions = await getSubscriptionsForUsers(userIds);
  if (subscriptions.length === 0) return;

  const body = JSON.stringify(payload);
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
