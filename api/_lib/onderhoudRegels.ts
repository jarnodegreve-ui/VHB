import type { Role } from "../types.js";
import type { Onderhoud } from "../../shared/schemas/onderhoud.js";

/**
 * Onderhoudsmodus: pure beslissingslogica, zonder db/express, zodat ze los
 * te unit-testen is (src/onderhoud.test.ts). De wiring (cache op
 * app_settings, middleware, routes) staat in onderhoud.ts, middleware.ts en
 * onderhoudRoutes.ts.
 */

export const ONDERHOUD_SETTING_KEY = "onderhoud";

/** Antwoord van de API zolang het schrijfblok aan staat (503). */
export const ONDERHOUD_FOUT = {
  error: "Het portaal is even in onderhoud, probeer het zo opnieuw.",
  code: "onderhoud",
} as const;

const SCHRIJF_METHODES = new Set(["POST", "PUT", "PATCH", "DELETE"]);
export const isSchrijfmethode = (method: string): boolean => SCHRIJF_METHODES.has(String(method ?? "").toUpperCase());

/**
 * Paden die tijdens een schrijfblok open blijven: sessie-boekhouding en
 * wachtwoordflow (/api/auth/**), toestelregistratie (anders raakt een nieuw
 * toestel nooit voorbij het wachtscherm) en de foutrapportage (die juist
 * tijdens onderhoud moet binnenkomen). Eigen voorkeuren (/api/me/…) worden
 * bewust wél geblokkeerd: eenvoud boven een lange uitzonderingenlijst.
 */
export const SCHRIJFBLOK_UITZONDERINGEN: readonly string[] = ["/api/auth/", "/api/devices/register", "/api/client-errors", "/api/csp-report"];
export const isSchrijfblokUitzondering = (path: string): boolean =>
  SCHRIJFBLOK_UITZONDERINGEN.some((p) => (p.endsWith("/") ? path.startsWith(p) : path === p));

/** Verlopen `tot` = onderhoud voorbij, ook als niemand de schakelaar omzette. */
export const effectiefOnderhoud = (onderhoud: Onderhoud, nu: number = Date.now()): Onderhoud => {
  if (!onderhoud.actief || !onderhoud.tot) return onderhoud;
  const einde = Date.parse(onderhoud.tot);
  return Number.isFinite(einde) && einde <= nu ? { ...onderhoud, actief: false } : onderhoud;
};

/**
 * Blokkeert het schrijfblok dit verzoek? Alleen schrijfmethodes van
 * niet-admins buiten de uitzonderingen, en alleen zolang het onderhoud
 * actief is mét schrijfblok. Admins kunnen altijd door, anders zetten ze
 * de modus nooit meer uit.
 */
export const beslisSchrijfblok = (i: { method: string; path: string; role: Role | null | undefined; onderhoud: Onderhoud; nu?: number }): boolean => {
  const o = effectiefOnderhoud(i.onderhoud, i.nu);
  if (!o.actief || !o.schrijfblok) return false;
  if (i.role === "admin") return false;
  if (!isSchrijfmethode(i.method)) return false;
  return !isSchrijfblokUitzondering(i.path);
};
