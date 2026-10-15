import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiJson } from './api';
import { TOON_MEER_STAP, useToonMeer, type ToonMeerStand } from '../components/ToonMeer';

/**
 * Het archief van een lijst die de server begrenst (15-10, Jarno: de
 * historiek houden zonder dat de opstart mee groeit). De opstart geeft het
 * venster (wat open staat en de laatste maanden); wat ouder is vraagt het
 * scherm per pagina op, pas als het opengaat: `GET <pad>?vanaf=&aantal=`
 * geeft `{ <veld>: [...], totaal }`.
 *
 * `useArchief` haalt de eerste pagina meteen (zo kent de lijst het totaal en
 * staan de eerste tien klaar), de volgende op vraag. Wisselt het pad (een
 * filter in de querystring), dan begint het opnieuw; een antwoord op een oud
 * pad telt niet meer. `pad` null = geen archief (een rol of filter zonder).
 */
export type ArchiefStand<T> = {
  /** false = geen archief (pad null): de lijst is het venster alleen. */
  actief: boolean;
  /** Wat er geladen is, in de volgorde van de server. */
  items: T[];
  /** Hoeveel er in het hele archief zitten; null zolang de eerste pagina onderweg is. */
  totaal: number | null;
  bezig: boolean;
  fout: boolean;
  laadVolgende: () => Promise<void>;
};

type Stand<T> = { pad: string | null; items: T[]; totaal: number | null; bezig: boolean; fout: boolean };

export function useArchief<T extends { id: string }>(
  pad: string | null,
  { veld, aantal = TOON_MEER_STAP }: { veld: string; aantal?: number },
): ArchiefStand<T> {
  const [stand, setStand] = useState<Stand<T>>({ pad, items: [], totaal: null, bezig: false, fout: false });
  const huidig = useRef(stand);
  huidig.current = stand;
  // Elke laadbeurt draagt haar pad: een antwoord voor een vorig pad (filter
  // intussen gewijzigd) wordt genegeerd.
  const padRef = useRef(pad);
  padRef.current = pad;

  const haal = useCallback(async (voorPad: string, vanaf: number) => {
    setStand((s) => (s.pad === voorPad ? { ...s, bezig: true, fout: false } : s));
    try {
      const scheiding = voorPad.includes('?') ? '&' : '?';
      const antwoord = await apiJson<Record<string, unknown>>(`${voorPad}${scheiding}vanaf=${vanaf}&aantal=${aantal}`);
      if (padRef.current !== voorPad) return;
      const nieuw = Array.isArray(antwoord?.[veld]) ? (antwoord[veld] as T[]) : [];
      const totaal = typeof antwoord?.totaal === 'number' ? antwoord.totaal : null;
      setStand((s) => {
        if (s.pad !== voorPad) return s;
        const bekend = new Set(s.items.map((x) => x.id));
        return { ...s, items: [...s.items, ...nieuw.filter((x) => !bekend.has(x.id))], totaal, bezig: false };
      });
    } catch {
      setStand((s) => (s.pad === voorPad ? { ...s, bezig: false, fout: true } : s));
    }
  }, [aantal, veld]);

  useEffect(() => {
    setStand({ pad, items: [], totaal: null, bezig: false, fout: false });
    if (pad) void haal(pad, 0);
  }, [pad, haal]);

  const laadVolgende = useCallback(async () => {
    const s = huidig.current;
    if (!s.pad || s.bezig) return;
    // Na een mislukte eerste pagina is er nog geen totaal: opnieuw van voren.
    if (s.totaal !== null && s.items.length >= s.totaal) return;
    await haal(s.pad, s.items.length);
  }, [haal]);

  const actueel = stand.pad === pad ? stand : { items: [] as T[], totaal: null, bezig: false, fout: false };
  return { actief: pad !== null, items: actueel.items, totaal: actueel.totaal, bezig: actueel.bezig, fout: actueel.fout, laadVolgende };
}

export type ToonMeerMetArchief<T> = Omit<ToonMeerStand<T>, 'totaal'> & {
  /** Venster plus archief; null zolang het archief zijn totaal nog niet gaf. */
  totaal: number | null;
  bezig: boolean;
  fout: boolean;
};

/**
 * "Toon meer" over het venster én het archief als één lijst: eerst wat lokaal
 * staat, daarna het archief, tien per stap (useToonMeer). Raakt wat geladen
 * is op, dan komt de volgende pagina van de server. Een record dat in beide
 * zit (de grens verschoof tussen de opstart en het archief) telt één keer.
 */
export function useToonMeerMetArchief<T extends { id: string }>(
  lokaal: readonly T[],
  archief: ArchiefStand<T>,
  opties: { stap?: number; sleutel?: string; doel?: (item: T) => boolean } = {},
): ToonMeerMetArchief<T> {
  const stap = Math.max(1, opties.stap ?? TOON_MEER_STAP);
  const lokaleIds = useMemo(() => new Set(lokaal.map((x) => x.id)), [lokaal]);
  const extra = useMemo(() => archief.items.filter((x) => !lokaleIds.has(x.id)), [archief.items, lokaleIds]);
  const geheel = useMemo(() => [...lokaal, ...extra], [lokaal, extra]);
  const lijst = useToonMeer(geheel, opties);
  // Wat het archief echt toevoegt: zijn totaal min wat al lokaal staat.
  const archiefTotaal = !archief.actief ? 0 : archief.totaal === null ? null : Math.max(0, archief.totaal - (archief.items.length - extra.length));
  const totaal = archiefTotaal === null ? null : lokaal.length + archiefTotaal;
  // Mislukte de eerste pagina, dan is er geen totaal: de knop probeert opnieuw.
  const opnieuw = archief.fout && archiefTotaal === null && lijst.volgende === 0;
  const volgende = opnieuw ? stap : totaal === null ? lijst.volgende : Math.min(stap, Math.max(0, totaal - lijst.getoond));

  const meer = () => {
    if (opnieuw) { void archief.laadVolgende(); return; }
    // Staat er minder klaar dan de volgende stap vraagt, dan een pagina bij.
    if (geheel.length < lijst.getoond + stap && totaal !== null && geheel.length < totaal) void archief.laadVolgende();
    lijst.meer();
  };

  return { zichtbaar: lijst.zichtbaar, getoond: lijst.getoond, totaal, volgende, meer, bezig: archief.bezig, fout: archief.fout };
}
