import { useEffect, useState } from 'react';
import type { LeaveRequest } from '../../types';
import { apiFetch } from '../../lib/api';
import type { DataCtx } from './kern';

/**
 * Verlof: de aanvragen, beslissen (PATCH met seenStatus-guard), de
 * ziekmelding en het 'laatst gezien'-moment voor de beslissingsbadge.
 * `refreshCoverageGaps` komt uit de planning-module: een ziekmelding slaat
 * een gat dat meteen in de cockpit moet staan.
 */
export function useVerlofData(ctx: DataCtx & { refreshCoverageGaps: () => Promise<void> }) {
  const { session, currentUser, showToast, meldLaadfout, fetchActivityLog, refreshCoverageGaps } = ctx;
  const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
  const [lastSeenLeaveDecisionAt, setLastSeenLeaveDecisionAt] = useState<string | null>(null);

  const fetchLeave = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/leave', { accessToken });
      ctx.captureRevision('leave', response);
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setLeaveRequests(data);
        ctx.markCollectionLoaded('leave');
      }
    } catch (error) {
      console.error('Error fetching leave:', error);
      meldLaadfout('de verlofaanvragen');
    }
  };

  const saveLeave = async (newLeave: LeaveRequest[]): Promise<boolean> => {
    if (!ctx.guardCollectionLoaded('leave', 'De verlofaanvragen zijn')) return false;
    try {
      const response = await apiFetch('/api/leave', {
        method: 'POST',
        headers: ctx.revisionHeader('leave'),
        body: JSON.stringify(newLeave),
      });
      if (response.status === 409 || response.status === 428) {
        showToast('De verlofaanvragen zijn intussen door iemand anders gewijzigd, ik ververs ze, probeer je wijziging opnieuw.', 'info');
        await fetchLeave();
        return false;
      }
      if (response.ok) {
        setLeaveRequests(newLeave);
        ctx.captureRevision('leave', response);
        if (currentUser?.role === 'admin') {
          await fetchActivityLog();
        }
        const isNewRequest = newLeave.some((r) => !leaveRequests.some((p) => p.id === r.id));
        showToast(isNewRequest ? 'Aanvraag ingediend, de planner beoordeelt ze.' : 'Verlofaanvraag bijgewerkt.', 'success');
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
        showToast('Ziekmelding doorgegeven, de planning is verwittigd.', 'success');
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

  const decideLeave = (id: string, status: LeaveRequest['status'], seenStatus?: string): Promise<boolean> => {
    const current = leaveRequests.find((r) => r.id === id);
    // Record niet (meer) lokaal → onze lijst is stale; ifStatus is server-
    // side verplicht, dus eerst verversen i.p.v. een kansloze PATCH.
    if (!current) { void fetchLeave(); return Promise.resolve(false); }
    // ifStatus = wat de beslisser ZAG (seenStatus uit de view), niet de live
    // state: realtime kan de lijst intussen ververst hebben met de beslissing
    // van een collega — met de live status als referentie keurt de check dan
    // altijd goed en is de guard feitelijk uitgeschakeld (controleronde 30/07).
    return ctx.decideViaPatch('leave', id, status, seenStatus ?? current.status, fetchLeave, (updated) => {
      setLeaveRequests((curr) => curr.map((r) => (r.id === id ? { ...r, ...updated } : r)));
    });
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

  /** Bij uitloggen: de aanvragen leeg (lastSeen wordt door het effect hierboven beheerd). */
  const resetVerlof = () => {
    setLeaveRequests([]);
  };

  return { leaveRequests, lastSeenLeaveDecisionAt, fetchLeave, saveLeave, reportSick, decideLeave, markLeaveDecisionsSeen, resetVerlof };
}
