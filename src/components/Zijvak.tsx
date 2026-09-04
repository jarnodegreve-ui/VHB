import type { ReactNode } from 'react';
import { cn } from '../lib/ui';
import { Card, CardHeader } from './Card';

/**
 * Zijvak — het rustige vak naast de hoofdkolom op desktop (afwerkingsronde
 * 04-09, pakket A nr. 3/4): een gedempte kaart met een kleine kop, rijen
 * "label links gedempt · waarde rechts" en een optioneel voetje voor één
 * actie of twee regels hulp-tekst. Geen extra kleuren: het zijvak zegt iets
 * nuttigs, het schreeuwt niet.
 *
 * `ZijvakLayout` zet hoofdinhoud en zijvak naast elkaar op `lg+` (kolom van
 * 20 rem rechts, sticky onder de topbar); daaronder blijft alles gestapeld
 * en komt het zijvak ónder de hoofdinhoud. Zonder `zijvak` rendert het
 * gewoon de kinderen — zo verdwijnt het vak als het niets toevoegt.
 */
export function ZijvakLayout({
  zijvak,
  breekpunt = 'lg',
  className,
  children,
}: {
  zijvak?: ReactNode;
  /** `xl` waar `lg` te krap is voor de hoofdinhoud (brede tabellen). */
  breekpunt?: 'lg' | 'xl';
  className?: string;
  children: ReactNode;
}) {
  if (!zijvak) return <div className={cn('space-y-6 md:space-y-8', className)}>{children}</div>;
  return (
    <div className={cn('grid gap-6', breekpunt === 'xl' ? 'xl:grid-cols-[minmax(0,1fr)_20rem] xl:items-start' : 'lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start', className)}>
      <div className="min-w-0 space-y-6 md:space-y-8">{children}</div>
      {/* self-start + sticky: het vak scrolt mee zolang het past; zonder
          self-start rekt de grid-cel tot rijhoogte en plakt er niets. */}
      <aside className={cn('min-w-0 self-start', breekpunt === 'xl' ? 'xl:sticky xl:top-20' : 'lg:sticky lg:top-20')}>{zijvak}</aside>
    </div>
  );
}

export function Zijvak({
  titel,
  aside,
  voet,
  className,
  children,
}: {
  titel: string;
  /** Klein element rechts van de titel (badge, InfoTip). */
  aside?: ReactNode;
  /** Voetje: één actie (knop) of hulp-tekst van hooguit twee regels. */
  voet?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Card as="section" tone="muted" padding="sm" className={className} aria-label={titel}>
      <CardHeader title={titel} aside={aside} />
      {children ? <div className="mt-2 divide-y divide-slate-200/60">{children}</div> : null}
      {voet ? <div className="mt-3 border-t border-slate-200/60 pt-3 text-xs font-medium leading-relaxed text-slate-500">{voet}</div> : null}
    </Card>
  );
}

/** Eén rij: label links gedempt, waarde rechts (mono voor getallen/tijden). */
export function ZijvakRij({
  label,
  waarde,
  mono = false,
  className,
}: {
  label: ReactNode;
  waarde: ReactNode;
  mono?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3 py-2', className)}>
      <span className="text-label shrink-0">{label}</span>
      <span className={cn('min-w-0 truncate text-right text-sm font-semibold text-slate-800', mono && 'font-mono tabular-nums')}>{waarde}</span>
    </div>
  );
}

/** Vrije tekst in het zijvak (bv. "Zo werkt het"): hooguit twee regels. */
export function ZijvakTekst({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn('py-2 text-sm font-normal leading-relaxed text-slate-600', className)}>{children}</p>;
}
