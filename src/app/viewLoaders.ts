import type { View } from '../types';

type Loader = () => Promise<unknown>;

/**
 * Eén loader per view, gebruikt door de lazy componenten in App.tsx én door
 * de prefetch bij hover/aanraken van een nav-item (SidebarNav, BottomNav).
 * Zo zit alleen de schil in de startbundel en voelt de eerste navigatie toch
 * instant. Bewust géén xlsx-views voorladen: die (±430 kB) laden pas bij echt
 * gebruik.
 *
 * `pad` = het bronbestand t.o.v. src/ zonder extensie. Dat is de sleutel in
 * de chunk-kaart die de build achteraan index-*.js schrijft (vite.config.ts,
 * plugin vhb-view-chunks), waarmee de warmup een view kan dównloaden zonder
 * hem te evalueren. scripts/check-bundle-size.mjs controleert dat pad en
 * import hier hetzelfde bestand noemen.
 */
const view = (pad: string, laad: Loader) => ({ pad, laad });

const VIEWS: Record<View, { pad: string; laad: Loader }> = {
  dashboard: view('views/DashboardView', () => import('../views/DashboardView')),
  'mijn-dag': view('views/MijnDagView', () => import('../views/MijnDagView')),
  rooster: view('views/ScheduleView', () => import('../views/ScheduleView')),
  omleidingen: view('views/DiversionsView', () => import('../views/DiversionsView')),
  ritblaadjes: view('views/RitblaadjesView', () => import('../views/RitblaadjesView')),
  documenten: view('views/DocumentsView', () => import('../views/DocumentsView')),
  'ruil-verzoeken': view('views/SwapRequestsView', () => import('../views/SwapRequestsView')),
  verlof: view('views/LeaveManagementView', () => import('../views/LeaveManagementView')),
  updates: view('views/UpdatesView', () => import('../views/UpdatesView')),
  meldingen: view('views/MeldingenView', () => import('../views/MeldingenView')),
  contacten: view('views/ContactsView', () => import('../views/ContactsView')),
  bezetting: view('views/CapacityView', () => import('../views/CapacityView')),
  'beheer-roosters': view('views/admin/ManageSchedulesView', () => import('../views/admin/ManageSchedulesView')),
  'planning-matrix': view('views/admin/PlanningMatrixView', () => import('../views/admin/PlanningMatrixView')),
  'planning-codes': view('views/admin/PlanningCodesView', () => import('../views/admin/PlanningCodesView')),
  dienstoverzicht: view('views/ServicesView', () => import('../views/ServicesView')),
  'beheer-dienstoverzicht': view('views/admin/ManageServicesView', () => import('../views/admin/ManageServicesView')),
  dekking: view('views/CoverageView', () => import('../views/CoverageView')),
  'verlof-kalender': view('views/admin/VerlofKalenderView', () => import('../views/admin/VerlofKalenderView')),
  ziekte: view('views/admin/ZiekteView', () => import('../views/admin/ZiekteView')),
  vervaldata: view('views/admin/VervaldataView', () => import('../views/admin/VervaldataView')),
  'beheer-updates': view('views/admin/ManageUpdatesView', () => import('../views/admin/ManageUpdatesView')),
  'beheer-omleidingen': view('views/admin/ManageDiversionsView', () => import('../views/admin/ManageDiversionsView')),
  gebruikers: view('views/admin/ManageUsersView', () => import('../views/admin/ManageUsersView')),
  toestellen: view('views/admin/DevicesView', () => import('../views/admin/DevicesView')),
  activiteit: view('views/admin/ActivityLogView', () => import('../views/admin/ActivityLogView')),
  'ocpi-monitoring': view('views/admin/OcpiDashboardView', () => import('../views/admin/OcpiDashboardView')),
  'beheer-debug': view('views/admin/DebugView', () => import('../views/admin/DebugView')),
  instellingen: view('views/InstellingenView', () => import('../views/InstellingenView')),
  designsysteem: view('views/admin/DesignsysteemView', () => import('../views/admin/DesignsysteemView')),
  defecten: view('views/techniek/GeleBoekView', () => import('../views/techniek/GeleBoekView')),
  werkprestaties: view('views/techniek/WerkprestatiesView', () => import('../views/techniek/WerkprestatiesView')),
  'voertuig-werken': view('views/techniek/VoertuigWerkenView', () => import('../views/techniek/VoertuigWerkenView')),
  voertuigen: view('views/techniek/VoertuigenView', () => import('../views/techniek/VoertuigenView')),
  dagafsluiting: view('views/admin/DagafsluitingView', () => import('../views/admin/DagafsluitingView')),
  looncontrole: view('views/admin/LooncontroleView', () => import('../views/admin/LooncontroleView')),
  dienstopbouw: view('views/admin/DienstopbouwView', () => import('../views/admin/DienstopbouwView')),
  werkvoorraad: view('views/WerkvoorraadView', () => import('../views/WerkvoorraadView')),
};

