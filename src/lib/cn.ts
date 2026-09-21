import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * `cn()` kent de typografie-rollen uit src/index.css.
 *
 * Zonder deze config ziet tailwind-merge `text-micro` als een tekstKLEUR
 * (elke onbekende `text-…` valt in die groep) en gooit het de rol weg zodra
 * er een `text-slate-500` naast staat: het kopje rendert dan als gewone tekst,
 * zonder kapitalen, maat of spatiëring.
 *
 * Model: elke rol is een eigen klassegroep.
 *  - rol tegen rol: de laatste wint (uitzondering: `text-stat-mono` is een
 *    aanvulling op `text-stat`, die twee staan samen);
 *  - rol tegen tekstkleur: nooit een conflict. De rollen staan in
 *    `@layer components`, een kleur-utility ernaast wint in de CSS van de
 *    rol-tint, en dat is precies de bedoeling (`text-micro text-oker-700`);
 *  - rol NA een losse utility voor een eigenschap die de rol zelf zet (maat,
 *    regelhoogte, gewicht, spatiëring, …): de rol wint, de utility valt weg.
 *    Zonder die regel zou de vroegere utility in de CSS toch winnen (utilities
 *    staan boven components), tegen de volgorde in;
 *  - losse utility NA de rol: beide blijven, de utility overschrijft alleen
 *    die ene eigenschap (`text-micro text-sm` = kapitalen op 13 px).
 *
 * De lijsten hieronder zijn de eigenschappen die elke rol in index.css zet,
 * vertaald naar tailwind-merge-groepen; `color` staat er bewust niet in.
 * src/lib/cn.test.ts leest index.css en faalt zodra een rol of een eigenschap
 * hier ontbreekt, scripts/design-lint.mjs bewaakt de namen.
 */
const KOP = ['font-size', 'leading', 'font-weight', 'tracking', 'font-family', 'text-wrap'] as const;
const LEES = ['font-size', 'leading', 'text-wrap'] as const;

export const TYPOGRAFIE_ROLLEN = {
  'page-title': KOP,
  'greeting': KOP,
  'section-title': KOP,
  'card-title': KOP,
  'body': LEES,
  'body-sm': LEES,
  'label': ['font-size', 'leading', 'font-weight'],
  'micro': ['font-size', 'leading', 'font-weight', 'tracking', 'text-transform'],
  'stat': ['font-size', 'leading', 'font-weight', 'tracking', 'font-family', 'fvn-spacing'],
  'stat-mono': ['font-size', 'font-weight', 'tracking', 'font-family'],
} as const;

export type TypografieRol = keyof typeof TYPOGRAFIE_ROLLEN;
type RolGroep = `rol-${TypografieRol}`;

/** Rollen die samen op één element horen en elkaar dus niet verdringen. */
const SAMEN: Partial<Record<TypografieRol, TypografieRol>> = { 'stat': 'stat-mono', 'stat-mono': 'stat' };

const rollen = Object.keys(TYPOGRAFIE_ROLLEN) as TypografieRol[];
const groep = (rol: TypografieRol): RolGroep => `rol-${rol}`;

const twMerge = extendTailwindMerge<RolGroep>({
  extend: {
    classGroups: Object.fromEntries(
      rollen.map(rol => [groep(rol), [{ text: [rol] }]]),
    ) as Record<RolGroep, [{ text: [TypografieRol] }]>,
    conflictingClassGroups: Object.fromEntries(
      rollen.map(rol => [
        groep(rol),
        [...rollen.filter(r => r !== rol && SAMEN[rol] !== r).map(groep), ...TYPOGRAFIE_ROLLEN[rol]],
      ]),
    ),
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
