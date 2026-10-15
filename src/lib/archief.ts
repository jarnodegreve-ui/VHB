import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiJson } from './api';
import { TOON_MEER_STAP, useToonMeer, type ToonMeerStand } from '../components/ToonMeer';

/**
 * Het archief van een lijst die de server begrenst (15-10, Jarno: de
 * historiek houden zonder dat de opstart mee groeit). De opstart geeft het
 * venster (wat open staat en de laatste maanden); wat ouder is vraagt het
 * scherm per pagina op, pas als het opengaat: `GET <pad>?vanaf=&aantal=`
 * geeft `{ <veld>: [...], totaal, grens }`.
 *
 * `useArchief` haalt de eerste pagina meteen (zo kent de lijst het totaal en
 * staan de eerste tien klaar), de volgende op vraag. Wisselt het pad (een
 * filter in de querystring), dan begint het opnieuw. `pad` null = geen
 * archief (een rol of filter zonder).
 *
 * De pagina's tellen op een plaats in het archief, en dat archief kan
 * verschuiven terwijl het scherm open staat: een beslissing zet een ruil erin,
 * de eerste van de maand een hele maand. Geeft een volgende pagina een ander
 * totaal of een andere grens dan de eerste, of brengt ze niets nieuws terwijl
 * er nog moeten zijn, dan begint het archief opnieuw van voren met zoveel als
 * er al stond (tegenlezing 15-10: anders bleef de knop eeuwig staan).
 */
export type ArchiefStand<T> = {
  /** false = geen archief (pad null): de lijst is het venster alleen. */
  actief: boolean;
  /** Wat er geladen is, in de volgorde van de server. */
  items: T[];
  /** Hoeveel er in het hele archief zitten; null zolang de eerste pagina er niet is. */
  totaal: number | null;
  /** Er is een vraag onderweg (ook de eerste pagina, meteen vanaf de eerste render). */
  bezig: boolean;
  /** De laatste vraag kwam niet. */
  fout: boolean;
  /** De volgende pagina; na een mislukte vraag dezelfde opnieuw. */
  laadVolgende: () => void;
  /** Opnieuw van voren, met zoveel als er al geladen was. */
  herlaad: () => void;
};

/** Meer geeft de server niet per pagina (GET /api/swaps/archief). */
const MAX_PAGINA = 50;

type Stand<T> = { pad: string | null; items: T[]; totaal: number | null; grens: string | null; bezig: boolean; fout: boolean };

const beginStand = <T,>(pad: string | null): Stand<T> => ({ pad, items: [], totaal: null, grens: null, bezig: pad !== null, fout: false });

const uniek = <T extends { id: string }>(lijst: T[]): T[] => {
  const gezien = new Set<string>();
  return lijst.filter((x) => (gezien.has(x.id) ? false : (gezien.add(x.id), true)));
};

