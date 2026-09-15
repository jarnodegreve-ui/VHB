import { describe, expect, it } from 'vitest';
import type { User } from '../types';
import { adminMailto, maandplanningParams, ziekmeldMailTekst } from './uitweg';

const u = (o: Partial<User>): User => ({ id: '1', name: 'X', role: 'chauffeur', employeeId: 'E', ...o });

describe('uitweg', () => {
  it('mailt alleen actieve admins met een adres', () => {
    const users = [u({ id: '1', role: 'admin', email: 'a@vhb.be' }), u({ id: '2', role: 'admin', email: 'b@vhb.be', isActive: false }), u({ id: '3', role: 'admin' }), u({ id: '4', role: 'planner', email: 'p@vhb.be' })];
    const href = adminMailto(users, 'Onderwerp met spatie', 'regel 1\nregel 2');
    expect(href).toBe('mailto:a@vhb.be?subject=Onderwerp%20met%20spatie&body=regel%201%0Aregel%202');
    expect(adminMailto([u({ role: 'planner', email: 'p@vhb.be' })], 'x', 'y')).toBeUndefined();
  });
  it('bouwt de maandplanning-parameters uit een datum', () => {
    expect(maandplanningParams('2026-09-16')).toEqual(['2026-09', '2026-09-16']);
  });
  it('zet de diensten met deeplink in de mailtekst', () => {
    const t = ziekmeldMailTekst('An', [{ date: '2026-09-16', nummer: '2601' }], 'https://vhbportaal.com');
    expect(t).toContain('- 2026-09-16: dienst 2601 (https://vhbportaal.com/maandplanning/2026-09/2026-09-16)');
  });
});
