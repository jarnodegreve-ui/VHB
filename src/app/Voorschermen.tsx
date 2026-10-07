import { Suspense, type ReactElement } from 'react';
import type { LeaveRequest, Shift, User } from '../types';
import { AppSkeleton } from './AppSkeleton';
import { SessieLaden, ProfielLaden, ConfigOntbreekt, PrintLaden } from './PreAppScreens';
import { isSupabaseConfigured, supabase } from '../lib/supabase';
import { lazyWithRetry } from '../lib/lazyRetry';
import { LoginView } from '../views/LoginView';
import type { Sessie } from './useSessie';

// Print-modus (?print-…=) lui: zelden gebruikt, dus niet in de startbundel (P5).
const LazyPrintModus = lazyWithRetry(() => import('./PrintModus'));
const PRINT_PARAM = /[?&](print-(driver|gele-boek|rapport|verlof-driver)|ruiloverzicht-week)=/;
const LazyToestelGeblokkeerd = lazyWithRetry(() => import('./ToestelGeblokkeerd').then((m) => ({ default: m.ToestelGeblokkeerd })));
const LazyTweeStapsScherm = lazyWithRetry(() => import('./TweeStapsScherm').then((m) => ({ default: m.TweeStapsScherm })));
const LazyUitnodiging = lazyWithRetry(() => import('./UitnodigingScherm').then((m) => ({ default: m.UitnodigingScherm })));

/**
 * De schermen vóór de app: laden, printblad, configuratie, uitnodiging,
 * wachtwoordherstel, tweede stap, toestel wacht en het inlogscherm. Geeft
 * het scherm terug dat nu hoort, of null als de app zelf mag renderen. Tot
 * 07-10 stond deze keten in App.tsx (stap 5 van de splitsing); de code is
 * verplaatst, niet herschreven. Geen hooks: App roept dit ná al zijn hooks.
 */
export function kiesVoorscherm({ sessie, users, shifts, leaveRequests, isInitialLoad, printGeweigerdVoor, geenPrintblad }: {
  sessie: Sessie;
  users: User[];
  shifts: Shift[];
  leaveRequests: LeaveRequest[];
  isInitialLoad: boolean;
  /** Voor wie de luie printmodule het blad weigerde: dan het gewone portaal. */
  printGeweigerdVoor: string | null;
  geenPrintblad: () => void;
}): ReactElement | null {
  const {
    authReady, warmeStart, profielGeladenRef, currentUser, uitnodiging, setUitnodiging,
    isPasswordRecovery, setRecoveryMode, tweeStaps, session, deviceBlocked, uitlogMelding,
    handleLogin, handleLogout, naTweeStaps, controleerToestelOpnieuw,
  } = sessie;

  // Warme start (opgeslagen sessie): meteen de skeleton-schil; koude start: het
  // carbon laadscherm — dat wordt zo het inlogscherm. Ook tijdens de afronding
  // van een afmelding (profiel was geladen): daarna volgt de herlaad naar het
  // inlogscherm, niet de app.
  if (!authReady) return warmeStart && !profielGeladenRef.current ? <AppSkeleton /> : <SessieLaden />;

  // Print-modus (?print-…=): een kaal blad zonder schil. Zie app/PrintModus.tsx.
  // Alleen met een ingelogde gebruiker (elk blad vraagt er een); weigert de
  // module het blad voor deze gebruiker, dan het gewone portaal.
  if (currentUser && printGeweigerdVoor !== currentUser.id && PRINT_PARAM.test(window.location.search)) {
    return (
      <Suspense fallback={<PrintLaden />}>
        <LazyPrintModus currentUser={currentUser} users={users} shifts={shifts} leaveRequests={leaveRequests} isInitialLoad={isInitialLoad} onGeenBlad={geenPrintblad} />
      </Suspense>
    );
  }

  if (!isSupabaseConfigured || !supabase) return <ConfigOntbreekt />;

  // Vóór het herstelscherm: de landing start zelf een herstelsessie om het
  // wachtwoord te zetten, en moet dan in beeld blijven.
  if (uitnodiging) {
    return (
      <Suspense fallback={<SessieLaden />}>
        <LazyUitnodiging code={uitnodiging} onLogin={handleLogin} onKlaar={() => setUitnodiging(null)} />
      </Suspense>
    );
  }

  if (isPasswordRecovery) {
    return (
      <LoginView
        onLogin={handleLogin}
        recoveryMode
        onRecoveryComplete={async () => { setRecoveryMode(false); }}
      />
    );
  }

  // Twee-stapsverificatie: ingelogd, maar de code (of de inschrijving) ontbreekt nog.
  if (tweeStaps && session) {
    return (
      <Suspense fallback={<SessieLaden />}>
      <LazyTweeStapsScherm
        stap={tweeStaps.stap}
        factorId={tweeStaps.factorId}
        onLogout={handleLogout}
        onKlaar={naTweeStaps}
      />
      </Suspense>
    );
  }

  // Toestel-whitelist: ingelogd, maar dit toestel is (nog) niet goedgekeurd.
  if (deviceBlocked && session) {
    return (
      <Suspense fallback={<SessieLaden />}>
      <LazyToestelGeblokkeerd
        revoked={deviceBlocked === 'revoked'}
        onLogout={handleLogout}
        onRetry={controleerToestelOpnieuw}
      />
      </Suspense>
    );
  }

  if (!currentUser) {
    // Wél een sessie maar (nog) geen profiel: toon een laadscherm met
    // retry i.p.v. het loginformulier aan een al-ingelogde gebruiker
    // (de 8s-watchdog kon hier anders een login-flits veroorzaken).
    if (session) return warmeStart ? <AppSkeleton /> : <ProfielLaden />;
    // uitlogMelding als prop: sessionStorage alleen is niet genoeg, want bij
    // een gedwongen uitlog kan LoginView al gemonteerd zijn vóórdat de vlag
    // geschreven is — dan zou de uitleg nooit verschijnen (viel om in e2e).
    return <LoginView onLogin={handleLogin} melding={uitlogMelding} />;
  }

  return null;
}
