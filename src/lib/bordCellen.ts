import { useEffect, useState } from 'react';
import { useOptioneleAppData } from '../app/AppDataContext';
import { fetchMonthPlanning } from './monthPlanning';
import type { BordCellen } from './vervangers';

/** Eén laadbeurt: waarvoor ze gold en wat ze per maand opleverde (null = mislukt). */
export type BordLading = { sleutel: readonly unknown[]; perMaand: Record<string, BordCellen | null> };

/**
 * Het bord van een dag uit de laatste laadbeurt: de cellen, `null` als het
 * laden mislukte, `undefined` zolang het bord voor déze vraag (maanden,
 * planning, ruilen) nog niet binnen is. Een laadbeurt voor een andere vraag
 * telt niet: cellen van een vorige maand of van vóór een wissel blijven nooit
 * staan terwijl de nieuwe laden.
 */
export const leesBord = (lading: BordLading | null, sleutel: readonly unknown[], datum: string): BordCellen | null | undefined =>
  lading && sleutel.every((v, i) => v === lading.sleutel[i])
    ? lading.perMaand[datum.slice(0, 7)]
    : undefined;

/**
 * De bordcellen van de maanden waarin `datums` vallen, voor de
 * vervangerlijsten (Ziekte, dashboard, Openstaande diensten). Dezelfde bron
 * als de Maandplanning (/api/month-planning): de matrixcel met de
 * doorgevoerde ruilen en afwezigheden erover. Wie via een wissel een
 * schoolrit kreeg staat daar met die rit, wie zijn dienst afgaf staat er vrij
 * (controle 29-09); de rauwe matrix toont dat allebei niet.
 *
 * Per dag: de cellen, `null` als het laden mislukte (`vrijOpDatum` valt dan
 * terug op de matrixregel), of `undefined` zolang het bord laadt. Tot dan
 * toont de lijst geen kandidaten: leeg mag nooit "nog niet geladen" betekenen.
 * Laadt opnieuw na elke wijziging van de planning of de ruilen in de datalaag.
 */
export function useBordCellen(datums: string[]): (datum: string) => BordCellen | null | undefined {
  const data = useOptioneleAppData();
  const maanden = [...new Set(datums.map((d) => d.slice(0, 7)))].sort().join();
  const sleutel = [maanden, data?.shifts, data?.swaps];
  const [lading, setLading] = useState<BordLading | null>(null);
  useEffect(() => {
    if (!maanden) return;
    let weg = false;
    const lijst = maanden.split(',');
    // Alleen een antwoord met cellen telt; al het andere is "mislukt".
    void Promise.all(lijst.map((maand) => fetchMonthPlanning(maand).then((mp) => mp?.cells || null, () => null)))
      .then((uit) => { if (!weg) setLading({ sleutel, perMaand: Object.fromEntries(lijst.map((maand, i) => [maand, uit[i]])) }); });
    return () => { weg = true; };
  }, sleutel);
  return (datum) => leesBord(lading, sleutel, datum);
}
