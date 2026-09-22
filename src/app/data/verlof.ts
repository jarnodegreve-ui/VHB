import { useEffect, useState } from 'react';
import type { LeaveRequest } from '../../types';
import { apiFetch, apiJson } from '../../lib/api';
import { stelExtraFeestdagenIn } from '../../lib/leaveBalance';
// Zod-vrij (shared/feestdagen.ts): deze hook zit in de startbundel.
import { parseExtraFeestdagenLos, type ExtraFeestdag } from '../../../shared/feestdagen';
import { useCollectieState, type DataCtx } from './kern';
import { laatSchrijffout } from '../../lib/foutenLui';

/**
 * Verlof: de aanvragen, beslissen (PATCH met seenStatus-guard), de
 * ziekmelding en het 'laatst gezien'-moment voor de beslissingsbadge.
 * `refreshCoverageGaps` komt uit de planning-module: een ziekmelding slaat
 * een gat dat meteen in de cockpit moet staan.
 */
export function useVerlofData(ctx: DataCtx & { refreshCoverageGaps: () => Promise<void> }) {
  const { session, currentUser, showToast, meldLaadfout, fetchActivityLog, refreshCoverageGaps } = ctx;
  const [leaveRequests, setLeaveRequests, zetLeaveUitAntwoord] = useCollectieState<LeaveRequest[]>([]);
  const [lastSeenLeaveDecisionAt, setLastSeenLeaveDecisionAt] = useState<string | null>(null);

  const fetchLeave = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/leave', { accessToken });
      ctx.noteerAntwoord(response);
      ctx.captureRevision('leave', response);
      const data = await response.json();
      if (data && Array.isArray(data)) {
        zetLeaveUitAntwoord(response, data, data);
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
        // Verlof verandert de dekking (afwezige telt als gat): meteen mee
        // verversen, anders bleven dashboard en topbar op de oude stand staan.
        void refreshCoverageGaps();
        // Logboek stil op de achtergrond: de overlay wacht er niet op.
        if (currentUser?.role === 'admin') void fetchActivityLog();
        const isNewRequest = newLeave.some((r) => !leaveRequests.some((p) => p.id === r.id));
        showToast(isNewRequest ? 'Aanvraag ingediend, de planner beoordeelt ze.' : 'Verlofaanvraag bijgewerkt.', 'success');
        return true;
      }
      const err = await response.json().catch(() => ({} as any));
      laatSchrijffout('Opslaan van verlofaanvragen', { status: response.status, message: err.details || err.error }, (tekst) => showToast(tekst, 'error'));
      return false;
    } catch (error) {
      console.error('Error saving leave:', error);
      laatSchrijffout('Opslaan van verlofaanvragen', error, (tekst) => showToast(tekst, 'error'));
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
      laatSchrijffout('Ziekmelding', { status: response.status, message: err.error }, (tekst) => showToast(tekst, 'error'));
      return false;
    } catch (error) {
      console.error('Error reporting sick:', error);
      laatSchrijffout('Ziekmelding', error, (tekst) => showToast(tekst, 'error'));
      return false;
    }
  };

  /** `reden` = vrije tekst van de planner bij een afwijzing (wens Jarno
   *  22-09); de server negeert hem bij elke andere status. */
  const decideLeave = (id: string, status: LeaveRequest['status'], seenStatus?: string, reden?: string): Promise<boolean> => {
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
    }, reden ? { reden } : {}).then((ok) => {
      // Een goedkeuring maakt een dienst tot dekkingsgat: dashboard en
      // topbar-badge meteen laten meebewegen.
      if (ok) void refreshCoverageGaps();
      return ok;
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
    // Server is de bron (15-09): per toestel in localStorage betekende dat
    // een nieuw toestel elke beslissing ooit als "nieuw" toonde.
    void apiFetch('/api/me/voorkeuren', { method: 'PATCH', body: JSON.stringify({ dashboard: { verlofGezienOp: now } }) }).catch(() => undefined);
  };

  useEffect(() => {
    if (!currentUser) {
      setLastSeenLeaveDecisionAt(null);
      return;
    }
    // Server-waarde eerst (geldt op elk toestel); localStorage als terugval
    // voor accounts van vóór deze wijziging of een niet-gelukte PATCH. De
    // jongste van de twee wint, zodat een oud servertijdstip een recentere
    // lokale "gezien" niet terugdraait.
    let lokaal: string | null = null;
    try {
      lokaal = localStorage.getItem(`planx-leave-lastseen-${currentUser.id}`);
    } catch {
      lokaal = null;
    }
    const server = currentUser.dashboardVoorkeuren?.verlofGezienOp ?? null;
    setLastSeenLeaveDecisionAt([lokaal, server].filter(Boolean).sort().pop() ?? null);
  }, [currentUser?.id]);

  // Extra vrije dagen van de beheerder (naast de wettelijke feestdagen): één
  // keer laden per sessie en meteen als standaard in de verloftelling zetten
  // (leaveBalance.stelExtraFeestdagenIn), zodat elk saldo in de app ze
  // meerekent zonder ze door te geven.
  const [feestdagenExtra, setFeestdagenExtra] = useState<ExtraFeestdag[]>([]);
  const zetFeestdagenExtra = (extra: ExtraFeestdag[]) => {
    setFeestdagenExtra(extra);
    stelExtraFeestdagenIn(extra.map((d) => d.datum));
  };
  useEffect(() => {
    if (!currentUser) return;
    let weg = false;
    void (async () => {
      try {
        const data = await apiJson<unknown>('/api/verlof/feestdagen');
        if (!weg) zetFeestdagenExtra(parseExtraFeestdagenLos(data));
      } catch {
        // standaard (alleen wettelijke feestdagen) blijft staan
      }
    })();
    return () => { weg = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id]);

  /** Bij uitloggen: de aanvragen leeg (lastSeen wordt door het effect hierboven beheerd). */
  const resetVerlof = () => {
    setLeaveRequests([]);
    zetFeestdagenExtra([]);
  };

  return { leaveRequests, lastSeenLeaveDecisionAt, fetchLeave, saveLeave, reportSick, decideLeave, markLeaveDecisionsSeen, resetVerlof, feestdagenExtra, zetFeestdagenExtra };
}
