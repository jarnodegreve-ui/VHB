import type { User as SupabaseAuthUser } from "@supabase/supabase-js";
import type { AppUser, IncomingUser, AppUserIntern } from "../../types.js";
import {
  countAdmins,
  ensureUniqueUserEmails,
  normalizeEmail,
  randomPassword,
  sanitizeIncomingUser,
  toDatabaseUser,
  toPublicUser,
} from "../../helpers.js";
import { supabaseAdmin } from "../../db.js";
import type { DashboardVoorkeuren } from "../../../shared/schemas/dashboardVoorkeuren.js";
import { verwijderInStukken } from "./activiteit.js";
import { isMissingDbFunction, paginatedFetch, requireDb } from "./basis.js";
import { isMissingColumnError } from "./fouten.js";

// --- Users ---

/** Het e-mailadres hoort in Supabase Auth al bij een ánder account dan dat
 *  van dit profiel. De routes vertalen dit naar een 409 (conflict: "email")
 *  — vroeger werd het profiel dan stil aan dat vreemde account gekoppeld
 *  (controle 05-09, nr. 29). */
export class EmailInGebruikError extends Error {
  constructor(public readonly email: string) {
    super("Dit e-mailadres is al in gebruik bij een ander account.");
    this.name = "EmailInGebruikError";
  }
}

export const OOK_TECHNIEKER_MIGRATIE = "supabase/2026-09-28_users_ook_technieker.sql";

/** Een save zet een waarde in een kolom waarvan de migratie nog niet gedraaid
 *  is. De routes geven een 503 met deze tekst; de app herkent het .sql-bestand
 *  erin als "er moet een migratie draaien", niet als onderhoud (src/lib/fouten.ts). */
export class MigratieOntbreektError extends Error {
  constructor(kolom: string, public readonly migratie: string) {
    super(`De kolom ${kolom} bestaat nog niet: draai ${migratie} in de SQL Editor.`);
    this.name = "MigratieOntbreektError";
  }
}

export const getUsersData = async (): Promise<AppUserIntern[]> => {
  const client = requireDb();
  const rows = await paginatedFetch((from, to) =>
    client.from('users').select('*').order('id', { ascending: true }).range(from, to),
  );
  return rows.map(toPublicUser);
};

/** Een net aangemaakt Auth-account: de route stuurt er een welkomstmail
 *  voor, met een uitnodigingslink op dit profiel en account. */
export type NieuwAccount = { email: string; name: string; userId: string; authId?: string };

