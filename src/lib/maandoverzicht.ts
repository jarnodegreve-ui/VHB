import type { OverzichtRij, OverzichtSortering } from './maandplanning';

/** Sorteerbare kolommen van het maandoverzicht (Overig sorteert niet). */
export const OVERZICHT_KOLOMMEN = [
  ['naam', 'Chauffeur'],
  ['diensten', 'Diensten'],
  ['minuten', 'Uren'],
  ['anderWerk', 'Ander werk'],
  ['ziek', 'Ziek'],
  ['betaald', 'Betaald afw.'],
  ['vrij', 'Vrij'],
  ['dagen', 'Dagen'],
] as const;

// Kopie van formatMinutenAlsUren (api/_lib/helpers.ts) — de client mag niet
// uit api/ importeren; houd het formaat gelijk.
export const urenLabel = (minuten: number) => `${Math.floor(minuten / 60)}:${String(Math.round(minuten) % 60).padStart(2, '0')}`;

/** De rijen in de gekozen volgorde; bij gelijke waarde op naam. */
export const sorteerOverzichtRijen = (rijen: OverzichtRij[], { kolom, richting }: OverzichtSortering): OverzichtRij[] =>
  [...rijen].sort((a, b) => {
    const va = a[kolom];
    const vb = b[kolom];
    const cmp = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
    return cmp * richting || a.naam.localeCompare(b.naam);
  });
