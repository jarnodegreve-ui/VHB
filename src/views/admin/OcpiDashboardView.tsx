import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { AlertTriangle, Zap, BatteryCharging, ChevronLeft, ChevronRight, Gauge, RefreshCw, X } from 'lucide-react';
import { cn, getSupabaseAuthHeaders } from '../../lib/ui';
import { busVoorLaadpunt } from '../../lib/laadplein';
import { isoDate } from '../../lib/availability';
import { MONTH_NAMES, WEEKDAY_SHORT_SUN, formatGetal } from '../../lib/format';
import { Modal } from '../../components/Modal';
import { PageHeader, PageShell, AdminSubsectionHeader, EmptyState } from '../../components/ui';
import { OpsStat } from '../../components/ops';
import { SkeletonTile } from '../../components/Skeleton';
import { Badge, Button, MicroLabel, microLabelClass, segItemClass, type BadgeTone } from '../../components/primitives';

/** Termijn-schakelaar in exact de app-standaard segmented-maat (rail
 *  rounded-2xl p-1, knop-klassen uit `segItemClass` — zie ScheduleView,
 *  Dienstoverzicht, Gebruikersbeheer). Stond hier eerst als eigen mini-variant
 *  van 24 px hoog — te klein als raakvlak én de enige afwijkende toggle. */
