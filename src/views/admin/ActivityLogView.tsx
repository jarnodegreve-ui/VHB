import { useEffect, useMemo, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { ChevronDown, Download } from 'lucide-react';
import type { ActivityLogEntry } from '../../types';
import { cn, downloadBlob } from '../../lib/ui';
import { csvTekst } from '../../lib/csv';
import { isoDate, addDagen } from '../../lib/datum';
import { formatDatumDMJ, formatDayLong, formatRelatief, formatShortDay, formatSyncedTime, WEEKDAY_SHORT_SUN } from '../../lib/format';
import { EmptyState, PageShell, PageHeader } from '../../components/ui';
import { apiFetch } from '../../lib/api';
import { Badge, Button, FilterChip, Segmented, Switch } from '../../components/primitives';
import { Uitklap, uitklapChevron } from '../../components/Uitklap';
import { Paginering, TableToolbar } from '../../components/Table';
import { useQueryParam } from '../../app/router';
import { Card, CardHeader } from '../../components/Card';
import { Avatar } from '../../components/Avatar';
import { Select } from '../../components/Field';
import { InfoTip } from '../../components/InfoTip';
import { LegeLijst, NietGevonden } from '../../components/illustraties';
import { balkenVoorDag, duurKort, isBuitenland, nuOnline, periodeRegels, rijStaatOpen, telBuitenlandPerDag, telPerDag, type AanwezigheidSessie, type DagBalk } from '../../lib/aanwezigheid';
import { asMarkeringen, asVenster, blokOpAs, labelStapVoor } from '../../lib/tijdAs';
import { useMinWidth } from '../../lib/useMinWidth';

/**
 * Activiteit (herwerking 08-09-2026, vraag Jarno: professioneler en
 * duidelijker). Twee vragen, twee kaarten:
 *
 *  1. Aanwezigheid: wie was wanneer actief. Sinds 18-09 gevoed door
 *     public.user_presence (sessies) in plaats van het auditlogboek, dat per
 *     persoon hoogstens één auth-regel per dag kende en dus alleen "was
 *     aanwezig" kon zeggen. Dagstrip van 14 dagen als keuzeknop, daaronder
 *     per persoon één compacte rij: naam, tijdbalk over de etmaal-as met een
 *     uurraster, en de totale tijd. De exacte periodes en de plaats van
 *     aanmelden klappen pas open na een tik op de rij (Jarno 20-09: de lijst
 *     was te lang op de telefoon). Een sessie van buiten België blijft ook in
 *     de dichte rij zichtbaar als amber stip bij de totale tijd, en met het
 *     filter "Buiten België" aan staan die rijen meteen open. "Recente
 *     aanmeldingen" blijft over de échte logins gaan, een andere vraag met een
 *     andere bron.
 *  2. Activiteit: het auditspoor als feed per dag i.p.v. een platte tabel
 *     met volledige tijdstempels. Cron-hartslagen (±1.000 regels per maand)
 *     staan standaard uit, herhaalde acties van dezelfde persoon binnen tien
 *     minuten vouwen samen tot één regel met een teller, en een regel klapt
 *     open voor de volledige details. Filters: periode, categorie, wie.
 */

type Categorie = ActivityLogEntry['category'];

const CATEGORY_TONES: Record<Categorie, ComponentProps<typeof Badge>['tone']> = {
  // Een categorie is informatie, geen status of "nu": geen goud (tranche 3B, 23-09).
  users: 'slate',
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

/** 'UU:MM' en 'dd/mm/jjjj UU:MM' in lokale tijd, via de gedeelde datumhelpers. */
const uur = (iso: string) => formatSyncedTime(new Date(iso).getTime());
const moment = (iso: string) => `${formatDatumDMJ(isoDate(new Date(iso)))} ${uur(iso)}`;
const dagKop = (dag: string, vandaag: string): string => {
  if (dag === vandaag) return 'Vandaag';
  if (dag === addDagen(vandaag, -1)) return 'Gisteren';
  return formatDayLong(dag).replace(/^./, (c) => c.toUpperCase());
};
const dagKort = (dag: string, vandaag: string): string => {
  if (dag === vandaag) return 'vandaag';
  if (dag === addDagen(vandaag, -1)) return 'gisteren';
  return formatShortDay(dag);
};

/**
 * De rasterrij van een tijdbalk: naam, balk, duur, chevron. Eén definitie,
 * zodat de uuras boven de balken exact op dezelfde kolommen valt als de rijen
 * eronder.
 *
 * Twee vormen. Op een telefoon is er geen breedte voor een naamkolom naast een
 * balk van 24 uur: elke naam werd dan "Jarno ..." en juist de naam is hier de
 * hoofdzaak. Daar staan naam, duur en chevron dus op de eerste regel en loopt
 * de balk eronder over de volle breedte. Vanaf sm past het wel naast elkaar.
 */
const TIJDBALK_RIJ = 'grid grid-cols-[minmax(0,1fr)_auto_1rem] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[10.5rem_minmax(0,1fr)_4.25rem_1rem]';
const TIJDBALK_NAAM = 'col-start-1 row-start-1 flex min-w-0 items-center gap-2';
const TIJDBALK_BALK = 'col-span-3 col-start-1 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-1';
const TIJDBALK_DUUR = 'col-start-2 row-start-1 inline-flex items-center justify-end gap-1.5 sm:col-start-3';
const TIJDBALK_CHEVRON = 'col-start-3 row-start-1 justify-self-end text-slate-400 sm:col-start-4';
/** Het uitgeklapte paneel lijnt vanaf sm uit op de kolom van de balk (naamkolom + gap). */
const TIJDBALK_PANEEL = 'sm:pl-[calc(10.5rem+0.75rem)]';

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

export function ActivityLogView({ entries, logins = [], aanwezigheid = [], aanwezigheidMigratie = null, locatieMigratie = null }: {
  entries: ActivityLogEntry[];
  logins?: ActivityLogEntry[];
  aanwezigheid?: AanwezigheidSessie[];
  aanwezigheidMigratie?: string | null;
  /** Naam van de migratie voor de plaats van aanmelden, zolang die nog moet draaien. */
  locatieMigratie?: string | null;
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
  //
  // Plaats van aanmelden. Het filter geldt alleen op een dag waar het iets te
  // filteren heeft: wie met het filter aan naar een dag zonder buitenlandse
  // sessie bladert, ziet gewoon iedereen in plaats van een lege lijst.
  const metPlaats = !locatieMigratie;
  const [alleenBuitenland, setAlleenBuitenland] = useState(false);
  // Welke rijen de kijker zelf omklapte. Meerdere tegelijk open mag: bij "één
  // tegelijk" klapt de vorige dicht terwijl je een rij lager aantikt, en dan
  // schuift precies de rij onder je vinger weg. Een andere dag of het filter
  // omzetten begint weer rustig, met de standaard van rijStaatOpen.
  const [omgezet, setOmgezet] = useState<Set<string>>(new Set());
  const klapOm = (userId: string) => setOmgezet((s) => { const n = new Set(s); if (n.has(userId)) n.delete(userId); else n.add(userId); return n; });
  const buitenlandPerDag = useMemo(() => telBuitenlandPerDag(aanwezigheid), [aanwezigheid]);
  const buitenlandVandaagGekozen = balken.filter((b) => b.buitenland).length;
  const filterAan = metPlaats && alleenBuitenland && buitenlandVandaagGekozen > 0;
  const getoondeBalken = filterAan ? balken.filter((b) => b.buitenland) : balken;
  const zichtbareBalken = getoondeBalken.slice(0, BALKEN_INGEKLAPT);
  const restBalken = getoondeBalken.slice(BALKEN_INGEKLAPT);
  const tijdbalkenRef = useRef<HTMLDivElement>(null);

  // De as: uurlijnen altijd, labels om de 2 uur op een breed scherm, om de 3
  // op een tablet en om de 6 op een telefoon. Het venster volgt álle balken
  // van de dag, niet de gefilterde, zodat de as niet verspringt als het filter
  // aan- of uitgaat.
  const isSm = useMinWidth(640);
  const isLg = useMinWidth(1024);
  const venster = useMemo(() => asVenster(balken.flatMap((b) => b.periodes)), [balken]);
  const markeringen = useMemo(
    () => asMarkeringen(venster, labelStapVoor(isLg ? 'desktop' : isSm ? 'tablet' : 'telefoon')),
    [venster, isLg, isSm],
  );

  /**
   * Eén persoon. Dicht: naam, balk en totale tijd. De hele rij is de knop; de
   * periodes en de plaats klappen eronder open. Losse functie omdat hij zowel
   * boven als achter "Toon alle N" staat.
   */
  const tijdbalkRij = (b: DagBalk) => {
    const isOpen = rijStaatOpen(b, filterAan, omgezet);
    const paneelId = `tijdbalk-periodes-${b.userId}`;
    const buitenland = metPlaats && b.buitenland;
    const aantal = `${b.periodes.length} ${b.periodes.length === 1 ? 'periode' : 'periodes'}`;
    return (
      <div key={b.userId}>
        {/* rauw: hele rij is de knop die de periodes open- en dichtklapt (eigen rasterlayout, gedeeld met de uuras) */}
        <button
          type="button"
          onClick={() => klapOm(b.userId)}
          aria-expanded={isOpen}
          aria-controls={paneelId}
          aria-label={`${b.naam}, ${duurKort(b.totaalMin)} actief in ${aantal}${buitenland ? ', aanmelding van buiten België' : ''}`}
          className={cn(TIJDBALK_RIJ, 'ios-pressable -mx-2 min-h-11 w-[calc(100%+1rem)] cursor-pointer rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-surface-soft-hover')}
        >
          <span className={TIJDBALK_NAAM}>
            <Avatar naam={b.naam} size="sm" />
            <span className="min-w-0 truncate text-sm font-semibold text-slate-800" title={b.naam}>{b.naam}</span>
          </span>
          <span className={cn(TIJDBALK_BALK, 'relative block h-5 overflow-hidden rounded-md bg-surface-muted ring-1 ring-hairline-subtle')}>
            {/* Uurraster: een fijne lijn per uur, iets sterker waar de as een label
                draagt. Onder de blokken, zodat het raster de balk nooit doorsnijdt. */}
            {markeringen.filter((m) => m.lijn === 'midden').map((m) => (
              <span key={m.uur} data-uurlijn={m.label ? 'sterk' : 'fijn'} className={cn('absolute inset-y-0 w-px', m.label ? 'bg-hairline-strong' : 'bg-hairline-strong/45')} style={{ left: `${m.pct}%` }} aria-hidden="true" />
            ))}
            {b.periodes.map((per) => {
              const { links, breedte } = blokOpAs(per, venster);
              const plaats = metPlaats && per.plaatsen?.length ? per.plaatsen.join(' en ') : '';
              return (
                <span
                  key={per.vanIso}
                  className={cn('absolute inset-y-0.5 rounded', isLopend(b.userId, per.totMin) ? 'bg-oker-500' : 'bg-slate-500')}
                  style={{ left: `${links}%`, width: `${breedte}%` }}
                  title={`${uurMin(per.vanMin)} tot ${uurMin(per.totMin)}${plaats ? ` · ${plaats}` : ''}`}
                  aria-label={`${b.naam} actief van ${uurMin(per.vanMin)} tot ${uurMin(per.totMin)}${plaats ? `, ${plaats}` : ''}`}
                />
              );
            })}
          </span>
          <span className={TIJDBALK_DUUR}>
            {/* Het veiligheidssignaal blijft in de dichte rij staan: dezelfde amber
                stip als op de tegel en in de dagstrip, zodat je weet wie je moet
                openklappen. Amber is hier waarschuwing, nooit goud. */}
            {buitenland && <span data-buitenland role="img" aria-label="Aanmelding van buiten België" title="Aanmelding van buiten België" className="size-2 shrink-0 rounded-full bg-amber-600" />}
            <span className="text-xs font-medium whitespace-nowrap text-slate-600" title={aantal}>{duurKort(b.totaalMin)}</span>
          </span>
          <ChevronDown size={16} className={uitklapChevron(isOpen, 180, TIJDBALK_CHEVRON)} aria-hidden="true" />
        </button>
        <Uitklap open={isOpen} id={paneelId}>
          {/* Eén regel per periode: tijd, duur, plaats. De ul is het raster en
              de li's zijn `contents`, zodat de kolommen over alle regels gelijk
              lopen zonder vaste breedtes (op 320 px telt elke pixel). */}
          <ul className={cn(TIJDBALK_PANEEL, 'grid grid-cols-[auto_auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1 pt-0.5 pb-3 text-sm sm:gap-x-4')} aria-label={`Periodes van ${b.naam}`}>
            {periodeRegels(b).map((regel) => {
              const lopend = isLopend(b.userId, regel.totMin);
              return (
                <li key={regel.sleutel} className="contents">
                  {/* Goud alleen voor de periode die nu nog loopt. */}
                  <span className={cn('whitespace-nowrap', lopend ? 'font-medium text-oker-700' : 'text-slate-700')}>
                    {uurMin(regel.vanMin)}–{uurMin(regel.totMin)}
                    {lopend && <span className="sr-only">, loopt nog</span>}
                  </span>
                  <span className="whitespace-nowrap text-slate-500">{duurKort(regel.duurMin)}</span>
                  {/* Buiten België: dezelfde amber stip als in de dichte rij, en het
                      land voluit. Geen pil: die paste op een telefoon niet naast de
                      plaats en viel dan los op een eigen regel. */}
                  <span className="flex min-w-0 items-baseline justify-end gap-x-1.5 text-right sm:justify-start sm:text-left">
                    {metPlaats && regel.buitenland && <span className="size-2 shrink-0 self-center rounded-full bg-amber-600" aria-hidden="true" />}
                    {metPlaats && (regel.plaats
                      ? (
                        <span className={cn('min-w-0 break-words', regel.buitenland ? 'font-medium text-amber-700' : 'text-slate-600')} title={regel.buitenland ? 'Aanmelding van buiten België' : undefined}>
                          {regel.plaats}
                          {regel.buitenland && <span className="sr-only">, buiten België</span>}
                        </span>
                      )
                      : <span className="text-slate-500">Plaats onbekend</span>)}
                  </span>
                </li>
              );
            })}
          </ul>
        </Uitklap>
      </div>
    );
  };
  const recentLogins = useMemo(
    () => logins.filter((e) => e.action === 'Aangemeld').sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 30),
    [logins],
  );
  const kpi = useMemo(() => {
    // Unieke personen over de week, niet de som van de dagtellingen: wie elke
    // dag rijdt telt één keer mee.
    const weekGrens = addDagen(vandaag, -6);
    const week = new Set<string>();
    const buitenland = new Set<string>();
    for (const s of aanwezigheid) {
      if (isoDate(new Date(s.tot)) < weekGrens) continue;
      week.add(s.userId);
      if (isBuitenland(s.land)) buitenland.add(s.userId);
    }
    return { vandaag: perDagTelling.get(vandaag) ?? 0, week: week.size, online: online.length, buitenland: buitenland.size };
  }, [perDagTelling, aanwezigheid, online, vandaag]);

  /** Vanuit de tegel: naar de recentste dag met een sessie van buiten België, filter aan. */
  const toonBuitenland = () => {
    const recentste = [...buitenlandPerDag.keys()].filter((d) => d >= addDagen(vandaag, -13)).sort().pop();
    if (!recentste) return;
    setGekozenDag(recentste);
    setAlleenBuitenland(true);
    setAlleBalken(false);
    setOmgezet(new Set());
    const rustig = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() => tijdbalkenRef.current?.scrollIntoView({ block: 'nearest', behavior: rustig ? 'auto' : 'smooth' }));
  };

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
            <dl className={cn('mt-5 grid grid-cols-2 gap-3', metPlaats ? 'sm:grid-cols-4' : 'sm:grid-cols-3')}>
              {([
                { label: 'Nu online', value: kpi.online, sub: 'op dit moment', live: true },
                { label: 'Vandaag', value: kpi.vandaag, sub: 'actieve gebruikers' },
                // Zonder de plaats zijn het er drie en krijgt de derde op een
                // telefoon de volle breedte; met vier is het een net 2×2.
                { label: 'Laatste 7 dagen', value: kpi.week, sub: 'unieke gebruikers', breed: !metPlaats },
                ...(metPlaats ? [{
                  label: 'Buiten België',
                  value: kpi.buitenland,
                  waarschuwing: kpi.buitenland > 0,
                  sub: kpi.buitenland > 0 ? (
                    // rauw: uitgerekte knop over de hele tegel (after:inset-0); de tegel zelf is een dl-groep en kan geen button zijn
                    <button type="button" onClick={toonBuitenland} aria-label="Bekijk wie buiten België aanmeldde" className="cursor-pointer text-left font-medium after:absolute after:inset-0 after:rounded-xl">
                      laatste 7 dagen, <span className="font-semibold text-amber-700 underline decoration-amber-700/40 underline-offset-2">bekijk</span>
                    </button>
                  ) : 'laatste 7 dagen',
                }] : []),
              ] as Array<{ label: string; value: number; sub: ReactNode; live?: boolean; breed?: boolean; waarschuwing?: boolean }>).map(({ label, value, sub, breed, live, waarschuwing }) => (
                <div key={label} className={cn('relative min-w-0 rounded-xl bg-surface-soft p-3 ring-1 ring-hairline sm:p-4', waarschuwing && 'transition-colors hover:bg-surface-soft-hover', breed && 'col-span-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 sm:col-span-1 sm:block')}>
                  <dt className={cn('text-label inline-flex items-center gap-1.5 break-words', breed ? 'col-start-1 row-start-1' : 'min-h-8 sm:min-h-0')}>
                    {live && value > 0 && <span className="size-1.5 shrink-0 rounded-full bg-oker-500 vhb-nu" aria-hidden="true" />}
                    {waarschuwing && <span className="size-1.5 shrink-0 rounded-full bg-amber-500" aria-hidden="true" />}
                    {label}
                  </dt>
                  <dd className={cn('text-stat break-words', live && value > 0 ? 'text-oker-700' : waarschuwing ? 'text-amber-700' : 'text-slate-900', breed ? 'col-start-2 row-span-2 row-start-1 sm:mt-2' : 'mt-2')}>{value}</dd>
                  {/* slate-600: op het zachte tegelvlak haalt slate-500 maar 4,3:1 (axe, 20-09). */}
                  <dd className={cn('mt-1 text-xs font-medium break-words text-slate-600', breed && 'col-start-1 row-start-2')}>{sub}</dd>
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
                        onClick={() => { setGekozenDag(d.day); setAlleBalken(false); setOmgezet(new Set()); }}
                        aria-pressed={d.day === gekozenDag}
                        aria-label={`${dagKort(d.day, vandaag)}: ${d.count} actief${metPlaats && buitenlandPerDag.get(d.day) ? `, ${buitenlandPerDag.get(d.day)} buiten België` : ''}`}
                        className="group flex h-full min-w-0 flex-1 cursor-pointer flex-col items-center justify-end gap-1 rounded-lg"
                      >
                        {/* 2xs: teller boven de dagstrip van de mini-grafiek */}
                        <span className={cn('text-2xs font-semibold', d.day === gekozenDag ? 'text-slate-900' : 'text-slate-700')}>{d.count || ''}</span>
                        <span
                          className={cn(
                            'w-full rounded-t-md transition-colors',
                            // Gekozen dag = selectie: de keuzekleur (carbon, in donker lichtgrijs), geen goud.
                            d.day === gekozenDag ? 'bg-keuze' : d.count > 0 ? 'bg-slate-500 group-hover:bg-slate-700' : 'bg-surface-muted',
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
                      <span key={d.day} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                        <span className={cn('w-full truncate text-center text-2xs font-medium', d.day === gekozenDag ? 'font-semibold text-slate-900' : 'text-slate-500')}>
                          {d.day === vandaag ? 'nu' : WEEKDAY_SHORT_SUN[d.dow]}
                        </span>
                        {/* Amber stip: die dag kwam er iemand van buiten België. Elke
                            dag reserveert de hoogte, zodat de labels op één lijn blijven. */}
                        <span className={cn('size-1 rounded-full', metPlaats && buitenlandPerDag.get(d.day) ? 'bg-amber-500' : 'bg-transparent')} />
                      </span>
                    ))}
                  </div>
                </div>
                <div className="min-w-0 border-t border-hairline pt-5 lg:col-span-2 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-6">
                  <h3 className="mb-1 text-card-title">Recente aanmeldingen</h3>
                  <p className="mb-3 text-xs text-slate-500">Alleen wie zich écht opnieuw moest aanmelden. Wie ingelogd blijft, telt mee in de aanwezigheid.</p>
                  {/* Eigen scrollstrook: focusbaar en benoemd, zodat ze ook met het toetsenbord scrolt (axe). */}
                  <div className="max-h-48 space-y-0.5 overflow-y-auto pr-1" role="region" aria-label="Recente aanmeldingen" tabIndex={0}>
                    {recentLogins.length === 0 ? (
                      <p className="text-sm text-slate-500">Nog geen aanmeldingen in de laatste 30 dagen.</p>
                    ) : recentLogins.map((e) => (
                      <div key={e.id} className="flex items-start gap-3 rounded-lg px-2 py-2 hover:bg-surface-soft-hover">
                        <Avatar naam={e.actorName} size="sm" />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-semibold break-words text-slate-800">{e.actorName}</p>
                          <p className="mt-0.5 text-xs font-medium text-slate-500"><time dateTime={e.createdAt} title={moment(e.createdAt)}>{formatRelatief(e.createdAt)}</time></p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ---- Tijdbalken van de gekozen dag ---- */}
            {aanwezigheid.length > 0 && (
              <div ref={tijdbalkenRef} className="mt-8 scroll-mt-24 border-t border-hairline pt-6">
                <div className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                  <h3 className="text-card-title">
                    {dagKop(gekozenDag, vandaag)}
                    {/* Alleen bij "Vandaag" en "Gisteren": voor oudere dagen ís de kop al de volle datum. */}
                    {(gekozenDag === vandaag || gekozenDag === addDagen(vandaag, -1)) && (
                      <span className="ml-2 text-sm font-normal text-slate-500">{formatDayLong(gekozenDag)}</span>
                    )}
                  </h3>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    {metPlaats && (
                      <span className="inline-flex items-center gap-0.5">
                        {buitenlandVandaagGekozen > 0 ? (
                          <FilterChip tone="amber" active={filterAan} onClick={() => { setAlleenBuitenland((v) => !v); setAlleBalken(false); setOmgezet(new Set()); }}>
                            Buiten België: {buitenlandVandaagGekozen}
                          </FilterChip>
                        ) : (
                          <span className="text-xs font-medium text-slate-500">Buiten België: 0</span>
                        )}
                        <InfoTip label="Uitleg plaats van aanmelden" align="right">
                          <p>De plaats wordt afgeleid van het IP-adres waarmee iemand verbinding maakt. Op mobiel internet is dat vaak de stad van de provider (Brussel, Antwerpen) en niet de plek waar iemand staat: lees het als een streek, niet als een adres. Het land klopt vrijwel altijd.</p>
                          <p className="mt-2">Een VPN kan een ander land tonen, dus “Buiten België” is een reden om het na te vragen, geen bewijs. Het IP-adres zelf wordt niet bewaard, en de plaats verdwijnt na 90 dagen samen met de sessie.</p>
                        </InfoTip>
                      </span>
                    )}
                    <span className="text-xs font-medium text-slate-500">
                      {filterAan ? `${getoondeBalken.length} van ${balken.length}` : balken.length} {balken.length === 1 ? 'persoon' : 'personen'}
                    </span>
                  </div>
                </div>
                {locatieMigratie && (
                  <p className="mb-4 text-xs text-slate-500">De plaats van aanmelden staat nog uit: draai {locatieMigratie} in de SQL Editor.</p>
                )}
                {balken.length === 0 ? (
                  <EmptyState
                    title="Niemand actief op deze dag"
                    message="Kies een andere dag in de grafiek hierboven."
                  />
                ) : (
                  <div className="min-w-0">
                    {/* Uuras boven de balken. Dezelfde markeringen als het raster in
                        de balken, dus een label staat exact boven zijn lijn. */}
                    <div className={cn(TIJDBALK_RIJ, 'mb-1')} aria-hidden="true">
                      <div className={cn(TIJDBALK_BALK, 'relative h-4')} data-uuras>
                        {markeringen.filter((m) => m.label).map((m) => (
                          /* 2xs: uurlabel op de tijdas van de aanwezigheidsbalken */
                          <span
                            key={m.uur}
                            className={cn('absolute top-0 text-2xs font-medium text-slate-500', m.lijn === 'midden' && '-translate-x-1/2')}
                            style={m.lijn === 'eind' ? { right: 0 } : { left: `${m.pct}%` }}
                          >
                            {m.label}
                          </span>
                        ))}
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
                            {alleBalken ? 'Toon minder' : `Toon alle ${getoondeBalken.length}`}
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
                className="!h-9 !w-auto min-w-[11rem] !py-1 sm:!text-xs font-semibold"
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
                className="!h-9 !w-auto min-w-[10rem] !py-1 sm:!text-xs font-semibold"
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
                Hartslagen{ruisAantal > 0 ? <span className="text-slate-500">({ruisAantal})</span> : null}
                <InfoTip label="Uitleg hartslagen"><p>Automatische meldingen van de nachtelijke taken (back-up, synchronisatie van de laadpalen, weekrapport). Ze bewijzen dat de taken draaien, maar zeggen niets over wat iemand deed; daarom staan ze standaard uit.</p></InfoTip>
              </span>
            </label>
          )}
        />

        <div className="mt-5">
          {bundels.length > 0 ? (
            // Een lijst, geen tabel: per dag een kop en een ul met regels die
            // openklappen (rijrecept: px-4 py-3, titel 15 px, meta 13 px). De
            // regels zelf houden hun raster (tijd, categorie, actie, wie).
            <Card padding="none" className="overflow-hidden">
              {perDag.map(({ dag, bundels: rijen }) => (
                <section key={dag} aria-label={dagKop(dag, vandaag)}>
                  <div className="flex items-baseline justify-between gap-3 border-b border-hairline-subtle bg-surface-muted/60 px-4 py-1.5">
                    <h3 className="text-subsection-title text-slate-700">{dagKop(dag, vandaag)}{dag === vandaag || dag === addDagen(vandaag, -1) ? <span className="ml-2 font-normal text-slate-500">{formatDayLong(dag)}</span> : null}</h3>
                    <span className="text-xs font-medium text-slate-500">{rijen.reduce((a, b) => a + b.items.length, 0)} {rijen.reduce((a, b) => a + b.items.length, 0) === 1 ? 'actie' : 'acties'}</span>
                  </div>
                  <ul className="divide-y divide-hairline-subtle">
                    {rijen.map((b) => {
                      const e = b.eerste;
                      const n = b.items.length;
                      const isOpen = open.has(b.key);
                      const laatste = b.items[n - 1];
                      const detailsUniek = [...new Set(b.items.map((x) => x.details).filter(Boolean))];
                      return (
                        <li key={b.key}>
                          {/* rauw: hele regel is de knop die de details open- en dichtklapt (eigen layout) */}
                          <button
                            type="button"
                            onClick={() => toggleOpen(b.key)}
                            aria-expanded={isOpen}
                            className="ios-pressable grid w-full grid-cols-[3.25rem_minmax(0,1fr)_1rem] items-center gap-x-3 px-4 py-3 text-left transition-colors hover:bg-surface-soft-hover sm:grid-cols-[4.5rem_8rem_minmax(0,1fr)_11rem_1rem]"
                          >
                            <span className="whitespace-nowrap text-xs font-medium text-slate-500">
                              {n > 1
                                ? <><time dateTime={laatste.createdAt}>{uur(laatste.createdAt)}</time>–<time dateTime={e.createdAt}>{uur(e.createdAt)}</time></>
                                : <time dateTime={e.createdAt}>{uur(e.createdAt)}</time>}
                            </span>
                            <Badge tone={CATEGORY_TONES[e.category]} dot stil className="hidden w-full justify-center sm:inline-flex">{CATEGORY_LABELS[e.category]}</Badge>
                            <span className="min-w-0">
                              <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                                <span className="text-md font-semibold text-slate-800">{e.action}</span>
                                {/* Teller van een bundel: neutraal, goud is geen telkleur voor een lijst (tranche 3B). */}
                                {n > 1 && <Badge tone="slate" stil>{n}×</Badge>}
                                <Badge tone={CATEGORY_TONES[e.category]} dot stil className="sm:hidden">{CATEGORY_LABELS[e.category]}</Badge>
                              </span>
                              {!isOpen && (
                                <span className="mt-0.5 block truncate text-body-sm font-normal text-slate-500">
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
                                      <time dateTime={x.createdAt} className="w-12 shrink-0 text-xs text-slate-500">{uur(x.createdAt)}</time>
                                      <span className="min-w-0">{x.details || x.action}</span>
                                    </li>
                                  ))}
                                </ul>
                              )}
                              <p className="mt-2 text-xs text-slate-500"><time dateTime={e.createdAt}>{moment(e.createdAt)}</time> · {e.actorName} ({e.actorRole}){e.entityType ? ` · ${e.entityType}${e.entityId ? ` ${e.entityId}` : ''}` : ''}</p>
                            </div>
                          </Uitklap>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
              <Paginering className="border-t border-hairline-subtle" totaal={bundels.length} perPagina={PER_PAGINA} pagina={huidigePagina} onPagina={setPagina} />
            </Card>
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
