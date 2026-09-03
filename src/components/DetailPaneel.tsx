import { useEffect, useRef, type ReactNode } from 'react';
import { cn } from '../lib/ui';
import { useMinWidth } from '../lib/useMinWidth';
import { Card } from './Card';
import { SlideOver } from './SlideOver';

/**
 * Hét detailpaneel van het portaal — één patroon voor "iets uit een lijst
 * openen". Onder `lg` (1024 px) is het een SlideOver (terugknop, swipe-back
 * en Escape sluiten via de useHistoryDismiss die SlideOver al heeft); vanaf
 * `lg` een kaart die náást de lijst staat (master-detail) en onder de topbar
 * blijft plakken. Views vertakken niet meer zelf op het breekpunt: ze geven
 * `open`, kop, inhoud en eventueel een footer met acties.
 *
 * Desktop heeft bewust geen sluitkruis: het paneel staat gewoon naast de
 * lijst. Een andere rij kiezen wisselt de inhoud; acties in de footer
 * (opslaan, beslissen, annuleren) roepen `onClose` aan waar dat past, en
 * het paneel valt dan terug op de lege staat ("Kies een …").
 */
const LG = 1024;

/**
 * Staat het paneel inline naast de lijst (lg+)? Alleen voor views die op
 * desktop een standaardkeuze willen (bv. de nieuwste update meteen open,
 * zodat het paneel nooit leeg opent) — verder hoort een view niet op het
 * breekpunt te vertakken; DetailPaneel doet dat zelf.
 */
export function useInlinePaneel() {
  return useMinWidth(LG);
}

/**
 * Lijst + paneel naast elkaar vanaf `lg` (lijst 38 %, paneel de rest);
 * eronder gewoon de lijst — het paneel is dan een SlideOver (portal) en
 * neemt geen plaats in. Zonder `paneel` (bv. lege lijst met EmptyState)
 * krijgt de lijst de volle breedte.
 */
export function MasterDetail({ lijst, paneel, className }: {
  lijst: ReactNode;
  paneel?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('lg:grid lg:grid-cols-[minmax(0,38%)_1fr] lg:items-start lg:gap-5', className)}>
      <div className={cn('min-w-0', !paneel && 'lg:col-span-2')}>{lijst}</div>
      {paneel}
    </div>
  );
}

export function DetailPaneel({
  open,
  onClose,
  title,
  subtitle,
  icon,
  footer,
  children,
  breedte = 'md',
  sleutel,
  leegTekst = 'Kies een item uit de lijst.',
  leegActie,
  verbergLeeg = false,
  plakkend = true,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  /** Icoontegel links van de titel (zelf sizen, bv. h-9 w-9). */
  icon?: ReactNode;
  /** Actieknoppen onderaan: vast in beeld, los van de scrollende inhoud. */
  footer?: ReactNode;
  children: ReactNode;
  /** Breedte van de mobiele SlideOver. */
  breedte?: 'md' | 'lg';
  /** Id van het getoonde item: bij wissel scrolt de inhoud terug naar boven
   *  en komt het paneel op desktop in beeld. */
  sleutel?: string;
  /** Lege staat op desktop (niets gekozen). */
  leegTekst?: string;
  /** Optionele knop onder de lege-staat-tekst (bv. "Nieuwe omleiding"). */
  leegActie?: ReactNode;
  /** Geen lege-staat-kaart tonen (paneel dat alleen bestaat terwijl het open is,
   *  bv. de verlofbeoordeling bovenaan een kolom die verder al gevuld is). */
  verbergLeeg?: boolean;
  /** `lg:sticky` onder de topbar — uit voor een paneel in een gewone kolomflow. */
  plakkend?: boolean;
  className?: string;
}) {
  const inline = useMinWidth(LG);
  const wortel = useRef<HTMLDivElement>(null);

  // Desktop: het paneel in beeld brengen zodra er iets (anders) gekozen is —
  // wie onderaan een lange lijst klikt, ziet anders niets gebeuren. Met een
  // plakkend paneel is dit meestal een no-op ('nearest').
  useEffect(() => {
    if (!inline || !open) return;
    const el = wortel.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
    return () => cancelAnimationFrame(raf);
  }, [inline, open, sleutel]);

  if (!inline) {
    return (
      <SlideOver open={open} onClose={onClose} title={title} subtitle={subtitle} icon={icon} width={breedte} footer={footer}>
        {children}
      </SlideOver>
    );
  }

  if (!open) {
    if (verbergLeeg) return null;
    return (
      <div ref={wortel} className={cn(plakkend && 'lg:sticky lg:top-16', className)} aria-live="polite">
        <Card tone="dashed" padding="lg" className="text-center">
          <p className="text-sm text-slate-500">{leegTekst}</p>
          {leegActie ? <div className="mt-4 flex justify-center">{leegActie}</div> : null}
        </Card>
      </div>
    );
  }

  return (
    <div ref={wortel} className={cn(plakkend && 'lg:sticky lg:top-16', className)} aria-live="polite">
      {/* Kop en footer staan vast; alleen de inhoud scrolt (max. de
          viewport onder de topbar) — zoals de SlideOver dat ook doet. */}
      <Card
        as="section"
        padding="none"
        aria-label={title}
        className={cn('flex flex-col overflow-hidden', plakkend && 'lg:max-h-[calc(100dvh_-_5rem)]')}
      >
        <div className="flex items-start gap-3 border-b border-slate-200/70 p-5 md:p-6">
          {icon}
          <div className="min-w-0 flex-1">
            <h2 className="text-section-title truncate">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-sm text-slate-500 truncate">{subtitle}</p> : null}
          </div>
        </div>
        <div key={sleutel} className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-5 md:p-6">
          {children}
        </div>
        {footer ? <div className="border-t border-slate-200/70 p-4 md:px-6">{footer}</div> : null}
      </Card>
    </div>
  );
}
