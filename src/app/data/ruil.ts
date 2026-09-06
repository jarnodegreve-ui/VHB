import { useState } from 'react';
import type { SwapRequest } from '../../types';
import { apiFetch } from '../../lib/api';
import { notify } from '../../lib/ui';
import type { DataCtx } from './kern';

/**
 * Dienstruil: de verzoeken, beslissen (PATCH met seenStatus-guard) en de
 * 'gezien'-bevestiging van de chauffeur.
 */
export function useRuilData(ctx: DataCtx) {
  const { session, currentUser, showToast, meldLaadfout, fetchActivityLog } = ctx;
  const [swaps, setSwaps] = useState<SwapRequest[]>([]);

  const fetchSwaps = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/swaps', { accessToken });
      ctx.captureRevision('swaps', response);
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setSwaps(data);
        ctx.markCollectionLoaded('swaps');
      }
    } catch (error) {
      console.error('Error fetching swaps:', error);
      meldLaadfout('de dienstruilen');
    }
  };

  const saveSwaps = async (newSwaps: SwapRequest[]): Promise<boolean> => {
    if (!ctx.guardCollectionLoaded('swaps', 'De dienstruilen zijn')) return false;
    // Nieuw verzoek vs. wijziging: andere boodschap, zodat de aanvrager weet
    // dat de collega eerst moet accepteren (anders lijkt de ruil al rond).
    const isNewRequest = newSwaps.length > swaps.length;
    try {
      const response = await apiFetch('/api/swaps', {
        method: 'POST',
        headers: ctx.revisionHeader('swaps'),
        body: JSON.stringify(newSwaps),
      });
      if (response.status === 409 || response.status === 428) {
        showToast('De dienstruilen zijn intussen door iemand anders gewijzigd, ik ververs ze, probeer je wijziging opnieuw.', 'info');
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
        showToast(isNewRequest ? 'Ruilverzoek verstuurd, je collega moet eerst accepteren.' : 'Dienstruil bijgewerkt.', 'success');
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

  const decideSwap = (id: string, status: SwapRequest['status'], seenStatus?: string): Promise<boolean> => {
    const current = swaps.find((s) => s.id === id);
    if (!current) { void fetchSwaps(); return Promise.resolve(false); }
    // Zelfde seenStatus-principe als decideLeave.
    return ctx.decideViaPatch('swaps', id, status, seenStatus ?? current.status, fetchSwaps, (updated) => {
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
      notify('Bevestigd, de planner ziet dat je de wissel gezien hebt.', 'success');
      return true;
    } catch {
      notify('Bevestigen mislukt. Controleer je verbinding.', 'error');
      return false;
    }
  };

  const resetRuil = () => {
    setSwaps([]);
  };

  return { swaps, fetchSwaps, saveSwaps, decideSwap, confirmSwapSeen, resetRuil };
}
