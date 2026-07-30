import { useEffect, useMemo } from 'react';
import type { LeaveRequest, User } from '../types';
import { daysBetween, verlofBalans } from '../lib/leaveBalance';
import { formatLeaveType, MONTH_NAMES } from '../lib/format';

/**
 * Print-vriendelijk verlof-jaaroverzicht voor één chauffeur: saldo,
 * alle opgenomen periodes chronologisch mét saldoverloop, en wat nog
 * op een beslissing wacht. Voor eindejaarsgesprekken en saldo-discussies —
 * één blad met de hele feitenbasis. Zelfde opzet als het print-maandrooster:
 * nieuw tabblad via query-params, automatische window.print().
 */

const clipToYear = (iso: string, year: number, fallback: 'start' | 'end') => {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;
  if (!iso) return fallback === 'start' ? yearStart : yearEnd;
  if (iso < yearStart) return yearStart;
  if (iso > yearEnd) return yearEnd;
  return iso;
};

/** "ma 3 feb" zonder jaar — het jaar staat al groot in de kop. */
const dagLabel = (iso: string) => {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' });
};

export function PrintLeaveYearView({
  driver,
  year,
  leaves,
}: {
  driver: User | null;
  year: number;
  leaves: LeaveRequest[];
}) {
  useEffect(() => {
    const t = window.setTimeout(() => window.print(), 400);
    return () => window.clearTimeout(t);
  }, []);

  const balans = useMemo(
    () => verlofBalans(leaves, driver?.id ?? '', year, driver?.verlofBudget),
    [leaves, driver, year],
  );

  const { approved, pending, ziekteDagen } = useMemo(() => {
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;
    const inYear = leaves
      .filter((l) => driver && l.userId === driver.id && l.startDate <= yearEnd && l.endDate >= yearStart)
      .map((l) => ({
        ...l,
        dagenInJaar: daysBetween(clipToYear(l.startDate, year, 'start'), clipToYear(l.endDate, year, 'end')),
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
      <div className="min-h-screen flex items-center justify-center bg-white text-slate-700 font-bold p-8">
        Chauffeur niet gevonden. Sluit dit tabblad.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white text-slate-900 print:bg-white">
      <style>{`
        @media print {
          @page { size: A4; margin: 14mm 14mm 18mm; }
          body { background: white; }
          .no-print { display: none !important; }
          .print-card { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>

      <div className="max-w-3xl mx-auto p-8 md:p-10">
        <div className="no-print flex justify-end mb-4">
          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-[0.08em] hover:bg-slate-800 transition-colors"
          >
            Print / Opslaan als PDF
          </button>
        </div>

        {/* Header */}
        <header className="border-b-2 border-slate-900 pb-5 mb-7">
          <p className="text-[10px] font-black uppercase tracking-[0.08em] text-oker-600">
            VHB · Maldegem · Verlof-jaaroverzicht
          </p>
          <div className="mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
            <div>
              <h1 className="text-3xl font-black tracking-tight">{driver.name}</h1>
              <p className="mt-1 text-lg font-bold text-slate-600">{year}</p>
              {driver.employeeId && (
                <p className="mt-1.5 text-xs font-medium text-slate-400">
                  Personeelsnummer: {driver.employeeId}
                </p>
              )}
            </div>
            <div className="flex items-stretch divide-x divide-slate-200">
              <div className="pr-5">
                <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400">Budget</p>
                <p className="mt-1 text-xl font-black text-slate-900 tabular-nums leading-none">{balans.betaaldBudget}</p>
              </div>
              <div className="px-5">
                <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-slate-400">Opgenomen</p>
                <p className="mt-1 text-xl font-black text-slate-900 tabular-nums leading-none">{balans.betaaldGebruikt}</p>
              </div>
              <div className="px-5">
                <p className="text-[9px] font-bold uppercase tracking-[0.08em] text-oker-600">Resterend</p>
                <p className="mt-1 text-xl font-black text-oker-600 tabular-nums leading-none">{balans.betaaldResterend}</p>
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
                <tr key={l.id} className="print-card border-b border-slate-100">
                  <td className="py-2.5 pr-3 font-bold text-slate-900">
                    {l.startDate === l.endDate
                      ? dagLabel(l.startDate)
                      : `${dagLabel(l.startDate)} – ${dagLabel(l.endDate)}`}
                    {(l.startDate < `${year}-01-01` || l.endDate > `${year}-12-31`) && (
                      <span className="ml-1.5 text-[10px] font-semibold text-slate-400">(deel in {year})</span>
                    )}
                  </td>
                  <td className="py-2.5 pr-3">
                    <span
                      className={`inline-block rounded border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-[0.08em] ${
                        l.type === 'betaald_verlof'
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : l.type === 'ziekte'
                            ? 'border-rose-200 bg-rose-50 text-rose-700'
                            : 'border-blue-200 bg-blue-50 text-blue-700'
                      }`}
                    >
                      {formatLeaveType(l.type)}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 text-right font-black tabular-nums">{l.dagenInJaar}</td>
                  <td className="py-2.5 text-right font-bold tabular-nums text-slate-600">
                    {l.saldoNa === null ? '—' : `${l.saldoNa} van ${balans.betaaldBudget}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {pending.length > 0 && (
          <section className="print-card mt-8">
            <h2 className="text-[10px] font-black uppercase tracking-[0.16em] text-amber-600 border-b border-amber-200 pb-1.5 mb-2">
              Nog niet beslist (telt niet mee in het saldo)
            </h2>
            <ul className="space-y-1 text-sm">
              {pending.map((l) => (
                <li key={l.id} className="flex items-baseline justify-between gap-3">
                  <span className="font-bold text-slate-700">
                    {l.startDate === l.endDate ? dagLabel(l.startDate) : `${dagLabel(l.startDate)} – ${dagLabel(l.endDate)}`}
                    <span className="ml-2 font-medium text-slate-400">{formatLeaveType(l.type)}</span>
                  </span>
                  <span className="font-black tabular-nums">{l.dagenInJaar} {l.dagenInJaar === 1 ? 'dag' : 'dagen'}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Handtekening — zelfde strook als het maandrooster, voor het
            eindejaarsgesprek. */}
        <section className="print-card mt-10 pt-6 border-t border-slate-200">
          <div className="grid grid-cols-2 gap-12">
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-500 mb-8">
                Voor gezien — chauffeur
              </p>
              <div className="border-b border-slate-400 h-10" />
              <p className="mt-1 text-[10px] font-medium text-slate-400">Datum en handtekening</p>
            </div>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.08em] text-slate-500 mb-8">
                Voor gezien — planner
              </p>
              <div className="border-b border-slate-400 h-10" />
              <p className="mt-1 text-[10px] font-medium text-slate-400">Datum en handtekening</p>
            </div>
          </div>
        </section>

        <footer className="mt-10 pt-4 border-t border-slate-200 text-[10px] font-medium text-slate-400 text-center">
          Stand van {MONTH_NAMES[new Date().getMonth()]} {new Date().getFullYear()} · gegenereerd op{' '}
          {new Date().toLocaleString('nl-BE', { dateStyle: 'short', timeStyle: 'short' })} via VHB Portaal
        </footer>
      </div>
    </div>
  );
}
