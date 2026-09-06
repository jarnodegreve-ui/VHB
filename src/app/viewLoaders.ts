import type { View } from '../types';

/**
 * Eén loader per view — gebruikt door de lazy componenten in App.tsx én door
 * de prefetch bij hover/aanraken van een nav-item (SidebarNav, BottomNav,
 * palette). Zo zit alleen de schil in de startbundel en voelt de eerste
 * navigatie toch instant. Bewust géén xlsx-views voorladen: die (±430 kB)
 * laden pas bij echt gebruik.
 */
export const VIEW_LOADERS: Record<View, () => Promise<unknown>> = {
  dashboard: () => import('../views/DashboardView'),
  'mijn-dag': () => import('../views/MijnDagView'),
  rooster: () => import('../views/ScheduleView'),
  omleidingen: () => import('../views/DiversionsView'),
  ritblaadjes: () => import('../views/RitblaadjesView'),
  documenten: () => import('../views/DocumentsView'),
  'ruil-verzoeken': () => import('../views/SwapRequestsView'),
  verlof: () => import('../views/LeaveManagementView'),
  updates: () => import('../views/UpdatesView'),
  meldingen: () => import('../views/MeldingenView'),
  contacten: () => import('../views/ContactsView'),
  bezetting: () => import('../views/CapacityView'),
  'beheer-roosters': () => import('../views/admin/ManageSchedulesView'),
  'planning-matrix': () => import('../views/admin/PlanningMatrixView'),
  'planning-codes': () => import('../views/admin/PlanningCodesView'),
  dienstoverzicht: () => import('../views/ServicesView'),
  'beheer-dienstoverzicht': () => import('../views/admin/ManageServicesView'),
  dekking: () => import('../views/CoverageView'),
  assistent: () => import('../views/AssistentView'),
  'verlof-kalender': () => import('../views/admin/VerlofKalenderView'),
  ziekte: () => import('../views/admin/ZiekteView'),
  vervaldata: () => import('../views/admin/VervaldataView'),
  'beheer-updates': () => import('../views/admin/ManageUpdatesView'),
  'beheer-omleidingen': () => import('../views/admin/ManageDiversionsView'),
  gebruikers: () => import('../views/admin/ManageUsersView'),
  toestellen: () => import('../views/admin/DevicesView'),
  activiteit: () => import('../views/admin/ActivityLogView'),
  'ocpi-monitoring': () => import('../views/admin/OcpiDashboardView'),
  'beheer-debug': () => import('../views/admin/DebugView'),
  instellingen: () => import('../views/InstellingenView'),
  designsysteem: () => import('../views/admin/DesignsysteemView'),
};

const ZWAAR: ReadonlySet<View> = new Set<View>(['beheer-roosters', 'beheer-dienstoverzicht', 'gebruikers']);
const gedaan = new Set<View>();

/** Stil voorladen (idempotent); zware xlsx-views alleen op expliciete vraag. */
export function prefetchView(view: View, opts: { ookZwaar?: boolean } = {}) {
  if (gedaan.has(view)) return;
  if (ZWAAR.has(view) && !opts.ookZwaar) return;
  gedaan.add(view);
  void VIEW_LOADERS[view]().catch(() => { gedaan.delete(view); });
}
