import { MAX_OMLEIDING_BIJLAGEN } from '../../shared/schemas/diversion';
import type { Diversion } from '../types';
import { Card } from './Card';
import { InfoTip } from './InfoTip';
import { PDF_MAX_TEKST, PdfBijlagenLijst, PdfKiesKnop, uploadPdfBijlage, usePdfBijlagen } from './PdfBijlagen';

/**
 * PDF's bij een omleiding (Jarno 23-09): hoogstens vijf, bijvoorbeeld het
 * omleidingsplan van De Lijn plus een haltekaart. Zit in het bewerkpaneel
 * van Beheer omleidingen.
 *
 * Bij een bestaande omleiding gaat elke PDF meteen naar de server (vaste
 * plek `<id>-<slot>.pdf`, de server hangt de lijst aan het record). Bij een
 * nieuwe omleiding bestaat het record nog niet: de gekozen bestanden staan
 * dan in een wachtrij en gaan mee zodra het formulier is opgeslagen (zie
 * uploadWachtrij), zodat een planner de omleiding mét PDF in één keer kan
 * toevoegen, zoals vroeger.
 */

/** Wachtende bestanden uploaden naar de slots 1, 2, … van een net
 *  aangemaakte omleiding. Geeft het aantal geslaagde uploads terug; een
 *  mislukking meldt zichzelf en stopt de reeks (de omleiding zelf staat er al). */
export async function uploadWachtrij(diversionId: string, wachtrij: File[]): Promise<number> {
  let geslaagd = 0;
  for (const [i, file] of wachtrij.entries()) {
    const ok = await uploadPdfBijlage(omleidingPad(diversionId), i + 1, file);
    if (!ok) break;
    geslaagd += 1;
  }
  return geslaagd;
}

const omleidingPad = (diversionId: string) => `/api/diversions/${encodeURIComponent(diversionId)}`;

export function OmleidingBijlagen({ diversion, wachtrij, onWachtrij, onGewijzigd }: {
  /** De opgeslagen omleiding, of null zolang ze nog toegevoegd moet worden. */
  diversion: Diversion | null;
  /** Bestanden die meegaan bij het opslaan van een nieuwe omleiding. */
  wachtrij: File[];
  onWachtrij: (files: File[]) => void;
  /** De server gaf een bijgewerkt record terug: de lijst opnieuw laden. */
  onGewijzigd: () => void;
}) {
  const bijlagen = diversion?.bijlagen ?? [];
  const aantal = diversion ? bijlagen.length : wachtrij.length;
  const vol = aantal >= MAX_OMLEIDING_BIJLAGEN;
  // Kiezen, uploaden en verwijderen: gedeeld met de updates. Alleen de
  // wachtrij van een nieuwe omleiding is van dit scherm.
  const { bestandRef, bezig, kies, verwijder } = usePdfBijlagen({
    recordPad: diversion ? omleidingPad(diversion.id) : null,
    bijlagen,
    max: MAX_OMLEIDING_BIJLAGEN,
    onGewijzigd,
    zonderRecord: (file) => { if (!vol) onWachtrij([...wachtrij, file]); },
  });

  const rijen = diversion
    ? bijlagen.map((b) => ({ sleutel: String(b.slot), slot: b.slot, filename: b.filename, sizeBytes: b.sizeBytes, uploadedAt: b.uploadedAt, url: b.url }))
    : wachtrij.map((f, i) => ({ sleutel: `wacht-${i}`, filename: f.name, sizeBytes: f.size, wachtend: true }));

  return (
    <Card tone="muted" padding="sm" className="space-y-3">
      <div className="min-w-0">
        <div className="flex items-center gap-1">
          <p className="text-sm font-semibold text-slate-800">Bijlagen</p>
          <InfoTip label="Uitleg bij bijlagen">
            <p>Hang hoogstens {MAX_OMLEIDING_BIJLAGEN} PDF's aan een omleiding, bijvoorbeeld het omleidingsplan en een haltekaart. Chauffeurs openen ze vanuit de omleiding.</p>
          </InfoTip>
        </div>
        <p className="mt-0.5 text-xs text-slate-500">{aantal} van {MAX_OMLEIDING_BIJLAGEN} · {PDF_MAX_TEKST}</p>
      </div>

      <PdfBijlagenLijst
        rijen={rijen}
        bron={diversion ? { soort: 'omleiding', recordId: diversion.id } : undefined}
        bezig={bezig}
        onVerwijder={(rij) => {
          if (rij.wachtend) onWachtrij(wachtrij.filter((_, i) => `wacht-${i}` !== rij.sleutel));
          else void verwijder(Number(rij.sleutel));
        }}
      />

      {!vol && (
        <PdfKiesKnop id="omleiding-bijlage-upload" bezig={bezig} label="PDF toevoegen…" inputRef={bestandRef} onKies={(f) => void kies(f)} />
      )}
    </Card>
  );
}
