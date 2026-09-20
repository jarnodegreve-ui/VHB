import { describe, it, expect } from 'vitest';
import { INZOOM_VAN_MIN, MIN_BLOK_PCT, VOLLE_DAG, asMarkeringen, asPositie, asVenster, blokOpAs, labelStapVoor } from './tijdAs';
import { balkenVoorDag, type AanwezigheidSessie } from './aanwezigheid';

const INGEZOOMD = { vanMin: INZOOM_VAN_MIN, totMin: 1440 };

describe('asVenster', () => {
  it('begint om 04:00 op een gewone dag', () => {
    expect(asVenster([{ vanMin: 4 * 60 + 41 }, { vanMin: 13 * 60 }])).toEqual(INGEZOOMD);
    expect(asVenster([{ vanMin: 4 * 60 }])).toEqual(INGEZOOMD);
  });

  it('toont het volle etmaal zodra iemand vóór 04:00 actief was', () => {
    expect(asVenster([{ vanMin: 3 * 60 + 59 }, { vanMin: 9 * 60 }])).toEqual(VOLLE_DAG);
    // Een sessie die over middernacht liep begint op de nieuwe dag om 00:00.
    expect(asVenster([{ vanMin: 0 }])).toEqual(VOLLE_DAG);
  });

  it('blijft ingezoomd op een dag zonder blokken, zodat de as niet verspringt', () => {
    expect(asVenster([])).toEqual(INGEZOOMD);
  });

  it('volgt de échte balken van een dag, los van de tijdzone van de machine', () => {
    // Zone-loze ISO-strings: JS leest ze als lokale tijd, dus dit meet de
    // logica en niet de klok van de runner (TZ=UTC en TZ=Europe/Brussels).
    const sessie = (van: string, tot: string): AanwezigheidSessie => ({ userId: 'u', naam: 'U', rol: 'chauffeur', van, tot });
    const gewoon = balkenVoorDag([sessie('2026-09-18T06:12:00', '2026-09-18T06:40:00')], '2026-09-18');
    expect(asVenster(gewoon.flatMap((b) => b.periodes))).toEqual(INGEZOOMD);
    const nacht = balkenVoorDag([sessie('2026-09-17T23:40:00', '2026-09-18T00:20:00')], '2026-09-18');
    expect(asVenster(nacht.flatMap((b) => b.periodes))).toEqual(VOLLE_DAG);
  });
});

describe('asPositie', () => {
  it('zet een tijdstip om in een percentage van het venster', () => {
    expect(asPositie(0, VOLLE_DAG)).toBe(0);
    expect(asPositie(720, VOLLE_DAG)).toBe(50);
    expect(asPositie(1440, VOLLE_DAG)).toBe(100);
    expect(asPositie(4 * 60, INGEZOOMD)).toBe(0);
    expect(asPositie(14 * 60, INGEZOOMD)).toBe(50);
  });

  it('klemt wat buiten het venster valt', () => {
    expect(asPositie(60, INGEZOOMD)).toBe(0);
    expect(asPositie(2000, INGEZOOMD)).toBe(100);
  });

  it('deelt niet door nul op een leeg venster', () => {
    expect(asPositie(100, { vanMin: 100, totMin: 100 })).toBe(0);
  });
});

describe('blokOpAs', () => {
  it('plaatst een blok op zijn begin- en einduur', () => {
    expect(blokOpAs({ vanMin: 360, totMin: 720 }, VOLLE_DAG)).toEqual({ links: 25, breedte: 25 });
  });

  it('maakt een blok breder wanneer de as inzoomt', () => {
    const vol = blokOpAs({ vanMin: 6 * 60, totMin: 7 * 60 }, VOLLE_DAG).breedte;
    const zoom = blokOpAs({ vanMin: 6 * 60, totMin: 7 * 60 }, INGEZOOMD).breedte;
    expect(zoom).toBeCloseTo(vol * 1.2, 5);
  });

  it('houdt een kort bezoek zichtbaar', () => {
    expect(blokOpAs({ vanMin: 600, totMin: 601 }, VOLLE_DAG).breedte).toBe(MIN_BLOK_PCT);
  });

  it('laat een blok aan de rechterrand niet over de as heen lopen', () => {
    const { links, breedte } = blokOpAs({ vanMin: 1439, totMin: 1440 }, VOLLE_DAG);
    expect(links + breedte).toBeLessThanOrEqual(100);
    expect(breedte).toBe(MIN_BLOK_PCT);
  });

  it('knipt af wat vóór het venster begint', () => {
    expect(blokOpAs({ vanMin: 3 * 60, totMin: 5 * 60 }, INGEZOOMD)).toEqual({ links: 0, breedte: 5 });
  });
});

describe('asMarkeringen', () => {
  it('geeft één markering per uur, randen inbegrepen', () => {
    expect(asMarkeringen(VOLLE_DAG, 2)).toHaveLength(25);
    expect(asMarkeringen(INGEZOOMD, 2)).toHaveLength(21);
  });

  it('labelt om de 2 uur op desktop', () => {
    const labels = asMarkeringen(INGEZOOMD, labelStapVoor('desktop')).filter((m) => m.label).map((m) => m.label);
    expect(labels).toEqual(['04', '06', '08', '10', '12', '14', '16', '18', '20', '22', '24']);
  });

  it('labelt om de 3 uur op een tablet en om de 6 uur op een telefoon, de uurlijnen blijven', () => {
    const tablet = asMarkeringen(VOLLE_DAG, labelStapVoor('tablet'));
    expect(tablet.filter((m) => m.label).map((m) => m.label)).toEqual(['00', '03', '06', '09', '12', '15', '18', '21', '24']);
    const telefoon = asMarkeringen(INGEZOOMD, labelStapVoor('telefoon'));
    expect(telefoon.filter((m) => m.label).map((m) => m.label)).toEqual(['06', '12', '18', '24']);
    expect(telefoon).toHaveLength(21);
  });

  it('zet elke markering op haar uur en lijnt de randen naar binnen uit', () => {
    const m = asMarkeringen(VOLLE_DAG, 6);
    expect(m[0]).toMatchObject({ uur: 0, pct: 0, lijn: 'begin' });
    expect(m[12]).toMatchObject({ uur: 12, pct: 50, lijn: 'midden', label: '12' });
    expect(m[24]).toMatchObject({ uur: 24, pct: 100, lijn: 'eind', label: '24' });
    expect(m[7]).toMatchObject({ uur: 7, label: null });
    // Stijgend en gelijkmatig verdeeld.
    for (let i = 1; i < m.length; i += 1) expect(m[i].pct - m[i - 1].pct).toBeCloseTo(100 / 24, 5);
  });

  it('een label staat exact op de plaats van een blok dat op dat uur begint', () => {
    const zes = asMarkeringen(INGEZOOMD, 2).find((m) => m.uur === 6)!;
    expect(blokOpAs({ vanMin: 6 * 60, totMin: 7 * 60 }, INGEZOOMD).links).toBe(zes.pct);
  });

  it('overleeft een onzinnige labelstap', () => {
    expect(asMarkeringen(VOLLE_DAG, 0).every((m) => m.label !== null)).toBe(true);
  });
});
