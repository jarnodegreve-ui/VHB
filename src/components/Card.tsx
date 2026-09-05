import { forwardRef, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../lib/ui';

/**
 * Kaart — hét oppervlak van de app. Eén radius (3xl = 18 px), drie paddings,
 * één rand en schaduw via `.surface-card` (met dark-variant in index.css).
 *
 * `padding`: sm = compacte lijst-/tegelkaart (p-4), md = standaard (p-5/6),
 * lg = ruime beheerkaart (p-6/8). `interactive` geeft hover-lift + cursor
 * (alleen op pointer-fine; zie .surface-card-hover). `tone="muted"` is het
 * ingezonken vlak binnen een kaart (`.surface-muted`, 2xl), `tone="dashed"`
 * de lege-staat-kaart. `as` voor <section>/<article>/<button>.
 */
type CardPadding = 'none' | 'sm' | 'md' | 'lg';
type CardTone = 'default' | 'muted' | 'dashed' | 'accent' | 'warning' | 'danger' | 'success' | 'info';

const CARD_PADDING: Record<CardPadding, string> = {
  none: '',
  sm: 'p-4',
  md: 'p-5 md:p-6',
  lg: 'p-6 md:p-8',
};

const CARD_TONE: Record<CardTone, string> = {
  default: 'surface-card rounded-3xl',
  muted: 'surface-muted rounded-2xl',
  dashed: 'surface-card rounded-3xl !border-dashed',
  // Callouts: één tint per betekenis, zonder schaduw (het vlak zelf is het
  // signaal). accent = merk-oker (welkom, samenvatting), de rest semantisch.
  accent: 'rounded-2xl border border-oker-200/70 bg-oker-50',
  warning: 'rounded-2xl border border-amber-200 bg-amber-50',
  danger: 'rounded-2xl border border-red-200 bg-red-50',
  success: 'rounded-2xl border border-emerald-200 bg-emerald-50',
  info: 'rounded-2xl border border-blue-200 bg-blue-50',
};

export const Card = forwardRef<HTMLElement, HTMLAttributes<HTMLElement> & {
  padding?: CardPadding;
  tone?: CardTone;
  interactive?: boolean;
  as?: 'div' | 'section' | 'article' | 'li';
  children?: ReactNode;
}>(function Card({ padding = 'md', tone = 'default', interactive = false, as: Tag = 'div', className, children, ...rest }, ref) {
  return (
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    <Tag ref={ref as any} className={cn(CARD_TONE[tone], CARD_PADDING[padding], interactive && 'surface-card-hover', className)} {...rest}>
      {children}
    </Tag>
  );
});

/**
 * Kop van een kaart of sectie: optionele eyebrow (micro-label), titel als
 * <h2> in de kaarttitel-rol, optionele beschrijving en een `aside`-slot
 * rechts (telling, knop, filter). Vervangt de zes handgeschreven
 * sectiekop-dialecten (font-semibold/bold, slate-800/900, met/zonder
 * tracking) door één vorm. `size="lg"` voor de grotere beheer-subsectie
 * (verving de oude AdminSubsectionHeader uit ui.tsx, verwijderd 05-09).
 */
export function CardHeader({
  eyebrow,
  title,
  description,
  aside,
  icon,
  size = 'md',
  className,
}: {
  eyebrow?: string;
  title: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  /** Klein icoon links van de titel (in een gedempte tegel). */
  icon?: ReactNode;
  size?: 'md' | 'lg';
  className?: string;
}) {
  // md: één rij, aside rechts (schakelaar, teller, kleine knop) — ook op
  // mobiel, anders zakt een Switch onder z'n eigen label. lg: titelblok
  // krijgt flex-1 en de aside mag wrappen (badges/knoppenrijen); op smal
  // scherm stapelt hij onder de titel.
  const lg = size === 'lg';
  return (
    <div className={cn('flex gap-3', lg ? 'flex-col md:flex-row md:items-end md:justify-between' : 'flex-row flex-wrap items-start', className)}>
      {/* md: titelblok claimt 60 % en groeit; een kleine aside (Switch, teller)
          past ernaast, een brede (knop op mobiel) wrapt naar een eigen regel
          i.p.v. de titel plat te drukken. lg: geen flex-basis, anders drukt
          een brede badge-rij de titel plat. */}
      <div className={cn('flex min-w-0 items-start gap-2.5', !lg && 'flex-[1_1_60%]')}>
        {icon ? (
          <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-500/12 text-slate-600">{icon}</span>
        ) : null}
        <div className="min-w-0 max-w-3xl">
          {eyebrow ? <p className="text-micro">{eyebrow}</p> : null}
          <h2 className={cn(lg ? 'text-section-title' : 'text-card-title', eyebrow && 'mt-1')}>{title}</h2>
          {description ? <p className="mt-1 text-sm font-normal leading-relaxed text-slate-500">{description}</p> : null}
        </div>
      </div>
      {aside ? <div className={cn('flex items-center gap-2.5', lg ? 'flex-wrap md:justify-end' : 'ml-auto shrink-0')}>{aside}</div> : null}
    </div>
  );
}
