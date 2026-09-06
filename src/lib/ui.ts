import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { deviceHeaders } from './device';
import { supabase } from './supabase';
import type { Toast, ToastOpties } from '../components/ToastStack';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** sessionStorage-sleutel waarmee een gedwongen uitlog zijn reden doorgeeft
 *  aan het inlogscherm. Een toast kon dat niet: LoginView vervangt de hele
 *  app, dus die melding verdween meteen en je stond zonder uitleg voor een
 *  leeg formulier. Waarde: 'sessie' of 'account'. */
export const LOGIN_MELDING_KEY = 'vhb-login-melding';

/** Inhoud van het `vhb-toast`-event (App.tsx luistert en roept showToast). */
export type ToastEventDetail = {
  message: string;
  tone?: Toast['tone'];
  action?: Toast['action'];
  opties?: ToastOpties;
};

export function notify(
  message: string,
  tone: 'success' | 'error' | 'info' = 'info',
  extra?: Pick<ToastEventDetail, 'action' | 'opties'>,
) {
  if (typeof window === 'undefined') return;
  const detail: ToastEventDetail = { message, tone, ...extra };
  window.dispatchEvent(new CustomEvent('vhb-toast', { detail }));
}

/** Sessie- en toestel-headers als los object. Alleen nog voor plekken die
 *  bewust búiten apiFetch (src/lib/api.ts) blijven: de foutrapportage
 *  (monitoring.ts, mag nooit een uitlog triggeren) — alle gewone API-calls
 *  gaan via apiFetch. */
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
 * Geeft window.open null terug (iOS-standalone zonder tabbladen, popup-
 * blocker), dan navigeren we in hetzelfde venster; terug-swipen brengt de
 * gebruiker weer in het portaal. Zie openNieuwVenster voor waarom dat null
 * NIET via de 'noopener'-feature mag komen.
 */
/** Alleen https/http en data:application/pdf mogen als navigatiedoel dienen.
 *  De pdfUrl van een omleiding is planner-invoer; zonder deze check kon een
 *  `javascript:`-URL bij de window.open-null-fallback (iOS-standalone) in de
 *  sessie van de kijkende admin uitgevoerd worden. */
export const isSafeDocumentUrl = (url: string): boolean => {
  const trimmed = url.trim();
  if (/^data:application\/pdf[;,]/i.test(trimmed)) return true;
  try {
    const proto = new URL(trimmed, window.location.origin).protocol;
    return proto === 'https:' || proto === 'http:';
  } catch {
    return false;
  }
};

/**
 * Telefoonnummer → `tel:`-href. Het veld is vrije tekst, dus notaties als
 * "+32 (0)475 12 34 56" komen voor: de landcode-nul tussen haakjes moet weg
 * (anders belt de telefoon een ongeldig nummer) en alleen een leidende `+`
 * heeft betekenis. Eén gedeelde bron zodat elke bel-knop hetzelfde nummer
 * draait. Geeft undefined bij een nummer zonder cijfers.
 */
export function telHref(phone: string | undefined | null): string | undefined {
  const raw = String(phone ?? '').trim();
  if (!raw) return undefined;
  const plus = raw.startsWith('+');
  // "(0)" na een landcode is een schrijfwijze, geen te kiezen cijfer.
  const digits = raw.replace(/\(0\)/g, '').replace(/\D/g, '');
  if (!digits) return undefined;
  return `tel:${plus ? '+' : ''}${digits}`;
}

/** Veilige href voor een download-anchor: onveilige/lege URL's worden
 *  onklikbaar (`undefined`) i.p.v. een navigatiedoel. */
export const safeDocumentHref = (url: string | undefined | null): string | undefined =>
  url && isSafeDocumentUrl(url) ? url : undefined;

