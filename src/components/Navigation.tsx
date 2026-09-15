import React, { useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../lib/ui';
import { overgangActief } from '../lib/overgang';
import { DUR, EASE_SPRING } from '../lib/motion';
import { MicroLabel, microLabelClass } from './primitives';
import { CountUp } from './CountUp';
import { Uitklap, uitklapChevron } from './Uitklap';


export function NavItem({ icon, label, active, onClick, onPrefetch, badge }: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  /** Stil voorladen van de bijhorende view zodra de muis of vinger het item
   *  raakt (prefetchView) — de klik erna voelt instant. */
  onPrefetch?: () => void;
  badge?: number;
}) {
  const reduced = useReducedMotion();
  return (
    <button
      onClick={onClick}
      onPointerEnter={onPrefetch}
      onTouchStart={onPrefetch}
      aria-current={active ? 'page' : undefined}
      className={cn(
        "group relative flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors duration-fast",
        active
          // Goud rantsoeneren (next-level 2, punt 4): een actief nav-item is een
          // plaats, geen actie. Neutrale chip met hairline; het enige merkmoment
          // is de gouden rail links. Goud blijft voor actie, focus en live.
          ? "bg-surface-muted text-slate-900 font-semibold ring-1 ring-hairline"
          : "text-slate-600 hover:bg-slate-100/70 hover:text-slate-900 font-medium"
      )}
    >
      {/* Actieve accent-rail links — subtiel merk-moment i.p.v. icoon-box */}
      {active && (
        <motion.span
          layoutId="nav-active-rail"
          // Tijdens een route-overgang schuift de rail via de view transition
          // (eigen naam); de veer zou dan onder de snapshot lopen en na
          // afloop verspringen — zie src/lib/overgang.ts. Zelfde veer als de
          // dock-tab, de dagstrip en de Segmented-pil (EASE_SPRING op
          // DUR.fast, golf 2 punt 9): geen springs met eigen getallen meer.
          transition={reduced || overgangActief() ? { duration: 0 } : { duration: DUR.fast, ease: EASE_SPRING }}
          style={{ viewTransitionName: 'nav-actief-rail' }}
          className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-[3px] rounded-full bg-oker-500"
        />
      )}
      <span className={cn(
        "shrink-0 transition-colors duration-fast",
        active ? "text-slate-900" : "text-slate-400 group-hover:text-slate-600"
      )}>
        {icon}
      </span>
      {/* leading-5 i.p.v. leading-none: truncate verbergt overflow en bij
          regelhoogte 1 werd de staart van g/j/p afgeknipt ("Planningscodes"). */}
      <span className="flex-1 leading-5 truncate">{label}</span>
      {badge !== undefined && badge > 0 && (
        <span className="ml-auto inline-flex items-center justify-center min-w-[19px] h-[19px] px-1.5 text-2xs font-bold bg-oker-500 text-slate-950 rounded-full">
          <CountUp value={badge} badge />
        </span>
      )}
    </button>
  );
}

/**
 * Inklapbare navigatiegroep voor de beheer-secties. Standaard dicht (rustige
 * zijbalk); onthoudt de open/dicht-keuze per groep in localStorage. Klapt
 * automatisch open wanneer de actieve view in deze groep zit, zodat je altijd
 * ziet waar je bent. `count` toont het aantal items zolang de groep dicht is.
 */
export function NavSection({ title, count, active = false, children }: { title: string; count: number; active?: boolean; children: React.ReactNode }) {
  const storageKey = `vhb-nav-${title}`;
  // Standaard ópen (feedback Jarno 30-08): sinds de sidebar-voet naar het
  // avatar-menu verhuisde mag het menu de volle hoogte gebruiken. Alleen wie
  // een sectie zelf dichtklapt ('0') houdt hem dicht.
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem(storageKey) !== '0'; } catch { return true; }
  });
  const expanded = open || active;
  const toggle = () => {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(storageKey, next ? '1' : '0'); } catch { /* private mode */ }
  };
  return (
    <div className="mt-4">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={expanded}
        className={cn('group flex w-full min-h-11 sm:pointer-fine:min-h-8 items-center gap-1.5 rounded-lg px-3 py-1.5 transition-colors', microLabelClass, 'hover:text-slate-700')}
      >
        <ChevronRight size={12} className={uitklapChevron(expanded, 90, 'shrink-0')} />
        <span className="flex-1 text-left">{title}</span>
        {!expanded && <span className="tabular-nums text-slate-300 group-hover:text-slate-400">{count}</span>}
      </button>
      <Uitklap open={expanded}>
        <div className="mt-0.5 space-y-0.5">{children}</div>
      </Uitklap>
    </div>
  );
}

/** Subgroep-kopje bínnen een NavSection (bv. Planning / Mensen / Communicatie
 *  in "Beheer"): geen knop, alleen een rustige tussentitel die de lange lijst
 *  in leesbare blokken deelt. */
export function NavSubLabel({ children }: { children: React.ReactNode }) {
  return (
    <MicroLabel className="px-3 pt-2.5 pb-0.5 select-none">
      {children}
    </MicroLabel>
  );
}
