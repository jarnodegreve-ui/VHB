import { Fragment, useEffect, useState } from 'react';
import { Zap, MapPin, BatteryCharging, Gauge, RefreshCw } from 'lucide-react';
import { getSupabaseAuthHeaders, notify } from '../../lib/ui';
import { PageHeader, PageShell, AdminSubsectionHeader, EmptyState } from '../../components/ui';
import { StatCard } from '../../components/StatCard';
import { Badge, Button, MicroLabel } from '../../components/primitives';

type Connector = { id: string; standard?: string; power_type?: string; max_electric_power?: number };
type Evse = { uid: string; evse_id?: string; status?: string; connectors: Connector[] };
type DashLocation = { id: string; name?: string; city?: string; evses: Evse[] };
type ActiveSession = { id: string; evse_uid?: string; location_id?: string; status?: string; start_date_time?: string; kwh?: number };
type Dashboard = {
  totals: { locations: number; evses: number; connectors: number; activeSessions: number; cdrs30d: number; kwh30d: number };
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

  const maxKwh = Math.max(1, ...(data?.kwhPerDay ?? []).map((d) => d.kwh));

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

      {data && (
        <div className="space-y-6">
          {/* KPI-tegels */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard icon={<MapPin size={20} className="text-oker-600" />} label="Locaties" value={String(data.totals.locations)} subValue={`${data.totals.evses} laadpunten`} />
            <StatCard icon={<BatteryCharging size={20} className="text-blue-600" />} label="Actieve sessies" value={String(data.totals.activeSessions)} subValue="op dit moment" />
            <StatCard icon={<Zap size={20} className="text-emerald-600" />} label="kWh (30 dagen)" value={String(data.totals.kwh30d)} subValue={`${data.totals.cdrs30d} sessies`} />
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

          {/* kWh per dag */}
          <div className="surface-card p-6 rounded-3xl">
            <MicroLabel className="mb-4">Verbruik per dag (kWh)</MicroLabel>
            {data.kwhPerDay.length === 0 ? (
              <p className="text-sm text-slate-500">Nog geen afgeronde sessies (CDR's) gesynchroniseerd.</p>
            ) : (
              <div className="space-y-1.5">
                {data.kwhPerDay.map((d) => (
                  <div key={d.date} className="flex items-center gap-3">
                    <span className="w-20 shrink-0 text-[11px] font-mono text-slate-500 tabular-nums">{d.date.slice(5)}</span>
                    <div className="flex-1 h-4 rounded-md bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-md bg-oker-400" style={{ width: `${Math.round((d.kwh / maxKwh) * 100)}%` }} />
                    </div>
                    <span className="w-24 shrink-0 text-right text-xs font-semibold text-slate-700 tabular-nums">{d.kwh} kWh</span>
                    <span className="w-14 shrink-0 text-right text-[11px] text-slate-400 tabular-nums">{d.sessions}×</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Live sessies */}
          <div>
            <AdminSubsectionHeader title="Lopende sessies" />
            {data.activeSessions.length === 0 ? (
              <EmptyState title="Geen lopende sessies" message="Er wordt op dit moment niet geladen (of ze zijn nog niet gesynchroniseerd)." />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {data.activeSessions.map((s) => (
                  <div key={s.id} className="surface-card p-4 rounded-2xl flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{s.evse_uid ?? 'Onbekende paal'}</p>
                      <p className="text-[11px] text-slate-500">sinds {s.start_date_time ? new Date(s.start_date_time).toLocaleString() : '—'}</p>
                    </div>
                    <Badge tone="blue" dot>{typeof s.kwh === 'number' ? `${s.kwh} kWh` : 'Laden'}</Badge>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Stations + laadpunten */}
          <div>
            <AdminSubsectionHeader title="Laadpalen per locatie" />
            {data.locations.length === 0 ? (
              <EmptyState title="Nog geen locaties" message="Klik in Systeem Status → OCPI-koppeling op 'Nu synchroniseren' om de laadpalen op te halen." />
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
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {loc.evses.map((evse) => (
                          <div key={evse.uid} className="rounded-2xl border border-slate-100 p-3.5">
                            <div className="flex items-center justify-between gap-2 mb-2">
                              <span className="text-sm font-semibold text-slate-700 truncate">{evse.evse_id ?? evse.uid}</span>
                              <Badge tone={statusTone(evse.status)} dot>{statusLabel(evse.status)}</Badge>
                            </div>
                            <div className="space-y-1">
                              {evse.connectors.map((c) => (
                                <div key={c.id} className="flex items-center justify-between text-[11px] text-slate-500">
                                  <span className="truncate">{c.standard ?? 'connector'} · {c.power_type ?? ''}</span>
                                  <span className="font-mono tabular-nums shrink-0">{kW(c.max_electric_power)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
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
