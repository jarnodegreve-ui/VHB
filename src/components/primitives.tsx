import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/ui';

/**
 * Primitieven van het VHB design-systeem.
 *
 * Eén bron van waarheid voor knoppen, badges, micro-labels en tabellen —
 * views componeren deze i.p.v. eigen className-soep te brouwen. Kleuren
 * volgen automatisch de omgekeerde schalen in dark mode (index.css).
 *
 * Regel: geen rauwe <button> in views — Button, IconButton, FilterChip of
 * Switch. Kaarten via <Card>, velden via <Field>/<Input> (Card.tsx, Field.tsx).
 */

// === Button ===

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'success' | 'warning' | 'danger' | 'dangerSolid' | 'ink';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: 'control-button-soft text-slate-700 hover:text-slate-900',
  ghost: 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/70',
  success: 'bg-emerald-600 text-white hover:bg-emerald-600/90 shadow-lg shadow-emerald-600/20',
  danger: 'bg-paper/90 border border-red-200 text-red-700 hover:bg-red-50',
  // red-600 als basis: wit op red-500 haalt maar ~3,8:1 — onder AA voor
  // 13-14px tekst, uitgerekend op de "Verwijderen"-knoppen.
  dangerSolid: 'bg-red-600 text-white hover:bg-red-600/90 shadow-lg shadow-red-600/20',
  // warning = semantisch amber (callout-knoppen), altijd carbon-tekst op amber.
  warning: 'bg-amber-500 text-slate-950 hover:bg-amber-400 shadow-sm shadow-amber-500/20',
  // ink = altijd-donkere solide knop (print, agenda-koppeling) — flipt niet.
  ink: 'bg-ink text-white hover:bg-ink-soft shadow-sm',
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  // min-h-11 ook op sm: de compacte maat mag optisch klein blijven, maar niet
  // ónder het 44px-aanraakminimum zakken (handschoenen, buiten). Op een fijne
  // pointer (muis) krimpt hij naar de oorspronkelijke 32px, zoals de rest van
  // de app dat met sm:pointer-fine: doet.
  sm: 'gap-1.5 rounded-lg px-3 py-2 text-xs min-h-11 sm:pointer-fine:min-h-8',
  md: 'gap-2 rounded-xl px-4 py-2.5 text-sm min-h-11',
  lg: 'gap-2 rounded-xl px-5 py-3 text-sm min-h-12',
};

