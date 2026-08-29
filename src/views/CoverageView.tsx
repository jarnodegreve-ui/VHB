import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarPlus, ChevronDown, ChevronLeft, ChevronRight, Settings2, AlertTriangle, Check, X, UserCheck, UserX, Plus } from 'lucide-react';
import { cn, getSupabaseAuthHeaders, notify } from '../lib/ui';
import { Skeleton, SkeletonTile } from '../components/Skeleton';
import { ConfirmationModal, EmptyState, PageHeader, PageShell } from '../components/ui';
import { Badge, Button, FilterChip, MicroLabel } from '../components/primitives';
import { Modal } from '../components/Modal';
import { fetchCoverageAdvies, kandidaatMeta, segmentenLabel, type CoverageAdvies } from '../lib/advisor';
import { formatShortDay, MONTH_NAMES } from '../lib/format';
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
import { normalizeCode, type DayTypeBron, type VerwachtingAfwijking, type VerwachtingVoorstel } from '../lib/coverageGaps';
import { VerwachtingAfwijkingLijst } from '../components/planningSignalen';
import { bouwKalenderUitzonderingen } from '../lib/schoolkalender';


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
  const [viewMonth, setViewMonth] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [config, setConfig] = useState<CoverageConfig | null>(null);
  // Bewerkbare config-state.
  const [dayTypes, setDayTypes] = useState<CoverageDayType[]>([]);
  const [weekdays, setWeekdays] = useState<string[]>(['', '', '', '', '', '', '']);
  const [weekdayPeriods, setWeekdayPeriods] = useState<CoverageWeekdayPeriod[]>([]);
  const [overrides, setOverrides] = useState<CoverageOverride[]>([]);
  const [gaps, setGaps] = useState<DayGap[]>([]);
  // Verwachtingen-vs-praktijk voor de getoonde maand: structurele afwijkingen
  // tussen de dag-type-lijsten en wat er echt gereden wordt (fantoomgaten).
  const [expCheck, setExpCheck] = useState<VerwachtingAfwijking[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
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

  const year = viewMonth.getFullYear();
  const monthIndex = viewMonth.getMonth();
  const from = `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  const to = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

  useEffect(() => {
    let cancelled = false;
    fetchCoverageConfig()
      .then((c) => {
        if (cancelled) return;
        setConfig(c);
        setDayTypes((c.dayTypes || []).map((dt) => ({ name: dt.name, services: [...(dt.services || [])] })));
        const w = Array.isArray(c.weekdays) && c.weekdays.length === 7 ? c.weekdays : ['', '', '', '', '', '', ''];
        setWeekdays([...w]);
        setWeekdayPeriods((c.weekdayPeriods || []).map((p) => ({ vanaf: p.vanaf, weekdays: [...(p.weekdays || [])] })));
        setOverrides((c.overrides || []).map((o) => ({ ...o })));
      })
      .catch((e) => { if (!cancelled) setError(e?.message || 'Kon instellingen niet laden.'); });
    return () => { cancelled = true; };
  }, []);

  // Versieteller tegen kruisende responses: zowel de maandwissel als een
  // refetch (na toewijzen/opslaan) bumpen hem, en alleen het recentste
  // antwoord mag de state zetten — anders kon een traag antwoord van de
  // vorige maand over de nieuwe heen schrijven.
  const gapsVersieRef = useRef(0);
  const laadGaps = (van: string, tot: string) => {
    const versie = ++gapsVersieRef.current;
    const alsActueel = (fn: () => void) => { if (versie === gapsVersieRef.current) fn(); };
    setLoading(true);
    return Promise.all([
      fetchCoverageGaps(van, tot)
        .then((res) => alsActueel(() => setGaps(Array.isArray(res?.days) ? res.days : [])))
        .catch((e) => alsActueel(() => setError(e?.message || 'Kon dekking niet berekenen.')))
        .finally(() => alsActueel(() => setLoading(false))),
      // Best-effort naast de gaten: een mislukte check mag het scherm niet raken.
      fetchExpectationCheck(van, tot)
        .then((res) => alsActueel(() => setExpCheck(Array.isArray(res?.afwijkingen) ? res.afwijkingen : [])))
        .catch(() => alsActueel(() => setExpCheck([]))),
    ]);
  };

  useEffect(() => {
    // Voorstel hoort bij de getoonde maand — bij bladeren resetten, anders
    // belooft de knop september terwijl er augustus-cijfers staan.
    setVoorstellen(null);
    laadGaps(from, to);
    return () => { gapsVersieRef.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to]);

  const refetchGaps = () => laadGaps(from, to);

  /** Wijs het gekozen gat toe aan een vrije chauffeur — de matrix én de
   *  planning worden server-side bijgewerkt, daarna verdwijnt het gat hier. */
  const wijsToe = async (kandidaat: { id: string; name: string }) => {
    if (!pick || assignBusy) return;
    setAssignBusy(kandidaat.id);
    try {
      const res = await fetch('/api/planning/assign-service', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await getSupabaseAuthHeaders()) },
        body: JSON.stringify({ date: pick.date, serviceNumber: pick.code, driverId: kandidaat.id }),
      });
      const body = await res.json().catch(() => ({} as any));
      if (!res.ok) { notify(body.error || 'Toewijzen is mislukt.', 'error'); return; }
      notify(`Dienst ${pick.code} toegewezen aan ${kandidaat.name} — de chauffeur krijgt een melding.`, 'success');
      setPick(null);
      await refetchGaps();
    } catch {
      notify('Toewijzen is mislukt — controleer je verbinding en probeer opnieuw.', 'error');
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
    setDayTypes((prev) => [{ name: '', services: [] }, ...prev]);
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
  const updateDayTypeName = (i: number, name: string) => {
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
    setWeekdayPeriods((prev) => [...prev, { vanaf: '', weekdays: ['', '', '', '', '', '', ''] }]);
  const setPeriodVanaf = (i: number, vanaf: string) =>
    setWeekdayPeriods((prev) => prev.map((p, idx) => (idx === i ? { ...p, vanaf } : p)));
  const setPeriodWeekday = (i: number, dow: number, name: string) =>
    setWeekdayPeriods((prev) => prev.map((p, idx) => (idx === i ? { ...p, weekdays: p.weekdays.map((x, d) => (d === dow ? name : x)) } : p)));
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
    // 27-08, bevinding 27). Zelfde vorm als overrideVandaag hieronder.
    const vandaag = new Date().toLocaleDateString('en-CA');
    const { uitzonderingen, overgeslagen } = bouwKalenderUitzonderingen({
      feestdagType: kalFeest || undefined,
      vakantieTypes: { maDiWo: kalMaDiWo || undefined, donderdag: kalDo || undefined, vrijdag: kalVr || undefined },
      bestaande: overrides,
      vanafDatum: vandaag,
    });
    if (uitzonderingen.length === 0) {
      notify(overgeslagen > 0 ? 'Alles uit de kalender staat al in de lijst.' : 'Kies eerst waar de feestdagen en vakantiedagen naartoe moeten.', 'error');
      return;
    }
    setOverrides((prev) => [...prev, ...uitzonderingen]);
    notify(`${uitzonderingen.length} uitzondering${uitzonderingen.length === 1 ? '' : 'en'} voorgezet${overgeslagen > 0 ? ` (${overgeslagen} al gedekt)` : ''} — controleer de lijst en klik op Opslaan.`, 'success');
  };

  // --- Uitzonderingen ---
  const addOverride = () => setOverrides((prev) => [...prev, { from: '', to: '', dayType: '' }]);
  const updateOverride = (i: number, field: keyof CoverageOverride, value: string) =>
    setOverrides((prev) => prev.map((o, idx) => (idx === i ? { ...o, [field]: value } : o)));
  const removeOverride = (i: number) => setOverrides((prev) => prev.filter((_, idx) => idx !== i));

  // Gesorteerd + verlopen gemarkeerd (nr. 5): de kalender-voorzet kan er
  // tientallen injecteren — chronologisch lezen en oude opruimen moet licht
  // blijven. De originele index reist mee voor de update/verwijder-handlers.
  const overrideVandaag = new Date().toLocaleDateString('en-CA');
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
    } catch (e: any) {
      notify(e?.message || 'Kon het voorstel niet berekenen.', 'error');
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
        : [...prev, { name: v.dayType, services: codes }];
    });
    notify(`Lijst voor "${v.dayType}" klaargezet (${codes.length} diensten) — controleer en klik op Opslaan.`, 'success');
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      // Dag-types: lege namen weg, dedupe (eerste wint).
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
      await refetchGaps();
    } catch (e: any) {
      setError(e?.message || 'Opslaan is mislukt.');
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

  return (
    <PageShell width="6xl">
      <PageHeader
        title="Openstaande diensten"
        description="Diensten die nog niet ingevuld zijn per dag, t.o.v. de verwachte diensten per dag-type."
        actions={(
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" icon={<ChevronLeft size={18} />} aria-label="Vorige maand" onClick={() => setViewMonth(new Date(year, monthIndex - 1, 1))} />
            <span className="px-3 text-sm font-bold tracking-tight capitalize min-w-[130px] text-center">{MONTH_NAMES[monthIndex]} {year}</span>
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
        )}
      />

      {error && <div className="surface-card p-4 rounded-2xl text-sm font-semibold text-red-700">{error}</div>}

      {/* === Instellingen === */}
      {showConfig && (
        <div className="surface-card rounded-3xl p-6 space-y-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold tracking-tight text-slate-900">Dekkingsinstellingen</h3>
              <p className="text-xs font-medium text-slate-500 mt-0.5">Beheer je dag-types, de verwachte diensten per type, welk type elke weekdag is, en uitzonderingen.</p>
            </div>
            <Button variant="primary" size="md" className="shrink-0" disabled={saving} onClick={handleSave}>
              {saving ? 'Opslaan…' : 'Opslaan'}
            </Button>
          </div>

          {!config ? (
            <div className="space-y-2.5">
              <Skeleton className="h-9 w-full" rounded="2xl" />
              <Skeleton className="h-9 w-4/5" rounded="2xl" />
              <Skeleton className="h-9 w-3/5" rounded="2xl" />
            </div>
          ) : config.services.length === 0 ? (
            <EmptyState mascotte={false} title="Geen diensten in het dienstoverzicht om uit te kiezen." />
          ) : (
            <>
              {/* 1. Dag-types + verwachte diensten */}
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <MicroLabel className="text-slate-500">Dag-types &amp; verwachte diensten</MicroLabel>
                  <Button variant="secondary" size="sm" icon={<Plus size={13} />} onClick={addDayType}>
                    Dag-type
                  </Button>
                </div>
                {dayTypes.length === 0 ? (
                  <p className="text-sm text-slate-500">Nog geen dag-types. Klik op "Dag-type" om er een toe te voegen (bv. schooldag, vakantie, zaterdag, zondag).</p>
                ) : (
                  <div className="space-y-3">
                    {dayTypes.map((dt, i) => {
                      const selected = new Set(dt.services);
                      return (
                        <div key={i} className="rounded-2xl border border-slate-100 bg-surface-field p-4">
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={<ChevronDown size={15} className={cn('transition-transform', openDayTypes.has(i) && 'rotate-180')} />}
                              className="shrink-0"
                              aria-label={openDayTypes.has(i) ? `Dag-type ${dt.name || ''} inklappen` : `Dag-type ${dt.name || ''} uitklappen`}
                              aria-expanded={openDayTypes.has(i)}
                              onClick={() => toggleDayTypeOpen(i)}
                            />
                            <input
                              ref={i === 0 ? firstNameRef : undefined}
                              value={dt.name}
                              onChange={(e) => updateDayTypeName(i, e.target.value)}
                              onFocus={() => beginDayTypeNameEdit(i)}
                              onBlur={() => finishDayTypeNameEdit(i)}
                              placeholder="Naam dag-type"
                              aria-label="Naam dag-type"
                              className="control-input flex-1 rounded-xl px-3 py-2 text-sm font-semibold outline-none"
                            />
                            <Badge tone="slate" className="shrink-0 tabular-nums">{dt.services.length} {dt.services.length === 1 ? 'dienst' : 'diensten'}</Badge>
                            <Button variant="ghost" size="sm" icon={<X size={15} />} className="shrink-0 hover:text-red-700 hover:bg-red-50" aria-label="Dag-type verwijderen" onClick={() => removeDayType(i)} />
                          </div>
                          {openDayTypes.has(i) && (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            {config.services.map((svc) => {
                              const on = selected.has(svc);
                              return (
                                <FilterChip key={svc} active={on} onClick={() => toggleService(i, svc)} className="tabular-nums">
                                  {svc}
                                </FilterChip>
                              );
                            })}
                          </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* 1b. Lijsten uit de planning: voorstel per dag-type uit wat er
                  deze maand echt gereden wordt (verbeterronde 22-08, nr. 2). */}
              <div className="border-t border-slate-100 pt-5 space-y-3">
                <button
                  type="button"
                  onClick={() => setVoorstelOpen((v) => !v)}
                  aria-expanded={voorstelOpen}
                  className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
                >
                  <div>
                    <MicroLabel className="text-slate-500">Lijsten uit de planning</MicroLabel>
                    <p className="text-xs font-medium text-slate-500 mt-0.5">Stel de dienstenlijsten voor op basis van wat er deze maand echt rijdt — de kortste weg na een dienstregelingswissel.</p>
                  </div>
                  <ChevronDown size={16} className={cn('shrink-0 text-slate-400 transition-transform', voorstelOpen && 'rotate-180')} />
                </button>
                {voorstelOpen && (
                <>
                <Button variant="secondary" size="sm" disabled={voorstelLaden} onClick={() => void haalVoorstelOp()}>
                  {voorstelLaden ? 'Berekenen…' : `Haal voorstel op (${MONTH_NAMES[monthIndex].toLowerCase()} ${year})`}
                </Button>
                {voorstellen !== null && (voorstellen.length === 0 ? (
                  <p className="text-sm text-slate-500">Geen voorstel mogelijk — te weinig dagen per dag-type in deze maand.</p>
                ) : (
                  <div className="space-y-2">
                    {voorstellen.map((v) => {
                      const huidig = dayTypes.find((dt) => dt.name.trim().toLowerCase() === v.dayType.trim().toLowerCase())?.services ?? null;
                      const lijstKloptAl = huidig !== null && huidig.length === v.codes.length
                        && v.codes.every((c) => huidig.some((h) => h.trim().toLowerCase() === c.code.trim().toLowerCase()));
                      return (
                        <div key={v.dayType} className="rounded-2xl border border-slate-100 bg-surface-field p-4">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-bold text-slate-700 capitalize">{v.dayType}</span>
                            <Badge tone="slate" className="tabular-nums">{v.codes.length} diensten · {v.dagen} dagen</Badge>
                            {lijstKloptAl ? (
                              <Badge tone="emerald" className="ml-auto shrink-0">Lijst klopt al</Badge>
                            ) : (
                              <Button variant="secondary" size="sm" className="ml-auto shrink-0" onClick={() => pasVoorstelToe(v)}>
                                {huidig === null ? 'Maak dag-type met deze lijst' : `Vervang lijst (nu ${huidig.length})`}
                              </Button>
                            )}
                          </div>
                          <p className="mt-2 text-2xs font-medium text-slate-500 tabular-nums">{v.codes.map((c) => c.code).join(' · ')}</p>
                        </div>
                      );
                    })}
                  </div>
                ))}
                </>
                )}
              </div>

              {/* 2. Standaard dag-type per weekdag */}
              <div className="border-t border-slate-100 pt-5 space-y-3">
                <button
                  type="button"
                  onClick={() => setWeekdagenOpen((v) => !v)}
                  aria-expanded={weekdagenOpen}
                  className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
                >
                  <div>
                    <MicroLabel className="text-slate-500">Standaard per weekdag</MicroLabel>
                    <p className="text-xs font-medium text-slate-500 mt-0.5">{weekdayPeriods.length > 0 ? `Basis + ${weekdayPeriods.length} ${weekdayPeriods.length === 1 ? 'periode' : 'periodes'}` : 'Basis-toewijzing'} — welk dag-type elke weekdag standaard is.</p>
                  </div>
                  <ChevronDown size={16} className={cn('shrink-0 text-slate-400 transition-transform', weekdagenOpen && 'rotate-180')} />
                </button>
                {weekdagenOpen && (
                <>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {WEEKDAY_ORDER.map(({ dow, label }) => (
                    <div key={dow} className="flex items-center justify-between gap-3 rounded-xl bg-surface-white ring-1 ring-hairline px-3 py-2">
                      <span className="text-sm font-bold text-slate-700">{label}</span>
                      <select
                        value={weekdays[dow] || ''}
                        onChange={(e) => setWeekday(dow, e.target.value)}
                        aria-label={`Dag-type voor ${label}`}
                        className="control-input rounded-xl px-2 py-1.5 text-sm font-bold outline-none max-w-[55%]"
                      >
                        <option value="">— geen —</option>
                        {dayTypeNames.map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
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
                      Vanaf een datum kan een ándere toewijzing gelden — bv. het schooljaar-regime vanaf 1 september. De recentste ingangsdatum vóór een dag wint; uitzonderingen hieronder gaan altijd voor.
                    </p>
                    <Button variant="secondary" size="sm" icon={<Plus size={13} />} className="shrink-0" onClick={addWeekdayPeriod}>
                      Periode
                    </Button>
                  </div>
                  {weekdayPeriods.map((p, i) => (
                    <div key={i} className="rounded-2xl border border-slate-100 bg-surface-field p-4 space-y-3">
                      <div className="flex items-center gap-2">
                        <MicroLabel className="text-slate-500">Vanaf</MicroLabel>
                        <input
                          type="date"
                          value={p.vanaf}
                          onChange={(e) => setPeriodVanaf(i, e.target.value)}
                          aria-label="Ingangsdatum van deze weekdag-toewijzing"
                          className="control-input rounded-xl px-3 py-2 text-sm font-bold outline-none"
                        />
                        <Button variant="ghost" size="sm" icon={<X size={15} />} className="ml-auto shrink-0 hover:text-red-700 hover:bg-red-50" aria-label="Periode verwijderen" onClick={() => removeWeekdayPeriod(i)} />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {WEEKDAY_ORDER.map(({ dow, label }) => (
                          <div key={dow} className="flex items-center justify-between gap-3 rounded-xl bg-surface-white ring-1 ring-hairline px-3 py-2">
                            <span className="text-sm font-bold text-slate-700">{label}</span>
                            <select
                              value={p.weekdays[dow] || ''}
                              onChange={(e) => setPeriodWeekday(i, dow, e.target.value)}
                              aria-label={`Dag-type voor ${label} vanaf ${p.vanaf || 'de ingangsdatum'}`}
                              className="control-input rounded-xl px-2 py-1.5 text-sm font-bold outline-none max-w-[55%]"
                            >
                              <option value="">— geen —</option>
                              {dayTypeNames.map((n) => <option key={n} value={n}>{n}</option>)}
                            </select>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                </>
                )}
              </div>

              {/* 3. Uitzonderingen */}
              <div className="border-t border-slate-100 pt-5 space-y-3">
                <button
                  type="button"
                  onClick={() => setUitzonderingenOpen((v) => !v)}
                  aria-expanded={uitzonderingenOpen}
                  className="flex min-h-11 w-full items-center justify-between gap-3 text-left"
                >
                  <div>
                    <MicroLabel className="text-slate-500">Uitzonderingen</MicroLabel>
                    <p className="text-xs font-medium text-slate-500 mt-0.5">
                      {overrides.length === 0 ? 'Nog geen uitzonderingen' : `${overrides.length} ingesteld${verlopenAantal > 0 ? ` · ${verlopenAantal} verlopen` : ''}`} — een periode die afwijkt van de weekdag-standaard.
                    </p>
                  </div>
                  <ChevronDown size={16} className={cn('shrink-0 text-slate-400 transition-transform', uitzonderingenOpen && 'rotate-180')} />
                </button>
                {uitzonderingenOpen && (
                <>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="min-w-0 text-xs font-medium text-slate-500">Bv. een schoolvakantie of feestdag (van = tot voor één dag). Chronologisch gesorteerd; verlopen uitzonderingen doen niets meer.</p>
                  <div className="flex shrink-0 gap-2">
                    {verlopenAantal > 0 && (
                      <Button variant="ghost" size="sm" onClick={ruimVerlopenOp}>
                        Ruim {verlopenAantal} verlopen op
                      </Button>
                    )}
                    <Button variant="secondary" size="sm" icon={<Plus size={13} />} onClick={addOverride}>
                      Uitzondering
                    </Button>
                  </div>
                </div>
                {overrides.length === 0 ? (
                  <p className="text-sm text-slate-500">Geen uitzonderingen — elke dag volgt de weekdag-standaard.</p>
                ) : (
                  <div className="space-y-2">
                    {gesorteerdeOverrides.map(({ o, i, verlopen }) => (
                      <div key={i} className="flex flex-wrap items-center gap-2">
                        <input type="date" value={o.from} onChange={(e) => updateOverride(i, 'from', e.target.value)} aria-label="Van" className="control-input rounded-xl px-3 py-2 text-sm font-bold outline-none" />
                        <span className="text-2xs font-bold text-slate-400">t/m</span>
                        <input type="date" value={o.to} onChange={(e) => updateOverride(i, 'to', e.target.value)} aria-label="Tot en met" className="control-input rounded-xl px-3 py-2 text-sm font-bold outline-none" />
                        <span className="text-slate-400 font-semibold">→</span>
                        <select value={o.dayType} onChange={(e) => updateOverride(i, 'dayType', e.target.value)} aria-label="Dag-type" className="control-input rounded-xl px-2 py-2 text-sm font-bold outline-none">
                          <option value="">— kies type —</option>
                          {dayTypeNames.map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                        {verlopen && <Badge tone="slate">Verlopen</Badge>}
                        <Button variant="ghost" size="sm" icon={<X size={15} />} className="shrink-0 hover:text-red-700 hover:bg-red-50" aria-label="Uitzondering verwijderen" onClick={() => removeOverride(i)} />
                      </div>
                    ))}
                  </div>
                )}
                </>
                )}
              </div>

              {/* 4. Kalender-voorzet: feestdagen + schoolvakanties in één klik */}
              <div className="border-t border-slate-100 pt-5 space-y-3">
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
                  <ChevronDown size={16} className={cn('shrink-0 text-slate-400 transition-transform', kalenderOpen && 'rotate-180')} />
                </button>
                {kalenderOpen && (
                <>
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
                    <div key={label} className="flex items-center justify-between gap-3 rounded-xl bg-surface-white ring-1 ring-hairline px-3 py-2">
                      <span className="text-sm font-bold text-slate-700">{label}</span>
                      <select
                        value={waarde}
                        onChange={(e) => zet(e.target.value)}
                        aria-label={`Dag-type voor ${label.toLowerCase()}`}
                        className="control-input rounded-xl px-2 py-1.5 text-sm font-bold outline-none max-w-[55%]"
                      >
                        <option value="">— overslaan —</option>
                        {dayTypeNames.map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                <Button variant="secondary" size="sm" icon={<CalendarPlus size={13} />} onClick={voegKalenderToe}>
                  Zet voor in de lijst
                </Button>
                </>
                )}
              </div>

              <p className="text-2xs font-medium text-slate-400">Vergeet niet op <span className="font-bold">Opslaan</span> te klikken.</p>
            </>
          )}
        </div>
      )}

      {/* Verwachtingen-vs-praktijk: structurele afwijkingen tussen de dag-
          type-lijsten en wat er echt gereden wordt. Zonder deze banner lezen
          die als "openstaande diensten" terwijl niemand ontbreekt (20-08). */}
      {expCheck.length > 0 && (
        <div className="rounded-3xl border border-amber-200 bg-amber-50/70 p-5 dark:border-amber-500/30 dark:bg-amber-500/10">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-amber-100 p-2 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"><AlertTriangle size={18} /></div>
            <div className="min-w-0">
              <MicroLabel className="text-amber-700 dark:text-amber-400">Verwachtingen wijken af van de planning</MicroLabel>
              <p className="mt-1 text-sm font-medium text-amber-900 dark:text-amber-200">
                Sommige dag-type-lijsten sporen niet met wat er deze maand echt gereden wordt — meestal een dienstregelingswissel die nog niet in de dekkingsinstellingen verwerkt is. Pas de lijsten aan via Instellen.
              </p>
              <VerwachtingAfwijkingLijst afwijkingen={expCheck} />
            </div>
          </div>
        </div>
      )}

      {/* === Gaten-overzicht === */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex items-center gap-2 text-sm">
          {totalMissing > 0 ? (
            <span className="inline-flex flex-wrap items-center gap-1.5 font-semibold text-red-600 tabular-nums">
              <AlertTriangle size={15} /> {totalMissing} niet-ingevulde {totalMissing === 1 ? 'dienst' : 'diensten'} deze maand
              {uitvalSplit.doorAfwezigheid > 0 && (
                <span className="font-medium text-slate-500">
                  — {uitvalSplit.zonderChauffeur > 0 ? `${uitvalSplit.zonderChauffeur} zonder chauffeur · ` : ''}{uitvalSplit.doorAfwezigheid} door afwezigheid{uitvalSplit.namen.length === 1 ? ` (${uitvalSplit.namen[0]})` : ` (${uitvalSplit.namen.length} chauffeurs)`}
                </span>
              )}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-600"><Check size={15} /> Alle verwachte diensten zijn ingevuld</span>
          )}
        </div>
        <label className="flex items-center gap-2 text-2xs font-bold text-slate-500 cursor-pointer select-none">
          <input type="checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} className="accent-oker-500" />
          Alleen dagen met gaten
        </label>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i}><SkeletonTile /></div>
          ))}
        </div>
      ) : !anyExpectations ? (
        <EmptyState
          mascotte={false}
          icon={<Settings2 size={28} />}
          title="Nog geen verwachte diensten ingesteld"
          message='Klik op "Instellen" en kies per dag-type welke diensten horen te draaien — daarna ziet dit scherm elke onbemande dienst.'
        />
      ) : visibleDays.length === 0 ? (
        <div className="surface-card p-6 md:p-8 rounded-3xl text-center">
          <p className="text-sm font-bold text-emerald-600">Geen openstaande diensten in {MONTH_NAMES[monthIndex].toLowerCase()} {year}.</p>
        </div>
      ) : (
        <div className="surface-card rounded-3xl overflow-hidden divide-y divide-slate-100">
          {visibleDays.map((d) => {
            const ok = d.missing.length === 0;
            return (
              <div key={d.date} className={cn('p-4 flex flex-col sm:flex-row sm:items-center gap-3', !ok && 'bg-red-50/40')}>
                <div className="sm:w-44 shrink-0">
                  <div className="text-sm font-semibold text-slate-800 capitalize tabular-nums">{dayLabel(d.date)}</div>
                  <div className="mt-1">
                    {/* Herkomst van het dag-type ("waarom is dit di/vrij?"):
                        tik/klik op de badge klapt de uitleg inline uit — een
                        title alleen zou op touch onzichtbaar zijn. -m-2/p-2 =
                        hit-slop zodat het doel raakbaar blijft zonder de rij
                        te laten groeien. */}
                    {bronUitleg(d.bron) ? (
                      <>
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
                          <p className="mt-1.5 max-w-[15rem] text-2xs font-medium leading-snug text-slate-500">{bronUitleg(d.bron)}</p>
                        )}
                      </>
                    ) : (
                      <Badge tone={d.dayType ? 'oker' : 'slate'} className="capitalize">{d.dayType || '—'}</Badge>
                    )}
                  </div>
                </div>
                <div className="shrink-0 sm:w-28">
                  <Badge tone={ok ? 'emerald' : 'red'} dot className="tabular-nums">{d.covered}/{d.expected} gedekt</Badge>
                </div>
                <div className="min-w-0 flex-1">
                  {ok ? (
                    <span className="text-xs font-medium text-emerald-600 inline-flex items-center gap-1"><Check size={13} /> volledig gedekt</span>
                  ) : (
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
                          ? 'text-rose-600 dark:text-rose-400'
                          : info?.reason === 'verlof'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : info?.reason === 'klein verlet'
                              ? 'text-blue-700 dark:text-blue-300'
                              : 'text-slate-600 dark:text-slate-300';
                        return (
                          <button
                            key={svc}
                            type="button"
                            onClick={() => setPick({ date: d.date, code: svc })}
                            title="Klik om te zien wie vrij is"
                            className="inline-flex min-h-9 max-w-full items-center gap-1.5 rounded-lg bg-red-100 text-red-800 px-2 py-1 text-2xs font-semibold ring-1 ring-red-200 hover:bg-red-200 hover:ring-red-300 transition-colors cursor-pointer dark:text-red-300"
                          >
                            <span className="tabular-nums">{svc}</span>
                            {info && (
                              <span className="flex min-w-0 items-baseline gap-1 font-medium">
                                <span className="min-w-0 truncate text-red-700/90 dark:text-red-300/80">· {info.name}</span>
                                <span className={cn('shrink-0', redenKleur)}>· {info.reason}</span>
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Advies voor het gekozen gat: wie is vrij én bij wie past de dienst? */}
      <Modal open={!!pick} onClose={() => setPick(null)} maxWidth="sm">
        {pick && (
          <div className="p-6">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <MicroLabel className="tabular-nums">Kandidaten voor dienst {pick.code}</MicroLabel>
                <h3 className="mt-0.5 text-lg font-bold tracking-tight text-slate-900 capitalize">{dayLabel(pick.date)}</h3>
                {advies && advies.segmenten.length > 0 && (
                  <p className="mt-0.5 text-xs font-semibold text-slate-500 tabular-nums">{segmentenLabel(advies.segmenten)}</p>
                )}
              </div>
              <button type="button" onClick={() => setPick(null)} aria-label="Sluiten" className="ios-pressable shrink-0 w-11 h-11 sm:pointer-fine:w-8 sm:pointer-fine:h-8 inline-flex items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700 transition-colors">
                <X size={16} />
              </button>
            </div>

            {pickLoading ? (
              <div className="mt-5 flex items-center gap-3 text-slate-500">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-slate-200 border-t-oker-500" />
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
                  <div className="rounded-2xl bg-oker-50/70 ring-1 ring-oker-100 px-4 py-3">
                    <MicroLabel className="text-oker-700">Advies</MicroLabel>
                    <p className="mt-1 text-sm font-semibold leading-snug text-slate-800">{advies.samenvatting}</p>
                  </div>

                  {advies.tijdenOnbekend && (
                    <p className="text-2xs font-semibold text-amber-800">
                      Dienst {pick.code} heeft geen tijden in het dienstoverzicht — de rustcheck kon niet, alleen de 6-dagenregel is toegepast.
                    </p>
                  )}

                  {passend.length > 0 ? (
                    <div>
                      <MicroLabel className="text-emerald-600 tabular-nums">Voorstel — {passend.length} passend</MicroLabel>
                      <div className="mt-2 flex flex-col gap-1.5">
                        {passend.map((k, i) => (
                          <div key={k.id} className="flex min-h-11 items-center gap-2 rounded-xl bg-emerald-50/70 ring-1 ring-emerald-100 px-3 py-2">
                            <UserCheck size={15} className="text-emerald-600 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5">
                                <span className="min-w-0 truncate text-sm font-bold text-slate-800">{k.name}</span>
                                {i === 0 && <Badge tone="oker" className="shrink-0">Advies</Badge>}
                              </div>
                              <p className="truncate text-2xs font-medium text-slate-500 tabular-nums">{kandidaatMeta(k)}</p>
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
                    <p className="text-sm font-medium text-slate-400">
                      Niemand bij wie deze dienst zonder meer past — hieronder wie wél vrij is, met wat er wringt.
                    </p>
                  )}

                  {/* Ruil in één stap — alleen berekend als niemand direct past.
                      Bewust advies-zonder-knop: de planner voert de ruil zelf
                      uit (Maandplanning) en wijst daarna het gat toe. */}
                  {passend.length === 0 && advies.kettingen.length > 0 && (
                    <div>
                      <MicroLabel className="text-oker-700 tabular-nums">Via een ruil — {advies.kettingen.length} {advies.kettingen.length === 1 ? 'optie' : 'opties'}</MicroLabel>
                      <div className="mt-2 flex flex-col gap-1.5">
                        {advies.kettingen.map((k) => (
                          <div key={`${k.vanId}-${k.naarId}`} className="rounded-xl bg-surface-field ring-1 ring-hairline px-3 py-2.5 text-sm font-medium text-slate-700">
                            <span className="font-bold">{k.naarNaam}</span> neemt dienst <span className="font-bold tabular-nums">{k.viaCode}</span> <span className="text-slate-500 tabular-nums">({k.viaTijden})</span> over van <span className="font-bold">{k.vanNaam}</span> — dan kan {k.vanNaam} dienst <span className="font-bold tabular-nums">{pick.code}</span> rijden. Beide schakels voldoen aan alle regels.
                          </div>
                        ))}
                      </div>
                      <p className="mt-1.5 text-2xs font-medium text-slate-400">Uitvoeren: zet de dienst over via de cel in de Maandplanning en wijs daarna dienst {pick.code} hier toe.</p>
                    </div>
                  )}

                  {nietPassend.length > 0 && (
                    <div>
                      <MicroLabel className="text-rose-700 tabular-nums">Vrij, maar past niet — {nietPassend.length}</MicroLabel>
                      <div className="mt-2 flex flex-col gap-1.5">
                        {nietPassend.map((k) => (
                          <div key={k.id} className="flex min-h-11 items-center gap-2 rounded-xl bg-rose-50/60 ring-1 ring-rose-100 px-3 py-2">
                            <UserX size={15} className="text-rose-500 shrink-0" />
                            <div className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-bold text-slate-800">{k.name}</span>
                              <p className="text-2xs font-medium text-rose-600 dark:text-rose-400">{k.redenen.join(' · ')}</p>
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

                  <p className="text-2xs font-medium text-slate-400">
                    Passend = die dag vrij, minstens {advies.minRustUren}u rust t.o.v. de aansluitende werkdagen, maximaal {advies.maxDagenNaElkaar} werkdagen na elkaar en geen schoolvervoerchauffeur. Kortste reeks werkdagen bovenaan, daarna wie dit jaar het minst inviel; toewijzen zet de dienst meteen in de planning en meldt het aan de chauffeur.
                  </p>
                </div>
              );
            })()}
          </div>
        )}
      </Modal>

      <ConfirmationModal
        isOpen={!!assignConfirm}
        onClose={() => setAssignConfirm(null)}
        onConfirm={() => { const k = assignConfirm; setAssignConfirm(null); if (k) void wijsToe(k); }}
        title="Dienst toewijzen?"
        message={pick && assignConfirm
          ? `Dienst ${pick.code} op ${dayLabel(pick.date)} wordt toegewezen aan ${assignConfirm.name}.${assignConfirm.redenen.length > 0 ? ` Let op — dit wijkt af van het advies: ${assignConfirm.redenen.join(', en ')}.` : ''} De planning wordt meteen bijgewerkt en de chauffeur krijgt een melding.`
          : ''}
        confirmText="Toewijzen"
        cancelText="Annuleren"
        variant="warning"
      />
    </PageShell>
  );
}
