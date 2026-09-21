/**
 * De lazy geladen schermen van de app: één `lazyWithRetry` per view, zodat elk
 * scherm zijn eigen chunk is. Stond tot 21-09 bovenaan App.tsx (G1); de
 * schermkeuze zelf staat in SchermInhoud.tsx. Schermen die ook in de warmup
 * of de nav-prefetch zitten laden via `VIEW_LOADERS` (viewLoaders.ts), zodat
 * prefetch en render dezelfde import delen.
 */
import type { ComponentType } from 'react';
import type { View } from '../types';
import { lazyWithRetry } from '../lib/lazyRetry';
import { VIEW_LOADERS, geladenView } from './viewLoaders';

/**
 * Eén scherm: lazy geladen via de loader uit viewLoaders.ts (zodat prefetch,
 * warmup en render dezelfde import delen), en meteen gerenderd als zijn
 * module al geladen is. Dat laatste voorkomt de skeletflits bij een
 * schermwissel: de router wacht even op de code (router.ts) en daarna staat
 * het scherm er zonder langs Suspense te gaan (zie lazyRetry.ts).
 *
 * `M` is het moduletype, `K` de naam van de geëxporteerde component; de
 * props van het scherm blijven dus gewoon getypeerd.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function scherm<M, K extends keyof M>(view: View, naam: M[K] extends ComponentType<any> ? K : never) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type C = M[K] extends ComponentType<any> ? M[K] : never;
  return lazyWithRetry<C>(
    () => VIEW_LOADERS[view]().then((m) => ({ default: (m as M)[naam] as C })),
    () => { const m = geladenView(view) as M | null; return m ? (m[naam] as C) : null; },
  );
}

// Planner/admin-views lazy: chauffeurs (de bulk van de gebruikers) laden zo
// géén beheer-code en vooral géén xlsx-bundel (~430 kB) bij het opstarten —
// die zit alleen in ManageSchedules/ManageServices/Reports/ManageUsers.
export const LazyActivityLogView = scherm<typeof import('../views/admin/ActivityLogView'), 'ActivityLogView'>('activiteit', 'ActivityLogView');
export const LazyOcpiDashboardView = scherm<typeof import('../views/admin/OcpiDashboardView'), 'OcpiDashboardView'>('ocpi-monitoring', 'OcpiDashboardView');
export const LazyVervaldataView = scherm<typeof import('../views/admin/VervaldataView'), 'VervaldataView'>('vervaldata', 'VervaldataView');
export const LazyZiekteView = scherm<typeof import('../views/admin/ZiekteView'), 'ZiekteView'>('ziekte', 'ZiekteView');
export const LazyManageSchedulesView = scherm<typeof import('../views/admin/ManageSchedulesView'), 'ManageSchedulesView'>('beheer-roosters', 'ManageSchedulesView');
export const LazyPlanningMatrixView = scherm<typeof import('../views/admin/PlanningMatrixView'), 'PlanningMatrixView'>('planning-matrix', 'PlanningMatrixView');
export const LazyPlanningCodesView = scherm<typeof import('../views/admin/PlanningCodesView'), 'PlanningCodesView'>('planning-codes', 'PlanningCodesView');
export const LazyManageDiversionsView = scherm<typeof import('../views/admin/ManageDiversionsView'), 'ManageDiversionsView'>('beheer-omleidingen', 'ManageDiversionsView');
export const LazyManageServicesView = scherm<typeof import('../views/admin/ManageServicesView'), 'ManageServicesView'>('beheer-dienstoverzicht', 'ManageServicesView');
export const LazyVerlofKalenderView = scherm<typeof import('../views/admin/VerlofKalenderView'), 'VerlofKalenderView'>('verlof-kalender', 'VerlofKalenderView');
export const LazyCoverageView = scherm<typeof import('../views/CoverageView'), 'CoverageView'>('dekking', 'CoverageView');
export const LazyDebugView = scherm<typeof import('../views/admin/DebugView'), 'DebugView'>('beheer-debug', 'DebugView');
// Techniek (fase A Access-migratie, 13-09): gele boek, werkprestaties, voertuigen.
export const LazyGeleBoekView = scherm<typeof import('../views/techniek/GeleBoekView'), 'GeleBoekView'>('defecten', 'GeleBoekView');
export const LazyWerkprestatiesView = scherm<typeof import('../views/techniek/WerkprestatiesView'), 'WerkprestatiesView'>('werkprestaties', 'WerkprestatiesView');
export const LazyVoertuigWerkenView = scherm<typeof import('../views/techniek/VoertuigWerkenView'), 'VoertuigWerkenView'>('voertuig-werken', 'VoertuigWerkenView');
export const LazyVoertuigenView = scherm<typeof import('../views/techniek/VoertuigenView'), 'VoertuigenView'>('voertuigen', 'VoertuigenView');
// Loon (fase B Access-migratie, 13-09): dagafsluiting en looncontrole.
export const LazyDagafsluitingView = scherm<typeof import('../views/admin/DagafsluitingView'), 'DagafsluitingView'>('dagafsluiting', 'DagafsluitingView');
export const LazyDienstopbouwView = scherm<typeof import('../views/admin/DienstopbouwView'), 'DienstopbouwView'>('dienstopbouw', 'DienstopbouwView');
export const LazyLooncontroleView = scherm<typeof import('../views/admin/LooncontroleView'), 'LooncontroleView'>('looncontrole', 'LooncontroleView');
export const LazyManageUpdatesView = scherm<typeof import('../views/admin/ManageUpdatesView'), 'ManageUpdatesView'>('beheer-updates', 'ManageUpdatesView');
export const LazyManageUsersView = scherm<typeof import('../views/admin/ManageUsersView'), 'ManageUsersView'>('gebruikers', 'ManageUsersView');
export const LazyDevicesView = scherm<typeof import('../views/admin/DevicesView'), 'DevicesView'>('toestellen', 'DevicesView');
export const LazyRapportenView = scherm<typeof import('../views/admin/RapportenView'), 'RapportenView'>('rapporten', 'RapportenView');
export const LazyVandaagView = scherm<typeof import('../views/VandaagView'), 'VandaagView'>('vandaag', 'VandaagView');
export const LazyWerkvoorraadView = scherm<typeof import('../views/WerkvoorraadView'), 'WerkvoorraadView'>('werkvoorraad', 'WerkvoorraadView');
export const LazyLeaveManagementView = scherm<typeof import('../views/LeaveManagementView'), 'LeaveManagementView'>('verlof', 'LeaveManagementView');
// Ook lazy (planner/admin-only, maar stond eager in de hoofdbundel): de
// ops-cockpit sleept ops/coverage/monthPlanning mee die een chauffeur nooit
// nodig heeft; het dienstoverzicht idem.
// Chauffeursviews ook lazy (nr. 12, 03-09): de startbundel is alleen nog de
// schil; SidebarNav/BottomNav prefetchen bij hover/aanraken (viewLoaders).
export const LazyContactsView = scherm<typeof import('../views/ContactsView'), 'ContactsView'>('contacten', 'ContactsView');
export const LazyDashboardView = scherm<typeof import('../views/DashboardView'), 'DashboardView'>('dashboard', 'DashboardView');
export const LazyMijnDagView = scherm<typeof import('../views/MijnDagView'), 'MijnDagView'>('mijn-dag', 'MijnDagView');
export const LazyDiversionsView = scherm<typeof import('../views/DiversionsView'), 'DiversionsView'>('omleidingen', 'DiversionsView');
export const LazyScheduleView = scherm<typeof import('../views/ScheduleView'), 'ScheduleView'>('rooster', 'ScheduleView');
export const LazyUpdatesView = scherm<typeof import('../views/UpdatesView'), 'UpdatesView'>('updates', 'UpdatesView');
export const LazyMeldingenView = scherm<typeof import('../views/MeldingenView'), 'MeldingenView'>('meldingen', 'MeldingenView');
export const LazySwapRequestsView = scherm<typeof import('../views/SwapRequestsView'), 'SwapRequestsView'>('ruil-verzoeken', 'SwapRequestsView');
export const LazyRitblaadjesView = scherm<typeof import('../views/RitblaadjesView'), 'RitblaadjesView'>('ritblaadjes', 'RitblaadjesView');
export const LazyDocumentsView = scherm<typeof import('../views/DocumentsView'), 'DocumentsView'>('documenten', 'DocumentsView');
export const LazyCapacityView = scherm<typeof import('../views/CapacityView'), 'CapacityView'>('bezetting', 'CapacityView');
export const LazyDesignsysteemView = scherm<typeof import('../views/admin/DesignsysteemView'), 'DesignsysteemView'>('designsysteem', 'DesignsysteemView');
export const LazyInstellingenView = scherm<typeof import('../views/InstellingenView'), 'InstellingenView'>('instellingen', 'InstellingenView');
export const LazyPlannerDashboardWidgets = lazyWithRetry(() => import('../views/PlannerDashboardWidgets').then((module) => ({ default: module.PlannerDashboardWidgets })));
export const LazyServicesView = scherm<typeof import('../views/ServicesView'), 'ServicesView'>('dienstoverzicht', 'ServicesView');
