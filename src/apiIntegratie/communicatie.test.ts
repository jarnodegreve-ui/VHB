// @vitest-environment node
import {
  api,
  KLOK_ISO,
  mem,
  tik,
} from './harnas';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bijlageSleutel, bijlageVersie } from '../lib/bijlageCache';

describe('een uitgeschakelde mail meldt niet dat hij verstuurd is (nr. 13)', () => {
  const UIT = { ok: true, mocked: false, overgeslagen: true };

  it('dringende update: het antwoord zegt dat de mail uit staat, niet "succesvol verzonden"', async () => {
    const { sendEmail } = await import('../../api/email.js');
    vi.mocked(sendEmail).mockResolvedValueOnce(UIT);
    const res = await api('POST', '/api/send-urgent-update-email', { token: 'tok-admin', body: { update: { title: 'Test', content: 'x' } } });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ success: true, overgeslagen: true, message: 'Mail staat uit in Beheer › Mails, er is niets verstuurd.' });
    expect(JSON.stringify(res.json)).not.toMatch(/verzonden/i);
  });

  it('weekoverzicht: de hartslag en het antwoord zeggen "niet verstuurd", niet "verstuurd"', async () => {
    const { sendEmail } = await import('../../api/email.js');
    process.env.ERROR_DIGEST_WEEKDAG = 'elke';
    mem.hartslagen = [];
    mem.clientErrors = [];
    try {
      vi.mocked(sendEmail).mockResolvedValueOnce(UIT);
      const res = await api('GET', '/api/cron/error-digest', { headers: { Authorization: 'Bearer test-cron-secret' } });
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({ success: true, alerted: false, reason: 'mail uit' });
      const hartslag = mem.hartslagen.filter((h) => h.naam === 'error-digest').at(-1)?.details ?? '';
      expect(hartslag).toContain('Dagoverzicht niet verstuurd (mail staat uit in Beheer › Mails)');
      expect(hartslag).not.toMatch(/overzicht verstuurd/i);

      // Een mislukte verzending is evenmin "verstuurd".
      vi.mocked(sendEmail).mockResolvedValueOnce({ ok: false, mocked: false, error: 'ECONNREFUSED' });
      const mislukt = await api('GET', '/api/cron/error-digest', { headers: { Authorization: 'Bearer test-cron-secret' } });
      expect(mislukt.json).toMatchObject({ alerted: false, reason: 'verzending mislukt' });
      expect(mem.hartslagen.at(-1)?.details).toContain('NIET verstuurd (verzending mislukt)');

      // Een echte verzending blijft "verstuurd".
      vi.mocked(sendEmail).mockResolvedValueOnce({ ok: true, mocked: false });
      const gelukt = await api('GET', '/api/cron/error-digest', { headers: { Authorization: 'Bearer test-cron-secret' } });
      expect(gelukt.json).toMatchObject({ alerted: true });
      expect(gelukt.json.reason).toBeUndefined();
      expect(mem.hartslagen.at(-1)?.details).toContain('Dagoverzicht verstuurd: ');
    } finally {
      delete process.env.ERROR_DIGEST_WEEKDAG;
    }
  });
});

describe('urgente-update-mail: ontvangers server-side', () => {
  it('negeert client-opgegeven adressen en stuurt alleen naar interne gebruikers', async () => {
    mem.emailsSent = [];
    const res = await api('POST', '/api/send-urgent-update-email', {
      token: 'tok-planner',
      body: { update: { title: 'Test', content: 'x' }, recipients: [{ id: '999', email: 'attacker@evil.example' }] },
    });
    expect(res.status).toBe(200);
    const sent = mem.emailsSent.find((e) => e.context === 'urgent-update');
    expect(sent).toBeTruthy();
    expect(sent!.to).not.toContain('attacker@evil.example');
    expect((sent!.to as string[]).every((addr) => addr.endsWith('@vhb.be'))).toBe(true);
  });
});

describe('push-notificaties', () => {
  it('geeft de public key aan ingelogde gebruikers', async () => {
    const res = await api('GET', '/api/push/public-key', { token: 'tok-a' });
    expect(res.status).toBe(200);
    expect(res.json.publicKey).toBe('test-public-key');
    const anon = await api('GET', '/api/push/public-key');
    expect(anon.status).toBe(401);
  });

  it('registreert en verwijdert een abonnement', async () => {
    const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'pk', auth: 'au' } };
    const res = await api('POST', '/api/push/subscribe', { token: 'tok-a', body: sub });
    expect(res.status).toBe(200);
    expect(mem.pushSubscriptions).toEqual([{ userId: '3', endpoint: 'https://fcm.googleapis.com/fcm/send/abc', p256dh: 'pk', auth: 'au' }]);

    const ongeldid = await api('POST', '/api/push/subscribe', { token: 'tok-a', body: { endpoint: '' } });
    expect(ongeldid.status).toBe(400);

    const del = await api('POST', '/api/push/unsubscribe', { token: 'tok-a', body: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc' } });
    expect(del.status).toBe(200);
    expect(mem.pushSubscriptions).toHaveLength(0);
  });

  it('stuurt een push naar de chauffeur bij een verlofbeslissing', async () => {
    const payload = mem.leave.map((l) => (l.id === 'l-a1' ? { ...l, status: 'approved', decidedAt: '2026-06-12T09:00:00Z' } : l));
    const res = await api('POST', '/api/leave', { token: 'tok-planner', body: payload });
    expect(res.status).toBe(200);
    const verlofPush = mem.pushesSent.find((p) => p.payload.title === 'Verlof goedgekeurd');
    expect(verlofPush).toBeTruthy();
    expect(verlofPush!.userIds).toEqual(['3']);
  });

  it('stuurt een push naar de aangezochte collega bij een nieuwe ruil', async () => {
    const own = mem.swaps.filter((s) => s.requesterId === '3' || s.targetDriverId === '3');
    const nieuw = {
      id: 's-nieuw', shiftId: 'sh-c', requesterId: '3', targetDriverId: '4', status: 'pending',
      reason: '', createdAt: '2026-06-12T08:00:00Z', returnDate: '2026-07-09', returnCode: 'VRIJ',
    };
    const res = await api('POST', '/api/swaps', { token: 'tok-a', body: [...own, nieuw] });
    expect(res.status).toBe(200);
    const ruilPush = mem.pushesSent.find((p) => p.payload.title === 'Nieuwe dienstruil-aanvraag');
    expect(ruilPush).toBeTruthy();
    expect(ruilPush!.userIds).toEqual(['4']);
  });

  it('pusht de beslissers (planner/admin) wanneer een collega de ruil accepteert', async () => {
    const res = await api('PATCH', '/api/swaps/s-1', { token: 'tok-b', body: { status: 'accepted', ifStatus: 'pending' } });
    expect(res.status).toBe(200);
    const validatiePush = mem.pushesSent.find((p) => p.payload.title === 'Dienstruil wacht op validatie');
    expect(validatiePush).toBeTruthy();
    expect(validatiePush!.userIds.sort()).toEqual(['1', '2']);
  });
});

// Beveiligingsscan 01-10, keuze 10: een abonnement mag alleen naar een echte
// pushdienst wijzen (api/_lib/pushBestemming.ts; de volledige tabel staat in
// src/pushBestemming.test.ts). Vroeger passeerde elke publieke https-host.
describe('push-abonnement: alleen naar een echte pushdienst (scan 01-10, keuze 10)', () => {
  const abonneer = (endpoint: string) => api('POST', '/api/push/subscribe', { token: 'tok-a', body: { endpoint, keys: { p256dh: 'pk', auth: 'au' } } });

  it.each([
    'https://push.aanvaller.tld/geheim-pad',
    'https://fcm.googleapis.com.aanvaller.tld/fcm/send/geheim-pad',
    'https://evil-fcm.googleapis.com/fcm/send/geheim-pad',
    'https://intern.vhb.example/geheim-pad',
    'https://fcm.googleapis.com:8443/fcm/send/geheim-pad',
    'https://gebruiker:wachtwoord@fcm.googleapis.com/fcm/send/geheim-pad',
    'https://203.0.113.10/geheim-pad',
  ])('weigert %s met 400 en bewaart niets', async (endpoint) => {
    const stil = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const res = await abonneer(endpoint);
      expect(res.status).toBe(400);
      expect(res.json.error).toBe('Meldingen konden voor deze browser niet worden ingeschakeld. De pushdienst van deze browser wordt niet ondersteund.');
      expect(mem.pushSubscriptions).toHaveLength(0);
      // Het logboek krijgt de hostnaam, nooit het pad (het endpoint is een geheime URL).
      const regels = stil.mock.calls.map((c) => c.join(' ')).filter((r) => r.includes('Push-abonnement geweigerd'));
      expect(regels).toHaveLength(1);
      expect(regels[0]).toContain(new URL(endpoint).hostname);
      expect(regels[0]).not.toContain('geheim-pad');
      expect(regels[0]).not.toContain('wachtwoord');
    } finally {
      stil.mockRestore();
    }
  });

  it.each([
    'https://fcm.googleapis.com/fcm/send/abc:DEF_-123',
    'https://jmt17.google.com/fcm/send/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAAABabc',
    'https://web.push.apple.com/QGuQyavXutnMH',
    'https://wns2-par02p.notify.windows.com/w/?token=BQYAAAD%2bxyz%3d',
  ])('laat %s door', async (endpoint) => {
    const res = await abonneer(endpoint);
    expect(res.status).toBe(200);
    expect(mem.pushSubscriptions).toEqual([{ userId: '3', endpoint, p256dh: 'pk', auth: 'au' }]);
  });
});

describe('document-leesbevestiging', () => {
  it('zet openedAt bij de eerste keer openen van een eigen document', async () => {
    mem.documents = [{ id: 'd1', userId: '3', filename: 'loonbrief.pdf', storagePath: '3/l', uploadedAt: '2026-07-01T00:00:00Z', openedAt: null }];
    const res = await api('POST', '/api/documents/d1/opened', { token: 'tok-a' });
    expect(res.status).toBe(204);
    expect(mem.documents[0].openedAt).toBe('2026-07-30T12:00:00Z');
  });

  it('laat andermans document onaangeroerd (user_id-match in de update)', async () => {
    mem.documents = [{ id: 'd1', userId: '3', filename: 'loonbrief.pdf', storagePath: '3/l', uploadedAt: '2026-07-01T00:00:00Z', openedAt: null }];
    const res = await api('POST', '/api/documents/d1/opened', { token: 'tok-b' });
    expect(res.status).toBe(204);
    expect(mem.documents[0].openedAt).toBeNull();
  });

  it('geeft openedAt terug in de documentenlijst', async () => {
    mem.documents = [{ id: 'd1', userId: '3', filename: 'loonbrief.pdf', storagePath: '3/l', uploadedAt: '2026-07-01T00:00:00Z', openedAt: '2026-07-30T12:00:00Z' }];
    const res = await api('GET', '/api/documents', { token: 'tok-a' });
    expect(res.status).toBe(200);
    expect(res.json[0].openedAt).toBe('2026-07-30T12:00:00Z');
  });
});

describe('wees-documenten opruimen', () => {
  it('verwijdert de documenten van een gebruiker die uit gebruikersbeheer wordt geschrapt', async () => {
    mem.documents = [
      { id: 'd1', userId: '3', filename: 'a.pdf', storagePath: '3/a', uploadedAt: '2026-07-01T00:00:00Z' },
      { id: 'd2', userId: '4', filename: 'b.pdf', storagePath: '4/b', uploadedAt: '2026-07-01T00:00:00Z' },
    ];
    // Chauffeur 3 (a@vhb.be) uit de lijst halen — de rest blijft (geen bulk-wipe).
    const zonderDrie = mem.users.filter((u: any) => u.id !== '3');
    const res = await api('POST', '/api/users', { token: 'tok-admin', body: zonderDrie });
    expect(res.status).toBe(200);
    expect(mem.documents.map((d: any) => d.id)).toEqual(['d2']);
  });
});

