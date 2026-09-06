import { createHash } from "node:crypto";

/**
 * Foutgroepen: één "vingerafdruk" per oorzaak, zodat 40 meldingen van
 * dezelfde bug één rij zijn in Systeemstatus › Fouten.
 *
 * fingerprint = hash(bron | genormaliseerde melding | top-frame bestand:regel)
 *  - getallen, uuid's en hex-id's in de melding worden `#` (een "dienst 2515"
 *    en "dienst 2607" zijn dezelfde fout);
 *  - het top-frame komt uit de symbolicatie (api/symbolicate.ts) en verliest
 *    zijn functienaam — bestand + regel volstaan;
 *  - zonder stack telt alleen de melding.
 *
 * Pure module zonder db/express: los te unit-testen (src/foutgroepen.test.ts)
 * en door zowel de POST-route (fingerprint bij binnenkomst) als de
 * groepeer-route (in-memory groepering) gebruikt. Rijen van vóór de migratie
 * hebben geen opgeslagen fingerprint: die krijgen er hier alsnog één op basis
 * van bron + melding, zodat de groepering zonder migratie óók werkt.
 */

export type FoutStatusWaarde = "open" | "opgelost" | "genegeerd";
export const FOUT_STATUSSEN: readonly FoutStatusWaarde[] = ["open", "opgelost", "genegeerd"];

export type FoutRij = {
  id: string | number;
  createdAt: string;
  message: string;
  stack?: string;
  source?: string;
  url?: string;
  userAgent?: string;
  userId?: string;
  fingerprint?: string;
  release?: string;
  view?: string;
  role?: string;
  online?: boolean;
  breadcrumbs?: unknown;
  topFrame?: string;
};

export type FoutStatus = {
  fingerprint: string;
  status: FoutStatusWaarde;
  /** Release waarin de status gezet werd (voor regressie-detectie). */
  release: string | null;
  bijgewerktOp: string | null;
  door: string | null;
};

export type FoutGroep = {
  fingerprint: string;
  message: string;
  source: string;
  topFrame: string | null;
  aantal: number;
  eerste: string;
  laatste: string;
  releases: string[];
  gebruikers: number;
  status: FoutStatusWaarde;
  /** Was 'opgelost' en kwam daarna in een andere release terug. */
  regressie: boolean;
  /** Recentste voorval: stack + broodkruimels voor het uitklapvak. */
  laatsteVoorval: Pick<FoutRij, "stack" | "breadcrumbs" | "url" | "view" | "role" | "release" | "userAgent" | "online" | "createdAt" | "userId">;
};

const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const HEX_ID_RE = /\b[0-9a-f]{12,}\b/gi;
const GETAL_RE = /\d+(?:[.,:]\d+)*/g;

/** Melding zonder variabele delen: getallen/uuid's → `#`, witruimte samengevouwen, max 200 tekens. */
export const normaliseerFoutmelding = (message: string): string =>
  String(message ?? "")
    .replace(UUID_RE, "#")
    .replace(HEX_ID_RE, "#")
    .replace(GETAL_RE, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);

/** "src/views/X.tsx:142 (render)" → "src/views/X.tsx:142". */
export const topFrameSleutel = (topFrame: string | null | undefined): string | null => {
  if (!topFrame) return null;
  const s = String(topFrame).replace(/\s*\([^)]*\)\s*$/, "").trim();
  return s || null;
};

export const fingerprintVan = (i: { message: string; source?: string | null; topFrame?: string | null }): string =>
  createHash("sha256")
    .update(`${i.source || ""}|${normaliseerFoutmelding(i.message)}|${topFrameSleutel(i.topFrame) || ""}`)
    .digest("hex")
    .slice(0, 16);

const STATUS_VOLGORDE: Record<FoutStatusWaarde, number> = { open: 0, opgelost: 1, genegeerd: 2 };

/**
 * Groepeert rijen per fingerprint en past de statussen toe. Regressie: een
 * groep die 'opgelost' is en ná het oplossen opnieuw voorkomt in een ándere
 * release, wordt weer 'open' (regressie=true) — releases zijn commit-SHA's
 * en dus niet ordenbaar, "nieuwer" is daarom "later dan het oplossen én een
 * andere build". `heropend` bevat de fingerprints die de aanroeper mag
 * terugschrijven naar de statustabel.
 */
export const groepeerFouten = (
  rijen: FoutRij[],
  statussen: ReadonlyMap<string, FoutStatus>,
): { groepen: FoutGroep[]; heropend: string[] } => {
  const per = new Map<string, { rijen: FoutRij[] }>();
  for (const rij of rijen) {
    const fp = rij.fingerprint || fingerprintVan({ message: rij.message, source: rij.source, topFrame: rij.topFrame });
    const g = per.get(fp) ?? { rijen: [] };
    g.rijen.push({ ...rij, fingerprint: fp });
    per.set(fp, g);
  }
  const heropend: string[] = [];
  const groepen: FoutGroep[] = [];
  for (const [fp, { rijen: r }] of per) {
    const gesorteerd = [...r].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const laatste = gesorteerd[0];
    const eerste = gesorteerd[gesorteerd.length - 1];
    const releases = [...new Set(gesorteerd.map((x) => x.release).filter((x): x is string => Boolean(x)))];
    const gebruikers = new Set(gesorteerd.map((x) => String(x.userId || "").replace(/^onbevestigd:/, "")).filter(Boolean));
    const st = statussen.get(fp);
    let status: FoutStatusWaarde = st?.status ?? "open";
    let regressie = false;
    if (st?.status === "opgelost") {
      const na = st.bijgewerktOp ?? "";
      const terug = gesorteerd.some((x) => String(x.createdAt) > na && Boolean(x.release) && x.release !== st.release);
      if (terug) {
        status = "open";
        regressie = true;
        heropend.push(fp);
      }
    }
    groepen.push({
      fingerprint: fp,
      message: laatste.message,
      source: laatste.source || "onbekend",
      topFrame: gesorteerd.map((x) => x.topFrame).find(Boolean) ?? null,
      aantal: gesorteerd.length,
      eerste: String(eerste.createdAt),
      laatste: String(laatste.createdAt),
      releases,
      gebruikers: gebruikers.size,
      status,
      regressie,
      laatsteVoorval: {
        createdAt: String(laatste.createdAt),
        stack: laatste.stack,
        breadcrumbs: laatste.breadcrumbs,
        url: laatste.url,
        view: laatste.view,
        role: laatste.role,
        release: laatste.release,
        userAgent: laatste.userAgent,
        online: laatste.online,
        userId: laatste.userId,
      },
    });
  }
  groepen.sort((a, b) => {
    const s = STATUS_VOLGORDE[a.status] - STATUS_VOLGORDE[b.status];
    if (s !== 0) return s;
    if (a.regressie !== b.regressie) return a.regressie ? -1 : 1;
    return b.laatste.localeCompare(a.laatste);
  });
  return { groepen, heropend };
};
