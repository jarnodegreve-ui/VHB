import { getAppSetting } from "../storage.js";
import { GEEN_ONDERHOUD, parseOnderhoud, type Onderhoud } from "../../shared/schemas/onderhoud.js";
import { effectiefOnderhoud, ONDERHOUD_SETTING_KEY } from "./onderhoudRegels.js";

/**
 * Onderhoudsinstelling uit app_settings, kort gecacht (30 s, zoals de
 * toestel-gate in middleware.ts): de middleware raadpleegt hem bij elke
 * schrijfactie van een niet-admin en de schil pollt hem, dus geen query per
 * request. Default bij ontbrekende tabel/rij/fout = géén onderhoud: de
 * modus mag het portaal nooit per ongeluk op slot zetten.
 */
let cache: { value: Onderhoud; at: number } | null = null;
export const getOnderhoud = async (): Promise<Onderhoud> => {
  if (cache && Date.now() - cache.at < 30_000) return effectiefOnderhoud(cache.value);
  let value: Onderhoud = GEEN_ONDERHOUD;
  try {
    value = parseOnderhoud(await getAppSetting(ONDERHOUD_SETTING_KEY));
  } catch {
    value = GEEN_ONDERHOUD;
  }
  cache = { value, at: Date.now() };
  return effectiefOnderhoud(value);
};
/** Na een wijziging via de API meteen de nieuwe waarde laten gelden. */
export const invalidateOnderhoudCache = () => { cache = null; };
