import { useEffect, useMemo, useState } from 'react';
import type { User } from '../types';
import { metRetry } from '../lib/lazyRetry';
import { telRuilenDieOpMijWachten } from '../lib/ruilWachtOpMij';
import type { Werkvoorraad } from '../lib/werkvoorraad';
import type { AppData } from './useAppData';

/**
 * Badges en werkvoorraad: de tellers op de navigatie, de werkvoorraad van
 * de planner en de badge op het app-icoon. Tot 07-10 stond dit in App.tsx
 * (stap 4 van de splitsing); de code is verplaatst, niet herschreven.
 */

// Startbundel-trim (fase 2, 22-09; de andere twee stukken staan in
// app/AppSchil.tsx): de werkvoorraad-berekening (lib/werkvoorraad) laadt
// zodra de rol staf is (effect hieronder in App); chauffeurs halen haar
// nooit op. Dezelfde module zit in de chunks van WerkvoorraadMenu, het
// plannerdashboard en het werkvoorraadscherm, dus ze wordt één gedeelde chunk.
type WerkvoorraadModule = typeof import('../lib/werkvoorraad');
const laadWerkvoorraad = metRetry(() => import('../lib/werkvoorraad'));

/** De tellers voor de badges op de navigatie. */
export function useBadges(currentUser: User | null, data: Pick<AppData, 'leaveRequests' | 'lastSeenLeaveDecisionAt' | 'swaps' | 'swapsGeladen' | 'usersGeladen'>) {
  const { leaveRequests, lastSeenLeaveDecisionAt, swaps, swapsGeladen, usersGeladen } = data;
  // Ziekte telt niet mee (Jarno 06-10): een ziekmelding is geen beslissing
  // over een aanvraag, en het Verlof-scherm toont ze niet, dus kon de
  // chauffeur het cijfer nooit wegkrijgen.
  const unseenLeaveDecisionCount = currentUser
    ? leaveRequests.filter((r) =>
        r.userId === currentUser.id &&
        r.type !== 'ziekte' &&
        !!r.decidedAt &&
        r.status !== 'pending' &&
        (!lastSeenLeaveDecisionAt || r.decidedAt > lastSeenLeaveDecisionAt),
      ).length
    : 0;

  // Rusttijd-overtredingen in de geladen planning (sidebar-badge) — alleen
  // relevant voor planner/admin; chauffeurs hebben enkel hun eigen shifts.

  // Wachtende beslissingen voor planner/admin (sidebar badges op
  // Verlofbeheer en Dienstruil-tab).
  // Rooster en dienstruil tonen per dienst of er al een ruil loopt en met
  // wie er geruild is: die schermen wachten op ruilen én namen. Voor staf
  // zitten beide in de poort; chauffeurs laden ze er direct na (useAppData).
  const ruilDataKlaar = swapsGeladen && usersGeladen;
  const pendingLeaveCount = leaveRequests.filter((r) => r.status === 'pending').length;
  // Zelfde definitie als de cockpit: 'accepted' wacht óók op de planner
  // (validatie), dus telt mee als open werkvoorraad.
  const pendingSwapsCount = swaps.filter((s) => s.status === 'pending' || s.status === 'accepted').length;
  // Voor chauffeurs: ruilen die op míjn antwoord wachten (badge op het
  // nav-item + dot op de "Meer"-tab, anders mist de collega het verzoek).
  // Zelfde regel als het paneel "Wacht op jouw antwoord" op het dashboard
  // (lib/ruilWachtOpMij): ook een goedgekeurde ruil die hij nog moet bevestigen.
  const targetedSwapsCount = currentUser && currentUser.role === 'chauffeur'
    ? telRuilenDieOpMijWachten(swaps, currentUser.id)
    : 0;

  return { unseenLeaveDecisionCount, ruilDataKlaar, pendingLeaveCount, pendingSwapsCount, targetedSwapsCount };
}