export const VIEW_LOADERS: Record<View, Loader> = Object.fromEntries(
  (Object.keys(VIEWS) as View[]).map((v) => [v, VIEWS[v].laad]),
) as Record<View, Loader>;

const ZWAAR: ReadonlySet<View> = new Set<View>(['beheer-roosters', 'beheer-dienstoverzicht', 'gebruikers']);
const gedaan = new Set<View>();

/** Stil voorladen én evalueren (idempotent); zware xlsx-views alleen op
 *  expliciete vraag. Voor hover/aanraken van een nav-item: de klik erna
 *  voelt instant. Heeft de warmup de bytes al binnen (zie warmViews), dan
 *  komt de download uit de cache en blijft alleen het evalueren over. */
export function prefetchView(view: View, opts: { ookZwaar?: boolean } = {}) {
  if (gedaan.has(view)) return;
  if (ZWAAR.has(view) && !opts.ookZwaar) return;
  gedaan.add(view);
  void VIEWS[view].laad().catch(() => { gedaan.delete(view); });
}

/**
 * Welke schermen na het inloggen stil opgewarmd worden, per rol: de schermen
 * die hierna het vaakst geopend worden. Dashboard/Mijn dag/Rooster voorop
 * (wie op een deeplink landt heeft het dashboard nog niet, en Mijn dag is de
 * eerste tik van elke chauffeur). Niet 'verlof' (14-09): die view sleept de
 * schemas- en zod-chunk mee (±20 kB brotli) en de nav-prefetch bij hover of
 * aanraken dekt hem al. De startschermen zelf (dashboard, cockpit, Mijn dag,
 * rooster) zijn sinds 19-09 zod-vrij: ze lezen de voorkeuren via de parser in
 * shared/dashboardVoorkeuren.ts, en check-bundle-size faalt als zod in hun
 * chunk-set terugkeert. In de staf-set zit zod nog wel, via dekking en de
 * verlofkalender. Niet de xlsx-views (500 kB): die laden pas bij echt
 * gebruik. scripts/check-bundle-size.mjs leest deze lijst en bewaakt de
 * totale grootte van de warmup-set.
 */
export const WARMUP_VIEWS: Record<'chauffeur' | 'staf', readonly View[]> = {
  chauffeur: ['dashboard', 'mijn-dag', 'rooster', 'omleidingen', 'ruil-verzoeken'],
  staf: ['dashboard', 'mijn-dag', 'rooster', 'dekking', 'bezetting', 'verlof-kalender', 'ruil-verzoeken'],
};

/** Chunk-kaart uit de build (vite.config.ts, plugin vhb-view-chunks); in dev
 *  of bij een oude shell afwezig, dan valt de warmup terug op `import()`. */
const chunkKaart = (): Record<string, string[]> | null => {
  const kaart = (globalThis as { __VHB_VIEW_CHUNKS__?: unknown }).__VHB_VIEW_CHUNKS__;
  return kaart && typeof kaart === 'object' ? (kaart as Record<string, string[]>) : null;
};

const prefetchLinkOndersteund = (): boolean => {
  try {
    return typeof document !== 'undefined' && document.createElement('link').relList?.supports?.('prefetch') === true;
  } catch {
    return false;
  }
};

const gewarmd = new Set<string>();

/** Eén chunk alleen dównloaden (niet evalueren), zodat de latere `import()`
 *  uit de HTTP-cache komt. Chromium/Firefox: `<link rel="prefetch">` (laagste
 *  netwerkprioriteit, geen hoofdthread). Safari kent geen prefetch-link; daar
 *  doet een gewone fetch met dezelfde credentials hetzelfde werk, precies
 *  zoals Vite's modulepreload-polyfill dat voor Safari doet. Mislukt het,
 *  dan is er niets verloren: de navigatie haalt de chunk dan gewoon op. */
function warmChunk(url: string): Promise<void> {
  if (gewarmd.has(url)) return Promise.resolve();
  gewarmd.add(url);
  if (prefetchLinkOndersteund()) {
    return new Promise<void>((klaar) => {
      const link = document.createElement('link');
      link.rel = 'prefetch';
      link.as = 'script';
      link.href = url;
      // Vangnet: een link die nooit load/error meldt mag de rij niet blokkeren.
      const timer = window.setTimeout(klaar, 8000);
      const af = () => { window.clearTimeout(timer); klaar(); };
      link.onload = af;
      link.onerror = af;
      document.head.appendChild(link);
    });
  }
  return fetch(url, { credentials: 'same-origin', ...({ priority: 'low' } as RequestInit) })
    .then((r) => r.arrayBuffer())
    .then(() => undefined, () => undefined);
}

