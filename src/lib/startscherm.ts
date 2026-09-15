/**
 * Startscherm-voorkeur (punt 15, 15-09), zod-vrij: de router leest dit vóór
 * de eerste render en vóór /api/me, dus de bron voor het opstarten is een
 * lokale kopie in localStorage. De server (users.dashboardvoorkeuren, veld
 * `startscherm`) blijft de waarheid over toestellen heen; de schermen die
 * de gebruiker als eerste ziet (dashboard, Mijn dag, rooster, Instellingen)
 * spiegelen het profiel naar de lokale kopie zodra ze renderen. Op een nieuw
 * toestel geldt de voorkeur daarom vanaf de tweede start.
 *
 * `STARTSCHERMEN` is een kopie van shared/schemas/dashboardVoorkeuren.ts
 * (dat bestand sleept zod mee en mag niet in de startbundel);
 * startscherm.test.ts bewaakt dat beide gelijk blijven.
 */
export const STARTSCHERMEN = ['dashboard', 'mijn-dag', 'rooster'] as const;
export type Startscherm = (typeof STARTSCHERMEN)[number];

export const STARTSCHERM_KEY = 'vhb-startscherm';

export const isStartscherm = (waarde: unknown): waarde is Startscherm =>
  typeof waarde === 'string' && (STARTSCHERMEN as readonly string[]).includes(waarde);

/** Lokale kopie lezen; ongeldig of afwezig = null (het huidige gedrag). */
export const leesStartschermLokaal = (): Startscherm | null => {
  try {
    const raw = window.localStorage.getItem(STARTSCHERM_KEY);
    return isStartscherm(raw) ? raw : null;
  } catch {
    return null;
  }
};

/** Lokale kopie schrijven; null wist hem. */
export const onthoudStartschermLokaal = (scherm: Startscherm | null | undefined): void => {
  try {
    if (scherm) window.localStorage.setItem(STARTSCHERM_KEY, scherm);
    else window.localStorage.removeItem(STARTSCHERM_KEY);
  } catch {
    /* privémodus of opslag geblokkeerd: de volgende start valt terug op het oude gedrag */
  }
};
