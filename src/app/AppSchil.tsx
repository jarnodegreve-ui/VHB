/**
 * De schil van de ingelogde app: zijbalk, topbalk, de inhoud van het scherm en
 * de overlays. Tot 05-10 was dit het return-blok van App.tsx; App houdt de
 * sessie en de staat bij en geeft hier door wat de schil toont. Bewust nog
 * één lange lijst props: dit was een verplaatsing, geen herontwerp.
 */
import { Suspense } from 'react';
import { SidebarNav } from './SidebarNav';
import { AppDataProvider } from './AppDataContext';
import { ViewFout } from './ViewFout';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { X, RefreshCw, Menu, Eye, WifiOff } from 'lucide-react';
import { formatSyncedTime } from '../lib/format';
import { AnimatePresence, motion } from 'motion/react';
import type { Session } from '@supabase/supabase-js';
import type { Role, Shift, User, View } from '../types';
import { cn } from '../lib/ui';
import { lazyWithRetry, metRetry } from '../lib/lazyRetry';
import { isPushSupported } from '../lib/push';
import { DashboardSkelet } from '../components/ui';
import { skeletVoor } from './skeletten';
import { SchermInhoud } from './SchermInhoud';
import { IconButton } from '../components/primitives';
import { Callout } from '../components/Callout';
import { ToastStack, type Toast } from '../components/ToastStack';
import { InstallPrompt } from '../components/PwaChrome';
import { BottomNav } from '../components/BottomNav';
import { BrandLogo } from '../components/BrandLogo';
import { OmgevingLabel } from '../components/OmgevingLabel';
import { OnderhoudBanner } from '../components/OnderhoudBanner';
import { UserMenu } from '../components/UserMenu';
import { MeldingenBel } from '../components/MeldingenBel';
import type { Werkvoorraad } from '../lib/werkvoorraad';
import { SpeedInsights } from '@vercel/speed-insights/react';
import type { Dispatch, SetStateAction, RefObject } from 'react';
import type { useAppData } from './useAppData';

// Overlays lazy (punt 18, 14-09): wachtwoord wijzigen, agenda-abonnement, de
// werkvoorraad-knop en het twee-stapsscherm zaten statisch in de schil, samen
// met de DatePicker die de eerste twee via Field meeslepen: ±30 kB in
// index-*.js voor schermen die een chauffeur zelden of nooit opent. De
// `laad…`-functies bestaan los van React.lazy zodat de knop die zo'n overlay
// opent hem bij hover/focus alvast kan ophalen (de eerste opening hapert dan
// niet); de module-cache maakt de tweede aanroep gratis.
const laadChangePasswordModal = () => import('../components/ChangePasswordModal');
const laadCalendarSubscribeModal = () => import('../components/CalendarSubscribeModal');
const laadProbleemMelder = () => import('./ProbleemMelder');
export const laadWerkvoorraadMenu = () => import('../components/WerkvoorraadMenu');
const laadRitbladViewer = () => import('../components/RitbladViewer');
const LazyChangePasswordModal = lazyWithRetry(() => laadChangePasswordModal().then((m) => ({ default: m.ChangePasswordModal })));
const LazyCalendarSubscribeModal = lazyWithRetry(() => laadCalendarSubscribeModal().then((m) => ({ default: m.CalendarSubscribeModal })));
// ProbleemMelder was de laatste schil-importeur van Field, en Field sleept de
// DatePicker (±17 kB bron) mee; lazy = Field + DatePicker uit de startbundel.
const LazyProbleemMelder = lazyWithRetry(() => laadProbleemMelder().then((m) => ({ default: m.ProbleemMelder })));
const LazyWerkvoorraadMenu = lazyWithRetry(() => laadWerkvoorraadMenu().then((m) => ({ default: m.WerkvoorraadMenu })));
// Volledige ritblad-bundel in de app (controle 16-09, nr. 10): pdfjs blijft
// lazy, net als bij de viewer op Mijn dag.
const LazyRitbladViewer = lazyWithRetry(() => laadRitbladViewer().then((m) => ({ default: m.RitbladViewer })));
// Startbundel-trim (fase 2, 22-09): drie stukken die alleen staf of één
// klik nodig heeft, uit index-*.js.
// - De avatar-stapel (staf, desktop) rendert zelf null zolang er niemand
//   anders is, dus een lege Suspense-fallback geeft geen sprong.
const LazyAanwezigheidStack = lazyWithRetry(() => import('../components/AanwezigheidStack').then((m) => ({ default: m.AanwezigheidStack })));
// - De agenda-download (roosterIcs + shared/ics) pas bij de klik op de knop;
//   het avatar-menu haalt de module bij hover alvast op (laadAccountOverlays).
const laadRoosterIcs = metRetry(() => import('../lib/roosterIcs'));
/** Plekje van de werkvoorraad-knop in de topbar (maat van IconButton sm). */
const WERKVOORRAAD_PLEK = <span aria-hidden="true" className="inline-block h-11 w-11 shrink-0 sm:pointer-fine:h-8 sm:pointer-fine:w-8" />;
/** Voorladen van de account-overlays: bij hover/focus op het avatar-menu en
 *  zodra Instellingen open staat (daar zitten dezelfde knoppen). */
