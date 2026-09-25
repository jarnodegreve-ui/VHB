import { getAppSetting } from "../storage.js";
import { isMailAan, MAIL_INSTELLINGEN_KEY, parseMailInstellingen, parseVerzendlijsten, STANDAARD_MAIL_INSTELLINGEN, VERZENDLIJSTEN_KEY, type MailInstellingen, type Verzendlijsten } from "../../shared/schemas/mail.js";
import { bijUsersCacheWissel, epochStand, invalidateUsersCache } from "../userCache.js";
import { maakSwrCache, SWR_STALE_MS } from "./swrCache.js";

/**
 * Mailinstellingen (welke soorten uit staan) en verzendlijsten uit
 * app_settings, kort gecacht zoals de onderhoudsmodus (onderhoud.ts):
 * sendEmail raadpleegt de instellingen bij élke mail, dus geen query per
 * verzending. Ontbreekt de tabel of de rij, dan staat alles aan: een
 * instelling die er niet is mag nooit een mail tegenhouden.
 */
const instellingenCache = maakSwrCache<MailInstellingen>(
  async () => {
    try {
      return parseMailInstellingen(await getAppSetting(MAIL_INSTELLINGEN_KEY));
    } catch {
      return STANDAARD_MAIL_INSTELLINGEN;
    }
  },
  { ttlMs: 30_000, staleMs: SWR_STALE_MS, epoch: epochStand },
);
const lijstenCache = maakSwrCache<Verzendlijsten>(
  async () => {
    try {
      return parseVerzendlijsten(await getAppSetting(VERZENDLIJSTEN_KEY));
    } catch {
      return [];
    }
  },
  { ttlMs: 30_000, staleMs: SWR_STALE_MS, epoch: epochStand },
);

export const getMailInstellingen = (): Promise<MailInstellingen> => instellingenCache.get();
export const getVerzendlijsten = (): Promise<Verzendlijsten> => lijstenCache.get();
/** Staat deze mailsoort aan? (Altijd-aan-soorten en onbekende soorten: ja.) */
export const mailSoortAan = async (soort: string): Promise<boolean> => isMailAan(await getMailInstellingen(), soort);

export const invalidateMailCaches = () => { instellingenCache.invalidate(); lijstenCache.invalidate(); };
bijUsersCacheWissel(invalidateMailCaches);
/** Na een wijziging via de API: lokaal meteen de nieuwe waarde, en de
 *  gedeelde epoch omhoog zodat de andere instanties binnen ±2 s volgen. */
export const meldMailWijziging = () => {
  invalidateMailCaches();
  invalidateUsersCache();
};
