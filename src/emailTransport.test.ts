// @vitest-environment node
/**
 * sendEmail met een hergebruikte verbinding (nr. 5): een reeks geeft haar
 * pool mee en sendEmail opent dan geen eigen verbinding meer. Zonder die
 * optie blijft alles zoals het was: één verbinding per mail.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nep = vi.hoisted(() => ({ createTransport: vi.fn(), log: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: nep.createTransport } }));
vi.mock('../api/storage.js', () => ({ logMail: nep.log }));
vi.mock('../api/_lib/mailInstellingen.js', () => ({ mailSoortAan: async () => true }));

import { maakMailTransport, sendEmail } from '../api/email';

const mail = { to: ['a@vhb.be'], subject: 'Test', text: 't', html: '<p>t</p>', soort: 'eigen-mail', zonderLog: true };
const vorige = { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS };

beforeEach(() => {
  process.env.SMTP_USER = 'gebruiker';
  process.env.SMTP_PASS = 'geheim';
  nep.createTransport.mockReset();
  nep.createTransport.mockImplementation(() => ({ sendMail: vi.fn(async () => ({})), close: vi.fn() }));
});
afterEach(() => {
  if (vorige.user === undefined) delete process.env.SMTP_USER; else process.env.SMTP_USER = vorige.user;
  if (vorige.pass === undefined) delete process.env.SMTP_PASS; else process.env.SMTP_PASS = vorige.pass;
});

describe('sendEmail en de verbinding', () => {
  it('met een meegegeven verbinding opent sendEmail er zelf geen', async () => {
    const transport = { sendMail: vi.fn(async () => ({})) };
    const r1 = await sendEmail({ ...mail, transport });
    const r2 = await sendEmail({ ...mail, to: ['b@vhb.be'], transport });
    expect(r1).toEqual({ ok: true, mocked: false });
    expect(r2).toEqual({ ok: true, mocked: false });
    expect(transport.sendMail).toHaveBeenCalledTimes(2);
    expect(nep.createTransport).not.toHaveBeenCalled();
  });

  it('zonder die optie blijft het één verbinding per mail', async () => {
    await sendEmail(mail);
    await sendEmail(mail);
    expect(nep.createTransport).toHaveBeenCalledTimes(2);
  });

  it('een fout van de meegegeven verbinding is een mislukte mail, geen exception', async () => {
    const transport = { sendMail: vi.fn(async () => { throw new Error('450 rate limit'); }) };
    expect(await sendEmail({ ...mail, transport })).toEqual({ ok: false, mocked: false, error: '450 rate limit' });
  });

  it('maakMailTransport bouwt een pool met een begrensd tempo en korte time-outs; zonder SMTP niets', async () => {
    const t = await maakMailTransport({ gelijktijdig: 4, perSeconde: 5 });
    expect(t).not.toBeNull();
    expect(nep.createTransport).toHaveBeenCalledTimes(1);
    expect(nep.createTransport.mock.calls[0]![0]).toMatchObject({ pool: true, maxConnections: 4, rateLimit: 5, rateDelta: 1000, requireTLS: true, socketTimeout: 15_000 });
    delete process.env.SMTP_USER;
    expect(await maakMailTransport({ gelijktijdig: 4, perSeconde: 5 })).toBeNull();
  });
});
