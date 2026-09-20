import { useEffect, useState } from 'react';
import type { ActivityLogEntry, Shift, SwapRequest } from '../types';
import { apiJson } from '../lib/api';
import { Button } from '../components/primitives';
import { formatDatumDMJ, formatDayLong, formatShortDay } from '../lib/format';
import { maandagVan } from '../lib/roosterUren';
import { isoWeekOf } from '../lib/week';
import { addDagen, isoDate } from '../lib/datum';
import { kaleReden } from '../lib/ruilBadge';

/**
 * Weekoverzicht van de dienstwissels als bewijsstuk voor het klassement
 * (Jarno 18-09). Nieuw tabblad via ?ruiloverzicht-week=<yyyy-mm-dd> (elke dag
 * uit de week mag, de view neemt de maandag), automatische window.print().
 *
 * Wat er in staat: de wissels die die week in het portaal zijn UITGEVOERD,
 * niet de wissels die die week in de planning vielen. Het uitvoeringsmoment
 * komt uit het activiteitenlog (server: GET /api/swaps/uitgevoerd), want de
 * `decidedAt` op de wissel wordt door een latere terugdraai overschreven (en
 * tot 20-09 ook door afhandelen).
 * Opmaak volgt de gele boek-print.
 */

const STATUS_LABEL: Record<SwapRequest['status'], string> = {
  pending: 'Wacht op collega',
  accepted: 'Wacht op planning',
  approved: 'Goedgekeurd',
  completed: 'Goedgekeurd',
  rejected: 'Teruggedraaid',
  cancelled: 'Teruggedraaid',
};

const ROL_LABEL: Record<string, string> = { chauffeur: 'chauffeur', planner: 'planner', admin: 'admin', technieker: 'technieker' };

type UitgevoerdeWissel = {
  swap: SwapRequest;
  aanvragerNaam: string;
  overnemerNaam: string;
  uitgevoerdOp: string;
  uitgevoerdDoor: string;
  uitgevoerdDoorRol: string;
  handmatig: boolean;
  verloop: ActivityLogEntry[];
};

const tijdstip = (iso: string) =>
  new Date(iso).toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const uur = (iso: string) => new Date(iso).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
/** Alleen de weekdag ('zondag'): de dagkop zet de datum er zelf in dd/mm/jjjj
 *  naast, en formatDayLong zou dag en maand dan dubbel tonen. */
const weekdag = (iso: string) => formatDayLong(iso).split(' ')[0];
/** Kalenderdag van een tijdstip, zoals de gebruiker hem beleeft. */
const dagVanTijdstip = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : isoDate(d);
};

