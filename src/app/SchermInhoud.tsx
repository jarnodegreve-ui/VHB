/**
 * De schermkeuze: welk scherm hoort bij de huidige view, met welke gegevens.
 * Stond tot 21-09 als blok van 146 regels midden in de render van App.tsx
 * (G1). De JSX is ongewijzigd verplaatst; wat uit de datalaag komt leest deze
 * component zelf uit de context, wat echt van App is (sessie, rol, thema,
 * push, de overlays) komt als prop binnen.
 *
 * Nieuw scherm = één regel in routes.tsx, een loader in viewLoaders.ts, een
 * lazy-declaratie in lazyViews.tsx en een case hieronder.
 */
import { Suspense } from 'react';
import { isStaf, type User, type View } from '../types';
import { isPushSupported } from '../lib/push';
import { DashboardSkelet, ViewLoader } from '../components/ui';
import { SchermInloop, Verwissel } from '../components/Verwissel';
import { WatIsNieuwKaart } from '../components/WatIsNieuwKaart';
import { useAppDataContext } from './AppDataContext';
import type { useRoute } from './router';
import { LazyActivityLogView, LazyCapacityView, LazyContactsView, LazyCoverageView, LazyDagafsluitingView, LazyDashboardView, LazyDebugView, LazyDesignsysteemView, LazyDevicesView, LazyDienstopbouwView, LazyDiversionsView, LazyDocumentsView, LazyGeleBoekView, LazyInstellingenView, LazyLeaveManagementView, LazyLooncontroleView, LazyManageDiversionsView, LazyManageSchedulesView, LazyManageServicesView, LazyManageUpdatesView, LazyManageUsersView, LazyMeldingenView, LazyMijnDagView, LazyOcpiDashboardView, LazyPlannerDashboardWidgets, LazyPlanningCodesView, LazyPlanningMatrixView, LazyRapportenView, LazyRitblaadjesView, LazyScheduleView, LazyServicesView, LazySwapRequestsView, LazyUpdatesView, LazyVandaagView, LazyVerlofKalenderView, LazyVervaldataView, LazyVoertuigWerkenView, LazyVoertuigenView, LazyWerkprestatiesView, LazyWerkvoorraadView, LazyZiekteView } from './lazyViews';

export type SchermInhoudProps = {
  /** De view na de rol-check (magView): nooit een scherm dat de rol niet mag. */
  resolvedCurrentView: View;
  currentUser: User;
  setCurrentView: (view: View) => void;
  navigeer: ReturnType<typeof useRoute>['navigeer'];
  isAdmin: boolean;
  isPlanner: boolean;
  /** Admin bekijkt de app als chauffeur (voorbeeldmodus). */
  previewingChauffeur: boolean;
  /** Ruilen én namen geladen: pas dan kloppen de ruilbadges. */
  ruilDataKlaar: boolean;
  swapPreselectShiftId: string | null;
  setSwapPreselectShiftId: (id: string | null) => void;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  pushEnabled: boolean;
  pushPublicKey: string | null;
  togglePush: () => void | Promise<void>;
  handleLogout: () => void | Promise<void>;
  setShowProbleemMelder: (open: boolean) => void;
  setShowChangePassword: (open: boolean) => void;
  setShowAgenda: (open: boolean) => void;
};

