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
};

export function useRealtimeSync(enabled: boolean, refetchers: RealtimeRefetchers) {
  // Stable ref naar refetchers zodat we geen subscribe-loop krijgen
  // wanneer een refetcher-identity wijzigt
  const refRef = useRef(refetchers);
  refRef.current = refetchers;

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
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'planning' },
        () => debounce('planning', () => refRef.current.refetchPlanning?.()),
      )
      .subscribe();

    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
      supabase!.removeChannel(channel);
    };
  }, [enabled]);
}
