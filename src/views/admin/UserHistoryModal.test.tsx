import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import type { LeaveRequest, Shift, SwapRequest, User } from '../../types';

// Nulmeting (ronde 6, punt 19, PR 1): de historiek die het rijmenu van
// Gebruikers opent ("Verlof- en dienstruilhistoriek"), zoals ze vandaag is,
// vóór ze de persoonskaart wordt. Een assert met "nulmeting: PR 2 zet dit
// recht" beschrijft een gebrek dat PR 2 bewust rechtzet en daar dus flipt;
// elke andere assert blijft in PR 2 groen.

const { apiJson, apiFetch, apiLijst, server } = vi.hoisted(() => {
  const server = {
    /** Het archief antwoordt pas als deze belofte rond is (zo is de laadstaat te zien). */
    archiefVrij: Promise.resolve(),
    archief: {} as Record<string, unknown>,
  };
  // Eén stand-in voor de server achter alle drie de ingangen van src/lib/api.
  // Geen van de drie roept een andere aan, zodat elk verzoek precies één keer telt.
  const antwoord = async (url: string): Promise<Response> => {
    if (url.startsWith('/api/swaps/archief?')) {
      await server.archiefVrij;
      return Response.json(server.archief);
    }
    return Response.json({ error: 'Niet gevonden.' }, { status: 404 });
  };
  const fout = (response: Response) => Object.assign(new Error('Niet gevonden.'), { status: response.status });
  return {
    server,
    apiFetch: vi.fn((url: RequestInfo | URL) => antwoord(String(url))),
    apiJson: vi.fn(async (url: string) => {
      const response = await antwoord(url);
      if (!response.ok) throw fout(response);
      return response.json();
    }),
    apiLijst: vi.fn(async (url: string) => {
      const response = await antwoord(url);
      if (!response.ok) throw fout(response);
      return { response, data: await response.json() };
    }),
  };
});
vi.mock('../../lib/api', async (importOriginal) => ({ ...await importOriginal<typeof import('../../lib/api')>(), apiJson, apiFetch, apiLijst }));

import { UserHistoryModal } from './UserHistoryModal';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Vaste klok: zaterdag 14 november 2026, 10:00 in Brussel. */
const NU = new Date('2026-11-14T10:00:00');

const PERSOON: User = { id: '3', name: 'Chauffeur A', role: 'chauffeur', employeeId: '1043', isActive: true };
const COLLEGA: User = { id: '8', name: 'Chauffeur B', role: 'chauffeur', employeeId: '1077', isActive: true };

const rij = (id: string, date: string, line: string, startTime: string, endTime: string, driverId = PERSOON.id): Shift =>
  ({ id, date, line, startTime, endTime, busNumber: '', loopnr: '', driverId });

const DIENSTEN: Shift[] = [
  // Voorbij: een gesplitste dienst, twee rijen met hetzelfde dienstnummer.
  rij('p1', '2026-11-04', '2116', '06:45', '10:00'),
  rij('p2', '2026-11-04', '2116', '15:45', '19:35'),
  // Komend: een gewone dienst en een gesplitste.
  rij('k1', '2026-11-17', '2214', '06:00', '14:12'),
  rij('k2', '2026-11-19', '2116', '06:45', '10:00'),
  rij('k3', '2026-11-19', '2116', '15:45', '19:35'),
  // Van de collega: telt nergens mee.
  rij('c1', '2026-11-17', '2301', '05:30', '13:30', COLLEGA.id),
];

const VERLOF: LeaveRequest[] = [
  // Goedgekeurd betaald verlof met een toelichting.
  { id: 'l1', userId: PERSOON.id, type: 'betaald_verlof', status: 'approved', startDate: '2026-08-03', endDate: '2026-08-14', comment: 'Zomervakantie', createdAt: '2026-06-02T08:00:00.000Z', decidedAt: '2026-06-03T09:00:00.000Z' },
  // Een wachtend klein verlet.
  { id: 'l2', userId: PERSOON.id, type: 'klein_verlet', status: 'pending', startDate: '2026-12-04', endDate: '2026-12-04', createdAt: '2026-11-10T08:00:00.000Z' },
  // Een goedgekeurde ziekmelding met een opmerking.
  { id: 'l3', userId: PERSOON.id, type: 'ziekte', status: 'approved', startDate: '2026-10-06', endDate: '2026-10-08', comment: 'Griep', createdAt: '2026-10-06T05:10:00.000Z', decidedAt: '2026-10-06T05:10:00.000Z' },
];

/** In het venster: komt met de opstart mee (de prop `swaps`). */
const VENSTER_RUIL: SwapRequest = { id: 'r1', shiftId: 'x1', requesterId: PERSOON.id, targetDriverId: COLLEGA.id, status: 'approved', swapType: 'overname', createdAt: '2026-10-20T08:00:00.000Z', decidedAt: '2026-10-21T09:00:00.000Z', shiftDate: '2026-10-23', shiftLine: '2214', reason: 'Familiefeest' };
/** In het archief: komt van GET /api/swaps/archief. */
const ARCHIEF_RUIL: SwapRequest = { id: 'r2', shiftId: 'x2', requesterId: COLLEGA.id, targetDriverId: PERSOON.id, status: 'completed', swapType: 'overname', createdAt: '2026-03-02T08:00:00.000Z', decidedAt: '2026-03-03T09:00:00.000Z', shiftDate: '2026-03-05', shiftLine: '2301', reason: 'Verhuis' };

