import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { cloneElement, isValidElement, useEffect, useId, useState, type ReactElement, type ReactNode } from 'react';
import { cn } from '../lib/ui';
import { DUR, EASE } from '../lib/motion';

/**
 * Tooltip (ronde 5, F2): korte uitleg bij hover of toetsenbordfocus, alleen
 * waar een echte aanwijzer is (op touch bestaat hover niet; daar draagt het
 * element zijn `aria-label` en volstaat dat). Vervangt het native `title=`
 * waar de uitleg zichtbaar moet zijn in de huisstijl en in beide thema's.
 * Inverse tegel (`bg-slate-900 text-slate-50`) zodat hij in licht donker en
 * in donker licht is, zoals de icoontegel in ops.tsx. Geen pijl, geen
 * vertraging boven 300 ms: het is uitleg, geen popover.
 *
 * Voor wat de gebruiker moet kunnen aanklikken of lezen op touch: InfoTip.
 */
export function Tooltip({ label, kant = 'boven', className, children }: {
  label: string;
  kant?: 'boven' | 'onder';
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const reduced = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [aanwijzer, setAanwijzer] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    const zet = () => setAanwijzer(mq.matches);
    zet();
    mq.addEventListener('change', zet);
    return () => mq.removeEventListener('change', zet);
  }, []);

  useEffect(() => {
    if (!open) return;
    const toets = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', toets);
    return () => document.removeEventListener('keydown', toets);
  }, [open]);

  const kind = isValidElement(children)
    ? cloneElement(children as ReactElement<{ 'aria-describedby'?: string }>, { 'aria-describedby': open ? id : undefined })
    : children;

  return (
    <span
      className={cn('relative inline-flex', className)}
      onPointerEnter={() => { if (aanwijzer) setOpen(true); }}
      onPointerLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      {kind}
      <AnimatePresence>
        {open && (
          <motion.span
            id={id}
            role="tooltip"
            initial={{ opacity: 0, y: kant === 'boven' ? 2 : -2 }}
            animate={{ opacity: 1, y: 0, transition: reduced ? { duration: 0, delay: 0 } : { duration: DUR.fast, ease: EASE, delay: 0.3 } }}
            exit={{ opacity: 0, transition: reduced ? { duration: 0 } : { duration: DUR.fast, ease: EASE } }}
            className={cn(
              'pointer-events-none absolute left-1/2 z-zwevend -translate-x-1/2 whitespace-nowrap rounded-lg bg-slate-900 px-2 py-1 text-xs font-medium text-slate-50 elev-2',
              kant === 'boven' ? 'bottom-full mb-1.5' : 'top-full mt-1.5',
            )}
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}
