import { useRef, useState } from 'react';
import { MAX_UPDATE_BIJLAGEN } from '../../shared/schemas/update';
import type { Update, UpdateBijlage } from '../types';
import { apiFetch } from '../lib/api';
import { notify } from '../lib/ui';
import { Switch } from './primitives';
import { Card } from './Card';
import { InfoTip } from './InfoTip';
import { meldSchrijffout } from '../lib/fouten';
import { PDF_MAX_TEKST, PdfBijlagenLijst, PdfKiesKnop, leesAlsDataUrl, pdfBestandFout } from './PdfBijlagen';

/**
 * PDF's bij een update (puntje Jarno 8, 21-09): hoogstens twee per bericht,
 * plus het vinkje "meteen tonen". Zit in het bewerkpaneel van Beheer updates.
 *
 * Uploaden kan pas als de update bestaat: het bestand krijgt een vaste plek
 * in de bucket (`<update-id>-<slot>.pdf`) en de server hangt de lijst aan het
 * record. Bij een nieuwe update staat er daarom eerst "publiceer eerst".
 */
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
    const fout = pdfBestandFout(file);
    if (fout) return notify(fout, 'error');
    setBezig(true);
    try {
      const dataUrl = await leesAlsDataUrl(file);
      const response = await apiFetch(`/api/updates/${encodeURIComponent(update.id)}/bijlage`, {
        method: 'POST',
        body: JSON.stringify({ slot, filename: file.name, dataUrl }),
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        return meldSchrijffout('Uploaden', { status: response.status, message: detail?.error });
      }
      notify('PDF toegevoegd.', 'success');
      onGewijzigd();
    } catch (err) {
      meldSchrijffout('Uploaden', err);
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
        return meldSchrijffout('Verwijderen', { status: response.status, message: detail?.error }, () => void verwijder(slot));
      }
      notify('PDF verwijderd.', 'success');
      onGewijzigd();
    } catch (err) {
      meldSchrijffout('Verwijderen', err, () => void verwijder(slot));
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
            {update ? `${bijlagen.length} van ${MAX_UPDATE_BIJLAGEN} · ${PDF_MAX_TEKST}` : 'Publiceer de update eerst, daarna kan je PDF’s toevoegen.'}
          </p>
        </div>
        <Switch
          label="PDF meteen tonen"
          checked={tonen}
          onChange={onTonenChange}
          disabled={!update && bijlagen.length === 0}
        />
      </div>

      <PdfBijlagenLijst
        rijen={bijlagen.map((b) => ({ sleutel: String(b.slot), filename: b.filename, sizeBytes: b.sizeBytes, url: b.url }))}
        bezig={bezig}
        onVerwijder={(rij) => void verwijder(Number(rij.sleutel))}
      />

      {update && !vol && (
        <PdfKiesKnop id="update-bijlage-upload" bezig={bezig} label="PDF toevoegen…" inputRef={bestandRef} onKies={(f) => void kies(f)} />
      )}
    </Card>
  );
}
