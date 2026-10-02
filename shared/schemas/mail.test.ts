import { describe, expect, it, vi } from 'vitest';
import { emailSchema } from './user';
import { EMAIL_MAX_TEKENS, EMAIL_RE, emailAdres, eigenMailSchema, omleidingMailSchema, isMailAan, leesAdressen, MAIL_SOORTEN, naamVanSoort, parseMailInstellingen, parseVerzendlijsten, UITZETBARE_MAIL_SOORTEN, verzendlijstenSchema } from './mail';

describe('mailinstellingen', () => {
  it('kent elke mailsoort één keer en markeert welkom, wachtwoord, back-up en herstel als altijd aan', () => {
    const sleutels = MAIL_SOORTEN.map((m) => m.soort);
    expect(new Set(sleutels).size).toBe(sleutels.length);
    for (const s of ['welkom', 'wachtwoord', 'backup-integriteit', 'backup-weekkopie', 'restore-proef', 'testmail']) {
      expect(UITZETBARE_MAIL_SOORTEN, s).not.toContain(s);
    }
    for (const s of ['verlof-beslissing', 'ziekmelding', 'dringende-update', 'vervaldatum', 'weekoverzicht']) {
      expect(UITZETBARE_MAIL_SOORTEN, s).toContain(s);
    }
  });

  it('parse laat onbekende en altijd-aan soorten uit de uit-lijst vallen; rommel wordt "alles aan"', () => {
    expect(parseMailInstellingen({ uit: ['ziekmelding', 'welkom', 'bestaat-niet', 'ziekmelding'] })).toEqual({ uit: ['ziekmelding'] });
    expect(parseMailInstellingen(null)).toEqual({ uit: [] });
    expect(parseMailInstellingen({ uit: 'ziekmelding' })).toEqual({ uit: [] });
  });

  it('isMailAan: uitgezet = uit; altijd-aan en onbekende soorten blijven aan', () => {
    const inst = { uit: ['ziekmelding'] };
    expect(isMailAan(inst, 'ziekmelding')).toBe(false);
    expect(isMailAan(inst, 'verlof-beslissing')).toBe(true);
    expect(isMailAan({ uit: ['welkom'] }, 'welkom')).toBe(true);
    expect(isMailAan({ uit: ['nieuwe-mail'] }, 'nieuwe-mail')).toBe(true);
  });
});

describe('verzendlijsten', () => {
  it('valideert naam en adressen, normaliseert naar kleine letters en ontdubbelt', () => {
    const r = verzendlijstenSchema.safeParse([{ id: 'l1', naam: ' De Lijn ', adressen: ['Dispatching@DeLijn.be', 'planning@delijn.be'] }]);
    expect(r.success).toBe(true);
    expect(r.success && r.data[0].naam).toBe('De Lijn');
    expect(r.success && r.data[0].adressen).toEqual(['dispatching@delijn.be', 'planning@delijn.be']);
    expect(parseVerzendlijsten([{ id: 'l1', naam: 'x', adressen: ['a@b.be', 'A@B.BE'] }])[0].adressen).toEqual(['a@b.be']);
  });

  it('weigert een lege naam, een ongeldig adres en rommel', () => {
    expect(verzendlijstenSchema.safeParse([{ id: 'l1', naam: '', adressen: ['a@b.be'] }]).success).toBe(false);
    expect(verzendlijstenSchema.safeParse([{ id: 'l1', naam: 'x', adressen: ['geen-adres'] }]).success).toBe(false);
    expect(parseVerzendlijsten('rommel')).toEqual([]);
  });

  it('leesAdressen: regels, komma\'s en puntkomma\'s, met de foute regels apart', () => {
    const r = leesAdressen('a@b.be\nB@c.be, c@d.be; geen adres\n\n a@b.be ');
    expect(r.adressen).toEqual(['a@b.be', 'b@c.be', 'c@d.be']);
    expect(r.fouten).toEqual(['geen adres']);
  });
});

