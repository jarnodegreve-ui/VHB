import { useEffect, useMemo, useRef, useState } from 'react';
import { useVeldfouten, useVerlaatWaarschuwing, useVuil } from '../lib/formulier';
import { focusEersteFout } from '../components/Formulier';
import { onvolledigeRijen, rijSleutel } from '../lib/dekkingRijen';
import { meldSchrijffout } from '../lib/fouten';
import { CalendarPlus, ChevronDown, ChevronLeft, ChevronRight, Settings2, AlertTriangle, Check, X, UserCheck, UserX, Plus, ListChecks } from 'lucide-react';
import { useOptioneleAppData } from '../app/AppDataContext';
import { bulkUitvoeren, meldBulkResultaat } from '../lib/bulk';
import { adviesSleutel, haalBatchAdvies, vulVervangersVoor, type BatchAdvies } from '../lib/herverdeel';
import { kandidaatLabel, nietBeschikbaarUitMatrix, rangschikKandidaten, vrijOpDatum, werkdagenUitShifts } from '../lib/vervangers';
import { BrandSpinner } from '../components/BrandSpinner';
import { cn, notify } from '../lib/ui';
import { isoDate } from '../lib/datum';
import { Skeleton, SkeletonTile } from '../components/Skeleton';
import { ConfirmationModal, EmptyState, Foutkaart, ModalHeader, PageHeader, PageShell, VersheidRegel } from '../components/ui';
import { useZelfLadend } from '../lib/zelfLadend';
import { apiFetch } from '../lib/api';
import { Badge, Button, FilterChip, IconButton, MicroLabel } from '../components/primitives';
import { Tabel, TableShell, Td, Th } from '../components/TabelBasis';
import { StickyThead } from '../components/Table';
import { Uitklap, uitklapChevron } from '../components/Uitklap';
import { Card, CardHeader } from '../components/Card';
import { DateInput, Input, Select } from '../components/Field';
import { Modal } from '../components/Modal';
import { fetchCoverageAdvies, kandidaatMeta, segmentenLabel, type CoverageAdvies } from '../lib/advisor';
import { formatDateHuman, formatShortDay, MONTH_NAMES } from '../lib/format';
import { Zijvak, ZijvakLayout, ZijvakRij } from '../components/Zijvak';
import {
  fetchCoverageConfig,
  fetchCoverageGaps,
  fetchExpectationCheck,
  fetchExpectationVoorstel,
  saveCoverageConfig,
  type CoverageConfig,
  type CoverageDayType,
  type CoverageOverride,
  type CoverageWeekdayPeriod,
  type DayGap,
} from '../lib/coverage';
import { normalizeCode, type DayTypeBron, type VerwachtingAfwijking, type VerwachtingVoorstel } from '../../shared/coverageGaps';
import { VerwachtingAfwijkingLijst } from '../components/planningSignalen';
import { bouwKalenderUitzonderingen } from '../lib/schoolkalender';
import { useRouteParam } from '../app/router';

/** Lokale rijsleutel voor de bewerkbare lijsten (nooit opgeslagen). */
let sleutelTeller = 0;
const sleutel = () => ++sleutelTeller;

/** Maand in de URL (`/openstaande-diensten/2026-10`) — spiegel van `viewMonth`;
 *  een ongeldige waarde wordt genegeerd. */
const MAAND_PARAM = /^\d{4}-(0[1-9]|1[0-2])$/;
const maandUitParam = (p: string | null): Date | null =>
  p && MAAND_PARAM.test(p) ? new Date(Number(p.slice(0, 4)), Number(p.slice(5, 7)) - 1, 1) : null;
const maandNaarParam = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;


// Weergave-volgorde maandag-eerst; dow = JS getUTCDay (0=zondag..6=zaterdag).
const WEEKDAY_ORDER: { dow: number; label: string }[] = [
  { dow: 1, label: 'Maandag' },
  { dow: 2, label: 'Dinsdag' },
  { dow: 3, label: 'Woensdag' },
  { dow: 4, label: 'Donderdag' },
  { dow: 5, label: 'Vrijdag' },
  { dow: 6, label: 'Zaterdag' },
  { dow: 0, label: 'Zondag' },
];

/**
 * Openstaande diensten — planner/admin: welke verwachte diensten zijn op een
 * dag niet ingevuld? De planner beheert zelf de dag-types + hun verwachte
 * diensten, welk dag-type elke weekdag standaard is, en uitzonderingen
 * (datumreeksen die afwijken, bv. schoolvakantie of feestdag).
 */
