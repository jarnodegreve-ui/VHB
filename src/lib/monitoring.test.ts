import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_BREADCRUMBS, addBreadcrumb, getBreadcrumbs, getLaatsteReferentie, reportBoundaryError, reportHandledError, reportUserFeedback, resetMonitoring, setMonitoringUser, subscribeReferentie, wisReferentie } from './monitoring';

describe('monitoring: broodkruimels en rapportcontext', () => {
  const fetchMock = vi.fn(async () => ({ ok: true }) as Response);
  beforeEach(() => {
    resetMonitoring();
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockClear();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('houdt hooguit de laatste 10 kruimels bij (ringbuffer)', () => {
    for (let i = 0; i < 14; i++) addBreadcrumb('navigatie', `scherm-${i}`);
    const kruimels = getBreadcrumbs();
    expect(kruimels).toHaveLength(MAX_BREADCRUMBS);
    expect(kruimels[0].tekst).toBe('scherm-4');
    expect(kruimels[9].tekst).toBe('scherm-13');
  });

  it('stuurt release, scherm, rol, online-status en kruimels mee, zonder naam of e-mail', async () => {
    setMonitoringUser('42', 'planner');
    addBreadcrumb('navigatie', 'verlof');
    reportHandledError('Kon het verlof niet laden.');
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.source).toBe('error-toast');
    expect(body.userId).toBe('42');
    expect(body.role).toBe('planner');
    expect(body.view).toBe('verlof');
    expect(typeof body.release).toBe('string');
    expect(typeof body.online).toBe('boolean');
    // De fout-toast zelf staat als laatste kruimel in het rapport.
    expect(body.breadcrumbs.map((b: { soort: string; tekst: string }) => `${b.soort}:${b.tekst}`)).toEqual(['navigatie:verlof', 'fout-toast:Kon het verlof niet laden.']);
    expect(JSON.stringify(body)).not.toMatch(/@|naam|name/i);
  });

  it('bewaart de referentie uit het serverantwoord en meldt luisteraars', async () => {
    fetchMock.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ ok: true, referentie: 'A7F3C1' }) }) as Response);
    const gezien: Array<string | null> = [];
    subscribeReferentie(() => gezien.push(getLaatsteReferentie()));
    reportBoundaryError(new Error('boem'));
    await new Promise((r) => setTimeout(r, 0));
    expect(getLaatsteReferentie()).toBe('A7F3C1');
    expect(gezien).toEqual(['A7F3C1']);
    wisReferentie();
    expect(getLaatsteReferentie()).toBeNull();
  });

  it('toont geen oude referentie als een nieuw rapport niet aankomt (offline), en een gebruikersmelding zet hem niet', async () => {
    fetchMock.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ ok: true, referentie: 'A7F3C1' }) }) as Response);
    reportHandledError('eerste');
    await new Promise((r) => setTimeout(r, 0));
    expect(getLaatsteReferentie()).toBe('A7F3C1');
    fetchMock.mockImplementationOnce(async () => { throw new TypeError('offline'); });
    reportHandledError('tweede');
    await new Promise((r) => setTimeout(r, 0));
    expect(getLaatsteReferentie()).toBeNull();
    fetchMock.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ ok: true, referentie: 'FFFFFF' }) }) as Response);
    expect(await reportUserFeedback('de knop doet niets')).toBe(true);
    expect(getLaatsteReferentie()).toBeNull();
  });
});
