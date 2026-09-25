import { describe, expect, it } from 'vitest';
import { eigenMailSchema, omleidingMailSchema, isMailAan, leesAdressen, MAIL_SOORTEN, naamVanSoort, parseMailInstellingen, parseVerzendlijsten, UITZETBARE_MAIL_SOORTEN, verzendlijstenSchema } from './mail';

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
