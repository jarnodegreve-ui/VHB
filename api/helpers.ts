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
});

export const toRoleScopedUser = (user: AppUser, role: Role): AppUser => {
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

  return {
    id: user.id,
    name: user.name,
    role: user.role,
    employeeId: "",
    phone: user.phone,
    email: user.email,
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
});

export const toPublicDiversion = (d: any): DiversionRecord => ({
  id: String(d.id),
  line: d.line ?? "",
  title: d.title ?? "",
  description: d.description ?? "",
  startDate: d.startDate ?? d.startdate ?? "",
  endDate: d.endDate ?? d.enddate ?? undefined,
  severity: d.severity,
  pdfUrl: d.pdfUrl ?? d.pdfurl ?? undefined,
  mapCoordinates: d.mapCoordinates ?? d.mapcoordinates ?? undefined,
});

export const toDatabaseDiversion = (d: DiversionRecord) => ({
  id: String(d.id),
  line: d.line,
  title: d.title,
  description: d.description,
  startdate: d.startDate,
  enddate: d.endDate || null,
  severity: d.severity,
  pdfurl: d.pdfUrl || null,
  mapcoordinates: d.mapCoordinates || null,
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

export const randomPassword = () => Math.random().toString(36).slice(-10) + "A1!";

export const PLANNING_MATRIX_MONTHS: Record<string, string> = {
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
  const month = PLANNING_MATRIX_MONTHS[monthRaw.toLowerCase()];
  if (!month) return value;

  const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;
  return `${year}-${month}-${day.padStart(2, "0")}`;
};

export const parsePlanningMatrixCsv = (csvContent: string): PlanningMatrixRow[] => {
  const raw = csvContent.replace(/^\uFEFF/, "");
  const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    throw new Error("Bestand bevat geen bruikbare rijen.");
  }

  const header = lines[0].split(";").map((cell) => cell.trim());
  const firstTotalsIndex = header.findIndex((cell, index) => index > 1 && cell.toLowerCase() === "aantal");
  if (firstTotalsIndex === -1) {
    throw new Error('Kolom "aantal" niet gevonden. Dit CSV-formaat wordt niet herkend.');
  }

  const driverColumns = header
    .slice(2, firstTotalsIndex)
    .map((name, offset) => ({ index: offset + 2, name: name.trim() }))
    .filter((column) => column.name.length > 0);

  return lines.slice(1).map((line, rowIndex) => {
    const cells = line.split(";");
    const sourceDate = normalizePlanningMatrixDate(cells[0] || "");
    const assignments: Record<string, string> = {};

    for (const driver of driverColumns) {
      const rawCode = String(cells[driver.index] || "").trim();
      if (!rawCode) continue;
      assignments[driver.name] = rawCode;
    }

    return {
      id: `${sourceDate}-${rowIndex + 1}`,
      source_date: sourceDate,
      day_type: String(cells[1] || "").trim(),
      assignments,
      raw_row: line,
    };
  });
};
