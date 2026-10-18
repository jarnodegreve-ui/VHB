import type { Role, View } from '../types';
import { MicroLabel } from '../components/primitives';
import { NavItem, NavSection, NavSubLabel } from '../components/Navigation';
import { sidebarRoutes, type RouteDef } from './routes';
import { prefetchView } from './viewLoaders';

/**
 * Zijbalk-navigatie, volledig uit de routetabel (routes.tsx): secties,
 * iconen en labels staan daar één keer. Badges komen als map binnen zodat
 * de teller-logica in App blijft (die kent de data).
 */
export function SidebarNav({
  rol,
  ookTechnieker,
  currentView,
  badges,
  onNavigate,
}: {
  /** Effectieve rol (preview-modus verrekend) — bepaalt welke secties er zijn. */
  rol: Role;
  /** Chauffeur die ook technieker is: de sectie Techniek komt erbij. */
  ookTechnieker?: boolean;
  currentView: View;
  badges: Partial<Record<View, number>>;
  onNavigate: (view: View) => void;
}) {
  const wie = { role: rol, ookTechnieker };
  const isPlanner = rol === 'planner' || rol === 'admin';
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
        onPrefetch={() => prefetchView(r.view)}
      />
    );
  };
  const algemeen = sidebarRoutes(wie, 'algemeen');
  const planning = sidebarRoutes(wie, 'planning');
  const afwezigheid = sidebarRoutes(wie, 'afwezigheid');
  const communicatie = sidebarRoutes(wie, 'communicatie');
  const techniek = sidebarRoutes(wie, 'techniek');
  const systeem = sidebarRoutes(wie, 'systeem');
  const beheer = [...planning, ...afwezigheid, ...communicatie];
  return (
    <nav className="flex-1 min-h-0 px-3 py-2 space-y-0.5 overflow-y-auto overscroll-contain" aria-label="Zijbalk">
      {isPlanner && <MicroLabel className="mb-1 px-3 pt-0.5">Algemeen</MicroLabel>}
      {algemeen.map(item)}
      {isPlanner && beheer.length > 0 && (
        <NavSection title="Beheer" count={beheer.length} active={beheer.some((r) => r.view === currentView)}>
          <NavSubLabel>Planning</NavSubLabel>
          {planning.map(item)}
          <NavSubLabel>Afwezigheid</NavSubLabel>
          {afwezigheid.map(item)}
          <NavSubLabel>Communicatie</NavSubLabel>
          {communicatie.map(item)}
        </NavSection>
      )}
      {/* Techniek: garagewerk voor de technieker (zijn enige beheerblok), een
          chauffeur met "Ook technieker" en staf (bussen inplannen, opvolgen). */}
      {techniek.length > 0 && (
        <NavSection title="Techniek" count={techniek.length} active={techniek.some((r) => r.view === currentView)}>
          {techniek.map(item)}
        </NavSection>
      )}
      {/* Systeem: de admin-schermen plus Rapporten (30-09, Jarno), dat ook de
          planner mag; die ziet hier dus alleen Rapporten. */}
      {systeem.length > 0 && (
        <NavSection title="Systeem" count={systeem.length} active={systeem.some((r) => r.view === currentView)}>
          {systeem.map(item)}
        </NavSection>
      )}
    </nav>
  );
}
