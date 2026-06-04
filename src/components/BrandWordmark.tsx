import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { cn } from '../lib/ui';

/**
 * Type-gebaseerde VHB-wordmark voor login + sidebar:
 *   VHB PORTAAL
 *   VAN HOOREBEKE EN ZOON
 *
 * Pure CSS/typografie — gebruikt EXACT dezelfde classes als de sidebar
 * op het dashboard (brand-wordmark + brand-wordmark-anim + section-title)
 * zodat font + tracking + line-height identiek zijn. Alleen de grootte
 * varieert per `size`-prop.
 *
 * Met `animateLetters` = letters typen zich in op eerste bezoek (gemeten
 * via localStorage). Daarna instant. prefers-reduced-motion: animatie uit.
 */
export function BrandWordmark({
  size = 'lg',
  className,
  animateLetters = false,
  storageKey = 'vhb-wordmark-typed',
}: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  animateLetters?: boolean;
  /** localStorage-key om te onthouden dat de animatie al gespeeld is. */
  storageKey?: string;
}) {
  // Zelfde stijl als sidebar (text-[1.25rem]); voor login een tikje groter
  // maar dichtbij identiek qua proportie.
  const titleSize = {
    sm: 'text-[1.25rem]',   // = 20px (zelfde als sidebar)
    md: 'text-[1.375rem]',  // = 22px
    lg: 'text-[1.625rem]',  // = 26px
  }[size];

  const subSize = {
    sm: 'text-[9px] tracking-[0.2em] mt-0.5',
    md: 'text-[10px] tracking-[0.2em] mt-1',
    lg: 'text-[11px] tracking-[0.22em] mt-1.5',
  }[size];

  // Eerste-bezoek-detectie: animeer enkel als nog niet eerder gespeeld
  // én reduced-motion niet aan staat.
  const [shouldAnimate, setShouldAnimate] = useState(false);

  useEffect(() => {
    if (!animateLetters) return;
    if (typeof window === 'undefined') return;
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    if (localStorage.getItem(storageKey) === '1') return;
    setShouldAnimate(true);
    // Markeer als gespeeld zodra animatie kan starten (idempotent)
    try {
      localStorage.setItem(storageKey, '1');
    } catch {
      // localStorage kan geblokkeerd zijn (private mode) — animatie gebeurt
      // dan elke keer, geen probleem.
    }
  }, [animateLetters, storageKey]);

  return (
    <div className={cn('inline-flex flex-col', className)}>
      <h1
        className={cn(
          'brand-wordmark brand-wordmark-anim section-title text-slate-900 leading-none',
          titleSize,
        )}
        aria-label="VHB PORTAAL"
      >
        {shouldAnimate ? (
          <AnimatedLetters />
        ) : (
          <>
            VHB <span className="brand-accent text-oker-500">PORTAAL</span>
          </>
        )}
      </h1>
      <motion.p
        initial={shouldAnimate ? { opacity: 0, y: 4 } : false}
        animate={shouldAnimate ? { opacity: 1, y: 0 } : undefined}
        transition={{
          delay: shouldAnimate ? 0.8 : 0,
          duration: 0.5,
          ease: [0.22, 1, 0.36, 1],
        }}
        className={cn('font-bold text-slate-400 uppercase', subSize)}
      >
        Van Hoorebeke en Zoon
      </motion.p>
    </div>
  );
}

/**
 * Letters typen zich in één voor één — VHB eerst, dan een ruimte, dan
 * PORTAAL in oker. Hele animatie duurt ~700ms (stagger 60ms × 11 chars).
 */
function AnimatedLetters() {
  const chars = [
    { c: 'V', accent: false },
    { c: 'H', accent: false },
    { c: 'B', accent: false },
    { c: ' ', accent: false },
    { c: 'P', accent: true },
    { c: 'O', accent: true },
    { c: 'R', accent: true },
    { c: 'T', accent: true },
    { c: 'A', accent: true },
    { c: 'A', accent: true },
    { c: 'L', accent: true },
  ];

  return (
    <motion.span
      initial="hidden"
      animate="visible"
      variants={{
        hidden: {},
        visible: { transition: { staggerChildren: 0.055, delayChildren: 0.1 } },
      }}
      className="inline-block"
    >
      {chars.map((ch, i) => (
        <motion.span
          key={i}
          variants={{
            hidden: { opacity: 0, y: '0.25em', filter: 'blur(4px)' },
            visible: {
              opacity: 1,
              y: 0,
              filter: 'blur(0px)',
              transition: { duration: 0.36, ease: [0.22, 1, 0.36, 1] },
            },
          }}
          className={cn(
            'inline-block',
            ch.accent && 'brand-accent text-oker-500',
          )}
          // Voor spaties: breedte forceren zodat ze niet collapsen
          style={ch.c === ' ' ? { width: '0.35em' } : undefined}
        >
          {ch.c === ' ' ? ' ' : ch.c}
        </motion.span>
      ))}
    </motion.span>
  );
}
