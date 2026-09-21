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
  werkvoorraad: "overzicht",
  "beheer-roosters": "beheer/roosters",
  "planning-matrix": "beheer/planningsoverzicht",
  "planning-codes": "beheer/planningscodes",
  dienstoverzicht: "dienstoverzicht",
  "beheer-dienstoverzicht": "beheer/dienstoverzicht",
  dienstopbouw: "beheer/dienstopbouw",
  dagafsluiting: "beheer/dagafsluiting",
  looncontrole: "beheer/looncontrole",
  dekking: "openstaande-diensten",
  "verlof-kalender": "beheer/verlofkalender",
  ziekte: "beheer/ziekte",
  vervaldata: "beheer/vervaldata",
  defecten: "techniek/defecten",
  werkprestaties: "techniek/prestaties",
  "voertuig-werken": "techniek/werken",
  voertuigen: "techniek/voertuigen",
  "beheer-updates": "beheer/updates",
  "beheer-omleidingen": "beheer/omleidingen",
  rapporten: "rapporten",
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
  defecten: "techniek",
  werkprestaties: "techniek",
  "voertuig-werken": "techniek",
  voertuigen: "techniek",
};

/**
 * Pad → view + record-segmenten, met de langste bekende prefix (zoals
 * routeUitPad in src/app/router.ts): `updates/u2` → updates + ['u2'],
 * `beheer/omleidingen` → beheer-omleidingen + []. Onbekend pad = null.
 */
const routeUitPad = (pad: string): { view: string; rest: string[] } | null => {
  const segmenten = pad.split("/").filter(Boolean).map((s) => {
    try { return decodeURIComponent(s); } catch { return s; }
  });
  for (let n = segmenten.length; n >= 1; n--) {
    const prefix = segmenten.slice(0, n).join("/");
    const view = Object.entries(PAD_PER_VIEW).find(([, p]) => p === prefix)?.[0];
    if (view) return { view, rest: segmenten.slice(n) };
  }
  return null;
};

/** View + record-segmenten uit een push-URL (`/?view=` of pad); null als ze nergens heen wijst. */
const routeUitPushUrl = (url: string | undefined): { view: string; rest: string[] } | null => {
  if (!url) return null;
  try {
    const u = new URL(url, "https://vhbportaal.com");
    const view = u.searchParams.get("view");
    if (view) return { view, rest: [] };
    return routeUitPad(u.pathname);
  } catch {
    return null;
  }
};

/** `/?view=rooster` → 'rooster'; `/verlof` → 'verlof'; `/updates/u2` → 'updates'; '/' → null. */
export const viewUitPushUrl = (url: string | undefined): string | null => routeUitPushUrl(url)?.view ?? null;

/**
 * Doel (pad in de app) uit een push-URL; null als de push nergens heen wijst.
 * Record-segmenten reizen mee (`/updates/u2` → 'updates/u2'), zodat de
 * melding op het item zelf landt (useRecordParam in de views).
 */
export const doelUitPushUrl = (url: string | undefined): string | null => {
  const r = routeUitPushUrl(url);
  if (!r) return null;
  const pad = PAD_PER_VIEW[r.view];
  if (pad === undefined) return null;
  return [pad, ...r.rest.map(encodeURIComponent)].filter(Boolean).join("/");
};

/**
 * Push-URL naar één record: `recordUrl('updates', 'u2')` → '/updates/u2'.
 * Padvorm (geen `?view=`), want alleen een pad kan een id dragen; de app
 * leest beide (routeUitUrl), de service worker navigeert op het pad.
 * Zonder id valt hij terug op het scherm zelf.
 */
export const recordUrl = (view: string, id?: string | number | null): string => {
  const pad = PAD_PER_VIEW[view] ?? "";
  const rest = id === undefined || id === null || String(id).trim() === "" ? "" : `/${encodeURIComponent(String(id))}`;
  return `${pad ? `/${pad}` : ""}${rest}` || "/";
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
