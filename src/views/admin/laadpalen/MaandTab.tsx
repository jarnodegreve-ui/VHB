import { useEffect, useMemo, useState } from 'react';
import { BatteryCharging, CalendarDays, Download, Gauge, Zap } from 'lucide-react';
import { Card, CardHeader } from '../../../components/Card';
import { DateInput } from '../../../components/Field';
import { InfoTip } from '../../../components/InfoTip';
import { MaandNavigatie } from '../../../components/MaandNavigatie';
import { OpsStat } from '../../../components/ops';
import { Badge, Button, MicroLabel, TableShell, Td, Th } from '../../../components/primitives';
import { SkeletonTile } from '../../../components/Skeleton';
import { SortTh, useSort } from '../../../components/Table';
import { EmptyState } from '../../../components/ui';
import { apiFetch } from '../../../lib/api';
import { isoDate, maandPlus } from '../../../lib/datum';
import { WEEKDAY_SHORT_SUN, formatGetal, metEenheid } from '../../../lib/format';
import { busVoorLaadpunt } from '../../../lib/laadplein';
import { cn } from '../../../lib/ui';
import {
  Delta, TermijnKeuze, dagKort, duurLabel, exporteerCsv, fmtKwh, klasseLabel, maandLabel, periodeLabel, tekstKw, tekstKwh, tekstKwhHeel, uurLabel,
  type DagRij, type PuntRij, type Totalen,
} from './gedeeld';
import { Staafgrafiek, useKeuze } from './grafieken';

/**
 * Tabblad Maand: dé maandrapportage. Eén kalendermaand (‹ ›) of een vrije
 * periode; KPI's met verschil t.o.v. de vorige periode, verbruik per dag en
 * dagpiek per dag als grafiek, en twee sorteerbare tabellen (per laadpunt,
 * per dag). CSV per tabel; het volledige Excel-werkboek zit in de paginakop.
 */

export type MaandData = {
  van: string;
  tot: string;
  maand: string | null;
  eersteDag: string | null;
  huidigeDag: string;
  totalen: Totalen;
  vorige: { van: string; tot: string; maand: string | null; kwh: number; laadbeurten: number; mislukt: number; piekKw: number | null; gemPerLaaddag: number; laaddagen: number };
  dagen: DagRij[];
  punten: PuntRij[];
  klassen: Record<string, number>;
};

/** Periode-parameter in de URL: "2026-08" of "2026-08-04_2026-08-05". */
export type PeriodeKeuze = { modus: 'maand'; maand: string } | { modus: 'periode'; van: string; tot: string };
export const periodeUitParam = (param: string | null): PeriodeKeuze | null => {
  if (!param) return null;
  if (/^\d{4}-\d{2}$/.test(param)) return { modus: 'maand', maand: param };
  const m = /^(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})$/.exec(param);
  return m ? { modus: 'periode', van: m[1], tot: m[2] } : null;
};
export const paramUitPeriode = (k: PeriodeKeuze): string => (k.modus === 'maand' ? k.maand : `${k.van}_${k.tot}`);
export const queryUitPeriode = (k: PeriodeKeuze | null): string => (!k ? '' : k.modus === 'maand' ? `maand=${k.maand}` : `van=${k.van}&tot=${k.tot}`);

type PuntKolom = 'punt' | 'kwh' | 'aandeel' | 'delta' | 'laadbeurten' | 'mislukt' | 'laadMin' | 'gemKw' | 'maxKw';
type DagKolom = 'dag' | 'kwh' | 'laadbeurten' | 'mislukt' | 'piekKw' | 'piekTs';

