import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Clock, Download, RotateCcw, Search, Table2, TriangleAlert } from 'lucide-react';
import { BrandSpinner } from '../components/BrandSpinner';
import { cn, downloadBlob, notify } from '../lib/ui';
import { weekRangeLabel } from '../lib/week';
import { ConfirmationModal, EmptyState, ModalHeader, PageHeader, PageShell } from '../components/ui';
import { ActieMenu } from '../components/ActieMenu';
import { apiFetch } from '../lib/api';
import { SkeletonRow } from '../components/Skeleton';
import { Button, Chip, IconButton, MicroLabel, microLabelClass, Td, Th } from '../components/primitives';
import { Card } from '../components/Card';
import { Field, Input, Select, Textarea } from '../components/Field';
import { Modal } from '../components/Modal';
import { typedagLabel } from '../lib/typedag';
import { isoDate } from '../lib/availability';
import { fetchMonthPlanning, type MonthPlanning, type MonthCell, type CellKind } from '../lib/monthPlanning';
import { KIND_CLS, KIND_LABEL, KIND_TEXT } from '../lib/planningKind';
import type { User } from '../types';
import { formatDayLong, MONTH_NAMES, WEEKDAY_LETTER_MON, WEEKDAY_SHORT_MON } from '../lib/format';
import { kandidaatLabel, rangschikKandidaten } from '../lib/vervangers';
import { DUR } from '../lib/motion';
import { useRouteParam } from '../app/router';


/** Maandag (ISO-datum) van de week waarin `iso` valt. */
const mondayOf = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  return isoDate(d);
};
const addDaysIso = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return isoDate(d);
};
const monthOf = (iso: string) => iso.slice(0, 7);

/** Hoofdmaand in de URL (`/maandplanning/2026-10`) — spiegel van `viewMonth`;
 *  een ongeldige waarde wordt genegeerd. */
const MAAND_PARAM = /^\d{4}-(0[1-9]|1[0-2])$/;
const maandUitParam = (p: string | null): Date | null =>
  p && MAAND_PARAM.test(p) ? new Date(Number(p.slice(0, 4)), Number(p.slice(5, 7)) - 1, 1) : null;
const maandNaarParam = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Vaste redenen voor een handmatige dienstwissel; bij 'Andere correctie' is
 *  de vrije toelichting verplicht (de server eist altijd een reden). */
const WISSEL_REDENEN = ['Ziekte', 'Mondelinge dienstruil', 'Andere correctie'] as const;

/**
 * Maandplanning — read-only weergave van de planning-matrix (chauffeur ×
 * datum met codes), zoals het overzicht dat in het chauffeurslokaal hangt.
 * Zichtbaar voor iedereen zodat collega's wissels kunnen vinden.
 */
