/**
 * Eén record uit de URL halen (tranche 3C, Deeplinks V1, 23-09).
 *
 * `/verlof/<id>` en `/dienstruil/<id>` wijzen naar één record. Een scherm
 * zoekt dat record alleen in wat de server hem al gaf: GET /api/leave en
 * GET /api/swaps filteren per gebruiker, dus een record waar je geen recht op
 * hebt staat er nooit in. "Bestaat niet", "verwijderd" en "geen toegang"
 * zijn daardoor voor de client één en dezelfde toestand, `onbekend`, en de
 * melding daarvoor verraadt dus ook niet of het record bestaat.
 *
 * Zolang de collectie nog laadt is er niets te zeggen (`wacht`): leeg mag nooit
 * "niet gevonden" betekenen.
 */
export type RecordLink<T> =
  | { staat: 'geen' }
  | { staat: 'wacht'; id: string }
  | { staat: 'gevonden'; id: string; record: T }
  | { staat: 'onbekend'; id: string };

export function bepaalRecordLink<T extends { id: string | number }>(
  id: string | null | undefined,
  records: readonly T[],
  geladen: boolean,
): RecordLink<T> {
  if (!id) return { staat: 'geen' };
  if (!geladen) return { staat: 'wacht', id };
  const record = records.find((r) => String(r.id) === id);
  return record ? { staat: 'gevonden', id, record } : { staat: 'onbekend', id };
}

/**
 * Het record van een rij in beeld brengen en de focus erop zetten, één keer
 * per id. De rij draagt `data-record="<id>"` (RecordRij `titelAttrs` of een
 * eigen attribuut); de focus gaat naar de knop van die rij, zodat Tab en een
 * schermlezer verder vanaf het record werken.
 */
export function brengRecordInBeeld(id: string): boolean {
  if (typeof document === 'undefined') return false;
  const el = document.querySelector<HTMLElement>(`[data-record="${CSS.escape(id)}"]`);
  if (!el) return false;
  el.scrollIntoView({ block: 'center' });
  const knop = el.closest<HTMLElement>('button, a, [tabindex]') ?? el;
  knop.focus({ preventScroll: true });
  return true;
}
