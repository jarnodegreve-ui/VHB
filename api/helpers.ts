import * as XLSX from "xlsx";
import { randomBytes } from "node:crypto";
import type {
  AppUser,
  DiversionRecord,
  IncomingUser,
  LeaveRecord,
  PlanningCodeRecord,
  PlanningMatrixRow,
  Role,
  SwapRecord,
  SwapType,
} from "./types.js";

export const normalizeEmail = (email?: string | null) => email?.trim().toLowerCase() || undefined;

export const toPublicUser = (user: any): AppUser => ({
  id: String(user.id),
  name: user.name,
  role: user.role,
  employeeId: user.employeeId ?? user.employeeid,
  lastLogin: user.lastLogin ?? user.lastlogin,
  activeSessions: user.activeSessions ?? user.activesessions,
  isActive: user.isActive ?? user.isactive,
  phone: user.phone,
  email: user.email,
  verlofBudget: typeof (user.verlofBudget ?? user.verlofbudget) === 'number'
    ? (user.verlofBudget ?? user.verlofbudget)
    : undefined,
  showInContacts: (user.showInContacts ?? user.showincontacts) !== false,
  // Alleen relevant voor admins: ontvangt deze persoon de systeemmails
  // (foutendigest, back-ups)? Default true; opt-out per account.
  wantsSystemMail: (user.wantsSystemMail ?? user.wantssystemmail) !== false,
  section: (user.section ?? undefined) || undefined,
  startDate: (user.startDate ?? user.startdate) || undefined,
});

export const toRoleScopedUser = (user: AppUser, role: Role, viewerId?: string): AppUser => {
  if (role === "admin") {
    return user;
  }

  if (role === "planner") {
    return {
      ...user,
      lastLogin: undefined,
      activeSessions: undefined,
    };
  }

  // Chauffeurs: contactgegevens van collega's die zich uit de contactlijst
  // hebben laten halen (showInContacts=false) NIET meesturen — het filteren
  // gebeurde eerst enkel client-side, waardoor phone/email alsnog in de
  // API-respons zaten. Eigen gegevens blijven altijd zichtbaar.
  const hideContact = user.showInContacts === false && String(user.id) !== String(viewerId ?? "");
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    employeeId: "",
    phone: hideContact ? undefined : user.phone,
    email: hideContact ? undefined : user.email,
    showInContacts: user.showInContacts,
    section: user.section,
  };
};

export const sanitizeIncomingUser = (user: IncomingUser): AppUser => ({
  id: String(user.id),
  name: user.name?.trim() || "Onbekende gebruiker",
  role: user.role || "chauffeur",
  employeeId: user.employeeId?.trim() || `VHB-${String(user.id).slice(-6)}`,
  lastLogin: user.lastLogin,
  activeSessions: user.activeSessions ?? 0,
  isActive: user.isActive !== false,
  phone: user.phone?.trim() || undefined,
  email: normalizeEmail(user.email),
  verlofBudget: typeof user.verlofBudget === 'number' && user.verlofBudget >= 0 ? user.verlofBudget : undefined,
  showInContacts: user.showInContacts !== false,
  wantsSystemMail: user.wantsSystemMail !== false,
  section: user.section?.trim() || undefined,
  startDate: user.startDate?.trim() || undefined,
});

export const toDatabaseUser = (user: AppUser) => ({
  id: String(user.id),
  name: user.name,
  role: user.role,
  employeeid: user.employeeId,
  lastlogin: user.lastLogin,
  activesessions: user.activeSessions ?? 0,
  isactive: user.isActive !== false,
  phone: user.phone,
  email: normalizeEmail(user.email),
  verlofbudget: typeof user.verlofBudget === 'number' && user.verlofBudget >= 0 ? user.verlofBudget : null,
  showincontacts: user.showInContacts !== false,
  wantssystemmail: user.wantsSystemMail !== false,
  section: user.section?.trim() || null,
  startdate: user.startDate?.trim() || null,
});

/**
 * Voorvoegsel van de reden bij een handmatige admin-dienstwissel. Eén bron:
 * de route schrijft ermee, de maandplanning herkent er de wissel aan (zodat
 * de cel gemerkt kan worden als "afwijkend van de Excel"). Bewust géén extra
 * kolom op swaps — de reden is sinds de verharding onveranderlijk zodra de
 * ruil 'pending' verlaat, en een handmatige wissel wordt direct goedgekeurd
 * aangemaakt.
 */
export const HANDMATIGE_WISSEL_PREFIX = "Handmatige wissel door ";

export const isHandmatigeWissel = (swap: { reason?: unknown } | null | undefined) =>
  String(swap?.reason ?? "").startsWith(HANDMATIGE_WISSEL_PREFIX);

/**
 * Bouwt een praktijk-tab-Excel uit de ACTUELE cel-waarheid van de maand-
 * planning — de omgekeerde richting van parsePlanningMatrixXlsx, in exact
 * hetzelfde formaat (sheet 'praktijk', kolom A datum als Excel-serial, B
 * dagtype, één kolom per chauffeur, afsluitende 'aantal'-kolom). Doel: de
 * planner start zijn volgende Excel-bewerking op de werkelijke stand
 * (wissels, toewijzingen, ziektes verwerkt) in plaats van op de verouderde
 * upload — en het bestand is direct her-importeerbaar.
 */
