import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOnline } from './useOnline';
import { formatSyncedTime } from './format';

/**
 * Eén laad-, fout- en versheidsmodel voor schermen die hun eigen data
 * ophalen (gele boek, vervaldata, voertuigen, loon, dekking, …). Vóór dit
 * bestand had elk scherm zijn eigen `isLoading`/`error`-boilerplate, een
 * eigen "Ververs"-knop en hooguit één (het gele boek) een focus-refresh.
 *
 * Wat de hook doet:
 * - `laad()` uitvoeren bij mount en bij elke wissel van `deps` (zichtbaar:
 *   `laden` = true, fout gewist); een oud antwoord dat ná een nieuwere
 *   start binnenkomt wordt genegeerd (versieteller).
 * - `opnieuw()` = dezelfde zichtbare laad, voor de knop op de Foutkaart.
 * - `ververs()` = stil (geen skelet, bestaande data blijft staan); een
 *   mislukte stille verversing laat `fout` met rust, alleen `laatstGeladen`
 *   blijft dan oud. Een geslaagde wist een fout van een eerdere laad.
 * - Focus-refresh: bij terugkeer naar het tabblad (visibilitychange/focus)
 *   stil verversen, hooguit één keer per `focusIntervalMs` (60 s), en niet
 *   zolang het toestel offline is (useOnline). Komt de verbinding terug,
 *   dan volgt één stille verversing.
 * - `onthoudenOm`: het scherm toont bij de mount al gegevens uit zijn
 *   geheugen (src/lib/schermGeheugen.ts); dan geen skelet maar een stille
 *   eerste laad, zie de optie.
 *
 * De weergave (Foutkaart, VersheidRegel) staat in components/ui.tsx; dit
 * bestand blijft JSX-vrij zodat de kern met fake timers te testen is.
 */
export type ZelfLadendOpties = {
  /** Afhankelijkheden waarop opnieuw (zichtbaar) geladen wordt. */
  deps?: readonly unknown[];
  /** Vaste foutboodschap, of een vertaling van de gevangen fout; zonder
   *  opgave de `message` van de Error, anders een algemene tekst. */
  boodschap?: string | ((fout: unknown) => string);
  /** Minimale tijd tussen twee focus-verversingen (ms). */
  focusIntervalMs?: number;
  /** Focus-refresh uit (bv. voor schermen met realtime-verversing). */
  focusRefresh?: boolean;
  /** Tijdstip (epoch-ms) van de gegevens die het scherm bij de mount al uit
   *  het geheugen toont (src/lib/schermGeheugen.ts); alleen bij de mount
   *  gelezen. Dan geen skelet: de eerste laad is stil, `laatstGeladen` is dat
   *  tijdstip en de regel noemt het ook tijdens het verversen (niet
   *  "Bijwerken…", dat de leeftijd zou verbergen), tot een laad slaagt. Zolang
   *  de gegevens niet van dit bezoek zijn, toont ook een stille laad haar
   *  fout. Een deps-wissel laadt zichtbaar, zoals zonder geheugen. */
  onthoudenOm?: number | null;
};

export type Versheid = {
  laatstGeladen: number | null;
  verversen: boolean;
  online: boolean;
};

export type ZelfLadend = {
  /** Zichtbare laad (eerste keer, deps-wissel, opnieuw). */
  laden: boolean;
  /** Stille verversing bezig. */
  verversen: boolean;
  /** Laadfout van de laatste zichtbare laad; null als die lukte of als een
   *  latere laad (ook een stille) slaagde. */
  fout: string | null;
  /** Epoch-ms van de laatste geslaagde laad. */
  laatstGeladen: number | null;
  online: boolean;
  /** Zichtbaar herladen (wist de fout). */
  opnieuw: () => Promise<void>;
  /** Stil herladen (na een eigen schrijfactie, realtime-signaal, focus). */
  ververs: () => Promise<void>;
  /** Bundel voor <VersheidRegel {...versheid} />. */
  versheid: Versheid;
};

export const FOCUS_INTERVAL_MS = 60_000;
const ALGEMENE_FOUT = 'Kon de gegevens niet laden.';

export function foutTekst(fout: unknown, boodschap?: ZelfLadendOpties['boodschap']): string {
  if (typeof boodschap === 'function') return boodschap(fout);
  if (typeof boodschap === 'string') return boodschap;
  if (fout instanceof Error && fout.message.trim()) return fout.message;
  return ALGEMENE_FOUT;
}

/** "Bijgewerkt om 14:32", "Bijwerken…" of, zonder bereik, "Offline · …". */
export function versheidTekst({ laatstGeladen, verversen, online }: Versheid): string {
  const kern = verversen ? 'Bijwerken…' : laatstGeladen ? `Bijgewerkt om ${formatSyncedTime(laatstGeladen)}` : '';
  if (!kern) return online ? '' : 'Offline';
  return online ? kern : `Offline · ${kern}`;
}

