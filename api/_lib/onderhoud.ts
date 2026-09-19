import { getAppSetting } from "../storage.js";
import { GEEN_ONDERHOUD, parseOnderhoud, type Onderhoud } from "../../shared/schemas/onderhoud.js";
import { effectiefOnderhoud, ONDERHOUD_SETTING_KEY } from "./onderhoudRegels.js";
import { bijUsersCacheWissel, epochStand, invalidateUsersCache } from "../userCache.js";
import { maakSwrCache, SWR_STALE_MS } from "./swrCache.js";

/**
 * Onderhoudsinstelling uit app_settings, kort gecacht (30 s, zoals de
 * toestel-gate in middleware.ts): de middleware raadpleegt hem bij elke
 * schrijfactie van een niet-admin en de schil pollt hem, dus geen query per
 * request. Default bij ontbrekende tabel/rij/fout = géén onderhoud: de
 * modus mag het portaal nooit per ongeluk op slot zetten.
 *
 * Sinds ronde 3 (19-09) stale-while-revalidate: na de TTL krijgt het request
 * de oude waarde (max. 5 min oud) en loopt de verversing op de achtergrond,
 * maar alleen zolang de gedeelde epoch nét geverifieerd en ongewijzigd is
 * (zie swrCache.ts). Een wijziging via de API verhoogt die epoch, dus het
 * omzetten van de modus wordt er niet trager door, integendeel.
 */
const cache = maakSwrCache<Onderhoud>(
  async () => {
    try {
      return parseOnderhoud(await getAppSetting(ONDERHOUD_SETTING_KEY));
    } catch {
      return GEEN_ONDERHOUD;
    }
  },
  { ttlMs: 30_000, staleMs: SWR_STALE_MS, epoch: epochStand },
);
export const getOnderhoud = async (): Promise<Onderhoud> => effectiefOnderhoud(await cache.get());
/** Alleen de lokale cache wissen (tests, epoch-wissel). */
export const invalidateOnderhoudCache = () => { cache.invalidate(); };
// Een epoch-wissel (elders omgezet) wist ook deze cache.
bijUsersCacheWissel(invalidateOnderhoudCache);
/** Na een wijziging via de API: lokaal meteen de nieuwe waarde, en de
 *  gedeelde epoch omhoog zodat de andere instanties binnen ±2 s volgen
 *  (vroeger pas na hun TTL van 30 s). */
export const meldOnderhoudWijziging = () => {
  invalidateOnderhoudCache();
  invalidateUsersCache();
};
