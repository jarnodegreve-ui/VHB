import { useEffect, useMemo, useState } from 'react';
import { Download, X } from 'lucide-react';
import { DateInput, Select } from '../../../components/Field';
import { Modal } from '../../../components/Modal';
import { Badge, Button, IconButton, TableShell, Td, microLabelClass } from '../../../components/primitives';
import { SkeletonTile } from '../../../components/Skeleton';
import { Paginering, SortTh, TableToolbar, useSort } from '../../../components/Table';
import { EmptyState } from '../../../components/ui';
import { NietGevonden } from '../../../components/illustraties';
import { apiFetch } from '../../../lib/api';
import { addDagen, isoDate, maandPlus } from '../../../lib/datum';
import { formatGetal } from '../../../lib/format';
import { busVoorLaadpunt } from '../../../lib/laadplein';
import { cn } from '../../../lib/ui';
import { SessieStatusBadge, socTekst } from './DagDetail';
import {
  TermijnKeuze, dagKort, dagVanTs, duurLabel, exporteerCsv, klasseLabel, laadpuntSort, periodeLabel, puntNaam, tekstKw, tekstKwh, tijdstipKort, uurLabel,
  type Laadpunt, type SessieDetail,
} from './gedeeld';

/**
 * Tabblad Sessies: elke laadsessie afzonderlijk, met alles wat ChargEye
 * erover meestuurt (duur, laadtijd, gemiddeld/max vermogen, batterij van →
 * tot, classificatie, voertuigmodel). Periode, laadpunt, status en zoektekst
 * als filters; sorteerbaar; 50 per pagina; CSV van de gefilterde lijst.
 */

type Antwoord = {
  van: string;
  tot: string;
  maand: string | null;
  huidigeDag: string;
  totaal: number;
  afgekapt: boolean;
  sessies: SessieDetail[];
  laadpunten: Laadpunt[];
};
type Periode = { van: string; tot: string };
type StatusFilter = 'alle' | 'geladen' | 'mislukt';
type Kolom = 'start' | 'eind' | 'punt' | 'kwh' | 'duurMin' | 'laadMin' | 'gemKw' | 'maxKw' | 'soc' | 'status';

const PER_PAGINA = 50;

