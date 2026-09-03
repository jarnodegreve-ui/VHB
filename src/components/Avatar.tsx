import { cn } from '../lib/ui';

/**
 * Persoonsavatar met initialen (idee 7, 09-2026): één vaste, gedempte tint
 * per naam zodat een lijst met mensen scanbaar wordt — zonder foto's en
 * zonder extra kleur elders in de rij. De ingelogde gebruiker in de topbar
 * (UserMenu) blijft goud: dat is "jij", dit zijn "de anderen".
 *
 * Kleurpaar per familie: `bg-<familie>-500/12 text-<familie>-800`. De 500
 * blijft in dark mode ongewijzigd (dus een transparante tint op het donkere
 * vlak) en 800 wordt daar een lichte tekstvariant — het paar klopt in beide
 * thema's zonder `dark:`-utilities. Alleen families uit `@theme` in
 * index.css, want alleen die schalen worden in dark mode omgekeerd.
 */
export const AVATAR_TINTEN = [
  'bg-oker-500/12 text-oker-800',
  'bg-emerald-500/12 text-emerald-800',
  'bg-blue-500/12 text-blue-800',
  'bg-rose-500/12 text-rose-800',
  'bg-amber-500/12 text-amber-800',
  'bg-slate-500/12 text-slate-800',
] as const;

const MATEN = {
  sm: 'h-6 w-6 text-2xs',
  md: 'h-8 w-8 text-2xs',
  lg: 'h-10 w-10 text-xs',
} as const;

/**
 * Initialen: eerste letter van voor- en achternaam ("Jarno De Greve" → JG);
 * bij één woord de eerste twee letters ("Beheerder" → BE); leeg → "?".
 */
export function initialen(naam: string): string {
  const delen = naam.trim().split(/\s+/).filter(Boolean);
  if (delen.length === 0) return '?';
  if (delen.length === 1) return Array.from(delen[0]).slice(0, 2).join('').toUpperCase();
  return (Array.from(delen[0])[0] + Array.from(delen[delen.length - 1])[0]).toUpperCase();
}

/** Deterministische index in AVATAR_TINTEN (FNV-1a over de genormaliseerde naam). */
export function avatarTintIndex(naam: string): number {
  const sleutel = naam.trim().toLowerCase();
  let h = 0x811c9dc5;
  for (let i = 0; i < sleutel.length; i++) {
    h ^= sleutel.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % AVATAR_TINTEN.length;
}

export function avatarTint(naam: string): string {
  return AVATAR_TINTEN[avatarTintIndex(naam)];
}

export function Avatar({
  naam,
  size = 'md',
  naamZichtbaar = true,
  className,
}: {
  naam: string;
  /** sm 24 · md 32 · lg 40 px. */
  size?: keyof typeof MATEN;
  /** Staat de naam ernaast in de tekst? Dan is de avatar decoratie
   *  (aria-hidden); anders draagt hij de naam zelf (role="img"). */
  naamZichtbaar?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold leading-none',
        MATEN[size],
        avatarTint(naam),
        className,
      )}
      {...(naamZichtbaar ? { 'aria-hidden': true } : { role: 'img', 'aria-label': naam })}
    >
      {initialen(naam)}
    </span>
  );
}
