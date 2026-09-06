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
type RealtimeRefetchers = {
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
  /** Meldingencentrum: eigen rijen in public.meldingen (bel + badge). Vereist
   *  `meldingenUserId` — zonder eigen id geen abonnement (RLS beschermt,
   *  het filter voorkomt alleen ruis). */
  refetchMeldingen?: () => void | Promise<void>;
  meldingenUserId?: string;
};

export function useRealtimeSync(enabled: boolean, refetchers: RealtimeRefetchers) {
  // Stable ref naar refetchers zodat we geen subscribe-loop krijgen
  // wanneer een refetcher-identity wijzigt
  const refRef = useRef(refetchers);
  refRef.current = refetchers;
  const firstSubscribe = useRef(true);
  const meldingenUserId = refetchers.meldingenUserId ?? '';

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

    let channel = supabase
      .channel('vhb-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'leave' },
        () => debounce('leave', () => refRef.current.refetchLeave?.()),
      );
    // Meldingencentrum: alleen de eigen rijen (server-filter op user_id;
    // RLS laat toch niets anders door). Eén event = één refetch van de lijst.
    if (meldingenUserId) {
      channel = channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'meldingen', filter: `user_id=eq.${meldingenUserId}` },
        () => debounce('meldingen', () => refRef.current.refetchMeldingen?.()),
      );
    }
    channel = channel
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
      // planning en planning_matrix_rows zitten BEWUST niet in de publicatie:
      // een heropbouw vervangt ~1.678 rijen in één transactie, en Realtime doet
      // per abonnee een access-check per rij op één thread. In plaats daarvan
      // luisteren we op planning_version — één rij met een teller die een
      // statement-trigger ophoogt zodra planning óf de matrix wijzigt. Vier
      // events per import in plaats van 1.678, en de debounce hieronder maakt
      // daar één refetch van.
      //
      // Eén event dekt allebei de tabellen, dus we verversen ze allebei.
      // refetchMatrix is voor een chauffeur toch een no-op (App.tsx slaat hem
      // over voor die rol).
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'planning_version' },
        () => debounce('planning-version', () => {
          refRef.current.refetchPlanning?.();
          refRef.current.refetchMatrix?.();
        }),
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
  }, [enabled, meldingenUserId]);
}
