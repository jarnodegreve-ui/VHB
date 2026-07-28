// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { toPublicService, toDatabaseService } from '../api/helpers';

/**
 * De mappers zitten tussen de database en zowel de API-respons als de
 * planning-import. Een veld dat hier ontbreekt verdwijnt stil: de
 * loopnummers kwamen daardoor nooit op een planning-rij terecht, en elk
 * opslaan vanuit het beheerscherm zou ze uit de database gewist hebben.
 *
 * Deze test bewaakt dat elk dienstveld de rondgang db → api → db overleeft.
 */
const DB_ROW = {
  id: '1',
  serviceNumber: '2101',
  startTime: '04:36', endTime: '07:52', loopnr: '4500',
  startTime2: '13:39', endTime2: '17:29', loopnr2: '4611',
  startTime3: '24:10', endTime3: '25:10', loopnr3: '4515',
};

describe('service-mappers behouden alle velden', () => {
  it('toPublicService neemt tijden én loopnummers mee', () => {
    expect(toPublicService(DB_ROW)).toMatchObject({
      serviceNumber: '2101',
      startTime: '04:36', endTime: '07:52', loopnr: '4500',
      startTime2: '13:39', endTime2: '17:29', loopnr2: '4611',
      startTime3: '24:10', endTime3: '25:10', loopnr3: '4515',
    });
  });

  it('db → api → db verliest niets', () => {
    const roundTrip = toDatabaseService(toPublicService(DB_ROW)) as Record<string, unknown>;
    for (const [key, value] of Object.entries(DB_ROW)) {
      expect(roundTrip[key], `veld ${key} ging verloren in de rondgang`).toBe(value);
    }
  });

  it('een dienst zonder loopnummers levert null op, geen ontbrekende kolom', () => {
    const minimal = toDatabaseService(toPublicService({ id: '2', serviceNumber: '4101', startTime: '04:25', endTime: '11:57' }));
    expect(minimal.loopnr).toBeNull();
    expect(minimal.loopnr2).toBeNull();
    expect(minimal.loopnr3).toBeNull();
  });
});
