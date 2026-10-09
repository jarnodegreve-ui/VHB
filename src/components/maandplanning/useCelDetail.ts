import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { notify } from '../../lib/ui';
import { meldSchrijffout } from '../../lib/fouten';
import type { MonthCell } from '../../lib/monthPlanning';
import { noteKey, type Chauffeur, type GekozenCel } from '../../lib/maandplanning';

/**
 * Het celdetail van de Maandplanning: de geopende cel en de dienstnotities
 * van de zichtbare maand (laden, concept, opslaan of verwijderen). Verplaatst
 * uit CapacityView.tsx op 09-10 (stap 3 van de splitsing), byte voor byte
 * dezelfde toestand en schrijfactie; het gedrag ligt vast in
 * useCelDetail.test.tsx. De dienstwissel op dezelfde cel staat in
 * useDienstwissel.ts en krijgt `selected` en `sluit` van hier.
 */
export function useCelDetail({ monthFrom, monthTo }: { monthFrom: string; monthTo: string }) {
  const [selected, setSelected] = useState<GekozenCel | null>(null);

  // Dienstnotities voor de zichtbare maand. Chauffeurs krijgen server-side
  // alleen hun eigen notities; planners alles.
  const [notes, setNotes] = useState<Map<string, string>>(new Map());
  const loadNotes = async () => {
    try {
      const res = await apiFetch(`/api/planning-notes?from=${monthFrom}&to=${monthTo}`);
      if (!res.ok) return;
      const data = await res.json();
      if (Array.isArray(data)) setNotes(new Map(data.map((n: any) => [noteKey(String(n.driverId), n.date), String(n.note)])));
    } catch { /* notities zijn nice-to-have */ }
  };
  useEffect(() => { void loadNotes(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [monthFrom]);

  const [noteDraft, setNoteDraft] = useState('');
  const [isSavingNote, setIsSavingNote] = useState(false);
  const saveNote = async () => {
    if (!selected || isSavingNote) return;
    setIsSavingNote(true);
    try {
      const res = await apiFetch('/api/planning-notes', {
        method: 'PUT',
        body: JSON.stringify({ driverId: selected.driverId, date: selected.iso, note: noteDraft }),
      });
      const body = await res.json().catch(() => ({} as any));
      // PUT per chauffeur en dag: opnieuw proberen is veilig.
      if (!res.ok) { meldSchrijffout('Notitie opslaan', { status: res.status, message: body.error }, () => void saveNote()); return; }
      setNotes((cur) => {
        const next = new Map(cur);
        const trimmed = noteDraft.trim();
        if (trimmed) next.set(noteKey(selected.driverId, selected.iso), trimmed);
        else next.delete(noteKey(selected.driverId, selected.iso));
        return next;
      });
      notify(noteDraft.trim() ? 'Notitie opgeslagen, de chauffeur krijgt een melding.' : 'Notitie verwijderd.', 'success');
      setSelected(null);
    } catch (err) {
      meldSchrijffout('Notitie opslaan', err, () => void saveNote());
    } finally {
      setIsSavingNote(false);
    }
  };

  // Tik op een cel (desktopraster of daglijst): het detailvenster open, met
  // de bestaande notitie van die chauffeur en dag als concept.
  const open = (drv: Chauffeur, iso: string, cell: MonthCell) => {
    setSelected({ driverName: drv.name, driverId: String(drv.id), iso, cell });
    setNoteDraft(notes.get(noteKey(String(drv.id), iso)) ?? '');
  };
  const sluit = () => setSelected(null);

  return { selected, open, sluit, notes, noteDraft, setNoteDraft, isSavingNote, saveNote };
}

export type CelDetail = ReturnType<typeof useCelDetail>;