export function CapacityView({ currentUser }: { currentUser: User }) {
  const ownId = String(currentUser?.id ?? '');
  const [maandParam, zetMaandParam] = useRouteParam(0);
  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return maandUitParam(maandParam) ?? new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [data, setData] = useState<MonthPlanning | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<{ driverName: string; driverId: string; iso: string; cell: MonthCell } | null>(null);


  // Desktop: vast venster van twee volle weken (ma–zo + ma–zo), beginnend op
  // de maandag van de huidige week — ook als er al dagen voorbij zijn (vraag
  // Jarno 03-09). Het venster mag over een maandgrens lopen; de tweede maand
  // wordt er dan stil bij geladen (extraData).
  const [windowStart, setWindowStart] = useState(() => {
    const dezeMaandag = mondayOf(isoDate(new Date()));
    const uitUrl = maandUitParam(maandParam);
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
  const noteKey = (driverId: string, iso: string) => `${driverId}:${iso}`;
  const canEditNotes = currentUser.role !== 'chauffeur';
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
      if (!res.ok) { notify(body.error || 'Notitie opslaan is mislukt.', 'error'); return; }
      setNotes((cur) => {
        const next = new Map(cur);
        const trimmed = noteDraft.trim();
        if (trimmed) next.set(noteKey(selected.driverId, selected.iso), trimmed);
        else next.delete(noteKey(selected.driverId, selected.iso));
        return next;
      });
      notify(noteDraft.trim() ? 'Notitie opgeslagen — de chauffeur krijgt een melding.' : 'Notitie verwijderd.', 'success');
      setSelected(null);
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
        notify(body.error || 'Exporteren is mislukt.', 'error');
        return;
      }
      await downloadBlob(`planning-${monthParam}.xlsx`, await res.blob());
      notify('Excel gedownload — dit is de actuele stand, direct her-importeerbaar.', 'success');
    } catch {
      notify('Exporteren is mislukt — controleer je verbinding en probeer opnieuw.', 'error');
    } finally {
      setIsExporteren(false);
    }
  };
  // Maandoverzicht-venster (verbeterronde 22-08, nr. 3): dezelfde telling als
  // het xlsx-tabblad (gedeelde server-berekening), maar als sorteerbare tabel
  // — voor de snelle blik zonder download.
  type OverzichtRij = { driverId: string; naam: string; diensten: number; minuten: number; anderWerk: number; ziek: number; betaald: number; vrij: number; overig: Array<{ code: string; keren: number }>; dagen: number };
  const [overzichtOpen, setOverzichtOpen] = useState(false);
  const [overzichtLaden, setOverzichtLaden] = useState(false);
  const [overzicht, setOverzicht] = useState<null | { dagen: number; rijen: OverzichtRij[]; totaal: Record<string, number> }>(null);
  const [overzichtSort, setOverzichtSort] = useState<{ kolom: keyof OverzichtRij; richting: 1 | -1 }>({ kolom: 'naam', richting: 1 });
  // Kopie van formatMinutenAlsUren (api/helpers.ts) — de client mag niet
  // uit api/ importeren; houd het formaat gelijk.
  const urenLabel = (minuten: number) => `${Math.floor(minuten / 60)}:${String(Math.round(minuten) % 60).padStart(2, '0')}`;
  const openOverzicht = async () => {
    setOverzichtOpen(true);
    setOverzichtLaden(true);
    try {
      const res = await apiFetch(`/api/month-planning?month=${monthParam}&format=summary`);
      const body = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        notify(body.error || 'Overzicht laden is mislukt.', 'error');
        setOverzichtOpen(false);
        return;
      }
      setOverzicht(body);
    } catch {
      notify('Overzicht laden is mislukt — controleer je verbinding en probeer opnieuw.', 'error');
      setOverzichtOpen(false);
    } finally {
      setOverzichtLaden(false);
    }
  };
  const sorteerOverzicht = (kolom: keyof OverzichtRij) =>
    setOverzichtSort((cur) => (cur.kolom === kolom ? { kolom, richting: cur.richting === 1 ? -1 : 1 } : { kolom, richting: kolom === 'naam' ? 1 : -1 }));

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
    : (wisselToelichting.trim() ? `${wisselReden} — ${wisselToelichting.trim()}` : wisselReden);
  const wisselKlaar = !!wisselNaar && !!wisselRedenTekst;

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
        }),
      });
      const body = await res.json().catch(() => ({} as any));
      if (!res.ok) { notify(body.error || 'Dienstwissel is mislukt.', 'error'); return; }
      notify(`Dienst ${wisselDienst} overgezet — beide chauffeurs krijgen een melding.`, 'success');
      setSelected(null);
      setReloadTick((t) => t + 1);
    } catch {
      notify('Dienstwissel is mislukt — controleer je verbinding en probeer opnieuw.', 'error');
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
      if (!res.ok) { notify(body.error || 'Terugdraaien is mislukt.', 'error'); return; }
      notify('Wissel teruggedraaid — de dienst staat weer op de oorspronkelijke chauffeur.', 'success');
      setSelected(null);
      setReloadTick((t) => t + 1);
    } catch {
      notify('Terugdraaien is mislukt — controleer je verbinding en probeer opnieuw.', 'error');
    } finally {
      setIsTerugdraaien(false);
    }
  };

  const monthParam = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  const todayIso = isoDate(new Date());

  // Hoofdmaand → URL (replace, geen extra history-entry); de state blijft de
  // bron. De huidige maand geeft een schone URL zonder parameter.
  useEffect(() => {
    const gewenst = monthParam === maandNaarParam(new Date()) ? null : monthParam;
    if ((maandParam ?? null) !== gewenst) zetMaandParam(gewenst);
  }, [monthParam, maandParam, zetMaandParam]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    fetchMonthPlanning(monthParam)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((e) => { if (!cancelled) setError(e?.message || 'Kon de maandplanning niet laden.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [monthParam]);

  // Stille herlaad-momenten: na een eigen wissel (reloadTick) en wanneer een
  // collega de planning wijzigt (realtime planning_version → App dispatcht
  // 'vhb-planning-changed'). Géén skeleton — de bestaande data blijft staan
  // tot de verse binnen is, anders flitst het scherm bij elke wissel.
  useEffect(() => {
    if (reloadTick === 0) return;
    let cancelled = false;
    fetchMonthPlanning(monthParam)
      .then((res) => { if (!cancelled) setData(res); })
      .catch(() => { /* stil: volgende verversing of maandwissel herstelt */ });
    return () => { cancelled = true; };
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

  useEffect(() => {
    const opWijziging = () => setReloadTick((t) => t + 1);
    window.addEventListener('vhb-planning-changed', opWijziging);
    return () => window.removeEventListener('vhb-planning-changed', opWijziging);
  }, []);

  const dates = data?.dates ?? [];
  // Chauffeurs en cellen van hoofd- én extra maand samen (venster over een
  // maandgrens); de hoofdmaand bepaalt de volgorde.
  const drivers = useMemo(() => {
    const basis = data?.drivers ?? [];
    // Defensief: een lege/onverwachte respons voor de extra maand mag het
    // scherm niet laten crashen (extraData zonder drivers).
    const extra = extraData?.drivers ?? [];
    if (extra.length === 0) return basis;
    const ids = new Set(basis.map((d) => d.id));
    return [...basis, ...extra.filter((d) => !ids.has(d.id))];
  }, [data, extraData]);
  const cells = useMemo(() => {
    const basis = data?.cells ?? {};
    const extraCells = extraData?.cells ?? {};
    if (Object.keys(extraCells).length === 0) return basis;
    const merged: Record<string, Record<string, MonthCell>> = {};
    for (const id of new Set([...Object.keys(basis), ...Object.keys(extraCells)])) {
      merged[id] = { ...(extraCells[id] ?? {}), ...(basis[id] ?? {}) };
    }
    return merged;
  }, [data, extraData]);
  // Werkdagen per chauffeur uit de maandcellen — voedt de vervanger-sortering
  // (minst gewerkt die week eerst). hiddenService telt mee als werkdag: de
  // dienst staat dan nog op naam (ziekte-overlay), dus die dag is niet vrij.
  const werkdagenPerChauffeur = useMemo(() => {
    const per = new Map<string, Set<string>>();
    for (const [driverId, perDag] of Object.entries(cells)) {
      const set = new Set<string>();
      for (const [iso, cel] of Object.entries(perDag)) {
        if (cel && (cel.kind === 'service' || cel.hiddenService)) set.add(iso);
      }
      per.set(driverId, set);
    }
    return per;
  }, [cells]);

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
  const goToday = () => {
    const n = new Date();
    setWindowStart(mondayOf(todayIso));
    setViewMonth(new Date(n.getFullYear(), n.getMonth(), 1));
    // Mobiele dag-weergave springt mee; valt vandaag buiten de al geladen
    // maand, dan corrigeert het dates-effect zodra de nieuwe maand binnen is.
    setMobielDag(todayIso);
  };

  const visibleDates = windowDates;

  const formatDayMonth = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    try { return d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' }); }
    catch { return iso; }
  };
  const windowLabel = `${weekRangeLabel(visibleDates)} · ${formatDayMonth(visibleDates[0])} – ${formatDayMonth(visibleDates[visibleDates.length - 1])} ${visibleDates[visibleDates.length - 1].slice(0, 4)}`;

  const dayHeader = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    const jsDay = d.getDay();
    return {
      letter: WEEKDAY_LETTER_MON[jsDay === 0 ? 6 : jsDay - 1],
      day: d.getDate(),
      weekend: jsDay === 0 || jsDay === 6,
      isMonday: jsDay === 1,
    };
  };

  const formatDateLong = formatDayLong;

  // Ook een venster dat alleen in de extra maand planning heeft telt als data.
  const hasData = (dates.length > 0 || (extraData?.dates?.length ?? 0) > 0) && drivers.length > 0;

  // Sectie-koppen tonen zodra minstens één chauffeur een sectie heeft (anders
  // gedraagt de lijst zich als voorheen — één alfabetische groep, geen koppen).
  // De API levert 'drivers' al gesorteerd op sectie → naam, dus we hoeven enkel
  // een kop te tonen wanneer de sectie t.o.v. de vorige chauffeur wisselt.
  const showSections = drivers.some((d) => !!d.section);
  const sectionOf = (d: { section?: string | null }) => (d.section || 'Overige');

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
    // Vandaag als hij in de geladen maand valt, anders de eerste dag; een al
    // geldige keuze blijft staan (maandwissel reset, dagwissel niet).
    setMobielDag((cur) => (cur && dates.includes(cur) ? cur : (dates.includes(todayIso) ? todayIso : dates[0])));
    setToonRust(false);
  }, [dates, todayIso]);

  // De gekozen dag in de strip in beeld houden (bv. na "Vandaag" of een
  // maandwissel). Bewust NIET scrollIntoView bij elke tik: die sprong hard
  // (geen smooth) en verschoof de strip ook als de dag al gewoon in beeld
  // stond — dan gleed de hele rij onder je vinger weg (melding Jarno 15-08).
  // Nu: alleen scrollen als de gekozen dag (deels) buiten beeld staat, zacht,
  // en via de container zelf zodat de pagina nooit verticaal meespringt.
  const reduceMotion = useReducedMotion();
  const stripDagRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const el = stripDagRef.current;
    const container = el?.parentElement;
    if (!el || !container) return;
    const elRect = el.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    if (elRect.left >= cRect.left && elRect.right <= cRect.right) return;
    container.scrollTo({
      left: el.offsetLeft - container.clientWidth / 2 + el.clientWidth / 2,
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
  }, [mobielDag, reduceMotion]);


  /** Tooltip van een cel: type, code en wat er aan de hand is. */
  const celTitel = (cell: MonthCell, heeftNotitie: boolean) => [
    `${KIND_LABEL[cell.kind]} · ${cell.code}`,
    cell.hiddenService ? `dienst ${cell.hiddenService} nog niet herverdeeld` : '',
    cell.swapId ? (cell.swapManual ? `handmatig overgezet van ${cell.swapFrom || 'een collega'}` : `geruild met ${cell.swapFrom || 'een collega'}`) : '',
    heeftNotitie ? 'notitie' : '',
  ].filter(Boolean).join(' · ') + ' — klik voor details';

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
    setMobielDag(volgende);
  };

  // Rijen van de mobiele dag-weergave: hoofdlijst per sectie (op dienstnummer,
  // zoals het bord in het lokaal) + ingeklapte rest-groep. Zie het state-blok
  // "Mobiel: dag-weergave" hierboven voor het waarom.
  type DagRij = { drv: (typeof drivers)[number]; cell: MonthCell | undefined };
  const dagRijen = useMemo(() => {
    const secties: Array<{ naam: string; rijen: DagRij[] }> = [];
    const rust: DagRij[] = [];
    if (!mobielDag) return { secties, rust };
    for (const drv of zichtbareDrivers) {
      const cell = cells[drv.id]?.[mobielDag];
      // Hoofdlijst = wat er die dag rijdt of aandacht vraagt: diensten én
      // afwezigheidscellen met een nog niet herverdeelde dienst eronder.
      if (cell && (cell.kind === 'service' || cell.hiddenService)) {
        const naam = sectionOf(drv);
        const laatste = secties[secties.length - 1];
        if (laatste && laatste.naam === naam) laatste.rijen.push({ drv, cell });
        else secties.push({ naam, rijen: [{ drv, cell }] });
      } else {
        // Vrij/afwezig/niets gepland: meestal ruis — ingeklapt onderaan.
        rust.push({ drv, cell });
      }
    }
    const codeVan = (r: DagRij) => String(r.cell?.hiddenService ?? r.cell?.code ?? '');
    for (const s of secties) s.rijen.sort((a, b) => codeVan(a).localeCompare(codeVan(b), undefined, { numeric: true }));
    return { secties, rust };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, zichtbareDrivers, mobielDag]);

  // Legende: de codes die in de héle maand voorkomen, elk met hun betekenis.
  // Data-gedreven (geen hardgecodeerde codes) → toont "BV = Verlof", "ziek =
  // Afwezig", "tk = Tijdskrediet"… precies zoals ze geïmporteerd zijn. Betekenis
  // = de omschrijving uit de planningscodes indien ingesteld, anders de categorie.
  const codeLegend = useMemo(() => {
    const map = new Map<string, { code: string; kind: CellKind; meaning: string }>();
    let serviceExample: string | null = null;
    for (const driverId of Object.keys(cells)) {
      const row = cells[driverId];
      for (const iso of Object.keys(row)) {
        const c = row[iso];
        if (c.kind === 'service') {
          if (!serviceExample) serviceExample = c.code;
          continue;
        }
        const key = c.code.trim().toLowerCase();
        if (!key || map.has(key)) continue;
        const hasDesc = !!c.label && c.label.trim().toLowerCase() !== key;
        const meaning = c.kind === 'unknown' || !hasDesc ? KIND_LABEL[c.kind] : c.label;
        map.set(key, { code: c.code, kind: c.kind, meaning });
      }
    }
    const order: CellKind[] = ['leave', 'absence', 'training', 'unknown'];
    const entries = Array.from(map.values()).sort(
      (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind) || a.code.localeCompare(b.code),
    );
    return { serviceExample, entries };
  }, [cells]);

  return (
    <PageShell>
      <PageHeader
        title="Maandplanning"
        description="Wie rijdt welke dienst, zoals het overzicht in het chauffeurslokaal."
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <span className="sr-only">Zoek chauffeur</span>
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                type="search"
                enterKeyHint="search"
                value={zoek}
                onChange={(e) => setZoek(e.target.value)}
                placeholder="Zoek chauffeur of dienst…"
                className="h-11 sm:pointer-fine:h-9 sm:w-52 pl-9 pr-3"
              />
            </label>
            {/* Het 2-weken-venster is een desktop-begrip; op mobiel navigeert
                de datumstrip (met eigen maandwissel) en is dit cluster ruis. */}
            <div className="hidden md:flex items-center gap-2">
              <IconButton label="Vorige 2 weken" variant="secondary" size="sm" onClick={goPrevWindow}>
                <ChevronLeft size={18} />
              </IconButton>
              <span className="px-3 text-sm font-semibold tracking-tight capitalize min-w-[150px] text-center tabular-nums">{windowLabel}</span>
              <IconButton label="Volgende 2 weken" variant="secondary" size="sm" onClick={goNextWindow}>
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

      {error ? (
        <Card padding="md" className="text-center"><p className="text-sm font-semibold text-red-700">{error}</p></Card>
      ) : loading ? (
        /* Skeleton i.p.v. spinner — zelfde shimmer als de rest van de app. */
        <Card padding="none" className="overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i}>
              <SkeletonRow className="border-b border-slate-100 last:border-0" />
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
          {/* .mp-*-klassen (weekend-arcering, opake sticky-cellen) staan in
              index.css bij de andere component-klassen. */}
          {/* Desktop: Excel-achtig maandgrid (chauffeur × dag) — dunne gridlijnen,
              platte dienstnummers, gearceerde weekend-kolommen. */}
          <Card padding="none" className="hidden md:block overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr>
                    <th className={cn('mp-sticky sticky left-0 top-0 z-30 bg-surface-muted px-4 py-3 min-w-[180px] border-b-2 border-slate-300 border-r-2 border-slate-300', microLabelClass)}>Chauffeur</th>
                    {visibleDates.map((iso) => {
                      const h = dayHeader(iso);
                      const today = iso === todayIso;
                      // De Lijn-typedag: feestdag (F, oker) of schoolvakantie
                      // (V) subtiel in de dagkop — de regeling die rijdt.
                      const td = typedagLabel(iso);
                      // Dag uit de ándere maand van het venster: leesbare
                      // maandmarkering ("aug") i.p.v. de losse typedag-letter,
                      // die onder "31" als een vreemd teken las.
                      const andereMaand = monthOf(iso) !== monthParam;
                      const maandKort = (MONTH_NAMES[Number(iso.slice(5, 7)) - 1] ?? '').slice(0, 3).toLowerCase();
                      return (
                        <th
                          key={iso}
                          title={td?.titel}
                          className={cn(
                            'sticky top-0 z-20 px-1 py-2 text-center font-medium border-b-2 border-slate-300',
                            h.isMonday ? 'border-l-2 border-l-slate-400' : 'border-l border-slate-200',
                            today ? 'bg-oker-100' : h.weekend ? 'mp-weekend' : 'bg-surface-soft',
                          )}
                        >
                          <div className={microLabelClass}>{h.letter}</div>
                          <div className={cn('text-xs font-semibold mt-0.5 tabular-nums', today ? 'text-oker-700' : 'text-slate-700')}>{h.day}</div>
                          <div className="mt-0.5 h-3 text-2xs font-bold leading-3">
                            {andereMaand ? (
                              <span className={microLabelClass}>{maandKort}</span>
                            ) : td && (
                              <span className={td.kort === 'F' ? 'text-oker-700' : 'text-slate-500'}>{td.kort}</span>
                            )}
                          </div>
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {zichtbareDrivers.map((drv, i) => {
                    const row = cells[drv.id] || {};
                    const isOwn = ownId && drv.id === ownId;
                    const rowBg = isOwn ? 'bg-oker-50' : 'bg-surface-white';
                    const section = sectionOf(drv);
                    const showHeader = showSections && (i === 0 || sectionOf(zichtbareDrivers[i - 1]) !== section);
                    return (
                      <Fragment key={drv.id}>
                      {showHeader && (
                        <tr>
                          {/* Label alleen in de vaste eerste cel; de dag-cellen
                              van de band behouden weekend-arcering en de
                              vandaag-markering, zodat die verticale gidsen
                              niet per sectie onderbroken worden. */}
                          <td className="mp-sticky sticky left-0 z-10 p-0 border-y border-slate-300 border-r-2 bg-slate-100/90">
                            <div className={cn('inline-flex items-center px-4 py-1.5', microLabelClass)}>
                              {section}
                            </div>
                          </td>
                          {visibleDates.map((iso) => {
                            const h = dayHeader(iso);
                            const today = iso === todayIso;
                            return (
                              <td
                                key={iso}
                                className={cn(
                                  'p-0 border-y border-slate-300 bg-slate-100/80',
                                  h.isMonday ? 'border-l-2 border-l-slate-400' : 'border-l border-slate-200',
                                  today ? 'bg-oker-100/60' : h.weekend ? 'mp-hatch' : '',
                                )}
                              />
                            );
                          })}
                        </tr>
                      )}
                      <tr className={cn('group border-b border-slate-200', rowBg)}>
                        <td
                          className={cn(
                            isOwn ? 'mp-sticky-own' : 'mp-sticky',
                            'sticky left-0 z-10 px-4 py-2 text-sm font-semibold min-w-[180px] truncate border-r-2 border-slate-300 transition-colors',
                            rowBg,
                            'group-hover:bg-oker-50',
                            isOwn ? 'text-oker-800' : 'text-slate-800',
                          )}
                        >
                          <span className="inline-flex items-center gap-1.5">
                            {isOwn && <span className="h-1.5 w-1.5 rounded-full bg-oker-500" aria-hidden />}
                            {drv.name}
                            {isOwn && <span className={cn(microLabelClass, 'text-oker-700')}>jij</span>}
                          </span>
                        </td>
                        {visibleDates.map((iso) => {
                          const cell = row[iso];
                          const h = dayHeader(iso);
                          const today = iso === todayIso;
                          return (
                            <td
                              key={iso}
                              className={cn(
                                'p-0 text-center',
                                h.isMonday ? 'border-l-2 border-l-slate-400' : 'border-l border-slate-200',
                                // oker-100/60 i.p.v. 50/50: blijft ook zichtbaar
                                // in je eigen rij (die zelf al bg-oker-50 heeft).
                                today ? 'bg-oker-100/60' : h.weekend ? 'mp-weekend' : '',
                              )}
                            >
                              {cell ? (
                                // rauw: gridcel van de maandplanning (Excel-look, h-7, eigen kleurtaal)
                                <button
                                  type="button"
                                  onClick={() => { setSelected({ driverName: drv.name, driverId: String(drv.id), iso, cell }); setNoteDraft(notes.get(noteKey(String(drv.id), iso)) ?? ''); }}
                                  className={cn(
                                    'relative flex h-7 w-full items-center justify-center px-1 text-2xs tabular-nums cursor-pointer transition-colors hover:bg-oker-100/70',
                                    // Gewisselde cel in het rood (keuze Jarno
                                    // 15-08): de planning wijkt hier af van de
                                    // Excel — dat moet je in één oogopslag zien,
                                    // zonder de cel aan te klikken.
                                    cell.swapId
                                      ? 'font-semibold text-red-700 border-b border-dashed border-red-500/80'
                                      : KIND_TEXT[cell.kind],
                                  )}
                                  title={celTitel(cell, notes.has(noteKey(String(drv.id), iso)))}
                                >
                                  {cell.code}
                                  {/* Dienst staat nog open onder een afwezigheid:
                                      dít is het werk dat wacht. */}
                                  {cell.hiddenService && (
                                    <TriangleAlert size={12} className="absolute left-0.5 top-0.5 text-amber-700" aria-label="dienst nog niet herverdeeld" />
                                  )}
                                  {notes.has(noteKey(String(drv.id), iso)) && (
                                    <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-oker-500" aria-label="notitie aanwezig" />
                                  )}
                                </button>
                              ) : (
                                <div className="h-7" />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* Mobile: dag-weergave — datumstrip + alle chauffeurs van één dag
              in één kolom (per sectie, op dienstnummer). De cel-modal met
              details/notitie/dienstwissel blijft dezelfde. */}
          <div className="md:hidden space-y-3">
            <Card padding="none" className="p-2">
              {/* Maandwissel hoort hier bij de dagen — de venster-pijlen in de
                  kop zijn op mobiel verborgen. */}
              <div className="flex items-center justify-between gap-2 px-1 pb-1">
                <IconButton
                  label="Vorige maand"
                  variant="ghost"
                  size="md"
                  className="text-slate-400"
                  onClick={() => setViewMonth(new Date(year, monthIndex - 1, 1))}
                >
                  <ChevronLeft size={16} />
                </IconButton>
                <span className="text-sm font-semibold tracking-tight text-slate-800 tabular-nums">{MONTH_NAMES[monthIndex]} {year}</span>
                <div className="flex items-center">
                  {/* Spring naar de eerstvolgende dag met een nog niet
                      herverdeelde dienst — scheelt dag voor dag vegen. */}
                  {aandachtDagen.length > 0 && (
                    <IconButton
                      label="Naar de volgende dag met een openstaande dienst"
                      title="Volgende dag met een openstaande dienst"
                      variant="ghost"
                      size="md"
                      className="text-amber-700"
                      onClick={springNaarAandacht}
                    >
                      <TriangleAlert size={16} />
                    </IconButton>
                  )}
                  <IconButton
                    label="Volgende maand"
                    variant="ghost"
                    size="md"
                    className="text-slate-400"
                    onClick={() => setViewMonth(new Date(year, monthIndex + 1, 1))}
                  >
                    <ChevronRight size={16} />
                  </IconButton>
                </div>
              </div>
              <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Kies een dag">
                {dates.map((iso) => {
                  const d = new Date(`${iso}T00:00:00`);
                  const gekozen = iso === mobielDag;
                  const vandaag = iso === todayIso;
                  const td = typedagLabel(iso);
                  return (
                    // rauw: dag-tab in de datumstrip (kalender-dagcel met schuivende motion-pil)
                    <button
                      key={iso}
                      ref={gekozen ? stripDagRef : undefined}
                      type="button"
                      role="tab"
                      aria-selected={gekozen}
                      onClick={() => setMobielDag(iso)}
                      className={cn(
                        // Kleuren via transition-colors; de amber pil zelf is
                        // een motion-span met layoutId die tussen de dagen
                        // schúíft (zelfde patroon als de dock-tabs) i.p.v. per
                        // knop hard aan/uit te wippen.
                        'ios-pressable relative flex min-h-11 w-12 shrink-0 flex-col items-center justify-center rounded-xl py-1.5 transition-colors',
                        gekozen ? 'text-slate-950' : 'text-slate-500',
                        // Vandaag: zachte oker hairline (inset, 35%) + het oker
                        // cijfer. De eerdere 60%-ring las als een lege tweede
                        // pil; op verzoek Jarno tóch een omlijsting, maar
                        // duidelijk stiller dan de gevulde selectie-pil.
                        !gekozen && vandaag && 'ring-1 ring-inset ring-oker-500/35',
                      )}
                    >
                      {gekozen && (
                        <motion.span
                          layoutId="dagstrip-actief"
                          transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 380, damping: 30, mass: 0.7 }}
                          className="absolute inset-0 rounded-xl bg-oker-500 shadow-sm shadow-oker-500/30"
                        />
                      )}
                      <span className={cn(microLabelClass, 'relative z-10 transition-colors', gekozen ? 'text-slate-950/70' : 'text-slate-500')}>
                        {WEEKDAY_SHORT_MON[(d.getDay() + 6) % 7]}
                      </span>
                      {/* Vandaag (niet gekozen) = oker dagcijfer — hetzelfde
                          stille signaal als de oude daglabels en het desktop-
                          grid. Een ring om de hele knop las als een tweede,
                          lege pil naast de gevulde selectie (melding Jarno). */}
                      <span className={cn('relative z-10 text-sm font-bold tabular-nums leading-tight transition-colors', !gekozen && vandaag && 'text-oker-700')}>
                        {d.getDate()}
                      </span>
                      {/* Typedag (F/V) — zelfde signaal als de desktop-dagkop. */}
                      <span className={cn('relative z-10 h-3 text-2xs font-bold leading-3 transition-colors', td?.kort === 'F' && !gekozen ? 'text-oker-700' : gekozen ? 'text-slate-950/60' : 'text-slate-500')}>
                        {td?.kort ?? ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            </Card>

            {mobielDag && (
              /* key per dag + korte opacity-fade: de kolom wisselt anders in
                 één harde klap van inhoud. Alleen opacity (composited) — geen
                 transform/hoogte-animatie, dat jankt op oudere toestellen. */
              <motion.div
                key={mobielDag}
                initial={reduceMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: DUR.fast, ease: 'easeOut' }}
              >
                <Card padding="none" className="overflow-hidden">
                <div className="flex items-baseline justify-between gap-3 border-b border-slate-200/70 px-4 py-3">
                  <span className="text-sm font-semibold capitalize text-slate-800">{formatDateLong(mobielDag)}</span>
                  <MicroLabel className="tabular-nums">
                    {dagRijen.secties.reduce((n, s) => n + s.rijen.length, 0)} {dagRijen.secties.reduce((n, s) => n + s.rijen.length, 0) === 1 ? 'dienst' : 'diensten'}
                  </MicroLabel>
                </div>

                {dagRijen.secties.length === 0 ? (
                  <p className="px-4 py-6 text-sm font-medium text-slate-500">
                    {zoekTerm ? 'Geen chauffeurs gevonden voor deze zoekterm.' : 'Geen diensten op deze dag.'}
                  </p>
                ) : dagRijen.secties.map((sectie) => (
                  <Fragment key={sectie.naam}>
                    {showSections && (
                      <div className={cn('bg-slate-100/80 px-4 py-1.5', microLabelClass)}>{sectie.naam}</div>
                    )}
                    {sectie.rijen.map(({ drv, cell }) => {
                      if (!cell) return null;
                      const isOwn = ownId && drv.id === ownId;
                      return (
                        // rauw: klikbare dagrij (code-chip + naam + uren) — kaart-als-knop met eigen layout
                        <button
                          key={drv.id}
                          type="button"
                          onClick={() => { setSelected({ driverName: drv.name, driverId: String(drv.id), iso: mobielDag, cell }); setNoteDraft(notes.get(noteKey(String(drv.id), mobielDag)) ?? ''); }}
                          className={cn(
                            'w-full flex items-center gap-3 px-4 py-2.5 min-h-11 text-left border-b border-slate-100 last:border-b-0 active:bg-black/[0.04] transition-colors',
                            isOwn && 'bg-oker-50',
                          )}
                        >
                          <Chip mono={false} className={cn(
                            'min-w-[46px] justify-center ring-1 ring-hairline',
                            cell.swapId ? 'bg-red-50 text-red-700' : KIND_CLS[cell.kind],
                          )}>{cell.code}</Chip>
                          <span className={cn('min-w-0 flex-1 truncate text-sm font-semibold', isOwn ? 'text-oker-800' : 'text-slate-800')}>
                            {drv.name}
                            {isOwn && <span className={cn(microLabelClass, 'ml-1.5 text-oker-700')}>jij</span>}
                          </span>
                          {/* Uren compact rechts; bij een open dienst de melding. */}
                          <span className="shrink-0 text-xs font-medium text-slate-500 tabular-nums">
                            {cell.hiddenService ? `dienst ${cell.hiddenService} open` : (cell.segments[0] ?? '')}
                          </span>
                          {cell.hiddenService && (
                            <TriangleAlert size={14} className="shrink-0 text-amber-700" aria-label="dienst nog niet herverdeeld" />
                          )}
                          {notes.has(noteKey(String(drv.id), mobielDag)) && (
                            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-oker-500" aria-label="notitie aanwezig" />
                          )}
                        </button>
                      );
                    })}
                  </Fragment>
                ))}

                {dagRijen.rust.length > 0 && (
                  <>
                    {/* rauw: uitklapband over de volle breedte (micro-label + chevron), geen knopvorm */}
                    <button
                      type="button"
                      onClick={() => setToonRust((v) => !v)}
                      aria-expanded={toonRust}
                      className={cn('w-full flex items-center justify-between gap-3 bg-slate-100/80 px-4 py-2.5 min-h-11 active:bg-black/[0.04] transition-colors tabular-nums', microLabelClass)}
                    >
                      <span>Vrij / afwezig · {dagRijen.rust.length}</span>
                      <ChevronRight size={14} className={cn('transition-transform', toonRust && 'rotate-90')} />
                    </button>
                    {toonRust && dagRijen.rust.map(({ drv, cell }) => {
                      const isOwn = ownId && drv.id === ownId;
                      const inhoud = (
                        <>
                          <Chip mono={false} className={cn(
                            'min-w-[46px] justify-center',
                            cell ? cn('ring-1 ring-hairline', KIND_CLS[cell.kind]) : 'bg-transparent text-slate-300',
                          )}>{cell?.code ?? '—'}</Chip>
                          <span className={cn('min-w-0 flex-1 truncate text-sm font-medium', isOwn ? 'text-oker-800' : 'text-slate-600')}>
                            {drv.name}
                            {isOwn && <span className={cn(microLabelClass, 'ml-1.5 text-oker-700')}>jij</span>}
                          </span>
                          <span className="shrink-0 text-xs font-medium text-slate-500">{cell?.label ?? ''}</span>
                        </>
                      );
                      const rijCls = cn(
                        'w-full flex items-center gap-3 px-4 py-2.5 min-h-11 text-left border-b border-slate-100 last:border-b-0',
                        isOwn && 'bg-oker-50',
                      );
                      // Zonder cel valt er niets te openen — dan geen knop.
                      // rauw: klikbare dagrij (zie hierboven) — kaart-als-knop met eigen layout
                      return cell ? (
                        <button
                          key={drv.id}
                          type="button"
                          onClick={() => { setSelected({ driverName: drv.name, driverId: String(drv.id), iso: mobielDag, cell }); setNoteDraft(notes.get(noteKey(String(drv.id), mobielDag)) ?? ''); }}
                          className={cn(rijCls, 'active:bg-black/[0.04] transition-colors')}
                        >
                          {inhoud}
                        </button>
                      ) : (
                        <div key={drv.id} className={rijCls}>{inhoud}</div>
                      );
                    })}
                  </>
                )}
                </Card>
              </motion.div>
            )}
          </div>

          {/* Legende — de codes die deze maand écht voorkomen, met hun betekenis. */}
          <Card padding="md" className="flex flex-wrap items-center gap-x-5 gap-y-3 text-xs">
            <MicroLabel className="text-slate-500">Legende</MicroLabel>
            {codeLegend.serviceExample && (
              <div className="flex items-center gap-2">
                <Chip mono={false} className={KIND_CLS.service}>{codeLegend.serviceExample}</Chip>
                <span className="font-medium text-slate-600">Dienst</span>
              </div>
            )}
            {codeLegend.entries.map((e) => (
              <div key={e.code} className="flex items-center gap-2">
                <Chip mono={false} className={KIND_CLS[e.kind]}>{e.code}</Chip>
                <span className="font-medium text-slate-600">{e.meaning}</span>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <TriangleAlert size={14} className="text-amber-700" />
              <span className="font-medium text-slate-600">Dienst nog niet herverdeeld</span>
            </div>
            <div className="flex items-center gap-2">
              <Chip tone="red" mono={false} className="ring-1 ring-hairline">4102</Chip>
              <span className="font-medium text-slate-600">Geruild of overgezet</span>
            </div>
            <span className="font-medium text-slate-500">Leeg = niets gepland</span>
          </Card>
        </>
      )}

      <Modal open={!!selected} onClose={() => setSelected(null)} maxWidth="sm" className="flex max-h-[88dvh] flex-col !overflow-hidden !p-0">
        {selected && (
          <>
          <ModalHeader
            eyebrow={formatDateLong(selected.iso)}
            title={selected.driverName}
            onClose={() => setSelected(null)}
          />
          <div className="flex-1 overflow-y-auto overscroll-contain p-6">
            <div className="flex items-center gap-2.5">
              <span className={cn(
                'inline-block rounded-lg px-2.5 py-1 text-sm font-semibold tabular-nums ring-1 ring-hairline',
                selected.cell.swapId ? 'bg-red-50 text-red-700' : KIND_CLS[selected.cell.kind],
              )}>{selected.cell.code}</span>
              <span className="text-sm font-semibold text-slate-700">{selected.cell.label}</span>
            </div>

            {/* Herkomst van deze cel: hij wijkt af van de geïmporteerde Excel.
                Planners/admins kunnen de wissel hier meteen terugdraaien — dat
                annuleert de ruil én zet de planning terug. */}
            {selected.cell.swapId && (
              <Card tone="muted" padding="none" className="mt-4 px-3.5 py-3 space-y-2.5">
                <p className="text-xs font-medium text-slate-600 leading-relaxed">
                  {selected.cell.swapManual ? 'Handmatig overgezet' : 'Geruild'}
                  {selected.cell.swapFrom ? <> van <span className="font-semibold text-slate-700">{selected.cell.swapFrom}</span></> : null}.
                </p>
                {canEditNotes && (
                  <Button variant="secondary" size="sm" full icon={<RotateCcw size={14} />} disabled={isTerugdraaien} onClick={() => setTerugdraaien(true)}>
                    {isTerugdraaien ? 'Terugdraaien…' : 'Wissel terugdraaien'}
                  </Button>
                )}
              </Card>
            )}

            {(notes.has(noteKey(selected.driverId, selected.iso)) || canEditNotes) && (
              <div className="mt-5 space-y-2">
                {canEditNotes ? (
                  <Field label="Notitie voor de chauffeur">
                    {({ id }) => (
                      <>
                        <Textarea
                          id={id}
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          maxLength={280}
                          placeholder="bv. Neem bus 412 — eerst tanken."
                          className="h-20"
                        />
                        {/* Secundair: de ene gouden knop van dit venster is
                            "Dienst overzetten…" (afwerking 04-09, nr. 5). */}
                        <Button variant="secondary" size="sm" full className="mt-2" disabled={isSavingNote} onClick={() => void saveNote()}>

                          {isSavingNote ? 'Opslaan…' : noteDraft.trim() ? 'Notitie opslaan' : notes.has(noteKey(selected.driverId, selected.iso)) ? 'Notitie verwijderen' : 'Notitie opslaan'}
                        </Button>
                      </>
                    )}
                  </Field>
                ) : (
                  <>
                    <MicroLabel>Notitie voor de chauffeur</MicroLabel>
                    <Card tone="accent" padding="none" className="px-3.5 py-2.5 text-sm font-medium text-slate-700">
                      {notes.get(noteKey(selected.driverId, selected.iso))}
                    </Card>
                  </>
                )}
              </div>
            )}

            {selected.cell.kind === 'service' ? (
              selected.cell.segments.length > 0 ? (
                <div className="mt-5 space-y-2">
                  <MicroLabel>Uren</MicroLabel>
                  {selected.cell.segments.map((seg, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-base font-semibold text-slate-800 tabular-nums">
                      <Clock size={16} className="text-oker-500 shrink-0" /> {seg}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-5 text-sm text-slate-500">Geen uren bekend voor deze dienst in het dienstoverzicht.</p>
              )
            ) : (
              <p className="mt-5 text-sm font-medium text-slate-500">
                {KIND_LABEL[selected.cell.kind]}
                {selected.cell.kind === 'unknown' && ' — staat (nog) niet in het dienstoverzicht of de planningscodes.'}
              </p>
            )}

            {/* Handmatige dienstwissel — alleen admins, op een dienst-cel én op
                een afwezigheidscel waar nog een dienst onder ligt (ziekte is
                juist hét scenario). Voor ziekte, een mondeling afgesproken ruil
                of een andere correctie; de gewone ruil-flow blijft de normale weg. */}
            {isAdmin && wisselDienst && (
              <div className="mt-6 border-t border-slate-200/70 pt-5 space-y-3">
                <MicroLabel>Dienstwissel (admin)</MicroLabel>
                {wisselNaAfwezigheid && (
                  <Card tone="accent" padding="none" className="px-3.5 py-2.5 text-xs font-medium text-slate-700 leading-relaxed">
                    {selected.driverName} staat op {selected.cell.label.toLowerCase()}, maar dienst{' '}
                    <span className="font-semibold tabular-nums">{wisselDienst}</span> staat nog op naam — zet hem hieronder over.
                  </Card>
                )}
                <p className="text-xs font-medium text-slate-500 leading-relaxed">
                  Zet dienst <span className="font-semibold text-slate-700 tabular-nums">{wisselDienst}</span> op {formatDateLong(selected.iso)} over van{' '}
                  <span className="font-semibold text-slate-700">{selected.driverName}</span> naar een andere chauffeur.
                </p>
                <Field label="Nieuwe chauffeur" htmlFor="wissel-naar">
                  <Select
                    id="wissel-naar"
                    value={wisselNaar}
                    onChange={(e) => setWisselNaar(e.target.value)}
                  >
                    <option value="">Kies een chauffeur…</option>
                    {/* Vrij die dag bovenaan, daarbinnen minst gewerkt die
                        week — zelfde criteria als de advisor (keuze Jarno
                        19-08). "Vrij" = geen dienst(cel) op deze dag in de
                        maandplanning. */}
                    {rangschikKandidaten(
                      drivers.filter((d) => String(d.id) !== selected.driverId),
                      (d) => {
                        const c = cells[String(d.id)]?.[selected.iso];
                        return !c || (c.kind !== 'service' && !c.hiddenService);
                      },
                      werkdagenPerChauffeur,
                      selected.iso,
                    ).map((k) => (
                      <option key={k.user.id} value={String(k.user.id)}>{kandidaatLabel(k)}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Reden" htmlFor="wissel-reden">
                  <div className="space-y-2">
                    <Select
                      id="wissel-reden"
                      value={wisselReden}
                      onChange={(e) => setWisselReden(e.target.value)}
                    >
                      {WISSEL_REDENEN.map((r) => <option key={r} value={r}>{r}</option>)}
                    </Select>
                    <Input
                      type="text"
                      aria-label="Toelichting bij de reden"
                      value={wisselToelichting}
                      onChange={(e) => setWisselToelichting(e.target.value)}
                      maxLength={200}
                      placeholder={wisselReden === 'Andere correctie' ? 'Omschrijf de correctie (verplicht)' : 'Toelichting (optioneel)'}
                    />
                  </div>
                </Field>
                <Button variant="primary" size="sm" full disabled={!wisselKlaar || isWisselen} onClick={() => setWisselBevestigen(true)}>
                  {isWisselen ? 'Doorvoeren…' : 'Dienst overzetten…'}
                </Button>
              </div>
            )}
          </div>
          </>
        )}
      </Modal>

      {/* Maandoverzicht per chauffeur — zelfde telling als de Excel-export.
          Op de huisprimitieven (ModalHeader, Th/Td) zodat dit venster niet
          zijn eigen dialect ontwikkelt (controle-ronde 22-08). */}
      <Modal open={overzichtOpen} onClose={() => setOverzichtOpen(false)} maxWidth="2xl" className="flex max-h-[88dvh] flex-col !overflow-hidden !p-0">
        <ModalHeader
          eyebrow="Maandoverzicht"
          title={`${MONTH_NAMES[monthIndex]} ${year}`}
          description={'Stand ná wissels, toewijzingen en afwezigheden — identiek aan het tabblad "maandoverzicht" in de Excel-export. Uren = som van de dienstsegmenten; diensten zonder tijden tellen alleen in de dagtelling.'}
          onClose={() => setOverzichtOpen(false)}
        />
        <div className="p-6 overflow-y-auto flex-1">
          {overzichtLaden ? (
            <div className="flex items-center gap-3 text-slate-500">
              <BrandSpinner size={16} />
              <span className="text-sm font-bold">Overzicht berekenen…</span>
            </div>
          ) : overzicht && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    {([
                      ['naam', 'Chauffeur'],
                      ['diensten', 'Diensten'],
                      ['minuten', 'Uren'],
                      ['anderWerk', 'Ander werk'],
                      ['ziek', 'Ziek'],
                      ['betaald', 'Betaald afw.'],
                      ['vrij', 'Vrij'],
                      ['dagen', 'Dagen'],
                    ] as Array<[keyof OverzichtRij, string]>).map(([kolom, label]) => {
                      const actief = overzichtSort.kolom === kolom;
                      return (
                        <Th
                          key={kolom}
                          sort={actief ? (overzichtSort.richting === 1 ? 'ascending' : 'descending') : undefined}
                          className={cn('px-2 py-1', kolom !== 'naam' && 'text-right')}
                        >
                          {/* rauw: sorteerbare tabelkop (tekst + pijltje) in een Th, geen knopvorm */}
                          <button
                            type="button"
                            onClick={() => sorteerOverzicht(kolom)}
                            className={cn(
                              'inline-flex min-h-11 sm:pointer-fine:min-h-0 items-center gap-1 px-1 -mx-1 transition-colors',
                              actief ? 'font-semibold text-slate-900' : 'font-medium hover:text-slate-800',
                            )}
                          >
                            {label}
                            {actief && (overzichtSort.richting === 1 ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                          </button>
                        </Th>
                      );
                    })}
                    <Th className="px-2 py-1">Overig</Th>
                  </tr>
                </thead>
                <tbody>
                  {[...overzicht.rijen]
                    .sort((a, b) => {
                      const { kolom, richting } = overzichtSort;
                      const va = a[kolom];
                      const vb = b[kolom];
                      const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
                      return cmp * richting || a.naam.localeCompare(b.naam);
                    })
                    .map((r) => (
                      <tr key={r.driverId} className="border-t border-slate-100">
                        <Td className="px-2 py-1.5 text-xs font-semibold text-slate-800 whitespace-nowrap">{r.naam}</Td>
                        <Td className="px-2 py-1.5 text-xs text-right tabular-nums">{r.diensten}</Td>
                        <Td className="px-2 py-1.5 text-xs text-right tabular-nums">{urenLabel(r.minuten)}</Td>
                        <Td className="px-2 py-1.5 text-xs text-right tabular-nums">{r.anderWerk}</Td>
                        <Td className="px-2 py-1.5 text-xs text-right tabular-nums">{r.ziek}</Td>
                        <Td className="px-2 py-1.5 text-xs text-right tabular-nums">{r.betaald}</Td>
                        <Td className="px-2 py-1.5 text-xs text-right tabular-nums">{r.vrij}</Td>
                        <Td className="px-2 py-1.5 text-xs text-right tabular-nums font-semibold">{r.dagen}</Td>
                        <Td className="px-2 py-1.5 text-xs text-slate-500 whitespace-nowrap">{r.overig.map(({ code, keren }) => `${code}×${keren}`).join(', ') || '—'}</Td>
                      </tr>
                    ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-200">
                    <Td className="px-2 py-2 text-xs font-bold text-slate-900">Totaal</Td>
                    <Td className="px-2 py-2 text-xs text-right tabular-nums font-bold text-slate-900">{overzicht.totaal.diensten}</Td>
                    <Td className="px-2 py-2 text-xs text-right tabular-nums font-bold text-slate-900">{urenLabel(overzicht.totaal.minuten)}</Td>
                    <Td className="px-2 py-2 text-xs text-right tabular-nums font-bold text-slate-900">{overzicht.totaal.anderWerk}</Td>
                    <Td className="px-2 py-2 text-xs text-right tabular-nums font-bold text-slate-900">{overzicht.totaal.ziek}</Td>
                    <Td className="px-2 py-2 text-xs text-right tabular-nums font-bold text-slate-900">{overzicht.totaal.betaald}</Td>
                    <Td className="px-2 py-2 text-xs text-right tabular-nums font-bold text-slate-900">{overzicht.totaal.vrij}</Td>
                    <Td className="px-2 py-2 text-xs text-right tabular-nums font-bold text-slate-900">{overzicht.totaal.dagen}</Td>
                    <Td className="px-2 py-2" />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </Modal>

      <ConfirmationModal
        isOpen={wisselBevestigen}
        onClose={() => setWisselBevestigen(false)}
        onConfirm={() => void uitvoerenWissel()}
        title="Dienstwissel doorvoeren?"
        message={selected && wisselDienst
          ? `Dienst ${wisselDienst} op ${formatDateLong(selected.iso)} gaat van ${selected.driverName} naar ${drivers.find((d) => String(d.id) === wisselNaar)?.name ?? '—'}. Reden: ${wisselRedenTekst}. De planning wordt meteen bijgewerkt en beide chauffeurs krijgen een melding.`
          : ''}
        confirmText="Doorvoeren"
        cancelText="Annuleren"
        variant="warning"
      />

      <ConfirmationModal
        isOpen={terugdraaien}
        onClose={() => setTerugdraaien(false)}
        onConfirm={() => void uitvoerenTerugdraai()}
        title="Wissel terugdraaien?"
        message={selected
          ? `Dienst ${selected.cell.code} op ${formatDateLong(selected.iso)} gaat terug naar ${selected.cell.swapFrom || 'de oorspronkelijke chauffeur'}. Beide chauffeurs krijgen een melding.`
          : ''}
        confirmText="Terugdraaien"
        cancelText="Annuleren"
        variant="warning"
      />
    </PageShell>
  );
}