export const bouwMatrixXlsx = (
  dates: string[],
  dayTypeByDate: Map<string, string>,
  chauffeurs: Array<{ id: string; name: string }>,
  cells: Record<string, Record<string, { code: string; kind: string }>>,
  // Optioneel tweede tabblad "maandoverzicht": per-chauffeur maandtelling
  // (diensten/uren/ziekte/verlof) als voorbereiding op de loonadministratie.
  maandoverzicht?: unknown[][],
): Buffer => {
  const serial = (iso: string) => {
    const ms = Date.parse(`${iso}T00:00:00Z`) - Date.parse("1899-12-30T00:00:00Z");
    return Math.round(ms / 86400000);
  };
  // Formule-injectie neutraliseren: een celwaarde die met = + - @ (of een
  // tab/CR die Excel negeert) begint, wordt door sommige spreadsheets als
  // formule uitgevoerd bij het openen. In .xlsx typeert aoa_to_sheet strings
  // al als tekst, maar deze helper is bewust her-importeerbaar en kan ooit als
  // CSV belanden — dus defensief een apostrof voorzetten. Namen én codes.
  const veilig = (raw: string): string =>
    /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  const aoa: unknown[][] = [["datum", "dagtype", ...chauffeurs.map((c) => veilig(c.name)), "aantal"]];
  for (const iso of dates) {
    const codes = chauffeurs.map((c) => veilig(cells[c.id]?.[iso]?.code ?? ""));
    const aantal = chauffeurs.filter((c) => cells[c.id]?.[iso]?.kind === "service").length;
    aoa.push([serial(iso), dayTypeByDate.get(iso) ?? "", ...codes, aantal]);
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "praktijk");
  if (maandoverzicht && maandoverzicht.length > 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(maandoverzicht), "maandoverzicht");
  }
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
};

/** 'HH:MM' → minuten; busvak-uren ≥ 24 ("26:16") geldig tot 47:59 — zelfde
 *  regels als parseBusvakMin in api/advisor.ts. */
const parseBusvakMinuten = (t: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 47 || min > 59) return null;
  return h * 60 + min;
};

/** Som van de segmentduren van één dienst in minuten (einde ≤ start = nacht,
 *  +24u); null zonder bruikbare tijden. */
export const dienstMinuten = (s: {
  startTime?: string | null; endTime?: string | null;
  startTime2?: string | null; endTime2?: string | null;
  startTime3?: string | null; endTime3?: string | null;
}): number | null => {
  const paren: Array<[unknown, unknown]> = [
    [s.startTime, s.endTime],
    [s.startTime2, s.endTime2],
    [s.startTime3, s.endTime3],
  ];
  let som: number | null = null;
  for (const [a, b] of paren) {
    const start = parseBusvakMinuten(String(a ?? ""));
    const eind = parseBusvakMinuten(String(b ?? ""));
    if (start === null || eind === null) continue;
    som = (som ?? 0) + (eind <= start ? eind + 24 * 60 : eind) - start;
  }
  return som;
};

export const formatMinutenAlsUren = (minuten: number): string =>
  `${Math.floor(minuten / 60)}:${String(Math.round(minuten) % 60).padStart(2, "0")}`;

/**
 * Per-chauffeur maandtelling als AOA voor het xlsx-tabblad "maandoverzicht" —
 * voorbereiding op de loonadministratie. Rekent op de ACTUELE cel-waarheid
 * (zelfde `cells` als de praktijk-terugexport: wissels, toewijzingen en
 * afwezigheids-overlay verwerkt). Categorieën: dienst (dienstoverzicht-nummer,
 * mét uren-som), ander werk (planningscode met counts_as_shift: EEK/bureau/
 * garage), ziek, betaalde afwezigheid (bv/f/kv), vrij, en overig per code.
 */
export const bouwMaandoverzichtAoa = (
  month: string,
  dates: string[],
  chauffeurs: Array<{ id: string; name: string }>,
  cells: Record<string, Record<string, { code: string; kind: string }>>,
  services: Array<{ serviceNumber?: unknown; startTime?: string | null; endTime?: string | null; startTime2?: string | null; endTime2?: string | null; startTime3?: string | null; endTime3?: string | null }>,
  planningCodes: Array<{ code: string; countsAsShift?: boolean; isPaidAbsence?: boolean; isDayOff?: boolean }>,
): unknown[][] => {
  const serviceByNorm = new Map(services.map((s) => [toLookupToken(String(s.serviceNumber ?? "")), s]));
  const codeByNorm = new Map(planningCodes.map((c) => [toLookupToken(c.code), c]));
  const aoa: unknown[][] = [
    [`Maandoverzicht ${month}`],
    [`Stand ná dienstruilen, toewijzingen en geregistreerde afwezigheden (${dates.length} dagen). Uren = som van de dienstsegmenten uit het Dienstoverzicht; diensten zonder tijden tellen alleen in de dagtelling.`],
    [],
    ["chauffeur", "diensten", "uren diensten", "ander werk", "ziek", "betaalde afwezigheid", "vrij", "overig", "dagen ingepland"],
  ];
  const totaal = { diensten: 0, minuten: 0, anderWerk: 0, ziek: 0, betaald: 0, vrij: 0, overig: 0, dagen: 0 };
  for (const c of chauffeurs) {
    let diensten = 0;
    let minuten = 0;
    let anderWerk = 0;
    let ziek = 0;
    let betaald = 0;
    let vrij = 0;
    let dagen = 0;
    const overigPerCode = new Map<string, number>();
    for (const iso of dates) {
      const cel = cells[c.id]?.[iso];
      if (!cel || !String(cel.code ?? "").trim()) continue;
      dagen += 1;
      const n = toLookupToken(cel.code);
      const svc = serviceByNorm.get(n);
      if (svc) {
        diensten += 1;
        minuten += dienstMinuten(svc) ?? 0;
        continue;
      }
      if (n === "ziek") {
        ziek += 1;
        continue;
      }
      const pc = codeByNorm.get(n);
      if (pc?.countsAsShift) anderWerk += 1;
      else if (pc?.isPaidAbsence) betaald += 1;
      else if (pc?.isDayOff) vrij += 1;
      else overigPerCode.set(cel.code, (overigPerCode.get(cel.code) ?? 0) + 1);
    }
    const overigTelling = [...overigPerCode.values()].reduce((a, b) => a + b, 0);
    aoa.push([
      c.name,
      diensten,
      formatMinutenAlsUren(minuten),
      anderWerk,
      ziek,
      betaald,
      vrij,
      [...overigPerCode.entries()].map(([code, x]) => `${code}×${x}`).join(", "),
      dagen,
    ]);
    totaal.diensten += diensten;
    totaal.minuten += minuten;
    totaal.anderWerk += anderWerk;
    totaal.ziek += ziek;
    totaal.betaald += betaald;
    totaal.vrij += vrij;
    totaal.overig += overigTelling;
    totaal.dagen += dagen;
  }
  aoa.push([]);
  aoa.push(["totaal", totaal.diensten, formatMinutenAlsUren(totaal.minuten), totaal.anderWerk, totaal.ziek, totaal.betaald, totaal.vrij, totaal.overig, totaal.dagen]);
  return aoa;
};

