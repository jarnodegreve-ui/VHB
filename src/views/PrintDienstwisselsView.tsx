import { useEffect, useState } from 'react';
import type { ActivityLogEntry, Shift, SwapRequest, User } from '../types';
import { apiJson } from '../lib/api';
import { Button } from '../components/primitives';

/**
 * Dagoverzicht van de dienstwissels als bewijsstuk voor de map (Jarno 17-09).
 * Nieuw tabblad via ?print-dienstwissels=<yyyy-mm-dd>, automatische
 * window.print(). Alle wissels waarvan de afgestane dienst óf de dienst in
 * ruil op die dag valt (behalve ingetrokken), elk met het verloop uit het
 * activiteitenlog: wie wat deed en wanneer. Opmaak volgt de gele boek-print.
 */

const STATUS_LABEL: Record<SwapRequest['status'], string> = {
  pending: 'Wacht op collega',
  accepted: 'Wacht op planning',
  approved: 'Goedgekeurd',
  completed: 'Goedgekeurd',
  rejected: 'Afgewezen',
  cancelled: 'Ingetrokken',
};

const ROL_LABEL: Record<string, string> = { chauffeur: 'chauffeur', planner: 'planner', admin: 'admin', technieker: 'technieker' };

const dagLang = (iso: string) => {
  const t = new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return t.charAt(0).toUpperCase() + t.slice(1);
};
const dagKort = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' });
const tijdstip = (iso: string) =>
  new Date(iso).toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export function PrintDienstwisselsView({ datum, swaps, users, shifts }: { datum: string; swaps: SwapRequest[]; users: User[]; shifts: Shift[] }) {
  const [verloop, setVerloop] = useState<Record<string, ActivityLogEntry[]> | null>(null);

  const naam = (id?: string) => (id ? users.find((u) => String(u.id) === String(id))?.name ?? 'Onbekend' : '');
  const dienstVan = (s: SwapRequest) => shifts.find((sh) => sh.id === s.shiftId);
  const dagVan = (s: SwapRequest) => s.shiftDate || dienstVan(s)?.date || '';
  const lijnVan = (s: SwapRequest) => String(s.shiftLine || dienstVan(s)?.line || '').trim() || '?';

  const wissels = swaps
    .filter((s) => s.status !== 'cancelled' && (dagVan(s) === datum || s.returnDate === datum))
    .sort((a, b) => lijnVan(a).localeCompare(lijnVan(b), 'nl', { numeric: true }) || a.createdAt.localeCompare(b.createdAt));
  const sleutel = wissels.map((s) => s.id).join(',');

  useEffect(() => {
    let actief = true;
    const ids = sleutel ? sleutel.split(',') : [];
    // Geschiedenis per wissel; mislukt er één, dan print de rest toch (zonder verloop).
    Promise.all(ids.map((id) => apiJson<ActivityLogEntry[]>(`/api/activity/swap/${encodeURIComponent(id)}`).catch(() => [])))
      .then((lijsten) => {
        if (!actief) return;
        setVerloop(Object.fromEntries(ids.map((id, i) => [id, [...lijsten[i]].sort((a, b) => a.createdAt.localeCompare(b.createdAt))])));
      });
    return () => { actief = false; };
  }, [sleutel]);

  useEffect(() => {
    if (!verloop) return;
    const t = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(t);
  }, [verloop]);

  if (!verloop) {
    return <div className="min-h-screen flex items-center justify-center bg-surface-white text-slate-500 p-8">Dagoverzicht wordt geladen…</div>;
  }

  const nu = new Date();
  const label = 'text-[9px] font-bold uppercase tracking-[0.06em] text-slate-500';

  return (
    <div className="min-h-screen bg-surface-white text-black print:bg-white">
      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 14mm 14mm 18mm;
            @bottom-left { content: "Afgedrukt ${tijdstip(nu.toISOString())}"; font: 8pt Arial, sans-serif; }
            @bottom-right { content: "Pagina " counter(page) " van " counter(pages); font: 8pt Arial, sans-serif; }
          }
          body { background: white; }
          .no-print { display: none !important; }
          .wissel { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>

      <div className="mx-auto max-w-[210mm] p-8 print:p-0" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
        <div className="no-print mb-4 flex justify-end">
          <Button variant="primary" onClick={() => window.print()}>Print / Opslaan als PDF</Button>
        </div>

        <header className="border-y-[3px] border-black py-2">
          <h1 className="text-[28px] font-bold leading-tight tracking-tight">Dienstwissels</h1>
          <p className="text-[13px] font-bold">{dagLang(datum)}</p>
        </header>

        {wissels.length === 0 ? (
          <p className="py-16 text-center italic text-slate-500">Geen dienstwissels op deze dag.</p>
        ) : (
          <div className="mt-5 space-y-5">
            {wissels.map((s) => {
              const dienst = dienstVan(s);
              const overname = s.swapType === 'overname';
              const inRuil = overname
                ? 'niets, overname zonder tegenprestatie'
                : s.returnCode && s.returnDate
                  ? `${s.returnCode.toLowerCase() === 'vrij' ? 'vrije dag' : `dienst ${s.returnCode}`} van ${dagKort(s.returnDate)}`
                  : '';
              const stappen = verloop[s.id] ?? [];
              return (
                <section key={s.id} className="wissel border-b-2 border-black pb-4 text-[11px] leading-snug">
                  <div className="flex items-baseline justify-between gap-4 border-b-[3px] border-double border-black pb-1">
                    <p className="text-[14px] font-bold">
                      Dienst {lijnVan(s)}
                      <span className="ml-2 font-normal">
                        {dagKort(dagVan(s))}{dienst?.startTime && dienst?.endTime ? `, ${dienst.startTime} – ${dienst.endTime}` : ''}
                      </span>
                    </p>
                    <p className="text-[12px] font-bold">{STATUS_LABEL[s.status]}</p>
                  </div>

                  <dl className="mt-2 grid grid-cols-[9rem_1fr] gap-x-3 gap-y-0.5">
                    <dt className={label}>Geeft dienst af</dt><dd>{naam(s.requesterId)}</dd>
                    <dt className={label}>Neemt dienst over</dt><dd>{naam(s.targetDriverId) || 'nog niet gekozen'}</dd>
                    {inRuil && (<><dt className={label}>In ruil</dt><dd>{inRuil}</dd></>)}
                    {s.reason && (<><dt className={label}>Reden</dt><dd>“{s.reason}”</dd></>)}
                    <dt className={label}>Aangevraagd op</dt><dd>{tijdstip(s.createdAt)}</dd>
                    {s.decidedAt && (<><dt className={label}>Beslist op</dt><dd>{tijdstip(s.decidedAt)}</dd></>)}
                    {s.targetSeenAt && (<><dt className={label}>Gezien door collega</dt><dd>{tijdstip(s.targetSeenAt)}</dd></>)}
                  </dl>

                  {stappen.length > 0 && (
                    <table className="mt-3 w-full border-collapse">
                      <thead>
                        <tr className="border-b border-black text-left">
                          <th className={`${label} w-[8.5rem] pb-0.5`}>Tijdstip</th>
                          <th className={`${label} pb-0.5`}>Verloop</th>
                          <th className={`${label} w-[11rem] pb-0.5`}>Door</th>
                        </tr>
                      </thead>
                      <tbody>
                        {stappen.map((e) => (
                          <tr key={e.id} className="align-top">
                            <td className="whitespace-nowrap py-0.5 pr-2">{tijdstip(e.createdAt)}</td>
                            <td className="py-0.5 pr-2">{e.action}</td>
                            <td className="py-0.5">{e.actorName} <span className="text-slate-500">({ROL_LABEL[e.actorRole] ?? e.actorRole})</span></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </section>
              );
            })}
          </div>
        )}

        <div className="wissel mt-10 grid grid-cols-2 gap-10 text-[11px]">
          <div className="border-t border-black pt-1">Paraaf planning</div>
          <div className="border-t border-black pt-1">Datum</div>
        </div>
      </div>
    </div>
  );
}
