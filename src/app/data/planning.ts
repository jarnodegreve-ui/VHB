import { useEffect, useState } from 'react';
import type { PlanningCode, PlanningMatrixImportHistory, PlanningMatrixRow, Service, Shift } from '../../types';
import { apiFetch } from '../../lib/api';
import { fetchCoverageGaps, type DayGap } from '../../lib/coverage';
import { addDays, isoDate } from '../../lib/availability';
import { useCollectieState, type DataCtx } from './kern';
import { navigeer } from '../router';
import { dienstoverzichtToast } from '../../lib/dienstoverzichtToast';

/**
 * Planning: de shifts, het dienstoverzicht (services), de planningsmatrix
 * met codes en importgeschiedenis, de dekkingsgaten voor de cockpit en de
 * dienstnotities van de ingelogde chauffeur.
 */
export function usePlanningData(ctx: DataCtx) {
  const { session, currentUser, showToast, meldLaadfout, beginLoading, endLoading, fetchActivityLog } = ctx;
  // Collecties via useCollectieState: een GET met ongewijzigde inhoud slaat
  // de setState (en dus de tree-render) over, zie kern.ts.
  const [shifts, setShifts, zetShiftsUitAntwoord] = useCollectieState<Shift[]>([]);
  const [services, setServices, zetServicesUitAntwoord] = useCollectieState<Service[]>([]);
  const [myNotes, setMyNotes, zetMyNotesUitAntwoord] = useCollectieState<Array<{ date: string; note: string }>>([]);
  const [planningMatrixRows, setPlanningMatrixRows, zetMatrixUitAntwoord] = useCollectieState<PlanningMatrixRow[]>([]);
  const [planningCodes, setPlanningCodes, zetCodesUitAntwoord] = useCollectieState<PlanningCode[]>([]);
  const [planningMatrixHistory, setPlanningMatrixHistory, zetHistoryUitAntwoord] = useCollectieState<PlanningMatrixImportHistory[]>([]);
  // Dekkingsgaten (vandaag + 6 dagen = 7-daags venster) voor het Operations
  // Center van planner/admin. null = (nog) niet geladen — de cockpit toont
  // dan 'onbekend' i.p.v. een vals-groen 'volledig gedekt'.
  const [coverageDays, , zetCoverageUitAntwoord] = useCollectieState<DayGap[] | null>(null);
  // Uitgestelde collecties (staf laadt ze ná de poort, zie useAppData): de
  // vlag gaat aan zodra de eerste laadpoging rond is, ook als ze mislukte
  // (dan toont de view leeg + de laadfout, zoals vroeger in de poort). Views
  // houden hun skelet aan tot de vlag waar is, zodat "leeg" nooit "nog niet
  // geladen" betekent.
  const [servicesGeladen, setServicesGeladen] = useState(false);
  const [planningMatrixGeladen, setPlanningMatrixGeladen] = useState(false);
  const [planningCodesGeladen, setPlanningCodesGeladen] = useState(false);

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
      ctx.noteerAntwoord(response);
      // Revisie alleen bij een ongefilterde fetch (de server zet 'm ook
      // alleen dan) — een subset-revisie zou valse conflicten geven.
      if (!qs) ctx.captureRevision('planning', response);
      const data = await response.json();
      // Een lege lijst is een geldig resultaat (chauffeur zonder diensten, of
      // planning gewist) → die moet ook écht leeg tonen. Vroeger hield
      // `length > 0` de oude/mock-data staan; nu enkel guarden op array-vorm.
      if (Array.isArray(data)) {
        zetShiftsUitAntwoord(response, data, data);
        ctx.markCollectionLoaded('planning');
      }
    } catch (error) {
      console.error('Error fetching planning:', error);
      meldLaadfout('de planning');
    } finally {
      if (!opts?.silent) endLoading();
    }
  };

  const savePlanning = async (newShifts: Shift[]): Promise<boolean> => {
    if (!ctx.guardCollectionLoaded('planning', 'De planning is')) return false;
    try {
      beginLoading();
      const response = await apiFetch('/api/planning', {
        method: 'POST',
        headers: ctx.revisionHeader('planning'),
        body: JSON.stringify(newShifts),
      });
      if (response.status === 409 || response.status === 428) {
        showToast('De planning is intussen door iemand anders gewijzigd, ik ververs ze, probeer je wijziging opnieuw.', 'info');
        await fetchPlanning();
        return false;
      }
      if (response.ok) {
        setShifts(newShifts);
        ctx.captureRevision('planning', response);
        // Logboek stil op de achtergrond: de overlay wacht er niet op.
        if (currentUser?.role === 'admin') void fetchActivityLog();
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

  const fetchServices = async (accessToken = session?.access_token) => {
    try {
      beginLoading();
      const response = await apiFetch('/api/services', { accessToken });
      const data = await response.json();
      if (data && Array.isArray(data)) {
        zetServicesUitAntwoord(response, data, data);
        ctx.markCollectionLoaded('services');
        ctx.captureRevision('services', response);
      }
    } catch (error) {
      console.error('Error fetching services:', error);
      meldLaadfout('het dienstoverzicht');
    } finally {
      setServicesGeladen(true);
      endLoading();
    }
  };

  // Promise<boolean> zodat het beheerformulier pas sluit/wist ná succes —
  // dit was de enige mutatie-view die fire-and-forget opsloeg (controleronde).
  const saveServices = async (newServices: Service[], opts?: { bulkReplace?: boolean }): Promise<boolean> => {
    if (!ctx.guardCollectionLoaded('services', 'Het dienstoverzicht is')) return false;
    try {
      beginLoading();
      const response = await apiFetch('/api/services', {
        method: 'POST',
        // Import vervangt legitiem de hele collectie; de header laat de
        // server z'n bulk-wipe-vangrail voor deze save overslaan. Bij een
        // gewone bewerking sturen we de revisie mee voor conflictdetectie.
        headers: opts?.bulkReplace ? { 'x-bulk-replace': '1' } : ctx.revisionHeader('services'),
        body: JSON.stringify(newServices),
      });
      if (response.status === 409 || response.status === 428) {
        showToast('Het dienstoverzicht is intussen door iemand anders gewijzigd, ik ververs het, probeer je wijziging opnieuw.', 'info');
        await fetchServices();
        return false;
      }
      if (response.ok) {
        setServices(newServices);
        ctx.captureRevision('services', response);
        // Logboek stil op de achtergrond: de overlay wacht er niet op.
        if (currentUser?.role === 'admin') void fetchActivityLog();
        // De server werkt de planning zelf bij na een inhoudelijke wijziging
        // (api/_lib/planningHeropbouw.ts). De save is hoe dan ook geslaagd; de
        // toast zegt wat er met de planning gebeurde.
        const antwoord = await response.json().catch(() => null);
        const melding = dienstoverzichtToast(antwoord?.planning);
        showToast(
          melding.tekst,
          melding.toon,
          melding.naarRoosters ? { label: 'Naar Beheer roosters', run: () => navigeer('beheer-roosters') } : undefined,
          // Lang genoeg om te lezen: de reden van een overgeslagen heropbouw
          // is een instructie, de gewone bevestiging mag snel weg.
          melding.naarRoosters ? { duurMs: 15000 } : melding.tekst.length > 60 ? { duurMs: 8000 } : undefined,
        );
        // Bijgewerkte planning meteen ophalen, stil: de schermen van deze
        // gebruiker hoeven niet op het realtime-signaal te wachten.
        if (antwoord?.planning?.status === 'bijgewerkt') void fetchPlanning(undefined, undefined, { silent: true });
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

  const fetchPlanningMatrix = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/planning-matrix', { accessToken });
      const data = await response.json();
      if (data && Array.isArray(data)) zetMatrixUitAntwoord(response, data, data);
    } catch (error) {
      console.error('Error fetching planning matrix:', error);
    } finally {
      setPlanningMatrixGeladen(true);
    }
  };

  const fetchPlanningCodes = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/planning-codes', { accessToken });
      const data = await response.json();
      if (data && Array.isArray(data)) {
        zetCodesUitAntwoord(response, data, data);
        ctx.markCollectionLoaded('planningCodes');
        ctx.captureRevision('planningCodes', response);
      }
    } catch (error) {
      console.error('Error fetching planning codes:', error);
    } finally {
      setPlanningCodesGeladen(true);
    }
  };

  const fetchPlanningMatrixHistory = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/planning-matrix/history', { accessToken });
      const data = await response.json();
      if (data && Array.isArray(data)) {
        zetHistoryUitAntwoord(response, data, data);
      }
    } catch (error) {
      console.error('Error fetching planning matrix history:', error);
    }
  };

  const savePlanningCodes = async (newCodes: PlanningCode[]) => {
    if (!ctx.guardCollectionLoaded('planningCodes', 'De planningscodes zijn')) return false;
    try {
      beginLoading();
      const response = await apiFetch('/api/planning-codes', {
        method: 'POST',
        headers: ctx.revisionHeader('planningCodes'),
        body: JSON.stringify(newCodes),
      });
      if (response.status === 409 || response.status === 428) {
        showToast('De planningscodes zijn intussen door iemand anders gewijzigd, ik ververs ze, probeer je wijziging opnieuw.', 'info');
        await fetchPlanningCodes();
        return false;
      }
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.details || data?.error || 'Opslaan mislukt.');
      }
      setPlanningCodes(newCodes);
      ctx.captureRevision('planningCodes', response);
      // Logboek stil op de achtergrond: de overlay wacht er niet op.
      if (currentUser?.role === 'admin') void fetchActivityLog();
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

  const refreshCoverageGaps = async () => {
    try {
      const from = isoDate(new Date());
      const to = isoDate(addDays(new Date(), 6));
      const res = await fetchCoverageGaps(from, to);
      // fetchCoverageGaps geeft de geparste body terug (geen Response): de
      // vergelijking valt terug op de payload.
      zetCoverageUitAntwoord(null, res.days, res.days);
    } catch (error) {
      // State blijft null (of houdt de vorige succesvolle fetch) — de
      // cockpit toont dan 'onbekend' i.p.v. vals-groen.
      console.error('Error fetching coverage gaps:', error);
    }
  };

  // Dienstnotities van de ingelogde chauffeur (planner leest ze in het
  // Maandrooster zelf). Venster: gisteren t/m +45 dagen.
  const fetchMyNotes = async (accessToken = session?.access_token) => {
    try {
      // Notities zijn per rijdende chauffeur; staf leest ze in het maandrooster.
      if (currentUser?.role !== 'chauffeur') return;
      const from = new Date(); from.setDate(from.getDate() - 1);
      const to = new Date(); to.setDate(to.getDate() + 45);
      const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const response = await apiFetch(`/api/planning-notes?from=${iso(from)}&to=${iso(to)}`, { accessToken });
      ctx.noteerAntwoord(response);
      const data = await response.json();
      if (Array.isArray(data)) zetMyNotesUitAntwoord(response, data, data.map((n: any) => ({ date: String(n.date), note: String(n.note) })));
    } catch { /* notities zijn nice-to-have */ }
  };

  useEffect(() => {
    if (currentUser?.role === 'chauffeur') void fetchMyNotes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, currentUser?.role]);

  /** Bij uitloggen: de collecties leeg. Ook de persoonlijke dienstnotities:
   *  MijnDagView zoekt ze enkel op datum, dus zonder wissen zag de volgende
   *  chauffeur op een gedeeld toestel de notitie van de vorige tot zijn eigen
   *  fetch slaagde (security-audit 07-09, bevinding 11). Coverage blijft. */
  const resetPlanning = () => {
    setShifts([]);
    setServices([]);
    setMyNotes([]);
    setPlanningMatrixRows([]);
    setPlanningCodes([]);
    setPlanningMatrixHistory([]);
    setServicesGeladen(false);
    setPlanningMatrixGeladen(false);
    setPlanningCodesGeladen(false);
  };

  return {
    shifts, services, myNotes, planningMatrixRows, planningCodes, planningMatrixHistory, coverageDays,
    servicesGeladen, planningMatrixGeladen, planningCodesGeladen,
    fetchPlanning, savePlanning, fetchServices, saveServices,
    fetchPlanningMatrix, fetchPlanningCodes, fetchPlanningMatrixHistory, savePlanningCodes,
    refreshCoverageGaps, fetchMyNotes, resetPlanning,
  };
}
