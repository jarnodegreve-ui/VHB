// @vitest-environment node
import {
  api,
  mem,
} from './harnas';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('verlof: scoped diff-autorisatie (regressie hotfix #66)', () => {
  it('accepteert een gescopede payload zonder verlof van collega\'s te verwijderen', async () => {
    // Chauffeur A stuurt exact wat de gescopede GET teruggaf — vroeger gaf
    // dit 403 ("intrekking van andermans verlof") of erger: verwijdering.
    const own = mem.leave.filter((l) => l.userId === '3');
    const res = await api('POST', '/api/leave', { token: 'tok-a', body: own });
    expect(res.status).toBe(200);
    expect(mem.leave.find((l) => l.id === 'l-b1')).toBeTruthy();
  });

  it('laat een chauffeur een eigen pending-aanvraag toevoegen', async () => {
    const own = mem.leave.filter((l) => l.userId === '3');
    const nieuw = { id: 'l-a3', userId: '3', startDate: '2027-09-01', endDate: '2027-09-02', type: 'betaald_verlof', status: 'pending', comment: '', createdAt: '2026-06-12T08:00:00Z' };
    const res = await api('POST', '/api/leave', { token: 'tok-a', body: [...own, nieuw] });
    expect(res.status).toBe(200);
    expect(mem.leave.find((l) => l.id === 'l-a3')).toBeTruthy();
  });

  it('meldt een nieuwe aanvraag alleen aan actieve planners/admins, niet aan een gepauzeerd staf-account (controle-ronde 27-08)', async () => {
    mem.users = [...mem.users, { id: '9', name: 'Paula Gepauzeerd', email: 'paula@vhb.be', role: 'planner', isActive: false }];
    const own = mem.leave.filter((l) => l.userId === '3');
    const nieuw = { id: 'l-a4', userId: '3', startDate: '2027-09-08', endDate: '2027-09-09', type: 'betaald_verlof', status: 'pending', comment: '', createdAt: '2026-08-28T08:00:00Z' };
    const res = await api('POST', '/api/leave', { token: 'tok-a', body: [...own, nieuw] });
    expect(res.status).toBe(200);
    const naarStaf = mem.pushesSent.filter((p) => p.userIds.includes('2'));
    expect(naarStaf.length).toBeGreaterThan(0); // de actieve planner krijgt het seintje…
    expect(mem.pushesSent.some((p) => p.userIds.includes('9'))).toBe(false); // …het gepauzeerde account niet
  });

  it('weigert een nieuwe aanvraag met een id dat een scheidingsteken bevat (400, audit 07-09, #9)', async () => {
    const own = mem.leave.filter((l) => l.userId === '3');
    const gevormd = { id: 'l-echt|approved', userId: '3', startDate: '2026-09-01', endDate: '2026-09-01', type: 'betaald_verlof', status: 'pending', createdAt: '2026-06-12T08:00:00Z' };
    const res = await api('POST', '/api/leave', { token: 'tok-a', body: [...own, gevormd] });
    expect(res.status).toBe(400);
    expect(mem.leave.find((l) => l.id === 'l-echt|approved')).toBeFalsy();
  });

  describe('verlof in het verleden (Jarno 23-09: ook op de server)', () => {
    const gisteren = () => { const d = new Date(Date.now() - 864e5); return d.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' }); };
    const vandaag = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });

    it('een chauffeur kan geen eigen verlof in het verleden aanvragen (400, niets bewaard)', async () => {
      const own = mem.leave.filter((l) => l.userId === '3');
      const nieuw = { id: 'l-verleden', userId: '3', startDate: gisteren(), endDate: vandaag(), type: 'betaald_verlof', status: 'pending', comment: '', createdAt: new Date().toISOString() };
      const res = await api('POST', '/api/leave', { token: 'tok-a', body: [...own, nieuw] });
      expect(res.status).toBe(400);
      expect(res.json.error).toBe('Je kan geen verlof aanvragen in het verleden.');
      expect(mem.leave.find((l) => l.id === 'l-verleden')).toBeFalsy();
    });

    it('vandaag mag wel', async () => {
      const own = mem.leave.filter((l) => l.userId === '3');
      const nieuw = { id: 'l-vandaag', userId: '3', startDate: vandaag(), endDate: vandaag(), type: 'betaald_verlof', status: 'pending', comment: '', createdAt: new Date().toISOString() };
      const res = await api('POST', '/api/leave', { token: 'tok-a', body: [...own, nieuw] });
      expect(res.status).toBe(200);
    });

    it('ook een admin of planner kan geen eigen verlof in het verleden aanvragen (geen uitzondering)', async () => {
      for (const [token, id] of [['tok-admin', '1'], ['tok-planner', '2']] as const) {
        const nieuw = { id: `l-eigen-${id}`, userId: id, startDate: gisteren(), endDate: gisteren(), type: 'betaald_verlof', status: 'pending', comment: '', createdAt: new Date().toISOString() };
        const res = await api('POST', '/api/leave', { token, body: [...mem.leave, nieuw] });
        expect(res.status).toBe(400);
        expect(mem.leave.find((l) => l.id === `l-eigen-${id}`)).toBeFalsy();
      }
    });

    it('de bestaande registratie door staf namens een chauffeur blijft kunnen (hij belde het door)', async () => {
      const nieuw = { id: 'l-registratie', userId: '3', startDate: gisteren(), endDate: gisteren(), type: 'betaald_verlof', status: 'approved', comment: '', createdAt: new Date().toISOString(), decidedAt: new Date().toISOString() };
      const res = await api('POST', '/api/leave', { token: 'tok-planner', body: [...mem.leave, nieuw] });
      expect(res.status).toBe(200);
      expect(mem.leave.find((l) => l.id === 'l-registratie')).toBeTruthy();
      // Actor en chauffeur blijven onderscheiden in het activiteitenlog.
      const log = mem.activity.find((a: any) => a.entityId === 'l-registratie');
      expect(log?.action).toBe('Verlof geregistreerd');
      expect(log?.actorName).toBe('Pieter Planner');
      expect(log?.message).toMatch(/vastgelegd door Pieter Planner/);
      expect(log?.message).not.toMatch(/^Pieter Planner/);
    });

    it('een chauffeur kan die registratie niet nabootsen met een handmatige request (403, niets bewaard)', async () => {
      const own = mem.leave.filter((l) => l.userId === '3');
      // Voor een collega, meteen goedgekeurd, in het verleden: zoals een registratie door staf.
      const nagebootst = { id: 'l-nagebootst', userId: '4', startDate: gisteren(), endDate: gisteren(), type: 'betaald_verlof', status: 'approved', comment: '', createdAt: new Date().toISOString(), decidedAt: new Date().toISOString() };
      const res = await api('POST', '/api/leave', { token: 'tok-a', body: [...own, nagebootst] });
      expect(res.status).toBe(403);
      expect(mem.leave.find((l) => l.id === 'l-nagebootst')).toBeFalsy();
      // Ook voor zichzelf goedgekeurd in het verleden: geweigerd.
      const zelf = { ...nagebootst, id: 'l-nagebootst-zelf', userId: '3' };
      const res2 = await api('POST', '/api/leave', { token: 'tok-a', body: [...own, zelf] });
      expect(res2.status).toBe(403);
      expect(mem.leave.find((l) => l.id === 'l-nagebootst-zelf')).toBeFalsy();
    });
  });

  it('weigert verlof aanvragen voor een ander (403)', async () => {
    const own = mem.leave.filter((l) => l.userId === '3');
    const voorAnder = { id: 'l-x', userId: '4', startDate: '2026-09-01', endDate: '2026-09-01', type: 'betaald_verlof', status: 'pending', createdAt: '2026-06-12T08:00:00Z' };
    const res = await api('POST', '/api/leave', { token: 'tok-a', body: [...own, voorAnder] });
    expect(res.status).toBe(403);
    expect(mem.leave.find((l) => l.id === 'l-x')).toBeFalsy();
  });

  it('weigert een nieuwe aanvraag die niet als pending start (403)', async () => {
    const own = mem.leave.filter((l) => l.userId === '3');
    const zelfGoedgekeurd = { id: 'l-x', userId: '3', startDate: '2026-09-01', endDate: '2026-09-01', type: 'betaald_verlof', status: 'approved', createdAt: '2026-06-12T08:00:00Z' };
    const res = await api('POST', '/api/leave', { token: 'tok-a', body: [...own, zelfGoedgekeurd] });
    expect(res.status).toBe(403);
  });

  it('laat intrekken van eigen pending toe; een weggelaten eigen approved wordt genegeerd (blijft staan)', async () => {
    const zonderPending = mem.leave.filter((l) => l.userId === '3' && l.id !== 'l-a1');
    const ok = await api('POST', '/api/leave', { token: 'tok-a', body: zonderPending });
    expect(ok.status).toBe(200);
    expect(mem.leave.find((l) => l.id === 'l-a1')).toBeFalsy();

    // Eigen approved weglaten is géén intrekking (stale sessie): genegeerd,
    // niet verwijderd — en geen storende 403 op de rest van de save.
    const zonderApproved = mem.leave.filter((l) => l.userId === '3' && l.id !== 'l-a2');
    const res = await api('POST', '/api/leave', { token: 'tok-a', body: zonderApproved });
    expect(res.status).toBe(200);
    expect(mem.leave.find((l) => l.id === 'l-a2')).toBeTruthy();
  });

  it('negeert een inhoudelijke wijziging van een bestaande aanvraag door een chauffeur (blijft ongewijzigd, geen clobber)', async () => {
    const own = mem.leave.filter((l) => l.userId === '3').map((l) =>
      l.id === 'l-a1' ? { ...l, endDate: '2026-07-10' } : l,
    );
    const res = await api('POST', '/api/leave', { token: 'tok-a', body: own });
    expect(res.status).toBe(200);
    // Echo van een bestaand record wordt niet weggeschreven → origineel behouden.
    expect(mem.leave.find((l) => l.id === 'l-a1')?.endDate).toBe('2026-07-03');
  });

  it('laat de planner een aanvraag goedkeuren en verwijderingen doorvoeren', async () => {
    const payload = mem.leave
      .filter((l) => l.id !== 'l-b1') // bewuste verwijdering door planner
      .map((l) => (l.id === 'l-a1' ? { ...l, status: 'approved', decidedAt: '2026-06-12T09:00:00Z' } : l));
    const res = await api('POST', '/api/leave', { token: 'tok-planner', body: payload });
    expect(res.status).toBe(200);
    expect(mem.leave.find((l) => l.id === 'l-a1')?.status).toBe('approved');
    expect(mem.leave.find((l) => l.id === 'l-b1')).toBeFalsy();
  });
});

