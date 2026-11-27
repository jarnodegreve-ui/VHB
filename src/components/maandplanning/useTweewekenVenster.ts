import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { weekRangeLabel } from '../../lib/week';
import { useZelfLadend } from '../../lib/zelfLadend';
import { isoDate } from '../../lib/availability';
import { fetchMonthPlanning, type Herkomst, type MonthPlanning } from '../../lib/monthPlanning';
import { begin, bewaar, lees, type Lezing } from '../../lib/schermGeheugen';
import { formatDatumDMJ, formatSyncedTime } from '../../lib/format';
import { addDaysIso, formatDayMonth, maandNaarParam, mondayOf, monthOf, PLANNING_SALVO_MS } from '../../lib/maandplanning';

/**
 * Het tweewekenvenster van de Maandplanning op desktop, in drie hooks die de
 * view na elkaar aanroept (in deze volgorde, zodat de effecten in dezelfde
 * volgorde lopen als vóór de splitsing):
 *
 *  1. `useTweewekenVenster`: het venster zelf (begin op een maandag, de 14
 *     dagen, verschuiven, naar vandaag) en de hoofdmaand in de URL;
 *  2. `useMaandLaden`: de hoofdmaand via useZelfLadend, de tweede maand achter
 *     de vensterrand stil erbij, en de stille herlaad-momenten (eigen wissel,
 *     salvo van planning-wijzigingen van collega's); sinds ronde 6 (punt 22,
 *     deel 3) onthoudt het elke maand in het geheugen van de schermen;
 *  3. `useImportGrenzen`: de grenzen van de geïmporteerde planning en de
 *     terugblikgrens van de server, die het venster en de knoppen sturen.
 *
 * De hoofdmaand (`viewMonth`), de twee geladen maanden en de herlaadtik
 * blijven in de view, want meer dan één hook leest ze. Verplaatst uit
 * CapacityView.tsx op 09-10 (stap 3 van de splitsing), byte voor byte
 * dezelfde toestand en effecten; het gedrag ligt vast in
 * useTweewekenVenster.test.tsx.
 */
