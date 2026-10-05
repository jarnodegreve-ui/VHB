// @vitest-environment node
/**
 * De planning-upload paste op 29-09 niet meer door de 4,5 MB van het platform
 * (413 zonder JSON, melding "Maak het bestand kleiner"). Deze suite bewaakt de
 * client-kant: inpakken met gzip (en terugvallen zonder CompressionStream),
 * de controle vooraf op de platformgrens, en een melding die grootte en grens
 * noemt. De keten met de echte routes staat in src/apiIntegratie/
 * (planning-import, grote werkmap).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { gunzipSync } from 'node:zlib';
import { PLATFORM_GRENS_BYTES, VERZOEK_GRENS_BYTES, matrixVerzoek, pakBestandIn, teGrootFout, type IngepaktBestand } from './bestandInpakken';
import { schrijffout } from './fouten';

/** Deterministische inhoud die, zoals een werkmap, maar deels comprimeert. */
const inhoud = (n: number) => {
  const b = Buffer.alloc(n);
  let x = 20260929;
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    b[i] = i % 4 === 0 ? x >>> 24 : 0x41 + (i % 11);
  }
  return b;
};

const vang = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return err as Error & { status?: number };
  }
  throw new Error('verwachtte een fout');
};

const MB = ' MB';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pakBestandIn', () => {
  it('pakt in met gzip: uitgepakt zijn het exact dezelfde bytes, en kleiner dan het bestand', async () => {
    const origineel = inhoud(400_000);
    const ingepakt = await pakBestandIn(new Blob([origineel]));
    expect(ingepakt.gzip).toBe(true);
    expect(ingepakt.bytes).toBe(origineel.length);
    const gz = Buffer.from(ingepakt.base64, 'base64');
    expect(gunzipSync(gz).equals(origineel)).toBe(true);
    expect(gz.length).toBeLessThan(origineel.length);
  });

  it('zonder CompressionStream gaat het bestand zelf, zoals vroeger', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    const origineel = inhoud(100_000);
    const ingepakt = await pakBestandIn(new Blob([origineel]));
    expect(ingepakt.gzip).toBe(false);
    expect(Buffer.from(ingepakt.base64, 'base64').equals(origineel)).toBe(true);
  });
});

describe('matrixVerzoek: de body en de controle vooraf', () => {
  const periode = { van: '2030-09-01', tot: '2030-09-30' };

  it('gzip gaat als xlsxGzipBase64, zonder compressie als xlsxBase64, met de andere velden erbij', () => {
    expect(JSON.parse(matrixVerzoek({ gzip: true, base64: 'QUJD', bytes: 3 }, { periode, filename: 'planning.xls' })))
      .toEqual({ xlsxGzipBase64: 'QUJD', periode, filename: 'planning.xls' });
    expect(JSON.parse(matrixVerzoek({ gzip: false, base64: 'QUJD', bytes: 3 }))).toEqual({ xlsxBase64: 'QUJD' });
  });

  it('de grens ligt onder die van het platform, met marge', () => {
    expect(PLATFORM_GRENS_BYTES).toBe(4_500_000);
    expect(VERZOEK_GRENS_BYTES).toBeLessThan(PLATFORM_GRENS_BYTES);
  });

  it('een body tot de grens gaat door, één byte erover vertrekt niet: 413 met grootte en grens', () => {
    const overhead = JSON.stringify({ xlsxGzipBase64: '' }).length;
    const past: IngepaktBestand = { gzip: true, base64: 'A'.repeat(VERZOEK_GRENS_BYTES - overhead), bytes: 20_000_000 };
    expect(new TextEncoder().encode(matrixVerzoek(past)).length).toBe(VERZOEK_GRENS_BYTES);

    const fout = vang(() => matrixVerzoek({ ...past, base64: `${past.base64}A` }));
    expect(fout.status).toBe(413);
    expect(fout.message).toBe(`Het bestand is ook gecomprimeerd nog 4,5${MB}, de server neemt hoogstens 4,4${MB} aan. Bewaar een kopie met alleen het tabblad “praktijk” en probeer het opnieuw.`);
  });

  it('telt de body in bytes, niet in tekens (een bestandsnaam met é)', () => {
    const overhead = JSON.stringify({ xlsxGzipBase64: '', filename: 'planning é.xls' }).length;
    const bestand: IngepaktBestand = { gzip: true, base64: 'A'.repeat(VERZOEK_GRENS_BYTES - overhead), bytes: 1 };
    // In tekens past het precies, in UTF-8 is de é twee bytes: één te veel.
    expect(vang(() => matrixVerzoek(bestand, { filename: 'planning é.xls' })).status).toBe(413);
  });

  it('zonder compressie: grootte van het bestand, de grens voor het bestand, en de raad om een recente browser of .xlsx te gebruiken', () => {
    const bytes = 3_450_000;
    const fout = vang(() => matrixVerzoek({ gzip: false, base64: 'A'.repeat(Math.ceil(bytes / 3) * 4), bytes }));
    expect(fout.status).toBe(413);
    expect(fout.message).toBe(`Het bestand is 3,5${MB}, zonder compressie neemt de server hoogstens 3,3${MB} aan. Gebruik een recente browser of bewaar het bestand als .xlsx en probeer het opnieuw.`);
  });
});

describe('de melding die de planner ziet', () => {
  // Zo zag hij het op 29-09: een 413 zonder JSON-body, dus zonder reden.
  it('vroeger: alleen de algemene vervolgstap', () => {
    expect(schrijffout('Excel-voorbeeld maken', Object.assign(new Error(''), { status: 413 })))
      .toBe('Excel-voorbeeld maken is mislukt. Maak het bestand kleiner en probeer het opnieuw.');
  });

  it('nu: elke variant komt volledig in de toast (veilige tekst, geen dubbele vervolgstap)', () => {
    const varianten = [
      teGrootFout({ gzip: true, base64: '', bytes: 1 }),
      teGrootFout({ gzip: false, base64: '', bytes: 1 }),
      teGrootFout({ gzip: true, base64: '', bytes: 1 }, 5_000_000),
      teGrootFout({ gzip: false, base64: '', bytes: 3_600_000 }, 4_800_000),
    ];
    for (const fout of varianten) {
      expect(fout.status).toBe(413);
      expect(schrijffout('Excel-voorbeeld maken', fout)).toBe(`Excel-voorbeeld maken is mislukt. ${fout.message}`);
    }
  });

  it('een 413 van het platform zegt dat het ook gecomprimeerd te groot is, met de grens van 4,5 MB', () => {
    expect(teGrootFout({ gzip: true, base64: '', bytes: 1 }).message)
      .toBe(`De server weigerde het bestand: ook gecomprimeerd is het verzoek groter dan de 4,5${MB} die hij aanneemt. Bewaar een kopie met alleen het tabblad “praktijk” en probeer het opnieuw.`);
    expect(teGrootFout({ gzip: false, base64: '', bytes: 1 }).message)
      .toBe(`De server weigerde het bestand: zonder compressie is het verzoek groter dan de 4,5${MB} die hij aanneemt. Gebruik een recente browser of bewaar het bestand als .xlsx en probeer het opnieuw.`);
  });
});
