import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';

// Build-info voor de versie-indicator in Systeem-status. Vercel injecteert de
// commit-SHA; lokaal blijft die leeg. builtAt = tijdstip van de build.
const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, 'package.json'), 'utf-8'));
const BUILD_INFO = {
  version: String(pkg.version ?? '0.0.0'),
  sha: (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7),
  builtAt: new Date().toISOString(),
};

export default defineConfig(() => {
  return {
    plugins: [react(), tailwindcss()],
    define: {
      __BUILD_INFO__: JSON.stringify(BUILD_INFO),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    build: {
      // Sourcemaps mee-deployen: de foutendigest vertaalt geminifieerde
      // stack-posities terug naar src/-bestanden (api/symbolicate.ts) en
      // DevTools tonen leesbare code. De repo is publiek — de maps lekken
      // niets dat niet al op GitHub staat. .map-bestanden tellen niet mee
      // in scripts/check-bundle-size.mjs (die telt alleen .js).
      sourcemap: true,
      // Enige chunk boven de standaard-500kB is xlsx (~500 kB min.) — die is
      // al lazy (alleen geladen bij een Excel-import in Beheer) en zit vast
      // op de SheetJS-CDN-versie. De échte bewaker is de CI-gzip-budgetcheck
      // (scripts/check-bundle-size.mjs, 600 kB); deze limiet dempt alleen de
      // vaste build-warning zonder nieuwe uitschieters te verstoppen.
      chunkSizeWarningLimit: 520,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            // Volgorde is betekenisvol: 'lucide-react' en 'react-leaflet'
            // bevatten allebei de substring 'react' — de brede react-check
            // ving ze eerst af, waardoor de complete kaart-stack (leaflet +
            // react-leaflet) én alle lucide-iconen in react-vendor zaten en
            // dus bij elke pagina-load meekwamen, terwijl DiversionMap juist
            // lazy is. Kaart-stack nu apart: die laadt alleen wanneer iemand
            // een omleiding met kaart opent.
            if (id.includes('leaflet')) {
              return 'map-vendor';
            }
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
            if (id.includes('nodemailer')) {
              return 'integrations-vendor';
            }
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});
