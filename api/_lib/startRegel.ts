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
const ROLLEN = ["chauffeur", "technieker", "planner", "admin"];
const SCHERMEN = ["dashboard", "mijn-dag", "ander"];
const FASEN = ["js", "sessie", "profiel", "gegevens", "beeld"] as const;
const CONTEXT: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["bron", ["cache", "vers"]],
  ["toestel", ["ios", "android", "desktop"]],
  ["weergave", ["app", "browser"]],
];
const MAX_MS = 120_000;
/** Een meting heeft hoogstens 12 velden; wat er veel meer draagt is geen meting. */
const MAX_VELDEN = 20;

const uitLijst = (waarde: unknown, lijst: readonly string[]): string | null =>
  typeof waarde === "string" && lijst.includes(waarde) ? waarde : null;

const geldigeMs = (waarde: unknown): waarde is number =>
  typeof waarde === "number" && Number.isInteger(waarde) && waarde >= 0 && waarde <= MAX_MS;

export function startRegel(start: unknown): string | null {
  if (!start || typeof start !== "object" || Array.isArray(start)) return null;
  if (Object.keys(start).length > MAX_VELDEN) return null;
  const s = start as Record<string, unknown>;
  const rol = uitLijst(s.rol, ROLLEN);
  const scherm = uitLijst(s.scherm, SCHERMEN);
  if (!rol || !scherm || !geldigeMs(s.gegevens)) return null;

  const fasen = FASEN.filter((f) => geldigeMs(s[f])).map((f) => `${f} ${s[f]}`);
  const context = CONTEXT.map(([veld, lijst]) => uitLijst(s[veld], lijst)).filter((w): w is string => w !== null);
  if (s.vroeg === true) context.push("vroeg");
  const release = typeof s.release === "string" && /^[0-9a-f]{7,12}$/.test(s.release) ? s.release : null;

  return [
    `[start] ${rol} ${scherm}`,
    fasen.join(" · "),
    ...(context.length > 0 ? [context.join(" · ")] : []),
    ...(release ? [`release ${release}`] : []),
  ].join(" | ");
}
