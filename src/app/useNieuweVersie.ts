import { useEffect } from 'react';
import type { Toast } from '../components/ToastStack';
import { abonneerOnline, isOnlineNu } from '../lib/useOnline';

export const NIEUWE_VERSIE_TEKST = 'Er staat een nieuwe versie van het portaal klaar.';

/**
 * De melding "nieuwe versie klaar" met de knop Vernieuw. Tot 07-10 stond dit
 * in App.tsx (stap 3 van de splitsing); de code is verplaatst, niet
 * herschreven. `showToast` komt uit useToasts.
 */
export function useNieuweVersie(showToast: (message: string, tone: Toast['tone'], action?: Toast['action']) => void) {
  // Nieuwe versie klaar: de SW blijft wachten (geen auto-skipWaiting meer,
  // zie public/sw.js) — wij melden het met een "Vernieuw"-actie. Pas na die
  // klik activeert de nieuwe SW en herlaadt index.html de app; een deploy
  // gooit dus nooit meer een half ingevuld formulier weg.
  //
  // Eén melding per wachtende versie (melding Jarno 09-09): de toast kwam
  // terug bij élke terugkeer naar de app zolang je niet op "Vernieuw" klikte,
  // dus wie hem wegklikte kreeg hem bij elke app-wissel opnieuw en het leek
  // alsof er telkens een nieuwe versie was. We onthouden welke wachtende
  // worker we al aanboden; een échte nieuwe deploy is een ander object en
  // wordt dus wél opnieuw gemeld.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    let gestopt = false;
    let alGemeld: ServiceWorker | null = null;
    const meldUpdate = (reg: ServiceWorkerRegistration) => {
      const wachtend = reg.waiting;
      // Alleen bij een échte vervanging: zonder controller is dit de eerste
      // installatie en valt er niets te vernieuwen.
      if (!wachtend || !navigator.serviceWorker.controller || gestopt) return;
      if (wachtend === alGemeld) return;
      // Niet aanbieden zonder netwerk: "Vernieuw" activeert de nieuwe SW en
      // herlaadt; offline was dat een wit scherm zodra de nieuwe cache leeg
      // bleek (controle-ronde 27-08, bevinding 6). Zodra het netwerk terug is,
      // meldt de online-listener hieronder het alsnog. Op de échte status
      // (online-store, met ping): `navigator.onLine` is op bus-wifi zonder
      // internet true en bood de toast dan tóch aan.
      if (!isOnlineNu()) return;
      alGemeld = wachtend;
      showToast(NIEUWE_VERSIE_TEKST, 'info', {
        label: 'Vernieuw',
        run: () => wachtend.postMessage({ type: 'SKIP_WAITING' }),
      });
    };
    let registratie: ServiceWorkerRegistration | null = null;
    const bijZichtbaar = () => {
      if (document.visibilityState === 'visible' && registratie) meldUpdate(registratie);
    };
    // Terug online (store-overgang false → true): het uitgestelde aanbod alsnog doen.
    let wasOnline = isOnlineNu();
    const stopOnline = abonneerOnline(() => {
      const nu = isOnlineNu();
      if (nu && !wasOnline && registratie) meldUpdate(registratie);
      wasOnline = nu;
    });
    navigator.serviceWorker.getRegistration().then((reg) => {
      if (!reg || gestopt) return;
      registratie = reg;
      meldUpdate(reg);
      reg.addEventListener('updatefound', () => {
        const nieuwe = reg.installing;
        nieuwe?.addEventListener('statechange', () => {
          if (nieuwe.state === 'installed') meldUpdate(reg);
        });
      });
      document.addEventListener('visibilitychange', bijZichtbaar);
    });
    return () => {
      gestopt = true;
      document.removeEventListener('visibilitychange', bijZichtbaar);
      stopOnline();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
