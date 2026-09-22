import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { leesFout, meldSchrijffout, vervolgstap } from './fouten';

/**
 * Autosave per cel (tranche 3A, 22-09-2026): Dagadministratie en de
 * matricules in Looncontrole bewaren elke cel zodra je hem verlaat. Dat
 * blijft zo, maar betrouwbaar:
 *
 * - Elke cel toont zijn eigen stand: bezig (spinner), bewaard (kort een
 *   vinkje), mislukt (reden bij de cel + "Opnieuw" dat precies die waarde
 *   opnieuw stuurt). De getypte waarde blijft staan, er wordt niets stil
 *   teruggezet.
 * - Ongeldige invoer (geen heel getal) is een fout bij de cel, zonder
 *   request, in plaats van stil genegeerd te worden.
 * - Een save die loopt wordt nooit afgebroken: ook als de cel verdwijnt
 *   (ander scherm, filter, andere dag) gaat de promise door. Mislukt hij
 *   daarna, dan meldt een toast het, met "Opnieuw proberen". Verdwijnt een
 *   cel die al mislukt was, dan komt dezelfde toast.
 * - Zolang er een save loopt of een cel mislukt en onbewaard is, waarschuwt
 *   de browser bij tabblad sluiten of herladen. Dat staat hier op
 *   moduleniveau en niet in een component, zodat het ook geldt voor een
 *   save die nog loopt nadat zijn scherm al weg is. De router van de app
 *   kent geen navigatiebewaker; binnen de app navigeren laat de saves dus
 *   gewoon doorlopen.
 *
 *   const cel = useAutosaveCel({ actie: `Overminuten van ${naam} bewaren`, bewaar: (n: number) => bewaarRij(…, { overmin: n }), opGelukt: vervang });
 *   onBlur: cel.bewaar(n)  |  cel.ongeldig(tekst, 'Vul een heel aantal minuten in.')
 */

export type AutosaveStaat<T> =
  | { status: 'rust' }
  | { status: 'bezig'; waarde: T }
  | { status: 'bewaard' }
  /** `opnieuw` is null bij ongeldige invoer: dan moet de invoer eerst anders. */
  | { status: 'fout'; waarde: T; melding: string; opnieuw: (() => void) | null };

// --- Moduleniveau: lopende en mislukte saves, voor de verlaatwaarschuwing ---

let inVlucht = 0;
const mislukt = new Set<number>();
const luisteraars = new Set<() => void>();
let volgendeCel = 0;

export const autosaveOnrustig = () => inVlucht > 0 || mislukt.size > 0;

const onBeforeUnload = (event: BeforeUnloadEvent) => {
  if (!autosaveOnrustig()) return;
  event.preventDefault();
  // Chromium wil nog een returnValue; de tekst zelf toont de browser niet.
  event.returnValue = '';
};
let luistert = false;
function meld() {
  const moet = autosaveOnrustig();
  if (typeof window !== 'undefined' && moet !== luistert) {
    // Alleen een listener zolang het nodig is: een vaste beforeunload
    // sluit in sommige browsers de back-forward-cache uit.
    if (moet) window.addEventListener('beforeunload', onBeforeUnload);
    else window.removeEventListener('beforeunload', onBeforeUnload);
    luistert = moet;
  }
  luisteraars.forEach((l) => l());
}
function zetMislukt(cel: number, aan: boolean) {
  if (aan === mislukt.has(cel)) return;
  if (aan) mislukt.add(cel); else mislukt.delete(cel);
  meld();
}
const abonneer = (l: () => void) => { luisteraars.add(l); return () => { luisteraars.delete(l); }; };

/** Loopt er ergens een save of staat er een mislukte cel? */
export function useAutosaveOnrustig(): boolean {
  return useSyncExternalStore(abonneer, autosaveOnrustig, autosaveOnrustig);
}

/** Alleen voor tests. */
export function resetAutosaveVoorTest() {
  inVlucht = 0;
  mislukt.clear();
  meld();
}

/** De korte tekst bij de cel: niet bewaard + reden + wat nu. */
export function celFoutTekst(err: unknown): string {
  const info = leesFout(err);
  const zin = (t: string) => (/[.!?]$/.test(t) ? t : `${t}.`);
  return ['Niet bewaard.', ...(info.tekst ? [zin(info.tekst)] : []), vervolgstap(info)].join(' ');
}

