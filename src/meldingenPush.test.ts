// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * De push-laag bewaart élke melding in public.meldingen — óók zonder
 * VAPID-sleutels (push uit) en óók voor gebruikers zonder abonnement. De
 * melding is de bron, push is het kanaal (meldingencentrum, 06-09).
 */
const mem = vi.hoisted(() => ({
  bewaard: [] as Array<{ userIds: string[]; melding: any }>,
  faalt: false,
}));

vi.mock('../api/db.js', () => ({ db: {}, supabase: null, supabaseAdmin: null }));
vi.mock('../api/storage.js', () => ({
  bewaarMeldingen: vi.fn(async (userIds: string[], melding: any) => {
    if (mem.faalt) throw { code: '42P01', message: 'relation "meldingen" does not exist' };
    mem.bewaard.push({ userIds, melding });
    return userIds.length;
  }),
}));

beforeEach(() => {
  mem.bewaard = [];
  mem.faalt = false;
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
});

describe('sendPushToUsers bewaart de melding', () => {
  it('schrijft één rij per unieke ontvanger, ook zonder VAPID-configuratie', async () => {
    const { sendPushToUsers } = await import('../api/push');
    await sendPushToUsers(['3', '4', '3', ''], { title: 'Verlof goedgekeurd', body: 'Betaald verlof (1–3 jul)', url: '/?view=verlof', soort: 'verlof' });
    expect(mem.bewaard).toEqual([
      { userIds: ['3', '4'], melding: { titel: 'Verlof goedgekeurd', tekst: 'Betaald verlof (1–3 jul)', soort: 'verlof', doel: 'verlof' } },
    ]);
  });

  it('leidt soort en doel af uit de url als de caller ze niet meegeeft', async () => {
    const { sendPushToUsers } = await import('../api/push');
    await sendPushToUsers(['9'], { title: 'Toestel goedgekeurd', body: 'Dit toestel heeft toegang.', url: '/' });
    expect(mem.bewaard[0].melding).toMatchObject({ soort: 'systeem', doel: null });
  });

  it('doet niets zonder ontvangers en breekt niet op een ontbrekende tabel', async () => {
    const { sendPushToUsers } = await import('../api/push');
    await sendPushToUsers([], { title: 'x', body: 'y' });
    expect(mem.bewaard).toEqual([]);
    mem.faalt = true;
    const stil = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(sendPushToUsers(['3'], { title: 'x', body: 'y' })).resolves.toBeUndefined();
    stil.mockRestore();
  });
});