const idle = (cb: () => void, timeout: number): (() => void) => {
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o: { timeout: number }) => number; cancelIdleCallback?: (id: number) => void };
  if (typeof w.requestIdleCallback === 'function') {
    const id = w.requestIdleCallback(cb, { timeout });
    return () => w.cancelIdleCallback?.(id);
  }
  const id = window.setTimeout(cb, Math.min(timeout, 1000));
  return () => window.clearTimeout(id);
};

/** Marge na de LCP voordat de warmup begint, en het uiterste moment zonder LCP-signaal. */
const NA_LCP_MS = 2000;
const UITERLIJK_MS = 4000;

/**
 * Stille warmup van de views die hierna waarschijnlijk geopend worden,
 * buiten het meetvenster van de eerste weergave. Geeft een opruimfunctie.
 *
 * Waarom pas ná de LCP (meting 12/13-09, .lighthouseci-rapporten van
 * /mijn-dag): dezelfde build scoorde zonder warmup 0,85 / LCP 3,9 s en met
 * de oude idle-warmup 0,81 / LCP 4,5 s, met in CI een TBT van 575-1037 ms.
 * requestIdleCallback vuurt al tijdens het opbouwen van het scherm zodra er
 * een gaatje valt, en de zes `import()`'s legden dan 75 kB brotli (>250 kB
 * JS) aan parse- en evaluatiewerk op de hoofdthread, midden in de LCP.
 *
 * Volgorde: wachten op een largest-contentful-paint-entry (PerformanceObserver,
 * met buffer) + 2 s marge, of eerder bij de eerste interactie (scroll,
 * aanraking, toets: dan staat de LCP per definitie vast), of uiterlijk 4 s na
 * de start als geen van beide komt. Dan per view, één tegelijk: met de
 * chunk-kaart van de build alleen downloaden (warmChunk), zonder kaart een
 * `import()` per idle-callback zodat de evaluaties gespreid blijven. Eén
 * tegelijk houdt ook Lighthouse' netwerk-rustcriterium (≤ 2 open verzoeken)
 * intact. Bij `saveData` gebeurt er niets.
 */
export function warmViews(views: readonly View[]): () => void {
  if (typeof window === 'undefined') return () => {};
  const verbinding = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  if (verbinding?.saveData) return () => {};

  let gestopt = false;
  let gestart = false;
  const opruimers: Array<() => void> = [];
  const ruimOp = () => { opruimers.splice(0).forEach((f) => f()); };

  const draai = async () => {
    const kaart = chunkKaart();
    for (const v of views) {
      if (gestopt) return;
      if (ZWAAR.has(v) || gedaan.has(v)) continue;
      const bestanden = kaart?.[VIEWS[v].pad];
      if (bestanden) {
        for (const url of bestanden) {
          if (gestopt) return;
          await warmChunk(url);
        }
      } else {
        // Geen kaart (dev/oude shell): evalueren dan maar, maar gespreid.
        await new Promise<void>((klaar) => { opruimers.push(idle(klaar, 2000)); });
        if (gestopt) return;
        prefetchView(v);
      }
    }
  };

  const start = (marge: number) => {
    if (gestart || gestopt) return;
    gestart = true;
    ruimOp();
    const timer = window.setTimeout(() => {
      opruimers.push(idle(() => { void draai(); }, 2000));
    }, marge);
    opruimers.push(() => window.clearTimeout(timer));
  };

  try {
    const po = new PerformanceObserver((lijst) => {
      if (lijst.getEntries().length > 0) start(NA_LCP_MS);
    });
    po.observe({ type: 'largest-contentful-paint', buffered: true });
    opruimers.push(() => po.disconnect());
  } catch {
    // Geen LCP-observer (Safari): de interactie- en tijdvangnetten hieronder volstaan.
  }
  const bijInteractie = () => start(0);
  for (const soort of ['scroll', 'pointerdown', 'keydown'] as const) {
    window.addEventListener(soort, bijInteractie, { once: true, passive: true });
    opruimers.push(() => window.removeEventListener(soort, bijInteractie));
  }
  const uiterlijk = window.setTimeout(() => start(0), UITERLIJK_MS);
  opruimers.push(() => window.clearTimeout(uiterlijk));

  return () => {
    gestopt = true;
    ruimOp();
  };
}
