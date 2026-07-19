import { Fragment, useMemo, useState, type ComponentProps, type ReactNode } from 'react';
import { Activity, Calendar, Download, Search, Users } from 'lucide-react';
import type { ActivityLogEntry } from '../../types';
import { cn, downloadBlob } from '../../lib/ui';
import { isoDate } from '../../lib/availability';
import { AdminSubsectionHeader, EmptyState, PageShell } from '../../components/ui';
import { StatCard } from '../../components/StatCard';
import { Badge, Button, MicroLabel, TableShell, Td, Th } from '../../components/primitives';

const CATEGORY_TONES: Record<ActivityLogEntry['category'], ComponentProps<typeof Badge>['tone']> = {
  users: 'oker',
  planning: 'blue',
  planning_codes: 'blue',
  services: 'emerald',
  diversions: 'amber',
  updates: 'slate',
  auth: 'slate',
  leave: 'amber',
  swaps: 'blue',
  system: 'red',
};

function FilterPill({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'ios-pressable rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors',
        active
          ? 'border-oker-200 bg-oker-50 text-oker-700'
          : 'border-slate-200 bg-white/70 text-slate-500 hover:bg-slate-50 hover:text-slate-700',
      )}
    >
      {children}
    </button>
  );
}

export function ActivityLogView({ entries, logins = [] }: { entries: ActivityLogEntry[]; logins?: ActivityLogEntry[] }) {
  // Aanwezigheid: per dag het aantal unieke aangemelde gebruikers (distinct
  // op user-id/naam), nieuwste dag eerst.
  const dailyActive = useMemo(() => {
    const byDay = new Map<string, Set<string>>();
    for (const e of logins) {
      const day = isoDate(new Date(e.createdAt)); // yyyy-mm-dd, lokaal
      const key = String(e.entityId || e.actorName);
      const set = byDay.get(day) ?? new Set<string>();
      set.add(key);
      byDay.set(day, set);
    }
    return [...byDay.entries()]
      .map(([day, set]) => ({ day, count: set.size }))
      .sort((a, b) => b.day.localeCompare(a.day));
  }, [logins]);
  const maxDaily = Math.max(1, ...dailyActive.map((d) => d.count));
  const recentLogins = useMemo(
    () => [...logins].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30),
    [logins],
  );
  const categoryLabels: Record<ActivityLogEntry['category'], string> = {
    users: 'Gebruikers',
    planning: 'Planning',
    planning_codes: 'Planningscodes',
    services: 'Diensten',
    diversions: 'Omleidingen',
    updates: 'Updates',
    auth: 'Authenticatie',
    leave: 'Verlof',
    swaps: 'Dienstruilen',
    system: 'Systeem',
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
    const dateSuffix = new Date().toISOString().slice(0, 10);
    void downloadBlob(`vhb-activiteit-${dateWindow}-${dateSuffix}.csv`, blob);
  };

  return (
    <PageShell width="5xl">
      <div className="grid gap-4 md:grid-cols-3">
        <StatCard icon={<Activity className="text-oker-600" />} label="Acties" value={entries.length.toString()} subValue="Laatste 100 wijzigingen" />
        <StatCard icon={<Users className="text-slate-600" />} label="Gebruikersacties" value={entries.filter((entry) => entry.category === 'users').length.toString()} subValue="Accounts en rollen" />
        <StatCard icon={<Calendar className="text-emerald-600" />} label="Planning" value={entries.filter((entry) => entry.category === 'planning' || entry.category === 'planning_codes').length.toString()} subValue="Imports, sync en codes" />
      </div>

      <section className="surface-card rounded-3xl p-6 md:p-8">
        <AdminSubsectionHeader
          eyebrow="Aanwezigheid"
          title="Aanmeldingen op het portaal"
          description="Wie kwam wanneer op het portaal, en hoeveel unieke gebruikers waren er per dag actief (laatste 30 dagen)."
        />
        {logins.length === 0 ? (
          <div className="mt-6">
            <EmptyState icon={<Users size={28} />} title="Nog geen aanmeldingen geregistreerd" message="Zodra gebruikers inloggen verschijnt hier per dag wie er actief was." />
          </div>
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <div>
              <MicroLabel className="mb-3">Actieve gebruikers per dag</MicroLabel>
              <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
                {dailyActive.map((d) => (
                  <div key={d.day} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-xs font-medium text-slate-500 tabular-nums">
                      {new Date(`${d.day}T00:00:00`).toLocaleDateString('nl-BE', { weekday: 'short', day: '2-digit', month: 'short' })}
                    </span>
                    <div className="flex-1 h-5 rounded-md bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-md bg-oker-400" style={{ width: `${Math.round((d.count / maxDaily) * 100)}%` }} />
                    </div>
                    <span className="w-6 shrink-0 text-right text-xs font-bold text-slate-700 tabular-nums">{d.count}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <MicroLabel className="mb-3">Recente aanmeldingen</MicroLabel>
              <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
                {recentLogins.map((e) => (
                  <div key={e.id} className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 hover:bg-slate-50">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{e.actorName}</span>
                    <span className="shrink-0 text-[11px] font-medium text-slate-400 tabular-nums">
                      {new Date(e.createdAt).toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </section>

      <section className="surface-card rounded-3xl p-6 md:p-8">
        <AdminSubsectionHeader
          eyebrow="Auditspoor"
          title="Recente activiteit"
          description="Alleen admins zien hier recente beheeracties en belangrijke wijzigingen."
          aside={<Badge tone="slate">{filteredEntries.length} items</Badge>}
        />

        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
          <div className="space-y-4">
            <label className="surface-muted flex items-center gap-3 rounded-2xl px-4 py-3">
              <Search size={18} className="text-slate-400" />
              <input
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Zoek op actie, details of actor..."
                className="w-full bg-transparent text-base md:text-sm font-medium text-slate-700 outline-none placeholder:text-slate-400"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <FilterPill active={dateWindow === 'today'} onClick={() => setDateWindow('today')}>Vandaag</FilterPill>
              <FilterPill active={dateWindow === '7d'} onClick={() => setDateWindow('7d')}>7 dagen</FilterPill>
              <FilterPill active={dateWindow === '30d'} onClick={() => setDateWindow('30d')}>30 dagen</FilterPill>
              <FilterPill active={dateWindow === 'all'} onClick={() => setDateWindow('all')}>Alles</FilterPill>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 lg:max-w-[32rem] lg:justify-end">
            <FilterPill active={activeCategory === 'all'} onClick={() => setActiveCategory('all')}>Alles</FilterPill>
            {(Object.keys(categoryLabels) as ActivityLogEntry['category'][]).map((category) => (
              <Fragment key={category}>
                <FilterPill active={activeCategory === category} onClick={() => setActiveCategory(category)}>
                  {categoryLabels[category]}
                </FilterPill>
              </Fragment>
            ))}
            <Button
              variant="secondary"
              size="sm"
              icon={<Download size={14} />}
              onClick={exportFilteredActivity}
              disabled={filteredEntries.length === 0}
            >
              Exporteer CSV
            </Button>
          </div>
        </div>

        <div className="mt-6">
          {filteredEntries.length > 0 ? (
            <TableShell>
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/60 border-b border-slate-100">
                    <Th>Tijdstip</Th>
                    <Th>Categorie</Th>
                    <Th>Actie</Th>
                    <Th className="text-right">Actor</Th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEntries.map((entry) => (
                    <tr key={entry.id} className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50/40 transition-colors">
                      <Td className="whitespace-nowrap align-top text-slate-500 tabular-nums">
                        {new Date(entry.createdAt).toLocaleString('nl-BE', {
                          day: '2-digit',
                          month: '2-digit',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </Td>
                      <Td className="align-top">
                        <Badge tone={CATEGORY_TONES[entry.category]}>{categoryLabels[entry.category]}</Badge>
                      </Td>
                      <Td className="align-top">
                        <p className="font-semibold text-slate-800">{entry.action}</p>
                        <p className="mt-0.5 text-xs font-normal leading-5 text-slate-500">{entry.details}</p>
                      </Td>
                      <Td className="align-top text-right">
                        <p className="font-semibold text-slate-800">{entry.actorName}</p>
                        <MicroLabel className="mt-0.5">{entry.actorRole}</MicroLabel>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableShell>
          ) : (
            <EmptyState
              icon={<Activity size={28} />}
              title={entries.length > 0 ? 'Geen resultaten voor deze filter' : 'Nog geen activiteit gelogd'}
              message={entries.length > 0 ? 'Pas je categorie of zoekterm aan om andere activiteiten te tonen.' : 'Zodra admins beheeracties uitvoeren, verschijnen ze hier automatisch.'}
            />
          )}
        </div>
      </section>
    </PageShell>
  );
}
