import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Role, View } from '../types';

/**
 * Aanwezigheid ("wie is er nu in het portaal?") via Supabase Realtime
 * presence. Alleen voor staf (planner/admin): zij zien elkaar én op welk
 * scherm de ander zit — handig vóór je een hele collectie opslaat. Chauffeurs
 * tracken niet en zien niets (privacy): voor hen is de lijst altijd leeg.
 *
 * Eén channel (`vhb-aanwezigheid`) met de user-id als presence-sleutel; twee
 * tabbladen van dezelfde persoon vallen zo samen op één rij. De eigen staat
 * wordt bij elke schermwissel opnieuw ge-tracked (gethrottled, zodat snel
 * doorklikken niet per klik een bericht stuurt). Bij unmount, sign-out of
 * rolwissel wordt het channel netjes verwijderd — de server ruimt de
 * presence dan meteen op voor de anderen.
 *
 * De lijst van anderen leeft in een module-store (useSyncExternalStore) i.p.v.
 * een context: App.tsx hoeft alleen de hook aan te roepen, en elk scherm kan
 * met `useAanwezigen()` lezen wie er is zonder props of provider.
 */
export type Aanwezige = {
  userId: string;
  naam: string;
  rol: Role;
  view: View;
  /** ISO-tijdstip waarop deze persoon het portaal opende. */
  sinds: string;
};

const KANAAL = 'vhb-aanwezigheid';
/** Schermwissels sneller dan dit worden samengevoegd tot één track-bericht. */
export const PRESENCE_THROTTLE_MS = 1500;
/** Alleen voor screenshots/e2e: een JSON-lijst van `Aanwezige` in localStorage
 *  vervangt het echte channel (er is dan geen Supabase-verkeer). */
const MOCK_SLEUTEL = 'vhb-aanwezigheid-mock';

const isStaf = (rol: Role | undefined) => rol === 'planner' || rol === 'admin';

// --- module-store ---
let anderen: Aanwezige[] = [];
const luisteraars = new Set<() => void>();
const zetAnderen = (lijst: Aanwezige[]) => {
  anderen = lijst;
  luisteraars.forEach((l) => l());
};
const abonneer = (l: () => void) => {
  luisteraars.add(l);
  return () => { luisteraars.delete(l); };
};
const leesAnderen = () => anderen;

/** De collega's (staf) die nu in het portaal zijn — zonder jezelf. Leeg voor
 *  chauffeurs en zolang presence niet actief is. */
export function useAanwezigen(): Aanwezige[] {
  return useSyncExternalStore(abonneer, leesAnderen, leesAnderen);
}

const leesMock = (): Aanwezige[] | null => {
  try {
    const raw = window.localStorage.getItem(MOCK_SLEUTEL);
    if (!raw) return null;
    const lijst = JSON.parse(raw);
    return Array.isArray(lijst) ? (lijst as Aanwezige[]) : null;
  } catch {
    return null;
  }
};

/**
 * Presence-state van het channel → platte lijst van anderen. Per sleutel
 * (user-id) kunnen meerdere tabbladen staan; we nemen het meest recent
 * geopende (grootste `sinds`) zodat de getoonde view de actieve is.
 */
export function anderenUitState(state: Record<string, Array<Record<string, unknown>>>, eigenUserId: string): Aanwezige[] {
  const lijst: Aanwezige[] = [];
  for (const [sleutel, entries] of Object.entries(state)) {
    if (sleutel === eigenUserId) continue;
    let beste: Aanwezige | null = null;
    for (const e of entries) {
      const naam = typeof e.naam === 'string' ? e.naam : '';
      const rol = e.rol as Role;
      if (!naam || !isStaf(rol)) continue;
      const kandidaat: Aanwezige = {
        userId: String(e.userId ?? sleutel),
        naam,
        rol,
        view: (typeof e.view === 'string' ? e.view : 'dashboard') as View,
        sinds: typeof e.sinds === 'string' ? e.sinds : '',
      };
      if (!beste || kandidaat.sinds > beste.sinds) beste = kandidaat;
    }
    if (beste) lijst.push(beste);
  }
  return lijst.sort((a, b) => a.naam.localeCompare(b.naam, 'nl'));
}

export function useAanwezigheid(
  enabled: boolean,
  eigen: { userId: string; naam: string; rol: Role | undefined; view: View },
) {
  const actief = enabled && isStaf(eigen.rol) && !!supabase && !!eigen.userId;
  const eigenRef = useRef(eigen);
  eigenRef.current = eigen;
  const kanaalRef = useRef<RealtimeChannel | null>(null);
  const sindsRef = useRef(new Date().toISOString());
  const laatsteTrackRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  const payload = () => ({
    userId: eigenRef.current.userId,
    naam: eigenRef.current.naam,
    rol: eigenRef.current.rol,
    view: eigenRef.current.view,
    sinds: sindsRef.current,
  });

  const track = () => {
    const kanaal = kanaalRef.current;
    if (!kanaal || typeof kanaal.track !== 'function') return;
    laatsteTrackRef.current = Date.now();
    try {
      void kanaal.track(payload()).catch(() => { /* presence is best-effort */ });
    } catch {
      // Mock-channel of gesloten socket: stil.
    }
  };

  // Aansluiten/loskoppelen: bij (de)activeren of een andere gebruiker.
  useEffect(() => {
    if (!actief) {
      zetAnderen([]);
      return;
    }
    const mock = leesMock();
    if (mock) {
      zetAnderen(mock.filter((a) => a.userId !== eigenRef.current.userId));
      return () => zetAnderen([]);
    }
    const kanaal = supabase!.channel(KANAAL, { config: { presence: { key: eigenRef.current.userId } } });
    kanaalRef.current = kanaal;
    const sync = () => {
      try {
        zetAnderen(anderenUitState(kanaal.presenceState() as Record<string, Array<Record<string, unknown>>>, eigenRef.current.userId));
      } catch {
        // presenceState ontbreekt (mock) — lijst blijft zoals hij was
      }
    };
    kanaal
      .on('presence', { event: 'sync' }, sync)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') track();
      });
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = null;
      kanaalRef.current = null;
      supabase!.removeChannel(kanaal);
      zetAnderen([]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actief, eigen.userId]);

  // Schermwissel → eigen staat bijwerken, gethrottled (leading + trailing):
  // de eerste wissel gaat meteen door, snel doorklikken levert nog één
  // trailing bericht op met het uiteindelijke scherm.
  useEffect(() => {
    if (!actief || !kanaalRef.current) return;
    const verstreken = Date.now() - laatsteTrackRef.current;
    if (verstreken >= PRESENCE_THROTTLE_MS) {
      track();
      return;
    }
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      track();
    }, PRESENCE_THROTTLE_MS - verstreken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actief, eigen.view]);
}
