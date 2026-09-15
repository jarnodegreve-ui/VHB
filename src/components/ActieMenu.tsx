import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '../lib/ui';
import { DUR, EASE, EASE_SPRING } from '../lib/motion';
import { useHistoryDismiss } from '../lib/useHistoryDismiss';
import { IconButton } from './primitives';

/**
 * Actiemenu ("…"): secundaire acties van een scherm of rij in één menu, zodat
 * de paginakop één primaire knop houdt (afwerkingsronde 04-09, nr. 5 en 7).
 * Zelfde popover-taal als het kolommenmenu in Table.tsx: opaak bg-paper,
 * haarlijn, klik buiten / Escape sluit, pijltjes navigeren. Escape en het
 * kiezen van een item zetten de focus terug op de trigger; de terugknop op
 * mobiel sluit het menu i.p.v. het scherm (useHistoryDismiss, zoals de
 * DatePicker). Items zijn ≥44 px op touch (controle-ronde 05-09, nr. 17).
 *
 * Het menu zelf staat in een portal op <body> met `position: fixed`, berekend
 * vanaf de trigger: een absoluut menu binnen een kaart met `overflow-clip`
 * (surface-table in Beheer dienstoverzicht) werd bij de onderste rijen
 * volledig afgeknipt (Jarno 15-09, dienst 4512). Onder de trigger als daar
 * plaats is, anders erboven. Bij scrollen volgt het menu de trigger en sluit
 * pas als die uit beeld schuift (een loutere scroll-event, bv. van het
 * scrollherstel na een navigatie, sluit hem dus niet). z-[125]: boven Modal (100/120) en SlideOver (101),
 * want DetailPaneel gebruikt dit menu binnen een SlideOver.
 */
export type ActieMenuItem = {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  /** Rood (verwijderen e.d.). */
  gevaarlijk?: boolean;
  disabled?: boolean;
  /** Scheidingslijn boven dit item. */
  scheiding?: boolean;
};

