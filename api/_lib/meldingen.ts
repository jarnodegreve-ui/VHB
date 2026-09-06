import type { MeldingSoort } from "../../shared/schemas/meldingen.js";

/**
 * Meldingencentrum: van een push-payload naar de rij in public.meldingen.
 *
 * Elke push die de API verstuurt krijgt een `soort` (filterchip) en een
 * `doel` (pad in de app). De callers in api/index.ts geven de soort expliciet
 * mee; ontbreekt hij (oudere caller, deviceRoutes), dan leiden we hem af uit
 * de deeplink-URL. Het doel komt altijd uit die URL: pushes gebruiken
 * `/?view=<view>` (viewUrl in api/index.ts), de app navigeert op paden.
 *
 * PAD_PER_VIEW spiegelt src/app/routes.tsx (api/ en src/ delen bewust geen
 * code); src/lib/meldingDoel.test.ts bewaakt dat beide lijsten gelijk blijven.
 */
export const PAD_PER_VIEW: Record<string, string> = {
  dashboard: "",
  "mijn-dag": "mijn-dag",
  rooster: "rooster",
  omleidingen: "omleidingen",
  ritblaadjes: "ritbladen",
  documenten: "documenten",
  "ruil-verzoeken": "dienstruil",
  verlof: "verlof",
  updates: "updates",
  contacten: "contacten",
  bezetting: "maandplanning",
  meldingen: "meldingen",
  "beheer-roosters": "beheer/roosters",
  "planning-matrix": "beheer/planningsoverzicht",
  "planning-codes": "beheer/planningscodes",
  dienstoverzicht: "dienstoverzicht",
  "beheer-dienstoverzicht": "beheer/dienstoverzicht",
  dekking: "openstaande-diensten",
  assistent: "assistent",
  "verlof-kalender": "beheer/verlofkalender",
  ziekte: "beheer/ziekte",
  vervaldata: "beheer/vervaldata",
  "beheer-updates": "beheer/updates",
  "beheer-omleidingen": "beheer/omleidingen",
  gebruikers: "beheer/gebruikers",
  toestellen: "beheer/toestellen",
  activiteit: "beheer/activiteit",
  "ocpi-monitoring": "beheer/laadpalen",
  designsysteem: "beheer/designsysteem",
  "beheer-debug": "beheer/systeemstatus",
  instellingen: "instellingen",
};

/** Soort per view, voor pushes zonder expliciete soort. */
const SOORT_PER_VIEW: Record<string, MeldingSoort> = {
  rooster: "planning",
  "mijn-dag": "planning",
  dekking: "planning",
  bezetting: "planning",
  verlof: "verlof",
  "verlof-kalender": "verlof",
  ziekte: "verlof",
  "ruil-verzoeken": "ruil",
  updates: "update",
  omleidingen: "omleiding",
  documenten: "document",
};

/** `/?view=rooster` → 'rooster'; `/verlof` → 'verlof'; '/' → null. */
export const viewUitPushUrl = (url: string | undefined): string | null => {
  if (!url) return null;
  try {
    const u = new URL(url, "https://vhbportaal.com");
    const view = u.searchParams.get("view");
    if (view) return view;
    const pad = u.pathname.replace(/^\/+|\/+$/g, "");
    if (!pad) return null;
    // Pad → view (omgekeerde tabel); onbekend pad = geen view.
    const view2 = Object.entries(PAD_PER_VIEW).find(([, p]) => p === pad)?.[0];
    return view2 ?? null;
  } catch {
    return null;
  }
};

/** Doel (pad in de app) uit een push-URL; null als de push nergens heen wijst. */
export const doelUitPushUrl = (url: string | undefined): string | null => {
  const view = viewUitPushUrl(url);
  if (!view) return null;
  const pad = PAD_PER_VIEW[view];
  return pad === undefined ? null : pad;
};

/** Soort uit een push-URL; 'systeem' als de URL geen domein verraadt. */
export const soortUitPushUrl = (url: string | undefined): MeldingSoort => {
  const view = viewUitPushUrl(url);
  return (view && SOORT_PER_VIEW[view]) || "systeem";
};

export type MeldingInvoer = {
  titel: string;
  tekst: string | null;
  soort: MeldingSoort;
  doel: string | null;
};

/** Van push-payload naar melding-rij (titel/tekst afgekapt op DB-vriendelijke lengtes). */
export const meldingUitPayload = (payload: { title: string; body?: string; url?: string; soort?: MeldingSoort; doel?: string }): MeldingInvoer => ({
  // Emoji-prefix van de dringende update ("🚨 …") hoort bij de push, niet bij de rij.
  titel: String(payload.title ?? "").replace(/^\s*🚨\s*/, "").trim().slice(0, 160) || "Melding",
  tekst: String(payload.body ?? "").trim().slice(0, 600) || null,
  soort: payload.soort ?? soortUitPushUrl(payload.url),
  doel: payload.doel !== undefined ? (payload.doel || null) : doelUitPushUrl(payload.url),
});
