import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/ui';

/**
 * Maandnavigatie: "‹ maandnaam ›" boven een maandraster. Stond 7× uitgeschreven
 * (controle-ronde 27-08, bevinding 42c); dit is het rooster-dialect
 * (ScheduleView): 44px-knoppen (36px op een desktop met muis), hairline-rand.
 * De aria-labels "Vorige maand"/"Volgende maand" zijn contract met de e2e-
 * tests — niet wijzigen. `children` = extra acties achter de pijlen (bv. een
 * "Vandaag"-knop); `className="justify-between"` spreidt de kop over de volle
 * breedte van een kaart.
 */
const KNOP =
  'ios-pressable flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-500 transition-colors hover:bg-surface-soft-hover hover:text-slate-800 sm:pointer-fine:h-9 sm:pointer-fine:w-9 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-slate-500';

export function MaandNavigatie({
  label,
  onVorige,
  onVolgende,
  vorigeUit = false,
  volgendeUit = false,
  labelClassName,
  className,
  children,
  ...rest
}: {
  label: string;
  onVorige: () => void;
  onVolgende: () => void;
  vorigeUit?: boolean;
  volgendeUit?: boolean;
  /** Extra klassen op de maandnaam (bv. een min-width tegen verspringen). */
  labelClassName?: string;
  className?: string;
  children?: ReactNode;
} & Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'className'>) {
  return (
    <div className={cn('flex items-center gap-2', className)} {...rest}>
      <button type="button" onClick={onVorige} disabled={vorigeUit} aria-label="Vorige maand" className={KNOP}>
        <ChevronLeft size={16} />
      </button>
      <span className={cn('text-center text-sm font-semibold capitalize text-slate-800', labelClassName)} aria-live="polite">
        {label}
      </span>
      <button type="button" onClick={onVolgende} disabled={volgendeUit} aria-label="Volgende maand" className={KNOP}>
        <ChevronRight size={16} />
      </button>
      {children}
    </div>
  );
}
