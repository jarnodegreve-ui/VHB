import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

// De landing van een uitnodiging (30-09): openen bij de server, wachtwoord
// kiezen, en dan dezelfde weg als een gewone aanmelding. Supabase en fetch
// zijn nagebootst; de volgorde van de Auth-stappen is wat hier telt.

const { auth, stappen } = vi.hoisted(() => ({
  stappen: [] as string[],
  auth: {
    verifyOtp: vi.fn(),
    updateUser: vi.fn(),
    signOut: vi.fn(),
    signInWithPassword: vi.fn(),
  },
}));
vi.mock('../lib/supabase', () => ({ supabase: { auth } }));
vi.mock('../components/OnderhoudBanner', () => ({ OnderhoudBanner: () => null }));

import { UitnodigingScherm } from './UitnodigingScherm';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CODE = '3.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const OPEN = { naam: 'Jan Peeters', email: 'jan@vhb.be', tokenHash: 'hash-1' };
const WACHTWOORD = 'een-goed-wachtwoord';

let antwoorden: Array<() => Response | Promise<Response>>;
const fetchMock = vi.fn(async () => (antwoorden.shift() ?? (() => Response.json(OPEN)))());

beforeEach(() => {
  stappen.length = 0;
  antwoorden = [];
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  auth.verifyOtp.mockReset().mockImplementation(async (o: { token_hash: string }) => { stappen.push(`verify:${o.token_hash}`); return { data: {}, error: null }; });
  auth.updateUser.mockReset().mockImplementation(async () => { stappen.push('wachtwoord'); return { data: {}, error: null }; });
  auth.signOut.mockReset().mockImplementation(async () => { stappen.push('afmelden'); return { error: null }; });
  auth.signInWithPassword.mockReset().mockImplementation(async (o: { email: string }) => { stappen.push(`aanmelden:${o.email}`); return { data: { session: { access_token: 'tok-nieuw' } }, error: null }; });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const toon = () => {
  const onLogin = vi.fn(async () => { stappen.push('app'); });
  const onKlaar = vi.fn();
  render(<UitnodigingScherm code={CODE} onLogin={onLogin} onKlaar={onKlaar} />);
  return { onLogin, onKlaar };
};
const kies = async (wachtwoord: string) => {
  fireEvent.change(screen.getByLabelText('Kies een wachtwoord'), { target: { value: wachtwoord } });
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Wachtwoord opslaan/ })); });
};

describe('landing van een uitnodiging', () => {
  it('opent de uitnodiging met de code en verwelkomt de persoon met zijn adres', async () => {
    toon();
    expect(await screen.findByRole('heading', { name: 'Welkom, Jan Peeters' })).toBeTruthy();
    expect(screen.getByText('jan@vhb.be')).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/uitnodiging/openen', expect.objectContaining({ method: 'POST', body: JSON.stringify({ code: CODE }) }));
    // Nog geen sessie: die start pas bij het opslaan.
    expect(auth.verifyOtp).not.toHaveBeenCalled();
  });

  it('wachtwoord kiezen: sessie via de token, wachtwoord zetten, afmelden, aanmelden met het nieuwe wachtwoord, de app in', async () => {
    const { onLogin, onKlaar } = toon();
    await screen.findByRole('heading', { name: 'Welkom, Jan Peeters' });
    await kies(WACHTWOORD);
    await waitFor(() => expect(onKlaar).toHaveBeenCalled());
    expect(stappen).toEqual(['verify:hash-1', 'wachtwoord', 'afmelden', 'aanmelden:jan@vhb.be', 'app']);
    expect(auth.updateUser).toHaveBeenCalledWith({ password: WACHTWOORD });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'jan@vhb.be', password: WACHTWOORD });
    expect(onLogin).toHaveBeenCalledWith('tok-nieuw');
  });

  it('een te kort wachtwoord: uitleg bij het veld, niets naar Supabase', async () => {
    toon();
    await screen.findByRole('heading', { name: 'Welkom, Jan Peeters' });
    await kies('kort');
    expect(screen.getByRole('alert').textContent).toMatch(/minstens \d+ tekens/);
    expect(stappen).toEqual([]);
  });

  it('stond het scherm te lang open (token verlopen), dan één keer een verse token', async () => {
    const { onKlaar } = toon();
    await screen.findByRole('heading', { name: 'Welkom, Jan Peeters' });
    auth.verifyOtp.mockImplementationOnce(async (o: { token_hash: string }) => { stappen.push(`verify:${o.token_hash}`); return { data: {}, error: { message: 'Token has expired or is invalid' } }; });
    antwoorden.push(() => Response.json({ ...OPEN, tokenHash: 'hash-2' }));
    await kies(WACHTWOORD);
    await waitFor(() => expect(onKlaar).toHaveBeenCalled());
    expect(stappen.slice(0, 3)).toEqual(['verify:hash-1', 'verify:hash-2', 'wachtwoord']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('weigert Supabase het wachtwoord, dan uitleg en bij de tweede poging geen tweede token', async () => {
    const { onKlaar } = toon();
    await screen.findByRole('heading', { name: 'Welkom, Jan Peeters' });
    auth.updateUser.mockImplementationOnce(async () => { stappen.push('wachtwoord'); return { data: {}, error: { code: 'same_password', message: 'same' } }; });
    await kies(WACHTWOORD);
    expect(screen.getByRole('alert').textContent).toContain('Kies een ander wachtwoord');
    expect(onKlaar).not.toHaveBeenCalled();
    await kies(`${WACHTWOORD}-2`);
    await waitFor(() => expect(onKlaar).toHaveBeenCalled());
    expect(stappen.filter((s) => s.startsWith('verify:'))).toEqual(['verify:hash-1']);
  });

  it('verlopen uitnodiging: de uitleg van de server en de weg naar inloggen', async () => {
    antwoorden.push(() => Response.json({ reden: 'verlopen', error: 'Deze uitnodiging is verlopen, de link werkt 7 dagen. Vraag de planning om een nieuwe.' }, { status: 410 }));
    const { onKlaar } = toon();
    expect(await screen.findByRole('heading', { name: 'Uitnodiging verlopen' })).toBeTruthy();
    expect(screen.getByText(/Vraag de planning om een nieuwe/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Opnieuw proberen/ })).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Naar inloggen' })); });
    expect(onKlaar).toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it('geen verbinding: opnieuw proberen haalt de uitnodiging alsnog op', async () => {
    antwoorden.push(() => { throw new TypeError('Failed to fetch'); });
    toon();
    expect(await screen.findByRole('heading', { name: 'Geen verbinding' })).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Opnieuw proberen/ })); });
    expect(await screen.findByRole('heading', { name: 'Welkom, Jan Peeters' })).toBeTruthy();
  });

  it('is het wachtwoord gezet maar lukt de aanmelding niet, dan zegt het scherm dat en wijst het naar inloggen', async () => {
    auth.signInWithPassword.mockImplementationOnce(async () => ({ data: { session: null }, error: { message: 'fout' } }));
    const { onKlaar } = toon();
    await screen.findByRole('heading', { name: 'Welkom, Jan Peeters' });
    await kies(WACHTWOORD);
    expect(await screen.findByRole('heading', { name: 'Wachtwoord ingesteld' })).toBeTruthy();
    expect(screen.getByText(/Log nu in met jan@vhb.be/)).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Naar inloggen/ })); });
    expect(onKlaar).toHaveBeenCalled();
  });
});
