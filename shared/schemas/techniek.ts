import { z } from './zod.js';
import { optioneel } from './basis.js';
import {
  VOERTUIG_TYPES, VOERTUIG_TYPE_LABEL, AANDRIJVINGEN, AANDRIJVING_LABEL, VOERTUIG_STATUSSEN, VOERTUIG_STATUS_LABEL,
  WERKTYPES, WERKTYPE_LABEL, DEFECT_STATUSSEN, DEFECT_STATUS_LABEL, WERKCODES, WERKCODE_LABEL,
  VOERTUIG_VERVAL_SOORTEN, VOERTUIG_VERVAL_LABEL, DEFECT_OMSCHRIJVING_MAX, WERK_OMSCHRIJVING_MAX, voertuigNaam,
  type VoertuigType, type Aandrijving, type VoertuigStatus, type Werktype, type DefectStatus, type Werkcode, type VoertuigVervalSoort,
} from '../techniek.js';

/**
 * Techniek (fase A van de Access-migratie, 13-09-2026): voertuigen, het gele
 * boek (defectmeldingen), werkprestaties van de techniekers en vervaldata per
 * voertuig. Eén bron voor server (validatie van de bodies) en client
 * (keuzelijsten, labels, types).
 *
 * De codes zijn bewust die van garage.accdb, zodat de techniekers hun
 * werkwijze herkennen (werktype T/C/I/L, werkcode H/O/G/Kb/Kv/D/E/L/A).
 */

export {
  VOERTUIG_TYPES, VOERTUIG_TYPE_LABEL, AANDRIJVINGEN, AANDRIJVING_LABEL, VOERTUIG_STATUSSEN, VOERTUIG_STATUS_LABEL,
  WERKTYPES, WERKTYPE_LABEL, DEFECT_STATUSSEN, DEFECT_STATUS_LABEL, WERKCODES, WERKCODE_LABEL,
  VOERTUIG_VERVAL_SOORTEN, VOERTUIG_VERVAL_LABEL, DEFECT_OMSCHRIJVING_MAX, WERK_OMSCHRIJVING_MAX, voertuigNaam,
};
export type { VoertuigType, Aandrijving, VoertuigStatus, Werktype, DefectStatus, Werkcode, VoertuigVervalSoort };

const isoDatum = z.string({ error: 'Vul een datum in' }).regex(/^\d{4}-\d{2}-\d{2}$/, 'Ongeldige datum');
const klokTijd = z.string().trim().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Ongeldige tijd, verwacht uu:mm');
/** '' of null uit een formulier = null (veld leegmaken); ontbreekt de sleutel, dan blijft hij undefined (niet aanraken bij een patch). */
const leegNaarNull = (s: z.ZodType<string>) => z.preprocess((v) => (v === '' ? null : v), s.nullable().optional());

/** Eén voertuig zoals GET /api/vehicles het teruggeeft en zoals het formulier het bewaart. */
export const vehicleSchema = z.object({
  id: z.string(),
  busnr: z.string({ error: 'Vul het busnummer in' }).trim().min(1, 'Vul het busnummer in').max(20, 'Hooguit 20 tekens'),
  kortNr: optioneel(z.number({ error: 'Vul een getal in' }).int('Geheel getal').min(0).max(99999).nullable()),
  nummerplaat: leegNaarNull(z.string().trim().max(20, 'Hooguit 20 tekens')),
  chassisnr: leegNaarNull(z.string().trim().max(40, 'Hooguit 40 tekens')),
  merk: leegNaarNull(z.string().trim().max(60, 'Hooguit 60 tekens')),
  type: z.enum(VOERTUIG_TYPES, { error: 'Kies een type' }),
  aandrijving: optioneel(z.enum(AANDRIJVINGEN, { error: 'Kies een aandrijving' }).nullable()),
  status: z.enum(VOERTUIG_STATUSSEN, { error: 'Kies een status' }).default('actief'),
  inDienst: leegNaarNull(isoDatum),
  uitDienst: leegNaarNull(isoDatum),
  zitplaatsen: optioneel(z.number({ error: 'Vul een getal in' }).int('Geheel getal').min(0).max(300).nullable()),
  opmerking: leegNaarNull(z.string().trim().max(300, 'Hooguit 300 tekens')),
});
export type Vehicle = z.output<typeof vehicleSchema>;

/** Body van POST /api/vehicles en PUT /api/vehicles/:id (id komt uit het pad). */
export const vehicleBodySchema = vehicleSchema.omit({ id: true });
export type VehicleBody = z.output<typeof vehicleBodySchema>;

/** Wat een chauffeur/technieker van een voertuig ziet (keuzelijst in de defectmelding). */
export const vehicleKortSchema = vehicleSchema.pick({ id: true, busnr: true, kortNr: true, nummerplaat: true, type: true, status: true });
export type VehicleKort = z.output<typeof vehicleKortSchema>;

