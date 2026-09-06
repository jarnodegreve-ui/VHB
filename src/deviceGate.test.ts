import { describe, it, expect } from 'vitest';
import { evaluateDeviceGate, isMissingTableError } from '../api/deviceGate';

const approved = { status: 'approved' };
const pending = { status: 'pending' };
const revoked = { status: 'revoked' };

describe('evaluateDeviceGate', () => {
  it('laat planner en admin altijd door (geen toestelcontrole)', () => {
    expect(evaluateDeviceGate('planner', '/api/planning', null).allow).toBe(true);
    expect(evaluateDeviceGate('admin', '/api/planning', null).allow).toBe(true);
  });

  it('laat chauffeurs door op de exempt-paden zonder toestel', () => {
    expect(evaluateDeviceGate('chauffeur', '/api/devices/register', null).allow).toBe(true);
    expect(evaluateDeviceGate('chauffeur', '/api/auth/session', null).allow).toBe(true);
  });

  it('blokkeert een chauffeur zonder toestel met device_unknown', () => {
    const v = evaluateDeviceGate('chauffeur', '/api/planning', null);
    expect(v.allow).toBe(false);
    expect(v.status).toBe(403);
    expect(v.body?.code).toBe('device_unknown');
  });

  it('laat een goedgekeurd toestel door, blokkeert pending/revoked met de juiste code', () => {
    expect(evaluateDeviceGate('chauffeur', '/api/planning', approved).allow).toBe(true);
    expect(evaluateDeviceGate('chauffeur', '/api/planning', pending).body?.code).toBe('device_pending');
    expect(evaluateDeviceGate('chauffeur', '/api/planning', revoked).body?.code).toBe('device_revoked');
  });
});

describe('isMissingTableError', () => {
  it('herkent de ontbrekende-tabel-fouten (fail-open-signaal)', () => {
    expect(isMissingTableError({ code: '42P01' })).toBe(true);
    expect(isMissingTableError({ code: 'PGRST205' })).toBe(true);
    expect(isMissingTableError({ message: 'relation "user_devices" does not exist' })).toBe(true);
    expect(isMissingTableError({ message: 'Could not find the table' })).toBe(true);
  });

  it('behandelt andere DB-fouten NIET als ontbrekende tabel (fail-closed)', () => {
    expect(isMissingTableError({ code: '08006', message: 'connection failure' })).toBe(false);
    expect(isMissingTableError(null)).toBe(false);
    expect(isMissingTableError(new Error('timeout'))).toBe(false);
  });
});

describe('evaluateDeviceGate met de schakelaar uit (gateEnabled=false)', () => {
  it('laat onbekende en wachtende toestellen door', () => {
    expect(evaluateDeviceGate('chauffeur', '/api/planning', null, false).allow).toBe(true);
    expect(evaluateDeviceGate('chauffeur', '/api/planning', { status: 'pending' }, false).allow).toBe(true);
  });

  it('houdt een GEBLOKKEERD toestel ook dan tegen, de schakelaar heropent geen gestolen telefoon', () => {
    const verdict = evaluateDeviceGate('chauffeur', '/api/planning', { status: 'revoked' }, false);
    expect(verdict.allow).toBe(false);
    expect(verdict.body?.code).toBe('device_revoked');
  });

  it('default (parameter weggelaten) blijft de strenge stand', () => {
    expect(evaluateDeviceGate('chauffeur', '/api/planning', null).allow).toBe(false);
  });
});
