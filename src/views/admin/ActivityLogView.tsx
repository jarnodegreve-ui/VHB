import { useMemo, useState } from 'react';
import { Activity, Calendar, Download, Search, Users } from 'lucide-react';
import type { ActivityLogEntry } from '../../types';
import { cn } from '../../lib/ui';
import { AdminSubsectionHeader, EmptyState } from '../../components/ui';
import { StatCard } from '../../components/StatCard';

export function ActivityLogView({ entries }: { entries: ActivityLogEntry[] }) {
  const categoryLabels: Record<ActivityLogEntry['category'], string> = {
    users: 'Gebruikers',
    planning: 'Planning',
    planning_codes: 'Planningscodes',
    services: 'Diensten',
    diversions: 'Omleidingen',
    updates: 'Updates',
    auth: 'Authenticatie',
  };
  const [activeCategory, setActiveCategory] = useState<'all' | ActivityLogEntry['category']>('all');
  const [dateWindow, setDateWindow] = useState<'all' | 'today' | '7d' | '30d'>('7d');
  const [searchTerm, setSearchTerm] = useState('');

  const filteredEntries = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const now = Date.now();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    return entries.filter((entry) => {
      const categoryMatch = activeCategory === 'all' || entry.category === activeCategory;
      if (!categoryMatch) {
        return false;
      }

      const createdAt = new Date(entry.createdAt).getTime();
      const dateMatch = dateWindow === 'all'
        ? true
        : dateWindow === 'today'
          ? createdAt >= startOfToday.getTime()
          : dateWindow === '7d'
            ? createdAt >= now - (7 * 24 * 60 * 60 * 1000)
            : createdAt >= now - (30 * 24 * 60 * 60 * 1000);
      if (!dateMatch) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const haystack = [entry.action, entry.details, entry.actorName, categoryLabels[entry.category]]
        .join(' ')
        .toLowerCase();
      return haystack.includes(normalizedSearch);
    });
  }, [activeCategory, categoryLabels, dateWindow, entries, searchTerm]);

  const exportFilteredActivity = () => {
    const escapeCsv = (value: string) => `"${value.replace(/"/g, '""')}"`;
    const rows = filteredEntries.map((entry) => [
      entry.createdAt,
      categoryLabels[entry.category],
      entry.action,
      entry.actorName,
      entry.actorRole,
      entry.details,
    ]);
    const csv = [
      ['tijdstip', 'categorie', 'actie', 'actor', 'rol', 'details'],
      ...rows,
    ]
      .map((row) => row.map((cell) => escapeCsv(String(cell ?? ''))).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateSuffix = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `vhb-activiteit-${dateWindow}-${dateSuffix}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="max-w-5xl space-y-6">
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard icon={<Activity className="text-oker-600" />} label="Acties" value={entries.length.toString()} subValue="Laatste 100 wijzigingen" />
        <StatCard icon={<Users className="text-slate-600" />} label="Gebruikersacties" value={entries.filter((entry) => entry.category === 'users').length.toString()} subValue="Accounts en rollen" />
        <StatCard icon={<Calendar className="text-emerald-600" />} label="Planning" value={entries.filter((entry) => entry.category === 'planning' || entry.category === 'planning_codes').length.toString()} subValue="Imports, sync en codes" />
      </div>

      <section className="surface-card rounded-[32px] p-6 md:p-8">
        <AdminSubsectionHeader
          eyebrow="Auditspoor"
          title="Recente activiteit"
          description="Alleen admins zien hier recente beheeracties en belangrijke wijzigingen."
          aside={<div className="rounded-full border border-white/70 bg-white/55 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">{filteredEntries.length} items</div>}
        />

        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
          <div className="space-y-4">
            <label className="surface-muted flex items-center gap-3 rounded-[24px] px-4 py-3">
              <Search size={18} className="text-slate-400" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Zoek op actie, details of actor..."
                className="w-full bg-transparent text-sm font-semibold text-slate-700 outline-none placeholder:text-slate-400"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setDateWindow('today')}
                className={cn(
                  'rounded-full border px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] transition-colors',
                  dateWindow === 'today'
                    ? 'border-oker-200 bg-oker-50 text-oker-700'
                    : 'border-white/80 bg-white/70 text-slate-500 hover:text-slate-700',
                )}
              >
                Vandaag
              </button>
              <button
                onClick={() => setDateWindow('7d')}
                className={cn(
                  'rounded-full border px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] transition-colors',
                  dateWindow === '7d'
                    ? 'border-oker-200 bg-oker-50 text-oker-700'
                    : 'border-white/80 bg-white/70 text-slate-500 hover:text-slate-700',
                )}
              >
                7 dagen
              </button>
              <button
                onClick={() => setDateWindow('30d')}
                className={cn(
                  'rounded-full border px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] transition-colors',
                  dateWindow === '30d'
                    ? 'border-oker-200 bg-oker-50 text-oker-700'
                    : 'border-white/80 bg-white/70 text-slate-500 hover:text-slate-700',
                )}
              >
                30 dagen
              </button>
              <button
                onClick={() => setDateWindow('all')}
                className={cn(
                  'rounded-full border px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] transition-colors',
                  dateWindow === 'all'
                    ? 'border-oker-200 bg-oker-50 text-oker-700'
                    : 'border-white/80 bg-white/70 text-slate-500 hover:text-slate-700',
                )}
              >
                Alles
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 lg:max-w-[32rem] lg:justify-end">
            <button
              onClick={() => setActiveCategory('all')}
              className={cn(
                'rounded-full border px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] transition-colors',
                activeCategory === 'all'
                  ? 'border-oker-200 bg-oker-50 text-oker-700'
                  : 'border-white/80 bg-white/70 text-slate-500 hover:text-slate-700',
              )}
            >
              Alles
            </button>
            {(Object.keys(categoryLabels) as ActivityLogEntry['category'][]).map((category) => (
              <button
                key={category}
                onClick={() => setActiveCategory(category)}
                className={cn(
                  'rounded-full border px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] transition-colors',
                  activeCategory === category
                    ? 'border-oker-200 bg-oker-50 text-oker-700'
                    : 'border-white/80 bg-white/70 text-slate-500 hover:text-slate-700',
                )}
              >
                {categoryLabels[category]}
              </button>
            ))}
            <button
              onClick={exportFilteredActivity}
              disabled={filteredEntries.length === 0}
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-3 py-2 text-[10px] font-black uppercase tracking-[0.16em] transition-colors',
                filteredEntries.length === 0
                  ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-300'
                  : 'border-white/80 bg-white/80 text-slate-600 hover:text-slate-900',
              )}
            >
              <Download size={14} />
              Exporteer CSV
            </button>
          </div>
        </div>

        <div className="mt-6 space-y-3">
          {filteredEntries.length > 0 ? filteredEntries.map((entry) => (
            <div key={entry.id} className="rounded-[26px] border border-white/70 bg-white/50 p-5">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-white/80 bg-white/80 px-3 py-1 text-[10px] font-black uppercase tracking-[0.16em] text-slate-500">
                      {categoryLabels[entry.category]}
                    </span>
                    <p className="text-sm font-black text-slate-900">{entry.action}</p>
                  </div>
                  <p className="mt-2 text-sm font-medium leading-6 text-slate-500">{entry.details}</p>
                </div>
                <div className="shrink-0 text-left md:text-right">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{entry.actorRole}</p>
                  <p className="mt-1 text-sm font-bold text-slate-800">{entry.actorName}</p>
                  <p className="mt-1 text-xs font-medium text-slate-400">
                    {new Date(entry.createdAt).toLocaleString('nl-BE', {
                      day: '2-digit',
                      month: '2-digit',
                      year: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </p>
                </div>
              </div>
            </div>
          )) : (
            <EmptyState
              icon={<Activity size={28} />}
              title={entries.length > 0 ? 'Geen resultaten voor deze filter' : 'Nog geen activiteit gelogd'}
              message={entries.length > 0 ? 'Pas je categorie of zoekterm aan om andere activiteiten te tonen.' : 'Zodra admins beheeracties uitvoeren, verschijnen ze hier automatisch.'}
            />
          )}
        </div>
      </section>
    </div>
  );
}


