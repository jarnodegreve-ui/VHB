import { describe, expect, it } from 'vitest';
import { isVeiligeFouttekst, schrijffout } from './fouten';

/** Alleen client-safe servertekst in beeld (3D.2, Jarno 23-09). */
describe('schrijffout toont alleen een veilige servertekst', () => {
  it('een geschreven gebruikerszin komt erdoor', () => {
    for (const t of ['Diensten verwijderen is alleen beschikbaar voor admins.', 'Onvoldoende rechten.', 'Niet toegestaan: je kan alleen voor jezelf verlof aanvragen.', 'Deze update bestaat niet meer.']) {
      expect(isVeiligeFouttekst(t), t).toBe(true);
    }
  });

  it('technische tekst niet: database, stack, JSON, implementatie', () => {
    for (const t of [
      'duplicate key value violates unique constraint "services_pkey"',
      'relation "user_devices" does not exist',
      'TypeError: Cannot read properties of undefined (reading \'id\')',
      'at requireRole (/var/task/api/middleware.js:413:5)',
      '{"code":"PGRST116","message":"JSON object requested"}',
      'Supabase error 42501: permission denied for table services',
      'x'.repeat(241),
    ]) {
      expect(isVeiligeFouttekst(t), t).toBe(false);
    }
  });

  it('een 403 met technische tekst valt terug op de veilige melding met vervolgstap', () => {
    const fout = Object.assign(new Error('permission denied for relation services'), { status: 403 });
    expect(schrijffout('Verwijderen van dienst 2515', fout)).toBe('Verwijderen van dienst 2515 is mislukt. Je hebt hiervoor geen rechten. Vraag de planning als dat niet klopt.');
  });
});
