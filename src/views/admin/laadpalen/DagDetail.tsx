import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { Modal } from '../../../components/Modal';
import { Badge, Button, IconButton, MicroLabel, TableShell, Td, Th } from '../../../components/primitives';
import { SkeletonTile } from '../../../components/Skeleton';
import { EmptyState } from '../../../components/ui';
import { apiFetch } from '../../../lib/api';
import { addDagen, isoDate } from '../../../lib/datum';
import { busVoorLaadpunt } from '../../../lib/laadplein';
import { formatGetal } from '../../../lib/format';
import {
  dagKort, dagLang, dagVanTs, duurLabel, exporteerCsv, klasseLabel, puntNaam, tekstKw, tekstKwh, tijdstipKort, uurLabel, type Laadpunt, type SessieDetail,
} from './gedeeld';
import { StapCurve, useKeuze } from './grafieken';

/**
 * Dagdetail: de kwartiercurve van één dag (zolang de snapshots bewaard zijn,
 * 400 dagen) plus alle sessies die die dag startten. Bereikbaar vanuit de
 * dag-staven (Live, Maand) en de per-dag-tabel; ‹ › bladert per dag.
 */

type Dag = {
  dag: string;
  slots: Array<{ ts: string; kw: number; charging: number }>;
  piekKw: number | null;
  piekTs: string | null;
  piekCharging: number | null;
  kwh: number;
  laadbeurten: number;
  mislukt: number;
  sessies: SessieDetail[];
  laadpunten: Laadpunt[];
};

export function SessieStatusBadge({ s }: { s: SessieDetail }) {
  if (s.ongeldig) return <Badge tone="slate" stil>Ongeldig</Badge>;
  if (s.status === 'ACTIVE') return <Badge tone="blue" dot stil>Bezig</Badge>;
  if (s.mislukt) return <Badge tone="red" dot className="whitespace-nowrap">{klasseLabel(s.klasse)}</Badge>;
  if (s.laadbeurt) return <Badge tone="emerald" dot stil>Geladen</Badge>;
  return <Badge tone="slate" stil>0 kWh</Badge>;
}

export const socTekst = (s: SessieDetail) => (s.socStart === null && s.socEind === null ? '—' : `${s.socStart ?? '?'} → ${s.socEind ?? '?'} %`);