export const saveUsersData = async (incomingUsers: IncomingUser[]): Promise<{ createdAccounts: NieuwAccount[] }> => {
  // Nieuw aangemaakte Auth-accounts gaan terug naar de route, die er een
  // welkomstmail met een link om het wachtwoord te kiezen voor verstuurt.
  const createdAccounts: NieuwAccount[] = [];
  const client = requireDb();
  if (!supabaseAdmin) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY ontbreekt. Gebruikersbeheer vereist een service role key.");
  }

  ensureUniqueUserEmails(incomingUsers);

  const currentUsers = await getUsersData();
  const currentById = new Map<string, AppUser>(currentUsers.map((user): [string, AppUser] => [String(user.id), user]));
  // Sessie-velden (lastLogin/activeSessions) zijn server-eigendom: ze worden
  // per login/logout gericht bijgewerkt (updateUserSessionMeta/
  // bumpActiveSessions). Wat de client meestuurt is een momentopname van
  // uren geleden en werd bij elke save teruggeschreven — na een 409 zelfs
  // de stand van vóór de refetch (controle-ronde 27-08). Bestaande rijen
  // houden hun DB-waarde; nieuwe rijen starten schoon.
  const sanitizedUsers = incomingUsers.map((user) => {
    const sanitized = sanitizeIncomingUser(user);
    const previous = currentById.get(sanitized.id);
    return previous
      ? { ...sanitized, lastLogin: previous.lastLogin, activeSessions: previous.activeSessions }
      : { ...sanitized, lastLogin: undefined, activeSessions: 0 };
  });
  if (countAdmins(sanitizedUsers) === 0) {
    throw new Error("Er moet minstens 1 actieve admin overblijven.");
  }
  const incomingIds = new Set(sanitizedUsers.map((user) => String(user.id)));

  const { data: authPage, error: authListError } = await supabaseAdmin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (authListError) throw authListError;

  const authUsersByEmail = new Map<string, SupabaseAuthUser>(
    ((authPage?.users ?? []) as SupabaseAuthUser[])
      .filter((user) => user.email)
      .map((user): [string, SupabaseAuthUser] => [normalizeEmail(user.email) as string, user]),
  );

  const removedUserIds = currentUsers
    .map((user) => String(user.id))
    .filter((id) => !incomingIds.has(id));

  // Vangrail (controle 05-09, nr. 29), vóór élke write: een adres waar in
  // Supabase Auth al een account op staat mag een profiel niet stil aan dat
  // account koppelen — dat gaf iemand anders' login toegang tot dit profiel.
  //  - Bestaand profiel dat van adres wisselt: het account op het nieuwe
  //    adres moet zijn éigen account zijn (authid, of bij gebrek daaraan het
  //    account op het oude adres); anders is het van iemand anders.
  //  - Nieuw profiel: een Auth-account op dat adres mag alleen als geen
  //    ander profiel eraan gekoppeld is (verweesd account → koppelen mag,
  //    zoals bij het aanmaken van profielen voor bestaande accounts).
  // De routes vangen dubbele adressen in de users-tabel zelf; dit is de
  // Auth-kant, die daar niet zichtbaar is. Hier en niet in de lus verderop,
  // omdat de tabel anders al het nieuwe adres had terwijl Auth nog het oude hield.
  for (const sanitizedUser of sanitizedUsers) {
    const currentEmail = normalizeEmail(sanitizedUser.email);
    const authOpAdres = currentEmail ? authUsersByEmail.get(currentEmail) : undefined;
    if (!currentEmail || !authOpAdres) continue;
    const previousUser = currentById.get(String(sanitizedUser.id)) as AppUserIntern | undefined;
    const previousEmail = normalizeEmail(previousUser?.email);
    const eigenAuthId = previousUser?.authId ?? (previousEmail ? authUsersByEmail.get(previousEmail)?.id : undefined);
    const adresWisselt = Boolean(previousUser) && previousEmail !== currentEmail;
    const vanAnderProfiel = currentUsers.some((u) => String(u.id) !== String(sanitizedUser.id) && u.authId === authOpAdres.id);
    if ((adresWisselt && authOpAdres.id !== eigenAuthId) || (!previousUser && vanAnderProfiel)) {
      throw new EmailInGebruikError(currentEmail);
    }
  }

  // DB-writes EERST. De Auth-mutaties hieronder zijn onomkeerbaar; door de
  // database vooraf te schrijven faalt een DB-fout vóór er ook maar één
  // Auth-account is aangemaakt of verwijderd (geen weeskonten / verweesde
  // profielen door een halverwege gefaalde write).
  await verwijderInStukken(client, 'users', 'id', removedUserIds);
  // Bestaande rijen zónder de sessie-kolommen upserten, zodat een login die
  // tussen het lezen hierboven en dit schrijven in valt niet alsnog
  // overschreven wordt; nieuwe rijen mét (schone) sessie-kolommen. Twee
  // upserts, want PostgREST eist per batch identieke sleutels.
  const SESSIE_KOLOMMEN = new Set(['lastlogin', 'activesessions']);
  const bestaandeRijen = sanitizedUsers
    .filter((user) => currentById.has(String(user.id)))
    .map((user) => Object.fromEntries(Object.entries(toDatabaseUser(user)).filter(([kolom]) => !SESSIE_KOLOMMEN.has(kolom))));
  const nieuweRijen = sanitizedUsers
    .filter((user) => !currentById.has(String(user.id)))
    .map(toDatabaseUser);
  for (const rijen of [bestaandeRijen, nieuweRijen] as Array<Record<string, unknown>>[]) {
    if (rijen.length === 0) continue;
    let { error } = await client.from('users').upsert(rijen);
    // Migratie 2026-09-28_users_ook_technieker.sql nog niet gedraaid: opnieuw
    // zonder de kolom, zolang niemand de schakelaar aan heeft. Zet iemand hem
    // aan, dan een duidelijke fout en geen stil verlies (zoals de plaats bij
    // de omleidingen, 28-09). Bij elke save opnieuw geprobeerd, niet per warme
    // lambda onthouden: dat overleefde daar de migratie.
    if (error && isMissingColumnError(error)) {
      if (rijen.some((rij) => rij.ooktechnieker === true)) throw new MigratieOntbreektError("users.ooktechnieker", OOK_TECHNIEKER_MIGRATIE);
      ({ error } = await client.from('users').upsert(rijen.map(({ ooktechnieker: _weg, ...rest }) => rest)));
    }
    if (error) throw error;
  }

  // Daarna pas de Auth-kant. Verwijderde gebruikers: bijhorend Auth-account weg.
  for (const currentUser of currentUsers) {
    if (incomingIds.has(String(currentUser.id))) continue;
    const existingAuth = normalizeEmail(currentUser.email)
      ? authUsersByEmail.get(normalizeEmail(currentUser.email) as string)
      : null;

    if (existingAuth) {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(existingAuth.id);
      if (error) throw error;
    }
  }

  for (const incomingUser of incomingUsers) {
    const sanitizedUser = sanitizeIncomingUser(incomingUser);
    const previousUser = currentById.get(String(sanitizedUser.id));
    const currentEmail = normalizeEmail(sanitizedUser.email);
    const previousEmail = normalizeEmail(previousUser?.email);

    if (!currentEmail) continue;

    const previousAuthUser = previousEmail ? authUsersByEmail.get(previousEmail) : null;
    const currentAuthUser = authUsersByEmail.get(currentEmail) ?? previousAuthUser;

    if (!currentAuthUser) {
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: currentEmail,
        password: incomingUser.password || randomPassword(),
        email_confirm: true,
        user_metadata: { name: sanitizedUser.name, role: sanitizedUser.role },
      });
      if (error) throw error;
      if (data.user?.email) {
        authUsersByEmail.set(normalizeEmail(data.user.email) as string, data.user);
      }
      if (!sanitizedUser.isActive && data.user) await zetAuthBan(data.user.id, true);
      const gekoppeld = data.user ? await koppelAuthIdStil(String(sanitizedUser.id), data.user.id) : false;
      // authId alleen als het profiel echt aan het account hangt: de
      // uitnodigingslink in de welkomstmail zoekt het account via het profiel,
      // anders valt de mail terug op de herstellink (api/_lib/recordWrites.ts).
      createdAccounts.push({ email: currentEmail, name: sanitizedUser.name, userId: String(sanitizedUser.id), ...(gekoppeld && data.user ? { authId: data.user.id } : {}) });
      continue;
    }

    // Profiel hoort bij dít Auth-account (nieuw gekoppeld, of admin wees een
    // adres toe waar al een Auth-account op stond) — koppeling meteen
    // vastleggen, anders liep de sessie-identiteit (authid) achter (SQL-review 05-09).
    if ((previousUser as AppUserIntern | undefined)?.authId !== currentAuthUser.id) {
      await koppelAuthIdStil(String(sanitizedUser.id), currentAuthUser.id);
    }

    if (previousEmail && previousEmail !== currentEmail) {
      const { data, error } = await supabaseAdmin.auth.admin.updateUserById(currentAuthUser.id, {
        email: currentEmail,
        email_confirm: true,
        user_metadata: { name: sanitizedUser.name, role: sanitizedUser.role },
      });
      if (error) throw error;
      authUsersByEmail.delete(previousEmail);
      if (data.user?.email) {
        authUsersByEmail.set(normalizeEmail(data.user.email) as string, data.user);
      }
    }

    if (incomingUser.password) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(currentAuthUser.id, {
        password: incomingUser.password,
        user_metadata: { name: sanitizedUser.name, role: sanitizedUser.role },
      });
      if (error) throw error;
    }

    // Pauzeren/heractiveren doorzetten naar Supabase Auth. "Pauzeer" zette
    // alleen users.isactive; het Auth-account kon blijven inloggen en via
    // PostgREST (anon-key + eigen JWT) rechtstreeks lezen, buiten de API en
    // de toestel-whitelist om (controle-ronde 27-08, bevinding 1 — de
    // RLS-kant zit in supabase/2026-08-28_rls_inactieve_gebruikers.sql).
    // Reconciliatie op de wérkelijke ban-staat, niet op de overgang: zo
    // raken accounts die vóór deze fix gepauzeerd werden bij de
    // eerstvolgende save alsnog geband.
    const bannedUntil = (currentAuthUser as { banned_until?: string | null }).banned_until;
    const isGebannen = Boolean(bannedUntil) && new Date(String(bannedUntil)).getTime() > Date.now();
    if (isGebannen !== !sanitizedUser.isActive) await zetAuthBan(currentAuthUser.id, !sanitizedUser.isActive);
  }
  // (DB-delete + DB-upsert zijn hierboven al uitgevoerd, vóór de Auth-mutaties.)
  return { createdAccounts };
};

