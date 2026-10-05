// @vitest-environment node
import {
  api,
  mem,
} from './harnas';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('onbemande dienst toewijzen (Dekking)', () => {
  // Een gat = een verwachte dienst die op níémand staat; de dienstwissel kan
  // daar niets mee. Toewijzen schrijft in de matrix (bron van elke heropbouw)
  // én zet de blokken direct in de planning.
  beforeEach(() => {
    mem.planningMatrix = [
      { id: 'm-gat', source_date: '2030-09-02', day_type: 'week', assignments: { 'Chauffeur A': '12' }, raw_row: '' },
    ];
    mem.planning = [{ id: 'sh-a2', driverId: '3', date: '2030-09-02', line: '12' }];
    mem.leave = [];
    mem.swaps = [];
  });

  it('wijst een onbemande dienst toe: matrix + planning bijgewerkt', async () => {
    // Dienst 14 wordt die dag verwacht maar staat op niemand; chauffeur 4 is vrij.
    const res = await api('POST', '/api/planning/assign-service', {
      token: 'tok-planner',
      body: { date: '2030-09-02', serviceNumber: '14', driverId: '4' },
    });
    expect(res.status).toBe(200);
    expect(res.json.success).toBe(true);
    // Planning-rij met de tijden uit het dienstoverzicht.
    const rij = mem.planning.find((r: any) => r.line === '14' && r.date === '2030-09-02');
    expect(rij).toMatchObject({ driverId: '4', startTime: '10:00', endTime: '18:00' });
    // Matrix-rij draagt de toewijzing, zodat een heropbouw hem regenereert.
    expect(mem.planningMatrix[0].assignments['Chauffeur B']).toBe('14');
    // Bestaande toewijzing van chauffeur A blijft staan.
    expect(mem.planningMatrix[0].assignments['Chauffeur A']).toBe('12');
  });

  it('weigert toewijzen aan iemand die al rijdt, en aan een bemande dienst', async () => {
    const alRijdt = await api('POST', '/api/planning/assign-service', {
      token: 'tok-planner',
      body: { date: '2030-09-02', serviceNumber: '14', driverId: '3' },
    });
    expect(alRijdt.status).toBe(409);
    expect(String(alRijdt.json?.error)).toContain('al dienst');

    const alBemand = await api('POST', '/api/planning/assign-service', {
      token: 'tok-planner',
      body: { date: '2030-09-02', serviceNumber: '12', driverId: '4' },
    });
    expect(alBemand.status).toBe(409);
    expect(String(alBemand.json?.error)).toContain('al ingevuld');
  });

  it('weigert een afwezige chauffeur en een chauffeur-rol-check via 403 voor chauffeurs', async () => {
    mem.leave = [{ id: 'l-a', userId: '4', startDate: '2030-09-02', endDate: '2030-09-02', type: 'ziekte', status: 'approved', comment: '', createdAt: '2030-09-01T06:00:00Z', decidedAt: '2030-09-01T06:00:00Z' }];
    const ziek = await api('POST', '/api/planning/assign-service', {
      token: 'tok-planner',
      body: { date: '2030-09-02', serviceNumber: '14', driverId: '4' },
    });
    expect(ziek.status).toBe(409);

    const chauffeur = await api('POST', '/api/planning/assign-service', {
      token: 'tok-a',
      body: { date: '2030-09-02', serviceNumber: '14', driverId: '4' },
    });
    expect(chauffeur.status).toBe(403);
  });
});

