/**
 * Gele boek en werkprestaties tegen een echte database (15-10): PostgREST geeft
 * hoogstens 1000 rijen per antwoord. Tot nu toe stond er een `limit` van 2000
 * (defecten, "Alles") en 5000 (werkprestaties, een kwartaal van de garage) op
 * één vraag, en kapte het antwoord stil af op 1000. De lezers lopen nu per
 * pagina tot hun grens.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../api/db';
import { getDefecten, getWerkprestaties } from '../api/_lib/techniekStorage';
import { leegDatabase } from './hulp';

/** De techniek-tabellen staan niet in leegDatabase: hier zelf, kinderen eerst. */
const leegTechniek = async () => {
  for (const tabel of ['vehicle_work', 'vehicle_defects', 'vehicles']) {
    const { error } = await db!.from(tabel).delete().not('id', 'is', null);
    if (error) throw new Error(`${tabel} leegmaken: ${error.message}`);
  }
};

const inStukken = async (tabel: string, rijen: Record<string, unknown>[]) => {
  for (let i = 0; i < rijen.length; i += 500) {
    const { error } = await db!.from(tabel).insert(rijen.slice(i, i + 500));
    if (error) throw new Error(`${tabel} vullen: ${error.message}`);
  }
};

beforeEach(async () => {
  await leegDatabase();
  await leegTechniek();
});

describe('lezen voorbij 1000 rijen', () => {
  it('werkprestaties: alles tot de grens, nieuwste dag eerst', async () => {
    await inStukken('vehicle_work', Array.from({ length: 1205 }, (_, i) => ({
      datum: i < 5 ? '2026-10-02' : '2026-10-01', mecanicien_id: 'm1', werkcode: 'H', omschrijving: `werk ${i}`, werkuren: 1,
    })));
    const alles = await getWerkprestaties({ limit: 5000 });
    expect(alles).toHaveLength(1205);
    expect(new Set(alles.map((w) => w.id)).size).toBe(1205);
    expect(alles.slice(0, 5).every((w) => w.datum === '2026-10-02')).toBe(true);
    expect(await getWerkprestaties({ limit: 1100 })).toHaveLength(1100);
  });

  it('defecten: "Alles" geeft meer dan 1000 meldingen, tot de grens van 2000', async () => {
    const { data: bus, error } = await db!.from('vehicles').insert({ busnr: 'T-1', type: 'lijnbus' }).select('id').single();
    if (error) throw error;
    await inStukken('vehicle_defects', Array.from({ length: 1103 }, (_, i) => ({
      vehicle_id: bus!.id, gemeld_door: 'c1', werktype: 'T', omschrijving: `defect ${i}`, status: i % 2 ? 'uitgevoerd' : 'open',
    })));
    expect(await getDefecten({ status: 'alles', limit: 2000 })).toHaveLength(1103);
    expect(await getDefecten({ status: 'open', limit: 2000 })).toHaveLength(552);
  });
});
