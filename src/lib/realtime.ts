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
  /** Lichte catch-up (tabblad terug, korter dan 5 min na de laatste volledige
   *  ronde): alleen de lichte, vaak wijzigende collecties (meldingen, verlof,
   *  ruilen). `planning` is waar wanneer `planning_version` wijzigde of de
   *  versie niet te lezen was: dan hoort de planning er stil bij. */
  refetchLicht?: (opts: { planning: boolean }) => void | Promise<void>;
  /** Meldingencentrum: eigen rijen in public.meldingen (bel + badge). Vereist
   *  `meldingenUserId` — zonder eigen id geen abonnement (RLS beschermt,
   *  het filter voorkomt alleen ruis). */
  refetchMeldingen?: () => void | Promise<void>;
  meldingenUserId?: string;
};

/** Tabblad minstens zo lang weg = catch-up bij terugkeer. */
export const WEG_DREMPEL_MS = 60_000;
/** Hooguit één VOLLEDIGE catch-up per 5 min bij terugkeer naar het tabblad. */
export const VOLLEDIG_INTERVAL_MS = 5 * 60_000;

export type CatchUp = 'geen' | 'licht' | 'volledig';

/**
 * Refetch-regime bij terugkeer naar het tabblad (ronde 3, 19-09). Vroeger
 * deed elke terugkeer na ≥ 60 s de volledige set (±10 calls, elk 250-400 ms
 * en soms een koude functie). De socket leeft meestal gewoon door en levert
 * de events af; de volledige ronde is dus een vangnet, geen routine:
 * - korter dan 60 s weg: niets;
 * - laatste volledige ronde ≥ 5 min geleden: de volledige set;
 * - daartussen: de lichte set (+ planning alleen bij een gewijzigde versie).
 * Een socket-RECONNECT valt hier buiten: die doet altijd de volledige set,
 * want gemiste events zijn definitief weg.
 */
export const kiesCatchUp = (wegMs: number, sindsVolledigMs: number): CatchUp =>
  wegMs <= WEG_DREMPEL_MS ? 'geen' : sindsVolledigMs >= VOLLEDIG_INTERVAL_MS ? 'volledig' : 'licht';

/** Stand van `planning_version` (één rij, SELECT voor elke ingelogde
 *  gebruiker): dé goedkope versiecheck, rechtstreeks bij Supabase en dus geen
 *  serverless functie. null = niet te lezen (offline, mock, time-out): de
 *  aanroeper behandelt dat als "mogelijk gewijzigd". */
const leesPlanningVersie = async (): Promise<string | null> => {
  if (!supabase) return null;
  try {
    const lees = supabase.from('planning_version').select('version').limit(1).maybeSingle()
      .then(({ data, error }) => (error || !data || data.version == null ? null : String(data.version)), () => null);
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500));
    return await Promise.race([lees, timeout]);
  } catch {
    return null;
  }
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

    // Catch-up-administratie. De app laadt bij de start alles, dus de effect-
    // mount telt als de laatste volledige ronde. `planningVersie` = de laatst
    // bekende stand (uit events of een eigen lezing); null = onbekend.
    let laatsteVolledig = Date.now();
    let planningVersie: string | null = null;
    // Volgorde: eerst de versie lezen, dan pas ophalen. Zo is de bewaarde
    // versie nooit nieuwer dan de data (hooguit één overbodige refetch later).
    const volledigeCatchUp = () => {
      laatsteVolledig = Date.now();
      void leesPlanningVersie().then((versie) => {
        planningVersie = versie;
        return refRef.current.refetchAll?.();
      });
    };
    const lichteCatchUp = () => {
      void leesPlanningVersie().then((versie) => {
        const gewijzigd = versie === null || planningVersie === null || versie !== planningVersie;
        if (versie !== null) planningVersie = versie;
        return refRef.current.refetchLicht?.({ planning: gewijzigd });
      });
    };

    // Eén debounce-venster voor beide bronnen (reconnect en zichtbaar worden
    // vallen vaak samen). Een gevraagde volledige ronde mag in dat venster
    // nooit door een lichte vervangen worden, in welke volgorde ze ook komen.
    let volledigGevraagd = false;
    const vraagCatchUp = (soort: Exclude<CatchUp, 'geen'>) => {
      if (soort === 'volledig') volledigGevraagd = true;
      debounce('catch-up', () => {
        const volledig = volledigGevraagd;
        volledigGevraagd = false;
        if (volledig) volledigeCatchUp();
        else lichteCatchUp();
      });
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
        (payload) => {
          // Stand bijhouden voor de lichte catch-up: wat via de socket al
          // verwerkt is, hoeft bij terugkeer naar het tabblad niet opnieuw.
          const nieuw = (payload as { new?: { version?: unknown } })?.new?.version;
          if (nieuw != null) planningVersie = String(nieuw);
          debounce('planning-version', () => {
            refRef.current.refetchPlanning?.();
            refRef.current.refetchMatrix?.();
          });
        },
      )
      .subscribe((status) => {
        // Na élke (her)aansluiting één catch-up: events die tijdens een dode
        // socket vielen (telefoon in de zak, nacht) zijn definitief gemist —
        // zonder deze refetch keek een heropende PWA naar de staat van
        // gisteren tot iemand handmatig ververste.
        if (status === 'SUBSCRIBED') {
          if (firstSubscribe.current) {
            firstSubscribe.current = false; // de app laadt initieel al alles
            // Uitgangsstand voor de versiecheck (één lichte Supabase-call,
            // buiten het kritieke pad en geen serverless functie).
            void leesPlanningVersie().then((versie) => { if (planningVersie === null) planningVersie = versie; });
            return;
          }
          // Reconnect = altijd de volledige set: gemiste events zijn weg.
          vraagCatchUp('volledig');
        }
      });

    // Heropenen van de app (tab/PWA weer zichtbaar na ≥ 60s weg): catch-up
    // volgens `kiesCatchUp`. visibilitychange is betrouwbaarder dan
    // socket-status op iOS. Een reconnect in hetzelfde moment wint altijd
    // (vraagCatchUp).
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt !== null) {
        const soort = kiesCatchUp(Date.now() - hiddenAt, Date.now() - laatsteVolledig);
        if (soort !== 'geen') vraagCatchUp(soort);
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
