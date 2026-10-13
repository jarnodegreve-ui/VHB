import { notify, openPdfInNewTab } from './ui';
import { apiFetch } from './api';

/** Het pad van de bundel-metadata: zonder datum die van vandaag. Hier en
 *  niet in ritbladPaginas.ts: dit bestand zit in de startbundel, dat niet. */
export const ritbladMetaPad = (datum?: string | null): string => (datum ? `/api/ritblaadje?datum=${encodeURIComponent(datum)}` : '/api/ritblaadje');

/**
 * De volledige bundel in de app tonen (controle 16-09, nr. 10). Vroeger
 * navigeerde deze knop naar de signed Supabase-URL; in iOS-standalone geeft
 * window.open dan null (zeker na een await) en opende iOS het blad in de
 * in-app-browser, búiten de service worker. Juist offline, de reden om het
 * blad bij zich te hebben, mislukte het daardoor terwijl de PDF gewoon in de
 * cache `vhb-ritbladen` stond.
 *
 * App.tsx luistert en opent de RitbladViewer in bundel-stand; dezelfde
 * gebeurtenis-aanpak als `notify`. Geen luisteraar (of geen venster) =
 * terugvallen op de oude route, zodat de knop nooit stil niets doet.
 *
 * Sinds 13-10 hoort een bundel bij een dag: de dienstregelingversie die op
 * die dag geldt (`datum`, ISO; zonder = vandaag). De gebeurtenis draagt de
 * dag mee, zodat het rooster ook het blad van volgende week kan openen.
 */
export const RITBLAD_BUNDEL_EVENT = 'vhb-ritblad-bundel';
export type RitbladBundelDetail = { datum?: string };

const toonBundelInApp = (datum?: string): boolean => {
  if (typeof window === 'undefined') return false;
  const gebeurtenis = new CustomEvent<RitbladBundelDetail>(RITBLAD_BUNDEL_EVENT, { cancelable: true, detail: { datum } });
  // De luisteraar bevestigt met preventDefault dat hij de viewer opent.
  return !window.dispatchEvent(gebeurtenis);
};

/**
 * Het ritblad van een dag openen zonder eerst naar de Ritbladen-pagina te gaan.
 *
 * De metadata wordt pas bij het klikken opgehaald: het rooster hoeft er niet
 * op te wachten, en offline serveert de service worker de PDF vanuit zijn
 * cache onder dezelfde query-loze URL.
 */
export async function openRitblad(datum?: string): Promise<void> {
  if (toonBundelInApp(datum)) return;
  return openRitbladExtern(datum);
}

/**
 * De oude route: verse link ophalen en de PDF buiten de app openen. Alleen
 * voor de gevallen waar de in-app viewer geen optie is (hij kon het document
 * juist niet laden) of waar de gebruiker de PDF echt wil hebben.
 */
export async function openRitbladExtern(datum?: string): Promise<void> {
  try {
    // no-store: anders kan de SW-cache een signed URL van >1 u teruggeven
    // (controle 05-09, nr. 9 — zelfde regel als de viewer).
    const res = await apiFetch(ritbladMetaPad(datum), { cache: 'no-store' });
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
