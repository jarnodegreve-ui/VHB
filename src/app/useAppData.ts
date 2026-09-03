import { useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { User, View } from '../types';
import type { Toast } from '../components/ToastStack';
import { useDataKern } from './data/kern';
import { useActiviteitData } from './data/activiteit';
import { usePlanningData } from './data/planning';
import { useVerlofData } from './data/verlof';
import { useRuilData } from './data/ruil';
import { useMensenData } from './data/mensen';
import { useCommunicatieData } from './data/communicatie';

/**
 * De datalaag van het portaal — de compositiewortel. De collecties, hun
 * fetchers en savers wonen per domein in `src/app/data/*` (planning,
 * verlof, ruil, mensen, communicatie, activiteit); de gedeelde vangrails
 * (collectie pas beschrijfbaar na een geslaagde GET) en de revisie-
 * administratie voor optimistic-concurrency zitten in `data/kern.ts`.
 *
 * Deze hook plakt ze aan elkaar, beheert de eerste dataload
 * (`loadAppData`, `isInitialLoad`, `lastSyncedAt`) en geeft één plat object
 * terug — dezelfde vorm als vóór de opsplitsing, zodat App en de views er
 * niets van merken. Views lezen het via `useAppDataContext()`
 * (src/app/AppDataContext.tsx).
 *
 * `showToast`/`meldLaadfout` komen als functies binnen zodat de meldingen
 * hun bundeling en sessie-onderdrukking in App behouden.
 */
export function useAppData({
  session,
  currentUser,
  currentView,
  showToast,
  meldLaadfout,
  beginLoading,
  endLoading,
}: {
  session: Session | null;
  currentUser: User | null;
  currentView: View;
  showToast: (message: string, tone?: Toast['tone'], action?: Toast['action']) => void;
  meldLaadfout: (bron: string) => void;
  beginLoading: () => void;
  endLoading: () => void;
}) {
  // Start leeg (geen mock-data): tot de eerste fetch klaar is gate't
  // isInitialLoad de skeleton-staat. Geen risico meer dat mock-diensten/
  // gebruikers stilletjes als echte data getoond worden.
  //
  // Volgorde: activiteit eerst (heeft de kern niet nodig, de kern heeft
  // fetchActivityLog wél — savers verversen het logboek van een admin),
  // dan de kern, dan de domeinen. Kruisverbanden lopen via de ctx:
  // verlof.reportSick → planning.refreshCoverageGaps, communicatie.
  // sendUrgentEmail → mensen.users.
  const activiteit = useActiviteitData({ session, currentUser, currentView });
  const ctx = useDataKern({ session, currentUser, showToast, meldLaadfout, beginLoading, endLoading, fetchActivityLog: activiteit.fetchActivityLog });
  const planning = usePlanningData(ctx);
  const verlof = useVerlofData({ ...ctx, refreshCoverageGaps: planning.refreshCoverageGaps });
  const ruil = useRuilData(ctx);
  const mensen = useMensenData(ctx);
  const communicatie = useCommunicatieData({ ...ctx, users: mensen.users });

  // Eerste data-fetch nog niet rond? Views kunnen dit gebruiken om
  // skeleton-loaders te tonen i.p.v. lege/mock-data.
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // Tijdstip van de laatste geslaagde dataload — chauffeurs zien zo hoe vers
  // hun rooster/omleidingen zijn (vooral offline of na een tijd weg).
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  /** Achtergrond-dataload ná het profiel: blokkeert de eerste render niet —
   *  de views tonen intussen skeletons (isInitialLoad). */
  const loadAppData = async (appUser: User, accessToken: string) => {
    try {
      // Chauffeur: enkel eigen shifts ophalen (50× minder data op mobile).
      // Planner/admin: alle shifts (nodig voor beheer-views).
      const planningFilter = appUser.role === 'chauffeur' ? { driverId: String(appUser.id) } : undefined;
      await Promise.all([
        planning.fetchPlanning(accessToken, planningFilter),
        mensen.fetchUsers(accessToken),
        communicatie.fetchDiversions(accessToken),
        // Dienstoverzicht is planner/admin-only (view + beheer) — chauffeurs
        // hebben de services-collectie nergens nodig, dus niet ophalen.
        ...(appUser.role === 'planner' || appUser.role === 'admin' ? [planning.fetchServices(accessToken)] : []),
        communicatie.fetchUpdates(accessToken),
        ruil.fetchSwaps(accessToken),
        verlof.fetchLeave(accessToken),
        ...(appUser.role === 'planner' || appUser.role === 'admin' ? [planning.fetchPlanningMatrix(accessToken)] : []),
        ...(appUser.role === 'planner' || appUser.role === 'admin' ? [planning.fetchPlanningCodes(accessToken)] : []),
        ...(appUser.role === 'planner' || appUser.role === 'admin' ? [planning.fetchPlanningMatrixHistory(accessToken)] : []),
        ...(appUser.role === 'planner' || appUser.role === 'admin' ? [planning.refreshCoverageGaps()] : []),
        ...(appUser.role === 'admin' ? [activiteit.fetchActivityLog(accessToken)] : []),
        ...(appUser.role === 'chauffeur' ? [mensen.fetchUnseenDocuments(appUser.id, accessToken)] : []),
      ]);
      setLastSyncedAt(Date.now());
    } catch (error) {
      console.error('Error loading app data:', error);
      meldLaadfout('de gegevens');
    } finally {
      setIsInitialLoad(false);
    }
  };

  const refreshAll = () =>
    currentUser && session?.access_token ? loadAppData(currentUser, session.access_token) : Promise.resolve();

  /** Alles leegmaken bij uitloggen (sessie verlopen / afgemeld). */
  const resetAll = () => {
    ctx.clearLoadedCollections();
    mensen.resetMensen();
    planning.resetPlanning();
    communicatie.resetCommunicatie();
    ruil.resetRuil();
    verlof.resetVerlof();
    activiteit.resetActiviteit();
  };

  const { shifts, services, myNotes, planningMatrixRows, planningCodes, planningMatrixHistory, coverageDays,
    fetchPlanning, savePlanning, fetchServices, saveServices, fetchPlanningMatrix, fetchPlanningCodes, fetchPlanningMatrixHistory,
    savePlanningCodes, refreshCoverageGaps, fetchMyNotes } = planning;
  const { leaveRequests, lastSeenLeaveDecisionAt, fetchLeave, saveLeave, reportSick, decideLeave, markLeaveDecisionsSeen } = verlof;
  const { swaps, fetchSwaps, saveSwaps, decideSwap, confirmSwapSeen } = ruil;
  const { users, unseenDocuments, vervaldata, pendingDevices, fetchUsers, saveUsers, saveUser, createUser, deleteUser,
    fetchUnseenDocuments, markDocumentsSeen } = mensen;
  const { updates, diversions, fetchUpdates, saveUpdates, sendUrgentEmail, saveUpdate, createUpdate, deleteUpdate,
    fetchDiversions, saveDiversions, saveDiversion, createDiversion, deleteDiversion } = communicatie;
  const { activityLog, loginActivity, fetchActivityLog, fetchLoginActivity } = activiteit;

  return {
    shifts, users, diversions, services, updates, swaps, leaveRequests, lastSeenLeaveDecisionAt, unseenDocuments, myNotes,
    planningMatrixRows, planningCodes, planningMatrixHistory, activityLog, loginActivity, coverageDays, vervaldata, pendingDevices,
    isInitialLoad, setIsInitialLoad, lastSyncedAt, setLastSyncedAt,
    loadAppData, refreshAll, resetAll,
    fetchUpdates, saveUpdates, sendUrgentEmail, fetchSwaps, saveSwaps, fetchLeave, fetchUnseenDocuments, markDocumentsSeen,
    fetchPlanningMatrix, fetchPlanningCodes, fetchPlanningMatrixHistory, refreshCoverageGaps, fetchActivityLog, fetchLoginActivity,
    savePlanningCodes, markLeaveDecisionsSeen, saveLeave, reportSick, decideLeave, decideSwap, confirmSwapSeen, fetchMyNotes,
    fetchServices, saveServices, fetchUsers, saveUsers, fetchPlanning, savePlanning, fetchDiversions, saveDiversions,
    saveUser, createUser, deleteUser, saveDiversion, createDiversion, deleteDiversion, saveUpdate, createUpdate, deleteUpdate,
  };
}

/** De platte vorm die App en de views (via de context) te zien krijgen. */
export type AppData = ReturnType<typeof useAppData>;
