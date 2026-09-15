// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  formatteerDiff,
  heeftDrift,
  normaliseer,
  platMaken,
  serialiseer,
  sleutelVan,
  vergelijk,
} from '../../scripts/beleid-drift-kern.mjs';

/**
 * Zuivere kern van scripts/beleid-drift.mjs (verbeterronde 07-09, nr. 10):
 * het document van public.security_snapshot() normaliseren en vergelijken.
 * De fetch en het bestand zitten in het script zelf en blijven hier buiten.
 */

const ruw = () => ({
  versie: 1,
  tabellen: [
    { tabel: 'users', rls: true, force_rls: false },
    { tabel: 'leave', rls: true, force_rls: false },
  ],
  policies: [
    {
      schema: 'public',
      tabel: 'planning',
      policy: 'planning_read_authenticated',
      permissive: 'PERMISSIVE',
      cmd: 'SELECT',
      rollen: ['authenticated'],
      using: '( SELECT\n   public.is_active_app_user()   AS is_active_app_user)',
      with_check: null as string | null,
    },
    {
      schema: 'realtime',
      tabel: 'messages',
      policy: 'vhb_aanwezigheid_staf_lezen',
      permissive: 'PERMISSIVE',
      cmd: 'SELECT',
      rollen: ['authenticated'],
      using: "(realtime.topic() = 'vhb-aanwezigheid')",
      with_check: null as string | null,
    },
  ],
  grants: [
    { tabel: 'users', grantee: 'service_role', privilege: 'SELECT', grantable: false },
    { tabel: 'users', grantee: 'anon', privilege: 'SELECT', grantable: false },
  ],
  functies: [
    {
      functie: 'current_app_user_role()',
      security_definer: true,
      definitie: 'CREATE OR REPLACE FUNCTION public.current_app_user_role()\n RETURNS text\n  SET search_path TO \'\'\nAS $function$\n  select role from public.users\n$function$',
      execute: ['authenticated', 'anon'],
    },
  ],
});

describe('normaliseer', () => {
  it('sorteert records op sleutel en velden alfabetisch', () => {
    const n = normaliseer(ruw());
    expect(n.tabellen.map((t) => t.tabel)).toEqual(['leave', 'users']);
    expect(n.grants.map((g) => g.grantee)).toEqual(['anon', 'service_role']);
    expect(Object.keys(n.policies[0])).toEqual(['cmd', 'permissive', 'policy', 'rollen', 'schema', 'tabel', 'using', 'with_check']);
  });

  it('trekt whitespace in SQL-tekst samen en sorteert rollenlijsten', () => {
    const n = normaliseer(ruw());
    expect(n.policies[0].using).toBe('( SELECT public.is_active_app_user() AS is_active_app_user)');
    expect(n.functies[0].definitie).not.toContain('\n');
    expect(n.functies[0].execute).toEqual(['anon', 'authenticated']);
  });

  it('is idempotent en verdraagt ontbrekende secties', () => {
    const een = normaliseer(ruw());
    expect(normaliseer(een)).toEqual(een);
    const leeg = normaliseer({ versie: 1 });
    expect(leeg).toEqual({ versie: 1, tabellen: [], policies: [], grants: [], functies: [] });
  });

  it('weigert iets dat geen document is', () => {
    expect(() => normaliseer(null)).toThrow();
    expect(() => normaliseer({ tabellen: 'nee' })).toThrow();
    expect(() => normaliseer({ tabellen: [1] })).toThrow();
  });
});

describe('sleutelVan en platMaken', () => {
  it('geeft per sectie een leesbare, unieke sleutel', () => {
    expect(sleutelVan('policies', { schema: 'public', tabel: 'leave', policy: 'x' })).toBe('policy public.leave › x');
    expect(sleutelVan('grants', { tabel: 'users', grantee: 'anon', privilege: 'SELECT' })).toBe('grant users › anon › SELECT');
    expect(() => sleutelVan('onbekend', {})).toThrow();
  });

  it('nummert een dubbele sleutel in plaats van te overschrijven', () => {
    const n = normaliseer({ grants: [
      { tabel: 'users', grantee: 'anon', privilege: 'SELECT', grantable: false },
      { tabel: 'users', grantee: 'anon', privilege: 'SELECT', grantable: true },
    ] });
    expect([...platMaken(n).keys()]).toEqual(['grant users › anon › SELECT', 'grant users › anon › SELECT #2']);
  });
});

