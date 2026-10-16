/**
 * Dienstruil tegen een echte database: de voorwaardelijke statuswissel
 * (compare-and-set), de insert die een bestaand id weigert, en het
 * doorvoeren en terugdraaien van een ruil in de planning.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applySwapToPlanning, getSwapsArchief, getSwapsData, getSwapsOpDienstdag, getSwapsVenster, replacePlanningData, revertSwapFromPlanning,
  schrijfSwapAlsStatus, swapToestandInPlanning, voegSwapsToe,
} from '../api/storage';
import { archiefVolgorde, ruilInVenster } from '../shared/ruilVenster';
import { dienst, leegDatabase, planningKort } from './hulp';

beforeEach(leegDatabase);

const ruil = {
  id: 'r1', shiftId: 's1', requesterId: 'c1', targetDriverId: 'c2', status: 'accepted' as const,
  createdAt: '2026-11-01T08:00:00.000Z', reason: 'Tandarts', swapType: 'ruil' as const,
  shiftDate: '2026-11-10', shiftLine: '2501', returnDate: '2026-11-12', returnCode: '2502',
};

describe('ruil opslaan', () => {
  it('leest terug wat er geschreven is, veld voor veld', async () => {
    await voegSwapsToe([ruil]);
    const [terug] = await getSwapsData();
    expect(terug).toMatchObject(ruil);
  });

  it('een tweede insert met hetzelfde id overschrijft niets', async () => {
    await voegSwapsToe([ruil]);
    await expect(voegSwapsToe([{ ...ruil, reason: 'Andere reden' }])).rejects.toMatchObject({ code: '23505' });
    expect((await getSwapsData())[0].reason).toBe('Tandarts');
  });

  it('statuswissel slaagt alleen vanaf de status die de handler las', async () => {
    await voegSwapsToe([ruil]);
    expect(await schrijfSwapAlsStatus({ ...ruil, status: 'approved', decidedAt: '2026-11-02T09:00:00.000Z' }, 'accepted')).toBe(true);
    // De chauffeur trok intussen in op basis van de oude stand: geen rij geraakt.
    expect(await schrijfSwapAlsStatus({ ...ruil, status: 'cancelled' }, 'accepted')).toBe(false);
    const [terug] = await getSwapsData();
    expect(terug.status).toBe('approved');
    expect(terug.decidedAt).toBe('2026-11-02T09:00:00.000Z');
  });
});

describe('ruil doorvoeren in de planning', () => {
  const planning = () => replacePlanningData([
    dienst({ id: 'a', date: '2026-11-10', line: '2501', driverId: 'c1' }),
    // Gesplitste dienst: twee rijen, één dienst.
    dienst({ id: 'a2', date: '2026-11-10', line: '2501', driverId: 'c1', startTime: '16:00', endTime: '19:00' }),
    dienst({ id: 'b', date: '2026-11-12', line: '2502', driverId: 'c2' }),
    dienst({ id: 'c', date: '2026-11-12', line: '2599', driverId: 'c3' }),
  ]);

  it('1-op-1: beide benen verhuizen, een derde blijft waar hij is', async () => {
    await planning();
    expect(await swapToestandInPlanning(ruil)).toBe('niet_doorgevoerd');
    expect(await applySwapToPlanning(ruil)).toEqual({ offeredMoved: 2, returnMoved: 1 });
    expect(await planningKort()).toEqual([
      '2026-11-10 2501 c2', '2026-11-10 2501 c2', '2026-11-12 2502 c1', '2026-11-12 2599 c3',
    ]);
    expect(await swapToestandInPlanning(ruil)).toBe('doorgevoerd');
  });

  it('een tweede keer doorvoeren verplaatst niets meer', async () => {
    await planning();
    await applySwapToPlanning(ruil);
    expect(await applySwapToPlanning(ruil)).toEqual({ offeredMoved: 0, returnMoved: 0 });
    expect(await swapToestandInPlanning(ruil)).toBe('doorgevoerd');
  });

  it('terugdraaien zet de planning exact terug', async () => {
    await planning();
    const voor = await planningKort();
    await applySwapToPlanning(ruil);
    expect(await revertSwapFromPlanning(ruil)).toEqual({ offeredMoved: 2, returnMoved: 1 });
    expect(await planningKort()).toEqual(voor);
  });

  it('overname: alleen de aangeboden dienst verhuist', async () => {
    await planning();
    const overname = { ...ruil, swapType: 'overname' as const, returnDate: undefined, returnCode: undefined };
    expect(await applySwapToPlanning(overname)).toEqual({ offeredMoved: 2, returnMoved: null });
    expect(await planningKort()).toContain('2026-11-12 2502 c2');
  });

  it('alleen het aangeboden been: de terugdienst blijft staan', async () => {
    await planning();
    expect(await applySwapToPlanning(ruil, { aangeboden: true, terug: false })).toEqual({ offeredMoved: 2, returnMoved: 0 });
    expect(await planningKort()).toContain('2026-11-12 2502 c2');
    // Half doorgevoerd is geen van beide eindstanden.
    expect(await swapToestandInPlanning(ruil)).toBe('onbekend');
  });
});

/**
 * Het venster en het archief (15-10): de filters staan als PostgREST-tekst in
 * api/_lib/opslag/ruilen.ts (één `or`, een geneste `and` voor het archief).
 * Hier tegen een echte database, en telkens gelijk aan de regel in JS
 * (shared/ruilVenster.ts), want de route legt die er als vangnet over.
 */
