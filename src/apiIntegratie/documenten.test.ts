// @vitest-environment node
import { api, mem } from './harnas';
import { describe, expect, it } from 'vitest';

/**
 * Ritbladbundel (documentRoutes): sinds 09-10 krijgen de actieve chauffeurs
 * één melding zodra een admin een nieuwe bundel oplaadt (keuze Jarno, punt 3
 * van de verbeterronde). Storage en de tabel komen hier uit een kleine mock
 * van supabaseAdmin; de PDF is bewust geen echte (de titel-stap valt dan
 * stil terug op het origineel).
 */
describe('ritbladbundel vervangen', () => {
  const metStorage = () => {
    const geupload: string[] = [];
    mem.supabaseAdmin = {
      storage: {
        from: () => ({
          upload: async (pad: string) => { geupload.push(pad); return { error: null }; },
          remove: async () => ({ error: null }),
          createSignedUrl: async () => ({ data: { signedUrl: 'https://storage.test/ritblad.pdf' }, error: null }),
        }),
      },
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        upsert: async () => ({ error: null }),
      }),
    };
    return geupload;
  };
  const body = { filename: 'ritblad.pdf', dataUrl: `data:application/pdf;base64,${Buffer.from('%PDF-1.4 proef').toString('base64')}` };

  it('is voor admins en pusht "Nieuwe ritbladen" naar de actieve chauffeurs', async () => {
    const geupload = metStorage();
    mem.users = mem.users.map((u: any) => (u.id === '4' ? { ...u, isActive: false } : u));
    mem.pushesSent = [];
    expect((await api('POST', '/api/ritblaadje', { token: 'tok-planner', body })).status).toBe(403);
    const res = await api('POST', '/api/ritblaadje', { token: 'tok-admin', body });
    expect(res.status).toBe(200);
    expect(res.json.filename).toBe('ritblad.pdf');
    expect(geupload).toHaveLength(1);
    const push = mem.pushesSent.find((p) => p.payload.title === 'Nieuwe ritbladen');
    expect(push?.userIds).toEqual(['3']);
    expect(push?.payload).toMatchObject({ soort: 'planning', url: '/?view=ritbladen' });
    expect(push?.payload.body).toBe('De ritbladbundel is vervangen. Open Ritbladen voor het blad van je dienst.');
    expect(mem.activity.some((a: any) => a.action === 'Ritblaadje vervangen')).toBe(true);
  });
});
