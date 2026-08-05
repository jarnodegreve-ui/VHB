import { Fragment, useEffect, useMemo, useState } from 'react';
import { Zap, MapPin, BatteryCharging, Gauge, RefreshCw } from 'lucide-react';
import { getSupabaseAuthHeaders } from '../../lib/ui';
import { PageHeader, PageShell, AdminSubsectionHeader, EmptyState } from '../../components/ui';
import { StatCard } from '../../components/StatCard';
import { SkeletonTile } from '../../components/Skeleton';
import { Badge, Button, MicroLabel } from '../../components/primitives';

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

  // Doorlopende 30-dagen-reeks voor de kolomgrafiek: dagen zonder sessies
  // worden 0 in plaats van weggelaten, anders schuiven de kolommen en klopt
  // het ritme (weekend vs. week) niet meer.
  const grafiek = useMemo(() => {
    const perDag = new Map((data?.kwhPerDay ?? []).map((d) => [d.date, d]));
    const dagen: Array<{ date: string; kwh: number; sessions: number; dow: number }> = [];
    for (let i = 29; i >= 0; i--) {
      const dt = new Date();
      dt.setDate(dt.getDate() - i);
      const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      const rij = perDag.get(iso);
      dagen.push({ date: iso, kwh: rij?.kwh ?? 0, sessions: rij?.sessions ?? 0, dow: dt.getDay() });
    }
    const max = Math.max(1, ...dagen.map((d) => d.kwh));
    const totaal = Math.round(dagen.reduce((a, d) => a + d.kwh, 0) * 10) / 10;
    const actieveDagen = dagen.filter((d) => d.kwh > 0).length;
    const gemiddeld = actieveDagen > 0 ? Math.round((totaal / actieveDagen) * 10) / 10 : 0;
    return { dagen, max, totaal, gemiddeld, piek: Math.max(...dagen.map((d) => d.kwh)) };
  }, [data?.kwhPerDay]);

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
          {/* KPI-tegels */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={<MapPin size={20} className="text-oker-600" />} label="Locaties" value={String(data.totals.locations)} subValue={`${data.totals.evses} laadpunten`} />
            <StatCard icon={<BatteryCharging size={20} className="text-blue-600 dark:text-blue-400" />} label="Actieve sessies" value={String(data.totals.activeSessions)} subValue={data.totals.totalPowerKw > 0 ? `${data.totals.totalPowerKw} kW op dit moment` : 'op dit moment'} />
            <StatCard icon={<Zap size={20} className="text-emerald-600" />} label="kWh (30 dagen)" value={String(data.totals.kwh30d)} subValue={`${data.totals.sessions30d} sessies`} />
            <StatCard icon={<Gauge size={20} className="text-slate-600" />} label="Connectoren" value={String(data.totals.connectors)} subValue="totaal aangesloten" />
          </div>

          {/* Statusoverzicht */}
          <div className="surface-card p-6 rounded-3xl">
            <MicroLabel className="mb-4">Status laadpunten</MicroLabel>
            {Object.keys(data.statusCounts).length === 0 ? (
              <p className="text-sm text-slate-500">Nog geen laadpunten gesynchroniseerd.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {Object.entries(data.statusCounts).sort((a, b) => Number(b[1]) - Number(a[1])).map(([status, count]) => (
                  <Fragment key={status}><Badge tone={statusTone(status)} dot>{`${statusLabel(status)}: ${count}`}</Badge></Fragment>
                ))}
              </div>
            )}
          </div>

          {/* kWh per dag — compacte kolomgrafiek: 30 dagen naast elkaar in een
              vast laag blok i.p.v. één rij per dag (dat werd een muur van 30
              regels). Ontbrekende dagen tellen als 0 zodat het weekritme
              klopt; maandagen krijgen een dagnummer als anker. */}
          <div className="surface-card p-6 rounded-3xl">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <MicroLabel>Verbruik per dag (kWh)</MicroLabel>
              <span className="text-[11px] font-semibold tabular-nums text-slate-500">
                {grafiek.totaal} kWh · 30 dagen
              </span>
            </div>
            {data.kwhPerDay.length === 0 ? (
              <p className="text-sm text-slate-500">Nog geen sessies gesynchroniseerd.</p>
            ) : (
              <>
                <div className="flex h-24 items-end gap-[3px]">
                  {grafiek.dagen.map((d, i) => {
                    const vandaag = i === grafiek.dagen.length - 1;
                    return (
                      <div
                        key={d.date}
                        title={`${d.date.slice(5)} · ${d.kwh} kWh · ${d.sessions} sessie${d.sessions === 1 ? '' : 's'}`}
                        className="flex h-full flex-1 flex-col justify-end"
                      >
                        <div
                          className={vandaag ? 'rounded-t-[3px] bg-oker-500' : 'rounded-t-[3px] bg-oker-400/70'}
                          style={{ height: d.kwh > 0 ? `${Math.max(4, Math.round((d.kwh / grafiek.max) * 100))}%` : '2px' }}
                        />
                      </div>
                    );
                  })}
                </div>
                <div className="mt-1 flex gap-[3px]">
                  {grafiek.dagen.map((d) => (
                    <span key={d.date} className="flex-1 text-center text-[10px] font-medium tabular-nums text-slate-400">
                      {d.dow === 1 ? Number(d.date.slice(8)) : ''}
                    </span>
                  ))}
                </div>
                <p className="mt-3 text-[11px] font-medium tabular-nums text-slate-500">
                  vandaag {grafiek.dagen.at(-1)?.kwh ?? 0} kWh · gemiddeld {grafiek.gemiddeld} kWh/laaddag · piek {grafiek.piek} kWh
                </p>
              </>
            )}
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
                        <p className="text-sm font-semibold text-slate-800 truncate">{s.evse_uid ?? 'Onbekende paal'}</p>
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
                                {cpu.evses.map((evse) => (
                                  <div key={evse.uid} className="flex min-h-8 items-center justify-between gap-2">
                                    <span className="flex min-w-0 items-baseline gap-1.5">
                                      <span className="text-sm font-semibold tabular-nums text-slate-700">{evse.evse_id ?? evse.uid}</span>
                                      {evse.connectors[0] && (
                                        <span className="truncate text-[11px] text-slate-400 tabular-nums">{kW(evse.connectors[0].max_electric_power)}</span>
                                      )}
                                    </span>
                                    <Badge tone={statusTone(evse.status)} dot>{statusLabel(evse.status)}</Badge>
                                  </div>
                                ))}
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
