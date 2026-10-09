import { describe, expect, it } from 'vitest';
import { dienstenVerschillenVoorPlanning } from '../api/_lib/planningHeropbouw';

/**
 * "Is het dienstoverzicht inhoudelijk gewijzigd?" beslist of de planning na
 * een save automatisch mee bijgewerkt wordt. Sinds 10-10 tellen de
 * afwijkingen per dagtype mee: een gewijzigde woensdagtijd van een schoolrit
 * moet de planning net zo goed bijwerken als een gewone tijd.
 */
const basis = { id: 'a', serviceNumber: 'EEK6', startTime: '07:10', endTime: '08:40', startTime2: '15:20', endTime2: '16:50' };
const wo = { dagtypes: ['23'], startTime: '07:10', endTime: '08:40', startTime2: '11:50', endTime2: '13:20' };

describe('dienstenVerschillenVoorPlanning met afwijkingen per dagtype', () => {
  it('een afwijking erbij, gewijzigd of weg is een verschil', () => {
    expect(dienstenVerschillenVoorPlanning([basis], [{ ...basis, varianten: [wo] }])).toBe(true);
    expect(dienstenVerschillenVoorPlanning([{ ...basis, varianten: [wo] }], [{ ...basis, varianten: [{ ...wo, endTime2: '13:30' }] }])).toBe(true);
    expect(dienstenVerschillenVoorPlanning([{ ...basis, varianten: [wo] }], [basis])).toBe(true);
  });

  it('dezelfde afwijkingen, ook in een andere volgorde of met een verse id, zijn geen verschil', () => {
    const do_ = { dagtypes: ['24'], startTime: '07:10', endTime: '08:40' };
    expect(dienstenVerschillenVoorPlanning([{ ...basis, varianten: [wo, do_] }], [{ ...basis, id: 'b', varianten: [do_, wo] }])).toBe(false);
    expect(dienstenVerschillenVoorPlanning([basis], [{ ...basis, varianten: null }])).toBe(false);
  });
});
