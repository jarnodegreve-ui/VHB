import { describe, expect, it } from 'vitest';
import { nieuwsRolVan, ongezienNieuws, WAT_IS_NIEUW, type WatIsNieuwItem } from './watIsNieuw';

const items: WatIsNieuwItem[] = [
  { id: '2026-09-10', titel: 'B', regels: { staf: ['x'] } },
  { id: '2026-09-04', titel: 'A', regels: { chauffeur: ['y'], staf: ['z'] } },
];

describe('ongezienNieuws', () => {
  it('geeft het nieuwste item met regels voor de rol', () => {
    expect(ongezienNieuws('staf', null, items)?.id).toBe('2026-09-10');
    expect(ongezienNieuws('chauffeur', null, items)?.id).toBe('2026-09-04');
  });
  it('verbergt alles tot en met het geziene id', () => {
    expect(ongezienNieuws('staf', '2026-09-10', items)).toBeNull();
    expect(ongezienNieuws('staf', '2026-09-04', items)?.id).toBe('2026-09-10');
    expect(ongezienNieuws('chauffeur', '2026-09-04', items)).toBeNull();
  });
  it('rolt de app-rollen op naar chauffeur/staf', () => {
    expect(nieuwsRolVan('driver')).toBe('chauffeur');
    expect(nieuwsRolVan('planner')).toBe('staf');
    expect(nieuwsRolVan('admin')).toBe('staf');
  });
  it('houdt de echte lijst nieuwste-eerst en met geldige ISO-ids', () => {
    const ids = WAT_IS_NIEUW.map((i) => i.id);
    expect(ids.every((id) => /^\d{4}-\d{2}-\d{2}$/.test(id))).toBe(true);
    expect([...ids].sort().reverse()).toEqual(ids);
  });
});
