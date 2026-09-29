import { describe, expect, it } from 'vitest';
import { MAIL_LOG_NIET_AFGEROND, MAIL_LOG_STATUS, mailLogStatus, mailLogToelichting, mailLogVraagtAandacht, mailReeksReden } from './mailLog';

const NU = Date.parse('2026-09-29T10:00:00Z');
const rij = (patch: Partial<{ gelukt: boolean; fout: string | null; verzondenOp: string }>) => ({ gelukt: false, fout: null, verzondenOp: '2026-09-29T09:00:00Z', ...patch });

describe('status van een regel in het verzendlog', () => {
  it('leidt de status af uit gelukt en de reden', () => {
    expect(mailLogStatus(rij({ gelukt: true }), NU)).toBe('verstuurd');
    expect(mailLogStatus(rij({ fout: 'uitgeschakeld in Beheer › Mails' }), NU)).toBe('uitgeschakeld');
    expect(mailLogStatus(rij({ fout: 'SMTP niet geconfigureerd, mail alleen gelogd' }), NU)).toBe('alleen-gelogd');
    expect(mailLogStatus(rij({ fout: '2 van 40 mislukt' }), NU)).toBe('mislukt');
    expect(mailLogStatus(rij({ fout: 'connect ECONNREFUSED' }), NU)).toBe('mislukt');
    expect(mailLogStatus(rij({ fout: null }), NU)).toBe('mislukt');
  });

  it('een niet-afgeronde reeks is kort "bezig" en daarna "onderbroken"', () => {
    const niet = (verzondenOp: string) => mailLogStatus(rij({ fout: MAIL_LOG_NIET_AFGEROND, verzondenOp }), NU);
    expect(niet('2026-09-29T09:59:30Z')).toBe('bezig');
    expect(niet('2026-09-29T09:58:31Z')).toBe('bezig');
    // Een functie leeft hoogstens 60 s: na anderhalve minuut is ze afgebroken.
    expect(niet('2026-09-29T09:58:29Z')).toBe('onderbroken');
    expect(niet('2026-09-28T09:00:00Z')).toBe('onderbroken');
    // Zonder of met een onleesbaar moment nooit "bezig".
    expect(mailLogStatus({ gelukt: false, fout: MAIL_LOG_NIET_AFGEROND }, NU)).toBe('onderbroken');
    expect(mailLogStatus({ gelukt: false, fout: MAIL_LOG_NIET_AFGEROND, verzondenOp: 'rommel' }, NU)).toBe('onderbroken');
  });

  it('een fout is rood, onderbroken heeft een eigen toon, en alleen die twee vragen aandacht (nr. 25)', () => {
    expect(MAIL_LOG_STATUS.mislukt.toon).toBe('gevaar');
    expect(MAIL_LOG_STATUS.onderbroken.toon).toBe('waarschuwing');
    expect(MAIL_LOG_STATUS.uitgeschakeld.toon).not.toBe(MAIL_LOG_STATUS.mislukt.toon);
    expect(MAIL_LOG_STATUS['alleen-gelogd'].toon).not.toBe(MAIL_LOG_STATUS.mislukt.toon);
    const aandacht = (Object.keys(MAIL_LOG_STATUS) as Array<keyof typeof MAIL_LOG_STATUS>).filter(mailLogVraagtAandacht);
    expect(aandacht.sort()).toEqual(['mislukt', 'onderbroken']);
    for (const s of Object.values(MAIL_LOG_STATUS)) expect(s.label).not.toBe('');
  });

  it('de toelichting noemt de reden bij een fout en legt een onderbroken verzending uit, zonder adressen', () => {
    expect(mailLogToelichting('mislukt', '2 van 40 mislukt')).toBe('2 van 40 mislukt');
    expect(mailLogToelichting('onderbroken', MAIL_LOG_NIET_AFGEROND)).toBe('Niet afgerond; onbekend hoeveel er vertrokken zijn.');
    expect(mailLogToelichting('uitgeschakeld', 'uitgeschakeld in Beheer › Mails')).toBe('');
    expect(mailLogToelichting('verstuurd', null)).toBe('');
  });
});

describe('reden van een reeks voor het log', () => {
  const basis = { aantal: 40, mislukt: 0, nietGeprobeerd: 0, onzeker: 0, mocked: false, overgeslagen: false };
  it('alles vertrokken = geen reden', () => {
    expect(mailReeksReden(basis)).toBeNull();
  });
  it('noemt aantallen, nooit adressen', () => {
    expect(mailReeksReden({ ...basis, mislukt: 2 })).toBe('2 van 40 mislukt');
    expect(mailReeksReden({ ...basis, mislukt: 1, nietGeprobeerd: 12, onzeker: 3 })).toBe('1 van 40 mislukt, 12 van 40 niet verstuurd (tijd op), 3 van 40 onzeker (geen antwoord van de mailserver)');
    expect(mailReeksReden({ ...basis, mislukt: 1, nietGeprobeerd: 12 })).not.toContain('@');
  });
  it('zonder SMTP en uitgeschakeld houden hun vaste reden, zodat het log ze blijft herkennen', () => {
    expect(mailLogStatus({ gelukt: false, fout: mailReeksReden({ ...basis, mocked: true }) })).toBe('alleen-gelogd');
    expect(mailLogStatus({ gelukt: false, fout: mailReeksReden({ ...basis, overgeslagen: true }) })).toBe('uitgeschakeld');
    expect(mailLogStatus({ gelukt: false, fout: mailReeksReden({ ...basis, nietGeprobeerd: 5 }) })).toBe('mislukt');
  });
});
