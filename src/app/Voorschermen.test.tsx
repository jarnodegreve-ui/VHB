import { describe, expect, it, vi } from 'vitest';
import type { ReactElement } from 'react';

vi.mock('../lib/supabase', () => ({ isSupabaseConfigured: true, supabase: {} }));
vi.mock('../lib/lazyRetry', () => ({ lazyWithRetry: (laad: () => Promise<unknown>) => ({ laad }) }));
vi.mock('../views/LoginView', () => ({ LoginView: () => null }));
vi.mock('./AppSkeleton', () => ({ AppSkeleton: () => null }));
vi.mock('./PreAppScreens', () => ({ SessieLaden: () => null, ProfielLaden: () => null, ConfigOntbreekt: () => null, PrintLaden: () => null }));

import type { User } from '../types';
import { AppSkeleton } from './AppSkeleton';
import { ProfielLaden, SessieLaden } from './PreAppScreens';
import { LoginView } from '../views/LoginView';
import { kiesVoorscherm } from './Voorschermen';
import type { Sessie } from './useSessie';

/**
 * Welk scherm er vóór de app komt, in de volgorde die tot 07-10 in App.tsx
 * stond: laden, printblad, uitnodiging, herstel, tweede stap, toestel wacht,
 * inlogscherm, en pas als dat allemaal niet speelt de app zelf (null).
 */
const chauffeur = { id: '3', name: 'Chauffeur A', role: 'chauffeur' } as User;
const sessieVan = (extra: Partial<Sessie> = {}): Sessie => ({
  authReady: true, warmeStart: false, profielGeladenRef: { current: false }, currentUser: chauffeur,
  uitnodiging: null, setUitnodiging: vi.fn(), isPasswordRecovery: false, setRecoveryMode: vi.fn(),
  tweeStaps: null, session: { access_token: 'tok' }, deviceBlocked: null, uitlogMelding: '',
  handleLogin: vi.fn(), handleLogout: vi.fn(), naTweeStaps: vi.fn(), controleerToestelOpnieuw: vi.fn(),
  ...extra,
} as unknown as Sessie);
const kies = (extra: Partial<Sessie> = {}, print: string | null = null) => kiesVoorscherm({
  sessie: sessieVan(extra), users: [], shifts: [], leaveRequests: [], isInitialLoad: false, printGeweigerdVoor: print, geenPrintblad: vi.fn(),
});
/** Het voorscherm dat er móet zijn, met leesbare props. */
const scherm = (extra: Partial<Sessie> = {}, print: string | null = null): ReactElement<Record<string, unknown>> => {
  const el = kies(extra, print);
  if (!el) throw new Error('geen voorscherm, de app zelf zou renderen');
  return el as ReactElement<Record<string, unknown>>;
};
const soort = (el: ReactElement | null) => (el === null ? null : typeof el.type === 'string' ? el.type : (el.type as { name?: string }).name ?? String(el.type));
const lui = (el: ReactElement | null) => ((el?.props as { children?: ReactElement })?.children?.type as { laad?: () => Promise<unknown> } | undefined)?.laad?.toString() ?? '';

describe('kiesVoorscherm', () => {
  it('nog niet klaar: skelet bij een warme start zonder geladen profiel, anders het laadscherm', () => {
    expect(scherm({ authReady: false, warmeStart: true }).type).toBe(AppSkeleton);
    expect(scherm({ authReady: false, warmeStart: false }).type).toBe(SessieLaden);
    expect(scherm({ authReady: false, warmeStart: true, profielGeladenRef: { current: true } }).type).toBe(SessieLaden);
  });

  it('met een gebruiker en niets in de weg: null, de app zelf', () => {
    expect(kies()).toBeNull();
  });

  it('zonder gebruiker: inlogscherm met de uitlogreden, of het profiel-laadscherm zolang er een sessie is', () => {
    const login = scherm({ currentUser: null, session: null, uitlogMelding: 'sessie' });
    expect(login.type).toBe(LoginView);
    expect(login.props.melding).toBe('sessie');
    expect(scherm({ currentUser: null }).type).toBe(ProfielLaden);
    expect(scherm({ currentUser: null, warmeStart: true }).type).toBe(AppSkeleton);
  });

  it('wachtwoordherstel gaat vóór de tweede stap en het toestel; uitnodiging gaat vóór het herstel', () => {
    const herstel = scherm({ isPasswordRecovery: true, tweeStaps: { stap: 'code', factorId: 'f' }, deviceBlocked: 'pending' });
    expect(herstel.type).toBe(LoginView);
    expect(herstel.props.recoveryMode).toBe(true);
    const uitnodiging = kies({ isPasswordRecovery: true, uitnodiging: 'abc.geheim' });
    expect(soort(uitnodiging)).toBe('Symbol(react.suspense)');
    expect(lui(uitnodiging)).toContain('UitnodigingScherm');
  });

  it('tweede stap en toestel-wachtscherm alleen met een sessie, de tweede stap eerst', () => {
    const twee = kies({ tweeStaps: { stap: 'code', factorId: 'f' }, deviceBlocked: 'revoked' });
    expect(lui(twee)).toContain('TweeStapsScherm');
    const toestel = kies({ deviceBlocked: 'revoked' });
    expect(lui(toestel)).toContain('ToestelGeblokkeerd');
    expect(scherm({ tweeStaps: { stap: 'code', factorId: 'f' }, deviceBlocked: 'revoked', session: null, currentUser: null, uitlogMelding: '' }).type).toBe(LoginView);
  });

  it('een printblad in de URL gaat vóór alles behalve het laden, en niet voor wie het blad geweigerd kreeg', () => {
    window.history.replaceState(null, '', '/?print-driver=1');
    try {
      expect(lui(kies())).toContain('PrintModus');
      expect(kies({}, '3')).toBeNull();
      expect(scherm({ currentUser: null }).type).toBe(ProfielLaden);
      expect(scherm({ authReady: false }).type).toBe(SessieLaden);
    } finally {
      window.history.replaceState(null, '', '/');
    }
  });
});
