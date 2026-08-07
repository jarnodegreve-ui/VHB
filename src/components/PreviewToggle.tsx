import { Eye } from 'lucide-react';

/**
 * Admin-schakelaar "bekijk het portaal als een chauffeur" — enkel visueel:
 * rechten, data en de toegestane views blijven die van de admin.
 *
 * Staat bewust op BEIDE dashboards. Hij hing eerder alleen in de chauffeurs-
 * variant, waardoor een admin (die het Operations Center ziet) hem nooit kon
 * aanzetten — alleen weer uit.
 */
export function PreviewToggle({ active, onToggle }: { active: boolean; onToggle: () => void }) {
  // Compacte pill op inhoudsbreedte — als volle-breedte-balk oogde dit als
  // een systeemmelding i.p.v. een hulpmiddel (feedback Jarno).
  return (
    <div className="inline-flex w-fit items-center gap-2.5 rounded-full border border-oker-200/70 bg-oker-500/10 py-1.5 pl-3 pr-2">
      <Eye size={14} className="shrink-0 text-oker-600" />
      <span className="text-xs font-medium text-slate-600 whitespace-nowrap">
        {active ? 'Chauffeurs-weergave aan' : 'Bekijk als chauffeur'}
      </span>
      <button
        type="button"
        onClick={onToggle}
        role="switch"
        aria-checked={active}
        aria-label="Chauffeurs-weergave"
        className={`ios-pressable relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${active ? 'bg-oker-500' : 'bg-slate-300'}`}
      >
        <span className={`inline-block h-4 w-4 transform rounded-full bg-surface-white shadow transition-transform ${active ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}
