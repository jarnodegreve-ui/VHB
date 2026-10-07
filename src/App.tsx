/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, Suspense, useState, useEffect, useRef } from 'react';
import { useRoute, routeUitUrl, neemStartDoel } from './app/router';
import { isBreed, magView, routeVan, sectieLabel } from './app/routes';
import { SessieLaden, ProfielLaden, ConfigOntbreekt, PrintLaden } from './app/PreAppScreens';
import { bepaalTweeStapsStap, leesTweeStapsStatus } from './lib/tweeStaps';
import { GEDEELD_TOESTEL_EVENT, isGedeeldToestel, useInactiviteitsUitlog } from './lib/inactiviteit';
import { AppSkeleton, heeftOpgeslagenSessie } from './app/AppSkeleton';
import { useAppData } from './app/useAppData';
import { antwoordUitCache } from './app/data/kern';
import { naOpruimen, useLaag } from './lib/lagen';
import { RITBLAD_BUNDEL_EVENT } from './lib/ritblad';
import type { Session } from '@supabase/supabase-js';
import { View, User, isStaf } from './types';
import { isSupabaseConfigured, supabase } from './lib/supabase';
import { LOGIN_MELDING_KEY, vergeetEffectiefThema, type ToastEventDetail } from './lib/ui';
import { AFGEMELD, type AfmeldBereik, bereikVanAfmelding, bevestigGebruiker, borgGebruiker, kanHerladen, magProfiel, meldAfBijSupabase, onthoudGebruiker, wisPriveCaches } from './lib/afmelden';
import { apiFetch, isToestelGeblokkeerd, vernieuwSessie } from './lib/api';
import { useToasts } from './app/useToasts';
import { useLiveUpdates } from './app/useLiveUpdates';
import { useNieuweVersie } from './app/useNieuweVersie';
import { useMeldingNavigatie, usePush } from './app/usePush';
import { useAppBadge, useBadges, useWerkvoorraad } from './app/useBadges';
import { lazyWithRetry } from './lib/lazyRetry';
import { WARMUP_VIEWS, prefetchView, warmViews } from './app/viewLoaders';
import { addBreadcrumb, setMonitoringUser } from './lib/monitoring';
import { useAanwezigheid } from './lib/presence';
import { isPushSupported, unsubscribeFromPush } from './lib/push';
import { deriveDeviceName, deviceHeaders } from './lib/device';
import { usePullToRefresh } from './lib/usePullToRefresh';
import { useThema } from './app/useThema';
import { abonneerOnline, isOnlineNu, useOnline } from './lib/useOnline';
import { useOnderhoud } from './app/useOnderhoud';
import { LoginView } from './views/LoginView';
import { UITNODIGING_HASH } from '../shared/uitnodigingHash';
import { ververRealtimeToken } from './lib/realtime';
import { AppSchil, laadWerkvoorraadMenu, laadAccountOverlays } from './app/AppSchil';
// Print-modus (?print-…=) lui: zelden gebruikt, dus niet in de startbundel (P5).
const LazyPrintModus = lazyWithRetry(() => import('./app/PrintModus'));
const PRINT_PARAM = /[?&](print-(driver|gele-boek|rapport|verlof-driver)|ruiloverzicht-week)=/;
const LazyToestelGeblokkeerd = lazyWithRetry(() => import('./app/ToestelGeblokkeerd').then((m) => ({ default: m.ToestelGeblokkeerd })));
const LazyTweeStapsScherm = lazyWithRetry(() => import('./app/TweeStapsScherm').then((m) => ({ default: m.TweeStapsScherm })));
const LazyUitnodiging = lazyWithRetry(() => import('./app/UitnodigingScherm').then((m) => ({ default: m.UitnodigingScherm })));

/** Rol van de vorige geslaagde start op dit toestel: alleen een hint voor
 *  wát er bij de boot parallel mag starten (2FA-status), nooit voor toegang. */
