import { useRef } from 'react';
import { isStaf, type User } from '../types';
import { meldLive } from '../lib/liveSignaal';
import { useRealtimeSync } from '../lib/realtime';
import type { AppData } from './useAppData';

/** De bronnen uit de datalaag die een realtime-event opnieuw ophaalt, plus
 *  `boekSync` dat een volledige ronde als synchronisatie boekt. */
export type LiveBronnen = Pick<AppData,
  'fetchLeave' | 'fetchSwaps' | 'fetchDiversions' | 'fetchUpdates' | 'fetchMyNotes' | 'fetchMeldingen' |
  'fetchPlanning' | 'fetchPlanningMatrix' | 'fetchPlanningMatrixHistory' | 'refreshCoverageGaps' | 'fetchUsers' | 'boekSync'
>;

/** Twee volledige catch-ups binnen dit venster zijn er één: bij wifi-herstel
 *  komen de socket-reconnect en de online-overgang seconden na elkaar. */
export const CATCHUP_BUNDEL_MS = 30_000;

/**
 * Live-updates: welke bron na welk realtime-event opnieuw wordt opgehaald,
 * met het stille "… bijgewerkt"-signaal. Tot 07-10 stond dit in App.tsx
 * (stap 3 van de splitsing); de code is verplaatst, niet herschreven.
 * `actief` = ingelogd en niet achter het toestel-wachtscherm (anders gaf
 * elke refetch alleen een toestel-403).
 */
export function useLiveUpdates(actief: boolean, currentUser: User | null, bronnen: LiveBronnen) {
  const {
    fetchLeave, fetchSwaps, fetchDiversions, fetchUpdates, fetchMyNotes, fetchMeldingen,
    fetchPlanning, fetchPlanningMatrix, fetchPlanningMatrixHistory, refreshCoverageGaps, fetchUsers, boekSync,
  } = bronnen;
  // Volledige catch-up (reconnect, heropenen na lang weg, terug online): stil
  // alles verversen, want gemiste realtime-events zijn definitief weg. Eén
  // pad voor alle aanleidingen; tot 05-11 had App.tsx een eigen kopie voor
  // terug-online, en bij wifi-herstel liepen die twee rondes vlak na elkaar.
  const catchUpRef = useRef<{ op: number; belofte: Promise<void> } | null>(null);
  const volledigeCatchUp = (): Promise<void> => {
    const lopend = catchUpRef.current;
    if (lopend && Date.now() - lopend.op < CATCHUP_BUNDEL_MS) return lopend.belofte;
    const planningFilter = currentUser && !isStaf(currentUser.role)
      ? { driverId: String(currentUser.id) }
      : undefined;
    const belofte = boekSync(() => Promise.allSettled([
      fetchMyNotes(),
      fetchMeldingen(),
      fetchLeave(),
      fetchSwaps(),
      fetchDiversions(undefined, { silent: true }),
      fetchUpdates(),
      fetchPlanning(undefined, planningFilter, { silent: true }),
      ...(currentUser && isStaf(currentUser.role) ? [
        refreshCoverageGaps(),
        fetchPlanningMatrix(),
        fetchPlanningMatrixHistory(),
        // Sessie-metadata (lastLogin) verandert zonder realtime-event; zonder
        // deze refetch liep "Laatst actief" achter in een openstaand tabblad.
        fetchUsers(),
      ] : []),
    ])).then(() => undefined);
    catchUpRef.current = { op: Date.now(), belofte };
    return belofte;
  };
  // Supabase Realtime: live sync van leave/swaps/diversions/updates/planning.
  // Activeert pas wanneer gebruiker is ingelogd (session present) — anders
  // gebeurt er niets.
  // Niet zolang het toestel-wachtscherm staat: elke refetch zou alleen een
  // toestel-403 opleveren.
  useRealtimeSync(actief, {
    // meldLive: stille "… bijgewerkt"-toast (max één per 10 s per collectie,
    // niet na een eigen schrijfactie) — src/lib/liveSignaal.ts.
    refetchLeave: (soort) => {
      // Ziekte is geen verlof: een gewijzigde ziekmelding meldt zich bij staf
      // als "Ziekmelding bijgewerkt" en bij een chauffeur helemaal niet.
      if (soort !== 'ziekte') meldLive('verlof');
      else if (currentUser && isStaf(currentUser.role)) meldLive('ziekte');
      // Verlof stuurt de dekking (afwezige = gat): voor staf meteen mee
      // verversen, anders liepen dashboard en topbar-badge achter.
      if (currentUser && isStaf(currentUser.role)) refreshCoverageGaps();
      return fetchLeave();
    },
    refetchSwaps: () => { meldLive('ruil'); return fetchSwaps(); },
    refetchDiversions: () => { meldLive('omleidingen'); return fetchDiversions(undefined, { silent: true }); },
    refetchUpdates: () => { meldLive('updates'); return fetchUpdates(); },
    refetchNotes: () => fetchMyNotes(),
    // Meldingencentrum: eigen rijen → bel + badge live.
    refetchMeldingen: () => fetchMeldingen(),
    meldingenUserId: currentUser ? String(currentUser.id) : undefined,
    refetchPlanning: () => {
      meldLive('planning');
      // Chauffeur krijgt enkel eigen shifts (zelfde filter als initial)
      const planningFilter = currentUser && !isStaf(currentUser.role)
        ? { driverId: String(currentUser.id) }
        : undefined;
      fetchPlanning(undefined, planningFilter, { silent: true });
      // Maandplanning haalt haar eigen data (/api/month-planning); dit event
      // laat een open Maandplanning-scherm stil meeverversen zodra een
      // collega een wissel doorvoert of de planning herbouwt.
      window.dispatchEvent(new Event('vhb-planning-changed'));
      // Dekking beweegt mee met de planning (Operations Center).
      if (currentUser && isStaf(currentUser.role)) {
        refreshCoverageGaps();
      }
    },
    refetchMatrix: () => {
      // Alleen planner/admin gebruiken het Planning-overzicht; chauffeurs
      // hebben deze data niet.
      if (currentUser && isStaf(currentUser.role)) {
        void fetchPlanningMatrix();
        void fetchPlanningMatrixHistory();
      }
    },
    refetchAll: volledigeCatchUp,
    // Lichte catch-up (tabblad terug binnen 5 min na de laatste volledige
    // ronde, src/lib/realtime.ts): alleen wat vaak wijzigt. De planning hoort
    // er alleen bij als planning_version wijzigde (of niet te lezen was), en
    // dan stil: een wijziging die via de socket binnenkwam gaf haar toast al.
    refetchLicht: ({ planning }) => {
      void fetchMeldingen();
      void fetchLeave();
      void fetchSwaps();
      if (!planning) return;
      const planningFilter = currentUser && !isStaf(currentUser.role)
        ? { driverId: String(currentUser.id) }
        : undefined;
      void fetchPlanning(undefined, planningFilter, { silent: true });
      window.dispatchEvent(new Event('vhb-planning-changed'));
      if (currentUser && isStaf(currentUser.role)) {
        refreshCoverageGaps();
        void fetchPlanningMatrix();
        void fetchPlanningMatrixHistory();
      }
    },
  });
  // Voor App.tsx: dezelfde ronde bij de overgang naar online.
  return { catchUp: volledigeCatchUp };
}
