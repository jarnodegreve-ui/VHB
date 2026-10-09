import { useEffect, useMemo, useState } from 'react';
import { weekRangeLabel } from '../../lib/week';
import { useZelfLadend } from '../../lib/zelfLadend';
import { isoDate } from '../../lib/availability';
import { fetchMonthPlanning, type MonthPlanning } from '../../lib/monthPlanning';
import { formatDatumDMJ } from '../../lib/format';
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
 *     salvo van planning-wijzigingen van collega's);
 *  3. `useImportGrenzen`: de grenzen van de geïmporteerde planning en de
 *     terugblikgrens van de server, die het venster en de knoppen sturen.
 *
 * De hoofdmaand (`viewMonth`), de twee geladen maanden en de herlaadtik
 * blijven in de view, want meer dan één hook leest ze. Verplaatst uit
 * CapacityView.tsx op 09-10 (stap 3 van de splitsing), byte voor byte
 * dezelfde toestand en effecten; het gedrag ligt vast in
 * useTweewekenVenster.test.tsx.
 */
export function useTweewekenVenster({ startMaand, monthParam, maandParam, zetMaandParam, dagParam, setViewMonth, todayIso }: {
  /** De maand uit de URL waarop het scherm opende, of null. */
  startMaand: Date | null;
  monthParam: string;
  maandParam: string | null;
  zetMaandParam: (waarde: string | null) => void;
  dagParam: string | null;
  setViewMonth: (maand: Date) => void;
  todayIso: string;
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
    return dezeWeekInMaand ? dezeMaandag : mondayOf(`${maand}-01`);
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

  return { windowStart, setWindowStart, windowDates, windowLabel, goPrevWindow, goNextWindow, naarVandaag };
}

export function useMaandLaden({ monthParam, windowDates, reloadTick, setReloadTick, setData, setExtraData }: {
  monthParam: string;
  windowDates: string[];
  reloadTick: number;
  setReloadTick: (volgende: (t: number) => number) => void;
  setData: (data: MonthPlanning | null) => void;
  setExtraData: (data: MonthPlanning | null) => void;
}) {
  // Hoofdmaand: laad, fout en "Opnieuw proberen" via de gedeelde hook (punt
  // 17); geen focus-refresh, de realtime-laag hieronder ververst al.
  const zl = useZelfLadend(async () => { setData(await fetchMonthPlanning(monthParam)); }, {
    deps: [monthParam],
    focusRefresh: false,
    boodschap: (e) => (e instanceof Error && e.message ? e.message : 'Kon de maandplanning niet laden.'),
  });

  // Stille herlaad-momenten: na een eigen wissel (reloadTick) en wanneer een
  // collega de planning wijzigt (realtime planning_version → App dispatcht
  // 'vhb-planning-changed'). Géén skeleton — de bestaande data blijft staan
  // tot de verse binnen is, anders flitst het scherm bij elke wissel.
  useEffect(() => {
    if (reloadTick === 0) return;
    void zl.ververs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadTick]);

  const extraMonth = useMemo(() => {
    const maanden = Array.from(new Set(windowDates.map(monthOf)));
    return maanden.find((m) => m !== monthParam) ?? null;
  }, [windowDates, monthParam]);
  useEffect(() => {
    if (!extraMonth) { setExtraData(null); return; }
    let cancelled = false;
    fetchMonthPlanning(extraMonth)
      .then((res) => { if (!cancelled) setExtraData(res); })
      .catch(() => { if (!cancelled) setExtraData(null); /* lege kolommen; volgende verversing herstelt */ });
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

  return zl;
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
  const laatsteDag = geimporteerd?.laatste ?? null;
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
