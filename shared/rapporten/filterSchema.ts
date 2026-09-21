import { z } from '../schemas/zod.js';
import { isoDatum } from '../schemas/basis.js';
import type { RapportDefinitie, RapportFilters } from './types.js';
import { JAAR_MAX, JAAR_MIN, VINKJE_AAN } from './filters.js';
import { periodeFout } from './periode.js';

/**
 * Het zod-schema voor de querystring van GET /api/rapporten/:id, afgeleid uit
 * de definitie: een rapport valideert alleen de filters die het heeft, en wat
 * er verder in de querystring staat wordt genegeerd. Streng, anders dan de
 * lezer aan de clientkant (filters.ts): een ontbrekende of onmogelijke waarde
 * is een 400 met de tekst bij het veld, geen stille terugval.
 *
 * Bewust een eigen bestand: het register en de lezer blijven zod-vrij, alleen
 * wie valideert (de server, de tests) trekt zod mee.
 */

const tekst = (fout: string) => z.string({ error: fout }).trim();
const id = z.preprocess((v) => (v === '' || v == null ? undefined : v), tekst('Ongeldige waarde').max(64, 'Ongeldige waarde').optional());

export const filterSchemaVoor = (def: RapportDefinitie) => {
  const vorm: Record<string, z.ZodType> = {};
  for (const f of def.filters) {
    if (f.soort === 'periode') {
      vorm.van = isoDatum('Kies een begindatum');
      vorm.tot = isoDatum('Kies een einddatum');
    } else if (f.soort === 'jaar') {
      vorm.jaar = z.preprocess(
        (v) => (typeof v === 'string' && /^\d{4}$/.test(v.trim()) ? Number(v) : v),
        z.number({ error: 'Kies een jaar' }).int('Kies een jaar').min(JAAR_MIN, 'Kies een jaar').max(JAAR_MAX, 'Kies een jaar'),
      );
    } else if (f.soort === 'chauffeur' || f.soort === 'voertuig') {
      vorm[f.soort] = id;
    } else if (f.soort === 'vinkje') {
      // Aan = '1', uit = afwezig of leeg; al de rest is een tikfout in de link, geen stille "uit".
      vorm[f.id] = z.preprocess(
        (v) => (v === '' || v == null ? false : v === VINKJE_AAN ? true : v),
        z.boolean({ error: 'Ongeldige keuze' }),
      );
    } else {
      const waarden = f.opties.map((o) => o.waarde);
      const standaard = f.standaard ?? waarden[0] ?? '';
      vorm[f.id] = z.preprocess(
        (v) => (v === '' || v == null ? standaard : v),
        tekst('Ongeldige keuze').refine((v) => waarden.includes(v), 'Ongeldige keuze'),
      );
    }
  }
  const keuzeIds = def.filters.flatMap((f) => (f.soort === 'keuze' ? [f.id] : []));
  const vinkjeIds = def.filters.flatMap((f) => (f.soort === 'vinkje' ? [f.id] : []));
  return z.object(vorm)
    .superRefine((waarden, ctx) => {
      if (!def.filters.some((f) => f.soort === 'periode')) return;
      const fout = periodeFout(waarden as { van?: string; tot?: string });
      if (fout) ctx.addIssue({ code: 'custom', path: [fout.veld], message: fout.tekst });
    })
    .transform((waarden): RapportFilters => {
      const w = waarden as Record<string, unknown>;
      const uit: RapportFilters = { keuzes: {} };
      if (typeof w.van === 'string') uit.van = w.van;
      if (typeof w.tot === 'string') uit.tot = w.tot;
      if (typeof w.jaar === 'number') uit.jaar = w.jaar;
      if (typeof w.chauffeur === 'string' && w.chauffeur) uit.chauffeur = w.chauffeur;
      if (typeof w.voertuig === 'string' && w.voertuig) uit.voertuig = w.voertuig;
      for (const k of keuzeIds) if (typeof w[k] === 'string') uit.keuzes[k] = w[k] as string;
      for (const k of vinkjeIds) (uit.vinkjes ??= {})[k] = w[k] === true;
      return uit;
    });
};
