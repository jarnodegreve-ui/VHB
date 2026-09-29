import { describe, expect, it } from 'vitest';
import verzonnen from './__fixtures__/easypay-verzonnen.json';
import { bouwEasypayRijen, easypayCsv, tiktijdenVan, type EasypayCode, type EasypayRij } from './easypay';
import { bouwFixture, serialiseerFixture } from '../../scripts/loonfixture-genereren.mjs';

/**
 * Golden tests van de Easypay-export, op twee bronnen.
 *
 * 1. In de repo: een VERZONNEN maand (__fixtures__/easypay-verzonnen.json,
 *    gemaakt door scripts/loonfixture-genereren.mjs met een vaste seed). De
 *    verwachte rijen volgen uit de regels in dat script, niet uit
 *    bouwEasypayRijen. Dit bewaakt dat de code de regels volgt.
 * 2. Buiten de repo, optioneel: een echte maand uit tblDagAdministratie,
 *    door de Access-query gehaald. Alleen dat bewijst dat de code hetzelfde
 *    doet als Access. De echte data hoort niet in een publieke repo; de test
 *    draait alleen als LOON_ECHTE_FIXTURE naar het bestand wijst:
 *      LOON_ECHTE_FIXTURE=/pad/naar/bestand.json npx vitest run shared/loon/easypay.test.ts
 */

type FixtureInput = { matric: number; datum: string; code: string; overmin: number; overminNacht: number; overminExtra: number; onvPremie: boolean };
type FixtureRij = Omit<EasypayRij, 'vrijveld' | 'version' | 'jd' | 'ja'> & Partial<Pick<EasypayRij, 'vrijveld' | 'version' | 'jd' | 'ja'>>;
type Fixture = { maand: string; lidnr: number; inputs: FixtureInput[]; expected: FixtureRij[] };

