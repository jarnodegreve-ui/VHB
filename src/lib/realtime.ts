import { useEffect, useRef } from 'react';
import { supabase } from './supabase';

/**
 * Realtime sync — luistert naar Postgres-changes op kritieke tabellen
 * en triggert de juiste refetcher. Voelt magisch: planner keurt verlof
 * goed → chauffeur ziet het direct op zijn telefoon zonder refresh.
 *
 * Vereist:
 * - Supabase Realtime aanstaan voor de tabellen in de Supabase-dashboard
 * - RLS-policies die SELECT toestaan voor de subscriber
 *
 * Strategie: één channel met meerdere postgres_changes-listeners.
 * Bij elke event roepen we de bijbehorende refetcher aan — dat zorgt
 * dat client-state altijd in sync is met DB, ook bij batch-updates.
 *
 * Debouncing: meerdere events binnen 400ms triggeren één refetch per
 * tabel, niet één per event (anders bij bulk-approve = N refetches).
 */
export type RealtimeRefetchers = {
  refetchLeave: () => void | Promise<void>;
  refetchSwaps: () => void | Promise<void>;
  refetchDiversions: () => void | Promise<void>;
  refetchUpdates: () => void | Promise<void>;
  refetchPlanning?: () => void | Promise<void>;
  /** Dienstnotities: planner plaatst → chauffeur ziet hem direct. */
  refetchNotes?: () => void | Promise<void>;
  /** Matrix + importhistoriek: zonder deze zag collega B na een import van
   *  collega A wél de nieuwe planning maar nog het oude Planning-overzicht. */
  refetchMatrix?: () => void | Promise<void>;
  /** Catch-up: alle refetchers in één keer — voor gemiste events na een
   *  reconnect of het heropenen van de PWA. */
  refetchAll?: () => void | Promise<void>;
};

export function useRealtimeSync(enabled: boolean, refetchers: RealtimeRefetchers) {
  // Stable ref naar refetchers zodat we geen subscribe-loop krijgen
  // wanneer een refetcher-identity wijzigt
  const refRef = useRef(refetchers);
  refRef.current = refetchers;
  const firstSubscribe = useRef(true);

  useEffect(() => {
    if (!enabled || !supabase) return;

    // Debounce-timers per tabel
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    const debounce = (key: string, fn: () => void) => {
      const existing = timers.get(key);
      if (existing) clearTimeout(existing);
      timers.set(
        key,
        setTimeout(() => {
          timers.delete(key);
          fn();
        }, 400),
      );
    };

    const channel = supabase
      .channel('vhb-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'leave' },
        () => debounce('leave', () => refRef.current.refetchLeave?.()),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'swaps' },
        () => debounce('swaps', () => refRef.current.refetchSwaps?.()),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'diversions' },
        () => debounce('diversions', () => refRef.current.refetchDiversions?.()),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'updates' },
        () => debounce('updates', () => refRef.current.refetchUpdates?.()),
      )
      // LET OP: deze twee vuren bewust NIET. planning en planning_matrix_rows
      // zitten niet in de supabase_realtime-publicatie, en dat is een keuze —
      // een heropbouw vervangt ~1.678 rijen in één transactie, wat per
      // verbonden chauffeur een access-check per rij betekent op de ene thread
      // die Realtime daarvoor heeft. Zie de toelichting in
      // supabase/2026-08-02_realtime_publicatie.sql.
      //
      // De abonnementen blijven staan omdat ze meteen werken zodra de geplande
      // planning_version-tabel er is (één event per import i.p.v. 1.678).
      // Tot dan komt de planning van de refetch bij (her)aansluiting, de
      // visibility-catch-up, en network-first op /api/planning in de SW.
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'planning' },
        () => debounce('planning', () => refRef.current.refetchPlanning?.()),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'planning_matrix_rows' },
        () => debounce('matrix', () => refRef.current.refetchMatrix?.()),
      )
      .subscribe((status) => {
        // Na élke (her)aansluiting één catch-up: events die tijdens een dode
        // socket vielen (telefoon in de zak, nacht) zijn definitief gemist —
        // zonder deze refetch keek een heropende PWA naar de staat van
        // gisteren tot iemand handmatig ververste.
        if (status === 'SUBSCRIBED') {
          if (firstSubscribe.current) {
            firstSubscribe.current = false; // de app laadt initieel al alles
            return;
          }
          debounce('catch-up', () => refRef.current.refetchAll?.());
        }
      });

    // Heropenen van de app (tab/PWA weer zichtbaar na ≥ 60s weg): zelfde
    // catch-up. visibilitychange is betrouwbaarder dan socket-status op iOS.
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt !== null && Date.now() - hiddenAt > 60_000) {
        debounce('catch-up', () => refRef.current.refetchAll?.());
      }
      hiddenAt = null;
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
      document.removeEventListener('visibilitychange', onVisibility);
      supabase!.removeChannel(channel);
    };
  }, [enabled]);
}
