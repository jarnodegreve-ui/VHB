import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { valideer, veldfoutenUitAntwoord } from './valideer';
import { userFormulierSchema } from '../../shared/schemas/user';

describe('valideer (client)', () => {
  it('geeft { ok: true, data } met de genormaliseerde waarden', () => {
    const r = valideer(userFormulierSchema, { id: 'u', name: ' Jan ', email: 'jan@voorbeeld.be', phone: '' });
    expect(r).toEqual({ ok: true, data: { id: 'u', name: 'Jan', role: 'chauffeur', employeeId: '', email: 'jan@voorbeeld.be' } });
  });

  it('geeft { ok: false, fouten } met één NL-tekst per veld', () => {
    const r = valideer(userFormulierSchema, { id: 'u', name: '', email: 'nee' });
    expect(r).toEqual({ ok: false, fouten: { name: 'Vul een naam in', email: 'Vul een geldig e-mailadres in' } });
  });

  it('werkt met elk zod-schema, ook met refine-paden', () => {
    const s = z.object({ van: z.string(), tot: z.string() }).refine((d) => d.tot >= d.van, { path: ['tot'], message: 'Einddatum ligt vóór begindatum' });
    expect(valideer(s, { van: '2026-09-10', tot: '2026-09-01' })).toEqual({ ok: false, fouten: { tot: 'Einddatum ligt vóór begindatum' } });
  });
});

describe('veldfoutenUitAntwoord', () => {
  it('haalt de veldfouten uit een 400 "Ongeldige invoer"', () => {
    expect(veldfoutenUitAntwoord({ error: 'Ongeldige invoer', details: 'e-mailadres: …', veldfouten: { email: 'Vul een geldig e-mailadres in' } }))
      .toEqual({ email: 'Vul een geldig e-mailadres in' });
  });

  it('negeert antwoorden zonder (bruikbare) veldfouten', () => {
    expect(veldfoutenUitAntwoord({ error: 'Opslaan is mislukt.' })).toBeNull();
    expect(veldfoutenUitAntwoord({ veldfouten: [] })).toBeNull();
    expect(veldfoutenUitAntwoord({ veldfouten: { email: 42, name: '' } })).toBeNull();
    expect(veldfoutenUitAntwoord(null)).toBeNull();
    expect(veldfoutenUitAntwoord(undefined)).toBeNull();
  });
});
