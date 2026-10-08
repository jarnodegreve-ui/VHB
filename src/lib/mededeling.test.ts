import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const apiFetchMock = vi.hoisted(() => vi.fn());
vi.mock('./api', () => ({ apiFetch: apiFetchMock }));

import { _resetMededeling, haalMededeling, useMededeling, zetMededelingLokaal } from './mededeling';

const antwoord = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('mededeling in de browser', () => {
  beforeEach(() => { _resetMededeling(); apiFetchMock.mockReset(); });
  afterEach(() => { vi.useRealTimers(); });

  it('haalt één keer op en deelt het antwoord; een fout geeft geen mededeling en geen uitzondering', async () => {
    apiFetchMock.mockResolvedValue(antwoord({ tekst: 'Nieuwe dienstregeling vanaf 11/12.', tonen: true, tot: null }));
    const [a, b] = await Promise.all([haalMededeling(), haalMededeling()]);
    expect(a).toEqual(b);
    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    await haalMededeling();
    expect(apiFetchMock).toHaveBeenCalledTimes(1);

    _resetMededeling();
    apiFetchMock.mockRejectedValue(new Error('offline'));
    await expect(haalMededeling()).resolves.toEqual({ tekst: '', tonen: false, tot: null });
    apiFetchMock.mockResolvedValue(antwoord({ error: 'nee' }, 500));
    await expect(haalMededeling({ vers: true })).resolves.toEqual({ tekst: '', tonen: false, tot: null });
  });

  it('de hook toont alleen een zichtbare mededeling en volgt een save door de beheerder', async () => {
    apiFetchMock.mockResolvedValue(antwoord({ tekst: 'Vanaf 11/12 nieuwe dienstregeling.', tonen: true, tot: '2999-01-01' }));
    const { result } = renderHook(() => useMededeling());
    await waitFor(() => expect(result.current?.tekst).toBe('Vanaf 11/12 nieuwe dienstregeling.'));
    zetMededelingLokaal({ tekst: 'Uit', tonen: false, tot: null });
    await waitFor(() => expect(result.current).toBeNull());
    zetMededelingLokaal({ tekst: 'Verlopen', tonen: true, tot: '2000-01-01' });
    await waitFor(() => expect(result.current).toBeNull());
  });
});
