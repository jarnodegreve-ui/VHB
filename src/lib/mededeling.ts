import { useEffect, useState } from 'react';
import { GEEN_MEDEDELING, mededelingZichtbaar, parseMededeling, type Mededeling } from '../../shared/mededeling';
import { apiFetch } from './api';
import { vandaagBrussel } from './brussel';

/**
 * De mededeling voor de chauffeurs in de browser (08-10): één ophaling per
 * tien minuten, gedeeld door Ritbladen, Mijn dag en het dashboard, en nooit
 * een foutmelding: zonder antwoord is er gewoon geen strook. Een save door
 * de beheerder zet de nieuwe waarde meteen lokaal (zetMededelingLokaal),
 * zodat zijn eigen schermen niet tien minuten achterlopen.
 */
const VERS_MS = 10 * 60 * 1000;
let bewaard: { waarde: Mededeling; op: number } | null = null;
let onderweg: Promise<Mededeling> | null = null;
const luisteraars = new Set<(m: Mededeling) => void>();

const meld = (m: Mededeling) => { for (const l of luisteraars) l(m); };

export async function haalMededeling(opties: { vers?: boolean } = {}): Promise<Mededeling> {
  if (!opties.vers && bewaard && Date.now() - bewaard.op < VERS_MS) return bewaard.waarde;
  if (!onderweg) {
    onderweg = (async () => {
      try {
        const res = await apiFetch('/api/mededeling', { cache: 'no-store' });
        if (!res.ok) return bewaard?.waarde ?? GEEN_MEDEDELING;
        const m = parseMededeling(await res.json());
        bewaard = { waarde: m, op: Date.now() };
        meld(m);
        return m;
      } catch {
        return bewaard?.waarde ?? GEEN_MEDEDELING;
      } finally {
        onderweg = null;
      }
    })();
  }
  return onderweg;
}

/** Na een save door de beheerder: meteen de nieuwe waarde voor elk scherm. */
export function zetMededelingLokaal(m: Mededeling): void {
  bewaard = { waarde: m, op: Date.now() };
  meld(m);
}

/** Alleen voor tests. */
export const _resetMededeling = () => { bewaard = null; onderweg = null; };

/** De mededeling zoals ze nu te zien hoort te zijn, of null. */
export function useMededeling(): Mededeling | null {
  const [m, setM] = useState<Mededeling | null>(bewaard?.waarde ?? null);
  useEffect(() => {
    let actief = true;
    const l = (v: Mededeling) => { if (actief) setM(v); };
    luisteraars.add(l);
    void haalMededeling().then(l);
    return () => { actief = false; luisteraars.delete(l); };
  }, []);
  return m && mededelingZichtbaar(m, vandaagBrussel()) ? m : null;
}