export function useTweewekenVenster({ startMaand, monthParam, maandParam, zetMaandParam, dagParam, setViewMonth, todayIso, toonRaster, dagBijUitvouwen, toonRasterDag }: {
  /** De maand uit de URL waarop het scherm opende, of null. */
  startMaand: Date | null;
  monthParam: string;
  maandParam: string | null;
  zetMaandParam: (waarde: string | null) => void;
  dagParam: string | null;
  setViewMonth: (maand: Date) => void;
  todayIso: string;
  toonRaster: boolean;
  /** Dag van de plannerdaglijst of haar open cel; null voor de chauffeursweergave. */
  dagBijUitvouwen: string | null;
  toonRasterDag: (dag: string) => void;
}) {
  // Desktop: vast venster van twee volle weken (ma–zo + ma–zo), beginnend op
  // de maandag van de huidige week — ook als er al dagen voorbij zijn (vraag
  // Jarno 03-09). Het venster mag over een maandgrens lopen; de tweede maand
  // wordt er dan stil bij geladen (extraData).
  const [windowStart, setWindowStart] = useState(() => {
    const dezeMaandag = mondayOf(isoDate(new Date()));
    const uitUrl = startMaand;
    if (!uitUrl) return dezeMaandag;
    // Maand uit de URL: valt de huidige week (ma–zo) erin, dan blijft het
    // venster op deze week staan; anders start het op de eerste maandag
    // van/vóór die maand.
    const maand = maandNaarParam(uitUrl);
    const dezeWeekInMaand = Array.from({ length: 7 }, (_, i) => addDaysIso(dezeMaandag, i)).some((d) => monthOf(d) === maand);
    const standaard = dezeWeekInMaand ? dezeMaandag : mondayOf(`${maand}-01`);
    // Dag uit de URL (ronde 6, punt 17): een rij "te herverdelen", de knop
    // Maandplanning in het ziektedetail en de mail naar de admins openen
    // /maandplanning/<maand>/<dag>. Ligt die dag buiten de twee weken
    // hierboven, dan stond hij op desktop niet in beeld; het venster begint
    // dan op de maandag van (of vóór) die dag. Alleen een echte kalenderdag
    // in de maand van het adres telt (30/02 of een dag uit een andere maand
    // niet), en alleen hier, bij het openen: daarna is het venster gewone
    // state, dus bladeren en "Vandaag" springen nooit terug naar deze dag.
    const dagInMaand = !!dagParam && /^\d{4}-\d{2}-\d{2}$/.test(dagParam) && monthOf(dagParam) === maand && addDaysIso(dagParam, 0) === dagParam;
    return dagInMaand && (dagParam < standaard || dagParam > addDaysIso(standaard, 13)) ? mondayOf(dagParam) : standaard;
  });

  // Hoofdmaand → URL (replace, geen extra history-entry); de state blijft de
  // bron. De huidige maand geeft een schone URL zonder parameter, behalve
  // als er een dag in de URL staat: die kan niet zonder maand ervoor.
  useEffect(() => {
    const gewenst = monthParam === maandNaarParam(new Date()) && !dagParam ? null : monthParam;
    if ((maandParam ?? null) !== gewenst) zetMaandParam(gewenst);
  }, [monthParam, maandParam, zetMaandParam, dagParam]);

  // De 14 dagen van het venster; de maand die niet de hoofdmaand is wordt
  // apart geladen zodat de kolommen na de maandgrens niet leeg blijven.
  const windowDates = useMemo(() => Array.from({ length: 14 }, (_, i) => addDaysIso(windowStart, i)), [windowStart]);

  // Draait de planner van raster naar lijst, dan begint de lijst binnen
  // dezelfde twee weken. Alleen een nieuwe keuze op het smalle scherm mag
  // het raster daarna verzetten, ook als die periode geen kiesbare dag had.
  const wasRaster = useRef(toonRaster);
  const daglijstKoos = useRef(true);
  const meldDagkeuze = () => { daglijstKoos.current = true; };
  useLayoutEffect(() => {
    const wisselt = wasRaster.current !== toonRaster;
    wasRaster.current = toonRaster;
    if (!wisselt || !dagBijUitvouwen) return;
    if (!toonRaster) {
      daglijstKoos.current = false;
      const dag = windowDates.includes(dagBijUitvouwen)
        ? dagBijUitvouwen : windowDates.find(d => monthOf(d) === monthParam);
      if (dag) toonRasterDag(dag);
    } else if (daglijstKoos.current && !windowDates.includes(dagBijUitvouwen)) {
      setWindowStart(mondayOf(dagBijUitvouwen));
    }
  }, [toonRaster, dagBijUitvouwen, windowDates, monthParam, toonRasterDag]);

  // Venster verschuiven = twee weken op; de hoofdmaand volgt de maand waarin
  // het grootste deel van het venster valt (de tweede maandag), zodat export
  // en overzicht bij "de maand die je bekijkt" horen.
  const verschuifVenster = (weken: number) => {
    const next = addDaysIso(windowStart, weken * 7);
    setWindowStart(next);
    const midden = new Date(`${addDaysIso(next, 7)}T00:00:00`);
    setViewMonth(new Date(midden.getFullYear(), midden.getMonth(), 1));
  };
  const goPrevWindow = () => verschuifVenster(-2);
  const goNextWindow = () => verschuifVenster(2);
  // Naar vandaag: het venster op deze week, de hoofdmaand op deze maand. De
  // view laat de mobiele dag-weergave daarna meespringen.
  const naarVandaag = () => {
    const n = new Date();
    setWindowStart(mondayOf(todayIso));
    setViewMonth(new Date(n.getFullYear(), n.getMonth(), 1));
  };

  const windowLabel = `${weekRangeLabel(windowDates)} · ${formatDayMonth(windowDates[0])} – ${formatDayMonth(windowDates[windowDates.length - 1])} ${windowDates[windowDates.length - 1].slice(0, 4)}`;

  return { windowStart, setWindowStart, windowDates, windowLabel, goPrevWindow, goNextWindow, naarVandaag, meldDagkeuze };
}

