import { describe, it, expect } from 'vitest';
import type { LeaveRequest, User } from '../types';
import {
  canApproveLeave,
  canCancelLeave,
  canWithdrawOwnLeave,
  canDecideSwap,
  canRespondToSwap,
  canManagePlanning,
  canManageUsers,
  canPostUpdates,
  canSubmitLeaveFor,
  canViewActivityLog,
  isAdmin,
  isChauffeur,
  isPlanner,
  isPlannerOrAdmin,
} from './authorization';

const mk = (role: User['role'], id = 'u1'): User => ({
  id,
  name: `Test ${role}`,
  role,
  employeeId: 'E001',
});

const chauffeur = mk('chauffeur', 'driver-1');
const planner = mk('planner', 'planner-1');
const admin = mk('admin', 'admin-1');

const pendingLeave: LeaveRequest = {
  id: 'l1',
  userId: 'driver-1',
  startDate: '2026-07-01',
  endDate: '2026-07-05',
  type: 'betaald_verlof',
  status: 'pending',
  createdAt: new Date('2026-06-01').toISOString(),
};

describe('authorization — basis-predicaten', () => {
  it('herkent rollen correct', () => {
    expect(isChauffeur(chauffeur)).toBe(true);
    expect(isPlanner(planner)).toBe(true);
    expect(isAdmin(admin)).toBe(true);

    expect(isChauffeur(planner)).toBe(false);
    expect(isPlanner(admin)).toBe(false);
    expect(isAdmin(chauffeur)).toBe(false);
  });

  it('null/undefined → altijd false', () => {
    expect(isChauffeur(null)).toBe(false);
    expect(isPlanner(undefined)).toBe(false);
    expect(isAdmin(null)).toBe(false);
    expect(isPlannerOrAdmin(null)).toBe(false);
  });

  it('planner OR admin', () => {
    expect(isPlannerOrAdmin(planner)).toBe(true);
    expect(isPlannerOrAdmin(admin)).toBe(true);
    expect(isPlannerOrAdmin(chauffeur)).toBe(false);
  });
});

describe('authorization — verlof', () => {
  it('alleen planner/admin keurt verlof goed', () => {
    expect(canApproveLeave(chauffeur)).toBe(false);
    expect(canApproveLeave(planner)).toBe(true);
    expect(canApproveLeave(admin)).toBe(true);
  });

  it('chauffeurs mogen NIET zelf verlof annuleren (must go via planner/admin)', () => {
    // Dit is een expliciete VHB-regel: rij- en rusttijden moeten gechecked
    // worden, dus altijd via planner/admin.
    expect(canCancelLeave(chauffeur, pendingLeave)).toBe(false);
    expect(canCancelLeave(planner, pendingLeave)).toBe(true);
    expect(canCancelLeave(admin, pendingLeave)).toBe(true);
  });

  it('chauffeur mag z\'n EIGEN pending aanvraag intrekken, niet die van een ander', () => {
    expect(canWithdrawOwnLeave(chauffeur, pendingLeave)).toBe(true); // pendingLeave.userId === driver-1
    const andersPending: LeaveRequest = { ...pendingLeave, userId: 'driver-2' };
    expect(canWithdrawOwnLeave(chauffeur, andersPending)).toBe(false);
  });

  it('intrekken mag NIET voor goedgekeurd/afgewezen verlof (alleen pending)', () => {
    const approved: LeaveRequest = { ...pendingLeave, status: 'approved' };
    const rejected: LeaveRequest = { ...pendingLeave, status: 'rejected' };
    expect(canWithdrawOwnLeave(chauffeur, approved)).toBe(false);
    expect(canWithdrawOwnLeave(chauffeur, rejected)).toBe(false);
  });

  it('planner/admin mag elke pending aanvraag intrekken', () => {
    const andersPending: LeaveRequest = { ...pendingLeave, userId: 'driver-2' };
    expect(canWithdrawOwnLeave(planner, andersPending)).toBe(true);
    expect(canWithdrawOwnLeave(admin, andersPending)).toBe(true);
  });

  it('chauffeur dient alleen voor zichzelf in', () => {
    expect(canSubmitLeaveFor(chauffeur, 'driver-1')).toBe(true);
    expect(canSubmitLeaveFor(chauffeur, 'driver-2')).toBe(false);
    expect(canSubmitLeaveFor(planner, 'driver-2')).toBe(true);
    expect(canSubmitLeaveFor(admin, 'driver-2')).toBe(true);
  });
});

describe('authorization — beheer', () => {
  it('alleen admin beheert gebruikers + activiteit', () => {
    expect(canManageUsers(chauffeur)).toBe(false);
    expect(canManageUsers(planner)).toBe(false);
    expect(canManageUsers(admin)).toBe(true);

    expect(canViewActivityLog(chauffeur)).toBe(false);
    expect(canViewActivityLog(planner)).toBe(false);
    expect(canViewActivityLog(admin)).toBe(true);
  });

  it('planner+admin beheren planning/omleidingen/updates/swaps', () => {
    expect(canManagePlanning(chauffeur)).toBe(false);
    expect(canManagePlanning(planner)).toBe(true);
    expect(canManagePlanning(admin)).toBe(true);

    expect(canPostUpdates(chauffeur)).toBe(false);
    expect(canPostUpdates(planner)).toBe(true);

    expect(canDecideSwap(chauffeur)).toBe(false);
    expect(canDecideSwap(planner)).toBe(true);
  });

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
