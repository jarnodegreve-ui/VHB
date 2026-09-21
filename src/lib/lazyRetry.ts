import { lazy, type ComponentType } from 'react';

const RELOAD_FLAG = 'vhb-chunk-reload';

/**
 * React.lazy met vangnet voor mislukte chunk-imports. Twee scenario's die in
 * een PWA anders in het hele-app-crashscherm eindigen:
 * - haperend netwerk onderweg: één stille retry na korte pauze;
 * - verlopen chunk-hash na een deploy (oude index.html verwijst naar een
 *   asset dat niet meer bestaat): een reload op de vérse shell. De
 *   sessionStorage-vlag voorkomt een reload-lus.
 *
 * Waarom een gewone reload niet volstaat (melding Jarno 09-09, "beheer-tabs
 * openen niet meer op mobiel"): een verdwenen asset geeft géén 404. De
 * SPA-rewrite van Vercel beantwoordt élk onbekend pad met 200 + index.html,
 * dus de dynamische import krijgt HTML terug en klapt op het parsen. De
 * service worker serveert navigaties network-first mét een timeout van 3 s;
 * op een traag mobiel netwerk komt daarna dezelfde oude shell uit de cache en
 * blijft de app in exact dezelfde fout hangen — stil, want alleen de lazy
 * schermen (Gebruikers, Activiteit, …) breken; de hoofdbundel werkt door.
 * Daarom eerst de wachtende service worker activeren en de shell-cache
 * weggooien, en pas dán herladen.
 */

/** Nieuwe versie laten aantreden en de oude shell weggooien. Best-effort:
 *  elke stap mag falen, de reload erna is wat telt. */
async function forceerVerseShell(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    if (reg) {
      await reg.update().catch(() => {});
      // Staat de nieuwe versie te wachten (de gebruiker klikte "Vernieuw"
      // niet weg of zag de melding nooit), laat hem nú aantreden.
      reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
    }
  } catch {
    // geen service worker of geen toegang — geeft niet
  }
  try {
    // Alleen de app-shell-caches (per build gestempeld). De ritbladen-cache
    // is build-onafhankelijk en blijft staan, zodat offline ritbladen niet
    // sneuvelen door een deploy-hik.
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('vhb-portaal-')).map((k) => caches.delete(k)));
  } catch {
    // Cache API geblokkeerd (privémodus) — de reload haalt dan gewoon vers op
  }
}

/** Laatste redmiddel: melding met een knop die alsnog vers herlaadt, zodat
 *  een leeg scherm nooit het eindstation is. */
function meldVastgelopenVersie(): void {
  try {
    window.dispatchEvent(new CustomEvent('vhb-toast', {
      detail: {
        message: 'Dit scherm hoort bij een oudere versie van het portaal. Vernieuw om verder te gaan.',
        tone: 'error',
        action: {
          label: 'Vernieuwen',
          run: () => { void forceerVerseShell().then(() => window.location.reload()); },
        },
        opties: { duurMs: 30_000 },
      },
    }));
  } catch {
    // geen window/CustomEvent — dan blijft alleen de fout over
  }
}

// `ComponentType<any>`, zoals React.lazy zelf: props zijn contravariant, dus
// onder `strict` past geen enkele component met eigen props in
// `ComponentType<unknown>` (dat gaf 89 van de 130 strict-fouten, 21-09).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function lazyWithRetry<T extends ComponentType<any>>(factory: () => Promise<{ default: T }>) {
  return lazy(async () => {
    try {
      const mod = await factory();
      sessionStorage.removeItem(RELOAD_FLAG);
      return mod;
    } catch (err) {
      try {
        await new Promise((resolve) => setTimeout(resolve, 800));
        const mod = await factory();
        sessionStorage.removeItem(RELOAD_FLAG);
        return mod;
      } catch {
        if (!sessionStorage.getItem(RELOAD_FLAG)) {
          sessionStorage.setItem(RELOAD_FLAG, '1');
          await forceerVerseShell();
          window.location.reload();
          // Reload is onderweg — laat de Suspense-fallback staan i.p.v. te crashen.
          return new Promise<{ default: T }>(() => {});
        }
        // Tweede keer mis: niet nog eens herladen (lus), wel uitleggen wat er
        // aan de hand is in plaats van een leeg scherm achter te laten.
        meldVastgelopenVersie();
        throw err;
      }
    }
  });
}
