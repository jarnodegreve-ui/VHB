import type { ReactNode } from 'react';
import { BrandBus } from './BrandBus';

/**
 * Vriendelijke empty state met de VHB-bus-mascotte.
 * Gebruik in plaats van platte "Geen X gevonden"-teksten.
 *
 * - bus: toon de mascotte (default true)
 * - title: hoofd-boodschap
 * - message: subtekst (optional)
 * - action: optionele knop/CTA
 */
export function BrandEmptyState({
  title,
  message,
  action,
  bus = true,
  className,
}: {
  title: string;
  message?: string;
  action?: ReactNode;
  bus?: boolean;
  className?: string;
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center py-10 px-4 ${className ?? ''}`}>
      {bus && (
        <div className="bus-sway mb-4">
          <BrandBus width={120} />
        </div>
      )}
      <h4 className="text-base font-black tracking-tight text-slate-800">{title}</h4>
      {message && (
        <p className="mt-1.5 max-w-sm text-sm font-medium text-slate-500">
          {message}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