export const Button = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Icoon links van het label (lucide, maat zelf meegeven). */
  icon?: ReactNode;
  /** Volle breedte (formulieren, kaart-acties). */
  full?: boolean;
}>(function Button({ variant = 'secondary', size = 'md', icon, full, className, children, type = 'button', ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(
        'ios-pressable inline-flex items-center justify-center font-semibold transition-all',
        'disabled:cursor-not-allowed disabled:opacity-50',
        BUTTON_VARIANTS[variant],
        BUTTON_SIZES[size],
        full && 'w-full',
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});

// === Badge ===

export type BadgeTone = 'slate' | 'oker' | 'emerald' | 'red' | 'amber' | 'blue';

const BADGE_TONES: Record<BadgeTone, { chip: string; dot: string }> = {
  slate: { chip: 'border-slate-200 bg-surface-soft text-slate-600', dot: 'bg-slate-400' },
  oker: { chip: 'border-oker-200 bg-oker-50 text-oker-800', dot: 'bg-oker-500' },
  emerald: { chip: 'border-emerald-100 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  red: { chip: 'border-red-100 bg-red-50 text-red-700', dot: 'bg-red-500' },
  amber: { chip: 'border-amber-100 bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  blue: { chip: 'border-blue-100 bg-blue-50 text-blue-700', dot: 'bg-blue-500' },
};

export function Badge({
  tone = 'slate',
  dot = false,
  stil = false,
  icon,
  className,
  title,
  children,
}: {
  tone?: BadgeTone;
  /** Status-dot vóór het label (voor live/lopende toestanden). */
  dot?: boolean;
  /** Stil: neutrale chip met alleen een gekleurd puntje in `tone` — voor
   *  informatieve status (actief, geconfigureerd, gelezen). Kleur op het
   *  hele vlak alleen als er iets fout of dringend is (afwerking 04-09, nr. 6). */
  stil?: boolean;
  icon?: ReactNode;
  className?: string;
  /** Native tooltip (bv. bevestigingstijdstip bij het gezien-vinkje). */
  title?: string;
  children: ReactNode;
}) {
  const t = BADGE_TONES[tone];
  const chip = stil ? BADGE_TONES.slate.chip : t.chip;
  return (
    <span title={title} className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-medium', chip, className)}>
      {(dot || stil) && <span className={cn('h-1.5 w-1.5 rounded-full', t.dot)} />}
      {icon}
      {children}
    </span>
  );
}

/** Toon + label per aanvraagstatus (verlof/ruil). Eén bron: de gebruikers-
 *  historiek had een eigen kopie ('Voltooid' i.p.v. 'Afgerond') en de verlof-
 *  historiek een losse accentkleur-map (controle-ronde 27-08, bevinding 22). */
const STATUS_TONES: Record<string, { tone: BadgeTone; label: string }> = {
  pending: { tone: 'amber', label: 'In behandeling' },
  accepted: { tone: 'blue', label: 'Wacht op planner' },
  approved: { tone: 'emerald', label: 'Goedgekeurd' },
  rejected: { tone: 'red', label: 'Afgewezen' },
  cancelled: { tone: 'slate', label: 'Geannuleerd' },
  completed: { tone: 'emerald', label: 'Afgerond' },
};
const statusTone = (status: string) => STATUS_TONES[status] ?? { tone: 'slate' as BadgeTone, label: status };

/** Status van een aanvraag (verlof/ruil) als consistente badge. */
export function StatusBadge({ status, className, stil }: { status: string; className?: string; /** Neutrale chip + gekleurd puntje (zie Badge). */ stil?: boolean }) {
  const m = statusTone(status);
  // Afgewezen/dringend blijft gekleurd: dat is een signaal, geen status.
  const kleur = stil && m.tone !== 'red' ? { stil: true } : { dot: true };
  return <Badge tone={m.tone} {...kleur} className={className}>{m.label}</Badge>;
}

/** Accentkleur (bg-klasse) van een status — voor een statusstreep langs een
 *  kaart; dezelfde tint als de dot van StatusBadge. */
export const statusAccentClass = (status: string): string => BADGE_TONES[statusTone(status).tone].dot;

// === MicroLabel ===

/** Het uppercase micro-label — ALLEEN voor sectie-eyebrows (paneelkopjes,
 *  eyebrow boven een PageHeader). Veldlabels en tabelkoppen zijn sentence-
 *  case (zie Th); als álles een eyebrow is, is niets het meer.
 *  slate-500 (niet -400): -400 haalt op wit maar ~2,8:1 contrast. */
/** Dezelfde klassen als losse string — voor plekken waar een <p> niet past
 *  (<label htmlFor>, <span> in een flex-kop, een knop). Zo blijft er één bron
 *  i.p.v. ±35 ad-hoc kopieën in slate-400/font-bold (controle-ronde 27-08,
 *  bevinding 14). */
export const microLabelClass = 'text-micro';

export function MicroLabel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <p className={cn(microLabelClass, className)}>
      {children}
    </p>
  );
}

// === Segmented control ===

/**
 * Eén dialect voor het segmented-control-patroon (sorteer-/filterschakelaars
 * op een `glass-segmented`-rail). Er waren er drie — amber-gevuld, glass-chip
 * en witte chip; dit is de amber-gevulde (de recentste, o.a. ScheduleView en
 * OCPI). `segItemClass(actief)` geeft de knop-klassen; de rail zelf blijft
 * `glass-segmented … p-1` bij de aanroeper (verschillende radius/breedte).
 */
export function segItemClass(actief: boolean, className?: string) {
  return cn(
    'ios-pressable rounded-xl px-3.5 py-2 text-xs font-semibold transition-all',
    // Actief = neutrale 'papieren' chip (iOS/Linear-patroon) i.p.v. vol goud:
    // een schakelaar is geen actie, en naast een gouden knop (Ziek melden)
    // gaf dat twee gouden vlakken in één kop (controle 05-09, nr. 19).
    actief ? 'bg-paper text-slate-900 shadow-sm ring-1 ring-hairline' : 'text-slate-500 hover:text-slate-700',
    className,
  );
}

// === FilterChip ===

type FilterChipTone = 'oker' | 'red';

const FILTER_CHIP_TONES: Record<FilterChipTone, { on: string; off: string }> = {
  oker: {
    on: 'bg-oker-500 text-slate-950 shadow-sm shadow-oker-500/30',
    off: 'control-button-soft text-slate-600 hover:text-slate-900',
  },
  // Foutfilter (onbekende codes in de planningsmatrix): rood blijft rood,
  // maar in dezelfde vorm als de gewone chip.
  red: {
    on: 'bg-red-600 text-white shadow-sm shadow-red-600/20',
    off: 'border border-red-200 bg-paper/90 text-red-700 hover:bg-red-50',
  },
};

/**
 * Losse filterchip (aan/uit) búiten een segmented-rail: snelfilters, categorie-
 * pillen, dienstnummers in een dag-type. Eén dialect voor wat er vier waren
 * (omlijnde oker-50-pil, gevulde rounded-2xl-pil, rounded-lg-ring-chip en een
 * rode rounded-full) — controle-ronde 27-08, bevinding 18. Actief = oker
 * gevuld met VHB Black-tekst (zoals de segmented-control), inactief = zachte
 * secondary-knop. Raakvlak 44 px op touch, 32 px met een muis.
 */
export function FilterChip({ active, tone = 'oker', icon, className, children, type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  active: boolean;
  tone?: FilterChipTone;
  icon?: ReactNode;
}) {
  const t = FILTER_CHIP_TONES[tone];
  return (
    <button
      type={type}
      aria-pressed={active}
      className={cn(
        'ios-pressable inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition-all sm:pointer-fine:min-h-8',
        active ? t.on : t.off,
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
}

// === IconButton ===

type IconButtonVariant = 'ghost' | 'secondary' | 'danger' | 'success' | 'primary';
type IconButtonSize = 'sm' | 'md';

const ICON_BUTTON_VARIANTS: Record<IconButtonVariant, string> = {
  ghost: 'text-slate-500 hover:bg-slate-100 hover:text-slate-800',
  secondary: 'control-button-soft text-slate-600 hover:text-slate-900',
  danger: 'text-slate-400 hover:bg-red-50 hover:text-red-700',
  success: 'text-slate-400 hover:bg-emerald-50 hover:text-emerald-700',
  primary: 'bg-oker-500 text-slate-950 hover:bg-oker-400 shadow-sm shadow-oker-500/30',
};

const ICON_BUTTON_SIZES: Record<IconButtonSize, string> = {
  // Raakvlak altijd 44 px op touch; met een muis krimpt de knop naar 32/36.
  sm: 'h-11 w-11 sm:pointer-fine:h-8 sm:pointer-fine:w-8 rounded-lg',
  md: 'h-11 w-11 sm:pointer-fine:h-9 sm:pointer-fine:w-9 rounded-xl',
};

/**
 * Knop met alléén een icoon. `label` is verplicht en wordt de toegankelijke
 * naam (aria-label) én de native tooltip. Vervangt de ±50 handgeschreven
 * `h-11 w-11 rounded-xl`-knoppen (sluiten, bewerken, verwijderen, historiek).
 */
export const IconButton = forwardRef<HTMLButtonElement, Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  children: ReactNode;
}>(function IconButton({ label, variant = 'ghost', size = 'md', className, children, type = 'button', ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={rest.title ?? label}
      className={cn(
        'ios-pressable inline-flex shrink-0 items-center justify-center transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        ICON_BUTTON_VARIANTS[variant],
        ICON_BUTTON_SIZES[size],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

// === Chip (code) ===

type ChipTone = 'slate' | 'oker' | 'emerald' | 'red' | 'amber' | 'blue' | 'rose';

const CHIP_TONES: Record<ChipTone, string> = {
  slate: 'bg-surface-muted text-slate-700',
  oker: 'bg-oker-500/15 text-oker-700',
  emerald: 'bg-emerald-50 text-emerald-700',
  red: 'bg-red-50 text-red-700',
  amber: 'bg-amber-50 text-amber-700',
  blue: 'bg-blue-50 text-blue-700',
  rose: 'bg-rose-50 text-rose-700',
};

/**
 * Compacte code-chip: een getal of code in monospace (dienst-/loopnummer,
 * teller, matrixcode) — de derde chipvorm naast Badge (status, pil) en
 * FilterChip (aan/uit). Radius md (6 px), geen rand; `ServiceChip` is de
 * domeinvariant hiervan voor dienstnummers.
 */
export function Chip({ tone = 'slate', mono = true, className, title, children }: {
  tone?: ChipTone;
  mono?: boolean;
  className?: string;
  title?: string;
  children: ReactNode;
}) {
  return (
    <span title={title} className={cn('inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-2xs font-semibold tabular-nums', mono && 'font-mono', CHIP_TONES[tone], className)}>
      {children}
    </span>
  );
}

// === Tabel-primitieven ===

/** Wrapper: kaart-oppervlak + horizontale scroll op smal scherm. */
export function TableShell({ className, sticky = false, children }: { className?: string; /** Kolomkop mag plakken (StickyThead): op md+ géén scrollcontainer, anders steelt die de sticky-context van de pagina. */ sticky?: boolean; children: ReactNode }) {
  return (
    <div className={cn('surface-table rounded-3xl', sticky ? 'overflow-x-auto xl:overflow-clip' : 'overflow-hidden', className)}>
      <div className={sticky ? undefined : 'overflow-x-auto'}>{children}</div>
    </div>
  );
}

export function Th({ className, children, title, sort, num = false }: { className?: string; children?: ReactNode; title?: string; sort?: 'ascending' | 'descending'; /** Kolom met getallen/tijden: rechts uitgelijnd (Td num doet de rest). */ num?: boolean }) {
  // Sentence-case, geen caps: tabelkoppen zijn leestekst, geen eyebrow.
  // `sort` zet aria-sort voor sorteerbare kolommen (maandoverzicht).
  return (
    <th title={title} aria-sort={sort} className={cn('px-4 py-3 text-xs font-medium text-slate-500 whitespace-nowrap', num ? 'text-right' : 'text-left', className)}>
      {children}
    </th>
  );
}

export function Td({ className, children, num = false }: { className?: string; children?: ReactNode; /** Cel met getal/tijd/grootte: rechts uitgelijnd, tabular-nums, niet afbrekend — zodat kolommen cijfer onder cijfer staan. */ num?: boolean }) {
  // Compacter op desktop-met-muis (dispatch-dichtheid); op touch blijft de
  // rij hoog genoeg als raakvlak. tabular-nums staat al op <body>; `num`
  // herhaalt het expliciet en lijnt rechts uit.
  return <td className={cn('px-4 py-3 text-sm text-slate-700', num && 'text-right tabular-nums whitespace-nowrap', className)}>{children}</td>;
}

// === Switch ===

/**
 * Schakelaar aan/uit — één dialect voor de hele app: oker = aan (zoals de
 * segmented-control), rustige uit-stand mét dark-override, en een raakvlak
 * van 44 px op touch (de zichtbare track blijft 24×44 px; met een muis krimpt
 * het raakvlak naar de track). Voorheen drie varianten (emerald h-6, oker
 * h-5, handgerold w-12) waarvan twee onder de 44 px zaten — controle-ronde
 * 27-08, bevindingen 12+13.
 */
export function Switch({ checked, onChange, label, disabled, className }: {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Toegankelijke naam (aria-label); het zichtbare label staat ernaast. */
  label: string;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'ios-pressable inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center sm:pointer-fine:min-h-6',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
    >
      <span className={cn('relative inline-flex h-6 w-11 items-center rounded-full transition-colors', checked ? 'bg-oker-500' : 'bg-slate-300')}>
        <span className={cn('inline-block h-5 w-5 rounded-full bg-surface-white shadow transition-transform', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} />
      </span>
    </button>
  );
}
