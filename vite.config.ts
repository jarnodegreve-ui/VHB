import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

// Build-info voor de versie-indicator in Systeem-status. Vercel injecteert de
// commit-SHA; lokaal blijft die leeg. builtAt = tijdstip van de build.
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));
const BUILD_INFO = {
  version: String(pkg.version ?? '0.0.0'),
  sha: (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7),
  builtAt: new Date().toISOString(),
};

// Lazy chunks die de service worker bij installatie mee moet precachen:
// pdfjs-viewer (pdf-*.js) + worker (pdf.worker.min-*.js — de `?worker`-
// wrapper-chunk én het echte worker-script, dat als asset geëmitteerd wordt).
// Zelfde patroon als scripts/check-bundle-size.mjs, maar op de build-output
// i.p.v. de map, en zonder de .map-bestanden. xlsx blijft bewust buiten de
// precache (zie public/sw.js).
const PRECACHE_EXTRA_PATROON = /^assets\/pdf(\.worker)?[.-][^/]*\.js$/;

// Stempelt bij elke build twee placeholders in public/sw.js:
//  - __VHB_BUILD_ID__ → commit-SHA (Vercel) of buildtijd (lokaal), als
//    cache-naam. Zo wijzigt sw.js bij élke deploy en pikt een standalone PWA
//    de nieuwe versie vanzelf op — de handmatige CACHE_NAME-bump werd
//    structureel vergeten (14 releases lang).
//  - __VHB_PRECACHE_EXTRA__ → komma-gescheiden paden van de lazy pdf-chunks,
//    zodat "Ritblad van vandaag" ook offline werkt zonder eerst één keer
//    online geopend te zijn (bevinding 15, controle-ronde 05-09).
const stampServiceWorker = () => {
  let precacheExtra: string[] = [];
  return {
    name: 'vhb-stamp-sw',
    generateBundle(_opties: unknown, bundle: Record<string, unknown>) {
      precacheExtra = Object.keys(bundle)
        .filter((naam) => PRECACHE_EXTRA_PATROON.test(naam))
        .sort()
        .map((naam) => `/${naam}`);
    },
    closeBundle() {
      const swPath = path.resolve(__dirname, 'dist/sw.js');
      if (!fs.existsSync(swPath)) return;
      const id = BUILD_INFO.sha || BUILD_INFO.builtAt.replace(/[-:TZ.]/g, '').slice(0, 12);
      fs.writeFileSync(
        swPath,
        fs.readFileSync(swPath, 'utf-8')
          .replaceAll('__VHB_BUILD_ID__', id)
          .replaceAll('__VHB_PRECACHE_EXTRA__', precacheExtra.join(',')),
      );
    },
  };
};

// Preconnect naar Supabase (prestatiebudget 09-2026): de eerste call na het
// laden (sessie ophalen / inloggen) hoeft dan geen DNS + TLS-handshake meer af
// te wachten. De URL is at build time bekend (VITE_SUPABASE_URL), dus de tag
// wordt hier ingebakken i.p.v. in index.html gehardcodeerd — een ander
// project (staging) krijgt vanzelf zijn eigen origin. Alleen voor https:
// de dummy-localhost-URL van e2e/Lighthouse krijgt niets. `crossorigin`
// omdat supabase-js met fetch (CORS, zonder cookies) praat: alleen een
// anonieme preconnect wordt daarvoor hergebruikt.
const preconnectSupabase = (supabaseUrl: string) => ({
  name: 'vhb-preconnect-supabase',
  transformIndexHtml() {
    let origin = '';
    try { origin = new URL(supabaseUrl).origin; } catch { return []; }
    if (!origin.startsWith('https://')) return [];
    return [{ tag: 'link', attrs: { rel: 'preconnect', href: origin, crossorigin: '' }, injectTo: 'head' as const }];
  },
});

