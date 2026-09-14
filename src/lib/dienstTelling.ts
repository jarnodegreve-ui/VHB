import { serviceNumberOf } from './format';

/**
 * Aantal diensten in een lijst planning-rijen. De planning bevat één rij per
 * dienst-DEEL (een gesplitste dienst zoals 2109 met 06:53-08:23 en
 * 13:10-19:15 = twee rijen), dus `shifts.length` telt delen, geen diensten.
 * Melding Jarno 14-09: het dashboard van een chauffeur toonde "27 diensten
 * ingepland" waar hij er 15 had. Eén dienst = één (chauffeur, dag,
 * dienstnummer), zelfde sleutel als de kaartgroepering in Mijn rooster en de
 * dedupe in openstaandeDienstenVanAfwezigen.
 */
export const telDiensten = (shifts: Array<{ driverId?: string; date: string; line?: string }>): number => {
  const sleutels = new Set<string>();
  for (const s of shifts) sleutels.add(`${String(s.driverId ?? '')}|${s.date}|${serviceNumberOf(s).toLowerCase()}`);
  return sleutels.size;
};
