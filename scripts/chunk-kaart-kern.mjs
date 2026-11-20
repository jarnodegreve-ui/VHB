/**
 * De chunk-kaart van de warmup: welke views erin horen. Pure kern, zonder
 * I/O, gedeeld door vite.config.ts (de plugin vhb-view-chunks schrijft alleen
 * deze views in de kaart) en scripts/check-bundle-size.mjs (bewaakt dat de
 * kaart precies deze views draagt).
 *
 * Tot 20-11-2026 schreef de plugin elke view in de kaart (43 views, 21,7 kB
 * ruw, ±1,7 kB gzip in de startbundel), terwijl alleen de warmup de kaart
 * leest, en alleen voor WARMUP_VIEWS (src/app/viewLoaders.ts, `warmViews`).
 * De prefetch bij hover of aanraken gebruikt de kaart niet: die roept de
 * loader van de view aan.
 */

/**
 * Startschermen die zod-vrij moeten blijven (bewaker 5 van check-bundle-size).
 * Ze staan in de kaart, ook de cockpit, die geen eigen warmup-view is: de
 * bewaker leest hun chunk-set uit de kaart.
 */
export const ZOD_VRIJE_VIEWS = ['views/MijnDagView', 'views/DashboardView', 'views/PlannerDashboardWidgets', 'views/ScheduleView'];

/**
 * Leest de tekst van src/app/viewLoaders.ts: de tabel view → pad (met de
 * regels waar het pad en de import ernaast verschillen) en WARMUP_VIEWS per
 * rol.
 * @param {string} bron
 * @returns {{ padPerView: Map<string, string>, drift: Array<{ view: string, pad: string, importPad: string }>, warmup: { chauffeur: string[], staf: string[] } }}
 */
export function leesViewLoaders(bron) {
  const padPerView = new Map();
  const drift = [];
  for (const m of bron.matchAll(/^\s*'?([\w-]+)'?:\s*view\('([^']+)',\s*\(\)\s*=>\s*import\('\.\.\/([^']+)'\)\)/gm)) {
    const [, view, pad, importPad] = m;
    padPerView.set(view, pad);
    if (pad !== importPad) drift.push({ view, pad, importPad });
  }
  const blok = bron.match(/WARMUP_VIEWS[^=]*=\s*\{([\s\S]*?)\n\};/);
  /** @param {string} rol */
  const lijst = (rol) => {
    const m = blok?.[1].match(new RegExp(`${rol}:\\s*\\[([^\\]]*)\\]`));
    return m ? [...m[1].matchAll(/'([\w-]+)'/g)].map((x) => x[1]) : [];
  };
  return { padPerView, drift, warmup: { chauffeur: lijst('chauffeur'), staf: lijst('staf') } };
}

/**
 * De sleutels (paden t.o.v. src/, zonder extensie) die in de kaart horen: de
 * views van WARMUP_VIEWS voor beide rollen, plus de zod-vrije startschermen.
 * `null` als de lijst niet te lezen is (een rol zonder views, of een view
 * zonder pad): de plugin schrijft dan de volledige kaart, zodat de warmup
 * nooit op evalueren terugvalt, en check-bundle-size faalt erop.
 * @param {string} bron
 * @returns {Set<string> | null}
 */
export function kaartSleutels(bron) {
  const { padPerView, warmup } = leesViewLoaders(bron);
  if (warmup.chauffeur.length === 0 || warmup.staf.length === 0) return null;
  const paden = [...warmup.chauffeur, ...warmup.staf].map((v) => padPerView.get(v));
  if (paden.some((p) => !p)) return null;
  return new Set([...paden, ...ZOD_VRIJE_VIEWS]);
}

/**
 * De kaart met alleen de sleutels die erin horen, in de volgorde van de
 * volledige kaart. Zonder sleutels (`null`) de volledige kaart.
 * @param {Record<string, string[]>} kaart
 * @param {Set<string> | null} sleutels
 * @returns {Record<string, string[]>}
 */
export function beperkKaart(kaart, sleutels) {
  if (!sleutels) return kaart;
  return Object.fromEntries(Object.entries(kaart).filter(([sleutel]) => sleutels.has(sleutel)));
}
