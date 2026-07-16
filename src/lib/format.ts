/**
 * Eén gedeelde datum-weergave voor het hele portaal: "vr 18 juli" (of met
 * jaartal als de datum niet in het huidige jaar valt). Chauffeurs zagen op
 * verschillende schermen drie formaten door elkaar, incl. rauw ISO
 * ("2026-07-18") — dit is de enige plek die daarover beslist.
 */
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
