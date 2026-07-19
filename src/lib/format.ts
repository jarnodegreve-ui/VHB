/**
 * Eén gedeelde datum-weergave voor het hele portaal: "vr 18 juli" (of met
 * jaartal als de datum niet in het huidige jaar valt). Chauffeurs zagen op
 * verschillende schermen drie formaten door elkaar, incl. rauw ISO
 * ("2026-07-18") — dit is de enige plek die daarover beslist.
 */
/**
 * Datum + tijd in Belgische tijd ("vr 18 juli, 14:32"). Verwacht een
 * ISO-timestamp; oudere niet-ISO-waarden (bv. al opgeslagen nl-BE-strings)
 * worden ongewijzigd teruggegeven.
 */
export function formatDateTimeHuman(value: string | undefined | null): string {
  if (!value) return '';
  const s = String(value);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  try {
    return d.toLocaleString('nl-BE', {
      timeZone: 'Europe/Brussels',
      weekday: 'short',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return s;
  }
}

export function formatDateHuman(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  try {
    return d.toLocaleDateString('nl-BE', {
      weekday: 'short',
      day: 'numeric',
      month: 'long',
      ...(sameYear ? {} : { year: 'numeric' }),
    });
  } catch {
    return String(iso);
  }
}

/** Compact dag-label 'vr 18 jul' (weekdag + dag + korte maand) uit een
 *  'YYYY-MM-DD'-string. Eén gedeelde vorm zodat lijsten die datums naast
 *  elkaar tonen (dienstruil, dekking) er niet uit elkaar lopen. */
export function formatShortDay(iso: string | undefined | null): string {
  if (!iso) return '';
  const d = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return String(iso);
  try {
    return d.toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' });
  } catch {
    return String(iso);
  }
}
