type Clock = () => number;

/**
 * Kleine stale-while-revalidate-cache voor één waarde (ronde 3, 19-09).
 *
 *  - binnen `ttlMs`: de gecachte waarde, vers;
 *  - daarna, tot `staleMs` oud: de OUDE waarde meteen teruggeven en op de
 *    achtergrond verversen (hooguit één verversing tegelijk), zodat het
 *    request dat toevallig net na de TTL komt niet op de database wacht;
 *  - ouder dan `staleMs` of nooit geladen: wachten, zoals vroeger.
 *
 * `epoch` levert de stand van de gedeelde epoch (userCache.epochStand). Het
 * stale-pad mag alleen wanneer die epoch nét met succes geverifieerd is ÉN
 * nog dezelfde is als toen de waarde geladen werd: dan weten we dat er
 * elders niets is ingetrokken of omgezet, want elke wijziging verhoogt die
 * epoch (en wist deze cache via invalidate). Zonder bereikbare store is er
 * geen stale-pad en gedraagt dit zich exact als de oude TTL-cache. Zo wordt
 * intrekken of omzetten nooit trager dan het was.
 *
 * invalidate() gooit ALTIJD alles weg (ook een lopende verversing mag de
 * cache daarna niet meer vullen): de volgende lezer wacht op verse data.
 */
export function maakSwrCache<T>(
  laad: () => Promise<T>,
  opts: { ttlMs: number; staleMs: number; epoch: () => { waarde: number | null; vers: boolean }; now?: Clock },
) {
  const { ttlMs, staleMs } = opts;
  const now = opts.now ?? (() => Date.now());
  let cache: { value: T; at: number; basis: number | null } | null = null;
  let inflight: Promise<T> | null = null;
  let generatie = 0;

  const ververs = (): Promise<T> => {
    if (inflight) return inflight;
    // De epoch zoals bekend bij de START van het laden (null = onbekend).
    // Eerst lezen: dit kan een verse waarneming overnemen en via de
    // luisteraar invalidate() aanroepen.
    const basis = opts.epoch().waarde;
    const gestart = generatie;
    const p = (async () => {
      try {
        const value = await laad();
        if (generatie === gestart) cache = { value, at: now(), basis };
        return value;
      } finally {
        if (inflight === p) inflight = null;
      }
    })();
    inflight = p;
    return p;
  };

  const get = async (): Promise<T> => {
    const t = now();
    // Eerst de epoch-stand (kan de cache wissen), dan pas de cache lezen.
    const stand = opts.epoch();
    const huidig = cache;
    if (huidig) {
      const leeftijd = t - huidig.at;
      if (leeftijd < ttlMs) return huidig.value;
      if (leeftijd < staleMs && stand.vers && huidig.basis !== null && huidig.basis === stand.waarde) {
        // Achtergrond: een fout hier mag het lopende request niet raken; de
        // oude waarde blijft staan tot ze te oud is, dan wacht (en faalt) de
        // volgende lezer zoals vroeger.
        void ververs().catch(() => undefined);
        return huidig.value;
      }
    }
    return ververs();
  };

  const invalidate = () => {
    cache = null;
    inflight = null;
    generatie += 1;
  };

  return { get, invalidate };
}

/** Bovengrens van het stale-venster voor de auth-caches. */
export const SWR_STALE_MS = 5 * 60_000;
