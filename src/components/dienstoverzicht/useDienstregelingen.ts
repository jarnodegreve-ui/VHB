import { useCallback, useEffect, useState } from 'react';
import type { Dienstregeling, Service } from '../../types';
import { haalDienstregelingen, haalVersieDiensten } from '../../lib/dienstregelingen';
import { vandaagBrussel } from '../../lib/brussel';

/**
 * De dienstregelingversies van het Dienstoverzicht (fase 1, 08-10): de lijst
 * van versies, de gekozen versie en, voor een andere versie dan die van
 * vandaag, haar diensten mét revisie. De versie van vandaag is de gewone
 * collectie `services` van de app; die blijft buiten deze hook.
 *
 * Mislukt het laden van de versies (oudere server, geen tabel), dan toont
 * het scherm gewoon de lijst van vandaag zonder versiebalk: de versies zijn
 * een laag erbovenop, nooit een voorwaarde om het dienstoverzicht te zien.
 */
export type VersieDienstenStaat = { versieId: string; services: Service[]; revisie: string | null } | null;

export function useDienstregelingen() {
  const [versies, setVersies] = useState<Dienstregeling[] | null>(null);
  const [vandaag, setVandaag] = useState(vandaagBrussel());
  const [gekozenId, setGekozenId] = useState<string | null>(null);
  const [versieDiensten, setVersieDiensten] = useState<VersieDienstenStaat>(null);
  const [laden, setLaden] = useState(false);
  const [fout, setFout] = useState<string | null>(null);

  const laadVersies = useCallback(async () => {
    try {
      const r = await haalDienstregelingen();
      // Een oudere server of een nep-antwoord (e2e) zonder lijst: geen versies.
      const lijst = Array.isArray(r?.versies) ? r.versies : [];
      setVersies(lijst);
      if (typeof r?.vandaag === 'string' && r.vandaag) setVandaag(r.vandaag);
      return lijst;
    } catch (err) {
      console.warn('Dienstregelingversies laden mislukte:', err);
      setVersies([]);
      return [] as Dienstregeling[];
    }
  }, []);

  useEffect(() => { void laadVersies(); }, [laadVersies]);

  const huidig = versies?.find((v) => v.status === 'huidig') ?? null;
  const gekozen = (gekozenId ? versies?.find((v) => v.id === gekozenId) : null) ?? huidig;
  const isHuidig = !gekozen || gekozen.id === huidig?.id;

  // De diensten van een andere versie dan die van vandaag.
  const laadVersieDiensten = useCallback(async (versieId: string) => {
    setLaden(true);
    setFout(null);
    try {
      const r = await haalVersieDiensten(versieId);
      setVersieDiensten({ versieId, services: r.services, revisie: r.revisie });
    } catch (err) {
      setFout(err instanceof Error ? err.message : 'De versie kon niet geladen worden.');
    } finally {
      setLaden(false);
    }
  }, []);

  useEffect(() => {
    if (!gekozen || isHuidig) { setVersieDiensten(null); return; }
    void laadVersieDiensten(gekozen.id);
  }, [gekozen, isHuidig, laadVersieDiensten]);

  const herlaadDiensten = useCallback(async () => {
    if (gekozen && !isHuidig) await laadVersieDiensten(gekozen.id);
  }, [gekozen, isHuidig, laadVersieDiensten]);

  /** De versie vóór de gekozen (op datum), voor de vergelijking. */
  const vorige = gekozen && versies
    ? [...versies].filter((v) => v.geldigVanaf < gekozen.geldigVanaf).sort((a, b) => b.geldigVanaf.localeCompare(a.geldigVanaf))[0] ?? null
    : null;

  return {
    versies, vandaag, huidig, gekozen, isHuidig, vorige,
    kies: setGekozenId,
    laadVersies,
    /** Diensten van de gekozen versie (null zolang het de versie van vandaag is). */
    versieDiensten: versieDiensten && gekozen && versieDiensten.versieId === gekozen.id ? versieDiensten : null,
    laden, fout, herlaadDiensten,
  };
}

export type DienstregelingenStaat = ReturnType<typeof useDienstregelingen>;
