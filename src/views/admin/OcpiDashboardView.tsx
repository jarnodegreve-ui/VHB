import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Zap, BatteryCharging, Gauge, RefreshCw, X } from 'lucide-react';
import { cn, getSupabaseAuthHeaders } from '../../lib/ui';
import { busVoorLaadpunt } from '../../lib/laadplein';
import { isoDate } from '../../lib/availability';
import { Modal } from '../../components/Modal';
import { PageHeader, PageShell, AdminSubsectionHeader, EmptyState } from '../../components/ui';
import { OpsStat } from '../../components/ops';
import { SkeletonTile } from '../../components/Skeleton';
import { Badge, Button, MicroLabel, type BadgeTone } from '../../components/primitives';

/** Termijn-schakelaar in exact de app-standaard segmented-maat (rail
 *  rounded-2xl p-1, knoppen px-3.5 py-2 text-xs — zie ScheduleView,
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
          className={cn(
            'ios-pressable rounded-xl px-3.5 py-2 text-xs font-semibold transition-all',
            waarde === o.id ? 'bg-oker-500 text-slate-950 shadow-sm shadow-oker-500/30' : 'text-slate-500 hover:text-slate-700',
          )}
        >
          {o.label}
        </button>
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
function groepeerPerCpu(evses: Evse[]): Array<{ key: string; label: string; evses: Evse[] }> {
  const groepen = new Map<string, Evse[]>();
  for (const e of evses) {
    const key = String(e.uid ?? '').replace(/-\d+$/, '') || 'onbekend';
    groepen.set(key, [...(groepen.get(key) ?? []), e]);
  }
  const cpuNummer = (lijst: Evse[]): number | null => {
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
  const nummerKey = (e: Evse): [number, string] => {
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
  /** Ruwe 30-min-slots van de laatste 24 uur. */
  powerCurve: Array<{ ts: string; kw: number; charging: number }>;
  /** Dágpieken (Brusselse kalenderdag) van de laatste 31 dagen — server-side
   *  bepaald zodat de dag-grens niet verschuift tussen UTC en lokaal. */
  powerDays?: Array<{ date: string; kw: number; ts: string; charging: number }>;
  storingen?: Array<{ soort: 'laadpunt' | 'sessie'; evseUid: string | null; status?: string; classificatie?: string; wanneer: string | null }>;
};

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
const kW = (w?: number) => (typeof w === 'number' ? `${Math.round(w / 100) / 10} kW` : '—');

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

  // Termijn-schakelaars (verzoek Jarno 05-08). Verbruik telt per dag, dus
  // daar is 24u geen zinnige stap; bij het vermogen tonen 7d/maand de
  // DÁGPIEK per dag — dat is het getal dat voor het capaciteitstarief telt.
  const [verbruikTermijn, setVerbruikTermijn] = useState<'7d' | '30d' | 'maand'>('30d');
  const [vermogenTermijn, setVermogenTermijn] = useState<'24u' | '7d' | 'maand'>('24u');
  const uurLabel = (ts: string) => new Date(ts).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
  const maandStart = () => { const nu = new Date(); return `${nu.getFullYear()}-${String(nu.getMonth() + 1).padStart(2, '0')}-01`; };
  const WEEKDAG_KORT = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];

  // Op een smal scherm (telefoon) zijn 48 slot-staven van ~4 px geen
  // raakvlak; dan voegen we de 24u-reeks samen tot uur-staven (piek per uur).
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

  // Vermogen: 24u = de 30-min-slots (op mobiel samengevoegd per uur);
  // 7d/maand = één staaf per dag met de server-side bepaalde dágpiek.
  const vermogen = useMemo(() => {
    if (vermogenTermijn === '24u') {
      let punten = (data?.powerCurve ?? []).map((pt) => ({ ts: pt.ts, kw: pt.kw, charging: pt.charging }));
      if (smalScherm) {
        const perUur = new Map<string, { ts: string; kw: number; charging: number }>();
        for (const pt of punten) {
          const uur = pt.ts.slice(0, 13);
          const cur = perUur.get(uur);
          if (!cur || pt.kw > cur.kw) perUur.set(uur, pt);
        }
        punten = [...perUur.values()].sort((a, b) => a.ts.localeCompare(b.ts));
      }
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
            ? WEEKDAG_KORT[dow]
            : dow === 1 && (!smalScherm || maandagTeller % 2 === 1) ? String(Number(d.date.slice(8))) : '',
        };
      });
    const maxKw = Math.max(1, ...staven.map((st) => st.kw));
    const piek = staven.reduce((best, st) => (st.kw > best.kw ? st : best), { key: '', kw: 0, ts: '', charging: 0, isPiek: false, asLabel: '' });
    for (const st of staven) st.isPiek = st.key === piek.key && st.kw > 0;
    const piekDagLabel = piek.key ? new Date(`${piek.key}T00:00:00`).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
    return { modus: 'dagen' as const, staven, maxKw, piekKw: piek.kw, piekTs: piek.ts, piekWanneer: piek.key ? `op ${piekDagLabel}` : '' };
  }, [data?.powerCurve, data?.powerDays, vermogenTermijn, smalScherm]);
  // Tik-selectie op de grafiekstaven: op een telefoon is er geen hover-title,
  // dus een tik op een staaf toont de details in de samenvattingsregel.
  const [gekozenDag, setGekozenDag] = useState<string | null>(null);
  const [gekozenSlot, setGekozenSlot] = useState<string | null>(null);
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
          <Button variant="secondary" onClick={load} disabled={isLoading}>
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
              sub={data.totals.totalPowerKw > 0 ? `${data.totals.totalPowerKw} kW nu` : 'geen vermogen nu'}
            />
            <OpsStat
              icon={<Zap size={16} />}
              tone="emerald"
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
              tone="oker"
              label="Vandaag geladen"
              text={`${Math.round(grafiek.dagen.at(-1)?.kwh ?? 0)} kWh`}
              sub={`30 d: ${kwh30} kWh · ${data.totals.sessions30d} sessies`}
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
                <div
                  role="img"
                  aria-label={`Verbruik per dag: totaal ${Math.round(grafiek.totaal)} kWh, gemiddeld ${grafiek.gemiddeld} kWh per laaddag, piek ${Math.round(grafiek.piek)} kWh`}
                  className="flex h-24 items-end gap-[3px]"
                >
                  {grafiek.dagen.map((d) => {
                    const gekozen = gekozenDag === d.date;
                    const isPiek = d.kwh > 0 && d.kwh === grafiek.piek;
                    return (
                      <button
                        key={d.date}
                        type="button"
                        tabIndex={-1}
                        aria-hidden="true"
                        onClick={() => setGekozenDag(gekozen ? null : d.date)}
                        title={`${d.date.slice(5)} · ${d.kwh} kWh · ${d.sessions} sessie${d.sessions === 1 ? '' : 's'}`}
                        className="flex h-full flex-1 cursor-pointer flex-col justify-end"
                      >
                        <div
                          className={gekozen ? 'w-full rounded-t-[3px] bg-slate-900 dark:bg-white' : isPiek ? 'w-full rounded-t-[3px] bg-oker-600 dark:bg-oker-500' : 'w-full rounded-t-[3px] bg-slate-500 dark:bg-slate-400'}
                          style={{ height: d.kwh > 0 ? `${Math.max(4, Math.round((d.kwh / grafiek.max) * 100))}%` : '2px' }}
                        />
                      </button>
                    );
                  })}
                </div>
                <div className="mt-1 flex min-h-4 gap-[3px]" aria-hidden="true">
                  {grafiek.dagen.map((d) => (
                    <span key={d.date} className="flex-1 text-center text-[10px] font-medium tabular-nums text-slate-500 dark:text-slate-400">
                      {grafiek.dagen.length <= 7 ? WEEKDAG_KORT[d.dow] : d.dow === 1 ? Number(d.date.slice(8)) : ''}
                    </span>
                  ))}
                </div>
                {(() => {
                  const dag = grafiek.dagen.find((d) => d.date === gekozenDag);
                  return dag ? (
                    <p className="mt-2 min-h-4 truncate text-[11px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                      {new Date(`${dag.date}T00:00:00`).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' })} · {dag.kwh} kWh · {dag.sessions} sessie{dag.sessions === 1 ? '' : 's'}
                    </p>
                  ) : (
                    <p className="mt-2 min-h-4 truncate text-[11px] font-medium tabular-nums text-slate-500">
                      totaal {Math.round(grafiek.totaal)} kWh · gemiddeld {grafiek.gemiddeld} kWh/laaddag · piek {Math.round(grafiek.piek)} kWh
                    </p>
                  );
                })()}
              </>
            )}
          </div>

          {/* Vermogen — de kwartierpiek bepaalt in België het capaciteits-
              tarief. 24u toont de ruwe 30-min-slots; 7d/maand tonen per dag
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
              <p className="text-sm text-slate-500">Nog geen vermogens-snapshots — de eerste verschijnt bij de volgende sync (elke 30 min).</p>
            ) : (
              <>
                <div
                  role="img"
                  aria-label={`Vermogen: ${vermogen.piekKw > 0 ? `piek ${vermogen.piekKw} kW ${vermogen.piekWanneer}` : 'nog geen vermogen gemeten'}`}
                  className={cn('flex h-24 items-end', vermogen.modus === 'slots' ? 'gap-[2px]' : 'gap-[3px]')}
                >
                  {vermogen.staven.map((st) => {
                    const gekozen = gekozenSlot === st.key;
                    const kop = vermogen.modus === 'slots'
                      ? uurLabel(st.key)
                      : new Date(`${st.key}T00:00:00`).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' });
                    return (
                      <button
                        key={st.key}
                        type="button"
                        tabIndex={-1}
                        aria-hidden="true"
                        onClick={() => setGekozenSlot(gekozen ? null : st.key)}
                        title={`${kop} · ${st.kw} kW · ${st.charging} sessie${st.charging === 1 ? '' : 's'}`}
                        className="flex h-full flex-1 cursor-pointer flex-col justify-end"
                      >
                        <div
                          className={gekozen ? 'w-full rounded-t-[3px] bg-slate-900 dark:bg-white' : st.isPiek ? 'w-full rounded-t-[3px] bg-oker-600 dark:bg-oker-500' : 'w-full rounded-t-[3px] bg-slate-500 dark:bg-slate-400'}
                          style={{ height: st.kw > 0 ? `${Math.max(4, Math.round((st.kw / vermogen.maxKw) * 100))}%` : '2px' }}
                        />
                      </button>
                    );
                  })}
                </div>
                {/* Vaste opbouw, identiek aan de verbruikskaart ernaast: één
                    as-regel (min-h-4) en één samenvattingsregel (mt-2 min-h-4)
                    — zo liggen grafiekbodem, as en tekst in beide kaarten op
                    exact dezelfde hoogte. */}
                {vermogen.modus === 'dagen' ? (
                  <div className="mt-1 flex min-h-4 gap-[3px]" aria-hidden="true">
                    {vermogen.staven.map((st) => (
                      <span key={st.key} className="flex-1 text-center text-[10px] font-medium tabular-nums text-slate-500 dark:text-slate-400">{st.asLabel}</span>
                    ))}
                  </div>
                ) : (
                  <div className="mt-1 flex min-h-4 justify-between text-[10px] font-medium tabular-nums text-slate-500 dark:text-slate-400" aria-hidden="true">
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
                      <p className="mt-2 min-h-4 truncate text-[11px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                        {kop} · {st.kw} kW · {st.charging} sessie{st.charging === 1 ? '' : 's'}
                      </p>
                    );
                  }
                  return (
                    <p className="mt-2 min-h-4 truncate text-[11px] font-medium tabular-nums text-slate-500">
                      {vermogen.piekKw > 0 ? `piek ${vermogen.piekKw} kW ${vermogen.piekWanneer}${vermogen.modus === 'dagen' && vermogen.piekTs ? ` om ${uurLabel(vermogen.piekTs)}` : ''}` : 'nog geen vermogen gemeten'}
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
                  <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400">{label}</span>
                  <span className="text-sm font-semibold tabular-nums text-slate-800">{waarde}</span>
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
                        className="ios-pressable flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-white/10"
                      >
                        <X size={16} />
                      </button>
                    </span>
                  </div>
                  <div>
                    {sessie && typeof sessie.powerKw === 'number' && rij('Actueel vermogen', `${sessie.powerKw} kW`)}
                    {sessie && typeof sessie.soc === 'number' && rij('Batterij voertuig', `${sessie.soc}%`)}
                    {sessie && typeof sessie.kwh === 'number' && rij('Geladen deze sessie', `${sessie.kwh} kWh`)}
                    {sessie?.start_date_time && rij('Aangekoppeld sinds', new Date(sessie.start_date_time).toLocaleString('nl-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }))}
                    {conn && rij('Max. vermogen', kW(conn.max_electric_power))}
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
                            <Badge tone={st.vol ? 'emerald' : 'blue'} className="shrink-0 tabular-nums">{st.soc}%</Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-[11px] text-slate-500">
                          sinds {s.start_date_time ? new Date(s.start_date_time).toLocaleString() : '—'}
                          {typeof s.kwh === 'number' ? ` · ${s.kwh} kWh geladen` : ''}
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
                      <span className="text-[11px] text-slate-400">{loc.evses.length} laadpunt{loc.evses.length === 1 ? '' : 'en'}</span>
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
                                <span className="text-[11px] font-medium tabular-nums text-slate-500 dark:text-slate-400">
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
                                        <span className="w-11 shrink-0 text-sm font-semibold tabular-nums text-slate-700">{evse.evse_id ?? evse.uid}</span>
                                        {/* Busnummer is dé operationele sleutel van dit
                                            scherm — niet in de zwakste tint zetten. */}
                                        <span className="w-14 shrink-0 text-[11px] font-medium tabular-nums text-slate-600 dark:text-slate-300">
                                          {busVoorLaadpunt(evse.evse_id) ? `bus ${busVoorLaadpunt(evse.evse_id)}` : ''}
                                        </span>
                                        {s.soc !== null && (
                                          <Badge tone={s.vol ? 'emerald' : 'blue'} className="shrink-0 tabular-nums">{s.soc}%</Badge>
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
                        <p className="min-w-0 text-[13px] font-medium text-slate-700 max-sm:line-clamp-2 sm:truncate">
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