/** Onbekende/ontbrekende waarden vallen terug op de klassieke 1-op-1 ruil. */
export const normalizeSwapType = (value: unknown): SwapType =>
  String(value ?? "").trim().toLowerCase() === "overname" ? "overname" : "ruil";

export const toPublicSwap = (swap: any): SwapRecord => {
  const swapType = normalizeSwapType(swap.swapType ?? swap.swap_type);
  return {
    id: String(swap.id),
    shiftId: String(swap.shiftId ?? swap.shiftid),
    requesterId: String(swap.requesterId ?? swap.requesterid),
    targetDriverId: swap.targetDriverId ?? swap.targetdriverid ?? undefined,
    status: swap.status,
    createdAt: String(swap.createdAt ?? swap.createdat),
    reason: swap.reason ?? undefined,
    decidedAt: swap.decidedAt ?? swap.decidedat ?? undefined,
    // Een overname heeft per definitie geen tegenprestatie: eventuele
    // meegestuurde return-velden negeren we, zodat de UI ze nooit toont.
    returnDate: swapType === "overname" ? undefined : (swap.returnDate ?? swap.return_date ?? undefined),
    returnCode: swapType === "overname" ? undefined : (swap.returnCode ?? swap.return_code ?? undefined),
    swapType,
    shiftDate: swap.shiftDate ?? swap.shift_date ?? undefined,
    shiftLine: swap.shiftLine ?? swap.shift_line ?? undefined,
    targetSeenAt: swap.targetSeenAt ?? swap.target_seen_at ?? undefined,
  };
};

export const toDatabaseSwap = (swap: SwapRecord) => {
  const swapType = normalizeSwapType(swap.swapType);
  return {
    id: String(swap.id),
    shiftid: String(swap.shiftId),
    requesterid: String(swap.requesterId),
    targetdriverid: swap.targetDriverId || null,
    status: swap.status,
    createdat: String(swap.createdAt),
    reason: swap.reason || null,
    decidedat: swap.decidedAt || null,
    return_date: swapType === "overname" ? null : (swap.returnDate || null),
    return_code: swapType === "overname" ? null : (swap.returnCode || null),
    swap_type: swapType,
    shift_date: swap.shiftDate || null,
    shift_line: swap.shiftLine || null,
    target_seen_at: swap.targetSeenAt || null,
  };
};

/**
 * Ruil zonder tegenprestatie — de planningcodes waarop een collega een dienst
 * mag overnemen zonder er iets voor terug te geven.
 *
 * Bewust een expliciete lijst en niet "alles wat geen dienst is": 'ziek' telt
 * óók niet als dienst maar mag natuurlijk geen dienst toegeschoven krijgen.
 * Wil je later 'f' (feestdag), 'kv' of 'ov' toelaten, dan is dít de enige
 * plek — de server valideert hierop en de UI toont hem via /api/availability.
 */
export const TAKEOVER_CODES = ["vrij", "bv", "tk", "ta"] as const;

const TAKEOVER_CODE_SET = new Set<string>(TAKEOVER_CODES);

export const isTakeoverCode = (code?: string | null) =>
  TAKEOVER_CODE_SET.has(toLookupToken(code));

/**
 * De planning-matrixcode per chauffeur-id voor één dag ('vrij', 'bv', '4101', …).
 * Naam-matching identiek aan buildPlanningFromMatrix/month-planning: strikt
 * genormaliseerd én volgorde-onafhankelijk ('Duysburgh Pascal' = 'Pascal
 * Duysburgh'), anders vallen accent- en omgekeerde namen stil weg.
 */
