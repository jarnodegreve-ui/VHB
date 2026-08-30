# PlanX — VHB-personeelsportaal

Portaal voor het busbedrijf (GitHub-repo `jarnodegreve-ui/VHB`). Vite + React + TS + Tailwind (`src/`), serverless API (`api/`), Supabase. Prod = Vercel-project `vhb` → vhb-five.vercel.app (Pro). **`vhb-planner` is een ánder Vercel-project** (rostering) — nooit daarheen deployen.

## Git & sessies
- **Nooit `git add -A`** — parallelle sessies delen deze working tree (rostering/, losse WIP). Stage expliciete paden; voor gedeelde bestanden (api/index.ts, vercel.json): aparte git-worktree vanaf origin/main.
- Features landen via feature-branch + PR, niet rechtstreeks op main.
- `rostering/` = geneste eigen repo (CP-SAT-solver, eigen memory) — niet aanraken tenzij gevraagd.

## API & deploy
- **Elk bestand in `api/` wordt een aparte Vercel-functie.** Gedeelde modules → `api/_lib/` (underscore bouwt niet als functie). vercel.json rewrites sturen alles naar api/index.ts.
- Deploy verifiëren via Vercel-MCP (`list_deployments`, `get_deployment_build_logs`) — niet met curl-salvo's (bot-challenge) of de GitHub-deployments-API. Functionele marker: nieuw endpoint 401 = live, 404 = oud. Bundel-hash lokaal vs. live vergelijken werkt NIET.
- Crons in vercel.json, CRON_SECRET-beveiligd (Pro: frequenter dan dagelijks mag).

## Database
- Supabase met **quoted camelCase-identifiers** (anders dan snake_case elders). Migraties handmatig in SQL Editor, idempotent; hergebruik `public.set_updated_at()` en `current_app_user_role()` uit setup_security.sql. Kolomnamen moeten matchen met api/storage.ts + api/types.ts. Elke .sql eerst langs de `supabase-sql-reviewer` (hook doet dit automatisch).

## Huisstijl (bindend)
- **Definitief logo** (pakket 2026-08): `brand/vhb-final-logo-package/` + `VHB-gebruiksrichtlijnen.md` — onderbroken ovale lus, VHB-monogram met gouden H-verbinding, naamregel als contouren. In de app uitsluitend via `<BrandLogo tone variant>` (inline SVG, kleuren bewust hard). Sizen op **breedte**: login/pre-app `w-56`/`w-64`; sidebar het volledige logo op `w-36` (144 px — bewust onder de 180 px-richtlijn, keuze Jarno 30-08: groter was te groot, zonder naamregel wilde hij niet; niet kleiner). Negatief (`tone="donker"`) is gedempt wit `#E4E6E8`, geen `#FFFFFF` (te fel op het zwart). Niet vervormen, lus-onderbreking niet sluiten, geen schaduw/gloed/verloop.
- Iconen/favicon in `public/` worden gegenereerd: `node scripts/brand-icons.mjs` (beeldmerk-negatief op VHB Black-tegel) — niet met de hand bewerken.
- Warm goud `#E2A323` (tokens `oker-*`, anker op 500); Carbonzwart `#14181B` = logo-inkt en `slate-900` (tekst op licht); VHB Black `#0D0D0F` blijft de basis van dark mode, login, theme-color/manifest en de icoon-tegel (Jarno 30-08: de carbon-variant oogde minder mooi); Graphite `#2C3137`, Light Grey `#F2F3F4`. `amber-*` = semantische waarschuwingskleur (bewust los van brand). Geen rauwe hex — altijd tokens (enige uitzondering: het logo zelf).
- Op goud-vlakken altijd carbon-tekst (`text-slate-950`), nooit wit (contrast ±2:1).
- Manrope (ExtraBold) koppen / Inter body. `brand/VHB-huisstijl/` en `brand/vhb-logo-redesign/` ("VHB Schakel") zijn historisch — vervangen op 2026-08-30, niet meer gebruiken.
- sw.js: cache-naam wordt per build gestempeld (vite.config.ts), handmatig bumpen hoeft niet. Dark mode: utilities met opacity-suffix (bv. `border-slate-200/70`) hebben eigen `.dark`-overrides nodig.

## Memory
Evoluerende staat & deploy-/OCPI-lessen: auto-memory van dit project (MEMORY.md-index).
