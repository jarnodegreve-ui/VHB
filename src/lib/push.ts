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
    const res = await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders },
      body: JSON.stringify(subscription.toJSON()),
    });
    if (!res.ok) {
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
  // Server-registratie ook opruimen (best-effort).
  void fetch('/api/push/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {});
  return ok;
};