/** Het jaar van de vaste klok; `vanaf` en `aantal` zet useArchief er zelf achter (eerste pagina van 10). */
const ARCHIEF_URL = '/api/swaps/archief?persoon=3&sinds=2026-01-01&vanaf=0&aantal=10';

const toonKaart = () => render(<UserHistoryModal user={PERSOON} shifts={DIENSTEN} leaveRequests={VERLOF} swaps={[VENSTER_RUIL]} users={[PERSOON, COLLEGA]} onClose={vi.fn()} />);

const dialoog = () => screen.getByRole('dialog');
/** Een teller (Stat): het cijfer en de regel eronder, gezocht op zijn label. */
const teller = (label: string) => {
  const [, waarde, sub] = Array.from(within(dialoog()).getByText(label).parentElement!.children, (el) => el.textContent);
  return { waarde, sub };
};
/** De sectie onder een kopje, bv. "Verlof dit jaar". */
const sectie = (kop: string) => within(dialoog()).getByText(kop).closest('section') as HTMLElement;
/** Elk verzoek dat vertrok, over de drie ingangen van src/lib/api samen. */
const verzoeken = () => [apiJson, apiFetch, apiLijst].flatMap((f) => f.mock.calls.map(([url]) => String(url)));

/** Kaart open, en wachten tot het archief er is (het totaal van de dienstruilen staat er). */
const openGeladen = async () => {
  toonKaart();
  await waitFor(() => expect(teller('Dienstruilen').waarde).toBe('2'));
  await act(async () => {});
};

beforeEach(() => {
  // Alleen Date: de timers blijven echt, zodat waitFor gewoon werkt.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NU);
  apiJson.mockClear();
  apiFetch.mockClear();
  apiLijst.mockClear();
  server.archiefVrij = Promise.resolve();
  server.archief = { ruilen: [ARCHIEF_RUIL], totaal: 1, grens: '2026-08-01' };
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false, media: query,
    addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(), removeListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Verlof- en dienstruilhistoriek uit Gebruikers: het gedrag van vandaag', () => {
  it('tellers: Diensten telt planningsrijen, Verlof telt de ziekmelding mee, Dienstruilen is venster plus archief', async () => {
    await openGeladen();
    // nulmeting: PR 2 zet dit recht (telt rijen: 3 diensten waarvan 2 komende, maar 5 rijen waarvan 3 komende)
    expect(teller('Diensten')).toEqual({ waarde: '5', sub: '3 komende' });
    // nulmeting: PR 2 zet dit recht (de ziekmelding telt als goedgekeurd verlof; zonder is het 1)
    expect(teller('Verlof')).toEqual({ waarde: '2', sub: 'goedgekeurd' });
    expect(teller('Dienstruilen')).toEqual({ waarde: '2', sub: 'totaal' });
  });

  it('Verlof dit jaar: het verlof met zijn toelichting, en ook de ziekmelding met haar opmerking', async () => {
    await openGeladen();
    const verlof = sectie('Verlof dit jaar');
    expect(verlof.textContent).toContain('Betaald verlof');
    expect(verlof.textContent).toContain('Zomervakantie');
    expect(verlof.textContent).toContain('Klein verlet');
    // nulmeting: PR 2 zet dit recht (ziekte staat niet onder verlof, en haar opmerking niet op de kaart)
    expect(within(verlof).getByText('Ziekte, "Griep"')).toBeTruthy();
  });

  it('het venster heeft geen toegankelijke naam, en de rol krijgt haar hoofdletter uit CSS', async () => {
    await openGeladen();
    // nulmeting: PR 2 zet dit recht (Modal zonder ariaLabel)
    expect(screen.getByRole('dialog', { name: '' })).toBe(dialoog());
    // nulmeting: PR 2 zet dit recht (rol als woord in plaats van CSS capitalize)
    expect(within(dialoog()).getByText('chauffeur · #1043').classList.contains('capitalize')).toBe(true);
  });

  it('Dienstruilen: zolang het archief laadt een "…", daarna venster plus archief als totaal en in de lijst', async () => {
    let geef!: () => void;
    server.archiefVrij = new Promise<void>((klaar) => { geef = klaar; });
    toonKaart();
    expect(teller('Dienstruilen')).toEqual({ waarde: '…', sub: 'totaal' });
    await act(async () => { geef(); });
    await waitFor(() => expect(teller('Dienstruilen')).toEqual({ waarde: '2', sub: 'totaal' }));
    // Eerst de ruil uit het venster, dan die uit het archief.
    expect(within(sectie('Dienstruilen dit jaar')).getAllByText(/^Dienst \d+ op /).map((el) => el.textContent)).toEqual([
      expect.stringMatching(/^Dienst 2214 op 23\/10\/2026/),
      expect.stringMatching(/^Dienst 2301 op 05\/03\/2026/),
    ]);
  });

  it('verzoeken: het archief van dit jaar precies één keer met deze URL, en geen ander verzoek', async () => {
    await openGeladen();
    expect(verzoeken().filter((url) => url.startsWith('/api/swaps/archief'))).toEqual([ARCHIEF_URL]);
    // nulmeting: PR 2 zet dit recht (PR 2 vraagt voor een chauffeur ook /api/user-expiries)
    expect(verzoeken()).toEqual([ARCHIEF_URL]);
  });
});
