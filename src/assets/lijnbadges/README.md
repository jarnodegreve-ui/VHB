# De Lijn-lijnbadges

De zeven originele PNG-bestanden zijn op 16 september 2026 door Jarno aangeleverd
uit `Desktop/lijnnummer`. Ze worden ongewijzigd gebruikt: kleurprofiel, vorm en
cijfers blijven behouden. Ook in het donkere thema en bij verlopen omleidingen
blijven de badges in hun oorspronkelijke kleuren zichtbaar.

In het donkere thema worden ze wel iets gedempt (`--badge-demping` in
`src/index.css`, klasse `lijnbadge`) en krijgen ze een hairline. Drie badges
(801, 858, 884) hebben een wit binnenvlak dat anders het felste element op de
donkere canvas is. De kleuren zelf verschuiven daarbij niet.

`src/components/LijnTegel.tsx` kadert alleen de badge in (315 × 216 pixels per
bronbestand), zodat de grijze screenshotmarge niet wordt getoond. De positie en
afmetingen van elk bronbestand staan daar bij de import. Vite levert de PNG's
met een inhoudshash; de bestaande service worker cachet geladen afbeeldingen.

Voor een extra lijn: voeg het originele bestand toe en registreer de positie
en afmetingen in `LIJNBADGES`. Zonder aangeleverde badge, of als laden mislukt,
blijft het lijnnummer als tekst zichtbaar. Er worden geen lijnkleuren afgeleid
van het nummer.