// Beveiligingsscan 01-10 + regel Jarno 02-10. De einddatum werd alleen op het
// patroon getoetst: 9999-12-31 en 9999-99-99 werden bewaard, en elk rapport of
// paneel dat de dagen van zo'n periode telt liep daarna duizenden jaren af.
// De klok van deze tests staat op 15/06/2026, de grens dus op 31/12/2027.
describe('verlof: invoergrenzen (einde uiterlijk 31/12 van volgend jaar, echte kalenderdagen, hoogstens vijf nieuwe)', () => {
  const GRENS_2027 = 'Verlof aanvragen kan tot en met 31/12/2027.';
  const eigen = () => mem.leave.filter((l: any) => l.userId === '3');
  const aanvraag = (over: Record<string, unknown> = {}) => ({ id: 'l-nieuw', userId: '3', startDate: '2027-12-20', endDate: '2027-12-31', type: 'betaald_verlof', status: 'pending', comment: '', createdAt: '2026-06-15T08:00:00Z', ...over });
  const registratie = (over: Record<string, unknown> = {}) => aanvraag({ status: 'approved', decidedAt: '2026-06-15T08:00:00Z', ...over });

  describe('de uiterste einddatum', () => {
    it('een chauffeur kan tot en met 31 december van volgend jaar aanvragen', async () => {
      const res = await api('POST', '/api/leave', { token: 'tok-a', body: [...eigen(), aanvraag()] });
      expect(res.status).toBe(200);
      expect(mem.leave.find((l: any) => l.id === 'l-nieuw')).toMatchObject({ endDate: '2027-12-31', status: 'pending' });
    });

    it.each(['2028-01-01', '2030-07-15', '9999-12-31'])('een einde op %s wordt geweigerd met de tekst van het formulier, er wordt niets bewaard of gemeld', async (endDate) => {
      const res = await api('POST', '/api/leave', { token: 'tok-a', body: [...eigen(), aanvraag({ endDate })] });
      expect(res.status).toBe(400);
      expect(res.json).toEqual({ error: GRENS_2027 });
      expect(mem.leave.find((l: any) => l.id === 'l-nieuw')).toBeFalsy();
      expect(mem.pushesSent).toEqual([]);
      expect(mem.activity).toEqual([]);
    });

    it('geldt voor iedereen: ook een planner of admin die verlof voor een chauffeur vastlegt, of voor zichzelf aanvraagt', async () => {
      for (const token of ['tok-planner', 'tok-admin']) {
        const namens = await api('POST', '/api/leave', { token, body: [...mem.leave, registratie({ endDate: '2028-01-01' })] });
        expect(namens.status, token).toBe(400);
        expect(namens.json.error, token).toBe(GRENS_2027);
      }
      const zelf = await api('POST', '/api/leave', { token: 'tok-admin', body: [...mem.leave, aanvraag({ userId: '1', endDate: '2028-01-01' })] });
      expect(zelf.status).toBe(400);
      expect(mem.leave.find((l: any) => l.id === 'l-nieuw')).toBeFalsy();
      // Binnen de grens blijft de registratie werken.
      const goed = await api('POST', '/api/leave', { token: 'tok-planner', body: [...mem.leave, registratie()] });
      expect(goed.status).toBe(200);
      expect(mem.leave.find((l: any) => l.id === 'l-nieuw')).toMatchObject({ status: 'approved', endDate: '2027-12-31' });
    });

    it('het lopende jaar is het Brusselse: op 31/12 om 23:30 nog 2026, een uur later 2027', async () => {
      // 22:30 UTC = 23:30 in Brussel, nog 2026: de grens is 31/12/2027.
      vi.setSystemTime(new Date('2026-12-31T22:30:00Z'));
      const voor = await api('POST', '/api/leave', { token: 'tok-a', body: [...eigen(), aanvraag({ startDate: '2027-12-20', endDate: '2028-01-01' })] });
      expect(voor.status).toBe(400);
      expect(voor.json.error).toBe(GRENS_2027);
      // 23:30 UTC = 00:30 in Brussel op 01/01/2027, terwijl UTC nog 2026 zegt: de grens is 31/12/2028.
      vi.setSystemTime(new Date('2026-12-31T23:30:00Z'));
      const na = await api('POST', '/api/leave', { token: 'tok-a', body: [...eigen(), aanvraag({ startDate: '2028-12-20', endDate: '2028-12-31' })] });
      expect(na.status).toBe(200);
      const teLaat = await api('POST', '/api/leave', { token: 'tok-a', body: [...mem.leave.filter((l: any) => l.userId === '3'), aanvraag({ id: 'l-nieuw-2', startDate: '2028-12-20', endDate: '2029-01-01' })] });
      expect(teLaat.status).toBe(400);
      expect(teLaat.json.error).toBe('Verlof aanvragen kan tot en met 31/12/2028.');
    });
  });

  describe('echte kalenderdagen', () => {
    it.each([
      ['endDate', '9999-99-99'],
      ['endDate', '2027-02-30'],
      ['endDate', '2027-13-01'],
      ['startDate', '2027-02-29'],
      ['startDate', '2027-00-10'],
    ])('%s = %s past in het patroon maar bestaat niet: geweigerd', async (veld, datum) => {
      const body = [...eigen(), aanvraag({ startDate: '2027-02-01', endDate: '2027-03-15', [veld]: datum })];
      const res = await api('POST', '/api/leave', { token: 'tok-a', body });
      expect(res.status).toBe(400);
      expect(res.json.error).toBe('Ongeldige datum in de aanvraag.');
      expect(mem.leave.find((l: any) => l.id === 'l-nieuw')).toBeFalsy();
      const staf = await api('POST', '/api/leave', { token: 'tok-planner', body: [...mem.leave, registratie({ startDate: '2027-02-01', endDate: '2027-03-15', [veld]: datum })] });
      expect(staf.status).toBe(400);
    });

    it('29 februari in een schrikkeljaar bestaat wel', async () => {
      vi.setSystemTime(new Date('2027-06-15T10:00:00Z'));
      const res = await api('POST', '/api/leave', { token: 'tok-a', body: [...eigen(), aanvraag({ startDate: '2028-02-29', endDate: '2028-02-29' })] });
      expect(res.status).toBe(200);
    });
  });

  describe('bestaande records waarvan de datums niet wijzigen blijven passeren', () => {
    beforeEach(() => {
      mem.leave = [
        ...mem.leave,
        // Wat er vóór deze grens al in kon staan.
        { id: 'l-eeuwig', userId: '4', startDate: '2026-09-01', endDate: '9999-12-31', type: 'ziekte', status: 'approved', comment: '', createdAt: '2026-05-01T08:00:00Z', decidedAt: '2026-05-01T08:00:00Z' },
        { id: 'l-onbestaand', userId: '4', startDate: '2026-02-30', endDate: '9999-99-99', type: 'betaald_verlof', status: 'pending', comment: '', createdAt: '2026-05-01T08:00:00Z' },
      ];
    });

    it('een save van de planner die iets anders beslist gaat door', async () => {
      const payload = mem.leave.map((l: any) => (l.id === 'l-a1' ? { ...l, status: 'approved', decidedAt: '2026-06-15T09:00:00Z' } : l));
      const res = await api('POST', '/api/leave', { token: 'tok-planner', body: payload });
      expect(res.status).toBe(200);
      expect(mem.leave.find((l: any) => l.id === 'l-a1')?.status).toBe('approved');
      expect(mem.leave.find((l: any) => l.id === 'l-eeuwig')?.endDate).toBe('9999-12-31');
    });

    it('zo\'n record zelf afwijzen, annuleren of van type wijzigen kan (zo ruim je het op)', async () => {
      const afwijzen = mem.leave.map((l: any) => (l.id === 'l-onbestaand' ? { ...l, status: 'rejected', decidedAt: '2026-06-15T09:00:00Z' } : l));
      expect((await api('POST', '/api/leave', { token: 'tok-planner', body: afwijzen })).status).toBe(200);
      const annuleren = mem.leave.map((l: any) => (l.id === 'l-eeuwig' ? { ...l, status: 'cancelled' } : l));
      expect((await api('POST', '/api/leave', { token: 'tok-planner', body: annuleren })).status).toBe(200);
      expect(mem.leave.find((l: any) => l.id === 'l-eeuwig')?.status).toBe('cancelled');
      const anderType = mem.leave.map((l: any) => (l.id === 'l-eeuwig' ? { ...l, type: 'betaald_verlof' } : l));
      expect((await api('POST', '/api/leave', { token: 'tok-planner', body: anderType })).status).toBe(200);
    });

    it('het einde inkorten tot binnen de grens kan, verzetten naar een andere te late dag niet', async () => {
      const teLaat = mem.leave.map((l: any) => (l.id === 'l-eeuwig' ? { ...l, endDate: '2099-12-31' } : l));
      const fout = await api('POST', '/api/leave', { token: 'tok-planner', body: teLaat });
      expect(fout.status).toBe(400);
      expect(fout.json.error).toBe(GRENS_2027);
      expect(mem.leave.find((l: any) => l.id === 'l-eeuwig')?.endDate).toBe('9999-12-31');
      const ingekort = mem.leave.map((l: any) => (l.id === 'l-eeuwig' ? { ...l, endDate: '2026-09-30' } : l));
      expect((await api('POST', '/api/leave', { token: 'tok-planner', body: ingekort })).status).toBe(200);
      expect(mem.leave.find((l: any) => l.id === 'l-eeuwig')?.endDate).toBe('2026-09-30');
    });

    it('alleen de start verzetten van een record met een te laat einde toetst de start, niet het oude einde', async () => {
      const start = mem.leave.map((l: any) => (l.id === 'l-eeuwig' ? { ...l, startDate: '2026-09-02' } : l));
      expect((await api('POST', '/api/leave', { token: 'tok-planner', body: start })).status).toBe(200);
      const kapot = mem.leave.map((l: any) => (l.id === 'l-eeuwig' ? { ...l, startDate: '2026-09-31' } : l));
      expect((await api('POST', '/api/leave', { token: 'tok-planner', body: kapot })).status).toBe(400);
    });
  });

  describe('hoogstens vijf nieuwe aanvragen per verzoek voor wie geen staf is', () => {
    const reeks = (aantal: number) => Array.from({ length: aantal }, (_, i) => aanvraag({ id: `l-reeks-${i}`, startDate: `2027-0${i + 1}-10`, endDate: `2027-0${i + 1}-11` }));

    it('vijf tegelijk gaat door (het formulier stuurt er één)', async () => {
      const res = await api('POST', '/api/leave', { token: 'tok-a', body: [...eigen(), ...reeks(5)] });
      expect(res.status).toBe(200);
      expect(mem.leave.filter((l: any) => String(l.id).startsWith('l-reeks-'))).toHaveLength(5);
    });

    it('zes tegelijk wordt geweigerd: niets bewaard, geen enkele melding naar de planners', async () => {
      const res = await api('POST', '/api/leave', { token: 'tok-a', body: [...eigen(), ...reeks(6)] });
      expect(res.status).toBe(400);
      expect(res.json.error).toBe('Je kan hoogstens 5 verlofaanvragen tegelijk indienen.');
      expect(mem.leave.filter((l: any) => String(l.id).startsWith('l-reeks-'))).toHaveLength(0);
      expect(mem.pushesSent).toEqual([]);
      // De echo van de eigen bestaande records telt niet mee.
      const metEcho = await api('POST', '/api/leave', { token: 'tok-a', body: [...eigen(), ...eigen(), ...reeks(5)] });
      expect(metEcho.status).toBe(200);
    });

    it('een planner die de papieren lijst overzet is niet begrensd', async () => {
      const res = await api('POST', '/api/leave', { token: 'tok-planner', body: [...mem.leave, ...reeks(8).map((r) => ({ ...r, status: 'approved', decidedAt: '2026-06-15T08:00:00Z' }))] });
      expect(res.status).toBe(200);
      expect(mem.leave.filter((l: any) => String(l.id).startsWith('l-reeks-'))).toHaveLength(8);
    });
  });

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty', 'onbekend', ''])('een verloftype "%s" is geen bekend type, ook niet als elk object die naam kent', async (type) => {
    const res = await api('POST', '/api/leave', { token: 'tok-a', body: [...eigen(), aanvraag({ type })] });
    expect(res.status).toBe(400);
    expect(res.json.error).toBe('Ongeldig verloftype.');
    expect(mem.leave.find((l: any) => l.id === 'l-nieuw')).toBeFalsy();
  });

  describe('de ziekmelding volgt dezelfde uiterste einddatum', () => {
    it('een einde na 31/12 van volgend jaar wordt geweigerd, ook als de periode zelf korter dan een jaar is', async () => {
      const res = await api('POST', '/api/leave/sick-report', { token: 'tok-planner', body: { userId: '4', startDate: '2027-12-30', endDate: '2028-01-02' } });
      expect(res.status).toBe(400);
      expect(res.json.error).toBe('Een ziekmelding kan tot en met 31/12/2027 lopen.');
      const ver = await api('POST', '/api/leave/sick-report', { token: 'tok-planner', body: { userId: '4', startDate: '9999-01-01', endDate: '9999-01-05' } });
      expect(ver.status).toBe(400);
      expect(mem.leave.some((l: any) => l.type === 'ziekte')).toBe(false);
    });

    it('tot en met die dag blijft een lange ziekte kunnen', async () => {
      const res = await api('POST', '/api/leave/sick-report', { token: 'tok-planner', body: { userId: '4', startDate: '2027-01-10', endDate: '2027-12-31' } });
      expect(res.status).toBe(200);
      expect(res.json.leave).toMatchObject({ type: 'ziekte', endDate: '2027-12-31' });
    });
  });
});

