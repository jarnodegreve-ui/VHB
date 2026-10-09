import { useMemo } from 'react';
import type { LeaveRequest, User } from '../types';
import { daysBetween, verlofBalans, verlofDagen } from '../lib/leaveBalance';
import { formatLeaveType, formatShortDay } from '../lib/format';
import { PrintBlad } from '../components/PrintBlad';

/**
 * Verlof-jaaroverzicht van één chauffeur op papier: saldo, alle opgenomen
 * periodes chronologisch mét saldoverloop, en wat nog op een beslissing
 * wacht. Voor eindejaarsgesprekken en saldo-discussies, één blad met de hele
 * feitenbasis. Nieuw tabblad via `?print-verlof-driver=&print-verlof-jaar=`;
 * kop, printdialoog en paginavoet zijn van `PrintBlad` (sinds 03-10). Geen
 * handtekeningstrook meer: het blad is ter info (Jarno 03-10).
 */

const clipToYear = (iso: string, year: number, fallback: 'start' | 'end') => {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  if (!iso) return fallback === 'start' ? yearStart : yearEnd;
  if (iso < yearStart) return yearStart;
  if (iso > yearEnd) return yearEnd;
  return iso;
};

/** Datums als "ma 3 feb" zonder jaar: het jaar staat al in de kop. */
export function PrintLeaveYearView({
  driver,
  year,
  leaves,
  door,
}: {
  driver: User | null;
  year: number;
  leaves: LeaveRequest[];
  /** Naam van wie afdrukt (voor de regel "Afgedrukt op … door …"). */
  door: string;
}) {
  const balans = useMemo(
    () => verlofBalans(leaves, driver?.id ?? '', year, driver),
    [leaves, driver, year],
  );

  const { approved, pending, ziekteDagen } = useMemo(() => {
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const inYear = leaves
      .filter((l) => driver && l.userId === driver.id && l.startDate <= yearEnd && l.endDate >= yearStart)
      .map((l) => ({
        ...l,
        // Verlof telt maandag t/m zaterdag (zondag nooit); ziekte telt gewoon
        // kalenderdagen, want die loopt door op zondag.
        dagenInJaar: (l.type === 'ziekte' ? daysBetween : verlofDagen)(
          clipToYear(l.startDate, year, 'start'),
          clipToYear(l.endDate, year, 'end'),
        ),
      }))
      .sort((a, b) => a.startDate.localeCompare(b.startDate));

    // Saldoverloop: na elke goedgekeurde betaald-verlofperiode het resterend
    // budget — zo is elk saldo in een discussie naar een datum te herleiden.
    let resterend = balans.betaaldBudget;
    const approvedRows = inYear
      .filter((l) => l.status === 'approved')
      .map((l) => {
        if (l.type === 'betaald_verlof') resterend -= l.dagenInJaar;
        return { ...l, saldoNa: l.type === 'betaald_verlof' ? resterend : null };
      });

    return {
      approved: approvedRows,
      pending: inYear.filter((l) => l.status === 'pending'),
      ziekteDagen: approvedRows.filter((l) => l.type === 'ziekte').reduce((sum, l) => sum + l.dagenInJaar, 0),
    };
  }, [leaves, driver, year, balans.betaaldBudget]);

  if (!driver) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-white text-slate-700 font-bold p-8">
        Chauffeur niet gevonden. Sluit dit tabblad.
      </div>
    );
  }

  return (
    <PrintBlad
      titel="Verlofjaar"
      filters={[`Chauffeur: ${driver.name}`, `Jaar ${year}`]}
      door={door}
      tabbladTitel={`VHB Verlofjaar ${driver.name} ${year}`}
    >
      {/* Koptitel van het vel: naam en jaar, met het saldo als strip met hairline-scheiders. */}
      <header className="printblad-bij-volgende mt-6 border-b-2 border-slate-900 pb-4 mb-6">
        <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <div>
            <h2 className="text-3xl font-black tracking-tight">{driver.name}</h2>
            <p className="mt-1 text-lg font-bold text-slate-600">{year}</p>
            {driver.employeeId && (
              <p className="mt-1.5 text-xs font-medium text-slate-400">
                Personeelsnummer: {driver.employeeId}
              </p>
            )}
          </div>
          <div className="flex items-stretch divide-x divide-hairline">
            <div className="pr-5">
              <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400">Budget</p>
              <p className="mt-1 text-xl font-black text-slate-900 tabular-nums leading-none">{balans.betaaldBudget}</p>
            </div>
            <div className="px-5">
              <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400">Opgenomen</p>
              <p className="mt-1 text-xl font-black text-slate-900 tabular-nums leading-none">{balans.betaaldGebruikt}</p>
            </div>
            <div className="px-5">
              <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400">Resterend</p>
              <p className="mt-1 text-xl font-black text-slate-900 tabular-nums leading-none">{balans.betaaldResterend}</p>
            </div>
            <div className="px-5">
              <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400">Klein verlet</p>
              <p className="mt-1 text-xl font-black text-slate-900 tabular-nums leading-none">{balans.kleinVerletDagen}</p>
            </div>
            {ziekteDagen > 0 && (
              <div className="pl-5">
                <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400">Ziekte</p>
                <p className="mt-1 text-xl font-black text-slate-900 tabular-nums leading-none">{ziekteDagen}</p>
              </div>
            )}
          </div>
        </div>
      </header>

      {approved.length === 0 ? (
        <p className="text-center py-16 text-slate-400 italic">
          Geen goedgekeurd verlof geregistreerd in {year}.
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b-2 border-slate-300 text-left">
              <th className="py-2 pr-3 text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">Periode</th>
              <th className="py-2 pr-3 text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">Type</th>
              <th className="py-2 pr-3 text-right text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">Dagen</th>
              <th className="py-2 text-right text-[10px] font-black uppercase tracking-[0.08em] text-slate-500">Saldo betaald</th>
            </tr>
          </thead>
          <tbody>
            {approved.map((l) => (
              <tr key={l.id} className="printblad-bijeen border-b border-slate-100">
                <td className="py-2.5 pr-3 font-bold text-slate-900">
                  {l.startDate === l.endDate
                    ? formatShortDay(l.startDate)
                    : `${formatShortDay(l.startDate)} – ${formatShortDay(l.endDate)}`}
                  {(l.startDate < `${year}-01-01` || l.endDate > `${year}-12-31`) && (
                    <span className="ml-1.5 text-[10px] font-semibold text-slate-400">(deel in {year})</span>
                  )}
                </td>
                <td className="py-2.5 pr-3">
                  {/* Het type als omlijnd label: de tekst draagt de betekenis, geen kleur (zwart-wit leesbaar). */}
                  <span className="inline-block rounded border border-slate-400 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.08em] text-slate-900">
                    {formatLeaveType(l.type)}
                  </span>
                </td>
                <td className="py-2.5 pr-3 text-right font-black tabular-nums">{l.dagenInJaar}</td>
                <td className={`py-2.5 text-right tabular-nums ${l.saldoNa !== null && l.saldoNa < 0 ? 'font-black text-slate-900' : 'font-bold text-slate-600'}`}>
                  {l.saldoNa === null
                    ? '—'
                    : l.saldoNa < 0
                      ? `${Math.abs(l.saldoNa)} boven budget (${balans.betaaldBudget})`
                      : `${l.saldoNa} van ${balans.betaaldBudget}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {pending.length > 0 && (
        <section className="printblad-bijeen mt-8">
          <h3 className="text-[10px] font-black uppercase tracking-[0.16em] text-slate-700 border-b border-slate-900 pb-1.5 mb-2">
            Nog niet beslist (telt niet mee in het saldo)
          </h3>
          <ul className="space-y-1 text-sm">
            {pending.map((l) => (
              <li key={l.id} className="flex items-baseline justify-between gap-3">
                <span className="font-bold text-slate-700">
                  {l.startDate === l.endDate ? formatShortDay(l.startDate) : `${formatShortDay(l.startDate)} – ${formatShortDay(l.endDate)}`}
                  <span className="ml-2 font-medium text-slate-400">{formatLeaveType(l.type)}</span>
                </span>
                <span className="font-black tabular-nums">{l.dagenInJaar} {l.dagenInJaar === 1 ? 'dag' : 'dagen'}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </PrintBlad>
  );
}