// Chunk-kaart voor de stille warmup (punt 18, 14-09). De warmup in App.tsx
// haalde zes views met `import()` op en dat evalueert ze meteen: 75 kB
// brotli / >250 kB JS aan werk op de hoofdthread binnen het meetvenster van
// Lighthouse (TBT 575-1037 ms op /mijn-dag sinds 12-09; zonder warmup
// 0,85 / LCP 3,9 s, met 0,81 / 4,5 s). Alleen downloaden (`<link
// rel="prefetch">`) kost geen hoofdthread, maar daarvoor moet de app de URL
// van een view-chunk kennen en die geeft Vite niet prijs. Deze plugin
// schrijft na het bundelen één regel achteraan index-*.js:
//   globalThis.__VHB_VIEW_CHUNKS__ = { 'views/MijnDagView': ['/assets/…'], … }
// per view (sleutel = bronbestand t.o.v. src/, zonder extensie) de chunk
// zelf plus alles wat hij statisch importeert en wat de schil nog niet
// geladen heeft. viewLoaders.ts leest de kaart; ontbreekt hij (dev), dan
// valt de warmup terug op `import()`. Achteraan toevoegen, vóór de
// sourceMappingURL-regel, houdt de sourcemap kloppend: er schuift geen
// bestaande regel op. Zelfde moment als Vite's eigen preload-kaart
// (generateBundle), dus de hashes zijn dan al definitief en de kaart beweegt
// mee met de chunks die hij benoemt.
const viewChunkKaart = () => {
  let base = '/';
  return {
    name: 'vhb-view-chunks',
    enforce: 'post' as const,
    configResolved(config: { base: string }) {
      base = config.base || '/';
    },
    generateBundle(_opties: unknown, bundle: Record<string, any>) {
      const chunks = Object.values(bundle).filter((c) => c && c.type === 'chunk');
      const entry = chunks.find((c) => c.isEntry);
      if (!entry) return;
      const perNaam = new Map<string, any>(chunks.map((c) => [c.fileName, c]));
      // Alles wat de schil zelf al (statisch, transitief) binnenhaalt.
      const alGeladen = new Set<string>();
      const loopStatisch = (naam: string, doel: Set<string>) => {
        if (doel.has(naam)) return;
        doel.add(naam);
        for (const dep of perNaam.get(naam)?.imports ?? []) loopStatisch(dep, doel);
      };
      loopStatisch(entry.fileName, alGeladen);
      const srcDir = path.resolve(__dirname, 'src');
      const kaart: Record<string, string[]> = {};
      for (const naam of entry.dynamicImports as string[]) {
        const chunk = perNaam.get(naam);
        if (!chunk?.facadeModuleId) continue;
        const sleutel = path.relative(srcDir, chunk.facadeModuleId).replace(/\\/g, '/').replace(/\.[cm]?[jt]sx?$/, '');
        if (!sleutel.startsWith('views/')) continue;
        const nodig = new Set<string>();
        loopStatisch(naam, nodig);
        kaart[sleutel] = [...nodig].filter((f) => !alGeladen.has(f)).map((f) => `${base}${f}`);
      }
      const regel = `globalThis.__VHB_VIEW_CHUNKS__=${JSON.stringify(kaart)};`;
      const code: string = entry.code;
      const staart = code.match(/\n\/\/# sourceMappingURL=[^\n]*\n?$/);
      entry.code = staart && staart.index !== undefined
        ? `${code.slice(0, staart.index)}\n${regel}${code.slice(staart.index)}`
        : `${code}\n${regel}\n`;
    },
  };
};

export default defineConfig(({ mode }) => {
  // .env-bestanden én process.env (Vercel/CI zetten de variabele direct).
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const supabaseUrl = process.env.VITE_SUPABASE_URL ?? env.VITE_SUPABASE_URL ?? '';
  return {
    plugins: [react(), tailwindcss(), stampServiceWorker(), preconnectSupabase(supabaseUrl), viewChunkKaart()],
    define: {
      __BUILD_INFO__: JSON.stringify(BUILD_INFO),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    // De pdfjs-worker (`?worker`) is een aparte Rollup-build die
    // build.rollupOptions niet erft — zonder dit droeg zijn map (2,5 MB) als
    // enige nog de volledige brontekst mee.
    worker: {
      rollupOptions: { output: { sourcemapExcludeSources: true } },
    },
    build: {
      // Sourcemaps mee-deployen: de foutendigest vertaalt geminifieerde
      // stack-posities terug naar src/-bestanden (api/symbolicate.ts). Die
      // heeft alleen de mappings + bronpaden nodig, niet de brontekst — dus
      // zonder `sourcesContent` (sourcemapExcludeSources hieronder): de maps
      // worden een fractie zo groot en er gaat geen kopie van de volledige
      // broncode publiek mee met elke deploy (controle 05-09, nr. 32; de
      // repo is publiek, maar env-afhankelijke build-paden en toekomstige
      // private code horen niet via dist/ te lekken). .map-bestanden tellen
      // niet mee in scripts/check-bundle-size.mjs (die telt alleen .js).
      sourcemap: true,
      // Enige chunk boven de standaard-500kB is xlsx (~500 kB min.) — die is
      // al lazy (alleen geladen bij een Excel-import in Beheer) en zit vast
      // op de SheetJS-CDN-versie. De échte bewaker is de CI-gzip-budgetcheck
      // (scripts/check-bundle-size.mjs, 600 kB); deze limiet dempt alleen de
      // vaste build-warning zonder nieuwe uitschieters te verstoppen.
      chunkSizeWarningLimit: 520,
      rollupOptions: {
        // zod uit de startbundel (punt 18, 14-09). De schil bereikt zod
        // statisch via app/data/kern.ts → lib/valideer.ts, dat `valideer` uit
        // shared/schemas/basis.ts her-exporteert. De schil gebruikt die export
        // niet en Rollup schudt hem weg, maar shared/schemas/zod.ts heeft een
        // top-level neveneffect (`z.config({ jitless: true })`), en dát hield
        // Rollup vast in index-*.js, samen met de zod-kern die ervoor nodig is.
        // Hier zeggen we: basis.ts (zelf alleen declaraties) telt pas mee als
        // iets een export ervan gebruikt. In de schil is dat niet zo, dus
        // Rollup volgt zijn imports daar niet en zod.ts valt weg; in de lazy
        // beheerchunks wél, en dan markeert Rollup basis als uitgevoerd en
        // neemt hij zod.ts mét `z.config` mee (default side effects). Bewust
        // niet de vlag op zod.ts zelf: dan schudt Rollup de `z.config`-aanroep
        // overal weg (gezien 14-09) en komen de CSP-eval-meldingen terug.
        // scripts/check-bundle-size.mjs bewaakt via de sourcemap dat
        // node_modules/zod niet terugkeert in de startbundel, en dat de
        // `z.config`-aanroep in een lazy chunk blijft staan.
        treeshake: {
          moduleSideEffects: (id) => !/\/shared\/schemas\/basis\.ts$/.test(id),
        },
        output: {
          // Maps zonder brontekst — zie het commentaar bij `sourcemap`.
          sourcemapExcludeSources: true,
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            // zod in een eigen chunk (punt 18, 14-09): één bestand dat alle
            // beheerschermen delen en dat de schil niet laadt (zie treeshake
            // hierboven). Bewust NIET ook shared/schemas/* in een manual
            // chunk: Rollup trekt alle statische afhankelijkheden van een
            // manual chunk mee, dus constanten.ts (zod-vrij, gebruikt door de
            // login en de schil) belandde erin en de schil importeerde de
            // chunk mét zod-vendor weer statisch (gezien 14-09). Rollup
            // plaatst de schema's zelf prima: elk bij zijn scherm, basis.ts +
            // zod.ts in een gedeelde chunk.
            if (/node_modules\/zod\//.test(id)) {
              return 'zod-vendor';
            }
            // Volgorde is betekenisvol: 'lucide-react' bevat de substring
            // 'react', dus de brede react-check hieronder zou hem anders
            // eerst afvangen.
            //
            // De map-vendor-regel is weg samen met de kaart-stack zelf
            // (controle-ronde #7): mapCoordinates bestond live niet, werd
            // nergens geschreven en had geen invoerveld, dus DiversionMap
            // rendeerde nooit — de chunk werd nooit geladen.
            // ui-vendor levert BEWUST geen uitstel-winst: lucide en motion
            // worden rechtstreeks geïmporteerd door App.tsx en BottomNav, dus
            // ze zitten hoe dan ook in het kritieke pad. Het afsplitsen is er
            // voor caching (deze bundel wijzigt zelden, de app-code elke
            // deploy) en parallelle download — niet voor minder bytes op de
            // eerste render. Wie hier ooit denkt "waarom zit lucide nog in de
            // startbundel?": dat is dit. Echt uitstellen vraagt per-icoon lazy
            // imports door de hele app; bewust niet gedaan.
            if (id.includes('lucide-react') || id.includes('motion') || id.includes('clsx') || id.includes('tailwind-merge')) {
              return 'ui-vendor';
            }
            if (id.includes('react') || id.includes('scheduler')) {
              return 'react-vendor';
            }
            if (id.includes('@supabase')) {
              return 'supabase-vendor';
            }
          },
        },
      },
    },
  };
});
