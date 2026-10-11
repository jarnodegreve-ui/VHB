import { useEffect, useState } from 'react';
import { apiJson } from './api';

/**
 * Het De Lijn-dagtype per dag voor elke rol (dagtypekalender deel 2, 11-10,
 * keuze Jarno): Mijn dag toont ermee waarom de tijden vandaag anders zijn
 * ("Vandaag · schoolvakantie"). Eén kleine lezing van GET /api/dagtypes,
 * dezelfde afleiding als het bord (matrixcode, kalender, dekking, weekdag).
 * Stil: zonder bereik of bij een fout blijft de regel gewoon weg.
 */
export type DagtypeInfo = { code: string; label: string; periode: string; bron: string };
export type DagtypesPerDag = Record<string, DagtypeInfo | null>;

/** Per gevraagd venster één keer per sessie: het dagtype van een dag verandert zelden. */
const cache = new Map<string, DagtypesPerDag>();

/** Woord voor onder de dagkop: "schooldag", "schoolvakantie", "feestdag".
 *  Leeg als het dagtype onbekend is of alleen op de weekdag berust (dan zegt
 *  het niets over de dienstregeling), en op zaterdag en zondag: "Zondag 11
 *  oktober · zondag" herhaalt alleen de weekdag. Een feestdag blijft staan. */
export const dagtypeWoord = (info: DagtypeInfo | null | undefined): string =>
  (info && info.bron !== 'weekdag' && info.code !== '26' && info.code !== '27' ? info.periode : '');

export function useDagtypes(van: string, tot: string): DagtypesPerDag {
  const sleutel = `${van}|${tot}`;
  const [dagtypes, setDagtypes] = useState<DagtypesPerDag>(() => cache.get(sleutel) ?? {});
  useEffect(() => {
    const bekend = cache.get(sleutel);
    if (bekend) { setDagtypes(bekend); return; }
    let actueel = true;
    apiJson<{ dagtypes?: DagtypesPerDag }>(`/api/dagtypes?van=${van}&tot=${tot}`)
      .then((r) => {
        if (!r || typeof r.dagtypes !== 'object' || r.dagtypes === null) return;
        cache.set(sleutel, r.dagtypes);
        if (actueel) setDagtypes(r.dagtypes);
      })
      .catch(() => { /* stil: de regel blijft weg */ });
    return () => { actueel = false; };
  }, [sleutel, van, tot]);
  return dagtypes;
}
