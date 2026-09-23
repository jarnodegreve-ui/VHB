import { ArrowDown, ArrowUp, ArrowUpDown, Check, Columns3, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type InputHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import { cn } from '../lib/ui';
import { DUR, EASE, EASE_SPRING } from '../lib/motion';
import { tik } from '../lib/tik';
import { Button, IconButton, MicroLabel, Segmented } from './primitives';
import { useDropdown } from './useDropdown';
import { Popover } from './Popover';
import { SearchField } from './Field';

import { Tabel, TabelKopContext, TableShell, Td, Th } from './TabelBasis';

export { Tabel, TableShell, Td, Th };


/**
 * Tabel-bouwstenen voor de beheerkant (fase C11):
 * - `TableToolbar`: zoekveld + filters + resultaattelling + acties, één rij.
 * - `useSort` + `SortTh`: sorteerbare kolomkop met aria-sort en pijl.
 * - `Checkbox`: selectievakje in huisstijl (rij- en alles-selectie).
 * - `BulkBar`: balk die verschijnt zodra er rijen geselecteerd zijn.
 * - `StickyThead`: kolomkop die onder de topbar blijft plakken bij scrollen.
 * - `Paginering`: eenvoudige "vorige/volgende + N per pagina".
 * - `useTabelVoorkeur`: rijdichtheid + kolomkeuze, per tabel onthouden in
 *   localStorage; de toolbar toont er de schakelaar en het kolommenmenu voor.
 * - `CelKnop` + `rijKlik`: een rij die iets opent (tranche 3B).
 * Het kader zelf is `TableShell` (label, kop, overloop) met `Tabel` erin
 * (TabelBasis.tsx, hier doorgegeven).
 */

// === Tabelvoorkeur: dichtheid + kolomkeuze ===

type Dichtheid = 'compact' | 'comfortabel';

/**
 * Klassen op de <table> per dichtheid. Compact knijpt de rijen alleen met een
 * muis (op touch blijft het raakvlak) en zet de celtekst op text-xs; de
 * selectors `[&_td]`/`[&_th]` winnen op specificiteit van de basismaten in
 * Td/Th, zodat de primitieven zelf ongemoeid blijven.
 */
const DICHTHEID_TABEL: Record<Dichtheid, string> = {
  comfortabel: '',
  compact: 'sm:pointer-fine:[&_td]:py-1.5 sm:pointer-fine:[&_th]:py-1.5 sm:pointer-fine:[&_th_button]:min-h-8 [&_td]:text-xs',
};

type KolomKeuze<K extends string = string> = { key: K; label: string };

type VoorkeurOpslag = { dichtheid: Dichtheid; verborgen: string[] };

const VOORKEUR_PREFIX = 'vhb-tabel:';

const leesVoorkeur = (sleutel: string): VoorkeurOpslag => {
  const standaard: VoorkeurOpslag = { dichtheid: 'comfortabel', verborgen: [] };
  try {
    const raw = window.localStorage.getItem(VOORKEUR_PREFIX + sleutel);
    if (!raw) return standaard;
    const p = JSON.parse(raw) as Partial<VoorkeurOpslag>;
    return {
      dichtheid: p.dichtheid === 'compact' ? 'compact' : 'comfortabel',
      verborgen: Array.isArray(p.verborgen) ? p.verborgen.filter((k): k is string => typeof k === 'string') : [],
    };
  } catch {
    // privémodus / kapotte JSON: gewoon de standaard
    return standaard;
  }
};

/**
 * Dichtheid ('compact' | 'comfortabel') en verborgen kolommen van één tabel,
 * onthouden per `sleutel` in localStorage. We bewaren de vérborgen kolommen
 * (niet de zichtbare): een kolom die er later bijkomt staat dan standaard
 * aan. `keuzes` zijn de uitschakelbare kolommen — verplichte kolommen (naam,
 * acties) geef je niet mee en blijven dus altijd staan.
 */
export function useTabelVoorkeur<K extends string = never>(sleutel: string, keuzes?: ReadonlyArray<KolomKeuze<K>>) {
  const [voorkeur, setVoorkeur] = useState<VoorkeurOpslag>(() => leesVoorkeur(sleutel));
  useEffect(() => {
    try { window.localStorage.setItem(VOORKEUR_PREFIX + sleutel, JSON.stringify(voorkeur)); } catch { /* privémodus */ }
  }, [sleutel, voorkeur]);

  const setDichtheid = useCallback((dichtheid: Dichtheid) => setVoorkeur((v) => ({ ...v, dichtheid })), []);
  const toggleKolom = useCallback((key: string) => setVoorkeur((v) => ({
    ...v,
    verborgen: v.verborgen.includes(key) ? v.verborgen.filter((k) => k !== key) : [...v.verborgen, key],
  })), []);
  const toonAlles = useCallback(() => setVoorkeur((v) => ({ ...v, verborgen: [] })), []);

  const verborgen = useMemo(() => new Set(voorkeur.verborgen), [voorkeur.verborgen]);
  const zichtbaar = useCallback((key: K) => !verborgen.has(key), [verborgen]);

  return {
    /** Voor `TableToolbar dichtheid`. */
    dichtheid: { waarde: voorkeur.dichtheid, onChange: setDichtheid },
    /** Voor `TableToolbar kolommen` — undefined als er geen keuzes zijn. */
    kolommen: keuzes && keuzes.length > 0 ? { keuzes, verborgen, onToggle: toggleKolom, onAlles: toonAlles } : undefined,
    /** Op de <table> zetten. */
    tabelClass: DICHTHEID_TABEL[voorkeur.dichtheid],
    zichtbaar,
  };
}

type DichtheidProps = { waarde: Dichtheid; onChange: (d: Dichtheid) => void };
type KolommenProps = {
  keuzes: ReadonlyArray<KolomKeuze<string>>;
  verborgen: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onAlles?: () => void;
};

const DICHTHEID_LABELS: Record<Dichtheid, string> = { comfortabel: 'Comfortabel', compact: 'Compact' };

/** Segmented "Comfortabel | Compact". Alleen op md+: mobiel toont kaartlijsten, geen tabel. */
function DichtheidSchakelaar({ waarde, onChange }: DichtheidProps) {
  return (
    <Segmented<Dichtheid>
      waarde={waarde}
      opties={(['comfortabel', 'compact'] as const).map((d) => ({ waarde: d, label: DICHTHEID_LABELS[d] }))}
      onChange={onChange}
      label="Rijdichtheid"
      className="hidden md:inline-flex"
      itemClassName="px-3 py-1.5"
    />
  );
}

/** Kolommenmenu: één Checkbox per uitschakelbare kolom, in een opaak vlak. */
function KolommenMenu({ keuzes, verborgen, onToggle, onAlles }: KolommenProps) {
  const { open, setOpen, wortel } = useDropdown();
  const id = useId();
  const aantalVerborgen = keuzes.filter((k) => verborgen.has(k.key)).length;
  return (
    <div ref={wortel} className="relative hidden md:block">
      <IconButton
        label={aantalVerborgen > 0 ? `Kolommen kiezen (${aantalVerborgen} verborgen)` : 'Kolommen kiezen'}
        size="sm"
        variant={aantalVerborgen > 0 ? 'secondary' : 'ghost'}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Columns3 size={16} />
      </IconButton>
      <Popover open={open} label="Kolommen" laag="menu" breedte="sm">
            <MicroLabel className="px-2.5 pb-1 pt-1.5">Kolommen</MicroLabel>
            {keuzes.map((k) => {
              const inputId = `${id}-${k.key}`;
              return (
                <div key={k.key} className="flex items-center gap-1.5 rounded-lg pl-1 pr-2 transition-colors hover:bg-surface-soft-hover">
                  <Checkbox id={inputId} checked={!verborgen.has(k.key)} onChange={() => onToggle(k.key)} label={`Kolom ${k.label} tonen`} />
                  <label htmlFor={inputId} className="flex-1 cursor-pointer select-none py-1.5 text-sm font-medium text-slate-700">{k.label}</label>
                </div>
              );
            })}
            {onAlles && aantalVerborgen > 0 && (
              <Button variant="ghost" size="sm" full className="mt-1" onClick={onAlles}>Alle kolommen tonen</Button>
            )}
      </Popover>
    </div>
  );
}

/**
 * Filterrij op de telefoon (onder md) tot aan de rand laten doorlopen, met
 * een zachte vervaging over precies die rand: een chip die niet meer past
 * loopt onder de rand door ("Geblokke…" stopte hard op de marge en las als
 * afgekapt). De vervaging ligt alleen over de binnenmarge, dus aan het begin
 * en aan het eind van het schuiven staat elke chip volledig in beeld.
 * `kaart` = binnen een tabelkader (px-5), `pagina` = rechtstreeks op de
 * pagina (safe-area-gutter). Het masker zelf staat in index.css
 * (`.filter-rij-rand`, alleen onder md).
 */
const FILTER_RAND = {
  kaart: 'filter-rij-rand max-md:-mx-5 max-md:px-5 [--filter-rand:1.25rem]',
  pagina: 'filter-rij-rand max-md:mx-gutter-neg max-md:px-gutter [--filter-rand:var(--gutter)]',
} as const;

export function TableToolbar({ zoek, onZoek, placeholder = 'Zoeken…', telling, filters, acties, dichtheid, kolommen, className, rand }: {
  zoek?: string;
  onZoek?: (v: string) => void;
  placeholder?: string;
  /** Bv. "12 van 42" — staat rechts van het zoekveld. */
  telling?: ReactNode;
  filters?: ReactNode;
  acties?: ReactNode;
  /** Rijdichtheid-schakelaar (uit `useTabelVoorkeur().dichtheid`). */
  dichtheid?: DichtheidProps;
  /** Kolommenmenu (uit `useTabelVoorkeur().kolommen`). */
  kolommen?: KolommenProps;
  className?: string;
  /**
   * Waar de filterrij op de telefoon tot aan de rand doorloopt: `kaart`
   * (tabelkader, vanzelf in de `kop` van een TableShell), `pagina` (toolbar
   * rechtstreeks op de pagina) of `geen`.
   */
  rand?: 'kaart' | 'pagina' | 'geen';
}) {
  const inKop = useContext(TabelKopContext);
  const filterRand = rand ?? (inKop ? 'kaart' : 'geen');
  return (
    // Vaste opbouw (ronde 3, 19-09): rij 1 = zoekveld links, telling en
    // tabelinstellingen rechts; rij 2 = de filters op ÉÉN regel die op smalle
    // schermen horizontaal schuift. Voorheen stonden filters tussen zoekveld
    // en instellingen en liepen ze rafelig over twee of drie regels.
    <div className={cn('flex flex-col gap-2.5', className)}>
      <div className="flex flex-col gap-2.5 md:flex-row md:items-center">
        {onZoek && (
          <SearchField value={zoek ?? ''} onChange={onZoek} placeholder={placeholder} size="sm" className="w-full md:max-w-xs" />
        )}
        <div className="flex items-center gap-2.5 md:ml-auto">
          {telling ? <span className="shrink-0 whitespace-nowrap text-xs font-medium tabular-nums text-slate-500">{telling}</span> : null}
          {dichtheid ? <DichtheidSchakelaar {...dichtheid} /> : null}
          {kolommen ? <KolommenMenu {...kolommen} /> : null}
          {acties}
        </div>
      </div>
      {/* -m/p van 1: de focus-outline (2 px + 2 px offset) mag niet door de
          overflow afgesneden worden. */}
      {filters ? (
        <div className={cn('filter-rij -m-1 flex items-center gap-1.5 overflow-x-auto p-1 [&>*]:shrink-0', filterRand !== 'geen' && FILTER_RAND[filterRand])}>
          {filters}
        </div>
      ) : null}
    </div>
  );
}

type SortRichting = 'asc' | 'desc';

/** Sorteerstate + comparator voor een lijst; `key` is de kolomsleutel. */
export function useSort<K extends string>(standaard: K, richting: SortRichting = 'asc') {
  const [key, setKey] = useState<K>(standaard);
  const [dir, setDir] = useState<SortRichting>(richting);
  const toggle = (k: K) => {
    if (k === key) setDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setKey(k); setDir('asc'); }
  };
  const sorteer = useMemo(() => {
    return <T,>(rows: T[], waarde: (row: T, k: K) => string | number | null | undefined): T[] => {
      const f = dir === 'asc' ? 1 : -1;
      return [...rows].sort((a, b) => {
        const va = waarde(a, key); const vb = waarde(b, key);
        if (va == null && vb == null) return 0;
        if (va == null) return 1;
        if (vb == null) return -1;
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * f;
        return String(va).localeCompare(String(vb), 'nl', { numeric: true, sensitivity: 'base' }) * f;
      });
    };
  }, [key, dir]);
  return { key, dir, toggle, sorteer };
}