export const laadAccountOverlays = () => {
  void laadChangePasswordModal();
  void laadCalendarSubscribeModal();
  void laadRoosterIcs().catch(() => {});
  void laadProbleemMelder();
};

export type AppSchilProps = {
  appData: ReturnType<typeof useAppData>;
  toasts: Toast[];
  dismissToast: (id: number) => void;
  resolvedCurrentView: View;
  showChangePassword: boolean;
  setShowChangePassword: Dispatch<SetStateAction<boolean>>;
  currentUser: User;
  session: Session | null;
  showProbleemMelder: boolean;
  setShowProbleemMelder: Dispatch<SetStateAction<boolean>>;
  currentView: View;
  showAgenda: boolean;
  setShowAgenda: Dispatch<SetStateAction<boolean>>;
  shifts: Shift[];
  bundelOpen: boolean;
  setBundelOpen: Dispatch<SetStateAction<boolean>>;
  isSidebarOpen: boolean;
  setIsSidebarOpen: Dispatch<SetStateAction<boolean>>;
  isDesktopNav: boolean;
  setCurrentView: (next: View) => void;
  effectiveRole: Role;
  unseenDocuments: number;
  isPlanner: boolean;
  pendingSwapsCount: number;
  targetedSwapsCount: number;
  pendingLeaveCount: number;
  unseenLeaveDecisionCount: number;
  markDocumentsSeen: () => void;
  ptrIndicatorRef: RefObject<HTMLDivElement | null>;
  ptrRefreshing: boolean;
  scrollContainerRef: RefObject<HTMLDivElement | null>;
  setIsScrolled: Dispatch<SetStateAction<boolean>>;
  isScrolled: boolean;
  kolomClass: "max-w-[var(--content-max-breed)]" | "max-w-[var(--content-max)]";
  sectie: string | null;
  currentMeta: { title: string; };
  isRealAdmin: boolean;
  previewChauffeur: boolean;
  setPreviewChauffeur: Dispatch<SetStateAction<boolean>>;
  werkvoorraad: Werkvoorraad | null;
  users: User[];
  userInitials: string;
  theme: "light" | "dark";
  toggleTheme: () => void;
  pushPublicKey: string | null;
  pushEnabled: boolean;
  togglePush: () => Promise<void>;
  handleLogout: () => Promise<void>;
  onderhoud: { actief: boolean; tekst: string; schrijfblok: boolean; tot?: string | undefined; };
  isOnline: boolean;
  lastSyncedAt: number | null;
  viewFoutReset: number;
  setViewFoutReset: Dispatch<SetStateAction<number>>;
  navigeer: (view: View, opts?: { params?: readonly string[]; replace?: boolean; }) => void;
  isAdmin: boolean;
  previewingChauffeur: boolean;
  ruilDataKlaar: boolean;
  swapPreselectShiftId: string | null;
  setSwapPreselectShiftId: Dispatch<SetStateAction<string | null>>;
};