export function SessiesTab({ herlaad }: { herlaad: number }) {
  const vandaag = isoDate(new Date());
  const dezeMaand = vandaag.slice(0, 7);
  const [periode, setPeriode] = useState<Periode>({ van: `${dezeMaand}-01`, tot: vandaag });
  const [data, setData] = useState<Antwoord | null>(null);
  const [laadt, setLaadt] = useState(true);
  const [fout, setFout] = useState<string | null>(null);
  const [evse, setEvse] = useState('');
  const [status, setStatus] = useState<StatusFilter>('alle');
  const [zoek, setZoek] = useState('');
  const [pagina, setPagina] = useState(1);
  const [gekozen, setGekozen] = useState<SessieDetail | null>(null);
  const sort = useSort<Kolom>('start', 'desc');

  useEffect(() => {
    let actueel = true;
    setLaadt(true);
    (async () => {
      try {
        const res = await apiFetch(`/api/ocpi/sessies?van=${periode.van}&tot=${periode.tot}`);
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as Antwoord;
        if (actueel) { setData(json); setFout(null); }
      } catch {
        if (actueel) setFout('Kon de sessies niet laden.');
      } finally {
        if (actueel) setLaadt(false);
      }
    })();
    return () => { actueel = false; };
  }, [periode, herlaad]);
  useEffect(() => { setPagina(1); }, [periode, evse, status, zoek, sort.key, sort.dir]);

  const laadpunten = useMemo(() => new Map((data?.laadpunten ?? []).map((p) => [p.uid, p])), [data?.laadpunten]);
  const laadpuntOpties = useMemo(() => [...(data?.laadpunten ?? [])].sort((a, b) => laadpuntSort(a.evseId ?? a.uid, b.evseId ?? b.uid)), [data?.laadpunten]);
  const naam = (s: SessieDetail) => puntNaam(s.evseUid, laadpunten);

  const gefilterd = useMemo(() => {
    const q = zoek.trim().toLowerCase();
    return (data?.sessies ?? []).filter((s) => {
      if (evse && s.evseUid !== evse) return false;
      if (status === 'geladen' && !s.laadbeurt) return false;
      if (status === 'mislukt' && !s.mislukt) return false;
      if (q) {
        const n = naam(s);
        const bus = busVoorLaadpunt(n) ?? '';
        const hooi = `${n} bus ${bus} ${s.voertuig ?? ''} ${klasseLabel(s.klasse)} ${s.id}`.toLowerCase();
        if (!hooi.includes(q)) return false;
      }
      return true;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.sessies, evse, status, zoek, laadpunten]);
  const gesorteerd = useMemo(() => sort.sorteer(gefilterd, (s, k) => {
    switch (k) {
      case 'punt': return naam(s);
      case 'soc': return s.socEind;
      case 'status': return s.ongeldig ? 'z' : s.mislukt ? 'c' : s.laadbeurt ? 'a' : 'b';
      default: return s[k];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [gefilterd, sort, laadpunten]);
  const pagina_ = gesorteerd.slice((pagina - 1) * PER_PAGINA, pagina * PER_PAGINA);
  const totaalKwh = gefilterd.reduce((a, s) => a + (s.ongeldig ? 0 : s.kwh), 0);

  const presets: Array<{ id: string; label: string; periode: Periode }> = [
    { id: 'maand', label: 'Deze maand', periode: { van: `${dezeMaand}-01`, tot: vandaag } },
    { id: 'vorige', label: 'Vorige maand', periode: { van: `${maandPlus(dezeMaand, -1)}-01`, tot: addDagen(`${dezeMaand}-01`, -1) } },
    { id: '7d', label: '7 dagen', periode: { van: addDagen(vandaag, -6), tot: vandaag } },
  ];
  const actiefPreset = presets.find((p) => p.periode.van === periode.van && p.periode.tot === periode.tot)?.id ?? null;

  const exporteer = () => {
    exporteerCsv(`vhb-laadplein-sessies-${periode.van}_${periode.tot}.csv`, [
      ['Start', 'Einde', 'Dag', 'Laadpunt', 'Bus', 'kWh', 'Duur (min)', 'Laadtijd (min)', 'Gem. kW', 'Max. kW', 'Batterij start %', 'Batterij einde %', 'Status', 'Classificatie', 'Voertuig', 'Sessie-id'],
      ...gesorteerd.map((s) => {
        const n = naam(s);
        return [s.start ? `${dagVanTs(s.start)} ${uurLabel(s.start)}` : '', s.eind ? `${dagVanTs(s.eind)} ${uurLabel(s.eind)}` : '', s.dag, n, busVoorLaadpunt(n) ?? '', s.kwh, s.duurMin ?? '', s.laadMin ?? '', s.gemKw ?? '', s.maxKw ?? '', s.socStart ?? '', s.socEind ?? '', s.ongeldig ? 'ongeldig' : s.laadbeurt ? 'geladen' : s.mislukt ? 'mislukt' : '0 kWh', klasseLabel(s.klasse), s.voertuig ?? '', s.id];
      }),
    ]);
  };

  return (
    <div className="space-y-4">
      {/* Periode: één segmented control voor de snelkeuzes, daarnaast de
          datumvelden voor een eigen periode (netter dan losse chips, Jarno 08-09). */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <TermijnKeuze<string>
          label="Periode"
          waarde={actiefPreset ?? 'eigen'}
          opties={[...presets.map((p) => ({ id: p.id, label: p.label })), { id: 'eigen', label: 'Eigen periode' }]}
          onKies={(id) => { const p = presets.find((x) => x.id === id); if (p) setPeriode(p.periode); }}
        />
        <div className="flex items-center gap-2" role="group" aria-label="Periodekeuze">
          <DateInput size="sm" value={periode.van} max={periode.tot} onChange={(v) => { if (v) setPeriode({ van: v, tot: v > periode.tot ? v : periode.tot }); }} aria-label="Van" />
          <span className="text-xs font-medium text-slate-500">t/m</span>
          <DateInput size="sm" value={periode.tot} min={periode.van} max={vandaag} onChange={(t) => { if (t) setPeriode({ van: t < periode.van ? t : periode.van, tot: t }); }} aria-label="Tot en met" />
        </div>
      </div>

      <TableToolbar
        zoek={zoek}
        onZoek={setZoek}
        placeholder="Zoek laadpunt, bus, voertuig…"
        telling={data ? `${gefilterd.length} van ${data.totaal} · ${tekstKwh(Math.round(totaalKwh))}` : undefined}
        filters={(
          <>
            <Select value={evse} onChange={(e) => setEvse(e.target.value)} aria-label="Laadpunt" className="h-9 py-1 text-xs">
              <option value="">Alle laadpunten</option>
              {laadpuntOpties.map((p) => {
                const n = p.evseId ?? p.physicalReference ?? p.uid;
                const bus = busVoorLaadpunt(p.evseId);
                return <option key={p.uid} value={p.uid}>{n}{bus ? ` · bus ${bus}` : ''}</option>;
              })}
            </Select>
            <TermijnKeuze<StatusFilter>
              label="Status"
              waarde={status}
              opties={[{ id: 'alle', label: 'Alle' }, { id: 'geladen', label: 'Geladen' }, { id: 'mislukt', label: 'Mislukt' }]}
              onKies={setStatus}
            />
          </>
        )}
        acties={<Button variant="secondary" size="sm" icon={<Download size={14} />} onClick={exporteer} disabled={gefilterd.length === 0}>CSV</Button>}
      />

      {fout ? (
        <EmptyState variant="fout" title={fout} message="Probeer het opnieuw met Ververs." />
      ) : !data ? (
        <SkeletonTile />
      ) : (
        <div className={cn('transition-opacity', laadt && 'opacity-60')} aria-busy={laadt}>
          {data.afgekapt && (
            <p className="mb-2 text-xs font-medium text-amber-700">Meer dan 5 000 sessies in deze periode: alleen de nieuwste worden getoond. Kies een kortere periode voor de volledige lijst.</p>
          )}
          {gesorteerd.length === 0 ? (
            <EmptyState illustratie={<NietGevonden />} title="Geen sessies" message={`Geen sessies gevonden voor ${periodeLabel({ ...periode, maand: null })} met deze filters.`} />
          ) : (
            <TableShell>
              <table className="w-full">
                <thead>
                  <tr>
                    <SortTh kolom="start" sort={sort}>Start</SortTh>
                    <SortTh kolom="eind" sort={sort} className="max-md:hidden">Einde</SortTh>
                    <SortTh kolom="punt" sort={sort}>Laadpunt</SortTh>
                    <SortTh kolom="kwh" sort={sort} align="right">kWh</SortTh>
                    <SortTh kolom="duurMin" sort={sort} align="right" className="max-lg:hidden">Aangekoppeld</SortTh>
                    <SortTh kolom="laadMin" sort={sort} align="right" className="max-md:hidden">Laadtijd</SortTh>
                    <SortTh kolom="gemKw" sort={sort} align="right" className="max-lg:hidden">Gem. kW</SortTh>
                    <SortTh kolom="maxKw" sort={sort} align="right" className="max-xl:hidden">Max. kW</SortTh>
                    <SortTh kolom="soc" sort={sort} align="right" className="max-md:hidden">Batterij</SortTh>
                    <SortTh kolom="status" sort={sort}>Status</SortTh>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline-subtle">
                  {pagina_.map((s) => {
                    const n = naam(s);
                    const bus = busVoorLaadpunt(n);
                    return (
                      <tr key={s.id} className="cursor-pointer hover:bg-surface-soft-hover" onClick={() => setGekozen(s)}>
                        <Td num className="text-left">
                          {/* rauw: rij-titel als knop (toetsenbord-toegang tot het detail), de hele rij vangt de klik */}
                          <button type="button" className="ios-pressable -mx-1 rounded-md px-1 text-left font-medium text-slate-800" aria-haspopup="dialog">
                            {tijdstipKort(s.start)}
                          </button>
                        </Td>
                        <Td num className="max-md:hidden text-left text-slate-600">{s.eind ? (dagVanTs(s.eind) === s.dag ? uurLabel(s.eind) : tijdstipKort(s.eind)) : <Badge tone="blue" dot stil>bezig</Badge>}</Td>
                        <Td className="whitespace-nowrap"><span className="font-semibold font-mono text-slate-800">{n}</span>{bus ? <span className="ml-1.5 text-xs text-slate-500">bus {bus}</span> : null}</Td>
                        <Td num className={cn('font-semibold', s.kwh > 0 ? 'text-slate-800' : 'text-slate-500')}>{formatGetal(s.kwh, 1)}</Td>
                        <Td num className="max-lg:hidden">{duurLabel(s.duurMin)}</Td>
                        <Td num className="max-md:hidden">{s.laadMin !== null && s.laadMin > 0 ? duurLabel(s.laadMin) : '—'}</Td>
                        <Td num className="max-lg:hidden">{s.gemKw !== null ? formatGetal(s.gemKw, 1) : '—'}</Td>
                        <Td num className="max-xl:hidden">{s.maxKw !== null ? formatGetal(s.maxKw, 1) : '—'}</Td>
                        <Td num className="max-md:hidden">{socTekst(s)}</Td>
                        <Td><SessieStatusBadge s={s} /></Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <Paginering totaal={gesorteerd.length} perPagina={PER_PAGINA} pagina={pagina} onPagina={setPagina} className="border-t border-hairline-subtle" />
            </TableShell>
          )}
        </div>
      )}

      <Modal open={!!gekozen} onClose={() => setGekozen(null)} maxWidth="sm" ariaLabel={gekozen ? `Sessie op laadpunt ${naam(gekozen)}` : 'Sessie'}>
        {gekozen && (() => {
          const n = naam(gekozen);
          const bus = busVoorLaadpunt(n);
          const rij = (label: string, waarde: string) => (
            <div className="flex items-center justify-between gap-3 border-b border-hairline-subtle py-2.5 last:border-b-0">
              <span className={microLabelClass}>{label}</span>
              <span className="min-w-0 truncate text-right text-sm font-semibold font-mono text-slate-800">{waarde}</span>
            </div>
          );
          return (
            <div className="p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 className="min-w-0 truncate text-card-title">Laadpunt {n}{bus ? ` · bus ${bus}` : ''}</h3>
                <span className="flex shrink-0 items-center gap-2">
                  <SessieStatusBadge s={gekozen} />
                  <IconButton label="Sluiten" variant="ghost" size="sm" onClick={() => setGekozen(null)}><X size={16} /></IconButton>
                </span>
              </div>
              <div>
                {rij('Dag', dagKort(gekozen.dag))}
                {rij('Start', tijdstipKort(gekozen.start))}
                {rij('Einde', gekozen.eind ? tijdstipKort(gekozen.eind) : 'nog bezig')}
                {rij('Aangekoppeld', duurLabel(gekozen.duurMin))}
                {rij('Laadtijd', gekozen.laadMin !== null ? duurLabel(gekozen.laadMin) : '—')}
                {rij('Geladen', tekstKwh(gekozen.kwh))}
                {rij('Gemiddeld vermogen', gekozen.gemKw !== null ? tekstKw(gekozen.gemKw) : '—')}
                {rij('Hoogste vermogen', gekozen.maxKw !== null ? tekstKw(gekozen.maxKw) : '—')}
                {rij('Batterij', socTekst(gekozen))}
                {rij('Classificatie', klasseLabel(gekozen.klasse))}
                {gekozen.voertuig && rij('Voertuig (ChargEye)', gekozen.voertuig)}
                {rij('Sessie-id', gekozen.id.slice(0, 8))}
              </div>
            </div>
          );
        })()}
      </Modal>
    </div>
  );
}