export function useZelfLadend(laad: () => Promise<void>, opties: ZelfLadendOpties = {}): ZelfLadend {
  const { deps = [], boodschap, focusIntervalMs = FOCUS_INTERVAL_MS, focusRefresh = true, onthoudenOm = null } = opties;
  const online = useOnline();
  // Gegevens uit het geheugen: de deps waarvoor ze gelden, tot een laad
  // slaagt of de deps wisselen (null = de gegevens zijn van dit bezoek).
  const geheugen = useRef(onthoudenOm === null ? null : deps);
  const [laden, setLaden] = useState(onthoudenOm === null);
  const [verversen, setVerversen] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [laatstGeladen, setLaatstGeladen] = useState<number | null>(onthoudenOm);

  // Altijd de laatste closure van `laad` (filters, maand, …) zonder dat de
  // aanroeper een useCallback hoeft te schrijven.
  const laadRef = useRef(laad);
  laadRef.current = laad;
  const boodschapRef = useRef(boodschap);
  boodschapRef.current = boodschap;
  const versie = useRef(0);
  const laatsteStart = useRef(0);
  const actief = useRef(true);
  const onlineRef = useRef(online);
  onlineRef.current = online;

  const voer = useCallback(async (stil: boolean) => {
    const mijn = ++versie.current;
    laatsteStart.current = Date.now();
    const isActueel = () => actief.current && mijn === versie.current;
    if (stil) setVerversen(true);
    else { setLaden(true); setFout(null); }
    try {
      await laadRef.current();
      if (!isActueel()) return;
      geheugen.current = null;
      setLaatstGeladen(Date.now());
      // Ook na een stille laad: de data is nu vers, dus een fout van een
      // eerdere laad (bereik weg, daarna terug) klopt niet meer. Zonder dit
      // bleef "Bijwerken is niet gelukt" staan boven een net bijgewerkte lijst.
      setFout(null);
    } catch (e) {
      if (!isActueel()) return;
      // Stil: bestaande data blijft staan, geen foutkaart over een gevulde
      // lijst; de volgende zichtbare laad of focus-verversing herstelt het.
      // Behalve als die data uit het geheugen komt: dan is ze niet van dit
      // bezoek en hoort de gebruiker dat het bijwerken niet lukte.
      if (!stil || geheugen.current) setFout(foutTekst(e, boodschapRef.current));
    } finally {
      if (isActueel()) { if (stil) setVerversen(false); else setLaden(false); }
    }
  }, []);

  const opnieuw = useCallback(() => voer(false), [voer]);
  const ververs = useCallback(() => voer(true), [voer]);

  useEffect(() => {
    actief.current = true;
    return () => { actief.current = false; };
  }, []);

  // Mount + deps-wissel: zichtbaar laden. Een lopende oudere laad verliest
  // door de versieteller. Met gegevens uit het geheugen voor deze deps stil
  // (vergeleken en niet geteld: StrictMode voert het effect twee keer uit).
  useEffect(() => {
    const g = geheugen.current;
    const uitGeheugen = !!g && g.every((d, i) => d === deps[i]);
    if (!uitGeheugen) geheugen.current = null;
    void voer(uitGeheugen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Focus-refresh, met minimuminterval en alleen met bereik.
  useEffect(() => {
    if (!focusRefresh || typeof document === 'undefined') return;
    const bijFocus = () => {
      if (document.visibilityState !== 'visible') return;
      if (!onlineRef.current) return;
      if (Date.now() - laatsteStart.current < focusIntervalMs) return;
      void voer(true);
    };
    document.addEventListener('visibilitychange', bijFocus);
    window.addEventListener('focus', bijFocus);
    return () => {
      document.removeEventListener('visibilitychange', bijFocus);
      window.removeEventListener('focus', bijFocus);
    };
  }, [focusRefresh, focusIntervalMs, voer]);

  // Verbinding terug: één stille verversing (ook als de laatste laad faalde
  // door het wegvallen ervan; de Foutkaart blijft tot die slaagt of de
  // aanroeper "Opnieuw" doet).
  const wasOffline = useRef(false);
  useEffect(() => {
    if (!online) { wasOffline.current = true; return; }
    if (wasOffline.current) { wasOffline.current = false; void voer(true); }
  }, [online, voer]);

  // Uit het geheugen noemt de regel de tijd van die lezing, ook tijdens het
  // verversen; `verversen` zelf blijft de waarheid.
  const regelVerversen = verversen && !geheugen.current;
  const versheid = useMemo<Versheid>(() => ({ laatstGeladen, verversen: regelVerversen, online }), [laatstGeladen, regelVerversen, online]);

  return { laden, verversen, fout, laatstGeladen, online, opnieuw, ververs, versheid };
}
