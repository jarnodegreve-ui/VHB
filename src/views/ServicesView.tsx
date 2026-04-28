import { useState } from 'react';
import { ChevronDown, ChevronUp, Clock, Download, Search } from 'lucide-react';
import type { Service, View } from '../types';
import { cn } from '../lib/ui';
import { EmptyState, PageHeader, PageShell } from '../components/ui';

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

  const filteredServices = services.filter(s => 
    s.serviceNumber.toLowerCase().includes(searchQuery.toLowerCase())
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
    const headers = ['Dienstnummer', 'Start 1', 'Eind 1', 'Start 2', 'Eind 2', 'Start 3', 'Eind 3'];
    const rows = filteredServices.map(s => [
      `"${s.serviceNumber}"`, 
      `"${s.startTime}"`, 
      `"${s.endTime}"`,
      `"${s.startTime2 || ''}"`,
      `"${s.endTime2 || ''}"`,
      `"${s.startTime3 || ''}"`,
      `"${s.endTime3 || ''}"`
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(r => r.join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `dienstoverzicht_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
                  "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2",
                  sortBy === 'number' ? "glass-chip text-oker-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                )}
              >
                Dienst #
                {sortBy === 'number' && (sortOrder === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
              </button>
              <button
                onClick={() => toggleSort('time')}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all flex items-center gap-2",
                  sortBy === 'time' ? "glass-chip text-oker-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                )}
              >
                Starttijd
                {sortBy === 'time' && (sortOrder === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
              </button>
            </div>
            <button
              onClick={downloadCSV}
              className="control-button-soft flex items-center gap-2 px-4 py-3 rounded-2xl text-slate-600 font-bold text-sm transition-all active:scale-95"
              title="Download als CSV"
            >
              <Download size={18} className="text-oker-500" />
              <span className="hidden sm:inline">CSV</span>
            </button>
            <div className="relative flex-1 md:w-64 group">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Search size={18} className="text-slate-400 group-focus-within:text-oker-500 transition-colors" />
              </div>
              <input
                type="text"
                placeholder="Zoek..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="control-input w-full pl-11 pr-4 py-3 rounded-2xl focus:outline-none transition-all font-medium text-sm"
              />
            </div>
          </div>
        )}
      />

      <div className="surface-table rounded-[28px] overflow-hidden">
        {/* Desktop Table View */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50">
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Dienst</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Deel 1</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Deel 2</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-widest border-b border-slate-100">Deel 3</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredServices.map(s => (
                <tr key={s.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-8 py-5">
                    <span className="font-black text-slate-800 tracking-tight">{s.serviceNumber}</span>
                  </td>
                  <td className="px-8 py-5">
                    <div className="flex items-center gap-2 text-slate-600 font-bold text-sm">
                      <Clock size={14} className="text-oker-500" />
                      {s.startTime} - {s.endTime}
                    </div>
                  </td>
                  <td className="px-8 py-5">
                    {s.startTime2 ? (
                      <div className="flex items-center gap-2 text-slate-600 font-bold text-sm">
                        <Clock size={14} className="text-oker-500" />
                        {s.startTime2} - {s.endTime2}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-8 py-5">
                    {s.startTime3 ? (
                      <div className="flex items-center gap-2 text-slate-600 font-bold text-sm">
                        <Clock size={14} className="text-oker-500" />
                        {s.startTime3} - {s.endTime3}
                      </div>
                    ) : null}
                  </td>
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
              <div key={s.id} className="hover:bg-slate-50/50 transition-colors">
                <button
                  type="button"
                  onClick={() => toggleExpanded(s.id)}
                  aria-expanded={isExpanded}
                  className="w-full p-6 flex items-center justify-between gap-3 text-left"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="text-lg font-black text-slate-800 tracking-tight">{s.serviceNumber}</span>
                    <span className="text-xs font-medium text-slate-400 truncate">
                      {s.startTime} - {s.endTime}
                      {s.startTime3 ? ` · ${s.endTime3}` : s.startTime2 ? ` · ${s.endTime2}` : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <div className="glass-chip px-3 py-1 text-oker-600 rounded-full text-[10px] font-black uppercase tracking-widest">
                      Dienst
                    </div>
                    <ChevronDown
                      size={18}
                      className={cn('text-slate-400 transition-transform duration-200', isExpanded && 'rotate-180')}
                    />
                  </div>
                </button>
                {isExpanded && (
                  <div className="px-6 pb-6 grid grid-cols-1 gap-3">
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Deel 1</span>
                      <div className="flex items-center gap-2 text-slate-700 font-bold text-sm">
                        <Clock size={14} className="text-oker-500" />
                        {s.startTime} - {s.endTime}
                      </div>
                    </div>
                    {s.startTime2 && (
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Deel 2</span>
                        <div className="flex items-center gap-2 text-slate-700 font-bold text-sm">
                          <Clock size={14} className="text-oker-500" />
                          {s.startTime2} - {s.endTime2}
                        </div>
                      </div>
                    )}
                    {s.startTime3 && (
                      <div className="flex flex-col gap-1">
                        <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Deel 3</span>
                        <div className="flex items-center gap-2 text-slate-700 font-bold text-sm">
                          <Clock size={14} className="text-oker-500" />
                          {s.startTime3} - {s.endTime3}
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
      </div>
    </PageShell>
  );
}

