import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Zap, BatteryCharging, Gauge, RefreshCw } from 'lucide-react';
import { cn, getSupabaseAuthHeaders } from '../../lib/ui';
import { busVoorLaadpunt } from '../../lib/laadplein';
import { PageHeader, PageShell, AdminSubsectionHeader, EmptyState } from '../../components/ui';
import { StatCard } from '../../components/StatCard';
import { SkeletonTile } from '../../components/Skeleton';
import { Badge, Button, MicroLabel } from '../../components/primitives';

/** Compacte termijn-schakelaar in dezelfde toggle-taal als de rest van de
 *  app (glass-segmented + oker-actief, zie ScheduleView/Gebruikersbeheer). */
function TermijnKeuze<T extends string>({ waarde, opties, onKies }: { waarde: T; opties: Array<{ id: T; label: string }>; onKies: (t: T) => void }) {
  return (
    <div className="glass-segmented inline-flex shrink-0 rounded-xl p-0.5">
      {opties.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onKies(o.id)}
          aria-pressed={waarde === o.id}
          className={cn(
            'ios-pressable rounded-[10px] px-2.5 py-1 text-[11px] font-semibold transition-all',
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
  return [...groepen.entries()]
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
}
type DashLocation = { id: string; name?: string; city?: string; evses: Evse[] };
type ActiveSession = { id: string; evse_uid?: string; location_id?: string; status?: string; start_date_time?: string; kwh?: number; powerKw?: number | null; soc?: number | null };
type Dashboard = {
  totals: { locations: number; evses: number; connectors: number; activeSessions: number; sessions30d: number; totalPowerKw: number; kwh30d: number };
  statusCounts: Record<string, number>;
  locations: DashLocation[];
  activeSessions: ActiveSession[];
  kwhPerDay: Array<{ date: string; kwh: number; sessions: number }>;
  powerCurve: Array<{ ts: string; kw: number; charging: number }>;
};

type BadgeTone = 'slate' | 'emerald' | 'red' | 'amber' | 'blue';
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
  const lokaleDag = (dt: Date) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  const maandStart = () => { const nu = new Date(); return `${nu.getFullYear()}-${String(nu.getMonth() + 1).padStart(2, '0')}-01`; };
  const WEEKDAG_KORT = ['zo', 'ma', 'di', 'wo', 'do', 'vr', 'za'];

  // Doorlopende reeks voor de kolomgrafiek: dagen zonder sessies worden 0
  // in plaats van weggelaten, anders schuiven de kolommen en klopt het
  // ritme (weekend vs. week) niet meer. De termijn snijdt uit de 30 dagen.
  const grafiek = useMemo(() => {
    const perDag = new Map((data?.kwhPerDay ?? []).map((d) => [d.date, d]));
    const alle: Array<{ date: string; kwh: number; sessions: number; dow: number }> = [];
    for (let i = 29; i >= 0; i--) {
      const dt = new Date();
      dt.setDate(dt.getDate() - i);
      const iso = lokaleDag(dt);
      const rij = perDag.get(iso);
      alle.push({ date: iso, kwh: rij?.kwh ?? 0, sessions: rij?.sessions ?? 0, dow: dt.getDay() });
    }
    const dagen = verbruikTermijn === '7d' ? alle.slice(-7)
      : verbruikTermijn === 'maand' ? alle.filter((d) => d.date >= maandStart())
      : alle;
    const max = Math.max(1, ...dagen.map((d) => d.kwh));
    const totaal = Math.round(dagen.reduce((a, d) => a + d.kwh, 0) * 10) / 10;
    const actieveDagen = dagen.filter((d) => d.kwh > 0).length;
    const gemiddeld = actieveDagen > 0 ? Math.round((totaal / actieveDagen) * 10) / 10 : 0;
    return { dagen, max, totaal, gemiddeld, piek: Math.max(0, ...dagen.map((d) => d.kwh)) };
  }, [data?.kwhPerDay, verbruikTermijn]);

  // Vermogen: 24u = de ruwe 30-min-slots; 7d/maand = één staaf per dag met
  // de dágpiek (en het moment waarop die viel).
  const vermogen = useMemo(() => {
    const alle = data?.powerCurve ?? [];
    if (vermogenTermijn === '24u') {
      const punten = alle.filter((pt) => Date.parse(pt.ts) >= Date.now() - 24 * 3600 * 1000);
      const maxKw = Math.max(1, ...punten.map((pt) => pt.kw));
      const piek = punten.reduce((best, pt) => (pt.kw > best.kw ? pt : best), { ts: '', kw: 0, charging: 0 });
      const staven = punten.map((pt) => ({ key: pt.ts, kw: pt.kw, charging: pt.charging, isPiek: pt.ts === piek.ts, asLabel: '' }));
      return { modus: 'slots' as const, staven, maxKw, piekKw: piek.kw, piekTs: piek.ts, piekWanneer: piek.ts ? `om ${uurLabel(piek.ts)}` : '' };
    }
    const vanaf = vermogenTermijn === '7d'
      ? lokaleDag(new Date(Date.now() - 6 * 24 * 3600 * 1000))
      : maandStart();
    const perDag = new Map<string, { kw: number; ts: string; charging: number; dow: number }>();
    for (const pt of alle) {
      const dt = new Date(pt.ts);
      const dag = lokaleDag(dt);
      if (dag < vanaf) continue;
      const cur = perDag.get(dag);
      if (!cur || pt.kw > cur.kw) perDag.set(dag, { kw: pt.kw, ts: pt.ts, charging: pt.charging, dow: dt.getDay() });
    }
    const staven = [...perDag.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([dag, v]) => ({
        key: dag, kw: v.kw, charging: v.charging, ts: v.ts, isPiek: false,
        asLabel: vermogenTermijn === '7d' ? WEEKDAG_KORT[v.dow] : v.dow === 1 ? String(Number(dag.slice(8))) : '',
      }));
    const maxKw = Math.max(1, ...staven.map((st) => st.kw));
    const piek = staven.reduce((best, st) => (st.kw > best.kw ? st : best), { key: '', kw: 0, ts: '', charging: 0, isPiek: false, asLabel: '' });
    for (const st of staven) (st as any).isPiek = st.key === piek.key;
    const piekDagLabel = piek.key ? new Date(`${piek.key}T00:00:00`).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
    return { modus: 'dagen' as const, staven, maxKw, piekKw: piek.kw, piekTs: (piek as any).ts ?? '', piekWanneer: piek.key ? `op ${piekDagLabel}` : '' };
  }, [data?.powerCurve, vermogenTermijn]);
  // Tik-selectie op de grafiekstaven: op een telefoon is er geen hover-title,
  // dus een tik op een staaf toont de details in de samenvattingsregel.
  const [gekozenDag, setGekozenDag] = useState<string | null>(null);
  const [gekozenSlot, setGekozenSlot] = useState<string | null>(null);
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
              veranderen nooit; de status-badges-kaart is in de rij opgegaan. */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              icon={<BatteryCharging size={20} className="text-blue-600 dark:text-blue-400" />}
              label="Aan de lader"
              value={`${kpi.laden} / ${data.totals.evses}`}
              subValue={data.totals.totalPowerKw > 0 ? `${data.totals.totalPowerKw} kW nu` : 'geen vermogen nu'}
            />
            <StatCard
              icon={<Zap size={20} className="text-emerald-600" />}
              label="Beschikbaar"
              value={String(kpi.beschikbaar)}
              subValue="vrije laadpunten"
            />
            <StatCard
              icon={<AlertTriangle size={20} className={kpi.afwijkend > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-400'} />}
              label="Afwijkend"
              value={String(kpi.afwijkend)}
              subValue={kpi.afwijkend > 0 ? kpi.afwijkendTekst : 'alles operationeel'}
            />
            <StatCard
              icon={<Gauge size={20} className="text-oker-600" />}
              label="Vandaag geladen"
              value={`${Math.round(grafiek.dagen.at(-1)?.kwh ?? 0)} kWh`}
              subValue={`30 d: ${Math.round(grafiek.totaal)} kWh · ${data.totals.sessions30d} sessies`}
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
                waarde={verbruikTermijn}
                opties={[{ id: '7d', label: '7 d' }, { id: '30d', label: '30 d' }, { id: 'maand', label: 'maand' }]}
                onKies={(t) => { setVerbruikTermijn(t); setGekozenDag(null); }}
              />
            </div>
            {data.kwhPerDay.length === 0 ? (
              <p className="text-sm text-slate-500">Nog geen sessies gesynchroniseerd.</p>
            ) : (
              <>
                <div className="flex h-24 items-end gap-[3px]">
                  {grafiek.dagen.map((d, i) => {
                    const vandaag = i === grafiek.dagen.length - 1;
                    const gekozen = gekozenDag === d.date;
                    return (
                      <button
                        key={d.date}
                        type="button"
                        onClick={() => setGekozenDag(gekozen ? null : d.date)}
                        aria-pressed={gekozen}
                        aria-label={`${d.date.slice(5)}: ${d.kwh} kWh, ${d.sessions} sessies`}
                        title={`${d.date.slice(5)} · ${d.kwh} kWh · ${d.sessions} sessie${d.sessions === 1 ? '' : 's'}`}
                        className="flex h-full flex-1 cursor-pointer flex-col justify-end"
                      >
                        <div
                          className={gekozen ? 'w-full rounded-t-[3px] bg-slate-700 dark:bg-slate-200' : vandaag ? 'w-full rounded-t-[3px] bg-oker-500' : 'w-full rounded-t-[3px] bg-oker-400/70'}
                          style={{ height: d.kwh > 0 ? `${Math.max(4, Math.round((d.kwh / grafiek.max) * 100))}%` : '2px' }}
                        />
                      </button>
                    );
                  })}
                </div>
                <div className="mt-1 flex min-h-4 gap-[3px]">
                  {grafiek.dagen.map((d) => (
                    <span key={d.date} className="flex-1 text-center text-[10px] font-medium tabular-nums text-slate-400">
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
                waarde={vermogenTermijn}
                opties={[{ id: '24u', label: '24 u' }, { id: '7d', label: '7 d' }, { id: 'maand', label: 'maand' }]}
                onKies={(t) => { setVermogenTermijn(t); setGekozenSlot(null); }}
              />
            </div>
            {vermogen.staven.length === 0 ? (
              <p className="text-sm text-slate-500">Nog geen vermogens-snapshots — de eerste verschijnt bij de volgende sync (elke 30 min).</p>
            ) : (
              <>
                <div className={cn('flex h-24 items-end', vermogen.modus === 'slots' ? 'gap-[2px]' : 'gap-[3px]')}>
                  {vermogen.staven.map((st) => {
                    const gekozen = gekozenSlot === st.key;
                    const kop = vermogen.modus === 'slots'
                      ? uurLabel(st.key)
                      : new Date(`${st.key}T00:00:00`).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' });
                    return (
                      <button
                        key={st.key}
                        type="button"
                        onClick={() => setGekozenSlot(gekozen ? null : st.key)}
                        aria-pressed={gekozen}
                        aria-label={`${kop}: ${st.kw} kW, ${st.charging} sessies`}
                        title={`${kop} · ${st.kw} kW · ${st.charging} sessie${st.charging === 1 ? '' : 's'}`}
                        className="flex h-full flex-1 cursor-pointer flex-col justify-end"
                      >
                        <div
                          className={gekozen ? 'w-full rounded-t-[3px] bg-slate-700 dark:bg-slate-200' : st.isPiek ? 'w-full rounded-t-[3px] bg-oker-500' : 'w-full rounded-t-[3px] bg-blue-400/60'}
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
                  <div className="mt-1 flex min-h-4 gap-[3px]">
                    {vermogen.staven.map((st) => (
                      <span key={st.key} className="flex-1 text-center text-[10px] font-medium tabular-nums text-slate-400">{st.asLabel}</span>
                    ))}
                  </div>
                ) : (
                  <div className="mt-1 flex min-h-4 justify-between text-[10px] font-medium tabular-nums text-slate-400">
                    <span>{vermogen.staven.length > 0 ? uurLabel(vermogen.staven[0].key) : ''}</span>
                    <span>nu</span>
                  </div>
                )}
                {(() => {
                  const st = vermogen.staven.find((x) => x.key === gekozenSlot);
                  if (st) {
                    const kop = vermogen.modus === 'slots'
                      ? uurLabel(st.key)
                      : `${new Date(`${st.key}T00:00:00`).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' })} · piek om ${uurLabel((st as any).ts ?? st.key)}`;
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

          {/* Live sessies */}
          <div>
            <AdminSubsectionHeader title="Lopende sessies" />
            {data.activeSessions.length === 0 ? (
              <EmptyState mascotte={false} title="Geen lopende sessies" message="Er wordt op dit moment niet geladen (of ze zijn nog niet gesynchroniseerd)." />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {data.activeSessions.map((s) => {
                  // powerKw 0 op 100% SoC is correct (vol, druppelt niet meer);
                  // dan zegt "vol" meer dan "0 kW".
                  const vol = (s.soc ?? 0) >= 100 || (typeof s.powerKw === 'number' && s.powerKw <= 0);
                  return (
                    <div key={s.id} className="surface-card p-4 rounded-2xl flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-800 truncate">
                          {(() => {
                            const nummer = (s.evse_uid && nummerByUid.get(s.evse_uid)) || s.evse_uid || 'Onbekende paal';
                            const bus = busVoorLaadpunt(nummer);
                            return bus ? `Laadpunt ${nummer} · bus ${bus}` : `Laadpunt ${nummer}`;
                          })()}
                        </p>
                        <p className="text-[11px] text-slate-500">
                          sinds {s.start_date_time ? new Date(s.start_date_time).toLocaleString() : '—'}
                          {typeof s.kwh === 'number' ? ` · ${s.kwh} kWh geladen` : ''}
                        </p>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <Badge tone={vol ? 'emerald' : 'blue'} dot>
                          {typeof s.powerKw === 'number' ? (vol ? 'vol' : `${s.powerKw} kW`) : 'Laden'}
                        </Badge>
                        {typeof s.soc === 'number' && (
                          <span className="text-[11px] font-semibold tabular-nums text-slate-500">{s.soc}% batterij</span>
                        )}
                      </div>
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
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        {groepeerPerCpu(loc.evses).map((cpu) => {
                          const laden = cpu.evses.filter((e) => e.status === 'CHARGING').length;
                          return (
                            <div key={cpu.key} className="rounded-2xl border border-slate-100 p-3.5">
                              <div className="mb-2.5 flex items-baseline justify-between gap-2 border-b border-slate-100 pb-2">
                                <span className="text-sm font-bold text-slate-800">{cpu.label}</span>
                                <span className="text-[11px] font-medium tabular-nums text-slate-400">
                                  {laden > 0 ? `${laden} aan het laden` : `${cpu.evses.length} punten`}
                                </span>
                              </div>
                              <div className="space-y-1">
                                {cpu.evses.map((evse) => {
                                  // Actuele sessie bij dit punt: toon kW + batterij%
                                  // op de regel zelf i.p.v. alleen bij "Lopende
                                  // sessies" — vol (0 kW / 100%) leest als "vol".
                                  const sessie = sessieByEvse.get(evse.uid);
                                  const vol = sessie && ((sessie.soc ?? 0) >= 100 || (typeof sessie.powerKw === 'number' && sessie.powerKw <= 0));
                                  return (
                                    <div key={evse.uid} className="flex min-h-8 items-center justify-between gap-2">
                                      {/* Vaste kolombreedtes: "1" en "13.A" verschillen
                                          in breedte, en zonder kolommen schoof alles wat
                                          erachter komt per rij naar een andere plek. De
                                          bus-kolom rendert ook leeg, zodat kW/percentage
                                          bij álle rijen op dezelfde x beginnen. */}
                                      <span className="flex min-w-0 items-baseline">
                                        <span className="w-11 shrink-0 text-sm font-semibold tabular-nums text-slate-700">{evse.evse_id ?? evse.uid}</span>
                                        <span className="w-14 shrink-0 text-[11px] font-medium tabular-nums text-slate-400">
                                          {busVoorLaadpunt(evse.evse_id) ? `bus ${busVoorLaadpunt(evse.evse_id)}` : ''}
                                        </span>
                                        {sessie ? (
                                          <span className={cn('truncate text-[11px] font-semibold tabular-nums', vol ? 'text-emerald-600 dark:text-emerald-400' : 'text-blue-600 dark:text-blue-400')}>
                                            {vol ? 'vol' : `${sessie.powerKw} kW`}{typeof sessie.soc === 'number' ? ` · ${sessie.soc}%` : ''}
                                          </span>
                                        ) : evse.connectors[0] ? (
                                          <span className="truncate text-[11px] text-slate-400 tabular-nums">{kW(evse.connectors[0].max_electric_power)}</span>
                                        ) : null}
                                      </span>
                                      <Badge tone={statusTone(evse.status)} dot>{statusLabel(evse.status)}</Badge>
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
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </PageShell>
  );
}