export const matrixCodesForDate = (
  rows: Array<Pick<PlanningMatrixRow, "source_date" | "assignments">>,
  users: Array<Pick<AppUser, "id" | "name">>,
  date: string,
): Map<string, string> => {
  // Gedeelde index mét botsingsdetectie — de lokale variant hier was
  // last-wins, waardoor bij twee gebruikers op dezelfde naam-sleutel de
  // codes stil bij de verkeerde chauffeur belandden terwijl de rest van de
  // app zulke sleutels juist weigert.
  const idByName = nameIdIndex(users);

  const out = new Map<string, string>();
  for (const row of rows) {
    if (String(row.source_date ?? "") !== date) continue;
    const assignments = row.assignments && typeof row.assignments === "object" && !Array.isArray(row.assignments)
      ? row.assignments
      : {};
    for (const [driverName, rawCode] of Object.entries(assignments)) {
      const id = idByName.get(toLookupToken(driverName)) ?? idByName.get(sortedNameToken(driverName));
      const code = String(rawCode ?? "").trim();
      if (!id || !code) continue;
      out.set(id, code);
    }
  }
  return out;
};

/** ISO-dag + n dagen (puur datumrekenen in UTC-frame). */
const addDagenIso = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * "ziek"-cellen in de planning-matrix waarvoor géén goedgekeurde ziekteperiode
 * in het portaal bestaat. De Excel en het Ziekte-blad lopen dan uiteen: digest,
 * advisor en het blad zelf kennen die afwezigheid niet. Aaneengesloten dagen
 * worden één reeks; `userId` is null als de Excel-naam niet aan een account te
 * koppelen is (dan valt er ook niets te registreren).
 */
