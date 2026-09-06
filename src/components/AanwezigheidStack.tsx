import { AnimatePresence, motion } from 'motion/react';
import { cn } from '../lib/ui';
import { DUR, EASE } from '../lib/motion';
import { useAanwezigen, type Aanwezige } from '../lib/presence';
import { routeVan } from '../app/routes';
import { Avatar } from './Avatar';
import { useDropdown } from './useDropdown';

const MAX_ZICHTBAAR = 3;

/** "Pieter · Dienstoverzicht" — naam plus het label van het scherm. */
export const aanwezigeRegel = (a: Aanwezige) => `${a.naam} · ${routeVan(a.view).label}`;

/**
 * Avatar-stapel in de desktop-topbar (staf): wie is er nu ook in het
 * portaal. Maximaal drie initialen-cirkels + "+n"; klik/tik opent een klein
 * vlak met naam en scherm per collega (zelfde popover-taal als InfoTip).
 * Rendert niets zolang er niemand anders is — geen lege stapel, geen
 * "1 online" voor jezelf.
 */
export function AanwezigheidStack({ className }: { className?: string }) {
  const anderen = useAanwezigen();
  const { open, setOpen, wortel } = useDropdown();
  if (anderen.length === 0) return null;
  const zichtbaar = anderen.slice(0, MAX_ZICHTBAAR);
  const rest = anderen.length - zichtbaar.length;
  const label = anderen.length === 1 ? `${anderen[0].naam} is ook in het portaal` : `${anderen.length} collega's zijn ook in het portaal`;
  return (
    <div ref={wortel} className={cn('relative hidden lg:inline-flex', className)}>
      {/* rauw: avatar-stapel als trigger (rounded-full, overlappende cirkels) — geen knop-vorm uit primitives. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={label}
        className={cn('flex items-center rounded-full py-1 pl-1 pr-1.5 transition-colors hover:bg-slate-100/80', open && 'bg-slate-100/80')}
      >
        <span className="flex -space-x-1.5">
          {zichtbaar.map((a) => (
            <Avatar key={a.userId} naam={a.naam} size="sm" className="ring-2 ring-paper" />
          ))}
        </span>
        {rest > 0 && <span className="ml-1.5 text-2xs font-semibold tabular-nums text-slate-500">+{rest}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="Nu in het portaal"
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: DUR.fast, ease: EASE }}
            className="absolute right-0 top-full z-40 mt-1.5 w-64 rounded-xl bg-paper p-2 ring-1 ring-hairline shadow-xl"
          >
            <p className="text-micro px-2 pb-1.5 pt-1">Nu in het portaal</p>
            <ul className="space-y-0.5">
              {anderen.map((a) => (
                <li key={a.userId} className="flex items-center gap-2.5 rounded-lg px-2 py-1.5">
                  <Avatar naam={a.naam} size="sm" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-800">{a.naam}</span>
                  {/* Label mag krimpen, de naam niet: "Sofie …" naast een lang schermlabel las verkeerd. */}
                  <span className="max-w-[8.5rem] shrink truncate text-xs text-slate-500">{routeVan(a.view).label}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
