/**
 * De [start]-regel (ronde 6, punt 21a): de client meet zijn warme start in
 * fasen (src/lib/startMeting.ts) en stuurt die meting mee met de
 * aanwezigheidsping van de vólgende start (`POST /api/auth/session`,
 * `action: 'resume'`, veld `start`). Deze pure functie maakt er één logregel
 * van, of null:
 *
 *   [start] chauffeur mijn-dag | js 380 · sessie 420 · profiel 780 · gegevens 1130 · beeld 1490 | vers · ios · app | release 1a2b3c4
 *
 * Alleen woorden uit vaste lijsten en gehele getallen tussen 0 en 120000 ms
 * komen in de regel, nooit een tekst van de client, een id of een naam. Een
 * ongeldig veld valt weg (en met het laatste contextwoord ook dat deel);
 * zonder geldige rol, scherm en `gegevens` is er geen regel, net als bij iets
 * dat geen object is of meer velden draagt dan een meting ooit heeft. De rol
 * komt uit de meting en niet uit de aanmelding: op een gedeeld toestel kan de
 * meting van de vorige gebruiker met de ping van de volgende meereizen.
 */
import { schoneStartMeting, START_FASEN } from "../../shared/startMeting.js";

export function startRegel(start: unknown): string | null {
  const s = schoneStartMeting(start);
  if (!s) return null;

  const fasen = START_FASEN.filter((f) => s[f] !== undefined).map((f) => `${f} ${s[f]}`);
  const context = [s.bron, s.toestel, s.weergave, s.vroeg ? "vroeg" : undefined].filter(Boolean);
  return [
    `[start] ${s.rol} ${s.scherm}`,
    fasen.join(" · "),
    ...(context.length > 0 ? [context.join(" · ")] : []),
    ...(s.release ? [`release ${s.release}`] : []),
  ].join(" | ");
}