export function ActieMenu({
  items,
  label = 'Meer acties',
  align = 'right',
  size = 'md',
  className,
  trigger,
}: {
  items: ActieMenuItem[];
  label?: string;
  align?: 'left' | 'right';
  size?: 'sm' | 'md';
  className?: string;
  /** Eigen trigger (bv. een Button "Meer"); standaard een IconButton met "…". */
  trigger?: (props: { open: boolean; toggle: () => void; id: string }) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const wortel = useRef<HTMLDivElement>(null);
  const lijst = useRef<HTMLDivElement>(null);
  const id = useId();
  const reduced = useReducedMotion();

  // De trigger is de eerste knop in de wortel die niet in de lijst zit — ook
  // bij een eigen `trigger`, waar we geen ref op kunnen zetten.
  const triggerElement = () =>
    Array.from(wortel.current?.querySelectorAll<HTMLElement>('button, [tabindex]') ?? []).find((el) => !lijst.current?.contains(el));

  const sluit = useCallback((focusTerug = false) => {
    setOpen(false);
    if (focusTerug) triggerElement()?.focus();
  }, []);

  // Terugknop/swipe-back op mobiel sluit het menu i.p.v. het scherm.
  useHistoryDismiss(open, () => setOpen(false));

  // Positie t.o.v. de viewport (portal + fixed). `align` is de voorkeur voor
  // de horizontale kant; valt het menu buiten beeld (bv. "…" links in een
  // mobiele kop), dan klapt het naar de andere kant. Verticaal: onder de
  // trigger, of erboven als daar meer plaats is dan het menu nodig heeft.
  const [kant, setKant] = useState<'left' | 'right'>(align);
  const [boven, setBoven] = useState(false);
  const [positie, setPositie] = useState<CSSProperties | null>(null);
  const MARGE = 8;
  /** Meet en zet de positie; geeft false als de trigger buiten beeld is. */
  const plaats = useCallback((): boolean => {
    const trigger = triggerElement();
    const menu = lijst.current;
    if (!trigger || !menu) return true;
    const t = trigger.getBoundingClientRect();
    if (t.bottom < 0 || t.top > window.innerHeight || t.width === 0) return false;
    const m = menu.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let k: 'left' | 'right' = align;
    if (align === 'right' && t.right - m.width < MARGE) k = 'left';
    else if (align === 'left' && t.left + m.width > vw - MARGE) k = 'right';
    const past = t.bottom + MARGE + m.height <= vh - MARGE;
    const naarBoven = !past && t.top - MARGE - m.height >= MARGE;
    const stijl: CSSProperties = naarBoven ? { bottom: vh - t.top + MARGE } : { top: t.bottom + MARGE };
    if (k === 'right') stijl.right = Math.max(MARGE, vw - t.right);
    else stijl.left = Math.max(MARGE, t.left);
    setKant(k);
    setBoven(naarBoven);
    setPositie(stijl);
    return true;
  }, [align]);
  useLayoutEffect(() => {
    if (!open) {
      setKant(align);
      setBoven(false);
      setPositie(null);
      return;
    }
    plaats();
  }, [open, align, plaats]);

  useEffect(() => {
    if (!open) return;
    const buiten = (e: MouseEvent | TouchEvent) => {
      const doel = e.target as Node;
      if (wortel.current?.contains(doel) || lijst.current?.contains(doel)) return;
      setOpen(false);
    };
    // Scrollt de pagina of een container: het fixed menu volgt de trigger en
    // sluit pas als die uit beeld is.
    const scrol = (e: Event) => {
      if (lijst.current && e.target instanceof Node && lijst.current.contains(e.target)) return;
      if (!plaats()) setOpen(false);
    };
    window.addEventListener('scroll', scrol, true);
    window.addEventListener('resize', scrol);
    const toets = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Alleen het menu sluit: een omliggende Modal/SlideOver luistert op
        // window en zou anders in dezelfde toets mee dichtklappen.
        e.stopPropagation();
        e.preventDefault();
        sluit(true);
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const knoppen = Array.from(lijst.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
      if (knoppen.length === 0) return;
      e.preventDefault();
      const i = knoppen.indexOf(document.activeElement as HTMLButtonElement);
      const volgende = e.key === 'ArrowDown' ? (i + 1) % knoppen.length : (i - 1 + knoppen.length) % knoppen.length;
      knoppen[volgende].focus();
    };
    document.addEventListener('mousedown', buiten);
    document.addEventListener('touchstart', buiten);
    document.addEventListener('keydown', toets);
    // Focus op het eerste item, zodat toetsenbordgebruikers meteen verder kunnen.
    lijst.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    return () => {
      document.removeEventListener('mousedown', buiten);
      document.removeEventListener('touchstart', buiten);
      document.removeEventListener('keydown', toets);
      window.removeEventListener('scroll', scrol, true);
      window.removeEventListener('resize', scrol);
    };
  }, [open, sluit, plaats]);

  const toggle = () => setOpen((o) => !o);
  const triggerEl = trigger ? (
    trigger({ open, toggle, id })
  ) : (
    <IconButton label={label} variant="secondary" size={size} aria-haspopup="menu" aria-expanded={open} aria-controls={id} onClick={toggle}>
      <MoreHorizontal size={size === 'sm' ? 16 : 18} />
    </IconButton>
  );

  // Vóór de eerste meting staat het menu onzichtbaar op (0,0), zodat er geen
  // frame op de verkeerde plek verschijnt; de layout-effect meet en zet hem.
  const menuStijl: CSSProperties = positie
    ? { ...positie, transformOrigin: `${boven ? 'bottom' : 'top'} ${kant}` }
    : { top: 0, left: 0, visibility: 'hidden' };
  const menu = (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={lijst}
          id={id}
          role="menu"
          aria-label={label}
          initial={{ opacity: 0, scale: 0.97, y: boven ? 4 : -4 }}
          animate={{ opacity: 1, scale: 1, y: 0, transition: reduced ? { duration: 0 } : { duration: DUR.fast, ease: EASE_SPRING } }}
          exit={{ opacity: 0, scale: 0.97, y: boven ? 4 : -4, transition: reduced ? { duration: 0 } : { duration: DUR.fast, ease: EASE } }}
          style={menuStijl}
          className="fixed z-[125] min-w-[12rem] rounded-2xl bg-paper p-1.5 ring-1 ring-hairline elev-2"
        >
          {items.map((item, i) => (
            <div key={item.label} className={cn(item.scheiding && i > 0 && 'mt-1 border-t border-hairline-subtle pt-1')}>
              {/* rauw: menu-item met eigen layout (role=menuitem), geen Button-variant */}
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  // Focus eerst terug op de trigger: opent de actie een modal,
                  // dan onthoudt die de trigger als terugkeerpunt (niet het
                  // menu-item, dat meteen verdwijnt).
                  sluit(true);
                  item.onClick();
                }}
                className={cn(
                  // min-h-11 = 44 px aanraakminimum; op een fijne pointer (muis)
                  // compacter, zoals Button (primitives.tsx).
                  'flex w-full min-h-11 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors sm:pointer-fine:min-h-9',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  item.gevaarlijk ? 'text-red-700 hover:bg-red-500/10' : 'text-slate-700 hover:bg-slate-100/70',
                )}
              >
                {item.icon && <span className={cn('shrink-0', item.gevaarlijk ? 'text-red-700' : 'text-slate-500')}>{item.icon}</span>}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </button>
            </div>
          ))}
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <div ref={wortel} className={cn('relative inline-flex', className)}>
      {triggerEl}
      {/* Zelfde in/uit als UserMenu: veer in, EASE uit, beide DUR.fast. */}
      {typeof document !== 'undefined' ? createPortal(menu, document.body) : menu}
    </div>
  );
}
