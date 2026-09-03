import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../lib/ui';
import { IconButton } from './primitives';

/**
 * Maandnavigatie: "‹ maandnaam ›" boven een maandraster. Stond 7× uitgeschreven
 * (controle-ronde 27-08, bevinding 42c); dit is het rooster-dialect
 * (ScheduleView): IconButton md = 44px-knoppen (36px op een desktop met muis).
 * De aria-labels "Vorige maand"/"Volgende maand" zijn contract met de e2e-
 * tests — niet wijzigen. `children` = extra acties achter de pijlen (bv. een
 * "Vandaag"-knop); `className="justify-between"` spreidt de kop over de volle
 * breedte van een kaart.
 */
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
      <IconButton label="Vorige maand" variant="secondary" onClick={onVorige} disabled={vorigeUit}>
        <ChevronLeft size={16} />
      </IconButton>
      <span className={cn('text-center text-sm font-semibold capitalize text-slate-800', labelClassName)} aria-live="polite">
        {label}
      </span>
      <IconButton label="Volgende maand" variant="secondary" onClick={onVolgende} disabled={volgendeUit}>
        <ChevronRight size={16} />
      </IconButton>
      {children}
    </div>
  );
}
