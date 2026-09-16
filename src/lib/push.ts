/**
 * Client-kant van push-notificaties. De server bepaalt of push aanstaat
 * (VAPID-keys geconfigureerd); zonder keys geeft /api/push/public-key null
 * en verbergt de UI de meldingen-knop.
 */

const base64ToUint8Array = (base64: string) => {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(normalized);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
};

export const isPushSupported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

const getRegistration = async () => {
  const registration = await navigator.serviceWorker.getRegistration();
  return registration ?? (await navigator.serviceWorker.ready);
};

/** Haalt de VAPID public key op; null betekent: push staat serverzijde uit. */
export const fetchPushPublicKey = async (authHeaders: Record<string, string>): Promise<string | null> => {
  try {
    const res = await fetch('/api/push/public-key', { headers: authHeaders });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.publicKey ?? null;
  } catch {
    return null;
  }
};

export const getExistingSubscription = async (): Promise<PushSubscription | null> => {
  if (!isPushSupported()) return null;
  try {
    const registration = await getRegistration();
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
};

/** localStorage-stempel van de laatste geslaagde registratie: `{ endpoint, at }`. */
export const PUSH_SYNC_KEY = 'vhb-push-sync';
const HERSYNC_INTERVAL_MS = 24 * 60 * 60 * 1000;

/**
 * Moet het abonnement (opnieuw) naar de server? Ja zonder stempel, bij een
 * ander endpoint (de push-service verving het abonnement terwijl de app
 * dicht was) of als de stempel ouder is dan 24 u. Zo komt een rij die de
 * server na een 410 opruimde vanzelf terug, zonder elke start te posten.
 */
export const moetPushHersyncen = (stempel: string | null, endpoint: string, nu: number): boolean => {
  if (!stempel) return true;
  try {
    const { endpoint: vorige, at } = JSON.parse(stempel) as { endpoint?: unknown; at?: unknown };
    if (vorige !== endpoint || typeof at !== 'number') return true;
    return nu - at >= HERSYNC_INTERVAL_MS;
  } catch {
    return true;
  }
};

const leesStempel = (): string | null => {
  try {
    return window.localStorage.getItem(PUSH_SYNC_KEY);
  } catch {
    return null;
  }
};

const schrijfStempel = (endpoint: string | null) => {
  try {
    if (endpoint) window.localStorage.setItem(PUSH_SYNC_KEY, JSON.stringify({ endpoint, at: Date.now() }));
    else window.localStorage.removeItem(PUSH_SYNC_KEY);
  } catch {
    // opslag geblokkeerd: dan hooguit één post per start
  }
};

const registreerOpServer = async (subscription: PushSubscriptionJSON, authHeaders: Record<string, string>): Promise<boolean> => {
  const res = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify(subscription),
  });
  if (res.ok && subscription.endpoint) schrijfStempel(subscription.endpoint);
  return res.ok;
};

/**
 * Bestaand abonnement opnieuw bij de server registreren: bij de start
 * (throttled via de stempel) en meteen (`force`) als de service worker een
 * PUSH_SUBSCRIPTION_CHANGED-bericht stuurt. Best-effort: false = niet
 * gedaan of mislukt.
 */
export const hersyncPushSubscription = async (
  subscription: PushSubscription | PushSubscriptionJSON,
  authHeaders: Record<string, string>,
  opties: { force?: boolean } = {},
): Promise<boolean> => {
  const json = 'toJSON' in subscription && typeof subscription.toJSON === 'function' ? subscription.toJSON() : (subscription as PushSubscriptionJSON);
  if (!json.endpoint) return false;
  if (!opties.force && !moetPushHersyncen(leesStempel(), json.endpoint, Date.now())) return false;
  try {
    return await registreerOpServer(json, authHeaders);
  } catch {
    return false;
  }
};

export type SubscribeResult = 'subscribed' | 'denied' | 'unsupported' | 'failed';

export const subscribeToPush = async (publicKey: string, authHeaders: Record<string, string>): Promise<SubscribeResult> => {
  if (!isPushSupported()) return 'unsupported';
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  try {
    const registration = await getRegistration();
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64ToUint8Array(publicKey),
    });
    if (!(await registreerOpServer(subscription.toJSON(), authHeaders))) {
      await subscription.unsubscribe().catch(() => {});
      return 'failed';
    }
    return 'subscribed';
  } catch {
    return 'failed';
  }
};

export const unsubscribeFromPush = async (authHeaders: Record<string, string>): Promise<boolean> => {
  const subscription = await getExistingSubscription();
  if (!subscription) return true;
  const endpoint = subscription.endpoint;
  const ok = await subscription.unsubscribe().catch(() => false);
  schrijfStempel(null);
  // Server-registratie ook opruimen (best-effort).
  void fetch('/api/push/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {});
  return ok;
};
