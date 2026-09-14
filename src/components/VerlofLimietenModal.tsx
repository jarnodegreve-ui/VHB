import React, { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from './Modal';
import { ModalHeader } from './ui';
import { Button, IconButton, MicroLabel } from './primitives';
import { Card } from './Card';
import { DateInput, Field, Input } from './Field';
import { apiJson } from '../lib/api';
import { notify } from '../lib/ui';
import { valideer } from '../../shared/schemas/basis';
import { sorteerPeriodes, verlofLimietenSchema, type VerlofLimieten, type VerlofLimietPeriode } from '../../shared/schemas/verlofLimieten';

/**
 * Verloflimieten instellen (verzoek Jarno 09-09): hoeveel chauffeurs er
 * tegelijk vrij mogen zijn. Een standaardwaarde voor gewone weken plus
 * uitzonderingsperiodes met een eigen maximum, want in de zomervakantie kan
 * er meer dan in een schoolperiode. Alleen voor admins; de verlofkalender
 * kleurt er meteen naar (vrij / deels vrij / volzet).
 */
export function VerlofLimietenModal({ open, onClose, limieten, onSaved }: {
  open: boolean;
  onClose: () => void;
  limieten: VerlofLimieten;
  onSaved: (limieten: VerlofLimieten) => void;
}) {
  const [standaard, setStandaard] = useState(String(limieten.standaard));
  const [periodes, setPeriodes] = useState<VerlofLimietPeriode[]>(limieten.periodes);
  const [fout, setFout] = useState('');
  const [bezig, setBezig] = useState(false);

  // Bij elk openen de actuele waarden overnemen; een geannuleerde bewerking
  // mag niet blijven hangen tot de volgende keer.
  useEffect(() => {
    if (!open) return;
    setStandaard(String(limieten.standaard));
    setPeriodes(limieten.periodes);
    setFout('');
  }, [open, limieten]);

  const nieuweId = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const voegToe = () => setPeriodes((cur) => [...cur, { id: nieuweId(), naam: '', van: '', tot: '', max: Number(standaard) || 0 }]);
  const wijzig = (id: string, patch: Partial<VerlofLimietPeriode>) => setPeriodes((cur) => cur.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const verwijder = (id: string) => setPeriodes((cur) => cur.filter((p) => p.id !== id));

  const opslaan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (bezig) return;
    const uitkomst = valideer(verlofLimietenSchema, { standaard: Number(standaard), periodes });
    if (uitkomst.ok === false) {
      const [veld, tekst] = Object.entries(uitkomst.fouten)[0] ?? ['', 'Controleer de invoer.'];
      // Veldpad als "periodes.1.tot" → "periode 2, einddatum" zodat de admin
      // weet welke rij het is.
      const m = /^periodes\.(\d+)\.(\w+)$/.exec(veld);
      const naam: Record<string, string> = { naam: 'naam', van: 'startdatum', tot: 'einddatum', max: 'maximum' };
      setFout(m ? `Periode ${Number(m[1]) + 1}, ${naam[m[2]] ?? m[2]}: ${tekst}` : `${veld === 'standaard' ? 'Standaard: ' : ''}${tekst}`);
      return;
    }
    setFout('');
    setBezig(true);
    try {
      const bewaard = await apiJson<VerlofLimieten>('/api/verlof/limieten', {
        method: 'PUT',
        body: JSON.stringify({ standaard: uitkomst.data.standaard, periodes: sorteerPeriodes(uitkomst.data.periodes) }),
      });
      onSaved(bewaard);
      notify('Verloflimieten opgeslagen, de kalender kleurt er meteen naar.', 'success');
      onClose();
    } catch (err) {
      setFout(err instanceof Error ? err.message : 'Opslaan is mislukt.');
    } finally {
      setBezig(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="lg" className="flex max-h-[88dvh] flex-col !overflow-hidden !p-0">
      <ModalHeader
        title="Verloflimieten"
        description="Hoeveel chauffeurs mogen tegelijk vrij zijn? De kalender toont een dag als volzet zodra dat aantal bereikt is. Flexi-jobs en techniekers tellen niet mee."
        onClose={onClose}
      />
      <form onSubmit={opslaan} className="flex-1 space-y-6 overflow-y-auto p-8">
        <Field label="Standaard (buiten de periodes hieronder)" hint="Bijvoorbeeld 2 in een gewone schoolweek.">
          {({ id }) => (
            <Input
              id={id}
              type="number"
              inputMode="numeric"
              min={0}
              max={200}
              value={standaard}
              onChange={(e) => setStandaard(e.target.value)}
              className="max-w-[8rem] tabular-nums"
            />
          )}
        </Field>

        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <MicroLabel>Uitzonderingsperiodes</MicroLabel>
            <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={voegToe}>Periode toevoegen</Button>
          </div>
          {periodes.length === 0 ? (
            <Card tone="muted" padding="sm" className="text-sm text-slate-500">
              Nog geen periodes. Voeg bijvoorbeeld de zomervakantie toe met een hoger maximum.
            </Card>
          ) : (
            <div className="space-y-2">
              {periodes.map((p, i) => (
                <Card key={p.id} padding="sm" className="space-y-3">
                  {/* Twee rijen: naam + verwijderen, daaronder de datums en het
                      maximum. Vijf kolommen naast elkaar drukten de naam plat. */}
                  <div className="flex items-end gap-3">
                    <div className="min-w-0 flex-1">
                      <Field label="Naam">
                        {({ id }) => <Input id={id} value={p.naam} placeholder="Zomervakantie" onChange={(e) => wijzig(p.id, { naam: e.target.value })} />}
                      </Field>
                    </div>
                    <IconButton label={`Periode ${p.naam || i + 1} verwijderen`} variant="danger" onClick={() => verwijder(p.id)}>
                      <Trash2 size={16} />
                    </IconButton>
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5rem] gap-3">
                    <Field label="Van">
                      {({ id }) => <DateInput id={id} value={p.van} onChange={(v) => wijzig(p.id, { van: v })} />}
                    </Field>
                    <Field label="Tot">
                      {({ id }) => <DateInput id={id} value={p.tot} min={p.van || undefined} onChange={(v) => wijzig(p.id, { tot: v })} />}
                    </Field>
                    <Field label="Max.">
                      {({ id }) => (
                        <Input
                          id={id}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={200}
                          value={String(p.max)}
                          onChange={(e) => wijzig(p.id, { max: Number(e.target.value) })}
                          className="tabular-nums"
                        />
                      )}
                    </Field>
                  </div>
                </Card>
              ))}
            </div>
          )}
          <p className="text-xs text-slate-500">Overlappen twee periodes, dan telt de vroegst beginnende.</p>
        </div>

        {fout && <p role="alert" className="text-xs font-medium text-red-700">{fout}</p>}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" size="lg" onClick={onClose}>Annuleren</Button>
          <Button type="submit" variant="primary" size="lg" disabled={bezig}>{bezig ? 'Opslaan…' : 'Opslaan'}</Button>
        </div>
      </form>
    </Modal>
  );
}
