import React, { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from './Modal';
import { ModalHeader } from './ui';
import { Button, IconButton, MicroLabel, Badge } from './primitives';
import { Card } from './Card';
import { DateInput, Field, Input } from './Field';
import { apiJson } from '../lib/api';
import { notify } from '../lib/ui';
import { formatShortDay } from '../lib/format';
import { feestdagenVanJaar } from '../lib/typedag';
import { valideer } from '../../shared/schemas/basis';
import { sorteerExtraFeestdagen, verlofFeestdagenSchema } from '../../shared/schemas/verlofFeestdagen';
import type { ExtraFeestdag } from '../../shared/feestdagen';

/**
 * Feestdagen (verzoek Jarno 10-09). De wettelijke Belgische feestdagen
 * berekent de app zelf en tellen nooit als verlofdag; daaronder houdt de
 * beheerder extra vrije dagen bij (brugdag, bedrijfssluiting) die dezelfde
 * regel volgen. Alleen voor admins; de verloftelling rekent er meteen mee.
 */
export function VerlofFeestdagenModal({ open, onClose, extra, onSaved }: {
  open: boolean;
  onClose: () => void;
  extra: ExtraFeestdag[];
  onSaved: (extra: ExtraFeestdag[]) => void;
}) {
  const [jaar, setJaar] = useState(new Date().getFullYear());
  const [lijst, setLijst] = useState<ExtraFeestdag[]>(extra);
  const [nieuwDatum, setNieuwDatum] = useState('');
  const [nieuwNaam, setNieuwNaam] = useState('');
  const [fout, setFout] = useState('');
  const [bezig, setBezig] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLijst(extra); setNieuwDatum(''); setNieuwNaam(''); setFout('');
  }, [open, extra]);

  const wettelijk = useMemo(() => Object.entries(feestdagenVanJaar(jaar)).sort(([a], [b]) => a.localeCompare(b)), [jaar]);
  const extraDitJaar = lijst.filter((d) => d.datum.startsWith(`${jaar}-`)).sort((a, b) => a.datum.localeCompare(b.datum));
  const nieuweId = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  const voegToe = () => {
    if (!nieuwDatum || !nieuwNaam.trim()) { setFout('Kies een datum en geef de dag een naam.'); return; }
    if (feestdagenVanJaar(Number(nieuwDatum.slice(0, 4)))[nieuwDatum]) { setFout('Die dag is al een wettelijke feestdag.'); return; }
    if (lijst.some((d) => d.datum === nieuwDatum)) { setFout('Die dag staat al in de lijst.'); return; }
    setLijst((cur) => sorteerExtraFeestdagen([...cur, { id: nieuweId(), datum: nieuwDatum, naam: nieuwNaam.trim() }]));
    setNieuwDatum(''); setNieuwNaam(''); setFout('');
  };
  const verwijder = (id: string) => setLijst((cur) => cur.filter((d) => d.id !== id));

  const opslaan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (bezig) return;
    const uitkomst = valideer(verlofFeestdagenSchema, { extra: lijst });
    if (uitkomst.ok === false) {
      const [, tekst] = Object.entries(uitkomst.fouten)[0] ?? ['', 'Controleer de invoer.'];
      setFout(tekst); return;
    }
    setBezig(true);
    try {
      const bewaard = await apiJson<{ extra: ExtraFeestdag[] }>('/api/verlof/feestdagen', {
        method: 'PUT',
        body: JSON.stringify({ extra: sorteerExtraFeestdagen(uitkomst.data.extra) }),
      });
      onSaved(bewaard.extra);
      notify('Extra vrije dagen opgeslagen, de verloftelling rekent er meteen mee.', 'success');
      onClose();
    } catch (err) {
      setFout(err instanceof Error ? err.message : 'Opslaan is mislukt.');
    } finally {
      setBezig(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} maxWidth="lg" className="flex max-h-overlay flex-col !overflow-hidden !p-0">
      <ModalHeader
        title="Feestdagen"
        description="Valt een feestdag in een verlofperiode, dan telt die dag niet als betaald verlof. De wettelijke feestdagen staan er al; voeg hieronder extra vrije dagen toe, zoals een brugdag."
        onClose={onClose}
      />
      <form onSubmit={opslaan} className="flex-1 space-y-6 overflow-y-auto p-8">
        <div className="flex items-center justify-between gap-3">
          <MicroLabel>Jaar</MicroLabel>
          <div className="flex items-center gap-1">
            <Button variant="secondary" size="sm" onClick={() => setJaar((j) => j - 1)} aria-label="Vorig jaar">‹</Button>
            <span className="min-w-14 text-center text-sm font-semibold text-slate-800">{jaar}</span>
            <Button variant="secondary" size="sm" onClick={() => setJaar((j) => j + 1)} aria-label="Volgend jaar">›</Button>
          </div>
        </div>

        <div className="space-y-2">
          <MicroLabel className="text-slate-500">Wettelijke feestdagen {jaar}</MicroLabel>
          <Card padding="none" className="divide-y divide-hairline-subtle">
            {wettelijk.map(([datum, naam]) => (
              <div key={datum} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span className="font-medium text-slate-700">{naam}</span>
                <span className="text-xs text-slate-500">{formatShortDay(datum)}</span>
              </div>
            ))}
          </Card>
        </div>

        <div className="space-y-3">
          <MicroLabel className="text-slate-500">Extra vrije dagen {jaar}</MicroLabel>
          {extraDitJaar.length === 0 ? (
            <Card tone="muted" padding="sm" className="text-sm text-slate-500">Nog geen extra vrije dagen in {jaar}.</Card>
          ) : (
            <Card padding="none" className="divide-y divide-hairline-subtle">
              {extraDitJaar.map((d) => (
                <div key={d.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate font-medium text-slate-700">{d.naam}</span>
                    <Badge tone="oker" stil>extra</Badge>
                  </span>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-slate-500">{formatShortDay(d.datum)}</span>
                    <IconButton label={`${d.naam} verwijderen`} size="sm" variant="danger" onClick={() => verwijder(d.id)}>
                      <Trash2 size={14} />
                    </IconButton>
                  </span>
                </div>
              ))}
            </Card>
          )}
          <Card padding="sm" className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-end">
            <Field label="Datum">
              {({ id }) => <DateInput id={id} value={nieuwDatum} onChange={setNieuwDatum} />}
            </Field>
            <Field label="Naam">
              {({ id }) => <Input id={id} value={nieuwNaam} placeholder="Brugdag" onChange={(e) => setNieuwNaam(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); voegToe(); } }} />}
            </Field>
            <Button variant="secondary" icon={<Plus size={14} />} onClick={voegToe}>Toevoegen</Button>
          </Card>
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
