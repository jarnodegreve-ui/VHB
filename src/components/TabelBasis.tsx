import { createContext, useContext, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '../lib/ui';

/**
 * De tabel-basis (tranche 3B, 23-09): TableShell, Tabel, Th en Td in een eigen,
 * lichte module. Niet in primitives.tsx, want die zit in de startbundel en
 * sleepte elke gebruikte export mee naar index-*.js (74,24 > 74 kB); niet
 * alleen in Table.tsx, want schermen in de warmup (rooster, dienstruil) die
 * alleen het kader nodig hebben, trokken dan ook menu's, bulkbalk en motion
 * mee. Table.tsx exporteert deze vier door.
 */

// === Tabel-primitieven ===

/**
 * Toegankelijke naam van de tabel in een `TableShell`: `Tabel` leest hem als
 * er geen eigen `label` meegegeven is (tranche 3B, 23-09).
 */
const TabelLabelContext = createContext<string | undefined>(undefined);

/**
 * Het tabelkader: kaartvlak (`surface-table`), afgeronde rand, optioneel een
 * kop (toolbar, filters, bulkbalk) met een hairline eronder, en de tabel.
 * Schermen rollen de wrapper `div.surface-table rounded-3xl overflow-clip`
 * plus het kopblok dus niet meer zelf (tranche 3B, 23-09).
 *
 * Overloop, drie standen (de buitenrand is altijd `overflow-clip`, dat is
 * geen scrollcontainer en laat een plakkende kop dus heel):
 * - standaard: de tabel schuift horizontaal in haar kader; de kolomkop plakt
 *   dan niet (zie StickyThead).
 * - `sticky`: schuiven onder xl, vanaf xl geen scrollcontainer zodat
 *   `StickyThead` onder de topbar blijft hangen.
 * - `past`: nooit een scrollcontainer, de kop plakt op elke breedte. Alleen
 *   voor een tabel die in haar kader past waar ze getoond wordt (op de
 *   telefoon een kaartlijst, of vaste kolombreedtes); wat niet past wordt
 *   afgeknipt, dus meet het na.
 *
 * `label` = de toegankelijke naam: `<Tabel>` zet hem als `aria-label` op de
 * `<table>`. Schuift de tabel echt (gemeten), dan wordt de scrollstrook een
 * focusbare `role="region"` met dezelfde naam, zodat ze ook zonder muis te
 * verschuiven is (axe: scrollable-region-focusable); anders blijft ze een
 * gewone div.
 *
 * Wissel tabel ↔ kaartlijst: `hidden md:block` / `md:hidden` (CSS, md =
 * 768 px). Een scherm wijkt daar alleen van af met een reden in de code
 * (Planningscodes en Beheer dienstoverzicht: container query, de kolom
 * naast zijbalk en zijvak is smaller dan het scherm doet vermoeden).
 */
export function TableShell({ className, sticky = false, past = false, label, kop, children }: {
  className?: string;
  /** Kolomkop mag vanaf xl plakken (StickyThead): daar geen scrollcontainer. */
  sticky?: boolean;
  /** De tabel past altijd in haar kader: geen scrollcontainer, de kop plakt op elke breedte. */
  past?: boolean;
  /** Toegankelijke naam van de tabel (en van de scrollstrook als die schuift). */
  label?: string;
  /** Kopblok boven de tabel (TableToolbar, CardHeader, BulkBar), met een hairline eronder. */
  kop?: ReactNode;
  children: ReactNode;
}) {
  const strook = useRef<HTMLDivElement>(null);
  const [schuift, setSchuift] = useState(false);
  useLayoutEffect(() => {
    const el = strook.current;
    if (!el || past) return;
    const meet = () => setSchuift(el.scrollWidth > el.clientWidth + 1);
    meet();
    if (typeof ResizeObserver === 'undefined') return;
    const waarnemer = new ResizeObserver(meet);
    waarnemer.observe(el);
    for (const kind of Array.from(el.children)) waarnemer.observe(kind);
    return () => waarnemer.disconnect();
  }, [past, children]);
  return (
    <TabelLabelContext.Provider value={label}>
      <div className={cn('surface-table rounded-3xl overflow-clip', className)}>
        {kop ? <div className="border-b border-hairline px-5 py-4 md:px-6">{kop}</div> : null}
        <div
          ref={strook}
          className={past ? undefined : sticky ? 'overflow-x-auto xl:overflow-visible' : 'overflow-x-auto'}
          {...(schuift && !past ? { role: 'region', 'aria-label': label ?? 'Tabel', tabIndex: 0 } : {})}
        >
          {children}
        </div>
      </div>
    </TabelLabelContext.Provider>
  );
}

/**
 * De `<table>` zelf: volle breedte, links uitgelijnd, samengevallen randen.
 * `label` wint van het label van de omliggende `TableShell`.
 */
export function Tabel({ label, className, children }: { label?: string; className?: string; children: ReactNode }) {
  const kaderLabel = useContext(TabelLabelContext);
  return <table aria-label={label ?? kaderLabel} className={cn('w-full border-collapse text-left', className)}>{children}</table>;
}

export function Th({ className, children, title, sort, num = false, scope = 'col' }: {
  className?: string;
  children?: ReactNode;
  title?: string;
  sort?: 'ascending' | 'descending';
  /** Kolom met getallen/tijden: rechts uitgelijnd (Td num doet de rest). */
  num?: boolean;
  /** Waarvoor de kop geldt; standaard de kolom, `row` voor een rijkop of totaalregel. */
  scope?: 'col' | 'row' | 'colgroup' | 'rowgroup';
}) {
  // Sentence-case, geen caps: tabelkoppen zijn leestekst, geen eyebrow.
  // `sort` zet aria-sort voor sorteerbare kolommen (maandoverzicht).
  return (
    <th scope={scope} title={title} aria-sort={sort} className={cn('px-4 py-3 text-xs font-medium text-slate-500 whitespace-nowrap', num ? 'text-right' : 'text-left', className)}>
      {children}
    </th>
  );
}

export function Td({ className, children, num = false, nowrap = false }: {
  className?: string;
  children?: ReactNode;
  /** Cel met getal/tijd/grootte: rechts uitgelijnd, tabular-nums, niet afbrekend — zodat kolommen cijfer onder cijfer staan. */
  num?: boolean;
  /** Links uitgelijnd maar niet afbrekend: datums, tijdvakken, dienst- en loopnummers, codes. */
  nowrap?: boolean;
}) {
  // Compacter op desktop-met-muis (dispatch-dichtheid); op touch blijft de
  // rij hoog genoeg als raakvlak. tabular-nums staat al op <body>; `num`
  // herhaalt het expliciet en lijnt rechts uit.
  return <td className={cn('px-4 py-3 text-sm text-slate-700', num && 'text-right tabular-nums whitespace-nowrap', nowrap && 'whitespace-nowrap', className)}>{children}</td>;
}