/**
 * Sorteerbare kolomkop: klik wisselt richting, aria-sort voor screenreaders.
 * `dicht` = de smalle variant voor een tabel op de telefoon (RapportTabel):
 * krappe zijmarge en de pijl alleen bij de actieve kolom, zodat drie
 * cijferkolommen naast een naam passen. `naam` = de volledige kolomnaam voor
 * hulptechnologie als de zichtbare kop een afkorting is ("Opgen.").
 */
export function SortTh<K extends string>({ kolom, sort, children, className, title, align = 'left', dicht = false, naam }: {
  kolom: K;
  sort: { key: K; dir: SortRichting; toggle: (k: K) => void };
  children: ReactNode;
  className?: string;
  title?: string;
  align?: 'left' | 'right';
  dicht?: boolean;
  naam?: string;
}) {
  const actief = sort.key === kolom;
  const Pijl = !actief ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  const pijl = dicht && !actief ? null : <Pijl size={12} className={cn('shrink-0 transition-opacity', actief ? 'opacity-100' : 'opacity-0 group-hover:opacity-60')} />;
  const rechts = align === 'right';
  return (
    <Th className={cn('p-0', className)} num={rechts} title={title} sort={actief ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
      {/* rauw: kolomkop-knop (tekst + sorteerpijl) in een tabelkop. */}
      <button type="button" aria-label={naam} onClick={() => sort.toggle(kolom)} className={cn('tikbaar group inline-flex min-h-11 sm:pointer-fine:min-h-9 w-full items-center text-xs font-medium transition-colors hover:text-slate-800', dicht ? 'gap-0.5 px-2' : 'gap-1 px-4', rechts ? 'justify-end text-right' : 'text-left', actief ? 'text-slate-800' : 'text-slate-500')}>
        {/* Rechts uitgelijnd: de pijl vóór de tekst, zodat de koptekst op
            dezelfde rechterrand staat als de cijfers eronder (de onzichtbare
            pijl erachter schoof hem 16 px naar links, "Toestellen"). */}
        {rechts && pijl}
        <span>{children}</span>
        {!rechts && pijl}
      </button>
    </Th>
  );
}

/** Selectievakje in huisstijl (oker vinkje op carbon), 44 px raakvlak op touch. */
export function Checkbox({ checked, onChange, label, indeterminate, className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type'> & {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Toegankelijke naam (het zichtbare label staat meestal in de rij ernaast). */
  label: string;
  indeterminate?: boolean;
  className?: string;
}) {
  return (
    <label className={cn('inline-flex min-h-11 min-w-11 sm:pointer-fine:min-h-6 sm:pointer-fine:min-w-6 cursor-pointer items-center justify-center', className)}>
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        aria-label={label}
        ref={(el) => { if (el) el.indeterminate = Boolean(indeterminate) && !checked; }}
        onChange={(e) => onChange(e.target.checked)}
        {...rest}
      />
      <span
        aria-hidden="true"
        className={cn(
          'inline-flex h-[18px] w-[18px] items-center justify-center rounded-md border transition-colors peer-focus-visible:focus-ring',
          // Selectie in carbon, niet in goud (punt 4): aanvinken is geen actie.
          // De focus-ring blijft wél goud.
          checked || indeterminate ? 'border-keuze bg-keuze text-keuze-tekst' : 'border-slate-300 bg-paper text-transparent hover:border-slate-400',
        )}
      >
        {indeterminate && !checked ? <span className="h-0.5 w-2.5 rounded-full bg-keuze-tekst" /> : <Check size={12} strokeWidth={3} />}
      </span>
    </label>
  );
}

/**
 * Bulk-balk boven een tabel: "N geselecteerd" + acties; verschijnt alleen bij
 * selectie. Klapt open (hoogte + opacity, veer op DUR.base) en dicht (EASE,
 * DUR.fast) i.p.v. de tabel in één frame omlaag te duwen (golf 2, punt 9).
 * `overflow: hidden` staat alleen tijdens de beweging, zodat de ring van de
 * balk daarna niet wordt afgeknipt. Reduced motion: geen beweging.
 */
export function BulkBar({ aantal, onWis, children, className }: { aantal: number; onWis: () => void; children: ReactNode; className?: string }) {
  const reduced = useReducedMotion();
  const [bezig, setBezig] = useState(false);
  // Haptische tik zodra de balk verschijnt (eerste selectie), niet bij elke
  // volgende rij en niet bij het sluiten (src/lib/tik.ts).
  const zichtbaar = aantal > 0;
  useEffect(() => {
    if (zichtbaar) tik('bulk');
  }, [zichtbaar]);
  return (
    <AnimatePresence initial={false}>
      {aantal > 0 && (
        <motion.div
          key="bulkbar"
          initial={{ opacity: 0, height: 0, y: -4 }}
          animate={{ opacity: 1, height: 'auto', y: 0, transition: reduced ? { duration: 0 } : { duration: DUR.base, ease: EASE_SPRING } }}
          exit={{ opacity: 0, height: 0, y: -4, transition: reduced ? { duration: 0 } : { duration: DUR.fast, ease: EASE } }}
          onAnimationStart={() => setBezig(true)}
          onAnimationComplete={() => setBezig(false)}
          style={{ overflow: bezig ? 'hidden' : 'visible' }}
        >
          <div className={cn('flex flex-wrap items-center gap-2.5 rounded-xl bg-paper ring-1 ring-hairline-strong elev-1 px-3 py-2', className)} role="region" aria-label="Bulkacties">
            <span className="text-sm font-semibold text-slate-900 tabular-nums">{aantal} geselecteerd</span>
            <IconButton label="Selectie wissen" size="sm" onClick={onWis}><X size={14} /></IconButton>
            <div className="ml-auto flex flex-wrap items-center gap-2">{children}</div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Waar of een element binnen `#hoofdinhoud` een scrollcontainer als
 *  voorouder heeft (overflow auto/scroll/hidden; `clip` telt niet). */
function inScrollcontainer(el: HTMLElement): boolean {
  for (let p = el.parentElement; p && p.id !== 'hoofdinhoud' && p !== document.body; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (/(auto|scroll|hidden)/.test(`${s.overflowX} ${s.overflowY}`)) return true;
  }
  return false;
}

/** thead die onder de sticky topbar blijft hangen tijdens het scrollen. */
export function StickyThead({ children, className }: { children: ReactNode; className?: string }) {
  // top = --sticky-top (topbar-hoogte + iOS-statusbalk-inset, index.css):
  // de scroll-root is de pagina en de topbar plakt daar bovenaan. Vroeger
  // een geraden 3,25 rem, die de safe-area en de touch-hoogte negeerde.
  //
  // Ronde 5 (B1): `position: sticky` rekent tegen de dichtstbijzijnde
  // scrollcontainer. Staat de tabel in een `overflow-x-auto`-wrapper (nodig
  // voor brede tabellen op smalle schermen), dan is dát de scrollport en
  // duwt `top: --sticky-top` de kop meteen ±56 px omlaag, over de eerste
  // rij heen (Dagadministratie, Dienstopbouw, Looncontrole, Werkprestaties).
  // De kop plakt dus alleen als er géén scrollcontainer tussen zit
  // (`TableShell sticky` gebruikt `xl:overflow-clip` precies daarvoor);
  // anders is hij gewoon statisch. Gemeten bij mount en bij resize, want
  // de wrapper wisselt per breakpoint.
  const ref = useRef<HTMLTableSectionElement>(null);
  const [statisch, setStatisch] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const meet = () => setStatisch(inScrollcontainer(el));
    meet();
    window.addEventListener('resize', meet);
    return () => window.removeEventListener('resize', meet);
  }, []);
  return (
    <thead
      ref={ref}
      className={cn(
        statisch ? 'static' : 'sticky top-[var(--sticky-top)] z-sticky-kop backdrop-blur-[2px]',
        'bg-surface-white/95 [&_th]:border-b [&_th]:border-slate-200',
        className,
      )}
    >
      {children}
    </thead>
  );
}

/** Simpele paginering: "1–25 van 240" met vorige/volgende. */
export function Paginering({ totaal, perPagina, pagina, onPagina, className }: { totaal: number; perPagina: number; pagina: number; onPagina: (p: number) => void; className?: string }) {
  const paginas = Math.max(1, Math.ceil(totaal / perPagina));
  const van = totaal === 0 ? 0 : (pagina - 1) * perPagina + 1;
  const tot = Math.min(totaal, pagina * perPagina);
  if (totaal <= perPagina) return null;
  return (
    <div className={cn('flex items-center justify-between gap-3 px-4 py-2.5 text-xs font-medium text-slate-500', className)}>
      <span className="tabular-nums">{van}–{tot} van {totaal}</span>
      <span className="inline-flex items-center gap-1">
        <IconButton label="Vorige pagina" size="sm" variant="secondary" disabled={pagina <= 1} onClick={() => onPagina(pagina - 1)}><ArrowUp size={14} className="-rotate-90" /></IconButton>
        <span className="px-1 tabular-nums">{pagina} / {paginas}</span>
        <IconButton label="Volgende pagina" size="sm" variant="secondary" disabled={pagina >= paginas} onClick={() => onPagina(pagina + 1)}><ArrowUp size={14} className="rotate-90" /></IconButton>
      </span>
    </div>
  );
}

/**
 * Een rij die een record opent (bewerken, detail): de hoofdcel draagt een
 * echte knop, zodat Tab + Enter/Spatie hetzelfde doen als klikken, en er is
 * geen apart potlood meer nodig. Zet op de `<tr>` `onClick={rijKlik(open)}`
 * als muisgemak: een klik ergens in de rij opent dan ook, behalve op een
 * eigen knop, link of invoer in die rij (tranche 3B, 23-09).
 */
export function CelKnop({ onClick, label, className, children }: {
  onClick: () => void;
  /** Toegankelijke naam als de zichtbare tekst niet zegt wat er gebeurt ("Vervaldata van X bewerken"). */
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    // rauw: tekstknop in een tabelcel (naam + metaregel), Button centreert en dwingt min-h en semibold af
    <button type="button" onClick={onClick} aria-label={label} className={cn('tikbaar -mx-1.5 -my-1 block max-w-full rounded-lg px-1.5 py-1 text-left', className)}>
      {children}
    </button>
  );
}

/**
 * Klikhandler voor een `<tr>` die ook via een `CelKnop` opent: klikken op een
 * interactief element in de rij tellen niet, en ook niets uit een portal (een
 * menu of dialoog bubbelt in React door naar de rij, maar staat er niet in).
 */
export const rijKlik = (open: () => void) => (e: MouseEvent<HTMLElement>) => {
  const doel = e.target as HTMLElement;
  if (!e.currentTarget.contains(doel)) return;
  if (doel.closest('button, a, input, select, textarea, label, [role="menuitem"]')) return;
  open();
};