export function AppSchil({
  appData,
  toasts,
  dismissToast,
  resolvedCurrentView,
  showChangePassword,
  setShowChangePassword,
  currentUser,
  session,
  showProbleemMelder,
  setShowProbleemMelder,
  currentView,
  showAgenda,
  setShowAgenda,
  shifts,
  bundelOpen,
  setBundelOpen,
  isSidebarOpen,
  setIsSidebarOpen,
  isDesktopNav,
  setCurrentView,
  effectiveRole,
  unseenDocuments,
  isPlanner,
  pendingSwapsCount,
  targetedSwapsCount,
  pendingLeaveCount,
  unseenLeaveDecisionCount,
  markDocumentsSeen,
  ptrIndicatorRef,
  ptrRefreshing,
  scrollContainerRef,
  setIsScrolled,
  isScrolled,
  kolomClass,
  sectie,
  currentMeta,
  isRealAdmin,
  previewChauffeur,
  setPreviewChauffeur,
  werkvoorraad,
  users,
  userInitials,
  theme,
  toggleTheme,
  pushPublicKey,
  pushEnabled,
  togglePush,
  handleLogout,
  onderhoud,
  isOnline,
  lastSyncedAt,
  viewFoutReset,
  setViewFoutReset,
  navigeer,
  isAdmin,
  previewingChauffeur,
  ruilDataKlaar,
  swapPreselectShiftId,
  setSwapPreselectShiftId,
}: AppSchilProps) {
  return (
    <AppDataProvider value={appData}>
      {/* Parallax-laag: fixed gekleurde blobs die trager scrollen dan content */}
      <div className="parallax-bg" aria-hidden="true" />

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      {/* Web-vitals (LCP/INP/CLS) per scherm naar Vercel Speed Insights; route = view-naam, niet de URL met parameters. */}
      <SpeedInsights route={`/${resolvedCurrentView}`} />
      <InstallPrompt />
      {/* Lazy overlays alleen mounten terwijl ze open staan: Modal heeft
          bewust geen exit-animatie (zie Modal.tsx), dus er gaat niets
          verloren; de Suspense-fallback is leeg omdat de chunk bij hover/focus
          op het avatar-menu al binnen is. */}
      {showChangePassword && (
        <Suspense fallback={null}>
          <LazyChangePasswordModal
            open
            onClose={() => setShowChangePassword(false)}
            email={currentUser?.email || session?.user?.email || ''}
          />
        </Suspense>
      )}
      {showProbleemMelder && (
        <Suspense fallback={null}>
          <LazyProbleemMelder open onClose={() => setShowProbleemMelder(false)} view={currentView} />
        </Suspense>
      )}
      {showAgenda && (
        <Suspense fallback={null}>
          <LazyCalendarSubscribeModal open onClose={() => setShowAgenda(false)} onDownload={() => { void laadRoosterIcs().then((m) => m.downloadRoosterIcs(currentUser.name, shifts.filter((s) => String(s.driverId) === String(currentUser.id)))).catch(() => {}); }} />
        </Suspense>
      )}
      {bundelOpen && (
        <Suspense fallback={null}>
          <LazyRitbladViewer dienstnummer="" alles open onClose={() => setBundelOpen(false)} />
        </Suspense>
      )}
      {/* De schermvullende dimmer "Gegevens verwerken…" is in fase 2 (22-09)
          weggehaald: elke schrijfactie draagt zijn eigen bezig-staat op de knop
          die haar startte (Button/IconButton `bezig`, ConfirmationModal wacht
          op een Promise), en een save van 300 ms bevroor anders de hele app. */}
      {/* h-dvh i.p.v. h-screen (100vh): vóór installatie in een Safari-tab is
          100vh de hoogte mét uitgeklapte toolbar, waardoor de onderrand achter
          de balk viel. dvh volgt de zichtbare viewport. */}
      {/* rauw: skip-link voor toetsenbord/VoiceOver — springt langs de zijbalk naar de inhoud. */}
      <a
        href="#hoofdinhoud"
        onClick={(e) => { e.preventDefault(); document.getElementById('hoofdinhoud')?.focus(); }}
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-skiplink focus:rounded-xl focus:bg-oker-500 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-slate-950"
      >
        Naar de inhoud
      </a>
      <div className="flex h-dvh w-full bg-transparent text-slate-900 font-sans overflow-hidden">
      {/* Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-ink/40 backdrop-blur-sm z-zwevend lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar — vaste rail, full-height, haarlijn rechts */}
      <aside
        aria-label="Zijbalk"
        inert={!isSidebarOpen && !isDesktopNav}
        className={cn(
          "fixed inset-y-0 left-0 w-zijbalk-lade max-w-[80vw] panel-dark flex flex-col z-zijbalk lg:w-zijbalk lg:max-w-none lg:relative lg:translate-x-0",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
        // De schuif-transitie komt uit .panel-dark (transform op
        // --duration-slow/--ease-standard, index.css): geen tweede
        // transition-transform/duration hier, dat was dubbel.
        // Landscape: iOS negeert de portrait-lock, dus met de notch links
        // hoort de zijbalk de linker-inset te respecteren (dock en SlideOver
        // deden dat al) — anders vallen logo en menu-items deels onder de
        // notch (controle-ronde 27-08, nr. 35).
        style={{ paddingLeft: 'env(safe-area-inset-left)' }}
      >
        {/* Statusbalkzone donker houden zolang de lade open is (licht thema: de
            lade is licht, de statusbalktekens wit — controle 05-09, nr. 14). */}
        <div className="statusbalk-strook shrink-0 lg:hidden" aria-hidden="true" />
        <div className="shrink-0 px-5 pt-4 pb-3 flex items-center justify-center relative text-center">
          {/* Géén transform/transition-all op de logoknop: Safari rastert een
              element met schaal-animatie als bitmap-laag en schaalt die —
              dat maakte de logo-randen kartelig op retina (melding Jarno). */}
          {/* rauw: logoknop (eigen layout, bewust zonder ios-pressable/transform). */}
          <button
            type="button"
            onClick={() => { setCurrentView('dashboard'); setIsSidebarOpen(false); }}
            className="rounded-xl py-1 px-2 transition-opacity hover:opacity-80"
            title="Naar dashboard"
          >
            {/* Volledig logo mét naamregel op w-36 = 144 px — bewuste keuze
                Jarno (30-08): op 192 px (richtlijn-minimum 180 px) te groot,
                het beeldmerk zonder naamregel wilde hij niet. Naamregel 1,2×
                en 26 eenheden lager (ook Jarno) voor leesbaarheid op deze
                maat; op mobiel w-32 = 128 px ("iets kleiner", Jarno 30-08). */}
            <BrandLogo tone="licht" className="w-40 lg:w-44 h-auto mx-auto select-none block dark:hidden" />
            <BrandLogo tone="donker" className="w-40 lg:w-44 h-auto mx-auto select-none hidden dark:block" />
          </button>
          <IconButton
            label="Menu sluiten"
            variant="ghost"
            onClick={() => setIsSidebarOpen(false)}
            className="absolute right-3 top-1/2 -translate-y-1/2 lg:hidden"
          >
            <X size={18} />
          </IconButton>
        </div>

        <SidebarNav
          rol={effectiveRole}
          ookTechnieker={currentUser.ookTechnieker}
          currentView={currentView}
          badges={{
            documenten: unseenDocuments,
            'ruil-verzoeken': isPlanner ? pendingSwapsCount : targetedSwapsCount,
            verlof: isPlanner ? pendingLeaveCount : unseenLeaveDecisionCount,
          }}
          onNavigate={(v) => { setCurrentView(v); setIsSidebarOpen(false); if (v === 'documenten') markDocumentsSeen(); }}
        />

        {/* Accountacties (thema, meldingen, wachtwoord, probleem, uitloggen)
            + het gebruikerskaartje verhuisden naar het avatar-menu in de
            topbar (mock Jarno 30-08). Hier alleen nog safe-area-lucht zodat
            het laatste nav-item op een iPhone boven de home-indicator blijft. */}
        <div className="shrink-0" style={{ paddingBottom: 'max(0.5rem, env(safe-area-inset-bottom))' }} />
      </aside>

      {/* Main Content */}
      {/* Mobiele lade open: de inhoud is inert (focus blijft in de lade). */}
      <main className="flex-1 min-w-0 flex flex-col overflow-hidden relative" inert={isSidebarOpen && !isDesktopNav}>
        {/* Statusbalkstrook vast bovenaan (buiten de scroll-root): bij
            rubber-band/pull-to-refresh schoof hij anders mee omlaag en flitste
            de lichte achtergrond onder de witte statusbalktekens (controle 05-09, nr. 39). */}
        <div className="statusbalk-strook pointer-events-none absolute inset-x-0 top-0 z-zwevend" aria-hidden="true" />
        {/* Scroll container met sticky-header — header zit BINNEN de scroll
            zodat content er onderdoor schuift en de panel-blur natuurlijk
            werkt (echte iOS-vibe i.p.v. harde rand). */}
        {/* Pull-to-refresh-indicator: altijd in de DOM (de hook stuurt opacity/
            transform rechtstreeks aan via ptrIndicatorRef); animate-spin volgt
            de refreshing-state. */}
        <div
          ref={ptrIndicatorRef}
          className="pointer-events-none absolute inset-x-0 top-[env(safe-area-inset-top,0px)] z-zwevend flex justify-center opacity-0"
        >
          <div className="mt-2 flex h-9 w-9 items-center justify-center rounded-full bg-surface-white elev-2 ring-1 ring-hairline">
            <RefreshCw size={18} data-ptr-icon className={cn('text-oker-500', ptrRefreshing && 'animate-spin')} />
          </div>
        </div>
        {/* scrollbar-gutter:stable (21-09): met een klassieke scrollbalk (muis,
            Windows) versprong de hele pagina ±15 px tussen een kort scherm zonder
            balk en een lang scherm met. De goot is nu altijd gereserveerd; met
            overlay-scrollbalken (iPhone, trackpad) verandert er niets. */}
        <div
          ref={scrollContainerRef}
          data-scroll-root
          className="flex-1 w-full min-w-0 overflow-y-auto overflow-x-hidden overscroll-y-contain [scrollbar-gutter:stable] px-gutter md:px-7 pb-[calc(9.5rem+env(safe-area-inset-bottom))] md:pb-8"
          onScroll={(e) => {
            const top = e.currentTarget.scrollTop ?? 0;
            const next = top > 8;
            // Parallax is bewust weg (Windows-perf): de vorige versie schreef
            // hier elke scroll-frame een CSS-var op <html> → document-brede
            // style-invalidatie + hersamplen van de blurred achtergrondlaag.
            setIsScrolled((current) => (current === next ? current : next));
          }}
        >
          {/* Sticky topbar — full-width werkbalk met haarlijn-onderrand */}
          {/* Negatieve marge = scroll-root-padding, óók de safe-area: met een
              vaste -mx-4 stopte de sticky topbar + haarlijn in landscape met
              notch ~30px vóór de schermrand (de inset is dan ~47px). */}
          {/* Sticky topbar begint onder de statusbalkstrook (die staat buiten de
              scroll-root, zie <main>), zodat overscroll de strook niet meeneemt. */}
          <div className="sticky top-[env(safe-area-inset-top,0px)] z-topbar mx-gutter-neg md:-mx-7 mb-5">
            <header className={cn("topbar px-gutter md:px-7", isScrolled && "topbar--scrolled")}>
              {/* Rijhoogte gepind op --topbar-h (index.css, min de haarlijn):
                  StickyThead en Zijvak rekenen daarmee, en het skelet
                  (AppSkeleton) heeft dezelfde rij, dus geen sprong bij het
                  omwisselen. */}
              <div className={cn('mx-auto flex w-full items-center justify-between gap-3 py-2.5 min-h-[calc(var(--topbar-h)-1px)]', kolomClass)}>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="hidden md:inline-flex lg:hidden">
                    <IconButton label="Menu openen" variant="ghost" size="sm" className="-ml-1" onClick={() => setIsSidebarOpen(true)}>
                      <Menu size={18} />
                    </IconButton>
                  </span>
                  {/* Beeldmerk in de mobiele topbar (huisstijl: variant
                      beeldmerk, h-6), op dezelfde plek en maat als in
                      AppSkeleton, zodat het bij een warme start niet opflitst
                      en verdwijnt. Licht/donker via block/hidden dark:
                      (toegestane uitzondering, zoals het skelet en de zijbalk). */}
                  <span className="lg:hidden inline-flex shrink-0 items-center">
                    <BrandLogo tone="licht" variant="beeldmerk" className="h-6 w-auto select-none block dark:hidden" />
                    <BrandLogo tone="donker" variant="beeldmerk" className="h-6 w-auto select-none hidden dark:block" />
                  </span>
                  {/* Desktop (het logo zit dan in de zijbalk): het sectiewoord
                      uit de routetabel, klein, en net als de titel pas zichtbaar
                      zodra de paginakop (met haar eigen eyebrow) weggescrold is;
                      anders staat het woord dubbel boven de vouw. */}
                  {sectie && (
                    <span aria-hidden={!isScrolled || undefined} className={cn('hidden lg:inline text-micro shrink-0 whitespace-nowrap transition-opacity duration-base', isScrolled ? 'opacity-100' : 'opacity-0')}>
                      {sectie}
                    </span>
                  )}
                  {/* Topbar is puur context: alleen de compacte titel. De
                      subtitel dupliceerde de PageHeader-description eronder,
                      en het identiteitsblok stond al in de sidebar-footer —
                      dubbele titeling boven de vouw is weg. */}
                  {/* Titel verschijnt pas zodra de paginakop (h1) weggescrold
                      is — anders stond dezelfde naam twee keer boven de vouw. */}
                  {/* Staging-label (alleen met VITE_OMGEVING=staging) — nooit een preview voor productie aanzien. */}
                  <OmgevingLabel className="shrink-0" />
                  <h2
                    aria-hidden={!isScrolled || undefined}
                    // Naast het sectiewoord krijgt de titel een haarlijn links; die
                    // zit óp de h2 en vervaagt dus mee (geen lege streep in rust).
                    className={cn('text-sm font-semibold text-slate-900 leading-tight truncate transition-opacity duration-base', sectie && 'lg:border-l lg:border-hairline-strong lg:pl-2.5', isScrolled ? 'opacity-100' : 'opacity-0')}
                  >
                    {currentMeta.title}
                  </h2>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Zoekknop bewust weg (Jarno: "vrij zinloos"). Geen
                      permanente "Online"-pill: alleen een storing verdient een
                      signaal (offline-banner hieronder). */}
                  {/* Topbar-inrichting = mock Jarno 30-08: preview-toggle,
                      bel met attentie-stip, avatar-menu. De toggle stond
                      eerst op beide dashboards; één vaste plek is rustiger.
                      Op smal scherm een compacte oog-knop i.p.v. de pill. */}
                  {/* Alleen het oogje, op elk formaat (vraag Jarno 03-09): de
                      pill met tekst + schakelaar was op desktop het drukste
                      element van de balk. Actief = neutraal gevuld (keuze-vlak, zoals een
                      FilterChip aan): een aan/uit-stand is selectie, geen goud. */}
                  {isRealAdmin && (
                    <IconButton
                      label={previewChauffeur ? 'Chauffeurs-weergave uit' : 'Bekijk als chauffeur'}
                      title={previewChauffeur ? 'Chauffeurs-weergave uit' : 'Bekijk als chauffeur'}
                      variant="ghost"
                      size="sm"
                      aria-pressed={previewChauffeur}
                      onClick={() => setPreviewChauffeur((v) => !v)}
                      className={cn(previewChauffeur && 'bg-keuze-vlak text-keuze-vlak-tekst hover:bg-keuze-vlak hover:text-keuze-vlak-tekst')}
                    >
                      <Eye size={16} />
                    </IconButton>
                  )}
                  {/* Werkvoorraad — tussen de preview-toggle en de bel (idee
                      Jarno 31-08): open taken vanuit elk scherm zichtbaar;
                      verving de statuspil op het planner-dashboard. */}
                  {isPlanner && (werkvoorraad ? (
                    // Lazy (punt 18); de fallback heeft de maat van de
                    // IconButton sm zodat de topbar niet verspringt in de
                    // oogwenk voordat de chunk (al bij het inloggen gestart) er is.
                    <Suspense fallback={WERKVOORRAAD_PLEK}>
                      <LazyWerkvoorraadMenu
                        werkvoorraad={werkvoorraad}
                        userNaam={(id) => users.find((u) => String(u.id) === String(id))?.name || 'Onbekend'}
                        onNavigate={setCurrentView}
                      />
                    </Suspense>
                  ) : (
                    // Zelfde plekje zolang de berekening (lazy module) nog
                    // onderweg is, zodat bel en avatar niet opschuiven.
                    WERKVOORRAAD_PLEK
                  ))}
                  {/* Bel = meldingencentrum (06-09): eigen meldingen met
                      ongelezen-teller; de werkvoorraad-knop hiernaast blijft
                      de open taken van staf tellen. */}
                  <MeldingenBel onNavigate={setCurrentView} actief={resolvedCurrentView === 'meldingen'} />
                  {isPlanner && <Suspense fallback={null}><LazyAanwezigheidStack /></Suspense>}
                  {/* Wikkel zonder eigen doos (contents): bij hover/focus op
                      het avatar-menu de lazy account-overlays alvast ophalen. */}
                  <span className="contents" onPointerEnter={laadAccountOverlays} onFocus={laadAccountOverlays}>
                  <UserMenu
                    user={currentUser}
                    initials={userInitials}
                    theme={theme}
                    onToggleTheme={toggleTheme}
                    pushBeschikbaar={!!pushPublicKey && isPushSupported()}
                    pushEnabled={pushEnabled}
                    onTogglePush={togglePush}
                    onChangePassword={() => setShowChangePassword(true)}
                    onProbleem={() => setShowProbleemMelder(true)}
                    onLogout={handleLogout}
                    onInstellingen={() => setCurrentView('instellingen')}
                  />
                  </span>
                </div>
              </div>
            </header>
          </div>
          {/* Offline-banner: de topbar-pill is desktop-only (hidden lg:flex),
              dus op de iPhone — hét toestel — was een uitval onzichtbaar en
              keek je zonder het te weten naar verouderde data. */}
          {/* Mijn dag draagt zijn eigen stille offline-chip (06-09) —
              daar geen kaart erbovenop. */}
          {onderhoud.actief && (
            <div className={cn('mx-auto w-full', kolomClass)}>
              <OnderhoudBanner onderhoud={onderhoud} tot={onderhoud.tot} className="mb-4" />
            </div>
          )}
          {!isOnline && resolvedCurrentView !== 'mijn-dag' && (
            <div className={cn('mx-auto w-full', kolomClass)}>
              <Callout tone="warning" compact icon={<WifiOff size={14} />} className="mb-4">
                Offline, wijzigingen komen niet door
                {lastSyncedAt ? ` · laatst bijgewerkt ${formatSyncedTime(lastSyncedAt)}` : ''}
              </Callout>
            </div>
          )}
          {/* Directe view-wissel — geen AnimatePresence/motion. Een in/uit-
              animatie op de hele view (mode="wait" = exit + enter, ~0.56s op
              een grote DOM) veroorzaakte hapering bij het wisselen van pagina's
              op tragere Windows-pc's. Instant = sneller en jank-vrij. */}
          <div id="hoofdinhoud" tabIndex={-1} className={cn('mx-auto w-full focus-stil', kolomClass)}>
            {/* Foutgrens per view: een crash in één scherm laat sidebar,
                sessie en context staan; de key reset de grens bij een
                viewwissel of "Opnieuw proberen". */}
            <ErrorBoundary key={`${resolvedCurrentView}-${viewFoutReset}`} fallback={<ViewFout onRetry={() => setViewFoutReset((n) => n + 1)} />}>
            {/* Eén Suspense voor alle (lazy) views + een zachte inloop per
                scherm (SchermInloop: opacity/y op DUR.base, alleen als de view
                transition het niet al doet; reduced motion = niets). De
                Verwissel-wrappers cross-faden het skelet naar de inhoud. */}
            {/* Dashboard = tegelraster, dus daar het rastergetrouwe skelet
                (zelfde als in AppSkeleton) i.p.v. de kop-plus-lijst. */}
            <Suspense fallback={resolvedCurrentView === 'dashboard' ? <DashboardSkelet /> : skeletVoor(resolvedCurrentView)}>
              <SchermInhoud
                resolvedCurrentView={resolvedCurrentView}
                setCurrentView={setCurrentView}
                navigeer={navigeer}
                isAdmin={isAdmin}
                isPlanner={isPlanner}
                previewingChauffeur={previewingChauffeur}
                ruilDataKlaar={ruilDataKlaar}
                swapPreselectShiftId={swapPreselectShiftId}
                setSwapPreselectShiftId={setSwapPreselectShiftId}
                theme={theme}
                toggleTheme={toggleTheme}
                pushEnabled={pushEnabled}
                pushPublicKey={pushPublicKey}
                togglePush={togglePush}
                handleLogout={handleLogout}
                setShowProbleemMelder={setShowProbleemMelder}
                setShowChangePassword={setShowChangePassword}
                setShowAgenda={setShowAgenda}
                currentUser={currentUser}
              />
            </Suspense>
            </ErrorBoundary>
          </div>
        </div>
      </main>
      </div>

      {/* Mobile bottom-nav (alleen op klein scherm, alleen voor ingelogde gebruikers) */}
      <BottomNav
        currentView={resolvedCurrentView}
        onSelect={(v) => { setCurrentView(v); setIsSidebarOpen(false); }}
        role={effectiveRole}
        unseenLeaveCount={unseenLeaveDecisionCount}
        pendingLeaveCount={pendingLeaveCount}
        pendingSwapsCount={pendingSwapsCount}
        onMore={() => setIsSidebarOpen(true)}
        moreBadge={isPlanner ? 0 : targetedSwapsCount}
        hidden={isSidebarOpen}
      />

    </AppDataProvider>
  );
}