/** Auth-account (de)blokkeren. Een ban van 100 jaar is Supabase's manier om
 *  een account uit te zetten zonder het te verwijderen; "none" heft hem op.
 *  Bestaande access-tokens lopen nog hooguit een uur door — de RLS-policies
 *  vangen die periode op. */
const zetAuthBan = async (authUserId: string, gebannen: boolean) => {
  if (!supabaseAdmin) throw new Error("Supabase-admin niet geconfigureerd.");
  const { error } = await supabaseAdmin.auth.admin.updateUserById(authUserId, { ban_duration: gebannen ? "876000h" : "none" });
  if (error) throw error;
};

/** Gericht sessie-metadata bijwerken — alléén de eigen rij.
 * Voorheen liep elke login/logout via saveUsersData (replace-all incl.
 * Supabase-auth-sync): gelijktijdige logins raceten met elkaar én met
 * admin-bewerkingen (een net verwijderde gebruiker kon zo terugkomen). */
/** Koppel een profiel aan zijn Supabase Auth-uid (eerste keer dat de
 *  gebruiker met dit account aanmeldt). Daarna geldt de uid als identiteit. */
export const koppelAuthId = async (userId: string, authId: string): Promise<void> => {
  const client = requireDb();
  const { error } = await client.from('users').update({ authid: authId }).eq('id', String(userId));
  if (error) throw error;
};

