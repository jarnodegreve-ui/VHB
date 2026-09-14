# VHB — Van Hoorebeke & Zoon

Logopakket "VHB primary" (14 september 2026). Het volledige pakket (alle PNG's op 3000 px, icoon-PNG's 32/64/256/512/1024) staat buiten de repo in `~/VHB/VHB-primary/`; hier staan alle SVG's plus een selectie PNG's.

## Opbouw

- `VHB-primary-*.svg` (902×334): het beeldmerk boven de naamregel. Standaardversie.
- `VHB-horizontaal-*.svg` (1297×256): beeldmerk, gouden scheidingslijn, naamregel op twee regels (VAN HOOREBEKE / & ZOON). Voor brede, lage plekken.
- `VHB-beeldmerk-*.svg` (611×236): alleen het merk (V·H·B met de gouden schuine streep).
- `VHB-icoon.svg` (1024×1024): app-icoon, wit merk op een carbon tegel (hoekstraal 198).

Alle bestanden bevatten de naamregel als lettercontouren; er hoeft geen lettertype meegeleverd te worden.

**Let op: de SVG's van de ontwerper zijn een automatische bitmap-trace** (golvende randen, afgeronde hoeken, bobbelige bogen). De map `schoon/` bevat dezelfde bestanden met schone vectorpaden, gegenereerd door `scripts/brand-paden-schoon.mjs`: het merk als zuivere geometrie met de trace als exacte maatvoering (verschil met de trace: merk 0,4 %, streep 0,6 %), de naamregel in het echte lettertype **Montserrat Medium** (`font/Montserrat-Medium.ttf`, SIL OFL; via overlay op de trace vastgesteld, elke letter valt samen), glyph voor glyph op de letterposities van het pakket. De app gebruikt uitsluitend `schoon/`. Nieuw pakket: bestanden hier vervangen, script opnieuw draaien.

## Kleuren

- Carbon: `#242628`
- Goud: `#CAA044`
- Wit: `#FFFFFF`

## Welke versie gebruiken?

- Lichte achtergrond: `*-kleur.svg`
- Donkere achtergrond: `*-wit-goud.svg` (wit met het goud behouden)
- Eén kleur: `*-zwart.svg` of `*-wit.svg`

## In de app

Uitsluitend via `<BrandLogo tone variant>` (inline SVG): `variant="volledig"` (primary), `"beeldmerk"`, `"horizontaal"`. De laadstand (`laden`) laat een lichtband door de gouden streep trekken. Twee bewuste afwijkingen in de app: het goud is het huisstijl-goud `#E2A323` (keuze Jarno 14-09) in plaats van het pakket-goud `#CAA044`, en het negatief is gedempt wit (`#DCDFE2`) in plaats van `#FFFFFF`. Iconen in `public/` komen uit `node scripts/brand-icons.mjs`.

## Niet doen

- Het logo niet uitrekken, kantelen of vervormen.
- De gouden streep niet verplaatsen, verkleuren of weglaten.
- Geen schaduw, gloed, verloop of omlijning toevoegen.
- De naamregel niet losser of smaller zetten dan in de master.
