import type { Shift, SwapRequest } from '../types';

type Kandidaat = { id: string | number; name: string };

/**
 * Rangschikking van vervanger-keuzelijsten (herverdelen, toewijzen, wissel):
 * wie die dag vrij is bovenaan, daarbinnen wie dit jaar het minst vaak een
 * dienst overnam — eerlijk verdelen, en het antwoord op "waarom altijd ik?".
 * Alfabetisch was de oude volgorde; die zette toevallig dezelfde namen
 * telkens bovenaan.
 */

/** Hoe vaak nam iemand dit jaar een dienst over (doorgevoerde wissels,
 *  handmatig én via ruil-overname)? */
export const overnameTellingDitJaar = (swaps: SwapRequest[], jaar = new Date().getFullYear()): Map<string, number> => {
  const per = new Map<string, number>();
  for (const s of swaps) {
    if (s.status !== 'approved' && s.status !== 'completed') continue;
    if (!s.targetDriverId) continue;
    const wanneer = String(s.decidedAt ?? s.createdAt ?? '');
    if (!wanneer.startsWith(String(jaar))) continue;
    per.set(String(s.targetDriverId), (per.get(String(s.targetDriverId)) ?? 0) + 1);
  }
  return per;
};

export type KandidaatInfo = { user: Kandidaat; vrij: boolean; keren: number };

/**
 * Sorteer kandidaten: vrij eerst, dan minst ingesprongen, dan naam.
 * `isVrij` bepaalt per gebruiker of hij die dag niets heeft — de aanroeper
 * weet waar die kennis zit (shifts-lijst of maandplanning-cellen).
 */
export const rangschikKandidaten = (
  kandidaten: Kandidaat[],
  isVrij: (u: Kandidaat) => boolean,
  telling: Map<string, number>,
): KandidaatInfo[] =>
  kandidaten
    .map((user) => ({ user, vrij: isVrij(user), keren: telling.get(String(user.id)) ?? 0 }))
    .sort((a, b) =>
      Number(b.vrij) - Number(a.vrij) ||
      a.keren - b.keren ||
      a.user.name.localeCompare(b.user.name),
    );

/** Optie-label: "Gino De Jaeger · vrij · 2× ingevallen". */
export const kandidaatLabel = (k: KandidaatInfo, metVrij = true): string => {
  const delen = [k.user.name];
  if (metVrij && k.vrij) delen.push('vrij');
  if (k.keren > 0) delen.push(`${k.keren}× ingevallen`);
  return delen.join(' · ');
};

/** Vrij-op-datum op basis van de planning-lijst (dashboard, Ziekte-blad). */
export const vrijOpDatum = (shifts: Shift[], datum: string) => {
  const bezet = new Set(shifts.filter((s) => s.date === datum).map((s) => String(s.driverId)));
  return (u: Kandidaat) => !bezet.has(String(u.id));
};