export function SchermInhoud(props: SchermInhoudProps) {
  const {
    resolvedCurrentView, currentUser, setCurrentView, navigeer, isAdmin, isPlanner, previewingChauffeur, ruilDataKlaar, swapPreselectShiftId, setSwapPreselectShiftId, theme, toggleTheme, pushEnabled, pushPublicKey, togglePush, handleLogout, setShowProbleemMelder, setShowChangePassword, setShowAgenda,
  } = props;
  const {
    aanwezigheid, aanwezigheidLocatieMigratie, aanwezigheidMigratie, activityLog, activityLogGeladen, confirmSwapSeen, createDiversion, createUpdate, decideLeave, decideSwap, deleteDiversion, deleteUpdate, diversions, feestdagenExtra, fetchActivityLog, fetchPlanning, fetchPlanningMatrix, fetchPlanningMatrixHistory, fetchSwaps, fetchUpdates, isInitialLoad, lastSeenLeaveDecisionAt, lastSyncedAt, leaveRequests, loginActivity, markDocumentsSeen, markLeaveDecisionsSeen, myNotes, planningCodes, planningCodesGeladen, planningMatrixGeladen, planningMatrixHistory, planningMatrixRows, planningTot, refreshCoverageGaps, reportSick, saveDiversion, saveDiversions, saveLeave, savePlanning, savePlanningCodes, saveServices, saveSwaps, saveUpdate, saveUpdates, sendUrgentEmail, services, servicesGeladen, shifts, swaps, updates, users, usersGeladen, zetFeestdagenExtra,
  } = useAppDataContext();
  return (
    <>
  <SchermInloop key={resolvedCurrentView}>
    {resolvedCurrentView === 'dashboard' && (
      isPlanner ? (
        /* Planner/admin: Operations Center — één operationele cockpit
           i.p.v. een dubbel dashboard. */
        <Suspense fallback={<DashboardSkelet />}>
        <WatIsNieuwKaart rol={currentUser!.role} onNavigate={setCurrentView} className="mb-5" />
        {/* Data (collecties, ziekmelding, verversen) leest de
            cockpit zelf uit de AppDataContext. */}
        <LazyPlannerDashboardWidgets
          currentUser={currentUser!}
          onNavigate={(view) => setCurrentView(view)}
        />
        </Suspense>
      ) : (
        <LazyDashboardView user={previewingChauffeur ? { ...currentUser!, role: 'chauffeur' } : currentUser!} notes={myNotes} shifts={shifts} diversions={diversions} leaveRequests={leaveRequests} isInitialLoad={isInitialLoad} onNavigate={setCurrentView} />
      )
    )}
    {resolvedCurrentView === 'mijn-dag' && <LazyMijnDagView user={previewingChauffeur ? { ...currentUser!, role: 'chauffeur' } : currentUser!} notes={myNotes} shifts={shifts} diversions={diversions} isInitialLoad={isInitialLoad} onNavigate={setCurrentView} />}
    {resolvedCurrentView === 'omleidingen' && <Verwissel laden={isInitialLoad} skelet={<ViewLoader />}><LazyDiversionsView diversions={diversions} lastSyncedAt={lastSyncedAt} /></Verwissel>}
    {resolvedCurrentView === 'rooster' && <LazyScheduleView user={currentUser!} notes={myNotes} shifts={shifts} users={users} leaveRequests={leaveRequests} swaps={swaps} isInitialLoad={isInitialLoad || !ruilDataKlaar} lastSyncedAt={lastSyncedAt} planningTot={planningTot} onRequestSwap={(shiftId) => { setSwapPreselectShiftId(shiftId); setCurrentView('ruil-verzoeken'); }} />}
    {resolvedCurrentView === 'dienstoverzicht' && <Verwissel laden={isInitialLoad || !servicesGeladen} skelet={<ViewLoader />}><Suspense fallback={<ViewLoader />}><LazyServicesView services={services} /></Suspense></Verwissel>}
    {resolvedCurrentView === 'ritblaadjes' && <LazyRitblaadjesView currentUser={currentUser!} />}
    {resolvedCurrentView === 'documenten' && <LazyDocumentsView currentUser={currentUser!} onSeen={markDocumentsSeen} />}
    {resolvedCurrentView === 'updates' && <Verwissel laden={isInitialLoad} skelet={<ViewLoader />}><LazyUpdatesView updates={updates} /></Verwissel>}
    {resolvedCurrentView === 'meldingen' && <LazyMeldingenView onNavigate={setCurrentView} />}
    {resolvedCurrentView === 'contacten' && <Verwissel laden={isInitialLoad || !usersGeladen} skelet={<ViewLoader />}><LazyContactsView users={users} currentUser={currentUser!} /></Verwissel>}
    {resolvedCurrentView === 'beheer-roosters' && <Verwissel laden={isInitialLoad} skelet={<ViewLoader />}>
      <Suspense fallback={<ViewLoader />}>
        <LazyManageSchedulesView shifts={shifts} onSave={savePlanning} users={users} history={planningMatrixHistory} canAdminOverride={isAdmin} onMatrixImported={async () => {
          // Logboek stil op de achtergrond: de import wacht er niet op.
          if (currentUser?.role === 'admin') void fetchActivityLog();
          await Promise.all([
            fetchPlanningMatrix(),
            fetchPlanning(),
            fetchPlanningMatrixHistory(),
            refreshCoverageGaps(),
          ]);
        }} />
      </Suspense>
    </Verwissel>}
    {resolvedCurrentView === 'planning-matrix' && <Verwissel laden={isInitialLoad || !servicesGeladen || !planningCodesGeladen || !planningMatrixGeladen} skelet={<ViewLoader />}>
      <Suspense fallback={<ViewLoader />}>
        <LazyPlanningMatrixView
          rows={planningMatrixRows}
          services={services}
          planningCodes={planningCodes}
          users={users}
          canOpenUserManagement={isAdmin}
          onOpenPlanningCodes={() => setCurrentView('planning-codes')}
          onOpenServiceOverview={() => setCurrentView('beheer-dienstoverzicht')}
          onOpenUserManagement={() => setCurrentView('gebruikers')}
        />
      </Suspense>
    </Verwissel>}
    {resolvedCurrentView === 'planning-codes' && <Verwissel laden={isInitialLoad || !planningCodesGeladen} skelet={<ViewLoader />}><Suspense fallback={<ViewLoader />}><LazyPlanningCodesView codes={planningCodes} onSave={savePlanningCodes} canAdminDelete={isAdmin} /></Suspense></Verwissel>}
    {resolvedCurrentView === 'beheer-updates' && <Verwissel laden={isInitialLoad} skelet={<ViewLoader />}>
      <Suspense fallback={<ViewLoader />}>
        <LazyManageUpdatesView updates={updates} onSave={saveUpdates} onSaveUpdate={saveUpdate} onCreateUpdate={createUpdate} onDeleteUpdate={deleteUpdate} onSendUrgentEmail={sendUrgentEmail} canSendUrgentEmail={isAdmin} onHerlaad={() => void fetchUpdates()} />
      </Suspense>
    </Verwissel>}
    {resolvedCurrentView === 'gebruikers' && <Verwissel laden={isInitialLoad} skelet={<ViewLoader />}>
      <Suspense fallback={<ViewLoader />}>
        <LazyManageUsersView currentUser={currentUser!} />
      </Suspense>
    </Verwissel>}
    {resolvedCurrentView === 'toestellen' && (
      <Suspense fallback={<ViewLoader />}>
        <LazyDevicesView users={users} currentUserId={currentUser!.id} />
      </Suspense>
    )}
    {resolvedCurrentView === 'activiteit' && <Verwissel laden={isInitialLoad || !activityLogGeladen} skelet={<ViewLoader />}><Suspense fallback={<ViewLoader />}><LazyActivityLogView entries={activityLog} logins={loginActivity} aanwezigheid={aanwezigheid} aanwezigheidMigratie={aanwezigheidMigratie} locatieMigratie={aanwezigheidLocatieMigratie} /></Suspense></Verwissel>}
    {resolvedCurrentView === 'ocpi-monitoring' && <Suspense fallback={<ViewLoader />}><LazyOcpiDashboardView /></Suspense>}
    {resolvedCurrentView === 'vervaldata' && <Suspense fallback={<ViewLoader />}><LazyVervaldataView users={users} /></Suspense>}
    {resolvedCurrentView === 'vandaag' && <Verwissel laden={isInitialLoad} skelet={<ViewLoader />}><Suspense fallback={<ViewLoader />}><LazyVandaagView onNavigate={(view, params) => navigeer(view, { params })} /></Suspense></Verwissel>}
    {resolvedCurrentView === 'werkvoorraad' && <Verwissel laden={isInitialLoad} skelet={<ViewLoader />}><Suspense fallback={<ViewLoader />}><LazyWerkvoorraadView currentUser={currentUser!} onNavigate={(view, params) => navigeer(view, { params })} /></Suspense></Verwissel>}
    {resolvedCurrentView === 'defecten' && <Suspense fallback={<ViewLoader />}><LazyGeleBoekView currentUser={currentUser!} /></Suspense>}
    {resolvedCurrentView === 'werkprestaties' && <Verwissel laden={!usersGeladen} skelet={<ViewLoader />}><Suspense fallback={<ViewLoader />}><LazyWerkprestatiesView currentUser={currentUser!} users={users} /></Suspense></Verwissel>}
    {resolvedCurrentView === 'voertuig-werken' && <Suspense fallback={<ViewLoader />}><LazyVoertuigWerkenView /></Suspense>}
    {resolvedCurrentView === 'voertuigen' && <Suspense fallback={<ViewLoader />}><LazyVoertuigenView currentUser={currentUser!} /></Suspense>}
    {resolvedCurrentView === 'dienstopbouw' && <Suspense fallback={<ViewLoader />}><LazyDienstopbouwView currentUser={currentUser!} /></Suspense>}
    {resolvedCurrentView === 'dagafsluiting' && <Suspense fallback={<ViewLoader />}><LazyDagafsluitingView currentUser={currentUser!} users={users} /></Suspense>}
    {resolvedCurrentView === 'rapporten' && <Verwissel laden={isInitialLoad} skelet={<ViewLoader />}><Suspense fallback={<ViewLoader />}><LazyRapportenView currentUser={currentUser!} /></Suspense></Verwissel>}
    {resolvedCurrentView === 'looncontrole' && <Suspense fallback={<ViewLoader />}><LazyLooncontroleView currentUser={currentUser!} onNavigate={(view, params) => navigeer(view, { params })} /></Suspense>}
    {resolvedCurrentView === 'beheer-omleidingen' && <Verwissel laden={isInitialLoad} skelet={<ViewLoader />}><Suspense fallback={<ViewLoader />}><LazyManageDiversionsView diversions={diversions} onSave={saveDiversions} onSaveDiversion={saveDiversion} onCreateDiversion={createDiversion} onDeleteDiversion={deleteDiversion} /></Suspense></Verwissel>}
    {resolvedCurrentView === 'beheer-dienstoverzicht' && <Verwissel laden={isInitialLoad || !servicesGeladen} skelet={<ViewLoader />}><Suspense fallback={<ViewLoader />}><LazyManageServicesView services={services} onSave={saveServices} canAdminOverride={isAdmin} /></Suspense></Verwissel>}
    {resolvedCurrentView === 'ruil-verzoeken' && <Verwissel laden={isInitialLoad || !ruilDataKlaar} skelet={<ViewLoader />}><LazySwapRequestsView user={currentUser} swaps={swaps} shifts={shifts} users={users} leaveRequests={leaveRequests} onSave={saveSwaps} onDecide={decideSwap} onConfirmSeen={confirmSwapSeen} preselectShiftId={swapPreselectShiftId} onPreselectConsumed={() => setSwapPreselectShiftId(null)} /></Verwissel>}
    {resolvedCurrentView === 'bezetting' && <LazyCapacityView currentUser={currentUser!} />}
    {resolvedCurrentView === 'dekking' && <Suspense fallback={<ViewLoader />}><LazyCoverageView /></Suspense>}
    {resolvedCurrentView === 'verlof-kalender' && <Verwissel laden={isInitialLoad} skelet={<ViewLoader />}><Suspense fallback={<ViewLoader />}><LazyVerlofKalenderView users={users} leaveRequests={leaveRequests} shifts={shifts} onDecide={isStaf(currentUser.role) ? decideLeave : undefined} /></Suspense></Verwissel>}
    {resolvedCurrentView === 'verlof' && <Verwissel laden={isInitialLoad || !usersGeladen} skelet={<ViewLoader />}>
      <Suspense fallback={<ViewLoader />}>
        <LazyLeaveManagementView
          user={currentUser}
          leaveRequests={leaveRequests}
          users={users}
          onSave={saveLeave}
          onDecide={isStaf(currentUser.role) ? decideLeave : undefined}
          feestdagenExtra={feestdagenExtra}
          onFeestdagenSaved={zetFeestdagenExtra}
          lastSeenDecisionAt={lastSeenLeaveDecisionAt}
          onMarkDecisionsSeen={markLeaveDecisionsSeen}
          shifts={shifts}
        />
      </Suspense>
    </Verwissel>}
    {resolvedCurrentView === 'ziekte' && <Verwissel laden={isInitialLoad} skelet={<ViewLoader />}>
      <Suspense fallback={<ViewLoader />}>
        <LazyZiekteView
          user={currentUser}
          users={users}
          leaveRequests={leaveRequests}
          shifts={shifts}
          onSickReport={reportSick}
          onSave={saveLeave}
          onShiftSwapped={async () => {
            await Promise.all([
              fetchPlanning(undefined, undefined, { silent: true }),
              fetchSwaps(),
              refreshCoverageGaps(),
            ]);
          }}
        />
      </Suspense>
    </Verwissel>}
    {resolvedCurrentView === 'designsysteem' && <LazyDesignsysteemView />}
    {resolvedCurrentView === 'instellingen' && (
      <LazyInstellingenView
        user={currentUser}
        theme={theme}
        onToggleTheme={toggleTheme}
        pushBeschikbaar={!!pushPublicKey && isPushSupported()}
        pushEnabled={pushEnabled}
        onTogglePush={togglePush}
        onChangePassword={() => setShowChangePassword(true)}
        onAgenda={() => setShowAgenda(true)}
        onProbleem={() => setShowProbleemMelder(true)}
        onLogout={handleLogout}
        onNavigate={setCurrentView}
      />
    )}
    {resolvedCurrentView === 'beheer-debug' && <Verwissel laden={isInitialLoad || !servicesGeladen} skelet={<ViewLoader />}>
      <Suspense fallback={<ViewLoader />}>
        <LazyDebugView currentUser={currentUser!} shifts={shifts} services={services} onSaveShifts={savePlanning} />
      </Suspense>
    </Verwissel>}
  </SchermInloop>
    </>
  );
}
