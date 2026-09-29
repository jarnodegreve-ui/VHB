import { describe, expect, it } from 'vitest';
import { urgenteMailMelding } from './communicatie';

/**
 * Dringende update mailen (nr. 13): staat de mail uit in Beheer › Mails, dan
 * verstuurt de server niets. Het scherm zei toen toch "E-mails verzonden naar
 * alle chauffeurs".
 */
describe('urgenteMailMelding', () => {
  it('zegt eerlijk dat er niets verstuurd is als de mail uit staat', () => {
    const m = urgenteMailMelding({ overgeslagen: true, message: 'Mail staat uit in Beheer › Mails, er is niets verstuurd.' });
    expect(m).toEqual({ tekst: 'Mail staat uit in Beheer › Mails, er is niets verstuurd.', toon: 'info' });
    expect(m.tekst).not.toMatch(/verzonden/i);
    // Ook zonder tekst van de server (oudere functie achter een nieuwe client).
    expect(urgenteMailMelding({ overgeslagen: true }).tekst).toBe('Mail staat uit in Beheer › Mails, er is niets verstuurd.');
  });

  it('een echte verzending en een omgeving zonder SMTP melden wat ze altijd meldden', () => {
    expect(urgenteMailMelding({})).toEqual({ tekst: 'E-mails verzonden naar alle chauffeurs.', toon: 'success' });
    expect(urgenteMailMelding({ mocked: true, message: 'Email gelogd (geen SMTP geconfigureerd)' })).toEqual({ tekst: 'E-mail gelogd: Email gelogd (geen SMTP geconfigureerd)', toon: 'success' });
  });
});