export const vindOngeregistreerdeZiekte = (
  rows: Array<Pick<PlanningMatrixRow, "source_date" | "assignments">>,
  users: Array<Pick<AppUser, "id" | "name">>,
  leave: Array<{ userId?: unknown; startDate?: unknown; endDate?: unknown; status?: unknown; type?: unknown }>,
  vanafDatum?: string,
): Array<{ userId: string | null; naam: string; van: string; tot: string; dagen: number }> => {
  const idByName = nameIdIndex(users);
  const naamById = new Map(users.map((u) => [String(u.id), String(u.name ?? "")]));
  const ziekteLeave = leave.filter((l) => l?.status === "approved" && String(l?.type) === "ziekte");
  const gedekt = (userId: string, date: string) =>
    ziekteLeave.some((l) => {
      if (String(l.userId) !== userId) return false;
      const start = String(l.startDate ?? "");
      const eind = String(l.endDate ?? "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(eind) || start > eind) return false;
      return start <= date && date <= eind;
    });
  const perPersoon = new Map<string, { userId: string | null; naam: string; dagen: string[] }>();
  const gesorteerd = [...rows].sort((a, b) => String(a.source_date).localeCompare(String(b.source_date)));
  for (const row of gesorteerd) {
    const date = String(row.source_date ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (vanafDatum && date < vanafDatum) continue;
    const assignments = row.assignments && typeof row.assignments === "object" && !Array.isArray(row.assignments)
      ? row.assignments
      : {};
    for (const [naam, v] of Object.entries(assignments)) {
      if (String(v ?? "").trim().toLowerCase() !== "ziek") continue;
      const id = idByName.get(toLookupToken(naam)) ?? idByName.get(sortedNameToken(naam)) ?? null;
      if (id && gedekt(id, date)) continue;
      const sleutel = id ?? `naam:${sortedNameToken(naam)}`;
      let entry = perPersoon.get(sleutel);
      if (!entry) {
        entry = { userId: id, naam: (id && naamById.get(id)) || naam, dagen: [] };
        perPersoon.set(sleutel, entry);
      }
      entry.dagen.push(date);
    }
  }
  // Losse dagen → aaneengesloten reeksen. Een niet-zieke dag ertussen (bv.
  // "vrij" op zaterdag) breekt de reeks bewust: liever twee korte periodes
  // registreren dan stilzwijgend een langere ziekte aannemen.
  const out: Array<{ userId: string | null; naam: string; van: string; tot: string; dagen: number }> = [];
  for (const p of perPersoon.values()) {
    let van = "";
    let vorige = "";
    let telling = 0;
    const sluit = () => {
      if (van) out.push({ userId: p.userId, naam: p.naam, van, tot: vorige, dagen: telling });
    };
    for (const date of p.dagen) {
      if (van && date === addDagenIso(vorige, 1)) {
        vorige = date;
        telling += 1;
        continue;
      }
      sluit();
      van = date;
      vorige = date;
      telling = 1;
    }
    sluit();
  }
  return out.sort((a, b) => a.van.localeCompare(b.van) || a.naam.localeCompare(b.naam));
};

export const toPublicDiversion = (d: any): DiversionRecord => ({
  id: String(d.id),
  line: d.line ?? "",
  title: d.title ?? "",
  description: d.description ?? "",
  startDate: d.startDate ?? d.startdate ?? "",
  endDate: d.endDate ?? d.enddate ?? undefined,
  pdfUrl: d.pdfUrl ?? d.pdfurl ?? undefined,
});

/** De bijlage van een omleiding hoort altijd in onze eigen (privé) Storage-bucket
 *  te staan; op lezen wordt de URL toch vervangen door een verse signed URL uit
 *  `${id}.pdf`. Een planner die hier een vrije URL kon opslaan, kon collega's
 *  vanuit het portaal naar een externe pagina sturen — op iOS-standalone
 *  navigeert de "Bekijk PDF"-fallback zelfs het PWA-venster zelf. `data:`,
 *  `javascript:` en `blob:` worden client-side al geweigerd (isSafeDocumentUrl
 *  in src/lib/ui.ts); dit is de server-side helft daarvan. */
export const sanitizeDiversionPdfUrl = (value?: string | null): string | null => {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const storageHost = (() => {
    try {
      return new URL(process.env.SUPABASE_URL ?? "").host;
    } catch {
      return "";
    }
  })();
  // Zonder geconfigureerde SUPABASE_URL valt er niets te vergelijken — dan
  // liever de URL laten vallen dan een onbekende origin doorlaten.
  if (!storageHost) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    if (url.host !== storageHost) return null;
    return raw;
  } catch {
    return null;
  }
};

// LET OP: diversions heeft — anders dan de meeste tabellen — quoted
// camelCase-kolommen in productie ("startDate"/"endDate"/"pdfUrl", geverifieerd
// 2026-08-01). De mapper schreef lowercase en dat liet élke omleiding-save
// falen met 42703. mapCoordinates wordt bewust NIET geschreven: de kolom
// bestaat live niet en het beheer-formulier heeft er geen veld voor — het
// veld leeft alleen als defensieve leesroute in toPublicDiversion.
export const toDatabaseDiversion = (d: DiversionRecord) => ({
  id: String(d.id),
  line: d.line,
  title: d.title,
  description: d.description,
  startDate: d.startDate,
  endDate: d.endDate || null,
  pdfUrl: sanitizeDiversionPdfUrl(d.pdfUrl),
});

export const toPublicService = (s: any) => ({
  id: String(s.id),
  serviceNumber: String(s.serviceNumber ?? s.servicenumber ?? ''),
  startTime: String(s.startTime ?? s.starttime ?? ''),
  endTime: String(s.endTime ?? s.endtime ?? ''),
  startTime2: s.startTime2 ?? s.starttime2 ?? undefined,
  endTime2: s.endTime2 ?? s.endtime2 ?? undefined,
  startTime3: s.startTime3 ?? s.starttime3 ?? undefined,
  endTime3: s.endTime3 ?? s.endtime3 ?? undefined,
  // Loopnummers MOETEN hier mee: deze mapper zit tussen de database en zowel
  // de API-respons als de planning-import. Ontbraken ze, dan kwam er nooit
  // een loopnummer op een planning-rij terecht — en wiste elk opslaan vanuit
  // het beheerscherm ze bovendien uit de database (zie toDatabaseService).
  loopnr: s.loopnr ?? undefined,
  loopnr2: s.loopnr2 ?? undefined,
  loopnr3: s.loopnr3 ?? undefined,
});

// Supabase heeft de services-tabel met *quoted camelCase* kolommen aangemaakt
// (via de Table Editor). Onquoted SQL-identifiers worden gevouwen naar lowercase,
// dus we moeten hier camelCase keys schrijven — anders krijg je
// `column "servicenumber" does not exist`.
export const toDatabaseService = (s: any) => ({
  id: String(s.id),
  serviceNumber: String(s.serviceNumber ?? s.servicenumber ?? ''),
  startTime: String(s.startTime ?? s.starttime ?? ''),
  endTime: String(s.endTime ?? s.endtime ?? ''),
  startTime2: s.startTime2 ?? s.starttime2 ?? null,
  endTime2: s.endTime2 ?? s.endtime2 ?? null,
  startTime3: s.startTime3 ?? s.starttime3 ?? null,
  endTime3: s.endTime3 ?? s.endtime3 ?? null,
  loopnr: s.loopnr ?? null,
  loopnr2: s.loopnr2 ?? null,
  loopnr3: s.loopnr3 ?? null,
});

export const toPublicLeave = (leave: any): LeaveRecord => ({
  id: String(leave.id),
  userId: String(leave.userId ?? leave.userid),
  startDate: String(leave.startDate ?? leave.startdate),
  endDate: String(leave.endDate ?? leave.enddate),
  type: leave.type,
  status: leave.status,
  comment: leave.comment ?? undefined,
  createdAt: String(leave.createdAt ?? leave.createdat),
  decidedAt: leave.decidedAt ?? leave.decidedat ?? undefined,
});

export const toDatabaseLeave = (leave: LeaveRecord) => ({
  id: String(leave.id),
  userid: String(leave.userId),
  startdate: String(leave.startDate),
  enddate: String(leave.endDate),
  type: leave.type,
  status: leave.status,
  comment: leave.comment || null,
  createdat: String(leave.createdAt),
  decidedat: leave.decidedAt || null,
});

export const toPublicPlanningCode = (code: any): PlanningCodeRecord => ({
  code: String(code.code || "").trim().toLowerCase(),
  category: code.category || "unknown",
  description: code.description || "",
  countsAsShift: Boolean(code.countsAsShift ?? code.counts_as_shift),
  isPaidAbsence: Boolean(code.isPaidAbsence ?? code.is_paid_absence),
  isDayOff: Boolean(code.isDayOff ?? code.is_day_off),
});

export const toDatabasePlanningCode = (code: PlanningCodeRecord) => ({
  code: String(code.code || "").trim().toLowerCase(),
  category: code.category,
  description: code.description?.trim() || "",
  counts_as_shift: code.countsAsShift === true,
  is_paid_absence: code.isPaidAbsence === true,
  is_day_off: code.isDayOff === true,
});

export const toPublicUpdate = (update: any) => ({
  id: String(update.id),
  date: String(update.date || ""),
  title: update.title || "",
  category: update.category || "algemeen",
  content: update.content || "",
  isUrgent: Boolean(update.isUrgent ?? update.isurgent),
});

export const toDatabaseUpdate = (update: any) => ({
  id: String(update.id),
  date: String(update.date || ""),
  title: update.title || "",
  category: update.category || "algemeen",
  content: update.content || "",
  isurgent: Boolean(update.isUrgent),
});

export const toLookupToken = (value?: string | null) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Volgorde-onafhankelijke naam-token: "Jan Peeters" en "Peeters Jan" → zelfde
 *  sleutel. Stond 4× lokaal uitgeschreven; dit is nu dé plek. */
export const sortedNameToken = (name: string) =>
  toLookupToken(name).split(/\s+/).filter(Boolean).sort().join(" ");

/**
 * Naam→id-index over beide token-vormen, mét botsingsdetectie: komen twee
 * verschillende gebruikers op dezelfde sleutel uit ("Jan Peeters" naast
 * "Peeters Jan"), dan wordt die sleutel onbruikbaar in plaats van last-wins —
 * dezelfde weigering die buildPlanningFromMatrix hanteert. Anders filtert de
 * dekking bij zo'n botsing de cel van de verkeerde chauffeur weg en meldt hij
 * een fantoom-gat op de verkeerde naam.
 */
export const nameIdIndex = (users: Array<{ id: string | number; name?: string | null }>): Map<string, string> => {
  const map = new Map<string, string>();
  const botsingen = new Set<string>();
  const zet = (token: string, id: string) => {
    if (!token) return;
    const bestaand = map.get(token);
    if (bestaand !== undefined && bestaand !== id) botsingen.add(token);
    else map.set(token, id);
  };
  for (const u of users) {
    const id = String(u.id);
    zet(toLookupToken(u.name), id);
    zet(sortedNameToken(String(u.name ?? "")), id);
  }
  for (const token of botsingen) map.delete(token);
  return map;
};

/** Nette verloftype-labels (server-kant). Bewust gedupliceerd in
 *  src/lib/format.ts (LEAVE_TYPE_LABELS) — de repo-conventie verbiedt
 *  cross-imports tussen api/ en src/; de drift-test in sharedTypes.test.ts
 *  bewaakt dat de twee gelijk blijven. */
export const LEAVE_TYPE_LABEL: Record<string, string> = {
  betaald_verlof: "Betaald verlof",
  klein_verlet: "Klein verlet",
  ziekte: "Ziekte",
};

/** Vervaldata-soorten (Code 95 / medische schifting). Bewust gedupliceerd in
 *  src/lib/format.ts (EXPIRY_SOORT_LABELS) — zelfde drift-test-afspraak als
 *  LEAVE_TYPE_LABEL. Rijbewijs is er op verzoek van Jarno (07-08) uit: de PUT
 *  weigert die soort daardoor met een 400 en de GET filtert oude rijen weg
 *  (zie /api/user-expiries), zodat achtergebleven data nergens meer opduikt. */
export const EXPIRY_SOORT_LABEL: Record<string, string> = {
  code95: "Code 95",
  medische_schifting: "Medische schifting",
};

/**
 * Is deze gebruiker op deze dag goedgekeurd afwezig? Geeft het type terug;
 * ziekte wint bij overlappende records (dát is het signaal waar actie op moet
 * volgen — verlof mag een ziekmelding nooit maskeren). Records met kapotte of
 * omgekeerde datums tellen niet mee.
 */
export const afwezigOp = (
  leave: Array<{ userId?: unknown; startDate?: unknown; endDate?: unknown; status?: unknown; type?: unknown }>,
  userId: string,
  date: string,
): { type: string } | null => {
  let gevonden: { type: string } | null = null;
  for (const l of leave) {
    if (l?.status !== "approved" || String(l.userId) !== userId) continue;
    const start = String(l.startDate ?? "");
    const eind = String(l.endDate ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(eind) || start > eind) continue;
    if (start <= date && date <= eind) {
      if (String(l.type) === "ziekte") return { type: "ziekte" };
      gevonden = { type: String(l.type) };
    }
  }
  return gevonden;
};

export const ensureUniqueUserEmails = (users: IncomingUser[]) => {
  const seen = new Set<string>();

  for (const user of users) {
    const email = normalizeEmail(user.email);
    if (!email) continue;

    if (seen.has(email)) {
      throw new Error(`E-mailadres ${email} komt meerdere keren voor.`);
    }

    seen.add(email);
  }
};

export const countAdmins = (users: Array<Pick<AppUser, "role" | "isActive">>) =>
  users.filter((user) => user.role === "admin" && user.isActive !== false).length;

// crypto i.p.v. Math.random: dit wordt het wérkende wachtwoord van nieuw
// aangemaakte auth-accounts zonder opgegeven wachtwoord.
export const randomPassword = () => randomBytes(12).toString("base64url") + "A1!";

const PLANNING_MATRIX_MONTHS: Record<string, string> = {
  jan: "01",
  feb: "02",
  mrt: "03",
  mar: "03",
  apr: "04",
  mei: "05",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  okt: "10",
  oct: "10",
  nov: "11",
  dec: "12",
};

export const normalizePlanningMatrixDate = (raw: string) => {
  const value = String(raw || "").trim();
  const normalizedValue = value.replace(/\//g, "-");
  const parts = normalizedValue.split("-");
  if (parts.length !== 3) return value;

  const [day, monthRaw, yearRaw] = parts;
  // Numerieke maand ("06-04-2026" of "06/04/2026", dd-mm-jjjj) — kwam als
  // tekst-cel uit Excel en werd stilzwijgend overgeslagen.
  const numericMonth = /^\d{1,2}$/.test(monthRaw) && Number(monthRaw) >= 1 && Number(monthRaw) <= 12
    ? String(monthRaw).padStart(2, "0")
    : undefined;
  const month = numericMonth ?? PLANNING_MATRIX_MONTHS[monthRaw.toLowerCase()];
  if (!month) return value;

  const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
  return `${year}-${month}-${day.padStart(2, "0")}`;
};

// Headers in de praktijk-tab die GEEN echte chauffeur zijn en dus
// genegeerd moeten worden bij assignment-detectie.
const PLANNING_MATRIX_NON_DRIVER_HEADERS = new Set([
  "",
  "undefined",
  "flexi/invallers",
  "flexi",
  "invallers",
  "aantal",
]);

// Excel serial → ISO YYYY-MM-DD. SheetJS rondt naar dichtstbijzijnde dag;
// we negeren tijd-fractie omdat de praktijk-tab dagniveau is.
const excelSerialToIso = (serial: number): string | null => {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const parsed = (XLSX as any).SSF?.parse_date_code?.(serial);
  if (!parsed || !parsed.y || !parsed.m || !parsed.d) return null;
  const y = String(parsed.y).padStart(4, "0");
  const m = String(parsed.m).padStart(2, "0");
  const d = String(parsed.d).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

// Lees de praktijk-tab uit een .xls/.xlsx-buffer en bouw een
// PlanningMatrixRow[]-shape die de downstream pipeline
// (buildPlanningFromMatrix → preview → confirm) kan verwerken. Datums
// blijven Excel-serial zodat we geen locale-LUT nodig hebben, en lege
// cellen vs. lege strings blijven goed gescheiden.
/** Achterwaarts-compatibele variant zonder waarschuwingen (tests, oude callers). */
export const parsePlanningMatrixXlsx = (buffer: Buffer): PlanningMatrixRow[] =>
  parsePlanningMatrixXlsxMetWaarschuwingen(buffer).rows;

export const parsePlanningMatrixXlsxMetWaarschuwingen = (
  buffer: Buffer,
): { rows: PlanningMatrixRow[]; waarschuwingen: string[] } => {
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheetName = workbook.SheetNames.find((name) => name.trim().toLowerCase() === "praktijk");
  if (!sheetName) {
    throw new Error(`Tabblad "praktijk" niet gevonden. Beschikbaar: ${workbook.SheetNames.join(", ")}`);
  }
  const sheet = workbook.Sheets[sheetName];
  if (!sheet || !sheet["!ref"]) {
    throw new Error('Tabblad "praktijk" is leeg.');
  }
  const range = XLSX.utils.decode_range(sheet["!ref"]);

  // Header-rij = rij 0. Verzamel alle kolomnamen.
  const header: string[] = [];
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: 0, c })];
    header.push(cell ? String(cell.v).trim() : "");
  }

  // Driver-block loopt van kolom 2 tot vóór de eerste "aantal"-kolom.
  const firstTotalsIndex = header.findIndex((cell, index) => index > 1 && cell.toLowerCase() === "aantal");
  if (firstTotalsIndex === -1) {
    throw new Error('Kolom "aantal" niet gevonden in praktijk-tab. Excel-structuur klopt niet.');
  }
  const driverColumns = header
    .slice(2, firstTotalsIndex)
    .map((name, offset) => ({ index: offset + 2, name }))
    .filter((column) => !PLANNING_MATRIX_NON_DRIVER_HEADERS.has(column.name.toLowerCase()));

  // Dubbele chauffeur-kolommen: assignments[naam] is laatste-wint, dus de
  // codes van de eerste kolom zouden geruisloos verdwijnen. Hard weigeren
  // met de namen erbij, zodat de planner het in de Excel kan rechtzetten.
  const seenHeaders = new Map<string, string>();
  const duplicateHeaders = new Set<string>();
  for (const column of driverColumns) {
    const key = column.name.trim().toLowerCase();
    if (!key) continue;
    if (seenHeaders.has(key)) duplicateHeaders.add(column.name.trim());
    else seenHeaders.set(key, column.name.trim());
  }
  if (duplicateHeaders.size > 0) {
    throw new Error(`Dubbele chauffeur-kolommen in de praktijk-tab: ${Array.from(duplicateHeaders).join(", ")}. Hernoem of verwijder de dubbele kolom en importeer opnieuw.`);
  }

  // Naamachtige kolommen NÁ de eerste "aantal"-kolom: daar begint het
  // tellingen-blok en daar leest de import bewust niet. Een chauffeur die per
  // ongeluk achteraan is toegevoegd, verdween tot nu geruisloos uit het
  // portaal — vandaar een expliciete (niet-blokkerende) waarschuwing.
  const NAAMACHTIG_RE = /^[a-zà-ÿ'’.-]+(\s+[a-zà-ÿ'’.-]+)+$/i;
  const waarschuwingen: string[] = [];
  for (let i = firstTotalsIndex + 1; i < header.length; i++) {
    const naam = String(header[i] ?? "").trim();
    if (!naam) continue;
    const laag = naam.toLowerCase();
    if (laag === "aantal" || PLANNING_MATRIX_NON_DRIVER_HEADERS.has(laag)) continue;
    if (!NAAMACHTIG_RE.test(naam)) continue;
    waarschuwingen.push(`Kolom "${naam}" staat ná de "aantal"-kolom en wordt niet geïmporteerd — staat daar een chauffeur, verplaats de kolom dan vóór "aantal" en importeer opnieuw.`);
  }

  // Voor diagnostiek bij faal: bewaar wat we wél zagen in kolom A.
  const seenColumnA: Array<{ row: number; type: string; raw: any; display?: string }> = [];

  const isValidIsoDate = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);

  const rows: PlanningMatrixRow[] = [];

  for (let r = 1; r <= range.e.r; r++) {
    const dateCell = sheet[XLSX.utils.encode_cell({ r, c: 0 })];
    if (!dateCell || dateCell.v === undefined || dateCell.v === null) continue;

    // Bewaar de eerste paar cellen voor de foutmelding mocht parsing falen.
    if (seenColumnA.length < 5) {
      seenColumnA.push({ row: r, type: dateCell.t, raw: dateCell.v, display: dateCell.w });
    }

    // Strategie: probeer eerst Excel-serial (de schone-bron-format), val
    // dan terug op de tekstuele display-string of de raw string-waarde
    // via de bestaande normalizePlanningMatrixDate (handelt "06-Apr-26"
    // / "06-apr-26" / "06/04/2026"-achtige formats af).
    let sourceDate: string | null = null;
    if (dateCell.t === "n" && typeof dateCell.v === "number") {
      sourceDate = excelSerialToIso(dateCell.v);
    }
    if (!sourceDate) {
      const candidate = String(dateCell.w ?? dateCell.v ?? "").trim();
      if (candidate) {
        const normalized = normalizePlanningMatrixDate(candidate);
        if (isValidIsoDate(normalized)) sourceDate = normalized;
      }
    }
    if (!sourceDate) continue;

    const dayTypeCell = sheet[XLSX.utils.encode_cell({ r, c: 1 })];
    const dayType = dayTypeCell ? String(dayTypeCell.v).trim() : "";

    const assignments: Record<string, string> = {};
    for (const driver of driverColumns) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c: driver.index })];
      if (!cell || cell.v === undefined || cell.v === null) continue;
      const rawCode = String(cell.v).trim();
      if (!rawCode) continue;
      assignments[driver.name] = rawCode;
    }

    rows.push({
      id: `${sourceDate}-${r}`,
      source_date: sourceDate,
      day_type: dayType,
      assignments,
      raw_row: `xlsx:${sheetName}:r${r}`,
    });
  }

  if (rows.length === 0) {
    // Diagnostiek meegeven zodat de gebruiker direct ziet wat er in
    // kolom A stond — anders is "geen rijen" een blinde vlek.
    const sample = seenColumnA
      .map((s) => `R${s.row}: type=${s.type ?? "?"}, v=${JSON.stringify(s.raw)}, w=${JSON.stringify(s.display ?? "")}`)
      .join(" | ");
    const detail = sample ? ` Kolom A zag: ${sample}` : ' Kolom A was volledig leeg.';
    throw new Error(`Geen rijen met datum gevonden in praktijk-tab.${detail}`);
  }

  // Dubbele datumrijen: de maandplanning toont dan enkel de laatste rij
  // terwijl de planning-opbouw beide verwerkt (dubbele shift-ids → de hele
  // import faalt pas ná het parsen). Hard weigeren met de datums erbij.
  const seenDates = new Set<string>();
  const duplicateDates = new Set<string>();
  for (const row of rows) {
    if (seenDates.has(row.source_date)) duplicateDates.add(row.source_date);
    else seenDates.add(row.source_date);
  }
  if (duplicateDates.size > 0) {
    throw new Error(`Dubbele datumrijen in de praktijk-tab: ${Array.from(duplicateDates).sort().join(", ")}. Elke datum hoort één rij te hebben — verwijder de dubbele rij en importeer opnieuw.`);
  }

  return { rows, waarschuwingen };
};

