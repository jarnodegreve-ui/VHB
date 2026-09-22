import { useEffect, useMemo, useRef, useState } from 'react';
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
import { UITGESTELD_PER_VIEW, uitgesteldVoor, type Uitgesteld } from './data/poort';

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
}: {
  session: Session | null;
  currentUser: User | null;
  currentView: View;
  showToast: ShowToast;
  meldLaadfout: (bron: string) => void;
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
  const ctx = useDataKern({ session, currentUser, showToast, meldLaadfout, fetchActivityLog: activiteit.fetchActivityLog });
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

  // Actueel scherm voor de uitgestelde laadbeurt: loadAppData loopt over
  // awaits heen en mag niet naar het scherm van bij zijn start kijken.
  const currentViewRef = useRef(currentView);
  currentViewRef.current = currentView;
  // Lopende uitgestelde fetches per collectie (één tegelijk) en of de
  // laadbeurt van deze sessie al begonnen is (pas dan mag een schermwissel
  // een uitgestelde collectie naar voren halen: vóór de 2FA-poort zou de
  // server ze weigeren).
  const uitgesteldBezigRef = useRef(new Map<Uitgesteld, Promise<void>>());
  const laadbeurtRef = useRef<{ rol: User['role']; userId: string; accessToken: string } | null>(null);

  /** Eén uitgestelde collectie ophalen; een tweede vraag terwijl ze loopt
   *  krijgt dezelfde belofte (boot-start en schermwissel botsen zo niet). */
  const laadUitgesteld = (sleutel: Uitgesteld): Promise<void> => {
    const beurt = laadbeurtRef.current;
    if (!beurt) return Promise.resolve();
    const bezig = uitgesteldBezigRef.current.get(sleutel);
    if (bezig) return bezig;
    const { accessToken, userId } = beurt;
    const haal = (): Promise<void> => {
      switch (sleutel) {
        case 'services': return planning.fetchServices(accessToken);
        case 'planningCodes': return planning.fetchPlanningCodes(accessToken);
        case 'planningMatrix': return planning.fetchPlanningMatrix(accessToken);
        case 'activityLog': return activiteit.fetchActivityLog(accessToken);
        case 'users': return mensen.fetchUsers(accessToken);
        case 'swaps': return ruil.fetchSwaps(accessToken);
        case 'documenten': return mensen.fetchUnseenDocuments(userId, accessToken);
      }
    };
    const belofte = haal().finally(() => {
      uitgesteldBezigRef.current.delete(sleutel);
      // Intussen uitgelogd: het late antwoord mag geen data of vlag van de
      // vorige gebruiker achterlaten voor wie daarna inlogt.
      if (!laadbeurtRef.current) resetAll();
    });
    uitgesteldBezigRef.current.set(sleutel, belofte);
    return belofte;
  };

  /** Dataload ná het profiel, in twee trappen (ronde 3, 19-09).
   *
   *  1. De POORT: alleen wat het eerste scherm van de rol nodig heeft.
   *     `isInitialLoad` valt weg zodra dié calls rond zijn, de skeletons
   *     wachten dus niet langer op de traagste van 8-13 calls.
   *  2. UITGESTELD (`uitgesteldVoor`): de rest, direct ná de poort op de
   *     achtergrond. Staat de gebruiker al op een scherm dat zo'n collectie
   *     nodig heeft (deeplink, `UITGESTELD_PER_VIEW`), dan start ze meteen,
   *     naast de poort. Elke uitgestelde collectie heeft een `…Geladen`-vlag;
   *     lezers houden hun skelet aan tot die waar is.
   *
   *  `wachtOpAlles` (pull-to-refresh): de belofte lost pas op als ook de
   *  uitgestelde collecties binnen zijn. */
  const loadAppData = async (appUser: User, accessToken: string, opts?: { wachtOpAlles?: boolean }) => {
    const isStafRol = appUser.role === 'planner' || appUser.role === 'admin';
    laadbeurtRef.current = { rol: appUser.role, userId: appUser.id, accessToken };
    const uitgesteld = uitgesteldVoor(appUser.role);
    // Het activiteitenscherm haalt zijn log zelf op bij het openen
    // (data/activiteit.ts); niet dubbel starten.
    const zonderEigenLader = (k: Uitgesteld) => !(k === 'activityLog' && currentViewRef.current === 'activiteit');
    // Nu al nodig voor het open scherm: naast de poort starten.
    const nuNodig = (UITGESTELD_PER_VIEW[currentViewRef.current] ?? []).filter((k) => uitgesteld.includes(k));
    const vroeg = nuNodig.map((k) => laadUitgesteld(k));
    let laat: Promise<void>[] = [];
    try {
      // Chauffeur: enkel eigen shifts ophalen (50× minder data op mobile).
      // Planner/admin: alle shifts (nodig voor beheer-views).
      const planningFilter = appUser.role === 'chauffeur' ? { driverId: String(appUser.id) } : undefined;
      ctx.beginBronMeting();
      await Promise.all([
        planning.fetchPlanning(accessToken, planningFilter),
        communicatie.fetchDiversions(accessToken),
        communicatie.fetchUpdates(accessToken),
        verlof.fetchLeave(accessToken),
        // Meldingencentrum (bel + badge) — voor elke rol.
        meldingenData.fetchMeldingen(accessToken),
        // Staf: de cockpit en de werkvoorraad rekenen op gebruikers, ruilen,
        // importgeschiedenis en dekking. Chauffeur/technieker hebben users
        // en swaps alleen voor badges/contacten nodig: uitgesteld.
        ...(isStafRol ? [
          mensen.fetchUsers(accessToken),
          ruil.fetchSwaps(accessToken),
          planning.fetchPlanningMatrixHistory(accessToken),
          planning.refreshCoverageGaps(),
        ] : []),
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
      // Ná de poort: de rest op de achtergrond. De fetchers vangen hun eigen
      // fouten (laadfout-toast waar dat al zo was) en zetten hun vlag altijd.
      // Niet wanneer intussen is uitgelogd (resetAll wist de laadbeurt).
      if (laadbeurtRef.current?.accessToken === accessToken) {
        laat = uitgesteld.filter(zonderEigenLader).map((k) => laadUitgesteld(k));
      }
    }
    if (opts?.wachtOpAlles) await Promise.allSettled([...vroeg, ...laat]);
  };

  // Schermwissel tijdens de poort naar een view die een uitgestelde collectie
  // nodig heeft: meteen starten i.p.v. wachten tot de poort dicht is ("wat
  // het eerst komt"). Na de poort is alles al gestart en doet dit niets.
  const geladenVlag: Record<Uitgesteld, boolean> = {
    services: planning.servicesGeladen,
    planningCodes: planning.planningCodesGeladen,
    planningMatrix: planning.planningMatrixGeladen,
    activityLog: activiteit.activityLogGeladen,
    users: mensen.usersGeladen,
    swaps: ruil.swapsGeladen,
    documenten: mensen.documentenGeladen,
  };
  useEffect(() => {
    const beurt = laadbeurtRef.current;
    if (!beurt) return;
    const toegestaan = uitgesteldVoor(beurt.rol);
    for (const k of UITGESTELD_PER_VIEW[currentView] ?? []) {
      if (toegestaan.includes(k) && !geladenVlag[k]) void laadUitgesteld(k);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView]);

  const refreshAll = () =>
    currentUser && session?.access_token ? loadAppData(currentUser, session.access_token, { wachtOpAlles: true }) : Promise.resolve();

  /** Alles leegmaken bij uitloggen (sessie verlopen / afgemeld). */
  const resetAll = () => {
    laadbeurtRef.current = null;
    ctx.clearLoadedCollections();
    mensen.resetMensen();
    planning.resetPlanning();
    communicatie.resetCommunicatie();
    ruil.resetRuil();
    verlof.resetVerlof();
    activiteit.resetActiviteit();
    meldingenData.resetMeldingen();
  };

  const { shifts, services, myNotes, planningMatrixRows, planningCodes, planningMatrixHistory, coverageDays, planningTot,
    fetchPlanning, savePlanning, fetchServices, saveServices, fetchPlanningMatrix, fetchPlanningCodes, fetchPlanningMatrixHistory,
    savePlanningCodes, refreshCoverageGaps, fetchMyNotes } = planning;
  const { leaveRequests, lastSeenLeaveDecisionAt, fetchLeave, saveLeave, reportSick, decideLeave, markLeaveDecisionsSeen, feestdagenExtra, zetFeestdagenExtra } = verlof;
  const { swaps, swapsGeladen, fetchSwaps, saveSwaps, decideSwap, confirmSwapSeen } = ruil;
  const { servicesGeladen, planningMatrixGeladen, planningCodesGeladen } = planning;
  const { users, usersGeladen, documentenGeladen, unseenDocuments, vervaldata, pendingDevices, fetchUsers, saveUsers, saveUser, createUser, deleteUser,
    fetchUnseenDocuments, markDocumentsSeen } = mensen;
  const { updates, diversions, fetchUpdates, saveUpdates, sendUrgentEmail, saveUpdate, createUpdate, deleteUpdate,
    fetchDiversions, saveDiversions, saveDiversion, createDiversion, deleteDiversion } = communicatie;
  const { activityLog, activityLogGeladen, loginActivity, aanwezigheid, aanwezigheidMigratie, aanwezigheidLocatieMigratie, fetchActivityLog, fetchLoginActivity } = activiteit;
  const { meldingen, ongelezenMeldingen, fetchMeldingen, markeerMeldingenGelezen, markeerMeldingenGelezenVoorScherm, verwijderMelding, herstelMelding } = meldingenData;

  // Data: alleen een nieuwe referentie wanneer een van de velden wijzigt.
  const data = useMemo(() => ({
    shifts, users, diversions, services, updates, swaps, leaveRequests, lastSeenLeaveDecisionAt, unseenDocuments, myNotes,
    planningMatrixRows, planningCodes, planningMatrixHistory, activityLog, loginActivity, aanwezigheid, aanwezigheidMigratie, aanwezigheidLocatieMigratie, coverageDays, vervaldata, pendingDevices,
    isInitialLoad, lastSyncedAt, feestdagenExtra, meldingen, ongelezenMeldingen, planningTot,
    servicesGeladen, planningMatrixGeladen, planningCodesGeladen, activityLogGeladen, usersGeladen, swapsGeladen, documentenGeladen,
  }), [
    shifts, users, diversions, services, updates, swaps, leaveRequests, lastSeenLeaveDecisionAt, unseenDocuments, myNotes,
    planningMatrixRows, planningCodes, planningMatrixHistory, activityLog, loginActivity, aanwezigheid, aanwezigheidMigratie, aanwezigheidLocatieMigratie, coverageDays, vervaldata, pendingDevices,
    isInitialLoad, lastSyncedAt, feestdagenExtra, meldingen, ongelezenMeldingen, planningTot,
    servicesGeladen, planningMatrixGeladen, planningCodesGeladen, activityLogGeladen, usersGeladen, swapsGeladen, documentenGeladen,
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
    fetchMeldingen, markeerMeldingenGelezen, markeerMeldingenGelezenVoorScherm, verwijderMelding, herstelMelding,
  });

  return useMemo(() => ({ ...data, ...acties, acties }), [data, acties]);
}

/** De platte vorm die App en de views (via de context) te zien krijgen. */
export type AppData = ReturnType<typeof useAppData>;
/** Alleen de acties (stabiel): voor de acties-context. */
export type AppActies = AppData['acties'];
