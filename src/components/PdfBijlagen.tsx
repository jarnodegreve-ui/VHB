import { useRef, useState } from 'react';
import { FileText, Trash2, Upload } from 'lucide-react';
import type { PdfBijlage } from '../types';
import { apiFetch } from '../lib/api';
import { leesAlsDataUrl } from '../lib/dataUrl';
import { prettySize } from '../lib/format';
import { meldSchrijffout } from '../lib/fouten';
import { notify, openPdfInNewTab } from '../lib/ui';
import { Button, IconButton } from './primitives';

/**
 * Gedeelde bouwstenen voor PDF-bijlagen in een beheerformulier (updates en
 * omleidingen): de lijst met wat er hangt, het verborgen bestandsveld met
 * label-als-knop, en sinds 29-09 ook het gedrag zelf (kiezen, uploaden,
 * verwijderen) in `usePdfBijlagen`. UpdateBijlagen en OmleidingBijlagen
 * hadden daar elk een eigen kopie van en die waren uit elkaar gegroeid: na
 * een geweigerd bestand maakte alleen het scherm van de omleidingen het
 * bestandsveld leeg, waardoor bij een update hetzelfde bestand opnieuw
 * kiezen niets deed. Wat per record verschilt (het pad van de route, het
 * aantal plaatsen, de wachtrij van een nieuwe omleiding) geeft de aanroeper
 * mee; de rest staat hier één keer.
 */

/** Ruim onder de 5 MB die express.json aankan, na base64-opslag (+33 %). */
export const PDF_MAX_BYTES = 3.5 * 1024 * 1024;
export const PDF_MAX_TEKST = 'PDF, max 3,5 MB';

/** Het lezen als data-URL staat in src/lib/dataUrl.ts (ook voor schermen
 *  buiten het beheer); hier doorgegeven voor wie hem bij de bijlagen zoekt. */
export { leesAlsDataUrl };

/** Eerste controle vóór het uploaden; geeft de fouttekst of null. */
export function pdfBestandFout(file: File): string | null {
  if (!file.name.toLowerCase().endsWith('.pdf')) return 'Alleen PDF-bestanden.';
  if (file.size > PDF_MAX_BYTES) return `PDF is te groot (max ${Math.round(PDF_MAX_BYTES / (1024 * 1024))} MB).`;
  return null;
}

/** De laagste vrije plaats (1 tot en met `max`), of null als alles bezet is. */
export function eersteVrijeSlot(bijlagen: ReadonlyArray<{ slot: number }>, max: number): number | null {
  for (let s = 1; s <= max; s++) if (!bijlagen.some((b) => b.slot === s)) return s;
  return null;
}

/**
 * Eén PDF naar een plaats van een bestaand record sturen. `recordPad` is het
 * API-pad van het record (`/api/updates/<id>` of `/api/diversions/<id>`).
 * Een mislukking meldt zichzelf; geeft terug of het lukte.
 */
