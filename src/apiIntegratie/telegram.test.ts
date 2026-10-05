// @vitest-environment node
import {
  api,
  mem,
} from './harnas';
import { describe, it, expect, afterAll, beforeEach } from 'vitest';

describe('telegram-webhook, secret, koppeling en commando\'s', () => {
  const verzonden: Array<{ chatId: string; tekst: string; knoppen?: Array<Array<{ tekst: string; data: string }>> }> = [];
  const webhook = (body: unknown, secretHeader?: string) =>
    api('POST', '/api/telegram/webhook', {
      body,
      headers: secretHeader === undefined ? {} : { 'X-Telegram-Bot-Api-Secret-Token': secretHeader },
    });

  beforeEach(async () => {
    const { zetTelegramVerzenderVoorTests } = await import('../../api/telegram');
    verzonden.length = 0;
    zetTelegramVerzenderVoorTests(async (v: any) => { verzonden.push(v); return true; });
    process.env.TELEGRAM_WEBHOOK_SECRET = 'test-secret';
    process.env.TELEGRAM_CHAT_ID = '777';
    process.env.TELEGRAM_MELDINGEN = 'aan';
    delete process.env.TELEGRAM_BOT_TOKEN; // answerCallbackQuery wordt dan een no-op
  });

  afterAll(async () => {
    const { zetTelegramVerzenderVoorTests } = await import('../../api/telegram');
    zetTelegramVerzenderVoorTests(null);
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    delete process.env.TELEGRAM_CHAT_ID;
    delete process.env.TELEGRAM_MELDINGEN;
  });

  it('weigert zonder (juiste) secret-header, en is dicht zonder geconfigureerd secret', async () => {
    expect((await webhook({ message: {} }, 'fout-secret')).status).toBe(401);
    expect((await webhook({ message: {} })).status).toBe(401);
    delete process.env.TELEGRAM_WEBHOOK_SECRET;
    expect((await webhook({ message: {} }, 'wat-dan-ook')).status).toBe(401);
  });

  it('toont bij /start de chat-id zolang er geen chat gekoppeld is, en negeert andere afzenders stil', async () => {
    delete process.env.TELEGRAM_CHAT_ID;
    const res = await webhook({ message: { chat: { id: 12345 }, text: '/start' } }, 'test-secret');
    expect(res.status).toBe(200);
    expect(verzonden).toHaveLength(1);
    expect(verzonden[0].chatId).toBe('12345');
    expect(verzonden[0].tekst).toContain('12345');
    expect(verzonden[0].tekst).toContain('TELEGRAM_CHAT_ID');

    // Mét gekoppelde chat: een vreemde afzender krijgt niets — ook geen /start.
    process.env.TELEGRAM_CHAT_ID = '777';
    verzonden.length = 0;
    await webhook({ message: { chat: { id: 999 }, text: '/start' } }, 'test-secret');
    await webhook({ message: { chat: { id: 999 }, text: '/gaten' } }, 'test-secret');
    expect(verzonden).toHaveLength(0);
  });

  it('/gaten antwoordt met de openstaande diensten en kandidaten-knoppen', async () => {
    const vandaag = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    mem.planningMatrix = [
      { id: 'm-nu', source_date: vandaag, day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': 'vrij' }, raw_row: '' },
    ];
    mem.coverageExpectations = { week: ['12', '11'] };
    const res = await webhook({ message: { chat: { id: 777 }, text: '/gaten' } }, 'test-secret');
    expect(res.status).toBe(200);
    expect(verzonden).toHaveLength(1);
    expect(verzonden[0].chatId).toBe('777');
    expect(verzonden[0].tekst).toContain('1 openstaande dienst');
    expect(verzonden[0].tekst).toContain('11');
    expect(verzonden[0].knoppen?.flat().map((k) => k.data)).toEqual([`adv|${vandaag}|11`]);
  });

  it('kandidaten-knop stuurt het invaladvies voor dat gat', async () => {
    const vandaag = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    mem.planningMatrix = [
      { id: 'm-nu', source_date: vandaag, day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': 'vrij' }, raw_row: '' },
    ];
    mem.coverageExpectations = { week: ['12', '11'] };
    const res = await webhook({
      callback_query: { id: 'cb1', data: `adv|${vandaag}|11`, message: { chat: { id: 777 } } },
    }, 'test-secret');
    expect(res.status).toBe(200);
    expect(verzonden).toHaveLength(1);
    expect(verzonden[0].tekst).toContain('Dienst 11');
    // Chauffeur B staat op "vrij" en hoort in het advies voor te komen.
    expect(verzonden[0].tekst).toContain('Chauffeur B');
  });

  it('/dienst toont de tijden uit het Dienstoverzicht, of legt een planningscode uit', async () => {
    mem.planningCodes = [{ code: 'bv', category: 'leave', description: 'Betaald verlof', countsAsShift: false, isPaidAbsence: true, isDayOff: false }];
    await webhook({ message: { chat: { id: 777 }, text: '/dienst 12' } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('Dienst 12');
    expect(verzonden[0].tekst).toContain('08:00');
    verzonden.length = 0;
    await webhook({ message: { chat: { id: 777 }, text: '/dienst bv' } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('planningscode');
    verzonden.length = 0;
    await webhook({ message: { chat: { id: 777 }, text: '/dienst 9999' } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('niet in het Dienstoverzicht');
  });

  it('/wie toont wie de dienst rijdt in de komende week (ruil-correcte planning)', async () => {
    const vandaag = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    mem.planning = [
      { id: 'p-1', driverId: '3', date: vandaag, line: '12', startTime: '08:00', endTime: '16:00' },
      { id: 'p-2', driverId: '4', date: '2020-01-01', line: '12', startTime: '08:00', endTime: '16:00' },
    ];
    await webhook({ message: { chat: { id: 777 }, text: '/wie 12' } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('Chauffeur A');
    // De oude rij van Chauffeur B valt buiten het venster.
    expect(verzonden[0].tekst).not.toContain('Chauffeur B');
  });

  it('/rooster vraagt om verduidelijking bij meerdere matches en toont anders de week', async () => {
    const vandaag = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    mem.planning = [
      { id: 'p-1', driverId: '3', date: vandaag, line: '12', startTime: '08:00', endTime: '16:00' },
    ];
    mem.planningMatrix = [
      { id: 'm-morgen', source_date: new Date(Date.parse(`${vandaag}T00:00:00Z`) + 86400000).toISOString().slice(0, 10), day_type: '', assignments: { 'Chauffeur A': 'vrij' }, raw_row: '' },
    ];
    await webhook({ message: { chat: { id: 777 }, text: '/rooster chauffeur' } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('Meerdere chauffeurs');
    verzonden.length = 0;
    await webhook({ message: { chat: { id: 777 }, text: '/rooster chauffeur a' } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('Chauffeur A');
    expect(verzonden[0].tekst).toContain('12 (08:00\u201316:00)');
    expect(verzonden[0].tekst).toContain('vrij');
  });

  it('/ziekmeld toont de interpretatie met bevestigknop, en de knop registreert echt', async () => {
    const vandaag = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    const morgen = new Date(Date.parse(`${vandaag}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    mem.leave = [];
    await webhook({ message: { chat: { id: 777 }, text: '/ziekmeld chauffeur a t/m morgen' } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('Ziek melden');
    expect(verzonden[0].tekst).toContain('Chauffeur A');
    const knop = verzonden[0].knoppen?.flat().find((k) => k.data.startsWith('zm|'));
    expect(knop?.data).toBe(`zm|3|${vandaag}|${morgen}`);

    verzonden.length = 0;
    await webhook({ callback_query: { id: 'cb-zm', data: knop!.data, message: { chat: { id: 777 } } } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('Ziek gemeld');
    const record = mem.leave.find((l: any) => l.type === 'ziekte' && String(l.userId) === '3');
    expect(record).toMatchObject({ status: 'approved', startDate: vandaag, endDate: morgen });
    // Meerdere matches → verduidelijking, geen knop.
    verzonden.length = 0;
    mem.leave = [];
    await webhook({ message: { chat: { id: 777 }, text: '/ziekmeld chauffeur' } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('Meerdere chauffeurs');
  });

  it('verlof-goedkeurknop: bevestiging eerst, daarna echte beslissing via de kern', async () => {
    mem.leave = [
      { id: 'lv-1', userId: '3', startDate: '2030-10-01', endDate: '2030-10-03', type: 'betaald_verlof', status: 'pending', comment: '', createdAt: '2030-09-01T08:00:00Z' },
    ];
    await webhook({ callback_query: { id: 'cb1', data: 'lv|lv-1|approved', message: { chat: { id: 777 } } } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('goedkeuren');
    const bevestig = verzonden[0].knoppen?.flat().find((k) => k.data === 'lv2|lv-1|approved');
    expect(bevestig).toBeTruthy();

    verzonden.length = 0;
    await webhook({ callback_query: { id: 'cb2', data: 'lv2|lv-1|approved', message: { chat: { id: 777 } } } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('Verlof goedgekeurd');
    expect(mem.leave.find((l: any) => l.id === 'lv-1')?.status).toBe('approved');
    // Nogmaals beslissen ketst af op de concurrency-guard (ifStatus pending).
    verzonden.length = 0;
    await webhook({ callback_query: { id: 'cb3', data: 'lv2|lv-1|approved', message: { chat: { id: 777 } } } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('intussen al');
  });

  it('toewijzen-knop: bevestiging eerst, daarna echte toewijzing via de kern', async () => {
    mem.planningMatrix = [
      { id: 'm-wt', source_date: '2030-08-03', day_type: 'W', assignments: { 'Chauffeur A': '12', 'Chauffeur B': 'vrij' }, raw_row: '' },
    ];
    mem.planning = [{ id: 'p-a', driverId: '3', date: '2030-08-03', line: '12', startTime: '08:00', endTime: '16:00' }];
    await webhook({ callback_query: { id: 'cb4', data: 'wt|2030-08-03|11|4', message: { chat: { id: 777 } } } }, 'test-secret');
    const bevestig = verzonden[0].knoppen?.flat().find((k) => k.data === 'wt2|2030-08-03|11|4');
    expect(bevestig).toBeTruthy();

    verzonden.length = 0;
    await webhook({ callback_query: { id: 'cb5', data: 'wt2|2030-08-03|11|4', message: { chat: { id: 777 } } } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('toegewezen aan');
    expect(verzonden[0].tekst).toContain('Chauffeur B');
    expect(mem.planning.some((r: any) => r.line === '11' && String(r.driverId) === '4' && r.date === '2030-08-03')).toBe(true);
    expect(mem.planningMatrix[0].assignments['Chauffeur B']).toBe('11');
  });

  it('ruil-goedkeurknop: dezelfde invariant, de aanvrager op de terugdag (Jarno 29-09)', async () => {
    mem.users = [...mem.users, { id: '5', name: 'Chauffeur C', email: 'c@vhb.be', role: 'chauffeur', isActive: true }];
    mem.planningCodes = [{ code: 'eek5', category: 'service', description: 'Schoolrit', countsAsShift: true }, { code: 'vrij', category: 'absence', description: 'Geen dienst', isDayOff: true }];
    mem.planningMatrix = [
      { id: 'm-t1', source_date: '2030-08-03', day_type: 'W', assignments: { 'Chauffeur B': 'vrij', 'Chauffeur C': '14' }, raw_row: '' },
      { id: 'm-t2', source_date: '2030-08-04', day_type: 'W', assignments: { 'Chauffeur B': '12', 'Chauffeur C': 'EEK5' }, raw_row: '' },
    ];
    mem.planning = [
      { id: 'p-c14', driverId: '5', date: '2030-08-03', line: '14', startTime: '10:00', endTime: '18:00' },
      { id: 'p-b12', driverId: '4', date: '2030-08-04', line: '12', startTime: '08:00', endTime: '16:00' },
    ];
    mem.swaps = [{ id: 's-tg', shiftId: 'p-c14', requesterId: '5', targetDriverId: '4', status: 'accepted', reason: '', createdAt: '2030-07-20T08:00:00Z', swapType: 'ruil', shiftDate: '2030-08-03', shiftLine: '14', returnDate: '2030-08-04', returnCode: '12' }];
    await webhook({ callback_query: { id: 'cb-rl', data: 'rl2|s-tg|approved', message: { chat: { id: 777 } } } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('Chauffeur C rijdt op 04/08/2030 al dienst EEK5');
    expect(mem.swaps[0].status).toBe('accepted');
    expect(mem.planning.map((r: any) => r.driverId)).toEqual(['5', '4']);
    // Het gewone geval: zonder de schoolrit gaat dezelfde knop door.
    mem.planningMatrix[1].assignments = { 'Chauffeur B': '12', 'Chauffeur C': 'vrij' };
    verzonden.length = 0;
    await webhook({ callback_query: { id: 'cb-rl2', data: 'rl2|s-tg|approved', message: { chat: { id: 777 } } } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('Dienstruil goedgekeurd');
    expect(mem.planning.map((r: any) => r.driverId)).toEqual(['4', '5']);
  });

  it('ruil-afwijsknop loopt door dezelfde kern: wat de Excel al aan de collega gaf gaat niet terug (01-10)', async () => {
    const DAG = '2030-08-03';
    mem.planningMatrix = [{ id: 'm-t1', source_date: DAG, day_type: 'W', assignments: { 'Chauffeur A': 'vrij', 'Chauffeur B': '12' }, raw_row: '' }];
    mem.planning = [{ id: `${DAG}-4-12-1`, driverId: '4', date: DAG, line: '12' }];
    mem.swaps = [{ id: 's-tg-af', shiftId: 'p-a12', requesterId: '3', targetDriverId: '4', status: 'accepted', reason: '', createdAt: '2030-07-20T08:00:00Z', swapType: 'overname', shiftDate: DAG, shiftLine: '12' }];
    await webhook({ callback_query: { id: 'cb-af', data: 'rl2|s-tg-af|rejected', message: { chat: { id: 777 } } } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('Dienstruil afgewezen');
    expect(mem.swaps[0].status).toBe('rejected');
    expect(mem.planning[0].driverId).toBe('4');
    // De knoppen kennen alleen goedkeuren en afwijzen: afhandelen is geen
    // Telegram-beslissing, ook niet met een zelfgemaakte knop.
    mem.swaps = [{ ...mem.swaps[0], id: 's-tg-klaar', status: 'accepted' }];
    await webhook({ callback_query: { id: 'cb-klaar', data: 'rl2|s-tg-klaar|completed', message: { chat: { id: 777 } } } }, 'test-secret');
    expect(mem.swaps[0].status).toBe('accepted');
  });

  it('toewijzen-knop: dezelfde invariant, een schoolrit via een wissel (Jarno 29-09)', async () => {
    mem.planningCodes = [{ code: 'eek6', category: 'service', description: 'Schoolrit', countsAsShift: true }, { code: 'vrij', category: 'absence', description: 'Geen dienst', isDayOff: true }];
    mem.planningMatrix = [
      { id: 'm-wt', source_date: '2030-08-03', day_type: 'W', assignments: { 'Chauffeur A': 'EEK6', 'Chauffeur B': 'vrij' }, raw_row: '' },
    ];
    mem.planning = [];
    mem.swaps = [{ id: 's-wt', shiftId: '2030-08-03-3-EEK6-bord', requesterId: '3', targetDriverId: '4', status: 'approved', reason: 'Handmatige wissel door Annelies Admin, test', createdAt: '2030-07-20T08:00:00Z', decidedAt: '2030-07-20T08:00:00Z', swapType: 'overname', shiftDate: '2030-08-03', shiftLine: 'EEK6' }];
    await webhook({ callback_query: { id: 'cb-wt', data: 'wt2|2030-08-03|11|4', message: { chat: { id: 777 } } } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('Chauffeur B rijdt op 03/08/2030 al dienst EEK6');
    expect(mem.planning).toHaveLength(0);
    expect(mem.planningMatrix[0].assignments['Chauffeur B']).toBe('vrij');
  });

  it('vrije tekst krijgt de commandolijst terug (de assistent is verwijderd, 08-09)', async () => {
    await webhook({ message: { chat: { id: 777 }, text: 'wie kan er zaterdag rijden?' } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('Commando');
  });

  it('briefing-cron is dicht zonder cron-secret', async () => {
    const res = await api('GET', '/api/cron/telegram-briefing', {});
    expect(res.status).toBe(401);
  });

  it('parseDagAanduiding: jaargrens-rol, kalender-echtheid en weekdagen', async () => {
    const { parseDagAanduiding } = await import('../../api/telegram');
    // Zonder jaar rolt een verleden datum naar volgend jaar (december-case).
    expect(parseDagAanduiding('03/01', '2026-12-28')).toBe('2027-01-03');
    expect(parseDagAanduiding('29/12', '2026-12-28')).toBe('2026-12-29');
    // Onbestaande datums zijn null, geen "Invalid Date"-weergave verderop.
    expect(parseDagAanduiding('31/02', '2026-08-23')).toBeNull();
    expect(parseDagAanduiding('2026-02-31', '2026-08-23')).toBeNull();
    // Weekdag = eerstvolgende (2026-08-23 is een zondag).
    expect(parseDagAanduiding('vrijdag', '2026-08-23')).toBe('2026-08-28');
    expect(parseDagAanduiding('zondag', '2026-08-23')).toBe('2026-08-23');
    expect(parseDagAanduiding('morgen', '2026-08-23')).toBe('2026-08-24');
  });

  it('/ziekmeld zonder argument stuurt een hulptekst die Telegram-HTML overleeft', async () => {
    await webhook({ message: { chat: { id: 777 }, text: '/ziekmeld' } }, 'test-secret');
    expect(verzonden).toHaveLength(1);
    expect(verzonden[0].tekst).toContain('Gebruik');
    // Geen rauwe tags — die laten Telegram het hele bericht weigeren.
    expect(verzonden[0].tekst).not.toMatch(/<naam>|<dag>/);
  });

  it('zm-knop van gisteren registreert vanaf vandaag, niet met terugwerkende kracht', async () => {
    const vandaag = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    const morgen = new Date(Date.parse(`${vandaag}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    const gisteren = new Date(Date.parse(`${vandaag}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    mem.leave = [];
    await webhook({ callback_query: { id: 'cb-oud', data: `zm|3|${gisteren}|${morgen}`, message: { chat: { id: 777 } } } }, 'test-secret');
    const record = mem.leave.find((l: any) => l.type === 'ziekte' && String(l.userId) === '3');
    expect(record).toMatchObject({ startDate: vandaag, endDate: morgen });
    expect(verzonden[0].tekst).toContain('start bijgesteld naar vandaag');
  });

  it('/gaten escapet dienstcodes zodat één rare code het bericht niet sloopt', async () => {
    const vandaag = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    mem.planningMatrix = [
      { id: 'm-esc', source_date: vandaag, day_type: 'week', assignments: { 'Chauffeur A': '12' }, raw_row: '' },
    ];
    mem.coverageExpectations = { week: ['12', '11<x>'] };
    await webhook({ message: { chat: { id: 777 }, text: '/gaten' } }, 'test-secret');
    expect(verzonden[0].tekst).toContain('11&lt;x&gt;');
    expect(verzonden[0].tekst).not.toContain('11<x>');
  });

  it('/ziek somt de actuele ziekmeldingen op', async () => {
    const vandaag = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
    mem.leave = [
      { id: 'l-z', userId: '3', startDate: vandaag, endDate: vandaag, type: 'ziekte', status: 'approved', comment: '', createdAt: '2026-08-01T06:00:00Z', decidedAt: '2026-08-01T06:00:00Z' },
    ];
    await webhook({ message: { chat: { id: 777 }, text: '/ziek' } }, 'test-secret');
    expect(verzonden).toHaveLength(1);
    expect(verzonden[0].tekst).toContain('Chauffeur A');
  });
});
