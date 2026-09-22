import { Info } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/ui';
import { useDropdown } from './useDropdown';
import { Popover } from './Popover';

/**
 * Hulp-popover: een klein (i) naast een titel of label dat uitleg toont
 * op klik/tik (werkt dus ook op touch, anders dan `title=`). Voor de
 * uitlegteksten die eerder als alinea's ín de beheerkaarten stonden —
 * de kaart zelf blijft zo rustig, de uitleg blijft één tik weg.
 */
export function InfoTip({ children, label = 'Uitleg', className, align = 'left' }: {
  children: ReactNode;
  label?: string;
  className?: string;
  align?: 'left' | 'right';
}) {
  const { open, setOpen, wortel } = useDropdown();
  return (
    <span ref={wortel} className={cn('relative inline-flex', className)}>
      {/* rauw: (i)-knop in de kop van een kaart — 24 px op muis, ruimer raakvlak via padding op touch. */}
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
        className={cn('inline-flex h-8 w-8 sm:pointer-fine:h-6 sm:pointer-fine:w-6 items-center justify-center rounded-md transition-colors', open ? 'bg-slate-100 text-slate-700' : 'text-slate-400 hover:bg-surface-soft-hover hover:text-slate-600')}
      >
        <Info size={14} />
      </button>
      <Popover open={open} label={label} align={align} breedte="lg" padding="tekst" className="max-w-[calc(100vw-2rem)] text-body-sm font-normal text-slate-600">
        {children}
      </Popover>
    </span>
  );
}
