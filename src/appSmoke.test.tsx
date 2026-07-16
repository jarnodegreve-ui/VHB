/**
 * Render-smoke-test: start de volledige app (jsdom) met een ingelogde
 * admin-sessie en gemockte fetches, en controleert dat het dashboard
 * verschijnt zónder fout-toasts.
 *
 * Dit is het vangnet voor client-bugs die de API-integratietests niet zien —
 * de oneindige-recursie in beginLoading/endLoading (juni 2026) crashte elke
 * fetch en vulde het scherm met fout-toasts; precies dat faalt hier.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeAll } from 'vitest';

vi.mock('./lib/supabase', () => {
  const session = {
    access_token: 'tok-test',
    user: { id: 'auth-admin', email: 'admin@vhb.be' },
  };
  return {
    isSupabaseConfigured: true,
    supabase: {
      auth: {
        getSession: async () => ({ data: { session } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        signOut: async () => ({ error: null }),
      },
      channel: () => {
        const chain: any = { on: () => chain, subscribe: () => chain };
        return chain;
      },
      removeChannel: () => {},
    },
  };
});

const ADMIN = {
  id: '1',
  name: 'Annelies Admin',
  email: 'admin@vhb.be',
  role: 'admin',
  isActive: true,
};

const okJson = (body: unknown): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  }) as unknown as Response;

const fetchCalls: string[] = [];

beforeAll(() => {
  // jsdom mist een aantal browser-API's die de UI gebruikt.
  window.matchMedia = window.matchMedia ?? (((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia);
  (globalThis as any).ResizeObserver = (globalThis as any).ResizeObserver ?? class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  (globalThis as any).IntersectionObserver = (globalThis as any).IntersectionObserver ?? class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };

  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
    fetchCalls.push(path);
    switch (path) {
      case '/api/me':
        return okJson(ADMIN);
      case '/api/users':
        return okJson([ADMIN]);
      case '/api/coverage-gaps':
        return okJson({ from: '2026-06-12', to: '2026-06-18', weekdays: [], days: [] });
      case '/api/auth/session':
        return okJson({ success: true });
      case '/api/planning-matrix/changes-since-import':
        return okJson({ changes: [], lastImport: null });
      default:
        // Alle collectie-GET's (planning, services, diversions, updates,
        // swaps, leave, planning-codes, matrix, history, activity) → leeg.
        return okJson([]);
    }
  }));
});

describe('app smoke test', () => {
  it('rendert het dashboard voor een ingelogde admin zonder fout-toasts', async () => {
    const { default: App } = await import('./App');
    render(<App />);

    // Operations Center verschijnt zodra profiel + data geladen zijn.
    // ('Systeemstatus' is bewust verwijderd in de design-review — de snelle
    // acties zijn het stabiele altijd-zichtbare ankerpunt.)
    expect(await screen.findByText('Aandacht vereist', undefined, { timeout: 5000 })).toBeTruthy();
    expect(await screen.findByText('Planning importeren', undefined, { timeout: 5000 })).toBeTruthy();

    // Alle boot-fetches zijn daadwerkelijk uitgevoerd...
    for (const endpoint of ['/api/me', '/api/planning', '/api/services', '/api/diversions', '/api/updates', '/api/swaps', '/api/leave']) {
      expect(fetchCalls).toContain(endpoint);
    }

    // ...en geen enkele flow brak: fout-toasts beginnen altijd met
    // 'Kon ...' (laden) of bevatten 'mislukt' (opslaan).
    expect(screen.queryByText(/mislukt/i)).toBeNull();
    expect(screen.queryByText(/^Kon /)).toBeNull();
  });
});