describe('vervaldata (Code 95 / medische schifting)', () => {
  it('planner zet een vervaldatum; chauffeur ziet alleen zijn eigen datums', async () => {
    const zet = await api('PUT', '/api/user-expiries', { token: 'tok-planner', body: { userId: '3', soort: 'code95', validUntil: '2027-03-01' } });
    expect(zet.status).toBe(200);
    await api('PUT', '/api/user-expiries', { token: 'tok-planner', body: { userId: '4', soort: 'medische_schifting', validUntil: '2028-01-15' } });
    // Chauffeur 3 (tok-a) ziet alleen zichzelf.
    const eigen = await api('GET', '/api/user-expiries', { token: 'tok-a' });
    expect(eigen.status).toBe(200);
    expect(eigen.json).toEqual([{ userId: '3', soort: 'code95', validUntil: '2027-03-01' }]);
    // Planner ziet alles.
    const alle = await api('GET', '/api/user-expiries', { token: 'tok-planner' });
    expect(alle.json).toHaveLength(2);
  });

  it('chauffeur mag niet schrijven (403); lege datum verwijdert; rommel wordt geweigerd', async () => {
    const verboden = await api('PUT', '/api/user-expiries', { token: 'tok-a', body: { userId: '3', soort: 'code95', validUntil: '2027-03-01' } });
    expect(verboden.status).toBe(403);
    await api('PUT', '/api/user-expiries', { token: 'tok-admin', body: { userId: '3', soort: 'code95', validUntil: '2027-03-01' } });
    const weg = await api('PUT', '/api/user-expiries', { token: 'tok-admin', body: { userId: '3', soort: 'code95', validUntil: null } });
    expect(weg.status).toBe(200);
    expect(mem.userExpiries).toHaveLength(0);
    const fouteSoort = await api('PUT', '/api/user-expiries', { token: 'tok-admin', body: { userId: '3', soort: 'tachograaf', validUntil: '2027-01-01' } });
    expect(fouteSoort.status).toBe(400);
    const fouteDatum = await api('PUT', '/api/user-expiries', { token: 'tok-admin', body: { userId: '3', soort: 'code95', validUntil: '01/03/2027' } });
    expect(fouteDatum.status).toBe(400);
    // Datumtranche PR 2: een dag die niet bestaat valt ook af, niets bewaard.
    const onbestaand = await api('PUT', '/api/user-expiries', { token: 'tok-admin', body: { userId: '3', soort: 'code95', validUntil: '2027-02-30' } });
    expect(onbestaand.status).toBe(400);
    expect(onbestaand.json.error).toBe('Ongeldige datum.');
    expect(mem.userExpiries).toHaveLength(0);
    const onbekendeUser = await api('PUT', '/api/user-expiries', { token: 'tok-admin', body: { userId: 'geest', soort: 'code95', validUntil: '2027-01-01' } });
    expect(onbekendeUser.status).toBe(404);
  });

  it('rijbewijs wordt niet meer bewaakt: PUT weigert, oude rijen komen niet in de GET', async () => {
    const oud = await api('PUT', '/api/user-expiries', { token: 'tok-admin', body: { userId: '3', soort: 'rijbewijs', validUntil: '2029-05-01' } });
    expect(oud.status).toBe(400);
    // Rij die vóór de wijziging is opgeslagen: blijft in de DB staan, maar
    // mag nergens meer opduiken.
    mem.userExpiries.push({ userId: '3', soort: 'rijbewijs', validUntil: '2029-05-01', updatedAt: null, updatedBy: null });
    await api('PUT', '/api/user-expiries', { token: 'tok-admin', body: { userId: '3', soort: 'code95', validUntil: '2027-03-01' } });
    const alle = await api('GET', '/api/user-expiries', { token: 'tok-planner' });
    expect(alle.json).toEqual([{ userId: '3', soort: 'code95', validUntil: '2027-03-01' }]);
  });
});

