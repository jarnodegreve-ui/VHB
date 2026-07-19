/**
 * Toestel-identiteit voor de toestel-whitelist. Elk toestel (browser-install)
 * krijgt één blijvend willekeurig token in localStorage; de server koppelt
 * dat aan de gebruiker en bepaalt approved/pending/revoked. Zie
 * supabase/user_devices.sql + api/middleware.ts.
 *
 * LET OP (iOS): Safari en de op het beginscherm geïnstalleerde PWA hebben elk
 * hun eigen localStorage-container, dus dat zijn twee aparte "toestellen" (elk
 * eigen token → elk eigen goedkeuring). Wie eerst in Safari inlogt en daarna
 * installeert, moet de app-versie apart laten goedkeuren. De geïnstalleerde
 * PWA is vrij van ITP-storage-eviction; een gewone Safari-tab kan het token na
 * ~7 dagen niet-gebruiken kwijtraken (dan opnieuw pending).
 */

const STORAGE_KEY = 'vhb-device-token';

// Fallback wanneer localStorage geblokkeerd is (strikte privacy-modus):
// token leeft dan alleen deze tab — elke sessie een "nieuw" toestel, maar
// de app blijft werken.
let inMemoryToken: string | null = null;

export function getDeviceToken(): string {
  try {
    const existing = window.localStorage.getItem(STORAGE_KEY);
    if (existing) return existing;
    const token = crypto.randomUUID();
    window.localStorage.setItem(STORAGE_KEY, token);
    return token;
  } catch {
    if (!inMemoryToken) inMemoryToken = crypto.randomUUID();
    return inMemoryToken;
  }
}

/** Header-object om mee te spreiden in fetch-headers. */
export function deviceHeaders(): Record<string, string> {
  try {
    return { 'X-Device-Token': getDeviceToken() };
  } catch {
    return {};
  }
}

/** Leesbare toestelnaam uit de user agent, bv. "iPhone · app" — de admin kan
 *  hem in het beheerscherm hernoemen. */
export function deriveDeviceName(): string {
  const ua = navigator.userAgent;
  const platform = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? 'Android'
        : /Macintosh/.test(ua)
          ? 'Mac'
          : /Windows/.test(ua)
            ? 'Windows-pc'
            : 'Toestel';
  const standalone =
    window.matchMedia?.('(display-mode: standalone)')?.matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;
  return standalone ? `${platform} · app` : `${platform} · browser`;
}