describe('ziekte werkt door in maandplanning en dekking', () => {
  // De Excel-import is een momentopname: wie dáárna ziek gemeld wordt, stond
  // in het maandrooster nog op zijn dienst en zijn dienst telde in de dekking
  // als ingevuld — terwijl de ziekmeldings-mail het omgekeerde beloofde.
  beforeEach(() => {
    mem.planningCodes = [
      { id: 'pc-ziek', code: 'ziek', description: 'Ziek', category: 'absence' },
      { id: 'pc-bv', code: 'bv', description: 'Betaald Verlof', category: 'leave' },
    ];
    mem.planningMatrix = [
      { id: 'm-1', source_date: '2026-07-15', day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': '11' }, raw_row: '' },
      { id: 'm-2', source_date: '2026-07-16', day_type: 'week', assignments: { 'Chauffeur A': '12' }, raw_row: '' },
    ];
    mem.leave = [
      { id: 'l-ziek', userId: '3', startDate: '2026-07-15', endDate: '2026-07-15', type: 'ziekte', status: 'approved', comment: '', createdAt: '2026-07-15T06:00:00Z', decidedAt: '2026-07-15T06:00:00Z' },
    ];
  });

  it('een ziekmelding overschrijft de dienst in het maandrooster, alleen op de ziektedagen', async () => {
    const res = await api('GET', '/api/month-planning?month=2026-07', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    // 15/07: ziek — de matrix-code 12 is overschreven met de ziekte-code.
    expect(res.json.cells['3']['2026-07-15']).toMatchObject({ code: 'ziek', kind: 'absence', label: 'Ziek' });
    // 16/07 (buiten de ziekteperiode): de dienst staat er nog gewoon.
    expect(res.json.cells['3']['2026-07-16']).toMatchObject({ kind: 'service' });
    // De collega is onaangeroerd.
    expect(res.json.cells['4']['2026-07-15']).toMatchObject({ kind: 'service' });
  });

  it('de overdekte dienst blijft meegestuurd, zodat een admin hem kan overzetten', async () => {
    // Ziek melden haalt de dienst niet uit de planning: de zieke chauffeur
    // stáát er nog op. Zonder hiddenService was juist het hoofdscenario
    // (ziekte) onbereikbaar in de maandplanning — de cel toont "ziek" en de
    // wissel-actie hangt aan een dienst.
    const res = await api('GET', '/api/month-planning?month=2026-07', { token: 'tok-planner' });
    expect(res.json.cells['3']['2026-07-15']).toMatchObject({ code: 'ziek', hiddenService: '12' });
    // Een afwezigheidsdag zónder dienst eronder krijgt het veld niet.
    mem.leave.push({ id: 'l-bv2', userId: '4', startDate: '2026-07-16', endDate: '2026-07-16', type: 'betaald_verlof', status: 'approved', comment: '', createdAt: '2026-07-10T06:00:00Z', decidedAt: '2026-07-11T06:00:00Z' });
    const res2 = await api('GET', '/api/month-planning?month=2026-07', { token: 'tok-planner' });
    expect(res2.json.cells['4']['2026-07-16'].hiddenService).toBeUndefined();
  });

  it('markeert gewisselde cellen met de swap-herkomst', async () => {
    // Een doorgevoerde wissel verplaatst de cel; de maandplanning moet erbij
    // zeggen dat die afwijkt van de Excel (merkteken + terugdraai-knop).
    mem.leave = [];
    mem.swaps = [{
      id: 's-merk', shiftId: 'sh-a', requesterId: '3', targetDriverId: '4', status: 'approved',
      reason: 'Handmatige wissel door Admin E2E, Ziekte', createdAt: '2026-07-14T08:00:00Z',
      decidedAt: '2026-07-14T09:00:00Z', shiftDate: '2026-07-15', shiftLine: '12', swapType: 'overname',
    }];
    const res = await api('GET', '/api/month-planning?month=2026-07', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    // De dienst staat nu bij chauffeur 4, mét herkomst.
    expect(res.json.cells['4']['2026-07-15']).toMatchObject({
      code: '12', swapId: 's-merk', swapManual: true, swapFrom: 'Chauffeur A',
    });
    // Een gewone ruil (geen handmatige wissel) is wél gemerkt maar niet 'manual'.
    mem.swaps = [{ ...mem.swaps[0], id: 's-ruil', reason: 'Ik heb een afspraak' }];
    const res2 = await api('GET', '/api/month-planning?month=2026-07', { token: 'tok-planner' });
    expect(res2.json.cells['4']['2026-07-15']).toMatchObject({ swapId: 's-ruil', swapManual: false });
  });

  it('ook een naderhand goedgekeurd verlof overschrijft de cel', async () => {
    mem.leave.push({ id: 'l-bv', userId: '4', startDate: '2026-07-15', endDate: '2026-07-16', type: 'betaald_verlof', status: 'approved', comment: '', createdAt: '2026-07-10T06:00:00Z', decidedAt: '2026-07-11T06:00:00Z' });
    const res = await api('GET', '/api/month-planning?month=2026-07', { token: 'tok-planner' });
    expect(res.json.cells['4']['2026-07-15']).toMatchObject({ code: 'bv', kind: 'leave' });
  });

  it('pending of afgewezen leave verandert niets aan het rooster', async () => {
    mem.leave = [
      { id: 'l-p', userId: '3', startDate: '2026-07-15', endDate: '2026-07-15', type: 'ziekte', status: 'pending', comment: '', createdAt: '2026-07-15T06:00:00Z' },
      { id: 'l-r', userId: '4', startDate: '2026-07-15', endDate: '2026-07-15', type: 'betaald_verlof', status: 'rejected', comment: '', createdAt: '2026-07-15T06:00:00Z', decidedAt: '2026-07-15T07:00:00Z' },
    ];
    const res = await api('GET', '/api/month-planning?month=2026-07', { token: 'tok-planner' });
    expect(res.json.cells['3']['2026-07-15']).toMatchObject({ kind: 'service' });
    expect(res.json.cells['4']['2026-07-15']).toMatchObject({ kind: 'service' });
  });

  it('de dienst van een zieke chauffeur telt als gat in de dekking (vandaag/toekomst)', async () => {
    // Toekomstige datums: de dekking past afwezigheid bewust alleen toe op
    // vandaag en later — een gereden dag is geen gat meer (zie test hieronder).
    mem.planningMatrix = [
      { id: 'm-t1', source_date: '2030-07-15', day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': '11' }, raw_row: '' },
      { id: 'm-t2', source_date: '2030-07-16', day_type: 'week', assignments: { 'Chauffeur A': '12' }, raw_row: '' },
    ];
    mem.leave = [
      { id: 'l-t', userId: '3', startDate: '2030-07-15', endDate: '2030-07-15', type: 'ziekte', status: 'approved', comment: '', createdAt: '2030-07-15T06:00:00Z', decidedAt: '2030-07-15T06:00:00Z' },
    ];
    mem.coverageExpectations = { week: ['12', '11'] };
    const res = await api('GET', '/api/coverage-gaps?from=2030-07-15&to=2030-07-16', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    // 15/07: Chauffeur A (dienst 12) is ziek → 12 valt open; 11 blijft gedekt.
    const dag15 = res.json.days.find((d: any) => d.date === '2030-07-15');
    expect(dag15.missing).toEqual(['12']);
    expect(dag15.covered).toBe(1);
    // De tegel weet wie er uitviel en waarom.
    expect(dag15.uitval).toEqual({ '12': { name: 'Chauffeur A', reason: 'ziek' } });
    // 16/07: niemand ziek → geen gat voor 12 (11 staat die dag niet in de matrix).
    const dag16 = res.json.days.find((d: any) => d.date === '2030-07-16');
    expect(dag16.missing).toEqual(['11']);
    // 11 was nooit toegewezen → géén uitval-info (kale chip in de UI).
    expect(dag16.uitval).toBeUndefined();
    // De matrix is alleen voor het gevraagde venster gelezen, niet volledig.
    expect(mem.matrixMaandFilters).toEqual(['2030-07-15..2030-07-16']);
  });

  it('coverage-gaps: een dienst die een collega overnam van een zieke is geen gat meer, maar staat bij `opgevangen` (rapport Openstaande diensten)', async () => {
    mem.planningMatrix = [
      { id: 'm-o1', source_date: '2030-07-15', day_type: 'week', assignments: { 'Chauffeur A': '12' }, raw_row: '' },
    ];
    mem.leave = [
      { id: 'l-o', userId: '3', startDate: '2030-07-15', endDate: '2030-07-15', type: 'ziekte', status: 'approved', comment: '', createdAt: '2030-07-15T06:00:00Z', decidedAt: '2030-07-15T06:00:00Z' },
    ];
    mem.coverageExpectations = { week: ['12'] };
    // Nog niet herverdeeld: een gat, met wie uitviel.
    const voor = await api('GET', '/api/coverage-gaps?from=2030-07-15&to=2030-07-15', { token: 'tok-planner' });
    expect(voor.json.days[0]).toMatchObject({ missing: ['12'], uitval: { '12': { name: 'Chauffeur A', reason: 'ziek' } } });
    expect(voor.json.days[0].opgevangen).toBeUndefined();
    // De planning zet de dienst over naar Chauffeur B: gedekt, en het rapport weet door wie.
    mem.swaps = [{
      id: 's-o', shiftId: 'sh-o', requesterId: '3', targetDriverId: '4', status: 'approved', reason: 'Handmatige wissel door Planner, ziekte',
      createdAt: '2030-07-14T08:00:00Z', decidedAt: '2030-07-14T08:00:00Z', shiftDate: '2030-07-15', shiftLine: '12', swapType: 'overname',
    }];
    const na = await api('GET', '/api/coverage-gaps?from=2030-07-15&to=2030-07-15', { token: 'tok-planner' });
    expect(na.json.days[0]).toMatchObject({ missing: [], covered: 1, opgevangen: { '12': { name: 'Chauffeur A', reason: 'ziek', door: 'Chauffeur B' } } });
    expect(na.json.days[0].uitval).toBeUndefined();
    mem.swaps = [];
  });

  it('coverage-gaps: het venster in de query geeft hetzelfde als de volledige matrix (rijen buiten het venster tellen niet mee)', async () => {
    const buiten = [
      { id: 'm-voor', source_date: '2030-07-14', day_type: 'week', assignments: { 'Chauffeur B': '11' }, raw_row: '' },
      { id: 'm-na', source_date: '2030-07-17', day_type: 'week', assignments: { 'Chauffeur B': '11' }, raw_row: '' },
    ];
    mem.planningMatrix = [
      { id: 'm-t1', source_date: '2030-07-15', day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': '11' }, raw_row: '' },
      { id: 'm-t2', source_date: '2030-07-16', day_type: 'week', assignments: { 'Chauffeur A': '12' }, raw_row: '' },
    ];
    mem.coverageExpectations = { week: ['12', '11'] };
    const zonder = await api('GET', '/api/coverage-gaps?from=2030-07-15&to=2030-07-16', { token: 'tok-planner' });
    mem.planningMatrix = [...mem.planningMatrix, ...buiten];
    const met = await api('GET', '/api/coverage-gaps?from=2030-07-15&to=2030-07-16', { token: 'tok-planner' });
    expect(met.json).toEqual(zonder.json);
    expect(met.json.days.map((d: any) => d.date)).toEqual(['2030-07-15', '2030-07-16']);
  });

  it('weekdag-periode: vanaf de ingangsdatum geldt een ander regime (dienstregelingswissel)', async () => {
    // Basis-toewijzing = 'zomer' (dienst 41); vanaf 01-09 geldt 'school'
    // (dienst 21). Matrixrijen zonder eigen dagtype vallen terug op de
    // toewijzing — en die moet per datum de juiste periode pakken.
    mem.planningMatrix = [
      { id: 'm-p1', source_date: '2030-08-26', day_type: '', assignments: {}, raw_row: '' },
      { id: 'm-p2', source_date: '2030-09-02', day_type: '', assignments: {}, raw_row: '' },
    ];
    mem.leave = [];
    mem.coverageExpectations = {
      zomer: ['41'],
      school: ['21'],
      __weekdagen__: ['zomer', 'zomer', 'zomer', 'zomer', 'zomer', 'zomer', 'zomer'],
      '__weekdagen_2030-09-01__': ['school', 'school', 'school', 'school', 'school', 'school', 'school'],
    };
    const res = await api('GET', '/api/coverage-gaps?from=2030-08-26&to=2030-09-02', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    const aug = res.json.days.find((d: any) => d.date === '2030-08-26');
    const sep = res.json.days.find((d: any) => d.date === '2030-09-02');
    expect([aug.dayType, aug.missing]).toEqual(['zomer', ['41']]);
    expect([sep.dayType, sep.missing]).toEqual(['school', ['21']]);
  });

  it('weekdag-periodes overleven een GET/PUT-rondje van de instellingen', async () => {
    mem.coverageExpectations = {};
    const put = await api('PUT', '/api/coverage-expectations', {
      token: 'tok-planner',
      body: {
        dayTypes: [{ name: 'zomer', services: ['41'] }, { name: 'school', services: ['21'] }],
        weekdays: ['zomer', 'zomer', 'zomer', 'zomer', 'zomer', 'zomer', 'zomer'],
        weekdayPeriods: [
          { vanaf: '2030-09-01', weekdays: ['school', 'school', 'school', 'school', 'school', 'school', 'school'] },
          // Ongeldige ingangsdatum → genegeerd, mag de rest niet blokkeren.
          { vanaf: 'kapot', weekdays: ['school'] },
        ],
        overrides: [],
      },
    });
    expect(put.status).toBe(200);
    const get = await api('GET', '/api/coverage-expectations', { token: 'tok-planner' });
    expect(get.status).toBe(200);
    expect(get.json.weekdayPeriods).toEqual([
      { vanaf: '2030-09-01', weekdays: ['school', 'school', 'school', 'school', 'school', 'school', 'school'] },
    ]);
    // De periode-sleutel is reserved en lekt niet als dag-type de lijst in.
    expect(get.json.dayTypes.map((d: any) => d.name)).toEqual(['school', 'zomer']);
  });

  it('een herverdeelde dienst verdwijnt uit de dekking (melding Jarno 14-08)', async () => {
    // De matrix blijft de zieke chauffeur tonen — dat is een momentopname van
    // de Excel. Is de dienst intussen overgenomen, dan is hij gewoon gedekt;
    // zonder deze overlay bleef hij als gat staan mét de naam van de zieke,
    // ook nadat de admin hem had overgezet.
    mem.planningMatrix = [
      { id: 'm-w1', source_date: '2030-07-15', day_type: 'week', assignments: { 'Chauffeur A': '12', 'Chauffeur B': '11' }, raw_row: '' },
    ];
    mem.leave = [
      { id: 'l-w', userId: '3', startDate: '2030-07-15', endDate: '2030-07-15', type: 'ziekte', status: 'approved', comment: '', createdAt: '2030-07-15T06:00:00Z', decidedAt: '2030-07-15T06:00:00Z' },
    ];
    mem.coverageExpectations = { week: ['12', '11'] };

    // Vóór de wissel: dienst 12 is een gat.
    const voor = await api('GET', '/api/coverage-gaps?from=2030-07-15&to=2030-07-15', { token: 'tok-planner' });
    expect(voor.json.days[0].missing).toEqual(['12']);

    // Admin zet dienst 12 over naar chauffeur 4 (niet afwezig).
    mem.swaps = [{
      id: 's-dekking', shiftId: 'sh-x', requesterId: '3', targetDriverId: '4', status: 'approved',
      reason: 'Handmatige wissel door Admin E2E, Ziekte', createdAt: '2030-07-14T08:00:00Z',
      decidedAt: '2030-07-14T09:00:00Z', shiftDate: '2030-07-15', shiftLine: '12', swapType: 'overname',
    }];
    const na = await api('GET', '/api/coverage-gaps?from=2030-07-15&to=2030-07-15', { token: 'tok-planner' });
    expect(na.json.days[0].missing).toEqual([]);
    expect(na.json.days[0].covered).toBe(2);
    expect(na.json.days[0].uitval).toBeUndefined();
  });

  it('een dienst die is overgezet naar iemand die zélf afwezig is, blijft een gat', async () => {
    mem.planningMatrix = [
      { id: 'm-w2', source_date: '2030-07-15', day_type: 'week', assignments: { 'Chauffeur A': '12' }, raw_row: '' },
    ];
    // Beide chauffeurs afwezig: de oorspronkelijke én de overnemer.
    mem.leave = [
      { id: 'l-w1', userId: '3', startDate: '2030-07-15', endDate: '2030-07-15', type: 'ziekte', status: 'approved', comment: '', createdAt: '2030-07-15T06:00:00Z', decidedAt: '2030-07-15T06:00:00Z' },
      { id: 'l-w2', userId: '4', startDate: '2030-07-15', endDate: '2030-07-15', type: 'betaald_verlof', status: 'approved', comment: '', createdAt: '2030-07-10T06:00:00Z', decidedAt: '2030-07-11T06:00:00Z' },
    ];
    mem.coverageExpectations = { week: ['12'] };
    mem.swaps = [{
      id: 's-dekking2', shiftId: 'sh-x', requesterId: '3', targetDriverId: '4', status: 'approved',
      reason: '', createdAt: '2030-07-14T08:00:00Z', decidedAt: '2030-07-14T09:00:00Z',
      shiftDate: '2030-07-15', shiftLine: '12', swapType: 'overname',
    }];
    const res = await api('GET', '/api/coverage-gaps?from=2030-07-15&to=2030-07-15', { token: 'tok-planner' });
    expect(res.json.days[0].missing).toEqual(['12']);
    // …en de tegel noemt de nieuwe eigenaar, niet de oorspronkelijke zieke.
    expect(res.json.days[0].uitval['12']).toMatchObject({ name: 'Chauffeur B', reason: 'verlof' });
  });

  it('een gereden (historische) dag wordt niet met terugwerkende kracht een gat', async () => {
    // Deze test redeneert over de echte kalender (vandaag/gisteren), niet over de vaste juni-klok.
    vi.useRealTimers();
    // Een achteraf ingevoerd ziektebriefje voor 15 juli (verleden): die dag ís
    // gereden — door een invaller die nooit in de matrix is bijgewerkt. De
    // dekking blijft hem als gedekt tonen; alleen vandaag/toekomst filtert.
    mem.coverageExpectations = { week: ['12', '11'] };
    const res = await api('GET', '/api/coverage-gaps?from=2026-07-15&to=2026-07-15', { token: 'tok-planner' });
    const dag = res.json.days[0];
    expect(dag.missing).toEqual([]);
    expect(dag.covered).toBe(2);
    expect(dag.uitval).toBeUndefined();
  });

  it('de dekking matcht de zieke ook op omgekeerde naamvolgorde', async () => {
    // De matrix schrijft "A Chauffeur" (achternaam eerst) — zelfde
    // volgorde-onafhankelijke resolutie als /api/month-planning.
    mem.planningMatrix = [
      { id: 'm-3', source_date: '2030-07-15', day_type: 'week', assignments: { 'A Chauffeur': '12' }, raw_row: '' },
    ];
    mem.leave = [
      { id: 'l-t', userId: '3', startDate: '2030-07-15', endDate: '2030-07-15', type: 'ziekte', status: 'approved', comment: '', createdAt: '2030-07-15T06:00:00Z', decidedAt: '2030-07-15T06:00:00Z' },
    ];
    mem.coverageExpectations = { week: ['12'] };
    const res = await api('GET', '/api/coverage-gaps?from=2030-07-15&to=2030-07-15', { token: 'tok-planner' });
    expect(res.json.days[0].missing).toEqual(['12']);
  });

  it('ziekte wint van overlappend verlof in het maandrooster', async () => {
    mem.leave = [
      { id: 'l-bv', userId: '3', startDate: '2026-07-14', endDate: '2026-07-16', type: 'betaald_verlof', status: 'approved', comment: '', createdAt: '2026-07-01T06:00:00Z', decidedAt: '2026-07-02T06:00:00Z' },
      { id: 'l-zk', userId: '3', startDate: '2026-07-15', endDate: '2026-07-15', type: 'ziekte', status: 'approved', comment: '', createdAt: '2026-07-15T06:00:00Z', decidedAt: '2026-07-15T06:00:00Z' },
    ];
    const res = await api('GET', '/api/month-planning?month=2026-07', { token: 'tok-planner' });
    // Op de ziektedag wint ziek; de dag ervoor/erna blijft verlof.
    expect(res.json.cells['3']['2026-07-15']).toMatchObject({ code: 'ziek' });
    expect(res.json.cells['3']['2026-07-16']).toMatchObject({ code: 'bv' });
  });

  it('een leave-record met kapotte datums overschrijft niets', async () => {
    mem.leave = [
      { id: 'l-kapot', userId: '3', startDate: '', endDate: '2026-07-31', type: 'ziekte', status: 'approved', comment: '', createdAt: '2026-07-01T06:00:00Z' },
    ];
    const res = await api('GET', '/api/month-planning?month=2026-07', { token: 'tok-planner' });
    // Lege startdatum vergeleek vroeger als "altijd waar" en zette de hele
    // maand op ziek; nu wordt zo'n record genegeerd.
    expect(res.json.cells['3']['2026-07-15']).toMatchObject({ kind: 'service' });
  });
});

describe('planning-import, ziekte blokkeert niet, gepland verlof wel', () => {
  // Melding Jarno 15-08: een upload werd geblokkeerd door een "verlofconflict"
  // dat in werkelijkheid een ziekteperiode was. Ziekte is onvoorzien (de Excel
  // wordt vooraf gemaakt) en heeft een eigen herverdeel-flow — alleen gepland
  // verlof (betaald/klein verlet) hoort de import tegen te houden.
  const buildXlsxBase64 = async () => {
    const XLSX = await import('xlsx');
    const serial = (iso: string) => Math.round((Date.parse(`${iso}T00:00:00Z`) - Date.parse('1899-12-30T00:00:00Z')) / 86400000);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ['datum', 'dagtype', 'Chauffeur A', 'Chauffeur B', 'aantal'],
      [serial('2030-08-03'), 'W', '12', '14', 2],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, 'praktijk');
    return (XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer).toString('base64');
  };

  it('preview scheidt ziekte (informatief) van verlof (blokkerend)', async () => {
    mem.leave = [
      { id: 'l-z', userId: '3', startDate: '2030-08-01', endDate: '2030-08-10', type: 'ziekte', status: 'approved', comment: '', createdAt: '2030-07-30T06:00:00Z', decidedAt: '2030-07-30T06:00:00Z' },
    ];
    const res = await api('POST', '/api/planning-matrix/preview', { token: 'tok-planner', body: { xlsxBase64: await buildXlsxBase64() } });
    expect(res.status).toBe(200);
    // Chauffeur A is ziek op 03/08 en staat op dienst 12 → informatief…
    expect(res.json.ziekteDiensten).toHaveLength(1);
    expect(res.json.ziekteDiensten[0]).toMatchObject({ driverName: 'Chauffeur A', serviceNumber: '12' });
    // …maar géén blokkerend verlofconflict.
    expect(res.json.verlofConflicts).toHaveLength(0);
  });

  it('import gaat dóór bij ziekte, en blokkeert nog steeds op betaald verlof', async () => {
    mem.leave = [
      { id: 'l-z', userId: '3', startDate: '2030-08-01', endDate: '2030-08-10', type: 'ziekte', status: 'approved', comment: '', createdAt: '2030-07-30T06:00:00Z', decidedAt: '2030-07-30T06:00:00Z' },
    ];
    const base64 = await buildXlsxBase64();
    const ok = await api('POST', '/api/planning-matrix/import', { token: 'tok-planner', body: { xlsxBase64: base64 } });
    expect(ok.status).toBe(200);
    expect(ok.json.success).toBe(true);
    expect(ok.json.ziekteDiensten).toHaveLength(1);

    // Zelfde Excel, maar nu met goedgekeurd betaald verlof: wél blokkeren.
    mem.leave = [
      { id: 'l-bv', userId: '3', startDate: '2030-08-01', endDate: '2030-08-10', type: 'betaald_verlof', status: 'approved', comment: '', createdAt: '2030-07-01T06:00:00Z', decidedAt: '2030-07-02T06:00:00Z' },
    ];
    const geblokkeerd = await api('POST', '/api/planning-matrix/import', { token: 'tok-planner', body: { xlsxBase64: base64 } });
    expect(geblokkeerd.status).toBe(400);
    expect(geblokkeerd.json.blocked).toBe(true);
    expect(geblokkeerd.json.verlofConflicts).toHaveLength(1);
  });
});

describe('verloflimieten en verlof registreren (09-09)', () => {
  const ZOMER = { id: 'zomer', naam: 'Zomervakantie', van: '2026-07-01', tot: '2026-08-31', max: 4 };
  const KROKUS = { id: 'krokus', naam: 'Krokus', van: '2026-02-16', tot: '2026-02-22', max: 1 };

  it('GET geeft iedereen de standaard zolang er niets ingesteld is', async () => {
    for (const token of ['tok-a', 'tok-planner', 'tok-admin']) {
      const res = await api('GET', '/api/verlof/limieten', { token });
      expect(res.status).toBe(200);
      expect(res.json).toEqual({ standaard: 2, periodes: [] });
    }
  });

  it('admin stelt limieten in: gesorteerd opgeslagen, gelogd, en daarna voor elke rol leesbaar', async () => {
    const res = await api('PUT', '/api/verlof/limieten', { token: 'tok-admin', body: { standaard: 2, periodes: [ZOMER, KROKUS] } });
    expect(res.status).toBe(200);
    expect(res.json.periodes.map((p: any) => p.id)).toEqual(['krokus', 'zomer']);
    expect(mem.appSettings.verlof_limieten).toEqual({ standaard: 2, periodes: [KROKUS, ZOMER] });
    const log = mem.activity.find((a: any) => a.action === 'Verloflimieten aangepast');
    expect(log?.message).toContain('Zomervakantie (4)');
    const chauffeur = await api('GET', '/api/verlof/limieten', { token: 'tok-a' });
    expect(chauffeur.json.periodes).toHaveLength(2);
  });

  it('planner en chauffeur mogen de limieten niet wijzigen (403)', async () => {
    expect((await api('PUT', '/api/verlof/limieten', { token: 'tok-planner', body: { standaard: 3, periodes: [] } })).status).toBe(403);
    expect((await api('PUT', '/api/verlof/limieten', { token: 'tok-a', body: { standaard: 3, periodes: [] } })).status).toBe(403);
    expect(mem.appSettings.verlof_limieten).toBeUndefined();
  });

  it('weigert ongeldige limieten met een leesbare fout (400)', async () => {
    const omgekeerd = await api('PUT', '/api/verlof/limieten', { token: 'tok-admin', body: { standaard: 2, periodes: [{ ...ZOMER, tot: '2026-06-01' }] } });
    expect(omgekeerd.status).toBe(400);
    expect(String(omgekeerd.json.details)).toMatch(/einddatum/i);
    const teVeel = await api('PUT', '/api/verlof/limieten', { token: 'tok-admin', body: { standaard: 999, periodes: [] } });
    expect(teVeel.status).toBe(400);
    expect(mem.appSettings.verlof_limieten).toBeUndefined();
  });

  it('een planner die verlof namens een chauffeur vastlegt: meteen goedgekeurd, gelogd als registratie, geen mail of push', async () => {
    const nieuw = { id: 'l-papier', userId: '4', startDate: '2026-03-02', endDate: '2026-03-06', type: 'betaald_verlof', status: 'approved', comment: 'Van papier overgezet', createdAt: '2026-09-09T08:00:00Z', decidedAt: '2026-09-09T08:00:00Z' };
    const res = await api('POST', '/api/leave', { token: 'tok-planner', body: [...mem.leave, nieuw] });
    expect(res.status).toBe(200);
    expect(mem.leave.find((l: any) => l.id === 'l-papier')?.status).toBe('approved');
    const log = mem.activity.find((a: any) => a.entityId === 'l-papier');
    expect(log?.action).toBe('Verlof geregistreerd');
    expect(log?.message).toContain('Pieter Planner');
    // Geen "je verlof is goedgekeurd"-mail en geen push: de chauffeur wist het al.
    expect(mem.emailsSent.filter((m) => (m.context ?? '').startsWith('leave:'))).toHaveLength(0);
    expect(mem.pushesSent.filter((p) => p.payload.soort === 'verlof')).toHaveLength(0);
  });

  it('een aanvraag van een chauffeur zelf heet nog steeds "Verlof aangevraagd"', async () => {
    const nieuw = { id: 'l-eigen', userId: '3', startDate: '2026-11-02', endDate: '2026-11-03', type: 'betaald_verlof', status: 'pending', comment: '', createdAt: '2026-09-09T08:00:00Z' };
    const res = await api('POST', '/api/leave', { token: 'tok-a', body: [...mem.leave.filter((l: any) => String(l.userId) === '3'), nieuw] });
    expect(res.status).toBe(200);
    expect(mem.activity.find((a: any) => a.entityId === 'l-eigen')?.action).toBe('Verlof aangevraagd');
  });
});

describe('extra vrije dagen (feestdagen) (10-09)', () => {
  const BRUG = { id: 'brug', naam: 'Brugdag', datum: '2026-05-15' };
  const SLUIT = { id: 'sluit', naam: 'Bedrijfssluiting', datum: '2026-12-24' };

  it('GET geeft iedereen een lege lijst zolang er niets ingesteld is', async () => {
    for (const token of ['tok-a', 'tok-planner', 'tok-admin']) {
      const res = await api('GET', '/api/verlof/feestdagen', { token });
      expect(res.status).toBe(200);
      expect(res.json).toEqual({ extra: [] });
    }
  });

  it('admin bewaart extra dagen: gesorteerd, ontdubbeld per datum, gelogd', async () => {
    const res = await api('PUT', '/api/verlof/feestdagen', { token: 'tok-admin', body: { extra: [SLUIT, BRUG, { ...BRUG, id: 'dubbel', naam: 'Nog eens' }] } });
    expect(res.status).toBe(200);
    expect(res.json.extra.map((d: any) => d.id)).toEqual(['brug', 'sluit']);
    expect(mem.appSettings.verlof_feestdagen).toEqual({ extra: [BRUG, SLUIT] });
    expect(mem.activity.find((a: any) => a.action === 'Extra vrije dagen aangepast')?.message).toContain('Brugdag (2026-05-15)');
    expect((await api('GET', '/api/verlof/feestdagen', { token: 'tok-a' })).json.extra).toHaveLength(2);
  });

  it('planner en chauffeur mogen niet schrijven (403); een kapotte datum geeft 400', async () => {
    expect((await api('PUT', '/api/verlof/feestdagen', { token: 'tok-planner', body: { extra: [BRUG] } })).status).toBe(403);
    expect((await api('PUT', '/api/verlof/feestdagen', { token: 'tok-a', body: { extra: [BRUG] } })).status).toBe(403);
    const kapot = await api('PUT', '/api/verlof/feestdagen', { token: 'tok-admin', body: { extra: [{ ...BRUG, datum: '15/05/2026' }] } });
    expect(kapot.status).toBe(400);
    expect(mem.appSettings.verlof_feestdagen).toBeUndefined();
  });
});

describe('rapporten ziekte en verlof (GET /api/rapporten/:id)', () => {
  const FEB = 'van=2026-02-01&tot=2026-02-28';
  const RAPPORTEN_STAP2 = [
    `ziekte-kalenderdagen?${FEB}`, `ziekte-details?${FEB}`, `ziekte-per-maand?${FEB}`,
    `verlofaanvragen?${FEB}`, `verlofbezetting?${FEB}`, 'verlof-per-type?jaar=2026',
  ];

  it('ziekte is gevoelig: zonder sessie 401, chauffeur en technieker 403, planner en admin 200', async () => {
    mem.users.push({ id: '5', name: 'Tom Technieker', email: 'tech@vhb.be', role: 'technieker', isActive: true });
    for (const pad of RAPPORTEN_STAP2) {
      expect((await api('GET', `/api/rapporten/${pad}`)).status, pad).toBe(401);
      expect((await api('GET', `/api/rapporten/${pad}`, { token: 'tok-a' })).status, pad).toBe(403);
      expect((await api('GET', `/api/rapporten/${pad}`, { token: 'tok-tech' })).status, pad).toBe(403);
      expect((await api('GET', `/api/rapporten/${pad}`, { token: 'tok-planner' })).status, pad).toBe(200);
      expect((await api('GET', `/api/rapporten/${pad}`, { token: 'tok-admin' })).status, pad).toBe(200);
    }
  });

  it('een onbekend type, een onbekende status of een kapot vinkje is 400 met de fout bij het veld', async () => {
    const type = await api('GET', `/api/rapporten/verlofaanvragen?${FEB}&type=ziekte`, { token: 'tok-planner' });
    expect(type.status).toBe(400);
    expect(type.json.veldfouten).toEqual({ type: 'Ongeldige keuze' });
    const status = await api('GET', `/api/rapporten/verlofaanvragen?${FEB}&status=completed`, { token: 'tok-planner' });
    expect(status.status).toBe(400);
    expect(status.json.veldfouten).toEqual({ status: 'Ongeldige keuze' });
    const vinkje = await api('GET', `/api/rapporten/verlofbezetting?${FEB}&bovenLimiet=ja`, { token: 'tok-planner' });
    expect(vinkje.status).toBe(400);
    expect(vinkje.json.veldfouten).toEqual({ bovenLimiet: 'Ongeldige keuze' });
    // Zonder periode kan geen enkel van deze rapporten.
    expect((await api('GET', '/api/rapporten/ziekte-details', { token: 'tok-planner' })).json.veldfouten).toEqual({ van: 'Kies een begindatum', tot: 'Kies een einddatum' });
  });

  it('ziekte: alleen goedgekeurde meldingen, met de totalen die geen som zijn', async () => {
    mem.leave.push(
      { id: 'z-1', userId: '3', startDate: '2026-01-30', endDate: '2026-02-03', type: 'ziekte', status: 'approved', comment: 'Griep', createdAt: '2026-01-30T06:00:00Z' },
      { id: 'z-2', userId: '4', startDate: '2026-02-10', endDate: '2026-02-10', type: 'ziekte', status: 'cancelled', createdAt: '2026-02-10T06:00:00Z' },
    );
    const perChauffeur = await api('GET', `/api/rapporten/ziekte-kalenderdagen?${FEB}`, { token: 'tok-planner' });
    expect(perChauffeur.json.rijen).toEqual([
      { id: '3', naam: 'Chauffeur A', personeelsnr: null, meldingen: 1, kalenderdagen: 3, langstePeriode: 3, laatsteMelding: '2026-01-30' },
    ]);
    expect(perChauffeur.json.totalen).toEqual({ meldingen: 1, kalenderdagen: 3 });
    expect(perChauffeur.json.bereik).toEqual({ van: '2026-01-30', tot: '2026-02-03' });

    const details = await api('GET', `/api/rapporten/ziekte-details?${FEB}&chauffeur=3`, { token: 'tok-planner' });
    expect(details.json.rijen).toEqual([
      { id: 'z-1', naam: 'Chauffeur A', personeelsnr: null, van: '2026-01-30', tot: '2026-02-03', kalenderdagen: 3, opmerking: 'Griep' },
    ]);

    const perMaand = await api('GET', '/api/rapporten/ziekte-per-maand?van=2026-01-01&tot=2026-02-28', { token: 'tok-planner' });
    expect(perMaand.json.rijen.map((r: any) => [r.maand, r.meldingen, r.kalenderdagen, r.chauffeurs])).toEqual([['Januari 2026', 1, 2, 1], ['Februari 2026', 1, 3, 1]]);
    // Kalenderdagen is een som; de melding en de chauffeur tellen één keer, niet per maand.
    expect(perMaand.json.totalen).toEqual({ kalenderdagen: 5, meldingen: 1, chauffeurs: 1 });
  });

  it('verlof: aanvragen met filters, bezetting met het vinkje en de limiet uit de instellingen, kolommen per type', async () => {
    const aanvragen = await api('GET', '/api/rapporten/verlofaanvragen?van=2026-07-01&tot=2026-08-31&status=pending', { token: 'tok-planner' });
    expect(aanvragen.json.rijen.map((r: any) => [r.id, r.naam, r.type, r.dagen, r.status, r.aangevraagdOp, r.beslistOp, r.opmerking])).toEqual([
      ['l-a1', 'Chauffeur A', 'Betaald verlof', 3, 'In behandeling', '2026-06-01', null, 'rust'],
      // zo 05/07 telt niet, ma 06/07 wel.
      ['l-b1', 'Chauffeur B', 'Klein verlet', 1, 'In behandeling', '2026-06-02', null, 'privé'],
    ]);
    expect(aanvragen.json.totalen).toEqual({ dagen: 4 });

    mem.appSettings.verlof_limieten = { standaard: 0, periodes: [] };
    const week = 'van=2026-08-09&tot=2026-08-13';
    const bezetting = await api('GET', `/api/rapporten/verlofbezetting?${week}`, { token: 'tok-planner' });
    expect(bezetting.json.rijen.map((r: any) => [r.datum, r.dag, r.afwezig, r.limiet, r.bovenLimiet, r.namen])).toEqual([
      ['2026-08-09', 'zo', 0, 0, false, null],
      ['2026-08-10', 'ma', 1, 0, true, 'Chauffeur A'],
      ['2026-08-11', 'di', 1, 0, true, 'Chauffeur A'],
      ['2026-08-12', 'wo', 1, 0, true, 'Chauffeur A'],
      ['2026-08-13', 'do', 0, 0, false, null],
    ]);
    const boven = await api('GET', `/api/rapporten/verlofbezetting?${week}&bovenLimiet=1`, { token: 'tok-planner' });
    expect(boven.json.rijen.map((r: any) => r.datum)).toEqual(['2026-08-10', '2026-08-11', '2026-08-12']);
    // Dezelfde telling als het endpoint van de verlofkalender, dat geen namen geeft.
    const kalender = await api('GET', `/api/leave/bezetting?${week}`, { token: 'tok-a' });
    expect(kalender.json.dagen).toEqual(bezetting.json.rijen.map((r: any) => ({ datum: r.datum, aantal: r.afwezig, limiet: r.limiet })));

    const perType = await api('GET', '/api/rapporten/verlof-per-type?jaar=2026', { token: 'tok-planner' });
    expect(perType.json.kolommen.map((k: any) => k.id)).toEqual(['maand', 'type_betaald_verlof', 'totaal']);
    expect(perType.json.rijen).toHaveLength(12);
    expect(perType.json.totalen).toEqual({ type_betaald_verlof: 3, totaal: 3 });
  });
});
