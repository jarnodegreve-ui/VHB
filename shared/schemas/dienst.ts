import { z } from './zod.js';
import { optioneel } from './basis.js';

/**
 * Dienstopbouw (fase C Access-migratie): de bodies van de import van de
 * ET-export en van de dagtype-koppeling. De ritdelen zelf worden server-side
 * door shared/dienst/importET.ts gelezen.
 */
export const segmentImportBodySchema = z.object({
  /** Base64 van het .xlsx- of .csv-bestand (zelfde patroon als de planning-import). */
  bestandBase64: z.string({ error: 'Kies een bestand' }).min(1, 'Kies een bestand'),
  filename: optioneel(z.string().trim().max(200)),
});
export type SegmentImportBody = z.output<typeof segmentImportBodySchema>;

export const PORTAAL_DAGTYPES = ['schooldag', 'vakantie', 'zaterdag', 'zondag'] as const;
export const dagtypeCodeBodySchema = z.object({
  portaalDagtype: z.preprocess((v) => (v === '' ? null : v), z.enum(PORTAAL_DAGTYPES, { error: 'Kies een dagtype' }).nullable()),
});
export type DagtypeCodeBody = z.output<typeof dagtypeCodeBodySchema>;
