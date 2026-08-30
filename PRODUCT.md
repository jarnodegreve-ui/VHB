# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Primaire gebruiker: de **buschauffeur van VHB**, een onderaannemer van De Lijn. Hij
opent het portaal op zijn telefoon — vaak staand, buiten, kort voor of tussen twee
delen van een gesplitste dienst, met handschoenen aan of in fel daglicht. Zijn taak
is bijna altijd één van drie: *wanneer moet ik morgen beginnen en met welke dienst*,
*is er iets veranderd aan mijn route*, en *kan ik dit verlof of deze ruil geregeld
krijgen*.

Tweede gebruiker: de **planner/beheerder** (waaronder de directeur zelf), op desktop,
die bezetting en dekking bewaakt, verlof en dienstruilen beoordeelt, omleidingen
publiceert en de maandplanning uit Excel importeert.

## Product Purpose

Eén plek waar de chauffeur alles vindt wat vroeger op een prikbord in het lokaal, in
een WhatsApp-groep of in een papieren dienstregeling zat: zijn rooster, zijn
verlofsaldo, dienstruilen, actieve omleidingen, ritbladen, documenten en
mededelingen. Geslaagd = de chauffeur hoeft niemand te bellen om te weten wanneer en
waarmee hij rijdt, en de planner hoeft niets twee keer in te typen.

## Positioning

Het portaal spreekt de taal van De Lijn-onderaanneming letterlijk: **dienstnummer**,
**loopnummer per tijdsblok**, gesplitste diensten als meerdere planningsrijen,
typedagen, en een planning-matrix die rechtstreeks uit de bestaande Excel-workflow
wordt geïmporteerd. Een generiek roosterpakket kent die begrippen niet en zou de
planner dwingen zijn werkelijkheid te verminken om in het model te passen.

## Operating Context

- Chauffeur: PWA op iPhone/Android, standalone vanaf het beginscherm, regelmatig met
  slecht of geen netwerk (service worker, cache-first).
- Een dienst kan uit meerdere blokken bestaan (gesplitste dienst); elk blok heeft een
  eigen loopnummer. Een dienst die 's nachts doorloopt heeft eindtijd ≤ starttijd.
- Verlofsoorten: betaald verlof, klein verlet, ziekte. Aanvraag → planner keurt goed
  of af. Verlofsaldo per jaar per chauffeur.
- Dienstruil: chauffeur vraagt ruil of overname aan → collega akkoord → planner keurt
  goed.
- Omleidingen hebben een geldigheidsperiode en een kaartlocatie; alleen actieve
  omleidingen zijn relevant tijdens de dienst.
- Taal: Nederlands (nl-BE), datums en tijden in Belgisch formaat, 24-uursklok.

## Capabilities and Constraints

- Vite + React 19 + TypeScript + Tailwind v4, serverless API op Vercel, Supabase als
  database (quoted camelCase-identifiers), rollen chauffeur/planner/admin.
- Bestaande views: dashboard, rooster, verlof, verlofkalender, dienstruil,
  omleidingen, ritbladen, documenten, updates, contacten, dienstoverzicht, plus een
  beheerzijde (bezetting, dekking, planning-matrix, gebruikers, toestellen, OCPI).
- PWA-eisen: safe-area, standalone-navigatie, touch-targets, geen animatie-jank op
  oudere toestellen, offline cache.
- Lokaal is er **geen `.env`** — de app kan hier niet met echte data draaien.
  Voorbeeldwerk gebruikt daarom verzonnen maar realistische demonstratiedata, en die
  moet als zodanig herkenbaar zijn.

## Brand Commitments

- Naam **VHB**; definitief logo in `brand/vhb-final-logo-package/` (actief sinds
  2026-08-30) — in de app via `src/components/BrandLogo.tsx`, iconen in `public/`.
- Toon: nuchter, Vlaams, zonder corporate-jargon; de app spreekt de chauffeur aan zoals
  een collega dat doet.
- **Voor dit redesign-voorbeeld heeft de eigenaar kleur én typografie expliciet
  vrijgegeven** ("alles mag op tafel"). De huidige amber/zwart-huisstijl en
  Manrope/Inter zijn daarmee bewijsmateriaal, geen wet — het productie-portaal houdt
  ze tot de eigenaar anders beslist.

## Evidence on Hand

- Werkende productiecode met echte domeinlogica: `src/views/`, `src/lib/`, `src/types.ts`.
- Echte vaktermen en regels (loopnummers, typedagen, verlofbalans, ruilstatussen).
- **Niet aanwezig:** echte chauffeursnamen, roosters, telefoonnummers of
  verlofgegevens. Die mogen niet verzonnen worden alsof ze echt zijn — demonstratiedata
  wordt zichtbaar gelabeld.

## Product Principles

1. **De dienst van vandaag wint van alles.** Wat de chauffeur nú moet weten staat
   bovenaan en is leesbaar op armlengte.
2. **De vaktaal blijft.** Dienstnummer en loopnummer worden niet vertaald naar
   vriendelijkere maar vagere woorden.
3. **Eén hand, buiten, gehaast.** Elke primaire actie is bereikbaar met de duim en
   overleeft slecht licht en een slechte verbinding.
4. **De planner en de chauffeur zien dezelfde waarheid.** Geen twee versies van een
   rooster.
5. **Stil tenzij het ertoe doet.** Alleen echte uitzonderingen (omleiding, wijziging,
   beslissing) vragen aandacht.

## Accessibility & Inclusion

Buitengebruik in fel licht en in het donker: contrast moet ruim boven de minimumnorm
zitten, niet er net op. Touch-targets ≥ 44px voor gebruik met handschoenen.