export function useArchief<T extends { id: string }>(
  pad: string | null,
  { veld, aantal = TOON_MEER_STAP }: { veld: string; aantal?: number },
): ArchiefStand<T> {
  const [stand, setStand] = useState<Stand<T>>(() => beginStand<T>(pad));
  const huidig = useRef(stand);
  huidig.current = stand;
  const padRef = useRef(pad);
  padRef.current = pad;
  // Elke laadbeurt draagt een generatie: een ander pad of een herstart maakt
  // elk antwoord dat nog onderweg is ongeldig, ook als het pad daarna weer
  // hetzelfde is (A → B → A met een pagina van de eerste A onderweg).
  const generatie = useRef(0);

  // Wat er opnieuw moet als de laatste vraag mislukte: een herstart van
  // voren (met hoeveel er moesten staan) of null = de volgende pagina. Zo
  // probeert "Opnieuw proberen" exact de vraag die faalde, ook een herstart
  // na een verschoven archief (tegenlezing 15-10, ronde 2).
  const opnieuwVanVoren = useRef<number | null>(null);

  // Gewone functies achter een ref: de volgende pagina start bij een
  // verschoven archief zelf een herstart, en de knoppen en effecten houden
  // een vaste identiteit.
  const acties = useRef({ vanVoren: async (_tot: number) => {}, volgende: async () => {} });
  const vraag = async (voorPad: string, vanaf: number, hoeveel: number) => {
    const scheiding = voorPad.includes('?') ? '&' : '?';
    const antwoord = await apiJson<Record<string, unknown>>(`${voorPad}${scheiding}vanaf=${vanaf}&aantal=${hoeveel}`);
    return {
      nieuw: Array.isArray(antwoord?.[veld]) ? (antwoord[veld] as T[]) : [],
      totaal: typeof antwoord?.totaal === 'number' ? antwoord.totaal : null,
      grens: typeof antwoord?.grens === 'string' ? antwoord.grens : null,
    };
  };
  /** Van voren tot `tot` records, per pagina van hoogstens MAX_PAGINA: wie al
   *  70 oudere in beeld had, houdt er na een herstart 70, niet 50. De lijst
   *  op het scherm blijft staan tot alles binnen is. */
  acties.current.vanVoren = async (tot) => {
    const voorPad = padRef.current;
    if (!voorPad) return;
    generatie.current += 1;
    const gen = generatie.current;
    const geldig = () => generatie.current === gen && padRef.current === voorPad;
    const doel = Math.max(aantal, tot);
    setStand((s) => (s.pad === voorPad ? { ...s, bezig: true, fout: false } : s));
    try {
      let items: T[] = [];
      let totaal: number | null = null;
      let grens: string | null = null;
      for (let pagina = 0; pagina < 40; pagina += 1) {
        const p = await vraag(voorPad, items.length, Math.min(MAX_PAGINA, doel - items.length));
        if (!geldig()) return;
        const voor = items.length;
        items = uniek([...items, ...p.nieuw]);
        totaal = p.totaal;
        grens = p.grens;
        if (items.length === voor || items.length >= doel || totaal === null || items.length >= totaal) break;
      }
      opnieuwVanVoren.current = null;
      setStand({ pad: voorPad, items, totaal, grens, bezig: false, fout: false });
    } catch {
      if (!geldig()) return;
      opnieuwVanVoren.current = doel;
      setStand((s) => (s.pad === voorPad ? { ...s, bezig: false, fout: true } : s));
    }
  };
  acties.current.volgende = async () => {
    const voorPad = padRef.current;
    if (!voorPad) return;
    const gen = generatie.current;
    const geldig = () => generatie.current === gen && padRef.current === voorPad;
    setStand((s) => (s.pad === voorPad ? { ...s, bezig: true, fout: false } : s));
    try {
      const s = huidig.current;
      const p = await vraag(voorPad, s.items.length, aantal);
      if (!geldig()) return;
      const nu = huidig.current;
      const bekend = new Set(nu.items.map((x) => x.id));
      const erbij = p.nieuw.filter((x) => !bekend.has(x.id));
      const verschoven = p.totaal !== nu.totaal || p.grens !== nu.grens || (erbij.length === 0 && p.totaal !== null && nu.items.length < p.totaal);
      if (verschoven) {
        void acties.current.vanVoren(nu.items.length + aantal);
        return;
      }
      opnieuwVanVoren.current = null;
      setStand({ ...nu, items: [...nu.items, ...erbij], totaal: p.totaal, grens: p.grens, bezig: false, fout: false });
    } catch {
      if (!geldig()) return;
      opnieuwVanVoren.current = null;
      setStand((s) => (s.pad === voorPad ? { ...s, bezig: false, fout: true } : s));
    }
  };

  useEffect(() => {
    setStand(beginStand<T>(pad));
    opnieuwVanVoren.current = null;
    if (pad) void acties.current.vanVoren(aantal);
    else generatie.current += 1;
    // Weg van het scherm (of een ander pad): niets wat nog onderweg is, telt
    // nog of start een nieuwe vraag.
    return () => { generatie.current += 1; };
  }, [pad, aantal]);

  const laadVolgende = useCallback(() => {
    const s = huidig.current;
    if (!padRef.current || s.pad !== padRef.current || s.bezig) return;
    // Mislukte de eerste pagina of een herstart: die opnieuw, van voren.
    if (s.totaal === null || opnieuwVanVoren.current !== null) {
      void acties.current.vanVoren(opnieuwVanVoren.current ?? aantal);
      return;
    }
    if (s.items.length < s.totaal) void acties.current.volgende();
  }, [aantal]);
  const herlaad = useCallback(() => { void acties.current.vanVoren(huidig.current.items.length); }, []);

  // Tot het effect het nieuwe pad oppakt: al de begintoestand (bezig), niet
  // één render lang de lijst of het "leeg" van het vorige pad.
  const actueel = stand.pad === pad ? stand : beginStand<T>(pad);
  return { actief: pad !== null, items: actueel.items, totaal: actueel.totaal, bezig: actueel.bezig, fout: actueel.fout, laadVolgende, herlaad };
}

