/**
 * De lazy geladen schermen van de app: één `lazyWithRetry` per view, zodat elk
 * scherm zijn eigen chunk is. Stond tot 21-09 bovenaan App.tsx (G1); de
 * schermkeuze zelf staat in SchermInhoud.tsx. Schermen die ook in de warmup
 * of de nav-prefetch zitten laden via `VIEW_LOADERS` (viewLoaders.ts), zodat
 * prefetch en render dezelfde import delen.
 */
import { lazyWithRetry } from '../lib/lazyRetry';
import { VIEW_LOADERS } from './viewLoaders';

// Planner/admin-views lazy: chauffeurs (de bulk van de gebruikers) laden zo
// géén beheer-code en vooral géén xlsx-bundel (~430 kB) bij het opstarten —
// die zit alleen in ManageSchedules/ManageServices/Reports/ManageUsers.
export const LazyActivityLogView = lazyWithRetry(() => import('../views/admin/ActivityLogView').then((module) => ({ default: module.ActivityLogView })));
export const LazyOcpiDashboardView = lazyWithRetry(() => import('../views/admin/OcpiDashboardView').then((module) => ({ default: module.OcpiDashboardView })));
export const LazyVervaldataView = lazyWithRetry(() => import('../views/admin/VervaldataView').then((module) => ({ default: module.VervaldataView })));
export const LazyZiekteView = lazyWithRetry(() => import('../views/admin/ZiekteView').then((module) => ({ default: module.ZiekteView })));
export const LazyManageSchedulesView = lazyWithRetry(() => import('../views/admin/ManageSchedulesView').then((module) => ({ default: module.ManageSchedulesView })));
export const LazyPlanningMatrixView = lazyWithRetry(() => import('../views/admin/PlanningMatrixView').then((module) => ({ default: module.PlanningMatrixView })));
export const LazyPlanningCodesView = lazyWithRetry(() => import('../views/admin/PlanningCodesView').then((module) => ({ default: module.PlanningCodesView })));
export const LazyManageDiversionsView = lazyWithRetry(() => import('../views/admin/ManageDiversionsView').then((module) => ({ default: module.ManageDiversionsView })));
export const LazyManageServicesView = lazyWithRetry(() => import('../views/admin/ManageServicesView').then((module) => ({ default: module.ManageServicesView })));
export const LazyVerlofKalenderView = lazyWithRetry(() => import('../views/admin/VerlofKalenderView').then((module) => ({ default: module.VerlofKalenderView })));
export const LazyCoverageView = lazyWithRetry(() => import('../views/CoverageView').then((module) => ({ default: module.CoverageView })));
export const LazyDebugView = lazyWithRetry(() => import('../views/admin/DebugView').then((module) => ({ default: module.DebugView })));
// Techniek (fase A Access-migratie, 13-09): gele boek, werkprestaties, voertuigen.
export const LazyGeleBoekView = lazyWithRetry(() => VIEW_LOADERS['defecten']().then((m) => ({ default: (m as typeof import('../views/techniek/GeleBoekView')).GeleBoekView })));
export const LazyWerkprestatiesView = lazyWithRetry(() => VIEW_LOADERS['werkprestaties']().then((m) => ({ default: (m as typeof import('../views/techniek/WerkprestatiesView')).WerkprestatiesView })));
export const LazyVoertuigWerkenView = lazyWithRetry(() => VIEW_LOADERS['voertuig-werken']().then((m) => ({ default: (m as typeof import('../views/techniek/VoertuigWerkenView')).VoertuigWerkenView })));
export const LazyVoertuigenView = lazyWithRetry(() => VIEW_LOADERS['voertuigen']().then((m) => ({ default: (m as typeof import('../views/techniek/VoertuigenView')).VoertuigenView })));
// Loon (fase B Access-migratie, 13-09): dagafsluiting en looncontrole.
export const LazyDagafsluitingView = lazyWithRetry(() => VIEW_LOADERS['dagafsluiting']().then((m) => ({ default: (m as typeof import('../views/admin/DagafsluitingView')).DagafsluitingView })));
export const LazyDienstopbouwView = lazyWithRetry(() => VIEW_LOADERS['dienstopbouw']().then((m) => ({ default: (m as typeof import('../views/admin/DienstopbouwView')).DienstopbouwView })));
export const LazyLooncontroleView = lazyWithRetry(() => VIEW_LOADERS['looncontrole']().then((m) => ({ default: (m as typeof import('../views/admin/LooncontroleView')).LooncontroleView })));
export const LazyManageUpdatesView = lazyWithRetry(() => import('../views/admin/ManageUpdatesView').then((module) => ({ default: module.ManageUpdatesView })));
export const LazyManageUsersView = lazyWithRetry(() => import('../views/admin/ManageUsersView').then((module) => ({ default: module.ManageUsersView })));
export const LazyDevicesView = lazyWithRetry(() => import('../views/admin/DevicesView').then((module) => ({ default: module.DevicesView })));
export const LazyRapportenView = lazyWithRetry(() => VIEW_LOADERS['rapporten']().then((m) => ({ default: (m as typeof import('../views/admin/RapportenView')).RapportenView })));
export const LazyWerkvoorraadView = lazyWithRetry(() => VIEW_LOADERS['werkvoorraad']().then((m) => ({ default: (m as typeof import('../views/WerkvoorraadView')).WerkvoorraadView })));
export const LazyLeaveManagementView = lazyWithRetry(() => import('../views/LeaveManagementView').then((module) => ({ default: module.LeaveManagementView })));
// Ook lazy (planner/admin-only, maar stond eager in de hoofdbundel): de
// ops-cockpit sleept ops/coverage/monthPlanning mee die een chauffeur nooit
// nodig heeft; het dienstoverzicht idem.
// Chauffeursviews ook lazy (nr. 12, 03-09): de startbundel is alleen nog de
// schil; SidebarNav/BottomNav prefetchen bij hover/aanraken (viewLoaders).
export const LazyContactsView = lazyWithRetry(() => VIEW_LOADERS['contacten']().then((m) => ({ default: (m as typeof import('../views/ContactsView')).ContactsView })));
export const LazyDashboardView = lazyWithRetry(() => VIEW_LOADERS['dashboard']().then((m) => ({ default: (m as typeof import('../views/DashboardView')).DashboardView })));
export const LazyMijnDagView = lazyWithRetry(() => VIEW_LOADERS['mijn-dag']().then((m) => ({ default: (m as typeof import('../views/MijnDagView')).MijnDagView })));
export const LazyDiversionsView = lazyWithRetry(() => VIEW_LOADERS['omleidingen']().then((m) => ({ default: (m as typeof import('../views/DiversionsView')).DiversionsView })));
export const LazyScheduleView = lazyWithRetry(() => VIEW_LOADERS['rooster']().then((m) => ({ default: (m as typeof import('../views/ScheduleView')).ScheduleView })));
export const LazyUpdatesView = lazyWithRetry(() => VIEW_LOADERS['updates']().then((m) => ({ default: (m as typeof import('../views/UpdatesView')).UpdatesView })));
export const LazyMeldingenView = lazyWithRetry(() => VIEW_LOADERS['meldingen']().then((m) => ({ default: (m as typeof import('../views/MeldingenView')).MeldingenView })));
export const LazySwapRequestsView = lazyWithRetry(() => VIEW_LOADERS['ruil-verzoeken']().then((m) => ({ default: (m as typeof import('../views/SwapRequestsView')).SwapRequestsView })));
export const LazyRitblaadjesView = lazyWithRetry(() => VIEW_LOADERS['ritblaadjes']().then((m) => ({ default: (m as typeof import('../views/RitblaadjesView')).RitblaadjesView })));
export const LazyDocumentsView = lazyWithRetry(() => VIEW_LOADERS['documenten']().then((m) => ({ default: (m as typeof import('../views/DocumentsView')).DocumentsView })));
export const LazyCapacityView = lazyWithRetry(() => VIEW_LOADERS['bezetting']().then((m) => ({ default: (m as typeof import('../views/CapacityView')).CapacityView })));
export const LazyDesignsysteemView = lazyWithRetry(() => VIEW_LOADERS['designsysteem']().then((m) => ({ default: (m as typeof import('../views/admin/DesignsysteemView')).DesignsysteemView })));
export const LazyInstellingenView = lazyWithRetry(() => VIEW_LOADERS['instellingen']().then((m) => ({ default: (m as typeof import('../views/InstellingenView')).InstellingenView })));
export const LazyPlannerDashboardWidgets = lazyWithRetry(() => import('../views/PlannerDashboardWidgets').then((module) => ({ default: module.PlannerDashboardWidgets })));
export const LazyServicesView = lazyWithRetry(() => import('../views/ServicesView').then((module) => ({ default: module.ServicesView })));
