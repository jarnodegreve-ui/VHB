import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { User as SupabaseAuthUser } from "@supabase/supabase-js";
import { supabaseAdmin } from "../db.js";
import { portalUrl } from "../email.js";
import { normalizeEmail } from "../helpers.js";
import type { AppUserIntern } from "../types.js";
import {
  UITNODIGING_GELDIG_DAGEN,
  UITNODIGING_HASH,
  leesUitnodigingCode,
  maakUitnodigingCode,
  uitnodigingBeletsel,
  type UitnodigingBeletsel,
} from "../../shared/uitnodiging.js";

/**
 * Uitnodigen voor het portaal (30-09, wens Jarno: een bestaande gebruiker
 * uitnodigen vanuit de gebruikerslijst).
 *
 * Waarom geen link van Supabase in de mail: die werkt één uur (zie
 * supabase/auth-mails, "De link werkt één uur"), en een chauffeur leest zijn
 * mail niet binnen het uur. Op 30-09 had een groot deel van de actieve
 * accounts nog nooit ingelogd, en bijna niemand van hen had ooit zo'n link
 * gekregen. Daarom draagt de mail een eigen code die zeven dagen werkt, en maakt de server pas bij het
 * openen een verse Supabase-link (POST /api/uitnodiging/openen). Die gebruikt
 * de landing meteen, dus het uur speelt daar geen rol meer.
 *
 * De code is `<gebruikers-id>.<geheim>` (shared/uitnodiging.ts). Het geheim
 * zijn 24 willekeurige bytes; alleen de sha256 ervan staat, met het adres en
 * de vervaldatum, in de app_metadata van het Auth-account, die alleen de
 * server kan schrijven. Geen tabel en geen ondertekensleutel nodig, en een
 * nieuwe uitnodiging overschrijft de vorige: alleen de laatste link werkt.
 *
 * Een code werkt zolang (1) het geheim klopt, (2) profiel en aanmelding nog
 * op het adres staan waarnaar de uitnodiging ging, (3) het profiel actief is,
 * (4) de persoon nog nooit in het portaal aanmeldde (lastLogin leeg) en
 * (5) de zeven dagen niet om zijn. Wie het wachtwoordscherm halverwege
 * verlaat, kan de link dus opnieuw openen tot hij echt binnen is.
 */

export const UITNODIGING_SOORT = "uitnodiging";
const META_SLEUTEL = "uitnodiging";
const GELDIG_MS = UITNODIGING_GELDIG_DAGEN * 24 * 60 * 60 * 1000;

type UitnodigingMeta = { hash: string; email: string; op: string; tot: string };

const hashVan = (geheim: string) => createHash("sha256").update(geheim).digest("hex");

const leesMeta = (appMetadata: unknown): UitnodigingMeta | null => {
  const m = (appMetadata as Record<string, unknown> | null | undefined)?.[META_SLEUTEL] as Partial<UitnodigingMeta> | null | undefined;
  if (!m || typeof m !== "object") return null;
  const { hash, email, op, tot } = m;
  if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) return null;
  if (typeof email !== "string" || typeof op !== "string" || typeof tot !== "string") return null;
  return { hash, email, op, tot };
};

const vereistAdmin = () => {
  if (!supabaseAdmin) throw new Error("Supabase-admin niet geconfigureerd.");
  return supabaseAdmin;
};

export type UitnodigingOntvanger = { userId: string; authId: string; adres: string; naam: string };
export type UitnodigingOvergeslagen = { id: string; naam: string; reden: UitnodigingBeletsel };

/**
 * Wie van de gekozen id's een uitnodiging krijgt en wie niet, met de reden.
 * Een onbekend id (intussen verwijderd) valt stil weg.
 */
export function kiesOntvangers(users: readonly AppUserIntern[], ids: readonly string[]): { ontvangers: UitnodigingOntvanger[]; overgeslagen: UitnodigingOvergeslagen[] } {
  const perId = new Map(users.map((u) => [String(u.id), u]));
  const ontvangers: UitnodigingOntvanger[] = [];
  const overgeslagen: UitnodigingOvergeslagen[] = [];
  const adressen = new Set<string>();
  for (const id of new Set(ids.map(String))) {
    const u = perId.get(id);
    if (!u) continue;
    const reden: UitnodigingBeletsel | null = uitnodigingBeletsel(u) ?? (u.authId ? null : "geen-account");
    if (reden) {
      overgeslagen.push({ id, naam: u.name, reden });
      continue;
    }
    const adres = normalizeEmail(u.email) as string;
    // Twee profielen op één adres weigert het opslaan al; hier geen twee mails.
    if (adressen.has(adres)) continue;
    adressen.add(adres);
    ontvangers.push({ userId: id, authId: u.authId as string, adres, naam: u.name });
  }
  return { ontvangers, overgeslagen };
}

/**
 * Nieuwe uitnodiging voor één account: de hash van een vers geheim, het adres
 * en de vervaldatum in de app_metadata (Supabase voegt de sleutel samen met
 * wat er al staat). Geeft de link voor in de mail.
 */