// Beveiligingsscan 01-10: de vorige uitdrukking liet de punt aan beide kanten
// van het domein toe en probeerde bij een rij punten elke verdeling
// (kwadratisch: 20.000 punten = 0,4 s, 350.000 = 58 s in de functie).
describe('e-mailadres: lineair en begrensd', () => {
  const bewijs = (punten: number) => `a@${'.'.repeat(punten)}@`;
  const duur = (werk: () => unknown): number => { const start = performance.now(); werk(); return performance.now() - start; };

  it('de uitdrukking zelf blijft snel op de bewijsreeks (100 kB en 4 MB)', () => {
    expect(duur(() => expect(EMAIL_RE.test(bewijs(100_000))).toBe(false))).toBeLessThan(100);
    expect(duur(() => expect(EMAIL_RE.test(bewijs(4_000_000))).toBe(false))).toBeLessThan(500);
    // Ook de andere vormen die een uitdrukking laten terugkrabbelen.
    for (const tekst of ['a'.repeat(100_000), `${'a.'.repeat(50_000)}@`, `a@${'a.'.repeat(50_000)}`, `a@${'a.'.repeat(50_000)}@`, `${'a@'.repeat(50_000)}b.c`]) {
      expect(duur(() => EMAIL_RE.test(tekst)), tekst.slice(0, 12)).toBeLessThan(100);
    }
  });

  it('het adres van een gebruiker (z.email in shared/schemas/user.ts) heeft die vorm niet', () => {
    for (const tekst of [bewijs(100_000), 'a'.repeat(100_000), `${'a.'.repeat(50_000)}@`, `a@${'a-'.repeat(50_000)}`, `a@${'a.'.repeat(50_000)}1`]) {
      expect(duur(() => expect(emailSchema.safeParse(tekst).success).toBe(false)), tekst.slice(0, 12)).toBeLessThan(100);
    }
  });

  it('het schema weigert de bewijsreeks van 100 kB ruim binnen 100 ms, ook in een lijst en via leesAdressen', () => {
    expect(duur(() => expect(emailAdres.safeParse(bewijs(100_000)).success).toBe(false))).toBeLessThan(100);
    expect(duur(() => expect(verzendlijstenSchema.safeParse([{ id: 'l1', naam: 'x', adressen: [bewijs(100_000)] }]).success).toBe(false))).toBeLessThan(100);
    expect(duur(() => expect(eigenMailSchema.safeParse({ onderwerp: 'x', tekst: 'y', ontvangers: { adressen: [bewijs(100_000)] }, alleen: [bewijs(100_000)] }).success).toBe(false))).toBeLessThan(100);
    expect(duur(() => expect(leesAdressen(bewijs(100_000))).toEqual({ adressen: [], fouten: [bewijs(100_000)] }))).toBeLessThan(100);
  });

  it('een te lang adres bereikt de uitdrukking niet: de lengtegrens breekt af (zod 4 loopt anders door)', () => {
    const test = vi.spyOn(EMAIL_RE, 'test');
    try {
      const lang = `${'a'.repeat(EMAIL_MAX_TEKENS)}@b.be`;
      const r = emailAdres.safeParse(lang);
      expect(r.success).toBe(false);
      expect(r.success ? [] : r.error.issues.map((i) => i.message)).toEqual(['Dit is geen geldig e-mailadres']);
      expect(test).not.toHaveBeenCalled();
      expect(leesAdressen(lang)).toEqual({ adressen: [], fouten: [lang] });
      expect(test).not.toHaveBeenCalled();
      // Een gewoon adres loopt wel door de uitdrukking.
      expect(emailAdres.safeParse('a@b.be').success).toBe(true);
      expect(test).toHaveBeenCalledTimes(1);
    } finally {
      test.mockRestore();
    }
  });

  it(`de grens ligt op ${EMAIL_MAX_TEKENS} tekens, geteld na het wegknippen van de spaties`, () => {
    const precies = `${'a'.repeat(EMAIL_MAX_TEKENS - 5)}@b.be`;
    expect(precies).toHaveLength(EMAIL_MAX_TEKENS);
    expect(emailAdres.safeParse(`  ${precies}  `).success).toBe(true);
    expect(emailAdres.safeParse(`a${precies}`).success).toBe(false);
    expect(leesAdressen(`${precies}\na${precies}`)).toEqual({ adressen: [precies], fouten: [`a${precies}`] });
  });

  it('gewone adressen blijven geldig; een lege domeinnaam, een spatie of een tweede @ niet', () => {
    for (const goed of ['a@b.c', 'jan.peeters@vhb.be', 'Dispatching@DeLijn.be', "o'neil+test@sub.domein.co.uk", 'a_b-c@x-y.be', '.a.@b.be']) {
      expect(emailAdres.safeParse(goed).success, goed).toBe(true);
      expect(leesAdressen(goed).adressen, goed).toEqual([goed.toLowerCase()]);
    }
    for (const fout of ['a@b..c', 'a@.b.c', 'a@b.c.', 'a@b', '@b.be', 'a@', 'a b@c.be', 'a@b@c.be', 'geen-adres', '']) {
      expect(emailAdres.safeParse(fout).success, fout).toBe(false);
      expect(leesAdressen(fout).adressen, fout).toEqual([]);
    }
  });
});