export type ToonMeerMetArchief<T> = Omit<ToonMeerStand<T>, 'totaal'> & {
  /** Venster plus archief; null zolang het archief zijn totaal nog niet gaf. */
  totaal: number | null;
  bezig: boolean;
  /** Een tik op de knop vraagt de mislukte pagina opnieuw (en doet niets anders). */
  fout: boolean;
  /**
   * Waarom er niets in beeld staat (null = er staat iets): `laden` = de
   * eerste pagina is onderweg, `fout` = ze kwam niet (de knop probeert
   * opnieuw), `leeg` = er is echt niets. Laadfout is nooit leeg.
   */
  leeg: 'laden' | 'fout' | 'leeg' | null;
};

/**
 * "Toon meer" over het venster én het archief als één lijst: eerst wat lokaal
 * staat, daarna het archief, tien per stap (useToonMeer). Raakt wat geladen
 * is op, dan komt de volgende pagina van de server. Een record dat in beide
 * zit (de grens verschoof tussen de opstart en het archief) telt één keer.
 *
 * Verdwijnt een record uit het venster terwijl het scherm open staat (beslist
 * en buiten het venster, of de eerste van de maand), dan staat het in het
 * archief, maar in geen pagina die al geladen is: het archief begint dan
 * opnieuw van voren. Een wissel van `sleutel` (een ander filter, en dus een
 * ander pad) telt daar niet voor.
 */
export function useToonMeerMetArchief<T extends { id: string }>(
  lokaal: readonly T[],
  archief: ArchiefStand<T>,
  opties: { stap?: number; sleutel?: string; doel?: (item: T) => boolean } = {},
): ToonMeerMetArchief<T> {
  const stap = Math.max(1, opties.stap ?? TOON_MEER_STAP);
  const sleutel = opties.sleutel ?? '';
  const lokaleIds = useMemo(() => new Set(lokaal.map((x) => x.id)), [lokaal]);
  const extra = useMemo(() => archief.items.filter((x) => !lokaleIds.has(x.id)), [archief.items, lokaleIds]);
  const geheel = useMemo(() => [...lokaal, ...extra], [lokaal, extra]);
  const lijst = useToonMeer(geheel, opties);
  // Wat het archief echt toevoegt: zijn totaal min wat al lokaal staat.
  const archiefTotaal = !archief.actief ? 0 : archief.totaal === null ? null : Math.max(0, archief.totaal - (archief.items.length - extra.length));
  const totaal = archiefTotaal === null ? null : lokaal.length + archiefTotaal;
  // "Opnieuw proberen" alleen als een tik niets anders kan tonen: staan er
  // nog geladen records klaar, dan toont de knop die eerst (en vraagt hij de
  // pagina erachter gewoon opnieuw).
  const opnieuw = archief.fout && lijst.volgende === 0;
  const volgende = opnieuw ? stap : totaal === null ? lijst.volgende : Math.min(stap, Math.max(0, totaal - lijst.getoond));

  const { actief, herlaad } = archief;
  const vorige = useRef<{ ids: Set<string>; sleutel: string } | null>(null);
  useEffect(() => {
    const was = vorige.current;
    vorige.current = { ids: lokaleIds, sleutel };
    if (!was || was.sleutel !== sleutel || !actief) return;
    for (const id of was.ids) {
      if (!lokaleIds.has(id)) { herlaad(); return; }
    }
  }, [lokaleIds, sleutel, actief, herlaad]);

  const meer = () => {
    if (opnieuw) { archief.laadVolgende(); return; }
    // Staat er minder klaar dan de volgende stap vraagt, dan een pagina bij.
    if (geheel.length < lijst.getoond + stap && (totaal === null || geheel.length < totaal)) archief.laadVolgende();
    lijst.meer();
  };

  // Laadfout gaat vóór leeg, ook als het totaal al gekend was (een herstart
  // die mislukte); onderweg is laden, nooit leeg.
  const leeg = lijst.getoond > 0 ? null : !archief.actief ? 'leeg' : archief.fout ? 'fout' : archief.bezig || archief.totaal === null ? 'laden' : 'leeg';
  return { zichtbaar: lijst.zichtbaar, getoond: lijst.getoond, totaal, volgende, meer, bezig: archief.bezig, fout: opnieuw, leeg };
}
