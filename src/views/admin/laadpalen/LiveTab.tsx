import { useMemo, useState } from 'react';
import { AlertTriangle, BatteryCharging, Gauge, X, Zap } from 'lucide-react';
import { busVoorLaadpunt } from '../../../lib/laadplein';
import { isoDate } from '../../../lib/datum';
import { WEEKDAY_SHORT_SUN, metEenheid } from '../../../lib/format';
import { Modal } from '../../../components/Modal';
import { EmptyState } from '../../../components/ui';
import { OpsStat } from '../../../components/ops';
import { Badge, Button, IconButton, MicroLabel, microLabelClass } from '../../../components/primitives';
import { Card, CardHeader } from '../../../components/Card';
import { AllesGedaan } from '../../../components/illustraties';
import {
  TermijnKeuze, dagKort, fmtKwh, groepeerPerCpu, laadStatus, statusLabel, statusTone, stilStatus, tekstKw, tekstKwh, tijdstipKort, uurLabel,
} from './gedeeld';
import { Staafgrafiek, StapCurve, useKeuze } from './grafieken';

/**
 * Tabblad Live: wat er nú aan de lader hangt. KPI's, de kwartiercurve van de
 * laatste 24 uur (met de maandpiek als referentie), het verbruik van de
 * laatste dagen, de lopende sessies, alle laadpunten per CPU en de
 * storingen uit ChargEye. De maandcijfers en de historiek zitten in de
 * andere tabbladen.
 */

type Connector = { id: string; standard?: string; power_type?: string; max_electric_power?: number };
export type Evse = { uid: string; evse_id?: string; status?: string; physical_reference?: string | null; connectors: Connector[] };
type DashLocation = { id: string; name?: string; city?: string; evses: Evse[] };
type ActiveSession = { id: string; evse_uid?: string; location_id?: string; status?: string; start_date_time?: string; kwh?: number; powerKw?: number | null; soc?: number | null };
export type Dashboard = {
  totals: { evses: number; sessions30d: number; totalPowerKw: number };
  statusCounts: Record<string, number>;
  locations: DashLocation[];
  activeSessions: ActiveSession[];
  kwhPerDay: Array<{ date: string; kwh: number; sessions: number }>;
  powerCurve: Array<{ ts: string; kw: number; charging: number }>;
  powerDays?: Array<{ date: string; kw: number; ts: string; charging: number }>;
  storingen?: Array<{ soort: 'laadpunt' | 'sessie'; evseUid: string | null; status?: string; classificatie?: string; wanneer: string | null }>;
};

const maxVermogen = (w?: number) => (typeof w === 'number' ? tekstKw(w / 1000) : '—');

