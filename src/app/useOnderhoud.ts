import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import { GEEN_ONDERHOUD, parseOnderhoud, type Onderhoud, type OnderhoudPubliek } from '../../shared/schemas/onderhoud';

const POLL_MS = 60_000;
const MELDING_STILTE_MS = 10_000;
// Eerste check pas ná de eerste paint en de kritieke keten (login-formulier,
// devices → me → data): een extra request in die aanloop kostte Lighthouse
// meetbaar LCP (login 0,93 → 0,88, Mijn dag 0,87 → 0,78 op 07-09). Drie
// seconden na mount, en dan nog in een idle-slot; de banner is informatief,
// niet kritiek.
const EERSTE_CHECK_MS = 3000;

/** Roept `fn` één keer uitgesteld aan (timer + idle-slot); geeft een stop-functie. */
const naEersteRust = (fn: () => void, ms: number): (() => void) => {
  let idle: number | null = null;
  const timer = window.setTimeout(() => {
    if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(() => fn(), { timeout: 2000 });
    else fn();
  }, ms);
  return () => {
    window.clearTimeout(timer);
    if (idle !== null && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idle);
  };
};

/**
 * Onderhoudsmodus in de schil: GET /api/onderhoud zolang er iemand ingelogd
 * is (eerst uitgesteld, zie EERSTE_CHECK_MS; daarna elke minuut en bij
 * terugkeer naar de voorgrond) en meteen
 * opnieuw wanneer apiFetch een 503 'onderhoud' tegenkwam (event
 * `vhb-onderhoud`, src/lib/api.ts). `opMelding` krijgt de servertekst van
 * zo'n geblokkeerde schrijfactie, hooguit één keer per 10 s: één toast, geen
 * foutscherm.
 */
export function useOnderhoud(ingelogd: boolean, opMelding: (tekst: string) => void): Onderhoud {
  const [onderhoud, setOnderhoud] = useState<Onderhoud>(GEEN_ONDERHOUD);
  const laatsteMelding = useRef(0);
  const opMeldingRef = useRef(opMelding);
  opMeldingRef.current = opMelding;

  useEffect(() => {
    if (!ingelogd) { setOnderhoud(GEEN_ONDERHOUD); return; }
    let actief = true;
    const laad = async () => {
      try {
        const res = await apiFetch('/api/onderhoud');
        if (!res.ok) return;
        const json = await res.json().catch(() => null);
        if (actief) setOnderhoud(parseOnderhoud(json));
      } catch {
        // Stil: de banner is informatief, een mislukte poll mag nooit storen.
      }
    };
    const stopEerste = naEersteRust(() => { void laad(); }, EERSTE_CHECK_MS);
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void laad(); }, POLL_MS);
    const opZichtbaar = () => { if (document.visibilityState === 'visible') void laad(); };
    const opBlok = (event: Event) => {
      const tekst = (event as CustomEvent<{ tekst?: string }>).detail?.tekst;
      const nu = Date.now();
      if (tekst && nu - laatsteMelding.current > MELDING_STILTE_MS) {
        laatsteMelding.current = nu;
        opMeldingRef.current(tekst);
      }
      void laad();
    };
    document.addEventListener('visibilitychange', opZichtbaar);
    window.addEventListener('vhb-onderhoud', opBlok as EventListener);
    return () => {
      actief = false;
      stopEerste();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', opZichtbaar);
      window.removeEventListener('vhb-onderhoud', opBlok as EventListener);
    };
  }, [ingelogd]);

  return onderhoud;
}

/** Loginscherm (geen sessie): één keer GET /api/onderhoud/publiek, pas
 *  nadat het formulier getekend is (zelfde uitstel als in de schil). */
export function useOnderhoudPubliek(): OnderhoudPubliek {
  const [onderhoud, setOnderhoud] = useState<OnderhoudPubliek>({ actief: false, tekst: '' });
  useEffect(() => {
    let actief = true;
    const stop = naEersteRust(() => {
      void fetch('/api/onderhoud/publiek')
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (actief && json && typeof json === 'object' && !Array.isArray(json)) {
            setOnderhoud({ actief: json.actief === true, tekst: typeof json.tekst === 'string' ? json.tekst : '' });
          }
        })
        .catch(() => undefined);
    }, EERSTE_CHECK_MS);
    return () => { actief = false; stop(); };
  }, []);
  return onderhoud;
}