describe('vergelijk', () => {
  it('ziet geen drift bij alleen andere volgorde of whitespace', () => {
    const a = normaliseer(ruw());
    const b = ruw();
    b.tabellen.reverse();
    b.policies[0].using = '(SELECT public.is_active_app_user() AS is_active_app_user)'.replace('(SELECT', '( SELECT');
    b.functies[0].execute = ['anon', 'authenticated'];
    const diff = vergelijk(a, normaliseer(b));
    expect(heeftDrift(diff)).toBe(false);
  });

  it('meldt toegevoegd, verwijderd en gewijzigd met oude en nieuwe waarde', () => {
    const oud = normaliseer(ruw());
    const b = ruw();
    b.tabellen[0].rls = false; // users: RLS uit
    b.grants.splice(1, 1); // anon-grant weg
    b.policies.push({ schema: 'public', tabel: 'leave', policy: 'leave_alles', permissive: 'PERMISSIVE', cmd: 'ALL', rollen: ['anon'], using: 'true', with_check: 'true' });
    const diff = vergelijk(oud, normaliseer(b));

    expect(heeftDrift(diff)).toBe(true);
    expect(diff.toegevoegd.map((x) => x.sleutel)).toEqual(['policy public.leave › leave_alles']);
    expect(diff.verwijderd.map((x) => x.sleutel)).toEqual(['grant users › anon › SELECT']);
    expect(diff.gewijzigd).toEqual([{ sleutel: 'tabel users', velden: [{ veld: 'rls', oud: true, nieuw: false }] }]);
  });

  it('ziet een veld dat verdwijnt of erbij komt als wijziging', () => {
    const oud = normaliseer(ruw());
    const b = ruw();
    delete (b.functies[0] as { execute?: string[] }).execute;
    const diff = vergelijk(oud, normaliseer(b));
    expect(diff.gewijzigd).toEqual([{ sleutel: 'functie current_app_user_role()', velden: [{ veld: 'execute', oud: ['anon', 'authenticated'], nieuw: undefined }] }]);
  });
});

describe('formatteerDiff', () => {
  it('toont per sleutel +/-/~ en bij een wijziging oud én nieuw', () => {
    const oud = normaliseer(ruw());
    const b = ruw();
    b.tabellen[0].rls = false;
    b.grants.splice(1, 1);
    b.policies.push({ schema: 'public', tabel: 'leave', policy: 'leave_alles', permissive: 'PERMISSIVE', cmd: 'ALL', rollen: ['anon'], using: 'true', with_check: null });
    const tekst = formatteerDiff(vergelijk(oud, normaliseer(b)));

    expect(tekst).toContain('+ policy public.leave › leave_alles');
    expect(tekst).toContain('    rollen: anon');
    expect(tekst).toContain('    with_check: null');
    expect(tekst).toContain('- grant users › anon › SELECT');
    expect(tekst).toContain('~ tabel users');
    expect(tekst).toContain('      oud  : true');
    expect(tekst).toContain('      nieuw: false');
  });

  it('is leeg zonder drift', () => {
    const n = normaliseer(ruw());
    expect(formatteerDiff(vergelijk(n, n))).toBe('');
  });
});

describe('serialiseer', () => {
  it('geeft dezelfde tekst ongeacht invoervolgorde, met afsluitende newline', () => {
    const a = serialiseer(ruw());
    const b = ruw();
    b.tabellen.reverse();
    b.grants.reverse();
    expect(serialiseer(b)).toBe(a);
    expect(a.endsWith('}\n')).toBe(true);
    expect(JSON.parse(a).tabellen[0].tabel).toBe('leave');
  });
});
