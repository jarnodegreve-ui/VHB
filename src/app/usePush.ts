import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { Toast } from '../components/ToastStack';
import type { User, View } from '../types';
import { deviceHeaders } from '../lib/device';
import { laatSchrijffout } from '../lib/foutenLui';
import { fetchPushPublicKey, getExistingSubscription, hersyncPushSubscription, isPushSupported, subscribeToPush, unsubscribeFromPush } from '../lib/push';
import { routeUitUrl } from './router';

type ShowToast = (message: string, tone: Toast['tone'], action?: Toast['action']) => void;

/**
 * Push-notificaties: de VAPID-sleutel van de server, de schakelaar en het
 * abonnement van dit toestel. Tot 07-10 stond dit in App.tsx (stap 3 van de
 * splitsing); de code is verplaatst, niet herschreven. `resetPush` is wat
 * App bij het wissen van de accountstaat deed (`setPushEnabled(false)`).
 */
export function usePush({ currentUser, session, showToast }: {
  currentUser: User | null;
  session: Session | null;
  showToast: ShowToast;
}) {
  // Push-notificaties: key=null betekent dat de server geen VAPID-keys heeft
  // (feature uit) — de knop verschijnt dan niet.
  const [pushPublicKey, setPushPublicKey] = useState<string | null>(null);
  const [pushEnabled, setPushEnabled] = useState(false);

  useEffect(() => {
    if (!currentUser || !session?.access_token || !isPushSupported()) return;
    let cancelled = false;
    const headers = { Authorization: `Bearer ${session.access_token}`, ...deviceHeaders() };
    (async () => {
      const key = await fetchPushPublicKey(headers);
      if (cancelled) return;
      setPushPublicKey(key);
      if (key) {
        const existing = await getExistingSubscription();
        if (cancelled) return;
        // Geen abonnement meer terwijl de schakelaar aan stond (push-service
        // of iOS ruimde het op) → de schakelaar toont eerlijk "uit".
        setPushEnabled(Boolean(existing));
        // Wél een abonnement: hooguit 1× per 24 u opnieuw registreren, zodat
        // een rij die de server na een 410 wiste terugkomt (nr. 8).
        if (existing) void hersyncPushSubscription(existing, headers);
      }
    })();
    // De service worker meldt een vervangen abonnement (pushsubscriptionchange
    // in sw.js); hij heeft zelf geen token, dus de app registreert het.
    const onBericht = (event: MessageEvent) => {
      if (event.data?.type !== 'PUSH_SUBSCRIPTION_CHANGED') return;
      const sub = event.data.subscription as PushSubscriptionJSON | null;
      if (!sub?.endpoint) {
        setPushEnabled(false);
        return;
      }
      void hersyncPushSubscription(sub, headers, { force: true }).then((ok) => { if (ok) setPushEnabled(true); });
    };
    const sw = 'serviceWorker' in navigator ? navigator.serviceWorker : null;
    sw?.addEventListener('message', onBericht);
    return () => {
      cancelled = true;
      sw?.removeEventListener('message', onBericht);
    };
  }, [currentUser?.id, session?.access_token]);

  const togglePush = async () => {
    if (!pushPublicKey || !session?.access_token) return;
    const headers = { Authorization: `Bearer ${session.access_token}`, ...deviceHeaders() };
    if (pushEnabled) {
      await unsubscribeFromPush(headers);
      setPushEnabled(false);
      showToast('Meldingen uitgeschakeld.', 'info');
      return;
    }
    const result = await subscribeToPush(pushPublicKey, headers);
    if (result === 'subscribed') {
      setPushEnabled(true);
      showToast('Meldingen ingeschakeld, je krijgt voortaan een seintje bij planning, verlof en dienstruil.', 'success');
    } else if (result === 'denied') {
      showToast('Meldingen geweigerd, sta notificaties toe in je browserinstellingen en probeer opnieuw.', 'info');
    } else {
      laatSchrijffout('Meldingen inschakelen', undefined, (tekst) => showToast(tekst, 'error', { label: 'Opnieuw proberen', run: () => void togglePush() }));
    }
  };

  const resetPush = () => setPushEnabled(false);

  return { pushPublicKey, pushEnabled, togglePush, resetPush };
}

/**
 * Tik op een melding terwijl het portaal al open staat: de service worker
 * stuurt een NAVIGATE-bericht (sw.js notificationclick) in plaats van het
 * venster te herladen, zodat een open formulier blijft staan.
 */
export function useMeldingNavigatie(navigeer: (view: View, opts?: { params?: readonly string[] }) => void) {
  // Deeplink terwijl het portaal al open staat: de service worker stuurt bij
  // een tik op een melding een NAVIGATE-bericht i.p.v. het venster te
  // herladen (zie sw.js notificationclick) — een open formulier blijft zo
  // staan. Onbekende views negeren; de rol-guard doet de rest.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const onMessage = (event: MessageEvent) => {
      if (event.data?.type !== 'NAVIGATE') return;
      const route = routeUitUrl(String(event.data.url ?? ''));
      if (route) navigeer(route.view, { params: route.params });
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [navigeer]);
}