/** De sleutel van één maand in het geheugen van de schermen
 *  (src/lib/schermGeheugen.ts): dezelfde voor de hoofdmaand en de maand achter
 *  de vensterrand, want het is hetzelfde antwoord van de server. */
export const maandSleutel = (maand: string) => `maandplanning:${maand}`;

/** De fout van een verversing die alleen een antwoord uit de cache van de
 *  service worker kreeg: het netwerk viel weg en de server bevestigde niets. */
export const GEEN_VERBINDING = 'Geen verbinding met de server.';

/** De regel boven een bord uit de cache van de service worker (zonder bord
 *  van de server ernaast), naar de vorm van Mijn dag: nooit "Bijgewerkt", want
 *  de server bevestigde niets. Het uur van het oorspronkelijke antwoord (de
 *  Date-kop) alleen als dat vandaag was; een ouder of onbekend uur zegt niets
 *  en valt weg. */
export function cacheRegel(datum: number | null, online: boolean, nu: Date = new Date()): string {
  const uur = datum !== null && new Date(datum).toDateString() === nu.toDateString() ? formatSyncedTime(datum) : '';
  if (online) return uur ? `Opgeslagen gegevens van ${uur}` : 'Opgeslagen gegevens';
  return uur ? `Offline · gegevens van ${uur}` : 'Offline · opgeslagen gegevens';
}

/** Een onthouden maand, alleen als het antwoord ook echt die maand is. */
export function leesOnthoudenMaand(maand: string): { antwoord: MonthPlanning; om: number } | null {
  const o = lees<MonthPlanning>(maandSleutel(maand));
  return o && o.antwoord?.month === maand ? o : null;
}

