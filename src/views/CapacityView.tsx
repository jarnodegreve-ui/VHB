import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ChevronLeft, ChevronRight, Clock, Download, RotateCcw, Table2, TriangleAlert } from 'lucide-react';
import { BrandSpinner } from '../components/BrandSpinner';
import { cn, downloadBlob, notify } from '../lib/ui';
import { weekRangeLabel } from '../lib/week';
import { ConfirmationModal, EmptyState, Foutkaart, ModalHeader, PageHeader, PageShell } from '../components/ui';
import { useZelfLadend } from '../lib/zelfLadend';
import { ActieMenu } from '../components/ActieMenu';
import { apiFetch } from '../lib/api';
import { SkeletonRow } from '../components/Skeleton';
import { Button, Chip, IconButton, MicroLabel, microLabelClass } from '../components/primitives';
import { SortTh, StickyThead } from '../components/Table';
import { Card } from '../components/Card';
import { Uitklap, uitklapChevron } from '../components/Uitklap';
import { Field, Input, SearchField, Select, Textarea } from '../components/Field';
import { Modal } from '../components/Modal';
import { meldSchrijffout } from '../lib/fouten';
import { typedagLabel } from '../lib/typedag';
import { isoDate } from '../lib/availability';
import { fetchMonthPlanning, type MonthPlanning, type MonthCell, type CellKind } from '../lib/monthPlanning';
import { KIND_CLS, KIND_LABEL, celChipClass, celTextClass } from '../lib/planningKind';
import { isStaf } from '../types';
import type { User } from '../types';
import { formatDatumDMJ, formatDayLong, MONTH_NAMES, WEEKDAY_LETTER_MON, WEEKDAY_SHORT_MON } from '../lib/format';
import { kandidaatLabel, rangschikKandidaten } from '../lib/vervangers';
import { DUR, EASE_SPRING } from '../lib/motion';
import { useRecordParam, useRouteParam } from '../app/router';
import { Td, Th, Tabel, TableShell } from '../components/TabelBasis';


/** Sectiekop in het grid en de daglijst ("Chauffeurs", "Flexi/invallers",
 *  "Vrij / afwezig"): duidelijker dan een micro-label (Jarno 08-09), met
 *  een donkerdere band, vette kop en een gouden accentstreep links. */
const SECTIE_KOP = 'text-xs font-bold uppercase tracking-wider text-slate-900';
/** Gouden streepje vóór de sectienaam: klein merkaccent i.p.v. een band. */
const SECTIE_STREEP = <span className="mr-2.5 inline-block h-3.5 w-1 shrink-0 rounded-full bg-oker-500" aria-hidden="true" />;
// Band-kleur staat in index.css (.mp-sectie, slate-200 die meeflipt in dark
// mode) zodat hij ook op de sticky cel wint; hier alleen de gouden
// accentstreep (Jarno 08-09: donker paste niet bij de rest).
const SECTIE_BAND = 'mp-sectie';

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

/** Wachttijd waarbinnen opeenvolgende planningswijzigingen tot één stille
 *  verversing samenvouwen. Ruim genoeg voor een salvo schrijfacties, kort
 *  genoeg dat het bord niet merkbaar achterloopt op een collega. */
const PLANNING_SALVO_MS = 1200;
const maandUitParam = (p: string | null): Date | null =>
  p && MAAND_PARAM.test(p) ? new Date(Number(p.slice(0, 4)), Number(p.slice(5, 7)) - 1, 1) : null;
const maandNaarParam = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;

/** Vaste redenen voor een handmatige dienstwissel; bij 'Andere correctie' is
 *  de vrije toelichting verplicht (de server eist altijd een reden). De
 *  ondertekende papieren ruil staat erbij sinds 18-09 (Jarno): die komt als
 *  briefje binnen en is het bewijsstuk waarnaar het ruiloverzicht verwijst. */
const WISSEL_REDENEN = ['Ziekte', 'Mondelinge dienstruil', 'Ruil op papier ondertekend', 'Andere correctie'] as const;

