import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal, SluitKnop } from './Modal';
import { Formulier } from './Formulier';
import { ModalHeader } from './ui';
import { Button, IconButton, MicroLabel } from './primitives';
import { Card } from './Card';
import { DateInput, Field, Input } from './Field';
import { apiFetch } from '../lib/api';
import { notify } from '../lib/ui';
import { useVeldfouten, useVuil } from '../lib/formulier';
import { meldSchrijffout } from '../lib/fouten';
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
  const fouten = useVeldfouten();
  const [bezig, setBezig] = useState(false);
  // Onbewaarde invoer (tranche 3A): sluiten vraagt eerst bevestiging. De
  // effect hieronder zet de waarden pas ná het openen; `geladen` telt dan op,
  // zodat de momentopname de geladen waarden neemt en niet de vorige.
  const [geladen, setGeladen] = useState(0);
  const { vuil } = useVuil({ standaard, periodes }, open, geladen);

  // Bij elk openen de actuele waarden overnemen; een geannuleerde bewerking
  // mag niet blijven hangen tot de volgende keer.
  useEffect(() => {
    if (!open) return;
    setStandaard(String(limieten.standaard));
    setPeriodes(limieten.periodes);
    fouten.wis();
    setGeladen((n) => n + 1);
  }, [open, limieten]);

  const nieuweId = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const voegToe = () => setPeriodes((cur) => [...cur, { id: nieuweId(), naam: '', van: '', tot: '', max: Number(standaard) || 0 }]);
  // Een rij wijzigen wist zijn eigen fout; van en tot samen, want de regel
  // "einddatum vóór startdatum" hangt aan tot maar hangt van beide af.
  const wijzig = (i: number, id: string, patch: Partial<VerlofLimietPeriode>) => {
    setPeriodes((cur) => cur.map((p) => (p.id === id ? { ...p, ...patch } : p)));
    for (const veld of Object.keys(patch)) {
      fouten.wisVeld(`periodes.${i}.${veld}`);
      if (veld === 'van') fouten.wisVeld(`periodes.${i}.tot`);
    }
  };
  // Verwijderen verschuift de rijnummers: de oude veldfouten kloppen dan niet meer.
  const verwijder = (id: string) => { setPeriodes((cur) => cur.filter((p) => p.id !== id)); fouten.wis(); };
  const periodeFout = (i: number, veld: string) => fouten.fouten[`periodes.${i}.${veld}`];
  // Fouten die bij geen enkel veld horen (bv. te veel periodes): één regel.
  const VELDEN = /^(standaard|periodes\.\d+\.(naam|van|tot|max))$/;
  const overig = Object.entries(fouten.fouten).filter(([k]) => !VELDEN.test(k)).map(([, t]) => t);

  const opslaan = async () => {
    if (bezig) return;
    const data = fouten.controleer(verlofLimietenSchema, { standaard: Number(standaard), periodes });
    if (!data) return;
    setBezig(true);
    try {
      const res = await apiFetch('/api/verlof/limieten', {
        method: 'PUT',
        body: JSON.stringify({ standaard: data.standaard, periodes: sorteerPeriodes(data.periodes) }),
      });
      const antwoord: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 400 && fouten.vanServer(antwoord)) return;
        // Hele instelling in één PUT = idempotent: opnieuw proberen mag.
        meldSchrijffout('Opslaan', { status: res.status, message: (antwoord as { error?: string } | null)?.error }, () => void opslaan());
        return;
      }
      onSaved(antwoord as VerlofLimieten);
      notify('Verloflimieten opgeslagen, de kalender kleurt er meteen naar.', 'success');
      onClose();
    } catch (err) {
      meldSchrijffout('Opslaan', err, () => void opslaan());
    } finally {
      setBezig(false);
    }
  };

  return (
<Modal open={open} onClose={onClose} vuil={vuil} maxWidth="lg" className="flex max-h-overlay flex-col !overflow-hidden !p-0">
      <ModalHeader
        title="Verloflimieten"
        description="Hoeveel chauffeurs mogen tegelijk vrij zijn? De kalender toont een dag als volzet zodra dat aantal bereikt is. Flexi-jobs en techniekers tellen niet mee."
        onClose={onClose}
      />
      <Formulier onVerstuur={opslaan} noValidate className="flex-1 space-y-6 overflow-y-auto p-8">
        <Field label="Standaard (buiten de periodes hieronder)" hint="Bijvoorbeeld 2 in een gewone schoolweek." error={fouten.fouten.standaard}>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={200}
            value={standaard}
            onChange={(e) => { setStandaard(e.target.value); fouten.wisVeld('standaard'); }}
            className="max-w-[8rem] tabular-nums"
          />
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
                      <Field label="Naam" error={periodeFout(i, 'naam')}>
                        <Input value={p.naam} placeholder="Zomervakantie" onChange={(e) => wijzig(i, p.id, { naam: e.target.value })} />
                      </Field>
                    </div>
                    <IconButton label={`Periode ${p.naam || i + 1} verwijderen`} variant="danger" onClick={() => verwijder(p.id)}>
                      <Trash2 size={16} />
                    </IconButton>
                  </div>
                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_5rem] gap-3">
                    <Field label="Van" error={periodeFout(i, 'van')}>
                      <DateInput value={p.van} onChange={(v) => wijzig(i, p.id, { van: v })} />
                    </Field>
                    <Field label="Tot" error={periodeFout(i, 'tot')}>
                      <DateInput value={p.tot} min={p.van || undefined} onChange={(v) => wijzig(i, p.id, { tot: v })} />
                    </Field>
                    <Field label="Max." error={periodeFout(i, 'max')}>
                      <Input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={200}
                        value={String(p.max)}
                        onChange={(e) => wijzig(i, p.id, { max: Number(e.target.value) })}
                        className="tabular-nums"
                      />
                    </Field>
                  </div>
                </Card>
              ))}
            </div>
          )}
          <p className="text-xs text-slate-500">Overlappen twee periodes, dan telt de vroegst beginnende.</p>
        </div>

        {overig.length > 0 && (
          // tabIndex 0: zo vindt focusEersteFout de melding, er is geen veld om naar te springen.
          <div data-fout="" role="alert" className="text-xs font-medium text-red-700">
            <div tabIndex={0} className="rounded-md outline-offset-2">{overig.map((t) => <p key={t}>{t}</p>)}</div>
          </div>
        )}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <SluitKnop onClose={onClose} variant="secondary" size="lg" disabled={bezig}>Annuleren</SluitKnop>
          <Button type="submit" variant="primary" size="lg" bezig={bezig}>Opslaan</Button>
        </div>
      </Formulier>
    </Modal>
  );
}
