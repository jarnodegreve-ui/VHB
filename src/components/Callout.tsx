import { AlertTriangle, CheckCircle2, Info, OctagonAlert, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../lib/ui';
import { Card } from './Card';

/**
 * Callout (ronde 5, F2): één meldingsvlak in de inhoud met icoon, titel,
 * tekst en één actie. Bouwt op `Card tone` (vlak 50 + rand 200 uit de
 * gedempte statusfamilies, elev-0) en vervangt de handgeschreven
 * icoon-plus-tekst-rijen in een getinte kaart (offline-balk, gevarenzone,
 * migratie-hint). `compact` = één regel: icoon, tekst, actie rechts.
 *
 * Geen `role` standaard: een callout die al bij het laden in beeld staat is
 * inhoud, geen live-melding. Geef `role="status"` of `"alert"` alleen mee
 * als het vlak verschijnt als gevolg van een actie.
 */
type CalloutTone = 'info' | 'warning' | 'danger' | 'success' | 'accent';

const TEKST: Record<CalloutTone, string> = {
  info: 'text-blue-800',
  warning: 'text-amber-800',
  danger: 'text-red-800',
  success: 'text-emerald-800',
  accent: 'text-oker-800',
};
const ICOON: Record<CalloutTone, string> = {
  info: 'text-blue-700',
  warning: 'text-amber-700',
  danger: 'text-red-700',
  success: 'text-emerald-700',
  accent: 'text-oker-700',
};
const STANDAARD_ICOON: Record<CalloutTone, ReactNode> = {
  info: <Info size={16} />,
  warning: <AlertTriangle size={16} />,
  danger: <OctagonAlert size={16} />,
  success: <CheckCircle2 size={16} />,
  accent: <Sparkles size={16} />,
};

export function Callout({ tone = 'info', icon, title, children, action, compact = false, role, className }: {
  tone?: CalloutTone;
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  role?: 'status' | 'alert';
  className?: string;
}) {
  return (
    <Card tone={tone} padding="none" role={role} className={cn('flex gap-3', compact ? 'items-center px-4 py-3' : 'items-start px-4 py-3.5 sm:px-5', action && !compact && 'flex-col sm:flex-row sm:items-center', className)}>
      <div className={cn('flex min-w-0 flex-1 gap-3', compact ? 'items-center' : 'items-start')}>
        <span className={cn('shrink-0', !compact && 'mt-0.5', ICOON[tone])} aria-hidden="true">{icon ?? STANDAARD_ICOON[tone]}</span>
        <div className={cn('min-w-0 flex-1', TEKST[tone])}>
          {title && <p className="text-sm font-semibold">{title}</p>}
          {children && <div className={cn(compact ? 'text-sm font-medium' : 'text-body-sm', title && 'mt-0.5')}>{children}</div>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </Card>
  );
}
