import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { DiversionRecord, IncomingUser } from '../../api/types';
import type { Diversion, Update, User } from '../../src/types';
import {
  diversionBodySchema,
  diversionSchema,
  leesbareVeldfout,
  nieuweUserFormulierSchema,
  updateBodySchema,
  updateSchema,
  userBodySchema,
  userFormulierSchema,
  userLijstSchema,
  userSchema,
  valideer,
  veldfoutenVan,
  WACHTWOORD_MIN,
  type GevalideerdeDiversion,
  type GevalideerdeUpdate,
  type GevalideerdeUser,
} from './index';

/**
 * Gedeelde API-contracten: (1) de afgeleide types zijn veld-voor-veld gelijk
 * aan api/types.ts én src/types.ts — drift faalt op `tsc` (en dus in CI);
 * (2) geldige en ongeldige voorbeelden met de Nederlandse teksten per veld.
 */

// --- (1) Type-drift: beide richtingen toewijsbaar met Required<> = exact dezelfde velden + types.
type UserDraft = User & { password?: string };
const schemaNaarApiUser = (u: Required<GevalideerdeUser>): Required<IncomingUser> => u;
const apiNaarSchemaUser = (u: Required<IncomingUser>): Required<GevalideerdeUser> => u;
const schemaNaarClientUser = (u: Required<GevalideerdeUser>): Required<UserDraft> => u;
const clientNaarSchemaUser = (u: Required<UserDraft>): Required<GevalideerdeUser> => u;

const schemaNaarApiDiversion = (d: Required<GevalideerdeDiversion>): Required<DiversionRecord> => d;
const apiNaarSchemaDiversion = (d: Required<DiversionRecord>): Required<GevalideerdeDiversion> => d;
const schemaNaarClientDiversion = (d: Required<GevalideerdeDiversion>): Required<Diversion> => d;
const clientNaarSchemaDiversion = (d: Required<Diversion>): Required<GevalideerdeDiversion> => d;

const schemaNaarClientUpdate = (u: Required<GevalideerdeUpdate>): Required<Update> => u;
const clientNaarSchemaUpdate = (u: Required<Update>): Required<GevalideerdeUpdate> => u;

describe('type-drift: schema-types ↔ api/types ↔ src/types', () => {
  it('User/IncomingUser', () => {
    for (const fn of [schemaNaarApiUser, apiNaarSchemaUser, schemaNaarClientUser, clientNaarSchemaUser]) expect(typeof fn).toBe('function');
  });
  it('Diversion/DiversionRecord', () => {
    for (const fn of [schemaNaarApiDiversion, apiNaarSchemaDiversion, schemaNaarClientDiversion, clientNaarSchemaDiversion]) expect(typeof fn).toBe('function');
  });
  it('Update', () => {
    for (const fn of [schemaNaarClientUpdate, clientNaarSchemaUpdate]) expect(typeof fn).toBe('function');
  });
});

// --- (2) Gedrag.
const geldigeUser = {
  id: 'u-1', name: 'Jan Janssen', role: 'chauffeur', employeeId: 'VHB-12',
  email: 'jan@voorbeeld.be', phone: '0470 11 22 33', isActive: true, verlofBudget: 24, startDate: '2020-03-01',
};

