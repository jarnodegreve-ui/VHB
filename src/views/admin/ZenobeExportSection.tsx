import React, { useMemo, useState } from 'react';
import { AlertTriangle, Download, Zap } from 'lucide-react';
import { cn, getSupabaseAuthHeaders, notify } from '../../lib/ui';
import { AdminSubsectionHeader } from '../../components/ui';

interface ZenobeRow {
  date: string;
  beginTime: string;
  endTime: string;
  runningBoard: string;
  depot: string;
  vehicle: string;
  driver: string;
  routeId: string;
  rowKey: string;
  sourceDate: string;
  dagtype: number | null;
  dienst: number;
  driverName: string;
  loopnummer: number;
  volgorde: number;
  busnummer: number | null;
  status: 'ok' | 'warning';
  issues: string[];
}

interface ZenobeExport {
  range: { from: string; to: string };
  header: string[];
  rows: ZenobeRow[];
  vehicles: Record<string, { mixId: string; bustype: string }>;
  stats: {
    matrixDays: number;
    assignmentsTotal: number;
    absencesSkipped: number;
    rowsGenerated: number;
    rowsWithWarning: number;
  };
  warnings: string[];
}

const firstOfMonth = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Hertelt de bus-gerelateerde issues + de Vehicle-cel na een handmatige override.
function applyBusOverride(row: ZenobeRow, busInput: string, vehicles: ZenobeExport['vehicles']): ZenobeRow {
  const trimmed = busInput.trim();
  const busnummer = trimmed === '' ? null : Number(trimmed);
  const veh = busnummer != null && !Number.isNaN(busnummer) ? vehicles[String(busnummer)] : undefined;

  // Behoud niet-bus-issues (chauffeur/loop), vervang de bus-issues.
  const issues = row.issues.filter((i) => !i.startsWith('geen standaardbus') && !i.startsWith('bus '));
  if (busnummer == null || Number.isNaN(busnummer)) issues.push('geen standaardbus');
  else if (!veh) issues.push(`bus ${busnummer} heeft geen MIX-id (niet-Zenobe?)`);

  return {
    ...row,
    busnummer: busnummer != null && !Number.isNaN(busnummer) ? busnummer : null,
    vehicle: veh?.mixId ?? '',
    issues,
    status: issues.length ? 'warning' : 'ok',
  };
}

