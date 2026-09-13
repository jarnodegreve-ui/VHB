import { z } from './zod.js';
import { optioneel } from './basis.js';
import { DIENST_TYPES, LOON_CODE_BRONNEN, OPMERKING_MAX, OVERMIN_MAX, OVERMIN_MIN, QUAL_VLAGGEN } from '../loon.js';

/**
 * Loon (fase B Access-migratie): de bodies van de looncodes, de medewerkers-
 * matricules en de dagafsluiting. Eén bron voor server en client.
 */
export { DIENST_TYPES, LOON_CODE_BRONNEN, QUAL_VLAGGEN };

const isoDatum = z.string({ error: 'Vul een datum in' }).regex(/^\d{4}-\d{2}-\d{2}$/, 'Ongeldige datum');
const klokTijd = z.string().trim().regex(/^([0-4]\d):[0-5]\d$/, 'Ongeldige tijd, verwacht uu:mm (tot 47:59 voor na middernacht)');
const leegNaarNull = (s: z.ZodType<string>) => z.preprocess((v) => (v === '' ? null : v), s.nullable().optional());
const minutenVeld = z.number({ error: 'Vul een getal in' }).int('Geheel aantal minuten').min(OVERMIN_MIN, `Minstens ${OVERMIN_MIN}`).max(OVERMIN_MAX, `Hooguit ${OVERMIN_MAX}`);
const minutenInt = z.number({ error: 'Vul een getal in' }).int('Geheel getal').min(0).max(2000);

/** Eén looncode zoals GET /api/loon/codes hem teruggeeft. */
export const loonCodeSchema = z.object({
  code: z.string({ error: 'Vul een code in' }).trim().min(1, 'Vul een code in').max(20, 'Hooguit 20 tekens'),
  codeWeergave: z.string().trim().min(1, 'Vul een code in').max(20),
  omschrijving: leegNaarNull(z.string().trim().max(80, 'Hooguit 80 tekens')),
  dienstType: z.enum(DIENST_TYPES, { error: 'Kies een type' }),
  inExport: z.boolean().default(true),
  easypayActiviteit: z.string({ error: 'Vul de activiteit in' }).trim().min(1, 'Vul de activiteit in').max(10, 'Hooguit 10 tekens'),
  easypayTypePrest: z.number({ error: 'Vul het typenummer in' }).int('Geheel getal').min(0).max(99999),
  tik1: leegNaarNull(klokTijd), tik2: leegNaarNull(klokTijd), tik3: leegNaarNull(klokTijd),
  tik4: leegNaarNull(klokTijd), tik5: leegNaarNull(klokTijd), tik6: leegNaarNull(klokTijd),
  lbRijtijd: optioneel(minutenInt.nullable()), lbStat100At: optioneel(minutenInt.nullable()), lbStat100Nat: optioneel(minutenInt.nullable()),
  lbStat50Nat: optioneel(minutenInt.nullable()), lbOnd: optioneel(minutenInt.nullable()), lbAndWrk: optioneel(minutenInt.nullable()), lbNacht: optioneel(minutenInt.nullable()),
  bron: z.enum(LOON_CODE_BRONNEN).default('handmatig'),
  updatedAt: optioneel(z.string()),
});
export type LoonCode = z.output<typeof loonCodeSchema>;

/** Body van PUT /api/loon/codes/:code (code komt uit het pad). */
export const loonCodeBodySchema = loonCodeSchema.omit({ code: true, updatedAt: true, bron: true });
export type LoonCodeBody = z.output<typeof loonCodeBodySchema>;

export const loonMedewerkerSchema = z.object({
  userId: z.string(),
  easypayNr: optioneel(z.number({ error: 'Vul een getal in' }).int('Geheel getal').min(1, 'Minstens 1').max(9999999).nullable()),
  inExport: z.boolean().default(true),
});
export type LoonMedewerker = z.output<typeof loonMedewerkerSchema>;
export const loonMedewerkerBodySchema = loonMedewerkerSchema.omit({ userId: true });

/** Body van PUT /api/loon/instellingen (admin). */
export const loonInstellingenSchema = z.object({
  easypayLidnr: z.number({ error: 'Vul het lidnummer in' }).int('Geheel getal').min(0).max(9999999).default(0),
});
export type LoonInstellingen = z.output<typeof loonInstellingenSchema>;
export const LOON_INSTELLINGEN_KEY = 'loon';
export const parseLoonInstellingen = (waarde: unknown): LoonInstellingen => {
  const r = loonInstellingenSchema.safeParse(waarde ?? {});
  return r.success ? r.data : { easypayLidnr: 0 };
};

const qualVelden = Object.fromEntries(QUAL_VLAGGEN.map((k) => [k, optioneel(z.boolean())])) as Record<(typeof QUAL_VLAGGEN)[number], ReturnType<typeof optioneel<z.ZodBoolean>>>;

/** Body van PUT /api/dagafsluiting/:datum/rijen/:id (alles optioneel; ontbreekt = niet aanraken). */
export const dagPrestatieBodySchema = z.object({
  geredenCode: leegNaarNull(z.string().trim().max(20, 'Hooguit 20 tekens')),
  overmin: optioneel(minutenVeld),
  overminNacht: optioneel(minutenVeld),
  overminExtra: optioneel(minutenVeld),
  onvPremie: optioneel(z.boolean()),
  ...qualVelden,
  opmerking: leegNaarNull(z.string().trim().max(OPMERKING_MAX, `Hooguit ${OPMERKING_MAX} tekens`)),
});
export type DagPrestatieBody = z.output<typeof dagPrestatieBodySchema>;

/** Body van POST /api/dagafsluiting/:datum/rijen (extra rij voor een chauffeur). */
export const dagPrestatieNieuwSchema = z.object({
  userId: z.string({ error: 'Kies een chauffeur' }).trim().min(1, 'Kies een chauffeur'),
  geredenCode: leegNaarNull(z.string().trim().max(20, 'Hooguit 20 tekens')),
});

/** Body van POST /api/dagafsluiting/:datum/heropenen. */
export const heropenBodySchema = z.object({
  reden: z.string({ error: 'Geef een reden' }).trim().min(3, 'Geef een reden (minstens 3 tekens)').max(OPMERKING_MAX, `Hooguit ${OPMERKING_MAX} tekens`),
});

/** Eén rij van de dagafsluiting zoals de API hem teruggeeft. */
export const dagPrestatieSchema = z.object({
  id: z.string(),
  datum: isoDatum,
  userId: z.string(),
  naam: optioneel(z.string()),
  volgnr: z.number().int(),
  planningCode: optioneel(z.string().nullable()),
  geredenCode: optioneel(z.string().nullable()),
  overmin: z.number().int(),
  overminNacht: z.number().int(),
  overminExtra: z.number().int(),
  onvPremie: z.boolean(),
  ...Object.fromEntries(QUAL_VLAGGEN.map((k) => [k, z.boolean()])) as Record<(typeof QUAL_VLAGGEN)[number], z.ZodBoolean>,
  opmerking: optioneel(z.string().nullable()),
  bewerktOp: optioneel(z.string().nullable()),
  bewerktDoor: optioneel(z.string().nullable()),
});
export type DagPrestatie = z.output<typeof dagPrestatieSchema>;

/** Body van PUT /api/loon/medewerkers/import: "Naam;matricule" per regel (plakken uit Access/Excel). */
export const loonMedewerkersImportSchema = z.object({
  tekst: z.string({ error: 'Plak de lijst' }).trim().min(1, 'Plak de lijst').max(20000, 'Te lang'),
});
