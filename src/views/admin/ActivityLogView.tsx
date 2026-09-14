import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { ChevronDown, Download, Users } from 'lucide-react';
import type { ActivityLogEntry } from '../../types';
import { cn, downloadBlob } from '../../lib/ui';
import { csvTekst } from '../../lib/csv';
import { Modal } from '../../components/Modal';
import { isoDate, addDagen } from '../../lib/datum';
import { formatDayLong, formatRelatief, WEEKDAY_SHORT_SUN } from '../../lib/format';
import { EmptyState, ModalHeader, PageShell, PageHeader } from '../../components/ui';
import { apiFetch } from '../../lib/api';
import { Badge, Button, MicroLabel, Switch, segItemClass } from '../../components/primitives';
import { Paginering, TableToolbar } from '../../components/Table';
import { useQueryParam } from '../../app/router';
import { Card, CardHeader } from '../../components/Card';
import { Avatar } from '../../components/Avatar';
import { Select } from '../../components/Field';
import { InfoTip } from '../../components/InfoTip';
import { LegeLijst, NietGevonden } from '../../components/illustraties';

/**
 * Activiteit (herwerking 08-09-2026, vraag Jarno: professioneler en
 * duidelijker). Twee vragen, twee kaarten:
 *
 *  1. Gebruik: wie was er actief (per dag, met namen) en wie meldde zich
 *     recent aan, met drie kengetallen bovenaan.
 *  2. Activiteit: het auditspoor als feed per dag i.p.v. een platte tabel
 *     met volledige tijdstempels. Cron-hartslagen (±1.000 regels per maand)
 *     staan standaard uit, herhaalde acties van dezelfde persoon binnen tien
 *     minuten vouwen samen tot één regel met een teller, en een regel klapt
 *     open voor de volledige details. Filters: periode, categorie, wie.
 */

type Categorie = ActivityLogEntry['category'];

