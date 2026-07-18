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
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules')) {
              if (id.includes('react') || id.includes('scheduler')) {
                return 'react-vendor';
              }
              if (id.includes('@supabase')) {
                return 'supabase-vendor';
              }
              if (id.includes('lucide-react') || id.includes('motion') || id.includes('clsx') || id.includes('tailwind-merge')) {
                return 'ui-vendor';
              }
              if (id.includes('nodemailer')) {
                return 'integrations-vendor';
              }
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
