# E2E-smoke (Playwright)

Lichte, **lokaal uitvoerbare** rooktest die de échte gebouwde app op een
iPhone-viewport boot. Vangt het ergste faalgeval af — een white-screen door een
crash bij het opstarten — en checkt dat het loginscherm mobiel netjes rendert.

Bewust **niet** in de GitHub-CI gehaakt: een volledige browser-download én de
ingelogde flow vragen een testaccount/backend die er (nog) niet is. De CI blijft
zo snel (typecheck + Vitest).

## Draaien

```bash
npx playwright install chromium   # eenmalig, lokaal
npm run test:e2e                  # bouwt + serveert + test
npm run test:e2e:ui               # interactieve UI-modus
```

De config (`playwright.config.ts`) bouwt de app met dummy-Supabase-env zodat het
loginscherm rendert i.p.v. de "configuratie ontbreekt"-melding, en serveert de
dist via `vite preview` op poort 4173.

## Uitbreiden

Zodra er een seed-/testaccount is, kan de ingelogde chauffeur-flow erbij:
inloggen → dienstoverzicht → een dienst openen. Voeg dan per flow een `*.spec.ts`
toe in deze map.
