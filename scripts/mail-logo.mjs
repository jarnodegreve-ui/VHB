// Bouwt het logo voor de mails (public/mail/vhb-logo.png) uit de transparante
// bron brand/mail/vhb-logo-transparant.png (nr. 4, 29-09).
//
// Waarom: Gmail en Outlook keren in dark mode de achtergrond van een mail om
// (wit wordt donker), maar laten afbeeldingen ongemoeid. Het logo was een
// transparante PNG met carbon letters (#242628): die verdwenen dan in het
// donkere vlak. Een lichte cel achter het logo helpt niet, want ook die keert
// de client om. De plaat zit daarom IN de afbeelding: een witte tegel met
// afgeronde hoeken, het logo er ongewijzigd bovenop. In een lichte mail valt
// de tegel weg tegen de witte kaart; in een donkere blijft het logo leesbaar.
//
// De pixels van het logo zelf veranderen niet (zelfde carbon, zelfde goud):
// dit script schaalt en herkleurt niets, het legt de bron alleen op wit.
// Zuiver pngjs, geen browser nodig.   Draaien:  node scripts/mail-logo.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BRON = path.join(ROOT, 'brand/mail/vhb-logo-transparant.png');
const UIT = path.join(ROOT, 'public/mail/vhb-logo.png');

// De afbeelding staat op 4× (720 px breed voor 180 px in de mail). Marge rond
// het logo: 40 px links/rechts en 41 px boven/onder, zodat de tegel in de
// mail precies 200 × 56 px is; hoekstraal 32 px = 8 px in de mail, zoals de knop.
export const MAIL_LOGO = { schaal: 4, margeX: 40, margeY: 41, straal: 32, breedte: 200, hoogte: 56 };

const bron = PNG.sync.read(fs.readFileSync(BRON));
const B = bron.width + 2 * MAIL_LOGO.margeX;
const H = bron.height + 2 * MAIL_LOGO.margeY;
if (B !== MAIL_LOGO.breedte * MAIL_LOGO.schaal || H !== MAIL_LOGO.hoogte * MAIL_LOGO.schaal) {
  throw new Error(`Onverwachte maat ${B}×${H}; de lay-out rekent op ${MAIL_LOGO.breedte * MAIL_LOGO.schaal}×${MAIL_LOGO.hoogte * MAIL_LOGO.schaal}.`);
}
const uit = new PNG({ width: B, height: H });

/** Dekking (0..1) van de afgeronde tegel op pixel (x, y), 4 × 4 bemonsterd. */
const dekking = (x, y) => {
  const r = MAIL_LOGO.straal;
  // Alleen in de vier hoekvierkanten kan een pixel (deels) buiten de tegel vallen.
  const inHoekX = x < r || x >= B - r;
  const inHoekY = y < r || y >= H - r;
  if (!inHoekX || !inHoekY) return 1;
  const cx = x < r ? r : B - r;
  const cy = y < r ? r : H - r;
  let binnen = 0;
  for (let i = 0; i < 4; i += 1) {
    for (let j = 0; j < 4; j += 1) {
      const px = x + (i + 0.5) / 4;
      const py = y + (j + 0.5) / 4;
      if ((px - cx) ** 2 + (py - cy) ** 2 <= r * r) binnen += 1;
    }
  }
  return binnen / 16;
};

for (let y = 0; y < H; y += 1) {
  for (let x = 0; x < B; x += 1) {
    const o = (y * B + x) * 4;
    const d = dekking(x, y);
    let r = 255; let g = 255; let b = 255;
    const lx = x - MAIL_LOGO.margeX;
    const ly = y - MAIL_LOGO.margeY;
    if (lx >= 0 && ly >= 0 && lx < bron.width && ly < bron.height) {
      const i = (ly * bron.width + lx) * 4;
      const a = bron.data[i + 3] / 255;
      r = Math.round(bron.data[i] * a + 255 * (1 - a));
      g = Math.round(bron.data[i + 1] * a + 255 * (1 - a));
      b = Math.round(bron.data[i + 2] * a + 255 * (1 - a));
    }
    uit.data[o] = r; uit.data[o + 1] = g; uit.data[o + 2] = b; uit.data[o + 3] = Math.round(d * 255);
  }
}

fs.writeFileSync(UIT, PNG.sync.write(uit, { colorType: 6 }));
console.log(`✓ ${path.relative(ROOT, UIT)}: ${B}×${H} px, witte tegel met hoekstraal ${MAIL_LOGO.straal} px, logo ongewijzigd op (${MAIL_LOGO.margeX}, ${MAIL_LOGO.margeY})`);