describe('userSchema', () => {
  it('accepteert een volledig record; null en lege tekst worden undefined', () => {
    const r = valideer(userSchema, { ...geldigeUser, phone: null, section: '', lastLogin: null, password: '' });
    expect(r.ok).toBe(true);
    if (r.ok === false) return;
    expect(r.data.phone).toBeUndefined();
    expect(r.data.section).toBeUndefined();
    expect(r.data.password).toBeUndefined();
    expect(r.data.email).toBe('jan@voorbeeld.be');
  });

  it('vult rol en personeelsnummer met dezelfde defaults als de server', () => {
    const r = valideer(userSchema, { id: 'x', name: 'A' });
    expect(r).toEqual({ ok: true, data: { id: 'x', name: 'A', role: 'chauffeur', employeeId: '' } });
  });

  it('geeft per veld één Nederlandse tekst', () => {
    const r = valideer(userSchema, {
      id: 'x', name: '  ', role: 'baas', email: 'jan@', phone: 'bel me', password: 'kort',
      verlofBudget: -1, startDate: '2026-02-30',
    });
    expect(r.ok).toBe(false);
    if (r.ok === true) return;
    expect(r.fouten).toEqual({
      name: 'Vul een naam in',
      role: 'Kies een rol',
      email: 'Vul een geldig e-mailadres in',
      phone: 'Vul een geldig telefoonnummer in',
      password: `Gebruik een wachtwoord van minstens ${WACHTWOORD_MIN} tekens`,
      verlofBudget: 'Verlofbudget kan niet negatief zijn',
      startDate: 'Vul een datum in als JJJJ-MM-DD',
    });
  });

  it('naam ontbreekt → dezelfde tekst als een lege naam', () => {
    const r = valideer(userSchema, { id: 'x' });
    expect(r.ok === false && r.fouten.name).toBe('Vul een naam in');
  });

  it('telefoon: internationale en Belgische schrijfwijzen zijn goed, letters niet', () => {
    for (const phone of ['+32 470 11 22 33', '0470/11.22.33', '(0)470-112233']) {
      expect(valideer(userSchema, { ...geldigeUser, phone }).ok).toBe(true);
    }
    expect(valideer(userSchema, { ...geldigeUser, phone: '12345' }).ok).toBe(false);
  });

  it('verlofbudget moet een geheel aantal dagen zijn', () => {
    const r = valideer(userSchema, { ...geldigeUser, verlofBudget: 24.5 });
    expect(r.ok === false && r.fouten.verlofBudget).toBe('Vul een geheel aantal dagen in');
  });

  it('userBodySchema (server): id optioneel, verder gelijk', () => {
    expect(valideer(userBodySchema, { name: 'A', email: 'a@b.be' }).ok).toBe(true);
    const r = valideer(userBodySchema, { name: 'A', password: 'kort' });
    expect(r.ok === false && r.fouten.password).toContain(`${WACHTWOORD_MIN} tekens`);
  });

  it('userLijstSchema: sleutels per rij (index.veld)', () => {
    const r = valideer(userLijstSchema, [geldigeUser, { ...geldigeUser, id: 'u-2', email: 'fout' }]);
    expect(r.ok === false && r.fouten).toEqual({ '1.email': 'Vul een geldig e-mailadres in' });
  });

  it('formulier: e-mail verplicht; nieuwe gebruiker: tijdelijk wachtwoord verplicht', () => {
    const bewerk = valideer(userFormulierSchema, { ...geldigeUser, email: '' });
    expect(bewerk.ok === false && bewerk.fouten).toEqual({ email: 'Vul een e-mailadres in' });
    const nieuw = valideer(nieuweUserFormulierSchema, { ...geldigeUser, password: '' });
    expect(nieuw.ok === false && nieuw.fouten).toEqual({ password: 'Vul een tijdelijk wachtwoord in' });
    const teKort = valideer(nieuweUserFormulierSchema, { ...geldigeUser, password: 'kort' });
    expect(teKort.ok === false && teKort.fouten.password).toBe(`Gebruik een tijdelijk wachtwoord van minstens ${WACHTWOORD_MIN} tekens`);
    expect(valideer(nieuweUserFormulierSchema, { ...geldigeUser, password: 'lang-genoeg' }).ok).toBe(true);
  });
});

