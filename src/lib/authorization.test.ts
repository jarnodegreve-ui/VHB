import { describe, it, expect } from 'vitest';
import type { User } from '../types';
import { canRespondToSwap } from './authorization';

const mk = (role: User['role'], id = 'u1'): User => ({
  id,
  name: `Test ${role}`,
  role,
  employeeId: 'E001',
});

describe('authorization', () => {
  it('canRespondToSwap: alleen de aangeduide collega op een pending ruil', () => {
    const target = mk('chauffeur', 'u-target');
    const requester = mk('chauffeur', 'u-req');
    const other = mk('chauffeur', 'u-other');
    const swap = { status: 'pending' as const, requesterId: 'u-req', targetDriverId: 'u-target' };

    expect(canRespondToSwap(target, swap)).toBe(true);
    expect(canRespondToSwap(requester, swap)).toBe(false); // niet je eigen verzoek
    expect(canRespondToSwap(other, swap)).toBe(false); // niet aan jou gericht
    expect(canRespondToSwap(target, { ...swap, status: 'accepted' })).toBe(false); // al beantwoord
    expect(canRespondToSwap(null, swap)).toBe(false);
  });
});
