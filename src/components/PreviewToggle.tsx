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
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-oker-200/70 bg-oker-500/10 px-4 py-2.5">
      <div className="flex items-center gap-2 min-w-0">
        <Eye size={15} className="shrink-0 text-oker-600" />
        <span className="text-[12.5px] font-medium text-slate-600 truncate">
          {active ? 'Je bekijkt het portaal als een chauffeur.' : 'Bekijk het portaal als een chauffeur.'}
        </span>
      </div>
      <button
        type="button"
        onClick={onToggle}
        role="switch"
        aria-checked={active}
        aria-label="Chauffeurs-weergave"
        className={`ios-pressable relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${active ? 'bg-oker-500' : 'bg-slate-300'}`}
      >
        <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${active ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}