describe('eigen mail', () => {
  it('vult de ontvangersdelen aan met lege lijsten en normaliseert adressen', () => {
    const r = eigenMailSchema.safeParse({ onderwerp: ' Test ', tekst: 'Hallo', ontvangers: { adressen: ['A@B.be'] } });
    expect(r.success).toBe(true);
    expect(r.success && r.data).toEqual({ onderwerp: 'Test', tekst: 'Hallo', droog: false, ontvangers: { groepen: [], lijsten: [], gebruikers: [], adressen: ['a@b.be'] } });
  });
  it('weigert een onbekende groep, een leeg bericht en een ongeldig adres', () => {
    expect(eigenMailSchema.safeParse({ onderwerp: 'x', tekst: 'y', ontvangers: { groepen: ['iedereen'] } }).success).toBe(false);
    expect(eigenMailSchema.safeParse({ onderwerp: 'x', tekst: '  ', ontvangers: {} }).success).toBe(false);
    expect(eigenMailSchema.safeParse({ onderwerp: 'x', tekst: 'y', ontvangers: { adressen: ['nope'] } }).success).toBe(false);
  });
  it('naamVanSoort kent ook de eigen mail', () => {
    expect(naamVanSoort('eigen-mail')).toBe('Eigen mail');
    expect(naamVanSoort('ziekmelding')).toBe('Ziekmelding');
    expect(naamVanSoort('onbekend')).toBe('onbekend');
  });
});

describe('omleiding mailen', () => {
  it('vult lege delen aan, normaliseert adressen en kent geen groepen', () => {
    const r = omleidingMailSchema.safeParse({ ontvangers: { adressen: ['A@B.be'] } });
    expect(r.success && r.data).toEqual({ droog: false, bericht: '', ontvangers: { lijsten: [], adressen: ['a@b.be'] } });
    expect(omleidingMailSchema.safeParse({ ontvangers: { groepen: ['chauffeurs'] } }).success).toBe(true); // onbekende sleutel wordt gestript
    expect(omleidingMailSchema.safeParse({ ontvangers: { adressen: ['nope'] } }).success).toBe(false);
    expect(naamVanSoort('omleiding-mail')).toBe('Omleiding gemaild');
  });
});

describe('alleen het restant versturen (nr. 5)', () => {
  it('`alleen` is optioneel, normaliseert adressen en weigert rommel, voor beide mails', () => {
    const eigen = eigenMailSchema.safeParse({ onderwerp: 'x', tekst: 'y', ontvangers: { groepen: ['chauffeurs'] }, alleen: ['Jan@VHB.be'] });
    expect(eigen.success && eigen.data.alleen).toEqual(['jan@vhb.be']);
    const omleiding = omleidingMailSchema.safeParse({ ontvangers: { lijsten: ['l-1'] }, alleen: ['Planning@DeLijn.be'] });
    expect(omleiding.success && omleiding.data.alleen).toEqual(['planning@delijn.be']);
    expect(eigenMailSchema.safeParse({ onderwerp: 'x', tekst: 'y', ontvangers: {}, alleen: ['geen adres'] }).success).toBe(false);
    expect(omleidingMailSchema.safeParse({ ontvangers: {}, alleen: 'jan@vhb.be' }).success).toBe(false);
    // Zonder `alleen` verandert er niets aan de invoer.
    const gewoon = eigenMailSchema.safeParse({ onderwerp: 'x', tekst: 'y', ontvangers: {} });
    expect(gewoon.success && 'alleen' in gewoon.data && gewoon.data.alleen !== undefined).toBe(false);
  });
});
