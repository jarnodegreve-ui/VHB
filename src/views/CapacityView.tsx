import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ChevronLeft, ChevronRight, Clock, RotateCcw, Search, TriangleAlert, X } from 'lucide-react';
import { cn, getSupabaseAuthHeaders, notify } from '../lib/ui';
import { weekRangeLabel } from '../lib/week';
import { ConfirmationModal, EmptyState, PageHeader, PageShell } from '../components/ui';
import { SkeletonRow } from '../components/Skeleton';
import { Button, MicroLabel } from '../components/primitives';
import { Modal } from '../components/Modal';
import { typedagLabel } from '../lib/typedag';
import { isoDate } from '../lib/availability';
import { fetchMonthPlanning, type MonthPlanning, type MonthCell, type CellKind } from '../lib/monthPlanning';
import { KIND_CLS, KIND_LABEL, KIND_TEXT } from '../lib/planningKind';
import type { User } from '../types';
import { formatDayLong, MONTH_NAMES, WEEKDAY_SHORT_MON } from '../lib/format';

const WEEKDAY_LETTERS = ['M', 'D', 'W', 'D', 'V', 'Z', 'Z'];

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
  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [data, setData] = useState<MonthPlanning | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<{ driverName: string; driverId: string; iso: string; cell: MonthCell } | null>(null);


  // Venster van 2 weken binnen de maand; bij de randen springen we naar de
  // vorige/volgende maand. 'pendingEdge' bepaalt waar we landen na het laden.
  const [pageIndex, setPageIndex] = useState(0);
  const [pendingEdge, setPendingEdge] = useState<null | 'first' | 'last' | 'today'>('today');

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
      const res = await fetch(`/api/planning-notes?from=${monthFrom}&to=${monthTo}`, { headers: await getSupabaseAuthHeaders() });
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
      const res = await fetch('/api/planning-notes', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...(await getSupabaseAuthHeaders()) },
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
      const res = await fetch('/api/admin/shift-swap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getSupabaseAuthHeaders()) },
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
      const res = await fetch(`/api/swaps/${encodeURIComponent(selected.cell.swapId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...(await getSupabaseAuthHeaders()) },
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

  useEffect(() => {
    const opWijziging = () => setReloadTick((t) => t + 1);
    window.addEventListener('vhb-planning-changed', opWijziging);
    return () => window.removeEventListener('vhb-planning-changed', opWijziging);
  }, []);

  const dates = data?.dates ?? [];
  const drivers = data?.drivers ?? [];
  const cells = data?.cells ?? {};

  // Maandag van de week (lokaal) → sleutel om dagen per week te bucketen.
  const weekKeyOf = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    const day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    return isoDate(d);
  };

  // Pagina's van telkens 2 kalenderweken (enkel de geplande dagen erin).
  const WEEKS_PER_PAGE = 2;
  const pages = useMemo(() => {
    if (dates.length === 0) return [] as string[][];
    const byWeek = new Map<string, string[]>();
    for (const iso of dates) {
      const k = weekKeyOf(iso);
      const bucket = byWeek.get(k);
      if (bucket) bucket.push(iso); else byWeek.set(k, [iso]);
    }
    const weekKeys = Array.from(byWeek.keys()).sort();
    const result: string[][] = [];
    for (let i = 0; i < weekKeys.length; i += WEEKS_PER_PAGE) {
      result.push(weekKeys.slice(i, i + WEEKS_PER_PAGE).flatMap((k) => byWeek.get(k)!));
    }
    return result;
  }, [dates]);

  // Na het (her)laden van een maand op de juiste pagina landen.
  useEffect(() => {
    // pendingEdge pas consumeren als de JUISTE maand geladen is — het effect
    // draaide eerder direct na setViewMonth tegen de oude pagina's, waardoor
    // "Vandaag"/maandwissels op het verkeerde 2-weken-venster landden.
    if (pendingEdge && (loading || data?.month !== monthParam)) return;
    if (pages.length === 0) { setPageIndex(0); return; }
    if (pendingEdge === 'last') { setPageIndex(pages.length - 1); setPendingEdge(null); }
    else if (pendingEdge === 'first') { setPageIndex(0); setPendingEdge(null); }
    else if (pendingEdge === 'today') {
      const idx = pages.findIndex((pg) => pg.includes(todayIso));
      setPageIndex(idx >= 0 ? idx : 0);
      setPendingEdge(null);
    } else {
      setPageIndex((p) => Math.min(p, pages.length - 1));
    }
  }, [pages, pendingEdge, todayIso, loading, data?.month, monthParam]);

  const goPrevWindow = () => {
    if (pageIndex > 0) { setPageIndex(pageIndex - 1); return; }
    setPendingEdge('last');
    setViewMonth(new Date(year, monthIndex - 1, 1));
  };
  const goNextWindow = () => {
    if (pageIndex < pages.length - 1) { setPageIndex(pageIndex + 1); return; }
    setPendingEdge('first');
    setViewMonth(new Date(year, monthIndex + 1, 1));
  };
  const goToday = () => {
    const n = new Date();
    setPendingEdge('today');
    setViewMonth(new Date(n.getFullYear(), n.getMonth(), 1));
    // Mobiele dag-weergave springt mee; valt vandaag buiten de al geladen
    // maand, dan corrigeert het dates-effect zodra de nieuwe maand binnen is.
    setMobielDag(todayIso);
  };

  const visibleDates = pages[pageIndex] ?? [];

  const formatDayMonth = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    try { return d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' }); }
    catch { return iso; }
  };
  const windowLabel = visibleDates.length > 0
    ? `${weekRangeLabel(visibleDates)} · ${formatDayMonth(visibleDates[0])} – ${formatDayMonth(visibleDates[visibleDates.length - 1])} ${year}`
    : `${MONTH_NAMES[monthIndex]} ${year}`;

  const dayHeader = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    const jsDay = d.getDay();
    return {
      letter: WEEKDAY_LETTERS[jsDay === 0 ? 6 : jsDay - 1],
      day: d.getDate(),
      weekend: jsDay === 0 || jsDay === 6,
      isMonday: jsDay === 1,
    };
  };

  const formatDateLong = formatDayLong;

  const hasData = dates.length > 0 && drivers.length > 0;

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
    <PageShell width="6xl">
      <PageHeader
        title="Maandplanning"
        description="Wie rijdt welke dienst, zoals het overzicht in het chauffeurslokaal."
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <label className="relative">
              <span className="sr-only">Zoek chauffeur</span>
              <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={zoek}
                onChange={(e) => setZoek(e.target.value)}
                placeholder="Zoek chauffeur of dienst…"
                className="control-input h-11 sm:pointer-fine:h-9 w-full sm:w-52 rounded-xl pl-9 pr-3 text-base sm:text-sm font-medium outline-none"
              />
            </label>
            {/* Het 2-weken-venster is een desktop-begrip; op mobiel navigeert
                de datumstrip (met eigen maandwissel) en is dit cluster ruis. */}
            <div className="hidden md:flex items-center gap-2">
              <button type="button" onClick={goPrevWindow} aria-label="Vorige 2 weken" className="ios-pressable w-9 h-9 rounded-xl border border-slate-200 bg-surface-white text-slate-500 hover:bg-surface-soft-hover flex items-center justify-center transition-colors">
                <ChevronLeft size={18} />
              </button>
              <span className="px-3 text-sm font-semibold tracking-tight capitalize min-w-[150px] text-center tabular-nums">{windowLabel}</span>
              <button type="button" onClick={goNextWindow} aria-label="Volgende 2 weken" className="ios-pressable w-9 h-9 rounded-xl border border-slate-200 bg-surface-white text-slate-500 hover:bg-surface-soft-hover flex items-center justify-center transition-colors">
                <ChevronRight size={18} />
              </button>
            </div>
            <Button variant="secondary" size="sm" className="ml-1 h-9 rounded-xl" onClick={goToday}>
              Vandaag
            </Button>
          </div>
        )}
      />

      {error ? (
        <div className="surface-card p-6 rounded-3xl text-center"><p className="text-sm font-semibold text-red-500">{error}</p></div>
      ) : loading ? (
        /* Skeleton i.p.v. spinner — zelfde shimmer als de rest van de app. */
        <div className="surface-card rounded-3xl overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i}>
              <SkeletonRow className="border-b border-slate-100 last:border-0" />
            </div>
          ))}
        </div>
      ) : !hasData ? (
        <EmptyState
          title={`Geen planning voor ${MONTH_NAMES[monthIndex]} ${year}`}
          message="Zodra de planning voor deze maand geïmporteerd is, verschijnt ze hier."
        />
      ) : (
        <>
          {/* .mp-*-klassen (weekend-arcering, opake sticky-cellen) staan in
              index.css bij de andere component-klassen. */}
          {/* Desktop: Excel-achtig maandgrid (chauffeur × dag) — dunne gridlijnen,
              platte dienstnummers, gearceerde weekend-kolommen. */}
          <div className="hidden md:block surface-card rounded-3xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr>
                    <th className="mp-sticky sticky left-0 top-0 z-30 bg-surface-muted px-4 py-3 text-2xs font-semibold uppercase tracking-[0.08em] text-slate-500 min-w-[180px] border-b-2 border-slate-300 border-r-2 border-slate-300">Chauffeur</th>
                    {visibleDates.map((iso) => {
                      const h = dayHeader(iso);
                      const today = iso === todayIso;
                      // De Lijn-typedag: feestdag (F, oker) of schoolvakantie
                      // (V) subtiel in de dagkop — de regeling die rijdt.
                      const td = typedagLabel(iso);
                      return (
                        <th
                          key={iso}
                          title={td?.titel}
                          className={cn(
                            'sticky top-0 z-20 px-1 py-2 text-center font-medium border-b-2 border-slate-300',
                            h.isMonday ? 'border-l-2 border-l-slate-300' : 'border-l border-slate-200',
                            today ? 'bg-oker-100' : h.weekend ? 'mp-weekend' : 'bg-surface-soft',
                          )}
                        >
                          <div className="text-2xs font-semibold uppercase tracking-[0.08em] text-slate-400">{h.letter}</div>
                          <div className={cn('text-xs font-semibold mt-0.5 tabular-nums', today ? 'text-oker-700' : 'text-slate-700')}>{h.day}</div>
                          <div className="mt-0.5 h-3 text-[10px] font-bold leading-3">
                            {td && (
                              <span className={td.kort === 'F' ? 'text-oker-600' : 'text-slate-400'}>{td.kort}</span>
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
                            <div className="inline-flex items-center px-4 py-1.5 text-2xs font-semibold uppercase tracking-[0.08em] text-slate-400">
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
                                  h.isMonday ? 'border-l-2 border-l-slate-300' : 'border-l border-slate-200',
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
                            {isOwn && <span className="text-2xs font-semibold uppercase tracking-[0.08em] text-oker-600">jij</span>}
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
                                h.isMonday ? 'border-l-2 border-l-slate-300' : 'border-l border-slate-200',
                                // oker-100/60 i.p.v. 50/50: blijft ook zichtbaar
                                // in je eigen rij (die zelf al bg-oker-50 heeft).
                                today ? 'bg-oker-100/60' : h.weekend ? 'mp-weekend' : '',
                              )}
                            >
                              {cell ? (
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
                                      ? 'font-semibold text-red-600 dark:text-red-400 border-b border-dashed border-red-500/80'
                                      : KIND_TEXT[cell.kind],
                                  )}
                                  title={celTitel(cell, notes.has(noteKey(String(drv.id), iso)))}
                                >
                                  {cell.code}
                                  {/* Dienst staat nog open onder een afwezigheid:
                                      dít is het werk dat wacht. */}
                                  {cell.hiddenService && (
                                    <TriangleAlert size={9} className="absolute left-0.5 top-0.5 text-amber-600 dark:text-amber-400" aria-label="dienst nog niet herverdeeld" />
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
          </div>

          {/* Mobile: dag-weergave — datumstrip + alle chauffeurs van één dag
              in één kolom (per sectie, op dienstnummer). De cel-modal met
              details/notitie/dienstwissel blijft dezelfde. */}
          <div className="md:hidden space-y-3">
            <div className="surface-card rounded-3xl p-2">
              {/* Maandwissel hoort hier bij de dagen — de venster-pijlen in de
                  kop zijn op mobiel verborgen. */}
              <div className="flex items-center justify-between gap-2 px-1 pb-1">
                <button
                  type="button"
                  onClick={() => { setPendingEdge('last'); setViewMonth(new Date(year, monthIndex - 1, 1)); }}
                  aria-label="Vorige maand"
                  className="ios-pressable flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 active:bg-black/[0.04] dark:active:bg-white/[0.06] transition-colors"
                >
                  <ChevronLeft size={17} />
                </button>
                <span className="text-sm font-semibold tracking-tight text-slate-800">{MONTH_NAMES[monthIndex]} {year}</span>
                <div className="flex items-center">
                  {/* Spring naar de eerstvolgende dag met een nog niet
                      herverdeelde dienst — scheelt dag voor dag vegen. */}
                  {aandachtDagen.length > 0 && (
                    <button
                      type="button"
                      onClick={springNaarAandacht}
                      aria-label="Naar de volgende dag met een openstaande dienst"
                      title="Volgende dag met een openstaande dienst"
                      className="ios-pressable flex h-11 w-11 items-center justify-center rounded-xl text-amber-600 dark:text-amber-400 active:bg-black/[0.04] dark:active:bg-white/[0.06] transition-colors"
                    >
                      <TriangleAlert size={15} />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => { setPendingEdge('first'); setViewMonth(new Date(year, monthIndex + 1, 1)); }}
                    aria-label="Volgende maand"
                    className="ios-pressable flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 active:bg-black/[0.04] dark:active:bg-white/[0.06] transition-colors"
                  >
                    <ChevronRight size={17} />
                  </button>
                </div>
              </div>
              <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Kies een dag">
                {dates.map((iso) => {
                  const d = new Date(`${iso}T00:00:00`);
                  const gekozen = iso === mobielDag;
                  const vandaag = iso === todayIso;
                  const td = typedagLabel(iso);
                  return (
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
                      <span className={cn('relative z-10 text-2xs font-semibold uppercase tracking-[0.08em] transition-colors', gekozen ? 'text-slate-950/70' : 'text-slate-400')}>
                        {WEEKDAY_SHORT_MON[(d.getDay() + 6) % 7]}
                      </span>
                      {/* Vandaag (niet gekozen) = oker dagcijfer — hetzelfde
                          stille signaal als de oude daglabels en het desktop-
                          grid. Een ring om de hele knop las als een tweede,
                          lege pil naast de gevulde selectie (melding Jarno). */}
                      <span className={cn('relative z-10 text-sm font-bold tabular-nums leading-tight transition-colors', !gekozen && vandaag && 'text-oker-600')}>
                        {d.getDate()}
                      </span>
                      {/* Typedag (F/V) — zelfde signaal als de desktop-dagkop. */}
                      <span className={cn('relative z-10 h-3 text-[10px] font-bold leading-3 transition-colors', td?.kort === 'F' && !gekozen ? 'text-oker-700' : gekozen ? 'text-slate-950/60' : 'text-slate-400')}>
                        {td?.kort ?? ''}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {mobielDag && (
              /* key per dag + korte opacity-fade: de kolom wisselt anders in
                 één harde klap van inhoud. Alleen opacity (composited) — geen
                 transform/hoogte-animatie, dat jankt op oudere toestellen. */
              <motion.div
                key={mobielDag}
                initial={reduceMotion ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className="surface-card rounded-3xl overflow-hidden"
              >
                <div className="flex items-baseline justify-between gap-3 border-b border-slate-200/70 px-4 py-3">
                  <span className="text-sm font-semibold capitalize text-slate-800">{formatDateLong(mobielDag)}</span>
                  <MicroLabel className="tabular-nums">
                    {dagRijen.secties.reduce((n, s) => n + s.rijen.length, 0)} {dagRijen.secties.reduce((n, s) => n + s.rijen.length, 0) === 1 ? 'dienst' : 'diensten'}
                  </MicroLabel>
                </div>

                {dagRijen.secties.length === 0 ? (
                  <p className="px-4 py-6 text-sm font-medium text-slate-400">
                    {zoekTerm ? 'Geen chauffeurs gevonden voor deze zoekterm.' : 'Geen diensten op deze dag.'}
                  </p>
                ) : dagRijen.secties.map((sectie) => (
                  <Fragment key={sectie.naam}>
                    {showSections && (
                      <div className="bg-slate-100/80 px-4 py-1.5 text-2xs font-semibold uppercase tracking-[0.08em] text-slate-400">{sectie.naam}</div>
                    )}
                    {sectie.rijen.map(({ drv, cell }) => {
                      if (!cell) return null;
                      const isOwn = ownId && drv.id === ownId;
                      return (
                        <button
                          key={drv.id}
                          type="button"
                          onClick={() => { setSelected({ driverName: drv.name, driverId: String(drv.id), iso: mobielDag, cell }); setNoteDraft(notes.get(noteKey(String(drv.id), mobielDag)) ?? ''); }}
                          className={cn(
                            'w-full flex items-center gap-3 px-4 py-2.5 min-h-11 text-left border-b border-slate-100 last:border-b-0 active:bg-black/[0.04] dark:active:bg-white/[0.06] transition-colors',
                            isOwn && 'bg-oker-50',
                          )}
                        >
                          <span className={cn(
                            'shrink-0 inline-block min-w-[46px] text-center rounded-md px-1.5 py-0.5 text-2xs font-semibold tabular-nums ring-1 ring-black/5',
                            cell.swapId ? 'bg-red-50 text-red-600' : KIND_CLS[cell.kind],
                          )}>{cell.code}</span>
                          <span className={cn('min-w-0 flex-1 truncate text-sm font-semibold', isOwn ? 'text-oker-800' : 'text-slate-800')}>
                            {drv.name}
                            {isOwn && <span className="ml-1.5 text-2xs font-semibold uppercase tracking-[0.08em] text-oker-600">jij</span>}
                          </span>
                          {/* Uren compact rechts; bij een open dienst de melding. */}
                          <span className="shrink-0 text-xs font-medium text-slate-400 tabular-nums">
                            {cell.hiddenService ? `dienst ${cell.hiddenService} open` : (cell.segments[0] ?? '')}
                          </span>
                          {cell.hiddenService && (
                            <TriangleAlert size={13} className="shrink-0 text-amber-600 dark:text-amber-400" aria-label="dienst nog niet herverdeeld" />
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
                    <button
                      type="button"
                      onClick={() => setToonRust((v) => !v)}
                      aria-expanded={toonRust}
                      className="w-full flex items-center justify-between gap-3 bg-slate-100/80 px-4 py-2.5 min-h-11 text-2xs font-semibold uppercase tracking-[0.08em] text-slate-400 active:bg-black/[0.04] dark:active:bg-white/[0.06] transition-colors"
                    >
                      <span>Vrij / afwezig · {dagRijen.rust.length}</span>
                      <ChevronRight size={14} className={cn('transition-transform', toonRust && 'rotate-90')} />
                    </button>
                    {toonRust && dagRijen.rust.map(({ drv, cell }) => {
                      const isOwn = ownId && drv.id === ownId;
                      const inhoud = (
                        <>
                          <span className={cn(
                            'shrink-0 inline-block min-w-[46px] text-center rounded-md px-1.5 py-0.5 text-2xs font-semibold tabular-nums',
                            cell ? cn('ring-1 ring-black/5', KIND_CLS[cell.kind]) : 'text-slate-300',
                          )}>{cell?.code ?? '—'}</span>
                          <span className={cn('min-w-0 flex-1 truncate text-sm font-medium', isOwn ? 'text-oker-800' : 'text-slate-600')}>
                            {drv.name}
                            {isOwn && <span className="ml-1.5 text-2xs font-semibold uppercase tracking-[0.08em] text-oker-600">jij</span>}
                          </span>
                          <span className="shrink-0 text-xs font-medium text-slate-400">{cell?.label ?? ''}</span>
                        </>
                      );
                      const rijCls = cn(
                        'w-full flex items-center gap-3 px-4 py-2.5 min-h-11 text-left border-b border-slate-100 last:border-b-0',
                        isOwn && 'bg-oker-50',
                      );
                      // Zonder cel valt er niets te openen — dan geen knop.
                      return cell ? (
                        <button
                          key={drv.id}
                          type="button"
                          onClick={() => { setSelected({ driverName: drv.name, driverId: String(drv.id), iso: mobielDag, cell }); setNoteDraft(notes.get(noteKey(String(drv.id), mobielDag)) ?? ''); }}
                          className={cn(rijCls, 'active:bg-black/[0.04] dark:active:bg-white/[0.06] transition-colors')}
                        >
                          {inhoud}
                        </button>
                      ) : (
                        <div key={drv.id} className={rijCls}>{inhoud}</div>
                      );
                    })}
                  </>
                )}
              </motion.div>
            )}
          </div>

          {/* Legende — de codes die deze maand écht voorkomen, met hun betekenis. */}
          <div className="surface-card rounded-3xl p-5 flex flex-wrap items-center gap-x-5 gap-y-3 text-xs">
            <MicroLabel className="text-slate-500">Legende</MicroLabel>
            {codeLegend.serviceExample && (
              <div className="flex items-center gap-2">
                <span className={cn('inline-block rounded-md px-1.5 py-0.5 text-2xs font-semibold tabular-nums', KIND_CLS.service)}>{codeLegend.serviceExample}</span>
                <span className="font-medium text-slate-600">Dienst</span>
              </div>
            )}
            {codeLegend.entries.map((e) => (
              <div key={e.code} className="flex items-center gap-2">
                <span className={cn('inline-block rounded-md px-1.5 py-0.5 text-2xs font-semibold', KIND_CLS[e.kind])}>{e.code}</span>
                <span className="font-medium text-slate-600">{e.meaning}</span>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <TriangleAlert size={13} className="text-amber-600 dark:text-amber-400" />
              <span className="font-medium text-slate-600">Dienst nog niet herverdeeld</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-block rounded-md bg-red-50 px-1.5 py-0.5 text-2xs font-semibold tabular-nums text-red-600 ring-1 ring-black/5">4102</span>
              <span className="font-medium text-slate-600">Geruild of overgezet</span>
            </div>
            <span className="font-medium text-slate-400">Leeg = niets gepland</span>
          </div>
        </>
      )}

      <Modal open={!!selected} onClose={() => setSelected(null)} maxWidth="sm">
        {selected && (
          <div className="p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <MicroLabel className="capitalize">{formatDateLong(selected.iso)}</MicroLabel>
                <h3 className="mt-0.5 text-lg font-semibold tracking-tight text-slate-900 truncate">{selected.driverName}</h3>
              </div>
              <button type="button" onClick={() => setSelected(null)} aria-label="Sluiten" className="ios-pressable shrink-0 w-11 h-11 sm:pointer-fine:w-8 sm:pointer-fine:h-8 rounded-full border border-slate-200 bg-surface-white text-slate-400 hover:text-slate-700 hover:bg-surface-soft-hover flex items-center justify-center transition-colors">
                <X size={16} />
              </button>
            </div>

            <div className="mt-4 flex items-center gap-2.5">
              <span className={cn(
                'inline-block rounded-lg px-2.5 py-1 text-sm font-semibold tabular-nums ring-1 ring-black/5',
                selected.cell.swapId ? 'bg-red-50 text-red-600' : KIND_CLS[selected.cell.kind],
              )}>{selected.cell.code}</span>
              <span className="text-sm font-semibold text-slate-700">{selected.cell.label}</span>
            </div>

            {/* Herkomst van deze cel: hij wijkt af van de geïmporteerde Excel.
                Planners/admins kunnen de wissel hier meteen terugdraaien — dat
                annuleert de ruil én zet de planning terug. */}
            {selected.cell.swapId && (
              <div className="mt-4 rounded-2xl bg-surface-soft px-3.5 py-3 space-y-2.5">
                <p className="text-xs font-medium text-slate-600 leading-relaxed">
                  {selected.cell.swapManual ? 'Handmatig overgezet' : 'Geruild'}
                  {selected.cell.swapFrom ? <> van <span className="font-semibold text-slate-700">{selected.cell.swapFrom}</span></> : null}.
                </p>
                {canEditNotes && (
                  <Button variant="secondary" size="sm" full icon={<RotateCcw size={14} />} disabled={isTerugdraaien} onClick={() => setTerugdraaien(true)}>
                    {isTerugdraaien ? 'Terugdraaien…' : 'Wissel terugdraaien'}
                  </Button>
                )}
              </div>
            )}

            {(notes.has(noteKey(selected.driverId, selected.iso)) || canEditNotes) && (
              <div className="mt-5 space-y-2">
                <MicroLabel>Notitie voor de chauffeur</MicroLabel>
                {canEditNotes ? (
                  <>
                    <textarea
                      value={noteDraft}
                      onChange={(e) => setNoteDraft(e.target.value)}
                      maxLength={280}
                      placeholder="bv. Neem bus 412 — eerst tanken."
                      className="control-input w-full rounded-2xl px-3.5 py-2.5 text-base sm:text-sm font-medium outline-none h-20 resize-none"
                    />
                    <Button variant="primary" size="sm" full disabled={isSavingNote} onClick={() => void saveNote()}>
                      {isSavingNote ? 'Opslaan…' : noteDraft.trim() ? 'Notitie opslaan' : notes.has(noteKey(selected.driverId, selected.iso)) ? 'Notitie verwijderen' : 'Notitie opslaan'}
                    </Button>
                  </>
                ) : (
                  <p className="rounded-2xl bg-oker-50/70 px-3.5 py-2.5 text-sm font-medium text-slate-700">
                    {notes.get(noteKey(selected.driverId, selected.iso))}
                  </p>
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
                <p className="mt-5 text-sm font-medium text-slate-400">Geen uren bekend voor deze dienst in het dienstoverzicht.</p>
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
                  <p className="rounded-2xl bg-oker-50/70 px-3.5 py-2.5 text-xs font-medium text-slate-700 leading-relaxed">
                    {selected.driverName} staat op {selected.cell.label.toLowerCase()}, maar dienst{' '}
                    <span className="font-semibold tabular-nums">{wisselDienst}</span> staat nog op naam — zet hem hieronder over.
                  </p>
                )}
                <p className="text-xs font-medium text-slate-500 leading-relaxed">
                  Zet dienst <span className="font-semibold text-slate-700 tabular-nums">{wisselDienst}</span> op {formatDateLong(selected.iso)} over van{' '}
                  <span className="font-semibold text-slate-700">{selected.driverName}</span> naar een andere chauffeur.
                </p>
                <div className="space-y-2">
                  <label className="text-2xs font-semibold text-slate-400 uppercase tracking-[0.08em] ml-1" htmlFor="wissel-naar">Nieuwe chauffeur</label>
                  <select
                    id="wissel-naar"
                    value={wisselNaar}
                    onChange={(e) => setWisselNaar(e.target.value)}
                    className="control-input w-full px-3.5 py-2.5 rounded-2xl font-semibold text-base sm:text-sm outline-none bg-surface-field"
                  >
                    <option value="">Kies een chauffeur…</option>
                    {drivers.filter((d) => String(d.id) !== selected.driverId).map((d) => (
                      <option key={d.id} value={String(d.id)}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-2xs font-semibold text-slate-400 uppercase tracking-[0.08em] ml-1" htmlFor="wissel-reden">Reden</label>
                  <select
                    id="wissel-reden"
                    value={wisselReden}
                    onChange={(e) => setWisselReden(e.target.value)}
                    className="control-input w-full px-3.5 py-2.5 rounded-2xl font-semibold text-base sm:text-sm outline-none bg-surface-field"
                  >
                    {WISSEL_REDENEN.map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                  <input
                    type="text"
                    value={wisselToelichting}
                    onChange={(e) => setWisselToelichting(e.target.value)}
                    maxLength={200}
                    placeholder={wisselReden === 'Andere correctie' ? 'Omschrijf de correctie (verplicht)' : 'Toelichting (optioneel)'}
                    className="control-input w-full px-3.5 py-2.5 rounded-2xl text-base sm:text-sm font-medium outline-none"
                  />
                </div>
                <Button variant="primary" size="sm" full disabled={!wisselKlaar || isWisselen} onClick={() => setWisselBevestigen(true)}>
                  {isWisselen ? 'Doorvoeren…' : 'Dienst overzetten…'}
                </Button>
              </div>
            )}
          </div>
        )}
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
