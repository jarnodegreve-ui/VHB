import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Table2 } from 'lucide-react';
import { downloadBlob, notify } from '../lib/ui';
import { weekRangeLabel } from '../lib/week';
import { EmptyState, Foutkaart, PageHeader, PageShell } from '../components/ui';
import { useZelfLadend } from '../lib/zelfLadend';
import { ActieMenu } from '../components/ActieMenu';
import { apiFetch } from '../lib/api';
import { SkeletonRow } from '../components/Skeleton';
import { Button, IconButton } from '../components/primitives';
import { Card } from '../components/Card';
import { SearchField } from '../components/Field';
import { meldSchrijffout } from '../lib/fouten';
import { isoDate } from '../lib/availability';
import { fetchMonthPlanning, type MonthCell, type MonthPlanning } from '../lib/monthPlanning';
import { isStaf } from '../types';
import type { User } from '../types';
import { formatDatumDMJ, hoofdletter, MONTH_NAMES } from '../lib/format';
import { useRecordParam, useRouteParam } from '../app/router';
import { eersteZichtbareDag } from '../../shared/maandplanningTerugblik';
import {
  addDaysIso, berekenCodeLegend, bouwDagRijen, formatDayMonth, groepeerPerSectie, maandNaarParam, maandUitParam,
  mondayOf, monthOf, noteKey, PLANNING_SALVO_MS, voegCellenSamen, voegChauffeursSamen,
  werkdagenUitCellen, WISSEL_REDENEN, wisselOverzichtSortering,
  type Chauffeur, type GekozenCel, type MaandOverzicht, type OverzichtRij, type OverzichtSortering,
} from '../lib/maandplanning';
import { DesktopRaster } from '../components/maandplanning/DesktopRaster';
import { Legende } from '../components/maandplanning/Legende';
import { CelDetailModal } from '../components/maandplanning/CelDetailModal';
import { MaandoverzichtModal } from '../components/maandplanning/MaandoverzichtModal';
import { DagWeergave } from '../components/maandplanning/DagWeergave';

/**
 * Maandplanning — read-only weergave van de planning-matrix (chauffeur ×
 * datum met codes), zoals het overzicht dat in het chauffeurslokaal hangt.
 * Zichtbaar voor iedereen zodat collega's wissels kunnen vinden.
 *
 * Sinds 09-10 (stap 1 en 2 van de splitsing, zoals App.tsx): de pure helpers
 * (datums, URL-maand, samenvoegen van twee maanden, dagrijen, legende,
 * maandoverzicht) staan in src/lib/maandplanning.ts; het desktopraster, de
 * legende, het celdetail met de dienstwissel, het maandoverzicht-venster en
 * de mobiele dagweergave (datumstrip + daglijst) in
 * src/components/maandplanning/. Alle toestand en elke schrijfactie blijven
 * hier; de componenten krijgen ze als props.
 */
