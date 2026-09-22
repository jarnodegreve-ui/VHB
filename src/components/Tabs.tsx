import { motion, useReducedMotion } from 'motion/react';
import { useId, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { cn } from '../lib/ui';
import { DUR, EASE_SPRING } from '../lib/motion';
import { overgangActief } from '../lib/overgang';

/**
 * Tabs (ronde 5, F2): het WAI-ARIA-tabpatroon (tablist/tab/tabpanel) met
 * pijltjes, Home en End en een schuivende onderstreep. Anders dan
 * `Segmented` (dat één waarde kiest in een formulier of filter) wisselen
 * tabs de inhoud eronder; de onderstreep is neutraal (`bg-keuze`, geen
 * goud: selectie is geen primaire actie).
 *
 *   const tabsId = useId();
 *   <Tabs id={tabsId} waarde={tab} opties={[…]} onChange={setTab} label="Onderdeel" />
 *   <TabPaneel tabsId={tabsId} waarde="maand" actief={tab === 'maand'}>…</TabPaneel>
 */
export function Tabs<T extends string>({ id: idProp, waarde, opties, onChange, label, className }: {
  id?: string;
  waarde: T;
  opties: ReadonlyArray<{ waarde: T; label: ReactNode; icon?: ReactNode; teller?: number }>;
  onChange: (waarde: T) => void;
  /** Toegankelijke naam van de tablijst. */
  label: string;
  className?: string;
}) {
  const eigenId = useId();
  const id = idProp ?? eigenId;
  const reduced = useReducedMotion();
  const lijst = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const i = opties.findIndex((o) => o.waarde === waarde);
    let volgende = -1;
    if (e.key === 'ArrowRight') volgende = (i + 1) % opties.length;
    else if (e.key === 'ArrowLeft') volgende = (i - 1 + opties.length) % opties.length;
    else if (e.key === 'Home') volgende = 0;
    else if (e.key === 'End') volgende = opties.length - 1;
    if (volgende < 0) return;
    e.preventDefault();
    onChange(opties[volgende].waarde);
    lijst.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[volgende]?.focus();
  };

  return (
    <div ref={lijst} role="tablist" aria-label={label} onKeyDown={onKeyDown} className={cn('flex gap-1 overflow-x-auto border-b border-hairline', className)}>
      {opties.map((o) => {
        const actief = o.waarde === waarde;
        return (
          // rauw: tab (role=tab) met schuivende onderstreep; Button heeft geen tab-vorm.
          <button
            key={String(o.waarde)}
            type="button"
            role="tab"
            id={`${id}-tab-${o.waarde}`}
            aria-selected={actief}
            aria-controls={`${id}-paneel-${o.waarde}`}
            tabIndex={actief ? 0 : -1}
            onClick={() => onChange(o.waarde)}
            className={cn(
              'ios-pressable relative inline-flex min-h-11 shrink-0 items-center gap-1.5 px-3 py-2 text-sm font-semibold transition-colors sm:pointer-fine:min-h-9',
              actief ? 'text-slate-900' : 'text-slate-500 hover:text-slate-800',
            )}
          >
            {o.icon && <span className="shrink-0">{o.icon}</span>}
            {o.label}
            {typeof o.teller === 'number' && (
              <span className={cn('inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-2xs font-bold tabular-nums', actief ? 'bg-keuze text-keuze-tekst' : 'bg-surface-muted text-slate-600')}>{o.teller}</span>
            )}
            {actief && (
              <motion.span
                layoutId={`tabs-streep-${id}`}
                aria-hidden="true"
                transition={reduced || overgangActief() ? { duration: 0 } : { duration: DUR.fast, ease: EASE_SPRING }}
                className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-keuze"
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TabPaneel({ tabsId, waarde, actief, className, children }: {
  tabsId: string;
  waarde: string;
  actief: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div id={`${tabsId}-paneel-${waarde}`} role="tabpanel" aria-labelledby={`${tabsId}-tab-${waarde}`} hidden={!actief} tabIndex={0} className={cn('focus-stil', className)}>
      {actief ? children : null}
    </div>
  );
}