export function ZenobeExportSection() {
  const [from, setFrom] = useState(firstOfMonth);
  const [to, setTo] = useState(today);
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [data, setData] = useState<ZenobeExport | null>(null);
  const [rows, setRows] = useState<ZenobeRow[]>([]);
  const [onlyWarnings, setOnlyWarnings] = useState(false);

  const visibleRows = useMemo(
    () => (onlyWarnings ? rows.filter((r) => r.status === 'warning') : rows),
    [rows, onlyWarnings],
  );
  const warningCount = useMemo(() => rows.filter((r) => r.status === 'warning').length, [rows]);

  const generate = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/zenobe-export?from=${from}&to=${to}`, {
        headers: await getSupabaseAuthHeaders(),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.details || payload.error || 'Genereren mislukt.');
      setData(payload);
      setRows(payload.rows);
      if (payload.rows.length === 0) {
        notify('Geen rijen voor dit bereik. Is de planning-matrix voor deze periode geïmporteerd?', 'info');
      }
    } catch (error: any) {
      notify(`Zenobe-export mislukt: ${error.message}`, 'error');
    } finally {
      setLoading(false);
    }
  };

  const onBusChange = (rowKey: string, value: string) => {
    if (!data) return;
    setRows((prev) => prev.map((r) => (r.rowKey === rowKey ? applyBusOverride(r, value, data.vehicles) : r)));
  };

  const download = async () => {
    setDownloading(true);
    try {
      const payload = rows.map((r) => ({
        date: r.date, beginTime: r.beginTime, endTime: r.endTime, runningBoard: r.runningBoard,
        depot: r.depot, vehicle: r.vehicle, driver: r.driver, routeId: r.routeId,
      }));
      const filename = `zenobe-upload_${from}_${to}.csv`;
      const response = await fetch('/api/zenobe-export/csv', {
        method: 'POST',
        headers: await getSupabaseAuthHeaders(),
        body: JSON.stringify({ rows: payload, filename }),
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.details || err.error || 'Download mislukt.');
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (error: any) {
      notify(`Download mislukt: ${error.message}`, 'error');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="surface-card p-8 rounded-[24px]">
      <AdminSubsectionHeader
        eyebrow="Export"
        title="Zenobe-upload"
        description="Genereert het upload-CSV voor het Zenobe-portaal uit de planning-matrix. Controleer de afwijkende bussen en download."
      />

      <div className="mt-6 grid gap-4 md:grid-cols-[1fr_1fr_auto] items-end">
        <div className="space-y-2">
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Van</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
            className="control-input w-full px-4 py-3 rounded-2xl font-bold text-sm outline-none" />
        </div>
        <div className="space-y-2">
          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 ml-1">Tot en met</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
            className="control-input w-full px-4 py-3 rounded-2xl font-bold text-sm outline-none" />
        </div>
        <button type="button" onClick={generate} disabled={loading || !from || !to}
          className="btn-primary ios-pressable px-6 py-3 text-xs uppercase tracking-widest disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center gap-2">
          <Zap className="h-4 w-4" />
          {loading ? 'Genereren…' : 'Genereer preview'}
        </button>
      </div>

      {data && (
        <div className="mt-6">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs font-bold text-slate-600">
            <span><span className="tabular-nums text-slate-900">{data.stats.rowsGenerated}</span> regels</span>
            <span><span className="tabular-nums text-slate-900">{data.stats.matrixDays}</span> dagen</span>
            <span className="text-slate-400"><span className="tabular-nums">{data.stats.absencesSkipped}</span> afwezigheden overgeslagen</span>
            {warningCount > 0
              ? <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle className="h-3.5 w-3.5" /><span className="tabular-nums">{warningCount}</span> met waarschuwing</span>
              : <span className="text-emerald-600">Alle regels compleet</span>}
          </div>

          {data.warnings.length > 0 && (
            <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/70 p-4 text-xs font-medium text-amber-900">
              {data.warnings.map((w, i) => <p key={i} className="flex gap-2"><AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />{w}</p>)}
            </div>
          )}

          {rows.length > 0 && (
            <>
              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={onlyWarnings} onChange={(e) => setOnlyWarnings(e.target.checked)} className="accent-amber-500" />
                  Toon alleen waarschuwingen
                </label>
                <button type="button" onClick={download} disabled={downloading}
                  className="btn-primary ios-pressable px-6 py-3 text-xs uppercase tracking-widest disabled:opacity-40 inline-flex items-center gap-2">
                  <Download className="h-4 w-4" />
                  {downloading ? 'Bezig…' : 'Download CSV'}
                </button>
              </div>

              <div className="mt-4 max-h-[28rem] overflow-auto rounded-2xl border border-white/60">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-white/90 backdrop-blur-sm">
                    <tr className="text-left text-[10px] font-black uppercase tracking-widest text-slate-400">
                      <th className="py-2 px-3">Datum</th>
                      <th className="py-2 px-2">Chauffeur</th>
                      <th className="py-2 px-2 text-right">Dienst</th>
                      <th className="py-2 px-2 text-right">Loop</th>
                      <th className="py-2 px-2">Begin</th>
                      <th className="py-2 px-2">Einde</th>
                      <th className="py-2 px-2">Route</th>
                      <th className="py-2 px-2 text-right">Bus</th>
                      <th className="py-2 px-3">Voertuig (MIX)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((r) => (
                      <tr key={r.rowKey} className={cn('border-t border-white/60', r.status === 'warning' ? 'bg-amber-50/50 text-amber-900' : 'text-slate-700')}
                        title={r.issues.join(' · ')}>
                        <td className="py-1.5 px-3 tabular-nums whitespace-nowrap">{r.date}</td>
                        <td className="py-1.5 px-2 font-bold whitespace-nowrap">
                          {r.driver ? r.driverName : <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle className="h-3 w-3" />{r.driverName}</span>}
                        </td>
                        <td className="py-1.5 px-2 text-right tabular-nums text-slate-500">{r.dienst}</td>
                        <td className="py-1.5 px-2 text-right tabular-nums">{r.loopnummer}</td>
                        <td className="py-1.5 px-2 tabular-nums">{r.beginTime || '—'}</td>
                        <td className="py-1.5 px-2 tabular-nums">{r.endTime || '—'}</td>
                        <td className="py-1.5 px-2">{r.routeId || '—'}</td>
                        <td className="py-1.5 px-2 text-right">
                          <input
                            value={r.busnummer ?? ''}
                            onChange={(e) => onBusChange(r.rowKey, e.target.value)}
                            inputMode="numeric"
                            className={cn(
                              'w-20 rounded-lg border px-2 py-1 text-right text-xs font-bold tabular-nums outline-none',
                              r.vehicle ? 'border-white/70 bg-white/70' : 'border-amber-300 bg-amber-50',
                            )}
                          />
                        </td>
                        <td className="py-1.5 px-3 font-mono text-[11px] text-slate-500">
                          {r.vehicle || <span className="text-amber-700">geen MIX-id</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-3 text-[11px] font-medium text-slate-400">
                De buskolom is aanpasbaar — corrigeer hier de last-minute wissels of rotatie. Gemarkeerde regels missen een chauffeur, tijden of een geldige Zenobe-bus.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
