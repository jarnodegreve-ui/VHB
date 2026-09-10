/**
 * Zod-vrije kant van de extra vrije dagen (zie shared/schemas/verlofFeestdagen.ts
 * voor het schema). De datalaag laadt deze lijst bij het opstarten, en zod
 * hoort niet in de startbundel (scripts/check-bundle-size.mjs bewaakt dat),
 * dus hier een lichte parser die alleen de vorm controleert.
 */
export type ExtraFeestdag = { id: string; datum: string; naam: string };

const ISO_DAG = /^\d{4}-\d{2}-\d{2}$/;

/** Onbekende invoer (API-antwoord) → geldige lijst; rommel valt weg. */
export const parseExtraFeestdagenLos = (waarde: unknown): ExtraFeestdag[] => {
  const extra = (waarde as { extra?: unknown } | null)?.extra;
  if (!Array.isArray(extra)) return [];
  const uit: ExtraFeestdag[] = [];
  for (const d of extra) {
    if (!d || typeof d !== 'object') continue;
    const { id, datum, naam } = d as Record<string, unknown>;
    if (typeof id !== 'string' || !id.trim()) continue;
    if (typeof datum !== 'string' || !ISO_DAG.test(datum)) continue;
    if (typeof naam !== 'string' || !naam.trim()) continue;
    uit.push({ id: id.trim(), datum, naam: naam.trim().slice(0, 60) });
  }
  return uit.sort((a, b) => a.datum.localeCompare(b.datum));
};
