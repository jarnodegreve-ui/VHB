import { z } from './zod.js';
import { isoDatum } from './basis.js';

/**
 * Extra vrije dagen (verzoek Jarno 10-09): dagen die, net als de wettelijke
 * feestdagen, niet meetellen als betaald verlof wanneer ze in een verlofperiode
 * vallen. De wettelijke feestdagen berekent de app zelf (src/lib/typedag.ts);
 * dit is de aanvulling die de beheerder bijhoudt, bv. een brugdag of een
 * bedrijfssluiting. Opgeslagen als één jsonb-waarde in app_settings.
 */
export const VERLOF_FEESTDAGEN_KEY = 'verlof_feestdagen';

export const extraFeestdagSchema = z.object({
  id: z.string().trim().min(1).max(64),
  datum: isoDatum('Ongeldige datum'),
  naam: z.string().trim().min(1, 'Geef de dag een naam').max(60, 'Maximum 60 tekens'),
});
export type { ExtraFeestdag } from '../feestdagen.js';
import type { ExtraFeestdag } from '../feestdagen.js';

export const verlofFeestdagenSchema = z.object({
  extra: z.array(extraFeestdagSchema).max(200, 'Maximum 200 dagen').default([]),
});
export type VerlofFeestdagen = z.output<typeof verlofFeestdagenSchema>;

export const STANDAARD_VERLOF_FEESTDAGEN: VerlofFeestdagen = { extra: [] };

/** Onbekende invoer (db-jsonb) → geldige lijst, anders leeg. */
export const parseVerlofFeestdagen = (waarde: unknown): VerlofFeestdagen => {
  const r = verlofFeestdagenSchema.safeParse(waarde);
  return r.success ? r.data : STANDAARD_VERLOF_FEESTDAGEN;
};

/** Gesorteerd op datum, ontdubbeld per datum (de eerste naam wint). */
export const sorteerExtraFeestdagen = (extra: ExtraFeestdag[]): ExtraFeestdag[] => {
  const perDatum = new Map<string, ExtraFeestdag>();
  for (const d of extra) if (!perDatum.has(d.datum)) perDatum.set(d.datum, d);
  return [...perDatum.values()].sort((a, b) => a.datum.localeCompare(b.datum));
};