/** De werkvoorraad van de planner, één berekening voor topbar, app-badge en dashboard. */
export function useWerkvoorraad(currentUser: User | null, data: Pick<AppData, 'users' | 'shifts' | 'leaveRequests' | 'swaps' | 'planningMatrixHistory' | 'coverageDays' | 'vervaldata' | 'pendingDevices'>) {
  const { users, shifts, leaveRequests, swaps, planningMatrixHistory, coverageDays, vervaldata, pendingDevices } = data;
  // Werkvoorraad van de planner — gedeelde berekening (lib/werkvoorraad) voor
  // de topbar-knop, de app-icoon-badge én het Open taken-paneel op het
  // dashboard, zodat die drie nooit uiteenlopen. Op de échte rol berekend
  // (data blijft kloppen in chauffeur-preview; de knop verdwijnt daar wel).
  const isStafRol = currentUser?.role === 'planner' || currentUser?.role === 'admin';
  // Achter useMemo (ronde 3, 19-09): dit liep bij élke App-render (scroll,
  // toast-timer, laadteller) en bevat een volledige pass over alle shifts ×
  // goedgekeurd verlof (openstaandeDienstenVanAfwezigen). De minuutsleutel
  // houdt de tijdsafhankelijke delen (vandaag, dagen sinds import) eerlijk
  // zonder een eigen klok: hooguit één herberekening per minuut.
  const minuutSleutel = Math.floor(Date.now() / 60_000);
  // De berekening zelf staat niet in de startbundel (fase 2, 22-09): de module
  // laadt zodra de rol staf is en blijft daarna in state; tot ze er is, is de
  // werkvoorraad null (de topbar houdt het plekje vrij, de app-badge telt 0,
  // net als vroeger vóór de data binnen was). Voor chauffeurs laadt ze nooit.
  const [werkvoorraadModule, setWerkvoorraadModule] = useState<WerkvoorraadModule | null>(null);
  useEffect(() => {
    if (!isStafRol || werkvoorraadModule) return;
    let actief = true;
    laadWerkvoorraad().then((m) => { if (actief) setWerkvoorraadModule(() => m); }).catch(() => {});
    return () => { actief = false; };
  }, [isStafRol, werkvoorraadModule]);
  const werkvoorraad = useMemo<Werkvoorraad | null>(
    () => (isStafRol && werkvoorraadModule
      ? werkvoorraadModule.berekenWerkvoorraad({
          users, shifts, leaveRequests, swaps,
          matrixHistory: planningMatrixHistory, coverageDays,
          vervaldata, pendingDevices, now: new Date(),
        })
      : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isStafRol, werkvoorraadModule, users, shifts, leaveRequests, swaps, planningMatrixHistory, coverageDays, vervaldata, pendingDevices, minuutSleutel],
  );

  return { isStafRol, werkvoorraad };
}

/** De badge op het app-icoon; geeft de getoonde teller terug. */
export function useAppBadge(currentUser: User | null, isStafRol: boolean, werkvoorraad: Werkvoorraad | null, ongelezenMeldingen: number) {
  // Badge op het app-icoon (iOS 16.4+ PWA, Chromium-desktop): wat op jou
  // wacht, zichtbaar zonder de app te openen. Chauffeur: ongelezen meldingen
  // (meldingencentrum, 06-09 — ruilverzoeken en nieuwe documenten zitten
  // daar als melding in; was ruil + documenten); planner/admin: de volledige
  // werkvoorraad (zelfde teller als de topbar-knop — was alleen verlof+ruil).
  // Elke niet-stafrol (chauffeur én technieker) krijgt de meldingenteller;
  // de technieker viel er eerst tussenuit (geen chauffeur, geen werkvoorraad)
  // en had daardoor altijd badge 0, ook met open gele-boek-meldingen.
  const appBadgeCount = !currentUser
    ? 0
    : isStafRol
      ? werkvoorraad?.attentionCount ?? 0
      : ongelezenMeldingen;
  useEffect(() => {
    const nav = navigator as any;
    if (typeof nav?.setAppBadge !== 'function') return;
    try {
      if (appBadgeCount > 0) void Promise.resolve(nav.setAppBadge(appBadgeCount)).catch(() => {});
      else void Promise.resolve(nav.clearAppBadge?.()).catch(() => {});
    } catch { /* badging niet ondersteund — stil */ }
  }, [appBadgeCount]);

  return appBadgeCount;
}
