import { useEffect, useState } from 'react';
import { useOptioneleAppData } from '../app/AppDataContext';
import { fetchMonthPlanning } from './monthPlanning';
import type { BordCellen } from './vervangers';

/**
 * De bordcellen van de maanden waarin `datums` vallen, voor de
 * vervangerlijsten (Ziekte, dashboard, Openstaande diensten). Dezelfde bron
 * als de Maandplanning (/api/month-planning): de matrixcel met de
 * doorgevoerde ruilen en afwezigheden erover. Wie via een wissel een
 * schoolrit kreeg staat daar met die rit, wie zijn dienst afgaf staat er vrij
 * (controle 29-09); de rauwe matrix toont dat allebei niet.
 *
 * Geeft per dag de cellen, of `undefined` zolang de maand niet geladen is of
 * het laden mislukte: `vrijOpDatum` valt dan terug op de matrixregel. Laadt
 * opnieuw na elke wijziging van de planning of de ruilen in de datalaag.
 */
export function useBordCellen(datums: string[]): (datum: string) => BordCellen | undefined {
  const data = useOptioneleAppData();
  const maanden = [...new Set(datums.map((d) => d.slice(0, 7)))].sort().join();
  const [perMaand, setPerMaand] = useState<Record<string, BordCellen | undefined>>({});
  useEffect(() => {
    let weg = false;
    for (const maand of maanden ? maanden.split(',') : []) {
      fetchMonthPlanning(maand)
        // Alleen een echt antwoord telt; al het andere is "niet geladen".
        .then((mp) => (mp && !Array.isArray(mp) && mp.cells ? mp.cells : undefined), () => undefined)
        .then((cellen) => { if (!weg) setPerMaand((cur) => ({ ...cur, [maand]: cellen })); });
    }
    return () => { weg = true; };
  }, [maanden, data?.shifts, data?.swaps]);
  return (datum) => perMaand[datum.slice(0, 7)];
}
