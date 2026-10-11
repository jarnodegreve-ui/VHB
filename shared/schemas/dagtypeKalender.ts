import { z } from './zod.js';
import { isoDatum } from './basis.js';

/** PUT /api/dagtypekalender (admin): de dagen uit het CSV, al gelezen door
 *  shared/dagtypeKalender.ts kalenderUitRijen. Hoogstens drie jaar in één keer. */
export const dagtypeKalenderDagSchema = z.object({
  datum: isoDatum('Ongeldige datum'),
  typedag: z.string().regex(/^(2[1-8]|3[1-5]|4[1-5]|5[1-5])$/, 'Onbekend dagtype'),
  maxVerlof: z.number().int('Gebruik een geheel getal').min(0, 'Minimum 0').max(200, 'Maximum 200').nullable(),
});

export const dagtypeKalenderBodySchema = z.object({
  dagen: z.array(dagtypeKalenderDagSchema).min(1, 'Geen dagen').max(1100, 'Hoogstens drie jaar in één keer'),
});

export type DagtypeKalenderBody = z.output<typeof dagtypeKalenderBodySchema>;

/** PATCH /api/dagtypekalender/:datum (admin, deel 2, 11-10): één dag met de
 *  hand bijwerken; de datum staat in het pad, de rest is dezelfde regel. */
export const dagtypeKalenderDagWijzigingSchema = dagtypeKalenderDagSchema.omit({ datum: true });
export type DagtypeKalenderDagWijziging = z.output<typeof dagtypeKalenderDagWijzigingSchema>;
