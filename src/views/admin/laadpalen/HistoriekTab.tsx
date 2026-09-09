import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Download } from 'lucide-react';
import { Card, CardHeader } from '../../../components/Card';
import { InfoTip } from '../../../components/InfoTip';
import { Button, MicroLabel, TableShell, Td, Th } from '../../../components/primitives';
import { SkeletonTile } from '../../../components/Skeleton';
import { EmptyState } from '../../../components/ui';
import { LegeLijst } from '../../../components/illustraties';
import { apiFetch } from '../../../lib/api';
import { formatGetal } from '../../../lib/format';
import { busVoorLaadpunt } from '../../../lib/laadplein';
import { cn } from '../../../lib/ui';
import { Delta, dagKort, duurLabel, exporteerCsv, fmtKwh, maandKort, maandLabel, tekstKw, tekstKwhHeel, uurLabel, type MaandRij } from './gedeeld';
import { Staafgrafiek, useKeuze } from './grafieken';

/**
 * Tabblad Historiek: alle maanden sinds de eerste sessie naast elkaar,
 * verbruik en maandpiek als grafiek, één rij per maand (klik = naar het
 * maandoverzicht), jaartotalen, en de matrix laadpunt × maand. CSV hier,
 * het Excel-werkboek via de paginakop.
 */

export type Historiek = {
  huidigeMaand: string;
  huidigeDag: string;
  maanden: MaandRij[];
  matrix: Array<{ evseUid: string; evseId: string | null; physicalReference: string | null; perMaand: Record<string, number>; totaal: number }>;
};

