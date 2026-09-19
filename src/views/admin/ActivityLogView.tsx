import { useEffect, useMemo, useState, type ComponentProps } from 'react';
import { ChevronDown, Download } from 'lucide-react';
import type { ActivityLogEntry } from '../../types';
import { cn, downloadBlob } from '../../lib/ui';
import { csvTekst } from '../../lib/csv';
import { isoDate, addDagen } from '../../lib/datum';
import { formatDayLong, formatRelatief, WEEKDAY_SHORT_SUN } from '../../lib/format';
import { EmptyState, PageShell, PageHeader } from '../../components/ui';
import { apiFetch } from '../../lib/api';
import { Badge, Button, Segmented, Switch } from '../../components/primitives';
import { Uitklap, uitklapChevron } from '../../components/Uitklap';
import { Paginering, TableToolbar } from '../../components/Table';
import { useQueryParam } from '../../app/router';
import { Card, CardHeader } from '../../components/Card';
import { Avatar } from '../../components/Avatar';
import { Select } from '../../components/Field';
import { InfoTip } from '../../components/InfoTip';
import { LegeLijst, NietGevonden } from '../../components/illustraties';
import { balkenVoorDag, duurKort, nuOnline, telPerDag, type AanwezigheidSessie, type DagBalk } from '../../lib/aanwezigheid';

/**
 * Activiteit (herwerking 08-09-2026, vraag Jarno: professioneler en
 * duidelijker). Twee vragen, twee kaarten:
 *
 *  1. Aanwezigheid: wie was wanneer actief. Sinds 18-09 gevoed door
 *     public.user_presence (sessies) in plaats van het auditlogboek, dat per
 *     persoon hoogstens één auth-regel per dag kende en dus alleen "was
 *     aanwezig" kon zeggen. Dagstrip van 14 dagen als keuzeknop, daaronder
 *     per persoon een tijdbalk over de etmaal-as. "Recente aanmeldingen"
 *     blijft over de échte logins gaan, een andere vraag met een andere bron.
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

/**
 * De rasterrij van een tijdbalk: naam, balk, duur. Eén definitie, zodat de
 * uuras boven de balken exact op dezelfde kolommen valt als de rijen eronder.
 *
 * Twee vormen. Op een telefoon is er geen breedte voor een naamkolom naast een
 * balk van 24 uur: elke naam werd dan "Jarno ..." en juist de naam is hier de
 * hoofdzaak. Daar staan naam en duur dus op de eerste regel en loopt de balk
 * eronder over de volle breedte. Vanaf sm past het wel naast elkaar.
 */
const TIJDBALK_RIJ = 'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 sm:grid-cols-[10.5rem_minmax(0,1fr)_3.5rem] sm:gap-y-0';
const TIJDBALK_NAAM = 'col-start-1 row-start-1 flex min-w-0 items-center gap-2';
const TIJDBALK_BALK = 'col-span-2 col-start-1 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-1';
const TIJDBALK_DUUR = 'col-start-2 row-start-1 text-right sm:col-start-3';

/**
 * Zoveel tijdbalken staan meteen open; de rest zit achter "Toon alle N".
 * Op een gewone werkdag zijn er twaalf tot veertig mensen actief, en dan werd
 * "Vandaag" één lange lap waar je doorheen moest scrollen om bij het
 * auditspoor eronder te komen (Jarno 18-09). Acht toont de hele ochtendploeg
 * in één oogopslag, en omdat de langst aanwezigen bovenaan staan is wie
 * wegvalt per definitie de kortste bezoeker van die dag.
 */
const BALKEN_INGEKLAPT = 8;

