/**
 * Aantal dagen met dienst in een lijst planning-rijen. De planning bevat één
 * rij per dienst-DEEL (een gesplitste dienst zoals 2109 met 06:53-08:23 en
 * 13:10-19:15 = twee rijen), dus `shifts.length` telt delen, geen dagen.
 * Melding Jarno 14-09: het dashboard van een chauffeur toonde "27 diensten
 * ingepland" waar hij 15 dagen reed; de bedoeling is dagen met dienst tellen
 * (twee diensten op één dag = één dag).
 */
export const telDienstdagen = (shifts: Array<{ driverId?: string; date: string }>): number => {
  const dagen = new Set<string>();
  for (const s of shifts) dagen.add(`${String(s.driverId ?? '')}|${s.date}`);
  return dagen.size;
};

/**
 * Aantal diensten (niet delen, niet dagen): een gesplitste dienst (zelfde
 * chauffeur, dag en dienstnummer in meerdere rijen) telt één keer; twee
 * verschillende dienstnummers op één dag tellen wél als twee.
 */
export const telDiensten = (shifts: Array<{ driverId?: string; date: string; line?: string | number }>): number => {
  const diensten = new Set<string>();
  for (const s of shifts) diensten.add(`${String(s.driverId ?? '')}|${s.date}|${String(s.line ?? '').trim()}`);
  return diensten.size;
};
