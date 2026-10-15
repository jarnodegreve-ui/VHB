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

  // Gewone functies achter een ref: `laad` start bij een verschoven archief
  // zelf een herstart, en de knoppen en effecten houden een vaste identiteit.
  const acties = useRef({ laad: async (_vanaf: number, _hoeveel: number, _vanVoren: boolean) => {}, herstart: (_hoeveel: number) => {} });
  acties.current.laad = async (vanaf, hoeveel, vanVoren) => {
    const voorPad = padRef.current;
    if (!voorPad) return;
    const gen = generatie.current;
    setStand((s) => (s.pad === voorPad ? { ...s, bezig: true, fout: false } : s));
    try {
      const scheiding = voorPad.includes('?') ? '&' : '?';
      const antwoord = await apiJson<Record<string, unknown>>(`${voorPad}${scheiding}vanaf=${vanaf}&aantal=${hoeveel}`);
      if (generatie.current !== gen || padRef.current !== voorPad) return;
      const nieuw = Array.isArray(antwoord?.[veld]) ? (antwoord[veld] as T[]) : [];
      const totaal = typeof antwoord?.totaal === 'number' ? antwoord.totaal : null;
      const grens = typeof antwoord?.grens === 'string' ? antwoord.grens : null;
      if (vanVoren) {
        setStand({ pad: voorPad, items: uniek(nieuw), totaal, grens, bezig: false, fout: false });
        return;
      }
      const s = huidig.current;
      const bekend = new Set(s.items.map((x) => x.id));
      const erbij = nieuw.filter((x) => !bekend.has(x.id));
      const verschoven = totaal !== s.totaal || grens !== s.grens || (erbij.length === 0 && totaal !== null && s.items.length < totaal);
      if (verschoven) {
        acties.current.herstart(s.items.length + hoeveel);
        return;
      }
      setStand({ ...s, items: [...s.items, ...erbij], totaal, grens, bezig: false, fout: false });
    } catch {
      if (generatie.current !== gen || padRef.current !== voorPad) return;
      setStand((s) => (s.pad === voorPad ? { ...s, bezig: false, fout: true } : s));
    }
  };
  acties.current.herstart = (hoeveel) => {
    if (!padRef.current) return;
    generatie.current += 1;
    void acties.current.laad(0, Math.min(MAX_PAGINA, Math.max(aantal, hoeveel)), true);
  };

  useEffect(() => {
    generatie.current += 1;
    setStand(beginStand<T>(pad));
    if (pad) void acties.current.laad(0, aantal, true);
  }, [pad, aantal]);

  const laadVolgende = useCallback(() => {
    const s = huidig.current;
    if (!padRef.current || s.pad !== padRef.current || s.bezig) return;
    // Nog geen totaal (de eerste pagina mislukte): opnieuw van voren.
    if (s.totaal === null) { void acties.current.laad(0, aantal, true); return; }
    if (s.items.length < s.totaal) void acties.current.laad(s.items.length, aantal, false);
  }, [aantal]);
  const herlaad = useCallback(() => { acties.current.herstart(huidig.current.items.length); }, []);

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

  const leeg = lijst.getoond > 0 ? null : archief.actief && archief.totaal === null ? (archief.fout ? 'fout' : 'laden') : 'leeg';
  return { zichtbaar: lijst.zichtbaar, getoond: lijst.getoond, totaal, volgende, meer, bezig: archief.bezig, fout: opnieuw, leeg };
}
