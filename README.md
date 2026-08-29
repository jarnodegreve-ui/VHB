# VHB Portaal

Personeelsportaal van busbedrijf VHB (onderaannemer De Lijn): rooster, verlof,
dienstruilen, omleidingen, documenten en het laadpalen-dashboard voor
chauffeurs en planners. iPhone-first PWA.

**Stack:** Vite + React + TypeScript + Tailwind (`src/`), Express-API als één
Vercel-functie (`api/`), Supabase (Postgres, Auth, Storage, Realtime).

```bash
npm install
cp .env.example .env.local   # Supabase- en SMTP-waarden invullen
npm run dev                  # API + Vite-middleware op http://localhost:3000
npm run test                 # vitest (unit + API-integratie)
npm run test:e2e             # Playwright (eenmalig: npx playwright install chromium)
npm run lint                 # tsc --noEmit
```

Werkafspraken en architectuur: `CLAUDE.md`. Productcontext en gebruikers:
`PRODUCT.md`. Back-up en herstel: `docs/RESTORE.md`.
