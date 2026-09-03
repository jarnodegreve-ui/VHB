import { Fragment, useEffect, useMemo, useState, type ComponentProps } from 'react';
import { Activity, Download, Search, Users } from 'lucide-react';
import type { ActivityLogEntry } from '../../types';
import { downloadBlob } from '../../lib/ui';
import { csvTekst } from '../../lib/csv';
import { Modal } from '../../components/Modal';
import { isoDate } from '../../lib/availability';
import { formatDayLong } from '../../lib/format';
import { EmptyState, ModalHeader, PageShell } from '../../components/ui';
import { apiFetch } from '../../lib/api';
import { Badge, Button, FilterChip, MicroLabel, TableShell, Td, Th } from '../../components/primitives';
import { Card, CardHeader } from '../../components/Card';
import { Input } from '../../components/Field';

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

export function ActivityLogView({ entries, logins = [] }: { entries: ActivityLogEntry[]; logins?: ActivityLogEntry[] }) {
  // Aanwezigheid: per dag het aantal unieke actieve gebruikers (distinct op
  // user-id/naam), nieuwste dag eerst. `logins` bevat zowel echte
  // aanmeldingen ('Aangemeld') als het dagelijkse sessie-herstel-event
  // ('Actief') — beide tellen als "actief die dag".
  const dailyActive = useMemo(() => {
    // Per dag dedupliceren op gebruiker (entityId), maar de náám bewaren:
    // de balk is aanklikbaar en toont dan wie er die dag actief was.
    const byDay = new Map<string, Map<string, string>>();
    for (const e of logins) {
      const day = isoDate(new Date(e.createdAt)); // yyyy-mm-dd, lokaal
      const key = String(e.entityId || e.actorName);
      const users = byDay.get(day) ?? new Map<string, string>();
      if (!users.has(key)) users.set(key, e.actorName);
      byDay.set(day, users);
    }
    return [...byDay.entries()]
      .map(([day, users]) => ({ day, count: users.size, names: [...users.values()].sort((a, b) => a.localeCompare(b, 'nl')) }))
      .sort((a, b) => b.day.localeCompare(a.day));
  }, [logins]);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [showDailyModal, setShowDailyModal] = useState(false);

  /** Eén dagregel — gedeeld tussen de compacte inline lijst en de
   *  alle-dagen-popup. Klik opent de namen-popup van die dag: inline chips
   *  werden met tientallen actieve gebruikers een muur onder de balk. */
  const renderDayRow = (d: { day: string; count: number; names: string[] }) => (
    // rauw: hele dagrij (datum + staaf + teller) is de knop; eigen layout, geen knop-uiterlijk
    <button
      key={d.day}
      type="button"
      onClick={() => setOpenDay(d.day)}
      title="Klik om te zien wie er actief was"
      className="flex w-full items-center gap-3 rounded-lg px-1 py-0.5 text-left hover:bg-surface-soft-hover transition-colors"
    >
      <span className="w-20 shrink-0 text-xs font-medium text-slate-500 tabular-nums">
        {new Date(`${d.day}T00:00:00`).toLocaleDateString('nl-BE', { weekday: 'short', day: '2-digit', month: 'short' })}
      </span>
      <div className="flex-1 h-3.5 rounded-md bg-surface-muted overflow-hidden">
        <div className="h-full rounded-md bg-oker-400" style={{ width: `${Math.round((d.count / maxDaily) * 100)}%` }} />
      </div>
      <span className="w-6 shrink-0 text-right text-xs font-bold text-slate-700 tabular-nums">{d.count}</span>
    </button>
  );
  const openDayData = openDay ? dailyActive.find((d) => d.day === openDay) : null;
  const maxDaily = Math.max(1, ...dailyActive.map((d) => d.count));
  // De lijst rechts toont alleen échte aanmeldingen — een 'Actief'-ping is
  // geen aanmeldmoment.
  const recentLogins = useMemo(
    () => logins.filter((e) => e.action === 'Aangemeld').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30),
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

  // De centrale fetch in App levert het 7-dagen-venster (genoeg voor het
  // dashboard). Kiest de admin hier "30 dagen" of "Alles", dan halen we dat
  // venster server-side op — voorheen filterde de UI over máx 100 rijen,
  // waardoor de filters en de CSV-export stil onvolledig waren.
  const [windowEntries, setWindowEntries] = useState<ActivityLogEntry[] | null>(null);
  const [isLoadingWindow, setIsLoadingWindow] = useState(false);
  useEffect(() => {
    const serverWindow = dateWindow === '30d' ? '30d' : dateWindow === 'all' ? 'all' : null;
    if (!serverWindow) {
      setWindowEntries(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setIsLoadingWindow(true);
      try {
        const res = await apiFetch(`/api/activity?window=${serverWindow}`);
        const data = await res.json();
        if (!cancelled && Array.isArray(data)) setWindowEntries(data);
      } catch {
        // props-venster blijft staan — beter een korter venster dan niets
      } finally {
        if (!cancelled) setIsLoadingWindow(false);
      }
    })();
    return () => { cancelled = true; };
  }, [dateWindow]);
  const sourceEntries = windowEntries ?? entries;

  const filteredEntries = useMemo(() => {
    const normalizedSearch = searchTerm.trim().toLowerCase();
    const now = Date.now();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    return sourceEntries.filter((entry) => {
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
  }, [activeCategory, categoryLabels, dateWindow, sourceEntries, searchTerm]);

  const exportFilteredActivity = () => {
    const rows = filteredEntries.map((entry) => [
      entry.createdAt,
      categoryLabels[entry.category],
      entry.action,
      entry.actorName,
      entry.actorRole,
      entry.details,
    ]);
    // csvTekst neutraliseert formule-cellen: `details` bevat gebruikersinvoer
    // (bv. een toestelnaam die met = of - begint).
    const csv = csvTekst([
      ['tijdstip', 'categorie', 'actie', 'actor', 'rol', 'details'],
      ...rows,
    ]);

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const dateSuffix = new Date().toISOString().slice(0, 10);
    void downloadBlob(`vhb-activiteit-${dateWindow}-${dateSuffix}.csv`, blob);
  };

  return (
    <PageShell>
      <Card as="section" padding="lg">
        <CardHeader
          size="lg"
          eyebrow="Aanwezigheid"
          title="Actieve gebruikers en aanmeldingen"
          description="Wie het portaal gebruikte per dag — ook zonder opnieuw in te loggen — en recente aanmeldingen (laatste 30 dagen)."
        />
        {logins.length === 0 ? (
          <div className="mt-5">
            <EmptyState icon={<Users size={24} />} title="Nog geen aanmeldingen geregistreerd" message="Zodra gebruikers inloggen verschijnt hier per dag wie er actief was." />
          </div>
        ) : (
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div>
              <MicroLabel className="mb-2">Actieve gebruikers per dag</MicroLabel>
              {/* Inline alleen de laatste 7 dagen; de volledige historiek
                  groeit onbegrensd en leeft in de scrollbare popup. */}
              <div className="space-y-1">
                {dailyActive.slice(0, 7).map(renderDayRow)}
              </div>
              {dailyActive.length > 7 && (
                <Button variant="ghost" size="sm" full className="mt-2 text-oker-700 hover:text-oker-800" onClick={() => setShowDailyModal(true)}>
                  Alle dagen bekijken ({dailyActive.length})
                </Button>
              )}
            </div>
            <div>
              <MicroLabel className="mb-2">Recente aanmeldingen</MicroLabel>
              <div className="space-y-0.5 max-h-44 overflow-y-auto pr-1">
                {recentLogins.map((e) => (
                  <div key={e.id} className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-1 hover:bg-surface-soft-hover">
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{e.actorName}</span>
                    <span className="shrink-0 text-2xs font-medium text-slate-400 tabular-nums">
                      {new Date(e.createdAt).toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Card>

      <Card as="section" padding="lg">
        <CardHeader
          size="lg"
          eyebrow="Auditspoor"
          title="Recente activiteit"
          description="Alleen admins zien hier recente beheeracties en belangrijke wijzigingen."
          aside={<Badge tone="slate">{filteredEntries.length} items</Badge>}
        />

        <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_auto] lg:items-start">
          <div className="space-y-4">
            <div className="relative">
              <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <Input
                type="search"
                enterKeyHint="search"
                aria-label="Zoek in activiteit"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Zoek op actie, details of actor..."
                className="pl-9"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <FilterChip active={dateWindow === 'today'} onClick={() => setDateWindow('today')}>Vandaag</FilterChip>
              <FilterChip active={dateWindow === '7d'} onClick={() => setDateWindow('7d')}>7 dagen</FilterChip>
              <FilterChip active={dateWindow === '30d'} onClick={() => setDateWindow('30d')}>30 dagen</FilterChip>
              <FilterChip active={dateWindow === 'all'} onClick={() => setDateWindow('all')}>{isLoadingWindow && dateWindow === 'all' ? 'Alles…' : 'Alles'}</FilterChip>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 lg:max-w-[32rem] lg:justify-end">
            <FilterChip active={activeCategory === 'all'} onClick={() => setActiveCategory('all')}>Alles</FilterChip>
            {(Object.keys(categoryLabels) as ActivityLogEntry['category'][]).map((category) => (
              <Fragment key={category}>
                <FilterChip active={activeCategory === category} onClick={() => setActiveCategory(category)}>
                  {categoryLabels[category]}
                </FilterChip>
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
              icon={<Activity size={24} />}
              title={entries.length > 0 ? 'Geen resultaten voor deze filter' : 'Nog geen activiteit gelogd'}
              message={entries.length > 0 ? 'Pas je categorie of zoekterm aan om andere activiteiten te tonen.' : 'Zodra admins beheeracties uitvoeren, verschijnen ze hier automatisch.'}
            />
          )}
        </div>
      </Card>
      <Modal open={showDailyModal} onClose={() => setShowDailyModal(false)} maxWidth="sm" className="flex max-h-[80dvh] flex-col !overflow-hidden !p-0">
        <ModalHeader title="Actieve gebruikers per dag" description="Klik op een dag voor de namen" onClose={() => setShowDailyModal(false)} />
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-3 space-y-1">
          {dailyActive.map(renderDayRow)}
        </div>
      </Modal>

      <Modal open={Boolean(openDayData)} onClose={() => setOpenDay(null)} maxWidth="sm" className="flex max-h-[80dvh] flex-col !overflow-hidden !p-0">
        {openDayData && (
          <>
            {/* ModalHeader neemt een string-titel; de CSS-`capitalize` van
                de oude kop wordt hier een hoofdletter op de weekdag. */}
            <ModalHeader
              eyebrow={`${openDayData.count} ${openDayData.count === 1 ? 'actieve gebruiker' : 'actieve gebruikers'}`}
              title={formatDayLong(openDayData.day).replace(/^./, (c) => c.toUpperCase())}
              onClose={() => setOpenDay(null)}
            />
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-3 space-y-0.5">
              {openDayData.names.map((name) => (
                <div key={name} className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 hover:bg-surface-soft-hover">
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-2xs font-bold text-slate-500">
                    {name.split(' ').map((part) => part[0]).slice(0, 2).join('')}
                  </span>
                  <span className="min-w-0 truncate text-sm font-semibold text-slate-800">{name}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </Modal>
    </PageShell>
  );
}
