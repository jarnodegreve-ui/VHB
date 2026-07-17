import { useMemo, useState, type ReactNode } from 'react';
import { Download, Printer, Clock, CalendarDays, Users as UsersIcon } from 'lucide-react';
import type { LeaveRequest, Shift, User } from '../../types';
import { buildDriverReport, periodLabel, MONTH_LABELS, type ReportPeriod } from '../../lib/reporting';
import { EmptyState, PageHeader, PageShell } from '../../components/ui';
import { Button, MicroLabel, TableShell, Th, Td } from '../../components/primitives';
import { notify } from '../../lib/ui';

export function ReportsView({ shifts, leaveRequests, users }: { shifts: Shift[]; leaveRequests: LeaveRequest[]; users: User[] }) {
  // Standaard: lopend jaar, alle maanden. new Date() i.p.v. een vaste datum
  // zodat het rapport meebeweegt met de werkelijke tijd.
  const now = new Date();
  const [period, setPeriod] = useState<ReportPeriod>({ year: now.getFullYear(), month: null });

  const rows = useMemo(
    () => buildDriverReport(shifts, leaveRequests, users, period),
    [shifts, leaveRequests, users, period],
  );

  const totals = useMemo(() => ({
    drivers: rows.length,
    workedMinutes: rows.reduce((s, r) => s + r.workedMinutes, 0),
    shifts: rows.reduce((s, r) => s + r.shiftsCount, 0),
    betaaldGebruikt: rows.reduce((s, r) => s + r.betaaldGebruikt, 0),
  }), [rows]);

  const years = useMemo(() => {
    const set = new Set<number>([now.getFullYear()]);
    for (const s of shifts) { const y = Number(s.date?.slice(0, 4)); if (y) set.add(y); }
    return [...set].sort((a, b) => b - a);
  }, [shifts, now]);

  const totalHoursLabel = `${Math.floor(totals.workedMinutes / 60)}u${totals.workedMinutes % 60 ? String(totals.workedMinutes % 60).padStart(2, '0') : ''}`;

  const exportExcel = async () => {
    try {
      const XLSX = await import('xlsx');
      const sheetData = rows.map((r) => ({
        Naam: r.name,
        Personeelsnummer: r.employeeId,
        Diensten: r.shiftsCount,
        'Gewerkte uren': r.workedHoursLabel,
        'Gewerkte minuten': r.workedMinutes,
        'Betaald verlof gebruikt': r.betaaldGebruikt,
        'Betaald verlof resterend': r.betaaldResterend,
        'Klein verlet': r.kleinVerlet,
      }));
      const ws = XLSX.utils.json_to_sheet(sheetData);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Rapport');
      XLSX.writeFile(wb, `vhb-rapport-${periodLabel(period).replace(/\s/g, '-')}.xlsx`);
    } catch {
      notify('Export naar Excel is mislukt.', 'error');
    }
  };

  return (
    <PageShell width="6xl">
      <PageHeader
        eyebrow="Beheer"
        title="Rapportage"
        description="Gewerkte uren, verlofsaldo's en rusttijd-signalen per chauffeur over een gekozen periode. Exporteerbaar naar Excel of afdrukbaar als PDF."
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <select
              value={period.year}
              onChange={(e) => setPeriod((p) => ({ ...p, year: Number(e.target.value) }))}
              className="control-button-soft rounded-xl px-3 py-2 text-sm font-semibold"
            >
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <select
              value={period.month ?? ''}
              onChange={(e) => setPeriod((p) => ({ ...p, month: e.target.value === '' ? null : Number(e.target.value) }))}
              className="control-button-soft rounded-xl px-3 py-2 text-sm font-semibold"
            >
              <option value="">Heel jaar</option>
              {MONTH_LABELS.map((label, i) => <option key={label} value={i + 1}>{label}</option>)}
            </select>
            <Button variant="secondary" icon={<Printer size={16} />} onClick={() => window.print()}>Afdrukken / PDF</Button>
            <Button variant="primary" icon={<Download size={16} />} onClick={exportExcel} disabled={rows.length === 0}>Excel</Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatTile icon={<UsersIcon size={16} />} label="Chauffeurs" value={String(totals.drivers)} />
        <StatTile icon={<CalendarDays size={16} />} label="Diensten" value={String(totals.shifts)} />
        <StatTile icon={<Clock size={16} />} label="Gewerkte uren" value={totalHoursLabel} />
      </div>

      <div className="surface-card rounded-3xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200/70 flex items-center justify-between">
          <MicroLabel>Periode: {periodLabel(period)}</MicroLabel>
        </div>
        {rows.length === 0 ? (
          <EmptyState title="Geen gegevens" message="Er zijn geen chauffeurs of geen planning in deze periode." />
        ) : (
          <TableShell>
            <thead>
              <tr>
                <Th>Chauffeur</Th>
                <Th className="text-right">Diensten</Th>
                <Th className="text-right">Gewerkte uren</Th>
                <Th className="text-right">Verlof gebruikt</Th>
                <Th className="text-right">Verlof resterend</Th>
                <Th className="text-right">Klein verlet</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.driverId} className="border-t border-slate-100">
                  <Td>
                    <span className="font-semibold text-slate-900">{r.name}</span>
                    {r.employeeId ? <span className="block text-[11px] font-medium text-slate-400">{r.employeeId}</span> : null}
                  </Td>
                  <Td className="text-right tabular-nums">{r.shiftsCount}</Td>
                  <Td className="text-right tabular-nums font-semibold">{r.workedHoursLabel}</Td>
                  <Td className="text-right tabular-nums">{r.betaaldGebruikt}<span className="text-slate-400">/{r.betaaldBudget}</span></Td>
                  <Td className="text-right tabular-nums">{r.betaaldResterend}</Td>
                  <Td className="text-right tabular-nums">{r.kleinVerlet}</Td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </div>
    </PageShell>
  );
}

function StatTile({ icon, label, value, tone = 'slate' }: { icon: ReactNode; label: string; value: string; tone?: 'slate' | 'red' | 'emerald' }) {
  return (
    <div className="surface-card rounded-2xl px-4 py-3.5">
      <div className="flex items-center gap-2 text-slate-400">{icon}<MicroLabel>{label}</MicroLabel></div>
      <p className={
        tone === 'red' ? 'mt-1.5 text-2xl font-black tabular-nums text-red-600'
        : tone === 'emerald' ? 'mt-1.5 text-2xl font-black tabular-nums text-emerald-600'
        : 'mt-1.5 text-2xl font-black tabular-nums text-slate-900'
      }>{value}</p>
    </div>
  );
}