/** Body van POST /api/defecten (iedereen die ingelogd is). */
export const defectMeldingBodySchema = z.object({
  vehicleId: z.string({ error: 'Kies een bus' }).trim().min(1, 'Kies een bus'),
  werktype: z.enum(WERKTYPES, { error: 'Kies een soort' }),
  omschrijving: z.string({ error: 'Beschrijf het probleem' }).trim().min(3, 'Beschrijf het probleem').max(DEFECT_OMSCHRIJVING_MAX, `Hooguit ${DEFECT_OMSCHRIJVING_MAX} tekens`),
});
export type DefectMeldingBody = z.output<typeof defectMeldingBodySchema>;

/** Body van PATCH /api/defecten/:id (technieker/staf; chauffeur alleen status geannuleerd op eigen melding). */
export const defectPatchSchema = z.object({
  status: optioneel(z.enum(DEFECT_STATUSSEN, { error: 'Kies een status' })),
  uitgevoerdOp: leegNaarNull(isoDatum),
  uitgevoerdWerk: leegNaarNull(z.string().trim().max(WERK_OMSCHRIJVING_MAX, `Hooguit ${WERK_OMSCHRIJVING_MAX} tekens`)),
  manuren: optioneel(z.number({ error: 'Vul een getal in' }).min(0, 'Niet negatief').max(999, 'Hooguit 999').nullable()),
  opmerking: leegNaarNull(z.string().trim().max(300, 'Hooguit 300 tekens')),
  werktype: optioneel(z.enum(WERKTYPES, { error: 'Kies een soort' })),
  omschrijving: optioneel(z.string().trim().min(3, 'Beschrijf het probleem').max(DEFECT_OMSCHRIJVING_MAX, `Hooguit ${DEFECT_OMSCHRIJVING_MAX} tekens`)),
});
export type DefectPatch = z.output<typeof defectPatchSchema>;

/** Eén melding uit het gele boek zoals de API hem teruggeeft. */
export const defectSchema = z.object({
  id: z.string(),
  vehicleId: z.string(),
  busnr: z.string(),
  kortNr: optioneel(z.number().nullable()),
  gemeldOp: z.string(),
  gemeldDoor: z.string(),
  gemeldDoorNaam: optioneel(z.string()),
  werktype: z.enum(WERKTYPES),
  omschrijving: z.string(),
  status: z.enum(DEFECT_STATUSSEN),
  uitgevoerdOp: optioneel(z.string().nullable()),
  uitgevoerdDoor: optioneel(z.string().nullable()),
  uitgevoerdDoorNaam: optioneel(z.string()),
  uitgevoerdWerk: optioneel(z.string().nullable()),
  manuren: optioneel(z.number().nullable()),
  opmerking: optioneel(z.string().nullable()),
  updatedAt: optioneel(z.string()),
});
export type Defect = z.output<typeof defectSchema>;

/** Body van POST/PUT /api/werkprestaties. */
export const werkprestatieBodySchema = z.object({
  datum: isoDatum,
  /** null = garage/algemeen. */
  vehicleId: leegNaarNull(z.string().trim()),
  werkcode: z.enum(WERKCODES, { error: 'Kies een werkcode' }),
  omschrijving: z.string({ error: 'Beschrijf het werk' }).trim().min(2, 'Beschrijf het werk').max(WERK_OMSCHRIJVING_MAX, `Hooguit ${WERK_OMSCHRIJVING_MAX} tekens`),
  beginTijd: leegNaarNull(klokTijd),
  eindeTijd: leegNaarNull(klokTijd),
  werkuren: z.number({ error: 'Vul de uren in' }).min(0, 'Niet negatief').max(24, 'Hooguit 24 uur per dag'),
  kmstand: optioneel(z.number({ error: 'Vul een getal in' }).int('Geheel getal').min(0).max(9999999).nullable()),
  defectId: leegNaarNull(z.string().trim()),
  /** Staf mag voor een andere technieker registreren; anders de aanmelder. */
  mecanicienId: optioneel(z.string().trim().min(1)),
});
export type WerkprestatieBody = z.output<typeof werkprestatieBodySchema>;

export const werkprestatieSchema = werkprestatieBodySchema.extend({
  id: z.string(),
  mecanicienId: z.string(),
  mecanicienNaam: optioneel(z.string()),
  busnr: optioneel(z.string().nullable()),
  kortNr: optioneel(z.number().nullable()),
  createdAt: optioneel(z.string()),
});
export type Werkprestatie = z.output<typeof werkprestatieSchema>;

/** Body van PUT /api/vehicles/:id/vervaldata (lege datum = verwijderen). */
export const vehicleExpiryBodySchema = z.object({
  soort: z.enum(VOERTUIG_VERVAL_SOORTEN, { error: 'Onbekende soort vervaldatum' }),
  validUntil: leegNaarNull(isoDatum),
  opmerking: leegNaarNull(z.string().trim().max(120, 'Hooguit 120 tekens')),
});
export type VehicleExpiryBody = z.output<typeof vehicleExpiryBodySchema>;

export const vehicleExpirySchema = z.object({
  vehicleId: z.string(),
  soort: z.enum(VOERTUIG_VERVAL_SOORTEN),
  validUntil: z.string(),
  opmerking: optioneel(z.string().nullable()),
});
export type VehicleExpiry = z.output<typeof vehicleExpirySchema>;
