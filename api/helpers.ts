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

export const toPublicSwap = (swap: any): SwapRecord => ({
  id: String(swap.id),
  shiftId: String(swap.shiftId ?? swap.shiftid),
  requesterId: String(swap.requesterId ?? swap.requesterid),
  targetDriverId: swap.targetDriverId ?? swap.targetdriverid ?? undefined,
  status: swap.status,
  createdAt: String(swap.createdAt ?? swap.createdat),
  reason: swap.reason ?? undefined,
  decidedAt: swap.decidedAt ?? swap.decidedat ?? undefined,
  returnDate: swap.returnDate ?? swap.return_date ?? undefined,
  returnCode: swap.returnCode ?? swap.return_code ?? undefined,
});

export const toDatabaseSwap = (swap: SwapRecord) => ({
  id: String(swap.id),
  shiftid: String(swap.shiftId),
  requesterid: String(swap.requesterId),
  targetdriverid: swap.targetDriverId || null,
  status: swap.status,
  createdat: String(swap.createdAt),
  reason: swap.reason || null,
  decidedat: swap.decidedAt || null,
  return_date: swap.returnDate || null,
  return_code: swap.returnCode || null,
});

export const toPublicDiversion = (d: any): DiversionRecord => ({
  id: String(d.id),
  line: d.line ?? "",
  title: d.title ?? "",
  description: d.description ?? "",
  startDate: d.startDate ?? d.startdate ?? "",
  endDate: d.endDate ?? d.enddate ?? undefined,
  pdfUrl: d.pdfUrl ?? d.pdfurl ?? undefined,
  mapCoordinates: d.mapCoordinates ?? d.mapcoordinates ?? undefined,
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

export const toDatabaseDiversion = (d: DiversionRecord) => ({
  id: String(d.id),
  line: d.line,
  title: d.title,
  description: d.description,
  startdate: d.startDate,
  enddate: d.endDate || null,
  pdfurl: sanitizeDiversionPdfUrl(d.pdfUrl),
  mapcoordinates: d.mapCoordinates || null,
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
export const parsePlanningMatrixXlsx = (buffer: Buffer): PlanningMatrixRow[] => {
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

  return rows;
};
