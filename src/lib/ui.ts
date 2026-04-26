import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
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
  };
}

/**
 * Open a PDF in a new tab. Handles `data:` URLs by converting them to a
 * blob URL — modern browsers block top-level navigation to data: URLs as
 * an anti-phishing measure, which would otherwise result in a blank page.
 */
export function openPdfInNewTab(pdfUrl: string | undefined | null) {
  if (!pdfUrl) return;
  if (!pdfUrl.startsWith('data:')) {
    window.open(pdfUrl, '_blank', 'noopener,noreferrer');
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
    window.open(url, '_blank', 'noopener,noreferrer');
    // Free the object URL after the new tab has had time to load it.
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  } catch (err) {
    console.error('Kon PDF niet openen:', err);
    notify('PDF kon niet worden geopend.', 'error');
  }
}
