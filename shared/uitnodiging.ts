/**
 * Uitnodigen voor het portaal (30-09): wie een uitnodiging kan krijgen, hoe
 * lang de link werkt en hoe de code in de link eruitziet. Gedeeld door de
 * server (api/_lib/uitnodiging.ts) en het scherm Gebruikers. Zod-vrij en
 * klein. De hash-sleutel van de link staat apart in uitnodigingHash.ts,
 * want die leest App.tsx in de startbundel.
 */

/** Zo lang werkt de link in een uitnodiging. */
export const UITNODIGING_GELDIG_DAGEN = 7;

export { UITNODIGING_HASH } from './uitnodigingHash.js';

/**
 * Waarom iemand geen uitnodiging krijgt. `geen-account` weet alleen de
 * server (het profiel is niet aan een aanmelding in Supabase gekoppeld).
 */
export type UitnodigingBeletsel = 'technisch' | 'gepauzeerd' | 'geen-email' | 'al-ingelogd' | 'geen-account';

export const UITNODIGING_BELETSEL_TEKST: Record<UitnodigingBeletsel, string> = {
  technisch: 'technisch account',
  gepauzeerd: 'gepauzeerd',
  'geen-email': 'geen e-mailadres',
  'al-ingelogd': 'al eens ingelogd',
  'geen-account': 'geen gekoppelde aanmelding',
};

/**
 * null = kan uitgenodigd worden. Alleen wie nog nooit in het portaal
 * aanmeldde: wie het al gebruikt en zijn wachtwoord kwijt is, heeft
 * "Wachtwoord vergeten?" of een nieuw tijdelijk wachtwoord van een admin.
 */
export function uitnodigingBeletsel(u: {
  name?: string | null;
  email?: string | null;
  isActive?: boolean | null;
  lastLogin?: string | null;
}): Exclude<UitnodigingBeletsel, 'geen-account'> | null {
  if (String(u.name ?? '').trim().toLowerCase() === 'beheerder') return 'technisch';
  if (u.isActive === false) return 'gepauzeerd';
  if (!String(u.email ?? '').trim()) return 'geen-email';
  if (u.lastLogin) return 'al-ingelogd';
  return null;
}

/** "Jan Peeters (al eens ingelogd), Els Maes (gepauzeerd)"; boven vijf per reden geteld. */
export function beschrijfOvergeslagen(lijst: ReadonlyArray<{ naam: string; reden: UitnodigingBeletsel }>): string {
  if (lijst.length <= 5) return lijst.map((o) => `${o.naam} (${UITNODIGING_BELETSEL_TEKST[o.reden]})`).join(', ');
  const perReden = new Map<UitnodigingBeletsel, number>();
  for (const o of lijst) perReden.set(o.reden, (perReden.get(o.reden) ?? 0) + 1);
  return [...perReden].map(([reden, n]) => `${n} ${UITNODIGING_BELETSEL_TEKST[reden]}`).join(', ');
}

/** De code in de link: `<gebruikers-id>.<geheim>`. */
export const maakUitnodigingCode = (userId: string, geheim: string) => `${encodeURIComponent(userId)}.${geheim}`;

/** Code → id en geheim, of null als ze niet de vorm van een uitnodiging heeft. */
export function leesUitnodigingCode(code: unknown): { userId: string; geheim: string } | null {
  if (typeof code !== 'string' || code.length > 200) return null;
  const punt = code.lastIndexOf('.');
  if (punt <= 0) return null;
  const geheim = code.slice(punt + 1);
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(geheim)) return null;
  let userId: string;
  try {
    userId = decodeURIComponent(code.slice(0, punt));
  } catch {
    return null;
  }
  return userId.trim() && userId.length <= 100 ? { userId, geheim } : null;
}
