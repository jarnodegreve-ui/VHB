import { useRef, useState } from 'react';
import { FileText, Trash2, Upload } from 'lucide-react';
import { MAX_UPDATE_BIJLAGEN } from '../../shared/schemas/update';
import type { Update, UpdateBijlage } from '../types';
import { apiFetch } from '../lib/api';
import { prettySize } from '../lib/format';
import { notify, openPdfInNewTab } from '../lib/ui';
import { Button, IconButton, Switch } from './primitives';
import { Card } from './Card';
import { InfoTip } from './InfoTip';

/**
 * PDF's bij een update (puntje Jarno 8, 21-09): hoogstens twee per bericht,
 * plus het vinkje "meteen tonen". Zit in het bewerkpaneel van Beheer updates.
 *
 * Uploaden kan pas als de update bestaat: het bestand krijgt een vaste plek
 * in de bucket (`<update-id>-<slot>.pdf`) en de server hangt de lijst aan het
 * record. Bij een nieuwe update staat er daarom eerst "publiceer eerst".
 */

/** Ruim onder de 5 MB die express.json aankan, na base64-opslag (+33 %). */
const MAX_BYTES = 3.5 * 1024 * 1024;

async function leesAlsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Kon bestand niet lezen.'));
    reader.readAsDataURL(file);
  });
}

export function UpdateBijlagen({ update, tonen, onTonenChange, onGewijzigd }: {
  /** De opgeslagen update, of null zolang ze nog gepubliceerd moet worden. */
  update: Update | null;
  /** Stand van het vinkje in het formulier (wordt met de update meebewaard). */
  tonen: boolean;
  onTonenChange: (v: boolean) => void;
  /** De server gaf een bijgewerkt record terug: de lijst opnieuw laden. */
  onGewijzigd: () => void;
}) {
  const bestandRef = useRef<HTMLInputElement>(null);
  const [bezig, setBezig] = useState(false);
  const bijlagen: UpdateBijlage[] = update?.bijlagen ?? [];
  const vol = bijlagen.length >= MAX_UPDATE_BIJLAGEN;

  const vrijSlot = () => {
    for (let s = 1; s <= MAX_UPDATE_BIJLAGEN; s++) if (!bijlagen.some((b) => b.slot === s)) return s;
    return null;
  };

  const kies = async (file: File | undefined) => {
    if (!file || !update) return;
    const slot = vrijSlot();
    if (slot === null) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) return notify('Alleen PDF-bestanden.', 'error');
    if (file.size > MAX_BYTES) return notify(`PDF is te groot (max ${Math.round(MAX_BYTES / (1024 * 1024))} MB).`, 'error');
    setBezig(true);
    try {
      const dataUrl = await leesAlsDataUrl(file);
      const response = await apiFetch(`/api/updates/${encodeURIComponent(update.id)}/bijlage`, {
        method: 'POST',
        body: JSON.stringify({ slot, filename: file.name, dataUrl }),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        return notify(detail?.error || 'Uploaden is mislukt.', 'error');
      }
      notify('PDF toegevoegd.', 'success');
      onGewijzigd();
    } catch {
      notify('Uploaden is mislukt.', 'error');
    } finally {
      setBezig(false);
      if (bestandRef.current) bestandRef.current.value = '';
    }
  };

  const verwijder = async (slot: number) => {
    if (!update) return;
    setBezig(true);
    try {
      const response = await apiFetch(`/api/updates/${encodeURIComponent(update.id)}/bijlage/${slot}`, { method: 'DELETE' });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        return notify(detail?.error || 'Verwijderen is mislukt.', 'error');
      }
      notify('PDF verwijderd.', 'success');
      onGewijzigd();
    } catch {
      notify('Verwijderen is mislukt.', 'error');
    } finally {
      setBezig(false);
    }
  };

  return (
    <Card tone="muted" padding="sm" className="space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <p className="text-sm font-semibold text-slate-800">Bijlagen</p>
            <InfoTip label="Uitleg bij bijlagen">
              <p>Hang hoogstens {MAX_UPDATE_BIJLAGEN} PDF's aan een update, bijvoorbeeld een mededeling of een formulier. Chauffeurs openen ze vanuit het bericht.</p>
              <p className="mt-2">Staat "meteen tonen" aan, dan staat de PDF op een computer ingebed onder de tekst zodra het bericht openklapt. Op een telefoon blijft het een knop: daar toont een ingebedde PDF alleen de eerste pagina.</p>
            </InfoTip>
          </div>
          <p className="mt-0.5 text-xs text-slate-500">
            {update ? `${bijlagen.length} van ${MAX_UPDATE_BIJLAGEN} · PDF, max 3,5 MB` : 'Publiceer de update eerst, daarna kan je PDF’s toevoegen.'}
          </p>
        </div>
        <Switch
          label="PDF meteen tonen"
          checked={tonen}
          onChange={onTonenChange}
          disabled={!update && bijlagen.length === 0}
        />
      </div>

      {bijlagen.length > 0 && (
        <ul className="divide-y divide-hairline-subtle overflow-hidden rounded-2xl bg-paper ring-1 ring-hairline">
          {bijlagen.map((b) => (
            <li key={b.slot} className="flex items-center gap-2 px-3 py-2">
              <span aria-hidden="true" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-oker-500/15 text-oker-700">
                <FileText size={14} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-slate-800">{b.filename}</span>
                {b.sizeBytes != null && <span className="block text-xs text-slate-500">{prettySize(b.sizeBytes)}</span>}
              </span>
              <Button variant="ghost" size="sm" disabled={!b.url} onClick={() => b.url && openPdfInNewTab(b.url)}>
                Openen
              </Button>
              <IconButton label={`Bijlage ${b.filename} verwijderen`} variant="ghost" size="sm" disabled={bezig} onClick={() => void verwijder(b.slot)}>
                <Trash2 size={14} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      {update && !vol && (
        <>
          <input
            ref={bestandRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            id="update-bijlage-upload"
            onChange={(e) => void kies(e.target.files?.[0])}
          />
          {/* Label-als-knop voor het verborgen bestandsveld: de native kiezer
              opent via het label, niet via een knop (zelfde als omleidingen). */}
          <label
            htmlFor="update-bijlage-upload"
            className={cnLabel(bezig)}
          >
            <Upload size={16} />
            <span className="truncate">{bezig ? 'Bezig…' : 'PDF toevoegen…'}</span>
          </label>
        </>
      )}
    </Card>
  );
}

const cnLabel = (bezig: boolean) =>
  [
    'ios-pressable control-button-soft inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all hover:text-slate-900',
    bezig ? 'pointer-events-none opacity-60' : 'cursor-pointer',
  ].join(' ');
