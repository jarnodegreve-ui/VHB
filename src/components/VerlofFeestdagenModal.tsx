import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal, SluitKnop } from './Modal';
import { Formulier } from './Formulier';
import { ModalHeader } from './ui';
import { Button, IconButton, MicroLabel, Badge } from './primitives';
import { Card } from './Card';
import { DateInput, Field, Input } from './Field';
import { apiFetch } from '../lib/api';
import { notify } from '../lib/ui';
import { useVeldfouten, useVuil } from '../lib/formulier';
import { meldSchrijffout } from '../lib/fouten';
import { formatShortDay } from '../lib/format';
import { feestdagenVanJaar } from '../lib/typedag';
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
  const fouten = useVeldfouten();
  const [bezig, setBezig] = useState(false);
  // Onbewaarde invoer (tranche 3A). De waarden worden pas ná het openen
  // gezet; `geladen` telt dan op zodat de momentopname die waarden neemt.
  const [geladen, setGeladen] = useState(0);
  const { vuil } = useVuil({ lijst, nieuwDatum, nieuwNaam }, open, geladen);

  useEffect(() => {
    if (!open) return;
    setLijst(extra); setNieuwDatum(''); setNieuwNaam(''); fouten.wis();
    setGeladen((n) => n + 1);
  }, [open, extra]);

  const wettelijk = useMemo(() => Object.entries(feestdagenVanJaar(jaar)).sort(([a], [b]) => a.localeCompare(b)), [jaar]);
  const extraDitJaar = lijst.filter((d) => d.datum.startsWith(`${jaar}-`)).sort((a, b) => a.datum.localeCompare(b.datum));
  const nieuweId = () => (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  // Toevoegen is geen submit (Enter in Naam voegt toe, Opslaan bewaart de
  // lijst); de fouten staan wel bij het veld waar ze over gaan.
  const voegToe = () => {
    const f: Record<string, string> = {};
    if (!nieuwDatum) f.nieuwDatum = 'Kies een datum.';
    if (!nieuwNaam.trim()) f.nieuwNaam = 'Geef de dag een naam.';
    if (nieuwDatum && feestdagenVanJaar(Number(nieuwDatum.slice(0, 4)))[nieuwDatum]) f.nieuwDatum = 'Die dag is al een wettelijke feestdag.';
    else if (nieuwDatum && lijst.some((d) => d.datum === nieuwDatum)) f.nieuwDatum = 'Die dag staat al in de lijst.';
    if (Object.keys(f).length > 0) { fouten.zet(f); return; }
    setLijst((cur) => sorteerExtraFeestdagen([...cur, { id: nieuweId(), datum: nieuwDatum, naam: nieuwNaam.trim() }]));
    setNieuwDatum(''); setNieuwNaam(''); fouten.wis();
  };
  const verwijder = (id: string) => { setLijst((cur) => cur.filter((d) => d.id !== id)); fouten.wis(); };
  // De lijst zelf heeft geen invoervelden: fouten daarover (van zod of de
  // server, bv. "extra.2.naam") zijn één melding boven de knoppen.
  const overig = Object.entries(fouten.fouten).filter(([k]) => k !== 'nieuwDatum' && k !== 'nieuwNaam').map(([, t]) => t);

  const opslaan = async () => {
    if (bezig) return;
    const data = fouten.controleer(verlofFeestdagenSchema, { extra: lijst });
    if (!data) return;
    setBezig(true);
    try {
      const res = await apiFetch('/api/verlof/feestdagen', {
        method: 'PUT',
        body: JSON.stringify({ extra: sorteerExtraFeestdagen(data.extra) }),
      });
      const antwoord: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        if (res.status === 400 && fouten.vanServer(antwoord)) return;
        // Hele instelling in één PUT = idempotent: opnieuw proberen mag.
        meldSchrijffout('Opslaan', { status: res.status, message: (antwoord as { error?: string } | null)?.error }, () => void opslaan());
        return;
      }
      onSaved((antwoord as { extra: ExtraFeestdag[] }).extra);
      notify('Extra vrije dagen opgeslagen, de verloftelling rekent er meteen mee.', 'success');
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
        title="Feestdagen"
        description="Valt een feestdag in een verlofperiode, dan telt die dag niet als betaald verlof. De wettelijke feestdagen staan er al; voeg hieronder extra vrije dagen toe, zoals een brugdag."
        onClose={onClose}
      />
      <Formulier onVerstuur={opslaan} noValidate className="flex-1 space-y-6 overflow-y-auto p-8">
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
            <Field label="Datum" error={fouten.fouten.nieuwDatum}>
              <DateInput value={nieuwDatum} onChange={(v) => { setNieuwDatum(v); fouten.wisVeld('nieuwDatum'); }} />
            </Field>
            <Field label="Naam" error={fouten.fouten.nieuwNaam}>
              <Input value={nieuwNaam} placeholder="Brugdag" onChange={(e) => { setNieuwNaam(e.target.value); fouten.wisVeld('nieuwNaam'); }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); voegToe(); } }} />
            </Field>
            <Button variant="secondary" icon={<Plus size={14} />} onClick={voegToe}>Toevoegen</Button>
          </Card>
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