const CATEGORY_TONES: Record<Categorie, ComponentProps<typeof Badge>['tone']> = {
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

const CATEGORY_LABELS: Record<Categorie, string> = {
  users: 'Gebruikers',
  planning: 'Planning',
  planning_codes: 'Planningscodes',
  services: 'Diensten',
  diversions: 'Omleidingen',
  updates: 'Updates',
  auth: 'Aanmelden',
  leave: 'Verlof',
  swaps: 'Dienstruil',
  system: 'Systeem',
};

const PER_PAGINA = 50;
/** Herhaalde acties van dezelfde persoon binnen dit venster vouwen samen. */
const BUNDEL_VENSTER_MS = 10 * 60 * 1000;

/** Automatische hartslagen (crons) zijn geen menselijke actie: standaard verborgen. */
const isRuis = (e: ActivityLogEntry) => e.category === 'system' && /^Cron /i.test(e.action);

const uur = (iso: string) => new Date(iso).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' });
const dagKop = (dag: string, vandaag: string): string => {
  if (dag === vandaag) return 'Vandaag';
  if (dag === addDagen(vandaag, -1)) return 'Gisteren';
  return formatDayLong(dag).replace(/^./, (c) => c.toUpperCase());
};
const dagKort = (dag: string, vandaag: string): string => {
  if (dag === vandaag) return 'vandaag';
  if (dag === addDagen(vandaag, -1)) return 'gisteren';
  return new Date(`${dag}T00:00:00`).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' });
};

type Bundel = {
  key: string;
  eerste: ActivityLogEntry;
  items: ActivityLogEntry[];
  dag: string;
};

/** Gesorteerd (nieuwste eerst) → bundels: zelfde actor, categorie en actie,
 *  opeenvolgend en binnen BUNDEL_VENSTER_MS van de vorige in de bundel. */
const bundel = (entries: ActivityLogEntry[]): Bundel[] => {
  const uit: Bundel[] = [];
  for (const e of entries) {
    const dag = isoDate(new Date(e.createdAt));
    const laatste = uit[uit.length - 1];
    const vorige = laatste?.items[laatste.items.length - 1];
    if (
      laatste && vorige && laatste.dag === dag
      && vorige.actorName === e.actorName && vorige.category === e.category && vorige.action === e.action
      && new Date(vorige.createdAt).getTime() - new Date(e.createdAt).getTime() <= BUNDEL_VENSTER_MS
    ) {
      laatste.items.push(e);
    } else {
      uit.push({ key: e.id, eerste: e, items: [e], dag });
    }
  }
  return uit;
};

export function ActivityLogView({ entries, logins = [] }: { entries: ActivityLogEntry[]; logins?: ActivityLogEntry[] }) {
  const vandaag = isoDate(new Date());

  // ---- Gebruik: actieve gebruikers per dag + aanmeldingen ----
  const dailyActive = useMemo(() => {
    const byDay = new Map<string, Map<string, string>>();
    for (const e of logins) {
      const day = isoDate(new Date(e.createdAt));
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
  const openDayData = openDay ? dailyActive.find((d) => d.day === openDay) : null;
  // Laatste 14 dagen als doorlopende reeks (dagen zonder gebruik = 0).
  const veertienDagen = useMemo(() => {
    const per = new Map(dailyActive.map((d) => [d.day, d]));
    return Array.from({ length: 14 }, (_, i) => {
      const dag = addDagen(vandaag, i - 13);
      const d = per.get(dag);
      return { day: dag, count: d?.count ?? 0, names: d?.names ?? [], dow: new Date(`${dag}T00:00:00`).getDay() };
    });
  }, [dailyActive, vandaag]);
  const maxDaily = Math.max(1, ...veertienDagen.map((d) => d.count));
  const recentLogins = useMemo(
    () => logins.filter((e) => e.action === 'Aangemeld').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30),
    [logins],
  );
  const kpi = useMemo(() => {
    const weekGrens = addDagen(vandaag, -6);
    const week = new Set<string>();
    for (const d of dailyActive) if (d.day >= weekGrens) for (const n of d.names) week.add(n);
    const aanmeldingen7d = logins.filter((e) => e.action === 'Aangemeld' && isoDate(new Date(e.createdAt)) >= weekGrens).length;
    return { vandaag: dailyActive.find((d) => d.day === vandaag)?.count ?? 0, week: week.size, aanmeldingen7d };
  }, [dailyActive, logins, vandaag]);

  // ---- Activiteit: venster, filters, bundeling ----
  const [activeCategory, setActiveCategory] = useState<'all' | Categorie>('all');
  const [actor, setActor] = useState('');
  const [dateWindow, setDateWindow] = useState<'all' | 'today' | '7d' | '30d'>('7d');
  const [toonRuis, setToonRuis] = useState(false);
  const [searchTerm, setSearchTerm] = useQueryParam('zoek');
  const [pagina, setPagina] = useState(1);
  const [open, setOpen] = useState<Set<string>>(new Set());

  // De centrale fetch levert 7 dagen; 30 dagen/alles komen server-side.
  const [windowEntries, setWindowEntries] = useState<ActivityLogEntry[] | null>(null);
  const [isLoadingWindow, setIsLoadingWindow] = useState(false);
  useEffect(() => {
    const serverWindow = dateWindow === '30d' ? '30d' : dateWindow === 'all' ? 'all' : null;
    if (!serverWindow) { setWindowEntries(null); return; }
    let cancelled = false;
    (async () => {
      setIsLoadingWindow(true);
      try {
        const res = await apiFetch(`/api/activity?window=${serverWindow}`);
        const data = await res.json();
        if (!cancelled && Array.isArray(data)) setWindowEntries(data);
      } catch {
        // props-venster blijft staan
      } finally {
        if (!cancelled) setIsLoadingWindow(false);
      }
    })();
    return () => { cancelled = true; };
  }, [dateWindow]);
  const sourceEntries = windowEntries ?? entries;

  // Wat het venster dekt (vóór categorie/actor/zoek), voor de tellers in de keuzelijsten.
  const inVenster = useMemo(() => {
    const now = Date.now();
    const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
    return sourceEntries.filter((entry) => {
      const t = new Date(entry.createdAt).getTime();
      const dateMatch = dateWindow === 'all' ? true : dateWindow === 'today' ? t >= startOfToday.getTime() : dateWindow === '7d' ? t >= now - 7 * 864e5 : t >= now - 30 * 864e5;
      return dateMatch && (toonRuis || !isRuis(entry));
    });
  }, [sourceEntries, dateWindow, toonRuis]);
  const ruisAantal = useMemo(() => sourceEntries.filter(isRuis).length, [sourceEntries]);
  const categorieTelling = useMemo(() => {
    const m = new Map<Categorie, number>();
    for (const e of inVenster) m.set(e.category, (m.get(e.category) ?? 0) + 1);
    return m;
  }, [inVenster]);
  const actoren = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of inVenster) m.set(e.actorName, (m.get(e.actorName) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [inVenster]);

  const filteredEntries = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    return inVenster
      .filter((entry) => {
        if (activeCategory !== 'all' && entry.category !== activeCategory) return false;
        if (actor && entry.actorName !== actor) return false;
        if (!q) return true;
        return [entry.action, entry.details, entry.actorName, CATEGORY_LABELS[entry.category]].join(' ').toLowerCase().includes(q);
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [inVenster, activeCategory, actor, searchTerm]);
  const bundels = useMemo(() => bundel(filteredEntries), [filteredEntries]);

  useEffect(() => { setPagina(1); setOpen(new Set()); }, [activeCategory, actor, dateWindow, searchTerm, sourceEntries, toonRuis]);
  const paginas = Math.max(1, Math.ceil(bundels.length / PER_PAGINA));
  const huidigePagina = Math.min(pagina, paginas);
  const paginaBundels = bundels.slice((huidigePagina - 1) * PER_PAGINA, huidigePagina * PER_PAGINA);
  // Per dag groeperen voor de dagkoppen in de feed.
  const perDag = useMemo(() => {
    const uit: Array<{ dag: string; bundels: Bundel[] }> = [];
    for (const b of paginaBundels) {
      const laatste = uit[uit.length - 1];
      if (laatste && laatste.dag === b.dag) laatste.bundels.push(b); else uit.push({ dag: b.dag, bundels: [b] });
    }
    return uit;
  }, [paginaBundels]);

  const filterActief = activeCategory !== 'all' || actor !== '' || searchTerm.trim() !== '';
  const wisFilters = () => { setActiveCategory('all'); setActor(''); setSearchTerm(''); };
  const toggleOpen = (key: string) => setOpen((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const exportFilteredActivity = () => {
    const csv = csvTekst([
      ['tijdstip', 'categorie', 'actie', 'wie', 'rol', 'details'],
      ...filteredEntries.map((e) => [e.createdAt, CATEGORY_LABELS[e.category], e.action, e.actorName, e.actorRole, e.details]),
    ]);
    void downloadBlob(`vhb-activiteit-${dateWindow}-${vandaag}.csv`, new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  };

  return (
    <PageShell>
      <PageHeader
        title="Activiteit"
        actions={(
          <Button variant="secondary" icon={<Download size={16} />} onClick={exportFilteredActivity} disabled={filteredEntries.length === 0} title="Gefilterde activiteit als CSV">
            CSV
          </Button>
        )}
      />

      {/* ---- Gebruik ---- */}
      <Card as="section" padding="lg">
        <CardHeader
          size="lg"
          eyebrow="Gebruik"
          title="Actieve gebruikers"
          description="Wie het portaal gebruikte, per dag. Een dag telt zodra iemand het portaal opent, ook zonder opnieuw aan te melden."
        />
        {/* Drie gelijke kengetal-tegels op een eigen rij (Jarno 09-09): eerst
            stonden ze als aside naast de beschrijving, met het onderschrift
            inline achter het cijfer, en liepen ze ongelijk door de
            verschillende lengtes. Nu label, cijfer en onderschrift elk op
            een eigen regel, links uitgelijnd. */}
        <dl className="mt-5 grid grid-cols-3 gap-3">
          {[
            ['Vandaag', kpi.vandaag, 'actief'],
            ['Deze week', kpi.week, 'unieke gebruikers'],
            ['Aanmeldingen', kpi.aanmeldingen7d, 'laatste 7 dagen'],
          ].map(([k, v, sub]) => (
            <div key={String(k)} className="rounded-xl bg-surface-soft px-4 py-3 ring-1 ring-hairline">
              <dt className="text-micro">{k}</dt>
              <dd className="mt-1 text-stat text-slate-900">{v}</dd>
              <dd className="mt-0.5 text-2xs font-medium text-slate-500">{sub}</dd>
            </div>
          ))}
        </dl>
        {logins.length === 0 ? (
          <div className="mt-5">
            <EmptyState title="Nog geen gebruik geregistreerd" message="Zodra gebruikers het portaal openen, verschijnt hier per dag wie er actief was." />
          </div>
        ) : (
          <div className="mt-6 grid gap-6 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <div className="mb-3 flex items-center justify-between gap-3">
                <MicroLabel>Per dag, laatste 14 dagen</MicroLabel>
                <Button variant="ghost" size="sm" onClick={() => setShowDailyModal(true)}>Alle dagen ({dailyActive.length})</Button>
              </div>
              {/* Kolommen: elke dag een staaf met het aantal erboven; tik/klik
                  toont de namen van die dag. */}
              <div className="flex h-32 items-end gap-1.5" role="img" aria-label={`Actieve gebruikers per dag, laatste 14 dagen: vandaag ${kpi.vandaag}, hoogste ${maxDaily}`}>
                {veertienDagen.map((d) => (
                  // rauw: staaf-als-knop (namen van die dag), eigen layout
                  <button
                    key={d.day}
                    type="button"
                    onClick={() => d.count > 0 && setOpenDay(d.day)}
                    aria-label={`${dagKort(d.day, vandaag)}: ${d.count} actief`}
                    className={cn('group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1 rounded-lg', d.count > 0 ? 'cursor-pointer' : 'cursor-default')}
                  >
                    <span className="text-2xs font-semibold font-mono text-slate-700">{d.count || ''}</span>
                    <span
                      className={cn('w-full rounded-t-md transition-colors', d.day === vandaag ? 'bg-oker-500' : d.count > 0 ? 'bg-slate-500 group-hover:bg-slate-700' : 'bg-surface-muted')}
                      style={{ height: d.count > 0 ? `${Math.max(6, Math.round((d.count / maxDaily) * 100))}%` : '3px' }}
                      aria-hidden="true"
                    />
                  </button>
                ))}
              </div>
              <div className="mt-1.5 flex gap-1.5" aria-hidden="true">
                {veertienDagen.map((d) => (
                  <span key={d.day} className={cn('min-w-0 flex-1 truncate text-center text-2xs font-medium font-mono', d.day === vandaag ? 'text-oker-700' : 'text-slate-500')}>
                    {d.day === vandaag ? 'nu' : WEEKDAY_SHORT_SUN[d.dow]}
                  </span>
                ))}
              </div>
            </div>
            <div className="lg:col-span-2">
              <MicroLabel className="mb-3 block">Recente aanmeldingen</MicroLabel>
              <div className="max-h-48 space-y-0.5 overflow-y-auto pr-1">
                {recentLogins.length === 0 ? (
                  <p className="text-sm text-slate-500">Nog geen aanmeldingen in de laatste 30 dagen.</p>
                ) : recentLogins.map((e) => (
                  <div key={e.id} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-surface-soft-hover">
                    <Avatar naam={e.actorName} size="sm" />
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{e.actorName}</span>
                    <span className="shrink-0 text-2xs font-medium text-slate-500" title={new Date(e.createdAt).toLocaleString('nl-BE')}>{formatRelatief(e.createdAt)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* ---- Activiteit ---- */}
      <Card as="section" padding="lg">
        <CardHeader
          size="lg"
          eyebrow="Auditspoor"
          title="Wat er gebeurde"
          description="Beheeracties en belangrijke wijzigingen, per dag. Herhaalde acties van dezelfde persoon staan samengevouwen; klik op een regel voor de details."
        />

        <TableToolbar
          className="mt-5"
          zoek={searchTerm}
          onZoek={setSearchTerm}
          placeholder="Zoek in acties, details of namen…"
          telling={`${filteredEntries.length} ${filteredEntries.length === 1 ? 'actie' : 'acties'}${bundels.length !== filteredEntries.length ? ` · ${bundels.length} regels` : ''}`}
          filters={(
            <>
              <div role="group" aria-label="Periode" className="glass-segmented inline-flex h-9 shrink-0 items-center rounded-2xl p-1">
                {([['today', 'Vandaag'], ['7d', '7 dagen'], ['30d', '30 dagen'], ['all', 'Alles']] as Array<[typeof dateWindow, string]>).map(([id, label]) => (
                  // rauw: segmented control op de glass-rail, klassen via segItemClass
                  <button key={id} type="button" onClick={() => setDateWindow(id)} aria-pressed={dateWindow === id} className={segItemClass(dateWindow === id, 'py-1.5')}>
                    {isLoadingWindow && dateWindow === id ? `${label}…` : label}
                  </button>
                ))}
              </div>
              <Select
                aria-label="Categorie"
                value={activeCategory}
                onChange={(e) => setActiveCategory(e.target.value as typeof activeCategory)}
                className="!h-9 !w-auto min-w-[11rem] !py-1 !text-xs font-semibold"
              >
                <option value="all">Alle categorieën</option>
                {(Object.keys(CATEGORY_LABELS) as Categorie[]).map((c) => (
                  <option key={c} value={c}>{CATEGORY_LABELS[c]}{categorieTelling.get(c) ? ` (${categorieTelling.get(c)})` : ''}</option>
                ))}
              </Select>
              <Select
                aria-label="Wie"
                value={actor}
                onChange={(e) => setActor(e.target.value)}
                className="!h-9 !w-auto min-w-[10rem] !py-1 !text-xs font-semibold"
              >
                <option value="">Iedereen</option>
                {actoren.map(([naam, n]) => <option key={naam} value={naam}>{naam} ({n})</option>)}
              </Select>
            </>
          )}
          acties={(
            <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-600">
              <Switch checked={toonRuis} onChange={setToonRuis} label="Systeemhartslagen tonen" />
              <span className="inline-flex items-center gap-1">
                Hartslagen{ruisAantal > 0 ? <span className="font-mono text-slate-500">({ruisAantal})</span> : null}
                <InfoTip label="Uitleg hartslagen"><p>Automatische meldingen van de nachtelijke taken (back-up, synchronisatie van de laadpalen, weekrapport). Ze bewijzen dat de taken draaien, maar zeggen niets over wat iemand deed; daarom staan ze standaard uit.</p></InfoTip>
              </span>
            </label>
          )}
        />

        <div className="mt-5">
          {bundels.length > 0 ? (
            <div className="surface-table overflow-hidden rounded-3xl">
              {perDag.map(({ dag, bundels: rijen }) => (
                <section key={dag} aria-label={dagKop(dag, vandaag)}>
                  <div className="flex items-baseline justify-between gap-3 border-b border-hairline-subtle bg-surface-muted/60 px-4 py-1.5">
                    <h3 className="text-xs font-semibold text-slate-700">{dagKop(dag, vandaag)}{dag === vandaag || dag === addDagen(vandaag, -1) ? <span className="ml-2 font-normal text-slate-500">{formatDayLong(dag)}</span> : null}</h3>
                    <span className="text-2xs font-medium font-mono text-slate-500">{rijen.reduce((a, b) => a + b.items.length, 0)} {rijen.reduce((a, b) => a + b.items.length, 0) === 1 ? 'actie' : 'acties'}</span>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {rijen.map((b) => {
                      const e = b.eerste;
                      const n = b.items.length;
                      const isOpen = open.has(b.key);
                      const laatste = b.items[n - 1];
                      const detailsUniek = [...new Set(b.items.map((x) => x.details).filter(Boolean))];
                      return (
                        <div key={b.key}>
                          {/* rauw: hele regel is de knop die de details open- en dichtklapt (eigen layout) */}
                          <button
                            type="button"
                            onClick={() => toggleOpen(b.key)}
                            aria-expanded={isOpen}
                            className="ios-pressable grid w-full grid-cols-[3.25rem_minmax(0,1fr)_1rem] items-center gap-x-3 px-4 py-2.5 text-left transition-colors hover:bg-surface-soft-hover sm:grid-cols-[4.5rem_8rem_minmax(0,1fr)_11rem_1rem]"
                          >
                            <span className="whitespace-nowrap text-xs font-medium font-mono text-slate-500">
                              {n > 1 ? `${uur(laatste.createdAt)}–${uur(e.createdAt)}` : uur(e.createdAt)}
                            </span>
                            <Badge tone={CATEGORY_TONES[e.category]} dot stil className="hidden w-full justify-center sm:inline-flex">{CATEGORY_LABELS[e.category]}</Badge>
                            <span className="min-w-0">
                              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                <span className="text-sm font-semibold text-slate-800">{e.action}</span>
                                {n > 1 && <Badge tone="oker" stil className="font-mono">{n}×</Badge>}
                                <Badge tone={CATEGORY_TONES[e.category]} dot stil className="sm:hidden">{CATEGORY_LABELS[e.category]}</Badge>
                              </span>
                              {!isOpen && (
                                <span className="mt-0.5 block truncate text-xs font-normal text-slate-500">
                                  {n > 1 && detailsUniek.length > 1 ? `${detailsUniek[0]} en ${detailsUniek.length - 1} andere` : e.details}
                                </span>
                              )}
                            </span>
                            <span className="hidden min-w-0 items-center gap-2 sm:flex">
                              <Avatar naam={e.actorName} size="sm" />
                              <span className="min-w-0 truncate text-xs font-medium text-slate-600" title={e.actorName}>{e.actorName}</span>
                            </span>
                            <ChevronDown size={16} className={cn('justify-self-end text-slate-400 transition-transform', isOpen && 'rotate-180')} aria-hidden="true" />
                          </button>
                          {isOpen && (
                            <div className="bg-surface-muted/40 px-4 pb-4 pt-1 sm:pl-[calc(4.5rem+8rem+2.5rem)]">
                              <p className="text-xs font-medium text-slate-500 sm:hidden">{e.actorName} · {e.actorRole}</p>
                              {n === 1 ? (
                                <p className="mt-1 text-sm text-slate-700">{e.details || 'Geen details.'}</p>
                              ) : (
                                <ul className="mt-1 space-y-1">
                                  {b.items.map((x) => (
                                    <li key={x.id} className="flex gap-3 text-sm text-slate-700">
                                      <span className="w-12 shrink-0 font-mono text-xs text-slate-500">{uur(x.createdAt)}</span>
                                      <span className="min-w-0">{x.details || x.action}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              <p className="mt-2 text-2xs text-slate-500">{new Date(e.createdAt).toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · {e.actorName} ({e.actorRole}){e.entityType ? ` · ${e.entityType}${e.entityId ? ` ${e.entityId}` : ''}` : ''}</p>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </section>
              ))}
              <Paginering className="border-t border-hairline-subtle" totaal={bundels.length} perPagina={PER_PAGINA} pagina={huidigePagina} onPagina={setPagina} />
            </div>
          ) : filterActief ? (
            <EmptyState
              illustratie={<NietGevonden />}
              title={searchTerm.trim() ? `Geen resultaten voor “${searchTerm.trim()}”` : 'Niets gevonden met deze filters'}
              message="Pas de zoekterm, de categorie, de persoon of de periode aan."
              action={<Button variant="secondary" onClick={wisFilters}>Filters wissen</Button>}
            />
          ) : (
            <EmptyState
              illustratie={sourceEntries.length > 0 ? <NietGevonden /> : <LegeLijst />}
              title={sourceEntries.length > 0 ? 'Geen activiteit in deze periode' : 'Nog geen activiteit gelogd'}
              message={sourceEntries.length > 0 ? (ruisAantal > 0 && !toonRuis ? 'Alleen systeemhartslagen in deze periode. Kies een ruimere periode of zet de hartslagen aan.' : 'Kies een ruimere periode om oudere activiteit te zien.') : 'Zodra beheerders acties uitvoeren, verschijnen ze hier vanzelf.'}
              action={sourceEntries.length > 0 && dateWindow !== 'all' ? <Button variant="secondary" onClick={() => setDateWindow('all')}>Alles tonen</Button> : undefined}
            />
          )}
        </div>
      </Card>

      <Modal open={showDailyModal} onClose={() => setShowDailyModal(false)} maxWidth="sm" className="flex max-h-[80dvh] flex-col !overflow-hidden !p-0">
        <ModalHeader title="Actieve gebruikers per dag" description="Klik op een dag voor de namen" onClose={() => setShowDailyModal(false)} />
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-4 py-3">
          {dailyActive.map((d) => (
            // rauw: dagrij (datum + staaf + teller) is de knop naar de namen
            <button key={d.day} type="button" onClick={() => setOpenDay(d.day)} className="flex w-full items-center gap-3 rounded-lg px-1 py-1 text-left transition-colors hover:bg-surface-soft-hover">
              <span className="w-24 shrink-0 text-xs font-medium text-slate-500">{dagKort(d.day, vandaag)}</span>
              <span className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface-muted"><span className="block h-full rounded-full bg-slate-500" style={{ width: `${Math.round((d.count / Math.max(1, ...dailyActive.map((x) => x.count))) * 100)}%` }} /></span>
              <span className="w-6 shrink-0 text-right text-xs font-bold font-mono text-slate-700">{d.count}</span>
            </button>
          ))}
        </div>
      </Modal>

      <Modal open={Boolean(openDayData)} onClose={() => setOpenDay(null)} maxWidth="sm" className="flex max-h-[80dvh] flex-col !overflow-hidden !p-0">
        {openDayData && (
          <>
            <ModalHeader
              eyebrow={`${openDayData.count} ${openDayData.count === 1 ? 'actieve gebruiker' : 'actieve gebruikers'}`}
              title={dagKop(openDayData.day, vandaag)}
              description={formatDayLong(openDayData.day)}
              onClose={() => setOpenDay(null)}
            />
            <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-4 py-3">
              {openDayData.names.map((name) => (
                <div key={name} className="flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 hover:bg-surface-soft-hover">
                  <Avatar naam={name} size="sm" />
                  <span className="min-w-0 truncate text-sm font-semibold text-slate-800">{name}</span>
                </div>
              ))}
              {openDayData.names.length === 0 && <p className="flex items-center gap-2 text-sm text-slate-500"><Users size={16} /> Niemand actief.</p>}
            </div>
          </>
        )}
      </Modal>
    </PageShell>
  );
}
