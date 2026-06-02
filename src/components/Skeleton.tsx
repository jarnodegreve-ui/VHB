import { cn } from '../lib/ui';

/**
 * Skeleton-loader met glass-DNA. Toon waar straks data komt — schetst
 * de layout met een shimmer-animatie zodat de pagina niet "leeg en
 * laadend" voelt maar "bijna klaar".
 */
export function Skeleton({
  className,
  rounded = 'md',
}: {
  className?: string;
  rounded?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | 'full';
}) {
  const radius = {
    sm: 'rounded-sm',
    md: 'rounded-md',
    lg: 'rounded-lg',
    xl: 'rounded-xl',
    '2xl': 'rounded-2xl',
    full: 'rounded-full',
  }[rounded];
  return <div className={cn('skeleton', radius, className)} aria-hidden="true" />;
}

/**
 * Pre-fab skeleton-rij voor lijst-items (avatar + 2 regels tekst).
 */
export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-3 p-3', className)}>
      <Skeleton rounded="xl" className="w-10 h-10 shrink-0" />
      <div className="flex-1 space-y-2">
        <Skeleton className="h-3 w-3/5" />
        <Skeleton className="h-2.5 w-2/5" />
      </div>
    </div>
  );
}

/**
 * Skeleton-tegel die qua maat ongeveer een StatTile vervangt.
 */
export function SkeletonTile({ className }: { className?: string }) {
  return (
    <div
      className={cn('rounded-[24px] p-5 relative overflow-hidden', className)}
      style={{
        background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.55) 0%, rgba(248, 250, 252, 0.4) 100%)',
        backdropFilter: 'blur(20px) saturate(140%)',
        WebkitBackdropFilter: 'blur(20px) saturate(140%)',
        border: '1px solid rgba(255, 255, 255, 0.7)',
      }}
    >
      <Skeleton rounded="xl" className="w-9 h-9" />
      <Skeleton className="mt-3 h-2 w-16" />
      <Skeleton className="mt-2 h-7 w-20" />
      <Skeleton className="mt-2 h-2.5 w-24" />
    </div>
  );
}
