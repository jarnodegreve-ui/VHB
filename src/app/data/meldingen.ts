import { useState } from 'react';
import type { Melding } from '../../types';
import { apiFetch } from '../../lib/api';
import type { DataCtx } from './kern';

/**
 * Meldingencentrum: de eigen meldingen (alles wat de server als push
 * verstuurde, ook zonder push-abonnement) en de ongelezen-teller voor de bel
 * in de topbar en de app-badge. Realtime (src/lib/realtime.ts) roept
 * `fetchMeldingen` bij elke wijziging op de eigen rijen.
 *
 * Gelezen markeren is optimistisch: de rij en de teller schuiven meteen, de
 * server volgt; mislukt het, dan zet de refetch de waarheid terug.
 */
export function useMeldingenData(ctx: Pick<DataCtx, 'session'>) {
  const { session } = ctx;
  const [meldingen, setMeldingen] = useState<Melding[]>([]);
  const [ongelezenMeldingen, setOngelezenMeldingen] = useState(0);

  const fetchMeldingen = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/meldingen', { accessToken });
      if (!response.ok) return;
      const data = await response.json();
      // Vorm: { meldingen, ongelezen }. Een kale lijst (oude server, mock)
      // tellen we zelf.
      const lijst: Melding[] = Array.isArray(data) ? data : Array.isArray(data?.meldingen) ? data.meldingen : [];
      setMeldingen(lijst);
      setOngelezenMeldingen(typeof data?.ongelezen === 'number' ? data.ongelezen : lijst.filter((m) => !m.gelezenOp).length);
    } catch (error) {
      // Meldingen zijn nice-to-have: geen laadfout-toast, de bel blijft leeg.
      console.error('Error fetching meldingen:', error);
    }
  };

  /** Gelezen markeren: een selectie van ids, of alles (zonder ids). */
  const markeerMeldingenGelezen = async (ids?: string[]) => {
    const nu = new Date().toISOString();
    const doelIds = ids ? new Set(ids) : null;
    setMeldingen((prev) => prev.map((m) => (!m.gelezenOp && (!doelIds || doelIds.has(m.id)) ? { ...m, gelezenOp: nu } : m)));
    setOngelezenMeldingen((prev) => {
      if (!doelIds) return 0;
      const geraakt = meldingen.filter((m) => !m.gelezenOp && doelIds.has(m.id)).length;
      return Math.max(0, prev - geraakt);
    });
    try {
      const response = await apiFetch('/api/meldingen/gelezen', {
        method: 'POST',
        body: JSON.stringify(ids ? { ids } : {}),
      });
      if (!response.ok) await fetchMeldingen();
    } catch {
      await fetchMeldingen();
    }
  };

  const resetMeldingen = () => {
    setMeldingen([]);
    setOngelezenMeldingen(0);
  };

  return { meldingen, ongelezenMeldingen, fetchMeldingen, markeerMeldingenGelezen, resetMeldingen };
}