describe('advies openstaande diensten (/api/coverage-advisor)', () => {
  // Vaste toekomst-dag: het advies rekent alleen met de meegegeven dag en
  // het venster eromheen (±6 dagen + de hele week én kalendermaand voor de
  // belastingtelling) — geen "vandaag" in de logica.
  const DAG = '2026-09-16';

  it('is planner/admin-terrein (chauffeur krijgt 403)', async () => {
    const res = await api('GET', `/api/coverage-advisor?date=${DAG}&code=10`, { token: 'tok-a' });
    expect(res.status).toBe(403);
  });

  it('weigert een kapotte datum of ontbrekende code', async () => {
    const geenCode = await api('GET', `/api/coverage-advisor?date=${DAG}`, { token: 'tok-planner' });
    expect(geenCode.status).toBe(400);
    const kapot = await api('GET', '/api/coverage-advisor?date=16-09-2026&code=10', { token: 'tok-planner' });
    expect(kapot.status).toBe(400);
  });

  it('beoordeelt rust: wie gisteren laat eindigde past niet vóór een vroege dienst', async () => {
    // Dienst 10 = 06:00–14:00. Chauffeur A werkte gisteren tot 23:30 → 6u30
    // rust; Chauffeur B was vrij → passend. B hoort vóór A te staan.
    mem.planning = [
      { id: 'p-1', driverId: '3', date: '2026-09-15', startTime: '15:00', endTime: '23:30', line: '12' },
    ];
    const res = await api('GET', `/api/coverage-advisor?date=${DAG}&code=10`, { token: 'tok-planner' });
    expect(res.status).toBe(200);
    expect(res.json.tijdenOnbekend).toBe(false);
    expect(res.json.segmenten).toEqual([{ startTime: '06:00', endTime: '14:00' }]);
    expect(res.json.kandidaten.map((k: any) => [k.name, k.past])).toEqual([
      ['Chauffeur B', true],
      ['Chauffeur A', false],
    ]);
    const a = res.json.kandidaten.find((k: any) => k.name === 'Chauffeur A');
    expect(a.rustVoor).toBe(6 * 60 + 30);
    expect(a.redenen).toEqual(['maar 6u30 rust na de dienst van de dag ervoor']);
  });

  it('bewaakt de 6-dagenregel over de bestaande planning heen', async () => {
    // Chauffeur A werkte 10 t/m 15 september (6 dagen): de 16e zou dag 7 zijn.
    mem.planning = ['10', '11', '12', '13', '14', '15'].map((d) => (
      { id: `p-${d}`, driverId: '3', date: `2026-09-${d}`, startTime: '08:00', endTime: '14:00', line: '12' }
    ));
    const res = await api('GET', `/api/coverage-advisor?date=${DAG}&code=10`, { token: 'tok-planner' });
    const a = res.json.kandidaten.find((k: any) => k.name === 'Chauffeur A');
    expect(a.past).toBe(false);
    expect(a.dagenNaElkaar).toBe(7);
    expect(a.redenen).toEqual(['zou 7 dagen na elkaar werken']);
  });

  it('wie die dag al rijdt of verlof heeft, is geen kandidaat', async () => {
    mem.planning = [
      { id: 'p-b', driverId: '4', date: DAG, startTime: '08:00', endTime: '16:00', line: '12' },
    ];
    mem.leave = [
      { id: 'l-adv', userId: '3', startDate: DAG, endDate: DAG, type: 'betaald_verlof', status: 'approved', comment: '', createdAt: '2026-09-01T08:00:00Z', decidedAt: '2026-09-02T08:00:00Z' },
    ];
    const res = await api('GET', `/api/coverage-advisor?date=${DAG}&code=10`, { token: 'tok-planner' });
    expect(res.json.kandidaten).toEqual([]);
  });

  it('sorteert op belasting: wie deze week het minst werkte staat bovenaan', async () => {
    // Chauffeur A werkte al op maandag 14/09 (zelfde week als het gat, niet
    // aansluitend); Chauffeur B werkte die week nog niet → B eerst.
    mem.planning = [
      { id: 'p-wk', driverId: '3', date: '2026-09-14', startTime: '08:00', endTime: '14:00', line: '12' },
    ];
    const res = await api('GET', `/api/coverage-advisor?date=${DAG}&code=10`, { token: 'tok-planner' });
    expect(res.json.kandidaten.map((k: any) => [k.name, k.dagenDezeWeek])).toEqual([
      ['Chauffeur B', 0],
      ['Chauffeur A', 1],
    ]);
  });

  it('een schoolvervoerchauffeur valt buiten het voorstel, mét reden', async () => {
    mem.planning = [];
    mem.users = mem.users.map((u: any) => (u.id === '4' ? { ...u, section: 'Schoolvervoer' } : u));
    const res = await api('GET', `/api/coverage-advisor?date=${DAG}&code=10`, { token: 'tok-planner' });
    expect(res.json.kandidaten.map((k: any) => [k.name, k.past])).toEqual([
      ['Chauffeur A', true],
      ['Chauffeur B', false],
    ]);
    const b = res.json.kandidaten.find((k: any) => k.name === 'Chauffeur B');
    expect(b.redenen).toEqual(['schoolvervoerchauffeur, springt niet in op een lijndienst']);
  });

  it('bij gelijke weekbelasting beslist de reeks, daarna het maandtotaal', async () => {
    // Beiden één werkdag deze week: A op di 15/09 (sluit aan op het gat →
    // reeks van 2), B op ma 14/09 (los → reeks van 1). B staat bovenaan.
    mem.planning = [
      { id: 'p-a15', driverId: '3', date: '2026-09-15', startTime: '08:00', endTime: '14:00', line: '12' },
      { id: 'p-b14', driverId: '4', date: '2026-09-14', startTime: '08:00', endTime: '14:00', line: '12' },
    ];
    const res = await api('GET', `/api/coverage-advisor?date=${DAG}&code=10`, { token: 'tok-planner' });
    expect(res.json.kandidaten.map((k: any) => [k.name, k.dagenDezeWeek, k.dagenNaElkaar])).toEqual([
      ['Chauffeur B', 1, 1],
      ['Chauffeur A', 1, 2],
    ]);

    // Zelfde week (0 gewerkte dagen) en zelfde reeks: het maandtotaal beslist.
    // A werkte 3 septemberdagen buiten de week van het gat — dat kan de
    // advisor alleen zien doordat het datavenster de hele maand dekt.
    mem.planning = ['01', '03', '05'].map((d) => (
      { id: `p-m${d}`, driverId: '3', date: `2026-09-${d}`, startTime: '08:00', endTime: '14:00', line: '12' }
    ));
    const res2 = await api('GET', `/api/coverage-advisor?date=${DAG}&code=10`, { token: 'tok-planner' });
    expect(res2.json.kandidaten.map((k: any) => [k.name, k.dagenDezeMaand])).toEqual([
      ['Chauffeur B', 0],
      ['Chauffeur A', 3],
    ]);
  });

  it('onbekende dienst: kandidaten mét 6-dagenregel, maar rustcheck gemarkeerd als onmogelijk', async () => {
    mem.planning = [];
    const res = await api('GET', `/api/coverage-advisor?date=${DAG}&code=999`, { token: 'tok-planner' });
    expect(res.status).toBe(200);
    expect(res.json.tijdenOnbekend).toBe(true);
    expect(res.json.segmenten).toEqual([]);
    const a = res.json.kandidaten.find((k: any) => k.name === 'Chauffeur A');
    expect(a.rustVoor).toBeNull();
    expect(a.past).toBe(true);
  });
});