export async function uploadPdfBijlage(recordPad: string, slot: number, file: File): Promise<boolean> {
  try {
    const dataUrl = await leesAlsDataUrl(file);
    const response = await apiFetch(`${recordPad}/bijlage`, {
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

/**
 * Het gedrag van een bijlagenblok: een bestand kiezen (controleren, naar de
 * eerste vrije plaats uploaden) en een bijlage verwijderen.
 *
 * Het bestandsveld wordt na ELKE keuze leeggemaakt, ook na een geweigerd
 * bestand of een mislukte upload: anders vuurt het veld geen change meer af
 * wanneer de gebruiker hetzelfde bestand opnieuw kiest.
 */
export function usePdfBijlagen({ recordPad, bijlagen, max, onGewijzigd, zonderRecord }: {
  /** API-pad van het opgeslagen record, of null zolang het nog niet bestaat. */
  recordPad: string | null;
  /** Wat er nu hangt (bepaalt de eerste vrije plaats). */
  bijlagen: ReadonlyArray<{ slot: number }>;
  /** Aantal plaatsen (2 bij een update, 5 bij een omleiding). */
  max: number;
  /** De server gaf een bijgewerkt record terug: de lijst opnieuw laden. */
  onGewijzigd: () => void;
  /** Een geldig bestand gekozen terwijl het record nog niet bestaat (de
   *  wachtrij van een nieuwe omleiding). Zonder opgave gebeurt er niets. */
  zonderRecord?: (file: File) => void;
}) {
  const bestandRef = useRef<HTMLInputElement>(null);
  const [bezig, setBezig] = useState(false);

  const kies = async (file: File | undefined) => {
    try {
      if (!file) return;
      const fout = pdfBestandFout(file);
      if (fout) return notify(fout, 'error');
      if (recordPad === null) return zonderRecord?.(file);
      const slot = eersteVrijeSlot(bijlagen, max);
      if (slot === null) return;
      setBezig(true);
      if (await uploadPdfBijlage(recordPad, slot, file)) {
        notify('PDF toegevoegd.', 'success');
        onGewijzigd();
      }
    } finally {
      setBezig(false);
      if (bestandRef.current) bestandRef.current.value = '';
    }
  };

  const verwijder = async (slot: number) => {
    if (recordPad === null) return;
    setBezig(true);
    try {
      const response = await apiFetch(`${recordPad}/bijlage/${slot}`, { method: 'DELETE' });
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

  return { bestandRef, bezig, kies, verwijder };
}

/** Een rij in de lijst: opgeslagen (met slot en url) of nog te uploaden. */
export type BijlageRij = Pick<PdfBijlage, 'filename' | 'sizeBytes' | 'url'> & { sleutel: string; wachtend?: boolean };

export function PdfBijlagenLijst({ rijen, bezig, onVerwijder }: {
  rijen: BijlageRij[];
  bezig: boolean;
  onVerwijder: (rij: BijlageRij) => void;
}) {
  if (rijen.length === 0) return null;
  return (
    <ul className="divide-y divide-hairline-subtle overflow-hidden rounded-2xl bg-paper ring-1 ring-hairline">
      {rijen.map((b) => (
        <li key={b.sleutel} className="flex items-center gap-2 px-3 py-2">
          <span aria-hidden="true" className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-surface-muted text-slate-700">
            <FileText size={14} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-slate-800">{b.filename}</span>
            <span className="block text-xs text-slate-500">
              {b.wachtend ? 'Wordt toegevoegd bij het opslaan' : b.sizeBytes != null ? prettySize(b.sizeBytes) : ''}
            </span>
          </span>
          {!b.wachtend && (
            <Button variant="ghost" size="sm" disabled={!b.url} onClick={() => b.url && openPdfInNewTab(b.url)}>
              Openen
            </Button>
          )}
          <IconButton label={`Bijlage ${b.filename} verwijderen`} variant="ghost" size="sm" disabled={bezig} onClick={() => onVerwijder(b)}>
            <Trash2 size={14} />
          </IconButton>
        </li>
      ))}
    </ul>
  );
}

/** Verborgen bestandsveld met label-als-knop: de native kiezer opent via het
 *  label, niet via een knop (zelfde als de ritbladen). */
export function PdfKiesKnop({ id, bezig, label, inputRef, onKies }: {
  id: string;
  bezig: boolean;
  label: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onKies: (file: File | undefined) => void;
}) {
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        className="hidden"
        id={id}
        onChange={(e) => onKies(e.target.files?.[0])}
      />
      <label
        htmlFor={id}
        className={[
          'ios-pressable control-button-soft inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-700 hover:text-slate-900',
          bezig ? 'pointer-events-none opacity-60' : 'cursor-pointer',
        ].join(' ')}
      >
        <Upload size={16} />
        <span className="truncate">{bezig ? 'Bezig…' : label}</span>
      </label>
    </>
  );
}