export function MaandTab({ keuze, zetKeuze, onDag, herlaad, onGeladen }: {
  keuze: PeriodeKeuze | null;
  zetKeuze: (k: PeriodeKeuze) => void;
  onDag: (dag: string) => void;
  herlaad: number;
  onGeladen?: (d: MaandData) => void;
}) {
  const [data, setData] = useState<MaandData | null>(null);
  const [laadt, setLaadt] = useState(true);
  const [fout, setFout] = useState<string | null>(null);
  useEffect(() => {
    let actueel = true;
    setLaadt(true);
    (async () => {
      try {
        const q = queryUitPeriode(keuze);
        const res = await apiFetch(`/api/ocpi/maand${q ? `?${q}` : ''}`);
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as MaandData;
        if (actueel) { setData(json); setFout(null); onGeladen?.(json); }
      } catch {
        if (actueel) setFout('Kon het maandoverzicht niet laden.');
      } finally {
        if (actueel) setLaadt(false);
      }
    })();
    return () => { actueel = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keuze, herlaad]);

  const vandaag = isoDate(new Date());
  const modus = keuze?.modus ?? 'maand';
  const maandGekozen = keuze?.modus === 'maand' ? keuze.maand : (data?.maand ?? data?.van.slice(0, 7) ?? vandaag.slice(0, 7));
  const periodeGekozen = keuze?.modus === 'periode' ? keuze : { van: data?.van ?? `${vandaag.slice(0, 7)}-01`, tot: data?.tot ?? vandaag };
  const wisselModus = (m: 'maand' | 'periode') => {
    if (m === modus) return;
    zetKeuze(m === 'periode'
      ? { modus: 'periode', van: periodeGekozen.van, tot: periodeGekozen.tot > vandaag ? vandaag : periodeGekozen.tot }
      : { modus: 'maand', maand: periodeGekozen.van.slice(0, 7) });
  };
  const zetVan = (v: string) => { if (v) zetKeuze({ modus: 'periode', van: v, tot: v > periodeGekozen.tot ? v : periodeGekozen.tot }); };
  const zetTot = (t: string) => { if (t) zetKeuze({ modus: 'periode', van: t < periodeGekozen.van ? t : periodeGekozen.van, tot: t }); };

  const label = data ? periodeLabel(data) : maandLabel(maandGekozen);
  const vorigeLabel = data ? periodeLabel({ van: data.vorige.van, tot: data.vorige.tot, maand: data.vorige.maand }) : '';
  const lopend = !!data && data.tot >= data.huidigeDag;

  // Grafieken: staven per dag; toekomst (rest van de lopende maand) blijft
  // weg zodat de as niet halfleeg is.
  const dagenTotNu = useMemo(() => (data?.dagen ?? []).filter((d) => d.dag <= (data?.huidigeDag ?? vandaag)), [data, vandaag]);
  const [gekozenDagKwh, setGekozenDagKwh] = useKeuze(data?.van);
  const [gekozenDagPiek, setGekozenDagPiek] = useKeuze(data?.van);
  const asLabel = (d: DagRij) => {
    const dow = new Date(`${d.dag}T00:00:00`).getDay();
    if (dagenTotNu.length <= 10) return WEEKDAY_SHORT_SUN[dow];
    return dow === 1 ? String(Number(d.dag.slice(8))) : '';
  };
  const dagSamenvattingKnop = (dag: string) => <Button variant="ghost" size="sm" className="-my-1 h-6 px-1.5 text-2xs" onClick={() => onDag(dag)}>dagdetail</Button>;

  const sortPunt = useSort<PuntKolom>('kwh', 'desc');
  const sortDag = useSort<DagKolom>('dag', 'asc');
  const puntNaam = (p: PuntRij) => p.evseId ?? p.physicalReference ?? p.evseUid;
  const punten = useMemo(() => sortPunt.sorteer(data?.punten ?? [], (p, k) => {
    switch (k) {
      case 'punt': return puntNaam(p);
      case 'delta': return p.kwhVorige && p.kwhVorige > 0 ? (p.kwh - p.kwhVorige) / p.kwhVorige : null;
      case 'laadMin': return p.laadMin;
      default: return p[k];
    }
  }), [data?.punten, sortPunt]);
  const dagen = useMemo(() => sortDag.sorteer(data?.dagen ?? [], (d, k) => (k === 'piekTs' ? (d.piekTs ? uurLabel(d.piekTs) : null) : d[k])), [data?.dagen, sortDag]);
  const maxPuntKwh = Math.max(0, ...(data?.punten ?? []).map((p) => p.kwh));
  const klassen = Object.entries(data?.klassen ?? {}).sort((a, b) => b[1] - a[1]);

  const exporteerPunten = () => {
    if (!data) return;
    exporteerCsv(`vhb-laadplein-${paramUitPeriode(keuze ?? { modus: 'maand', maand: maandGekozen })}-per-laadpunt.csv`, [
      ['Laadpunt', 'Bus', `kWh (${label})`, 'Aandeel %', `kWh (${vorigeLabel})`, 'Laadsessies', 'Mislukt', 'Laadtijd (min)', 'Gem. kW', 'Max. kW', 'Max. vermogen paal kW'],
      ...data.punten.map((p) => [puntNaam(p), busVoorLaadpunt(p.evseId) ?? '', p.kwh, p.aandeel, p.kwhVorige ?? 0, p.laadbeurten, p.mislukt, p.laadMin, p.gemKw ?? '', p.maxKw ?? '', p.maxElectricPowerKw ?? '']),
      ['Totaal', '', data.totalen.kwh, 100, data.vorige.kwh, data.totalen.laadbeurten, data.totalen.mislukt, data.totalen.laadMin, '', '', ''],
    ]);
  };
  const exporteerDagen = () => {
    if (!data) return;
    exporteerCsv(`vhb-laadplein-${paramUitPeriode(keuze ?? { modus: 'maand', maand: maandGekozen })}-per-dag.csv`, [
      ['Dag', 'Weekdag', 'kWh', 'Laadsessies', 'Mislukt', 'Aankoppelingen totaal', 'Piek kW', 'Piek om', 'Bussen aan de lader bij piek'],
      ...data.dagen.map((d) => [d.dag, WEEKDAY_SHORT_SUN[new Date(`${d.dag}T00:00:00`).getDay()], d.kwh, d.laadbeurten, d.mislukt, d.sessies, d.piekKw ?? '', d.piekTs ? uurLabel(d.piekTs) : '', d.piekCharging ?? '']),
      ['Totaal', '', data.totalen.kwh, data.totalen.laadbeurten, data.totalen.mislukt, data.totalen.sessies, data.totalen.piekKw ?? '', data.totalen.piekTs ? uurLabel(data.totalen.piekTs) : '', data.totalen.piekCharging ?? ''],
    ]);
  };

  const t = data?.totalen;
  return (
    <div className="space-y-6">
      {/* Periodekeuze: één rij, de maandnaam als anker. */}
      <div className="flex flex-wrap items-center gap-2">
        <TermijnKeuze label="Maand of vrije periode" waarde={modus} opties={[{ id: 'maand', label: 'Maand' }, { id: 'periode', label: 'Periode' }]} onKies={wisselModus} />
        {modus === 'maand' ? (
          <MaandNavigatie
            role="group"
            aria-label="Maandkeuze"
            label={maandLabel(maandGekozen)}
            labelClassName="min-w-[8.5rem]"
            onVorige={() => zetKeuze({ modus: 'maand', maand: maandPlus(maandGekozen, -1) })}
            vorigeUit={!!data?.eersteDag && maandPlus(maandGekozen, -1) < data.eersteDag.slice(0, 7)}
            onVolgende={() => zetKeuze({ modus: 'maand', maand: maandPlus(maandGekozen, 1) })}
            volgendeUit={maandGekozen >= vandaag.slice(0, 7)}
          >
            {maandGekozen !== vandaag.slice(0, 7) && (
              <Button variant="ghost" size="sm" onClick={() => zetKeuze({ modus: 'maand', maand: vandaag.slice(0, 7) })}>Deze maand</Button>
            )}
          </MaandNavigatie>
        ) : (
          <div className="flex items-center gap-2" role="group" aria-label="Periodekeuze">
            <DateInput size="sm" value={periodeGekozen.van} min={data?.eersteDag ?? undefined} max={periodeGekozen.tot || vandaag} onChange={zetVan} aria-label="Van" />
            <span className="text-xs font-medium text-slate-500">t/m</span>
            <DateInput size="sm" value={periodeGekozen.tot} min={periodeGekozen.van || data?.eersteDag || undefined} max={vandaag} onChange={zetTot} aria-label="Tot en met" />
          </div>
        )}
        {lopend && <Badge tone="oker" stil dot className="shrink-0">lopend, t/m vandaag</Badge>}
      </div>

      {fout ? (
        <EmptyState variant="fout" title={fout} message="Probeer het opnieuw met Ververs." />
      ) : !data || !t ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{Array.from({ length: 4 }).map((_, i) => <SkeletonTile key={i} />)}</div>
      ) : (
        <div className={cn('space-y-6 transition-opacity', laadt && 'opacity-60')} aria-busy={laadt}>
          {/* KPI's: de vier getallen die je uit een maand wilt halen, elk met
              het verschil t.o.v. de vorige periode. */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <OpsStat icon={<Zap size={16} />} tone="oker" label="Verbruik" text={fmtKwh(t.kwh)} suffix={' kWh'} sub={`${vorigeLabel}: ${tekstKwhHeel(data.vorige.kwh)}`} />
            <OpsStat icon={<Gauge size={16} />} tone="slate" label="Piekvermogen" text={t.piekKw !== null ? formatGetal(Math.round(t.piekKw)) : '—'} suffix={t.piekKw !== null ? ' kW' : ''} sub={t.piekDag ? `${dagKort(t.piekDag)} om ${uurLabel(t.piekTs)}${typeof t.piekCharging === 'number' ? ` · ${t.piekCharging} bussen` : ''}` : 'geen kwartiermeting in deze periode'} />
            <OpsStat icon={<BatteryCharging size={16} />} tone="slate" label="Laadsessies" value={t.laadbeurten} sub={t.mislukt > 0 ? `${t.mislukt} mislukt · ${t.sessies} aankoppelingen totaal` : `${t.sessies} aankoppelingen totaal, niets mislukt`} />
            <OpsStat icon={<CalendarDays size={16} />} tone="slate" label="Per laaddag" text={fmtKwh(t.gemPerLaaddag)} suffix={' kWh'} sub={t.hoogsteDag ? `hoogste dag: ${dagKort(t.hoogsteDag.dag)}, ${tekstKwhHeel(t.hoogsteDag.kwh)}` : `${t.laaddagen} laaddagen`} />
          </div>
          <div className="-mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-2xs text-slate-500">
            <span className="inline-flex items-center gap-1.5">verbruik <Delta huidig={t.kwh} vorige={data.vorige.kwh} /></span>
            <span className="inline-flex items-center gap-1.5">piek <Delta huidig={t.piekKw} vorige={data.vorige.piekKw} omgekeerd /></span>
            <span className="inline-flex items-center gap-1.5">laadsessies <Delta huidig={t.laadbeurten} vorige={data.vorige.laadbeurten} /></span>
            <span className="inline-flex items-center gap-1.5">per laaddag <Delta huidig={t.gemPerLaaddag} vorige={data.vorige.gemPerLaaddag} /></span>
            <span className="ml-auto">t.o.v. {vorigeLabel}</span>
            {t.piekDagen < dagenTotNu.length && <span>{t.piekDagen} van {dagenTotNu.length} dagen met piekmeting</span>}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <Card>
              <div className="mb-4 flex items-center justify-between gap-3">
                <MicroLabel>Verbruik per dag (kWh)</MicroLabel>
                <span className="text-2xs font-medium font-mono text-slate-500">{label}</span>
              </div>
              {dagenTotNu.length === 0 ? (
                <p className="text-sm text-slate-500">Geen dagen in deze periode.</p>
              ) : (
                <Staafgrafiek
                  staven={dagenTotNu.map((d) => ({ key: d.dag, waarde: d.kwh, asLabel: asLabel(d), isPiek: !!t.hoogsteDag && d.dag === t.hoogsteDag.dag, gedempt: d.dag === data.huidigeDag }))}
                  eenheid="kWh"
                  ariaLabel={`Verbruik per dag in ${label}: totaal ${tekstKwhHeel(t.kwh)}, gemiddeld ${tekstKwhHeel(t.gemPerLaaddag)} per laaddag${t.hoogsteDag ? `, hoogste ${dagKort(t.hoogsteDag.dag)} ${tekstKwhHeel(t.hoogsteDag.kwh)}` : ''}`}
                  gekozen={gekozenDagKwh}
                  onKies={setGekozenDagKwh}
                  titelVan={(s) => { const d = dagenTotNu.find((x) => x.dag === s.key); return `${dagKort(s.key)} · ${tekstKwh(s.waarde)} · ${d?.laadbeurten ?? 0} laadsessie${d?.laadbeurten === 1 ? '' : 's'}`; }}
                  samenvatting={(s) => {
                    const d = s ? dagenTotNu.find((x) => x.dag === s.key) : null;
                    return d
                      ? <>{dagKort(d.dag)} · {tekstKwh(d.kwh)} · {d.laadbeurten} laadsessie{d.laadbeurten === 1 ? '' : 's'}{d.mislukt ? ` · ${d.mislukt} mislukt` : ''} · {dagSamenvattingKnop(d.dag)}</>
                      : `totaal ${tekstKwhHeel(t.kwh)} · ${tekstKwhHeel(t.gemPerLaaddag)}/laaddag · ${t.laaddagen} laaddagen`;
                  }}
                />
              )}
            </Card>
            <Card>
              <div className="mb-4 flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1">
                  <MicroLabel>Dagpiek (kW)</MicroLabel>
                  <InfoTip label="Uitleg dagpiek">
                    <p>Per dag de hoogste kwartierwaarde van het totale laadvermogen op het plein. De hoogste dagpiek van de maand is het getal dat het capaciteitstarief bepaalt. De gestippelde lijn is de piek van de vorige periode.</p>
                  </InfoTip>
                </span>
                <span className="text-2xs font-medium font-mono text-slate-500">{t.gemDagpiekKw !== null ? `gem. ${tekstKw(Math.round(t.gemDagpiekKw))}` : ''}</span>
              </div>
              {t.piekDagen === 0 ? (
                <p className="text-sm text-slate-500">Geen kwartiermetingen in deze periode (de piekbewaking loopt sinds 5 augustus 2026).</p>
              ) : (
                <Staafgrafiek
                  staven={dagenTotNu.map((d) => ({ key: d.dag, waarde: d.piekKw ?? 0, asLabel: asLabel(d), isPiek: d.dag === t.piekDag, ontbreekt: d.piekKw === null, gedempt: d.dag === data.huidigeDag }))}
                  eenheid="kW"
                  ariaLabel={`Dagpiek per dag in ${label}: hoogste ${t.piekKw !== null ? tekstKw(t.piekKw) : 'onbekend'}${t.piekDag ? ` op ${dagKort(t.piekDag)}` : ''}`}
                  gekozen={gekozenDagPiek}
                  onKies={setGekozenDagPiek}
                  referentie={data.vorige.piekKw ? { waarde: data.vorige.piekKw, label: `vorige ${tekstKw(Math.round(data.vorige.piekKw))}` } : null}
                  titelVan={(s) => { const d = dagenTotNu.find((x) => x.dag === s.key); return d?.piekKw !== null && d?.piekKw !== undefined ? `${dagKort(s.key)} · ${tekstKw(d.piekKw)} om ${uurLabel(d.piekTs)}` : `${dagKort(s.key)} · geen meting`; }}
                  samenvatting={(s) => {
                    const d = s ? dagenTotNu.find((x) => x.dag === s.key) : null;
                    if (d) {
                      return d.piekKw !== null
                        ? <>{dagKort(d.dag)} · piek {tekstKw(d.piekKw)} om {uurLabel(d.piekTs)}{typeof d.piekCharging === 'number' ? ` · ${d.piekCharging} bussen` : ''} · {dagSamenvattingKnop(d.dag)}</>
                        : <>{dagKort(d.dag)} · geen kwartiermeting · {dagSamenvattingKnop(d.dag)}</>;
                    }
                    return t.piekKw !== null ? `hoogste ${tekstKw(t.piekKw)} op ${dagKort(t.piekDag!)} om ${uurLabel(t.piekTs)} · gem. dagpiek ${tekstKw(Math.round(t.gemDagpiekKw ?? 0))}` : 'geen meting';
                  }}
                />
              )}
            </Card>
          </div>

          {klassen.length > 0 && (
            <Card padding="sm" tone="muted" className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
              <span className="font-semibold text-slate-800">{t.mislukt} mislukte aankoppeling{t.mislukt === 1 ? '' : 'en'}</span>
              {klassen.map(([k, n]) => (
                <span key={k} className="inline-flex items-center gap-1.5 text-slate-600"><Badge tone="red" dot stil>{klasseLabel(k)}</Badge><span className="font-mono">{n}×</span></span>
              ))}
              <InfoTip label="Uitleg mislukte aankoppelingen" className="ml-auto">
                <p>Sessies waarin ChargEye een technische fout meldt: de bus is aangekoppeld maar er is niet geladen. “Handshake mislukt” = de communicatie tussen bus en paal kwam niet tot stand, meestal even de stekker opnieuw insteken. Ze tellen niet mee als laadbeurt.</p>
              </InfoTip>
            </Card>
          )}

          <div>
            <CardHeader
              size="lg"
              title="Per laadpunt"
              description={`Geleverde energie per laadpunt (en dus per bus) in ${label}. Klik op een kolomkop om te sorteren.`}
              aside={<Button variant="secondary" size="sm" icon={<Download size={14} />} onClick={exporteerPunten} disabled={data.totalen.sessies === 0}>CSV</Button>}
            />
            <TableShell className="mt-3">
              <table className="w-full">
                <thead>
                  <tr>
                    <SortTh kolom="punt" sort={sortPunt}>Laadpunt</SortTh>
                    <SortTh kolom="kwh" sort={sortPunt} align="right">kWh</SortTh>
                    <SortTh kolom="aandeel" sort={sortPunt} align="right">Aandeel</SortTh>
                    <SortTh kolom="delta" sort={sortPunt} align="right" className="max-md:hidden">Vorige</SortTh>
                    <SortTh kolom="laadbeurten" sort={sortPunt} align="right">Sessies</SortTh>
                    <SortTh kolom="mislukt" sort={sortPunt} align="right" className="max-md:hidden">Mislukt</SortTh>
                    <SortTh kolom="laadMin" sort={sortPunt} align="right" className="max-lg:hidden">Laadtijd</SortTh>
                    <SortTh kolom="gemKw" sort={sortPunt} align="right" className="max-lg:hidden">Gem. kW</SortTh>
                    <SortTh kolom="maxKw" sort={sortPunt} align="right" className="max-lg:hidden">Max. kW</SortTh>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {punten.map((p) => {
                    const bus = busVoorLaadpunt(p.evseId);
                    const isTop = p.kwh > 0 && p.kwh === maxPuntKwh;
                    return (
                      <tr key={p.evseUid} className={cn(p.kwh === 0 && 'text-slate-500')}>
                        <Td className="whitespace-nowrap">
                          <span className="font-semibold font-mono text-slate-800">{puntNaam(p)}</span>
                          {bus ? <span className="ml-1.5 text-2xs font-medium text-slate-500">bus {bus}</span> : null}
                        </Td>
                        <Td num>
                          <span className="inline-flex items-center justify-end gap-2">
                            <span className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-slate-200/70 sm:block" aria-hidden="true">
                              <span className={cn('block h-full rounded-full', isTop ? 'bg-oker-500' : 'bg-slate-500')} style={{ width: maxPuntKwh > 0 ? `${Math.max(p.kwh > 0 ? 2 : 0, Math.round((p.kwh / maxPuntKwh) * 100))}%` : '0%' }} />
                            </span>
                            <span className={cn('font-semibold', p.kwh > 0 ? 'text-slate-800' : 'text-slate-500')}>{fmtKwh(p.kwh)}</span>
                          </span>
                        </Td>
                        <Td num>{p.aandeel > 0 ? `${formatGetal(p.aandeel, 1)} %` : '—'}</Td>
                        <Td num className="max-md:hidden"><span className="inline-flex items-center gap-1.5">{fmtKwh(p.kwhVorige ?? 0)}<Delta huidig={p.kwh} vorige={p.kwhVorige ?? 0} /></span></Td>
                        <Td num>{p.laadbeurten}</Td>
                        <Td num className={cn('max-md:hidden', p.mislukt > 0 && 'font-semibold text-red-700')}>{p.mislukt || '—'}</Td>
                        <Td num className="max-lg:hidden">{p.laadMin > 0 ? duurLabel(p.laadMin) : '—'}</Td>
                        <Td num className="max-lg:hidden">{p.gemKw !== null ? formatGetal(p.gemKw, 1) : '—'}</Td>
                        <Td num className="max-lg:hidden">{p.maxKw !== null ? formatGetal(p.maxKw, 1) : '—'}</Td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-200 font-semibold text-slate-800">
                    <Td>Totaal</Td>
                    <Td num>{fmtKwh(t.kwh)}</Td>
                    <Td num>100 %</Td>
                    <Td num className="max-md:hidden">{fmtKwh(data.vorige.kwh)}</Td>
                    <Td num>{t.laadbeurten}</Td>
                    <Td num className="max-md:hidden">{t.mislukt || '—'}</Td>
                    <Td num className="max-lg:hidden">{duurLabel(t.laadMin)}</Td>
                    <Td num className="max-lg:hidden">—</Td>
                    <Td num className="max-lg:hidden">—</Td>
                  </tr>
                </tfoot>
              </table>
            </TableShell>
          </div>

          <div>
            <CardHeader
              size="lg"
              title="Per dag"
              description="Verbruik, laadsessies en de kwartierpiek per kalenderdag. Klik op een dag voor de curve en de sessies van die dag."
              aside={<Button variant="secondary" size="sm" icon={<Download size={14} />} onClick={exporteerDagen}>CSV</Button>}
            />
            <TableShell className="mt-3">
              <table className="w-full">
                <thead>
                  <tr>
                    <SortTh kolom="dag" sort={sortDag}>Dag</SortTh>
                    <SortTh kolom="kwh" sort={sortDag} align="right">kWh</SortTh>
                    <SortTh kolom="laadbeurten" sort={sortDag} align="right">Sessies</SortTh>
                    <SortTh kolom="mislukt" sort={sortDag} align="right" className="max-md:hidden">Mislukt</SortTh>
                    <SortTh kolom="piekKw" sort={sortDag} align="right">Piek kW</SortTh>
                    <SortTh kolom="piekTs" sort={sortDag} align="right" className="max-md:hidden">Piek om</SortTh>
                    <Th num className="max-lg:hidden">Bussen bij piek</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {dagen.map((d) => {
                    const toekomst = d.dag > data.huidigeDag;
                    const isPiekDag = d.dag === t.piekDag;
                    const isTopDag = !!t.hoogsteDag && d.dag === t.hoogsteDag.dag;
                    return (
                      <tr key={d.dag} className={cn(toekomst && 'text-slate-400', 'hover:bg-surface-soft-hover')}>
                        <Td className="whitespace-nowrap">
                          {/* rauw: dag-link opent het dagdetail; hele cel als tekstknop */}
                          <button type="button" onClick={() => onDag(d.dag)} disabled={toekomst} className="ios-pressable -mx-1 rounded-md px-1 text-left font-medium text-slate-800 disabled:text-slate-400 hover:text-oker-700">
                            {dagKort(d.dag)}
                          </button>
                          {d.dag === data.huidigeDag && <Badge tone="oker" stil className="ml-2">vandaag</Badge>}
                        </Td>
                        <Td num className={cn('font-semibold', isTopDag ? 'text-oker-700' : d.kwh > 0 ? 'text-slate-800' : 'text-slate-500')}>{toekomst ? '' : fmtKwh(d.kwh)}</Td>
                        <Td num>{toekomst ? '' : d.laadbeurten}</Td>
                        <Td num className={cn('max-md:hidden', d.mislukt > 0 && 'font-semibold text-red-700')}>{toekomst ? '' : d.mislukt || '—'}</Td>
                        <Td num className={cn('font-semibold', isPiekDag ? 'text-oker-700' : 'text-slate-800')}>{d.piekKw !== null ? formatGetal(Math.round(d.piekKw)) : toekomst ? '' : '—'}</Td>
                        <Td num className="max-md:hidden">{d.piekTs ? uurLabel(d.piekTs) : ''}</Td>
                        <Td num className="max-lg:hidden">{d.piekCharging ?? ''}</Td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-slate-200 font-semibold text-slate-800">
                    <Td>Totaal</Td>
                    <Td num>{fmtKwh(t.kwh)}</Td>
                    <Td num>{t.laadbeurten}</Td>
                    <Td num className="max-md:hidden">{t.mislukt || '—'}</Td>
                    <Td num>{t.piekKw !== null ? formatGetal(Math.round(t.piekKw)) : '—'}</Td>
                    <Td num className="max-md:hidden">{t.piekDag ? `${dagKort(t.piekDag)} ${uurLabel(t.piekTs)}` : ''}</Td>
                    <Td num className="max-lg:hidden">{t.piekCharging ?? ''}</Td>
                  </tr>
                </tfoot>
              </table>
            </TableShell>
            <p className="mt-2 px-1 text-2xs text-slate-500">Laadtijd totaal {duurLabel(t.laadMin)} · {metEenheid(formatGetal(t.laadMin > 0 ? t.kwh / (t.laadMin / 60) : 0, 1), 'kW')} gemiddeld tijdens het laden</p>
          </div>
        </div>
      )}
    </div>
  );
}