export function useMaandLaden({ monthParam, windowDates, reloadTick, setReloadTick, setData, setExtraData, onthoudenOm = null }: {
  monthParam: string;
  windowDates: string[];
  reloadTick: number;
  setReloadTick: (volgende: (t: number) => number) => void;
  setData: (data: MonthPlanning | null) => void;
  setExtraData: (data: MonthPlanning | null) => void;
  /** Terug binnen vijf minuten (ronde 6, punt 22, deel 3): het tijdstip van
   *  de hoofdmaand die de view bij de mount al uit het geheugen toont
   *  (`leesOnthoudenMaand`), of null. Alleen bij de mount gelezen. */
  onthoudenOm?: number | null;
}) {
  // Hoofdmaand: laad, fout en "Opnieuw proberen" via de gedeelde hook (punt
  // 17); geen focus-refresh, de realtime-laag hieronder ververst al. Met een
  // onthouden hoofdmaand is de eerste laad stil (geen skelet) en noemt de
  // regel de tijd van die lezing tot de verversing binnen is.
  //
  // Elke geslaagde lezing gaat in het geheugen, onder de regels daarvan (vijf
  // minuten, geen eigen schrijfactie en geen planningswijziging sinds het
  // vertrek, dezelfde gebruiker), behalve een antwoord uit de cache van de
  // service worker: dat is het bord van een vorige keer.
  const laatsteHoofd = useRef<Lezing | null>(null);
  // De kolommen van de maand achter de vensterrand die nog uit het geheugen
  // komen (de maand, of null), of hun eigen lezing mislukte, en of de
  // hoofdmaand intussen vers binnen is; zie het effect van de extra maand.
  const extraUitGeheugen = useRef<string | null>(null);
  const extraMislukt = useRef(false);
  const hoofdVers = useRef(false);
  // De maand van het bord van de server dat in beeld staat (uit het geheugen
  // of van dit bezoek); null = geen, of een bord uit de cache van de service
  // worker. Zo'n antwoord uit de cache vervangt nooit een bord van de server:
  // het telt als een mislukte verversing, dus het bord en zijn ware tijd
  // blijven (uit het geheugen met de kleine Foutkaart erboven, zoals bij een
  // 500). Zonder bord van de server (een koude start zonder bereik, een
  // maandwissel) toont het scherm het zoals vroeger, met `uitCache` erbij,
  // want useZelfLadend zet na elke laad de tijd van nu.
  const bordVanServer = useRef<string | null>(onthoudenOm === null ? null : monthParam);
  const [uitCache, setUitCache] = useState<{ datum: number | null } | null>(null);
  // In dit bezoek kwam er een antwoord voor de hoofdmaand (van de server, of
  // uit de cache van de service worker, ook als dat het bord niet verving);
  // na een terugkeer pas met de verversing. De view opent pas dan een cel
  // voor de staf: op hetzelfde moment als vroeger, toen het bord pas met dat
  // antwoord verscheen. Een mislukte lezing (500) telt niet.
  const [versDitBezoek, setVersDitBezoek] = useState(onthoudenOm === null);
  // De nieuwste lezing van de hoofdmaand loopt nog. Haalt een zichtbare laad
  // een stille in (een maandwissel vlak na een terugkeer), dan zet
  // useZelfLadend `verversen` nooit meer uit; dit houdt de regel en de knop
  // van de kleine Foutkaart eerlijk.
  const [hoofdLopend, setHoofdLopend] = useState(false);
  const zl = useZelfLadend(async () => {
    const lezing = begin(maandSleutel(monthParam), { planning: true });
    laatsteHoofd.current = lezing;
    setHoofdLopend(true);
    try {
      const herkomst: Herkomst = {};
      const res = await fetchMonthPlanning(monthParam, herkomst);
      if (!herkomst.uitCache && res?.month === monthParam) bewaar(lezing, res);
      // Een nieuwere lezing vertrok intussen (een maandwissel, een verversing):
      // die beslist, een laat antwoord raakt het bord niet meer.
      if (laatsteHoofd.current !== lezing) return;
      if (herkomst.uitCache && bordVanServer.current === monthParam) {
        // Het bord blijft; wel kwam er in dit bezoek een antwoord, op hetzelfde
        // moment als vroeger het bord uit de cache verscheen.
        setVersDitBezoek(true);
        throw new Error(GEEN_VERBINDING);
      }
      setData(res);
      bordVanServer.current = herkomst.uitCache ? null : (res?.month ?? null);
      setUitCache(herkomst.uitCache ? { datum: herkomst.datum ?? null } : null);
      setVersDitBezoek(true);
      hoofdVers.current = true;
      // Mislukte de lezing van de onthouden kolommen al, dan gaan ze nu weg:
      // onder een verse regel staan geen kolommen van een vorige keer.
      if (extraUitGeheugen.current && extraMislukt.current) {
        extraUitGeheugen.current = null;
        setExtraData(null);
      }
    } finally {
      if (laatsteHoofd.current === lezing) setHoofdLopend(false);
    }
  }, {
    deps: [monthParam],
    focusRefresh: false,
    boodschap: (e) => (e instanceof Error && e.message ? e.message : 'Kon de maandplanning niet laden.'),
    onthoudenOm,
  });

  // Stille herlaad-momenten: na een eigen wissel (reloadTick) en wanneer een
  // collega de planning wijzigt (realtime planning_version → App dispatcht
  // 'vhb-planning-changed'). Géén skeleton — de bestaande data blijft staan
  // tot de verse binnen is, anders flitst het scherm bij elke wissel.
  // Loopt er nog een zichtbare laad (het skelet staat er), dan zichtbaar
  // opnieuw: een stille laad die een zichtbare inhaalt, zet het skelet nooit
  // meer uit (useZelfLadend), en sinds de inhaalronde ook 'vhb-planning-changed'
  // stuurt, valt zo'n tik vaker midden in een laad (ronde 6, punt 22, deel 3).
  useEffect(() => {
    if (reloadTick === 0) return;
    void (zl.laden ? zl.opnieuw() : zl.ververs());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadTick]);

  const extraMonth = useMemo(() => {
    const maanden = Array.from(new Set(windowDates.map(monthOf)));
    return maanden.find((m) => m !== monthParam) ?? null;
  }, [windowDates, monthParam]);
  // De maand van de kolommen van de server die achter de vensterrand staan
  // (uit het geheugen of van dit bezoek), of null. Een antwoord uit de cache
  // van de service worker vervangt ze niet, zoals bij de hoofdmaand: voor
  // onthouden kolommen is het een mislukte lezing, verse kolommen van dit
  // bezoek blijven gewoon staan.
  const extraVanServer = useRef<string | null>(null);
  // De maand achter de vensterrand bij de mount uit het geheugen, alleen als
  // de hoofdmaand er ook uit kwam (anders stonden onthouden kolommen onder
  // een verse regel). Een layout-effect: het eerste beeld heeft de kolommen
  // al. Alleen een geslaagd antwoord voor die maand vervangt ze. Mislukt haar
  // lezing, dan blijven ze staan zolang ook de hoofdmaand nog uit het
  // geheugen komt (of mislukte: dan staat de kleine Foutkaart erboven); is
  // de hoofdmaand vers, dan lege kolommen zoals zonder geheugen, in welke
  // volgorde de twee antwoorden ook binnenkomen.
  useLayoutEffect(() => {
    if (onthoudenOm === null || !extraMonth) return;
    const o = leesOnthoudenMaand(extraMonth);
    if (!o) return;
    extraUitGeheugen.current = extraMonth;
    extraVanServer.current = extraMonth;
    setExtraData(o.antwoord);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (extraUitGeheugen.current !== extraMonth) extraUitGeheugen.current = null;
    if (!extraMonth) { extraVanServer.current = null; setExtraData(null); return; }
    let cancelled = false;
    extraMislukt.current = false;
    const lezing = begin(maandSleutel(extraMonth), { planning: true });
    const herkomst: Herkomst = {};
    const mislukt = () => {
      // Onthouden kolommen naast een hoofdmaand die nog niet vers is: ze
      // blijven (zie hierboven).
      if (extraUitGeheugen.current === extraMonth && !hoofdVers.current) { extraMislukt.current = true; return; }
      // Lege kolommen; de volgende verversing herstelt.
      extraUitGeheugen.current = null;
      extraVanServer.current = null;
      setExtraData(null);
    };
    fetchMonthPlanning(extraMonth, herkomst)
      .then((res) => {
        if (!herkomst.uitCache && res?.month === extraMonth) bewaar(lezing, res);
        if (cancelled) return;
        if (herkomst.uitCache && extraVanServer.current === extraMonth) {
          if (extraUitGeheugen.current === extraMonth) mislukt();
          return;
        }
        extraUitGeheugen.current = null;
        extraVanServer.current = herkomst.uitCache ? null : extraMonth;
        setExtraData(res);
      })
      .catch(() => {
        if (cancelled) return;
        mislukt();
      });
    return () => { cancelled = true; };
  }, [extraMonth, reloadTick]);

  // Eén tik per reeks wijzigingen. Elke 'vhb-planning-changed' verhoogde
  // reloadTick, en elke tik herlaadt twee volledige maandberekeningen (de
  // hoofdmaand plus de maand achter de vensterrand). Een planner die een paar
  // wissels na elkaar doorvoert, of een herbouw van de planning, stuurt die
  // events in een salvo: in de Vercel-logs van 17-09 liepen er zo elf
  // /api/month-planning-aanroepen in 56 seconden, precies op het moment dat
  // het scherm in gebruik was. Een trailing venster vouwt zo'n salvo samen;
  // de timer schuift mee op, dus de laatste wijziging zit er altijd in.
  useEffect(() => {
    let timer: number | null = null;
    const opWijziging = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        setReloadTick((t) => t + 1);
      }, PLANNING_SALVO_MS);
    };
    window.addEventListener('vhb-planning-changed', opWijziging);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener('vhb-planning-changed', opWijziging);
    };
  }, []);

  // `verversen` alleen zolang de nieuwste lezing van de hoofdmaand echt
  // loopt, en nooit tijdens een zichtbare laad (zie `hoofdLopend`).
  const verversen = zl.verversen && hoofdLopend && !zl.laden;
  const versheid = { ...zl.versheid, verversen: zl.versheid.verversen && hoofdLopend && !zl.laden };
  return { ...zl, verversen, versheid, uitCache, versDitBezoek };
}