describe('diversionSchema', () => {
  const geldig = { id: 'o-1', line: '12', title: 'Werken N70', description: 'Omrijden via …', startDate: '2026-07-01', endDate: '2026-07-31' };

  it('accepteert een omleiding met en zonder einddatum', () => {
    expect(valideer(diversionSchema, geldig).ok).toBe(true);
    const zonder = valideer(diversionSchema, { ...geldig, endDate: '', pdfUrl: null });
    expect(zonder.ok && zonder.data.endDate).toBeUndefined();
  });

  it('einddatum vóór begindatum → fout bij einddatum', () => {
    const r = valideer(diversionSchema, { ...geldig, endDate: '2026-06-30' });
    expect(r.ok === false && r.fouten).toEqual({ endDate: 'Einddatum ligt vóór begindatum' });
    expect(valideer(diversionSchema, { ...geldig, endDate: '2026-07-01' }).ok).toBe(true);
  });

  it('datums moeten JJJJ-MM-DD zijn; titel, lijn en omschrijving verplicht', () => {
    const r = valideer(diversionSchema, { id: 'o', line: '', title: ' ', description: '', startDate: '10/09/2026', endDate: '2026-13-01' });
    expect(r.ok === false && r.fouten).toEqual({
      line: 'Vul een lijn in',
      title: 'Vul een titel in',
      description: 'Vul een omschrijving in',
      startDate: 'Vul een startdatum in als JJJJ-MM-DD',
      endDate: 'Vul een einddatum in als JJJJ-MM-DD',
    });
  });

  it('diversionBodySchema (server): id optioneel, datumregel blijft', () => {
    expect(valideer(diversionBodySchema, { line: '1', title: 'X', description: 'y', startDate: '2026-09-10' }).ok).toBe(true);
    const r = valideer(diversionBodySchema, { line: '1', title: 'X', description: 'y', startDate: '2026-09-10', endDate: '2026-09-01' });
    expect(r.ok === false && r.fouten.endDate).toBe('Einddatum ligt vóór begindatum');
  });
});

describe('updateSchema', () => {
  it('accepteert de nl-BE-datum van de UI en een ISO-dag', () => {
    expect(valideer(updateSchema, { id: '1', date: '3/9/2026', title: 'T', content: 'C', category: 'algemeen', isUrgent: false }).ok).toBe(true);
    const r = valideer(updateSchema, { id: '1', date: '2026-09-03', title: 'T', content: 'C', category: null, isUrgent: null });
    expect(r.ok && r.data).toEqual({ id: '1', date: '2026-09-03', title: 'T', content: 'C' });
  });

  it('titel en inhoud verplicht, categorie uit de vaste lijst', () => {
    const r = valideer(updateSchema, { id: '1', date: '2026-09-03', title: '', content: '  ', category: 'x' });
    expect(r.ok === false && r.fouten).toEqual({ title: 'Vul een titel in', content: 'Schrijf een bericht', category: 'Onbekende categorie' });
  });

  it('updateBodySchema (server): id optioneel', () => {
    expect(valideer(updateBodySchema, { date: '2026-09-03', title: 'T', content: 'C' }).ok).toBe(true);
    expect(valideer(updateBodySchema, { date: '2026-09-03', title: 'T' }).ok).toBe(false);
  });
});

describe('basis: foutteksten', () => {
  it('veldfoutenVan: eerste tekst per veld, wortelfouten onder "_"', () => {
    const s = z.object({ a: z.string().min(1, 'eerste').min(2, 'tweede') });
    const r = s.safeParse({ a: '' });
    expect(r.success).toBe(false);
    if (r.success === true) return;
    expect(veldfoutenVan(r.error)).toEqual({ a: 'eerste' });
    const wortel = z.object({}).safeParse('geen object');
    expect(wortel.success === false && veldfoutenVan(wortel.error)).toEqual({ _: expect.any(String) });
  });

  it('checks zonder eigen tekst vallen terug op Nederlands', () => {
    const r = valideer(z.object({ a: z.string(), b: z.number() }), { b: 'x' });
    expect(r.ok === false && r.fouten).toEqual({ a: 'Dit veld is verplicht', b: 'Ongeldige waarde' });
  });

  it('leesbareVeldfout gebruikt het NL-label van het veld', () => {
    expect(leesbareVeldfout('email', 'Vul een geldig e-mailadres in')).toBe('e-mailadres: Vul een geldig e-mailadres in');
    expect(leesbareVeldfout('3.endDate', 'Einddatum ligt vóór begindatum')).toBe('einddatum: Einddatum ligt vóór begindatum');
    expect(leesbareVeldfout('_', 'Ongeldig formaat')).toBe('Ongeldig formaat');
  });
});