const LAST_ROLE_KEY = 'vhb-last-role';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  // Eén keer bij het opstarten bepaald: warme start = er is al een sessie.
  const [warmeStart] = useState(() => typeof window !== 'undefined' && heeftOpgeslagenSessie());
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  // Waar we zijn = de URL (src/app/router.ts): terugknop, deeplinks en
  // refresh-op-dezelfde-plek werken daardoor vanzelf.
  const { view: currentView, navigeer } = useRoute();
  // Aanwezigheid (staf ziet elkaar in de topbar) + broodkruimel per schermwissel (foutrapporten).
  useAanwezigheid(!!session && !!currentUser, { userId: String(currentUser?.id ?? ''), naam: currentUser?.name ?? '', rol: currentUser?.role, view: currentView });
  useEffect(() => { addBreadcrumb('navigatie', currentView); }, [currentView]);
  // Aankomen op het scherm waar een melding naar wijst = die melding gelezen
  // (ook via een push-tik of deeplink); de bel- en app-badge zakken meteen
  // mee in plaats van te blijven staan tot iemand het meldingenscherm opent.
  useEffect(() => {
    if (!currentUser) return;
    markeerMeldingenGelezenVoorScherm(currentView, (doel) => routeUitUrl('/' + doel.replace(/^\/+/, ''))?.view ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentView, currentUser?.id]);
  // Netwerkstatus uit de online-store (src/lib/useOnline.ts): dezelfde
  // waarheid als Mijn dag en de ritbladviewer, mét ping-fallback voor
  // "wifi zonder internet". Bij terug-online meteen stil bijverversen; via
  // een ref, want het effect heeft lege deps en zou anders een verouderde
  // currentUser vasthouden.
  const isOnline = useOnline();
  const onlineCatchUpRef = useRef<() => void>(() => {});
  useEffect(() => {
    let vorige = isOnlineNu();
    return abonneerOnline(() => {
      const nu = isOnlineNu();
      if (nu && !vorige) onlineCatchUpRef.current();
      vorige = nu;
    });
  }, []);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  // Admin-only preview: toont het portaal (nav + dashboard) zoals een chauffeur
  // het ziet. Puur visueel — rechten/data blijven admin. Reset bij herladen.
  const [previewChauffeur, setPreviewChauffeur] = useState(false);
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false);
  // Uitnodiging uit de mail (#uitnodiging=<code>, shared/uitnodiging.ts). De
  // code blijft in de adresbalk tot de landing geladen is (die haalt haar
  // weg): herlaadt lazyRetry na een mislukte chunk, dan is ze er nog. Wie al
  // aangemeld is, laat ze liggen (zie de bootstrap).
  const [uitnodiging, setUitnodiging] = useState<string | null>(() => {
    const { hash } = window.location;
    return hash.startsWith(UITNODIGING_HASH) ? hash.slice(UITNODIGING_HASH.length) || null : null;
  });
  const [showChangePassword, setShowChangePassword] = useState(false);
  // "Meld een probleem" (testfase): vrije tekst → client_errors met bron
  // 'gebruikersmelding', zichtbaar in Systeem Status en de dagoverzicht-mail.
  const [showProbleemMelder, setShowProbleemMelder] = useState(false);
  const [showAgenda, setShowAgenda] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);
  const [viewFoutReset, setViewFoutReset] = useState(0);
  const { theme, toggleTheme } = useThema(currentUser);
  const isPasswordRecoveryRef = useRef(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // Navigeren = bovenaan beginnen; terug = de oude positie terug. Dat zit
  // sinds 15-09 (punt 19) in de router zelf (scrollgeheugen per route,
  // src/lib/scrollGeheugen.ts): vroeger scrolde deze wrapper vóór elke
  // navigeer naar 0 (controle-ronde 27-08, bevinding 10), maar dan was de
  // positie al weg voordat de router hem kon bewaren, en bij popstate
  // landde je willekeurig. De router scrolt nog steeds vóór de nieuwe view
  // rendert, zodat een view die bij het openen zelf scrolt het laatste
  // woord houdt; dezelfde tab nog eens kiezen = ook naar boven.
  const setCurrentView = useCallback((next: View) => {
    navigeer(next);
  }, [navigeer]);
  // Tik op een melding terwijl het portaal open staat (src/app/usePush.ts).
  useMeldingNavigatie(navigeer);
  const ptrIndicatorRef = useRef<HTMLDivElement>(null);
  // Ruil starten vanuit het rooster: de gekozen dienst wordt in de ruil-wizard
  // voorgeselecteerd.
  const [swapPreselectShiftId, setSwapPreselectShiftId] = useState<string | null>(null);
  // Datalaag (src/app/useAppData.ts, per domein in src/app/data/*).
  // showToast/meldLaadfout staan verderop als const — de wrappers roepen ze
  // pas aan op het moment van gebruik. `appData` gaat ook als geheel de
  // AppDataProvider in (rond de schil), zodat views het via
  // useAppDataContext() kunnen lezen i.p.v. via een stapel props.
  const appData = useAppData({
    session,
    currentUser,
    currentView,
    showToast: (m, t, a, o) => showToast(m, t, a, o),
    meldLaadfout: (b, f) => meldLaadfout(b, f),
  });
  const {
    shifts, users, swaps, leaveRequests, lastSeenLeaveDecisionAt, unseenDocuments,
    planningMatrixHistory, coverageDays, vervaldata, pendingDevices,
    isInitialLoad, setIsInitialLoad, lastSyncedAt, setLastSyncedAt,
    usersGeladen, swapsGeladen,
    loadAppData, refreshAll, resetAll,
    fetchUpdates, fetchSwaps, fetchLeave, markDocumentsSeen,
    fetchPlanningMatrix, fetchPlanningMatrixHistory, refreshCoverageGaps,
    fetchMyNotes,
    fetchUsers, fetchPlanning, fetchDiversions,
    fetchMeldingen, ongelezenMeldingen, markeerMeldingenGelezenVoorScherm,
  } = appData;
  // Staat de sessie op uitloggen? Dan zijn alle lopende calls gedoemd en
  // onderdrukken we hun individuele fout-toasts (zie showToast/forceSignOut).
  const sessieBeeindigdRef = useRef(false);
  // Staat het toestel-wachtscherm (device_pending/revoked)? Dan faalt elke
  // call met een toestel-403 en is dat scherm de melding: geen laadfout- of
  // fout-toasts die zich opstapelen en na de goedkeuring verschijnen.
  const toestelGeblokkeerdRef = useRef(false);
  // Toasts en de gebundelde laadfout (src/app/useToasts.ts). De twee vlaggen
  // hierboven blijven van de sessie; de hook leest ze alleen.
  const { toasts, showToast, dismissToast, meldLaadfout, meldOnderhoud, wisFouten, wisToasts } = useToasts({
    sessieBeeindigdRef,
    toestelGeblokkeerdRef,
    opnieuwLaden: () => { void refreshAll(); },
  });
  // Toestel-whitelist: 'pending'/'revoked' → geblokkeerd-scherm i.p.v. de app.
  const [deviceBlocked, zetDeviceBlockedState] = useState<'pending' | 'revoked' | null>(null);
  // Eén setter voor state én ref (de ref lezen showToast/meldLaadfout
  // synchroon, ook in listeners van de eerste render). Blokkeren wist wat er
  // al aan laadfouten klaarstond.
  const setDeviceBlocked = (status: 'pending' | 'revoked' | null) => {
    toestelGeblokkeerdRef.current = status !== null;
    if (status !== null) wisFouten();
    zetDeviceBlockedState(status);
  };
  // Reden van een gedwongen uitlog, door te geven aan het inlogscherm.
  const [uitlogMelding, setUitlogMelding] = useState<'sessie' | 'account' | 'inactief' | ''>('');
  // Dubbele-init-guard: bootstrap én het INITIAL_SESSION/SIGNED_IN-event
  // proberen allebei te initialiseren; per gebruiker doen we het één keer.
  // `initialized` = klaar (blijft na succes); `initializing` = nú bezig, en
  // wordt SYNCHROON bij binnenkomst gezet. Zonder die tweede vlag passeerden
  // bij een koude start beide aanroepers de check vóór de vlag ná de awaits
  // gezet was → alles dubbel gefetcht (toestel-registratie, profiel, ±10
  // loadAppData-calls, aanwezigheids-ping).
  const initializedUserIdRef = useRef<string | null>(null);
  const initializingUserIdRef = useRef<string | null>(null);
  // Lopende toestelregistratie tijdens de parallelle start (punt 19): de
  // 403-listener wacht hierop i.p.v. meteen het wachtscherm te tonen.
  const registratieRef = useRef<Promise<'approved' | 'pending' | 'revoked' | null> | null>(null);
  // Is er in deze pagina een profiel geladen? Alleen dan herlaadt een
  // afmelding de pagina (zie rondAfmeldingAf): zonder profiel is er niets van
  // een account in het geheugen, en zo kan een herlaad nooit de volgende
  // uitlokken.
  const profielGeladenRef = useRef(false);
  // De lopende afronding van een afmelding: knop, gedwongen uitlog en het
  // SIGNED_OUT-event komen bij dezelfde afmelding alle drie langs.
  const afmeldingRef = useRef<Promise<void> | null>(null);
  const setRecoveryMode = (v: boolean) => {
    isPasswordRecoveryRef.current = v;
    setIsPasswordRecovery(v);
  };

  // Op mobiel is de dichte sidebar alleen visueel weggeschoven
  // (-translate-x-full): zonder `inert` bleef hij focusbaar en landde
  // Tab/VoiceOver onzichtbaar buiten beeld. Op lg+ staat hij altijd in
  // beeld en moet hij juist wél bereikbaar blijven.
  const [isDesktopNav, setIsDesktopNav] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const luister = (e: MediaQueryListEvent) => setIsDesktopNav(e.matches);
    mq.addEventListener('change', luister);
    return () => mq.removeEventListener('change', luister);
  }, []);

  // De mobiele zijbalk is een laag in de gedeelde stapel (src/lib/lagen.ts):
  // terugknop/swipe-back sluit hem i.p.v. de app te verlaten, Escape sluit
  // alleen hem, en de scroll-lock (src/lib/scrollSlot.ts) hangt aan dezelfde
  // levensloop, anders kan iOS Safari de aside-inhoud "rubber-banden" of de
  // hoofdpagina laten meebewegen.
  useLaag({ open: isSidebarOpen && !isDesktopNav, sluit: () => setIsSidebarOpen(false), soort: 'zijbalk', scrollSlot: 'zijbalk' });

  // openHuidigRitblad() vraagt met een gebeurtenis of de app de bundel zelf
  // kan tonen; zo blijft de PWA-schil staan en werkt het offline uit de
  // service-worker-cache (controle 16-09, nr. 10).
  const [bundelOpen, setBundelOpen] = useState(false);
  useEffect(() => {
    const onBundel = (e: Event) => {
      e.preventDefault(); // bevestigt aan openHuidigRitblad dat wij het doen
      setBundelOpen(true);
    };
    window.addEventListener(RITBLAD_BUNDEL_EVENT, onBundel);
    return () => window.removeEventListener(RITBLAD_BUNDEL_EVENT, onBundel);
  }, []);
  // Geen eigen history-entry: de Modal van de RitbladViewer is zelf een laag.
  // Een tweede entry hier liet na het kruisje een dode terugstap achter.

  // Live-updates via Supabase Realtime (src/app/useLiveUpdates.ts): de
  // refetchers per collectie; niet zolang het toestel-wachtscherm staat.
  useLiveUpdates(!!session && !!currentUser && !deviceBlocked, currentUser, {
    fetchLeave, fetchSwaps, fetchDiversions, fetchUpdates, fetchMyNotes, fetchMeldingen,
    fetchPlanning, fetchPlanningMatrix, fetchPlanningMatrixHistory, refreshCoverageGaps, fetchUsers,
  });

  // Terug online (offline-banner verdwijnt): zelfde catch-up als realtime —
  // gemiste events zijn definitief weg — en daarna de sync-tijd verversen,
  // zodat "gegevens van HH:MM" bij een volgende uitval klopt.
  onlineCatchUpRef.current = () => {
    if (!currentUser || toestelGeblokkeerdRef.current) return;
    const planningFilter = isStaf(currentUser.role) ? undefined : { driverId: String(currentUser.id) };
    void Promise.allSettled([
      fetchMyNotes(),
      fetchLeave(),
      fetchSwaps(),
      fetchDiversions(undefined, { silent: true }),
      fetchUpdates(),
      fetchPlanning(undefined, planningFilter, { silent: true }),
      ...(isStaf(currentUser.role)
        ? [refreshCoverageGaps(), fetchPlanningMatrix(), fetchPlanningMatrixHistory()]
        : []),
    ]).then(() => {
      if (typeof navigator === 'undefined' || navigator.onLine) setLastSyncedAt(Date.now());
    });
  };

  // Nieuwe versie van het portaal klaar (src/app/useNieuweVersie.ts).
  useNieuweVersie(showToast);

  // Push-notificaties (src/app/usePush.ts): sleutel, schakelaar en abonnement.
  const { pushPublicKey, pushEnabled, togglePush, resetPush } = usePush({ currentUser, session, showToast });
  // Twee-stapsverificatie (staf): tussenscherm vóór de app, zie initializeAuthenticatedApp.
  const [tweeStaps, setTweeStaps] = useState<{ stap: 'code' | 'inschrijven'; factorId: string | null } | null>(null);
  // Gedeeld toestel (Instellingen › Beveiliging): automatisch afmelden na een half uur stilte.
  const [gedeeldToestel, setGedeeldToestel] = useState<boolean>(() => (typeof window !== 'undefined' ? isGedeeldToestel() : false));


  // Onderhoudsmodus (src/app/useOnderhoud.ts): banner boven de inhoud zolang
  // actief; bij een geblokkeerde schrijfactie één info-toast.
  const onderhoud = useOnderhoud(Boolean(currentUser), (tekst) => meldOnderhoud(tekst));

  useEffect(() => {
    let isMounted = true;

    // Zonder client géén listener registreren: de destructure hieronder zou
    // op undefined crashen vóór het config-foutscherm ooit rendert.
    if (!supabase) {
      setAuthReady(true);
      return;
    }

    const bootstrap = async () => {
      if (!supabase) {
        setAuthReady(true);
        return;
      }

      // try/finally: wat er ook misgaat (netwerk, Supabase-lock-hang in een
      // ander tabblad, API-fout), de app mag NOOIT eeuwig op 'Sessie
      // laden…' blijven staan — dan liever terugvallen op het loginscherm.
      try {
        const { data } = await supabase.auth.getSession();
        if (!isMounted) return;

        setSession(data.session);
        if (data.session) {
          // Al aangemeld: een uitnodigingslink opent dan gewoon de app, met
          // een woord uitleg (op een gedeeld toestel eerst afmelden).
          if (uitnodiging) {
            setUitnodiging(null);
            window.history.replaceState(window.history.state, '', window.location.pathname + window.location.search);
            showToast('Uitnodiging niet geopend: je bent al aangemeld. Is ze voor iemand anders, meld dan eerst af.', 'info');
          }
          // Chunk van de landingsview alvast ophalen, parallel met /api/me —
          // anders begon die download pas ná het profiel (prestatiebudget
          // 09-2026). Niet op het loginscherm: daar zou hij het kritieke pad
          // beconcurreren. currentView = de view bij het opstarten (lege deps).
          prefetchView(currentView);
          await initializeAuthenticatedApp(data.session.access_token, data.session.user.id);
        }
      } catch (error) {
        console.error('Auth bootstrap error:', error);
      } finally {
        if (isMounted) setAuthReady(true);
      }
    };

    bootstrap();

    // Watchdog: mocht getSession() tóch blijven hangen (bekend Supabase-
    // fenomeen met meerdere open tabbladen), forceer dan na 8s een render
    // zodat de gebruiker kan inloggen i.p.v. naar een spinner te staren.
    const watchdog = window.setTimeout(() => {
      // Niet tijdens de afronding van een afmelding: die houdt het
      // laadscherm zelf vast tot de herlaad (en heeft haar eigen vangnet).
      if (isMounted && !afmeldingRef.current) setAuthReady(true);
    }, 8000);

    const { data: authListener } = supabase?.auth.onAuthStateChange(async (event, nextSession) => {
      if (!isMounted) return;

      if (event === 'PASSWORD_RECOVERY') {
        setRecoveryMode(true);
        setSession(nextSession);
        setAuthReady(true);
        return;
      }

      // While user is completing a password reset, skip the normal profile
      // bootstrap — the recovery form handles sign-out itself when done.
      if (isPasswordRecoveryRef.current && nextSession) {
        setSession(nextSession);
        setAuthReady(true);
        return;
      }

      setSession(nextSession);
      // TOKEN_REFRESHED/USER_UPDATED: alleen de sessie verversen — een
      // volledige her-init (12 fetches + overlay) elk uur is onnodig en
      // stoort de gebruiker midden in z'n werk.
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        setAuthReady(true);
        return;
      }
      if (nextSession) {
        // Al ingelogd bij het openen: de link is gewoon geopend, er valt na
        // een latere login niets meer naar terug te keren (tranche 3C).
        if (event === 'INITIAL_SESSION') neemStartDoel();
        // Verse sessie: de onderdrukking van fout-toasts en de eenmalige
        // uitlog-guard weer vrijgeven, anders blijft de app na opnieuw
        // inloggen stil bij échte fouten.
        sessieBeeindigdRef.current = false;
        forceSignOutRef.current = false;
        await initializeAuthenticatedApp(nextSession.access_token, nextSession.user.id);
      } else if (event === 'INITIAL_SESSION') {
        // Koude start zonder sessie: geen afmelding, dus niets wissen en
        // nooit herladen. De URL blijft staan (een link naar /verlof/<id>
        // blijft dus ook na een herlaad van het inlogscherm bewaard) en
        // handleLogin gaat er na het inloggen heen (tranche 3C, 23-09). Het
        // browser-push-abonnement gaat wel uit: liep de sessie af terwijl de
        // app dicht was, dan erft een volgende gebruiker op dit toestel geen
        // meldingen van het vorige account.
        if (isPushSupported()) void unsubscribeFromPush({}).catch(() => {});
        wisAccountStaat();
      } else {
        // Een echte afmelding, ook als Supabase ze zelf afkondigt (sessie
        // verlopen, elders afgemeld): zelfde afronding als de knop. Terug naar
        // het dashboard, zodat de volgende gebruiker daar start. Kwam ze niet
        // van de knop of van een gedwongen uitlog en volgt er een herlaad, dan
        // is dit het moment om de uitleg klaar te zetten: de 401 die er
        // vroeger voor zorgde, komt na de herlaad niet meer aan.
        setCurrentView('dashboard');
        if (!forceSignOutRef.current && magHerladen()) {
          forceSignOutRef.current = true;
          noteerUitlogReden('sessie');
        }
        void rondAfmeldingAf();
        return;
      }
      setAuthReady(true);
    });

    return () => {
      isMounted = false;
      window.clearTimeout(watchdog);
      authListener?.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const { detail } = event as CustomEvent<ToastEventDetail>;
      showToast(detail.message, detail.tone, detail.action, detail.opties);
    };

    window.addEventListener('vhb-toast', handler as EventListener);
    return () => window.removeEventListener('vhb-toast', handler as EventListener);
  }, []);

  // Terug uit de achtergrond: de ververs-timer van Supabase staat stil zolang
  // de PWA in de app-switcher hangt, dus na een paar uur is het token bij
  // hervatten verlopen en liep de eerstvolgende call tegen een 401 — precies
  // het patroon achter de trosjes fouten in de log. Hier vernieuwen we vóór er
  // iets geladen wordt; de 401-retry in apiFetch blijft het vangnet.
  useEffect(() => {
    if (!supabase || !session) return;
    const controleer = () => {
      if (document.visibilityState !== 'visible') return;
      const verlooptOp = session.expires_at ? session.expires_at * 1000 : 0;
      // Marge van een minuut: een net-niet-verlopen token is tegen de tijd dat
      // de eerste fetch aankomt alsnog te oud.
      if (verlooptOp && verlooptOp - Date.now() > 60_000) return;
      void vernieuwSessie();
    };
    document.addEventListener('visibilitychange', controleer);
    return () => document.removeEventListener('visibilitychange', controleer);
  }, [session]);

  // Auth-events uit apiFetch (src/lib/api.ts) — die heeft geen toegang tot
  // deze React-state, dus een verlopen sessie, gedeactiveerd account of
  // geblokkeerd toestel komt via window-events hierheen; één plek voor álle
  // API-calls, ook die van App zelf.
  useEffect(() => {
    // De uitleg staat op het inlogscherm (reden 'sessie'). De reden uit het
    // event ging hier al niet mee naar forceSignOut; dat is zo gelaten.
    const onExpired = () => { void forceSignOut(); };
    const onDeviceBlocked = (event: Event) => {
      const code = (event as CustomEvent<{ code?: string }>).detail?.code;
      const blokkeer = (status: 'pending' | 'revoked') => {
        setDeviceBlocked(status);
        void wisPriveCaches(); // ingetrokken/wachtend toestel: geen offline rooster of ritblad meer
      };
      // Parallelle start (punt 19): /api/me en de toestelregistratie lopen
      // tegelijk. Op een gloednieuw toestel geeft /api/me dan 403
      // device_unknown vóórdat de registratie het als eerste toestel heeft
      // goedgekeurd; het oordeel van de registratie wint, dus geen wachtscherm
      // dat meteen weer verdwijnt. Buiten de start (registratie klaar) telt
      // de 403 zoals altijd meteen.
      const lopend = registratieRef.current;
      if (lopend) {
        void lopend.then((status) => { if (status === 'pending' || status === 'revoked') blokkeer(status); });
        return;
      }
      blokkeer(code === 'device_revoked' ? 'revoked' : 'pending');
    };
    // Server zegt 403 mfa_required (staf zonder code in deze sessie): naar het
    // codescherm, of naar inschrijven als er nog geen authenticator is.
    const onMfaRequired = () => {
      void leesTweeStapsStatus().then((status) => {
        setTweeStaps(status?.factorId ? { stap: 'code', factorId: status.factorId } : { stap: 'inschrijven', factorId: null });
      });
    };
    const onGedeeldToestel = (event: Event) => {
      setGedeeldToestel(!!(event as CustomEvent<{ aan: boolean }>).detail?.aan);
    };
    window.addEventListener('vhb-auth-expired', onExpired);
    window.addEventListener('vhb-device-blocked', onDeviceBlocked as EventListener);
    window.addEventListener('vhb-mfa-required', onMfaRequired);
    window.addEventListener(GEDEELD_TOESTEL_EVENT, onGedeeldToestel);
    return () => {
      window.removeEventListener('vhb-auth-expired', onExpired);
      window.removeEventListener('vhb-device-blocked', onDeviceBlocked as EventListener);
      window.removeEventListener('vhb-mfa-required', onMfaRequired);
      window.removeEventListener(GEDEELD_TOESTEL_EVENT, onGedeeldToestel);
    };
  }, []);


  useEffect(() => {
    if (!currentUser) {
      return;
    }

    if (!magView(currentUser, currentView)) {
      navigeer('dashboard', { replace: true });
      showToast('Dit scherm is niet beschikbaar voor jouw rol.', 'info');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, currentView]);



  // Idempotente harde logout vanuit een API-respons (verlopen sessie /
  // gedeactiveerd account). Eén keer per sessie: onAuthStateChange(SIGNED_OUT)
  // wist verder alle state en toont LoginView.
  const forceSignOutRef = useRef(false);
  const forceSignOut = async (reden: 'sessie' | 'inactief' = 'sessie') => {
    if (forceSignOutRef.current) return;
    forceSignOutRef.current = true;
    // Vanaf hier is élke lopende fetch gedoemd: hun catch-blokken mogen geen
    // eigen fout-toast meer tonen (dat waren er vijf tegelijk) en ook niets
    // meer naar de foutenlog sturen. showToast leest deze vlag.
    sessieBeeindigdRef.current = true;
    noteerUitlogReden(reden);
    await meldAf();
  };

  /** De melding hoort thuis op het inlogscherm, niet in een toast die meteen
   *  daarna achter LoginView verdwijnt. Via state (LoginView kan al
   *  gemonteerd zijn) én sessionStorage (overleeft de herlaad). */
  const noteerUitlogReden = (reden: 'sessie' | 'inactief') => {
    setUitlogMelding(reden);
    try { sessionStorage.setItem(LOGIN_MELDING_KEY, reden); } catch { /* privémodus */ }
  };

  /** Herlaadt een afmelding de pagina? Alleen als er in deze pagina een
   *  profiel geladen was, en niet tijdens een wachtwoordherstel: dat scherm
   *  meldt zelf af en gaat door op zijn plaats. */
  const magHerladen = () => profielGeladenRef.current && !isPasswordRecoveryRef.current;

  /** Wat er van het account in de React-state staat, weg. Op zijn plaats:
   *  dit is ook de terugval wanneer herladen niet kan. */
  const wisAccountStaat = () => {
    setRecoveryMode(false);
    setSession(null);
    setCurrentUser(null);
    setMonitoringUser(null);
    resetPush();
    setDeviceBlocked(null);
    setTweeStaps(null);
    initializedUserIdRef.current = null;
    initializingUserIdRef.current = null;
    resetAll();
  };

  /**
   * Eén afronding voor elke afmelding (beveiligingsscan 01-10): de knop, de
   * gedwongen uitlog en de sessie die Supabase zelf beëindigt. Daarna staat er
   * niets van het vorige account meer in het geheugen of in de privé-caches
   * (src/lib/afmelden.ts).
   *
   *  1. State en toasts weg (een toast kan een gedownload bestand vasthouden).
   *  2. De privé-caches weg. Dit loopt ná de laatste netwerkaanroep van de
   *     afmelding (signOut roept de listener pas na zijn eigen verzoek), zodat
   *     een laat antwoord ze niet opnieuw vult.
   *  3. De pagina herladen: alleen dat haalt lopende verzoeken en hun
   *     closures echt weg. Alleen als er in deze pagina een profiel geladen
   *     was, niet tijdens een wachtwoordherstel (dat scherm meldt zelf af en
   *     gaat door), en alleen als de schil er daarna nog is (`kanHerladen`).
   *     Tot de herlaad staat het laadscherm er, niet het inlogscherm: dat
   *     zou anders de melding uit sessionStorage al verbruiken, en wat iemand
   *     er intikt ging met de herlaad verloren.
   *
   * Geen lus: herladen vraagt een profiel dat in déze pagina geladen is. Na
   * de herlaad is er geen sessie meer (signOut haalde ze uit de opslag), dus
   * ook geen profiel; een start zonder profiel herlaadt nooit.
   */
  const rondAfmeldingAf = (): Promise<void> => (afmeldingRef.current ??= (async () => {
    const herlaad = magHerladen();
    // Wat nog onderweg is, strandt: geen fout-toasts meer.
    sessieBeeindigdRef.current = true;
    setAuthReady(!herlaad);
    wisAccountStaat();
    wisToasts();
    vergeetEffectiefThema();
    // De privé-caches gaan weg en zijn van niemand meer: wie hierna start,
    // doorloopt de volledige controle (zie AFGEMELD).
    onthoudGebruiker(AFGEMELD);
    // Het lokale push-abonnement moet weg zijn vóór de herlaad het afbreekt.
    await Promise.all([wisPriveCaches(), isPushSupported() ? unsubscribeFromPush({}).catch(() => {}) : null]);
    if (herlaad && await kanHerladen(isOnlineNu())) {
      // Via de lagenstapel: stond er een menu, paneel of venster open, dan
      // ruimt dat bij het sluiten zijn stap in de historiek op, en zo'n
      // terugstap breekt een herlaad die al onderweg is weer af.
      naOpruimen(() => window.location.reload());
      // Vangnet: blijft de herlaad uit, dan komt het inlogscherm alsnog op
      // zijn plaats; bij een herlaad sterft deze wachttijd met de pagina.
      await new Promise((klaar) => window.setTimeout(klaar, 5000));
    }
    afmeldingRef.current = null;
    setAuthReady(true);
  })());

  /** Afmelden bij Supabase, daarna de afronding. De push-afmelding gaat
   *  voor: die heeft nog een geldig token nodig. Alles best-effort, het
   *  afmelden mag nooit blijven hangen. `bereik`: alleen dit toestel of elke
   *  sessie van het account (src/lib/afmelden.ts); de gedwongen uitlog blijft
   *  bij elke sessie. */
  const meldAf = async (bereik: AfmeldBereik = 'global') => {
    try {
      if (session?.access_token && isPushSupported()) {
        await unsubscribeFromPush({ Authorization: `Bearer ${session.access_token}`, ...deviceHeaders() });
      }
    } catch { /* best-effort */ }
    // Ook als signOut faalt, is de sessie hierna uit de opslag.
    await meldAfBijSupabase(supabase?.auth, bereik);
    // signOut vuurt SIGNED_OUT en de listener rondt al af; faalt signOut
    // zelf, dan blijft dat event uit en doet deze aanroep het werk.
    await rondAfmeldingAf();
  };

  // apiFetch + vernieuwSessie staan in src/lib/api.ts: één implementatie voor
  // App én de losse views/lib-helpers (controle-ronde 27-08, bevinding 19).
  // Verlopen sessie / gedeactiveerd account / geblokkeerd toestel komen via
  // window-events terug (zie de listener hierboven).

  /** Beveiligingsstatus die /api/me voor staf meestuurt (punt 19); ontbreekt
   *  bij een oudere server of de e2e-mock, dan valt de init terug op
   *  /api/me/beveiliging. */
  type ProfielBeveiliging = { mfaVerplicht?: boolean; aal?: 'aal1' | 'aal2' };

  const fetchCurrentUser = async (accessToken: string, cacheMag: boolean): Promise<{ appUser: User; beveiliging: ProfielBeveiliging | null; uitCache: boolean }> => {
    const response = await apiFetch('/api/me', { accessToken });
    const uitCache = antwoordUitCache(response);
    // Zonder deze checks werd een JSON-errorbody ({error: ...}) als
    // gebruiker gezet → crash op currentUser.name verderop. Een profiel uit
    // de cache van de service worker telt niet voor iemand anders dan de
    // vorige gebruiker van dit toestel: dan is het het profiel van die vorige.
    if (!response.ok || !magProfiel(uitCache, cacheMag)) {
      throw new Error('Profiel kon niet geladen worden.');
    }
    const data = await response.json();
    if (!data?.id || !data?.role) {
      throw new Error('Ongeldig profiel-antwoord van de server.');
    }
    // /api/me draagt sinds punt 19 ook `toestel` (oordeel over dit toestel)
    // en, voor staf, `beveiliging`; die horen niet in het User-object.
    const { toestel: _toestel, beveiliging, ...appUser } = data as User & { toestel?: unknown; beveiliging?: ProfielBeveiliging };
    setCurrentUser(appUser);
    profielGeladenRef.current = true;
    setMonitoringUser(String(appUser.id), appUser.role);
    forceSignOutRef.current = false; // geldige sessie → her-arm de auto-logout
    return { appUser, beveiliging: beveiliging && typeof beveiliging === 'object' ? beveiliging : null, uitCache };
  };


  // Pull-to-refresh (PWA): sleep omlaag bovenaan → alle data opnieuw ophalen.
  // `enabled` op !!currentUser zodat de hook (her)bindt zodra de scroll-
  // container gemonteerd is (bij de koude start bestaat die nog niet).
  const { refreshing: ptrRefreshing } = usePullToRefresh(scrollContainerRef, ptrIndicatorRef, refreshAll, !!currentUser);

  /** Meldt dit toestel aan bij de server (toestel-whitelist). Faalt stil:
   *  bij een netwerk-/serverfout laten we de app gewoon door — de server-gate
   *  in de API blijft sowieso de autoriteit. */
  const registerThisDevice = async (accessToken: string): Promise<'approved' | 'pending' | 'revoked' | null> => {
    try {
      const res = await fetch('/api/devices/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, ...deviceHeaders() },
        body: JSON.stringify({ name: deriveDeviceName() }),
      });
      if (!res.ok) return null;
      const data = await res.json().catch(() => null);
      return data?.status === 'approved' || data?.status === 'pending' || data?.status === 'revoked' ? data.status : null;
    } catch {
      return null;
    }
  };

  const initializeAuthenticatedApp = async (accessToken: string, authUserId?: string) => {
    // Progressieve boot: alleen het profiel (één snelle call) blokkeert de
    // eerste render; alle overige data streamt op de achtergrond binnen.
    if (authUserId && (initializedUserIdRef.current === authUserId || initializingUserIdRef.current === authUserId)) return;
    // Synchroon markeren dat we bezig zijn — vóór de eerste await, zodat een
    // vrijwel gelijktijdige tweede aanroeper meteen terugkeert.
    if (authUserId) initializingUserIdRef.current = authUserId;
    try {
      // Gedeeld toestel: is dit iemand anders dan de vorige keer, dan gaan de
      // privé-caches eerst weg en telt een profiel uit de cache niet.
      // Vergeleken op het auth-id van de sessie, vóór het profiel: het id in
      // een profiel uit de cache bewijst niets.
      const cacheMag = await borgGebruiker(authUserId);
      // Toestelregistratie en profiel tegelijk (punt 19, 15-09). Vroeger
      // serieel: register → /api/me → (staf) beveiliging → data, drie
      // roundtrips vóór de eerste inhoud. De server-gate op /api/me blijft
      // de autoriteit: slaagt /api/me, dan is dit toestel goedgekeurd (of
      // staf/schakelaar uit) en hoeven we het registratie-antwoord niet af
      // te wachten; de registratie werkt intussen last_seen bij. Faalt
      // /api/me (403 device_* op een nieuw of geblokkeerd toestel), dan
      // beslist het registratie-oordeel: eerste toestel = 'approved' → één
      // keer opnieuw; pending/revoked → wachtscherm. De 403 van de eerste
      // poging komt óók als window-event binnen; de listener wacht dan op
      // hetzelfde oordeel (registratieRef), dus geen flits van het
      // wachtscherm op een gloednieuw toestel.
      const registratie = registerThisDevice(accessToken);
      registratieRef.current = registratie;
      // 2FA-status tegelijk met het profiel (ronde 3, 19-09): listFactors doet
      // intern een netwerk-getUser en stond voor staf serieel ná /api/me. De
      // poort zelf verandert niet: het resultaat wordt pas gelezen als de rol
      // staf blijkt. De rol-hint van de vorige start bespaart chauffeurs de
      // overbodige call; zonder hint (nieuw toestel) starten we hem wel. De
      // hint stuurt alleen het moment, nooit de beslissing. Verwerpt nooit
      // (leesTweeStapsStatus vangt zelf af), dus een ongelezen belofte is veilig.
      let rolHint: string | null = null;
      try { rolHint = window.localStorage.getItem(LAST_ROLE_KEY); } catch { /* opslag geblokkeerd */ }
      const vroegeTweeStaps = rolHint === 'chauffeur' || rolHint === 'technieker' ? null : leesTweeStapsStatus();
      let profiel: Awaited<ReturnType<typeof fetchCurrentUser>>;
      try {
        profiel = await fetchCurrentUser(accessToken, cacheMag);
      } catch (eersteFout) {
        const deviceStatus = await registratie;
        // De toestel-403 van apiFetch draagt de servermelding ("Dit toestel
        // is niet geregistreerd…", "…wacht op goedkeuring…", "…geblokkeerd…").
        const toestelFout = isToestelGeblokkeerd(eersteFout) || (eersteFout instanceof Error && /toestel/i.test(eersteFout.message));
        if (deviceStatus === 'pending' || deviceStatus === 'revoked' || (deviceStatus === null && toestelFout)) {
          // Registratie mislukt (null) terwijl /api/me een toestelreden gaf:
          // dezelfde uitkomst als vroeger, het wachtscherm met "Opnieuw controleren".
          setDeviceBlocked(deviceStatus === 'revoked' ? 'revoked' : 'pending');
          void wisPriveCaches();
          setIsInitialLoad(false);
          initializingUserIdRef.current = null; // "Opnieuw controleren" moet opnieuw kunnen initialiseren
          return; // dedup-vlag (initialized) bewust niet zetten
        }
        // Geen toestelreden en geen registratie-oordeel: een gewone hik, de
        // algemene foutafhandeling hieronder. Met 'approved' (zojuist als
        // eerste toestel goedgekeurd) één herkansing.
        if (deviceStatus === null) throw eersteFout;
        profiel = await fetchCurrentUser(accessToken, cacheMag);
      } finally {
        registratieRef.current = null;
      }
      setDeviceBlocked(null);
      const { appUser, beveiliging, uitCache } = profiel;
      // Twee-stapsverificatie (staf): ingeschreven maar nog geen code in deze
      // sessie = codescherm; geen authenticator terwijl de server hem eist =
      // inschrijfscherm. Chauffeurs slaan dit over. Fail-open: lukt de status
      // niet (mock-Supabase, oude sessie), dan gaat de app gewoon door en
      // vangt de 403 mfa_required van de server het alsnog. `mfaVerplicht`
      // komt sinds punt 19 mee in /api/me (geen aparte roundtrip meer);
      // alleen een oudere server zonder dat veld vraagt het nog apart.
      if (appUser.role === 'planner' || appUser.role === 'admin') {
        const [status, mfaVerplicht] = await Promise.all([
          vroegeTweeStaps ?? leesTweeStapsStatus(),
          beveiliging
            ? Promise.resolve(!!beveiliging.mfaVerplicht)
            : (apiFetch('/api/me/beveiliging', { accessToken }).then((r) => (r.ok ? r.json() : null)).catch(() => null) as Promise<{ mfaVerplicht?: boolean } | null>).then((b) => !!b?.mfaVerplicht),
        ]);
        const stap = bepaalTweeStapsStap(status, mfaVerplicht);
        if (stap !== 'geen') {
          setTweeStaps({ stap, factorId: status?.factorId ?? null });
          setIsInitialLoad(false);
          initializingUserIdRef.current = null; // na de code opnieuw initialiseren
          return;
        }
      }
      setTweeStaps(null);
      // Een profiel van de server: vanaf hier zijn de privé-caches van deze
      // gebruiker (borgGebruiker hierboven wiste ze als het iemand anders was).
      if (!uitCache) await bevestigGebruiker(authUserId, String(appUser.id));
      try {
        window.localStorage.setItem(LAST_ROLE_KEY, appUser.role);
      } catch {
        // localStorage geblokkeerd, geen blocker voor de boot
      }
      // Pas NA een geslaagd profiel de dedup-vlag zetten — anders blijft de
      // gebruiker bij een transiente /api/me-fout vasthangen op 'Profiel
      // laden…' (een volgend auth-event werd door de vlag kortgesloten).
      if (authUserId) { initializedUserIdRef.current = authUserId; initializingUserIdRef.current = null; }
      // Aanwezigheids-ping: wie de app opent met een nog geldige sessie logt
      // niet opnieuw in en was daardoor onzichtbaar in "Actieve gebruikers
      // per dag". De server dedupliceert per dag. Best-effort, fire-and-forget.
      void apiFetch('/api/auth/session', {
        method: 'POST',
        body: JSON.stringify({ action: 'resume' }),
        accessToken,
      }).catch(() => {});
      void loadAppData(appUser, accessToken);
    } catch (error) {
      console.error('Error initializing app:', error);
      if (authUserId) { initializedUserIdRef.current = null; initializingUserIdRef.current = null; } // her-init toestaan bij een volgend auth-event
      setIsInitialLoad(false);
      showToast('Kon je profiel niet laden. Vernieuw de pagina of log opnieuw in.', 'error');
    }
  };


  // Tellers voor de badges (src/app/useBadges.ts): verlofbeslissingen,
  // wachtende verlof- en ruilaanvragen, ruilen die op mij wachten.
  const { unseenLeaveDecisionCount, ruilDataKlaar, pendingLeaveCount, pendingSwapsCount, targetedSwapsCount } = useBadges(currentUser, {
    leaveRequests, lastSeenLeaveDecisionAt, swaps, swapsGeladen, usersGeladen,
  });

  // Werkvoorraad van de planner (src/app/useBadges.ts): één berekening voor
  // topbar-knop, app-icoon-badge en het Open taken-paneel.
  const { isStafRol, werkvoorraad } = useWerkvoorraad(currentUser, {
    users, shifts, leaveRequests, swaps, planningMatrixHistory, coverageDays, vervaldata, pendingDevices,
  });

  // Badge op het app-icoon (src/app/useBadges.ts).
  useAppBadge(currentUser, isStafRol, werkvoorraad, ongelezenMeldingen);

  // Stille warmup van de lazy views die hierna waarschijnlijk geopend worden,
  // zodat de eerste navigatie instant voelt zonder de startbundel te
  // vergroten. Sinds 14-09 (punt 18) niet meer bij de eerste idle-callback
  // maar pas ná de LCP + marge, en alleen dównloaden (prefetch-link via de
  // chunk-kaart van de build) in plaats van evalueren: de oude warmup legde
  // 75 kB brotli (>250 kB JS) aan evaluatiewerk midden in het meetvenster
  // (Lighthouse /mijn-dag 0,81 / LCP 4,5 s tegen 0,85 / 3,9 s zonder warmup;
  // CI-TBT 575-1037 ms). Lijsten per rol en de hele werkwijze: warmViews in
  // src/app/viewLoaders.ts. Bewust NIET de xlsx-views (500 kB) en niet
  // 'verlof' (schemas + zod, hover-prefetch dekt hem).
  useEffect(() => {
    if (!currentUser || isInitialLoad) return;
    return warmViews(WARMUP_VIEWS[currentUser.role === 'chauffeur' ? 'chauffeur' : 'staf']);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser?.id, currentUser?.role, isInitialLoad]);

  // Overlays voorladen op het moment dat ze waarschijnlijk worden: de
  // werkvoorraad-knop staat voor staf altijd in de topbar (meteen ophalen,
  // parallel met de data, zodat het plekje maar een oogwenk leeg is); de
  // account-overlays zodra Instellingen open staat (de knoppen zitten daar).
  useEffect(() => {
    if (currentUser && isStaf(currentUser.role)) void laadWerkvoorraadMenu();
  }, [currentUser?.role]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (currentView === 'instellingen') laadAccountOverlays();
  }, [currentView]);

  const handleLogin = async (accessToken?: string) => {
    const token = accessToken || session?.access_token;
    if (!token) return;

    const response = await apiFetch('/api/auth/session', {
      method: 'POST',
      body: JSON.stringify({ action: 'start' }),
      accessToken: token,
    });
    const text = await response.text();
    let user;
    try {
      user = JSON.parse(text);
    } catch {
      throw new Error('De server gaf geen geldig antwoord terug. Controleer of de nieuwste backend deploy actief is.');
    }
    if (!response.ok || !user?.id || !user?.role) {
      throw new Error(user?.error || 'Sessie kon niet gestart worden. Probeer opnieuw.');
    }
    // Terug naar de oorspronkelijke bestemming (src/app/terugNaLogin.ts, lui
    // geladen), vóór setCurrentUser: zo beslist de rol-guard één keer over
    // het echte doel. Geen (geldig) doel = het dashboard zoals vroeger.
    const ruwDoel = neemStartDoel();
    const terug = ruwDoel ? await import('./app/terugNaLogin').then((m) => m.naarStartDoel(ruwDoel), () => false) : false;
    setCurrentUser(user);
    profielGeladenRef.current = true;
    await fetchUsers(token);
    if (!terug) setCurrentView('dashboard');
  };

  const handleLogout = async () => {
    // Een eigen afmelding is geen verlopen sessie: wat intussen een 401
    // krijgt, mag die uitleg niet op het inlogscherm zetten.
    forceSignOutRef.current = true;
    sessieBeeindigdRef.current = true;
    try {
      if (session?.access_token) {
        await apiFetch('/api/auth/session', {
          method: 'POST',
          body: JSON.stringify({ action: 'end' }),
        });
      }
    } catch (error) {
      console.error('Error ending session:', error);
    }
    // Push-abonnement, Supabase en de afronding (privé-caches, herlaad):
    // dezelfde weg als de gedwongen uitlog. Alleen dit toestel, behalve op
    // een gedeeld toestel (05-10): afmelden op de computer liet tot dan ook de
    // eigen telefoon zonder sessie achter.
    await meldAf(bereikVanAfmelding(gedeeldToestel));
  };

  // Gedeeld toestel: na 30 minuten zonder aanraking terug naar het
  // loginscherm, met uitleg (verbeterronde 07-09, nr. 12).
  // Print-modus: voor wie de luie module het blad weigerde (rol mag het niet),
  // tonen we het portaal; per gebruiker, zodat een andere login opnieuw kijkt.
  const [printGeweigerdVoor, setPrintGeweigerdVoor] = useState<string | null>(null);
  const geenPrintblad = useCallback(() => setPrintGeweigerdVoor(currentUser?.id ?? null), [currentUser?.id]);

  useInactiviteitsUitlog(gedeeldToestel && !!currentUser, () => {
    void forceSignOut('inactief');
  });

  // Warme start (opgeslagen sessie): meteen de skeleton-schil; koude start: het
  // carbon laadscherm — dat wordt zo het inlogscherm. Ook tijdens de afronding
  // van een afmelding (profiel was geladen): daarna volgt de herlaad naar het
  // inlogscherm, niet de app.
  if (!authReady) return warmeStart && !profielGeladenRef.current ? <AppSkeleton /> : <SessieLaden />;

  // Print-modus (?print-…=): een kaal blad zonder schil. Zie app/PrintModus.tsx.
  // Alleen met een ingelogde gebruiker (elk blad vraagt er een); weigert de
  // module het blad voor deze gebruiker, dan het gewone portaal.
  if (currentUser && printGeweigerdVoor !== currentUser.id && PRINT_PARAM.test(window.location.search)) {
    return (
      <Suspense fallback={<PrintLaden />}>
        <LazyPrintModus currentUser={currentUser} users={users} shifts={shifts} leaveRequests={leaveRequests} isInitialLoad={isInitialLoad} onGeenBlad={geenPrintblad} />
      </Suspense>
    );
  }

  if (!isSupabaseConfigured || !supabase) return <ConfigOntbreekt />;

  // Vóór het herstelscherm: de landing start zelf een herstelsessie om het
  // wachtwoord te zetten, en moet dan in beeld blijven.
  if (uitnodiging) {
    return (
      <Suspense fallback={<SessieLaden />}>
        <LazyUitnodiging code={uitnodiging} onLogin={handleLogin} onKlaar={() => setUitnodiging(null)} />
      </Suspense>
    );
  }

  if (isPasswordRecovery) {
    return (
      <LoginView
        onLogin={handleLogin}
        recoveryMode
        onRecoveryComplete={async () => { setRecoveryMode(false); }}
      />
    );
  }

  // Twee-stapsverificatie: ingelogd, maar de code (of de inschrijving) ontbreekt nog.
  if (tweeStaps && session) {
    return (
      <Suspense fallback={<SessieLaden />}>
      <LazyTweeStapsScherm
        stap={tweeStaps.stap}
        factorId={tweeStaps.factorId}
        onLogout={handleLogout}
        onKlaar={async () => {
          // challengeAndVerify gaf een nieuwe (aal2-)sessie; die opnieuw
          // ophalen en de app alsnog initialiseren.
          const { data } = (await supabase?.auth.getSession()) ?? { data: { session: null } };
          const verse = data.session ?? session;
          // De socket meteen het aal2-token geven (zie ververRealtimeToken).
          ververRealtimeToken(verse.access_token);
          setSession(verse);
          setTweeStaps(null);
          initializedUserIdRef.current = null;
          initializingUserIdRef.current = null;
          void initializeAuthenticatedApp(verse.access_token, verse.user?.id);
        }}
      />
      </Suspense>
    );
  }

  // Toestel-whitelist: ingelogd, maar dit toestel is (nog) niet goedgekeurd.
  if (deviceBlocked && session) {
    return (
      <Suspense fallback={<SessieLaden />}>
      <LazyToestelGeblokkeerd
        revoked={deviceBlocked === 'revoked'}
        onLogout={handleLogout}
        onRetry={async () => {
          if (!session?.access_token) return;
          const status = await registerThisDevice(session.access_token);
          if (status === 'approved' || status === null) {
            setDeviceBlocked(null);
            initializedUserIdRef.current = null;
            initializingUserIdRef.current = null;
            void initializeAuthenticatedApp(session.access_token, session.user?.id);
          } else {
            setDeviceBlocked(status);
            showToast('Nog niet goedgekeurd, vraag de planning om dit toestel goed te keuren.', 'info');
          }
        }}
      />
      </Suspense>
    );
  }

  if (!currentUser) {
    // Wél een sessie maar (nog) geen profiel: toon een laadscherm met
    // retry i.p.v. het loginformulier aan een al-ingelogde gebruiker
    // (de 8s-watchdog kon hier anders een login-flits veroorzaken).
    if (session) return warmeStart ? <AppSkeleton /> : <ProfielLaden />;
    // uitlogMelding als prop: sessionStorage alleen is niet genoeg, want bij
    // een gedwongen uitlog kan LoginView al gemonteerd zijn vóórdat de vlag
    // geschreven is — dan zou de uitleg nooit verschijnen (viel om in e2e).
    return <LoginView onLogin={handleLogin} melding={uitlogMelding} />;
  }

  const isRealAdmin = currentUser.role === 'admin';
  // In preview-modus rendert alles op chauffeur-niveau (nav-secties verdwijnen,
  // dashboard toont de chauffeursvariant). allowedViews/guard blijven bewust op
  // de échte rol zodat er niets wordt weg-geredirect.
  const previewingChauffeur = isRealAdmin && previewChauffeur;
  const effectiveRole = previewingChauffeur ? 'chauffeur' : currentUser.role;
  const isPlanner = effectiveRole === 'planner' || effectiveRole === 'admin';
  const isAdmin = effectiveRole === 'admin';
  const resolvedCurrentView: View = magView(currentUser, currentView) ? currentView : 'dashboard';
  // Titel in de topbar = het label uit de routetabel (één naam per scherm).
  const currentMeta = { title: routeVan(resolvedCurrentView).label };
  // Kolombreedte van de schil volgt de route (routes.tsx `breed`): topbar,
  // banners en #hoofdinhoud even breed als de PageShell van het scherm.
  const kolomClass = isBreed(resolvedCurrentView) ? 'max-w-[var(--content-max-breed)]' : 'max-w-[var(--content-max)]';
  const sectie = sectieLabel(resolvedCurrentView);
  // Volledige initialen ("Jarno De Greve" → JDG), gecapt op 4 voor extreem
  // lange namen (avatar is maar 32px breed).
  const userInitials = currentUser.name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .slice(0, 4)
    .join('')
    .toUpperCase() || '?';

  return (
    <AppSchil
      appData={appData}
      toasts={toasts}
      dismissToast={dismissToast}
      resolvedCurrentView={resolvedCurrentView}
      showChangePassword={showChangePassword}
      setShowChangePassword={setShowChangePassword}
      currentUser={currentUser}
      session={session}
      showProbleemMelder={showProbleemMelder}
      setShowProbleemMelder={setShowProbleemMelder}
      currentView={currentView}
      showAgenda={showAgenda}
      setShowAgenda={setShowAgenda}
      shifts={shifts}
      bundelOpen={bundelOpen}
      setBundelOpen={setBundelOpen}
      isSidebarOpen={isSidebarOpen}
      setIsSidebarOpen={setIsSidebarOpen}
      isDesktopNav={isDesktopNav}
      setCurrentView={setCurrentView}
      effectiveRole={effectiveRole}
      unseenDocuments={unseenDocuments}
      isPlanner={isPlanner}
      pendingSwapsCount={pendingSwapsCount}
      targetedSwapsCount={targetedSwapsCount}
      pendingLeaveCount={pendingLeaveCount}
      unseenLeaveDecisionCount={unseenLeaveDecisionCount}
      markDocumentsSeen={markDocumentsSeen}
      ptrIndicatorRef={ptrIndicatorRef}
      ptrRefreshing={ptrRefreshing}
      scrollContainerRef={scrollContainerRef}
      setIsScrolled={setIsScrolled}
      isScrolled={isScrolled}
      kolomClass={kolomClass}
      sectie={sectie}
      currentMeta={currentMeta}
      isRealAdmin={isRealAdmin}
      previewChauffeur={previewChauffeur}
      setPreviewChauffeur={setPreviewChauffeur}
      werkvoorraad={werkvoorraad}
      users={users}
      userInitials={userInitials}
      theme={theme}
      toggleTheme={toggleTheme}
      pushPublicKey={pushPublicKey}
      pushEnabled={pushEnabled}
      togglePush={togglePush}
      handleLogout={handleLogout}
      onderhoud={onderhoud}
      isOnline={isOnline}
      lastSyncedAt={lastSyncedAt}
      viewFoutReset={viewFoutReset}
      setViewFoutReset={setViewFoutReset}
      navigeer={navigeer}
      isAdmin={isAdmin}
      previewingChauffeur={previewingChauffeur}
      ruilDataKlaar={ruilDataKlaar}
      swapPreselectShiftId={swapPreselectShiftId}
      setSwapPreselectShiftId={setSwapPreselectShiftId}
    />
  );
}




