import { Info } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { cn } from '../lib/ui';
import { DUR, EASE } from '../lib/motion';
import { useDropdown } from './useDropdown';

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
        className={cn('inline-flex h-8 w-8 sm:pointer-fine:h-6 sm:pointer-fine:w-6 items-center justify-center rounded-md transition-colors', open ? 'bg-slate-100 text-slate-700' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600')}
      >
        <Info size={14} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label={label}
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: DUR.fast, ease: EASE }}
            className={cn('absolute top-full z-40 mt-1.5 w-72 max-w-[calc(100vw-2rem)] rounded-xl bg-surface-white p-3.5 text-sm font-normal leading-relaxed text-slate-600 ring-1 ring-hairline shadow-xl', align === 'right' ? 'right-0' : 'left-0')}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}
