/**
 * Ritbladen per dienstregelingversie (13-10): de migratie laat de check
 * "precies één rij" los, hangt een bundel aan een versie (hoogstens één per
 * versie) en ruimt de rij op wanneer de versie verdwijnt. Met een nagebootste
 * opslag is een constraint of een cascade niet te bewijzen; hier wel.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createDienstregeling, deleteDienstregeling, getRitbladRijen, saveRitbladRij, deleteRitbladRij } from '../api/storage';
import { leegDatabase } from './hulp';

beforeEach(leegDatabase);

const rij = (id: string, filename: string, dienstregelingId: string | null) => ({
  id, filename, storagePath: `${id}-x.pdf`, uploadedAt: '2026-10-13T10:00:00Z', uploadedBy: null, sizeBytes: 1, dienstregelingId,
});

describe('ritblaadje per versie', () => {
  it('meer dan één rij, één bundel per versie, en een verwijderde versie neemt haar rij mee', async () => {
    const sep = await createDienstregeling({ naam: 'september', geldigVanaf: '2026-09-01', opmerking: null, createdBy: null, kopieVanId: null });
    const jan = await createDienstregeling({ naam: 'januari', geldigVanaf: '2027-01-01', opmerking: null, createdBy: null, kopieVanId: null });
    await saveRitbladRij(rij('current', 'sep.pdf', sep.id));
    await saveRitbladRij(rij(jan.id, 'jan.pdf', jan.id));
    expect((await getRitbladRijen()).map((r) => [r.filename, r.dienstregelingId]).sort()).toEqual([['jan.pdf', jan.id], ['sep.pdf', sep.id]]);
    // Een tweede bundel voor dezelfde versie weigert de unieke index.
    await expect(saveRitbladRij(rij('nog-een', 'jan2.pdf', jan.id))).rejects.toBeTruthy();
    // Dezelfde rij opnieuw schrijven (vervangen) mag.
    await saveRitbladRij({ ...rij(jan.id, 'jan2.pdf', jan.id), storagePath: `${jan.id}-y.pdf` });
    expect((await getRitbladRijen()).find((r) => r.id === jan.id)?.filename).toBe('jan2.pdf');
    await deleteDienstregeling(jan.id);
    expect((await getRitbladRijen()).map((r) => r.filename)).toEqual(['sep.pdf']);
    await deleteRitbladRij('current');
    expect(await getRitbladRijen()).toEqual([]);
  });

  it('een rij zonder versie blijft mogelijk (de stand van vóór de migratie)', async () => {
    await saveRitbladRij(rij('current', 'oud.pdf', null));
    expect((await getRitbladRijen())[0]).toMatchObject({ id: 'current', dienstregelingId: null });
  });
});