/** Zelfde, maar best-effort: vóór migratie 2026-09-05_users_authid.sql
 *  bestaat de kolom niet en mag een gebruikers-save daar niet op falen.
 *  Geeft terug of het gelukt is. */
let koppelStilGemeld = false;
const koppelAuthIdStil = async (userId: string, authId: string): Promise<boolean> => {
  try {
    await koppelAuthId(userId, authId);
    return true;
  } catch (err: any) {
    if (!koppelStilGemeld) {
      koppelStilGemeld = true;
      console.error("[users] authid koppelen mislukt (migratie users.authid gedraaid?):", err?.message ?? err);
    }
    return false;
  }
};

export const updateUserSessionMeta = async (
  userId: string,
  fields: { lastLogin?: string; activeSessions?: number },
) => {
  const client = requireDb();
  const patch: Record<string, unknown> = {};
  if (fields.lastLogin !== undefined) patch.lastlogin = fields.lastLogin;
  if (fields.activeSessions !== undefined) patch.activesessions = fields.activeSessions;
  if (Object.keys(patch).length === 0) return;
  const { error } = await client.from('users').update(patch).eq('id', String(userId));
  if (error) throw error;
};

/** Eigen dashboardindeling opslaan (users.dashboardvoorkeuren, jsonb —
 *  2026-09-06_meldingen.sql). Alleen deze kolom; de gebruikers-save
 *  (toDatabaseUser) raakt hem niet aan. Gooit door: de route vertaalt een
 *  ontbrekende kolom naar een duidelijke 503 met de migratienaam. */
export const updateUserDashboardVoorkeuren = async (userId: string, voorkeuren: DashboardVoorkeuren): Promise<void> => {
  const client = requireDb();
  const { error } = await client.from('users').update({ dashboardvoorkeuren: voorkeuren }).eq('id', String(userId));
  if (error) throw error;
};

/** Verhoog/verlaag de activeSessions-teller ATOMAIR via een Postgres-RPC.
 *  Voorkomt de lost-update-race wanneer meerdere mensen ~tegelijk in/uitloggen
 *  (read-modify-write op de gecachte waarde telde mis). Valt terug op een
 *  read-modify-write zolang de RPC nog niet in de DB staat (zie
 *  supabase/active_sessions_rpc.sql). */
export const bumpActiveSessions = async (userId: string, delta: number) => {
  const client = requireDb();
  const { error } = await client.rpc('bump_active_sessions', { uid: String(userId), delta });
  if (!error) return;
  if (!isMissingDbFunction(error)) throw error;
  // Fallback (migratie nog niet gedraaid): niet-atomair, maar functioneel.
  const { data } = await client.from('users').select('activesessions').eq('id', String(userId)).maybeSingle();
  const current = Number((data as any)?.activesessions ?? 0);
  await client.from('users').update({ activesessions: Math.max(0, current + delta) }).eq('id', String(userId));
};
