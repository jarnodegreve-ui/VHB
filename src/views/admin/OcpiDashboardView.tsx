import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Zap, BatteryCharging, Gauge, RefreshCw } from 'lucide-react';
import { cn, getSupabaseAuthHeaders } from '../../lib/ui';
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

  // Vermogenscurve (24u): piek + piekmoment voor de samenvattingsregel.
  const vermogen = useMemo(() => {
    const punten = data?.powerCurve ?? [];
    const maxKw = Math.max(1, ...punten.map((pt) => pt.kw));
    const piek = punten.reduce((best, pt) => (pt.kw > best.kw ? pt : best), { ts: '', kw: 0, charging: 0 });
    return { punten, maxKw, piek };
  }, [data?.powerCurve]);
  // Tik-selectie op de grafiekstaven: op een telefoon is er geen hover-title,
  // dus een tik op een staaf toont de details in de samenvattingsregel.
  const [gekozenDag, setGekozenDag] = useState<string | null>(null);
  const [gekozenSlot, setGekozenSlot] = useState<string | null>(null);
  const sessieByEvse = useMemo(
    () => new Map((data?.activeSessions ?? []).filter((x) => x.evse_uid).map((x) => [String(x.evse_uid), x])),
    [data?.activeSessions],
  );
  const uurLabel = (ts: string) => new Date(ts).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
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
                <div className="mt-1 flex gap-[3px]">
                  {grafiek.dagen.map((d) => (
                    <span key={d.date} className="flex-1 text-center text-[10px] font-medium tabular-nums text-slate-400">
                      {d.dow === 1 ? Number(d.date.slice(8)) : ''}
                    </span>
                  ))}
                </div>
                {(() => {
                  const dag = grafiek.dagen.find((d) => d.date === gekozenDag);
                  return dag ? (
                    <p className="mt-3 text-[11px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                      {new Date(`${dag.date}T00:00:00`).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' })} · {dag.kwh} kWh · {dag.sessions} sessie{dag.sessions === 1 ? '' : 's'}
                    </p>
                  ) : (
                    <p className="mt-3 text-[11px] font-medium tabular-nums text-slate-500">
                      vandaag {Math.round(grafiek.dagen.at(-1)?.kwh ?? 0)} kWh · gemiddeld {grafiek.gemiddeld} kWh/laaddag · piek {Math.round(grafiek.piek)} kWh
                    </p>
                  );
                })()}
              </>
            )}
          </div>

          {/* Vermogen (24u) — de kwartierpiek bepaalt in België het
              capaciteitstarief; deze curve laat zien wannéér alles tegelijk
              trekt. Gevoed door de 30-min-snapshots van de sync. */}
          <div className="surface-card p-6 rounded-3xl">
            <div className="mb-4 flex items-baseline justify-between gap-3">
              <MicroLabel>Vermogen (24 u)</MicroLabel>
              {vermogen.piek.kw > 0 && (
                <span className="text-[11px] font-semibold tabular-nums text-slate-500">
                  piek {vermogen.piek.kw} kW om {uurLabel(vermogen.piek.ts)}
                </span>
              )}
            </div>
            {vermogen.punten.length === 0 ? (
              <p className="text-sm text-slate-500">Nog geen vermogens-snapshots — de eerste verschijnt bij de volgende sync (elke 30 min).</p>
            ) : (
              <>
                <div className="flex h-20 items-end gap-[2px]">
                  {vermogen.punten.map((pt) => {
                    const gekozen = gekozenSlot === pt.ts;
                    return (
                      <button
                        key={pt.ts}
                        type="button"
                        onClick={() => setGekozenSlot(gekozen ? null : pt.ts)}
                        aria-pressed={gekozen}
                        aria-label={`${uurLabel(pt.ts)}: ${pt.kw} kW, ${pt.charging} sessies`}
                        title={`${uurLabel(pt.ts)} · ${pt.kw} kW · ${pt.charging} sessie${pt.charging === 1 ? '' : 's'}`}
                        className="flex h-full flex-1 cursor-pointer flex-col justify-end"
                      >
                        <div
                          className={gekozen ? 'w-full rounded-t-[3px] bg-slate-700 dark:bg-slate-200' : pt.ts === vermogen.piek.ts ? 'w-full rounded-t-[3px] bg-oker-500' : 'w-full rounded-t-[3px] bg-blue-400/60'}
                          style={{ height: pt.kw > 0 ? `${Math.max(4, Math.round((pt.kw / vermogen.maxKw) * 100))}%` : '2px' }}
                        />
                      </button>
                    );
                  })}
                </div>
                {(() => {
                  const slot = vermogen.punten.find((pt) => pt.ts === gekozenSlot);
                  return slot ? (
                    <p className="mt-1.5 text-[11px] font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                      {uurLabel(slot.ts)} · {slot.kw} kW · {slot.charging} sessie{slot.charging === 1 ? '' : 's'}
                    </p>
                  ) : (
                    <div className="mt-1 flex justify-between text-[10px] font-medium tabular-nums text-slate-400">
                      <span>{uurLabel(vermogen.punten[0].ts)}</span>
                      <span>nu</span>
                    </div>
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
                                {cpu.evses.map((evse) => {
                                  // Actuele sessie bij dit punt: toon kW + batterij%
                                  // op de regel zelf i.p.v. alleen bij "Lopende
                                  // sessies" — vol (0 kW / 100%) leest als "vol".
                                  const sessie = sessieByEvse.get(evse.uid);
                                  const vol = sessie && ((sessie.soc ?? 0) >= 100 || (typeof sessie.powerKw === 'number' && sessie.powerKw <= 0));
                                  return (
                                    <div key={evse.uid} className="flex min-h-8 items-center justify-between gap-2">
                                      <span className="flex min-w-0 items-baseline gap-1.5">
                                        <span className="text-sm font-semibold tabular-nums text-slate-700">{evse.evse_id ?? evse.uid}</span>
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