export async function maakUitnodiging(o: { userId: string; authId: string; adres: string }, nu = Date.now()): Promise<{ link: string; op: string; tot: string }> {
  const admin = vereistAdmin();
  const geheim = randomBytes(24).toString("base64url");
  const op = new Date(nu).toISOString();
  const tot = new Date(nu + GELDIG_MS).toISOString();
  const meta: UitnodigingMeta = { hash: hashVan(geheim), email: normalizeEmail(o.adres) ?? o.adres, op, tot };
  const { error } = await admin.auth.admin.updateUserById(o.authId, { app_metadata: { [META_SLEUTEL]: meta } });
  if (error) throw error;
  return { link: `${portalUrl().replace(/\/+$/, "")}/${UITNODIGING_HASH}${maakUitnodigingCode(o.userId, geheim)}`, op, tot };
}

/**
 * Uitnodiging weghalen, bv. als de mail met de link niet vertrok: dan staat
 * er in Gebruikers geen "Uitgenodigd" bij iemand die niets kreeg. Een
 * sleutel op null laat Supabase weg uit de app_metadata.
 */
export async function trekUitnodigingIn(authId: string): Promise<void> {
  const { error } = await vereistAdmin().auth.admin.updateUserById(authId, { app_metadata: { [META_SLEUTEL]: null } });
  if (error) throw error;
}

export type OpenReden = "ongeldig" | "verlopen" | "gebruikt" | "gepauzeerd";
export type OpenUitkomst = { ok: true; naam: string; email: string; tokenHash: string } | { ok: false; reden: OpenReden };

/** Wat de landing toont als een uitnodiging niet (meer) werkt. */
export const OPEN_REDEN_TEKST: Record<OpenReden, string> = {
  ongeldig: "Deze uitnodiging werkt niet (meer). Vraag de planning om een nieuwe.",
  verlopen: `Deze uitnodiging is verlopen, de link werkt ${UITNODIGING_GELDIG_DAGEN} dagen. Vraag de planning om een nieuwe.`,
  gebruikt: "Je bent al eens aangemeld met deze uitnodiging. Log in met je e-mailadres en wachtwoord.",
  gepauzeerd: "Je account staat op pauze. Neem contact op met de planning.",
};

/**
 * Een uitnodiging openen: controleert de code en geeft een verse
 * herstel-token (hashed_token) terug, waarmee de landing zelf de sessie
 * start (supabase.auth.verifyOtp) en het wachtwoord laat kiezen. Er gaat
 * geen mail uit. Eerst het geheim, dan pas de rest: wie de code niet heeft,
 * leert niets over het account (altijd "ongeldig").
 */
export async function openUitnodiging(code: unknown, users: readonly AppUserIntern[], nu = Date.now()): Promise<OpenUitkomst> {
  const admin = vereistAdmin();
  const ongeldig: OpenUitkomst = { ok: false, reden: "ongeldig" };
  const gelezen = leesUitnodigingCode(code);
  if (!gelezen) return ongeldig;
  const user = users.find((u) => String(u.id) === gelezen.userId);
  if (!user?.authId) return ongeldig;

  const { data, error } = await admin.auth.admin.getUserById(user.authId);
  if (error) {
    if ((error as { status?: number }).status === 404) return ongeldig;
    throw error;
  }
  const authUser = data?.user as SupabaseAuthUser | undefined;
  const meta = leesMeta(authUser?.app_metadata);
  if (!authUser || !meta) return ongeldig;
  const verwacht = Buffer.from(meta.hash, "hex");
  const gekregen = Buffer.from(hashVan(gelezen.geheim), "hex");
  if (verwacht.length !== gekregen.length || !timingSafeEqual(verwacht, gekregen)) return ongeldig;

  // Na een adreswissel ging de link naar het oude adres: dan werkt hij niet meer.
  const adres = normalizeEmail(user.email);
  if (!adres || adres !== meta.email || normalizeEmail(authUser.email) !== adres) return ongeldig;
  if (user.isActive === false) return { ok: false, reden: "gepauzeerd" };
  if (user.lastLogin) return { ok: false, reden: "gebruikt" };
  if (!(Date.parse(meta.tot) > nu)) return { ok: false, reden: "verlopen" };

  const { data: link, error: linkFout } = await admin.auth.admin.generateLink({ type: "recovery", email: adres });
  if (linkFout) throw linkFout;
  const tokenHash = link?.properties?.hashed_token;
  if (!tokenHash) throw new Error("generateLink gaf geen hashed_token terug.");
  return { ok: true, naam: user.name, email: adres, tokenHash };
}

/**
 * De lopende uitnodiging per gebruiker (verstuurd en vervaldatum), voor de
 * kolom "Laatst actief" in Gebruikers. Alleen een uitnodiging naar het
 * huidige adres telt; één Auth-oproep voor de hele lijst.
 */
export async function uitnodigingenPerGebruiker(users: readonly AppUserIntern[]): Promise<Array<{ userId: string; op: string; tot: string }>> {
  const admin = vereistAdmin();
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  // Expliciete cast, zoals bij de wachtwoordreset: de function-builder van
  // Vercel typeert data.users soms als never[].
  const perAuthId = new Map(((data?.users ?? []) as SupabaseAuthUser[]).map((a): [string, SupabaseAuthUser] => [a.id, a]));
  const uit: Array<{ userId: string; op: string; tot: string }> = [];
  for (const u of users) {
    const meta = u.authId ? leesMeta(perAuthId.get(u.authId)?.app_metadata) : null;
    if (meta && meta.email === normalizeEmail(u.email)) uit.push({ userId: String(u.id), op: meta.op, tot: meta.tot });
  }
  return uit;
}