export function CapacityView({ currentUser }: { currentUser: User }) {
  const ownId = String(currentUser?.id ?? '');
  const [maandParam, zetMaandParam] = useRouteParam(0);
  // Gekozen dag van de mobiele dag-weergave in de URL (segment ná de maand:
  // /maandplanning/2026-09/2026-09-15), zie het state-blok "Mobiel:
  // dag-weergave" verderop. Alleen een tik schrijft; de automatische keuze
  // (vandaag / eerste dag) blijft buiten de URL.
  const [dagParam, zetDagParam] = useRecordParam(1, { view: 'bezetting' });
  // De maand waarop het scherm opent: die uit de URL. Wie geen staf is ziet
  // niets van vóór de maandag van deze week (shared/maandplanningTerugblik.ts);
  // een oude link naar een vroegere maand of dag telt voor hem dus niet en
  // het bord opent op nu, in plaats van leeg. De maand-naar-URL-spiegel
  // hieronder zet de adresbalk daarna recht, met replace.
  const [startMaand] = useState(() => {
    const uitUrl = maandUitParam(maandParam);
    if (!uitUrl || isStaf(currentUser.role)) return uitUrl;
    const vanaf = eersteZichtbareDag();
    return maandNaarParam(uitUrl) < monthOf(vanaf) || (!!dagParam && dagParam < vanaf) ? null : uitUrl;
  });
  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return startMaand ?? new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [data, setData] = useState<MonthPlanning | null>(null);
  const [selected, setSelected] = useState<GekozenCel | null>(null);


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
  const [extraData, setExtraData] = useState<MonthPlanning | null>(null);

  const year = viewMonth.getFullYear();
  const monthIndex = viewMonth.getMonth();

  // Dienstnotities voor de zichtbare maand. Chauffeurs krijgen server-side
  // alleen hun eigen notities; planners alles.
  const [notes, setNotes] = useState<Map<string, string>>(new Map());
  const canEditNotes = isStaf(currentUser.role);
  const monthFrom = `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
  const monthTo = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(new Date(year, monthIndex + 1, 0).getDate()).padStart(2, '0')}`;
  const loadNotes = async () => {
    try {
      const res = await apiFetch(`/api/planning-notes?from=${monthFrom}&to=${monthTo}`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) setNotes(new Map(data.map((n: any) => [noteKey(String(n.driverId), n.date), String(n.note)])));
    } catch { /* notities zijn nice-to-have */ }
  };
  useEffect(() => { void loadNotes(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [monthFrom]);

  const [noteDraft, setNoteDraft] = useState('');
  const [isSavingNote, setIsSavingNote] = useState(false);
  const saveNote = async () => {
    if (!selected || isSavingNote) return;
    setIsSavingNote(true);
    try {
      const res = await apiFetch('/api/planning-notes', {
        method: 'PUT',
        body: JSON.stringify({ driverId: selected.driverId, date: selected.iso, note: noteDraft }),
      });
      const body = await res.json().catch(() => ({} as any));
      // PUT per chauffeur en dag: opnieuw proberen is veilig.
      if (!res.ok) { meldSchrijffout('Notitie opslaan', { status: res.status, message: body.error }, () => void saveNote()); return; }
      setNotes((cur) => {
        const next = new Map(cur);
        const trimmed = noteDraft.trim();
        if (trimmed) next.set(noteKey(selected.driverId, selected.iso), trimmed);
        else next.delete(noteKey(selected.driverId, selected.iso));
        return next;
      });
      notify(noteDraft.trim() ? 'Notitie opgeslagen, de chauffeur krijgt een melding.' : 'Notitie verwijderd.', 'success');
      setSelected(null);
    } catch (err) {
      meldSchrijffout('Notitie opslaan', err, () => void saveNote());
    } finally {
      setIsSavingNote(false);
    }
  };

  // Handmatige dienstwissel — alleen voor admins zichtbaar (server dwingt de
  // rol óók af via requireRole). 'reloadTick' herlaadt de maand na een wissel,
  // zodat de dienst meteen bij de nieuwe chauffeur staat.
  const isAdmin = currentUser.role === 'admin';

  // Excel-terugexport (staf): de actuele maand — wissels, toewijzingen en
  // afwezigheid verwerkt — in het her-importeerbare praktijk-tab-formaat.
  const [isExporteren, setIsExporteren] = useState(false);
  const exporteerExcel = async () => {
    if (isExporteren) return;
    setIsExporteren(true);
    try {
      const res = await apiFetch(`/api/month-planning?month=${monthParam}&format=xlsx`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as any));
        meldSchrijffout('Exporteren', { status: res.status, message: body.error }, () => void exporteerExcel());
        return;
      }
      // Alleen een eigen toast als het bestand ook echt lokaal geland is;
      // downloadBlob handelt het deelblad en de verlopen-gesture-tik zelf af.
      const uitkomst = await downloadBlob(`planning-${monthParam}.xlsx`, await res.blob());
      if (uitkomst === 'gedownload') notify('Dit is de actuele stand, direct her-importeerbaar.', 'success');
    } catch (err) {
      meldSchrijffout('Exporteren', err, () => void exporteerExcel());
    } finally {
      setIsExporteren(false);
    }
  };
  // Maandoverzicht-venster (verbeterronde 22-08, nr. 3): dezelfde telling als
  // het xlsx-tabblad (gedeelde server-berekening), maar als sorteerbare tabel
  // — voor de snelle blik zonder download. Types, kolommen en sortering staan
  // in src/lib/maandplanning.ts, het venster zelf is MaandoverzichtModal.
  const [overzichtOpen, setOverzichtOpen] = useState(false);
  const [overzichtLaden, setOverzichtLaden] = useState(false);
  const [overzicht, setOverzicht] = useState<MaandOverzicht | null>(null);
  const [overzichtSort, setOverzichtSort] = useState<OverzichtSortering>({ kolom: 'naam', richting: 1 });
  const openOverzicht = async () => {
    setOverzichtOpen(true);
    setOverzichtLaden(true);
    try {
      const res = await apiFetch(`/api/month-planning?month=${monthParam}&format=summary`);
      const body = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        meldSchrijffout('Overzicht laden', { status: res.status, message: body.error }, () => void openOverzicht());
        setOverzichtOpen(false);
        return;
      }
      setOverzicht(body);
    } catch (err) {
      meldSchrijffout('Overzicht laden', err, () => void openOverzicht());
      setOverzichtOpen(false);
    } finally {
      setOverzichtLaden(false);
    }
  };
  const sorteerOverzicht = (kolom: keyof OverzichtRij) =>
    setOverzichtSort((cur) => wisselOverzichtSortering(cur, kolom));

  const [wisselNaar, setWisselNaar] = useState('');
  const [wisselReden, setWisselReden] = useState<string>(WISSEL_REDENEN[0]);
  const [wisselToelichting, setWisselToelichting] = useState('');
  const [wisselBevestigen, setWisselBevestigen] = useState(false);
  const [isWisselen, setIsWisselen] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  // Vers formulier per geopende cel — restjes van een vorige cel mogen nooit
  // stil in een bevestiging belanden.
  useEffect(() => {
    setWisselNaar('');
    setWisselReden(WISSEL_REDENEN[0]);
    setWisselToelichting('');
  }, [selected?.driverId, selected?.iso]);

  const wisselRedenTekst = wisselReden === 'Andere correctie'
    ? wisselToelichting.trim()
    : (wisselToelichting.trim() ? `${wisselReden}, ${wisselToelichting.trim()}` : wisselReden);
  const wisselKlaar = !!wisselNaar && !!wisselRedenTekst;
  // Onbewaarde invoer in de celdetail: een gewijzigde notitie of een
  // begonnen dienstwissel. Sluiten vraagt dan eerst bevestiging.
  const celVuil = !!selected && (
    (canEditNotes && noteDraft !== (notes.get(noteKey(selected.driverId, selected.iso)) ?? ''))
    || wisselNaar !== '' || wisselToelichting !== '' || wisselReden !== WISSEL_REDENEN[0]
  );

  // Welke dienst is hier over te zetten? Een dienst-cel spreekt voor zich;
  // op een afwezigheidscel (ziek/bv/kv) is dat de dienst die eronder ligt —
  // ziek melden haalt de dienst niet uit de planning, dus die moet juist dán
  // herverdeeld worden. Zonder dit was het hoofdscenario onbereikbaar.
  const wisselDienst = selected
    ? (selected.cell.kind === 'service' ? selected.cell.code : (selected.cell.hiddenService ?? null))
    : null;
  const wisselNaAfwezigheid = !!wisselDienst && selected?.cell.kind !== 'service';

  const uitvoerenWissel = async () => {
    if (!selected || !wisselDienst || !wisselKlaar || isWisselen) return;
    setIsWisselen(true);
    try {
      const res = await apiFetch('/api/admin/shift-swap', {
        method: 'POST',
        body: JSON.stringify({
          date: selected.iso,
          line: wisselDienst,
          fromDriverId: selected.driverId,
          toDriverId: wisselNaar,
          reason: wisselRedenTekst,
          ...(wisselTerug ? { returnLine: wisselTerug } : {}),
        }),
      });
      const body = await res.json().catch(() => ({} as any));
      if (!res.ok) { meldSchrijffout('Dienstwissel', { status: res.status, message: body.error }); return; }
      notify(wisselTerug
        ? `Diensten ${wisselDienst} en ${wisselTerug} gewisseld, beide chauffeurs krijgen een melding.`
        : `Dienst ${wisselDienst} overgezet, beide chauffeurs krijgen een melding.`, 'success');
      setSelected(null);
      setReloadTick((t) => t + 1);
    } catch (err) {
      meldSchrijffout('Dienstwissel', err);
    } finally {
      setIsWisselen(false);
    }
  };

  // Wissel terugdraaien: de ruil annuleren draait de planning mee terug
  // (revertSwapFromPlanning server-side) — dat is de nette weg, en scheelt
  // de omweg via het Dienstruil-scherm om de juiste aanvraag op te zoeken.
  const [terugdraaien, setTerugdraaien] = useState(false);
  const [isTerugdraaien, setIsTerugdraaien] = useState(false);
  const uitvoerenTerugdraai = async () => {
    if (!selected?.cell.swapId || isTerugdraaien) return;
    setIsTerugdraaien(true);
    try {
      const res = await apiFetch(`/api/swaps/${encodeURIComponent(selected.cell.swapId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled', ifStatus: 'approved' }),
      });
      const body = await res.json().catch(() => ({} as any));
      if (!res.ok) { meldSchrijffout('Terugdraaien', { status: res.status, message: body.error }, () => void uitvoerenTerugdraai()); return; }
      notify('Wissel teruggedraaid, de dienst staat weer op de oorspronkelijke chauffeur.', 'success');
      setSelected(null);
      setReloadTick((t) => t + 1);
    } catch (err) {
      meldSchrijffout('Terugdraaien', err, () => void uitvoerenTerugdraai());
    } finally {
      setIsTerugdraaien(false);
    }
  };

  const monthParam = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  const todayIso = isoDate(new Date());

  // Hoofdmaand → URL (replace, geen extra history-entry); de state blijft de
  // bron. De huidige maand geeft een schone URL zonder parameter, behalve
  // als er een dag in de URL staat: die kan niet zonder maand ervoor.
  useEffect(() => {
    const gewenst = monthParam === maandNaarParam(new Date()) && !dagParam ? null : monthParam;
    if ((maandParam ?? null) !== gewenst) zetMaandParam(gewenst);
  }, [monthParam, maandParam, zetMaandParam, dagParam]);

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

  // De 14 dagen van het venster; de maand die niet de hoofdmaand is wordt
  // apart geladen zodat de kolommen na de maandgrens niet leeg blijven.
  const windowDates = useMemo(() => Array.from({ length: 14 }, (_, i) => addDaysIso(windowStart, i)), [windowStart]);
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

  const dates = data?.dates ?? [];
  // Chauffeurs en cellen van hoofd- én extra maand samen (venster over een
  // maandgrens); de hoofdmaand bepaalt de volgorde. Defensief: een lege of
  // onverwachte respons voor de extra maand mag het scherm niet laten
  // crashen (extraData zonder drivers).
  const drivers = useMemo(() => voegChauffeursSamen(data?.drivers ?? [], extraData?.drivers ?? []), [data, extraData]);
  const cells = useMemo(() => voegCellenSamen(data?.cells ?? {}, extraData?.cells ?? {}), [data, extraData]);
  // Werkdagen per chauffeur uit de maandcellen, voedt de vervanger-sortering
  // (minst gewerkt die week eerst); de regel staat in src/lib/maandplanning.ts.
  const werkdagenPerChauffeur = useMemo(() => werkdagenUitCellen(cells), [cells]);

  // Rijdt de gekozen chauffeur die dag zelf een dienst, dan wordt het een
  // 1-op-1-wissel (Jarno 14-09): zijn dienst gaat in ruil naar de huidige
  // chauffeur. Niet vanaf een afwezigheidscel: wie ziek is krijgt er geen
  // dienst bij (die kandidaten staan dan ook niet in de lijst).
  const wisselNaarCel = selected && wisselNaar ? cells[wisselNaar]?.[selected.iso] : undefined;
  const wisselTerug = !wisselNaAfwezigheid && wisselNaarCel?.kind === 'service' ? wisselNaarCel.code : null;
  const wisselNaarNaam = drivers.find((d) => String(d.id) === wisselNaar)?.name ?? '—';

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
  const goToday = () => {
    const n = new Date();
    setWindowStart(mondayOf(todayIso));
    setViewMonth(new Date(n.getFullYear(), n.getMonth(), 1));
    // Mobiele dag-weergave springt mee; valt vandaag buiten de al geladen
    // maand, dan corrigeert het dates-effect zodra de nieuwe maand binnen is.
    setMobielDag(todayIso);
  };

  const visibleDates = windowDates;

  const windowLabel = `${weekRangeLabel(visibleDates)} · ${formatDayMonth(visibleDates[0])} – ${formatDayMonth(visibleDates[visibleDates.length - 1])} ${visibleDates[visibleDates.length - 1].slice(0, 4)}`;

  // Ook een venster dat alleen in de extra maand planning heeft telt als data.
  const hasData = (dates.length > 0 || (extraData?.dates?.length ?? 0) > 0) && drivers.length > 0;

  // Sectie-koppen tonen zodra minstens één chauffeur een sectie heeft (anders
  // gedraagt de lijst zich als voorheen — één alfabetische groep, geen koppen).
  // De API levert 'drivers' al gesorteerd op sectie → naam, dus we hoeven enkel
  // een kop te tonen wanneer de sectie t.o.v. de vorige chauffeur wisselt.
  const showSections = drivers.some((d) => !!d.section);

  // === Mobiel: dag-weergave (keuze Jarno 15-08) =============================
  // Op een telefoon is de vraag "wie doet wat op dag X?", niet "wat doet
  // chauffeur Y de hele maand?" (daarvoor bestaat Mijn rooster). De oude
  // mobiele lijst was chauffeur-per-chauffeur: ~39 kaarten × 14 dagregels
  // scrollen zonder ooit één dag in z'n geheel te zien. Nu: één gekozen dag,
  // alle chauffeurs in één kolom, gegroepeerd per sectie en gesorteerd op
  // dienstnummer — leest als het bord in het chauffeurslokaal.
  const [mobielDag, setMobielDag] = useState<string | null>(null);
  const [toonRust, setToonRust] = useState(false);
  useEffect(() => {
    if (dates.length === 0) { setMobielDag(null); return; }
    // De dag uit de URL (deeplink, refresh, terugknop) wint zolang hij in de
    // geladen maand valt; anders vandaag als die erin valt, anders de eerste
    // dag. Een al geldige keuze blijft staan (maandwissel reset, dagwissel
    // niet). Een dag die niet in deze maand ligt (oude maand, typefout) gaat
    // stil uit de URL: /maandplanning/2026-10/2026-09-15 zegt niets.
    const uitUrl = dagParam && dates.includes(dagParam) ? dagParam : null;
    if (dagParam && !uitUrl) zetDagParam(null);
    setMobielDag((cur) => uitUrl ?? (cur && dates.includes(cur) ? cur : (dates.includes(todayIso) ? todayIso : dates[0])));
  }, [dates, todayIso, dagParam, zetDagParam]);
  // Rust-groep dichtklappen bij een maandwissel (nieuwe dagenlijst), niet bij
  // elke dagwissel.
  useEffect(() => { setToonRust(false); }, [dates]);
  // Tik in de strip of op het aandachtspijltje: dag kiezen én in de URL
  // zetten (replace). De maand moet er dan vóór staan, ook voor de huidige
  // maand die anders een schone URL houdt.
  const kiesDag = (iso: string) => {
    setMobielDag(iso);
    if (!maandParam) zetMaandParam(monthParam);
    zetDagParam(iso);
  };

  // Zoeken op chauffeur óf dienstnummer: bij 39 namen scroll je anders het
  // halve scherm door, en "wie rijdt 4102?" is de omgekeerde vraag die je
  // bij een telefoontje net zo vaak krijgt. Een dienst-treffer matcht ook de
  // dienst die onder een afwezigheid ligt (hiddenService).
  const [zoek, setZoek] = useState('');
  const zoekTerm = zoek.trim().toLowerCase();
  const zichtbareDrivers = useMemo(() => {
    if (!zoekTerm) return drivers;
    return drivers.filter((d) => {
      if (d.name.toLowerCase().includes(zoekTerm)) return true;
      const rij = cells[d.id] ?? {};
      return Object.values(rij).some((c) =>
        c.code.toLowerCase().includes(zoekTerm) ||
        (c.hiddenService ?? '').toLowerCase().includes(zoekTerm),
      );
    });
  }, [drivers, cells, zoekTerm]);
  // Het desktopraster per sectie (één tbody per sectie): een nieuwe groep
  // begint waar de sectie wisselt, zie groepeerPerSectie.
  const gridSecties = groepeerPerSectie(zichtbareDrivers);

  // Dagen waar werk wacht (dienst nog niet herverdeeld onder een afwezigheid)
  // — voedt het sprong-pijltje in de strip zodat je niet dag voor dag hoeft
  // te vegen om het volgende aandachtspunt te vinden.
  const aandachtDagen = useMemo(
    () => dates.filter((iso) => zichtbareDrivers.some((d) => cells[d.id]?.[iso]?.hiddenService)),
    [dates, zichtbareDrivers, cells],
  );
  const springNaarAandacht = () => {
    if (aandachtDagen.length === 0) return;
    const volgende = aandachtDagen.find((iso) => !!mobielDag && iso > mobielDag) ?? aandachtDagen[0];
    kiesDag(volgende);
  };

  // Rijen van de mobiele dag-weergave: hoofdlijst per sectie (op dienstnummer,
  // zoals het bord in het lokaal) + ingeklapte rest-groep. Zie het state-blok
  // "Mobiel: dag-weergave" hierboven voor het waarom; de opbouw staat in
  // src/lib/maandplanning.ts (bouwDagRijen).
  const dagRijen = useMemo(() => bouwDagRijen(zichtbareDrivers, cells, mobielDag), [cells, zichtbareDrivers, mobielDag]);

  // Legende: de codes die in de héle maand voorkomen, elk met hun betekenis,
  // data-gedreven uit de cellen (berekenCodeLegend in src/lib/maandplanning.ts).
  const codeLegend = useMemo(() => berekenCodeLegend(cells), [cells]);

  // Tik op een cel (desktopraster of daglijst): het detailvenster open, met
  // de bestaande notitie van die chauffeur en dag als concept.
  const onCel = (drv: Chauffeur, iso: string, cell: MonthCell) => {
    setSelected({ driverName: drv.name, driverId: String(drv.id), iso, cell });
    setNoteDraft(notes.get(noteKey(String(drv.id), iso)) ?? '');
  };

  return (
    <PageShell breed>
      <PageHeader
        title="Maandplanning"
        description="Wie rijdt welke dienst, zoals in het chauffeurslokaal."
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            {/* Gedeeld zoekveld (loep + wisknop); op de telefoon vult het de
                regel naast Vandaag en het actiemenu. */}
            <SearchField
              value={zoek}
              onChange={setZoek}
              label="Zoek chauffeur of dienst"
              placeholder="Chauffeur of dienst…"
              enterKeyHint="search"
              size="sm"
              className="min-w-40 flex-1 sm:w-52 sm:flex-none"
            />
            {/* Het 2-weken-venster is een desktop-begrip; op mobiel navigeert
                de datumstrip (met eigen maandwissel) en is dit cluster ruis. */}
            <div className="hidden md:flex items-center gap-2">
              <IconButton
                label="Vorige 2 weken"
                title={kanTerug ? 'Vorige 2 weken' : beginUitleg}
                variant="secondary"
                size="sm"
                disabled={!kanTerug}
                onClick={goPrevWindow}
              >
                <ChevronLeft size={18} />
              </IconButton>
              <span className="px-3 text-sm font-semibold min-w-[150px] text-center tabular-nums">{hoofdletter(windowLabel)}</span>
              <IconButton
                label="Volgende 2 weken"
                title={kanVooruit ? 'Volgende 2 weken' : `De planning is geïmporteerd tot ${formatDatumDMJ(laatsteDag)}`}
                variant="secondary"
                size="sm"
                disabled={!kanVooruit}
                onClick={goNextWindow}
              >
                <ChevronRight size={18} />
              </IconButton>
            </div>
            <Button variant="secondary" size="sm" className="ml-1" onClick={goToday}>
              Vandaag
            </Button>
            {/* Terugexport + maandoverzicht: alleen staf — sluit de Excel-
                cyclus (bewerken op de actuele stand i.p.v. de verouderde
                upload). In een actiemenu zodat de kop op mobiel niet
                stapelt (afwerking 04-09, nr. 7). */}
            {canEditNotes && (
              <ActieMenu
                size="sm"
                label="Meer acties"
                // ml-auto: op mobiel wikkelt de kop en stond de knop links,
                // waardoor het (rechts uitgelijnde) menu buiten beeld viel.
                className="ml-auto"
                items={[

                  { label: isExporteren ? 'Excel wordt gemaakt…' : 'Excel exporteren', icon: <Download size={16} />, disabled: isExporteren, onClick: () => void exporteerExcel() },
                  { label: 'Maandoverzicht', icon: <Table2 size={16} />, onClick: () => void openOverzicht() },
                ]}
              />
            )}
          </div>
        )}
      />

      {zl.fout ? (
        <Foutkaart boodschap={zl.fout} offline={!zl.online} onOpnieuw={zl.opnieuw} bezig={zl.laden} />
      ) : zl.laden || maandVoorbij ? (
        /* Skeleton i.p.v. spinner — zelfde shimmer als de rest van de app.
           Ook het ogenblik waarin een voorbije maand plaatsmaakt voor nu. */
        <Card padding="none" className="overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i}>
              <SkeletonRow className="border-b border-hairline-subtle last:border-0" />
            </div>
          ))}
        </Card>
      ) : !hasData ? (
        <EmptyState
          title={`Geen planning voor ${MONTH_NAMES[monthIndex].toLowerCase()} ${year}`}
          message="Zodra de planning voor deze maand geïmporteerd is, verschijnt ze hier."
        />
      ) : (
        <>
          {/* Desktop: Excel-achtig maandgrid (chauffeur × dag), sinds 09-10 in
              src/components/maandplanning/DesktopRaster.tsx. */}
          <DesktopRaster
            visibleDates={visibleDates}
            todayIso={todayIso}
            gridSecties={gridSecties}
            showSections={showSections}
            cells={cells}
            ownId={ownId}
            notes={notes}
            onCel={onCel}
          />

          {/* Mobiel: dag-weergave (datumstrip + alle chauffeurs van één dag in
              één kolom), sinds 09-10 in src/components/maandplanning/DagWeergave.tsx.
              De cel-modal met details/notitie/dienstwissel blijft dezelfde. */}
          <DagWeergave
            dag={{ dates, mobielDag, todayIso, dagRijen, showSections, ownId, notes, zoekTerm, toonRust, year, monthIndex, kanMaandTerug, kanMaandVooruit, beginUitleg, laatsteDag, heeftAandacht: aandachtDagen.length > 0 }}
            acties={{ kiesDag, springNaarAandacht, setViewMonth, setToonRust, onCel }}
          />

          {/* Legende: codes en markeringen van deze maand (src/components/maandplanning/Legende.tsx). */}
          <Legende legend={codeLegend} />
        </>
      )}

      {/* Celdetail (notitie, dienstwissel, terugdraaien) en het maandoverzicht:
          sinds 09-10 in src/components/maandplanning/, de toestand blijft hier. */}
      <CelDetailModal
        selected={selected}
        onClose={() => setSelected(null)}
        vuil={celVuil}
        canEditNotes={canEditNotes}
        isAdmin={isAdmin}
        notes={notes}
        noteDraft={noteDraft}
        setNoteDraft={setNoteDraft}
        isSavingNote={isSavingNote}
        saveNote={saveNote}
        terugdraaien={terugdraaien}
        setTerugdraaien={setTerugdraaien}
        isTerugdraaien={isTerugdraaien}
        uitvoerenTerugdraai={uitvoerenTerugdraai}
        wisselDienst={wisselDienst}
        wisselNaAfwezigheid={wisselNaAfwezigheid}
        wisselNaar={wisselNaar}
        setWisselNaar={setWisselNaar}
        wisselReden={wisselReden}
        setWisselReden={setWisselReden}
        wisselToelichting={wisselToelichting}
        setWisselToelichting={setWisselToelichting}
        wisselTerug={wisselTerug}
        wisselNaarNaam={wisselNaarNaam}
        wisselKlaar={wisselKlaar}
        wisselRedenTekst={wisselRedenTekst}
        isWisselen={isWisselen}
        wisselBevestigen={wisselBevestigen}
        setWisselBevestigen={setWisselBevestigen}
        uitvoerenWissel={uitvoerenWissel}
        drivers={drivers}
        cells={cells}
        werkdagenPerChauffeur={werkdagenPerChauffeur}
      />

      <MaandoverzichtModal
        open={overzichtOpen}
        onClose={() => setOverzichtOpen(false)}
        monthIndex={monthIndex}
        year={year}
        laden={overzichtLaden}
        overzicht={overzicht}
        sort={overzichtSort}
        sorteer={sorteerOverzicht}
      />
    </PageShell>
  );
}
