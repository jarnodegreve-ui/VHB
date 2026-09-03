import type { Role, View } from '../types';
import { MicroLabel } from '../components/primitives';
import { NavItem, NavSection, NavSubLabel } from '../components/Navigation';
import { sidebarRoutes, type RouteDef } from './routes';

/**
 * Zijbalk-navigatie, volledig uit de routetabel (routes.tsx): secties,
 * iconen en labels staan daar één keer. Badges komen als map binnen zodat
 * de teller-logica in App blijft (die kent de data).
 */
export function SidebarNav({
  rol,
  currentView,
  badges,
  onNavigate,
}: {
  /** Effectieve rol (preview-modus verrekend) — bepaalt welke secties er zijn. */
  rol: Role;
  currentView: View;
  badges: Partial<Record<View, number>>;
  onNavigate: (view: View) => void;
}) {
  const isPlanner = rol === 'planner' || rol === 'admin';
  const isAdmin = rol === 'admin';
  const item = (r: RouteDef) => {
    const Icoon = r.icoon;
    return (
      <NavItem
        key={r.view}
        icon={<Icoon size={16} />}
        label={r.label}
        active={currentView === r.view}
        badge={badges[r.view] || undefined}
        onClick={() => onNavigate(r.view)}
      />
    );
  };
  const algemeen = sidebarRoutes(rol, 'algemeen');
  const planning = sidebarRoutes(rol, 'planning');
  const mensen = sidebarRoutes(rol, 'mensen');
  const communicatie = sidebarRoutes(rol, 'communicatie');
  const systeem = sidebarRoutes(rol, 'systeem');
  const beheer = [...planning, ...mensen, ...communicatie];
  return (
    <nav className="flex-1 min-h-0 px-3 py-2 space-y-0.5 overflow-y-auto overscroll-contain" aria-label="Zijbalk">
      {isPlanner && <MicroLabel className="mb-1 px-3 pt-0.5">Algemeen</MicroLabel>}
      {algemeen.map(item)}
      {isPlanner && beheer.length > 0 && (
        <NavSection title="Beheer" count={beheer.length} active={beheer.some((r) => r.view === currentView)}>
          <NavSubLabel>Planning</NavSubLabel>
          {planning.map(item)}
          <NavSubLabel>Mensen</NavSubLabel>
          {mensen.map(item)}
          <NavSubLabel>Communicatie</NavSubLabel>
          {communicatie.map(item)}
        </NavSection>
      )}
      {isAdmin && systeem.length > 0 && (
        <NavSection title="Systeem" count={systeem.length} active={systeem.some((r) => r.view === currentView)}>
          {systeem.map(item)}
        </NavSection>
      )}
    </nav>
  );
}