/**
 * Meldingen die wél in client_errors thuishoren maar niet in de foutendigest.
 * Twee soorten ruis, allebei geen defect:
 *
 *  - "sessie is verlopen" — levenscyclus. Wie lang niet inlogde krijgt die
 *    toast gewoon (sinds #248 al gefilterd, verzoek Jarno).
 *  - chunk-laadfouten na een deploy — een tabblad dat openstaat tijdens een
 *    uitrol verwijst nog naar bestandsnamen die net vervangen zijn.
 *    lazyWithRetry vangt dat op met een stille retry en desnoods één reload,
 *    dus de gebruiker merkt er niets van; alleen de melding was al onderweg.
 *    Op 02-08 vulde dat de digest met 10 van de 16 fouten, allemaal van de
 *    eigen toestellen tijdens het uitrollen.
 *
 * De rijen blijven in de database en in Systeem Status zichtbaar — dit filtert
 * alleen wat er in de dagelijkse mail terechtkomt, zodat een écht probleem
 * daar niet in verdrinkt.
 */
const DIGEST_RUIS = [
  "sessie is verlopen",
  "failed to fetch dynamically imported module",
  "error loading dynamically imported module",
  "importing a module script failed",
  "'text/html' is not a valid javascript mime type",
];

export const isDigestRuis = (message?: string | null): boolean => {
  const m = String(message ?? "").toLowerCase();
  return DIGEST_RUIS.some((patroon) => m.includes(patroon));
};
