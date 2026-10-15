/**
 * Het venster van de dienstruilen (Jarno 15-10: het portaal moet klaar zijn
 * voor steeds meer data). `GET /api/swaps` geeft alleen wat open staat of de
 * laatste maanden raakt; al de rest is het archief, dat het scherm per
 * pagina opvraagt (`GET /api/swaps/archief`). Zo groeit de opstart niet met de
 * historiek mee, en de ruilen die het bord, het rooster en Mijn dag nodig
 * hebben (een doorgevoerde wissel van een dag die nog komt) zitten er altijd
 * in.
 *
 * Eén regel voor de query (api/_lib/opslag/ruilen.ts zet ze om in een filter),
 * het vangnet in de route en de testen. Alleen wat naar de app gaat volgt het
 * venster: de controles bij het goedkeuren (dubbele inplanning, rust, de
 * heropbouw) lezen nog altijd elke ruil.
 */

/** Hoeveel volle maanden vóór de huidige maand in het venster zitten. */
export const RUIL_VENSTER_MAANDEN = 3;

/** Wat nog een stap van iemand vraagt: altijd in het venster, hoe oud ook. */
export const OPEN_RUIL_STATUSSEN = ['pending', 'accepted', 'approved'] as const;

/**
 * De grens van het venster: de eerste dag van de maand, `maanden` maanden
 * vóór de maand van `vandaag` ('2026-10-15' → '2026-07-01'). Op een maandgrens,
 * zodat ze maar één keer per maand verschuift: een scherm dat vóór middernacht
 * laadde en erna opslaat, botst dan bijna nooit op een andere revisie.
 */
export function ruilVensterGrens(vandaag: string, maanden = RUIL_VENSTER_MAANDEN): string {
  const [jaar, maand] = vandaag.slice(0, 7).split('-').map(Number);
  const index = jaar * 12 + (maand - 1) - maanden;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`;
}

export type RuilVoorVenster = {
  status: string;
  createdAt?: string | null;
  shiftDate?: string | null;
  returnDate?: string | null;
};

/**
 * Hoort deze ruil in het venster? Open, of aangemaakt, of met een dienst of
 * tegenprestatie op of na de grens. ISO-teksten vergelijken als tekst
 * ('2026-07-01T08:00…' ≥ '2026-07-01'), net als de query.
 */
export function ruilInVenster(swap: RuilVoorVenster, grens: string): boolean {
  if ((OPEN_RUIL_STATUSSEN as readonly string[]).includes(String(swap.status))) return true;
  const vanafGrens = (waarde?: string | null) => !!waarde && String(waarde) >= grens;
  return vanafGrens(swap.createdAt) || vanafGrens(swap.shiftDate) || vanafGrens(swap.returnDate);
}

export type RuilVoorArchief = RuilVoorVenster & { id: string; decidedAt?: string | null };

/**
 * Volgorde van het archief, gelijk aan de query: het beslismoment, het
 * jongste eerst (zonder beslismoment achteraan), dan het aanmaakmoment en het
 * id. Afgehandeld op het scherm sorteert ook op het beslismoment.
 */
export const archiefVolgorde = (a: RuilVoorArchief, b: RuilVoorArchief): number => {
  const beslist = (r: RuilVoorArchief) => String(r.decidedAt ?? '');
  if (!beslist(a) !== !beslist(b)) return beslist(a) ? -1 : 1;
  return beslist(b).localeCompare(beslist(a))
    || String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? ''))
    || String(b.id).localeCompare(String(a.id));
};