/** Sorteerbare kolommen van het maandoverzicht (Overig sorteert niet). */
const OVERZICHT_KOLOMMEN = [
  ['naam', 'Chauffeur'],
  ['diensten', 'Diensten'],
  ['minuten', 'Uren'],
  ['anderWerk', 'Ander werk'],
  ['ziek', 'Ziek'],
  ['betaald', 'Betaald afw.'],
  ['vrij', 'Vrij'],
  ['dagen', 'Dagen'],
] as const;

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
    setOverzichtSort((cur) => (cur.kolom === kolom ? { kolom, richting: cur.richting === 1 ? -1 : 1 } : { kolom, richting: kolom === 'naam' ? 1 : -1 }));
  // Dezelfde sorteerstand in de vorm die SortTh leest (aria-sort, pijl).
  const overzichtSortTh = {
    key: overzichtSort.kolom,
    dir: (overzichtSort.richting === 1 ? 'asc' : 'desc') as 'asc' | 'desc',
    toggle: sorteerOverzicht,
  };

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

  // Gekozen dag van de mobiele dag-weergave in de URL (segment ná de maand:
  // /maandplanning/2026-09/2026-09-15), zie het state-blok "Mobiel:
  // dag-weergave" verderop. Alleen een tik schrijft; de automatische keuze
  // (vandaag / eerste dag) blijft buiten de URL.
  const [dagParam, zetDagParam] = useRecordParam(1, { view: 'bezetting' });

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
  // Het vórige venster eindigt de dag vóór dit venster; het vólgende begint
  // twee weken later. Een venster dat helemaal buiten de import valt heeft
  // niets te tonen.
  const kanTerug = !eersteDag || addDaysIso(windowStart, -1) >= eersteDag;
  const kanVooruit = !laatsteDag || addDaysIso(windowStart, 14) <= laatsteDag;
  const maandGrens = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const kanMaandTerug = !eersteDag || maandGrens(new Date(year, monthIndex - 1, 1)) >= eersteDag.slice(0, 7);
  const kanMaandVooruit = !laatsteDag || maandGrens(new Date(year, monthIndex + 1, 1)) <= laatsteDag.slice(0, 7);
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
  // Kop boven een sectie: de opgeslagen waarde is de korte ploegnaam uit
  // gebruikersbeheer ("Reguliere"); in het bord leest "Reguliere diensten"
  // beter (Jarno 09-09). Alleen weergave, de data en de keuzelijst blijven.
  const sectieLabel = (naam: string) => (/^regulier/i.test(naam.trim()) ? 'Reguliere diensten' : naam);

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
    cell.swapId
      ? cell.swapAway
        ? `dienst ${cell.swapManual ? 'overgezet' : 'weggeruild'} naar ${cell.swapTo || 'een collega'}`
        : (cell.swapManual ? `handmatig overgezet van ${cell.swapFrom || 'een collega'}` : `geruild met ${cell.swapFrom || 'een collega'}`)
      : '',
    heeftNotitie ? 'notitie' : '',
  ].filter(Boolean).join(' · ') + ', klik voor details';

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
  // Het desktopraster per sectie (één tbody per sectie). De API levert de
  // chauffeurs al op sectie → naam, dus een nieuwe groep begint waar de
  // sectie wisselt, precies waar de sectiekop vroeger tussen de rijen stond.
  const gridSecties: Array<{ naam: string; drivers: typeof zichtbareDrivers }> = [];
  for (const drv of zichtbareDrivers) {
    const naam = sectionOf(drv);
    const laatste = gridSecties[gridSecties.length - 1];
    if (laatste && laatste.naam === naam) laatste.drivers.push(drv);
    else gridSecties.push({ naam, drivers: [drv] });
  }

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
    const heeftRuil = Object.values(cells).some((row) => Object.values(row).some((c) => Boolean(c.swapId)));
    return { serviceExample, entries, heeftRuil };
  }, [cells]);

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
              placeholder="Zoek chauffeur of dienst…"
              enterKeyHint="search"
              size="sm"
              className="min-w-40 flex-1 sm:w-60 sm:flex-none"
            />
            {/* Het 2-weken-venster is een desktop-begrip; op mobiel navigeert
                de datumstrip (met eigen maandwissel) en is dit cluster ruis. */}
            <div className="hidden md:flex items-center gap-2">
              <IconButton
                label="Vorige 2 weken"
                title={kanTerug ? 'Vorige 2 weken' : `De planning begint op ${formatDatumDMJ(eersteDag)}`}
                variant="secondary"
                size="sm"
                disabled={!kanTerug}
                onClick={goPrevWindow}
              >
                <ChevronLeft size={18} />
              </IconButton>
              <span className="px-3 text-sm font-semibold capitalize min-w-[150px] text-center tabular-nums">{windowLabel}</span>
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
      ) : zl.laden ? (
        /* Skeleton i.p.v. spinner — zelfde shimmer als de rest van de app. */
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
          {/* .mp-*-klassen (weekend-arcering, opake sticky-cellen) staan in
              index.css bij de andere component-klassen. */}
          {/* Desktop: Excel-achtig maandgrid (chauffeur × dag) — dunne gridlijnen,
              platte dienstnummers, gearceerde weekend-kolommen.
              TableShell `sticky` (tranche 3B): onder xl schuift het raster in
              zijn kader met de naamkolom vast links; vanaf xl past het venster
              van 14 dagen in het kader en plakt de dagkop onder de topbar
              terwijl je door de chauffeurs scrollt. Vroeger plakte er
              verticaal niets: de kaart had overflow-hidden. */}
          <TableShell label="Maandplanning per chauffeur en dag" sticky className="hidden md:block">
            <Tabel>
              {/* De dagkop draagt een dikke lijn eronder (zoals het bord), niet de dunne van StickyThead. */}
              <StickyThead className="[&_th]:border-b-2 [&_th]:border-hairline-strong">
                <tr>
                  <Th className="mp-sticky sticky left-0 z-sticky-hoek min-w-[180px] border-r-2 border-hairline-strong bg-surface-muted">
                    <span className={microLabelClass}>Chauffeur</span>
                  </Th>
                  {visibleDates.map((iso) => {
                    const h = dayHeader(iso);
                    const today = iso === todayIso;
                    // De Lijn-typedag, alleen nog de feestdag (F, oker):
                    // die bepaalt welke dienstregeling rijdt. De V van
                    // schoolvakantie is eruit op vraag van Jarno (17-09),
                    // die zegt niets over wie er rijdt.
                    const td = typedagLabel(iso);
                    const feestdag = td?.kort === 'F';
                    // Maandafkorting onder élke dag (Jarno 17-09): stond
                    // eerst alleen bij dagen uit de ándere maand van het
                    // 2-wekenvenster, waardoor de ene week een maand toonde
                    // en de andere niet.
                    const maandKort = (MONTH_NAMES[Number(iso.slice(5, 7)) - 1] ?? '').slice(0, 3).toLowerCase();
                    return (
                      <Th
                        key={iso}
                        title={feestdag ? td?.titel : undefined}
                        className={cn(
                          'px-1 py-2 text-center',
                          h.isMonday ? 'border-l-2 border-l-slate-400' : 'border-l border-hairline',
                          today ? 'bg-oker-100' : h.weekend ? 'mp-weekend' : 'bg-surface-soft',
                        )}
                      >
                        {/* Zichtbaar: letter, dag, maand; voorgelezen: de volledige dag. */}
                        <span className="sr-only">{formatDayLong(iso)}{feestdag ? ', feestdag' : ''}{today ? ', vandaag' : ''}</span>
                        <span aria-hidden="true">
                          <span className={cn(microLabelClass, 'block')}>{h.letter}</span>
                          <span className={cn('mt-0.5 block text-xs font-semibold', today ? 'text-oker-700' : 'text-slate-700')}>{h.day}</span>
                          {/* 2xs: matrixcel van 3 px-hoog label onder de dag, dichte planningsmatrix */}
                          <span className="mt-0.5 block h-3 text-2xs font-bold leading-3">
                            <span className={microLabelClass}>{maandKort}</span>
                            {feestdag && <span className="ml-1 text-oker-700">F</span>}
                          </span>
                        </span>
                      </Th>
                    );
                  })}
                </tr>
              </StickyThead>
              {/* Eén tbody per sectie (Chauffeurs, Flexi/invallers…): de
                  sectiekop is dan een echte kop over die groep rijen. */}
              {gridSecties.map((sectie) => (
                <tbody key={sectie.naam}>
                  {showSections && (
                    <tr>
                      {/* Label alleen in de vaste eerste cel; de dag-cellen
                          van de band behouden weekend-arcering en de
                          vandaag-markering, zodat die verticale gidsen
                          niet per sectie onderbroken worden. */}
                      <Th scope="rowgroup" className={cn('mp-sticky sticky left-0 z-sticky p-0 border-r-2 border-r-slate-300', SECTIE_BAND)}>
                        <span className={cn('flex h-8 items-center px-4', SECTIE_KOP)}>
                          {SECTIE_STREEP}
                          {sectieLabel(sectie.naam)}
                        </span>
                      </Th>
                      {visibleDates.map((iso) => {
                        const h = dayHeader(iso);
                        return (
                          <td
                            key={iso}
                            className={cn(
                              'mp-sectie p-0 border-l',
                              h.isMonday && 'mp-sectie-ma',
                            )}
                          />
                        );
                      })}
                    </tr>
                  )}
                  {sectie.drivers.map((drv) => {
                    const row = cells[drv.id] || {};
                    const isOwn = ownId && drv.id === ownId;
                    return (
                      <tr key={drv.id} className="group border-b border-hairline bg-surface-white">
                        {/* Rijkop: de naam. Je eigen rij krijgt een neutrale stip
                            en vet, geen goud (goud = actie, focus, nu). */}
                        <Th
                          scope="row"
                          className={cn(
                            'mp-sticky sticky left-0 z-sticky min-w-[180px] truncate border-r-2 border-hairline-strong bg-surface-white px-4 py-2 text-sm text-slate-800 transition-colors group-hover:bg-surface-soft-hover',
                            isOwn ? 'font-bold' : 'font-semibold',
                          )}
                        >
                          <span className="inline-flex items-center gap-1.5">
                            {isOwn && <span className="size-1.5 shrink-0 rounded-full bg-slate-700" aria-hidden="true" />}
                            {drv.name}
                            {isOwn && <span className="sr-only"> (jij)</span>}
                          </span>
                        </Th>
                        {visibleDates.map((iso) => {
                          const cell = row[iso];
                          const h = dayHeader(iso);
                          const today = iso === todayIso;
                          return (
                            <td
                              key={iso}
                              className={cn(
                                'p-0 text-center',
                                h.isMonday ? 'border-l-2 border-l-slate-400' : 'border-l border-hairline',
                                today ? 'bg-oker-100/60' : h.weekend ? 'mp-weekend' : '',
                                // Lege cel: stippen (anders dan de weekendarcering), Jarno 08-09.
                                !cell && 'mp-leeg',
                              )}
                            >
                              {cell ? (
                                // rauw: gridcel van de maandplanning (Excel-look, h-7, eigen kleurtaal)
                                <button
                                  type="button"
                                  onClick={() => { setSelected({ driverName: drv.name, driverId: String(drv.id), iso, cell }); setNoteDraft(notes.get(noteKey(String(drv.id), iso)) ?? ''); }}
                                  className={cn(
                                    // 2xs: dichte bezettingsmatrix, 12 px laat de kolommen wrappen.
                                    // Hover = neutrale binnenrand, geen goud (tranche 3B).
                                    'relative flex h-7 w-full cursor-pointer items-center justify-center px-1 text-2xs transition-colors hover:ring-1 hover:ring-inset hover:ring-hairline-strong',
                                    // Gewisselde cel in het geel en ziekte in
                                    // het rood (Jarno 08-09; ruil was rood sinds
                                    // 15-08): afwijkingen van de Excel moet je
                                    // in één oogopslag zien.
                                    celTextClass(cell),
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
                    );
                  })}
                </tbody>
              ))}
            </Tabel>
          </TableShell>

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
                  title={kanMaandTerug ? 'Vorige maand' : `De planning begint op ${formatDatumDMJ(eersteDag)}`}
                  variant="ghost"
                  size="md"
                  className="text-slate-400"
                  disabled={!kanMaandTerug}
                  onClick={() => setViewMonth(new Date(year, monthIndex - 1, 1))}
                >
                  <ChevronLeft size={16} />
                </IconButton>
                <span className="text-sm font-semibold text-slate-800 tabular-nums">{MONTH_NAMES[monthIndex]} {year}</span>
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
                    title={kanMaandVooruit ? 'Volgende maand' : `De planning is geïmporteerd tot ${formatDatumDMJ(laatsteDag)}`}
                    variant="ghost"
                    size="md"
                    className="text-slate-400"
                    disabled={!kanMaandVooruit}
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
                      onClick={() => kiesDag(iso)}
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
                          // Zelfde veer als sidebar-rail, dock-tab en Segmented-pil
                          // (EASE_SPRING op DUR.fast, golf 2 punt 9).
                          transition={reduceMotion ? { duration: 0 } : { duration: DUR.fast, ease: EASE_SPRING }}
                          className="absolute inset-0 rounded-xl bg-oker-500 elev-accent"
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
                      {/* Feestdag (F) — zelfde signaal als de desktop-dagkop.
                          De V van schoolvakantie is eruit (Jarno 17-09). De
                          maand staat hier niet onder elke dag: de strip loopt
                          binnen één maand en die staat in de kop erboven. */}
                      {/* 2xs: matrixcel, typedagletter in een vaste 3 px-hoge strook */}
                      <span className={cn('relative z-10 h-3 text-2xs font-bold leading-3 transition-colors', !gekozen ? 'text-oker-700' : 'text-slate-950/60')}>
                        {td?.kort === 'F' ? 'F' : ''}
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
                <div className="flex items-baseline justify-between gap-3 border-b border-hairline px-4 py-3">
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
                      <div className={cn(SECTIE_BAND, 'flex h-9 items-center px-4', SECTIE_KOP)}>{SECTIE_STREEP}{sectieLabel(sectie.naam)}</div>
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
                          className="w-full flex items-center gap-3 px-4 py-2.5 min-h-11 text-left border-b border-hairline-subtle last:border-b-0 active:bg-surface-soft-hover transition-colors"
                        >
                          <Chip mono={false} className={cn(
                            'min-w-[46px] justify-center ring-1 ring-hairline',
                            celChipClass(cell),
                          )}>{cell.code}</Chip>
                          {/* Eigen rij: neutrale stip en vet, geen gouden vlak (tranche 3B). */}
                          <span className={cn('min-w-0 flex-1 truncate text-sm text-slate-800', isOwn ? 'font-bold' : 'font-semibold')}>
                            {isOwn && <span className="mr-1.5 inline-block size-1.5 rounded-full bg-slate-700 align-middle" aria-hidden="true" />}
                            {drv.name}
                            {isOwn && <span className="sr-only"> (jij)</span>}
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
                      className={cn('w-full flex items-center justify-between gap-3 px-4 py-2.5 min-h-11 active:bg-surface-soft-hover transition-colors', SECTIE_BAND, SECTIE_KOP)}
                    >
                      <span>Vrij / afwezig · {dagRijen.rust.length}</span>
                      <ChevronRight size={14} className={uitklapChevron(toonRust, 90)} />
                    </button>
                    <Uitklap open={toonRust}>
                    <div>
                    {dagRijen.rust.map(({ drv, cell }) => {
                      const isOwn = ownId && drv.id === ownId;
                      const inhoud = (
                        <>
                          <Chip mono={false} className={cn(
                            'min-w-[46px] justify-center',
                            cell ? cn('ring-1 ring-hairline', KIND_CLS[cell.kind]) : 'bg-transparent text-slate-300',
                          )}>{cell?.code ?? '—'}</Chip>
                          <span className={cn('min-w-0 flex-1 truncate text-sm', isOwn ? 'font-bold text-slate-800' : 'font-medium text-slate-600')}>
                            {isOwn && <span className="mr-1.5 inline-block size-1.5 rounded-full bg-slate-700 align-middle" aria-hidden="true" />}
                            {drv.name}
                            {isOwn && <span className="sr-only"> (jij)</span>}
                          </span>
                          <span className="shrink-0 text-xs font-medium text-slate-500">{cell?.label ?? ''}</span>
                        </>
                      );
                      const rijCls = 'w-full flex items-center gap-3 px-4 py-2.5 min-h-11 text-left border-b border-hairline-subtle last:border-b-0';
                      // Zonder cel valt er niets te openen — dan geen knop.
                      // rauw: klikbare dagrij (zie hierboven) — kaart-als-knop met eigen layout
                      return cell ? (
                        <button
                          key={drv.id}
                          type="button"
                          onClick={() => { setSelected({ driverName: drv.name, driverId: String(drv.id), iso: mobielDag, cell }); setNoteDraft(notes.get(noteKey(String(drv.id), mobielDag)) ?? ''); }}
                          className={cn(rijCls, 'active:bg-surface-soft-hover transition-colors')}
                        >
                          {inhoud}
                        </button>
                      ) : (
                        <div key={drv.id} className={rijCls}>{inhoud}</div>
                      );
                    })}
                    </div>
                    </Uitklap>
                  </>
                )}
                </Card>
              </motion.div>
            )}
          </div>

          {/* Legende (herwerkt 08-09, Jarno): twee groepen, codes en markeringen,
              elk chip + betekenis in een vaste rij. Alleen codes die deze maand
              voorkomen; ruil en ziekte volgen dezelfde kleuren als de cellen. */}
          <Card padding="md" className="text-xs">
            <div className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-start md:gap-x-10">
              <div className="min-w-0">
                <MicroLabel className="mb-2 block">Codes</MicroLabel>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  {codeLegend.serviceExample && (
                    <span className="inline-flex items-center gap-2">
                      <Chip mono={false} className={cn('min-w-11 justify-center', KIND_CLS.service)}>{codeLegend.serviceExample}</Chip>
                      <span className="font-medium text-slate-700">Dienst</span>
                    </span>
                  )}
                  {codeLegend.entries.map((e) => (
                    <span key={e.code} className="inline-flex items-center gap-2">
                      <Chip mono={false} className={cn('min-w-11 justify-center', celChipClass({ kind: e.kind, code: e.code }))}>{e.code}</Chip>
                      <span className="font-medium text-slate-700">{e.meaning}</span>
                    </span>
                  ))}
                  {/* Alleen tonen als er die maand écht een wissel in staat:
                      anders legt de legende twee kleuren uit die nergens
                      voorkomen (heeftRuil werd berekend maar nooit gelezen). */}
                  {codeLegend.heeftRuil && (
                    <>
                      <span className="inline-flex items-center gap-2">
                        <Chip mono={false} className={cn('min-w-11 justify-center', celChipClass({ kind: 'service', code: '', swapId: 'x' }))}>{codeLegend.serviceExample ?? 'dienst'}</Chip>
                        <span className="font-medium text-slate-700">Geruild of overgezet, gekregen</span>
                      </span>
                      <span className="inline-flex items-center gap-2">
                        <Chip mono={false} className={cn('min-w-11 justify-center', celChipClass({ kind: 'absence', code: 'vrij', swapId: 'x' }))}>vrij</Chip>
                        <span className="font-medium text-slate-700">Geruild of overgezet, weggegeven</span>
                      </span>
                    </>
                  )}
                </div>
              </div>
              <div className="min-w-0">
                <MicroLabel className="mb-2 block">Markeringen</MicroLabel>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-flex h-6 w-11 items-center justify-center rounded-lg bg-surface-muted"><TriangleAlert size={14} className="text-amber-700" /></span>
                    <span className="font-medium text-slate-700">Dienst nog niet herverdeeld</span>
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="inline-flex h-6 w-11 items-center justify-center rounded-lg bg-surface-muted"><span className="h-1.5 w-1.5 rounded-full bg-oker-500" /></span>
                    <span className="font-medium text-slate-700">Notitie bij de dag</span>
                  </span>
                  <span className="inline-flex items-center gap-2">
                    {/* 2xs: datumbadge van vaste maat */}
                    <span className="inline-flex h-6 w-11 items-center justify-center rounded-lg bg-oker-100 text-2xs font-semibold text-oker-800">{new Date().getDate()}</span>
                    <span className="font-medium text-slate-700">Vandaag</span>
                  </span>
                </div>
              </div>
            </div>
          </Card>
        </>
      )}

      <Modal open={!!selected} onClose={() => setSelected(null)} vuil={celVuil} maxWidth="sm" className="flex max-h-overlay flex-col !overflow-hidden !p-0">
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
                celChipClass(selected.cell),
              )}>{selected.cell.code}</span>
              <span className="text-sm font-semibold text-slate-700">{selected.cell.label}</span>
            </div>

            {/* Herkomst van deze cel: hij wijkt af van de geïmporteerde Excel.
                Planners/admins kunnen de wissel hier meteen terugdraaien — dat
                annuleert de ruil én zet de planning terug. */}
            {selected.cell.swapId && (
              <Card tone="muted" padding="none" className="mt-4 px-3.5 py-3 space-y-2.5">
                <p className="text-body-sm font-medium text-slate-600">
                  {selected.cell.swapAway ? (
                    <>
                      Dienst {selected.cell.swapManual ? 'overgezet' : 'weggeruild'}
                      {selected.cell.swapTo ? <> naar <span className="font-semibold text-slate-700">{selected.cell.swapTo}</span></> : null}, daardoor vrij.
                    </>
                  ) : (
                    <>
                      {selected.cell.swapManual ? 'Handmatig overgezet' : 'Geruild'}
                      {selected.cell.swapFrom ? <> van <span className="font-semibold text-slate-700">{selected.cell.swapFrom}</span></> : null}.
                    </>
                  )}
                </p>
                {canEditNotes && (selected.cell.swapDone ? (
                  // Afgehandelde ruil: de state-machine laat geen overgang
                  // meer toe, dus geen knop die gegarandeerd een fout geeft.
                  <p className="text-body-sm font-medium text-slate-500">Afgehandeld, terugdraaien kan niet meer. Zet de dienst desnoods handmatig terug via Dienstwissel.</p>
                ) : (
                  <Button variant="secondary" size="sm" full icon={<RotateCcw size={14} />} disabled={isTerugdraaien} onClick={() => setTerugdraaien(true)}>
                    {isTerugdraaien ? 'Terugdraaien…' : 'Wissel terugdraaien'}
                  </Button>
                ))}
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
                          placeholder="bv. Neem bus 412, eerst tanken."
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
                {selected.cell.kind === 'unknown' && ', staat (nog) niet in het dienstoverzicht of de planningscodes.'}
              </p>
            )}

            {/* Handmatige dienstwissel — alleen admins, op een dienst-cel én op
                een afwezigheidscel waar nog een dienst onder ligt (ziekte is
                juist hét scenario). Voor ziekte, een mondeling afgesproken ruil
                of een andere correctie; de gewone ruil-flow blijft de normale weg. */}
            {isAdmin && wisselDienst && (
              <div className="mt-6 border-t border-hairline pt-5 space-y-3">
                <MicroLabel>Dienstwissel (admin)</MicroLabel>
                {wisselNaAfwezigheid && (
                  <Card tone="accent" padding="none" className="px-3.5 py-2.5 text-body-sm font-medium text-slate-700">
                    {selected.driverName} staat op {selected.cell.label.toLowerCase()}, maar dienst{' '}
                    <span className="font-semibold tabular-nums">{wisselDienst}</span> staat nog op naam, zet hem hieronder over.
                  </Card>
                )}
                <p className="text-body-sm font-medium text-slate-500">
                  Zet dienst <span className="font-semibold text-slate-700 tabular-nums">{wisselDienst}</span> op {formatDateLong(selected.iso)} over van{' '}
                  <span className="font-semibold text-slate-700">{selected.driverName}</span> naar een andere chauffeur.
                  {!wisselNaAfwezigheid && ' Kies je iemand die die dag zelf rijdt, dan wisselen ze hun diensten 1-op-1.'}
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
                        maandplanning; een TA of andere code staat erbij.
                        Wie die dag zelf rijdt, staat er met zijn dienst bij
                        (1-op-1-wissel), behalve als de huidige chauffeur
                        afwezig is: die kan geen dienst terugnemen. */}
                    {rangschikKandidaten(
                      drivers.filter((d) => {
                        if (String(d.id) === selected.driverId) return false;
                        const c = cells[String(d.id)]?.[selected.iso];
                        return !wisselNaAfwezigheid || !c || (c.kind !== 'service' && !c.hiddenService);
                      }),
                      (d) => {
                        const c = cells[String(d.id)]?.[selected.iso];
                        return !c || (c.kind !== 'service' && !c.hiddenService);
                      },
                      werkdagenPerChauffeur,
                      selected.iso,
                    ).map((k) => {
                      const c = cells[String(k.user.id)]?.[selected.iso];
                      const code = c?.kind === 'service' ? `rijdt ${c.code}` : c && c.code.toLowerCase() !== 'vrij' ? c.code.toUpperCase() : '';
                      return (
                        <option key={k.user.id} value={String(k.user.id)}>{kandidaatLabel(k, !code)}{code ? ` · ${code}` : ''}</option>
                      );
                    })}
                  </Select>
                </Field>
                {wisselTerug && (
                  <Card tone="info" padding="none" className="px-3.5 py-2.5 text-body-sm font-medium text-slate-700">
                    {wisselNaarNaam} rijdt die dag dienst <span className="font-semibold tabular-nums">{wisselTerug}</span>. Die gaat in ruil naar {selected.driverName}: een 1-op-1-wissel.
                  </Card>
                )}
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
                  {isWisselen ? 'Doorvoeren…' : wisselTerug ? 'Diensten wisselen…' : 'Dienst overzetten…'}
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
      <Modal open={overzichtOpen} onClose={() => setOverzichtOpen(false)} maxWidth="2xl" className="flex max-h-overlay flex-col !overflow-hidden !p-0">
        <ModalHeader
          eyebrow="Maandoverzicht"
          title={`${MONTH_NAMES[monthIndex]} ${year}`}
          description={'Stand ná wissels, toewijzingen en afwezigheden, identiek aan het tabblad “maandoverzicht” in de Excel-export. Uren = som van de dienstsegmenten; diensten zonder tijden tellen alleen in de dagtelling.'}
          onClose={() => setOverzichtOpen(false)}
        />
        <div className="p-6 overflow-y-auto flex-1">
          {overzichtLaden ? (
            <div className="flex items-center gap-3 text-slate-500">
              <BrandSpinner size={16} />
              <span className="text-sm font-bold">Overzicht berekenen…</span>
            </div>
          ) : overzicht && (
            // TableShell: schuift in zijn kader als de modal smal is (telefoon);
            // de naamkolom is de rijkop, de totaalrij een rijkop "Totaal".
            <TableShell label={`Maandoverzicht ${MONTH_NAMES[monthIndex].toLowerCase()} ${year}`}>
              <Tabel className="text-xs">
                <thead>
                  <tr className="border-b border-hairline">
                    {OVERZICHT_KOLOMMEN.map(([kolom, label]) => (
                      // Eigen sorteerregel, via SortTh getoond: dezelfde kolom
                      // keert om, een nieuwe cijferkolom begint aflopend, de
                      // naam oplopend (zoals voorheen).
                      <SortTh
                        key={kolom}
                        kolom={kolom}
                        sort={overzichtSortTh}
                        align={kolom === 'naam' ? 'left' : 'right'}
                        dicht
                      >
                        {label}
                      </SortTh>
                    ))}
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
                      <tr key={r.driverId} className="border-b border-hairline-subtle last:border-b-0">
                        <Th scope="row" className="px-2 py-1.5 text-xs font-semibold text-slate-800">{r.naam}</Th>
                        <Td num className="px-2 py-1.5 text-xs">{r.diensten}</Td>
                        <Td num className="px-2 py-1.5 text-xs">{urenLabel(r.minuten)}</Td>
                        <Td num className="px-2 py-1.5 text-xs">{r.anderWerk}</Td>
                        <Td num className="px-2 py-1.5 text-xs">{r.ziek}</Td>
                        <Td num className="px-2 py-1.5 text-xs">{r.betaald}</Td>
                        <Td num className="px-2 py-1.5 text-xs">{r.vrij}</Td>
                        <Td num className="px-2 py-1.5 text-xs font-semibold">{r.dagen}</Td>
                        <Td nowrap className="px-2 py-1.5 text-xs text-slate-500">{r.overig.map(({ code, keren }) => `${code}×${keren}`).join(', ') || '—'}</Td>
                      </tr>
                    ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-hairline-strong">
                    <Th scope="row" className="px-2 py-2 text-xs font-bold text-slate-900">Totaal</Th>
                    <Td num className="px-2 py-2 text-xs font-bold text-slate-900">{overzicht.totaal.diensten}</Td>
                    <Td num className="px-2 py-2 text-xs font-bold text-slate-900">{urenLabel(overzicht.totaal.minuten)}</Td>
                    <Td num className="px-2 py-2 text-xs font-bold text-slate-900">{overzicht.totaal.anderWerk}</Td>
                    <Td num className="px-2 py-2 text-xs font-bold text-slate-900">{overzicht.totaal.ziek}</Td>
                    <Td num className="px-2 py-2 text-xs font-bold text-slate-900">{overzicht.totaal.betaald}</Td>
                    <Td num className="px-2 py-2 text-xs font-bold text-slate-900">{overzicht.totaal.vrij}</Td>
                    <Td num className="px-2 py-2 text-xs font-bold text-slate-900">{overzicht.totaal.dagen}</Td>
                    <Td className="px-2 py-2" />
                  </tr>
                </tfoot>
              </Tabel>
            </TableShell>
          )}
        </div>
      </Modal>

      <ConfirmationModal
        open={wisselBevestigen}
        onClose={() => setWisselBevestigen(false)}
        onConfirm={() => void uitvoerenWissel()}
        title="Dienstwissel doorvoeren?"
        message={selected && wisselDienst
          ? wisselTerug
            ? `Op ${formatDateLong(selected.iso)} gaat dienst ${wisselDienst} van ${selected.driverName} naar ${wisselNaarNaam}, en dienst ${wisselTerug} van ${wisselNaarNaam} naar ${selected.driverName}. Reden: ${wisselRedenTekst}. De planning wordt meteen bijgewerkt en beide chauffeurs krijgen een melding.`
            : `Dienst ${wisselDienst} op ${formatDateLong(selected.iso)} gaat van ${selected.driverName} naar ${wisselNaarNaam}. Reden: ${wisselRedenTekst}. De planning wordt meteen bijgewerkt en beide chauffeurs krijgen een melding.`
          : ''}
        confirmText="Doorvoeren"
        cancelText="Annuleren"
        variant="warning"
      />

      <ConfirmationModal
        open={terugdraaien}
        onClose={() => setTerugdraaien(false)}
        onConfirm={() => void uitvoerenTerugdraai()}
        title="Wissel terugdraaien?"
        message={selected
          ? selected.cell.swapAway
            // Vanaf de kant die de dienst afstond: de dienst komt hier terug.
            ? `De dienst die ${selected.driverName} op ${formatDateLong(selected.iso)} wegruilde, komt terug op naam van ${selected.driverName}. Beide chauffeurs krijgen een melding.`
            : `Dienst ${selected.cell.code} op ${formatDateLong(selected.iso)} gaat terug naar ${selected.cell.swapFrom || 'de oorspronkelijke chauffeur'}. Beide chauffeurs krijgen een melding.`
          : ''}
        confirmText="Terugdraaien"
        cancelText="Annuleren"
        variant="warning"
      />
    </PageShell>
  );
}
