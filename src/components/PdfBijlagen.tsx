import { FileText, Trash2, Upload } from 'lucide-react';
import type { PdfBijlage } from '../types';
import { prettySize } from '../lib/format';
import { openPdfInNewTab } from '../lib/ui';
import { Button, IconButton } from './primitives';

/**
 * Gedeelde bouwstenen voor PDF-bijlagen in een beheerformulier (updates en
 * omleidingen): de lijst met wat er hangt, het verborgen bestandsveld met
 * label-als-knop, en het lezen van een bestand als data-URL voor de API.
 * De routes zelf verschillen per record (zie UpdateBijlagen en
 * OmleidingBijlagen), de vorm niet.
 */

/** Ruim onder de 5 MB die express.json aankan, na base64-opslag (+33 %). */
export const PDF_MAX_BYTES = 3.5 * 1024 * 1024;
export const PDF_MAX_TEKST = 'PDF, max 3,5 MB';

export async function leesAlsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('Kon bestand niet lezen.'));
    reader.readAsDataURL(file);
  });
}

/** Eerste controle vóór het uploaden; geeft de fouttekst of null. */
export function pdfBestandFout(file: File): string | null {
  if (!file.name.toLowerCase().endsWith('.pdf')) return 'Alleen PDF-bestanden.';
  if (file.size > PDF_MAX_BYTES) return `PDF is te groot (max ${Math.round(PDF_MAX_BYTES / (1024 * 1024))} MB).`;
  return null;
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
