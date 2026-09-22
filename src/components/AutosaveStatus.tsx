import { Check } from 'lucide-react';
import type { AutosaveStaat } from '../lib/autosave';
import { BrandSpinner } from './BrandSpinner';
import { Button } from './primitives';

/**
 * Stand van één autosave-cel (tranche 3A, 22-09-2026), zie src/lib/autosave.ts.
 *
 * `AutosaveTeken` staat naast het control in een vast vakje van 16 px (geen
 * verspringende kolom): spinner tijdens het bewaren, kort een stil vinkje
 * erna. `AutosaveFout` staat onder het control: de reden en, als de save
 * mislukte, "Opnieuw" voor precies die waarde. Het control zelf krijgt
 * `invalid` en `aria-describedby={foutId}`.
 */
export function AutosaveTeken({ staat }: { staat: AutosaveStaat<unknown> }) {
  return (
    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center" aria-live="polite">
      {staat.status === 'bezig' ? (
        <><BrandSpinner size={14} /><span className="sr-only">Bewaren…</span></>
      ) : staat.status === 'bewaard' ? (
        <><Check size={14} className="text-emerald-700" aria-hidden="true" /><span className="sr-only">Bewaard</span></>
      ) : null}
    </span>
  );
}

export function AutosaveFout({ staat, id }: { staat: AutosaveStaat<unknown>; id: string }) {
  if (staat.status !== 'fout') return null;
  return (
    <div id={id} role="alert" className="mt-1 w-44 whitespace-normal text-left text-xs font-medium text-red-700">
      {staat.melding}
      {staat.opnieuw && (
        <Button variant="ghost" size="sm" className="ml-1 !px-1.5 !py-0.5 text-xs" onClick={staat.opnieuw}>Opnieuw</Button>
      )}
    </div>
  );
}
