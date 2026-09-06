import { z } from 'zod';
import { isoDatum, leegNaarUndefined, optioneel, verplichteTekst } from './basis.js';
import { ROLLEN, WACHTWOORD_MIN } from './constanten.js';
import { dashboardVoorkeurenSchema } from './dashboardVoorkeuren.js';

/**
 * Gebruiker — spiegel van `AppUser`/`IncomingUser` (api/types.ts) en
 * `User` (src/types.ts). Drift valt op in shared/schemas/schemas.test.ts
 * (type-asserties: het afgeleide type moet veld-voor-veld gelijk zijn).
 *
 * Drie varianten op dezelfde velden:
 * - `userSchema`: het volledige record (id verplicht) — de lijst-POST en
 *   het contract-type.
 * - `userBodySchema`: server-invoer voor PUT/:id en POST …/one — het id
 *   komt uit de URL of wordt gegenereerd.
 * - `userFormulierSchema` / `nieuweUserFormulierSchema`: het beheer-
 *   formulier — e-mail is daar verplicht (anders kan de collega niet
 *   inloggen) en een nieuwe gebruiker moet een tijdelijk wachtwoord krijgen.
 *   De server blijft hier soepeler (Excel-import, historische accounts).
 */

export { ROLLEN, WACHTWOORD_MIN };
export const roleSchema = z.enum(ROLLEN, { error: 'Kies een rol' });

export const emailSchema = z.email('Vul een geldig e-mailadres in');

export const wachtwoordSchema = z
  .string({ error: 'Vul een wachtwoord in' })
  .min(WACHTWOORD_MIN, `Gebruik een wachtwoord van minstens ${WACHTWOORD_MIN} tekens`);

/** Soepel: cijfers, spaties, +, /, ., -, haakjes — en minstens 6 cijfers.
 *  Bestaande nummers ('0470 11 22 33', '+32 470/11.22.33') blijven geldig. */
export const telefoonSchema = z
  .string({ error: 'Vul een geldig telefoonnummer in' })
  .trim()
  .refine(
    (v) => /^[+\d\s./()-]+$/.test(v) && (v.match(/\d/g)?.length ?? 0) >= 6,
    'Vul een geldig telefoonnummer in',
  );

const userVelden = {
  id: verplichteTekst('Id ontbreekt'),
  name: verplichteTekst('Vul een naam in'),
  role: roleSchema.default('chauffeur'),
  /** Leeg mag: de server vult dan 'VHB-…' in (sanitizeIncomingUser). */
  employeeId: z.preprocess(leegNaarUndefined, z.string({ error: 'Ongeldig personeelsnummer' }).trim().default('')),
  lastLogin: optioneel(z.string()),
  activeSessions: optioneel(z.number().int().min(0)),
  isActive: optioneel(z.boolean()),
  phone: optioneel(telefoonSchema),
  email: optioneel(emailSchema),
  verlofBudget: optioneel(
    z.number({ error: 'Vul een getal in' }).int('Vul een geheel aantal dagen in').min(0, 'Verlofbudget kan niet negatief zijn'),
  ),
  showInContacts: optioneel(z.boolean()),
  wantsSystemMail: optioneel(z.boolean()),
  section: optioneel(z.string().trim()),
  startDate: optioneel(isoDatum('Vul een datum in als JJJJ-MM-DD')),
  /** Eigen dashboardindeling (alleen via PATCH /api/me/voorkeuren geschreven;
   *  de gebruikers-save negeert dit veld — zie api/helpers.ts toDatabaseUser). */
  dashboardVoorkeuren: optioneel(dashboardVoorkeurenSchema),
  /** Nieuw of reset; leeg = geen wijziging. */
  password: optioneel(wachtwoordSchema),
};

export const userSchema = z.object(userVelden);
export type GevalideerdeUser = z.output<typeof userSchema>;

export const userLijstSchema = z.array(userSchema);

export const userBodySchema = z.object({ ...userVelden, id: optioneel(z.string().trim()) });

const verplichteEmail = verplichteTekst('Vul een e-mailadres in').pipe(emailSchema);
export const userFormulierSchema = z.object({ ...userVelden, email: verplichteEmail });
export const nieuweUserFormulierSchema = z.object({
  ...userVelden,
  email: verplichteEmail,
  password: z
    .string({ error: 'Vul een tijdelijk wachtwoord in' })
    .min(1, 'Vul een tijdelijk wachtwoord in')
    .min(WACHTWOORD_MIN, `Gebruik een tijdelijk wachtwoord van minstens ${WACHTWOORD_MIN} tekens`),
});
