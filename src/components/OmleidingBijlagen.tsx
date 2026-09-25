import { useRef, useState } from 'react';
import { MAX_OMLEIDING_BIJLAGEN } from '../../shared/schemas/diversion';
import type { Diversion } from '../types';
import { apiFetch } from '../lib/api';
import { notify } from '../lib/ui';
import { Card } from './Card';
import { InfoTip } from './InfoTip';
import { meldSchrijffout } from '../lib/fouten';
import { PDF_MAX_TEKST, PdfBijlagenLijst, PdfKiesKnop, leesAlsDataUrl, pdfBestandFout } from './PdfBijlagen';

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
    const ok = await uploadBijlage(diversionId, i + 1, file);
    if (!ok) break;
    geslaagd += 1;
  }
  return geslaagd;
}

async function uploadBijlage(diversionId: string, slot: number, file: File): Promise<boolean> {
  try {
    const dataUrl = await leesAlsDataUrl(file);
    const response = await apiFetch(`/api/diversions/${encodeURIComponent(diversionId)}/bijlage`, {
      method: 'POST',
      body: JSON.stringify({ slot, filename: file.name, dataUrl }),
    });
    if (!response.ok) {
      const detail = await response.json().catch(() => null);
      meldSchrijffout('Uploaden', { status: response.status, message: detail?.error });
      return false;
    }
    return true;
  } catch (err) {
    meldSchrijffout('Uploaden', err);
    return false;
  }
}

export function OmleidingBijlagen({ diversion, wachtrij, onWachtrij, onGewijzigd }: {
  /** De opgeslagen omleiding, of null zolang ze nog toegevoegd moet worden. */
  diversion: Diversion | null;
  /** Bestanden die meegaan bij het opslaan van een nieuwe omleiding. */
  wachtrij: File[];
  onWachtrij: (files: File[]) => void;
  /** De server gaf een bijgewerkt record terug: de lijst opnieuw laden. */
  onGewijzigd: () => void;
}) {
  const bestandRef = useRef<HTMLInputElement>(null);
  const [bezig, setBezig] = useState(false);
  const bijlagen = diversion?.bijlagen ?? [];
  const aantal = diversion ? bijlagen.length : wachtrij.length;
  const vol = aantal >= MAX_OMLEIDING_BIJLAGEN;

  const vrijSlot = () => {
    for (let s = 1; s <= MAX_OMLEIDING_BIJLAGEN; s++) if (!bijlagen.some((b) => b.slot === s)) return s;
    return null;
  };

  const kies = async (file: File | undefined) => {
    if (!file) return;
    const fout = pdfBestandFout(file);
    if (fout) { notify(fout, 'error'); return leegmaken(); }
    if (!diversion) {
      if (!vol) onWachtrij([...wachtrij, file]);
      return leegmaken();
    }
    const slot = vrijSlot();
    if (slot === null) return leegmaken();
    setBezig(true);
    try {
      if (await uploadBijlage(diversion.id, slot, file)) {
        notify('PDF toegevoegd.', 'success');
        onGewijzigd();
      }
    } finally {
      setBezig(false);
      leegmaken();
    }
  };
  const leegmaken = () => { if (bestandRef.current) bestandRef.current.value = ''; };

  const verwijder = async (slot: number) => {
    if (!diversion) return;
    setBezig(true);
    try {
      const response = await apiFetch(`/api/diversions/${encodeURIComponent(diversion.id)}/bijlage/${slot}`, { method: 'DELETE' });
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

  const rijen = diversion
    ? bijlagen.map((b) => ({ sleutel: String(b.slot), filename: b.filename, sizeBytes: b.sizeBytes, url: b.url }))
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