export function useImportGrenzen({ data, extraData, monthParam, year, monthIndex, windowStart, setWindowStart, setViewMonth }: {
  data: MonthPlanning | null;
  extraData: MonthPlanning | null;
  monthParam: string;
  year: number;
  monthIndex: number;
  windowStart: string;
  setWindowStart: (iso: string) => void;
  setViewMonth: (maand: Date) => void;
}) {
  // Grenzen van de geïmporteerde planning: verder bladeren toont een leeg bord
  // dat leest als "er staat niemand ingepland", terwijl er simpelweg nog niets
  // geïmporteerd is (Jarno 18-09, hij kon voorbij de laatste import scrollen).
  // Zolang de server de grenzen niet meestuurt blijft alles gewoon bereikbaar.
  const geimporteerd = data?.geimporteerd ?? extraData?.geimporteerd ?? null;
  const eersteDag = geimporteerd?.eerste ?? null;
  // De laatste van de twee geladen maanden: komt de hoofdmaand uit de cache
  // van vóór een nieuwe import (zwak netwerk) en de tweede maand vers binnen,
  // dan mag de oude grens de verse cellen van de tweede maand niet verbergen.
  const laatsten = [data?.geimporteerd?.laatste, extraData?.geimporteerd?.laatste].filter((d): d is string => !!d).sort();
  const laatsteDag = laatsten.length > 0 ? laatsten[laatsten.length - 1] : null;
  // Wie geen staf is krijgt het bord vanaf de maandag van deze week; de server
  // legt `eerste` dan op die dag (`zichtbaarVanaf`), zodat dezelfde grens de
  // knoppen hieronder stuurt. Alleen de uitleg bij de knop verschilt.
  const terugGrens = data?.zichtbaarVanaf ?? extraData?.zichtbaarVanaf ?? null;
  const beginUitleg = terugGrens && eersteDag === terugGrens
    ? `Je ziet de planning vanaf deze week (${formatDatumDMJ(eersteDag)})`
    : `De planning begint op ${formatDatumDMJ(eersteDag)}`;
  // Die grens schuift elke maandag op. Stond het scherm open over de
  // weekwissel (of loopt de klok van het toestel achter), dan ligt het venster
  // ineens vóór wat de server nog geeft, en een lege week leest als "er reed
  // niemand". Het venster springt dan mee naar de grens; een maand die
  // helemaal voorbij is wordt de maand van dat venster. Staf heeft geen grens.
  const maandVoorbij = !!terugGrens && monthParam < monthOf(terugGrens);
  useEffect(() => {
    if (!terugGrens) return;
    if (windowStart < terugGrens) setWindowStart(terugGrens);
    if (maandVoorbij) {
      const midden = new Date(`${addDaysIso(terugGrens, 7)}T00:00:00`);
      setViewMonth(new Date(midden.getFullYear(), midden.getMonth(), 1));
    }
  }, [terugGrens, windowStart, maandVoorbij]);
  // Het vórige venster eindigt de dag vóór dit venster; het vólgende begint
  // twee weken later. Een venster dat helemaal buiten de import valt heeft
  // niets te tonen.
  const kanTerug = !eersteDag || addDaysIso(windowStart, -1) >= eersteDag;
  const kanVooruit = !laatsteDag || addDaysIso(windowStart, 14) <= laatsteDag;
  const kanMaandTerug = !eersteDag || maandNaarParam(new Date(year, monthIndex - 1, 1)) >= eersteDag.slice(0, 7);
  const kanMaandVooruit = !laatsteDag || maandNaarParam(new Date(year, monthIndex + 1, 1)) <= laatsteDag.slice(0, 7);

  return { laatsteDag, beginUitleg, maandVoorbij, kanTerug, kanVooruit, kanMaandTerug, kanMaandVooruit };
}
