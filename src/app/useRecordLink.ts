import { useCallback, useMemo } from 'react';
import type { View } from '../types';
import { useRecordParam } from './router';
import { bepaalRecordLink, type RecordLink } from '../lib/recordLink';

/**
 * Het gedeelde mechanisme achter de record-URL's van tranche 3C
 * (`/verlof/<id>`, `/dienstruil/<id>`): het id staat in het eerste
 * pad-segment van de view (useRecordParam), het record komt uit de collectie
 * die de view al heeft. `open` en `sluit` vervangen de entry (een record
 * kiezen binnen het scherm is geen terugstap waard); wie van buiten linkt
 * (dashboard, Vandaag, meldingen) pusht met `navigeer(view, { params: [id] })`,
 * dus terug brengt je daar weer.
 */
export function useRecordLink<T extends { id: string | number }>(
  view: View,
  records: readonly T[],
  geladen = true,
): RecordLink<T> & { open: (id: string) => void; sluit: () => void } {
  const [id, zet] = useRecordParam(0, { view });
  const link = useMemo(() => bepaalRecordLink(id, records, geladen), [id, records, geladen]);
  const open = useCallback((nieuw: string) => zet(nieuw), [zet]);
  const sluit = useCallback(() => zet(null), [zet]);
  return { ...link, open, sluit };
}