export function PrintDienstwisselsView({ dag, shifts }: { dag: string; shifts: Shift[] }) {
  const van = maandagVan(dag);
  const tot = addDagen(van, 6);
  const [wissels, setWissels] = useState<UitgevoerdeWissel[] | null>(null);
  const [fout, setFout] = useState<string | null>(null);

  useEffect(() => {
    let actief = true;
    setWissels(null);
    setFout(null);
    apiJson<{ wissels: UitgevoerdeWissel[] }>(`/api/swaps/uitgevoerd?van=${van}&tot=${tot}`)
      .then((data) => { if (actief) setWissels(data.wissels ?? []); })
      .catch((err: unknown) => { if (actief) setFout(err instanceof Error ? err.message : 'Het weekoverzicht kon niet geladen worden.'); });
    return () => { actief = false; };
  }, [van, tot]);

  useEffect(() => {
    if (!wissels) return;
    const t = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(t);
  }, [wissels]);

  if (fout) {
    return <div className="min-h-screen flex items-center justify-center bg-surface-white text-slate-700 p-8 text-center">{fout}</div>;
  }
  if (!wissels) {
    return <div className="min-h-screen flex items-center justify-center bg-surface-white text-slate-500 p-8">Weekoverzicht wordt geladen…</div>;
  }

  const nu = new Date();
  const label = 'text-[9px] font-bold uppercase tracking-[0.06em] text-slate-500';
  const dienstVan = (s: SwapRequest) => shifts.find((sh) => sh.id === s.shiftId);
  const lijnVan = (s: SwapRequest) => String(s.shiftLine || dienstVan(s)?.line || '').trim() || '?';

  // Per uitvoeringsdag, chronologisch: zo leest het klassement als een
  // dagboek van de week in plaats van als één lange lijst.
  const dagen: Array<{ dag: string; wissels: UitgevoerdeWissel[] }> = [];
  for (const wissel of wissels) {
    const d = dagVanTijdstip(wissel.uitgevoerdOp);
    const laatste = dagen[dagen.length - 1];
    if (laatste && laatste.dag === d) laatste.wissels.push(wissel);
    else dagen.push({ dag: d, wissels: [wissel] });
  }
  const handmatige = wissels.filter((w) => w.handmatig).length;

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
          .dagkop { break-after: avoid; page-break-after: avoid; }
        }
      `}</style>

      <div className="mx-auto max-w-[210mm] p-8 print:p-0" style={{ fontFamily: 'Arial, Helvetica, sans-serif' }}>
        <div className="no-print mb-4 flex justify-end">
          <Button variant="primary" onClick={() => window.print()}>Print / Opslaan als PDF</Button>
        </div>

        <header className="border-y-[3px] border-black py-2">
          <h1 className="text-[28px] font-bold leading-tight tracking-tight">Ruiloverzicht</h1>
          <p className="text-[13px] font-bold">Week {isoWeekOf(van)}, {formatDatumDMJ(van)} t/m {formatDatumDMJ(tot)}</p>
          <p className="text-[11px]">
            Dienstwissels die deze week in het portaal zijn uitgevoerd
            {wissels.length > 0 ? `: ${wissels.length} in totaal${handmatige > 0 ? `, waarvan ${handmatige} handmatig door de planning` : ''}` : ''}.
          </p>
        </header>

        {wissels.length === 0 ? (
          <p className="py-16 text-center italic text-slate-500">Deze week zijn er geen dienstwissels uitgevoerd.</p>
        ) : (
          <div className="mt-5 space-y-6">
            {dagen.map((groep) => (
              <div key={groep.dag} className="space-y-4">
                <h2 className="dagkop border-b-2 border-black pb-0.5 text-[13px] font-bold uppercase tracking-[0.08em]">
                  {weekdag(groep.dag)} {formatDatumDMJ(groep.dag)}
                </h2>
                {groep.wissels.map((wissel) => {
                  const s = wissel.swap;
                  const dienst = dienstVan(s);
                  const overname = s.swapType === 'overname';
                  // Bij een handmatige wissel staat "door wie" al in de regel
                  // Uitgevoerd om, dus alleen de kale reden hier.
                  const reden = kaleReden(s.reason);
                  const inRuil = overname
                    ? 'niets, overname zonder tegenprestatie'
                    : s.returnCode && s.returnDate
                      ? `${s.returnCode.toLowerCase() === 'vrij' ? 'vrije dag' : `dienst ${s.returnCode}`} van ${formatShortDay(s.returnDate)}`
                      : '';
                  return (
                    <section key={`${s.id}-${wissel.uitgevoerdOp}`} className="wissel border-b-2 border-black pb-4 text-[11px] leading-snug">
                      <div className="flex items-baseline justify-between gap-4 border-b-[3px] border-double border-black pb-1">
                        <p className="text-[14px] font-bold">
                          Dienst {lijnVan(s)}
                          <span className="ml-2 font-normal">
                            {formatShortDay(s.shiftDate || dienst?.date)}
                            {dienst?.startTime && dienst?.endTime ? `, ${dienst.startTime} – ${dienst.endTime}` : ''}
                          </span>
                        </p>
                        <p className="text-[12px] font-bold">{STATUS_LABEL[s.status]}</p>
                      </div>

                      <dl className="mt-2 grid grid-cols-[9rem_1fr] gap-x-3 gap-y-0.5">
                        <dt className={label}>Uitgevoerd om</dt>
                        <dd>
                          {uur(wissel.uitgevoerdOp)} door {wissel.uitgevoerdDoor}
                          <span className="text-slate-500"> ({ROL_LABEL[wissel.uitgevoerdDoorRol] ?? wissel.uitgevoerdDoorRol})</span>
                          {wissel.handmatig ? ', handmatige wissel' : ''}
                        </dd>
                        <dt className={label}>Geeft dienst af</dt><dd>{wissel.aanvragerNaam}</dd>
                        <dt className={label}>Neemt dienst over</dt><dd>{wissel.overnemerNaam || 'nog niet gekozen'}</dd>
                        {inRuil && (<><dt className={label}>In ruil</dt><dd>{inRuil}</dd></>)}
                        {reden && (<><dt className={label}>Reden</dt><dd>“{reden}”</dd></>)}
                        <dt className={label}>Aangevraagd op</dt><dd>{tijdstip(s.createdAt)}</dd>
                        {s.targetSeenAt && (<><dt className={label}>Gezien door collega</dt><dd>{tijdstip(s.targetSeenAt)}</dd></>)}
                      </dl>

                      {wissel.verloop.length > 0 && (
                        <table className="mt-3 w-full border-collapse">
                          <thead>
                            <tr className="border-b border-black text-left">
                              <th className={`${label} w-[8.5rem] pb-0.5`}>Tijdstip</th>
                              <th className={`${label} pb-0.5`}>Verloop</th>
                              <th className={`${label} w-[11rem] pb-0.5`}>Door</th>
                            </tr>
                          </thead>
                          <tbody>
                            {wissel.verloop.map((e) => (
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
            ))}
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
