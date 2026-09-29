// @vitest-environment node
/**
 * Een reeks mails versturen (nr. 5 en 34): logregel vooraf, één hergebruikte
 * verbinding, een paar tegelijk, en een tijdsbudget. Vroeger ging het één
 * voor één met een nieuwe verbinding per mail en stond de logregel na de lus.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const nep = vi.hoisted(() => ({
  verloop: [] as string[],
  transport: { sendMail: vi.fn(), close: vi.fn() },
  smtp: true,
  logId: 'log-1' as string | null,
  stuur: vi.fn(),
}));

vi.mock('../api/email.js', () => ({
  maakMailTransport: vi.fn(async () => (nep.smtp ? nep.transport : null)),
  sendEmail: (opts: unknown) => nep.stuur(opts),
}));
vi.mock('../api/storage.js', () => ({
  startMailLog: vi.fn(async (r: { soort: string; aantal: number }) => { nep.verloop.push(`start:${r.soort}:${r.aantal}`); return nep.logId; }),
  rondMailLogAf: vi.fn(async (id: string, u: { gelukt: boolean; fout: string | null }) => { nep.verloop.push(`klaar:${id}:${u.gelukt}:${u.fout}`); return true; }),
  logMail: vi.fn(async (r: { gelukt: boolean; fout: string | null; aantal: number }) => { nep.verloop.push(`achteraf:${r.aantal}:${r.gelukt}:${r.fout}`); }),
}));

import { REEKS, verdeelReeks, verstuurMailReeks } from '../api/_lib/mailReeks';

const adressen = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}@vhb.be`);
const START = Date.parse('2026-09-29T10:00:00Z');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START);
  nep.verloop = [];
  nep.smtp = true;
  nep.logId = 'log-1';
  nep.transport.close.mockClear();
  nep.stuur.mockReset();
});
afterEach(() => { vi.useRealTimers(); });

describe('verdeelReeks', () => {
  it('stuurt hoogstens `gelijktijdig` mails tegelijk en elk adres precies één keer', async () => {
    let onderweg = 0;
    let piek = 0;
    const gezien: string[] = [];
    const stuur = async (adres: string) => {
      gezien.push(adres);
      onderweg += 1;
      piek = Math.max(piek, onderweg);
      await new Promise((r) => setTimeout(r, 100));
      onderweg -= 1;
      return { ok: true };
    };
    const klaar = verdeelReeks(adressen(10), stuur, { gelijktijdig: 4, stopNa: START + 35_000, uiterste: START + 52_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    const r = await klaar;
    expect(piek).toBe(4);
    expect(gezien.sort()).toEqual(adressen(10).sort());
    expect([...r.standen.values()].every((s) => s === 'gelukt')).toBe(true);
    // 10 mails van 100 ms met 4 tegelijk: 3 rondes, geen 10.
    expect(Date.now() - START).toBeLessThanOrEqual(1_000);
  });

  it('wat na het tijdsbudget nog niet begonnen is, wordt niet geprobeerd', async () => {
    const gezien: string[] = [];
    const stuur = async (adres: string) => {
      gezien.push(adres);
      await new Promise((r) => setTimeout(r, 10_000));
      return { ok: true };
    };
    const klaar = verdeelReeks(adressen(10), stuur, { gelijktijdig: 2, stopNa: START + 35_000, uiterste: START + 52_000 });
    await vi.advanceTimersByTimeAsync(60_000);
    const r = await klaar;
    // Rondes op 0, 10, 20 en 30 s (elk 2 mails); op 40 s is het budget op.
    expect(gezien).toHaveLength(8);
    expect(adressen(10).map((a) => r.standen.get(a))).toEqual([...Array(8).fill('gelukt'), 'niet-geprobeerd', 'niet-geprobeerd']);
  });

  it('een mail die gooit of mislukt telt als mislukt, de rest gaat door', async () => {
    const stuur = async (adres: string) => {
      if (adres === 'p2@vhb.be') throw new Error('ECONNRESET');
      return { ok: adres !== 'p3@vhb.be' };
    };
    const r = await verdeelReeks(adressen(4), stuur, { gelijktijdig: 2, stopNa: START + 35_000, uiterste: START + 52_000 });
    expect(adressen(4).map((a) => r.standen.get(a))).toEqual(['gelukt', 'mislukt', 'mislukt', 'gelukt']);
  });

  it('wat op de uiterste grens nog onderweg is, is onzeker; het antwoord wacht er niet op', async () => {
    const stuur = (adres: string) => (adres === 'p1@vhb.be' ? new Promise<{ ok: boolean }>(() => {}) : Promise.resolve({ ok: true }));
    const klaar = verdeelReeks(adressen(3), stuur, { gelijktijdig: 1, stopNa: START + 35_000, uiterste: START + 52_000 });
    await vi.advanceTimersByTimeAsync(52_000);
    const r = await klaar;
    expect(adressen(3).map((a) => r.standen.get(a))).toEqual(['onzeker', 'niet-geprobeerd', 'niet-geprobeerd']);
  });

  it('staat de mailsoort uit, dan stopt de reeks en is niets verstuurd', async () => {
    const stuur = vi.fn(async () => ({ ok: true, overgeslagen: true }));
    const r = await verdeelReeks(adressen(5), stuur, { gelijktijdig: 1, stopNa: START + 35_000, uiterste: START + 52_000 });
    expect(stuur).toHaveBeenCalledTimes(1);
    expect(r.overgeslagen).toBe(true);
    expect([...r.standen.values()].every((s) => s === 'niet-geprobeerd')).toBe(true);
  });
});

describe('verstuurMailReeks', () => {
  const opdracht = (n: number) => ({
    soort: 'eigen-mail', door: 'Annelies Admin', context: 'eigen-mail:1', onderwerp: 'Test', text: 'tekst', html: '<p>tekst</p>', replyTo: 'admin@vhb.be',
    ontvangers: adressen(n).map((adres) => ({ adres, naam: adres })), gestartOp: START,
  });

  it('schrijft de logregel vóór de eerste mail en werkt hem daarna bij', async () => {
    nep.stuur.mockImplementation(async (o: { to: string[] }) => { nep.verloop.push(`mail:${o.to[0]}`); return { ok: true, mocked: false }; });
    const u = await verstuurMailReeks(opdracht(3));
    expect(nep.verloop[0]).toBe('start:eigen-mail:3');
    expect(nep.verloop.at(-1)).toBe('klaar:log-1:true:null');
    expect(nep.verloop.filter((v) => v.startsWith('mail:'))).toHaveLength(3);
    expect(nep.verloop.some((v) => v.startsWith('achteraf:'))).toBe(false);
    expect(u).toMatchObject({ aantal: 3, gelukt: 3, mislukt: 0, nietGeprobeerd: 0, onzeker: 0, resterend: [], onzekerAdressen: [] });
  });

  it('hergebruikt één verbinding voor alle mails, zonder logregel per mail, en sluit ze', async () => {
    nep.stuur.mockResolvedValue({ ok: true, mocked: false });
    await verstuurMailReeks(opdracht(6));
    expect(nep.stuur).toHaveBeenCalledTimes(6);
    for (const [o] of nep.stuur.mock.calls) {
      expect(o.transport).toBe(nep.transport);
      expect(o.zonderLog).toBe(true);
      expect(o.replyTo).toBe('admin@vhb.be');
      expect(o.to).toHaveLength(1);
    }
    expect(nep.transport.close).toHaveBeenCalledTimes(1);
  });

  it('geeft terug welke adressen niet vertrokken zijn; het log krijgt alleen aantallen', async () => {
    nep.stuur.mockImplementation(async (o: { to: string[] }) => ({ ok: o.to[0] !== 'p2@vhb.be', mocked: false }));
    const u = await verstuurMailReeks(opdracht(3));
    expect(u).toMatchObject({ aantal: 3, gelukt: 2, mislukt: 1, resterend: ['p2@vhb.be'] });
    expect(nep.verloop.at(-1)).toBe('klaar:log-1:false:1 van 3 mislukt');
    expect(nep.verloop.join('\n')).not.toContain('@');
  });

  it('het tijdsbudget telt vanaf het binnenkomen van het verzoek', async () => {
    nep.stuur.mockImplementation(async () => { await new Promise((r) => setTimeout(r, 5_000)); return { ok: true, mocked: false }; });
    // Het verzoek kwam 30 s geleden binnen (bv. trage bijlagen): nog 5 s budget.
    const klaar = verstuurMailReeks({ ...opdracht(12), gestartOp: START - 30_000 });
    await vi.advanceTimersByTimeAsync(30_000);
    const u = await klaar;
    expect(u.gelukt).toBe(REEKS.gelijktijdig());
    expect(u.nietGeprobeerd).toBe(12 - REEKS.gelijktijdig());
    expect(u.resterend).toHaveLength(12 - REEKS.gelijktijdig());
    expect(nep.verloop.at(-1)).toBe(`klaar:log-1:false:${12 - REEKS.gelijktijdig()} van 12 niet verstuurd (tijd op)`);
  });

  it('zonder regel vooraf (tabel ontbreekt) komt er achteraf één regel, zoals vroeger', async () => {
    nep.logId = null;
    nep.smtp = false;
    nep.stuur.mockResolvedValue({ ok: true, mocked: true });
    const u = await verstuurMailReeks(opdracht(2));
    expect(u).toMatchObject({ gelukt: 2, mocked: true });
    expect(nep.verloop).toEqual(['start:eigen-mail:2', 'achteraf:2:false:SMTP niet geconfigureerd, mail alleen gelogd']);
  });
});
