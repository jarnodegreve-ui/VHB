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
        onPrefetch={() => prefetchView(r.view)}
      />
    );
  };
  const algemeen = sidebarRoutes(wie, 'algemeen');
  const planning = sidebarRoutes(wie, 'planning');
  const mensen = sidebarRoutes(wie, 'mensen');
  const communicatie = sidebarRoutes(wie, 'communicatie');
  const rapporten = sidebarRoutes(wie, 'rapporten');
  const techniek = sidebarRoutes(wie, 'techniek');
  const systeem = sidebarRoutes(wie, 'systeem');
  const beheer = [...planning, ...mensen, ...communicatie];
  return (
    <nav className="flex-1 min-h-0 px-3 py-2 space-y-0.5 overflow-y-auto overscroll-contain" aria-label="Zijbalk">
      {isPlanner && <MicroLabel className="mb-1 px-3 pt-0.5">Algemeen</MicroLabel>}
      {algemeen.map(item)}
      {isPlanner && beheer.length > 0 && (
        <NavSection title="Beheer" count={beheer.length} active={beheer.some((r) => r.view === currentView)}>
          <NavSubLabel>Planning</NavSubLabel>
          {planning.map(item)}
          <NavSubLabel>Personeel</NavSubLabel>
          {mensen.map(item)}
          <NavSubLabel>Communicatie</NavSubLabel>
          {communicatie.map(item)}
        </NavSection>
      )}
      {/* Rapporten: één ingang naar de catalogus (de rapporten zelf staan
          dáár, niet in het menu), dus een los item zoals onder Algemeen en
          geen uitklapsectie met één regel. */}
      {rapporten.length > 0 && (
        <>
          <MicroLabel className="mb-1 px-3 pt-3">Rapporten</MicroLabel>
          {rapporten.map(item)}
        </>
      )}
      {/* Techniek: garagewerk voor de technieker (zijn enige beheerblok), een
          chauffeur met "Ook technieker" en staf (bussen inplannen, opvolgen). */}
      {techniek.length > 0 && (
        <NavSection title="Techniek" count={techniek.length} active={techniek.some((r) => r.view === currentView)}>
          {techniek.map(item)}
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