function TermijnKeuze<T extends string>({ label, waarde, opties, onKies }: { label: string; waarde: T; opties: Array<{ id: T; label: string }>; onKies: (t: T) => void }) {
  return (
    <div role="group" aria-label={label} className="glass-segmented inline-flex shrink-0 rounded-2xl p-1">
      {opties.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onKies(o.id)}
          aria-pressed={waarde === o.id}
          className={segItemClass(waarde === o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Kleinste "mooie" as-top ≥ max (1/1.5/2/2.5/3/4/5/6/8 × 10^n): zo staan de
 *  gridlijnen op ronde getallen en betekent dezelfde staafhoogte niet elke
 *  dag iets anders (de schaal was voorheen data-relatief). */
function mooiMax(max: number): number {
  if (!Number.isFinite(max) || max <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(max)));
  for (const f of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
    if (max <= f * p) return f * p;
  }
  return 10 * p;
}

/** Hairline-gridlijnen mét waarde-labels achter een grafiek — het verschil
 *  tussen "een blokje" en een afleesbaar instrument. Render in een
 *  `relative` wrapper; de labels hangen nét onder hun lijn. */
function GridLijnen({ top, eenheid }: { top: number; eenheid: string }) {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden="true">
      {[1, 0.5].map((f) => (
        <div key={f} className="absolute inset-x-0" style={{ bottom: `${f * 100}%` }}>
          <div className="border-t border-slate-200/80 dark:border-white/10" />
          {/* Dekkend chipje op kaartkleur: zonder achtergrond liep het label
              dwars door staven/curve en werd het onleesbaar. */}
          <span
            className="absolute right-0 top-0.5 z-10 rounded px-1 py-0.5 text-2xs font-medium font-mono tabular-nums leading-none text-slate-400 dark:text-slate-500"
            style={{ background: 'var(--tile-bg)' }}
          >
            {formatGetal(top * f)} {eenheid}
          </span>
        </div>
      ))}
    </div>
  );
}

type Connector = { id: string; standard?: string; power_type?: string; max_electric_power?: number };
type Evse = { uid: string; evse_id?: string; status?: string; physical_reference?: string | null; connectors: Connector[] };

/** Groepeer laadpunten per CPU (het fysieke station): het uid-voorvoegsel
 *  vóór het laatste "-N" identificeert het station. Het CPU-nummer komt uit
 *  de physical_reference ("CPU3 sat1.1" → 3, "mal.1.5" → 1, "2.7" → 2);
 *  zonder herkenbaar nummer valt de groep terug op "Station N". */
function groepeerPerCpu<T extends { uid: string; evse_id?: string; physical_reference?: string | null }>(evses: T[]): Array<{ key: string; label: string; evses: T[] }> {
  const groepen = new Map<string, T[]>();
  for (const e of evses) {
    const key = String(e.uid ?? '').replace(/-\d+$/, '') || 'onbekend';
    groepen.set(key, [...(groepen.get(key) ?? []), e]);
  }
  const cpuNummer = (lijst: T[]): number | null => {
    for (const e of lijst) {
      const ref = String(e.physical_reference ?? '');
      const cpu = /cpu\s*(\d+)/i.exec(ref);
      if (cpu) return Number(cpu[1]);
      const leidend = /^(?:[a-z]+\.)?(\d+)\./i.exec(ref);
      if (leidend) return Number(leidend[1]);
    }
    return null;
  };
  // Laadpunt-nummers natuurlijk sorteren: 1, 2, … 12.A, 12.B (niet "1", "10", "11").
  const nummerKey = (e: T): [number, string] => {
    const m = /^(\d+)(?:\.(.+))?$/.exec(String(e.evse_id ?? ''));
    return m ? [Number(m[1]), m[2] ?? ''] : [Number.MAX_SAFE_INTEGER, String(e.evse_id ?? e.uid)];
  };
  const kolommen = [...groepen.entries()]
    .map(([key, lijst], i) => {
      const nr = cpuNummer(lijst);
      return {
        key,
        label: nr !== null ? `CPU ${nr}` : `Station ${i + 1}`,
        volgorde: nr ?? 90 + i,
        evses: [...lijst].sort((a, b) => {
          const [an, as] = nummerKey(a);
          const [bn, bs] = nummerKey(b);
          return an - bn || as.localeCompare(bs);
        }),
      };
    })
    .sort((a, b) => a.volgorde - b.volgorde)
    .map(({ key, label, evses: lijst }) => ({ key, label, evses: lijst }));
  // Twee stations die op hetzelfde CPU-nummer uitkomen (rommelige
  // physical_reference) kregen identieke koppen — nummer ze dan door.
  const gezien = new Map<string, number>();
  for (const kolom of kolommen) {
    const n = (gezien.get(kolom.label) ?? 0) + 1;
    gezien.set(kolom.label, n);
    if (n > 1) kolom.label = `${kolom.label} (${n})`;
  }
  return kolommen;
}
type DashLocation = { id: string; name?: string; city?: string; evses: Evse[] };
type ActiveSession = { id: string; evse_uid?: string; location_id?: string; status?: string; start_date_time?: string; kwh?: number; powerKw?: number | null; soc?: number | null };
type Dashboard = {
  totals: { evses: number; sessions30d: number; totalPowerKw: number };
  statusCounts: Record<string, number>;
  locations: DashLocation[];
  activeSessions: ActiveSession[];
  kwhPerDay: Array<{ date: string; kwh: number; sessions: number }>;
  /** Ruwe kwartier-slots van de laatste 24 uur (capaciteitstarief-maat). */
  powerCurve: Array<{ ts: string; kw: number; charging: number }>;
  /** Dágpieken (Brusselse kalenderdag) van de laatste 31 dagen — server-side
   *  bepaald zodat de dag-grens niet verschuift tussen UTC en lokaal. */
  powerDays?: Array<{ date: string; kw: number; ts: string; charging: number }>;
  storingen?: Array<{ soort: 'laadpunt' | 'sessie'; evseUid: string | null; status?: string; classificatie?: string; wanneer: string | null }>;
};

/** Antwoord van GET /api/ocpi/verbruik. `maand` is gezet als de periode
 *  precies een kalendermaand is. */
type Verbruik = {
  van: string;
  tot: string;
  maand: string | null;
  eersteDag: string | null;
  huidigeDag: string;
  totaalKwh: number;
  totaalSessies: number;
  punten: Array<{ evseUid: string; evseId: string | null; physicalReference: string | null; kwh: number; sessies: number }>;
};
/** Wat de gebruiker koos: een kalendermaand (‹ ›) of een vrije periode van/tot. */
type PeriodeKeuze = { modus: 'maand'; maand: string } | { modus: 'periode'; van: string; tot: string };
/** "YYYY-MM" ± n maanden — zuiver op de string, zonder tijdzone-gedoe. */
const maandPlus = (maand: string, delta: number): string => {
  const [j, m] = maand.split('-').map(Number);
  const d = new Date(Date.UTC(j, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const maandLabel = (maand: string): string => {
  const [j, m] = maand.split('-').map(Number);
  return `${MONTH_NAMES[m - 1] ?? maand} ${j}`;
};
const dagMaand = (dag: string) => `${Number(dag.slice(8, 10))} ${(MONTH_NAMES[Number(dag.slice(5, 7)) - 1] ?? '').toLowerCase()}`;
/** "Augustus 2026" · "4 augustus 2026" · "4–5 augustus 2026" · "28 juli – 5 augustus 2026". */
const periodeLabel = (v: Pick<Verbruik, 'van' | 'tot' | 'maand'>): string => {
  if (v.maand) return maandLabel(v.maand);
  const jaar = v.tot.slice(0, 4);
  if (v.van === v.tot) return `${dagMaand(v.van)} ${jaar}`;
  if (v.van.slice(0, 7) === v.tot.slice(0, 7)) return `${Number(v.van.slice(8, 10))}–${dagMaand(v.tot)} ${jaar}`;
  if (v.van.slice(0, 4) === jaar) return `${dagMaand(v.van)} – ${dagMaand(v.tot)} ${jaar}`;
  return `${dagMaand(v.van)} ${v.van.slice(0, 4)} – ${dagMaand(v.tot)} ${jaar}`;
};
/** Hele kWh met Belgisch duizendtal ("6.559"): tienden zeggen niets op dit niveau. */
const fmtKwh = (kwh: number) => formatGetal(Math.round(kwh));
/** kW / kWh in Belgische notatie met max. 2 cijfers na de komma (verzoek
 *  Jarno 27-08: ChargEye levert tot vijf decimalen). Eén plek voor de hele
 *  pagina — ook titles en aria-labels. */
const tekstKw = (v: number) => `${formatGetal(v)} kW`;
const tekstKwh = (v: number) => `${formatGetal(v)} kWh`;

const STATUS_LABEL: Record<string, string> = {
  AVAILABLE: 'Beschikbaar', CHARGING: 'Laden', RESERVED: 'Gereserveerd', BLOCKED: 'Geblokkeerd',
  INOPERATIVE: 'Buiten dienst', OUTOFORDER: 'Storing', PLANNED: 'Gepland', REMOVED: 'Verwijderd', UNKNOWN: 'Onbekend',
};
const statusTone = (s?: string): BadgeTone => {
  switch ((s ?? '').toUpperCase()) {
    case 'AVAILABLE': return 'emerald';
    case 'CHARGING': return 'blue';
    case 'RESERVED': return 'amber';
    case 'BLOCKED': case 'INOPERATIVE': case 'OUTOFORDER': return 'red';
    default: return 'slate';
  }
};
const statusLabel = (s?: string) => STATUS_LABEL[(s ?? '').toUpperCase()] ?? (s ?? 'Onbekend');

/** Eén bron voor de rijstructuur van een laadpunt (verzoek Jarno 07-08):
 *  laadpunt · bus · SoC-pil · statuspil. "Vol" is 100% batterij óf laden
 *  zónder vermogen (de bus druppelt niet meer na) — dan zegt "Laden voltooid"
 *  meer dan "0 kW". Zonder sessie is er geen label en valt de rij terug op de
 *  gewone status ("Beschikbaar", "Storing", …). */
const laadStatus = (status: string | undefined, sessie?: { soc?: number | null; powerKw?: number | null } | null) => {
  const soc = typeof sessie?.soc === 'number' ? sessie.soc : null;
  const kw = typeof sessie?.powerKw === 'number' ? sessie.powerKw : null;
  const laadt = (status ?? '').toUpperCase() === 'CHARGING';
  const vol = Boolean(sessie) && ((soc ?? 0) >= 100 || (laadt && kw !== null && kw <= 0));
  const label = !sessie
    ? null
    : vol
      ? 'Laden voltooid'
      : laadt && kw !== null && kw > 0
        ? `Laden · ${Math.round(kw)} kW`
        : null;
  return { soc, kw, laadt, vol, label };
};
const maxVermogen = (w?: number) => (typeof w === 'number' ? tekstKw(w / 1000) : '—');

export function OcpiDashboardView() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/ocpi/dashboard', { headers: await getSupabaseAuthHeaders() });
      if (!response.ok) throw new Error(String(response.status));
      setData(await response.json());
      setError(null);
    } catch {
      setError('Kon de OCPI-gegevens niet laden.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  // Verbruik per laadpunt (verzoek Jarno 27-08): eigen endpoint met
  // periodekeuze — een kalendermaand (‹ ›-navigatie) of een vrije periode
  // van/tot (bv. 4–5 augustus). null = "lopende maand" (de server bepaalt
  // die in Brusselse tijd). De herlaad-teller hangt aan de Ververs-knop
  // zodat die ook deze kaart ververst. De actueel-vlag voorkomt dat een traag
  // antwoord van een vorige keuze een snelle van de volgende overschrijft.
  const [keuze, setKeuze] = useState<PeriodeKeuze | null>(null);
  const [verbruik, setVerbruik] = useState<Verbruik | null>(null);
  const [verbruikLaadt, setVerbruikLaadt] = useState(false);
  const [verbruikFout, setVerbruikFout] = useState<string | null>(null);
  const [herlaad, setHerlaad] = useState(0);
  useEffect(() => {
    let actueel = true;
    (async () => {
      setVerbruikLaadt(true);
      try {
        const query = !keuze ? '' : keuze.modus === 'maand' ? `?maand=${keuze.maand}` : `?van=${keuze.van}&tot=${keuze.tot}`;
        const response = await fetch(`/api/ocpi/verbruik${query}`, { headers: await getSupabaseAuthHeaders() });
        if (!response.ok) throw new Error(String(response.status));
        const json = (await response.json()) as Verbruik;
        if (actueel) { setVerbruik(json); setVerbruikFout(null); }
      } catch {
        if (actueel) setVerbruikFout('Kon het verbruik per laadpunt niet laden.');
      } finally {
        if (actueel) setVerbruikLaadt(false);
      }
    })();
    return () => { actueel = false; };
  }, [keuze, herlaad]);
  const vandaag = isoDate(new Date());
  const periodeModus = keuze?.modus ?? 'maand';
  // In maand-modus: de gekozen maand, anders wat de server toonde.
  const maandGekozen = keuze?.modus === 'maand' ? keuze.maand : (verbruik?.maand ?? verbruik?.van.slice(0, 7) ?? vandaag.slice(0, 7));
  const periodeGekozen = keuze?.modus === 'periode' ? keuze : { van: verbruik?.van ?? `${vandaag.slice(0, 7)}-01`, tot: verbruik?.tot ?? vandaag };
  const wisselModus = (m: 'maand' | 'periode') => {
    if (m === periodeModus) return;
    // Periode start op wat nu in beeld staat (de maand, geknipt op vandaag)
    // zodat je alleen de dagen bijstelt; terug naar maand = de maand van de
    // begindag.
    setKeuze(m === 'periode'
      ? { modus: 'periode', van: periodeGekozen.van, tot: periodeGekozen.tot > vandaag ? vandaag : periodeGekozen.tot }
      : { modus: 'maand', maand: periodeGekozen.van.slice(0, 7) });
  };
  // Datumvelden: 'van' voorbij 'tot' schuift 'tot' mee (en omgekeerd); een
  // gewist veld (lege waarde uit de picker) wordt genegeerd.
  const zetVan = (v: string) => { if (v) setKeuze({ modus: 'periode', van: v, tot: v > periodeGekozen.tot ? v : periodeGekozen.tot }); };
  const zetTot = (t: string) => { if (t) setKeuze({ modus: 'periode', van: t < periodeGekozen.van ? t : periodeGekozen.van, tot: t }); };

  // Termijn-schakelaars (verzoek Jarno 05-08). Verbruik telt per dag, dus
  // daar is 24u geen zinnige stap; bij het vermogen tonen 7d/maand de
  // DÁGPIEK per dag — dat is het getal dat voor het capaciteitstarief telt.
  const [verbruikTermijn, setVerbruikTermijn] = useState<'7d' | '30d' | 'maand'>('30d');
  const [vermogenTermijn, setVermogenTermijn] = useState<'24u' | '7d' | 'maand'>('24u');
  const uurLabel = (ts: string) => new Date(ts).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
  const maandStart = () => { const nu = new Date(); return `${nu.getFullYear()}-${String(nu.getMonth() + 1).padStart(2, '0')}-01`; };

  // Smal scherm (telefoon): dunt de maand-aslabels uit tot elke tweede maandag,
  // anders lopen de datums in elkaar. De 24u-reeks wordt níét meer samengevoegd
  // tot uur-staven — sinds de veeg-selectie is elk kwartier gewoon aanwijsbaar.
  const [smalScherm, setSmalScherm] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 640px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 640px)');
    const luister = (e: MediaQueryListEvent) => setSmalScherm(e.matches);
    mq.addEventListener('change', luister);
    return () => mq.removeEventListener('change', luister);
  }, []);

  // Doorlopende reeks voor de kolomgrafiek: dagen zonder sessies worden 0
  // in plaats van weggelaten, anders schuiven de kolommen en klopt het
  // ritme (weekend vs. week) niet meer. De reeks loopt van maandstart óf 30
  // dagen terug (wat het vroegst is) — een vaste 30-dagen-reeks miste dag 1
  // in maanden van 31 dagen.
  const grafiek = useMemo(() => {
    const perDag = new Map((data?.kwhPerDay ?? []).map((d) => [d.date, d]));
    const dagInMaand = new Date().getDate();
    const terug = Math.max(29, dagInMaand - 1);
    const alle: Array<{ date: string; kwh: number; sessions: number; dow: number }> = [];
    for (let i = terug; i >= 0; i--) {
      const dt = new Date();
      dt.setDate(dt.getDate() - i);
      const iso = isoDate(dt);
      const rij = perDag.get(iso);
      alle.push({ date: iso, kwh: rij?.kwh ?? 0, sessions: rij?.sessions ?? 0, dow: dt.getDay() });
    }
    const dagen = verbruikTermijn === '7d' ? alle.slice(-7)
      : verbruikTermijn === 'maand' ? alle.filter((d) => d.date >= maandStart())
      : alle.slice(-30);
    const max = Math.max(1, ...dagen.map((d) => d.kwh));
    const totaal = Math.round(dagen.reduce((a, d) => a + d.kwh, 0) * 10) / 10;
    const actieveDagen = dagen.filter((d) => d.kwh > 0).length;
    const gemiddeld = actieveDagen > 0 ? Math.round((totaal / actieveDagen) * 10) / 10 : 0;
    return { dagen, max, totaal, gemiddeld, piek: Math.max(0, ...dagen.map((d) => d.kwh)) };
  }, [data?.kwhPerDay, verbruikTermijn]);
  // Vast 30-dagen-totaal voor de KPI-tegel, onafhankelijk van de gekozen
  // grafiektermijn — de tegel zei "30 d" maar toonde het termijn-totaal.
  const kwh30 = useMemo(() => Math.round((data?.kwhPerDay ?? []).reduce((a, d) => a + d.kwh, 0)), [data?.kwhPerDay]);

  // Vermogen: 24u = de ruwe kwartier-slots op élk scherm — op de telefoon
  // is de step-lijn als lijn prima leesbaar, en de veeg-selectie (zie
  // kiesSlotOpX) maakt elk kwartier aanwijsbaar zonder 96 mini-tikvlakken.
  // 7d/maand = één staaf per dag met de server-side bepaalde dágpiek.
  const vermogen = useMemo(() => {
    if (vermogenTermijn === '24u') {
      const punten = (data?.powerCurve ?? []).map((pt) => ({ ts: pt.ts, kw: pt.kw, charging: pt.charging }));
      const maxKw = Math.max(1, ...punten.map((pt) => pt.kw));
      const piek = punten.reduce((best, pt) => (pt.kw > best.kw ? pt : best), { ts: '', kw: 0, charging: 0 });
      const staven = punten.map((pt) => ({ key: pt.ts, ts: pt.ts, kw: pt.kw, charging: pt.charging, isPiek: pt.ts === piek.ts && pt.kw > 0, asLabel: '' }));
      return { modus: 'slots' as const, staven, maxKw, piekKw: piek.kw, piekTs: piek.ts, piekWanneer: piek.ts ? `om ${uurLabel(piek.ts)}` : '' };
    }
    const vanaf = vermogenTermijn === '7d'
      ? isoDate(new Date(Date.now() - 6 * 24 * 3600 * 1000))
      : maandStart();
    let maandagTeller = 0;
    const staven = (data?.powerDays ?? [])
      .filter((d) => d.date >= vanaf)
      .map((d) => {
        const dow = new Date(`${d.date}T00:00:00`).getDay();
        if (dow === 1) maandagTeller += 1;
        return {
          key: d.date, ts: d.ts, kw: d.kw, charging: d.charging, isPiek: false,
          // Maand-as: alleen (op smal scherm elke twééde) maandag een dagnummer
          // — 31 labels van twee cijfers passen niet op 320 px.
          asLabel: vermogenTermijn === '7d'
            ? WEEKDAY_SHORT_SUN[dow]
            : dow === 1 && (!smalScherm || maandagTeller % 2 === 1) ? String(Number(d.date.slice(8))) : '',
        };
      });
    const maxKw = Math.max(1, ...staven.map((st) => st.kw));
    const piek = staven.reduce((best, st) => (st.kw > best.kw ? st : best), { key: '', kw: 0, ts: '', charging: 0, isPiek: false, asLabel: '' });
    for (const st of staven) st.isPiek = st.key === piek.key && st.kw > 0;
    const piekDagLabel = piek.key ? new Date(`${piek.key}T00:00:00`).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
    return { modus: 'dagen' as const, staven, maxKw, piekKw: piek.kw, piekTs: piek.ts, piekWanneer: piek.key ? `op ${piekDagLabel}` : '' };
  }, [data?.powerCurve, data?.powerDays, vermogenTermijn, smalScherm]);
  // De hoogste dágpiek van de laatste ±31 dagen — hét capaciteitstarief-getal.
  // In de 24u-grafiek staat hij als gestippelde referentielijn: zo zie je in
  // één oogopslag of de curve van vandaag de maandpiek nadert.
  const maandpiek = useMemo(() => Math.max(0, ...(data?.powerDays ?? []).map((d) => d.kw)), [data?.powerDays]);
  // Tik-selectie op de grafiekstaven: op een telefoon is er geen hover-title,
  // dus een tik op een staaf toont de details in de samenvattingsregel.
  const [gekozenDag, setGekozenDag] = useState<string | null>(null);
  const [gekozenSlot, setGekozenSlot] = useState<string | null>(null);

  // Veeg-selectie (touch) over de 24u-curve: sleep met je vinger en de
  // uitlezing eronder springt per kwartier mee (à la de iOS-batterijgrafiek).
  // touch-action: pan-y op de container laat verticaal scrollen met rust;
  // horizontale bewegingen komen hier binnen. De vlag onderdrukt de click
  // van het onderliggende tik-vlak, anders zou die de net gekozen selectie
  // meteen weer omschakelen.
  const scrubActief = useRef(false);
  const scrubStart = useRef<{ vooraf: string | null; bewogen: boolean; x: number }>({ vooraf: null, bewogen: false, x: 0 });
  /**
   * Handlers voor één grafiekvlak. Werkt op elke reeks even brede vakken, dus
   * naast de 24u-curve ook op de dag-staven: bij 31 dagen op een telefoon is
   * een staaf ~10 px en tik je anders altijd de buurdag aan. Eén gedeelde ref
   * volstaat — er is maar één vinger tegelijk in één grafiek.
   */
  const scrubHandlers = (items: Array<{ key: string }>, huidig: string | null, zet: (key: string | null) => void) => {
    const kiesOpX = (clientX: number, el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || items.length === 0) return null;
      const frac = Math.min(0.999, Math.max(0, (clientX - r.left) / r.width));
      const key = items[Math.floor(frac * items.length)].key;
      zet(key);
      return key;
    };
    return {
      onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
        if (e.pointerType !== 'touch') return;
        scrubActief.current = true;
        scrubStart.current = { vooraf: huidig, bewogen: false, x: e.clientX };
        kiesOpX(e.clientX, e.currentTarget);
      },
      onPointerMove: (e: ReactPointerEvent<HTMLElement>) => {
        if (e.pointerType !== 'touch' || !scrubActief.current) return;
        if (Math.abs(e.clientX - scrubStart.current.x) > 6) scrubStart.current.bewogen = true;
        kiesOpX(e.clientX, e.currentTarget);
      },
      onPointerUp: (e: ReactPointerEvent<HTMLElement>) => {
        if (e.pointerType !== 'touch') return;
        // Korte tik (geen veeg) op het al gekozen vak = deselecteren — zelfde
        // toggle als de muis-klik.
        if (!scrubStart.current.bewogen) {
          const key = kiesOpX(e.clientX, e.currentTarget);
          if (key && key === scrubStart.current.vooraf) zet(null);
        }
        // Ná de click-afhandeling van het tik-vlak weer vrijgeven.
        window.setTimeout(() => { scrubActief.current = false; }, 50);
      },
      onPointerCancel: () => {
        // De browser claimt de gesture (verticaal scrollen na een aanraking op
        // de grafiek). Wat de vinger onderweg aanwees was dan geen keuze: zet
        // de selectie terug zoals ze vóór de aanraking stond.
        zet(scrubStart.current.vooraf);
        window.setTimeout(() => { scrubActief.current = false; }, 50);
      },
    };
  };
  // Detail-popup per laadpunt (tik op een rij): daar wonen de technische
  // gegevens zoals het maximale vermogen — die stonden inline maar zijn
  // dagelijks ruis (verzoek Jarno 05-08).
  const [gekozenPunt, setGekozenPunt] = useState<Evse | null>(null);
  // Storingen-lijst: standaard de 5 recentste, de rest achter "Toon alles".
  // ??-guard: een oudere API-respons (uit de PWA-cache of tijdens een deploy)
  // mist het veld en gaf anders een witte pagina.
  const [alleStoringen, setAlleStoringen] = useState(false);
  const storingen = data?.storingen ?? [];
  // uid → laadpunt-nummer, zodat sessiekaarten "13.A" tonen i.p.v. de rauwe
  // ChargEye-uid ("CSrh1AH0aNN-3").
  const nummerByUid = useMemo(() => {
    const map = new Map<string, string>();
    for (const loc of data?.locations ?? []) {
      for (const e of loc.evses) if (e.evse_id) map.set(e.uid, e.evse_id);
    }
    return map;
  }, [data?.locations]);
  const sessieByEvse = useMemo(
    () => new Map((data?.activeSessions ?? []).filter((x) => x.evse_uid).map((x) => [String(x.evse_uid), x])),
    [data?.activeSessions],
  );
  // KPI-afgeleiden: de status-telling gecomprimeerd tot wat operationeel
  // telt. Alles wat niet beschikbaar/ladend is, is afwijkend — meestal 0,
  // en dan hoort de tegel stil (slate) te zijn, geen loos alarm.
  const kpi = useMemo(() => {
    const sc = data?.statusCounts ?? {};
    const laden = sc.CHARGING ?? 0;
    const beschikbaar = sc.AVAILABLE ?? 0;
    const afwijkend = Object.entries(sc).filter(([st]) => st !== 'AVAILABLE' && st !== 'CHARGING');
    const afwijkendTotaal = afwijkend.reduce((a, [, n]) => a + Number(n), 0);
    const afwijkendTekst = afwijkend
      .sort((a, b) => Number(b[1]) - Number(a[1]))
      .map(([st, n]) => `${n}× ${statusLabel(st).toLowerCase()}`)
      .join(' · ');
    return { laden, beschikbaar, afwijkend: afwijkendTotaal, afwijkendTekst };
  }, [data?.statusCounts]);

  return (
    <PageShell width="5xl">
      <PageHeader
        eyebrow="Laadinfrastructuur"
        title="Laadpalen (OCPI)"
        description="Read-only monitoring van de Kempower-laadpalen via ChargEye."
        actions={(
          <Button variant="secondary" onClick={() => { load(); setHerlaad((n) => n + 1); }} disabled={isLoading}>
            <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
            <span className="ml-1.5">Ververs</span>
          </Button>
        )}
      />

      {error && (
        <div className="p-4 rounded-2xl text-sm font-semibold bg-red-50 text-red-700 border border-red-100">{error}</div>
      )}

      {isLoading && !data && !error && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i}><SkeletonTile /></div>
          ))}
        </div>
      )}

      {data && (
        <div className="space-y-6">
          {/* KPI-rij — vier tegels die állemaal iets operationeels zeggen.
              "Locaties: 1" en "Connectoren: 24" stonden hier eerst, maar die
              veranderen nooit; de status-badges-kaart is in de rij opgegaan.
              OpsStat i.p.v. StatCard (vaste regel): de vaste twee-regel-
              labelzone houdt cijfers en subteksten op één lijn. */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <OpsStat
              icon={<BatteryCharging size={16} />}
              tone={kpi.laden > 0 ? 'blue' : 'slate'}
              label="Aan de lader"
              text={`${kpi.laden} / ${data.totals.evses}`}
              sub={data.totals.totalPowerKw > 0 ? `${tekstKw(data.totals.totalPowerKw)} nu` : 'geen vermogen nu'}
            />
            <OpsStat
              icon={<Zap size={16} />}
              tone="slate"
              label="Beschikbaar"
              value={kpi.beschikbaar}
              sub="vrije laadpunten"
            />
            <OpsStat
              icon={<AlertTriangle size={16} />}
              tone={kpi.afwijkend > 0 ? 'red' : 'slate'}
              label="Afwijkend"
              value={kpi.afwijkend}
              sub={kpi.afwijkend > 0 ? kpi.afwijkendTekst : 'alles operationeel'}
            />
            <OpsStat
              icon={<Gauge size={16} />}
              tone="slate"
              label="Vandaag geladen"
              text={tekstKwh(Math.round(grafiek.dagen.at(-1)?.kwh ?? 0))}
              sub={`30 d: ${tekstKwh(kwh30)} · ${data.totals.sessions30d} sessies`}
            />
          </div>

          {/* Grafieken naast elkaar op desktop (gestapeld op mobiel):
              verbruik per dag + vermogen 24u horen als paar gelezen te
              worden — hoevéél er geladen is en wannéér het trekt. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* kWh per dag — compacte kolomgrafiek: 30 dagen naast elkaar in een
              vast laag blok i.p.v. één rij per dag (dat werd een muur van 30
              regels). Ontbrekende dagen tellen als 0 zodat het weekritme
              klopt; maandagen krijgen een dagnummer als anker. */}
          <div className="surface-card p-6 rounded-3xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <MicroLabel>Verbruik (kWh)</MicroLabel>
              <TermijnKeuze
                label="Termijn verbruiksgrafiek"
                waarde={verbruikTermijn}
                opties={[{ id: '7d', label: '7 d' }, { id: '30d', label: '30 d' }, { id: 'maand', label: 'maand' }]}
                onKies={(t) => { setVerbruikTermijn(t); setGekozenDag(null); }}
              />
            </div>
            {data.kwhPerDay.length === 0 ? (
              <p className="text-sm text-slate-500">Nog geen sessies gesynchroniseerd.</p>
            ) : (
              <>
                {/* Rol img + samenvatting: VoiceOver leest zo één zin i.p.v.
                    30 losse staaf-knoppen af te lopen. De staven zelf blijven
                    tikbaar maar vallen buiten de focus-volgorde; de details
                    komen in de samenvattingsregel eronder. Kleuren zonder
                    opacity-tinten (contrast ≥ 3:1) en oker betekent in beide
                    grafieken hetzelfde: de piek. */}
                {(() => {
                  const asTop = mooiMax(grafiek.max);
                  return (
                    <div
                      role="img"
                      aria-label={`Verbruik per dag: totaal ${tekstKwh(Math.round(grafiek.totaal))}, gemiddeld ${tekstKwh(grafiek.gemiddeld)} per laaddag, piek ${tekstKwh(Math.round(grafiek.piek))}`}
                      className="relative h-28 touch-pan-y"
                      {...scrubHandlers(grafiek.dagen.map((d) => ({ key: d.date })), gekozenDag, setGekozenDag)}
                    >
                      <GridLijnen top={asTop} eenheid="kWh" />
                      <div className="flex h-full items-end gap-[3px]">
                        {grafiek.dagen.map((d) => {
                          const gekozen = gekozenDag === d.date;
                          const isPiek = d.kwh > 0 && d.kwh === grafiek.piek;
                          return (
                            <button
                              key={d.date}
                              type="button"
                              tabIndex={-1}
                              aria-hidden="true"
                              onClick={() => { if (scrubActief.current) return; setGekozenDag(gekozen ? null : d.date); }}
                              title={`${d.date.slice(5)} · ${tekstKwh(d.kwh)} · ${d.sessions} sessie${d.sessions === 1 ? '' : 's'}`}
                              className="flex h-full flex-1 cursor-pointer flex-col justify-end"
                            >
                              <div
                                className={gekozen ? 'w-full rounded-t-[3px] bg-slate-900 dark:bg-white' : isPiek ? 'w-full rounded-t-[3px] bg-oker-600 dark:bg-oker-500' : 'w-full rounded-t-[3px] bg-slate-500 dark:bg-slate-400'}
                                style={{ height: d.kwh > 0 ? `${Math.max(3, Math.round((d.kwh / asTop) * 100))}%` : '2px' }}
                              />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
                <div className="mt-1 flex min-h-4 gap-[3px]" aria-hidden="true">
                  {grafiek.dagen.map((d) => (
                    <span key={d.date} className="flex-1 text-center text-2xs font-medium font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {grafiek.dagen.length <= 7 ? WEEKDAY_SHORT_SUN[d.dow] : d.dow === 1 ? Number(d.date.slice(8)) : ''}
                    </span>
                  ))}
                </div>
                {(() => {
                  const dag = grafiek.dagen.find((d) => d.date === gekozenDag);
                  return dag ? (
                    <p className="mt-2 min-h-4 truncate text-2xs font-semibold font-mono tabular-nums text-slate-700 dark:text-slate-200">
                      {new Date(`${dag.date}T00:00:00`).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' })} · {tekstKwh(dag.kwh)} · {dag.sessions} sessie{dag.sessions === 1 ? '' : 's'}
                    </p>
                  ) : (
                    <p className="mt-2 min-h-4 truncate text-2xs font-medium font-mono tabular-nums text-slate-500">
                      totaal {tekstKwh(Math.round(grafiek.totaal))} · gemiddeld {tekstKwh(grafiek.gemiddeld)}/laaddag · piek {tekstKwh(Math.round(grafiek.piek))}
                    </p>
                  );
                })()}
              </>
            )}
          </div>

          {/* Vermogen — de kwartierpiek bepaalt in België het capaciteits-
              tarief. 24u toont de ruwe kwartier-slots; 7d/maand tonen per dag
              de dágpiek en wanneer die viel. Gevoed door de sync-snapshots. */}
          <div className="surface-card p-6 rounded-3xl">
            <div className="mb-4 flex items-center justify-between gap-3">
              <MicroLabel>Vermogen (kW)</MicroLabel>
              <TermijnKeuze
                label="Termijn vermogensgrafiek"
                waarde={vermogenTermijn}
                opties={[{ id: '24u', label: '24 u' }, { id: '7d', label: '7 d' }, { id: 'maand', label: 'maand' }]}
                onKies={(t) => { setVermogenTermijn(t); setGekozenSlot(null); }}
              />
            </div>
            {vermogen.staven.length === 0 ? (
              <p className="text-sm text-slate-500">Nog geen vermogens-snapshots — de eerste verschijnt bij de volgende sync (elk kwartier).</p>
            ) : (
              <>
                {(() => {
                  // 24u: één doorlopende step-lijn i.p.v. 48 losse staafjes —
                  // een vermogenscurve ís een curve. De schaal neemt de
                  // maandpiek mee zodat de referentielijn altijd in beeld is.
                  const asTop = mooiMax(Math.max(vermogen.maxKw, vermogen.modus === 'slots' ? maandpiek : 0));
                  const kopVan = (key: string) => (vermogen.modus === 'slots'
                    ? uurLabel(key)
                    : new Date(`${key}T00:00:00`).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' }));
                  if (vermogen.modus === 'slots' && vermogen.staven.length > 1) {
                    const n = vermogen.staven.length;
                    const w = 100 / n;
                    const y = (kw: number) => 100 - Math.min(98, Math.max(kw > 0 ? 2 : 0.5, (kw / asTop) * 100));
                    let lijn = `M 0 ${y(vermogen.staven[0].kw).toFixed(2)}`;
                    vermogen.staven.forEach((st, i) => {
                      lijn += ` H ${((i + 1) * w).toFixed(2)}`;
                      const volgende = vermogen.staven[i + 1];
                      if (volgende) lijn += ` V ${y(volgende.kw).toFixed(2)}`;
                    });
                    const vlak = `${lijn} V 100 H 0 Z`;
                    const piekIndex = vermogen.staven.findIndex((st) => st.isPiek);
                    const gekozenIndex = vermogen.staven.findIndex((st) => st.key === gekozenSlot);
                    return (
                      <div
                        role="img"
                        aria-label={`Vermogen: ${vermogen.piekKw > 0 ? `piek ${tekstKw(vermogen.piekKw)} ${vermogen.piekWanneer}` : 'nog geen vermogen gemeten'}${maandpiek > 0 ? `, maandpiek ${tekstKw(Math.round(maandpiek))}` : ''}`}
                        className="relative h-28 touch-pan-y"
                        {...scrubHandlers(vermogen.staven, gekozenSlot, setGekozenSlot)}
                      >
                        <GridLijnen top={asTop} eenheid="kW" />
                        {/* Maandpiek-referentie: gestippeld, oker — de norm
                            waartegen de curve van vandaag gelezen wordt. */}
                        {maandpiek > 0 && (
                          <div className="absolute inset-x-0" style={{ bottom: `${Math.min(98, (maandpiek / asTop) * 100)}%` }} aria-hidden="true">
                            <div className="border-t border-dashed border-oker-500/70" />
                            {/* Label BOVEN de lijn (daar is lege ruimte — de
                                curve raakt de lijn van onderen), op een dekkend
                                chipje en met z-10 zodat de SVG-curve en de
                                piekstip er niet doorheen tekenen. */}
                            <span
                              className="absolute left-0 bottom-1 z-10 rounded px-1 py-0.5 text-2xs font-medium font-mono tabular-nums leading-none text-oker-700 dark:text-oker-400"
                              style={{ background: 'var(--tile-bg)' }}
                            >
                              maandpiek {tekstKw(Math.round(maandpiek))}
                            </span>
                          </div>
                        )}
                        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
                          <path d={vlak} className="fill-slate-500/12 dark:fill-slate-400/15" />
                          <path d={lijn} fill="none" vectorEffect="non-scaling-stroke" strokeWidth={1.5} className="stroke-slate-600 dark:stroke-slate-300" />
                          {piekIndex >= 0 && (
                            <circle
                              cx={(piekIndex + 0.5) * w}
                              cy={y(vermogen.staven[piekIndex].kw)}
                              r={2.2}
                              vectorEffect="non-scaling-stroke"
                              className="fill-oker-500 stroke-white dark:stroke-slate-900"
                              strokeWidth={1}
                            />
                          )}
                          {gekozenIndex >= 0 && (
                            <rect x={gekozenIndex * w} y={0} width={w} height={100} className="fill-slate-900/10 dark:fill-white/10" />
                          )}
                        </svg>
                        {/* Onzichtbare tik-vlakken bovenop de curve: zelfde
                            tap-selectie als de staafvariant. */}
                        <div className="absolute inset-0 flex">
                          {vermogen.staven.map((st) => (
                            <button
                              key={st.key}
                              type="button"
                              tabIndex={-1}
                              aria-hidden="true"
                              onClick={() => {
                                // Touch is al door de veeg-selectie afgehandeld.
                                if (scrubActief.current) return;
                                setGekozenSlot(gekozenSlot === st.key ? null : st.key);
                              }}
                              title={`${kopVan(st.key)} · ${tekstKw(st.kw)} · ${st.charging} sessie${st.charging === 1 ? '' : 's'}`}
                              className="h-full flex-1 cursor-pointer"
                            />
                          ))}
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div
                      role="img"
                      aria-label={`Vermogen: ${vermogen.piekKw > 0 ? `piek ${tekstKw(vermogen.piekKw)} ${vermogen.piekWanneer}` : 'nog geen vermogen gemeten'}`}
                      className="relative h-28 touch-pan-y"
                      {...scrubHandlers(vermogen.staven, gekozenSlot, setGekozenSlot)}
                    >
                      <GridLijnen top={asTop} eenheid="kW" />
                      <div className="flex h-full items-end gap-[3px]">
                        {vermogen.staven.map((st) => {
                          const gekozen = gekozenSlot === st.key;
                          return (
                            <button
                              key={st.key}
                              type="button"
                              tabIndex={-1}
                              aria-hidden="true"
                              onClick={() => { if (scrubActief.current) return; setGekozenSlot(gekozen ? null : st.key); }}
                              title={`${kopVan(st.key)} · ${tekstKw(st.kw)} · ${st.charging} sessie${st.charging === 1 ? '' : 's'}`}
                              className="flex h-full flex-1 cursor-pointer flex-col justify-end"
                            >
                              <div
                                className={gekozen ? 'w-full rounded-t-[3px] bg-slate-900 dark:bg-white' : st.isPiek ? 'w-full rounded-t-[3px] bg-oker-600 dark:bg-oker-500' : 'w-full rounded-t-[3px] bg-slate-500 dark:bg-slate-400'}
                                style={{ height: st.kw > 0 ? `${Math.max(3, Math.round((st.kw / asTop) * 100))}%` : '2px' }}
                              />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
                {/* Vaste opbouw, identiek aan de verbruikskaart ernaast: één
                    as-regel (min-h-4) en één samenvattingsregel (mt-2 min-h-4)
                    — zo liggen grafiekbodem, as en tekst in beide kaarten op
                    exact dezelfde hoogte. */}
                {vermogen.modus === 'dagen' ? (
                  <div className="mt-1 flex min-h-4 gap-[3px]" aria-hidden="true">
                    {vermogen.staven.map((st) => (
                      <span key={st.key} className="flex-1 text-center text-2xs font-medium font-mono tabular-nums text-slate-500 dark:text-slate-400">{st.asLabel}</span>
                    ))}
                  </div>
                ) : (
                  <div className="mt-1 flex min-h-4 justify-between text-2xs font-medium font-mono tabular-nums text-slate-500 dark:text-slate-400" aria-hidden="true">
                    <span>{vermogen.staven.length > 0 ? uurLabel(vermogen.staven[0].key) : ''}</span>
                    <span>nu</span>
                  </div>
                )}
                {(() => {
                  const st = vermogen.staven.find((x) => x.key === gekozenSlot);
                  if (st) {
                    const kop = vermogen.modus === 'slots'
                      ? uurLabel(st.key)
                      : `${new Date(`${st.key}T00:00:00`).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' })} · piek om ${uurLabel(st.ts || st.key)}`;
                    return (
                      <p className="mt-2 min-h-4 truncate text-2xs font-semibold font-mono tabular-nums text-slate-700 dark:text-slate-200">
                        {kop} · {tekstKw(st.kw)} · {st.charging} sessie{st.charging === 1 ? '' : 's'}
                      </p>
                    );
                  }
                  return (
                    <p className="mt-2 min-h-4 truncate text-2xs font-medium font-mono tabular-nums text-slate-500">
                      {vermogen.piekKw > 0 ? `piek ${tekstKw(vermogen.piekKw)} ${vermogen.piekWanneer}${vermogen.modus === 'dagen' && vermogen.piekTs ? ` om ${uurLabel(vermogen.piekTs)}` : ''}` : 'nog geen vermogen gemeten'}
                    </p>
                  );
                })()}
              </>
            )}
          </div>

          </div>

          {/* Detail-popup per laadpunt: technische gegevens die dagelijks
              ruis zijn maar soms nodig — max. vermogen, connector-type — plus
              de live sessie als die er is. */}
          <Modal
            open={!!gekozenPunt}
            onClose={() => setGekozenPunt(null)}
            maxWidth="sm"
            ariaLabel={gekozenPunt ? `Laadpunt ${gekozenPunt.evse_id ?? gekozenPunt.uid}` : 'Laadpunt'}
          >
            {gekozenPunt && (() => {
              const sessie = sessieByEvse.get(gekozenPunt.uid);
              const bus = busVoorLaadpunt(gekozenPunt.evse_id);
              const conn = gekozenPunt.connectors[0];
              const rij = (label: string, waarde: string) => (
                <div className="flex items-center justify-between gap-3 border-b border-slate-100 py-2.5 last:border-b-0">
                  <span className={microLabelClass}>{label}</span>
                  <span className="text-sm font-semibold font-mono tabular-nums text-slate-800">{waarde}</span>
                </div>
              );
              return (
                <div className="p-6">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <h3 className="min-w-0 truncate text-base font-bold text-slate-800">
                      Laadpunt {gekozenPunt.evse_id ?? gekozenPunt.uid}{bus ? ` · bus ${bus}` : ''}
                    </h3>
                    <span className="flex shrink-0 items-center gap-2">
                      <Badge tone={statusTone(gekozenPunt.status)} dot>{statusLabel(gekozenPunt.status)}</Badge>
                      {/* Expliciete sluitknop: tik-buiten en ESC bestaan, maar
                          een popup zonder zichtbare uitgang is op een telefoon
                          een raadsel. */}
                      <button
                        type="button"
                        onClick={() => setGekozenPunt(null)}
                        aria-label="Sluiten"
                        className="ios-pressable inline-flex h-11 w-11 sm:pointer-fine:h-8 sm:pointer-fine:w-8 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                      >
                        <X size={16} />
                      </button>
                    </span>
                  </div>
                  <div>
                    {sessie && typeof sessie.powerKw === 'number' && rij('Actueel vermogen', tekstKw(sessie.powerKw))}
                    {sessie && typeof sessie.soc === 'number' && rij('Batterij voertuig', `${sessie.soc}%`)}
                    {sessie && typeof sessie.kwh === 'number' && rij('Geladen deze sessie', tekstKwh(sessie.kwh))}
                    {sessie?.start_date_time && rij('Aangekoppeld sinds', new Date(sessie.start_date_time).toLocaleString('nl-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}
                    {(() => {
                      // Totaal van dit punt uit de verbruikskaart hieronder (zelfde periodekeuze).
                      const mv = verbruik?.punten.find((p) => p.evseUid === gekozenPunt.uid);
                      return verbruik && mv ? rij(verbruik.maand ? `Geladen in ${maandLabel(verbruik.maand)}` : `Geladen ${periodeLabel(verbruik)}`, `${fmtKwh(mv.kwh)} kWh`) : null;
                    })()}
                    {conn && rij('Max. vermogen', maxVermogen(conn.max_electric_power))}
                    {conn && rij('Connector', `${conn.standard ?? '—'}${conn.power_type ? ` · ${conn.power_type}` : ''}`)}
                    {!sessie && rij('Voertuig', 'geen aangekoppeld')}
                  </div>
                </div>
              );
            })()}
          </Modal>

          {/* Live sessies */}
          <div>
            <AdminSubsectionHeader title="Lopende sessies" />
            {data.activeSessions.length === 0 ? (
              <EmptyState mascotte={false} title="Geen lopende sessies" message="Er wordt op dit moment niet geladen (of ze zijn nog niet gesynchroniseerd)." />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {data.activeSessions.map((s) => {
                  // Zelfde rijstructuur als de laadpuntenlijst hieronder
                  // (verzoek Jarno 07-08): laadpunt · bus · SoC-pil · statuspil.
                  // Een lopende sessie laadt per definitie, dus 'CHARGING'.
                  const st = laadStatus('CHARGING', s);
                  const nummer = (s.evse_uid && nummerByUid.get(s.evse_uid)) || s.evse_uid || 'Onbekende paal';
                  const bus = busVoorLaadpunt(nummer);
                  return (
                    <div key={s.id} className="surface-card p-4 rounded-2xl flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-sm font-semibold text-slate-800">
                            Laadpunt {nummer}{bus ? ` · bus ${bus}` : ''}
                          </span>
                          {st.soc !== null && (
                            <Badge tone={st.vol ? 'emerald' : 'blue'} className="shrink-0 font-mono tabular-nums">{st.soc}%</Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-2xs text-slate-500">
                          sinds {s.start_date_time ? new Date(s.start_date_time).toLocaleString() : '—'}
                          {typeof s.kwh === 'number' ? ` · ${tekstKwh(s.kwh)} geladen` : ''}
                        </p>
                      </div>
                      {/* nowrap: op iPad-breedte wikkelde "Laden · 112 kW" naar
                          twee regels en werden de kaarten ongelijk hoog. */}
                      <Badge tone={st.vol ? 'emerald' : 'blue'} dot className="shrink-0 whitespace-nowrap">
                        {st.label ?? 'Laden'}
                      </Badge>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Stations + laadpunten */}
          <div>
            <AdminSubsectionHeader title="Laadpalen per locatie" />
            {data.locations.length === 0 ? (
              <EmptyState mascotte={false} title="Nog geen locaties" message="Klik in Systeem Status → OCPI-koppeling op 'Nu synchroniseren' om de laadpalen op te halen." />
            ) : (
              <div className="space-y-4">
                {data.locations.map((loc) => (
                  <div key={loc.id} className="surface-card p-6 rounded-3xl">
                    <div className="flex items-center justify-between gap-3 mb-4">
                      <div>
                        <h3 className="text-base font-bold text-slate-800">{loc.name ?? loc.id}</h3>
                        {loc.city && <p className="text-xs text-slate-500">{loc.city}</p>}
                      </div>
                      <span className="text-2xs text-slate-400">{loc.evses.length} laadpunt{loc.evses.length === 1 ? '' : 'en'}</span>
                    </div>
                    {loc.evses.length === 0 ? (
                      <p className="text-sm text-slate-500">Geen laadpunten.</p>
                    ) : (
                      // Eén kolom per CPU (fysiek station) — de nummering van
                      // de laadpunten (1…7, 12.A/B, CPU3-satellieten) loopt
                      // per CPU, dus door elkaar gehusseld las de lijst als
                      // willekeur. Op mobiel stapelen de kolommen onder elkaar.
                      // Pas drie kolommen vanaf 2xl: op 1280px bleef er ~270px
                      // per rij over, te weinig voor nummer + bus + percentage
                      // + "Laden · 112 kW" — de pillen werden dan platgedrukt
                      // en liepen in elkaar (melding Jarno).
                      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
                        {groepeerPerCpu(loc.evses).map((cpu) => {
                          const laden = cpu.evses.filter((e) => e.status === 'CHARGING').length;
                          return (
                            <div key={cpu.key} className="rounded-2xl border border-slate-100 p-3.5">
                              <div className="mb-2.5 flex items-baseline justify-between gap-2 border-b border-slate-100 pb-2">
                                <span className="text-sm font-bold text-slate-800">{cpu.label}</span>
                                <span className="text-2xs font-medium font-mono tabular-nums text-slate-500 dark:text-slate-400">
                                  {laden > 0 ? `${laden} aan het laden` : `${cpu.evses.length} punten`}
                                </span>
                              </div>
                              <div className="space-y-1">
                                {cpu.evses.map((evse) => {
                                  // Vaste rijstructuur (verzoek Jarno 07-08):
                                  // nummer · bus · SoC-pil · status-pil. Het
                                  // batterijpercentage was hiervóór losse
                                  // gekleurde tekst; als pil staat het naast de
                                  // statuspil op één lijn en lees je de kolom
                                  // in één oogopslag. Technische details (max
                                  // vermogen, connector) zitten achter een tik.
                                  const sessie = sessieByEvse.get(evse.uid);
                                  const s = laadStatus(evse.status, sessie);
                                  return (
                                    <button
                                      key={evse.uid}
                                      type="button"
                                      onClick={() => setGekozenPunt(evse)}
                                      aria-haspopup="dialog"
                                      title="Tik voor details (max. vermogen, connector)"
                                      className="ios-pressable flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-1 text-left transition-colors hover:bg-surface-soft-hover dark:hover:bg-white/5"
                                    >
                                      {/* shrink-0 i.p.v. min-w-0: met min-w-0 werd
                                          deze groep bij krappe kolombreedte
                                          samengedrukt, liep het percentage uit
                                          zijn pil ("61%" werd "6") en schoof
                                          hij ín de statuspil ernaast. */}
                                      <span className="flex shrink-0 items-center gap-1.5">
                                        <span className="w-11 shrink-0 text-sm font-semibold font-mono tabular-nums text-slate-700">{evse.evse_id ?? evse.uid}</span>
                                        {/* Busnummer is dé operationele sleutel van dit
                                            scherm — niet in de zwakste tint zetten. */}
                                        <span className="w-14 shrink-0 text-2xs font-medium font-mono tabular-nums text-slate-600 dark:text-slate-300">
                                          {busVoorLaadpunt(evse.evse_id) ? `bus ${busVoorLaadpunt(evse.evse_id)}` : ''}
                                        </span>
                                        {s.soc !== null && (
                                          <Badge tone={s.vol ? 'emerald' : 'blue'} className="shrink-0 font-mono tabular-nums">{s.soc}%</Badge>
                                        )}
                                      </span>
                                      {/* Vol = groen, ook al staat de paal
                                          technisch nog op CHARGING — anders
                                          stond "Laden voltooid" in een blauwe
                                          pil naast een groene 100%-pil. */}
                                      <Badge tone={s.vol ? 'emerald' : statusTone(evse.status)} dot className="shrink-0 whitespace-nowrap">
                                        {s.label ?? statusLabel(evse.status)}
                                      </Badge>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Verbruik per laadpunt (verzoek Jarno 27-08): hoeveel kWh elk
              laadpunt in een periode geleverd heeft — een kalendermaand (‹ ›)
              of een vrije periode van/tot (bv. 4–5 augustus). De
              verbruiksgrafiek bovenaan telt alles bij elkaar op; dit splitst
              het uit per punt (en dus per bus), in dezelfde CPU-kolommen als
              de statuslijst zodat je een laadpunt op dezelfde plek terugvindt.
              Oker = het punt met het hoogste totaal, net als de piek in de
              grafieken. */}
          <div>
            <AdminSubsectionHeader
              title="Verbruik per laadpunt"
              description="Geleverde energie per laadpunt, per maand of per vrij gekozen periode, uit de laadsessies van ChargEye."
              aside={(
                <div className="flex flex-wrap items-center gap-2">
                  <TermijnKeuze
                    label="Maand of vrije periode"
                    waarde={periodeModus}
                    opties={[{ id: 'maand', label: 'Maand' }, { id: 'periode', label: 'Periode' }]}
                    onKies={wisselModus}
                  />
                  {periodeModus === 'maand' ? (
                    <div className="flex items-center gap-2" role="group" aria-label="Maandkeuze">
                      <button
                        type="button"
                        onClick={() => setKeuze({ modus: 'maand', maand: maandPlus(maandGekozen, -1) })}
                        disabled={!verbruik?.eersteDag || maandPlus(maandGekozen, -1) < verbruik.eersteDag.slice(0, 7)}
                        aria-label="Vorige maand"
                        className="ios-pressable flex h-11 w-11 sm:pointer-fine:h-9 sm:pointer-fine:w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition-colors hover:bg-surface-soft-hover hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-500"
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <span className="min-w-[8.5rem] text-center text-sm font-semibold text-slate-800" aria-live="polite">{maandLabel(maandGekozen)}</span>
                      <button
                        type="button"
                        onClick={() => setKeuze({ modus: 'maand', maand: maandPlus(maandGekozen, 1) })}
                        disabled={!verbruik || maandGekozen >= verbruik.huidigeDag.slice(0, 7)}
                        aria-label="Volgende maand"
                        className="ios-pressable flex h-11 w-11 sm:pointer-fine:h-9 sm:pointer-fine:w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition-colors hover:bg-surface-soft-hover hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-500"
                      >
                        <ChevronRight size={16} />
                      </button>
                    </div>
                  ) : (
                    // Vrije periode: twee datumvelden, begrensd op de eerste dag
                    // met sessies en vandaag. Volgorde-fouten worden stil
                    // rechtgezet (zie zetVan/zetTot) i.p.v. met een foutmelding.
                    <div className="flex items-center gap-2" role="group" aria-label="Periodekeuze">
                      <input
                        type="date"
                        value={periodeGekozen.van}
                        min={verbruik?.eersteDag ?? undefined}
                        max={vandaag}
                        onChange={(e) => zetVan(e.target.value)}
                        aria-label="Van"
                        className="control-input rounded-2xl px-3 py-2 text-sm font-bold outline-none"
                      />
                      <span className="text-xs font-medium text-slate-400">t/m</span>
                      <input
                        type="date"
                        value={periodeGekozen.tot}
                        min={verbruik?.eersteDag ?? undefined}
                        max={vandaag}
                        onChange={(e) => zetTot(e.target.value)}
                        aria-label="Tot en met"
                        className="control-input rounded-2xl px-3 py-2 text-sm font-bold outline-none"
                      />
                    </div>
                  )}
                </div>
              )}
            />
            {verbruikFout ? (
              <div className="p-4 rounded-2xl text-sm font-semibold bg-red-50 text-red-700 border border-red-100">{verbruikFout}</div>
            ) : !verbruik ? (
              <SkeletonTile />
            ) : (() => {
              const actief = verbruik.punten.filter((p) => p.kwh > 0).length;
              const max = Math.max(0, ...verbruik.punten.map((p) => p.kwh));
              const kolommen = groepeerPerCpu(verbruik.punten.map((p) => ({
                uid: p.evseUid, evse_id: p.evseId ?? undefined, physical_reference: p.physicalReference, kwh: p.kwh, sessies: p.sessies,
              })));
              const label = periodeLabel(verbruik);
              return (
                <div className={cn('surface-card p-6 rounded-3xl transition-opacity', verbruikLaadt && 'opacity-60')} aria-busy={verbruikLaadt}>
                  {/* Eén regel die zegt wáárover de cijfers gaan — in periode-
                      modus staat het label nergens anders voluit. */}
                  <p className="mb-4 text-2xs font-medium font-mono tabular-nums text-slate-500">
                    {label} · totaal {fmtKwh(verbruik.totaalKwh)} kWh · {verbruik.totaalSessies} sessie{verbruik.totaalSessies === 1 ? '' : 's'} · {actief} van {verbruik.punten.length} laadpunten actief
                    {verbruik.tot >= verbruik.huidigeDag ? ' · t/m vandaag' : ''}
                  </p>
                  {verbruik.totaalSessies === 0 ? (
                    <p className="text-sm text-slate-500">Geen laadsessies in deze periode ({label}).</p>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-4">
                      {kolommen.map((cpu) => {
                        const cpuKwh = cpu.evses.reduce((a, p) => a + p.kwh, 0);
                        return (
                          <div key={cpu.key} className="rounded-2xl border border-slate-100 p-3.5">
                            <div className="mb-2.5 flex items-baseline justify-between gap-2 border-b border-slate-100 pb-2">
                              <span className="text-sm font-bold text-slate-800">{cpu.label}</span>
                              <span className="text-2xs font-medium font-mono tabular-nums text-slate-500 dark:text-slate-400">{fmtKwh(cpuKwh)} kWh</span>
                            </div>
                            <div className="space-y-1">
                              {cpu.evses.map((p) => {
                                const bus = busVoorLaadpunt(p.evse_id);
                                const isPiek = p.kwh > 0 && p.kwh === max;
                                return (
                                  <div
                                    key={p.uid}
                                    className="flex min-h-9 items-center gap-1.5 px-1"
                                    title={`${p.sessies} sessie${p.sessies === 1 ? '' : 's'}`}
                                  >
                                    {/* Zelfde kolombreedtes als de statuslijst (w-11 / w-14),
                                        zodat nummer en bus in beide kaarten op één lijn staan. */}
                                    <span className="w-11 shrink-0 text-sm font-semibold font-mono tabular-nums text-slate-700">{p.evse_id ?? p.uid}</span>
                                    <span className="w-14 shrink-0 text-2xs font-medium font-mono tabular-nums text-slate-600 dark:text-slate-300">{bus ? `bus ${bus}` : ''}</span>
                                    <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-slate-200/70 dark:bg-white/10" aria-hidden="true">
                                      <div
                                        className={cn('h-full rounded-full', isPiek ? 'bg-oker-600 dark:bg-oker-500' : 'bg-slate-500 dark:bg-slate-400')}
                                        style={{ width: max > 0 && p.kwh > 0 ? `${Math.max(2, Math.round((p.kwh / max) * 100))}%` : '0%' }}
                                      />
                                    </div>
                                    <span className={cn('w-20 shrink-0 text-right text-sm font-semibold font-mono tabular-nums', p.kwh > 0 ? 'text-slate-800' : 'text-slate-400')}>
                                      {fmtKwh(p.kwh)} kWh
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>

          {/* Storingen uit ChargEye (verzoek Jarno 06-08): defecte laadpunten
              + mislukte laadsessies (technicalFailClassification ≠ OK) van de
              afgelopen 7 dagen. Dit maakt het "stekker in maar laadt niet"-
              scenario zichtbaar dat anders alleen in de ruwe data stond. */}
          <div>
            <AdminSubsectionHeader title="Storingen (ChargEye)" />
            {storingen.length === 0 ? (
              <EmptyState mascotte={false} title="Geen storingen" message="Alle laadpunten en laadbeurten van de afgelopen 7 dagen zijn in orde." />
            ) : (
              <div className="surface-card rounded-3xl overflow-hidden">
                <div className="divide-y divide-slate-100">
                  {(alleStoringen ? storingen : storingen.slice(0, 5)).map((st, i) => {
                    const nummer = st.evseUid ? nummerByUid.get(st.evseUid) ?? st.evseUid : null;
                    const bus = nummer ? busVoorLaadpunt(nummer) : null;
                    return (
                      <div key={`${st.soort}-${st.evseUid ?? 'x'}-${st.wanneer ?? ''}-${i}`} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2">
                        {/* Op mobiel twee regels toestaan: truncate sneed
                            precies de reden en het tijdstip weg — de kern van
                            de melding. */}
                        <p className="min-w-0 text-sm font-medium text-slate-700 max-sm:line-clamp-2 sm:truncate">
                          <span className="font-semibold text-slate-800">{nummer ? `Laadpunt ${nummer}` : 'Onbekend laadpunt'}{bus ? ` · bus ${bus}` : ''}</span>
                          <span className="text-slate-500">
                            {' — '}
                            {st.soort === 'laadpunt'
                              ? `in storing (${statusLabel(st.status).toLowerCase()})`
                              : `laadbeurt mislukt (${st.classificatie})${st.wanneer ? ` · ${new Date(st.wanneer).toLocaleString('nl-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}`}
                          </span>
                        </p>
                        <Badge tone="red" dot className="shrink-0 whitespace-nowrap">{st.soort === 'laadpunt' ? statusLabel(st.status) : 'Mislukt'}</Badge>
                      </div>
                    );
                  })}
                </div>
                {storingen.length > 5 && (
                  <button
                    type="button"
                    onClick={() => setAlleStoringen((v) => !v)}
                    aria-expanded={alleStoringen}
                    className="ios-pressable w-full border-t border-slate-100 px-4 py-2.5 text-center text-xs font-semibold text-slate-500 transition-colors hover:bg-surface-soft-hover hover:text-slate-700 dark:hover:bg-white/5"
                  >
                    {alleStoringen ? 'Toon minder' : `Toon alle ${storingen.length} storingen`}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </PageShell>
  );
}
