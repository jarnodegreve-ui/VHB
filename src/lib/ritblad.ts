import { getSupabaseAuthHeaders, notify, openPdfInNewTab } from './ui';

/**
 * Het actuele ritblad openen zonder eerst naar de Ritbladen-pagina te gaan.
 *
 * Er is één ritblad voor iedereen (niet één per dienst), dus deze knop hoort
 * alleen bij de dienst van vandáág — bij een dienst van volgende week zou hij
 * suggereren dat het dát blad is.
 *
 * De metadata wordt pas bij het klikken opgehaald: het rooster hoeft er niet
 * op te wachten, en offline serveert de service worker de PDF vanuit zijn
 * cache onder dezelfde query-loze URL.
 */
export async function openHuidigRitblad(): Promise<void> {
  try {
    const res = await fetch('/api/ritblaadje', { headers: await getSupabaseAuthHeaders() });
    if (!res.ok) throw new Error(`Server antwoordde ${res.status}`);
    const data = await res.json();
    if (!data?.url) {
      notify('Er staat op dit moment geen ritblad klaar.', 'info');
      return;
    }
    // openPdfInNewTab valt terug op navigeren in hetzelfde venster wanneer
    // window.open null geeft — dat gebeurt in iOS-standalone geregeld, en
    // helemaal na een await (geen directe gebruikersactie meer).
    openPdfInNewTab(data.url);
  } catch {
    notify('Kon het ritblad niet openen. Probeer het via Ritbladen.', 'error');
  }
}