export function LiveTab({ data, onDag }: { data: Dashboard; onDag: (dag: string) => void }) {
  const [verbruikTermijn, setVerbruikTermijn] = useState<'7d' | '30d'>('7d');
  const [vermogenTermijn, setVermogenTermijn] = useState<'24u' | '7d'>('24u');
  const [gekozenDag, setGekozenDag] = useKeuze(verbruikTermijn);
  const [gekozenSlot, setGekozenSlot] = useKeuze(vermogenTermijn);
  const [gekozenPunt, setGekozenPunt] = useState<Evse | null>(null);
  const [alleStoringen, setAlleStoringen] = useState(false);
  const storingen = data.storingen ?? [];

  // Doorlopende dagreeks (dagen zonder sessies = 0) zodat het weekritme klopt.
  const grafiek = useMemo(() => {
    const perDag = new Map((data.kwhPerDay ?? []).map((d) => [d.date, d]));
    const alle: Array<{ date: string; kwh: number; sessions: number; dow: number }> = [];
    for (let i = 29; i >= 0; i--) {
      const dt = new Date();
      dt.setDate(dt.getDate() - i);
      const iso = isoDate(dt);
      const rij = perDag.get(iso);
      alle.push({ date: iso, kwh: rij?.kwh ?? 0, sessions: rij?.sessions ?? 0, dow: dt.getDay() });
    }
    const dagen = verbruikTermijn === '7d' ? alle.slice(-7) : alle;
    const totaal = Math.round(dagen.reduce((a, d) => a + d.kwh, 0) * 10) / 10;
    const actieveDagen = dagen.filter((d) => d.kwh > 0).length;
    return { dagen, totaal, gemiddeld: actieveDagen > 0 ? Math.round((totaal / actieveDagen) * 10) / 10 : 0, piek: Math.max(0, ...dagen.map((d) => d.kwh)) };
  }, [data.kwhPerDay, verbruikTermijn]);
  const kwh30 = useMemo(() => Math.round((data.kwhPerDay ?? []).reduce((a, d) => a + d.kwh, 0)), [data.kwhPerDay]);
  const vandaag = isoDate(new Date());

  const slots24 = useMemo(() => (data.powerCurve ?? []).map((pt) => ({ key: pt.ts, ts: pt.ts, kw: pt.kw, charging: pt.charging })), [data.powerCurve]);
  const piek24 = slots24.reduce((best, s) => (s.kw > best.kw ? s : best), { key: '', ts: '', kw: 0, charging: 0 });
  const dagen7 = useMemo(() => {
    const vanaf = isoDate(new Date(Date.now() - 6 * 24 * 3600 * 1000));
    const per = new Map((data.powerDays ?? []).map((d) => [d.date, d]));
    const uit: Array<{ date: string; kw: number; ts: string; charging: number; dow: number }> = [];
    for (let i = 6; i >= 0; i--) {
      const dt = new Date(); dt.setDate(dt.getDate() - i);
      const iso = isoDate(dt);
      const d = per.get(iso);
      if (iso >= vanaf) uit.push({ date: iso, kw: d?.kw ?? 0, ts: d?.ts ?? '', charging: d?.charging ?? 0, dow: dt.getDay() });
    }
    return uit;
  }, [data.powerDays]);
  const piek7 = dagen7.reduce((best, d) => (d.kw > best.kw ? d : best), { date: '', kw: 0, ts: '', charging: 0, dow: 0 });
  // Hoogste dagpiek van de laatste ±31 dagen: de norm waartegen de curve van
  // vandaag gelezen wordt.
  const maandpiek = useMemo(() => Math.max(0, ...(data.powerDays ?? []).map((d) => d.kw)), [data.powerDays]);

  const nummerByUid = useMemo(() => {
    const map = new Map<string, string>();
    for (const loc of data.locations ?? []) for (const e of loc.evses) if (e.evse_id) map.set(e.uid, e.evse_id);
    return map;
  }, [data.locations]);
  const sessieByEvse = useMemo(
    () => new Map((data.activeSessions ?? []).filter((x) => x.evse_uid).map((x) => [String(x.evse_uid), x])),
    [data.activeSessions],
  );
  const kpi = useMemo(() => {
    const sc = data.statusCounts ?? {};
    const laden = sc.CHARGING ?? 0;
    const beschikbaar = sc.AVAILABLE ?? 0;
    const afwijkend = Object.entries(sc).filter(([st]) => st !== 'AVAILABLE' && st !== 'CHARGING');
    const afwijkendTotaal = afwijkend.reduce((a, [, n]) => a + Number(n), 0);
    const afwijkendTekst = afwijkend.sort((a, b) => Number(b[1]) - Number(a[1])).map(([st, n]) => `${n}× ${statusLabel(st).toLowerCase()}`).join(' · ');
    return { laden, beschikbaar, afwijkend: afwijkendTotaal, afwijkendTekst };
  }, [data.statusCounts]);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <OpsStat icon={<BatteryCharging size={16} />} tone={kpi.laden > 0 ? 'blue' : 'slate'} label="Aan de lader" value={kpi.laden} suffix={` / ${data.totals.evses}`} sub={data.totals.totalPowerKw > 0 ? `${tekstKw(data.totals.totalPowerKw)} nu` : 'geen vermogen nu'} />
        <OpsStat icon={<Zap size={16} />} tone="slate" label="Beschikbaar" value={kpi.beschikbaar} sub="vrije laadpunten" />
        <OpsStat icon={<AlertTriangle size={16} />} tone={kpi.afwijkend > 0 ? 'red' : 'slate'} label="Afwijkend" value={kpi.afwijkend} sub={kpi.afwijkend > 0 ? kpi.afwijkendTekst : 'alles operationeel'} />
        <OpsStat icon={<Gauge size={16} />} tone="slate" label="Vandaag geladen" text={fmtKwh(grafiek.dagen.at(-1)?.kwh ?? 0)} suffix={' kWh'} sub={`30 d: ${tekstKwh(kwh30)} · ${data.totals.sessions30d} laadsessies`} onClick={() => onDag(vandaag)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-4 flex items-center justify-between gap-3">
            <MicroLabel>Vermogen (kW)</MicroLabel>
            <TermijnKeuze<'24u' | '7d'> label="Termijn vermogensgrafiek" waarde={vermogenTermijn} opties={[{ id: '24u', label: metEenheid(24, 'u') }, { id: '7d', label: metEenheid(7, 'd') }]} onKies={setVermogenTermijn} />
          </div>
          {vermogenTermijn === '24u' ? (
            slots24.length === 0 ? (
              <p className="text-sm text-slate-500">Nog geen vermogens-snapshots, de eerste verschijnt bij de volgende sync (elk kwartier).</p>
            ) : (
              <StapCurve
                slots={slots24}
                ariaLabel={`Vermogen laatste 24 uur: ${piek24.kw > 0 ? `piek ${tekstKw(piek24.kw)} om ${uurLabel(piek24.ts)}` : 'nog geen vermogen gemeten'}${maandpiek > 0 ? `, maandpiek ${tekstKw(Math.round(maandpiek))}` : ''}`}
                gekozen={gekozenSlot}
                onKies={setGekozenSlot}
                titelVan={(s) => `${uurLabel(s.ts)} · ${tekstKw(s.kw)} · ${s.charging} sessie${s.charging === 1 ? '' : 's'}`}
                referentie={maandpiek > 0 ? { waarde: maandpiek, label: `maandpiek ${tekstKw(Math.round(maandpiek))}` } : null}
                asLinks={uurLabel(slots24[0].ts)}
                asRechts="nu"
                samenvatting={(s) => (s
                  ? `${uurLabel(s.ts)} · ${tekstKw(s.kw)} · ${s.charging} sessie${s.charging === 1 ? '' : 's'}`
                  : piek24.kw > 0 ? `piek ${tekstKw(piek24.kw)} om ${uurLabel(piek24.ts)}` : 'nog geen vermogen gemeten')}
              />
            )
          ) : (
            <Staafgrafiek
              staven={dagen7.map((d) => ({ key: d.date, waarde: d.kw, asLabel: WEEKDAY_SHORT_SUN[d.dow], isPiek: d.kw > 0 && d.date === piek7.date, ontbreekt: d.kw === 0 && !d.ts }))}
              eenheid="kW"
              ariaLabel={`Dagpiek per dag, laatste 7 dagen: ${piek7.kw > 0 ? `hoogste ${tekstKw(piek7.kw)} op ${dagKort(piek7.date)}` : 'nog geen meting'}`}
              gekozen={gekozenSlot}
              onKies={setGekozenSlot}
              titelVan={(s) => { const d = dagen7.find((x) => x.date === s.key); return `${dagKort(s.key)} · ${tekstKw(s.waarde)}${d?.ts ? ` om ${uurLabel(d.ts)}` : ''}`; }}
              samenvatting={(s) => {
                const d = s ? dagen7.find((x) => x.date === s.key) : null;
                return d
                  ? `${dagKort(d.date)} · piek ${tekstKw(d.kw)}${d.ts ? ` om ${uurLabel(d.ts)}` : ''} · ${d.charging} sessie${d.charging === 1 ? '' : 's'}`
                  : piek7.kw > 0 ? `hoogste dagpiek ${tekstKw(piek7.kw)} op ${dagKort(piek7.date)} om ${uurLabel(piek7.ts)}` : 'nog geen meting';
              }}
            />
          )}
        </Card>

        <Card>
          <div className="mb-4 flex items-center justify-between gap-3">
            <MicroLabel>Verbruik (kWh)</MicroLabel>
            <TermijnKeuze<'7d' | '30d'> label="Termijn verbruiksgrafiek" waarde={verbruikTermijn} opties={[{ id: '7d', label: metEenheid(7, 'd') }, { id: '30d', label: metEenheid(30, 'd') }]} onKies={setVerbruikTermijn} />
          </div>
          {data.kwhPerDay.length === 0 ? (
            <p className="text-sm text-slate-500">Nog geen sessies gesynchroniseerd.</p>
          ) : (
            <Staafgrafiek
              staven={grafiek.dagen.map((d) => ({ key: d.date, waarde: d.kwh, asLabel: grafiek.dagen.length <= 7 ? WEEKDAY_SHORT_SUN[d.dow] : d.dow === 1 ? String(Number(d.date.slice(8))) : '', isPiek: d.kwh > 0 && d.kwh === grafiek.piek, gedempt: d.date === vandaag }))}
              eenheid="kWh"
              ariaLabel={`Verbruik per dag: totaal ${tekstKwh(Math.round(grafiek.totaal))}, gemiddeld ${tekstKwh(grafiek.gemiddeld)} per laaddag, piek ${tekstKwh(Math.round(grafiek.piek))}`}
              gekozen={gekozenDag}
              onKies={setGekozenDag}
              titelVan={(s) => { const d = grafiek.dagen.find((x) => x.date === s.key); return `${dagKort(s.key)} · ${tekstKwh(s.waarde)} · ${d?.sessions ?? 0} sessie${d?.sessions === 1 ? '' : 's'}`; }}
              samenvatting={(s) => {
                const d = s ? grafiek.dagen.find((x) => x.date === s.key) : null;
                return d
                  ? <>{dagKort(d.date)} · {tekstKwh(d.kwh)} · {d.sessions} sessie{d.sessions === 1 ? '' : 's'} · <Button variant="ghost" size="sm" className="-my-1 h-6 px-1.5 text-xs" onClick={() => onDag(d.date)}>dagdetail</Button></>
                  : `totaal ${tekstKwh(Math.round(grafiek.totaal))} · gemiddeld ${tekstKwh(grafiek.gemiddeld)}/laaddag · piek ${tekstKwh(Math.round(grafiek.piek))}`;
              }}
            />
          )}
        </Card>
      </div>

      <Modal open={!!gekozenPunt} onClose={() => setGekozenPunt(null)} maxWidth="sm" ariaLabel={gekozenPunt ? `Laadpunt ${gekozenPunt.evse_id ?? gekozenPunt.uid}` : 'Laadpunt'}>
        {gekozenPunt && (() => {
          const sessie = sessieByEvse.get(gekozenPunt.uid);
          const bus = busVoorLaadpunt(gekozenPunt.evse_id);
          const conn = gekozenPunt.connectors[0];
          const rij = (label: string, waarde: string) => (
            <div className="flex items-center justify-between gap-3 border-b border-hairline-subtle py-2.5 last:border-b-0">
              <span className={microLabelClass}>{label}</span>
              <span className="text-sm font-semibold font-mono text-slate-800">{waarde}</span>
            </div>
          );
          return (
            <div className="p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className="min-w-0 truncate text-card-title">Laadpunt {gekozenPunt.evse_id ?? gekozenPunt.uid}{bus ? ` · bus ${bus}` : ''}</h3>
                <span className="flex shrink-0 items-center gap-2">
                  <Badge tone={statusTone(gekozenPunt.status)} dot stil={stilStatus(statusTone(gekozenPunt.status))}>{statusLabel(gekozenPunt.status)}</Badge>
                  <IconButton label="Sluiten" variant="ghost" size="sm" onClick={() => setGekozenPunt(null)}><X size={16} /></IconButton>
                </span>
              </div>
              <div>
                {sessie && typeof sessie.powerKw === 'number' && rij('Actueel vermogen', tekstKw(sessie.powerKw))}
                {sessie && typeof sessie.soc === 'number' && rij('Batterij voertuig', `${sessie.soc} %`)}
                {sessie && typeof sessie.kwh === 'number' && rij('Geladen deze sessie', tekstKwh(sessie.kwh))}
                {sessie?.start_date_time && rij('Aangekoppeld sinds', tijdstipKort(sessie.start_date_time))}
                {conn && rij('Max. vermogen', maxVermogen(conn.max_electric_power))}
                {conn && rij('Connector', `${conn.standard ?? '—'}${conn.power_type ? ` · ${conn.power_type}` : ''}`)}
                {gekozenPunt.physical_reference && rij('Referentie ChargEye', gekozenPunt.physical_reference)}
                {!sessie && rij('Voertuig', 'geen aangekoppeld')}
              </div>
            </div>
          );
        })()}
      </Modal>

      <div>
        <CardHeader size="lg" title="Lopende sessies" />
        {data.activeSessions.length === 0 ? (
          <EmptyState title="Geen lopende sessies" message="Er wordt op dit moment niet geladen (of ze zijn nog niet gesynchroniseerd)." />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {data.activeSessions.map((s) => {
              const st = laadStatus('CHARGING', s);
              const nummer = (s.evse_uid && nummerByUid.get(s.evse_uid)) || s.evse_uid || 'Onbekende paal';
              const bus = busVoorLaadpunt(nummer);
              return (
                <Card key={s.id} padding="sm" className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-semibold text-slate-800">Laadpunt {nummer}{bus ? ` · bus ${bus}` : ''}</span>
                      {st.soc !== null && <Badge tone={st.vol ? 'emerald' : 'blue'} stil className="shrink-0 font-mono">{st.soc} %</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-slate-500">
                      sinds {tijdstipKort(s.start_date_time)}{typeof s.kwh === 'number' ? ` · ${tekstKwh(s.kwh)} geladen` : ''}
                    </p>
                  </div>
                  <Badge tone={st.vol ? 'emerald' : 'blue'} stil className="shrink-0 whitespace-nowrap">{st.label ?? 'Laden'}</Badge>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <CardHeader size="lg" title="Laadpalen per locatie" />
        {data.locations.length === 0 ? (
          <EmptyState title="Nog geen locaties" message='Klik in Systeemstatus › OCPI-koppeling op “Nu synchroniseren” om de laadpalen op te halen.' />
        ) : (
          <div className="space-y-4">
            {data.locations.map((loc) => (
              <Card key={loc.id}>
                <CardHeader className="mb-4" title={loc.name ?? loc.id} description={loc.city || undefined} aside={<span className="text-xs font-medium text-slate-500">{loc.evses.length} laadpunt{loc.evses.length === 1 ? '' : 'en'}</span>} />
                {loc.evses.length === 0 ? (
                  <p className="text-sm text-slate-500">Geen laadpunten.</p>
                ) : (
                  <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
                    {groepeerPerCpu(loc.evses).map((cpu) => {
                      const laden = cpu.evses.filter((e) => e.status === 'CHARGING').length;
                      return (
                        <div key={cpu.key} className="rounded-2xl border border-hairline-subtle p-3.5">
                          <div className="mb-2.5 flex items-baseline justify-between gap-2 border-b border-hairline-subtle pb-2">
                            <span className="text-sm font-bold text-slate-800">{cpu.label}</span>
                            <span className="text-xs font-medium font-mono text-slate-500">{laden > 0 ? `${laden} aan het laden` : `${cpu.evses.length} punten`}</span>
                          </div>
                          <div className="space-y-1">
                            {cpu.evses.map((evse) => {
                              const sessie = sessieByEvse.get(evse.uid);
                              const s = laadStatus(evse.status, sessie);
                              return (
                                // rauw: hele laadpuntrij (nummer · bus · pillen) is de knop naar de detail-popup
                                <button
                                  key={evse.uid}
                                  type="button"
                                  onClick={() => setGekozenPunt(evse)}
                                  aria-haspopup="dialog"
                                  aria-label={`Laadpunt ${evse.evse_id ?? evse.uid}, details`}
                                  className="ios-pressable flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-1 text-left transition-colors hover:bg-surface-soft-hover"
                                >
                                  <span className="flex shrink-0 items-center gap-1.5">
                                    <span className="w-11 shrink-0 text-sm font-semibold font-mono text-slate-700">{evse.evse_id ?? evse.uid}</span>
                                    <span className="w-14 shrink-0 text-xs font-medium font-mono text-slate-600">{busVoorLaadpunt(evse.evse_id) ? `bus ${busVoorLaadpunt(evse.evse_id)}` : ''}</span>
                                    {s.soc !== null && <Badge tone={s.vol ? 'emerald' : 'blue'} stil className="shrink-0 font-mono">{s.soc} %</Badge>}
                                  </span>
                                  <Badge tone={s.vol ? 'emerald' : statusTone(evse.status)} dot stil={s.vol || stilStatus(statusTone(evse.status))} className="shrink-0 whitespace-nowrap">
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
              </Card>
            ))}
          </div>
        )}
      </div>

      <div>
        <CardHeader size="lg" title="Storingen (ChargEye)" description="Defecte laadpunten en mislukte laadsessies van de afgelopen 7 dagen." />
        {storingen.length === 0 ? (
          <EmptyState variant="klaar" illustratie={<AllesGedaan />} title="Geen storingen" message="Alle laadpunten en laadsessies van de afgelopen 7 dagen zijn in orde." />
        ) : (
          <Card padding="none" className="overflow-hidden">
            <div className="divide-y divide-hairline-subtle">
              {(alleStoringen ? storingen : storingen.slice(0, 5)).map((st, i) => {
                const nummer = st.evseUid ? nummerByUid.get(st.evseUid) ?? st.evseUid : null;
                const bus = nummer ? busVoorLaadpunt(nummer) : null;
                return (
                  <div key={`${st.soort}-${st.evseUid ?? 'x'}-${st.wanneer ?? ''}-${i}`} className="flex min-h-11 items-center justify-between gap-3 px-4 py-2">
                    <p className="min-w-0 text-sm font-medium text-slate-700 max-sm:line-clamp-2 sm:truncate">
                      <span className="font-semibold text-slate-800">{nummer ? `Laadpunt ${nummer}` : 'Onbekend laadpunt'}{bus ? ` · bus ${bus}` : ''}</span>
                      <span className="text-slate-500">
                        {', '}
                        {st.soort === 'laadpunt'
                          ? `in storing (${statusLabel(st.status).toLowerCase()})`
                          : `laadsessie mislukt (${st.classificatie})${st.wanneer ? ` · ${tijdstipKort(st.wanneer)}` : ''}`}
                      </span>
                    </p>
                    <Badge tone="red" dot className="shrink-0 whitespace-nowrap">{st.soort === 'laadpunt' ? statusLabel(st.status) : 'Mislukt'}</Badge>
                  </div>
                );
              })}
            </div>
            {storingen.length > 5 && (
              <Button variant="ghost" size="sm" full className="rounded-none border-t border-hairline-subtle" aria-expanded={alleStoringen} onClick={() => setAlleStoringen((v) => !v)}>
                {alleStoringen ? 'Toon minder' : `Toon alle ${storingen.length} storingen`}
              </Button>
            )}
          </Card>
        )}
      </div>
    </div>
  );
}
