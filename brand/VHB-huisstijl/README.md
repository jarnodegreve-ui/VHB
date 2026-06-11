# VHB Huisstijl — Van Hoorebeke & Zoon

Productieklaar logopakket, gevectoriseerd vanaf de aangeleverde ontwerpen.
Monogram is parametrisch herbouwd (wiskundig rechte lijnen, zuivere cirkelbogen) op basis van een 1-op-1 trace; H-linkerstam bovenaan verdikt op verzoek; tekst is gezet in echt Manrope ExtraBold en
omgezet naar outlines (rendert dus overal identiek, geen fonts nodig).

## Kleuren

| Naam       | HEX     | RGB         | Gebruik                      |
|------------|---------|-------------|------------------------------|
| VHB Amber  | #E8A33D | 232 163 61  | V, accenten, lijnen          |
| VHB Black  | #0D0D0F | 13 13 15    | Achtergrond, tekst op licht  |
| Graphite   | #2C3137 | 44 49 55    | Secundaire tekst             |
| Light Grey | #F2F3F4 | 242 243 244 | Vlakken, kaders              |
| White      | #FFFFFF | 255 255 255 | Tekst op donker              |

Let op: je brandsheet bevatte een tegenstrijdigheid (hex vs. RGB vs. CMYK
bij amber). RGB 232 163 61 klopt wiskundig exact met CMYK 0/35/74/9 en met
de logorender, dus #E8A33D is aangehouden. Andere voorkeur? Eén woord en
ik regenereer alles.

## Typografie

- Primair: **Manrope ExtraBold** (koppen, wordmark)
- Secundair: **Inter Regular** (bodytekst)
- TTF-bestanden zitten in `fonts/`. Installeren op Mac: dubbelklik > Installeer.
  Nodig om het factuurmodel (.docx) correct te tonen en te bewerken.
- Licentie: beide SIL Open Font License — vrij voor commercieel gebruik.

## Welk bestand waarvoor

**logo/svg/** — oneindig schaalbaar, voor alles wat gedrukt of groot wordt
- `vhb-logo-donkere-kaart.svg` — zoals je render: zwarte kaart, compleet
- `vhb-logo-transparant-wittekst.svg` — op donkere ondergronden (bussen, web dark mode)
- `vhb-logo-transparant-zwartetekst.svg` — op lichte ondergronden (papier, web)
- `vhb-logo-strak-*.svg` — zelfde, maar strak bijgesneden (geen lege rand)

**logo/png/** — @3x rasterversies (2316 px breed) voor mail, socials, Office

**icoon/**
- `favicon.ico` — in de root van je website zetten
- `apple-touch-icon-180.png` — iOS-bladwijzer/app
- `vhb-icoon-192.png` + `vhb-icoon-512.png` — Android/PWA manifest
- `vhb-icoon-vierkant.svg` + `-1024-vierkant.png` — app-stores (die ronden zelf af)
- `vhb-icoon.svg` — afgeronde tegel, algemeen gebruik

**factuur/**
- `VHB-factuurmodel.docx` — bewerkbaar model (Word), fonts uit `fonts/` installeren
- `VHB-factuurmodel.pdf` — voorbeeldweergave

## Factuur: in te vullen placeholders

- [Straat + nummer], [Postcode Gemeente]
- BTW [BE 0xxx.xxx.xxx]
- IBAN [BExx xxxx xxxx xxxx] + BIC
- RPR [rechtbank + afdeling]
- [tel] en [e-mail]

Bezorg deze gegevens en je krijgt het model definitief ingevuld terug.

## Webgebruik (favicon-snippet)

```html
<link rel="icon" href="/favicon.ico" sizes="48x48">
<link rel="icon" href="/vhb-icoon-512.png" type="image/png" sizes="512x512">
<link rel="apple-touch-icon" href="/apple-touch-icon-180.png">
```
