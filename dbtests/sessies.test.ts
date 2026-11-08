/**
 * De databasefunctie achter "toestel uitloggen beëindigt de sessie"
 * (supabase/2026-11-07_auth_sessie_beeindigen.sql), tegen een echte
 * lokale Supabase: een echte aanmelding, de sessie weg, het refresh-token
 * werkt niet meer. En de rechten: alleen service_role mag ze aanroepen.
 */
import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { beeindigAuthSessie } from '../api/_lib/storage';
import { db, supabase, supabaseAdmin } from '../api/_lib/db';
import { leegDatabase } from './hulp';

beforeEach(leegDatabase);

const WACHTWOORD = 'Dbtest-wachtwoord-123';

describe('beeindig_auth_sessie', () => {
  it('geeft false voor een onbekende sessie en null voor iets wat geen uuid is', async () => {
    expect(await beeindigAuthSessie(randomUUID())).toBe(false);
    expect(await beeindigAuthSessie('sess-geen-uuid')).toBe(null);
  });

  it('beëindigt een echte sessie: de tweede keer false, en het refresh-token werkt niet meer', async () => {
    const email = `sessie-${Date.now()}@example.com`;
    const { error: maakFout } = await supabaseAdmin!.auth.admin.createUser({ email, password: WACHTWOORD, email_confirm: true });
    expect(maakFout).toBeNull();
    const { data: login, error: loginFout } = await supabase!.auth.signInWithPassword({ email, password: WACHTWOORD });
    expect(loginFout).toBeNull();
    const sessie = login.session!;
    const claims = JSON.parse(Buffer.from(sessie.access_token.split('.')[1], 'base64').toString('utf8')) as { session_id?: string };
    expect(typeof claims.session_id).toBe('string');

    expect(await beeindigAuthSessie(String(claims.session_id))).toBe(true);
    expect(await beeindigAuthSessie(String(claims.session_id))).toBe(false);

    // Het toestel kan niet meer verversen: dat is wat de client afmeldt.
    const { error: verversFout } = await supabase!.auth.refreshSession({ refresh_token: sessie.refresh_token });
    expect(verversFout).not.toBeNull();
    await supabase!.auth.signOut({ scope: 'local' }).catch(() => undefined);
  });

  it('is security definer en alleen voor service_role (niet voor anon of authenticated)', async () => {
    const { data, error } = await db!.rpc('security_snapshot');
    expect(error).toBeNull();
    const functies = (data as { functies: Array<{ functie: string; security_definer: boolean; execute: string[] }> }).functies;
    const f = functies.find((x) => x.functie === 'beeindig_auth_sessie(p_session_id uuid)');
    expect(f).toBeDefined();
    expect(f!.security_definer).toBe(true);
    expect(f!.execute).toEqual([]);
  });
});
