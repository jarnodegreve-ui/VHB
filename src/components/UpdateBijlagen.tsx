import { MAX_UPDATE_BIJLAGEN } from '../../shared/schemas/update';
import type { Update, UpdateBijlage } from '../types';
import { Switch } from './primitives';
import { Card } from './Card';
import { InfoTip } from './InfoTip';
import { PDF_MAX_TEKST, PdfBijlagenLijst, PdfKiesKnop, usePdfBijlagen } from './PdfBijlagen';

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
  const bijlagen: UpdateBijlage[] = update?.bijlagen ?? [];
  const vol = bijlagen.length >= MAX_UPDATE_BIJLAGEN;
  // Kiezen, uploaden en verwijderen: gedeeld met de omleidingen.
  const { bestandRef, bezig, kies, verwijder } = usePdfBijlagen({
    recordPad: update ? `/api/updates/${encodeURIComponent(update.id)}` : null,
    bijlagen,
    max: MAX_UPDATE_BIJLAGEN,
    onGewijzigd,
  });

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
        rijen={bijlagen.map((b) => ({ sleutel: String(b.slot), slot: b.slot, filename: b.filename, sizeBytes: b.sizeBytes, uploadedAt: b.uploadedAt, url: b.url }))}
        bron={update ? { soort: 'update', recordId: update.id } : undefined}
        bezig={bezig}
        onVerwijder={(rij) => void verwijder(Number(rij.sleutel))}
      />

      {update && !vol && (
        <PdfKiesKnop id="update-bijlage-upload" bezig={bezig} label="PDF toevoegen…" inputRef={bestandRef} onKies={(f) => void kies(f)} />
      )}
    </Card>
  );
}