export function useAutosaveCel<T, R = unknown>(opties: {
  /** Werkwoordsvorm voor de toast na het verlaten, bv. "Overminuten van Jan bewaren". */
  actie: string;
  /** Het idempotente schrijfpad (PUT/PATCH op een id): opnieuw sturen is veilig. */
  bewaar: (waarde: T) => Promise<R>;
  /** Na een geslaagde save, alleen voor de laatste poging van deze cel. */
  opGelukt?: (resultaat: R) => void;
  /** Hoe lang het vinkje blijft staan (ms). */
  bewaardMs?: number;
}) {
  const [staat, zetStaat] = useState<AutosaveStaat<T>>({ status: 'rust' });
  const laatste = useRef(opties);
  laatste.current = opties;
  const gemonteerd = useRef(true);
  // `poging` = laatste wijziging van de stand (ook ongeldig/wis), `verzoek` =
  // laatste request: een ouder antwoord mag de rij nog bijwerken zolang er
  // geen nieuwer request is, maar nooit een nieuwere stand overschrijven.
  const poging = useRef(0);
  const verzoek = useRef(0);
  const cel = useRef(0);
  if (cel.current === 0) cel.current = ++volgendeCel;
  const vinkje = useRef<number | undefined>(undefined);
  // De laatste mislukte request van deze cel, zolang die de stand is.
  const openFout = useRef<{ err: unknown; opnieuw: () => void } | null>(null);

  useEffect(() => {
    gemonteerd.current = true;
    return () => {
      gemonteerd.current = false;
      window.clearTimeout(vinkje.current);
      // Een cel met een mislukte save verdwijnt (ander scherm, filter,
      // andere dag): de fout mag niet mee verdwijnen, dus een toast met
      // "Opnieuw proberen". Ongeldige invoer is nooit verstuurd en gaat weg.
      const f = openFout.current;
      openFout.current = null;
      if (f) meldSchrijffout(laatste.current.actie, f.err, f.opnieuw);
      zetMislukt(cel.current, false);
    };
  }, []);

  const voerUit = useCallback((waarde: T) => {
    const nr = ++poging.current;
    const req = ++verzoek.current;
    openFout.current = null;
    window.clearTimeout(vinkje.current);
    if (gemonteerd.current) {
      zetStaat({ status: 'bezig', waarde });
      zetMislukt(cel.current, false);
    }
    inVlucht += 1;
    meld();
    const { bewaar, actie } = laatste.current;
    let p: Promise<R>;
    try { p = Promise.resolve(bewaar(waarde)); } catch (err) { p = Promise.reject(err); }
    p.then(
      (resultaat) => {
        if (req === verzoek.current) laatste.current.opGelukt?.(resultaat);
        if (nr !== poging.current || !gemonteerd.current) return;
        zetStaat({ status: 'bewaard' });
        vinkje.current = window.setTimeout(() => {
          if (gemonteerd.current) zetStaat((s) => (s.status === 'bewaard' ? { status: 'rust' } : s));
        }, laatste.current.bewaardMs ?? 1500);
      },
      (err: unknown) => {
        if (nr !== poging.current) return;
        const opnieuw = () => voerUit(waarde);
        if (!gemonteerd.current) {
          // De cel is weg, de save liep nog: melden via een toast.
          meldSchrijffout(actie, err, opnieuw);
          return;
        }
        openFout.current = { err, opnieuw };
        zetStaat({ status: 'fout', waarde, melding: celFoutTekst(err), opnieuw });
        zetMislukt(cel.current, true);
      },
    ).finally(() => {
      inVlucht -= 1;
      meld();
    });
  }, []);

  /** Ongeldige invoer: fout bij de cel, geen request. */
  const ongeldig = useCallback((waarde: T, melding: string) => {
    poging.current += 1; // een lopende oudere save mag deze fout niet wissen
    openFout.current = null;
    window.clearTimeout(vinkje.current);
    zetStaat({ status: 'fout', waarde, melding, opnieuw: null });
    zetMislukt(cel.current, true);
  }, []);

  /** Terug naar rust, bv. als de invoer weer gelijk is aan wat bewaard is. */
  const wis = useCallback(() => {
    poging.current += 1;
    openFout.current = null;
    window.clearTimeout(vinkje.current);
    zetStaat({ status: 'rust' });
    zetMislukt(cel.current, false);
  }, []);

  /** Wat de cel moet tonen: de waarde die bewaard wordt of mislukte, anders die van de server. */
  const toon = (serverWaarde: T): T => (staat.status === 'bezig' || staat.status === 'fout' ? staat.waarde : serverWaarde);

  /**
   * De gebruiker koos een waarde (blur, change). Gelijk aan wat bewaard is:
   * niets sturen (een mislukte stand verdwijnt dan), behalve als er nog een
   * andere waarde onderweg is, want die moet dan overschreven worden.
   * Gelijk aan wat al onderweg is: niet nog eens.
   */
  const verander = (waarde: T, serverWaarde: T, gelijk: (a: T, b: T) => boolean = Object.is) => {
    if (staat.status === 'bezig' && gelijk(waarde, staat.waarde)) return;
    if (staat.status !== 'bezig' && gelijk(waarde, serverWaarde)) {
      if (staat.status === 'fout') wis();
      return;
    }
    voerUit(waarde);
  };

  return { staat, bewaar: voerUit, verander, ongeldig, wis, toon };
}
