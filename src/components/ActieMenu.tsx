import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { cn } from '../lib/ui';
import { IconButton } from './primitives';

/**
 * Actiemenu ("…"): secundaire acties van een scherm of rij in één menu, zodat
 * de paginakop één primaire knop houdt (afwerkingsronde 04-09, nr. 5 en 7).
 * Zelfde popover-taal als het kolommenmenu in Table.tsx: opaak bg-paper,
 * haarlijn, klik buiten / Escape sluit, pijltjes navigeren.
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
  // Viewport-bewust: `align` is de voorkeur; valt het menu buiten beeld
  // (bv. "…" links in een mobiele kop), dan klapt het naar de andere kant.
  const [kant, setKant] = useState<'left' | 'right'>(align);
  useEffect(() => {
    if (!open) {
      setKant(align);
      return;
    }
    const el = lijst.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (align === 'right' && r.left < 8) setKant('left');
    else if (align === 'left' && r.right > window.innerWidth - 8) setKant('right');
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const buiten = (e: MouseEvent | TouchEvent) => {
      if (wortel.current && !wortel.current.contains(e.target as Node)) setOpen(false);
    };
    const toets = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
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
    };
  }, [open]);

  const toggle = () => setOpen((o) => !o);
  const triggerEl = trigger ? (
    trigger({ open, toggle, id })
  ) : (
    <IconButton label={label} variant="secondary" size={size} aria-haspopup="menu" aria-expanded={open} aria-controls={id} onClick={toggle}>
      <MoreHorizontal size={size === 'sm' ? 16 : 18} />
    </IconButton>
  );

  return (
    <div ref={wortel} className={cn('relative inline-flex', className)}>
      {triggerEl}
      {open && (
        <div
          ref={lijst}
          id={id}
          role="menu"
          aria-label={label}
          className={cn(
            'absolute top-full z-50 mt-2 min-w-[12rem] rounded-2xl bg-paper p-1.5 ring-1 ring-hairline shadow-xl',
            kant === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item, i) => (
            <div key={item.label} className={cn(item.scheiding && i > 0 && 'mt-1 border-t border-slate-100 pt-1')}>
              {/* rauw: menu-item met eigen layout (role=menuitem), geen Button-variant */}
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors',
                  'disabled:cursor-not-allowed disabled:opacity-50',
                  item.gevaarlijk ? 'text-red-700 hover:bg-red-500/10' : 'text-slate-700 hover:bg-slate-100/70',
                )}
              >
                {item.icon && <span className={cn('shrink-0', item.gevaarlijk ? 'text-red-700' : 'text-slate-500')}>{item.icon}</span>}
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
