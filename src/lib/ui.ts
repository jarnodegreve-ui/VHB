import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { deviceHeaders } from './device';
import { supabase } from './supabase';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function notify(message: string, tone: 'success' | 'error' | 'info' = 'info') {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('vhb-toast', { detail: { message, tone } }));
}

export async function getSupabaseAuthHeaders() {
  const accessToken = (await supabase?.auth.getSession())?.data.session?.access_token;
  return {
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    ...deviceHeaders(),
  };
}

/**
 * Open a PDF in a new tab. Handles `data:` URLs by converting them to a
 * blob URL — modern browsers block top-level navigation to data: URLs as
 * an anti-phishing measure, which would otherwise result in a blank page.
 *
 * In een geïnstalleerde PWA (iOS-standalone) geeft window.open geregeld null
 * terug (geen tabbladen in standalone) — dan navigeren we in hetzelfde
 * venster; terug-swipen brengt de gebruiker weer in het portaal.
 */
export function openPdfInNewTab(pdfUrl: string | undefined | null) {
  if (!pdfUrl) return;
  if (!pdfUrl.startsWith('data:')) {
    const win = window.open(pdfUrl, '_blank', 'noopener,noreferrer');
    if (!win) window.location.assign(pdfUrl);
    return;
  }
  try {
    const [header, base64] = pdfUrl.split(',');
    const mime = header.match(/data:([^;]+)/)?.[1] || 'application/pdf';
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank', 'noopener,noreferrer');
    if (!win) {
      window.location.assign(url);
      return; // niet revoken — het huidige venster gebruikt de blob-URL nog
    }
    // Free the object URL after the new tab has had time to load it.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    console.error('Kon PDF niet openen:', err);
    notify('PDF kon niet worden geopend.', 'error');
  }
}

/**
 * Download een Blob als bestand. In een geïnstalleerde PWA op iOS is het
 * a.download-patroon wisselvallig (soms geen zichtbare feedback); daar proberen
 * we eerst het deelblad (navigator.share met een File → bewaren in Bestanden),
 * met de klassieke download als fallback + een bevestigings-toast. Roep aan
 * vanuit een click-handler (user-gesture) zodat het deelblad mag openen.
 */
export async function downloadBlob(filename: string, blob: Blob) {
  const standalone =
    (typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)')?.matches) ||
    (typeof navigator !== 'undefined' && (navigator as { standalone?: boolean }).standalone === true);
  const shareNav = navigator as Navigator & {
    canShare?: (data: unknown) => boolean;
    share?: (data: unknown) => Promise<void>;
  };
  if (standalone && typeof File !== 'undefined' && shareNav.share && shareNav.canShare) {
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
    if (shareNav.canShare({ files: [file] })) {
      try {
        await shareNav.share({ files: [file], title: filename });
        return;
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError') return; // gebruiker annuleerde
        // anders: val terug op de klassieke download hieronder
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  notify(`"${filename}" gedownload.`, 'success');
}