describe('ruilen: venster en archief', () => {
  const GRENS = '2026-03-01';
  const basis = { shiftId: 's', requesterId: 'c1', targetDriverId: 'c2', reason: '', swapType: 'ruil' as const, returnCode: 'vrij' };
  const ruilen = [
    { ...basis, id: 'open-oud', status: 'approved' as const, createdAt: '2026-01-02T08:00:00.000Z', decidedAt: '2026-01-03T08:00:00.000Z', shiftDate: '2026-01-15' },
    { ...basis, id: 'recent', status: 'rejected' as const, createdAt: '2026-03-01T00:30:00.000Z', decidedAt: '2026-03-02T08:00:00.000Z', shiftDate: '2026-02-20' },
    { ...basis, id: 'komend', status: 'completed' as const, createdAt: '2026-01-05T08:00:00.000Z', decidedAt: '2026-01-06T08:00:00.000Z', shiftDate: '2026-07-05' },
    { ...basis, id: 'terug-komend', status: 'completed' as const, createdAt: '2026-01-05T09:00:00.000Z', decidedAt: '2026-01-06T09:00:00.000Z', shiftDate: '2026-01-20', returnDate: '2026-03-04', returnCode: '2502' },
    { ...basis, id: 'laat-beslist', status: 'rejected' as const, createdAt: '2026-01-20T08:00:00.000Z', decidedAt: '2026-03-05T08:00:00.000Z', shiftDate: '2026-01-25' },
    { ...basis, id: 'oud', status: 'rejected' as const, createdAt: '2026-01-10T08:00:00.000Z', decidedAt: '2026-01-11T08:00:00.000Z', shiftDate: '2026-01-20' },
    { ...basis, id: 'oud-zonder-datum', status: 'cancelled' as const, createdAt: '2026-02-27T08:00:00.000Z' },
    { ...basis, id: 'ouder', requesterId: 'c3', targetDriverId: 'c1', status: 'cancelled' as const, createdAt: '2025-12-01T08:00:00.000Z', decidedAt: '2025-12-02T08:00:00.000Z', shiftDate: '2025-12-10' },
  ];

  it('het venster is precies wat de regel in JS zegt, en het archief de rest', async () => {
    await voegSwapsToe(ruilen);
    const venster = (await getSwapsVenster(GRENS)).map((s) => s.id).sort();
    expect(venster).toEqual(['komend', 'laat-beslist', 'open-oud', 'recent', 'terug-komend']);
    expect(venster).toEqual(ruilen.filter((r) => ruilInVenster(r, GRENS)).map((r) => r.id).sort());
    const { ruilen: archief, totaal } = await getSwapsArchief({ grens: GRENS, vanaf: 0, aantal: 10 });
    expect(totaal).toBe(3);
    // Het jongste beslismoment eerst; zonder beslismoment achteraan.
    expect(archief.map((s) => s.id)).toEqual(['oud', 'ouder', 'oud-zonder-datum']);
    expect(archief.map((s) => s.id)).toEqual([...ruilen].filter((r) => !ruilInVenster(r, GRENS)).sort(archiefVolgorde).map((r) => r.id));
  });

  it('per pagina, per persoon en vanaf een dag', async () => {
    await voegSwapsToe(ruilen);
    expect((await getSwapsArchief({ grens: GRENS, vanaf: 1, aantal: 1 })).ruilen.map((s) => s.id)).toEqual(['ouder']);
    expect((await getSwapsArchief({ grens: GRENS, vanaf: 0, aantal: 10, persoonId: 'c3' })).ruilen.map((s) => s.id)).toEqual(['ouder']);
    expect((await getSwapsArchief({ grens: GRENS, vanaf: 0, aantal: 10, aanvragerId: 'c1' })).totaal).toBe(2);
    const sinds = await getSwapsArchief({ grens: GRENS, vanaf: 0, aantal: 10, sinds: '2026-01-01' });
    expect(sinds.ruilen.map((s) => s.id)).toEqual(['oud', 'oud-zonder-datum']);
    expect((await getSwapsArchief({ grens: GRENS, vanaf: 0, aantal: 1, persoonId: 'c2' })).totaal).toBe(2);
  });

  it('een pagina voorbij het einde is leeg, met het actuele totaal (geen fout)', async () => {
    await voegSwapsToe(ruilen);
    expect(await getSwapsArchief({ grens: GRENS, vanaf: 50, aantal: 10 })).toEqual({ ruilen: [], totaal: 3 });
    expect(await getSwapsArchief({ grens: GRENS, vanaf: 3, aantal: 10 })).toEqual({ ruilen: [], totaal: 3 });
  });

  it('venster en archief samen zijn elke ruil precies één keer', async () => {
    await voegSwapsToe(ruilen);
    const venster = (await getSwapsVenster(GRENS)).map((s) => s.id);
    const archief = (await getSwapsArchief({ grens: GRENS, vanaf: 0, aantal: 50 })).ruilen.map((s) => s.id);
    expect([...venster, ...archief].sort()).toEqual((await getSwapsData()).map((s) => s.id).sort());
  });
});

// Ruiloverzicht op dienstdatum (16-10): shift_date is tekst, dus de
// tekstvergelijking in de query moet de datumvergelijking zijn, randen inbegrepen.
describe('ruilen op dienstdatum', () => {
  it('precies de ruilen met een dienst in [van, tot], randen inbegrepen, oplopend; zonder dienstdatum nooit', async () => {
    const basis = { shiftId: 's', requesterId: 'c1', targetDriverId: 'c2', reason: '', swapType: 'ruil' as const, status: 'approved' as const, createdAt: '2026-10-01T08:00:00.000Z' };
    await voegSwapsToe([
      { ...basis, id: 'b', shiftDate: '2026-11-30' },
      { ...basis, id: 'a', shiftDate: '2026-11-01' },
      { ...basis, id: 'midden', shiftDate: '2026-11-15' },
      { ...basis, id: 'ervoor', shiftDate: '2026-10-31' },
      { ...basis, id: 'erna', shiftDate: '2026-12-01' },
      { ...basis, id: 'zonder-datum' },
    ]);
    expect((await getSwapsOpDienstdag('2026-11-01', '2026-11-30')).map((s) => s.id)).toEqual(['a', 'midden', 'b']);
  });
});
