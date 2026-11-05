// @vitest-environment node
import {
  api,
  mem,
} from './harnas';
import { describe, it, expect } from 'vitest';

// De dienstopbouw draait hier integraal (api/_lib/dienstStorage.ts tegen de
// mini-PostgREST van het harnas, die zoals de echte op 1000 rijen per
// antwoord kapt).
describe('dienstopbouw: ritdelen voorbij de PostgREST-cap', () => {
  const ritdeel = (i: number) => ({
    id: `seg-${String(i).padStart(4, '0')}`, import_id: 'imp-1',
    // 100 diensten × 12 à 13 delen, over twee dagtypes: de sortering in de
    // query (dagtype, dienst, volgorde, id) heeft dus echte tiebreaks nodig.
    service_number: String(4100 + (i % 100)), dagtype_code: i % 2 ? 'W' : 'Z', volgorde: Math.floor(i / 100),
    type: 'rit', start_min: 300 + i, einde_min: 330 + i, duur_min: 30, loop: null, intern_loop: null, lijn: '12', variant: null,
    rit: null, voertuig: null, vertrek: null, vertrek_code: null, aankomst: null, aankomst_code: null, afstand_km: null, at_tijd: null, vt_tijd: null,
  });

  it('geeft alle 1234 ritdelen van de echte ET-export 2026 terug, niet de eerste 1000', async () => {
    mem.loonRijen.service_segment_imports = [{ id: 'imp-1', created_at: '2026-06-01T08:00:00Z', imported_by: '2', filename: 'et.xlsx', rijen: 1234, diensten: 100, dagtypes: ['W', 'Z'], waarschuwingen: [], bevindingen: [], actief: true, actief_sinds: '2026-06-01T08:00:00Z' }];
    mem.loonRijen.service_segments = Array.from({ length: 1234 }, (_, i) => ritdeel(i));
    const res = await api('GET', '/api/dienstopbouw/segmenten?importId=imp-1', { token: 'tok-planner' });
    expect(res.status).toBe(200);
    expect(res.json.segmenten).toHaveLength(1234);
    expect(new Set(res.json.segmenten.map((s: any) => s.id)).size).toBe(1234);
    // Een filter blijft een filter in de query, ook met paginering.
    const een = await api('GET', '/api/dienstopbouw/segmenten?importId=imp-1&serviceNumber=4107&dagtype=W', { token: 'tok-planner' });
    expect(een.json.segmenten.map((s: any) => s.serviceNumber)).toEqual(Array(13).fill('4107'));
  });
});