/** Nieuw tabblad zonder opener-lek — bewust NIET via de 'noopener'/
 *  'noreferrer'-features: per HTML-spec geeft window.open dán áltijd null
 *  terug, óók als het venster gewoon opent. De fallback in openPdfInNewTab
 *  navigeerde daardoor bij élke PDF-klik ook het portaal zelf naar de PDF
 *  (controle-ronde 27-08, bevinding 5). opener handmatig op null zetten mag
 *  ook cross-origin. De referrer gaat nu mee, maar de Referrer-Policy-header
 *  (strict-origin-when-cross-origin) beperkt die tot de origin. */
const openNieuwVenster = (url: string): Window | null => {
  const win = window.open(url, '_blank');
  if (win) {
    try {
      win.opener = null;
    } catch {
      // Setter geweigerd — dan blijft hooguit een opener-verwijzing naar het portaal.
    }
  }
  return win;
};

export function openPdfInNewTab(pdfUrl: string | undefined | null) {
  if (!pdfUrl) return;
  if (!isSafeDocumentUrl(pdfUrl)) {
    notify('Deze bijlage heeft een ongeldig adres en is niet geopend.', 'error');
    return;
  }
  if (!pdfUrl.startsWith('data:')) {
    if (!openNieuwVenster(pdfUrl)) window.location.assign(pdfUrl);
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
    if (!openNieuwVenster(url)) {
      window.location.assign(url);
      return; // niet revoken, het huidige venster gebruikt de blob-URL nog
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

/** Statusbalk-kleur van de PWA-schil laten meekleuren met het thema — een
 *  carbon balk boven een lichte app oogde als een bug op geïnstalleerde
 *  iPhones (design-ronde 30/07). Login zet hem altijd op carbon. */
export function applyThemeColorMeta(dark: boolean) {
  if (typeof document === 'undefined') return;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0D0D0F' : '#F2F3F4');
  // In een geïnstalleerde iOS-PWA stuurt DEZE meta de statusbalk aan, niet
  // theme-color. Hij stond hard op 'black', dus in lichte modus hield je
  // alsnog een zwarte strook boven een lichtgrijze app — precies wat de regel
  // hierboven wilde wegnemen. 'default' = lichte balk met donkere tekst.
  // iOS leest hem bij het opstarten van de PWA, dus het effect is er vooral
  // vanaf de volgende keer openen; beter dan permanent verkeerd staan.
  const statusBar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
  if (statusBar) statusBar.setAttribute('content', dark ? 'black' : 'default');
}

/**
 * Spiegel van het effectieve thema voor het boot-script in index.html: dat
 * zet de dark-class vóór de eerste paint (anti-witflits, 01-09). De
 * expliciete gebruikerskeuze blijft in 'vhb-theme'; deze sleutel volgt óók
 * de rol-standaard (planner/admin = donker), die bewust geen keuze is.
 */
export function onthoudEffectiefThema(thema: 'light' | 'dark') {
  try {
    window.localStorage.setItem('vhb-theme-effectief', thema);
  } catch {
    // opslag geblokkeerd — dan blijft hooguit de flits
  }
}

/** Cache Storage leegmaken (rooster, ritblad-PDF, shell): bij uitloggen,
 *  gebruikerswissel op een gedeeld toestel én zodra een toestel geblokkeerd
 *  of ingetrokken is — anders bleef de laatste ritbladbundel offline
 *  beschikbaar tot de volgende deploy (controle 05-09, nr. 46). Best-effort. */
export async function wisOfflineCaches(): Promise<void> {
  try {
    if (typeof window === 'undefined' || !('caches' in window)) return;
    const keys = await caches.keys();
    await Promise.all(keys.map((k) => caches.delete(k)));
  } catch {
    // cache-API geblokkeerd — geen blocker
  }
}

/** Rol-standaardthema is per gebruiker, niet per toestel: bij uitloggen
 *  vergeten, zodat een chauffeur na een planner op hetzelfde toestel niet
 *  donker start (controle 05-09, nr. 34). Een expliciete keuze (vhb-theme)
 *  blijft staan: die is van het toestel. */
export function vergeetEffectiefThema(): void {
  try {
    window.localStorage.removeItem('vhb-theme-effectief');
  } catch {
    // opslag geblokkeerd
  }
}
