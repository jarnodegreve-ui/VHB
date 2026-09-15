import { useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { User, View } from '../types';
import { useDataKern, useStabieleActies, type ShowToast } from './data/kern';
import { useActiviteitData } from './data/activiteit';
import { usePlanningData } from './data/planning';
import { useVerlofData } from './data/verlof';
import { useRuilData } from './data/ruil';
import { useMensenData } from './data/mensen';
import { useCommunicatieData } from './data/communicatie';
import { useMeldingenData } from './data/meldingen';

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
 * Stabiel (punt 19, 15-09): het teruggegeven object verandert alleen van
 * referentie wanneer een dátaveld verandert. De acties hebben blijvende
 * identiteiten (`useStabieleActies`) en staan óók apart onder `acties`, voor
 * de acties-context. Vroeger was dit een vers object-literal per render van
 * App, en App rendert bij elke scroll (topbar-schaduw), toast-timer en
 * laadteller, dus elke context-lezer rekende dan mee.
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
  showToast: ShowToast;
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
  const meldingenData = useMeldingenData(ctx);

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
      ctx.beginBronMeting();
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
        // Meldingencentrum (bel + badge) — voor elke rol.
        meldingenData.fetchMeldingen(accessToken),
        ...(appUser.role === 'planner' || appUser.role === 'admin' ? [planning.fetchPlanningMatrix(accessToken)] : []),
        ...(appUser.role === 'planner' || appUser.role === 'admin' ? [planning.fetchPlanningCodes(accessToken)] : []),
        ...(appUser.role === 'planner' || appUser.role === 'admin' ? [planning.fetchPlanningMatrixHistory(accessToken)] : []),
        ...(appUser.role === 'planner' || appUser.role === 'admin' ? [planning.refreshCoverageGaps()] : []),
        ...(appUser.role === 'admin' ? [activiteit.fetchActivityLog(accessToken)] : []),
        // Documenten bestaan ook voor techniekers (routes.tsx); alleen voor
        // chauffeurs ophalen liet hun nieuw-badge altijd op 0 staan.
        ...(appUser.role === 'chauffeur' || appUser.role === 'technieker' ? [mensen.fetchUnseenDocuments(appUser.id, accessToken)] : []),
      ]);
      // Versheid: kwam er ook maar één antwoord uit de SW-cache (offline of
      // buiten bereik), dan is dit geen verse synchronisatie. We houden dan
      // de datum van het oudste gecachte antwoord aan (of laten de vorige
      // waarde staan), zodat "gegevens van hh:mm" klopt.
      const bron = ctx.sluitBronMeting();
      if (bron.uitCache === 0) setLastSyncedAt(Date.now());
      else if (bron.oudste !== null) setLastSyncedAt((vorige) => (vorige === null ? bron.oudste : Math.min(vorige, bron.oudste!)));
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
    meldingenData.resetMeldingen();
  };

  const { shifts, services, myNotes, planningMatrixRows, planningCodes, planningMatrixHistory, coverageDays,
    fetchPlanning, savePlanning, fetchServices, saveServices, fetchPlanningMatrix, fetchPlanningCodes, fetchPlanningMatrixHistory,
    savePlanningCodes, refreshCoverageGaps, fetchMyNotes } = planning;
  const { leaveRequests, lastSeenLeaveDecisionAt, fetchLeave, saveLeave, reportSick, decideLeave, markLeaveDecisionsSeen, feestdagenExtra, zetFeestdagenExtra } = verlof;
  const { swaps, fetchSwaps, saveSwaps, decideSwap, confirmSwapSeen } = ruil;
  const { users, unseenDocuments, vervaldata, pendingDevices, fetchUsers, saveUsers, saveUser, createUser, deleteUser,
    fetchUnseenDocuments, markDocumentsSeen } = mensen;
  const { updates, diversions, fetchUpdates, saveUpdates, sendUrgentEmail, saveUpdate, createUpdate, deleteUpdate,
    fetchDiversions, saveDiversions, saveDiversion, createDiversion, deleteDiversion } = communicatie;
  const { activityLog, loginActivity, fetchActivityLog, fetchLoginActivity } = activiteit;
  const { meldingen, ongelezenMeldingen, fetchMeldingen, markeerMeldingenGelezen, markeerMeldingenGelezenVoorScherm } = meldingenData;

  // Data: alleen een nieuwe referentie wanneer een van de velden wijzigt.
  const data = useMemo(() => ({
    shifts, users, diversions, services, updates, swaps, leaveRequests, lastSeenLeaveDecisionAt, unseenDocuments, myNotes,
    planningMatrixRows, planningCodes, planningMatrixHistory, activityLog, loginActivity, coverageDays, vervaldata, pendingDevices,
    isInitialLoad, lastSyncedAt, feestdagenExtra, meldingen, ongelezenMeldingen,
  }), [
    shifts, users, diversions, services, updates, swaps, leaveRequests, lastSeenLeaveDecisionAt, unseenDocuments, myNotes,
    planningMatrixRows, planningCodes, planningMatrixHistory, activityLog, loginActivity, coverageDays, vervaldata, pendingDevices,
    isInitialLoad, lastSyncedAt, feestdagenExtra, meldingen, ongelezenMeldingen,
  ]);

  // Acties: blijvende identiteiten die altijd de laatste implementatie aanroepen.
  const acties = useStabieleActies({
    setIsInitialLoad, setLastSyncedAt,
    loadAppData, refreshAll, resetAll,
    fetchUpdates, saveUpdates, sendUrgentEmail, fetchSwaps, saveSwaps, fetchLeave, fetchUnseenDocuments, markDocumentsSeen,
    fetchPlanningMatrix, fetchPlanningCodes, fetchPlanningMatrixHistory, refreshCoverageGaps, fetchActivityLog, fetchLoginActivity,
    savePlanningCodes, markLeaveDecisionsSeen, saveLeave, reportSick, decideLeave, decideSwap, confirmSwapSeen, fetchMyNotes,
    zetFeestdagenExtra,
    fetchServices, saveServices, fetchUsers, saveUsers, fetchPlanning, savePlanning, fetchDiversions, saveDiversions,
    saveUser, createUser, deleteUser, saveDiversion, createDiversion, deleteDiversion, saveUpdate, createUpdate, deleteUpdate,
    fetchMeldingen, markeerMeldingenGelezen, markeerMeldingenGelezenVoorScherm,
  });

  return useMemo(() => ({ ...data, ...acties, acties }), [data, acties]);
}

/** De platte vorm die App en de views (via de context) te zien krijgen. */
export type AppData = ReturnType<typeof useAppData>;
/** Alleen de acties (stabiel): voor de acties-context. */
export type AppActies = AppData['acties'];
