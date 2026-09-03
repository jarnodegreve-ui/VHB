import { useEffect, useState } from 'react';
import type { PlanningCode, PlanningMatrixImportHistory, PlanningMatrixRow, Service, Shift } from '../../types';
import { apiFetch } from '../../lib/api';
import { fetchCoverageGaps, type DayGap } from '../../lib/coverage';
import { addDays, isoDate } from '../../lib/availability';
import type { DataCtx } from './kern';

/**
 * Planning: de shifts, het dienstoverzicht (services), de planningsmatrix
 * met codes en importgeschiedenis, de dekkingsgaten voor de cockpit en de
 * dienstnotities van de ingelogde chauffeur.
 */
export function usePlanningData(ctx: DataCtx) {
  const { session, currentUser, showToast, meldLaadfout, beginLoading, endLoading, fetchActivityLog } = ctx;
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [myNotes, setMyNotes] = useState<Array<{ date: string; note: string }>>([]);
  const [planningMatrixRows, setPlanningMatrixRows] = useState<PlanningMatrixRow[]>([]);
  const [planningCodes, setPlanningCodes] = useState<PlanningCode[]>([]);
  const [planningMatrixHistory, setPlanningMatrixHistory] = useState<PlanningMatrixImportHistory[]>([]);
  // Dekkingsgaten (vandaag + 6 dagen = 7-daags venster) voor het Operations
  // Center van planner/admin. null = (nog) niet geladen — de cockpit toont
  // dan 'onbekend' i.p.v. een vals-groen 'volledig gedekt'.
  const [coverageDays, setCoverageDays] = useState<DayGap[] | null>(null);

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
      if (!qs) ctx.captureRevision('planning', response);
      const data = await response.json();
      // Een lege lijst is een geldig resultaat (chauffeur zonder diensten, of
      // planning gewist) → die moet ook écht leeg tonen. Vroeger hield
      // `length > 0` de oude/mock-data staan; nu enkel guarden op array-vorm.
      if (Array.isArray(data)) {
        setShifts(data);
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
      if (response.status === 409) {
        showToast('De planning is intussen door iemand anders gewijzigd — ik ververs ze, probeer je wijziging opnieuw.', 'info');
        await fetchPlanning();
        return false;
      }
      if (response.ok) {
        setShifts(newShifts);
        ctx.captureRevision('planning', response);
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

  const fetchServices = async (accessToken = session?.access_token) => {
    try {
      beginLoading();
      const response = await apiFetch('/api/services', { accessToken });
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setServices(data);
        ctx.markCollectionLoaded('services');
        ctx.captureRevision('services', response);
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
      if (response.status === 409) {
        showToast('Het dienstoverzicht is intussen door iemand anders gewijzigd — ik ververs het, probeer je wijziging opnieuw.', 'info');
        await fetchServices();
        return false;
      }
      if (response.ok) {
        setServices(newServices);
        ctx.captureRevision('services', response);
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
        ctx.markCollectionLoaded('planningCodes');
        ctx.captureRevision('planningCodes', response);
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

  const savePlanningCodes = async (newCodes: PlanningCode[]) => {
    if (!ctx.guardCollectionLoaded('planningCodes', 'De planningscodes zijn')) return false;
    try {
      beginLoading();
      const response = await apiFetch('/api/planning-codes', {
        method: 'POST',
        headers: ctx.revisionHeader('planningCodes'),
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
      ctx.captureRevision('planningCodes', response);
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

  /** Bij uitloggen: de collecties leeg (coverage/notities blijven, zoals voorheen). */
  const resetPlanning = () => {
    setShifts([]);
    setServices([]);
    setPlanningMatrixRows([]);
    setPlanningCodes([]);
    setPlanningMatrixHistory([]);
  };

  return {
    shifts, services, myNotes, planningMatrixRows, planningCodes, planningMatrixHistory, coverageDays,
    fetchPlanning, savePlanning, fetchServices, saveServices,
    fetchPlanningMatrix, fetchPlanningCodes, fetchPlanningMatrixHistory, savePlanningCodes,
    refreshCoverageGaps, fetchMyNotes, resetPlanning,
  };
}
