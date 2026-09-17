import { useEffect, useState } from 'react';
import { WERKTYPES, WERKTYPE_LABEL } from '../../shared/techniek';
import { laadDefecten, type Defect } from '../lib/techniek';
import { Button } from '../components/primitives';

/**
 * Papieren gele boek voor de ISO-map (Jarno 13-09): de garage hield het
 * gele boek altijd al op papier bij, dat moet kunnen blijven. Zelfde opzet
 * als de andere printschermen (nieuw tabblad via ?print-gele-boek=open|alles,
 * automatische window.print()), maar zelf-ladend: de defecten zitten niet in
 * de collecties van de schil.
 *
 * Opmaak volgt het Access-rapport "openstaande aangevraagde werken" (Jarno
 * 17-09): A4 staand, gegroepeerd per werktype, per bus oplopend, met de duur
 * in dagen sinds de melding.
 */

const MAANDEN = ['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];

/** '24-apr-26', zoals in het Access-rapport. */
const kortDatum = (iso: string | null | undefined): string => {
  if (!iso) return '';
  const [j, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${MAANDEN[Number(m) - 1] ?? m}-${j.slice(2)}`;
};

const dagNr = (iso: string) => Math.floor(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) / 86_400_000);

/** Dagen van melding tot uitvoering (of vandaag), de meldingsdag meegeteld zoals in Access. */
const duurDagen = (d: Defect, vandaag: string): number | null => {
  if (d.status === 'geannuleerd') return null;
  return Math.max(1, dagNr(d.uitgevoerdOp ?? vandaag) - dagNr(d.gemeldOp) + 1);
};

const busSleutel = (d: Defect) => d.kortNr ?? (Number.parseInt(d.busnr, 10) || Number.MAX_SAFE_INTEGER);

export function PrintGeleBoekView({ filter }: { filter: 'open' | 'alles' }) {
  const [rijen, setRijen] = useState<Defect[] | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  useEffect(() => {
    let actief = true;
    laadDefecten({ status: filter === 'open' ? 'open' : 'alles', limit: 5000 })
      .then((d) => {
        if (!actief) return;
        setRijen([...d].sort((a, b) => busSleutel(a) - busSleutel(b) || a.busnr.localeCompare(b.busnr) || a.gemeldOp.localeCompare(b.gemeldOp)));
      })
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

  const vandaagIso = new Date().toLocaleDateString('sv-SE');
  const vandaagTekst = new Date().toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const titel = filter === 'open' ? 'Openstaande aangevraagde werken' : 'Aangevraagde werken';
  const groepen = WERKTYPES.map((t) => ({ type: t, rijen: rijen.filter((r) => r.werktype === t) })).filter((g) => g.rijen.length > 0);

  const th = 'pb-1 pr-2 text-left align-bottom text-[11px] font-bold text-black';

  return (
    <div className="min-h-screen bg-surface-white text-black print:bg-white">
      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 14mm 14mm 18mm;
            @bottom-left { content: "${vandaagTekst}"; font: 8pt Arial, sans-serif; }
            @bottom-right { content: "Pagina " counter(page) " van " counter(pages); font: 8pt Arial, sans-serif; }
          }
          body { background: white; }
          .no-print { display: none !important; }
          tbody { break-inside: auto; }
          tr { break-inside: avoid; page-break-inside: avoid; }
          thead { display: table-header-group; }
          .groepkop { break-after: avoid; page-break-after: avoid; }
        }
      `}</style>

      <div className="mx-auto max-w-[210mm] p-8 print:p-0" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
        <div className="no-print mb-4 flex justify-end">
          <Button variant="primary" onClick={() => window.print()}>Print / Opslaan als PDF</Button>
        </div>

        <header className="border-y-[3px] border-black py-2">
          <h1 className="text-[28px] font-bold leading-tight tracking-tight">{titel}</h1>
        </header>

        {groepen.length === 0 ? (
          <p className="py-16 text-center italic text-slate-500">Geen meldingen.</p>
        ) : (
          <table className="mt-5 w-full border-collapse text-[10px] leading-snug">
            <colgroup>
              <col className="w-[7%]" />
              <col className="w-[11%]" />
              <col className="w-[12%]" />
              <col />
              <col className="w-[6%]" />
              <col className="w-[11%]" />
              <col className="w-[6%]" />
            </colgroup>
            <thead>
              <tr className="border-b-2 border-black">
                <th className={`${th} text-right`}>bus</th>
                <th className={`${th} text-center`}>datum</th>
                <th className={th}>naam</th>
                <th className={th}>aangevraagd werk</th>
                <th className={`${th} text-center`}>type</th>
                <th className={`${th} text-center`}>{filter === 'open' ? 'datum' : 'uitgevoerd'}</th>
                <th className={`${th} pr-0 text-right`}>duur</th>
              </tr>
            </thead>
            {groepen.map((g) => (
              <tbody key={g.type}>
                <tr className="groepkop">
                  <td colSpan={7} className="pt-3">
                    <p className="border-b-[3px] border-double border-black pb-1 text-[13px] font-bold">
                      werktype <span className="ml-2">{WERKTYPE_LABEL[g.type].toLowerCase()}</span>
                    </p>
                  </td>
                </tr>
                {g.rijen.map((d, i) => {
                  const nieuweBus = i > 0 && g.rijen[i - 1].busnr !== d.busnr;
                  const duur = duurDagen(d, vandaagIso);
                  return (
                    <tr key={d.id} className={`align-top ${nieuweBus ? 'border-t border-black' : ''}`}>
                      <td className="py-0.5 pr-2 text-right">{d.kortNr ?? d.busnr}</td>
                      <td className="whitespace-nowrap py-0.5 pr-2 text-center">{kortDatum(d.gemeldOp)}</td>
                      <td className="py-0.5 pr-2">{d.gemeldDoorNaam ?? ''}</td>
                      <td className="py-0.5 pr-2">
                        {d.omschrijving}
                        {filter === 'alles' && d.uitgevoerdWerk && <span className="block text-slate-600">→ {d.uitgevoerdWerk}</span>}
                        {d.status === 'geannuleerd' && <span className="block italic text-slate-600">geannuleerd</span>}
                      </td>
                      <td className="py-0.5 pr-2 text-center">{d.werktype}</td>
                      <td className="whitespace-nowrap py-0.5 pr-2 text-center">{kortDatum(d.uitgevoerdOp)}</td>
                      <td className="py-0.5 text-right">{duur ?? ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        )}

        <footer className="no-print mt-10 flex justify-between border-t-2 border-black pt-1 text-[10px]">
          <span>{vandaagTekst}</span>
          <span>VHB Portaal</span>
        </footer>
      </div>
    </div>
  );
}
