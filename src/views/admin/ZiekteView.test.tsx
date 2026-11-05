import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { LeaveRequest, Shift, User } from '../../types';

// Het detailpaneel van een ziekmelding leest het record uit de live lijst
// (controle 04-11, punt 34): stelt een collega intussen de einddatum bij
// (realtime), dan toont het paneel die wijziging. Verdwijnt het record uit
// de lijst, dan blijft de kopie van het openen staan.

const { apiFetchMock } = vi.hoisted(() => ({ apiFetchMock: vi.fn() }));
vi.mock('../../lib/api', () => ({
  apiFetch: apiFetchMock,
  apiJson: async (url: string, init?: RequestInit) => (await apiFetchMock(url, init)).json(),
}));

import { ZiekteView } from './ZiekteView';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const PLANNER = { id: 'p1', name: 'Pieter Planner', role: 'planner', isActive: true } as User;
const CHAUFFEUR = { id: 'c1', name: 'Chauffeur A', role: 'chauffeur', isActive: true } as User;
const ZIEK = { id: 'z1', userId: 'c1', type: 'ziekte', status: 'approved', startDate: '2026-11-02', endDate: '2026-11-06', createdAt: '2026-11-02T06:00:00.000Z' } as LeaveRequest;

const toon = (leaveRequests: LeaveRequest[]) => (
  <ZiekteView user={PLANNER} users={[PLANNER, CHAUFFEUR]} leaveRequests={leaveRequests} shifts={[] as Shift[]} onSickReport={vi.fn().mockResolvedValue(true)} onSave={vi.fn().mockResolvedValue(true)} />
);

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-05T10:00:00+01:00'), toFake: ['Date'] });
  apiFetchMock.mockReset();
  apiFetchMock.mockImplementation(async () => Response.json({ reeksen: [] }));
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Ziekte: het detail volgt de live lijst', () => {
  it('toont de bijgestelde einddatum van een collega, en houdt de kopie als het record verdwijnt', async () => {
    const { rerender } = render(toon([ZIEK]));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Bekijk ziekmelding van Chauffeur A/ })); });
    const dialoog = await screen.findByRole('dialog');
    expect(dialoog.textContent).toContain('t/m vrijdag 6 november');

    // Een collega verlengt de ziekte: de lijst (props) verandert, het paneel ook.
    rerender(toon([{ ...ZIEK, endDate: '2026-11-10' }]));
    expect(screen.getByRole('dialog').textContent).toContain('t/m dinsdag 10 november');

    // Het record is weg (verwijderd door een collega): het paneel klapt niet dicht.
    rerender(toon([]));
    expect(screen.getByRole('dialog').textContent).toContain('t/m dinsdag 10 november');
  });
});
