import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Card } from './Card';
import { cn } from '../lib/ui';
import { Badge, Button } from './primitives';
import { gezienNieuwsId, markeerNieuwsGezien, nieuwsRolVan, ongezienNieuws } from '../app/watIsNieuw';
import type { View } from '../types';

/**
 * Dismissbare "Wat is nieuw"-kaart bovenaan het dashboard (één per release,
 * per rol andere regels). Inhoud en zichtbaarheid: src/app/watIsNieuw.ts.
 */
export function WatIsNieuwKaart({ rol, onNavigate, className }: { rol: string; onNavigate?: (view: View) => void; className?: string }) {
  const nieuwsRol = nieuwsRolVan(rol);
  const [item, setItem] = useState(() => ongezienNieuws(nieuwsRol, gezienNieuwsId()));
  if (!item) return null;
  const regels = item.regels[nieuwsRol] ?? [];
  const bekijk = item.bekijk?.[nieuwsRol];
  const sluit = () => {
    markeerNieuwsGezien(item.id);
    setItem(null);
  };
  return (
    <Card tone="muted" padding="sm" className={cn('flex flex-col gap-3 sm:flex-row sm:items-start', className)} role="region" aria-label="Wat is nieuw">
      <div className="mt-0.5 hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-oker-500/15 text-oker-700 sm:flex">
        <Sparkles size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="text-card-title">{item.titel}</p>
          <Badge tone="oker">Nieuw</Badge>
        </div>
        <ul className="mt-1.5 space-y-1 text-sm text-slate-600">
          {regels.map((regel) => (
            <li key={regel} className="flex gap-2">
              <span className="mt-[0.55em] h-1 w-1 shrink-0 rounded-full bg-oker-500" aria-hidden="true" />
              <span>{regel}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex shrink-0 gap-2 sm:pt-0.5">
        {bekijk && onNavigate && (
          <Button variant="secondary" size="sm" onClick={() => { sluit(); onNavigate(bekijk as View); }}>
            Bekijk
          </Button>
        )}
        <Button variant="ghost" size="sm" onClick={sluit}>
          Begrepen
        </Button>
      </div>
    </Card>
  );
}
