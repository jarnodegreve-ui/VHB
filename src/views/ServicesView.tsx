import { useState } from 'react';
import { ChevronDown, ChevronUp, Clock, Download, Search } from 'lucide-react';
import type { Service } from '../types';
import { cn, downloadBlob } from '../lib/ui';
import { EmptyState, PageHeader, PageShell } from '../components/ui';
import { Badge, Button, MicroLabel, TableShell, Td, Th } from '../components/primitives';

export function ServicesView({ services }: { services: Service[] }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'number' | 'time'>('number');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const hasValidTime = (start?: string, end?: string) =>
    !!start && !!end && /^\d{1,2}:\d{2}$/.test(start) && /^\d{1,2}:\d{2}$/.test(end);

  // Zoekt op dienstnummer én op loopnummer: "welke dienst bevat loop 4515?"
  // is een dagelijkse vraag sinds de loopnummers erin staan.
  const zoek = searchQuery.trim().toLowerCase();
  const filteredServices = services.filter((s) =>
    !zoek ||
    s.serviceNumber.toLowerCase().includes(zoek) ||
    [s.loopnr, s.loopnr2, s.loopnr3].some((l) => (l || '').toLowerCase().includes(zoek))
  ).sort((a, b) => {
    let comparison = 0;
    if (sortBy === 'number') {
      comparison = a.serviceNumber.localeCompare(b.serviceNumber, undefined, { numeric: true });
    } else {
      comparison = a.startTime.localeCompare(b.startTime);
    }
    return sortOrder === 'asc' ? comparison : -comparison;
  });

  const toggleSort = (field: 'number' | 'time') => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const downloadCSV = () => {
    const headers = ['Dienstnummer', 'Start 1', 'Eind 1', 'Loop 1', 'Start 2', 'Eind 2', 'Loop 2', 'Start 3', 'Eind 3', 'Loop 3'];
    const rows = filteredServices.map(s => [
      `"${s.serviceNumber}"`,
      `"${s.startTime}"`,
      `"${s.endTime}"`,
      `"${s.loopnr || ''}"`,
      `"${s.startTime2 || ''}"`,
      `"${s.endTime2 || ''}"`,
      `"${s.loopnr2 || ''}"`,
      `"${s.startTime3 || ''}"`,
      `"${s.endTime3 || ''}"`,
      `"${s.loopnr3 || ''}"`
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.join(','))
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    void downloadBlob(`dienstoverzicht_${new Date().toISOString().split('T')[0]}.csv`, blob);
  };

  return (
    <PageShell>
      <PageHeader
        title="Dienstoverzicht"
        description="Overzicht van alle diensten en bijbehorende uren."
        actions={(
          <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
            <div className="glass-segmented flex p-1 rounded-xl">
              <button
                onClick={() => toggleSort('number')}
                className={cn(
                  "px-3 py-2 min-h-10 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-2",
                  sortBy === 'number' ? "glass-chip text-oker-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                )}
              >
                Dienst #
                {sortBy === 'number' && (sortOrder === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
              </button>
              <button
                onClick={() => toggleSort('time')}
                className={cn(
                  "px-3 py-2 min-h-10 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-2",
                  sortBy === 'time' ? "glass-chip text-oker-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                )}
              >
                Starttijd
                {sortBy === 'time' && (sortOrder === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
              </button>
            </div>
            <Button
              variant="secondary"
              onClick={downloadCSV}
              title="Download als CSV"
              icon={<Download size={16} className="text-oker-500" />}
            >
              <span className="hidden sm:inline">CSV</span>
            </Button>
            <div className="relative flex-1 md:w-64 group">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Search size={18} className="text-slate-400 group-focus-within:text-oker-500 transition-colors" />
              </div>
              <input
                type="text"
                placeholder="Zoek op dienst- of loopnummer..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="control-input w-full pl-11 pr-4 py-3 rounded-2xl focus:outline-none transition-all font-medium text-sm"
              />
            </div>
          </div>
        )}
      />

      <TableShell>
        {/* Desktop Table View */}
        <div className="hidden md:block">
          <table className="w-full text-left">
            <thead className="bg-surface-soft border-b border-slate-100">
              {/* Zelfde indeling als het totaaloverzicht van de planning:
                  per deel eerst het loopnummer, dan de uren. */}
              <tr>
                <Th>Dienst</Th>
                <Th>Loop 1</Th>
                <Th>Deel 1</Th>
                <Th>Loop 2</Th>
                <Th>Deel 2</Th>
                <Th>Loop 3</Th>
                <Th>Deel 3</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredServices.map(s => (
                <tr key={s.id} className="hover:bg-slate-50/60 transition-colors">
                  <Td>
                    <span className="font-semibold text-slate-800">{s.serviceNumber}</span>
                  </Td>
                  <Td><LoopCell loopnr={s.loopnr} /></Td>
                  <Td><TimeCell start={s.startTime} end={s.endTime} /></Td>
                  <Td><LoopCell loopnr={hasValidTime(s.startTime2, s.endTime2) ? s.loopnr2 : undefined} /></Td>
                  <Td>{hasValidTime(s.startTime2, s.endTime2) ? <TimeCell start={s.startTime2!} end={s.endTime2!} /> : null}</Td>
                  <Td><LoopCell loopnr={hasValidTime(s.startTime3, s.endTime3) ? s.loopnr3 : undefined} /></Td>
                  <Td>{hasValidTime(s.startTime3, s.endTime3) ? <TimeCell start={s.startTime3!} end={s.endTime3!} /> : null}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile Card View — uitklapbaar */}
        <div className="md:hidden divide-y divide-slate-50">
          {filteredServices.map((s) => {
            const isExpanded = expandedIds.has(s.id);
            return (
              <div key={s.id} className="hover:bg-slate-50/60 transition-colors">
                <button
                  type="button"
                  onClick={() => toggleExpanded(s.id)}
                  aria-expanded={isExpanded}
                  className="w-full p-5 flex items-center justify-between gap-3 text-left"
                >
                  <span className="text-lg font-semibold text-slate-800 tracking-tight">{s.serviceNumber}</span>
                  <div className="flex items-center gap-3 shrink-0">
                    <Badge tone="oker">Dienst</Badge>
                    <ChevronDown
                      size={18}
                      className={cn('text-slate-400 transition-transform duration-200', isExpanded && 'rotate-180')}
                    />
                  </div>
                </button>
                {isExpanded && (
                  <div className="px-5 pb-5 grid grid-cols-1 gap-3">
                    <div className="flex flex-col gap-1">
                      <MicroLabel>Deel 1</MicroLabel>
                      <div className="flex items-center gap-2 text-slate-700 font-medium text-sm tabular-nums">
                        <Clock size={14} className="text-oker-500" />
                        {s.startTime} - {s.endTime}
                        <LoopChip loopnr={s.loopnr} />
                      </div>
                    </div>
                    {hasValidTime(s.startTime2, s.endTime2) && (
                      <div className="flex flex-col gap-1">
                        <MicroLabel>Deel 2</MicroLabel>
                        <div className="flex items-center gap-2 text-slate-700 font-medium text-sm tabular-nums">
                          <Clock size={14} className="text-oker-500" />
                          {s.startTime2} - {s.endTime2}
                          <LoopChip loopnr={s.loopnr2} />
                        </div>
                      </div>
                    )}
                    {hasValidTime(s.startTime3, s.endTime3) && (
                      <div className="flex flex-col gap-1">
                        <MicroLabel>Deel 3</MicroLabel>
                        <div className="flex items-center gap-2 text-slate-700 font-medium text-sm tabular-nums">
                          <Clock size={14} className="text-oker-500" />
                          {s.startTime3} - {s.endTime3}
                          <LoopChip loopnr={s.loopnr3} />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {filteredServices.length === 0 && (
          <div className="px-6 py-6">
            <EmptyState
              icon={<Clock size={28} />}
              title="Geen diensten gevonden"
              message={searchQuery ? `Geen diensten gevonden voor "${searchQuery}".` : 'Er zijn nog geen diensten beschikbaar.'}
            />
          </div>
        )}
      </TableShell>
    </PageShell>
  );
}

/** Loopnummer van een dienstdeel — het deel van de dienst waaronder bepaalde
 *  ritten vallen. Toont niets zolang er geen nummer ingevuld is. */
function LoopChip({ loopnr }: { loopnr?: string }) {
  if (!loopnr?.trim()) return null;
  return (
    <span className="shrink-0 rounded-md bg-surface-muted px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-slate-600">
      loop {loopnr.trim()}
    </span>
  );
}

/** Loopnummer als eigen tabelkolom (zoals in het totaaloverzicht). */
function LoopCell({ loopnr }: { loopnr?: string }) {
  const value = loopnr?.trim();
  if (!value) return <span className="text-slate-300">—</span>;
  return <span className="font-semibold tabular-nums text-slate-700">{value}</span>;
}

/** Uren van één dienstdeel. */
function TimeCell({ start, end }: { start: string; end: string }) {
  return (
    <span className="inline-flex items-center gap-2 font-medium tabular-nums text-slate-700">
      <Clock size={14} className="text-oker-500" />
      {start} - {end}
    </span>
  );
}
