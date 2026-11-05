import { describe, expect, it } from 'vitest';
import { toekomstOpNaam, uitDienstWaarschuwing } from './uitDienstWaarschuwing';

const rij = (driverId: string, date: string, line: string) => ({ driverId, date, line });
const ruil = (requesterId: string, targetDriverId: string | undefined, status: 'pending' | 'accepted' | 'approved' | 'rejected' | 'completed' | 'cancelled') => ({ requesterId, targetDriverId, status });

describe('toekomstOpNaam', () => {
  it('telt diensten vanaf vandaag op naam, een gesplitste dienst één keer, het verleden en anderen niet', () => {
    const t = toekomstOpNaam(
      [rij('3', '2026-11-20', '2116'), rij('3', '2026-11-20', '2116'), rij('3', '2026-11-22', 'R12'), rij('3', '2026-11-04', '2101'), rij('4', '2026-11-21', '2300')],
      [],
      '3',
      '2026-11-05',
    );
    expect(t).toEqual({ diensten: 2, eerste: '2026-11-20', openRuilen: 0 });
  });

  it('vandaag telt mee; open ruilen zijn pending en accepted, als aanvrager of als collega', () => {
    const t = toekomstOpNaam(
      [rij('3', '2026-11-05', '2116')],
      [ruil('3', '4', 'pending'), ruil('4', '3', 'accepted'), ruil('4', '3', 'approved'), ruil('3', undefined, 'rejected'), ruil('4', '5', 'pending')],
      '3',
      '2026-11-05',
    );
    expect(t).toEqual({ diensten: 1, eerste: '2026-11-05', openRuilen: 2 });
  });
});

describe('uitDienstWaarschuwing', () => {
  it('niets op naam = geen waarschuwing', () => {
    expect(uitDienstWaarschuwing({ diensten: 0, eerste: null, openRuilen: 0 })).toBeNull();
  });

  it('diensten en ruilen, met de eerste dag als dd/mm/jjjj', () => {
    expect(uitDienstWaarschuwing({ diensten: 3, eerste: '2026-11-20', openRuilen: 1 }))
      .toBe('staat nog op 3 diensten vanaf vandaag (eerste 20/11/2026) en in 1 open ruilverzoek. De diensten blijven op naam staan en verschijnen in Openstaande diensten.');
    expect(uitDienstWaarschuwing({ diensten: 1, eerste: '2026-11-05', openRuilen: 0 }))
      .toBe('staat nog op 1 dienst vanaf vandaag (eerste 05/11/2026). De diensten blijven op naam staan en verschijnen in Openstaande diensten.');
  });

  it('alleen open ruilen', () => {
    expect(uitDienstWaarschuwing({ diensten: 0, eerste: null, openRuilen: 2 }))
      .toBe('staat nog in 2 open ruilverzoeken. Die blijven open tot iemand ze afwijst.');
  });
});
