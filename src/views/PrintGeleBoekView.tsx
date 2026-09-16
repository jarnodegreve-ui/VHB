import { useEffect, useState } from 'react';
import { DEFECT_STATUS_LABEL, WERKTYPE_LABEL } from '../../shared/techniek';
import { laadDefecten, urenTekst, type Defect } from '../lib/techniek';
import { formatDateHuman } from '../lib/format';
import { Button } from '../components/primitives';

/**
 * Papieren gele boek voor de ISO-map (Jarno 13-09): de garage hield het
 * gele boek altijd al op papier bij, dat moet kunnen blijven. Zelfde opzet
 * als de andere printschermen (nieuw tabblad via ?print-gele-boek=open|alles,
 * automatische window.print()), maar zelf-ladend: de defecten zitten niet in
 * de collecties van de schil. Chronologisch oplopend, zoals een logboek.
 */
export function PrintGeleBoekView({ filter }: { filter: 'open' | 'alles' }) {
  const [rijen, setRijen] = useState<Defect[] | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  useEffect(() => {
    let actief = true;
    laadDefecten({ status: filter === 'open' ? 'open' : 'alles', limit: 5000 })
      .then((d) => { if (actief) setRijen([...d].sort((a, b) => a.gemeldOp.localeCompare(b.gemeldOp))); })
      .catch((e: unknown) => { if (actief) setFout(e instanceof Error ? e.message : 'Kon de gele boek niet laden.'); });
    return () => { actief = false; };
  }, [filter]);

  useEffect(() => {
    if (!rijen) return;
    const t = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(t);
  }, [rijen]);

  if (fout) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-white text-slate-700 font-bold p-8">
        {fout} Sluit dit tabblad.
      </div>
    );
  }
  if (!rijen) {
    return <div className="min-h-screen flex items-center justify-center bg-surface-white text-slate-500 p-8">Gele boek wordt geladen…</div>;
  }

  const open = rijen.filter((r) => r.status === 'open').length;
  const nu = new Date();

  return (
    <div className="min-h-screen bg-surface-white text-slate-900 print:bg-white">
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 12mm 12mm 14mm; }
          body { background: white; }
          .no-print { display: none !important; }
          tr { break-inside: avoid; page-break-inside: avoid; }
          thead { display: table-header-group; }
        }
      `}</style>

      <div className="mx-auto max-w-6xl p-8 md:p-10">
        <div className="no-print mb-4 flex justify-end">
          <Button variant="primary" onClick={() => window.print()}>Print / Opslaan als PDF</Button>
        </div>

        <header className="mb-6 border-b-2 border-slate-900 pb-4">
          <p className="text-[10px] font-black uppercase tracking-[0.08em] text-oker-700">VHB · Maldegem · Gele boek</p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div>
              <h1 className="text-3xl font-black tracking-tight">{filter === 'open' ? 'Open meldingen' : 'Alle meldingen'}</h1>
              <p className="mt-1 text-sm font-medium text-slate-500">Stand van {formatDateHuman(nu.toISOString().slice(0, 10))}, {nu.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}</p>
            </div>
            <div className="flex items-stretch divide-x divide-slate-200">
              <div className="pr-5">
                <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-slate-500">Meldingen</p>
                <p className="mt-1 text-xl font-black leading-none text-slate-900">{rijen.length}</p>
              </div>
              <div className="pl-5">
                <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-oker-700">Open</p>
                <p className="mt-1 text-xl font-black leading-none text-oker-700">{open}</p>
              </div>
            </div>
          </div>
        </header>

        {rijen.length === 0 ? (
          <p className="py-16 text-center italic text-slate-400">Geen meldingen.</p>
        ) : (
          <table className="w-full border-collapse text-[11px] leading-snug">
            <thead>
              <tr className="border-b-2 border-slate-300 text-left">
                <th className="py-1.5 pr-2 text-[9px] font-black uppercase tracking-[0.08em] text-slate-500">Gemeld</th>
                <th className="py-1.5 pr-2 text-[9px] font-black uppercase tracking-[0.08em] text-slate-500">Bus</th>
                <th className="py-1.5 pr-2 text-[9px] font-black uppercase tracking-[0.08em] text-slate-500">Soort</th>
                <th className="py-1.5 pr-2 text-[9px] font-black uppercase tracking-[0.08em] text-slate-500">Melding</th>
                <th className="py-1.5 pr-2 text-[9px] font-black uppercase tracking-[0.08em] text-slate-500">Melder</th>
                <th className="py-1.5 pr-2 text-[9px] font-black uppercase tracking-[0.08em] text-slate-500">Status</th>
                <th className="py-1.5 pr-2 text-[9px] font-black uppercase tracking-[0.08em] text-slate-500">Uitgevoerd</th>
                <th className="py-1.5 pr-2 text-[9px] font-black uppercase tracking-[0.08em] text-slate-500">Werk</th>
                <th className="py-1.5 text-right text-[9px] font-black uppercase tracking-[0.08em] text-slate-500">Uren</th>
              </tr>
            </thead>
            <tbody>
              {rijen.map((d) => (
                <tr key={d.id} className="border-b border-slate-100 align-top">
                  <td className="whitespace-nowrap py-1.5 pr-2 font-semibold">{formatDateHuman(d.gemeldOp.slice(0, 10))}</td>
                  <td className="whitespace-nowrap py-1.5 pr-2 font-bold">{d.busnr}</td>
                  <td className="whitespace-nowrap py-1.5 pr-2">{WERKTYPE_LABEL[d.werktype]}</td>
                  <td className="py-1.5 pr-2">
                    {d.omschrijving}
                    {d.opmerking && <span className="block text-[10px] text-slate-500">{d.opmerking}</span>}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-2">{d.gemeldDoorNaam ?? '—'}</td>
                  <td className="whitespace-nowrap py-1.5 pr-2">{DEFECT_STATUS_LABEL[d.status]}</td>
                  <td className="whitespace-nowrap py-1.5 pr-2">
                    {d.uitgevoerdOp ? formatDateHuman(d.uitgevoerdOp) : '—'}
                    {d.uitgevoerdDoorNaam && <span className="block text-[10px] text-slate-500">{d.uitgevoerdDoorNaam}</span>}
                  </td>
                  <td className="py-1.5 pr-2">{d.uitgevoerdWerk ?? '—'}</td>
                  <td className="whitespace-nowrap py-1.5 text-right">{d.manuren !== null && d.manuren !== undefined ? urenTekst(d.manuren) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <footer className="mt-8 border-t border-slate-200 pt-3 text-center text-[10px] font-medium text-slate-500">
          Gegenereerd op {nu.toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short' })} via VHB Portaal
        </footer>
      </div>
    </div>
  );
}