export function DagDetail({ dag, onSluit, onDag, eersteDag }: { dag: string | null; onSluit: () => void; onDag: (dag: string) => void; eersteDag?: string | null }) {
  const [data, setData] = useState<Dag | null>(null);
  const [fout, setFout] = useState<string | null>(null);
  const [gekozenSlot, setGekozenSlot] = useKeuze(dag);
  const vandaag = isoDate(new Date());

  useEffect(() => {
    if (!dag) return;
    let actueel = true;
    setData(null);
    setFout(null);
    (async () => {
      try {
        const res = await apiFetch(`/api/ocpi/dag?dag=${dag}`);
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as Dag;
        if (actueel) setData(json);
      } catch {
        if (actueel) setFout('Kon het dagdetail niet laden.');
      }
    })();
    return () => { actueel = false; };
  }, [dag]);

  const laadpunten = useMemo(() => new Map((data?.laadpunten ?? []).map((p) => [p.uid, p])), [data?.laadpunten]);
  const slots = useMemo(() => (data?.slots ?? []).map((s) => ({ key: s.ts, ts: s.ts, kw: s.kw, charging: s.charging })), [data?.slots]);

  const exporteer = () => {
    if (!data) return;
    exporteerCsv(`vhb-laadplein-${data.dag}-sessies.csv`, [
      ['Start', 'Einde', 'Laadpunt', 'Bus', 'kWh', 'Duur (min)', 'Laadtijd (min)', 'Gem. kW', 'Max. kW', 'Batterij start %', 'Batterij einde %', 'Status', 'Classificatie', 'Voertuig'],
      ...data.sessies.map((s) => {
        const naam = puntNaam(s.evseUid, laadpunten);
        return [s.start ? `${s.dag} ${uurLabel(s.start)}` : '', s.eind ? uurLabel(s.eind) : '', naam, busVoorLaadpunt(naam) ?? '', s.kwh, s.duurMin ?? '', s.laadMin ?? '', s.gemKw ?? '', s.maxKw ?? '', s.socStart ?? '', s.socEind ?? '', s.ongeldig ? 'ongeldig' : s.laadbeurt ? 'geladen' : s.mislukt ? 'mislukt' : '0 kWh', klasseLabel(s.klasse), s.voertuig ?? ''];
      }),
    ]);
  };

  return (
    <Modal open={!!dag} onClose={onSluit} maxWidth="2xl" ariaLabel={dag ? `Dagdetail ${dagLang(dag)}` : 'Dagdetail'}>
      {dag && (
        <div className="flex max-h-[85vh] flex-col">
          <div className="flex items-center justify-between gap-3 border-b border-slate-100 p-5 md:p-6">
            <div className="flex min-w-0 items-center gap-1.5">
              <IconButton label="Vorige dag" variant="secondary" size="sm" onClick={() => onDag(addDagen(dag, -1))} disabled={!!eersteDag && addDagen(dag, -1) < eersteDag}>
                <ChevronLeft size={16} />
              </IconButton>
              <h3 className="min-w-0 truncate text-card-title first-letter:uppercase" aria-live="polite"><span className="max-sm:hidden">{dagLang(dag)}</span><span className="sm:hidden">{dagKort(dag)}</span></h3>
              <IconButton label="Volgende dag" variant="secondary" size="sm" onClick={() => onDag(addDagen(dag, 1))} disabled={dag >= vandaag}>
                <ChevronRight size={16} />
              </IconButton>
            </div>
            <span className="flex shrink-0 items-center gap-2">
              <Button variant="secondary" size="sm" icon={<Download size={14} />} onClick={exporteer} disabled={!data || data.sessies.length === 0}>CSV</Button>
              <IconButton label="Sluiten" variant="ghost" size="sm" onClick={onSluit}><X size={16} /></IconButton>
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-5 md:p-6">
            {fout ? (
              <EmptyState variant="fout" title={fout} compact />
            ) : !data ? (
              <SkeletonTile />
            ) : (
              <div className="space-y-6">
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {[
                    ['Verbruik', tekstKwh(Math.round(data.kwh))],
                    ['Piek (kwartier)', data.piekKw !== null ? `${tekstKw(Math.round(data.piekKw))} om ${uurLabel(data.piekTs)}` : 'geen meting'],
                    ['Laadsessies', String(data.laadbeurten)],
                    ['Mislukt', String(data.mislukt)],
                  ].map(([k, v]) => (
                    <div key={k} className="surface-muted rounded-2xl px-3.5 py-3">
                      <dt className="text-micro">{k}</dt>
                      <dd className="mt-1 truncate text-sm font-semibold font-mono text-slate-900">{v}</dd>
                    </div>
                  ))}
                </dl>
                <div>
                  <MicroLabel className="mb-3 block">Vermogen (kW) per kwartier</MicroLabel>
                  {slots.length === 0 ? (
                    <p className="text-sm text-slate-500">Geen kwartiermetingen voor deze dag (snapshots worden 400 dagen bewaard; vóór 5 augustus 2026 zijn er geen).</p>
                  ) : (
                    <StapCurve
                      slots={slots}
                      ariaLabel={`Vermogen op ${dagLang(dag)}: ${data.piekKw !== null ? `piek ${tekstKw(data.piekKw)} om ${uurLabel(data.piekTs)}` : 'geen meting'}`}
                      gekozen={gekozenSlot}
                      onKies={setGekozenSlot}
                      titelVan={(s) => `${uurLabel(s.ts)} · ${tekstKw(s.kw)} · ${s.charging} bus${s.charging === 1 ? '' : 'sen'}`}
                      asLinks={uurLabel(slots[0].ts)}
                      asRechts={uurLabel(slots[slots.length - 1].ts)}
                      samenvatting={(s) => (s
                        ? `${uurLabel(s.ts)} · ${tekstKw(s.kw)} · ${s.charging} bus${s.charging === 1 ? '' : 'sen'} aan de lader`
                        : data.piekKw !== null ? `piek ${tekstKw(data.piekKw)} om ${uurLabel(data.piekTs)}${typeof data.piekCharging === 'number' ? ` · ${data.piekCharging} bussen aan de lader` : ''} · ${slots.length} kwartieren` : 'geen meting')}
                    />
                  )}
                </div>
                <div>
                  <MicroLabel className="mb-3 block">Sessies gestart op deze dag ({data.sessies.length})</MicroLabel>
                  {data.sessies.length === 0 ? (
                    <p className="text-sm text-slate-500">Geen sessies gestart op deze dag.</p>
                  ) : (
                    <TableShell>
                      <table className="w-full">
                        <thead>
                          <tr>
                            <Th>Start</Th><Th>Einde</Th><Th>Laadpunt</Th><Th num>kWh</Th><Th num>Laadtijd</Th><Th num>Gem. kW</Th><Th num>Batterij</Th><Th>Status</Th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {data.sessies.map((s) => {
                            const naam = puntNaam(s.evseUid, laadpunten);
                            const bus = busVoorLaadpunt(naam);
                            return (
                              <tr key={s.id}>
                                <Td num className="text-left">{uurLabel(s.start)}</Td>
                                <Td num className="text-left">{s.eind ? (dagVanTs(s.eind) !== s.dag ? tijdstipKort(s.eind) : uurLabel(s.eind)) : '—'}</Td>
                                <Td className="whitespace-nowrap"><span className="font-semibold font-mono text-slate-800">{naam}</span>{bus ? <span className="ml-1.5 text-2xs text-slate-500">bus {bus}</span> : null}</Td>
                                <Td num className="font-semibold text-slate-800">{formatGetal(s.kwh, 1)}</Td>
                                <Td num>{duurLabel(s.laadMin)}</Td>
                                <Td num>{s.gemKw !== null ? formatGetal(s.gemKw, 1) : '—'}</Td>
                                <Td num>{socTekst(s)}</Td>
                                <Td><SessieStatusBadge s={s} /></Td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </TableShell>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Modal>
  );
}
