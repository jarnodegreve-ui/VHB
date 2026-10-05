/**
 * Het schema dat de migraties opbouwen (supabase/volgorde.json) is het schema
 * dat de code verwacht. Dezelfde probes als GET /api/health/schema, maar hier
 * tegen een lege database die alleen uit de repo is opgebouwd: een kolom of
 * functie die de code gebruikt en geen migratie heeft, faalt in de PR en niet
 * pas in productie.
 */
import { describe, expect, it } from 'vitest';
import { db } from '../api/db';
import { RPC_PROBES, TABLE_PROBES } from '../api/schemaProbes';
import { isMissingDbFunction } from '../api/storage';

describe('schema uit de migraties', () => {
  it('praat met de lokale database', () => {
    expect(db).not.toBeNull();
  });

  it.each(TABLE_PROBES)('tabel $table heeft de kolommen die de code leest en schrijft', async ({ table, columns }) => {
    const { error } = await db!.from(table).select(columns).limit(0);
    expect(error?.message ?? null).toBeNull();
  });

  it.each(RPC_PROBES)('functie $name bestaat', async ({ name, args }) => {
    const { error } = await db!.rpc(name, args);
    expect(error ? isMissingDbFunction(error) : false).toBe(false);
  });
});