describe('foutmelding-digest (cron)', () => {
  // De digest mailt sinds 05-09 standaard één keer per week; de bestaande
  // tests draaien met 'elke' (dagelijks) zodat de dag van de testrun er niet
  // toe doet. De weekregel zelf heeft een eigen test.
  beforeEach(() => { process.env.ERROR_DIGEST_WEEKDAG = 'elke'; });
  afterEach(() => { delete process.env.ERROR_DIGEST_WEEKDAG; });

  it('mailt op een andere dag dan de ingestelde weekdag niets, maar draait wel', async () => {
    const andereDag = String((new Date().getDay() + 1) % 7);
    process.env.ERROR_DIGEST_WEEKDAG = andereDag;
    mem.emailsSent.length = 0;
    const res = await api('GET', '/api/cron/error-digest', { headers: { Authorization: 'Bearer test-cron-secret' } });
    expect(res.status).toBe(200);
    expect(res.json.reason).toBe('weekoverzicht');
    expect(mem.emailsSent).toHaveLength(0);
  });

  it('noemt het een weekoverzicht en kijkt zeven dagen terug op de ingestelde weekdag', async () => {
    process.env.ERROR_DIGEST_WEEKDAG = String(new Date().getDay());
    mem.emailsSent.length = 0;
    const res = await api('GET', '/api/cron/error-digest', { headers: { Authorization: 'Bearer test-cron-secret' } });
    expect(res.status).toBe(200);
    expect(mem.emailsSent).toHaveLength(1);
    expect(mem.emailsSent[0].subject).toMatch(/^Weekoverzicht portaal: /);
    expect(mem.emailsSent[0].text).toContain('7 dagen');
    // De weekcijfers (vroeger de aparte maandagmail) zitten in dezelfde mail.
    expect(mem.emailsSent[0].text).toContain('Afgelopen 7 dagen\nActieve gebruikers: ');
    expect(mem.emailsSent[0].text).toMatch(/Verlof: \d+ nieuw, \d+ beslist, \d+ open/);
  });
  const recent = () => new Date().toISOString();

  it('weigert zonder of met fout secret (401)', async () => {
    expect((await api('GET', '/api/cron/error-digest')).status).toBe(401);
    expect((await api('GET', '/api/cron/error-digest', { headers: { Authorization: 'Bearer fout' } })).status).toBe(401);
  });

  it('mailt een samenvatting naar admins als er recente fouten zijn', async () => {
    mem.clientErrors = [
      { id: 1, createdAt: recent(), message: 'Kon planning niet laden', source: 'error-toast', url: '/' },
      { id: 2, createdAt: recent(), message: 'Kon planning niet laden', source: 'error-toast', url: '/' },
      { id: 3, createdAt: recent(), message: 'TypeError: x is undefined', source: 'window.onerror', url: '/rooster' },
    ];
    const res = await api('GET', '/api/cron/error-digest', { headers: { Authorization: 'Bearer test-cron-secret' } });
    expect(res.status).toBe(200);
    expect(res.json.alerted).toBe(true);
    expect(res.json.count).toBe(3);
    expect(mem.emailsSent).toHaveLength(1);
    // Default-ontvanger = admin-account (admin@vhb.be).
    expect(mem.emailsSent[0].to).toContain('admin@vhb.be');
    expect(mem.emailsSent[0].subject).toContain('3 meldingen');
    expect(mem.emailsSent[0].context).toBe('error-digest');
  });

  it('stuurt ook een overzicht als er niets gebeurd is', async () => {
    // Bewuste keuze (02-08): élke dag een mail, ook bij nul. Een bericht dat
    // alleen bij problemen komt, laat je je afvragen of het niet gewoon niet
    // verstuurd is.
    mem.clientErrors = [];
    const res = await api('GET', '/api/cron/error-digest', { headers: { Authorization: 'Bearer test-cron-secret' } });
    expect(res.status).toBe(200);
    expect(res.json.alerted).toBe(true);
    expect(mem.emailsSent).toHaveLength(1);
    expect(mem.emailsSent[0].subject).toContain('geen meldingen');
  });

  it('houdt de toon neutraal en noemt het aantal toestellen', async () => {
    // Waarschuwingsteken weg (verzoek Jarno): 16 meldingen van één toestel las
    // als een storing terwijl het deploy-ruis was. Het aantal toestellen is
    // het signaal dat er wél toe doet.
    mem.clientErrors = [
      { id: 1, createdAt: recent(), message: 'Kon planning niet laden', source: 'error-toast', userId: '3' },
      { id: 2, createdAt: recent(), message: 'Kon updates niet laden', source: 'error-toast', userId: 'onbevestigd:3' },
    ];
    const res = await api('GET', '/api/cron/error-digest', { headers: { Authorization: 'Bearer test-cron-secret' } });
    expect(res.status).toBe(200);
    expect(mem.emailsSent[0].subject).not.toContain('⚠');
    expect(mem.emailsSent[0].subject).toMatch(/^Dagoverzicht portaal: /);
    // 'onbevestigd:3' en '3' zijn hetzelfde toestel.
    expect(mem.emailsSent[0].subject).toContain('1 toestel');
  });

  it('meldt hoeveel er als ruis genegeerd is', async () => {
    mem.clientErrors = [
      { id: 1, createdAt: recent(), message: 'Kon planning niet laden', source: 'error-toast', userId: '3' },
      { id: 2, createdAt: recent(), message: 'Je sessie is verlopen. Log opnieuw in.', source: 'error-toast', userId: '4' },
      { id: 3, createdAt: recent(), message: 'Failed to fetch dynamically imported module: /assets/x.js', source: 'unhandledrejection', userId: '4' },
    ];
    const res = await api('GET', '/api/cron/error-digest', { headers: { Authorization: 'Bearer test-cron-secret' } });
    expect(res.json.count).toBe(1);
    expect(mem.emailsSent[0].text).toContain('2 meldingen niet meegeteld');
  });

  it('negeert fouten ouder dan het interval', async () => {
    mem.clientErrors = [
      { id: 1, createdAt: '2020-01-01T00:00:00.000Z', message: 'oud', source: 'error-toast' },
    ];
    const res = await api('GET', '/api/cron/error-digest', { headers: { Authorization: 'Bearer test-cron-secret' } });
    // Er komt wél een dagoverzicht (dat komt elke dag), maar de oude fout
    // telt niet mee.
    expect(res.json.count).toBe(0);
    expect(mem.emailsSent[0].subject).toContain('geen meldingen');
  });

  it('respecteert ALERT_EMAIL als die gezet is', async () => {
    process.env.ALERT_EMAIL = 'ops@vhb.be, baas@vhb.be';
    mem.clientErrors = [{ id: 1, createdAt: recent(), message: 'boem', source: 'window.onerror' }];
    try {
      const res = await api('GET', '/api/cron/error-digest', { headers: { Authorization: 'Bearer test-cron-secret' } });
      expect(res.status).toBe(200);
      expect(mem.emailsSent[0].to).toEqual(['ops@vhb.be', 'baas@vhb.be']);
    } finally {
      delete process.env.ALERT_EMAIL;
    }
  });
});

describe('aanmeldingen (login-activiteit)', () => {
  it('logt een aanmelding bij sessie-start', async () => {
    const res = await api('POST', '/api/auth/session', { token: 'tok-a', body: { action: 'start' } });
    expect(res.status).toBe(200);
    const login = mem.activity.find((a) => a.action === 'Aangemeld');
    expect(login).toBeTruthy();
    expect(login.domain).toBe('auth');
  });

  it("sessie-start logt géén tweede 'Aangemeld' binnen 10 minuten (spam-dedup)", async () => {
    mem.lastAuthEventAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const res = await api('POST', '/api/auth/session', { token: 'tok-a', body: { action: 'start' } });
    expect(res.status).toBe(200);
    expect(mem.activity.find((a) => a.action === 'Aangemeld')).toBeUndefined();
    // Ouder dan 10 minuten → wél opnieuw loggen.
    mem.lastAuthEventAt = new Date(Date.now() - 15 * 60 * 1000).toISOString();
    await api('POST', '/api/auth/session', { token: 'tok-a', body: { action: 'start' } });
    expect(mem.activity.find((a) => a.action === 'Aangemeld')).toBeTruthy();
  });

  it('GET /api/activity/logins: admin krijgt logins, planner 403', async () => {
    await api('POST', '/api/auth/session', { token: 'tok-a', body: { action: 'start' } });
    const planner = await api('GET', '/api/activity/logins', { token: 'tok-planner' });
    expect(planner.status).toBe(403);
    const admin = await api('GET', '/api/activity/logins', { token: 'tok-admin' });
    expect(admin.status).toBe(200);
    expect(admin.json.days).toBe(30);
    expect(Array.isArray(admin.json.logins)).toBe(true);
    expect(admin.json.logins.length).toBeGreaterThanOrEqual(1);
  });

  // Tot 18-09 schreef 'resume' een 'Actief'-regel in het auditlogboek,
  // gededupliceerd op de kalenderdag. Dat wás de bron voor "wie was vandaag
  // actief", en meteen de reden dat die vraag onbeantwoordbaar bleef: één
  // regel per persoon per dag, dus alleen het eerste moment. Aanwezigheid komt
  // nu uit user_presence (zie de suite hieronder); het auditspoor gaat weer
  // puur over beheeracties en echte aanmeldingen.
  it('resume vervuilt het auditlogboek niet meer met aanwezigheid', async () => {
    const res = await api('POST', '/api/auth/session', { token: 'tok-a', body: { action: 'resume' } });
    expect(res.status).toBe(200);
    expect(mem.activity.find((a) => a.action === 'Actief')).toBeUndefined();
  });

  it('resume werkt lastLogin (Laatst actief) bij, zodat Gebruikers niet achterloopt op Activiteit', async () => {
    const res = await api('POST', '/api/auth/session', { token: 'tok-a', body: { action: 'resume' } });
    expect(res.status).toBe(200);
    expect(mem.sessionMetaWrites).toHaveLength(1);
    expect(res.json.lastLogin).toBe(mem.sessionMetaWrites[0].lastLogin);
    expect(Date.now() - new Date(res.json.lastLogin).getTime()).toBeLessThan(60_000);
  });

  it('een echte aanmelding blijft wél in het auditspoor staan', async () => {
    const res = await api('POST', '/api/auth/session', { token: 'tok-a', body: { action: 'start' } });
    expect(res.status).toBe(200);
    expect(mem.activity.find((a) => a.action === 'Aangemeld')).toBeTruthy();
  });
});

describe('documenten per gebruiker', () => {
  it('een chauffeur ziet alleen zijn eigen documenten, ook met een vreemde userId in de query', async () => {
    mem.documents = [
      { id: 'd1', userId: '3', filename: 'attest.pdf', storagePath: '3/x', uploadedAt: '2026-07-01T00:00:00Z' },
      { id: 'd2', userId: '4', filename: 'loonbrief.pdf', storagePath: '4/y', uploadedAt: '2026-07-01T00:00:00Z' },
    ];
    const res = await api('GET', '/api/documents?userId=4', { token: 'tok-a' }); // tok-a = user 3
    expect(res.status).toBe(200);
    expect(res.json.map((d: any) => d.id)).toEqual(['d1']);
  });

  it('alleen een admin kan de documenten van een andere gebruiker opvragen, een planner krijgt de eigen lijst', async () => {
    mem.documents = [
      { id: 'd2', userId: '4', filename: 'loonbrief.pdf', storagePath: '4/y', uploadedAt: '2026-07-01T00:00:00Z' },
      { id: 'd-p', userId: '2', filename: 'eigen.pdf', storagePath: '2/z', uploadedAt: '2026-07-01T00:00:00Z' },
    ];
    // Admin (user 1) mag een andere gebruiker uitlezen.
    const adminRes = await api('GET', '/api/documents?userId=4', { token: 'tok-admin' });
    expect(adminRes.status).toBe(200);
    expect(adminRes.json.map((d: any) => d.id)).toEqual(['d2']);
    // Planner (user 2) is géén staff meer voor documenten: ?userId=4 wordt
    // genegeerd, hij krijgt enkel zijn eigen documenten (gevoelige PII).
    const plannerRes = await api('GET', '/api/documents?userId=4', { token: 'tok-planner' });
    expect(plannerRes.status).toBe(200);
    expect(plannerRes.json.map((d: any) => d.id)).toEqual(['d-p']);
  });

  it('uploaden/broadcasten is niet meer toegankelijk voor een planner (403, admin-only)', async () => {
    expect((await api('POST', '/api/documents', { token: 'tok-planner', body: { userId: '3', filename: 'x.pdf', dataUrl: 'data:application/pdf;base64,QQ==' } })).status).toBe(403);
    expect((await api('POST', '/api/documents/broadcast', { token: 'tok-planner', body: { filename: 'r.pdf', dataUrl: 'data:application/pdf;base64,QQ==' } })).status).toBe(403);
  });

  it('uploaden en verwijderen zijn niet toegankelijk voor chauffeurs (403)', async () => {
    expect((await api('POST', '/api/documents', { token: 'tok-a', body: { userId: '3', filename: 'x.pdf', dataUrl: 'data:application/pdf;base64,QQ==' } })).status).toBe(403);
    expect((await api('DELETE', '/api/documents/d1', { token: 'tok-a' })).status).toBe(403);
  });

  it('document rondsturen naar alle chauffeurs is niet toegankelijk voor chauffeurs (403)', async () => {
    const res = await api('POST', '/api/documents/broadcast', { token: 'tok-a', body: { filename: 'reglement.pdf', dataUrl: 'data:application/pdf;base64,QQ==' } });
    expect(res.status).toBe(403);
  });
});

describe('push-abonnees (wie kan meldingen ontvangen)', () => {
  it('planner ziet de ids, chauffeur krijgt 403', async () => {
    await api('POST', '/api/push/subscribe', {
      token: 'tok-a',
      body: { endpoint: 'https://updates.push.services.mozilla.com/wpush/v2/abc', keys: { p256dh: 'p', auth: 'a' } },
    });
    const alsPlanner = await api('GET', '/api/push/subscribers', { token: 'tok-planner' });
    expect(alsPlanner.status).toBe(200);
    expect(alsPlanner.json).toEqual({ userIds: ['3'] });
    // Geen chauffeur-inzage: wie meldingen aan heeft is beheerinformatie.
    const alsChauffeur = await api('GET', '/api/push/subscribers', { token: 'tok-a' });
    expect(alsChauffeur.status).toBe(403);
  });
});

describe('digest: proactieve sectie openstaande diensten', () => {
  beforeEach(() => { process.env.ERROR_DIGEST_WEEKDAG = 'elke'; });
  afterEach(() => { delete process.env.ERROR_DIGEST_WEEKDAG; });
  it('mailt de gaten van de komende 7 dagen mét advies en pusht de planning', async () => {
    // Morgen (lokale klok — valt hoe dan ook binnen het Brusselse 7-dagenvenster):
    // dienst 12 is bemand in de matrix, dienst 11 wordt verwacht maar staat open.
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const morgen = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    mem.planningMatrix = [
      { id: 'm-dig', source_date: morgen, day_type: 'week', assignments: { 'Chauffeur A': '12' }, raw_row: '' },
    ];
    mem.coverageExpectations = { week: ['12', '11'] };
    mem.planning = [];

    const res = await api('GET', '/api/cron/error-digest', { headers: { Authorization: 'Bearer test-cron-secret' } });
    expect(res.status).toBe(200);
    const mail = mem.emailsSent.find((m) => m.context === 'error-digest');
    expect(mail?.text).toContain('Openstaande diensten (komende 7 dagen)');
    expect(mail?.text).toContain('dienst 11');
    // De samenvatting reist mee de mail in ("Ik zou … vragen").
    expect(mail?.text).toContain('Ik zou');
    // En de planners/admins krijgen één push met het aantal.
    const push = mem.pushesSent.find((p) => String(p.payload.title).includes('openstaande dienst'));
    expect(push).toBeTruthy();
    expect(push!.userIds.sort()).toEqual(['1', '2']);
  });

  it('geen gaten → geen sectie en geen push', async () => {
    mem.planningMatrix = [];
    mem.coverageExpectations = {};
    const res = await api('GET', '/api/cron/error-digest', { headers: { Authorization: 'Bearer test-cron-secret' } });
    expect(res.status).toBe(200);
    const mail = mem.emailsSent.find((m) => m.context === 'error-digest');
    expect(mail?.text ?? '').not.toContain('Openstaande diensten');
    expect(mem.pushesSent.some((p) => String(p.payload.title).includes('openstaande dienst'))).toBe(false);
  });
});

