# De Lijn-lijnbadges

De zeven originele PNG-bestanden zijn op 16 september 2026 door Jarno aangeleverd
uit `Desktop/lijnnummer`. Ze blijven hier ongewijzigd als visuele bron.

Sinds 18 september tekent `src/components/LijnTegel.tsx` de badges met echte
tekst en CSS. Zo verdwijnen de zachte screenshotcijfers, afwijkende uitsneden
en fracties van pixels in de breedte. Er hoeven geen afbeeldingen te laden.

Elke badge gebruikt dezelfde centrering, randdikte en afronding. De kleine
maat is 36 × 24 px, de detailmaat 48 × 32 px bij de standaardtekstgrootte.
Langere lijncodes mogen in de breedte groeien zodat alle tekens zichtbaar
blijven. Beide maten schalen mee met de tekstgrootte van het portaal.

Lijn 50 behoudt het oranje vlak; 801, 858, 871, 872, 883 en 884 behouden de
zandkleurige rand op een licht vlak. De tekst is donkerder voor meer contrast
op klein formaat. `--lijn-*` in `src/index.css` bevat de gedeelde kleuren,
inclusief rustige donkere varianten. Verlopen omleidingen houden hun lijnkleur.

Voor een extra streeklijn met dezelfde aangeleverde kleur: voeg het nummer
toe aan `STREEKLIJNEN`. Overige lijnen krijgen dezelfde vorm met een neutrale
of portaalaccentkleur; lijnkleuren worden niet afgeleid van het nummer.