export function CoverageView() {
  const [maandParam, zetMaandParam] = useRouteParam(0);
  const [viewMonth, setViewMonth] = useState(() => {
    const n = new Date();
    return maandUitParam(maandParam) ?? new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [config, setConfig] = useState<CoverageConfig | null>(null);
  // Bewerkbare config-state.
  // Elke lokale rij draagt een sleutel `_k` (B5, ronde 5): met `key={i}`
  // nam kaart 3 na het verwijderen van kaart 2 diens DOM (focus, open
  // datumkiezer) over. De sleutel blijft lokaal; handleSave bouwt de
  // payload veld voor veld op en stuurt hem nooit mee.
  const [dayTypes, setDayTypes] = useState<(CoverageDayType & { _k: number })[]>([]);
  const [weekdays, setWeekdays] = useState<string[]>(['', '', '', '', '', '', '']);
  const [weekdayPeriods, setWeekdayPeriods] = useState<(CoverageWeekdayPeriod & { _k: number })[]>([]);
  const [overrides, setOverrides] = useState<(CoverageOverride & { _k: number })[]>([]);
  const [gaps, setGaps] = useState<DayGap[]>([]);
  // Verwachtingen-vs-praktijk voor de getoonde maand: structurele afwijkingen
  // tussen de dag-type-lijsten en wat er echt gereden wordt (fantoomgaten).
  const [expCheck, setExpCheck] = useState<VerwachtingAfwijking[]>([]);
  const [saving, setSaving] = useState(false);
  // Onvolledige rijen blokkeren Opslaan (tranche 3A): één fout per rij,
  // sleutel = rijSleutel.<soort>(_k), zie src/lib/dekkingRijen.ts.
  const rijFouten = useVeldfouten();
  const instellingenRef = useRef<HTMLElement | null>(null);
  const [focusFout, setFocusFout] = useState(0);
  const [showConfig, setShowConfig] = useState(false);
  const [onlyGaps, setOnlyGaps] = useState(true);
  // Klik op een ontbrekende dienst → advies: wie is vrij én bij wie past dit?
  const [pick, setPick] = useState<{ date: string; code: string } | null>(null);
  // Dag-type-badge aangetikt → herkomst-uitleg inline onder de badge. Een
  // title-tooltip alleen bestaat niet op touch, en dit scherm wordt juist op
  // iPhone/iPad gebruikt (controle-ronde 20-08).
  const [bronOpenDate, setBronOpenDate] = useState<string | null>(null);
  const [advies, setAdvies] = useState<CoverageAdvies | null>(null);
  const [adviesError, setAdviesError] = useState('');
  // Toewijzen van het gat aan een vrije chauffeur (POST /api/planning/assign-service).
  const [assignBusy, setAssignBusy] = useState<string | null>(null);
  // redenen ≠ leeg = bewust overrulen van het advies → waarschuwing in de bevestiging.
  const [assignConfirm, setAssignConfirm] = useState<{ id: string; name: string; redenen: string[] } | null>(null);
  const [pickLoading, setPickLoading] = useState(false);

  // --- Alle gaten van één dag in één keer (punt 16) ------------------------
  // Zelfde wizard als "Verdeel alles" in Beheer › Ziekte: het batch-advies
  // vult per gat de beste passende kandidaat voor (dag-bewust, zodat twee
  // gaten niet dezelfde chauffeur krijgen), de planner corrigeert per rij, en
  // één bevestiging voert alles na elkaar door met fouten per rij
  // (src/lib/herverdeel.ts + src/lib/bulk.ts). De chauffeurslijst voor de
  // keuzelijst komt uit de datalaag; zonder context (los gerenderd) valt hij
  // terug op de passende kandidaten uit het advies.
  const appData = useOptioneleAppData();
  const chauffeurs = useMemo(() => (appData?.users ?? []).filter((u) => u.role === 'chauffeur' && u.isActive !== false), [appData?.users]);
  const alleShifts = appData?.shifts ?? [];
  // De matrix laadt ná de poort (useAppData); zonder context (tests) = klaar.
  const planningMatrixGeladen = appData?.planningMatrixGeladen ?? true;
  const werkdagen = useMemo(() => werkdagenUitShifts(alleShifts), [alleShifts]);
  const [batch, setBatch] = useState<{ date: string; codes: string[] } | null>(null);
  const [batchAdvies, setBatchAdvies] = useState<Record<string, BatchAdvies>>({});
  const [batchLaden, setBatchLaden] = useState(false);
  const [batchKeuze, setBatchKeuze] = useState<Record<string, string>>({});
  const [batchBezig, setBatchBezig] = useState(false);
  const [batchConfirm, setBatchConfirm] = useState(false);
  const [batchFouten, setBatchFouten] = useState<Record<string, string>>({});
  const [batchKlaar, setBatchKlaar] = useState<Record<string, string>>({});
  const openBatch = async (d: DayGap) => {
    const gaten = d.missing.map((code) => ({ date: d.date, code }));
    setBatch({ date: d.date, codes: d.missing });
    setBatchAdvies({}); setBatchKeuze({}); setBatchFouten({}); setBatchKlaar({});
    setBatchLaden(true);
    try {
      const per = await haalBatchAdvies(gaten);
      setBatchAdvies(per);
      setBatchKeuze((cur) => vulVervangersVoor(gaten, {
        sleutelVan: (g) => adviesSleutel(g.date, g.code),
        dagVan: (g) => g.date,
        adviesVan: (g) => per[adviesSleutel(g.date, g.code)],
        huidig: cur,
      }));
    } catch (e) {
      meldSchrijffout('Kandidaten voorstellen', e, () => void openBatch(d));
    } finally {
      setBatchLaden(false);
    }
  };
  const naamVanChauffeur = (id: string) =>
    chauffeurs.find((u) => String(u.id) === String(id))?.name
    ?? Object.values(batchAdvies).flatMap((a) => a.passend).find((k) => String(k.id) === String(id))?.name
    ?? 'de chauffeur';
  const optiesVoor = (date: string, code: string): Array<{ id: string; label: string }> => {
    if (chauffeurs.length > 0) {
      return rangschikKandidaten(chauffeurs, vrijOpDatum(alleShifts, date, nietBeschikbaarUitMatrix(appData?.planningMatrixRows ?? [], chauffeurs, date)), werkdagen, date)
        .map((k) => ({ id: String(k.user.id), label: kandidaatLabel(k) }));
    }
    return (batchAdvies[adviesSleutel(date, code)]?.passend ?? []).map((k) => ({ id: String(k.id), label: k.name }));
  };
  const batchTeDoen = batch
    ? batch.codes.filter((code) => !batchKlaar[adviesSleutel(batch.date, code)] && batchKeuze[adviesSleutel(batch.date, code)])
    : [];
  const voerBatchUit = async () => {
    if (!batch || batchBezig || batchTeDoen.length === 0) return;
    const { date } = batch;
    setBatchBezig(true);
    const resultaat = await bulkUitvoeren(batchTeDoen, async (code) => {
      const sleutel = adviesSleutel(date, code);
      const driverId = batchKeuze[sleutel];
      let res: Response;
      try {
        res = await apiFetch('/api/planning/assign-service', {
          method: 'POST',
          body: JSON.stringify({ date, serviceNumber: code, driverId }),
        });
      } catch {
        return { fout: 'Netwerkfout, deze dienst is niet toegewezen.' };
      }
      const body = await res.json().catch(() => ({} as { error?: string }));
      if (!res.ok) return { fout: body.error || 'Toewijzen is mislukt.' };
      setBatchKlaar((cur) => ({ ...cur, [sleutel]: naamVanChauffeur(driverId) }));
    });
    setBatchBezig(false);
    setBatchFouten(Object.fromEntries(resultaat.mislukt.map((m) => [adviesSleutel(date, m.item), m.fout])));
    meldBulkResultaat(notify, resultaat, {
      item: ['dienst', 'diensten'],
      gedaan: 'toegewezen',
      rest: (f) => `, ${f.length} mislukt, zie de rijen`,
    });
    if (resultaat.gelukt.length > 0) await refetchGaps();
    // Alles gelukt: de gaten zijn weg, het venster mag dicht; bij fouten
    // blijft het open met de melding per rij.
    if (resultaat.mislukt.length === 0) setBatch(null);
  };

  const year = viewMonth.getFullYear();
  const monthIndex = viewMonth.getMonth();
  const from = `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const to = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  // Maand → URL (replace, geen extra history-entry); de state blijft de bron.
  // De huidige maand geeft een schone URL zonder parameter.
  const monthParam = maandNaarParam(viewMonth);
  useEffect(() => {
    const gewenst = monthParam === maandNaarParam(new Date()) ? null : monthParam;
    if ((maandParam ?? null) !== gewenst) zetMaandParam(gewenst);
  }, [monthParam, maandParam, zetMaandParam]);

  // Instellingen één keer (de bewerkbare kopie leeft in state); pas als dat
  // lukte hoeft het niet meer, anders probeert de volgende laad het opnieuw.
  const configGeladen = useRef(false);
  const laadConfig = async () => {
    const c = await fetchCoverageConfig();
    setConfig(c);
    setDayTypes((c.dayTypes || []).map((dt) => ({ _k: sleutel(), name: dt.name, services: [...(dt.services || [])] })));
    const w = Array.isArray(c.weekdays) && c.weekdays.length === 7 ? c.weekdays : ['', '', '', '', '', '', ''];
    setWeekdays([...w]);
    setWeekdayPeriods((c.weekdayPeriods || []).map((p) => ({ _k: sleutel(), vanaf: p.vanaf, weekdays: [...(p.weekdays || [])] })));
    setOverrides((c.overrides || []).map((o) => ({ ...o, _k: sleutel() })));
    configGeladen.current = true;
  };

  // Versieteller tegen kruisende responses: zowel de maandwissel als een
  // refetch (na toewijzen/opslaan) bumpen hem, en alleen het recentste
  // antwoord mag de state zetten — anders kon een traag antwoord van de
  // vorige maand over de nieuwe heen schrijven. Een mislukte gatenberekening
  // werpt; de hook eronder maakt daar de Foutkaart van.
  const gapsVersieRef = useRef(0);
  const laadGaps = async (van: string, tot: string) => {
    const versie = ++gapsVersieRef.current;
    const alsActueel = (fn: () => void) => { if (versie === gapsVersieRef.current) fn(); };
    await Promise.all([
      fetchCoverageGaps(van, tot)
        .then((res) => alsActueel(() => setGaps(Array.isArray(res?.days) ? res.days : []))),
      // Best-effort naast de gaten: een mislukte check mag het scherm niet raken.
      fetchExpectationCheck(van, tot)
        .then((res) => alsActueel(() => setExpCheck(Array.isArray(res?.afwijkingen) ? res.afwijkingen : [])))
        .catch(() => alsActueel(() => setExpCheck([]))),
    ]);
  };

  // Laad, fout, focus-refresh en versheid via de gedeelde hook (punt 17).
  const zl = useZelfLadend(async () => {
    if (!configGeladen.current) await laadConfig();
    await laadGaps(from, to);
  }, { deps: [from, to], boodschap: (e) => (e instanceof Error && e.message ? e.message : 'Kon de dekking niet berekenen.') });

  useEffect(() => {
    // Voorstel hoort bij de getoonde maand — bij bladeren resetten, anders
    // belooft de knop september terwijl er augustus-cijfers staan.
    setVoorstellen(null);
    return () => { gapsVersieRef.current += 1; };
  }, [from, to]);

  // Na een eigen schrijfactie: stil (geen skelet over de gatenlijst).
  const refetchGaps = () => zl.ververs();

  // Laatste matrix-import (voor het zijvak) — best-effort, zelfde bron als
  // Beheer planning; zonder antwoord gewoon een streepje.
  const [laatsteImport, setLaatsteImport] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiFetch('/api/planning-matrix/changes-since-import');
        if (!res.ok) return;
        const data = await res.json();
        const at = data && typeof data === 'object' ? data.lastImport?.createdAt : null;
        if (!cancelled && typeof at === 'string') setLaatsteImport(at);
      } catch { /* stil: geen import-info is geen fout */ }
    })();
    return () => { cancelled = true; };
  }, []);

  /** Wijs het gekozen gat toe aan een vrije chauffeur — de matrix én de
   *  planning worden server-side bijgewerkt, daarna verdwijnt het gat hier. */
  const wijsToe = async (kandidaat: { id: string; name: string }) => {
    if (!pick || assignBusy) return;
    setAssignBusy(kandidaat.id);
    try {
      const res = await apiFetch('/api/planning/assign-service', {
        method: 'POST',
        body: JSON.stringify({ date: pick.date, serviceNumber: pick.code, driverId: kandidaat.id }),
      });
      const body = await res.json().catch(() => ({} as any));
      if (!res.ok) { meldSchrijffout('Toewijzen', { status: res.status, message: body.error }); return; }
      notify(`Dienst ${pick.code} toegewezen aan ${kandidaat.name}, de chauffeur krijgt een melding.`, 'success');
      setPick(null);
      await refetchGaps();
    } catch (err) {
      meldSchrijffout('Toewijzen', err);
    } finally {
      setAssignBusy(null);
    }
  };

  // Advies ophalen voor het gekozen gat: vrije chauffeurs, beoordeeld op
  // rusttijd (≥ 8u t.o.v. de aansluitende werkdagen) en de 6-dagenregel,
  // gesorteerd op wie dit jaar het minst inviel.
  useEffect(() => {
    if (!pick) { setAdvies(null); setAdviesError(''); return; }
    let cancelled = false;
    setPickLoading(true);
    setAdvies(null);
    setAdviesError('');
    fetchCoverageAdvies(pick.date, pick.code)
      .then((res) => { if (!cancelled) setAdvies(res); })
      .catch((e) => { if (!cancelled) setAdviesError(e?.message || 'Kon het advies niet laden.'); })
      .finally(() => { if (!cancelled) setPickLoading(false); });
    return () => { cancelled = true; };
  }, [pick]);

  // --- Dag-types beheren ---
  const dayTypeNames = useMemo(
    () => Array.from(new Set(dayTypes.map((d) => d.name.trim()).filter(Boolean))),
    [dayTypes],
  );

  // Nieuw dag-type bovenaan toevoegen (anders verdwijnt het onder de lange
  // chips-lijsten en lijkt "toevoegen" niets te doen) + naamveld focussen.
  const firstNameRef = useRef<HTMLInputElement | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  // Uitklap-status per dag-type-kaart (vraag Jarno 20-08: met 60+ dienst-
  // chips per kaart werd het paneel onoverzichtelijk). Standaard dicht; een
  // nieuwe kaart opent meteen, anders valt er niets aan te vinken.
  const [openDayTypes, setOpenDayTypes] = useState<Set<number>>(new Set());
  const toggleDayTypeOpen = (i: number) =>
    setOpenDayTypes((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });

  const addDayType = () => {
    setDayTypes((prev) => [{ _k: sleutel(), name: '', services: [] }, ...prev]);
    // Nieuwe kaart komt vooraan: bestaande open indexen schuiven één op.
    setOpenDayTypes((prev) => new Set([0, ...Array.from(prev, (x) => x + 1)]));
    setFocusTick((t) => t + 1);
  };
  useEffect(() => {
    if (focusTick === 0) return;
    firstNameRef.current?.focus();
    firstNameRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [focusTick]);

  // Hernoemen: verwijzingen in weekdagen + uitzonderingen mee-hernoemen.
  // Per toetsaanslag alléén bij niet-lege namen (oud patroon hernoemde naar
  // '' zodra het veld leeggemaakt werd → mappings definitief kwijt bij
  // leegmaken-en-hertypen). Het anker bij focus + de remap bij blur dekt
  // dat hertyp-scenario af.
  const nameEditAnchorRef = useRef<string | null>(null);
  const remapDayTypeName = (old: string, neu: string) => {
    if (!old || !neu || old === neu) return;
    setWeekdays((prev) => prev.map((x) => (x === old ? neu : x)));
    setOverrides((prev) => prev.map((x) => (x.dayType === old ? { ...x, dayType: neu } : x)));
  };
  const wisDagtypeFout = (i: number) => { const k = dayTypes[i]?._k; if (k !== undefined) rijFouten.wisVeld(rijSleutel.dagtype(k)); };
  const updateDayTypeName = (i: number, name: string) => {
    wisDagtypeFout(i);
    const old = (dayTypes[i]?.name ?? '').trim();
    const neu = name.trim();
    setDayTypes((prev) => prev.map((dt, idx) => (idx === i ? { ...dt, name } : dt)));
    remapDayTypeName(old, neu);
  };
  const beginDayTypeNameEdit = (i: number) => {
    nameEditAnchorRef.current = (dayTypes[i]?.name ?? '').trim();
  };
  const finishDayTypeNameEdit = (i: number) => {
    const anchor = nameEditAnchorRef.current;
    nameEditAnchorRef.current = null;
    if (anchor) remapDayTypeName(anchor, (dayTypes[i]?.name ?? '').trim());
  };

  const toggleService = (i: number, svc: string) => {
    wisDagtypeFout(i);
    setDayTypes((prev) => prev.map((dt, idx) => {
      if (idx !== i) return dt;
      const set = new Set(dt.services);
      if (set.has(svc)) set.delete(svc); else set.add(svc);
      return { ...dt, services: Array.from(set) };
    }));
  };

  const removeDayType = (i: number) => {
    const removed = (dayTypes[i]?.name ?? '').trim();
    setDayTypes((prev) => prev.filter((_, idx) => idx !== i));
    setOpenDayTypes((prev) => new Set(Array.from(prev).filter((x) => x !== i).map((x) => (x > i ? x - 1 : x))));
    if (removed) {
      setWeekdays((prev) => prev.map((x) => (x === removed ? '' : x)));
      setOverrides((prev) => prev.filter((o) => o.dayType !== removed));
    }
  };

  const setWeekday = (dow: number, name: string) =>
    setWeekdays((prev) => prev.map((x, idx) => (idx === dow ? name : x)));

  // --- Weekdag-periodes (vanaf een datum geldt een andere toewijzing) ---
  const addWeekdayPeriod = () =>
    setWeekdayPeriods((prev) => [...prev, { _k: sleutel(), vanaf: '', weekdays: ['', '', '', '', '', '', ''] }]);
  const wisPeriodeFout = (i: number) => { const k = weekdayPeriods[i]?._k; if (k !== undefined) rijFouten.wisVeld(rijSleutel.periode(k)); };
  const setPeriodVanaf = (i: number, vanaf: string) => {
    wisPeriodeFout(i);
    setWeekdayPeriods((prev) => prev.map((p, idx) => (idx === i ? { ...p, vanaf } : p)));
  };
  const setPeriodWeekday = (i: number, dow: number, name: string) => {
    wisPeriodeFout(i);
    setWeekdayPeriods((prev) => prev.map((p, idx) => (idx === i ? { ...p, weekdays: p.weekdays.map((x, d) => (d === dow ? name : x)) } : p)));
  };
  const removeWeekdayPeriod = (i: number) =>
    setWeekdayPeriods((prev) => prev.filter((_, idx) => idx !== i));

  // --- Kalender-voorzet: feestdagen + schoolvakanties 2026-2027 ------------
  // Zonder dit tikte de planner elke vakantie en feestdag handmatig in als
  // uitzondering — één vergeten krokusvakantie = wéér fantoomgaten. De
  // dag-type-koppeling is instelbaar; standaard fuzzy op de bestaande namen.
  const [kalFeest, setKalFeest] = useState('');
  const [kalMaDiWo, setKalMaDiWo] = useState('');
  const [kalDo, setKalDo] = useState('');
  const [kalVr, setKalVr] = useState('');
  // Standaard dicht, zoals de dag-type-kaarten (#385): het Instellen-paneel
  // moet scanbaar blijven — dit is een af-en-toe-actie, geen dagelijks werk.
  const [kalenderOpen, setKalenderOpen] = useState(false);
  // Validatiefout van de kalender-voorzet, inline bij de keuzes (fase C15)
  // — voorheen een toast die verdween voor je las wat er mis was.
  const [kalFout, setKalFout] = useState('');
  useEffect(() => {
    if (!config) return;
    const namen = (config.dayTypes || []).map((d) => d.name);
    const vind = (test: (n: string) => boolean) => namen.find((n) => test(n.toLowerCase())) ?? '';
    setKalFeest((cur) => cur || vind((n) => n.includes('zondag')));
    setKalMaDiWo((cur) => cur || vind((n) => n.includes('ma/di/wo')));
    setKalDo((cur) => cur || vind((n) => n.includes('vakantie') && n.includes('donderdag')));
    setKalVr((cur) => cur || vind((n) => n.includes('vakantie') && n.includes('vrijdag')));
  }, [config]);
  const voegKalenderToe = () => {
    // Lokale kalenderdag, niet de UTC-dag: tussen 00:00 en 02:00 was
    // "vandaag" nog gisteren en werd een net verlopen feestdag toch voorgezet
    // terwijl de lijst eronder hem al als verlopen toonde (controle-ronde
    // 27-08, bevinding 27). Zelfde bron als overrideVandaag hieronder.
    const vandaag = isoDate(new Date());
    const { uitzonderingen, overgeslagen } = bouwKalenderUitzonderingen({
      feestdagType: kalFeest || undefined,
      vakantieTypes: { maDiWo: kalMaDiWo || undefined, donderdag: kalDo || undefined, vrijdag: kalVr || undefined },
      bestaande: overrides,
      vanafDatum: vandaag,
    });
    if (uitzonderingen.length === 0) {
      setKalFout(overgeslagen > 0 ? 'Alles uit de kalender staat al in de lijst.' : 'Kies eerst bij minstens één groep een dag-type.');
      return;
    }
    setKalFout('');
    setOverrides((prev) => [...prev, ...uitzonderingen.map((u) => ({ ...u, _k: sleutel() }))]);
    notify(`${uitzonderingen.length} uitzondering${uitzonderingen.length === 1 ? '' : 'en'} voorgezet${overgeslagen > 0 ? ` (${overgeslagen} al gedekt)` : ''}, controleer de lijst en klik op Opslaan.`, 'success');
  };

  // --- Uitzonderingen ---
  const addOverride = () => setOverrides((prev) => [...prev, { _k: sleutel(), from: '', to: '', dayType: '' }]);
  const updateOverride = (i: number, field: keyof CoverageOverride, value: string) => {
    const k = overrides[i]?._k;
    if (k !== undefined) rijFouten.wisVeld(rijSleutel.uitzondering(k));
    setOverrides((prev) => prev.map((o, idx) => (idx === i ? { ...o, [field]: value } : o)));
  };
  const removeOverride = (i: number) => setOverrides((prev) => prev.filter((_, idx) => idx !== i));

  // Gesorteerd + verlopen gemarkeerd (nr. 5): de kalender-voorzet kan er
  // tientallen injecteren — chronologisch lezen en oude opruimen moet licht
  // blijven. De originele index reist mee voor de update/verwijder-handlers.
  const overrideVandaag = isoDate(new Date());
  const gesorteerdeOverrides = useMemo(
    () => overrides
      .map((o, i) => ({ o, i, verlopen: Boolean(o.to && o.to < overrideVandaag) }))
      .sort((a, b) => (a.o.from || '9999-99-99').localeCompare(b.o.from || '9999-99-99')),
    [overrides, overrideVandaag],
  );
  const verlopenAantal = gesorteerdeOverrides.filter((x) => x.verlopen).length;
  const ruimVerlopenOp = () => setOverrides((prev) => prev.filter((o) => !(o.to && o.to < overrideVandaag)));

  // Inklap-status van de instellen-secties (nr. 4): het paneel moet één
  // scanbaar lijstje zijn — zelfde patroon als de kalender-sectie.
  const [weekdagenOpen, setWeekdagenOpen] = useState(false);
  const [uitzonderingenOpen, setUitzonderingenOpen] = useState(false);

  // Lijstenvoorstel uit de praktijk (nr. 2): wat rijdt er deze maand écht,
  // per dag-type — na een dienstregelingswissel is dat de kortste weg naar
  // kloppende lijsten.
  const [voorstelOpen, setVoorstelOpen] = useState(false);
  const [voorstelLaden, setVoorstelLaden] = useState(false);
  const [voorstellen, setVoorstellen] = useState<VerwachtingVoorstel[] | null>(null);
  const haalVoorstelOp = async () => {
    setVoorstelLaden(true);
    try {
      const res = await fetchExpectationVoorstel(from, to);
      setVoorstellen(Array.isArray(res?.voorstellen) ? res.voorstellen : []);
    } catch (e) {
      meldSchrijffout('Voorstel berekenen', e, () => void haalVoorstelOp());
    } finally {
      setVoorstelLaden(false);
    }
  };
  const pasVoorstelToe = (v: VerwachtingVoorstel) => {
    const codes = v.codes.map((c) => c.code);
    // Case-ongevoelig matchen: "Zaterdag" uit de Excel-kolom mag geen
    // duplicaat naast een geconfigureerd "zaterdag" aanmaken — de bestaande
    // naam (waar de weekdag-toewijzing naar wijst) blijft leidend.
    const zelfdeNaam = (naam: string) => naam.trim().toLowerCase() === v.dayType.trim().toLowerCase();
    setDayTypes((prev) => {
      const bestaat = prev.some((dt) => zelfdeNaam(dt.name));
      return bestaat
        ? prev.map((dt) => (zelfdeNaam(dt.name) ? { ...dt, services: codes } : dt))
        : [...prev, { _k: sleutel(), name: v.dayType, services: codes }];
    });
    notify(`Lijst voor “${v.dayType}” klaargezet (${codes.length} diensten), controleer en klik op Opslaan.`, 'success');
  };

  // Onbewaarde instellingen (tranche 3A): vergeleken met wat er geladen of
  // laatst bewaard is, zonder de lokale rijsleutels. De momentopname valt
  // zodra de config binnen is; tabblad sluiten of herladen waarschuwt dan.
  const instellingenWaarden = {
    dayTypes: dayTypes.map(({ name, services }) => ({ name, services })),
    weekdays,
    weekdayPeriods: weekdayPeriods.map(({ vanaf, weekdays: w }) => ({ vanaf, weekdays: w })),
    overrides: overrides.map(({ from: van, to: tot, dayType }) => ({ from: van, to: tot, dayType })),
  };
  const { vuil: instellingenVuil, markeerSchoon: instellingenSchoon } = useVuil(instellingenWaarden, config !== null);
  useVerlaatWaarschuwing(instellingenVuil);

  // Na een geblokkeerde save: focus op het eerste ontbrekende veld (de
  // velden die ontbreken dragen aria-invalid; geen data-fout op de rij, dan
  // zou de uitklapknop vooraan de focus krijgen). De knop staat buiten elk
  // formulier, dus hier zelf; een tik later, zodat een net opengeklapte
  // sectie niet meer inert is.
  useEffect(() => {
    if (focusFout === 0) return;
    const t = window.setTimeout(() => focusEersteFout(instellingenRef.current), 0);
    return () => window.clearTimeout(t);
  }, [focusFout]);

  const handleSave = async () => {
    if (saving) return;
    // Een half ingevulde rij blokkeert (tranche 3A): vroeger viel ze stil
    // weg. Een volledig lege rij valt nog altijd weg, hieronder.
    const onvolledig = onvolledigeRijen({ dayTypes, weekdayPeriods, overrides });
    if (Object.keys(onvolledig).length > 0) {
      rijFouten.zet(onvolledig);
      const sleutels = Object.keys(onvolledig);
      if (sleutels.some((k) => k.startsWith('periode-'))) setWeekdagenOpen(true);
      if (sleutels.some((k) => k.startsWith('uitzondering-'))) setUitzonderingenOpen(true);
      setFocusFout((t) => t + 1);
      return;
    }
    rijFouten.wis();
    setSaving(true);
    try {
      // Dag-types: lege rijen weg (deels ingevuld is hierboven al
      // tegengehouden), dedupe (eerste wint).
      const seen = new Set<string>();
      const cleanDayTypes: CoverageDayType[] = [];
      for (const dt of dayTypes) {
        const name = dt.name.trim();
        if (!name || seen.has(name)) continue;
        seen.add(name);
        cleanDayTypes.push({ name, services: dt.services });
      }
      const validNames = new Set(cleanDayTypes.map((d) => d.name));
      const cleanWeekdays = weekdays.map((w) => (validNames.has(w) ? w : ''));
      const cleanOverrides = overrides
        .filter((o) => o.from && o.to && validNames.has(o.dayType))
        .map((o) => ({ from: o.from, to: o.to, dayType: o.dayType }));
      const cleanPeriods = weekdayPeriods
        .filter((p) => /^\d{4}-\d{2}-\d{2}$/.test(p.vanaf))
        .map((p) => ({ vanaf: p.vanaf, weekdays: p.weekdays.map((w) => (validNames.has(w) ? w : '')) }));
      await saveCoverageConfig({ dayTypes: cleanDayTypes, weekdays: cleanWeekdays, weekdayPeriods: cleanPeriods, overrides: cleanOverrides });
      instellingenSchoon();
      await refetchGaps();
      // Ook de app-brede dekking (dashboard, topbar-badge) volgt de nieuwe
      // verwachtingen, niet alleen dit scherm.
      void appData?.refreshCoverageGaps();
    } catch (e: unknown) {
      // Schrijffout = toast met vervolgstap; de kaart is voor laadfouten.
      // Opnieuw is veilig: de hele config gaat met één PUT.
      meldSchrijffout('Opslaan', e, () => void handleSave());
    } finally {
      setSaving(false);
    }
  };

  const dayLabel = formatShortDay; // gedeelde compacte dag-vorm (datum-consolidatie)

  const totalMissing = useMemo(() => gaps.reduce((sum, d) => sum + d.missing.length, 0), [gaps]);
  // Oorzaak-uitsplitsing voor de teller: een gat mét uitval-info komt door een
  // gemelde afwezigheid (één zieke collega kan de hele teller kleuren); een
  // kaal gat heeft écht nog geen chauffeur. Dat onderscheid vertelt in één
  // regel of het structureel is of niet.
  const uitvalSplit = useMemo(() => {
    let doorAfwezigheid = 0;
    const namen = new Set<string>();
    for (const d of gaps) {
      for (const svc of d.missing) {
        const info = d.uitval?.[normalizeCode(svc)];
        if (info) {
          doorAfwezigheid += 1;
          namen.add(info.name);
        }
      }
    }
    return { doorAfwezigheid, zonderChauffeur: totalMissing - doorAfwezigheid, namen: [...namen] };
  }, [gaps, totalMissing]);
  const anyExpectations = useMemo(() => dayTypes.some((dt) => dt.services.length > 0), [dayTypes]);
  const visibleDays = onlyGaps ? gaps.filter((d) => d.missing.length > 0) : gaps;
  const dagenMetGaten = useMemo(() => gaps.filter((d) => d.missing.length > 0).length, [gaps]);

  // Zijvak "Deze maand": de cijfers die je anders uit de lijst moet tellen,
  // plus wat er ingesteld is en wanneer de planning voor het laatst geladen
  // is (afwerkingsronde 04-09).
  const zijvak = (
    <Zijvak
      titel="Deze maand"
      voet={config && !anyExpectations ? (
        <Button variant="secondary" size="sm" icon={<Settings2 size={14} />} onClick={() => setShowConfig(true)}>
          Instellen
        </Button>
      ) : undefined}
    >
      <ZijvakRij label="Dagen met gaten" waarde={zl.laden ? '…' : dagenMetGaten} mono />
      <ZijvakRij label="Open diensten" waarde={zl.laden ? '…' : totalMissing} mono />
      <ZijvakRij
        label="Dag-types"
        waarde={!config ? '…' : dayTypeNames.length === 0 ? 'nog niet ingesteld' : dayTypeNames.length}
        mono={!!config && dayTypeNames.length > 0}
      />
      <ZijvakRij label="Laatste import" waarde={laatsteImport ? formatDateHuman(laatsteImport) : '—'} mono={!!laatsteImport} />
    </Zijvak>
  );

  /** Uitleg bij het dag-type van een dag: waar komt het vandaan? */
  const bronUitleg = (bron?: DayTypeBron): string | undefined => {
    if (!bron) return undefined;
    switch (bron.soort) {
      case 'excel': return 'Dag-type komt uit de Excel-import (kolom B) en gaat vóór alle instellingen.';
      case 'uitzondering': return `Via de uitzondering ${bron.from} t/m ${bron.to} (Instellen → Uitzonderingen).`;
      case 'periode': return `Via de weekdagperiode vanaf ${bron.vanaf} (Instellen → Standaard per weekdag).`;
      case 'basis': return 'Via de basis-weekdagtoewijzing (Instellen → Standaard per weekdag).';
      default: return undefined;
    }
  };

  // Bouwstenen van één dag, gedeeld door de tabel (desktop) en de lijst
  // (telefoon), zodat beide precies hetzelfde tonen en doen.

  /** Dag-type als badge; met een bekende herkomst klapt een tik de uitleg open. */
  const dagTypeVan = (d: DayGap) => (bronUitleg(d.bron) ? (
    <>
      {/* Herkomst van het dag-type ("waarom is dit di/vrij?"):
          tik/klik op de badge klapt de uitleg inline uit — een
          title alleen zou op touch onzichtbaar zijn. -m-2/p-2 =
          hit-slop zodat het doel raakbaar blijft zonder de rij
          te laten groeien. */}
      {/* rauw: badge-als-knop met hit-slop (-m-2/p-2), geen knopvorm */}
      <button
        type="button"
        onClick={() => setBronOpenDate((cur) => (cur === d.date ? null : d.date))}
        aria-expanded={bronOpenDate === d.date}
        aria-label={`Waarom is ${dayLabel(d.date)} een ${d.dayType || 'dag zonder type'}?`}
        title={bronUitleg(d.bron)}
        className="ios-pressable -m-2 rounded-xl p-2 text-left"
      >
        <Badge tone={d.dayType ? 'oker' : 'slate'} className="capitalize">{d.dayType || '—'}</Badge>
      </button>
      {bronOpenDate === d.date && (
        <p className="mt-1.5 max-w-[15rem] text-xs font-medium leading-snug text-slate-500">{bronUitleg(d.bron)}</p>
      )}
    </>
  ) : (
    <Badge tone={d.dayType ? 'oker' : 'slate'} className="capitalize">{d.dayType || '—'}</Badge>
  ));

  /** Gedekt = stille chip; een gat blijft rood (afwerking 04-09, nr. 6). */
  const dekkingVan = (d: DayGap) => {
    const ok = d.missing.length === 0;
    return <Badge tone={ok ? 'emerald' : 'red'} stil={ok} dot={!ok}>{d.covered}/{d.expected} gedekt</Badge>;
  };

  /** De open diensten als klikbare chips (kandidaten), plus de batchknop bij meer dan één gat. */
  const gatenVan = (d: DayGap) => (d.missing.length === 0 ? (
    <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500"><Check size={14} className="text-emerald-700" /> volledig gedekt</span>
  ) : (
    <>
      <div className="flex flex-wrap gap-2">
        {d.missing.map((svc) => {
          // Gat door een gemelde afwezigheid: toon wie uitviel en
          // waarom ("4407 · Pascal Duysburgh · ziek"). Een dienst
          // die nooit toegewezen was, blijft een kale chip.
          // Vorm: min-h 36px + gap-2 — de oude 20px-chips met
          // 6px ertussen waren op een telefoon niet raakbaar.
          // De NAAM truncate't, de REDEN nooit (shrink-0): de
          // reden was juist de toevoeging. Redenkleur volgt de
          // statuskleurtaal app-breed: ziek rose, verlof
          // emerald, klein verlet blue (zelfde als dashboard-
          // aftelling) — rood blijft van het gat zelf, niet
          // van de persoon.
          const info = d.uitval?.[normalizeCode(svc)];
          const redenKleur = info?.reason === 'ziek'
            ? 'text-rose-700'
            : info?.reason === 'verlof'
              ? 'text-emerald-700'
              : info?.reason === 'klein verlet'
                ? 'text-blue-700'
                : 'text-slate-600';
          return (
            // rauw: dienst-chip met samengestelde inhoud (code · naam · reden) in de
            // rode gat-toon — Chip is niet klikbaar en FilterChip kent geen inhoud-slots
            <button
              key={svc}
              type="button"
              onClick={() => setPick({ date: d.date, code: svc })}
              title="Klik om te zien wie vrij is"
              className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-lg bg-red-100 text-red-800 px-2 py-1 text-xs font-semibold ring-1 ring-red-200 hover:bg-red-200 hover:ring-red-300 transition-colors cursor-pointer"
            >
              <span className="font-mono">{svc}</span>
              {info && (
                <span className="flex min-w-0 items-baseline gap-1 font-medium">
                  <span className="min-w-0 truncate text-red-700/90">· {info.name}</span>
                  <span className={cn('shrink-0', redenKleur)}>· {info.reason}</span>
                </span>
              )}
            </button>
          );
        })}
      </div>
      {/* Meerdere gaten op één dag: in één keer voorinvullen en toewijzen. */}
      {d.missing.length > 1 && (
        <div className="mt-2">
          <Button variant="secondary" size="sm" icon={<ListChecks size={14} />} onClick={() => void openBatch(d)}>
            Vul alle gaten van deze dag voor
          </Button>
        </div>
      )}
    </>
  ));

  return (
    <PageShell breed>
      <PageHeader
        view="dekking"
        title="Openstaande diensten"
        actions={(
          <>
          <VersheidRegel {...zl.versheid} />
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" icon={<ChevronLeft size={18} />} aria-label="Vorige maand" onClick={() => setViewMonth(new Date(year, monthIndex - 1, 1))} />
            <span className="px-3 text-sm font-bold capitalize min-w-[130px] text-center tabular-nums">{MONTH_NAMES[monthIndex]} {year}</span>
            <Button variant="ghost" size="sm" icon={<ChevronRight size={18} />} aria-label="Volgende maand" onClick={() => setViewMonth(new Date(year, monthIndex + 1, 1))} />
            <Button
              variant="secondary"
              size="sm"
              icon={<Settings2 size={14} />}
              className={cn('ml-1', showConfig && 'bg-oker-50 text-oker-700 hover:text-oker-700')}
              onClick={() => setShowConfig((v) => !v)}
            >
              Instellen
            </Button>
          </div>
          </>
        )}
      />

      {/* Desktop: instellingen + gatenlijst als hoofdkolom, het zijvak
          ernaast; de maandnavigatie blijft in de kop. */}
      <ZijvakLayout zijvak={zijvak}>
      {zl.fout && <Foutkaart compact={zl.laatstGeladen !== null} boodschap={zl.fout} offline={!zl.online} onOpnieuw={zl.opnieuw} bezig={zl.laden} />}

      {/* === Instellingen === */}
      {showConfig && (
        <Card ref={instellingenRef} padding="md" className="space-y-6">
          <CardHeader
            title="Dekkingsinstellingen"
            description="Beheer je dag-types, de verwachte diensten per type, welk type elke weekdag is, en uitzonderingen."
            aside={(
              <Button variant="primary" size="md" className="shrink-0" disabled={saving} onClick={handleSave}>
                {saving ? 'Opslaan…' : 'Opslaan'}
              </Button>
            )}
          />

          {!config ? (
            <div className="space-y-2.5">
              <Skeleton className="h-9 w-full" rounded="2xl" />
              <Skeleton className="h-9 w-4/5" rounded="2xl" />
              <Skeleton className="h-9 w-3/5" rounded="2xl" />
            </div>
          ) : config.services.length === 0 ? (
            <EmptyState compact title="Geen diensten in het dienstoverzicht om uit te kiezen." />
          ) : (
            <>
              {/* 1. Dag-types + verwachte diensten */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <MicroLabel className="text-slate-500">Dag-types &amp; verwachte diensten</MicroLabel>
                  <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={addDayType}>
                    Dag-type
                  </Button>
                </div>
                {dayTypes.length === 0 ? (
                  <p className="text-sm text-slate-500">Nog geen dag-types. Klik op "Dag-type" om er een toe te voegen (bv. schooldag, vakantie, zaterdag, zondag).</p>
                ) : (
                  <div className="space-y-3">
                    {dayTypes.map((dt, i) => {
                      const selected = new Set(dt.services);
                      const fout = rijFouten.fouten[rijSleutel.dagtype(dt._k)];
                      const foutId = fout ? `${rijSleutel.dagtype(dt._k)}-fout` : undefined;
                      return (
                        <Card key={dt._k} tone="muted" padding="sm">
                          <div className="flex items-center gap-2">
                            <IconButton
                              label={openDayTypes.has(i) ? `Dag-type ${dt.name || ''} inklappen` : `Dag-type ${dt.name || ''} uitklappen`}
                              variant="ghost"
                              size="sm"
                              aria-expanded={openDayTypes.has(i)}
                              onClick={() => toggleDayTypeOpen(i)}
                            >
                              <ChevronDown size={16} className={uitklapChevron(openDayTypes.has(i))} />
                            </IconButton>
                            <Input
                              ref={i === 0 ? firstNameRef : undefined}
                              value={dt.name}
                              onChange={(e) => updateDayTypeName(i, e.target.value)}
                              onFocus={() => beginDayTypeNameEdit(i)}
                              onBlur={() => finishDayTypeNameEdit(i)}
                              placeholder="Naam dag-type"
                              aria-label="Naam dag-type"
                              aria-describedby={foutId}
                              invalid={Boolean(fout)}
                              className="flex-1 font-semibold"
                            />
                            <Badge tone="slate" className="shrink-0 tabular-nums">{dt.services.length} {dt.services.length === 1 ? 'dienst' : 'diensten'}</Badge>
                            <IconButton label="Dag-type verwijderen" variant="danger" size="sm" onClick={() => removeDayType(i)}><X size={16} /></IconButton>
                          </div>
                          {fout && <p id={foutId} className="mt-2 text-xs font-medium text-red-700">{fout}</p>}
                          <Uitklap open={openDayTypes.has(i)}>
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {config.services.map((svc) => {
                              const on = selected.has(svc);
                              return (
                                <FilterChip key={svc} active={on} onClick={() => toggleService(i, svc)} className="font-mono tabular-nums">
                                  {svc}
                                </FilterChip>
                              );
                            })}
                          </div>
                          </Uitklap>
                        </Card>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 1b. Lijsten uit de planning: voorstel per dag-type uit wat er
                  deze maand echt gereden wordt (verbeterronde 22-08, nr. 2). */}
              <div className="border-t border-hairline-subtle pt-5">
                {/* rauw: accordeonkop over de volle breedte (micro-label + omschrijving + chevron) */}
                <button
                  type="button"
                  onClick={() => setVoorstelOpen((v) => !v)}
                  aria-expanded={voorstelOpen}
                  className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
                >
                  <div>
                    <MicroLabel className="text-slate-500">Lijsten uit de planning</MicroLabel>
                    <p className="text-xs font-medium text-slate-500 mt-0.5">Stel de dienstenlijsten voor op basis van wat er deze maand echt rijdt, de kortste weg na een dienstregelingswissel.</p>
                  </div>
                  <ChevronDown size={16} className={uitklapChevron(voorstelOpen, 180, 'shrink-0 text-slate-400')} />
                </button>
                <Uitklap open={voorstelOpen}>
                <div className="space-y-3 pt-3">
                <Button variant="secondary" size="sm" disabled={voorstelLaden} onClick={() => void haalVoorstelOp()}>
                  {voorstelLaden ? 'Berekenen…' : `Haal voorstel op (${MONTH_NAMES[monthIndex].toLowerCase()} ${year})`}
                </Button>
                {voorstellen !== null && (voorstellen.length === 0 ? (
                  <p className="text-sm text-slate-500">Geen voorstel mogelijk, te weinig dagen per dag-type in deze maand.</p>
                ) : (
                  <div className="space-y-2">
                    {voorstellen.map((v) => {
                      const huidig = dayTypes.find((dt) => dt.name.trim().toLowerCase() === v.dayType.trim().toLowerCase())?.services ?? null;
                      const lijstKloptAl = huidig !== null && huidig.length === v.codes.length
                        && v.codes.every((c) => huidig.some((h) => h.trim().toLowerCase() === c.code.trim().toLowerCase()));
                      return (
                        <Card key={v.dayType} tone="muted" padding="sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-bold text-slate-700 capitalize">{v.dayType}</span>
                            <Badge tone="slate" className="tabular-nums">{v.codes.length} diensten · {v.dagen} dagen</Badge>
                            {lijstKloptAl ? (
                              <Badge tone="emerald" stil className="ml-auto shrink-0">Lijst klopt al</Badge>
                            ) : (
                              <Button variant="secondary" size="sm" className="ml-auto shrink-0" onClick={() => pasVoorstelToe(v)}>
                                {huidig === null ? 'Maak dag-type met deze lijst' : `Vervang lijst (nu ${huidig.length})`}
                              </Button>
                            )}
                          </div>
                          <p className="mt-2 text-xs font-mono font-medium text-slate-500 tabular-nums">{v.codes.map((c) => c.code).join(' · ')}</p>
                        </Card>
                      );
                    })}
                  </div>
                ))}
                </div>
                </Uitklap>
              </div>

              {/* 2. Standaard dag-type per weekdag */}
              <div className="border-t border-hairline-subtle pt-5">
                {/* rauw: accordeonkop over de volle breedte (micro-label + omschrijving + chevron) */}
                <button
                  type="button"
                  onClick={() => setWeekdagenOpen((v) => !v)}
                  aria-expanded={weekdagenOpen}
                  className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
                >
                  <div>
                    <MicroLabel className="text-slate-500">Standaard per weekdag</MicroLabel>
                    <p className="text-xs font-medium text-slate-500 mt-0.5 tabular-nums">{weekdayPeriods.length > 0 ? `Basis + ${weekdayPeriods.length} ${weekdayPeriods.length === 1 ? 'periode' : 'periodes'}` : 'Basis-toewijzing'}, welk dag-type elke weekdag standaard is.</p>
                  </div>
                  <ChevronDown size={16} className={uitklapChevron(weekdagenOpen, 180, 'shrink-0 text-slate-400')} />
                </button>
                <Uitklap open={weekdagenOpen}>
                <div className="space-y-3 pt-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {WEEKDAY_ORDER.map(({ dow, label }) => (
                    <div key={dow} className="flex items-center justify-between gap-3 rounded-xl bg-surface-white ring-1 ring-hairline px-3 py-2">
                      <span className="text-label">{label}</span>
                      <Select
                        value={weekdays[dow] || ''}
                        onChange={(e) => setWeekday(dow, e.target.value)}
                        aria-label={`Dag-type voor ${label}`}
                        className="w-auto max-w-[55%]"
                      >
                        <option value="">geen</option>
                        {dayTypeNames.map((n) => <option key={n} value={n}>{n}</option>)}
                      </Select>
                    </div>
                  ))}
                </div>

                {/* Weekdag-periodes: bij een dienstregelingswissel (bv. schooljaar
                    vanaf 1 september) verandert wat elke weekdag is — zonder
                    ingangsdatum bleef de dekking eeuwig het oude regime
                    verwachten (melding Jarno 19-08). */}
                <div className="mt-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <p className="text-xs font-medium text-slate-500">
                      Vanaf een datum kan een ándere toewijzing gelden, bv. het schooljaar-regime vanaf 1 september. De recentste ingangsdatum vóór een dag wint; uitzonderingen hieronder gaan altijd voor.
                    </p>
                    <Button variant="secondary" size="sm" icon={<Plus size={14} />} className="shrink-0" onClick={addWeekdayPeriod}>
                      Periode
                    </Button>
                  </div>
                  {weekdayPeriods.map((p, i) => {
                    const fout = rijFouten.fouten[rijSleutel.periode(p._k)];
                    const foutId = fout ? `${rijSleutel.periode(p._k)}-fout` : undefined;
                    return (
                    <Card key={p._k} tone="muted" padding="sm" className="space-y-3">
                      <div className="flex flex-wrap items-center gap-2">
                        <MicroLabel className="text-slate-600">Vanaf</MicroLabel>
                        <DateInput
                          size="sm"
                          value={p.vanaf}
                          onChange={(v) => setPeriodVanaf(i, v)}
                          aria-label="Ingangsdatum van deze weekdag-toewijzing"
                          aria-describedby={foutId}
                          invalid={Boolean(fout)}
                        />
                        {fout && <span id={foutId} className="text-xs font-medium text-red-700">{fout}</span>}
                        <IconButton label="Periode verwijderen" variant="danger" size="sm" className="ml-auto" onClick={() => removeWeekdayPeriod(i)}><X size={16} /></IconButton>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {WEEKDAY_ORDER.map(({ dow, label }) => (
                          <div key={dow} className="flex items-center justify-between gap-3 rounded-xl bg-surface-white ring-1 ring-hairline px-3 py-2">
                            <span className="text-label">{label}</span>
                            <Select
                              value={p.weekdays[dow] || ''}
                              onChange={(e) => setPeriodWeekday(i, dow, e.target.value)}
                              aria-label={`Dag-type voor ${label} vanaf ${p.vanaf || 'de ingangsdatum'}`}
                              className="w-auto max-w-[55%]"
                            >
                              <option value="">geen</option>
                              {dayTypeNames.map((n) => <option key={n} value={n}>{n}</option>)}
                            </Select>
                          </div>
                        ))}
                      </div>
                    </Card>
                    );
                  })}
                </div>
                </div>
                </Uitklap>
              </div>

              {/* 3. Uitzonderingen */}
              <div className="border-t border-hairline-subtle pt-5">
                {/* rauw: accordeonkop over de volle breedte (micro-label + omschrijving + chevron) */}
                <button
                  type="button"
                  onClick={() => setUitzonderingenOpen((v) => !v)}
                  aria-expanded={uitzonderingenOpen}
                  className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
                >
                  <div>
                    <MicroLabel className="text-slate-500">Uitzonderingen</MicroLabel>
                    <p className="text-xs font-medium text-slate-500 mt-0.5 tabular-nums">
                      {overrides.length === 0 ? 'Nog geen uitzonderingen' : `${overrides.length} ingesteld${verlopenAantal > 0 ? ` · ${verlopenAantal} verlopen` : ''}`}, een periode die afwijkt van de weekdag-standaard.
                    </p>
                  </div>
                  <ChevronDown size={16} className={uitklapChevron(uitzonderingenOpen, 180, 'shrink-0 text-slate-400')} />
                </button>
                <Uitklap open={uitzonderingenOpen}>
                <div className="space-y-3 pt-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="min-w-0 text-xs font-medium text-slate-500">Bv. een schoolvakantie of feestdag (van = tot voor één dag). Chronologisch gesorteerd; verlopen uitzonderingen doen niets meer.</p>
                  <div className="flex shrink-0 gap-2">
                    {verlopenAantal > 0 && (
                      <Button variant="ghost" size="sm" onClick={ruimVerlopenOp}>
                        Ruim {verlopenAantal} verlopen op
                      </Button>
                    )}
                    <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={addOverride}>
                      Uitzondering
                    </Button>
                  </div>
                </div>
                {overrides.length === 0 ? (
                  <p className="text-sm text-slate-500">Geen uitzonderingen, elke dag volgt de weekdag-standaard.</p>
                ) : (
                  <div className="space-y-2">
                    {gesorteerdeOverrides.map(({ o, i, verlopen }) => {
                      // Onvolledig blokkeert Opslaan en staat dan hier (tranche
                      // 3A); omgekeerde datums zegt de rij meteen.
                      const onvolledig = rijFouten.fouten[rijSleutel.uitzondering(o._k)];
                      const omgekeerd = !!o.from && !!o.to && o.to < o.from;
                      const rijFout = omgekeerd ? 'Tot en met ligt vóór Van.' : onvolledig ?? '';
                      const foutId = rijFout ? `${rijSleutel.uitzondering(o._k)}-fout` : undefined;
                      return (
                        <div key={o._k} className="space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <DateInput size="sm" value={o.from} max={o.to || undefined} onChange={(v) => updateOverride(i, 'from', v)} aria-label="Van" aria-describedby={foutId} invalid={(Boolean(onvolledig) && !o.from) || omgekeerd} />
                            <span className="text-label">t/m</span>
                            <DateInput size="sm" value={o.to} min={o.from || undefined} onChange={(v) => updateOverride(i, 'to', v)} aria-label="Tot en met" aria-describedby={foutId} invalid={(Boolean(onvolledig) && !o.to) || omgekeerd} />
                            <span className="text-slate-400 font-semibold">→</span>
                            <Select value={o.dayType} onChange={(e) => updateOverride(i, 'dayType', e.target.value)} aria-label="Dag-type" aria-describedby={foutId} invalid={Boolean(onvolledig) && !dayTypeNames.includes(o.dayType)} className="w-auto">
                              <option value="">kies type</option>
                              {dayTypeNames.map((n) => <option key={n} value={n}>{n}</option>)}
                            </Select>
                            {verlopen && <Badge tone="slate">Verlopen</Badge>}
                            <IconButton label="Uitzondering verwijderen" variant="danger" size="sm" onClick={() => removeOverride(i)}><X size={16} /></IconButton>
                          </div>
                          {rijFout && <p id={foutId} className="text-xs font-medium text-red-700">{rijFout}</p>}
                        </div>
                      );
                    })}
                  </div>
                )}
                </div>
                </Uitklap>
              </div>

              {/* 4. Kalender-voorzet: feestdagen + schoolvakanties in één klik */}
              <div className="border-t border-hairline-subtle pt-5">
                {/* rauw: accordeonkop over de volle breedte (micro-label + omschrijving + chevron) */}
                <button
                  type="button"
                  onClick={() => setKalenderOpen((v) => !v)}
                  aria-expanded={kalenderOpen}
                  className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
                >
                  <div>
                    <MicroLabel className="text-slate-500">Kalender 2026–2027</MicroLabel>
                    <p className="text-xs font-medium text-slate-500 mt-0.5">Feestdagen en schoolvakanties in één klik voorzetten als uitzonderingen.</p>
                  </div>
                  <ChevronDown size={16} className={uitklapChevron(kalenderOpen, 180, 'shrink-0 text-slate-400')} />
                </button>
                <Uitklap open={kalenderOpen}>
                <div className="space-y-3 pt-3">
                <p className="text-xs font-medium text-slate-500">
                  Zet de Belgische feestdagen (zondagsdienst) en de Vlaamse schoolvakanties (herfst, kerst, krokus, Pasen) in één keer voor als uitzonderingen. Je kiest hieronder welk dag-type elke groep krijgt; daarna gewoon controleren en opslaan. De zomervakantie stel je in via een weekdagperiode, zoals vanaf 1 september.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {([
                    { label: 'Feestdagen', waarde: kalFeest, zet: setKalFeest },
                    { label: 'Vakantie ma/di/wo', waarde: kalMaDiWo, zet: setKalMaDiWo },
                    { label: 'Vakantie donderdag', waarde: kalDo, zet: setKalDo },
                    { label: 'Vakantie vrijdag', waarde: kalVr, zet: setKalVr },
                  ] as const).map(({ label, waarde, zet }) => (
                    <div key={label} className={cn('flex items-center justify-between gap-3 rounded-xl bg-surface-white ring-1 px-3 py-2', kalFout && !waarde ? 'ring-red-200' : 'ring-hairline')}>
                      <span className="text-label">{label}</span>
                      <Select
                        value={waarde}
                        onChange={(e) => { zet(e.target.value); setKalFout(''); }}
                        aria-label={`Dag-type voor ${label.toLowerCase()}`}
                        aria-describedby={kalFout ? 'kalender-fout' : undefined}
                        invalid={!!kalFout && !waarde}
                        className="w-auto max-w-[55%]"
                      >
                        <option value="">overslaan</option>
                        {dayTypeNames.map((n) => <option key={n} value={n}>{n}</option>)}
                      </Select>
                    </div>
                  ))}
                </div>
                {kalFout && (
                  <p id="kalender-fout" role="alert" className="text-xs font-medium text-red-700">{kalFout}</p>
                )}
                <Button variant="secondary" size="sm" icon={<CalendarPlus size={14} />} onClick={voegKalenderToe}>
                  Zet voor in de lijst
                </Button>
                </div>
                </Uitklap>
              </div>

              <p className="text-xs font-medium text-slate-500">Vergeet niet op <span className="font-bold">Opslaan</span> te klikken.</p>
            </>
          )}
        </Card>
      )}

      {/* Verwachtingen-vs-praktijk: structurele afwijkingen tussen de dag-
          type-lijsten en wat er echt gereden wordt. Zonder deze banner lezen
          die als "openstaande diensten" terwijl niemand ontbreekt (20-08). */}
      {expCheck.length > 0 && (
        <Card tone="warning" padding="md">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-amber-100 p-2 text-amber-700"><AlertTriangle size={18} /></div>
            <div className="min-w-0">
              <MicroLabel className="text-amber-700">Verwachtingen wijken af van de planning</MicroLabel>
              <p className="mt-1 text-sm font-medium text-amber-900">
                Sommige dag-type-lijsten sporen niet met wat er deze maand echt gereden wordt, meestal een dienstregelingswissel die nog niet in de dekkingsinstellingen verwerkt is. Pas de lijsten aan via Instellen.
              </p>
              <VerwachtingAfwijkingLijst afwijkingen={expCheck} />
            </div>
          </div>
        </Card>
      )}

      {/* === Gaten-overzicht === */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex items-center gap-2 text-sm">
          {totalMissing > 0 ? (
            <span className="inline-flex flex-wrap items-center gap-1.5 font-semibold text-red-700 tabular-nums">
              <AlertTriangle size={16} /> {totalMissing} niet-ingevulde {totalMissing === 1 ? 'dienst' : 'diensten'} deze maand
              {uitvalSplit.doorAfwezigheid > 0 && (
                <span className="font-medium text-slate-500">
                 , {uitvalSplit.zonderChauffeur > 0 ? `${uitvalSplit.zonderChauffeur} zonder chauffeur · ` : ''}{uitvalSplit.doorAfwezigheid} door afwezigheid{uitvalSplit.namen.length === 1 ? ` (${uitvalSplit.namen[0]})` : ` (${uitvalSplit.namen.length} chauffeurs)`}
                </span>
              )}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700"><Check size={16} className="text-emerald-700" /> Alle verwachte diensten zijn ingevuld</span>
          )}
        </div>
        <FilterChip active={onlyGaps} onClick={() => setOnlyGaps((v) => !v)}>
          Alleen dagen met gaten
        </FilterChip>
      </div>

      {zl.fout && zl.laatstGeladen === null ? null : zl.laden ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i}><SkeletonTile /></div>
          ))}
        </div>
      ) : !anyExpectations ? (
        <EmptyState
          title="Nog geen verwachte diensten ingesteld"
          message='Klik op “Instellen” en kies per dag-type welke diensten horen te draaien, daarna ziet dit scherm elke onbemande dienst.'
        />
      ) : visibleDays.length === 0 ? (
        <EmptyState variant="klaar" title={`Geen openstaande diensten in ${MONTH_NAMES[monthIndex].toLowerCase()} ${year}.`} message="Alle verwachte diensten zijn ingevuld." />
      ) : (
        // Breed: een echte tabel, Dag · Dekking · Openstaande diensten, met
        // de dag als rijkop. Past in haar kader (de laatste kolom breekt af),
        // dus `past` en een plakkende kop over een maand van dertig rijen.
        // Smal: dezelfde dagen als lijst, zelfde chips en knoppen.
        // Wissel via een container query i.p.v. md: naast zijbalk en zijvak
        // is deze kolom op 1024 px maar ±340 px breed, de tabel vraagt er
        // ±520 (e2e planning-tabellen). Een dag met een gat heeft geen getint
        // vlak meer: de rode dekkingspil en de rode chips zijn het signaal.
        <TableShell past className="@container" label={`Openstaande diensten ${MONTH_NAMES[monthIndex].toLowerCase()} ${year}`}>
          <div className="hidden @[36rem]:block">
            <Tabel>
              <StickyThead>
                <tr>
                  <Th className="w-44">Dag</Th>
                  <Th className="w-32">Dekking</Th>
                  <Th>Openstaande diensten</Th>
                </tr>
              </StickyThead>
              <tbody>
                {visibleDays.map((d) => (
                  <tr key={d.date} className="border-b border-hairline-subtle align-top last:border-b-0">
                    <Th scope="row" className="whitespace-normal py-3 text-sm font-semibold text-slate-800">
                      <span className="block whitespace-nowrap capitalize">{dayLabel(d.date)}</span>
                      <span className="mt-1 block font-normal">{dagTypeVan(d)}</span>
                    </Th>
                    <Td nowrap>{dekkingVan(d)}</Td>
                    <Td>{gatenVan(d)}</Td>
                  </tr>
                ))}
              </tbody>
            </Tabel>
          </div>
          <ul className="divide-y divide-hairline-subtle @[36rem]:hidden" aria-label={`Openstaande diensten ${MONTH_NAMES[monthIndex].toLowerCase()} ${year}`}>
            {visibleDays.map((d) => (
              <li key={d.date} className="space-y-2 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-md font-semibold capitalize text-slate-800">{dayLabel(d.date)}</p>
                    <div className="mt-1">{dagTypeVan(d)}</div>
                  </div>
                  <div className="shrink-0">{dekkingVan(d)}</div>
                </div>
                {gatenVan(d)}
              </li>
            ))}
          </ul>
        </TableShell>
      )}
      </ZijvakLayout>

      {/* Advies voor het gekozen gat: wie is vrij én bij wie past de dienst? */}
      <Modal open={!!pick} onClose={() => setPick(null)} maxWidth="sm" className="flex max-h-overlay flex-col !overflow-hidden !p-0">
        {pick && (
          <>
          <ModalHeader
            eyebrow={`Kandidaten voor dienst ${pick.code}`}
            title={dayLabel(pick.date).replace(/^./, (c) => c.toUpperCase())}
            description={advies && advies.segmenten.length > 0 ? <span className="tabular-nums">{segmentenLabel(advies.segmenten)}</span> : undefined}
            onClose={() => setPick(null)}
          />
          <div className="flex-1 overflow-y-auto overscroll-contain p-6">

            {pickLoading ? (
              <div className="mt-5 flex items-center gap-3 text-slate-500">
                <BrandSpinner size={16} />
                <span className="text-sm font-bold">Advies berekenen…</span>
              </div>
            ) : adviesError ? (
              <p className="mt-5 text-sm font-semibold text-red-700">{adviesError}</p>
            ) : !advies || advies.kandidaten.length === 0 ? (
              <p className="mt-5 text-sm text-slate-500">Niemand is vrij op deze dag (geen dienst én geen verlof).</p>
            ) : (() => {
              const passend = advies.kandidaten.filter((k) => k.past);
              const nietPassend = advies.kandidaten.filter((k) => !k.past);
              return (
                <div className="mt-4 space-y-4">
                  {/* De collega-zin: zelfde feiten als de lijst, maar dan zoals
                      je ze tegen elkaar zegt — server-side opgebouwd. */}
                  <Card tone="accent" padding="none" className="px-4 py-3">
                    <MicroLabel className="text-oker-700">Advies</MicroLabel>
                    <p className="mt-1 text-sm font-semibold leading-snug text-slate-800">{advies.samenvatting}</p>
                  </Card>

                  {advies.tijdenOnbekend && (
                    <p className="text-xs font-semibold text-amber-800">
                      Dienst {pick.code} heeft geen tijden in het dienstoverzicht, de rustcheck kon niet, alleen de 6-dagenregel is toegepast.
                    </p>
                  )}

                  {passend.length > 0 ? (
                    <div>
                      <MicroLabel className="tabular-nums">Voorstel, {passend.length} passend</MicroLabel>
                      {/* Neutrale rijen met een groen icoon: een passende kandidaat is
                          informatie, het advies-label draagt de nadruk. */}
                      <div className="mt-2 flex flex-col gap-1.5">
                        {passend.map((k, i) => (
                          <div key={k.id} className="flex min-h-11 items-center gap-2 rounded-xl bg-surface-row ring-1 ring-hairline px-3 py-2">

                            <UserCheck size={16} className="text-emerald-700 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="min-w-0 truncate text-sm font-bold text-slate-800">{k.name}</span>
                                {i === 0 && <Badge tone="oker" className="shrink-0">Advies</Badge>}
                              </div>
                              <p className="truncate text-xs font-medium text-slate-500 tabular-nums">{kandidaatMeta(k)}</p>
                            </div>
                            <Button
                              variant="secondary"
                              size="sm"
                              className="shrink-0"
                              disabled={!!assignBusy}
                              onClick={() => setAssignConfirm({ id: k.id, name: k.name, redenen: [] })}
                            >
                              {assignBusy === k.id ? 'Bezig…' : 'Wijs toe'}
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm font-medium text-slate-500">
                      Niemand bij wie deze dienst zonder meer past, hieronder wie wél vrij is, met wat er wringt.
                    </p>
                  )}

                  {/* Ruil in één stap — alleen berekend als niemand direct past.
                      Bewust advies-zonder-knop: de planner voert de ruil zelf
                      uit (Maandplanning) en wijst daarna het gat toe. */}
                  {passend.length === 0 && advies.kettingen.length > 0 && (
                    <div>
                      <MicroLabel className="text-oker-700 tabular-nums">Via een ruil, {advies.kettingen.length} {advies.kettingen.length === 1 ? 'optie' : 'opties'}</MicroLabel>
                      <div className="mt-2 flex flex-col gap-1.5">
                        {advies.kettingen.map((k) => (
                          <div key={`${k.vanId}-${k.naarId}`} className="rounded-xl bg-surface-field ring-1 ring-hairline px-3 py-2.5 text-sm font-medium text-slate-700">
                            <span className="font-bold">{k.naarNaam}</span> neemt dienst <span className="font-bold tabular-nums">{k.viaCode}</span> <span className="text-slate-500 tabular-nums">({k.viaTijden})</span> over van <span className="font-bold">{k.vanNaam}</span>, dan kan {k.vanNaam} dienst <span className="font-bold tabular-nums">{pick.code}</span> rijden. Beide schakels voldoen aan alle regels.
                          </div>
                        ))}
                      </div>
                      <p className="mt-1.5 text-xs font-medium text-slate-500">Uitvoeren: zet de dienst over via de cel in de Maandplanning en wijs daarna dienst {pick.code} hier toe.</p>
                    </div>
                  )}

                  {nietPassend.length > 0 && (
                    <div>
                      <MicroLabel className="text-rose-700 tabular-nums">Vrij, maar past niet, {nietPassend.length}</MicroLabel>
                      <div className="mt-2 flex flex-col gap-1.5">
                        {nietPassend.map((k) => (
                          <div key={k.id} className="flex min-h-11 items-center gap-2 rounded-xl bg-rose-50/60 ring-1 ring-rose-100 px-3 py-2">
                            <UserX size={16} className="text-rose-500 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-bold text-slate-800">{k.name}</span>
                              <p className="text-xs font-medium text-rose-700">{k.redenen.join(' · ')}</p>
                            </div>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="shrink-0"
                              disabled={!!assignBusy}
                              onClick={() => setAssignConfirm({ id: k.id, name: k.name, redenen: k.redenen })}
                            >
                              {assignBusy === k.id ? 'Bezig…' : 'Toch toewijzen'}
                            </Button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  <p className="text-xs font-medium text-slate-500">
                    Passend = die dag vrij, minstens {advies.minRustUren}u rust t.o.v. de aansluitende werkdagen, maximaal {advies.maxDagenNaElkaar} werkdagen na elkaar en geen schoolvervoerchauffeur. Kortste reeks werkdagen bovenaan, daarna wie dit jaar het minst inviel; toewijzen zet de dienst meteen in de planning en meldt het aan de chauffeur.
                  </p>
                </div>
              );
            })()}
          </div>
          </>
        )}
      </Modal>

      <ConfirmationModal
        open={!!assignConfirm}
        onClose={() => setAssignConfirm(null)}
        onConfirm={() => { const k = assignConfirm; setAssignConfirm(null); if (k) void wijsToe(k); }}
        title="Dienst toewijzen?"
        message={pick && assignConfirm
          ? `Dienst ${pick.code} op ${dayLabel(pick.date)} wordt toegewezen aan ${assignConfirm.name}.${assignConfirm.redenen.length > 0 ? ` Let op, dit wijkt af van het advies: ${assignConfirm.redenen.join(', en ')}.` : ''} De planning wordt meteen bijgewerkt en de chauffeur krijgt een melding.`
          : ''}
        confirmText="Toewijzen"
        cancelText="Annuleren"
        variant="warning"
      />

      {/* Alle gaten van één dag: batch-advies vooringevuld, per rij te corrigeren. */}
      <Modal open={!!batch} onClose={() => setBatch(null)} maxWidth="md" className="flex max-h-overlay flex-col !overflow-hidden !p-0" ariaLabel="Alle gaten van deze dag voorinvullen">
        {batch && (
          <>
            <ModalHeader
              eyebrow={`${batch.codes.length} openstaande diensten`}
              title={dayLabel(batch.date).replace(/^./, (c) => c.toUpperCase())}
              description="Het advies vult per dienst de best passende vrije chauffeur voor; twee diensten op deze dag krijgen nooit dezelfde. Pas aan waar nodig en wijs alles in één keer toe."
              onClose={() => setBatch(null)}
            />
            <div className="flex-1 space-y-2.5 overflow-y-auto overscroll-contain p-6">
              {batchLaden && (
                <div className="flex items-center gap-3 text-slate-500">
                  <BrandSpinner size={16} />
                  <span className="text-sm font-bold">Advies berekenen…</span>
                </div>
              )}
              {batch.codes.map((code) => {
                const sleutel = adviesSleutel(batch.date, code);
                const klaar = batchKlaar[sleutel];
                const advies = batchAdvies[sleutel];
                return (
                  <Card key={code} tone="muted" padding="none" className="space-y-2 px-3.5 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-sm font-semibold text-slate-800 tabular-nums">Dienst {code}</span>
                      {klaar && <Badge tone="emerald" stil>Toegewezen aan {klaar}</Badge>}
                    </div>
                    {advies?.samenvatting && !klaar && (
                      <p className="text-xs font-medium text-slate-500">{advies.samenvatting}</p>
                    )}
                    {batchFouten[sleutel] && (
                      <p role="alert" className="text-xs font-semibold text-red-700">{batchFouten[sleutel]}</p>
                    )}
                    {!klaar && (
                      <Select
                        aria-label={`Chauffeur voor dienst ${code}`}
                        value={batchKeuze[sleutel] ?? ''}
                        disabled={batchBezig || !planningMatrixGeladen}
                        onChange={(e) => setBatchKeuze((cur) => ({ ...cur, [sleutel]: e.target.value }))}
                      >
                        {/* Zonder matrix geen kandidaten: een afwezige stond
                            anders even als vrij in de lijst. */}
                        <option value="">{planningMatrixGeladen ? 'Kies een chauffeur…' : 'Kandidaten laden…'}</option>
                        {planningMatrixGeladen && optiesVoor(batch.date, code).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                      </Select>
                    )}
                  </Card>
                );
              })}
            </div>
            <div className="flex items-center justify-end gap-2 border-t border-hairline p-4">
              <Button variant="secondary" onClick={() => setBatch(null)}>Sluiten</Button>
              <Button variant="primary" disabled={batchLaden || batchTeDoen.length === 0} bezig={batchBezig} onClick={() => setBatchConfirm(true)}>
                Wijs alles toe ({batchTeDoen.length})
              </Button>
            </div>
          </>
        )}
      </Modal>
      <ConfirmationModal
        open={batchConfirm}
        onClose={() => setBatchConfirm(false)}
        onConfirm={() => { setBatchConfirm(false); void voerBatchUit(); }}
        title="Alle gaten van deze dag toewijzen?"
        message={batch
          ? `${batchTeDoen.length} ${batchTeDoen.length === 1 ? 'dienst' : 'diensten'} op ${dayLabel(batch.date)} ${batchTeDoen.length === 1 ? 'wordt' : 'worden'} in één keer toegewezen aan de gekozen chauffeurs. De planning wordt meteen bijgewerkt en elke chauffeur krijgt een melding; terugdraaien kan per dienst via de cel in de Maandplanning.`
          : ''}
        confirmText="Wijs alles toe"
        cancelText="Annuleren"
        variant="warning"
      />
    </PageShell>
  );
}