describe('meldingencentrum (public.meldingen)', () => {
  const zaai = () => {
    mem.meldingen = [
      { id: 'm-a1', userId: '3', titel: 'Verlof goedgekeurd', tekst: 'Betaald verlof', soort: 'verlof', doel: 'verlof', createdAt: '2026-06-30T08:00:00.000Z', gelezenOp: null },
      { id: 'm-a2', userId: '3', titel: 'Rooster bijgewerkt', tekst: null, soort: 'planning', doel: 'rooster', createdAt: '2026-06-29T08:00:00.000Z', gelezenOp: '2026-06-29T09:00:00.000Z' },
      { id: 'm-b1', userId: '4', titel: 'Nieuwe dienstruil-aanvraag', tekst: 'A wil ruilen', soort: 'ruil', doel: 'dienstruil', createdAt: '2026-06-30T09:00:00.000Z', gelezenOp: null },
    ];
  };

  it('GET geeft alleen de eigen meldingen, nieuwste eerst, mét ongelezen-teller', async () => {
    zaai();
    const res = await api('GET', '/api/meldingen', { token: 'tok-a' });
    expect(res.status).toBe(200);
    expect(res.json.ongelezen).toBe(1);
    expect(res.json.meldingen.map((m: any) => m.id)).toEqual(['m-a1', 'm-a2']);
    expect(res.json.meldingen[0]).toEqual({ id: 'm-a1', titel: 'Verlof goedgekeurd', tekst: 'Betaald verlof', soort: 'verlof', doel: 'verlof', createdAt: '2026-06-30T08:00:00.000Z' });
    expect(res.json.meldingen.some((m: any) => 'userId' in m)).toBe(false);
  });

  it('gelezen markeren: een selectie, alleen eigen rijen; zonder ids alles', async () => {
    zaai();
    // Andermans id in de selectie doet niets.
    const sel = await api('POST', '/api/meldingen/gelezen', { token: 'tok-a', body: { ids: ['m-a1', 'm-b1'] } });
    expect(sel.status).toBe(200);
    expect(sel.json.gelezen).toBe(1);
    expect(mem.meldingen.find((m: any) => m.id === 'm-b1').gelezenOp).toBeNull();
    // Alles (chauffeur B): één rij open.
    const alles = await api('POST', '/api/meldingen/gelezen', { token: 'tok-b', body: {} });
    expect(alles.json.gelezen).toBe(1);
    expect((await api('GET', '/api/meldingen', { token: 'tok-b' })).json.ongelezen).toBe(0);
  });

  it('verwijderen raakt alleen eigen rijen; andermans id doet niets', async () => {
    zaai();
    const res = await api('DELETE', '/api/meldingen', { token: 'tok-a', body: { ids: ['m-a2', 'm-b1'] } });
    expect(res.status).toBe(200);
    expect(res.json.verwijderd).toBe(1);
    expect(mem.meldingen.map((m: any) => m.id).sort()).toEqual(['m-a1', 'm-b1']);
    // De teller volgt: m-a2 was al gelezen, dus die blijft op 1 staan.
    expect((await api('GET', '/api/meldingen', { token: 'tok-a' })).json.ongelezen).toBe(1);
  });

  it('verwijderen eist minstens één id (400) en een sessie (401)', async () => {
    zaai();
    const leeg = await api('DELETE', '/api/meldingen', { token: 'tok-a', body: { ids: [] } });
    expect(leeg.status).toBe(400);
    expect(leeg.json.error).toBe('Ongeldige invoer');
    expect((await api('DELETE', '/api/meldingen', { body: { ids: ['m-a1'] } })).status).toBe(401);
    expect(mem.meldingen).toHaveLength(3);
  });

  it('valideert de body (400) en eist een sessie (401)', async () => {
    const fout = await api('POST', '/api/meldingen/gelezen', { token: 'tok-a', body: { ids: 'm-a1' } });
    expect(fout.status).toBe(400);
    expect(fout.json.error).toBe('Ongeldige invoer');
    expect((await api('GET', '/api/meldingen')).status).toBe(401);
  });

  it('een verlofbeslissing landt als melding bij de chauffeur (soort verlof, doel = de aanvraag zelf)', async () => {
    const res = await api('PATCH', '/api/leave/l-a1', { token: 'tok-planner', body: { status: 'approved', ifStatus: 'pending' } });
    expect(res.status).toBe(200);
    const vanA = mem.meldingen.filter((m: any) => m.userId === '3');
    expect(vanA).toHaveLength(1);
    // Tranche 3C: de melding wijst naar de aanvraag (`/verlof/<id>`), niet naar de lijst.
    expect(vanA[0]).toMatchObject({ soort: 'verlof', doel: 'verlof/l-a1', gelezenOp: null });
    expect(vanA[0].titel).toMatch(/goedgekeurd/i);
  });

  it('een ruilverzoek landt als melding bij de aangezochte collega (soort ruil, doel = die ruil)', async () => {
    const nieuw = { id: 's-nieuw', shiftId: 'sh-c', requesterId: '3', targetDriverId: '4', status: 'pending', reason: '', createdAt: '2026-06-13T08:00:00Z', returnDate: '2026-07-09', returnCode: 'VRIJ' };
    const own = mem.swaps.filter((s: any) => s.requesterId === '3' || s.targetDriverId === '3');
    const res = await api('POST', '/api/swaps', { token: 'tok-a', body: [...own, nieuw] });
    expect(res.status).toBe(200);
    const vanB = mem.meldingen.filter((m: any) => m.userId === '4');
    // Tranche 3C: de melding wijst naar de ruil zelf (`/dienstruil/<id>`).
    expect(vanB.map((m: any) => [m.soort, m.doel])).toEqual([['ruil', 'dienstruil/s-nieuw']]);
  });
});