describe('advies openstaande diensten, het venster van één aanvraag is begrensd (beveiligingsscan 01-10, punt 7)', () => {
  // Het advies laadt de planning per maand voor het venster rond elke
  // gevraagde dag. Zonder grens haalde één batch met een dag in 2026 en een
  // dag in 9999 bijna 96.000 maanden tegelijk op, en liep de maandlus bij
  // december 9999 door tot voorbij een miljoen. Nu: echte kalenderdagen,
  // hoogstens een jaar breed, en geweigerd vóór er iets geladen wordt.
  const batch = (items: Array<{ date: string; code: string }>) =>
    api('POST', '/api/coverage-advisor/batch', { token: 'tok-planner', body: { items } });
  const los = (date: string) => api('GET', `/api/coverage-advisor?date=${date}&code=10`, { token: 'tok-planner' });
  const dagNa = (iso: string, n: number) => {
    const d = new Date(`${iso}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  /** Geen planning en geen matrix opgehaald: de weigering kwam vóór de dataload. */
  const nietsGeladen = () => {
    expect(mem.planningMaandFilters).toEqual([]);
    expect(mem.matrixMaandFilters).toEqual([]);
  };
  const nette400 = (res: { status: number; json: any }, stuk: string) => {
    expect(res.status).toBe(400);
    expect(res.json.error).toContain(stuk);
    expect(res.json.error.length).toBeLessThan(240);
    expect(res.json.error).not.toContain('—');
  };

  it('gemeten 1: een dag in 2026 samen met een dag in 9999 (95.679 maanden) is een 400 met uitleg', async () => {
    const start = performance.now();
    const res = await batch([{ date: '2026-10-01', code: '10' }, { date: '9999-11-15', code: '10' }]);
    nette400(res, 'meer dan een jaar uit elkaar');
    expect(res.json.error).toMatch(/vraag het advies per dienst op\.$/);
    nietsGeladen();
    expect(performance.now() - start).toBeLessThan(2000);
  });

  it('gemeten 2 en 3: één dag in december 9999 (1.079.881 maanden) wordt geweigerd, los en in een batch', async () => {
    const start = performance.now();
    for (const dag of ['9999-12-01', '9999-12-15', '9999-12-31']) {
      nette400(await los(dag), 'Controleer de datum');
      nette400(await batch([{ date: dag, code: '10' }]), 'Controleer de datum');
    }
    nietsGeladen();
    expect(performance.now() - start).toBeLessThan(2000);
  });

  it('een dag die niet bestaat: los een 400, in een batch valt hij weg zoals elke kapotte datum', async () => {
    for (const kapot of ['2026-02-30', '2026-13-01', '2026-00-10']) {
      expect((await los(kapot)).status).toBe(400);
      expect((await batch([{ date: kapot, code: '10' }])).status).toBe(400);
    }
    nietsGeladen();
    const gemengd = await batch([{ date: '2026-02-30', code: '10' }, { date: '2030-09-02', code: '11' }]);
    expect(gemengd.status).toBe(200);
    expect(gemengd.json.items.map((i: any) => i.date)).toEqual(['2030-09-02']);
  });

  it('net boven een jaar wordt geweigerd, een vol jaar niet', async () => {
    // 15/01/2027 en 27/12/2027: de vensters samen lopen van 01/01/2027 tot en
    // met 02/01/2028, 367 dagen (13 maanden: de maandlus alleen liet dit door).
    nette400(await batch([{ date: '2027-01-15', code: '10' }, { date: '2027-12-27', code: '10' }]), 'meer dan een jaar uit elkaar');
    nietsGeladen();
    // 15/01/2028 en 15/12/2028: 01/01 tot en met 31/12 van een schrikkeljaar, precies 366 dagen.
    const jaar = await batch([{ date: '2028-01-15', code: '10' }, { date: '2028-12-15', code: '10' }]);
    expect(jaar.status).toBe(200);
    expect(jaar.json.items).toHaveLength(2);
    expect([...mem.planningMaandFilters].sort()).toEqual(Array.from({ length: 12 }, (_, i) => `2028-${String(i + 1).padStart(2, '0')}`));
  });

  it('de herverdeel-wizard blijft werken: 40 diensten van een langdurig afwezige, acht weken lang', async () => {
    // Vijf dagen per week vanaf maandag 02/09/2030: 40 werkdagen, tot en met vrijdag 25/10.
    const werkdagen = Array.from({ length: 56 }, (_, i) => dagNa('2030-09-02', i))
      .filter((dag) => ![0, 6].includes(new Date(`${dag}T00:00:00Z`).getUTCDay()));
    expect(werkdagen).toHaveLength(40);
    expect(werkdagen[39]).toBe('2030-10-25');
    // Chauffeur A rijdt de eerste dag zelf dienst 12, Chauffeur B is vrij.
    mem.planning = [{ id: 'w-1', driverId: '3', date: '2030-09-02', line: '12', startTime: '08:00', endTime: '16:00' }];
    const res = await batch(werkdagen.map((date) => ({ date, code: '11' })));
    expect(res.status).toBe(200);
    expect(res.json.items.map((i: any) => i.date)).toEqual(werkdagen);
    expect(res.json.items[0].passend.map((k: any) => k.name)).toEqual(['Chauffeur B']);
    expect(res.json.items[39].passend.map((k: any) => k.name)).toContain('Chauffeur A');
    // Precies de maanden van het verenigde venster (27/08 tot en met 31/10),
    // elk één keer en elk met een maandfilter: nooit de hele planning.
    expect([...mem.planningMaandFilters].sort()).toEqual(['2030-08', '2030-09', '2030-10']);
  });

  it('ook wie maar één dag per week rijdt past: 40 diensten over 40 weken', async () => {
    const weken = Array.from({ length: 40 }, (_, i) => dagNa('2030-09-02', i * 7));
    expect(weken[39]).toBe('2031-06-02');
    const res = await batch(weken.map((date) => ({ date, code: '11' })));
    expect(res.status).toBe(200);
    expect(res.json.items).toHaveLength(40);
    expect([...mem.planningMaandFilters].sort()).toEqual([
      '2030-08', '2030-09', '2030-10', '2030-11', '2030-12', '2031-01', '2031-02', '2031-03', '2031-04', '2031-05', '2031-06',
    ]);
  });

  it('het losse advies laadt de maanden van zijn eigen venster, niet meer', async () => {
    expect((await los('2026-09-16')).status).toBe(200);
    expect(mem.planningMaandFilters).toEqual(['2026-09']);
    mem.planningMaandFilters = [];
    // De 1e van de maand: zes dagen terug ligt in september.
    expect((await los('2026-10-01')).status).toBe(200);
    expect(mem.planningMaandFilters).toEqual(['2026-09', '2026-10']);
  });

  it('digest: een matrixrij met een dag die niet bestaat breekt het dagoverzicht niet, het gat blijft erin staan', async () => {
    // Vrijdag 26/02/2027: het venster van zeven dagen loopt tot 04/03, en
    // "2027-02-30" sorteert daar als tekst middenin. Zo'n rij kan alleen uit
    // een kapotte import komen; het advies weigert de dag, de cron gaat door.
    process.env.ERROR_DIGEST_WEEKDAG = 'elke';
    vi.setSystemTime(new Date('2027-02-26T10:00:00Z'));
    mem.planningMatrix = [
      { id: 'm-kapot', source_date: '2027-02-30', day_type: 'week', assignments: { 'Chauffeur A': '12' }, raw_row: '' },
      { id: 'm-goed', source_date: '2027-03-01', day_type: 'week', assignments: { 'Chauffeur A': '12' }, raw_row: '' },
    ];
    mem.coverageExpectations = { week: ['12', '11'] };
    mem.planning = [];
    const fouten = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await api('GET', '/api/cron/error-digest', { headers: { Authorization: 'Bearer test-cron-secret' } });
      expect(res.status).toBe(200);
      const tekst = mem.emailsSent.find((m) => m.context === 'error-digest')?.text ?? '';
      expect(tekst).toContain('Openstaande diensten (komende 7 dagen)');
      const regels = tekst.split('\n').filter((r) => r.includes('dienst 11'));
      expect(regels).toHaveLength(2);
      // Het gat op de dag die niet bestaat: zichtbaar in de mail, zonder advies.
      expect(regels[0]).toContain('advies kon niet berekend worden');
      // Het echte gat erna krijgt gewoon zijn advies.
      expect(regels[1]).toContain('Ik zou');
      // En de reden staat in het log.
      expect(fouten.mock.calls.some((c) => String(c[0]).includes('advies voor 2027-02-30, dienst 11 mislukt') && String(c[1]).includes('Controleer de datum'))).toBe(true);
    } finally {
      fouten.mockRestore();
      delete process.env.ERROR_DIGEST_WEEKDAG;
    }
  });

  it('Telegram: een knop met een dag die niet kan krijgt een antwoord in de chat, geen crash en geen dataload', async () => {
    const { zetTelegramVerzenderVoorTests } = await import('../../api/telegram');
    const verzonden: Array<{ tekst: string }> = [];
    zetTelegramVerzenderVoorTests(async (v: any) => { verzonden.push(v); return true; });
    process.env.TELEGRAM_WEBHOOK_SECRET = 'test-secret';
    process.env.TELEGRAM_CHAT_ID = '777';
    delete process.env.TELEGRAM_BOT_TOKEN;
    const fouten = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      for (const dag of ['9999-12-15', '2026-02-30', '']) {
        verzonden.length = 0;
        const res = await api('POST', '/api/telegram/webhook', {
          body: { callback_query: { id: 'cb-x', data: `adv|${dag}|11`, message: { chat: { id: 777 } } } },
          headers: { 'X-Telegram-Bot-Api-Secret-Token': 'test-secret' },
        });
        expect(res.status).toBe(200);
        expect(verzonden).toHaveLength(1);
        expect(verzonden[0].tekst).toBe('Advies voor dienst 11 kon niet berekend worden.');
      }
      nietsGeladen();
      expect(fouten.mock.calls.filter((c) => String(c[0]).includes('[telegram] advies mislukt'))).toHaveLength(3);
    } finally {
      fouten.mockRestore();
      zetTelegramVerzenderVoorTests(null);
      delete process.env.TELEGRAM_WEBHOOK_SECRET;
      delete process.env.TELEGRAM_CHAT_ID;
    }
  });
});

describe('advisor: ketting-voorstellen en collega-samenvatting', () => {
  const DAG = '2026-09-16';

  it('stelt een ruil in één stap voor als niemand direct past', async () => {
    // Dienst 10 begint 06:00. Chauffeur B is vrij maar werkte gisteren tot
    // 23:30 → maar 6u30 rust vóór 06:00, wél 8u30 vóór 08:00. Chauffeur A
    // rijdt dienst 12 (08:00–16:00) en kan zelf het gat rijden.
    mem.planning = [
      { id: 'p-ka', driverId: '3', date: DAG, startTime: '08:00', endTime: '16:00', line: '12' },
      { id: 'p-kb', driverId: '4', date: '2026-09-15', startTime: '15:00', endTime: '23:30', line: '14' },
    ];
    const res = await api('GET', `/api/coverage-advisor?date=${DAG}&code=10`, { token: 'tok-planner' });
    expect(res.status).toBe(200);
    expect(res.json.kandidaten.some((k: any) => k.past)).toBe(false);
    expect(res.json.kettingen).toEqual([{
      vanId: '3', vanNaam: 'Chauffeur A', viaCode: '12', viaTijden: '08:00–16:00',
      naarId: '4', naarNaam: 'Chauffeur B',
    }]);
    expect(res.json.samenvatting).toContain('Wél mogelijk via een ruil');
    expect(res.json.samenvatting).toContain('Chauffeur B');
  });

  it('geen kettingen zolang er een passende kandidaat is; samenvatting noemt hem', async () => {
    mem.planning = [];
    const res = await api('GET', `/api/coverage-advisor?date=${DAG}&code=10`, { token: 'tok-planner' });
    expect(res.json.kettingen).toEqual([]);
    expect(res.json.samenvatting).toContain('Ik zou Chauffeur A vragen');
  });
});

describe('verbeterronde 22-08, voorstel, batch-advies en maandoverzicht', () => {
  it('GET /api/coverage-expectations/voorstel stelt lijsten voor uit de praktijk (staf-only)', async () => {
    mem.planningMatrix = [
      { id: 'v-1', source_date: '2030-09-01', day_type: 'school', assignments: { 'Chauffeur A': '2101', 'Chauffeur B': 'vrij' }, raw_row: '' },
      { id: 'v-2', source_date: '2030-09-02', day_type: 'school', assignments: { 'Chauffeur A': '2101', 'Chauffeur B': '2102' }, raw_row: '' },
    ];
    const res = await api('GET', '/api/coverage-expectations/voorstel?from=2030-09-01&to=2030-09-30', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    expect(res.json.voorstellen).toEqual([
      { dayType: 'school', dagen: 2, codes: [{ code: '2101', dagen: 2 }, { code: '2102', dagen: 1 }] },
    ]);
    expect((await api('GET', '/api/coverage-expectations/voorstel?from=2030-09-01&to=2030-09-30', { token: 'tok-a' })).status).toBe(403);
  });

  it('POST /api/coverage-advisor/batch geeft per gat de passende topkandidaten in één call', async () => {
    // Chauffeur A rijdt dienst 12 op 01-09; Chauffeur B is vrij → kandidaat
    // voor het gat op dienst 11 diezelfde dag.
    mem.planning = [
      { id: 'b-1', driverId: '3', date: '2030-09-01', line: '12', startTime: '08:00', endTime: '16:00' },
    ];
    const res = await api('POST', '/api/coverage-advisor/batch', {
      token: 'tok-planner',
      body: { items: [{ date: '2030-09-01', code: '11' }, { date: '2030-09-02', code: '12' }] },
    });
    expect(res.status).toBe(200);
    expect(res.json.items).toHaveLength(2);
    const eerste = res.json.items[0];
    expect(eerste.date).toBe('2030-09-01');
    expect(eerste.passend.map((k: any) => k.name)).toContain('Chauffeur B');
    // Ongeldige input wordt geweigerd.
    expect((await api('POST', '/api/coverage-advisor/batch', { token: 'tok-planner', body: { items: [] } })).status).toBe(400);
  });

  it('GET /api/month-planning?format=summary telt zoals het xlsx-tabblad en weigert chauffeurs', async () => {
    mem.planningMatrix = [
      { id: 's-1', source_date: '2030-09-01', day_type: 'school', assignments: { 'Chauffeur A': '12', 'Chauffeur B': 'vrij' }, raw_row: '' },
    ];
    mem.planningCodes = [{ code: 'vrij', category: 'absence', description: 'Geen dienst', countsAsShift: false, isPaidAbsence: false, isDayOff: true }];
    const res = await api('GET', '/api/month-planning?month=2030-09&format=summary', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    const rijA = res.json.rijen.find((r: any) => r.naam === 'Chauffeur A');
    const rijB = res.json.rijen.find((r: any) => r.naam === 'Chauffeur B');
    expect(rijA).toMatchObject({ diensten: 1, dagen: 1 });
    expect(rijB).toMatchObject({ vrij: 1, dagen: 1 });
    expect((await api('GET', '/api/month-planning?month=2030-09&format=summary', { token: 'tok-a' })).status).toBe(403);
  });
});
