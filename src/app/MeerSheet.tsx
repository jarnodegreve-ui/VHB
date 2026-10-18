import { Settings } from 'lucide-react';
import type { Role, View } from '../types';
import { Sheet } from '../components/Sheet';
import { NavItem } from '../components/Navigation';
import { SidebarNav } from './SidebarNav';
import { prefetchView } from './viewLoaders';

/**
 * "Meer" op de telefoon (Apple-review 17-10, nr. 10): een sheet van onder
 * met alleen de schermen die niet in de onderbalk staan, plus Instellingen,
 * zoals de More-tab van iOS. Tot dan opende Meer de volledige zijbalk als
 * lade van links, met het grote logo en ook de vijf schermen uit de balk.
 * Op de tablet (geen onderbalk) blijft de zijbalk de lade achter "Menu
 * openen". Navigeren sluit het sheet in dezelfde beweging, zoals de lade.
 */
export function MeerSheet({ open, onClose, rol, ookTechnieker, currentView, badges, verberg, onNavigate }: {
  open: boolean;
  onClose: () => void;
  rol: Role;
  ookTechnieker?: boolean;
  currentView: View;
  badges: Partial<Record<View, number>>;
  /** De schermen in de onderbalk: die staan hier niet nog eens. */
  verberg: readonly View[];
  onNavigate: (view: View) => void;
}) {
  return (
    <Sheet open={open} onClose={onClose} title="Meer">
      <SidebarNav
        rol={rol}
        ookTechnieker={ookTechnieker}
        currentView={currentView}
        badges={badges}
        verberg={verberg}
        label="Meer"
        className="px-0 py-1"
        onNavigate={onNavigate}
      />
      <div className="mt-2 border-t border-hairline pt-2">
        <NavItem
          icon={<Settings size={16} />}
          label="Instellingen"
          active={currentView === 'instellingen'}
          onClick={() => onNavigate('instellingen')}
          onPrefetch={() => prefetchView('instellingen')}
        />
      </div>
    </Sheet>
  );
}