// --- PDF-bijlagen bij een update (2026-09-21_updates_bijlagen.sql) ---
describe('bijlagen bij een update', () => {
  const PDF = 'data:application/pdf;base64,JVBERi0xLjQKJSVFT0Y=';
  const eersteId = () => String(mem.updates[0].id);

  it('planner hangt een PDF aan een update; de lijst komt terug in het record', async () => {
    const id = eersteId();
    const res = await api('POST', `/api/updates/${id}/bijlage`, { token: 'tok-planner', body: { slot: 1, filename: 'mededeling.pdf', dataUrl: PDF } });
    expect(res.status).toBe(200);
    expect(res.json.update.bijlagen).toEqual([{ slot: 1, filename: 'mededeling.pdf', sizeBytes: expect.any(Number), uploadedAt: KLOK_ISO }]);
    expect(mem.opslag.has(`update-bijlagen/${id}-1.pdf`)).toBe(true);
  });

  it('een tweede PDF komt erbij, een derde plaats bestaat niet', async () => {
    const id = eersteId();
    await api('POST', `/api/updates/${id}/bijlage`, { token: 'tok-planner', body: { slot: 1, filename: 'een.pdf', dataUrl: PDF } });
    const tweede = await api('POST', `/api/updates/${id}/bijlage`, { token: 'tok-planner', body: { slot: 2, filename: 'twee.pdf', dataUrl: PDF } });
    expect(tweede.json.update.bijlagen.map((b: any) => b.slot)).toEqual([1, 2]);
    const derde = await api('POST', `/api/updates/${id}/bijlage`, { token: 'tok-planner', body: { slot: 3, filename: 'drie.pdf', dataUrl: PDF } });
    expect(derde.status).toBe(400);
  });

  it('dezelfde plaats opnieuw vervangt de vorige, geen dubbele rij', async () => {
    const id = eersteId();
    await api('POST', `/api/updates/${id}/bijlage`, { token: 'tok-planner', body: { slot: 1, filename: 'oud.pdf', dataUrl: PDF } });
    const res = await api('POST', `/api/updates/${id}/bijlage`, { token: 'tok-planner', body: { slot: 1, filename: 'nieuw.pdf', dataUrl: PDF } });
    expect(res.json.update.bijlagen).toEqual([{ slot: 1, filename: 'nieuw.pdf', sizeBytes: expect.any(Number), uploadedAt: KLOK_ISO }]);
  });

  it('weigert niet-PDF, een leeg bestand, een onbekende update en een chauffeur', async () => {
    const id = eersteId();
    expect((await api('POST', `/api/updates/${id}/bijlage`, { token: 'tok-planner', body: { slot: 1, filename: 'foto.png', dataUrl: PDF } })).status).toBe(400);
    expect((await api('POST', `/api/updates/${id}/bijlage`, { token: 'tok-planner', body: { slot: 1, filename: 'leeg.pdf', dataUrl: 'data:application/pdf;base64,' } })).status).toBe(400);
    expect((await api('POST', '/api/updates/bestaat-niet/bijlage', { token: 'tok-planner', body: { slot: 1, filename: 'x.pdf', dataUrl: PDF } })).status).toBe(404);
    expect((await api('POST', `/api/updates/${id}/bijlage`, { token: 'tok-a', body: { slot: 1, filename: 'x.pdf', dataUrl: PDF } })).status).toBe(403);
  });

  it('een id met een schuine streep komt de bucket niet in', async () => {
    const res = await api('POST', '/api/updates/..%2Fgeheim/bijlage', { token: 'tok-planner', body: { slot: 1, filename: 'x.pdf', dataUrl: PDF } });
    expect(res.status).toBe(400);
    expect([...mem.opslag]).toEqual([]);
  });

  it('verwijderen haalt het bestand én de rij weg', async () => {
    const id = eersteId();
    await api('POST', `/api/updates/${id}/bijlage`, { token: 'tok-planner', body: { slot: 1, filename: 'weg.pdf', dataUrl: PDF } });
    const res = await api('DELETE', `/api/updates/${id}/bijlage/1`, { token: 'tok-planner' });
    expect(res.status).toBe(200);
    expect(res.json.update.bijlagen).toBeUndefined();
    expect(mem.opslag.has(`update-bijlagen/${id}-1.pdf`)).toBe(false);
  });

  it('een gewone save van de updates laat de bijlagen staan', async () => {
    const id = eersteId();
    await api('POST', `/api/updates/${id}/bijlage`, { token: 'tok-planner', body: { slot: 1, filename: 'blijft.pdf', dataUrl: PDF } });
    const lijst = mem.updates.map((u: any) => ({ id: u.id, date: u.date, title: u.title, content: u.content, category: u.category ?? 'algemeen' }));
    const res = await api('POST', '/api/updates', { token: 'tok-planner', body: lijst.map((u: any) => (String(u.id) === id ? { ...u, title: 'Nieuwe titel' } : u)) });
    expect(res.status).toBe(200);
    const bewaard = mem.updates.find((u: any) => String(u.id) === id);
    expect(bewaard.title).toBe('Nieuwe titel');
    expect(bewaard.bijlagen).toEqual([{ slot: 1, filename: 'blijft.pdf', sizeBytes: expect.any(Number), uploadedAt: KLOK_ISO }]);
  });

  it('GET /api/updates ondertekent elke bijlage en laat een verdwenen bestand weg', async () => {
    const id = eersteId();
    await api('POST', `/api/updates/${id}/bijlage`, { token: 'tok-planner', body: { slot: 1, filename: 'met-url.pdf', dataUrl: PDF } });
    const metUrl = (await api('GET', '/api/updates', { token: 'tok-a' })).json.find((u: any) => String(u.id) === id);
    expect(metUrl.bijlagen[0].url).toMatch(/^https:\/\/opslag\.test\//);
    // Bestand weg uit de bucket, rij nog in de kolom: dan geen dode link.
    mem.opslag.clear();
    const zonder = (await api('GET', '/api/updates', { token: 'tok-a' })).json.find((u: any) => String(u.id) === id);
    expect(zonder.bijlagen).toBeUndefined();
  });

  // Gewijzigd op 29-09 (controle-ronde nr. 12): heette 'een verwijderde update
  // neemt haar bestanden mee' en eiste dat de PDF meteen weg was. Dat gedrag
  // is bewust veranderd: zo kon "Ongedaan maken" de bijlagen nooit
  // terugbrengen. De bestanden gaan nog altijd weg, maar via de nachtcron.
  it('een verwijderde update laat haar bestanden staan tot de nachtcron ze een dag later opruimt', async () => {
    const id = eersteId();
    await api('POST', `/api/updates/${id}/bijlage`, { token: 'tok-planner', body: { slot: 1, filename: 'mee.pdf', dataUrl: PDF } });
    const rev = (await api('GET', '/api/updates', { token: 'tok-planner' })).json.find((u: any) => String(u.id) === id)._rev;
    // Een seconde na de upload: staat de verwijdering op dezelfde
    // milliseconde als een andere logregel, dan telt ze niet als bewijs.
    tik();
    const res = await api('DELETE', `/api/updates/${id}`, { token: 'tok-planner', headers: { 'X-Record-Revision': rev } });
    expect(res.status).toBe(200);
    expect(mem.opslag.has(`update-bijlagen/${id}-1.pdf`)).toBe(true);

    // Dezelfde nacht: de verwijdering is van zonet, het bestand blijft.
    const cron = () => api('GET', '/api/cron/backup', { headers: { Authorization: 'Bearer test-cron-secret' } });
    expect((await cron()).json.bijlagen).toEqual({ omleidingen: 0, updates: 0, overgeslagen: [] });
    expect(mem.opslag.has(`update-bijlagen/${id}-1.pdf`)).toBe(true);

    // Een dag later is het record nog altijd weg: nu mag het bestand weg.
    vi.setSystemTime(new Date('2026-06-16T11:00:00Z'));
    expect((await cron()).json.bijlagen).toEqual({ omleidingen: 0, updates: 1, overgeslagen: [] });
    expect(mem.opslag.has(`update-bijlagen/${id}-1.pdf`)).toBe(false);
  });

  it('een herstelde update houdt haar PDF, ook een dag later en ook als de brede lijst haar niet toont', async () => {
    const id = eersteId();
    await api('POST', `/api/updates/${id}/bijlage`, { token: 'tok-planner', body: { slot: 1, filename: 'blijft.pdf', dataUrl: PDF } });
    const record = (await api('GET', '/api/updates', { token: 'tok-planner' })).json.find((u: any) => String(u.id) === id);
    tik();
    await api('DELETE', `/api/updates/${id}`, { token: 'tok-planner', headers: { 'X-Record-Revision': record._rev } });
    tik();
    const { _rev, ...zonderRev } = record;
    expect((await api('POST', '/api/updates/one', { token: 'tok-planner', body: zonderRev, headers: { 'X-Herstel': '1' } })).status).toBe(201);

    vi.setSystemTime(new Date('2026-06-17T11:00:00Z'));
    const cron = () => api('GET', '/api/cron/backup', { headers: { Authorization: 'Bearer test-cron-secret' } });
    expect((await cron()).json.bijlagen).toEqual({ omleidingen: 0, updates: 0, overgeslagen: [] });
    expect(mem.opslag.has(`update-bijlagen/${id}-1.pdf`)).toBe(true);
  });

  describe('ongedaan maken na verwijderen (X-Herstel)', () => {
    const verwijder = async (id: string) => {
      const record = (await api('GET', '/api/updates', { token: 'tok-planner' })).json.find((u: any) => String(u.id) === id);
      tik();
      const res = await api('DELETE', `/api/updates/${id}`, { token: 'tok-planner', headers: { 'X-Record-Revision': record._rev } });
      expect(res.status).toBe(200);
      tik();
      const { _rev, ...zonderRev } = record;
      return zonderRev;
    };

    it('brengt de update terug met haar PDF’s, zonder tweede push', async () => {
      const id = eersteId();
      await api('POST', `/api/updates/${id}/bijlage`, { token: 'tok-planner', body: { slot: 1, filename: 'een.pdf', dataUrl: PDF } });
      await api('POST', `/api/updates/${id}/bijlage`, { token: 'tok-planner', body: { slot: 2, filename: 'twee.pdf', dataUrl: PDF } });
      const record = await verwijder(id);
      expect(record.bijlagen).toHaveLength(2);
      mem.pushesSent = [];

      const terug = await api('POST', '/api/updates/one', { token: 'tok-planner', body: record, headers: { 'X-Herstel': '1' } });
      expect(terug.status).toBe(201);
      // Naam van de client (etiket), grootte uit Storage.
      expect(terug.json.update.bijlagen).toEqual([
        { slot: 1, filename: 'een.pdf', sizeBytes: 1001 },
        { slot: 2, filename: 'twee.pdf', sizeBytes: 1002 },
      ]);
      const get = (await api('GET', '/api/updates', { token: 'tok-a' })).json.find((u: any) => String(u.id) === id);
      expect(get.bijlagen.map((b: any) => b.url)).toEqual([`https://opslag.test/${id}-1.pdf?sig=test`, `https://opslag.test/${id}-2.pdf?sig=test`]);
      expect(mem.pushesSent).toEqual([]);
      expect(mem.activity.some((a) => a.action === 'Bijlagen hersteld' && a.entityType === 'update' && a.entityId === id)).toBe(true);
    });

    it('hangt alleen terug wat nog in Storage staat, en nooit iets zonder X-Herstel', async () => {
      const id = eersteId();
      await api('POST', `/api/updates/${id}/bijlage`, { token: 'tok-planner', body: { slot: 1, filename: 'een.pdf', dataUrl: PDF } });
      await api('POST', `/api/updates/${id}/bijlage`, { token: 'tok-planner', body: { slot: 2, filename: 'twee.pdf', dataUrl: PDF } });
      const record = await verwijder(id);
      mem.opslag.delete(`update-bijlagen/${id}-2.pdf`);

      // Zonder de herstel-header is het een gewone nieuwe update: geen bijlagen.
      const gewoon = await api('POST', '/api/updates/one', { token: 'tok-planner', body: record });
      expect(gewoon.status).toBe(201);
      expect(gewoon.json.update.bijlagen).toBeUndefined();
      const rev = gewoon.json.update._rev;
      tik();
      await api('DELETE', `/api/updates/${id}`, { token: 'tok-planner', headers: { 'X-Record-Revision': rev } });
      tik();

      const terug = await api('POST', '/api/updates/one', { token: 'tok-planner', body: record, headers: { 'X-Herstel': '1' } });
      expect(terug.status).toBe(201);
      expect(terug.json.update.bijlagen).toEqual([{ slot: 1, filename: 'een.pdf', sizeBytes: 1001 }]);
    });

    it('X-Herstel zonder verwijdering in het log is een gewone opslag: er gaat niets terug', async () => {
      // Een bestand dat toevallig op de sleutel van het nieuwe id hangt.
      mem.opslag.add('update-bijlagen/nooit-verwijderd-1.pdf');
      const res = await api('POST', '/api/updates/one', {
        token: 'tok-planner',
        headers: { 'X-Herstel': '1' },
        body: { id: 'nooit-verwijderd', date: '29/09/2026', title: 'Nieuw', content: 'Tekst', bijlagen: [{ slot: 1, filename: 'x.pdf' }] },
      });
      expect(res.status).toBe(201);
      expect(res.json.update.bijlagen).toBeUndefined();
      expect(mem.updates.find((u: any) => u.id === 'nooit-verwijderd').bijlagen).toBeUndefined();
      expect(mem.activity.some((a) => a.action === 'Bijlagen hersteld')).toBe(false);
    });

    it('een verwijdering van langer dan vijf minuten geleden is geen herstel meer', async () => {
      const id = eersteId();
      await api('POST', `/api/updates/${id}/bijlage`, { token: 'tok-planner', body: { slot: 1, filename: 'een.pdf', dataUrl: PDF } });
      const record = await verwijder(id);
      tik(6 * 60_000);
      const terug = await api('POST', '/api/updates/one', { token: 'tok-planner', body: record, headers: { 'X-Herstel': '1' } });
      expect(terug.status).toBe(201);
      expect(terug.json.update.bijlagen).toBeUndefined();
      // Het bestand zelf blijft staan: er is alleen niets aan het record gehangen.
      expect(mem.opslag.has(`update-bijlagen/${id}-1.pdf`)).toBe(true);
    });
  });

  // Uploadmoment (29-09): de server zet `uploadedAt` bij elke upload, zodat een
  // vervanging met dezelfde naam en grootte voor de cache op het toestel een
  // ander bestand is. Een client kan het nooit zetten; een bijlage van
  // daarvoor heeft het niet en blijft overal geldig.
  describe('uploadmoment (uploadedAt)', () => {
    const upload = (id: string, slot: number, filename: string, extra: Record<string, unknown> = {}) =>
      api('POST', `/api/updates/${id}/bijlage`, { token: 'tok-planner', body: { slot, filename, dataUrl: PDF, ...extra } });
    const inLijst = async (id: string, token = 'tok-a') => (await api('GET', '/api/updates', { token })).json.find((u: any) => String(u.id) === id);
    const VALS = '2099-01-01T00:00:00.000Z';

    it('een upload zet het uploadmoment van de server, en de chauffeur krijgt het mee in de lijst', async () => {
      const id = eersteId();
      tik(5 * 60_000);
      const moment = new Date(Date.parse(KLOK_ISO) + 5 * 60_000).toISOString();
      const res = await upload(id, 2, 'formulier.pdf');
      expect(res.json.update.bijlagen).toEqual([{ slot: 2, filename: 'formulier.pdf', sizeBytes: expect.any(Number), uploadedAt: moment }]);
      expect(mem.updates.find((u: any) => String(u.id) === id).bijlagen).toEqual([{ slot: 2, filename: 'formulier.pdf', sizeBytes: expect.any(Number), uploadedAt: moment }]);
      expect((await inLijst(id)).bijlagen).toEqual([{ slot: 2, filename: 'formulier.pdf', sizeBytes: expect.any(Number), uploadedAt: moment, url: `https://opslag.test/${id}-2.pdf?sig=test` }]);
    });

    it('een vervanging op dezelfde plaats met dezelfde naam en grootte is voor de cache van de client een ander bestand', async () => {
      const id = eersteId();
      await upload(id, 1, 'rooster.pdf');
      const eerste = (await inLijst(id)).bijlagen[0];
      tik(90_000);
      await upload(id, 1, 'rooster.pdf');
      const tweede = (await inLijst(id)).bijlagen[0];
      // Plaats, naam, grootte en pad in de opslag zijn gelijk: zonder het
      // uploadmoment hield de telefoon het vorige bestand voor dit.
      expect([tweede.slot, tweede.filename, tweede.sizeBytes]).toEqual([eerste.slot, eerste.filename, eerste.sizeBytes]);
      expect(bijlageSleutel(tweede.url)).toBe(bijlageSleutel(eerste.url));
      expect(eerste.uploadedAt).toBe(KLOK_ISO);
      expect(tweede.uploadedAt).toBe(new Date(Date.parse(KLOK_ISO) + 90_000).toISOString());
      expect(bijlageVersie(tweede)).not.toBe(bijlageVersie(eerste));
    });

    it('een meegestuurd uploadedAt van de client telt nooit: niet bij opslaan, niet bij uploaden, niet bij herstellen', async () => {
      const id = eersteId();
      await upload(id, 1, 'een.pdf');
      tik();
      // In de body van de upload zelf.
      const tweede = await upload(id, 2, 'twee.pdf', { uploadedAt: VALS });
      expect(tweede.json.update.bijlagen.map((b: any) => b.uploadedAt)).toEqual([KLOK_ISO, new Date(Date.parse(KLOK_ISO) + 1000).toISOString()]);
      const serverLijst = mem.updates.find((u: any) => String(u.id) === id).bijlagen;

      // PUT met een vervalste lijst: de server houdt de zijne.
      const { _rev, ...record } = await inLijst(id, 'tok-planner');
      const vervalst = record.bijlagen.map((b: any) => ({ ...b, uploadedAt: VALS }));
      const put = await api('PUT', `/api/updates/${id}`, { token: 'tok-planner', body: { ...record, bijlagen: vervalst }, headers: { 'X-Record-Revision': _rev } });
      expect(put.status).toBe(200);
      expect(put.json.update.bijlagen).toEqual(serverLijst);

      // De hele collectie opslaan (bulk) met dezelfde vervalsing.
      const bulk = await api('POST', '/api/updates', { token: 'tok-planner', body: mem.updates.map((u: any) => ({ id: u.id, date: u.date, title: u.title, content: u.content, category: u.category ?? 'algemeen', bijlagen: String(u.id) === id ? vervalst : undefined })) });
      expect(bulk.status).toBe(200);
      expect(mem.updates.find((u: any) => String(u.id) === id).bijlagen).toEqual(serverLijst);

      // Ongedaan maken na verwijderen: het uploadmoment komt uit Storage.
      // Voor slot 1 kent Storage er een, voor slot 2 niet: dan blijft het weg.
      mem.opslagTijd.set(`update-bijlagen/${id}-1.pdf`, '2026-06-15T09:59:58.000Z');
      const weg = await inLijst(id, 'tok-planner');
      tik();
      expect((await api('DELETE', `/api/updates/${id}`, { token: 'tok-planner', headers: { 'X-Record-Revision': weg._rev } })).status).toBe(200);
      tik();
      const { _rev: _weg, ...terugTeZetten } = weg;
      const terug = await api('POST', '/api/updates/one', {
        token: 'tok-planner',
        headers: { 'X-Herstel': '1' },
        body: { ...terugTeZetten, bijlagen: weg.bijlagen.map((b: any) => ({ ...b, uploadedAt: VALS })) },
      });
      expect(terug.status).toBe(201);
      expect(terug.json.update.bijlagen).toEqual([
        { slot: 1, filename: 'een.pdf', sizeBytes: 1001, uploadedAt: '2026-06-15T09:59:58.000Z' },
        { slot: 2, filename: 'twee.pdf', sizeBytes: 1002 },
      ]);
    });

    it('een bijlage zonder uploadmoment (van vóór 29-09) blijft geldig naast een nieuwe: lijst, versie, opslaan en verwijderen', async () => {
      const id = eersteId();
      mem.updates[0].bijlagen = [{ slot: 1, filename: 'oud.pdf', sizeBytes: 900 }];
      mem.opslag.add(`update-bijlagen/${id}-1.pdf`);
      const res = await upload(id, 2, 'nieuw.pdf');
      expect(res.json.update.bijlagen).toEqual([
        { slot: 1, filename: 'oud.pdf', sizeBytes: 900 },
        { slot: 2, filename: 'nieuw.pdf', sizeBytes: expect.any(Number), uploadedAt: KLOK_ISO },
      ]);
      const lijst = (await inLijst(id)).bijlagen;
      expect(lijst.map((b: any) => [b.slot, b.uploadedAt ?? null, typeof b.url])).toEqual([[1, null, 'string'], [2, KLOK_ISO, 'string']]);
      // Zonder uploadmoment valt de client terug op naam en grootte.
      expect(bijlageVersie(lijst[0])).toBe('oud.pdf|900|');
      // Het nieuwe weghalen laat het oude ongemoeid.
      const na = await api('DELETE', `/api/updates/${id}/bijlage/2`, { token: 'tok-planner' });
      expect(na.status).toBe(200);
      expect(na.json.update.bijlagen).toEqual([{ slot: 1, filename: 'oud.pdf', sizeBytes: 900 }]);
    });
  });
});

// --- PDF-bijlagen bij een omleiding (2026-09-25_diversions_bijlagen.sql) ---
describe('bijlagen bij een omleiding', () => {
  const PDF = 'data:application/pdf;base64,JVBERi0xLjQKJSVFT0Y=';
  const upload = (id: string, slot: number, filename = `plan-${slot}.pdf`, token = 'tok-planner') =>
    api('POST', `/api/diversions/${id}/bijlage`, { token, body: { slot, filename, dataUrl: PDF } });
  beforeEach(() => {
    mem.opslag.clear();
    mem.diversions = [
      { id: 'o-1', line: '12', title: 'Werken N70', description: 'Omrijden via …', startDate: '2026-07-01', endDate: '2026-07-31' },
      { id: 'o-2', line: '14', title: 'Kermis', description: 'Centrum afgesloten', startDate: '2026-08-01' },
    ];
  });

  it('POST …/bijlage zet het bestand op <id>-<slot>.pdf, hangt de lijst aan het record en logt', async () => {
    const res = await upload('o-1', 1, 'omleidingsplan.pdf');
    expect(res.status).toBe(200);
    expect(res.json.diversion.bijlagen).toEqual([{ slot: 1, filename: 'omleidingsplan.pdf', sizeBytes: expect.any(Number), uploadedAt: KLOK_ISO, url: 'https://opslag.test/diversions/o-1-1.pdf?sig=test' }]);
    expect(res.json.diversion._rev).toBeTruthy();
    expect(mem.opslag.has('diversions/o-1-1.pdf')).toBe(true);
    expect(mem.diversions[0].bijlagen).toEqual([{ slot: 1, filename: 'omleidingsplan.pdf', sizeBytes: expect.any(Number), uploadedAt: KLOK_ISO }]);
    expect(mem.activity.find((a) => a.action === 'Bijlage toegevoegd' && a.entityType === 'diversion')).toBeTruthy();
  });

  it('vijf plaatsen, op slot gesorteerd; een zesde en slot 0 worden geweigerd', async () => {
    for (const slot of [3, 1, 5, 2, 4]) expect((await upload('o-1', slot)).status).toBe(200);
    const get = await api('GET', '/api/diversions', { token: 'tok-a' });
    expect(get.json.find((d: any) => d.id === 'o-1').bijlagen.map((b: any) => b.slot)).toEqual([1, 2, 3, 4, 5]);
    expect((await upload('o-1', 6)).status).toBe(400);
    expect((await upload('o-1', 0)).status).toBe(400);
  });

  it('dezelfde plaats opnieuw vervangt de vorige, geen dubbele rij', async () => {
    await upload('o-1', 2, 'oud.pdf');
    const res = await upload('o-1', 2, 'nieuw.pdf');
    expect(res.json.diversion.bijlagen).toEqual([{ slot: 2, filename: 'nieuw.pdf', sizeBytes: expect.any(Number), uploadedAt: KLOK_ISO, url: expect.any(String) }]);
  });

  it('weigert geen-PDF, leeg bestand, onbekende omleiding, chauffeur en een id met padtekens', async () => {
    expect((await api('POST', '/api/diversions/o-1/bijlage', { token: 'tok-planner', body: { slot: 1, filename: 'foto.png', dataUrl: PDF } })).status).toBe(400);
    expect((await api('POST', '/api/diversions/o-1/bijlage', { token: 'tok-planner', body: { slot: 1, filename: 'leeg.pdf', dataUrl: 'data:application/pdf;base64,' } })).status).toBe(400);
    expect((await upload('bestaat-niet', 1)).status).toBe(404);
    expect((await upload('o-1', 1, 'x.pdf', 'tok-a')).status).toBe(403);
    const traversal = await api('POST', '/api/diversions/..%2Fgeheim/bijlage', { token: 'tok-planner', body: { slot: 1, filename: 'x.pdf', dataUrl: PDF } });
    expect(traversal.status).toBe(400);
    expect(mem.opslag.size).toBe(0);
  });

  it('DELETE …/bijlage/:slot haalt het bestand weg; zonder bijlagen verdwijnt het veld', async () => {
    await upload('o-1', 1);
    await upload('o-1', 2);
    const eerste = await api('DELETE', '/api/diversions/o-1/bijlage/1', { token: 'tok-planner' });
    expect(eerste.status).toBe(200);
    expect(eerste.json.diversion.bijlagen.map((b: any) => b.slot)).toEqual([2]);
    expect(mem.opslag.has('diversions/o-1-1.pdf')).toBe(false);
    const tweede = await api('DELETE', '/api/diversions/o-1/bijlage/2', { token: 'tok-planner' });
    expect(tweede.json.diversion.bijlagen).toBeUndefined();
    expect(mem.diversions[0].bijlagen).toBeUndefined();
    expect(mem.activity.filter((a) => a.action === 'Bijlage verwijderd')).toHaveLength(2);
  });

  it('een gewone save (PUT en bulk) laat de bijlagen staan', async () => {
    await upload('o-1', 1, 'blijft.pdf');
    const rev = (await api('GET', '/api/diversions', { token: 'tok-planner' })).json.find((d: any) => d.id === 'o-1')._rev;
    const put = await api('PUT', '/api/diversions/o-1', { token: 'tok-planner', body: { id: 'o-1', line: '12', title: 'Werken N70 (verlengd)', description: 'Omrijden via …', startDate: '2026-07-01', endDate: '2026-08-31' }, headers: { 'X-Record-Revision': rev } });
    expect(put.status).toBe(200);
    expect(put.json.diversion.title).toBe('Werken N70 (verlengd)');
    expect(put.json.diversion.bijlagen).toEqual([{ slot: 1, filename: 'blijft.pdf', sizeBytes: expect.any(Number), uploadedAt: KLOK_ISO, url: expect.any(String) }]);
    const bulk = await api('POST', '/api/diversions', { token: 'tok-planner', body: mem.diversions.map((d: any) => ({ id: d.id, line: d.line, title: d.title, description: d.description, startDate: d.startDate, endDate: d.endDate })) });
    expect(bulk.status).toBe(200);
    expect(mem.diversions.find((d: any) => d.id === 'o-1').bijlagen).toEqual([{ slot: 1, filename: 'blijft.pdf', sizeBytes: expect.any(Number), uploadedAt: KLOK_ISO }]);
  });

  it('GET ondertekent elke bijlage en laat een verdwenen bestand weg', async () => {
    await upload('o-1', 1);
    await upload('o-1', 2);
    mem.opslag.delete('diversions/o-1-1.pdf');
    const get = await api('GET', '/api/diversions', { token: 'tok-a' });
    const o1 = get.json.find((d: any) => d.id === 'o-1');
    expect(o1.bijlagen).toEqual([{ slot: 2, filename: 'plan-2.pdf', sizeBytes: expect.any(Number), uploadedAt: KLOK_ISO, url: 'https://opslag.test/diversions/o-1-2.pdf?sig=test' }]);
    expect(get.json.find((d: any) => d.id === 'o-2').bijlagen).toBeUndefined();
  });

  const cron = () => api('GET', '/api/cron/backup', { headers: { Authorization: 'Bearer test-cron-secret' } });
  /** Verwijdert de omleiding zoals de client dat doet en geeft het record
   *  terug dat "Ongedaan maken" opnieuw zou posten. */
  const verwijder = async (id: string) => {
    const record = (await api('GET', '/api/diversions', { token: 'tok-planner' })).json.find((d: any) => d.id === id);
    tik();
    const res = await api('DELETE', `/api/diversions/${id}`, { token: 'tok-planner', headers: { 'X-Record-Revision': record._rev } });
    expect(res.status).toBe(200);
    tik();
    const { _rev, ...zonderRev } = record;
    return zonderRev;
  };
  /** Alles wat er in de bucket van de omleidingen hangt, gesorteerd. */
  const inOpslag = () => [...mem.opslag].filter((k) => k.startsWith('diversions/')).sort();

  // Gewijzigd op 29-09 (controle-ronde nr. 12): heette 'een verwijderde
  // omleiding neemt haar bestanden mee' en eiste dat de PDF's meteen weg
  // waren. Dat gedrag is bewust veranderd: zo kon "Ongedaan maken" de
  // bijlagen nooit terugbrengen. De bestanden gaan nog altijd weg, maar via
  // de nachtcron, een dag nadat het record verdween.
  it('een verwijderde omleiding laat haar bestanden staan tot de nachtcron ze een dag later opruimt', async () => {
    await upload('o-1', 1);
    await upload('o-1', 4);
    await upload('o-2', 1);
    await verwijder('o-1');
    expect([...mem.opslag].filter((k) => k.startsWith('diversions/o-1')).sort()).toEqual(['diversions/o-1-1.pdf', 'diversions/o-1-4.pdf']);

    // Dezelfde nacht: de verwijdering is van zonet, de bestanden blijven.
    expect((await cron()).json.bijlagen).toEqual({ omleidingen: 0, updates: 0, overgeslagen: [] });
    expect([...mem.opslag].filter((k) => k.startsWith('diversions/o-1'))).toHaveLength(2);

    // Een dag later: weg, en de PDF van de omleiding die nog bestaat blijft.
    vi.setSystemTime(new Date('2026-06-16T11:00:00Z'));
    expect((await cron()).json.bijlagen).toEqual({ omleidingen: 2, updates: 0, overgeslagen: [] });
    expect([...mem.opslag].filter((k) => k.startsWith('diversions/'))).toEqual(['diversions/o-2-1.pdf']);
  });

  describe('ongedaan maken na verwijderen (X-Herstel)', () => {
    it('brengt de omleiding terug met haar PDF’s', async () => {
      await upload('o-1', 1, 'plan.pdf');
      await upload('o-1', 3, 'haltes.pdf');
      const record = await verwijder('o-1');
      expect(record.bijlagen).toHaveLength(2);

      const terug = await api('POST', '/api/diversions/one', { token: 'tok-planner', body: record, headers: { 'X-Herstel': '1' } });
      expect(terug.status).toBe(201);
      // Naam van de client (etiket), grootte en URL van de server.
      expect(terug.json.diversion.bijlagen).toEqual([
        { slot: 1, filename: 'plan.pdf', sizeBytes: 1001, url: 'https://opslag.test/diversions/o-1-1.pdf?sig=test' },
        { slot: 3, filename: 'haltes.pdf', sizeBytes: 1003, url: 'https://opslag.test/diversions/o-1-3.pdf?sig=test' },
      ]);
      expect(mem.diversions.find((d: any) => d.id === 'o-1').bijlagen).toEqual([
        { slot: 1, filename: 'plan.pdf', sizeBytes: 1001 },
        { slot: 3, filename: 'haltes.pdf', sizeBytes: 1003 },
      ]);
      expect(mem.activity.some((a) => a.action === 'Omleiding hersteld' && a.entityId === 'o-1')).toBe(true);
      expect(mem.activity.some((a) => a.action === 'Bijlagen hersteld' && a.entityType === 'diversion' && a.entityId === 'o-1')).toBe(true);

      // Na het herstel bestaat het record weer: de cron blijft van de PDF's af.
      vi.setSystemTime(new Date('2026-06-17T11:00:00Z'));
      expect((await cron()).json.bijlagen.omleidingen).toBe(0);
      expect(mem.opslag.has('diversions/o-1-1.pdf')).toBe(true);
    });

    it('vertrouwt geen pad, URL of slot van de client: alleen wat de server zelf in Storage vindt', async () => {
      await upload('o-1', 1, 'plan.pdf');
      await upload('o-2', 2, 'van-een-ander.pdf');
      const record = await verwijder('o-1');
      const terug = await api('POST', '/api/diversions/one', {
        token: 'tok-planner',
        headers: { 'X-Herstel': '1' },
        body: {
          ...record,
          pdfUrl: 'https://kwaad.example/nep.pdf',
          bijlagen: [
            { slot: 1, filename: 'plan.pdf', sizeBytes: 5, url: 'https://kwaad.example/nep.pdf' },
            // Slot 2 hangt bij o-2, niet bij o-1: er staat geen o-1-2.pdf.
            { slot: 2, filename: 'van-een-ander.pdf', url: 'https://opslag.test/diversions/o-2-2.pdf?sig=test' },
            // Geen PDF-naam en een naam met een pad: nooit als etiket.
            { slot: 3, filename: 'script.exe' },
            { slot: 4, filename: '../o-2-2.pdf' },
          ],
        },
      });
      expect(terug.status).toBe(201);
      expect(terug.json.diversion.bijlagen).toEqual([{ slot: 1, filename: 'plan.pdf', sizeBytes: 1001, url: 'https://opslag.test/diversions/o-1-1.pdf?sig=test' }]);
      expect(terug.json.diversion.pdfUrl).toBeUndefined();
      expect(mem.diversions.find((d: any) => d.id === 'o-1').pdfUrl).toBeUndefined();
    });

    it('zonder X-Herstel blijft een nieuwe omleiding zonder bijlagen, ook als er bestanden op haar id hangen', async () => {
      await upload('o-1', 1, 'plan.pdf');
      const record = await verwijder('o-1');
      const gewoon = await api('POST', '/api/diversions/one', { token: 'tok-planner', body: record });
      expect(gewoon.status).toBe(201);
      expect(gewoon.json.diversion.bijlagen).toBeUndefined();
    });

    it('is het bestand intussen weg, dan komt de omleiding terug zonder die bijlage', async () => {
      await upload('o-1', 1, 'plan.pdf');
      const record = await verwijder('o-1');
      mem.opslag.delete('diversions/o-1-1.pdf');
      const terug = await api('POST', '/api/diversions/one', { token: 'tok-planner', body: record, headers: { 'X-Herstel': '1' } });
      expect(terug.status).toBe(201);
      expect(terug.json.diversion.title).toBe('Werken N70');
      expect(terug.json.diversion.bijlagen).toBeUndefined();
    });

    // Tegenlezing 29-09, punt 1: het id komt van de client. Omleiding o-1
    // heeft een PDF op slot 2 (o-1-2.pdf); wie "herstelt" met het id o-1-2
    // liet de server dat bestand lezen als de oude sleutel van het nieuwe
    // id en verhuizen naar o-1-2-1.pdf: o-1 was zijn PDF kwijt.
    describe('een vreemd id kaapt geen PDF van een bestaande omleiding', () => {
      const kaping = { id: 'o-1-2', line: '12', title: 'Kaping', description: 'x', startDate: '2026-09-29', bijlagen: [{ slot: 1, filename: 'x.pdf' }] };

      it('X-Herstel zonder verwijdering in het log: geen verhuis, o-1 houdt zijn PDF, Storage ongewijzigd', async () => {
        await upload('o-1', 2, 'van-o-1.pdf');
        const voor = inOpslag();
        const res = await api('POST', '/api/diversions/one', { token: 'tok-planner', body: kaping, headers: { 'X-Herstel': '1' } });
        expect(res.status).toBe(201);
        expect(res.json.diversion.bijlagen).toBeUndefined();
        expect(inOpslag()).toEqual(voor);
        expect(inOpslag()).toEqual(['diversions/o-1-2.pdf']);
        const o1 = (await api('GET', '/api/diversions', { token: 'tok-a' })).json.find((d: any) => d.id === 'o-1');
        expect(o1.bijlagen).toEqual([{ slot: 2, filename: 'van-o-1.pdf', sizeBytes: expect.any(Number), uploadedAt: KLOK_ISO, url: 'https://opslag.test/diversions/o-1-2.pdf?sig=test' }]);
        expect(mem.activity.some((a) => a.action === 'Bijlagen hersteld')).toBe(false);
      });

      it('ook met een echte, verse verwijdering van o-1-2 blijft het bestand van o-1: de naam kan slot 2 van een bestaand record zijn', async () => {
        await upload('o-1', 2, 'van-o-1.pdf');
        // De planner maakt o-1-2 echt aan en verwijdert het, zodat het log
        // een verse verwijdering van precies dat id kent.
        const { bijlagen: _b, ...zonder } = kaping;
        expect((await api('POST', '/api/diversions/one', { token: 'tok-planner', body: zonder })).status).toBe(201);
        await verwijder('o-1-2');
        const voor = inOpslag();
        const res = await api('POST', '/api/diversions/one', { token: 'tok-planner', body: kaping, headers: { 'X-Herstel': '1' } });
        expect(res.status).toBe(201);
        expect(res.json.diversion.bijlagen).toBeUndefined();
        expect(inOpslag()).toEqual(voor);
        const o1 = (await api('GET', '/api/diversions', { token: 'tok-a' })).json.find((d: any) => d.id === 'o-1');
        expect(o1.bijlagen.map((b: any) => b.url)).toEqual(['https://opslag.test/diversions/o-1-2.pdf?sig=test']);
      });

      it('andersom: een herstelde omleiding hangt geen bestand terug dat de oude PDF van een bestaand record kan zijn', async () => {
        // o-1-1.pdf is slot 1 van o-1, maar ook de oude sleutel van een
        // omleiding met id o-1-1 (marker pdfUrl, geen lijst).
        await upload('o-1', 1, 'plan.pdf');
        mem.diversions.push({ id: 'o-1-1', line: '14', title: 'Oude PDF', description: 'x', startDate: '2026-07-01', pdfUrl: 'https://oud.supabase.test/o-1-1.pdf' });
        const record = await verwijder('o-1');
        const res = await api('POST', '/api/diversions/one', { token: 'tok-planner', body: record, headers: { 'X-Herstel': '1' } });
        expect(res.status).toBe(201);
        expect(res.json.diversion.bijlagen).toBeUndefined();
        expect(inOpslag()).toEqual(['diversions/o-1-1.pdf']);
      });

      it('is niet na te gaan of de andere eigenaar bestaat, dan gebeurt er niets', async () => {
        mem.opslag.add('diversions/o-1.pdf');
        mem.diversions[0].pdfUrl = 'https://oud.supabase.test/o-1.pdf';
        const record = await verwijder('o-1');
        mem.recordLezingFaalt = true;
        const res = await api('POST', '/api/diversions/one', { token: 'tok-planner', body: record, headers: { 'X-Herstel': '1' } });
        expect(res.status).toBe(201);
        expect(res.json.diversion.bijlagen).toBeUndefined();
        expect(inOpslag()).toEqual(['diversions/o-1.pdf']);
      });
    });

    it('is het log niet te lezen, dan komt de omleiding terug zonder bijlagen en blijft Storage ongewijzigd', async () => {
      await upload('o-1', 1, 'plan.pdf');
      const record = await verwijder('o-1');
      mem.logLezingFaalt = true;
      const terug = await api('POST', '/api/diversions/one', { token: 'tok-planner', body: record, headers: { 'X-Herstel': '1' } });
      expect(terug.status).toBe(201);
      expect(terug.json.diversion.title).toBe('Werken N70');
      expect(terug.json.diversion.bijlagen).toBeUndefined();
      expect(inOpslag()).toEqual(['diversions/o-1-1.pdf']);
    });

    it('een verwijdering van langer dan vijf minuten geleden is geen herstel meer', async () => {
      await upload('o-1', 1, 'plan.pdf');
      const record = await verwijder('o-1');
      tik(6 * 60_000);
      const terug = await api('POST', '/api/diversions/one', { token: 'tok-planner', body: record, headers: { 'X-Herstel': '1' } });
      expect(terug.status).toBe(201);
      expect(terug.json.diversion.bijlagen).toBeUndefined();
      expect(inOpslag()).toEqual(['diversions/o-1-1.pdf']);
    });

    it('is Storage niet te controleren, dan komt de omleiding toch terug, zonder bijlagen en zonder de bestanden te raken', async () => {
      await upload('o-1', 1, 'plan.pdf');
      const record = await verwijder('o-1');
      mem.opslagFaalt = true;
      const terug = await api('POST', '/api/diversions/one', { token: 'tok-planner', body: record, headers: { 'X-Herstel': '1' } });
      expect(terug.status).toBe(201);
      expect(mem.diversions.find((d: any) => d.id === 'o-1').bijlagen).toBeUndefined();
      expect(mem.opslag.has('diversions/o-1-1.pdf')).toBe(true);
      expect(mem.activity.some((a) => a.action === 'Bijlagen hersteld')).toBe(false);
    });

    it('een chauffeur kan niets herstellen', async () => {
      await upload('o-1', 1, 'plan.pdf');
      const record = await verwijder('o-1');
      const res = await api('POST', '/api/diversions/one', { token: 'tok-a', body: record, headers: { 'X-Herstel': '1' } });
      expect(res.status).toBe(403);
      expect(mem.diversions.some((d: any) => d.id === 'o-1')).toBe(false);
    });
  });

  describe('een PDF van vóór 25-09 (<id>.pdf met marker pdfUrl)', () => {
    beforeEach(() => {
      mem.opslag.add('diversions/o-1.pdf');
      mem.diversions[0].pdfUrl = 'https://oud.supabase.test/storage/v1/object/sign/diversions/o-1.pdf?token=x';
    });

    it('telt als slot 1 met de naam omleiding.pdf, zolang de rij geen lijst heeft', async () => {
      const get = await api('GET', '/api/diversions', { token: 'tok-a' });
      const o1 = get.json.find((d: any) => d.id === 'o-1');
      expect(o1.bijlagen).toEqual([{ slot: 1, filename: 'omleiding.pdf', url: 'https://opslag.test/diversions/o-1.pdf?sig=test' }]);
      expect(o1.pdfUrl).toBeUndefined();
      // Bestand weg maar marker nog aanwezig: geen bijlage, geen dode link.
      mem.opslag.delete('diversions/o-1.pdf');
      const zonder = (await api('GET', '/api/diversions', { token: 'tok-a' })).json.find((d: any) => d.id === 'o-1');
      expect(zonder.bijlagen).toBeUndefined();
    });

    it('een tweede PDF erbij verhuist de oude naar <id>-1.pdf en wist de marker', async () => {
      const res = await upload('o-1', 2, 'haltekaart.pdf');
      expect(res.status).toBe(200);
      expect(res.json.diversion.bijlagen).toEqual([
        { slot: 1, filename: 'omleiding.pdf', url: 'https://opslag.test/diversions/o-1-1.pdf?sig=test' },
        { slot: 2, filename: 'haltekaart.pdf', sizeBytes: expect.any(Number), uploadedAt: KLOK_ISO, url: 'https://opslag.test/diversions/o-1-2.pdf?sig=test' },
      ]);
      expect(mem.opslag.has('diversions/o-1.pdf')).toBe(false);
      expect(mem.diversions[0].pdfUrl).toBeUndefined();
      expect(mem.diversions[0].bijlagen).toEqual([{ slot: 1, filename: 'omleiding.pdf' }, { slot: 2, filename: 'haltekaart.pdf', sizeBytes: expect.any(Number), uploadedAt: KLOK_ISO }]);
    });

    it('slot 1 vervangen ruimt de oude sleutel op', async () => {
      const res = await upload('o-1', 1, 'nieuw-plan.pdf');
      expect(res.status).toBe(200);
      expect(res.json.diversion.bijlagen).toEqual([{ slot: 1, filename: 'nieuw-plan.pdf', sizeBytes: expect.any(Number), uploadedAt: KLOK_ISO, url: 'https://opslag.test/diversions/o-1-1.pdf?sig=test' }]);
      expect(mem.opslag.has('diversions/o-1.pdf')).toBe(false);
      expect(mem.diversions[0].pdfUrl).toBeUndefined();
    });

    it('slot 1 verwijderen haalt de oude sleutel weg en laat een lege omleiding achter', async () => {
      const res = await api('DELETE', '/api/diversions/o-1/bijlage/1', { token: 'tok-planner' });
      expect(res.status).toBe(200);
      expect(res.json.diversion.bijlagen).toBeUndefined();
      expect(mem.opslag.has('diversions/o-1.pdf')).toBe(false);
      expect(mem.diversions[0].pdfUrl).toBeUndefined();
      expect(mem.diversions[0].bijlagen).toBeUndefined();
    });

    it('ongedaan maken na verwijderen verhuist de oude PDF naar <id>-1.pdf en hangt ze terug', async () => {
      const record = await verwijder('o-1');
      expect(record.bijlagen).toEqual([{ slot: 1, filename: 'omleiding.pdf', url: 'https://opslag.test/diversions/o-1.pdf?sig=test' }]);
      expect(mem.opslag.has('diversions/o-1.pdf')).toBe(true);
      const terug = await api('POST', '/api/diversions/one', { token: 'tok-planner', body: record, headers: { 'X-Herstel': '1' } });
      expect(terug.status).toBe(201);
      expect(terug.json.diversion.bijlagen).toEqual([{ slot: 1, filename: 'omleiding.pdf', url: 'https://opslag.test/diversions/o-1-1.pdf?sig=test' }]);
      expect(mem.opslag.has('diversions/o-1.pdf')).toBe(false);
      expect(mem.diversions.find((d: any) => d.id === 'o-1').pdfUrl).toBeUndefined();
    });

    it('een gewone save houdt de marker (en dus de oude PDF) vast', async () => {
      const rev = (await api('GET', '/api/diversions', { token: 'tok-planner' })).json.find((d: any) => d.id === 'o-1')._rev;
      const put = await api('PUT', '/api/diversions/o-1', { token: 'tok-planner', body: { id: 'o-1', line: '12', title: 'Werken N70', description: 'Anders', startDate: '2026-07-01' }, headers: { 'X-Record-Revision': rev } });
      expect(put.status).toBe(200);
      expect(put.json.diversion.bijlagen).toEqual([{ slot: 1, filename: 'omleiding.pdf', url: 'https://opslag.test/diversions/o-1.pdf?sig=test' }]);
      expect(mem.diversions[0].pdfUrl).toBeTruthy();
    });
  });

  // Uploadmoment (29-09): zelfde regels als bij de updates.
  describe('uploadmoment (uploadedAt)', () => {
    const inLijst = async (id: string, token = 'tok-a') => (await api('GET', '/api/diversions', { token })).json.find((d: any) => d.id === id);
    const VALS = '2099-01-01T00:00:00.000Z';
    const velden = (d: any) => ({ id: d.id, line: d.line, title: d.title, description: d.description, startDate: d.startDate, endDate: d.endDate });

    it('een upload zet het uploadmoment van de server, en de chauffeur krijgt het mee in de lijst', async () => {
      tik(5 * 60_000);
      const moment = new Date(Date.parse(KLOK_ISO) + 5 * 60_000).toISOString();
      const res = await upload('o-1', 3, 'haltes.pdf');
      expect(res.json.diversion.bijlagen).toEqual([{ slot: 3, filename: 'haltes.pdf', sizeBytes: expect.any(Number), uploadedAt: moment, url: 'https://opslag.test/diversions/o-1-3.pdf?sig=test' }]);
      expect(mem.diversions[0].bijlagen).toEqual([{ slot: 3, filename: 'haltes.pdf', sizeBytes: expect.any(Number), uploadedAt: moment }]);
      expect((await inLijst('o-1')).bijlagen).toEqual([{ slot: 3, filename: 'haltes.pdf', sizeBytes: expect.any(Number), uploadedAt: moment, url: 'https://opslag.test/diversions/o-1-3.pdf?sig=test' }]);
    });

    it('een vervanging op dezelfde plaats met dezelfde naam en grootte is voor de cache van de client een ander bestand', async () => {
      await upload('o-1', 1, 'plan.pdf');
      const eerste = (await inLijst('o-1')).bijlagen[0];
      tik(90_000);
      await upload('o-1', 1, 'plan.pdf');
      const tweede = (await inLijst('o-1')).bijlagen[0];
      expect([tweede.slot, tweede.filename, tweede.sizeBytes]).toEqual([eerste.slot, eerste.filename, eerste.sizeBytes]);
      expect(bijlageSleutel(tweede.url)).toBe(bijlageSleutel(eerste.url));
      expect(eerste.uploadedAt).toBe(KLOK_ISO);
      expect(tweede.uploadedAt).toBe(new Date(Date.parse(KLOK_ISO) + 90_000).toISOString());
      expect(bijlageVersie(tweede)).not.toBe(bijlageVersie(eerste));
    });

    it('een meegestuurd uploadedAt van de client telt nooit: niet bij opslaan, niet bij uploaden, niet bij herstellen', async () => {
      await upload('o-1', 1, 'plan.pdf');
      tik();
      const tweede = await api('POST', '/api/diversions/o-1/bijlage', { token: 'tok-planner', body: { slot: 2, filename: 'haltes.pdf', dataUrl: PDF, uploadedAt: VALS } });
      expect(tweede.json.diversion.bijlagen.map((b: any) => b.uploadedAt)).toEqual([KLOK_ISO, new Date(Date.parse(KLOK_ISO) + 1000).toISOString()]);
      const serverLijst = mem.diversions[0].bijlagen;

      // PUT met een vervalste lijst: de server houdt de zijne.
      const { _rev, ...record } = await inLijst('o-1', 'tok-planner');
      const vervalst = record.bijlagen.map((b: any) => ({ ...b, uploadedAt: VALS }));
      const put = await api('PUT', '/api/diversions/o-1', { token: 'tok-planner', body: { ...record, bijlagen: vervalst }, headers: { 'X-Record-Revision': _rev } });
      expect(put.status).toBe(200);
      expect(mem.diversions[0].bijlagen).toEqual(serverLijst);
      expect(put.json.diversion.bijlagen.map((b: any) => b.uploadedAt)).toEqual(serverLijst.map((b: any) => b.uploadedAt));

      // Bulk met dezelfde vervalsing.
      const bulk = await api('POST', '/api/diversions', { token: 'tok-planner', body: mem.diversions.map((d: any) => ({ ...velden(d), ...(d.id === 'o-1' ? { bijlagen: vervalst } : {}) })) });
      expect(bulk.status).toBe(200);
      expect(mem.diversions.find((d: any) => d.id === 'o-1').bijlagen).toEqual(serverLijst);

      // Een nieuwe omleiding met een vervalste lijst krijgt geen bijlagen.
      const nieuw = await api('POST', '/api/diversions/one', { token: 'tok-planner', body: { line: '9', title: 'Nieuw', description: 'x', startDate: '2026-07-01', bijlagen: vervalst } });
      expect(nieuw.status).toBe(201);
      expect(nieuw.json.diversion.bijlagen).toBeUndefined();

      // Ongedaan maken: het uploadmoment komt uit Storage (slot 1), of blijft
      // weg als Storage er geen kent (slot 2).
      mem.opslagTijd.set('diversions/o-1-1.pdf', '2026-06-15T09:59:58.000Z');
      const weg = await verwijder('o-1');
      const terug = await api('POST', '/api/diversions/one', {
        token: 'tok-planner',
        headers: { 'X-Herstel': '1' },
        body: { ...weg, bijlagen: weg.bijlagen.map((b: any) => ({ ...b, uploadedAt: VALS })) },
      });
      expect(terug.status).toBe(201);
      expect(mem.diversions.find((d: any) => d.id === 'o-1').bijlagen).toEqual([
        { slot: 1, filename: 'plan.pdf', sizeBytes: 1001, uploadedAt: '2026-06-15T09:59:58.000Z' },
        { slot: 2, filename: 'haltes.pdf', sizeBytes: 1002 },
      ]);
    });

    it('een bijlage zonder uploadmoment (van vóór 29-09) blijft overal geldig naast een nieuwe: lijst, versie, mail en nachtcron', async () => {
      mem.diversions[0].bijlagen = [{ slot: 1, filename: 'oud.pdf', sizeBytes: 900 }];
      mem.opslag.add('diversions/o-1-1.pdf');
      const res = await upload('o-1', 2, 'nieuw.pdf');
      expect(res.json.diversion.bijlagen).toEqual([
        { slot: 1, filename: 'oud.pdf', sizeBytes: 900, url: 'https://opslag.test/diversions/o-1-1.pdf?sig=test' },
        { slot: 2, filename: 'nieuw.pdf', sizeBytes: expect.any(Number), uploadedAt: KLOK_ISO, url: 'https://opslag.test/diversions/o-1-2.pdf?sig=test' },
      ]);
      const lijst = (await inLijst('o-1')).bijlagen;
      // Zonder uploadmoment valt de client terug op naam en grootte.
      expect(bijlageVersie(lijst[0])).toBe('oud.pdf|900|');
      expect(bijlageVersie(lijst[1])).toBe(`nieuw.pdf|${lijst[1].sizeBytes}|${encodeURIComponent(KLOK_ISO)}`);

      // De mailknop stuurt beide PDF's mee.
      mem.emailsSent = [];
      const mail = await api('POST', '/api/diversions/o-1/mail', { token: 'tok-planner', body: { ontvangers: { adressen: ['x@y.be'] } } });
      expect(mail.status).toBe(200);
      expect(mem.emailsSent[0].attachments?.map((a) => a.filename)).toEqual(['oud.pdf', 'nieuw.pdf']);

      // Verwijderd en een dag later: de nachtcron ruimt beide bestanden op.
      await verwijder('o-1');
      vi.setSystemTime(new Date('2026-06-16T11:00:00Z'));
      expect((await cron()).json.bijlagen).toEqual({ omleidingen: 2, updates: 0, overgeslagen: [] });
      expect(inOpslag()).toEqual([]);
    });
  });
});


// --- Beheer › Mails (mailtranche PR 3) ---
describe('Beheer › Mails (/api/mails)', () => {
  beforeEach(async () => {
    delete mem.appSettings['mail_instellingen'];
    delete mem.appSettings['verzendlijsten'];
    mem.mailLog = [
      { id: 'm-1', verzondenOp: '2026-09-25T06:00:00Z', soort: 'weekoverzicht', aantal: 2, gelukt: true, fout: null, door: 'Systeem' },
      { id: 'm-2', verzondenOp: '2026-09-24T10:00:00Z', soort: 'ziekmelding', aantal: 1, gelukt: false, fout: 'uitgeschakeld in Beheer › Mails', door: 'Planner Piet' },
      { id: 'm-3', verzondenOp: '2026-09-23T10:00:00Z', soort: 'ziekmelding', aantal: 2, gelukt: true, fout: null, door: 'Planner Piet' },
    ];
    const { invalidateMailCaches } = await import('../../api/_lib/mailInstellingen.js');
    invalidateMailCaches();
  });

  it('GET geeft elke mailsoort met aan/uit en laatst geslaagde verzending, de lijsten en het log; alleen admin', async () => {
    const res = await api('GET', '/api/mails', { token: 'tok-admin' });
    expect(res.status).toBe(200);
    const ziek = res.json.soorten.find((s: any) => s.soort === 'ziekmelding');
    expect(ziek.aan).toBe(true);
    // "Laatst" = de laatste GESLAAGDE verzending, niet de uitgeschakelde poging.
    expect(ziek.laatst).toEqual({ op: '2026-09-23T10:00:00Z', aantal: 2, gelukt: true });
    expect(res.json.soorten.find((s: any) => s.soort === 'welkom')).toMatchObject({ altijdAan: true, aan: true, laatst: null });
    expect(res.json.verzendlijsten).toEqual([]);
    expect(res.json.log).toHaveLength(3);
    expect((await api('GET', '/api/mails', { token: 'tok-planner' })).status).toBe(403);
    expect((await api('GET', '/api/mails', { token: 'tok-a' })).status).toBe(403);
  });

  it('PUT instellingen zet een uitzetbare soort uit, negeert altijd-aan en onbekende soorten, en logt de omslag', async () => {
    const res = await api('PUT', '/api/mails/instellingen', { token: 'tok-admin', body: { uit: ['ziekmelding', 'welkom', 'bestaat-niet'] } });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ uit: ['ziekmelding'] });
    expect(mem.appSettings['mail_instellingen']).toEqual({ uit: ['ziekmelding'] });
    const get = await api('GET', '/api/mails', { token: 'tok-admin' });
    expect(get.json.soorten.find((s: any) => s.soort === 'ziekmelding').aan).toBe(false);
    expect(get.json.soorten.find((s: any) => s.soort === 'welkom').aan).toBe(true);
    expect(mem.activity.find((a: any) => a.action === 'Mailinstellingen gewijzigd')?.message).toContain('Uit: Ziekmelding.');
    // Weer aan: opnieuw een logregel, deze keer "Aan".
    await api('PUT', '/api/mails/instellingen', { token: 'tok-admin', body: { uit: [] } });
    expect(mem.activity.filter((a: any) => a.action === 'Mailinstellingen gewijzigd').at(-1)?.message).toContain('Aan: Ziekmelding.');
    expect((await api('PUT', '/api/mails/instellingen', { token: 'tok-planner', body: { uit: [] } })).status).toBe(403);
    expect((await api('PUT', '/api/mails/instellingen', { token: 'tok-admin', body: { uit: 'x' } })).status).toBe(400);
  });

  it('een uitgezette soort houdt sendEmail tegen (mailSoortAan), altijd-aan niet', async () => {
    const { mailSoortAan } = await import('../../api/_lib/mailInstellingen.js');
    await api('PUT', '/api/mails/instellingen', { token: 'tok-admin', body: { uit: ['dringende-update'] } });
    expect(await mailSoortAan('dringende-update')).toBe(false);
    expect(await mailSoortAan('welkom')).toBe(true);
    expect(await mailSoortAan('verlof-beslissing')).toBe(true);
  });

  it('PUT verzendlijsten valideert (naam, adressen), normaliseert en logt; GET geeft ze terug', async () => {
    const lijsten = [{ id: 'l-1', naam: 'De Lijn', adressen: ['Dispatching@DeLijn.be', 'planning@delijn.be'] }];
    const res = await api('PUT', '/api/mails/verzendlijsten', { token: 'tok-admin', body: lijsten });
    expect(res.status).toBe(200);
    expect(res.json[0].adressen).toEqual(['dispatching@delijn.be', 'planning@delijn.be']);
    expect((await api('GET', '/api/mails', { token: 'tok-admin' })).json.verzendlijsten).toHaveLength(1);
    expect(mem.activity.find((a: any) => a.action === 'Verzendlijsten gewijzigd')?.message).toBe('Nieuw: De Lijn.');
    expect((await api('PUT', '/api/mails/verzendlijsten', { token: 'tok-admin', body: [{ id: 'l-2', naam: '', adressen: ['a@b.be'] }] })).status).toBe(400);
    expect((await api('PUT', '/api/mails/verzendlijsten', { token: 'tok-admin', body: [{ id: 'l-2', naam: 'x', adressen: ['geen-adres'] }] })).status).toBe(400);
    expect((await api('PUT', '/api/mails/verzendlijsten', { token: 'tok-planner', body: [] })).status).toBe(403);
    const weg = await api('PUT', '/api/mails/verzendlijsten', { token: 'tok-admin', body: [] });
    expect(weg.status).toBe(200);
    expect(mem.activity.filter((a: any) => a.action === 'Verzendlijsten gewijzigd').at(-1)?.message).toBe('Verwijderd: De Lijn.');
  });

  describe('zelf een mail sturen (POST /api/mails/eigen)', () => {
    const basis = { onderwerp: 'Nieuwe uniformen', tekst: 'Vanaf 1 juli.\n\nKom passen in het depot.' };
    beforeEach(() => {
      mem.emailsSent = [];
      mem.appSettings['verzendlijsten'] = [{ id: 'l-1', naam: 'De Lijn', adressen: ['dispatching@delijn.be', 'a@vhb.be'] }];
      mem.users.push({ id: '9', name: 'Inactieve Chauffeur', email: 'inactief@vhb.be', role: 'chauffeur', isActive: false });
      mem.users.push({ id: '10', name: 'Technieker Tom', email: 'tom@vhb.be', role: 'technieker', isActive: true });
    });
    afterEach(() => { mem.users = mem.users.filter((u: any) => !['9', '10'].includes(u.id)); });

    it('droog: leidt de ontvangers server-side af, ontdubbelt over groepen, lijsten, gebruikers en adressen, en geeft de mail terug', async () => {
      const res = await api('POST', '/api/mails/eigen', { token: 'tok-admin', body: { ...basis, droog: true, ontvangers: { groepen: ['chauffeurs'], lijsten: ['l-1'], gebruikers: ['3', '10', '9', 'bestaat-niet'], adressen: ['B@vhb.be', 'extern@voorbeeld.be'] } } });
      expect(res.status).toBe(200);
      expect(res.json.droog).toBe(true);
      // chauffeurs a + b, lijst dispatching (+ a dubbel), gebruiker tom, adres extern; inactief valt af, b dubbel.
      expect(res.json.ontvangers.map((o: any) => o.adres).sort()).toEqual(['a@vhb.be', 'b@vhb.be', 'dispatching@delijn.be', 'extern@voorbeeld.be', 'tom@vhb.be']);
      expect(res.json.aantal).toBe(5);
      expect(res.json.html).toContain('Nieuwe uniformen');
      expect(res.json.html).toContain('Kom passen in het depot.');
      // Geen regel over wie verstuurde of waar antwoorden terechtkomen (Jarno 30-09);
      // het antwoordadres blijft (zie de verzending hieronder).
      expect(res.json.html).not.toContain('Verstuurd door');
      expect(res.json.html).not.toContain('Antwoorden komen');
      expect(mem.emailsSent).toHaveLength(0);
    });

    it('versturen: één mail per persoon met de admin als antwoordadres, één logregel, activity-log', async () => {
      const res = await api('POST', '/api/mails/eigen', { token: 'tok-admin', body: { ...basis, ontvangers: { groepen: ['planning'], adressen: ['extern@voorbeeld.be'] } } });
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({ droog: false, aantal: 3, gelukt: 3, mislukt: 0 });
      expect(mem.emailsSent.map((m) => m.to).sort()).toEqual([['admin@vhb.be'], ['extern@voorbeeld.be'], ['planner@vhb.be']]);
      expect(mem.emailsSent.every((m) => m.subject === 'Nieuwe uniformen' && m.context?.startsWith('eigen-mail:'))).toBe(true);
      expect(mem.mailLog.filter((r: any) => r.soort === 'eigen-mail')).toHaveLength(1);
      expect(mem.mailLog.find((r: any) => r.soort === 'eigen-mail')).toMatchObject({ aantal: 3, door: 'Annelies Admin' });
      expect(mem.activity.find((a: any) => a.action === 'Eigen mail verstuurd')?.message).toContain('"Nieuwe uniformen" naar 3 ontvangers');
    });

    it('de logregel staat er vóór de eerste mail, als niet afgerond, en wordt daarna bijgewerkt (nr. 5)', async () => {
      const { sendEmail } = await import('../../api/email.js');
      mem.mailLogVerloop = [];
      const tijdens: any[] = [];
      vi.mocked(sendEmail).mockImplementationOnce(async (opts: any) => {
        // Zou de functie hier afbreken, dan is dit wat er in het verzendlog blijft staan.
        tijdens.push({ ...mem.mailLog.find((r: any) => r.soort === 'eigen-mail') });
        mem.emailsSent.push({ to: opts.to, subject: opts.subject, context: opts.context });
        mem.mailLogVerloop.push(`mail:${opts.to.join(',')}`);
        return { ok: true, mocked: false };
      });
      const res = await api('POST', '/api/mails/eigen', { token: 'tok-admin', body: { ...basis, ontvangers: { groepen: ['planning'], adressen: ['extern@voorbeeld.be'] } } });
      expect(res.status).toBe(200);
      expect(mem.mailLogVerloop[0]).toBe('start:eigen-mail');
      expect(mem.mailLogVerloop.at(-1)).toBe('klaar:eigen-mail');
      expect(mem.mailLogVerloop.filter((v: string) => v.startsWith('mail:'))).toHaveLength(3);
      expect(tijdens[0]).toMatchObject({ soort: 'eigen-mail', aantal: 3, gelukt: false, door: 'Annelies Admin' });
      expect(tijdens[0].fout).toMatch(/^onderbroken/);
      // Eén regel, geen tweede erbij, en nooit een adres of de inhoud.
      expect(mem.mailLog.filter((r: any) => r.soort === 'eigen-mail')).toHaveLength(1);
      expect(JSON.stringify(mem.mailLog)).not.toMatch(/@|Nieuwe uniformen|Kom passen/);
    });

    it('deels mislukt: het antwoord noemt wie niet vertrok, en `alleen` stuurt daarna alleen naar hen (nr. 5)', async () => {
      const { sendEmail } = await import('../../api/email.js');
      vi.mocked(sendEmail).mockImplementation(async (opts: any) => {
        if (opts.to[0] === 'planner@vhb.be') return { ok: false, mocked: false, error: '450 rate limit' };
        mem.emailsSent.push({ to: opts.to, subject: opts.subject, context: opts.context });
        return { ok: true, mocked: false };
      });
      const keuze = { groepen: ['planning'], adressen: ['extern@voorbeeld.be'] };
      try {
        const res = await api('POST', '/api/mails/eigen', { token: 'tok-admin', body: { ...basis, ontvangers: keuze } });
        expect(res.status).toBe(200);
        expect(res.json).toMatchObject({ droog: false, aantal: 3, gelukt: 2, mislukt: 1, nietGeprobeerd: 0, onzeker: 0, mocked: false, resterend: ['planner@vhb.be'], onzekerAdressen: [] });
        expect(mem.mailLog.find((r: any) => r.soort === 'eigen-mail')).toMatchObject({ aantal: 3, gelukt: false, fout: '1 van 3 mislukt' });
        expect(mem.activity.find((a: any) => a.action === 'Eigen mail verstuurd')?.message).toContain('naar 3 ontvangers, 1 mislukt');
      } finally {
        vi.mocked(sendEmail).mockImplementation(async (opts: any) => {
          mem.emailsSent.push({ to: opts.to, subject: opts.subject, context: opts.context, text: opts.text, attachments: opts.attachments });
          mem.mailLogVerloop.push(`mail:${opts.to.join(',')}`);
          return { ok: true, mocked: true };
        });
      }
      // Alleen de rest: dezelfde keuze, met het adres dat niet vertrok.
      mem.emailsSent = [];
      const rest = await api('POST', '/api/mails/eigen', { token: 'tok-admin', body: { ...basis, ontvangers: keuze, alleen: ['Planner@VHB.be'] } });
      expect(rest.status).toBe(200);
      expect(rest.json).toMatchObject({ aantal: 1, gelukt: 1, resterend: [] });
      expect(mem.emailsSent.map((m) => m.to)).toEqual([['planner@vhb.be']]);
      // `alleen` is een filter op de keuze, geen extra bron van ontvangers.
      mem.emailsSent = [];
      const vreemd = await api('POST', '/api/mails/eigen', { token: 'tok-admin', body: { ...basis, ontvangers: keuze, alleen: ['iemand-anders@voorbeeld.be'] } });
      expect(vreemd.status).toBe(400);
      expect(mem.emailsSent).toHaveLength(0);
    });

    it('zonder regel vooraf (tabel ontbreekt) blijft het één regel achteraf', async () => {
      mem.mailLogStuk = true;
      try {
        const res = await api('POST', '/api/mails/eigen', { token: 'tok-admin', body: { ...basis, ontvangers: { adressen: ['extern@voorbeeld.be'] } } });
        expect(res.status).toBe(200);
        expect(mem.mailLog.filter((r: any) => r.soort === 'eigen-mail')).toHaveLength(1);
        expect(mem.mailLog.find((r: any) => r.soort === 'eigen-mail')).toMatchObject({ aantal: 1, gelukt: false, fout: 'SMTP niet geconfigureerd, mail alleen gelogd' });
      } finally {
        mem.mailLogStuk = false;
      }
    });

    it('weigert zonder ontvangers, met een ongeldig adres, een onbekende lijst, een leeg onderwerp, en voor niet-admins', async () => {
      expect((await api('POST', '/api/mails/eigen', { token: 'tok-admin', body: { ...basis, ontvangers: {} } })).status).toBe(400);
      expect((await api('POST', '/api/mails/eigen', { token: 'tok-admin', body: { ...basis, ontvangers: { adressen: ['geen-adres'] } } })).status).toBe(400);
      expect((await api('POST', '/api/mails/eigen', { token: 'tok-admin', body: { ...basis, ontvangers: { lijsten: ['bestaat-niet'] } } })).status).toBe(400);
      expect((await api('POST', '/api/mails/eigen', { token: 'tok-admin', body: { ...basis, onderwerp: ' ', ontvangers: { groepen: ['chauffeurs'] } } })).status).toBe(400);
      expect((await api('POST', '/api/mails/eigen', { token: 'tok-planner', body: { ...basis, ontvangers: { groepen: ['chauffeurs'] } } })).status).toBe(403);
      expect(mem.emailsSent).toHaveLength(0);
    });
  });

  describe('een omleiding mailen (POST /api/diversions/:id/mail)', () => {
    beforeEach(() => {
      mem.emailsSent = [];
      mem.opslag.clear();
      mem.appSettings['verzendlijsten'] = [{ id: 'l-1', naam: 'De Lijn', adressen: ['dispatching@delijn.be', 'planning@delijn.be'] }];
      mem.diversions = [
        { id: 'o-1', line: '58, 82', location: 'Zottegem', title: 'Werken Markt', description: 'Omrijden via de ring.\n\nHaltes Markt en Station vervallen.', startDate: '2026-10-01', endDate: '2026-10-10', bijlagen: [{ slot: 1, filename: 'plan.pdf', sizeBytes: 1200 }, { slot: 3, filename: 'haltes.pdf' }] },
        { id: 'o-2', line: 'Alle', title: 'Kermis', description: 'x', startDate: '2026-10-05', pdfUrl: 'https://oud.supabase.test/o-2.pdf' },
      ];
      mem.opslag.add('diversions/o-1-1.pdf');
      mem.opslag.add('diversions/o-2.pdf');
    });

    it('droog: verzendlijsten plus vrije adressen, ontdubbeld, met onderwerp, mail en bijlagenlijst; planner mag', async () => {
      const res = await api('POST', '/api/diversions/o-1/mail', { token: 'tok-planner', body: { droog: true, bericht: 'Beste, hierbij de omleiding.', ontvangers: { lijsten: ['l-1'], adressen: ['Planning@DeLijn.be', 'garage@vhb.be'] } } });
      expect(res.status).toBe(200);
      expect(res.json.ontvangers.map((o: any) => o.adres).sort()).toEqual(['dispatching@delijn.be', 'garage@vhb.be', 'planning@delijn.be']);
      expect(res.json.onderwerp).toBe('Omleiding lijnen 58 en 82: Werken Markt (01/10/2026 t/m 10/10/2026)');
      expect(res.json.html).toContain('Beste, hierbij de omleiding.');
      expect(res.json.html).toContain('Haltes Markt en Station vervallen.');
      expect(res.json.html).toContain('Zottegem');
      expect(res.json.html).toContain('In bijlage');
      expect(res.json.html).not.toContain('Verstuurd door');
      expect(res.json.bijlagen.map((b: any) => b.filename)).toEqual(['plan.pdf', 'haltes.pdf']);
      expect(mem.emailsSent).toHaveLength(0);
    });

    it('versturen: één mail per ontvanger met alleen de PDF\'s die echt hangen als bijlage, één logregel en een logboekregel op de omleiding', async () => {
      const res = await api('POST', '/api/diversions/o-1/mail', { token: 'tok-admin', body: { ontvangers: { lijsten: ['l-1'] } } });
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({ droog: false, aantal: 2, gelukt: 2, mislukt: 0, bijlagen: 1 });
      expect(mem.emailsSent).toHaveLength(2);
      // slot 3 (haltes.pdf) hangt niet in de opslag → alleen plan.pdf gaat mee.
      expect(mem.emailsSent[0].attachments?.map((a) => a.filename)).toEqual(['plan.pdf']);
      expect(mem.emailsSent[0].context).toBe('omleiding-mail:o-1');
      expect(mem.mailLog.filter((r: any) => r.soort === 'omleiding-mail')).toHaveLength(1);
      expect(mem.activity.find((a: any) => a.action === 'Omleiding gemaild')).toMatchObject({ entityType: 'diversion', entityId: 'o-1' });
      expect(mem.activity.find((a: any) => a.action === 'Omleiding gemaild')?.message).toContain('naar 2 ontvangers met 1 PDF');
    });

    it('de mail noemt alleen de bijlagen die echt meegaan, en het antwoord zegt welke ontbrak (nr. 11)', async () => {
      const res = await api('POST', '/api/diversions/o-1/mail', { token: 'tok-admin', body: { ontvangers: { lijsten: ['l-1'] } } });
      expect(res.status).toBe(200);
      // slot 3 (haltes.pdf) hangt niet in de opslag.
      expect(res.json).toMatchObject({ bijlagen: 1, ontbrekendeBijlagen: ['haltes.pdf'] });
      for (const mail of mem.emailsSent) {
        expect(mail.attachments?.map((a) => a.filename)).toEqual(['plan.pdf']);
        expect(mail.text).toContain('In bijlage\n- plan.pdf');
        expect(mail.text).not.toContain('haltes.pdf');
      }
      expect(mem.activity.find((a: any) => a.action === 'Omleiding gemaild')?.message).toContain('met 1 PDF (niet meegegaan, bestand niet gevonden: haltes.pdf)');
      // Hangt geen enkele bijlage meer, dan noemt de mail er ook geen.
      mem.opslag.clear();
      mem.emailsSent = [];
      const zonder = await api('POST', '/api/diversions/o-1/mail', { token: 'tok-admin', body: { ontvangers: { lijsten: ['l-1'] } } });
      expect(zonder.json).toMatchObject({ bijlagen: 0, ontbrekendeBijlagen: ['plan.pdf', 'haltes.pdf'] });
      expect(mem.emailsSent[0].text).not.toContain('In bijlage');
      // Alles aanwezig: niets te melden.
      mem.opslag.add('diversions/o-1-1.pdf');
      mem.opslag.add('diversions/o-1-3.pdf');
      const volledig = await api('POST', '/api/diversions/o-1/mail', { token: 'tok-admin', body: { ontvangers: { lijsten: ['l-1'] } } });
      expect(volledig.json).toMatchObject({ bijlagen: 2, ontbrekendeBijlagen: [] });
    });

    it('gaat door dezelfde verzendfunctie: regel vooraf, en `alleen` stuurt alleen naar het restant (nr. 5 en 34)', async () => {
      mem.mailLogVerloop = [];
      const res = await api('POST', '/api/diversions/o-1/mail', { token: 'tok-planner', body: { ontvangers: { lijsten: ['l-1'], adressen: ['garage@vhb.be'] }, alleen: ['planning@delijn.be'] } });
      expect(res.status).toBe(200);
      expect(res.json).toMatchObject({ droog: false, aantal: 1, gelukt: 1, mislukt: 0, nietGeprobeerd: 0, onzeker: 0, resterend: [], bijlagen: 1 });
      expect(mem.emailsSent.map((m) => m.to)).toEqual([['planning@delijn.be']]);
      expect(mem.mailLogVerloop).toEqual(['start:omleiding-mail', 'mail:planning@delijn.be', 'klaar:omleiding-mail']);
      expect(mem.mailLog.filter((r: any) => r.soort === 'omleiding-mail')).toHaveLength(1);
    });

    it('een PDF van vóór 25-09 (<id>.pdf) gaat mee als omleiding.pdf; zonder einddatum zegt de mail "tot nader bericht"', async () => {
      const res = await api('POST', '/api/diversions/o-2/mail', { token: 'tok-planner', body: { ontvangers: { adressen: ['x@y.be'] } } });
      expect(res.status).toBe(200);
      expect(res.json.bijlagen).toBe(1);
      expect(mem.emailsSent[0].attachments?.[0]?.filename).toBe('omleiding.pdf');
      expect(mem.emailsSent[0].text).toContain('tot nader bericht');
    });

    it('weigert chauffeurs, een onbekende omleiding, een onbekende lijst, geen ontvangers en een fout adres', async () => {
      expect((await api('POST', '/api/diversions/o-1/mail', { token: 'tok-a', body: { ontvangers: { adressen: ['x@y.be'] } } })).status).toBe(403);
      expect((await api('POST', '/api/diversions/bestaat-niet/mail', { token: 'tok-planner', body: { ontvangers: { adressen: ['x@y.be'] } } })).status).toBe(404);
      expect((await api('POST', '/api/diversions/o-1/mail', { token: 'tok-planner', body: { ontvangers: { lijsten: ['weg'] } } })).status).toBe(400);
      expect((await api('POST', '/api/diversions/o-1/mail', { token: 'tok-planner', body: { ontvangers: {} } })).status).toBe(400);
      expect((await api('POST', '/api/diversions/o-1/mail', { token: 'tok-planner', body: { ontvangers: { adressen: ['nope'] } } })).status).toBe(400);
      expect(mem.emailsSent).toHaveLength(0);
    });

    it('GET /api/mails/verzendlijsten is voor planner en admin, niet voor chauffeurs', async () => {
      expect((await api('GET', '/api/mails/verzendlijsten', { token: 'tok-planner' })).json).toHaveLength(1);
      expect((await api('GET', '/api/mails/verzendlijsten', { token: 'tok-a' })).status).toBe(403);
    });
  });

  it('GET voorbeeld geeft onderwerp en HTML op de vaste lay-out; onbekende soort 404', async () => {
    const res = await api('GET', '/api/mails/voorbeeld/verlof-beslissing', { token: 'tok-admin' });
    expect(res.status).toBe(200);
    expect(res.json.onderwerp).toContain('Verlofaanvraag');
    expect(res.json.html).toContain('/mail/vhb-logo.png');
    // Het redenblok van de afwijzing (kop in hoofdletters via CSS).
    expect(res.json.html).toMatch(/text-transform: uppercase;[^"]*">Reden<\/p>/);
    expect((await api('GET', '/api/mails/voorbeeld/bestaat-niet', { token: 'tok-admin' })).status).toBe(404);
    expect((await api('GET', '/api/mails/voorbeeld/welkom', { token: 'tok-planner' })).status).toBe(403);
  });
});
