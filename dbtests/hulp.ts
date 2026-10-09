/**
 * Hulp voor de databasetests: een lege stand vóór elke test en kleine
 * bouwstenen. Alles loopt via de echte client uit api/db.ts (service role),
 * tegen de lokale Supabase uit vitest.db.config.ts.
 */
import { db, supabaseAdmin } from '../api/db';
import type { PlanningMatrixRow, ShiftRecord } from '../api/types';

/** Tabel + een kolom die nooit null is: PostgREST wist niet zonder filter. */
const TE_LEGEN: Array<[tabel: string, kolom: string]> = [
  ['swaps', 'id'],
  ['leave', 'id'],
  ['planning', 'id'],
  ['planning_matrix_rows', 'id'],
  ['services', 'id'],
  // Na services (FK met cascade): de dienstregelingversies van dbtests/diensten.test.ts.
  ['dienstregelingen', 'id'],
  ['diversions', 'id'],
  ['updates', 'id'],
  ['planning_codes', 'code'],
  ['coverage_expectations', 'day_type'],
  ['activity_log', 'category'],
  ['users', 'id'],
];

export const leegDatabase = async () => {
  for (const [tabel, kolom] of TE_LEGEN) {
    const { error } = await db!.from(tabel).delete().not(kolom, 'is', null);
    if (error) throw new Error(`${tabel} leegmaken: ${error.message}`);
  }
  const { data } = await supabaseAdmin!.auth.admin.listUsers({ page: 1, perPage: 1000 });
  for (const u of data?.users ?? []) await supabaseAdmin!.auth.admin.deleteUser(u.id);
};

export const dienst = (o: Partial<ShiftRecord> & Pick<ShiftRecord, 'id' | 'date' | 'line' | 'driverId'>): ShiftRecord => ({
  startTime: '06:00', endTime: '14:00', busNumber: '', loopnr: '', ...o,
});

export const matrixRij = (datum: string, assignments: Record<string, string>): PlanningMatrixRow => ({
  id: `m-${datum}`, source_date: datum, day_type: 'week', assignments, raw_row: '',
});

export const gebruiker = (id: string, role: 'chauffeur' | 'planner' | 'admin', naam: string) => ({
  id, name: naam, role, email: `${id}@dbtest.vhb.test`, employeeId: id, isActive: true,
});

export const planningVersie = async (): Promise<number> => {
  const { data, error } = await db!.from('planning_version').select('version').limit(1).maybeSingle();
  if (error) throw error;
  return Number((data as { version: number }).version);
};

/** De planning als gesorteerde lijst "datum dienst chauffeur", om te vergelijken. */
export const planningKort = async (): Promise<string[]> => {
  const { data, error } = await db!.from('planning').select('date,line,driverId');
  if (error) throw error;
  return (data ?? []).map((r: any) => `${r.date} ${r.line} ${r.driverId}`).sort();
};
