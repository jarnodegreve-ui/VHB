import { useEffect, useRef, useState } from 'react';
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
 *
 * Verwijderen is uitgesteld: de melding gaat meteen uit de lijst, de DELETE
 * vertrekt pas als de ongedaan-toast verlopen is. Een rij die weg is kan de
 * client niet terugschrijven (alleen de server maakt meldingen), dus is
 * wachten de enige eerlijke manier om "Ongedaan maken" waar te maken.
 */
export function useMeldingenData(ctx: Pick<DataCtx, 'session' | 'noteerAntwoord'>) {
  const { session } = ctx;
  const [meldingen, setMeldingen, zetMeldingenUitAntwoord] = useCollectieState<Melding[]>([]);
  const [ongelezenMeldingen, setOngelezenMeldingen] = useState(0);
  // Actuele lijst voor markeerMeldingenGelezenVoorScherm zonder dat de
  // schermwissel-hook op elke meldingenwijziging opnieuw hoeft te vuren.
  const meldingenRef = useRef<Melding[]>([]);
  meldingenRef.current = meldingen;

  // Wacht op de DELETE: id → melding, met de timer die hem alsnog verstuurt.
  const wachtendRef = useRef(new Map<string, { melding: Melding; timer: ReturnType<typeof setTimeout> }>());

  const stuurVerwijdering = async (ids: string[], opties?: { keepalive?: boolean }) => {
    if (ids.length === 0) return;
    try {
      await apiFetch('/api/meldingen', {
        method: 'DELETE',
        body: JSON.stringify({ ids }),
        ...(opties?.keepalive ? { keepalive: true } : {}),
      });
    } catch (error) {
      // Mislukt het, dan staat de melding er bij de volgende refetch gewoon
      // weer: vervelend, maar niets is stil verdwenen.
      console.error('Melding verwijderen is mislukt:', error);
    }
  };

  // Tabblad dicht met een wis nog in de wacht: alsnog versturen (keepalive
  // laat het verzoek de pagina overleven). Anders stond de melding er na een
  // herstart weer, terwijl de gebruiker hem had weggeveegd.
  useEffect(() => {
    const flush = () => {
      const wachtend = wachtendRef.current;
      if (wachtend.size === 0) return;
      const ids = [...wachtend.keys()];
      for (const { timer } of wachtend.values()) clearTimeout(timer);
      wachtend.clear();
      void stuurVerwijdering(ids, { keepalive: true });
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fetchMeldingen = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/meldingen', { accessToken });
      if (!response.ok) return;
      ctx.noteerAntwoord(response);
      const data = await response.json();
      // Vorm: { meldingen, ongelezen }. Een kale lijst (oude server, mock)
      // tellen we zelf.
      const rauw: Melding[] = Array.isArray(data) ? data : Array.isArray(data?.meldingen) ? data.meldingen : [];
      // Een wis die nog in de ongedaan-termijn zit staat bij de server nog
      // gewoon in de tabel: zonder dit filter kwam hij bij elke realtime-
      // refetch terug in de lijst die hem net zag verdwijnen.
      const wachtend = wachtendRef.current;
      const lijst = wachtend.size > 0 ? rauw.filter((m) => !wachtend.has(m.id)) : rauw;
      // Lijst en teller komen uit hetzelfde antwoord: gelijk antwoord = beide
      // laten staan. Lokaal "gelezen" markeren gaat via setMeldingen en maakt
      // de afdruk ongeldig, dus de server-waarheid komt daarna altijd terug.
      if (zetMeldingenUitAntwoord(response, data, lijst)) {
        setOngelezenMeldingen(
          // Telt de server mee, dan telt hij de wachtende rijen ook mee: dan
          // liever zelf tellen, anders blijft de bel op 1 staan.
          wachtend.size > 0 || typeof data?.ongelezen !== 'number'
            ? lijst.filter((m) => !m.gelezenOp).length
            : data.ongelezen,
        );
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

  /**
   * Verwijderen met een weg terug: de melding gaat meteen uit de lijst en de
   * DELETE vertrekt pas na `wachtMs` (de duur van de ongedaan-toast plus wat
   * marge). Geeft `false` als het id niet in de lijst staat, zodat de toast
   * niet verschijnt voor iets dat er niet was.
   */
  const verwijderMelding = (id: string, wachtMs: number): boolean => {
    const melding = meldingenRef.current.find((m) => m.id === id);
    if (!melding || wachtendRef.current.has(id)) return false;
    setMeldingen((prev) => prev.filter((m) => m.id !== id));
    if (!melding.gelezenOp) setOngelezenMeldingen((prev) => Math.max(0, prev - 1));
    const timer = setTimeout(() => {
      wachtendRef.current.delete(id);
      void stuurVerwijdering([id]);
    }, wachtMs);
    wachtendRef.current.set(id, { melding, timer });
    return true;
  };

  /** "Ongedaan maken": timer weg, melding terug op zijn plaats in de lijst. */
  const herstelMelding = (id: string) => {
    const wachtend = wachtendRef.current.get(id);
    if (!wachtend) return;
    clearTimeout(wachtend.timer);
    wachtendRef.current.delete(id);
    setMeldingen((prev) => (
      prev.some((m) => m.id === id)
        ? prev
        : [...prev, wachtend.melding].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    ));
    if (!wachtend.melding.gelezenOp) setOngelezenMeldingen((prev) => prev + 1);
  };

  const resetMeldingen = () => {
    for (const { timer } of wachtendRef.current.values()) clearTimeout(timer);
    wachtendRef.current.clear();
    setMeldingen([]);
    setOngelezenMeldingen(0);
  };

  return { meldingen, ongelezenMeldingen, fetchMeldingen, markeerMeldingenGelezen, markeerMeldingenGelezenVoorScherm, verwijderMelding, herstelMelding, resetMeldingen };
}
