import { useRef, useState } from 'react';
import type { Melding } from '../../types';
import { apiFetch } from '../../lib/api';
import { useCollectieState, type DataCtx } from './kern';

/**
 * Meldingencentrum: de eigen meldingen (alles wat de server als push
 * verstuurde, ook zonder push-abonnement) en de ongelezen-teller voor de bel
 * in de topbar en de app-badge. Realtime (src/lib/realtime.ts) roept
 * `fetchMeldingen` bij elke wijziging op de eigen rijen.
 *
 * Gelezen markeren is optimistisch: de rij en de teller schuiven meteen, de
 * server volgt; mislukt het, dan zet de refetch de waarheid terug.
 */
export function useMeldingenData(ctx: Pick<DataCtx, 'session' | 'noteerAntwoord'>) {
  const { session } = ctx;
  const [meldingen, setMeldingen, zetMeldingenUitAntwoord] = useCollectieState<Melding[]>([]);
  const [ongelezenMeldingen, setOngelezenMeldingen] = useState(0);
  // Actuele lijst voor markeerMeldingenGelezenVoorScherm zonder dat de
  // schermwissel-hook op elke meldingenwijziging opnieuw hoeft te vuren.
  const meldingenRef = useRef<Melding[]>([]);
  meldingenRef.current = meldingen;

  const fetchMeldingen = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/meldingen', { accessToken });
      if (!response.ok) return;
      ctx.noteerAntwoord(response);
      const data = await response.json();
      // Vorm: { meldingen, ongelezen }. Een kale lijst (oude server, mock)
      // tellen we zelf.
      const lijst: Melding[] = Array.isArray(data) ? data : Array.isArray(data?.meldingen) ? data.meldingen : [];
      // Lijst en teller komen uit hetzelfde antwoord: gelijk antwoord = beide
      // laten staan. Lokaal "gelezen" markeren gaat via setMeldingen en maakt
      // de afdruk ongeldig, dus de server-waarheid komt daarna altijd terug.
      if (zetMeldingenUitAntwoord(response, data, lijst)) {
        setOngelezenMeldingen(typeof data?.ongelezen === 'number' ? data.ongelezen : lijst.filter((m) => !m.gelezenOp).length);
      }
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

  /** Meldingen die naar dít scherm wijzen als gelezen markeren, aangeroepen
   *  bij elke schermwissel (App.tsx). Zo verdwijnen bel- en app-badge ook
   *  wanneer iemand via een push of de navigatie op de plek van de melding
   *  aankomt, zonder eerst langs het meldingenscherm te moeten (15-09).
   *  Vergelijkt op view-niveau: het doel 'updates/u2' hoort bij het scherm
   *  'updates'. */
  const markeerMeldingenGelezenVoorScherm = (view: string, doelNaarView: (doel: string) => string | null) => {
    const ids = meldingenRef.current
      .filter((m) => !m.gelezenOp && m.doel && doelNaarView(m.doel) === view)
      .map((m) => m.id);
    if (ids.length > 0) void markeerMeldingenGelezen(ids);
  };

  const resetMeldingen = () => {
    setMeldingen([]);
    setOngelezenMeldingen(0);
  };

  return { meldingen, ongelezenMeldingen, fetchMeldingen, markeerMeldingenGelezen, markeerMeldingenGelezenVoorScherm, resetMeldingen };
}
