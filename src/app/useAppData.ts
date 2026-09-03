import { useEffect, useRef, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { ActivityLogEntry, Diversion, LeaveRequest, PlanningCode, PlanningMatrixImportHistory, PlanningMatrixRow, Service, Shift, SwapRequest, Update, User, View } from '../types';
import { apiFetch, apiJson } from '../lib/api';
import { notify } from '../lib/ui';
import { fetchCoverageGaps, type DayGap } from '../lib/coverage';
import { addDays, isoDate } from '../lib/availability';
import type { VervaldataRij, PendingDevice } from '../lib/werkvoorraad';
import type { Toast } from '../components/ToastStack';

/**
 * De datalaag van het portaal: alle collecties (planning, gebruikers,
 * verlof, ruilen, …), hun fetchers en opslag-functies, de laadvangrails
 * (collectie pas beschrijfbaar na een geslaagde GET) en optimistic-
 * concurrency via revisie-headers. Stond tot fase B (03-09-2026) in
 * App.tsx zelf; de code is ongewijzigd verhuisd — App houdt auth, sessie,
 * thema, toasts en de schil.
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
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [diversions, setDiversions] = useState<Diversion[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [updates, setUpdates] = useState<Update[]>([]);
  const [swaps, setSwaps] = useState<SwapRequest[]>([]);
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [lastSeenLeaveDecisionAt, setLastSeenLeaveDecisionAt] = useState<string | null>(null);
  const [unseenDocuments, setUnseenDocuments] = useState(0);
  const [myNotes, setMyNotes] = useState<Array<{ date: string; note: string }>>([]);
  const [planningMatrixRows, setPlanningMatrixRows] = useState<PlanningMatrixRow[]>([]);
  const [planningCodes, setPlanningCodes] = useState<PlanningCode[]>([]);
  const [planningMatrixHistory, setPlanningMatrixHistory] = useState<PlanningMatrixImportHistory[]>([]);
  const [activityLog, setActivityLog] = useState<ActivityLogEntry[]>([]);
  const [loginActivity, setLoginActivity] = useState<ActivityLogEntry[]>([]);
  // Dekkingsgaten (vandaag + 6 dagen = 7-daags venster) voor het Operations
  // Center van planner/admin. null = (nog) niet geladen — de cockpit toont
  // dan 'onbekend' i.p.v. een vals-groen 'volledig gedekt'.
  const [coverageDays, setCoverageDays] = useState<DayGap[] | null>(null);
  // Voer voor de werkvoorraad-knop in de topbar én het Open taken-paneel op
  // het dashboard: vervaldata (staf) en wachtende toestellen (admin-only API)
  // komen uit eigen endpoints. Best-effort — de app mag hier nooit op breken.
  const [vervaldata, setVervaldata] = useState<VervaldataRij[]>([]);
  const [pendingDevices, setPendingDevices] = useState<PendingDevice[]>([]);
  // Ververst elke 10 min én bij tab-focus: het portaal staat bij de planner
  // de hele dag open en de werkvoorraad-badge moet blijven kloppen.
  useEffect(() => {
    const rol = currentUser?.role;
    if (rol !== 'planner' && rol !== 'admin') { setVervaldata([]); return; }
    let cancelled = false;
    const haal = () => {
      apiJson<VervaldataRij[]>('/api/user-expiries')
        .then((rows) => { if (!cancelled && Array.isArray(rows)) setVervaldata(rows); })
        .catch(() => { /* geen data = geen rijen */ });
    };
    haal();
    const timer = window.setInterval(haal, 10 * 60 * 1000);
    window.addEventListener('focus', haal);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', haal);
    };
  }, [currentUser?.role]);
  useEffect(() => {
    if (currentUser?.role !== 'admin') { setPendingDevices([]); return; }
    let cancelled = false;
    const haal = async () => {
      try {
        const res = await apiFetch('/api/devices');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data)) setPendingDevices(data.filter((d: { status?: string }) => d.status === 'pending'));
      } catch {
        // stil: de werkvoorraad mag niet breken op een toestellen-fetch
      }
    };
    void haal();
    const timer = window.setInterval(haal, 10 * 60 * 1000);
    const opFocus = () => { void haal(); };
    window.addEventListener('focus', opFocus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', opFocus);
    };
  }, [currentUser?.role]);

  // Eerste data-fetch nog niet rond? Views kunnen dit gebruiken om
  // skeleton-loaders te tonen i.p.v. lege/mock-data.
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // Tijdstip van de laatste geslaagde dataload — chauffeurs zien zo hoe vers
  // hun rooster/omleidingen zijn (vooral offline of na een tijd weg).
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  // Vangrail tegen dataverlies: het write-model POST telkens de volledige
  // collectie — opslaan vanuit een nooit-geladen staat zou de server alle
  // "ontbrekende" records laten verwijderen. Een collectie is pas
  // beschrijfbaar nadat haar GET aantoonbaar geslaagd is.
  const loadedCollectionsRef = useRef<Set<string>>(new Set());
  const markCollectionLoaded = (key: string) => {
    loadedCollectionsRef.current.add(key);
  };
  const guardCollectionLoaded = (key: string, label: string): boolean => {
    if (loadedCollectionsRef.current.has(key)) return true;
    showToast(`${label} is nog niet geladen — opslaan is geblokkeerd om dataverlies te voorkomen. Vernieuw de pagina en probeer het opnieuw.`, 'error');
    return false;
  };
  // Optimistic-concurrency: per collectie de laatst geladen revisie bewaren
  // (ondoorzichtige token uit de X-Collection-Revision-header). Bij opslaan
  // sturen we 'm mee; matcht hij niet meer met de serverstaat, dan heeft een
  // collega ondertussen opgeslagen → 409, wij verversen i.p.v. te overschrijven.
  const REVISION_HEADER = 'x-collection-revision';
  const collectionRevisionsRef = useRef<Record<string, string>>({});
  const captureRevision = (key: string, response: Response) => {
    const rev = response.headers.get(REVISION_HEADER);
    if (rev) collectionRevisionsRef.current[key] = rev;
  };
  const revisionHeader = (key: string): Record<string, string> => {
    const rev = collectionRevisionsRef.current[key];
    return rev ? { [REVISION_HEADER]: rev } : {};
  };

  // Per-record-revisies (gebruikers, omleidingen, updates): de server hangt
  // aan elk record een `_rev` (hash van het record zoals hij het serveert;
  // records hebben geen updatedAt). We halen hem uit de GET-respons, bewaren
  // hem hier per id en sturen hem bij PUT/DELETE /api/<collectie>/:id terug
  // in X-Record-Revision. De views zien `_rev` nooit — de state blijft het
  // gewone User/Diversion/Update-type.
  const RECORD_REVISION_HEADER = 'x-record-revision';
  type RecordKey = 'users' | 'diversions' | 'updates';
  const recordRevisionsRef = useRef<Record<RecordKey, Record<string, string>>>({ users: {}, diversions: {}, updates: {} });
  const stripRecordRevisions = <T extends { id: string }>(key: RecordKey, rows: Array<T & { _rev?: string }>): T[] => {
    const map: Record<string, string> = {};
    const clean = rows.map(({ _rev, ...rest }) => {
      if (typeof _rev === 'string') map[String(rest.id)] = _rev;
      return rest as T;
    });
    recordRevisionsRef.current[key] = map;
    return clean;
  };
  const captureRecordRevision = <T extends { id: string }>(key: RecordKey, record: (T & { _rev?: string }) | null | undefined): T | null => {
    if (!record) return null;
    const { _rev, ...rest } = record;
    if (typeof _rev === 'string') recordRevisionsRef.current[key][String(rest.id)] = _rev;
    return rest as T;
  };
  const forgetRecordRevision = (key: RecordKey, id: string) => {
    delete recordRevisionsRef.current[key][id];
  };

  /** Achtergrond-dataload ná het profiel: blokkeert de eerste render niet —
   *  de views tonen intussen skeletons (isInitialLoad). */
  const loadAppData = async (appUser: User, accessToken: string) => {
    try {
      // Chauffeur: enkel eigen shifts ophalen (50× minder data op mobile).
      // Planner/admin: alle shifts (nodig voor beheer-views).
      const planningFilter = appUser.role === 'chauffeur' ? { driverId: String(appUser.id) } : undefined;
      await Promise.all([
        fetchPlanning(accessToken, planningFilter),
        fetchUsers(accessToken),
        fetchDiversions(accessToken),
        // Dienstoverzicht is planner/admin-only (view + beheer) — chauffeurs
        // hebben de services-collectie nergens nodig, dus niet ophalen.
        ...(appUser.role === 'planner' || appUser.role === 'admin' ? [fetchServices(accessToken)] : []),
        fetchUpdates(accessToken),
        fetchSwaps(accessToken),
        fetchLeave(accessToken),
        ...(appUser.role === 'planner' || appUser.role === 'admin' ? [fetchPlanningMatrix(accessToken)] : []),
        ...(appUser.role === 'planner' || appUser.role === 'admin' ? [fetchPlanningCodes(accessToken)] : []),
        ...(appUser.role === 'planner' || appUser.role === 'admin' ? [fetchPlanningMatrixHistory(accessToken)] : []),
        ...(appUser.role === 'planner' || appUser.role === 'admin' ? [refreshCoverageGaps()] : []),
        ...(appUser.role === 'admin' ? [fetchActivityLog(accessToken)] : []),
        ...(appUser.role === 'chauffeur' ? [fetchUnseenDocuments(appUser.id, accessToken)] : []),
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

  const fetchUpdates = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/updates', { accessToken });
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setUpdates(stripRecordRevisions<Update>('updates', data));
        markCollectionLoaded('updates');
        captureRevision('updates', response);
      }
    } catch (error) {
      console.error('Error fetching updates:', error);
      meldLaadfout('de updates');
    }
  };

  const saveUpdates = async (newUpdates: Update[]) => {
    if (!guardCollectionLoaded('updates', 'De updates zijn')) return false;
    try {
      const response = await apiFetch('/api/updates', {
        method: 'POST',
        headers: revisionHeader('updates'),
        body: JSON.stringify(newUpdates),
      });
      if (response.status === 409) {
        showToast('De updates zijn intussen door iemand anders gewijzigd — ik ververs ze, probeer je wijziging opnieuw.', 'info');
        await fetchUpdates();
        return false;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.details || data?.error || 'Opslaan mislukt.');
      }
      setUpdates(newUpdates);
      captureRevision('updates', response);
      // Verse per-record-revisies ophalen (de collectie-save kent ze niet).
      void fetchUpdates();
      if (currentUser?.role === 'admin') {
        await fetchActivityLog();
      }
      return true;
    } catch (error) {
      console.error('Error saving updates:', error);
      showToast(`Opslaan van updates is mislukt: ${error instanceof Error ? error.message : 'Onbekende fout'}`, 'error');
      return false;
    }
  };

  const sendUrgentEmail = async (update: Update) => {
    try {
      const response = await apiFetch('/api/send-urgent-update-email', {
        method: 'POST',
        body: JSON.stringify({
          update,
          recipients: users.filter(u => u.email)
        }),
      });
      const data = await response.json().catch(() => ({} as any));
      if (response.ok && data.success) {
        showToast(data.mocked ? `E-mail gelogd: ${data.message}` : 'E-mails verzonden naar alle chauffeurs.', 'success');
      } else {
        showToast(data.details || data.error || 'Verzenden van de e-mailupdate is mislukt.', 'error');
      }
    } catch (error) {
      console.error('Error sending urgent email:', error);
      showToast('Verzenden van de e-mailupdate is mislukt.', 'error');
    }
  };

  const fetchSwaps = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/swaps', { accessToken });
      captureRevision('swaps', response);
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setSwaps(data);
        markCollectionLoaded('swaps');
      }
    } catch (error) {
      console.error('Error fetching swaps:', error);
      meldLaadfout('de dienstruilen');
    }
  };

  const saveSwaps = async (newSwaps: SwapRequest[]): Promise<boolean> => {
    if (!guardCollectionLoaded('swaps', 'De dienstruilen zijn')) return false;
    // Nieuw verzoek vs. wijziging: andere boodschap, zodat de aanvrager weet
    // dat de collega eerst moet accepteren (anders lijkt de ruil al rond).
    const isNewRequest = newSwaps.length > swaps.length;
    try {
      const response = await apiFetch('/api/swaps', {
        method: 'POST',
        headers: revisionHeader('swaps'),
        body: JSON.stringify(newSwaps),
      });
      if (response.status === 409) {
        showToast('De dienstruilen zijn intussen door iemand anders gewijzigd — ik ververs ze, probeer je wijziging opnieuw.', 'info');
        await fetchSwaps();
        return false;
      }
      if (response.ok) {
        // Bewust opnieuw ophalen i.p.v. setSwaps(newSwaps): de server vult bij
        // het opslaan shiftDate/shiftLine aan — de dienst-info die de
        // ruilkaarten tonen zodra de dienst niet (meer) in de eigen planning
        // zit. Schreven we de client-array terug, dan bleef het dienstlabel
        // leeg tot de volgende fetch. fetchSwaps legt zelf de revisie vast.
        await fetchSwaps();
        if (currentUser?.role === 'admin') {
          await fetchActivityLog();
        }
        showToast(isNewRequest ? 'Ruilverzoek verstuurd — je collega moet eerst accepteren.' : 'Dienstruil bijgewerkt.', 'success');
        return true;
      }
      const err = await response.json().catch(() => ({} as any));
      showToast(err.error || 'Opslaan van dienstruilen is mislukt.', 'error');
      return false;
    } catch (error) {
      console.error('Error saving swaps:', error);
      showToast('Opslaan van dienstruilen is mislukt.', 'error');
      return false;
    }
  };

  const fetchLeave = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/leave', { accessToken });
      captureRevision('leave', response);
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setLeaveRequests(data);
        markCollectionLoaded('leave');
      }
    } catch (error) {
      console.error('Error fetching leave:', error);
      meldLaadfout('de verlofaanvragen');
    }
  };

  // 'Nieuw'-badge op Mijn documenten: telt de eigen documenten die nieuwer zijn
  // dan het moment waarop de chauffeur de documentenweergave het laatst opende.
  const fetchUnseenDocuments = async (userId: string, accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/documents', { accessToken });
      const data = await response.json();
      if (!Array.isArray(data)) return;
      let lastSeen: string | null = null;
      try { lastSeen = localStorage.getItem(`planx-documents-lastseen-${userId}`); } catch { /* privacy-modus */ }
      const unseen = lastSeen ? data.filter((d: any) => String(d.uploadedAt) > lastSeen).length : data.length;
      setUnseenDocuments(unseen);
    } catch (error) {
      console.error('Error fetching documents badge:', error);
    }
  };

  const markDocumentsSeen = () => {
    setUnseenDocuments(0);
    if (!currentUser) return;
    try { localStorage.setItem(`planx-documents-lastseen-${currentUser.id}`, new Date().toISOString()); } catch { /* privacy-modus */ }
  };

  const fetchPlanningMatrix = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/planning-matrix', { accessToken });
      const data = await response.json();
      if (data && Array.isArray(data)) setPlanningMatrixRows(data);
    } catch (error) {
      console.error('Error fetching planning matrix:', error);
    }
  };

  const fetchPlanningCodes = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/planning-codes', { accessToken });
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setPlanningCodes(data);
        markCollectionLoaded('planningCodes');
        captureRevision('planningCodes', response);
      }
    } catch (error) {
      console.error('Error fetching planning codes:', error);
    }
  };

  const fetchPlanningMatrixHistory = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/planning-matrix/history', { accessToken });
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setPlanningMatrixHistory(data);
      }
    } catch (error) {
      console.error('Error fetching planning matrix history:', error);
    }
  };

  const refreshCoverageGaps = async () => {
    try {
      const from = isoDate(new Date());
      const to = isoDate(addDays(new Date(), 6));
      const res = await fetchCoverageGaps(from, to);
      setCoverageDays(res.days);
    } catch (error) {
      // State blijft null (of houdt de vorige succesvolle fetch) — de
      // cockpit toont dan 'onbekend' i.p.v. vals-groen.
      console.error('Error fetching coverage gaps:', error);
    }
  };

  const fetchActivityLog = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/activity', { accessToken });
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setActivityLog(data);
      }
    } catch (error) {
      console.error('Error fetching activity log:', error);
    }
  };

  const fetchLoginActivity = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/activity/logins', { accessToken });
      const data = await response.json();
      if (data && Array.isArray(data.logins)) {
        setLoginActivity(data.logins);
      }
    } catch (error) {
      console.error('Error fetching login activity:', error);
    }
  };

  const savePlanningCodes = async (newCodes: PlanningCode[]) => {
    if (!guardCollectionLoaded('planningCodes', 'De planningscodes zijn')) return false;
    try {
      beginLoading();
      const response = await apiFetch('/api/planning-codes', {
        method: 'POST',
        headers: revisionHeader('planningCodes'),
        body: JSON.stringify(newCodes),
      });
      if (response.status === 409) {
        showToast('De planningscodes zijn intussen door iemand anders gewijzigd — ik ververs ze, probeer je wijziging opnieuw.', 'info');
        await fetchPlanningCodes();
        return false;
      }
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.details || data?.error || 'Opslaan mislukt.');
      }
      setPlanningCodes(newCodes);
      captureRevision('planningCodes', response);
      if (currentUser?.role === 'admin') {
        await fetchActivityLog();
      }
      showToast('Planningscodes succesvol opgeslagen.', 'success');
      return true;
    } catch (error: any) {
      console.error('Error saving planning codes:', error);
      showToast(`Opslaan van planningscodes is mislukt: ${error.message}`, 'error');
      return false;
    } finally {
      endLoading();
    }
  };

  const markLeaveDecisionsSeen = () => {
    if (!currentUser) return;
    const now = new Date().toISOString();
    setLastSeenLeaveDecisionAt(now);
    try {
      localStorage.setItem(`planx-leave-lastseen-${currentUser.id}`, now);
    } catch {
      // ignore quota / unavailable storage
    }
  };

  const saveLeave = async (newLeave: LeaveRequest[]): Promise<boolean> => {
    if (!guardCollectionLoaded('leave', 'De verlofaanvragen zijn')) return false;
    try {
      const response = await apiFetch('/api/leave', {
        method: 'POST',
        headers: revisionHeader('leave'),
        body: JSON.stringify(newLeave),
      });
      if (response.status === 409) {
        showToast('De verlofaanvragen zijn intussen door iemand anders gewijzigd — ik ververs ze, probeer je wijziging opnieuw.', 'info');
        await fetchLeave();
        return false;
      }
      if (response.ok) {
        setLeaveRequests(newLeave);
        captureRevision('leave', response);
        if (currentUser?.role === 'admin') {
          await fetchActivityLog();
        }
        const isNewRequest = newLeave.some((r) => !leaveRequests.some((p) => p.id === r.id));
        showToast(isNewRequest ? 'Aanvraag ingediend — de planner beoordeelt ze.' : 'Verlofaanvraag bijgewerkt.', 'success');
        return true;
      }
      const err = await response.json().catch(() => ({} as any));
      showToast(err.details || err.error || 'Opslaan van verlofaanvragen is mislukt.', 'error');
      return false;
    } catch (error) {
      console.error('Error saving leave:', error);
      showToast('Opslaan van verlofaanvragen is mislukt.', 'error');
      return false;
    }
  };

  /** Ziekmelding: aparte, directe flow (geen goedkeuring). POST → verse
   *  verloflijst ophalen zodat de ziekte-dag meteen zichtbaar is. */
  const reportSick = async (payload: { userId: string; startDate?: string; endDate?: string; comment?: string }): Promise<boolean> => {
    try {
      const response = await apiFetch('/api/leave/sick-report', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (response.ok) {
        // Dekking meteen mee verversen: het gat dat deze ziekmelding slaat
        // moet direct in "Open taken" en Openstaande diensten staan — dít is
        // het moment waarop de planner een vervanger zoekt, niet na een
        // harde refresh. Best-effort naast de leave-fetch.
        await Promise.all([fetchLeave(), refreshCoverageGaps()]);
        showToast('Ziekmelding doorgegeven — de planning is verwittigd.', 'success');
        return true;
      }
      const err = await response.json().catch(() => ({} as any));
      showToast(err.error || 'Ziekmelding is mislukt.', 'error');
      return false;
    } catch (error) {
      console.error('Error reporting sick:', error);
      showToast('Ziekmelding is mislukt.', 'error');
      return false;
    }
  };

  /** Delta-beslissing op één record (PATCH) met optimistic-concurrency:
   *  bij een 409/404 is een collega ons voor geweest — verse lijst ophalen
   *  i.p.v. stilletjes overschrijven. Geldt voor verlof én dienstruil. */
  const decideViaPatch = async (
    kind: 'leave' | 'swaps',
    id: string,
    status: string,
    ifStatus: string | undefined,
    refetch: () => Promise<void> | void,
    applyLocal: (updated: any) => void,
  ): Promise<boolean> => {
    try {
      const response = await apiFetch(`/api/${kind}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, ifStatus }),
      });
      const data = await response.json().catch(() => ({} as any));
      if (response.ok) {
        captureRevision(kind, response);
        applyLocal(data?.leave ?? data?.swap ?? { status });
        if (currentUser?.role === 'admin') void fetchActivityLog();
        return true;
      }
      if (response.status === 409 || response.status === 404) {
        showToast(data.error || 'Dit is intussen al behandeld door een collega — de lijst is ververst.', 'info');
        void refetch();
        return false;
      }
      showToast(data.details || data.error || 'Beslissing opslaan is mislukt.', 'error');
      return false;
    } catch (error) {
      console.error(`Error deciding ${kind}:`, error);
      showToast('Beslissing opslaan is mislukt.', 'error');
      return false;
    }
  };

  const decideLeave = (id: string, status: LeaveRequest['status'], seenStatus?: string): Promise<boolean> => {
    const current = leaveRequests.find((r) => r.id === id);
    // Record niet (meer) lokaal → onze lijst is stale; ifStatus is server-
    // side verplicht, dus eerst verversen i.p.v. een kansloze PATCH.
    if (!current) { void fetchLeave(); return Promise.resolve(false); }
    // ifStatus = wat de beslisser ZAG (seenStatus uit de view), niet de live
    // state: realtime kan de lijst intussen ververst hebben met de beslissing
    // van een collega — met de live status als referentie keurt de check dan
    // altijd goed en is de guard feitelijk uitgeschakeld (controleronde 30/07).
    return decideViaPatch('leave', id, status, seenStatus ?? current.status, fetchLeave, (updated) => {
      setLeaveRequests((curr) => curr.map((r) => (r.id === id ? { ...r, ...updated } : r)));
    });
  };

  const decideSwap = (id: string, status: SwapRequest['status'], seenStatus?: string): Promise<boolean> => {
    const current = swaps.find((s) => s.id === id);
    if (!current) { void fetchSwaps(); return Promise.resolve(false); }
    // Zelfde seenStatus-principe als decideLeave.
    return decideViaPatch('swaps', id, status, seenStatus ?? current.status, fetchSwaps, (updated) => {
      setSwaps((curr) => curr.map((s) => (s.id === id ? { ...s, ...updated } : s)));
    });
  };

  // Chauffeur bevestigt een doorgevoerde wissel ("gezien") — eigen endpoint,
  // want targetSeenAt is bewust niet schrijfbaar via de array-route.
  const confirmSwapSeen = async (id: string): Promise<boolean> => {
    try {
      const response = await apiFetch(`/api/swaps/${id}/gezien`, { method: 'POST' });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        notify(data?.error || 'Bevestigen mislukt. Probeer het opnieuw.', 'error');
        void fetchSwaps();
        return false;
      }
      // Endpoint geeft { success: true } terug; lokaal direct markeren en de
      // echte timestamp via de refresh binnenhalen.
      setSwaps((curr) => curr.map((s) => (s.id === id ? { ...s, targetSeenAt: new Date().toISOString() } : s)));
      void fetchSwaps();
      notify('Bevestigd — de planner ziet dat je de wissel gezien hebt.', 'success');
      return true;
    } catch {
      notify('Bevestigen mislukt. Controleer je verbinding.', 'error');
      return false;
    }
  };

  // Dienstnotities van de ingelogde chauffeur (planner leest ze in het
  // Maandrooster zelf). Venster: gisteren t/m +45 dagen.
  const fetchMyNotes = async (accessToken = session?.access_token) => {
    try {
      if (currentUser?.role !== 'chauffeur') return;
      const from = new Date(); from.setDate(from.getDate() - 1);
      const to = new Date(); to.setDate(to.getDate() + 45);
      const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const response = await apiFetch(`/api/planning-notes?from=${iso(from)}&to=${iso(to)}`, { accessToken });
      const data = await response.json();
      if (Array.isArray(data)) setMyNotes(data.map((n: any) => ({ date: String(n.date), note: String(n.note) })));
    } catch { /* notities zijn nice-to-have */ }
  };

  useEffect(() => {
    if (currentUser?.role === 'chauffeur') void fetchMyNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, currentUser?.role]);

  const fetchServices = async (accessToken = session?.access_token) => {
    try {
      beginLoading();
      const response = await apiFetch('/api/services', { accessToken });
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setServices(data);
        markCollectionLoaded('services');
        captureRevision('services', response);
      }
    } catch (error) {
      console.error('Error fetching services:', error);
      meldLaadfout('het dienstoverzicht');
    } finally {
      endLoading();
    }
  };

  // Promise<boolean> zodat het beheerformulier pas sluit/wist ná succes —
  // dit was de enige mutatie-view die fire-and-forget opsloeg (controleronde).
  const saveServices = async (newServices: Service[], opts?: { bulkReplace?: boolean }): Promise<boolean> => {
    if (!guardCollectionLoaded('services', 'Het dienstoverzicht is')) return false;
    try {
      beginLoading();
      const response = await apiFetch('/api/services', {
        method: 'POST',
        // Import vervangt legitiem de hele collectie; de header laat de
        // server z'n bulk-wipe-vangrail voor deze save overslaan. Bij een
        // gewone bewerking sturen we de revisie mee voor conflictdetectie.
        headers: opts?.bulkReplace ? { 'x-bulk-replace': '1' } : revisionHeader('services'),
        body: JSON.stringify(newServices),
      });
      if (response.status === 409) {
        showToast('Het dienstoverzicht is intussen door iemand anders gewijzigd — ik ververs het, probeer je wijziging opnieuw.', 'info');
        await fetchServices();
        return false;
      }
      if (response.ok) {
        setServices(newServices);
        captureRevision('services', response);
        if (currentUser?.role === 'admin') {
          await fetchActivityLog();
        }
        showToast('Diensten succesvol opgeslagen.', 'success');
        return true;
      }
      const err = await response.json().catch(() => ({} as any));
      showToast(err.details || err.error || 'Opslaan van diensten is mislukt.', 'error');
      return false;
    } catch (error) {
      console.error('Error saving services:', error);
      showToast('Opslaan van diensten is mislukt.', 'error');
      return false;
    } finally {
      endLoading();
    }
  };

  const fetchUsers = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/users', { accessToken });
      captureRevision('users', response);
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setUsers(stripRecordRevisions<User>('users', data));
        markCollectionLoaded('users');
      }
    } catch (error) {
      console.error('Error fetching users:', error);
      meldLaadfout('de gebruikerslijst');
    }
  };

  const saveUsers = async (newUsers: Array<User & { password?: string }>) => {
    if (!guardCollectionLoaded('users', 'De gebruikerslijst is')) return false;
    try {
      beginLoading();
      const response = await apiFetch('/api/users', {
        method: 'POST',
        headers: revisionHeader('users'),
        body: JSON.stringify(newUsers),
      });
      if (response.status === 409) {
        showToast('De gebruikerslijst is intussen door iemand anders gewijzigd — ik ververs ze, probeer je wijziging opnieuw.', 'info');
        await fetchUsers();
        return false;
      }
      if (response.ok) {
        await fetchUsers();
        if (currentUser?.role === 'admin') {
          await fetchActivityLog();
        }
        showToast('Gebruikers succesvol opgeslagen.', 'success');
        return true;
      } else {
        const text = await response.text();
        console.error('Server error saving users. Status:', response.status, 'Body:', text);
        
        let errorMsg = `Server fout (${response.status})`;
        try {
          const errorData = JSON.parse(text);
          errorMsg = errorData.details || errorData.error || errorMsg;
        } catch (e) {
          // If not JSON, maybe it's a Vercel error page
          if (text.includes('500') || text.includes('Internal Server Error')) {
            errorMsg = "Interne Server Fout (500). Controleer de Vercel logs of de tabelstructuur in Supabase.";
          } else if (text.length > 0) {
            errorMsg = `Server fout: ${text.slice(0, 100)}`;
          }
        }
        throw new Error(errorMsg);
      }
    } catch (error: any) {
      console.error('Error saving users:', error);
      showToast('Fout bij het opslaan van gebruikers: ' + error.message, 'error');
      return false;
    } finally {
      endLoading();
    }
  };

  const fetchPlanning = async (accessToken = session?.access_token, filters?: { driverId?: string; month?: string }, opts?: { silent?: boolean }) => {
    try {
      if (!opts?.silent) beginLoading();
      // Chauffeurs krijgen alleen hun eigen shifts — 50x minder data
      // dan het volledige rooster. Planner/admin krijgt alles.
      const params = new URLSearchParams();
      if (filters?.driverId) params.set('driverId', filters.driverId);
      if (filters?.month) params.set('month', filters.month);
      const qs = params.toString();
      const url = qs ? `/api/planning?${qs}` : '/api/planning';
      const response = await apiFetch(url, { accessToken });
      // Revisie alleen bij een ongefilterde fetch (de server zet 'm ook
      // alleen dan) — een subset-revisie zou valse conflicten geven.
      if (!qs) captureRevision('planning', response);
      const data = await response.json();
      // Een lege lijst is een geldig resultaat (chauffeur zonder diensten, of
      // planning gewist) → die moet ook écht leeg tonen. Vroeger hield
      // `length > 0` de oude/mock-data staan; nu enkel guarden op array-vorm.
      if (Array.isArray(data)) {
        setShifts(data);
        markCollectionLoaded('planning');
      }
    } catch (error) {
      console.error('Error fetching planning:', error);
      meldLaadfout('de planning');
    } finally {
      if (!opts?.silent) endLoading();
    }
  };

  const savePlanning = async (newShifts: Shift[]): Promise<boolean> => {
    if (!guardCollectionLoaded('planning', 'De planning is')) return false;
    try {
      beginLoading();
      const response = await apiFetch('/api/planning', {
        method: 'POST',
        headers: revisionHeader('planning'),
        body: JSON.stringify(newShifts),
      });
      if (response.status === 409) {
        showToast('De planning is intussen door iemand anders gewijzigd — ik ververs ze, probeer je wijziging opnieuw.', 'info');
        await fetchPlanning();
        return false;
      }
      if (response.ok) {
        setShifts(newShifts);
        captureRevision('planning', response);
        if (currentUser?.role === 'admin') {
          await fetchActivityLog();
        }
        showToast('Planning succesvol opgeslagen.', 'success');
        return true;
      }
      const err = await response.json().catch(() => ({} as any));
      showToast(err.details || err.error || 'Opslaan van planning is mislukt.', 'error');
      return false;
    } catch (error) {
      console.error('Error saving planning:', error);
      showToast('Opslaan van planning is mislukt.', 'error');
      return false;
    } finally {
      endLoading();
    }
  };

  const fetchDiversions = async (accessToken = session?.access_token, opts?: { silent?: boolean }) => {
    try {
      if (!opts?.silent) beginLoading();
      const response = await apiFetch('/api/diversions', { accessToken });
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setDiversions(stripRecordRevisions<Diversion>('diversions', data));
        markCollectionLoaded('diversions');
        captureRevision('diversions', response);
      }
    } catch (error) {
      console.error('Error fetching diversions:', error);
    } finally {
      if (!opts?.silent) endLoading();
    }
  };

  const saveDiversions = async (newDiversions: Diversion[]) => {
    if (!guardCollectionLoaded('diversions', 'De omleidingen zijn')) return;
    try {
      beginLoading();
      const response = await apiFetch('/api/diversions', {
        method: 'POST',
        headers: revisionHeader('diversions'),
        body: JSON.stringify(newDiversions),
      });
      if (response.status === 409) {
        showToast('De omleidingen zijn intussen door iemand anders gewijzigd — ik ververs ze, probeer je wijziging opnieuw.', 'info');
        await fetchDiversions(undefined, { silent: true });
        return;
      }
      if (response.ok) {
        setDiversions(newDiversions);
        captureRevision('diversions', response);
        // Verse per-record-revisies ophalen (de collectie-save kent ze niet).
        void fetchDiversions(undefined, { silent: true });
        if (currentUser?.role === 'admin') {
          await fetchActivityLog();
        }
        showToast('Omleidingen succesvol opgeslagen.', 'success');
      } else {
        const err = await response.json().catch(() => ({} as any));
        showToast(err.details || err.error || 'Opslaan van omleidingen is mislukt.', 'error');
      }
    } catch (error) {
      console.error('Error saving diversions:', error);
      showToast('Opslaan van omleidingen is mislukt.', 'error');
    } finally {
      endLoading();
    }
  };


  // --- Per-record opslaan (gebruikers, omleidingen, updates) ---
  // Eerste stap weg van "POST de hele collectie": bewerken/toevoegen/
  // verwijderen gaat per record (PUT / POST …/one / DELETE). Optimistisch:
  // de lokale lijst wordt meteen aangepast; slaagt de call, dan vervangt
  // het canonieke serverrecord (mét verse `_rev`) de optimistische versie;
  // bij een 409 (iemand anders wijzigde het record) of een fout verversen
  // we de collectie — dat draait de optimistische stap vanzelf terug.
  // De collectie-savers (saveUsers e.d.) blijven bestaan voor import/bulk.
  type PerRecordOpts<T extends { id: string }> = {
    key: RecordKey;
    /** Onderwerp voor de toasts, bv. 'Deze gebruiker'. */
    label: string;
    method: 'PUT' | 'POST' | 'DELETE';
    url: string;
    id: string;
    body?: unknown;
    /** Sleutel van het record in de respons-JSON ('user' | 'diversion' | 'update'). */
    responseKey: string;
    setList: React.Dispatch<React.SetStateAction<T[]>>;
    optimistic: (prev: T[]) => T[];
    /** Canoniek record uit de respons in de lijst zetten (PUT/POST). */
    applySaved?: (prev: T[], saved: T) => T[];
    refetch: () => Promise<void> | void;
    successToast?: string;
  };
  const perRecord = async <T extends { id: string }>(opts: PerRecordOpts<T>): Promise<boolean> => {
    if (!guardCollectionLoaded(opts.key, opts.label + ' is')) return false;
    const needsRevision = opts.method !== 'POST';
    const rev = recordRevisionsRef.current[opts.key][opts.id];
    if (needsRevision && !rev) {
      // Geen revisie bekend (lijst nooit vers geladen sinds een bulk-save):
      // eerst verversen, dan opnieuw proberen — nooit blind overschrijven.
      showToast(`${opts.label} is nog niet vers geladen — ik ververs de lijst, probeer het daarna opnieuw.`, 'info');
      await opts.refetch();
      return false;
    }
    opts.setList(opts.optimistic);
    try {
      const response = await apiFetch(opts.url, {
        method: opts.method,
        headers: needsRevision && rev ? { [RECORD_REVISION_HEADER]: rev } : {},
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      const data = await response.json().catch(() => ({} as any));
      if (response.ok) {
        captureRevision(opts.key, response);
        if (opts.method === 'DELETE') {
          forgetRecordRevision(opts.key, opts.id);
        } else {
          const saved = captureRecordRevision<T>(opts.key, data?.[opts.responseKey]);
          if (saved && opts.applySaved) opts.setList((prev) => opts.applySaved!(prev, saved));
        }
        if (currentUser?.role === 'admin') void fetchActivityLog();
        if (opts.successToast) showToast(opts.successToast, 'success');
        return true;
      }
      if (response.status === 409 || response.status === 404) {
        showToast(
          response.status === 404
            ? `${opts.label} is intussen door iemand anders verwijderd — ik ververs de lijst.`
            : data?.conflict === 'record' || data?.conflict === 'revision'
              ? `${opts.label} is intussen door iemand anders gewijzigd — ik ververs de lijst, probeer je wijziging opnieuw.`
              : (data?.details || data?.error || `${opts.label} kon niet opgeslagen worden.`),
          'info',
        );
        await opts.refetch();
        return false;
      }
      showToast(data?.details || data?.error || `${opts.label} kon niet opgeslagen worden (${response.status}).`, 'error');
      await opts.refetch();
      return false;
    } catch (error) {
      console.error(`Error saving ${opts.key} record:`, error);
      showToast(`${opts.label} kon niet opgeslagen worden: ${error instanceof Error ? error.message : 'onbekende fout'}.`, 'error');
      await opts.refetch();
      return false;
    }
  };
  const replaceById = <T extends { id: string }>(prev: T[], record: T): T[] =>
    prev.map((r) => (r.id === record.id ? record : r));
  const withoutId = <T extends { id: string }>(prev: T[], id: string): T[] => prev.filter((r) => r.id !== id);

  // Gebruikers (admin). Het record mag een `password` dragen (nieuw of reset);
  // het serverrecord dat terugkomt is zonder.
  const saveUser = (record: User & { password?: string }): Promise<boolean> =>
    perRecord<User>({
      key: 'users', label: 'Deze gebruiker', method: 'PUT', url: `/api/users/${encodeURIComponent(record.id)}`, id: record.id, body: record,
      responseKey: 'user', setList: setUsers,
      optimistic: (prev) => { const { password: _pw, ...zonder } = record; return replaceById(prev, zonder as User); },
      applySaved: replaceById, refetch: () => fetchUsers(), successToast: 'Gebruiker opgeslagen.',
    });
  const createUser = (record: User & { password?: string }): Promise<boolean> =>
    perRecord<User>({
      key: 'users', label: 'Deze gebruiker', method: 'POST', url: '/api/users/one', id: record.id, body: record,
      responseKey: 'user', setList: setUsers,
      optimistic: (prev) => { const { password: _pw, ...zonder } = record; return [...withoutId(prev, record.id), zonder as User]; },
      applySaved: replaceById, refetch: () => fetchUsers(), successToast: 'Gebruiker toegevoegd.',
    });
  const deleteUser = (id: string): Promise<boolean> =>
    perRecord<User>({
      key: 'users', label: 'Deze gebruiker', method: 'DELETE', url: `/api/users/${encodeURIComponent(id)}`, id,
      responseKey: 'user', setList: setUsers, optimistic: (prev) => withoutId(prev, id), refetch: () => fetchUsers(), successToast: 'Gebruiker verwijderd.',
    });

  // Omleidingen (planner/admin).
  const saveDiversion = (record: Diversion): Promise<boolean> =>
    perRecord<Diversion>({
      key: 'diversions', label: 'Deze omleiding', method: 'PUT', url: `/api/diversions/${encodeURIComponent(record.id)}`, id: record.id, body: record,
      responseKey: 'diversion', setList: setDiversions, optimistic: (prev) => replaceById(prev, record), applySaved: replaceById,
      refetch: () => fetchDiversions(undefined, { silent: true }), successToast: 'Omleiding opgeslagen.',
    });
  const createDiversion = (record: Diversion): Promise<boolean> =>
    perRecord<Diversion>({
      key: 'diversions', label: 'Deze omleiding', method: 'POST', url: '/api/diversions/one', id: record.id, body: record,
      responseKey: 'diversion', setList: setDiversions, optimistic: (prev) => [...withoutId(prev, record.id), record], applySaved: replaceById,
      refetch: () => fetchDiversions(undefined, { silent: true }), successToast: 'Omleiding toegevoegd.',
    });
  const deleteDiversion = (id: string): Promise<boolean> =>
    perRecord<Diversion>({
      key: 'diversions', label: 'Deze omleiding', method: 'DELETE', url: `/api/diversions/${encodeURIComponent(id)}`, id,
      responseKey: 'diversion', setList: setDiversions, optimistic: (prev) => withoutId(prev, id),
      refetch: () => fetchDiversions(undefined, { silent: true }), successToast: 'Omleiding verwijderd.',
    });

  // Updates (planner/admin). Geen success-toast: de view meldt zelf
  // "gepubliceerd/bijgewerkt" (en stuurt eventueel de dringende mail).
  const saveUpdate = (record: Update): Promise<boolean> =>
    perRecord<Update>({
      key: 'updates', label: 'Deze update', method: 'PUT', url: `/api/updates/${encodeURIComponent(record.id)}`, id: record.id, body: record,
      responseKey: 'update', setList: setUpdates, optimistic: (prev) => replaceById(prev, record), applySaved: replaceById, refetch: () => fetchUpdates(),
    });
  const createUpdate = (record: Update): Promise<boolean> =>
    perRecord<Update>({
      key: 'updates', label: 'Deze update', method: 'POST', url: '/api/updates/one', id: record.id, body: record,
      responseKey: 'update', setList: setUpdates, optimistic: (prev) => [record, ...withoutId(prev, record.id)], applySaved: replaceById, refetch: () => fetchUpdates(),
    });
  const deleteUpdate = (id: string): Promise<boolean> =>
    perRecord<Update>({
      key: 'updates', label: 'Deze update', method: 'DELETE', url: `/api/updates/${encodeURIComponent(id)}`, id,
      responseKey: 'update', setList: setUpdates, optimistic: (prev) => withoutId(prev, id), refetch: () => fetchUpdates(),
    });

  useEffect(() => {
    if (currentView === 'activiteit' && currentUser?.role === 'admin') {
      fetchActivityLog();
      fetchLoginActivity();
    }
  }, [currentView, currentUser?.role]);

  useEffect(() => {
    if (!currentUser) {
      setLastSeenLeaveDecisionAt(null);
      return;
    }
    try {
      setLastSeenLeaveDecisionAt(localStorage.getItem(`planx-leave-lastseen-${currentUser.id}`));
    } catch {
      setLastSeenLeaveDecisionAt(null);
    }
  }, [currentUser?.id]);

  /** Alles leegmaken bij uitloggen (sessie verlopen / afgemeld). */
  const resetAll = () => {
    loadedCollectionsRef.current.clear();
    setUsers([]);
    setShifts([]);
    setDiversions([]);
    setServices([]);
    setUpdates([]);
    setSwaps([]);
    setLeaveRequests([]);
    setPlanningMatrixRows([]);
    setPlanningCodes([]);
    setPlanningMatrixHistory([]);
    setActivityLog([]);
  };

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
