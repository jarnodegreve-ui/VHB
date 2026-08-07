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
- VHB Amber `#E8A33D` (tokens `oker-*`), VHB Black `#0D0D0F`, Graphite `#2C3137`, Light Grey `#F2F3F4`. `amber-*` = semantische waarschuwingskleur (bewust los van brand). Geen rauwe hex — altijd tokens.
- Op amber-vlakken altijd VHB Black-tekst (`text-slate-950`), nooit wit (contrast 2,2:1).
- Manrope (ExtraBold) koppen / Inter body. Bronpakket `brand/VHB-huisstijl/` + `brand/vhb-logo-redesign/` ("VHB Schakel", sinds 2026-07 het actieve logo — bewust niet in public/; logo's wel: vhb-logo.svg = portaal-lockup 740×160 (ratio 4.63:1), vhb-logo-wit.svg = reverse, vhb-logo-stacked.svg = login; outlined SVG's, geen font-afhankelijkheid).
- sw.js: bij asset-wissels CACHE_NAME bumpen (cache-first). Dark mode: utilities met opacity-suffix (bv. `border-slate-200/70`) hebben eigen `.dark`-overrides nodig.

## Memory
Evoluerende staat & deploy-/OCPI-lessen: auto-memory van dit project (MEMORY.md-index).
