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

## Beleidssnapshot

Migraties draaien met de hand in de Supabase SQL Editor, dus niets bewijst dat
wat live staat nog is wat de repo zegt. De workflow `Beleidsdrift`
(`.github/workflows/beleid-drift.yml`) vergelijkt daarom elke nacht (06:00
Belgische zomertijd) de live beveiligingsstand (RLS per tabel, policies,
grants, security-definer-functies; `public.security_snapshot()`) met het
gecommitte `supabase/beleid-snapshot.json`. Verschil = rode run = mail via
de gewone GitHub-notificaties. Ook handmatig te starten via Actions › Run
workflow.

Eenmalig inrichten:

1. `supabase/2026-09-08_security_snapshot.sql` draaien in de SQL Editor
   (productie; staging ook als je die wilt bewaken).
2. Secrets zetten (waarden uit Project Settings › API; de service_role-sleutel
   blijft alleen in GitHub en `.env.local`):
   ```bash
   gh secret set SUPABASE_URL
   gh secret set SUPABASE_SERVICE_ROLE_KEY
   # optioneel, staging:
   gh secret set STAGING_SUPABASE_URL
   gh secret set STAGING_SERVICE_ROLE_KEY
   ```
   Zonder de productie-secrets slaat de job over met een melding (geen fout).
3. Eerste snapshot maken en committen:
   ```bash
   node --env-file=.env.local scripts/beleid-drift.mjs --update
   git add supabase/beleid-snapshot.json
   ```
   Staging: `--omgeving staging --update` (leest `STAGING_SUPABASE_URL` en
   `STAGING_SERVICE_ROLE_KEY`, schrijft `supabase/beleid-snapshot-staging.json`;
   zonder dat bestand wordt staging overgeslagen).

Daarna: **elke migratie die RLS, policies, grants of definer-functies raakt**
= na het draaien opnieuw `--update` en het snapshotbestand mee committen,
anders is de volgende nacht rood. Lokaal vergelijken:
`node --env-file=.env.local scripts/beleid-drift.mjs` (exit 1 met de diff bij
verschil). Zuivere logica en tests: `scripts/beleid-drift-kern.mjs`,
`src/lib/beleidDrift.test.ts`.
