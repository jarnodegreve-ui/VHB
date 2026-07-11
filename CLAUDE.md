# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

VHB Portaal — a Dutch-language web portal for VHB bus drivers (chauffeurs), planners and admins: work schedules, route diversions, leave requests, shift swaps, plus admin/planner management views and read-only OCPI monitoring of the company's EV chargers.

**Everything is in Dutch**: UI text, code comments, commit messages (conventional style, e.g. `feat(ux): chauffeur-eenvoud batch 3 — rust & consistentie`), and domain terms (verlof = leave, ruil = swap, rooster = schedule, omleiding = diversion, dienst = service/duty). Write new comments and user-facing text in Dutch.

## Commands

```bash
npm run dev          # Start everything on http://localhost:3000 (Express + Vite middleware, one process)
npm run lint         # Type check only (tsc --noEmit) — there is no ESLint
npm test             # vitest run (all tests)
npm run test:watch   # vitest in watch mode
npx vitest run src/lib/compliance.test.ts   # Run a single test file
npm run build        # vite build → dist/
```

CI (`.github/workflows/ci.yml`) runs `npm run lint` + `npm test` on Node 20. Both must pass.

Environment: copy `.env.example` to `.env.local`. Supabase needs **both** server vars (`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) and browser vars (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`).

## Architecture

One Express app serves both the API and the SPA:

- **`api/index.ts`** (~2400 lines) — all REST routes. In dev it mounts Vite as middleware; on Vercel, `vercel.json` rewrites every `/api/*` request to this file as a serverless function and everything else to `index.html`. Cron endpoints (`/api/cron/backup`, `error-digest`, `ocpi-sync`) are scheduled in `vercel.json`.
- **`api/storage.ts`** — the data-access layer (Supabase Postgres). Routes call these functions, never Supabase directly.
- **`api/helpers.ts`** — `toDatabaseX` / `toPublicX` mapping between DB rows and API shapes, plus sanitization.
- **`api/middleware.ts`** — `authenticate` (Supabase JWT → app user looked up by email via `userCache.ts`) and `requireRole(...roles)`.
- **`api/ocpi.ts`** — self-contained OCPI 2.2.1 eMSP module (read-only monitoring of ChargEye/Kempower chargers). It has its **own token auth** (Token A/C handshake, state in the `ocpi_registration` table), completely separate from Supabase auth.

Frontend is a React 19 SPA **without a router**:

- **`src/App.tsx`** (~1800 lines) is the hub: all collection state lives here as `useState` and is passed to views as props. Navigation is a `View` string union (see `src/types.ts`) gated by `ALLOWED_VIEWS_BY_ROLE`. Heavy admin views are lazy-loaded.
- **`src/views/`** — one component per view, admin-only views under `src/views/admin/`.
- **`src/lib/`** — pure domain logic (compliance, leave balance, conflicts, coverage, ICS…) with colocated `*.test.ts` files. Put new business rules here, not in components.
- **`src/lib/realtime.ts`** — Supabase Realtime subscription that debounce-refetches collections when the DB changes (planner approves leave → driver sees it live).

### Roles and authorization

Three roles: `chauffeur`, `planner`, `admin`. The **server** enforces access via `requireRole(...)` in routes; **`src/lib/authorization.ts`** mirrors the same rules purely for showing/hiding UI — it is not security. When you change a permission rule, update both sides.

### Supabase specifics

- `api/db.ts` exports three clients: `supabase` (anon, used for auth verification), `supabaseAdmin` (service role), and `db = supabaseAdmin ?? supabase` used by storage.
- **There are no managed migrations.** `supabase/*.sql` files are run by hand in the Supabase SQL editor; write them idempotent (`create table if not exists`, `add column if not exists`) and self-contained, like the existing ones.
- **Always paginate reads of growing tables** via `paginatedFetch` in `storage.ts` — PostgREST silently caps responses at 1000 rows (this caused a real data-loss-looking incident).
- Bulk collection replaces go through a transactional Postgres function (`supabase/transactional_replace.sql`); the JS fallback in `storage.ts` only triggers when that function is missing, never on real errors.

### Concurrency and safety patterns

- **Optimistic concurrency**: collection GETs return an `X-Collection-Revision` header; `App.tsx` stores it and sends it back on save. Mismatch → 409 → client refetches instead of overwriting a colleague's change. New save endpoints for shared collections should follow this pattern.
- Rate limiting (`api/rateLimit.ts`) is per user token, in-memory — on Vercel that means per warm serverless instance, not global. That's a deliberate trade-off; don't "fix" it by adding a shared store without being asked.
- `App.tsx` blocks saving a collection that never finished loading (`guardCollectionLoaded`) to avoid wiping data.

### Testing

Vitest with jsdom; the include pattern is `src/**/*.test.ts(x)` only. That's why tests for `api/` code also live in `src/` (e.g. `src/rateLimit.test.ts`, `src/userCache.test.ts`, `src/apiIntegration.test.ts`) — put new API tests there too, or the runner won't find them.

## Other notes

- Path alias `@/*` maps to the **repo root** (not `src/`).
- Two fetch helpers exist on purpose: `App.tsx` has its own `apiFetch` (revision-aware, session from React state); `src/lib/api.ts` `apiFetch` is for standalone components/modals that fetch their own data.
- PWA: service worker in `public/sw.js`, web push via `api/push.ts` (VAPID) + `src/lib/push.ts`.
- `brand/VHB-huisstijl/` holds brand assets (fonts, logos, invoice template); `public/` holds the deployed icons.
- `scripts/convert-planning-matrix.ts` (`npm run convert:planning-matrix`) converts the planning Excel; `gen_services_sql.cjs` and `supabase/_seed_services_from_excel.sql` seed services data.
- Vite HMR is intentionally disabled when `DISABLE_HMR=true` (AI Studio) — leave that logic in `vite.config.ts` alone.