/** Minuten sinds middernacht als klok: 375 wordt "06:15", 1440 wordt "24:00". */
const uurMin = (min: number): string => {
  const m = Math.max(0, Math.min(24 * 60, Math.round(min)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
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

export function ActivityLogView({ entries, logins = [], aanwezigheid = [], aanwezigheidMigratie = null }: {
  entries: ActivityLogEntry[];
  logins?: ActivityLogEntry[];
  aanwezigheid?: AanwezigheidSessie[];
  aanwezigheidMigratie?: string | null;
}) {
  const vandaag = isoDate(new Date());

  // ---- Aanwezigheid: wie was wanneer actief ----
  // Bron is public.user_presence (sessies), niet meer het auditlogboek. Dat
  // laatste kende per persoon hoogstens één auth-regel per dag, dus het kon
  // alleen "was aanwezig" zeggen en nooit "van wanneer tot wanneer".
  const [gekozenDag, setGekozenDag] = useState(vandaag);
  const [alleBalken, setAlleBalken] = useState(false);
  const perDagTelling = useMemo(() => telPerDag(aanwezigheid), [aanwezigheid]);
  // Laatste 14 dagen als doorlopende reeks (dagen zonder gebruik = 0).
  const veertienDagen = useMemo(() => Array.from({ length: 14 }, (_, i) => {
    const dag = addDagen(vandaag, i - 13);
    return { day: dag, count: perDagTelling.get(dag) ?? 0, dow: new Date(`${dag}T00:00:00`).getDay() };
  }), [perDagTelling, vandaag]);
  const maxDaily = Math.max(1, ...veertienDagen.map((d) => d.count));
  const balken = useMemo(() => balkenVoorDag(aanwezigheid, gekozenDag), [aanwezigheid, gekozenDag]);
  const online = useMemo(() => nuOnline(aanwezigheid), [aanwezigheid]);
  // Een blok kleurt goud zolang het nog loopt: vandaag, van iemand die online
  // is, en eindigend op of na het huidige moment. Goud is in dit portaal de
  // kleur van "nu", dus een afgelopen periode blijft bewust neutraal.
  const nuMinuten = new Date().getHours() * 60 + new Date().getMinutes();
  const isLopend = (userId: string, totMin: number) =>
    gekozenDag === vandaag && totMin >= nuMinuten - 10 && online.some((o) => o.userId === userId);
  // balkenVoorDag sorteert al op duur, dus wie achter het uitklappen verdwijnt
  // is per definitie de kortste bezoeker van die dag.
  const zichtbareBalken = balken.slice(0, BALKEN_INGEKLAPT);
  const restBalken = balken.slice(BALKEN_INGEKLAPT);

  /** Eén tijdbalk. Losse functie omdat hij zowel boven als in de uitklap staat. */
  const tijdbalkRij = (b: DagBalk) => (
    <div key={b.userId} className={cn(TIJDBALK_RIJ, 'py-2')}>
      <span className={TIJDBALK_NAAM}>
        <Avatar naam={b.naam} size="sm" />
        <span className="min-w-0 truncate text-sm font-semibold text-slate-800" title={b.naam}>{b.naam}</span>
      </span>
      <div className={cn(TIJDBALK_BALK, 'relative h-5 overflow-hidden rounded-md bg-surface-muted ring-1 ring-hairline-subtle')}>
        {/* Ankers op 06, 12 en 18 uur, zodat een blok afleesbaar is zonder te mikken. */}
        {[6, 12, 18].map((u) => (
          <span key={u} className="absolute inset-y-0 w-px bg-hairline-strong/40" style={{ left: `${(u / 24) * 100}%` }} aria-hidden="true" />
        ))}
        {b.periodes.map((per) => (
          <span
            key={per.vanIso}
            className={cn('absolute inset-y-0.5 rounded', isLopend(b.userId, per.totMin) ? 'bg-oker-500' : 'bg-slate-500')}
            style={{ left: `${(per.vanMin / 1440) * 100}%`, width: `${Math.max(0.5, ((per.totMin - per.vanMin) / 1440) * 100)}%` }}
            title={`${uurMin(per.vanMin)} tot ${uurMin(per.totMin)}`}
            aria-label={`${b.naam} actief van ${uurMin(per.vanMin)} tot ${uurMin(per.totMin)}`}
          />
        ))}
      </div>
      <span className={cn(TIJDBALK_DUUR, 'text-xs font-medium font-mono text-slate-600')} title={`${b.periodes.length} ${b.periodes.length === 1 ? 'periode' : 'periodes'}`}>{duurKort(b.totaalMin)}</span>
    </div>
  );
  const recentLogins = useMemo(
    () => logins.filter((e) => e.action === 'Aangemeld').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30),
    [logins],
  );
  const kpi = useMemo(() => {
    // Unieke personen over de week, niet de som van de dagtellingen: wie elke
    // dag rijdt telt één keer mee.
    const weekGrens = addDagen(vandaag, -6);
    const week = new Set<string>();
    for (const s of aanwezigheid) if (isoDate(new Date(s.tot)) >= weekGrens) week.add(s.userId);
    return { vandaag: perDagTelling.get(vandaag) ?? 0, week: week.size, online: online.length };
  }, [perDagTelling, aanwezigheid, online, vandaag]);

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
    <PageShell breed>
      <PageHeader
        view="activiteit"
        title="Activiteit"
        actions={(
          <Button variant="secondary" icon={<Download size={16} />} onClick={exportFilteredActivity} disabled={filteredEntries.length === 0} title="Gefilterde activiteit als CSV">
            CSV
          </Button>
        )}
      />

      {/* ---- Aanwezigheid ---- */}
      <Card as="section" padding="lg" className="min-w-0 p-4 sm:p-6 md:p-8">
        <CardHeader
          size="lg"
          eyebrow="Aanwezigheid"
          title="Wie was wanneer actief"
          description="Het portaal legt vast wanneer iemand de app op de voorgrond had, in stappen van vijf minuten. Kies een dag om het verloop per persoon te zien."
        />
        {aanwezigheidMigratie ? (
          <div className="mt-5">
            <EmptyState
              illustratie={<LegeLijst />}
              title="Aanwezigheid staat nog uit"
              message={`Draai ${aanwezigheidMigratie} in de SQL Editor. Daarna verschijnt hier per dag wie er wanneer actief was.`}
            />
          </div>
        ) : (
          <>
            <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[
                { label: 'Nu online', value: kpi.online, sub: 'op dit moment', live: true },
                { label: 'Vandaag', value: kpi.vandaag, sub: 'actieve gebruikers', live: false },
                { label: 'Laatste 7 dagen', value: kpi.week, sub: 'unieke gebruikers', breed: true, live: false },
              ].map(({ label, value, sub, breed, live }) => (
                <div key={label} className={cn('min-w-0 rounded-xl bg-surface-soft p-3 ring-1 ring-hairline sm:p-4', breed && 'col-span-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 sm:col-span-1 sm:block')}>
                  <dt className={cn('text-label inline-flex items-center gap-1.5 break-words', breed ? 'col-start-1 row-start-1' : 'min-h-8 sm:min-h-0')}>
                    {live && value > 0 && <span className="size-1.5 shrink-0 rounded-full bg-oker-500 vhb-nu" aria-hidden="true" />}
                    {label}
                  </dt>
                  <dd className={`text-stat ${cn('break-words', live && value > 0 ? 'text-oker-700' : 'text-slate-900', breed ? 'col-start-2 row-span-2 row-start-1 sm:mt-2' : 'mt-2')}`}>{value}</dd>
                  <dd className={cn('mt-1 text-xs font-medium break-words text-slate-500', breed && 'col-start-1 row-start-2')}>{sub}</dd>
                </div>
              ))}
            </dl>

            {aanwezigheid.length === 0 ? (
              <div className="mt-5">
                <EmptyState
                  illustratie={<LegeLijst />}
                  title="Nog geen aanwezigheid geregistreerd"
                  message="Zodra gebruikers het portaal openen, verschijnt hier per dag wie er wanneer actief was."
                />
              </div>
            ) : (
              <div className="mt-6 grid gap-6 lg:grid-cols-5">
                <div className="min-w-0 lg:col-span-3">
                  <div className="mb-4">
                    <h3 className="text-card-title">Actieve gebruikers per dag</h3>
                    <p className="mt-1 text-xs text-slate-500">Laatste 14 dagen, tik een dag voor het verloop</p>
                  </div>
                  {/* Kolommen: elke dag een staaf met het aantal erboven; de dag
                      die je kiest stuurt de tijdbalken eronder. De hoogste staaf
                      gebruikt 80% van de hoogte, zodat er ruimte blijft voor de teller. */}
                  <div className="flex h-36 items-end gap-1 sm:gap-1.5" role="group" aria-label={`Actieve gebruikers per dag, laatste 14 dagen: vandaag ${kpi.vandaag}, hoogste ${maxDaily}`}>
                    {veertienDagen.map((d) => (
                      // rauw: staaf-als-knop (kiest de dag van de tijdbalken), eigen layout
                      <button
                        key={d.day}
                        type="button"
                        onClick={() => { setGekozenDag(d.day); setAlleBalken(false); }}
                        aria-pressed={d.day === gekozenDag}
                        aria-label={`${dagKort(d.day, vandaag)}: ${d.count} actief`}
                        className="group flex h-full min-w-0 flex-1 cursor-pointer flex-col items-center justify-end gap-1 rounded-lg"
                      >
                        {/* 2xs: teller boven de dagstrip van de mini-grafiek */}
                        <span className={cn('text-2xs font-semibold font-mono', d.day === gekozenDag ? 'text-slate-900' : 'text-slate-700')}>{d.count || ''}</span>
                        <span
                          className={cn(
                            'w-full rounded-t-md transition-colors',
                            d.day === gekozenDag ? 'bg-oker-500' : d.count > 0 ? 'bg-slate-500 group-hover:bg-slate-700' : 'bg-surface-muted',
                          )}
                          style={{ height: d.count > 0 ? `${Math.max(6, Math.round((d.count / maxDaily) * 80))}%` : '3px' }}
                          aria-hidden="true"
                        />
                      </button>
                    ))}
                  </div>
                  <div className="mt-1.5 flex gap-1 sm:gap-1.5" aria-hidden="true">
                    {veertienDagen.map((d) => (
                      /* 2xs: daglabels van de mini-grafiek, 14 kolommen naast elkaar */
                      <span key={d.day} className={cn('min-w-0 flex-1 truncate text-center text-2xs font-medium font-mono', d.day === gekozenDag ? 'text-oker-700' : 'text-slate-500')}>
                        {d.day === vandaag ? 'nu' : WEEKDAY_SHORT_SUN[d.dow]}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="min-w-0 border-t border-hairline pt-5 lg:col-span-2 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
                  <h3 className="mb-1 text-card-title">Recente aanmeldingen</h3>
                  <p className="mb-3 text-xs text-slate-500">Alleen wie zich écht opnieuw moest aanmelden. Wie ingelogd blijft, telt mee in de aanwezigheid.</p>
                  <div className="max-h-48 space-y-0.5 overflow-y-auto pr-1">
                    {recentLogins.length === 0 ? (
                      <p className="text-sm text-slate-500">Nog geen aanmeldingen in de laatste 30 dagen.</p>
                    ) : recentLogins.map((e) => (
                      <div key={e.id} className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-surface-soft-hover">
                        <Avatar naam={e.actorName} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold break-words text-slate-800">{e.actorName}</p>
                          <p className="mt-0.5 text-xs font-medium text-slate-500" title={new Date(e.createdAt).toLocaleString('nl-BE')}>{formatRelatief(e.createdAt)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ---- Tijdbalken van de gekozen dag ---- */}
            {aanwezigheid.length > 0 && (
              <div className="mt-8 border-t border-hairline pt-6">
                <div className="mb-4 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h3 className="text-card-title">
                    {dagKop(gekozenDag, vandaag)}
                    <span className="ml-2 text-sm font-normal text-slate-500">{formatDayLong(gekozenDag)}</span>
                  </h3>
                  <span className="text-xs font-medium font-mono text-slate-500">
                    {balken.length} {balken.length === 1 ? 'persoon' : 'personen'}
                  </span>
                </div>
                {balken.length === 0 ? (
                  <EmptyState
                    title="Niemand actief op deze dag"
                    message="Kies een andere dag in de grafiek hierboven."
                  />
                ) : (
                  <div className="min-w-0">
                    {/* Uuras boven de balken: 00, 06, 12, 18 en 24 uur. */}
                    <div className={cn(TIJDBALK_RIJ, 'mb-1')} aria-hidden="true">
                      <div className={cn(TIJDBALK_BALK, 'relative h-4')}>
                        {[0, 6, 12, 18].map((u) => (
                          /* 2xs: uurlabel op de tijdas van de aanwezigheidsbalken */
                          <span key={u} className="absolute top-0 text-2xs font-medium font-mono text-slate-500" style={{ left: `${(u / 24) * 100}%` }}>{String(u).padStart(2, '0')}</span>
                        ))}
                        <span className="absolute top-0 right-0 text-2xs font-medium font-mono text-slate-500">24</span>
                      </div>
                    </div>
                    <div className="divide-y divide-hairline-subtle">
                      {zichtbareBalken.map(tijdbalkRij)}
                    </div>
                    {restBalken.length > 0 && (
                      <>
                        <Uitklap open={alleBalken}>
                          <div className="divide-y divide-hairline-subtle border-t border-hairline-subtle">
                            {restBalken.map(tijdbalkRij)}
                          </div>
                        </Uitklap>
                        <div className="mt-1 border-t border-hairline-subtle pt-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setAlleBalken((v) => !v)}
                            icon={<ChevronDown size={16} className={uitklapChevron(alleBalken, 180)} />}
                          >
                            {alleBalken ? 'Toon minder' : `Toon alle ${balken.length}`}
                          </Button>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
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
              <Segmented<typeof dateWindow>
                label="Periode"
                className="h-9 shrink-0 items-center"
                itemClassName="py-1.5"
                waarde={dateWindow}
                opties={([['today', 'Vandaag'], ['7d', '7 dagen'], ['30d', '30 dagen'], ['all', 'Alles']] as Array<[typeof dateWindow, string]>).map(([id, label]) => ({
                  waarde: id,
                  label: isLoadingWindow && dateWindow === id ? `${label}…` : label,
                }))}
                onChange={setDateWindow}
              />
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
                    <span className="text-xs font-medium font-mono text-slate-500">{rijen.reduce((a, b) => a + b.items.length, 0)} {rijen.reduce((a, b) => a + b.items.length, 0) === 1 ? 'actie' : 'acties'}</span>
                  </div>
                  <div className="divide-y divide-hairline-subtle">
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
                            <ChevronDown size={16} className={uitklapChevron(isOpen, 180, 'justify-self-end text-slate-400')} aria-hidden="true" />
                          </button>
                          <Uitklap open={isOpen}>
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
                              <p className="mt-2 text-xs text-slate-500">{new Date(e.createdAt).toLocaleString('nl-BE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })} · {e.actorName} ({e.actorRole}){e.entityType ? ` · ${e.entityType}${e.entityId ? ` ${e.entityId}` : ''}` : ''}</p>
                            </div>
                          </Uitklap>
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

    </PageShell>
  );
}
