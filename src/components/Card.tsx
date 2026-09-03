import type { HTMLAttributes, ReactNode } from 'react';
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
type CardTone = 'default' | 'muted' | 'dashed';

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
};

export function Card({
  padding = 'md',
  tone = 'default',
  interactive = false,
  as: Tag = 'div',
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLElement> & {
  padding?: CardPadding;
  tone?: CardTone;
  interactive?: boolean;
  as?: 'div' | 'section' | 'article' | 'li';
  children?: ReactNode;
}) {
  return (
    <Tag className={cn(CARD_TONE[tone], CARD_PADDING[padding], interactive && 'surface-card-hover', className)} {...rest}>
      {children}
    </Tag>
  );
}

/**
 * Kop van een kaart of sectie: optionele eyebrow (micro-label), titel als
 * <h2> in de kaarttitel-rol, optionele beschrijving en een `aside`-slot
 * rechts (telling, knop, filter). Vervangt de zes handgeschreven
 * sectiekop-dialecten (font-semibold/bold, slate-800/900, met/zonder
 * tracking) door één vorm. `size="lg"` voor de grotere beheer-subsectie
 * (was AdminSubsectionHeader).
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
  return (
    <div className={cn('flex flex-col gap-3 md:flex-row md:items-end md:justify-between', className)}>
      <div className="flex min-w-0 items-start gap-2.5">
        {icon ? (
          <span className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-500/12 text-slate-600">{icon}</span>
        ) : null}
        <div className="min-w-0 max-w-3xl">
          {eyebrow ? <p className="text-micro">{eyebrow}</p> : null}
          <h2 className={cn(size === 'lg' ? 'text-section-title' : 'text-card-title', eyebrow && 'mt-1')}>{title}</h2>
          {description ? <p className="mt-1 text-sm font-normal leading-relaxed text-slate-500">{description}</p> : null}
        </div>
      </div>
      {aside ? <div className="flex shrink-0 flex-wrap items-center gap-2.5">{aside}</div> : null}
    </div>
  );
}
