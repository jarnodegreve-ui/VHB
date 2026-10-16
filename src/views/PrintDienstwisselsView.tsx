import { useEffect, useState } from 'react';
import type { ActivityLogEntry, Shift, SwapRequest } from '../types';
import { apiJson } from '../lib/api';
import { PrintBlad } from '../components/PrintBlad';
import { formatDatumDMJ, formatDayLong, formatShortDay } from '../lib/format';
import { maandagVan } from '../lib/roosterUren';
import { isoWeekOf } from '../lib/week';
import { addDagen, isoDate } from '../lib/datum';

/**
 * Weekoverzicht van de dienstwissels als bewijsstuk voor het klassement
 * (Jarno 18-09). Nieuw tabblad via ?ruiloverzicht-week=<yyyy-mm-dd> (elke dag
 * uit de week mag, de view neemt de maandag). Kop, printdialoog en paginavoet
 * zijn van `PrintBlad` (sinds 03-10); geen paraafstrook meer, het blad is ter
 * info (Jarno 03-10).
 *
 * Wat er in staat: de wissels die die week in het portaal zijn UITGEVOERD,
 * niet de wissels die die week in de planning vielen. Het uitvoeringsmoment
 * komt uit het activiteitenlog (server: GET /api/swaps/uitgevoerd), want de
 * `decidedAt` op de wissel wordt door een latere terugdraai overschreven (en
 * tot 20-09 ook door afhandelen).
 *
 * Sinds 16-10 (Jarno) compact, zodat er veel wissels op één blad passen: één
 * tabelregel per wissel met alleen dienst, dienstdatum, soort (ruil of
 * overname, bij een ruil klein eronder wat er in ruil terugkomt), wie afgeeft, wie overneemt, aangevraagd op en bevestigd op (de
 * bevestiging van de nieuwe rijder, `targetSeenAt`, zoals "Dienstwissel
 * bevestigd" in het verloop). Geen verloop, reden, uitvoerder of
 * "Afgedrukt op" meer. Per uitvoeringsdag een kopregel, zoals de werktypes in
 * de gele boek-print.
 */

/** Dit blad toont alleen wissels die doorgevoerd zijn geweest, dus afgewezen
 *  of geannuleerd betekent hier altijd dat de wissel later is teruggedraaid
 *  (api/_lib/ruilRoutes.ts). Dat blijft zichtbaar, de andere statussen niet. */
const isTeruggedraaid = (s: SwapRequest) => s.status === 'rejected' || s.status === 'cancelled';

/** Wat de overnemer bij een ruil teruggeeft: 'tegen 2606, za 5 dec' of 'tegen vrije dag, …'. */
const inRuil = (s: SwapRequest): string => {
  if (s.swapType === 'overname' || !s.returnCode || !s.returnDate) return '';
  const wat = s.returnCode.toLowerCase() === 'vrij' ? 'vrije dag' : s.returnCode;
  return `tegen ${wat}, ${formatShortDay(s.returnDate)}`;
};

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

  if (fout) {
    return <div className="min-h-screen flex items-center justify-center bg-surface-white text-slate-700 p-8 text-center">{fout}</div>;
  }
  if (!wissels) {
    return <div className="min-h-screen flex items-center justify-center bg-surface-white text-slate-500 p-8">Weekoverzicht wordt geladen…</div>;
  }

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

  const th = 'pb-1 pr-2 text-left align-bottom text-[11px] font-bold text-slate-900';

  return (
    <PrintBlad
      titel="Ruiloverzicht"
      filters={[`Week ${isoWeekOf(van)}`, `${formatDatumDMJ(van)} t/m ${formatDatumDMJ(tot)}`]}
      tabbladTitel={`VHB Ruiloverzicht week ${isoWeekOf(van)} ${formatDatumDMJ(van)}`}
    >
      {wissels.length === 0 ? (
        <p className="printblad-leeg">Deze week zijn er geen dienstwissels uitgevoerd.</p>
      ) : (
        <table className="mt-5 w-full border-collapse text-[10px] leading-snug">
          <colgroup>
            <col className="w-[7%]" />
            <col className="w-[10%]" />
            <col className="w-[19%]" />
            <col />
            <col />
            <col className="w-[11%]" />
            <col className="w-[11%]" />
          </colgroup>
          <thead>
            <tr className="border-b-2 border-slate-900">
              <th className={th}>dienst</th>
              <th className={th}>datum</th>
              <th className={th}>soort</th>
              <th className={th}>geeft af</th>
              <th className={th}>neemt over</th>
              <th className={th}>aangevraagd</th>
              <th className={`${th} pr-0`}>bevestigd</th>
            </tr>
          </thead>
          {dagen.map((groep) => (
            <tbody key={groep.dag}>
              <tr className="printblad-bij-volgende">
                <td colSpan={7} className="pt-3">
                  <p className="border-b border-slate-900 pb-0.5 text-[11px] font-bold">
                    {weekdag(groep.dag)} {formatDatumDMJ(groep.dag)}
                  </p>
                </td>
              </tr>
              {groep.wissels.map((wissel) => {
                const s = wissel.swap;
                const terug = inRuil(s);
                return (
                  <tr key={`${s.id}-${wissel.uitgevoerdOp}`} className="printblad-bijeen border-b border-slate-300 align-top">
                    <td className="py-0.5 pr-2 font-bold">{lijnVan(s)}</td>
                    <td className="whitespace-nowrap py-0.5 pr-2">{formatShortDay(s.shiftDate || dienstVan(s)?.date)}</td>
                    <td className="py-0.5 pr-2">
                      {s.swapType === 'overname' ? 'Overname' : 'Ruil'}
                      {terug && <span className="block whitespace-nowrap text-[9px] text-slate-600">{terug}</span>}
                      {isTeruggedraaid(s) && <span className="block italic text-slate-600">teruggedraaid</span>}
                    </td>
                    <td className="py-0.5 pr-2">{wissel.aanvragerNaam}</td>
                    <td className="py-0.5 pr-2">{wissel.overnemerNaam || 'nog niet gekozen'}</td>
                    <td className="whitespace-nowrap py-0.5 pr-2">{formatDatumDMJ(dagVanTijdstip(s.createdAt))}</td>
                    <td className="whitespace-nowrap py-0.5">
                      {s.targetSeenAt ? formatDatumDMJ(dagVanTijdstip(s.targetSeenAt)) : <span className="text-slate-500">nog niet</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      )}
    </PrintBlad>
  );
}
