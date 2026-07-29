// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { sanitizeIncomingUser, toPublicUser, toDatabaseUser } from '../api/helpers';

/**
 * wantsSystemMail (systeemmail-opt-out voor admins) passeert drie
 * opsommende lagen: input-sanitizer → public-mapper → db-mapper. Eén
 * vergeten laag en de voorkeur verdwijnt stil bij het opslaan — exact de
 * bug die de loopnummers gisteren trof (#239).
 */
const BASE = { id: '1', name: 'Admin', role: 'admin' as const, employeeId: 'VHB-1' };

describe('wantsSystemMail overleeft de volledige rondgang', () => {
  it('uitgezet → blijft false door alle lagen heen', () => {
    const db = toDatabaseUser(sanitizeIncomingUser({ ...BASE, wantsSystemMail: false }));
    expect(db.wantssystemmail).toBe(false);
    expect(toPublicUser({ ...BASE, wantssystemmail: false }).wantsSystemMail).toBe(false);
  });

  it('niet opgegeven → default true (bestaande admins blijven mails krijgen)', () => {
    const db = toDatabaseUser(sanitizeIncomingUser({ ...BASE }));
    expect(db.wantssystemmail).toBe(true);
    expect(toPublicUser(BASE).wantsSystemMail).toBe(true);
  });
});