// De looncodes uit de seed van de migratie (dezelfde bron: tblDienstNummerGegevens).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const hier = dirname(fileURLToPath(import.meta.url));
const seedSql = (): string => readFileSync(join(hier, '..', '..', 'supabase', '2026-09-13_loon_dagafsluiting.sql'), 'utf8');
const seedCodes = (): EasypayCode[] => {
  const sql = seedSql();
  const start = sql.indexOf("insert into public.loon_codes");
  const blok = sql.slice(sql.indexOf('values', start) + 6, sql.indexOf('on conflict do nothing', start));
  const rij = /\(\s*'((?:[^']|'')*)',\s*'((?:[^']|'')*)',\s*(?:'(?:[^']|'')*'|null),\s*'(\w+)',\s*(true|false),\s*'([^']*)',\s*(\d+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+)/g;
  const out: EasypayCode[] = [];
  for (const m of blok.matchAll(rij)) {
    const t = (v: string) => (v.trim() === 'null' ? null : v.trim().replace(/^'|'$/g, ''));
    out.push({ code: m[1].replace(/''/g, "'"), inExport: m[4] === 'true', easypayActiviteit: m[5], easypayTypePrest: Number(m[6]), tik1: t(m[7]), tik2: t(m[8]), tik3: t(m[9]), tik4: t(m[10]), tik5: t(m[11]), tik6: t(m[12]) });
  }
  return out;
};

/** De invoer van een fixture door de productiecode, met elke medewerker in de export. */
const bouwUit = (fixture: Fixture, codes: EasypayCode[]) => {
  const matricules = [...new Set(fixture.inputs.map((i) => i.matric))];
  return bouwEasypayRijen({
    maand: fixture.maand,
    lidnr: fixture.lidnr,
    codes,
    medewerkers: matricules.map((m) => ({ userId: `u${m}`, easypayNr: m, inExport: true })),
    prestaties: fixture.inputs.map((i) => ({ userId: `u${i.matric}`, datum: i.datum, geredenCode: i.code, overmin: i.overmin, overminNacht: i.overminNacht, overminExtra: i.overminExtra, onvPremie: i.onvPremie })),
  });
};

// Pad naar de echte fixture, buiten de repo. Leeg = de Access-test wordt overgeslagen.
const ECHTE_FIXTURE = (process.env.LOON_ECHTE_FIXTURE ?? '').trim();
if (!ECHTE_FIXTURE) {
  console.info('[easypay] Access-test overgeslagen: zet LOON_ECHTE_FIXTURE op het pad van de echte fixture (buiten de repo) om de gelijkheid met Access te bewijzen.');
}

describe('Easypay-export (golden)', () => {
  const codes = seedCodes();

  it('seed bevat de 229 looncodes', () => {
    expect(codes.length).toBe(229);
    expect(codes.find((c) => c.code === '2102')).toMatchObject({ easypayTypePrest: 40140, tik1: '05:28', tik4: '17:27' });
  });

  it('de verzonnen fixture is byte voor byte wat het generatorscript geeft', () => {
    const bestand = readFileSync(join(hier, '__fixtures__', 'easypay-verzonnen.json'), 'utf8');
    expect(serialiseerFixture(bouwFixture(seedSql()))).toBe(bestand);
  });

  it('volgt op de verzonnen maand exact de regels, alle 22 kolommen', () => {
    const fixture = verzonnen as unknown as Fixture & { expected: EasypayRij[]; dekking: Record<string, number> };
    const { rijen, issues } = bouwUit(fixture, codes);
    expect(issues).toEqual([]);
    expect(rijen.length).toBe(fixture.expected.length);
    // Elk soort geval zit erin (de telling komt uit het generatorscript).
    expect(Object.entries(fixture.dekking).filter(([, aantal]) => aantal === 0)).toEqual([]);
    const norm = (r: EasypayRij) => ({ ...r, duree: Number(r.duree.toFixed(9)) });
    const sorteer = (a: EasypayRij, b: EasypayRij) => a.matric - b.matric || a.date.localeCompare(b.date) || a.typpre - b.typpre;
    expect(rijen.map(norm).sort(sorteer)).toEqual(fixture.expected.map(norm).sort(sorteer));
  });

  it.skipIf(!ECHTE_FIXTURE)('reproduceert exact de rijen van de Access-query (optioneel, vraagt LOON_ECHTE_FIXTURE)', () => {
    // Een pad dat niet bestaat of geen fixture is, laat de test falen: wie de
    // variabele zet, wil het bewijs en geen stille overslag.
    const fixture = JSON.parse(readFileSync(ECHTE_FIXTURE, 'utf8')) as Fixture;
    const verwacht = fixture.expected;
    const { rijen, issues } = bouwUit(fixture, codes);
    expect(issues).toEqual([]);
    expect(rijen.length).toBe(verwacht.length);
    const norm = (r: FixtureRij) => ({
      matric: r.matric, date: r.date, activit: r.activit, hd: r.hd, ha: r.ha, duree: Number(r.duree.toFixed(9)), typpre: r.typpre,
      typeInfo: r.typeInfo, prime: r.prime, service: r.service, periode: r.periode, alphal2: r.alphal2 ?? fixture.lidnr,
    });
    const sorteer = (a: ReturnType<typeof norm>, b: ReturnType<typeof norm>) => a.matric - b.matric || a.date.localeCompare(b.date) || a.typpre - b.typpre;
    expect(rijen.map(norm).sort(sorteer)).toEqual(verwacht.map(norm).sort(sorteer));
  });

  it('meldt ontbrekende matricules en onbekende codes in plaats van stil weg te laten', () => {
    const { rijen, issues } = bouwEasypayRijen({
      maand: '2026-08',
      lidnr: 1234,
      codes,
      medewerkers: [{ userId: 'a', easypayNr: null, inExport: true }, { userId: 'b', easypayNr: 7, inExport: true }, { userId: 'c', easypayNr: 8, inExport: false }],
      prestaties: [
        { userId: 'a', datum: '2026-08-01', geredenCode: '2102', overmin: 0, overminNacht: 0, overminExtra: 0, onvPremie: false },
        { userId: 'b', datum: '2026-08-01', geredenCode: 'xyz', overmin: 0, overminNacht: 0, overminExtra: 0, onvPremie: false },
        { userId: 'b', datum: '2026-08-02', geredenCode: null, overmin: 0, overminNacht: 0, overminExtra: 0, onvPremie: false },
        { userId: 'b', datum: '2026-08-03', geredenCode: 'BV', overmin: -30, overminNacht: 0, overminExtra: 0, onvPremie: true },
        { userId: 'c', datum: '2026-08-03', geredenCode: '2102', overmin: 0, overminNacht: 0, overminExtra: 0, onvPremie: false },
      ],
    });
    expect(issues).toEqual([
      { soort: 'geen_matricule', userId: 'a' },
      { soort: 'onbekende_code', userId: 'b', datum: '2026-08-01', code: 'xyz' },
      { soort: 'geen_code', userId: 'b', datum: '2026-08-02' },
    ]);
    expect(rijen.map((r) => [r.matric, r.date, r.typpre, r.typeInfo, r.prime, r.duree])).toEqual([
      [7, '2026-08-03', 15200, 'TH', '12', 0],
      [7, '2026-08-03', 40946, 'PRT', '12', -30 / 1440],
    ]);
  });

  it('tiktijden: HD = eerste van 1/3/5, HA = laatste van 6/4/2', () => {
    expect(tiktijdenVan({ tik1: null, tik2: '18:10', tik3: '16:07', tik4: null, tik5: null, tik6: null })).toEqual({ hd: '16:07', ha: '18:10' });
    expect(tiktijdenVan({ tik1: '05:28', tik2: '12:13', tik3: '15:28', tik4: '17:27', tik5: null, tik6: null })).toEqual({ hd: '05:28', ha: '17:27' });
  });

  it('CSV: kop, puntkomma, dd/mm/jjjj, komma-decimaal', () => {
    const csv = easypayCsv([{
      soc: 1, matric: 42, date: '2026-08-03', composant: 1, activit: 'LIJN', hd: '05:28', ha: '17:27', duree: 30 / 1440, typpre: 40945, nbpl: 0,
      alpha1: 0, dec1: 0, alphal2: 1234, deci2: 0, typeInfo: 'PRT', prime: '', vrijveld: '', service: '2102', version: '', periode: '202608', jd: 0, ja: 0,
    }]);
    expect(csv.split('\r\n')[0]).toBe('soc;matric;Datum;composant;Activit;HD;HA;duree;Typpre;NBPL;alpha1;dec1;alphal2;deci2;Type Info;Prime;VrijVeld;service;Version;periode;JD;ja');
    expect(csv.split('\r\n')[1]).toBe('1;42;03/08/2026;1;LIJN;05:28;17:27;0,020833;40945;0;0;0;1234;0;PRT;;;2102;;202608;0;0');
  });
});
