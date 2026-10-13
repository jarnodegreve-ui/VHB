// @vitest-environment node
import { api, mem } from './harnas';
import { describe, expect, it } from 'vitest';

/**
 * Ritbladbundels (documentRoutes): sinds 09-10 krijgen de actieve chauffeurs
 * één melding zodra een admin een nieuwe bundel oplaadt (keuze Jarno), en
 * sinds 13-10 hangt elke bundel aan een dienstregelingversie (fase 2 van het
 * plan van 08-10). Tabel en bucket komen uit het harnas (mem.ritbladen,
 * mem.ritbladBestanden); de PDF is bewust geen echte (de titel-stap valt dan
 * stil terug op het origineel).
 */
describe('ritbladen per dienstregelingversie (13-10)', () => {
  // Seed: één versie dr-sep (vanaf 01/01/2026) die op de testklok (15/06/2026)
  // geldt; chauffeurs 3 en 4, waarvan 4 in de eerste test uitstaat.
  const body = { filename: 'ritblad.pdf', dataUrl: `data:application/pdf;base64,${Buffer.from('%PDF-1.4 proef').toString('base64')}` };
  const maakVersie = async (geldigVanaf: string) => (await api('POST', '/api/dienstregelingen', { token: 'tok-planner', body: { geldigVanaf, melden: false } })).json;
  const upload = (extra: Record<string, unknown> = {}, versie?: string) =>
    api('POST', versie ? `/api/ritblaadje?versie=${versie}` : '/api/ritblaadje', { token: 'tok-admin', body: { ...body, ...extra } });

  it('upload is voor admins, hangt de bundel aan de versie van vandaag en pusht "Nieuwe ritbladen" naar de actieve chauffeurs', async () => {
    mem.users = mem.users.map((u: any) => (u.id === '4' ? { ...u, isActive: false } : u));
    mem.pushesSent = [];
    expect((await api('POST', '/api/ritblaadje', { token: 'tok-planner', body })).status).toBe(403);
    const res = await upload();
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ filename: 'ritblad.pdf', dienstregelingId: 'dr-sep', url: expect.stringContaining('https://storage.test/dr-sep-'), versie: { id: 'dr-sep', status: 'huidig' } });
    expect(mem.ritbladBestanden).toHaveLength(1);
    expect(mem.ritbladen).toHaveLength(1);
    const push = mem.pushesSent.find((p) => p.payload.title === 'Nieuwe ritbladen');
    expect(push?.userIds).toEqual(['3']);
    expect(push?.payload).toMatchObject({ soort: 'planning', url: '/?view=ritbladen', body: 'De ritbladbundel is vervangen. Open Ritbladen voor het blad van je dienst.' });
    expect(mem.activity.some((a: any) => a.action === 'Ritblaadje toegevoegd')).toBe(true);
    // Nog eens voor dezelfde versie: vervangt, het oude bestand gaat weg, één rij.
    expect((await upload({ filename: 'ritblad2.pdf' })).status).toBe(200);
    expect(mem.ritbladBestanden).toHaveLength(1);
    expect(mem.ritbladen.map((r: any) => r.filename)).toEqual(['ritblad2.pdf']);
    expect(mem.activity.some((a: any) => a.action === 'Ritblaadje vervangen')).toBe(true);
  });

  it('een bundel voor een toekomstige versie is vooraf te zien, meldt haar datum (tenzij melden uitstaat) en geldt per dag', async () => {
    const juli = await maakVersie('2026-07-05');
    await upload({ filename: 'juni.pdf' });
    mem.pushesSent = [];
    const res = await upload({ filename: 'juli.pdf', melden: false }, juli.id);
    expect(res.status).toBe(200);
    expect(res.json.versie).toMatchObject({ id: juli.id, status: 'toekomstig', geldigVanaf: '2026-07-05' });
    expect(mem.pushesSent).toHaveLength(0);
    await upload({ filename: 'juli2.pdf' }, juli.id);
    const push = mem.pushesSent.find((p) => p.payload.title === 'Nieuwe ritbladen vanaf 05/07/2026');
    expect(push?.payload.body).toBe('Vanaf 05/07/2026 gelden nieuwe ritbladen. Je kan ze nu al bekijken via Ritbladen.');
    // De oude route kiest op datum (standaard vandaag).
    expect((await api('GET', '/api/ritblaadje', { token: 'tok-a' })).json).toMatchObject({ filename: 'juni.pdf', terugval: false, versie: { id: 'dr-sep', status: 'huidig', geldigTot: '2026-07-04' } });
    expect((await api('GET', '/api/ritblaadje?datum=2026-07-05', { token: 'tok-a' })).json).toMatchObject({ filename: 'juli2.pdf', versie: { id: juli.id } });
    // De lijst voor het scherm.
    const lijst = (await api('GET', '/api/ritbladen?datum=2026-07-10', { token: 'tok-a' })).json;
    expect(lijst.datum).toBe('2026-07-10');
    expect(lijst.bundels.map((b: any) => [b.versie?.id, b.versie?.status, b.bundel?.filename])).toEqual([['dr-sep', 'huidig', 'juni.pdf'], [juli.id, 'toekomstig', 'juli2.pdf']]);
    expect(lijst.bundel.filename).toBe('juli2.pdf');
    expect(lijst.vorige).toBeNull();
    expect((await upload({}, 'nope')).status).toBe(404);
  });

  it('een versie zonder eigen bundel: de lijst wijst naar de vorige, de oude route valt er stil op terug', async () => {
    const juli = await maakVersie('2026-07-05');
    await upload({ filename: 'juni.pdf' });
    const lijst = (await api('GET', '/api/ritbladen?datum=2026-07-10', { token: 'tok-a' })).json;
    expect(lijst.versie.id).toBe(juli.id);
    expect(lijst.bundel).toBeNull();
    expect(lijst.vorige).toMatchObject({ versie: { id: 'dr-sep' }, bundel: { filename: 'juni.pdf' } });
    expect((await api('GET', '/api/ritblaadje?datum=2026-07-10', { token: 'tok-a' })).json).toMatchObject({ filename: 'juni.pdf', terugval: true, versie: { id: 'dr-sep' } });
    // Geen enkele bundel meer: null, zoals vroeger.
    expect((await api('DELETE', '/api/ritblaadje', { token: 'tok-admin' })).status).toBe(200);
    expect((await api('GET', '/api/ritblaadje', { token: 'tok-a' })).json).toBeNull();
    expect((await api('GET', '/api/ritbladen', { token: 'tok-a' })).json.bundels.map((b: any) => b.bundel)).toEqual([null, null]);
    expect(mem.ritbladBestanden).toHaveLength(0);
  });

  it('verwijderen per versie is admin-only, en een verwijderde versie neemt haar bundel mee', async () => {
    const juli = await maakVersie('2026-07-05');
    await upload({ filename: 'juni.pdf' });
    await upload({ filename: 'juli.pdf', melden: false }, juli.id);
    expect((await api('DELETE', `/api/ritblaadje?versie=${juli.id}`, { token: 'tok-planner' })).status).toBe(403);
    expect((await api('DELETE', `/api/ritblaadje?versie=${juli.id}`, { token: 'tok-admin' })).status).toBe(200);
    expect(mem.ritbladen.map((r: any) => r.filename)).toEqual(['juni.pdf']);
    expect((await api('DELETE', '/api/ritblaadje?versie=nope', { token: 'tok-admin' })).status).toBe(404);
    await upload({ filename: 'juli.pdf', melden: false }, juli.id);
    expect(mem.ritbladBestanden).toHaveLength(2);
    expect((await api('DELETE', `/api/dienstregelingen/${juli.id}`, { token: 'tok-admin' })).status).toBe(200);
    expect(mem.ritbladen.map((r: any) => r.filename)).toEqual(['juni.pdf']);
    expect(mem.ritbladBestanden).toHaveLength(1);
    expect(mem.activity.find((a: any) => a.action === 'Dienstregelingversie verwijderd')?.message).toMatch(/diensten en ritbladen zijn mee verwijderd/);
  });
});