export function HistoriekTab({ onMaand, herlaad, onGeladen }: { onMaand: (maand: string) => void; herlaad: number; onGeladen?: (h: Historiek) => void }) {
  const [data, setData] = useState<Historiek | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  useEffect(() => {
    let actueel = true;
    (async () => {
      try {
        const res = await apiFetch('/api/ocpi/historiek');
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as Historiek;
        if (actueel) { setData(json); setFout(null); onGeladen?.(json); }
      } catch {
        if (actueel) setFout('Kon de historiek niet laden.');
      }
    })();
    return () => { actueel = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [herlaad]);

  const maanden = useMemo(() => [...(data?.maanden ?? [])].reverse(), [data?.maanden]); // nieuwste bovenaan
  const chrono = data?.maanden ?? [];
  const [gekozenKwh, setGekozenKwh] = useKeuze(data);
  const [gekozenPiek, setGekozenPiek] = useKeuze(data);
  const hoogsteKwh = chrono.reduce<MaandRij | null>((b, m) => (!b || m.kwh > b.kwh ? m : b), null);
  const hoogstePiek = chrono.reduce<MaandRij | null>((b, m) => (m.piekKw !== null && (!b || (b.piekKw ?? 0) < m.piekKw) ? m : b), null);
  // Jaartotalen: onder de maanden van dat jaar.
  const perJaar = useMemo(() => {
    const uit = new Map<string, { kwh: number; laadbeurten: number; mislukt: number; laaddagen: number; laadMin: number | null; piek: MaandRij | null }>();
    for (const m of chrono) {
      const j = m.maand.slice(0, 4);
      const cur = uit.get(j) ?? { kwh: 0, laadbeurten: 0, mislukt: 0, laaddagen: 0, laadMin: null, piek: null };
      cur.kwh += m.kwh; cur.laadbeurten += m.laadbeurten; cur.mislukt += m.mislukt; cur.laaddagen += m.laaddagen;
      // Onbekend blijft onbekend: alleen optellen zodra één maand een echte
      // laadtijd heeft, anders toonde het jaartotaal "0 min" als een waarde.
      if (m.laadMin !== null) cur.laadMin = (cur.laadMin ?? 0) + m.laadMin;
      if (m.piekKw !== null && (!cur.piek || (cur.piek.piekKw ?? 0) < m.piekKw)) cur.piek = m;
      uit.set(j, cur);
    }
    return uit;
  }, [chrono]);

  const exporteerMaanden = () => {
    if (!data) return;
    exporteerCsv(`vhb-laadplein-historiek-${data.huidigeDag}.csv`, [
      ['Maand', 'kWh', 'Laadsessies', 'Mislukt', 'Aankoppelingen totaal', 'Laaddagen', 'Gem. kWh per laaddag', 'Hoogste dag kWh', 'Hoogste dag', 'Piek kW', 'Piekdag', 'Piek om', 'Gem. dagpiek kW', 'Dagen met piekmeting', 'Laadtijd (uur)'],
      ...chrono.map((m) => [m.maand, m.kwh, m.laadbeurten, m.mislukt, m.sessies, m.laaddagen, m.gemPerLaaddag, m.hoogsteDag?.kwh ?? '', m.hoogsteDag?.dag ?? '', m.piekKw ?? '', m.piekDag ?? '', m.piekTs ? uurLabel(m.piekTs) : '', m.gemDagpiekKw ?? '', m.piekDagen, m.laadMin !== null ? Math.round((m.laadMin / 60) * 10) / 10 : '']),
    ]);
  };
  const exporteerMatrix = () => {
    if (!data) return;
    const keys = chrono.map((m) => m.maand);
    exporteerCsv(`vhb-laadplein-laadpunt-per-maand-${data.huidigeDag}.csv`, [
      ['Laadpunt', 'Bus', ...keys, 'Totaal kWh'],
      ...data.matrix.map((r) => [r.evseId ?? r.physicalReference ?? r.evseUid, busVoorLaadpunt(r.evseId) ?? '', ...keys.map((k) => r.perMaand[k] ?? 0), r.totaal]),
    ]);
  };

  if (fout) return <EmptyState variant="fout" title={fout} message="Probeer het opnieuw met Ververs." />;
  if (!data) return <div className="grid grid-cols-1 gap-4 lg:grid-cols-2"><SkeletonTile /><SkeletonTile /></div>;
  if (chrono.length === 0) return <EmptyState illustratie={<LegeLijst />} title="Nog geen historiek" message="Zodra de eerste laadsessies gesynchroniseerd zijn, verschijnt hier één rij per maand." />;

  const matrixMaanden = chrono.map((m) => m.maand);
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <div className="mb-4 flex items-center justify-between gap-3">
            <MicroLabel>Verbruik per maand (kWh)</MicroLabel>
            <span className="text-2xs font-medium font-mono text-slate-500">{chrono.length} maand{chrono.length === 1 ? '' : 'en'}</span>
          </div>
          <Staafgrafiek
            staven={chrono.map((m) => ({ key: m.maand, waarde: m.kwh, asLabel: maandKort(m.maand), isPiek: !!hoogsteKwh && m.maand === hoogsteKwh.maand, gedempt: m.maand === data.huidigeMaand }))}
            eenheid="kWh"
            ariaLabel={`Verbruik per maand: ${hoogsteKwh ? `hoogste ${maandLabel(hoogsteKwh.maand)} met ${tekstKwhHeel(hoogsteKwh.kwh)}` : 'geen data'}`}
            gekozen={gekozenKwh}
            onKies={setGekozenKwh}
            titelVan={(s) => `${maandLabel(s.key)} · ${tekstKwhHeel(s.waarde)}`}
            samenvatting={(s) => {
              const m = s ? chrono.find((x) => x.maand === s.key) : null;
              return m
                ? <>{maandLabel(m.maand)} · {tekstKwhHeel(m.kwh)} · {m.laadbeurten} laadsessies · <Button variant="ghost" size="sm" className="-my-1 h-6 px-1.5 text-2xs" onClick={() => onMaand(m.maand)}>maandoverzicht</Button></>
                : `totaal ${tekstKwhHeel(chrono.reduce((a, m2) => a + m2.kwh, 0))} sinds ${maandLabel(chrono[0].maand)}`;
            }}
          />
        </Card>
        <Card>
          <div className="mb-4 flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-1">
              <MicroLabel>Maandpiek (kW)</MicroLabel>
              <InfoTip label="Uitleg maandpiek"><p>De hoogste kwartierwaarde van het totale laadvermogen in die maand: het capaciteitstarief-getal. De piekbewaking loopt sinds 5 augustus 2026; eerdere maanden hebben geen meting.</p></InfoTip>
            </span>
            <span className="text-2xs font-medium font-mono text-slate-500">{hoogstePiek ? `hoogste ${tekstKw(Math.round(hoogstePiek.piekKw ?? 0))}` : ''}</span>
          </div>
          <Staafgrafiek
            staven={chrono.map((m) => ({ key: m.maand, waarde: m.piekKw ?? 0, asLabel: maandKort(m.maand), isPiek: !!hoogstePiek && m.maand === hoogstePiek.maand, ontbreekt: m.piekKw === null, gedempt: m.maand === data.huidigeMaand }))}
            eenheid="kW"
            ariaLabel={`Maandpiek per maand: ${hoogstePiek ? `hoogste ${tekstKw(hoogstePiek.piekKw ?? 0)} in ${maandLabel(hoogstePiek.maand)}` : 'geen meting'}`}
            gekozen={gekozenPiek}
            onKies={setGekozenPiek}
            titelVan={(s) => { const m = chrono.find((x) => x.maand === s.key); return m?.piekKw !== null && m?.piekKw !== undefined ? `${maandLabel(s.key)} · ${tekstKw(m.piekKw)} op ${m.piekDag ? dagKort(m.piekDag) : '?'}` : `${maandLabel(s.key)} · geen meting`; }}
            samenvatting={(s) => {
              const m = s ? chrono.find((x) => x.maand === s.key) : null;
              if (m) return m.piekKw !== null ? `${maandLabel(m.maand)} · piek ${tekstKw(m.piekKw)} op ${m.piekDag ? dagKort(m.piekDag) : '?'} om ${uurLabel(m.piekTs)} · gem. dagpiek ${tekstKw(Math.round(m.gemDagpiekKw ?? 0))}` : `${maandLabel(m.maand)} · geen kwartiermeting`;
              return hoogstePiek ? `hoogste ${tekstKw(hoogstePiek.piekKw ?? 0)} in ${maandLabel(hoogstePiek.maand)}` : 'nog geen meting';
            }}
          />
        </Card>
      </div>

      <div>
        <CardHeader size="lg" title="Per maand" description="Nieuwste bovenaan. Klik op een maand voor het volledige maandoverzicht." aside={<Button variant="secondary" size="sm" icon={<Download size={14} />} onClick={exporteerMaanden}>CSV</Button>} />
        <TableShell className="mt-3">
          <table className="w-full">
            <thead>
              <tr>
                <Th>Maand</Th>
                <Th num>kWh</Th>
                <Th num className="max-md:hidden">Vorige</Th>
                <Th num>Sessies</Th>
                <Th num className="max-md:hidden">Mislukt</Th>
                <Th num className="max-lg:hidden">Laaddagen</Th>
                <Th num className="max-lg:hidden">Per laaddag</Th>
                <Th num>Piek kW</Th>
                <Th className="max-md:hidden">Piekmoment</Th>
                <Th num className="max-lg:hidden">Gem. dagpiek</Th>
                <Th num className="max-xl:hidden">Laadtijd</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {maanden.map((m, i) => {
                const vorige = chrono[chrono.indexOf(m) - 1] ?? null;
                const lopend = m.maand === data.huidigeMaand;
                const jaar = m.maand.slice(0, 4);
                const laatsteVanJaar = i === maanden.length - 1 || maanden[i + 1].maand.slice(0, 4) !== jaar;
                const jt = perJaar.get(jaar);
                return (
                  <FragmentRij key={m.maand}>
                    <tr className="hover:bg-surface-soft-hover">
                      <Td className="whitespace-nowrap">
                        {/* rauw: maand-link naar het maandoverzicht, hele cel als tekstknop */}
                        <button type="button" onClick={() => onMaand(m.maand)} className="ios-pressable -mx-1 rounded-md px-1 text-left font-semibold capitalize text-slate-800 hover:text-oker-700">
                          {maandLabel(m.maand)}
                        </button>
                        {lopend && <span className="ml-2 text-2xs font-medium text-slate-500">lopend</span>}
                      </Td>
                      <Td num className={cn('font-semibold', hoogsteKwh?.maand === m.maand ? 'text-oker-700' : 'text-slate-800')}>{fmtKwh(m.kwh)}</Td>
                      <Td num className="max-md:hidden"><Delta huidig={m.kwh} vorige={vorige?.kwh ?? null} /></Td>
                      <Td num>{m.laadbeurten}</Td>
                      <Td num className={cn('max-md:hidden', m.mislukt > 0 && 'font-semibold text-red-700')}>{m.mislukt || '—'}</Td>
                      <Td num className="max-lg:hidden">{m.laaddagen}</Td>
                      <Td num className="max-lg:hidden">{m.laaddagen > 0 ? fmtKwh(m.gemPerLaaddag) : '—'}</Td>
                      <Td num className={cn('font-semibold', hoogstePiek?.maand === m.maand ? 'text-oker-700' : 'text-slate-800')}>{m.piekKw !== null ? formatGetal(Math.round(m.piekKw)) : '—'}</Td>
                      <Td className="max-md:hidden whitespace-nowrap text-slate-600">{m.piekDag ? `${dagKort(m.piekDag)} ${uurLabel(m.piekTs)}` : m.piekDagen === 0 ? 'geen meting' : ''}</Td>
                      <Td num className="max-lg:hidden">{m.gemDagpiekKw !== null ? formatGetal(Math.round(m.gemDagpiekKw)) : '—'}</Td>
                      <Td num className="max-xl:hidden">{m.laadMin !== null && m.laadMin > 0 ? duurLabel(m.laadMin) : '—'}</Td>
                    </tr>
                    {laatsteVanJaar && jt && (
                      <tr className="bg-surface-muted/60 text-xs font-semibold text-slate-700">
                        <Td>Totaal {jaar}</Td>
                        <Td num>{fmtKwh(jt.kwh)}</Td>
                        <Td num className="max-md:hidden" />
                        <Td num>{jt.laadbeurten}</Td>
                        <Td num className="max-md:hidden">{jt.mislukt || '—'}</Td>
                        <Td num className="max-lg:hidden">{jt.laaddagen}</Td>
                        <Td num className="max-lg:hidden">{jt.laaddagen > 0 ? fmtKwh(jt.kwh / jt.laaddagen) : '—'}</Td>
                        <Td num>{jt.piek?.piekKw !== null && jt.piek?.piekKw !== undefined ? formatGetal(Math.round(jt.piek.piekKw)) : '—'}</Td>
                        <Td className="max-md:hidden whitespace-nowrap">{jt.piek?.piekDag ? `${dagKort(jt.piek.piekDag)} ${uurLabel(jt.piek.piekTs)}` : ''}</Td>
                        <Td num className="max-lg:hidden" />
                        <Td num className="max-xl:hidden">{jt.laadMin !== null && jt.laadMin > 0 ? duurLabel(jt.laadMin) : '—'}</Td>
                      </tr>
                    )}
                  </FragmentRij>
                );
              })}
            </tbody>
          </table>
        </TableShell>
      </div>

      <div>
        <CardHeader size="lg" title="Laadpunt per maand" description="Verbruik in kWh per laadpunt (en dus per bus), maand na maand." aside={<Button variant="secondary" size="sm" icon={<Download size={14} />} onClick={exporteerMatrix}>CSV</Button>} />
        <TableShell className="mt-3">
          <table className="w-full">
            <thead>
              <tr>
                <Th className="sticky left-0 z-10 bg-surface-white">Laadpunt</Th>
                {matrixMaanden.map((m) => <Th key={m} num>{maandKort(m)}</Th>)}
                <Th num>Totaal</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.matrix.map((r) => {
                const naam = r.evseId ?? r.physicalReference ?? r.evseUid;
                const bus = busVoorLaadpunt(r.evseId);
                return (
                  <tr key={r.evseUid} className={cn(r.totaal === 0 && 'text-slate-500')}>
                    <Td className="sticky left-0 z-10 bg-surface-white"><span className="font-semibold font-mono text-slate-800">{naam}</span>{bus ? <span className="ml-1.5 text-2xs text-slate-500">bus {bus}</span> : null}</Td>
                    {matrixMaanden.map((m) => <Td key={m} num className={cn((r.perMaand[m] ?? 0) === 0 && 'text-slate-400')}>{(r.perMaand[m] ?? 0) > 0 ? fmtKwh(r.perMaand[m]) : '·'}</Td>)}
                    <Td num className="font-semibold text-slate-800">{fmtKwh(r.totaal)}</Td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-slate-200 font-semibold text-slate-800">
                <Td className="sticky left-0 z-10 bg-surface-white">Totaal</Td>
                {matrixMaanden.map((m) => <Td key={m} num>{fmtKwh(chrono.find((x) => x.maand === m)?.kwh ?? 0)}</Td>)}
                <Td num>{fmtKwh(chrono.reduce((a, m) => a + m.kwh, 0))}</Td>
              </tr>
            </tfoot>
          </table>
        </TableShell>
      </div>
    </div>
  );
}

/** React.Fragment met key, leesbaar in een tabel-map. */
function FragmentRij({ children }: { children: ReactNode }) { return <>{children}</>; }
