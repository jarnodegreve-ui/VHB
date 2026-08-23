import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/ui';

/**
 * Primitieven van het VHB design-systeem.
 *
 * Eén bron van waarheid voor knoppen, badges, micro-labels en tabellen —
 * views componeren deze i.p.v. eigen className-soep te brouwen. Alle
 * kleurklassen hier hebben een dark-override in index.css.
 */

// === Button ===

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'success' | 'danger' | 'dangerSolid';
type ButtonSize = 'sm' | 'md' | 'lg';

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'btn-primary',
  secondary: 'control-button-soft text-slate-700 hover:text-slate-900',
  ghost: 'text-slate-500 hover:text-slate-800 hover:bg-slate-100/70',
  success: 'bg-emerald-700 text-white hover:bg-emerald-800 shadow-lg shadow-emerald-700/20',
  danger: 'bg-white/90 border border-red-200 text-red-600 hover:bg-red-50',
  // red-600 als basis: wit op red-500 haalt maar ~3,8:1 — onder AA voor
  // 13-14px tekst, uitgerekend op de "Verwijderen"-knoppen.
  dangerSolid: 'bg-red-600 text-white hover:bg-red-700 shadow-lg shadow-red-600/20',
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
  oker: { chip: 'border-oker-200 bg-oker-50 text-oker-700', dot: 'bg-oker-500' },
  emerald: { chip: 'border-emerald-100 bg-emerald-50 text-emerald-700', dot: 'bg-emerald-500' },
  red: { chip: 'border-red-100 bg-red-50 text-red-700', dot: 'bg-red-500' },
  amber: { chip: 'border-amber-100 bg-amber-50 text-amber-700', dot: 'bg-amber-500' },
  blue: { chip: 'border-blue-100 bg-blue-50 text-blue-700', dot: 'bg-blue-500' },
};

export function Badge({
  tone = 'slate',
  dot = false,
  icon,
  className,
  title,
  children,
}: {
  tone?: BadgeTone;
  /** Status-dot vóór het label (voor live/lopende toestanden). */
  dot?: boolean;
  icon?: ReactNode;
  className?: string;
  /** Native tooltip (bv. bevestigingstijdstip bij het gezien-vinkje). */
  title?: string;
  children: ReactNode;
}) {
  const t = BADGE_TONES[tone];
  return (
    <span title={title} className={cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-2xs font-medium', t.chip, className)}>
      {dot && <span className={cn('h-1.5 w-1.5 rounded-full', t.dot)} />}
      {icon}
      {children}
    </span>
  );
}

/** Status van een aanvraag (verlof/ruil) als consistente badge. */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const map: Record<string, { tone: BadgeTone; label: string }> = {
    pending: { tone: 'amber', label: 'In behandeling' },
    accepted: { tone: 'blue', label: 'Wacht op planner' },
    approved: { tone: 'emerald', label: 'Goedgekeurd' },
    rejected: { tone: 'red', label: 'Afgewezen' },
    cancelled: { tone: 'slate', label: 'Geannuleerd' },
    completed: { tone: 'emerald', label: 'Afgerond' },
  };
  const m = map[status] ?? { tone: 'slate' as BadgeTone, label: status };
  return <Badge tone={m.tone} dot className={className}>{m.label}</Badge>;
}

// === MicroLabel ===

/** Het uppercase micro-label — ALLEEN voor sectie-eyebrows (paneelkopjes,
 *  eyebrow boven een PageHeader). Veldlabels en tabelkoppen zijn sentence-
 *  case (zie Th); als álles een eyebrow is, is niets het meer.
 *  slate-500 (niet -400): -400 haalt op wit maar ~2,8:1 contrast. */
export function MicroLabel({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <p className={cn('text-2xs font-medium uppercase tracking-[0.08em] text-slate-500', className)}>
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
    actief ? 'bg-oker-500 text-slate-950 shadow-sm shadow-oker-500/30' : 'text-slate-500 hover:text-slate-700',
    className,
  );
}

// === Tabel-primitieven ===

/** Wrapper: kaart-oppervlak + horizontale scroll op smal scherm. */
export function TableShell({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('surface-table rounded-3xl overflow-hidden', className)}>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

export function Th({ className, children, title, sort }: { className?: string; children?: ReactNode; title?: string; sort?: 'ascending' | 'descending' }) {
  // Sentence-case, geen caps: tabelkoppen zijn leestekst, geen eyebrow.
  // `sort` zet aria-sort voor sorteerbare kolommen (maandoverzicht).
  return (
    <th title={title} aria-sort={sort} className={cn('px-4 py-3 sm:pointer-fine:py-2.5 text-left text-xs font-medium text-slate-500 whitespace-nowrap', className)}>
      {children}
    </th>
  );
}

export function Td({ className, children }: { className?: string; children?: ReactNode }) {
  // Compacter op desktop-met-muis (dispatch-dichtheid); op touch blijft de
  // rij hoog genoeg als raakvlak.
  return <td className={cn('px-4 py-3 sm:pointer-fine:py-2.5 text-sm text-slate-700', className)}>{children}</td>;
}
