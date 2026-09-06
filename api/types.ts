import type express from "express";
import type { User as SupabaseAuthUser } from "@supabase/supabase-js";
import type { DashboardVoorkeuren } from "../shared/schemas/dashboardVoorkeuren.js";
import type { MeldingSoort } from "../shared/schemas/meldingen.js";

export type Role = "chauffeur" | "planner" | "admin";

export interface AppUser {
  id: string;
  name: string;
  role: Role;
  employeeId: string;
  lastLogin?: string;
  activeSessions?: number;
  isActive?: boolean;
  phone?: string;
  email?: string;
  verlofBudget?: number;
  showInContacts?: boolean;
  /** Admins: ontvangt systeemmails (foutendigest, back-ups). Default true. */
  wantsSystemMail?: boolean;
  section?: string;
  startDate?: string;
  /** Eigen dashboardindeling (verborgen tegels + volgorde) — alleen in het
   *  eigen profiel (/api/me); PATCH /api/me/voorkeuren schrijft hem. */
  dashboardVoorkeuren?: DashboardVoorkeuren;
}

/** Eén rij uit public.meldingen zoals de API hem teruggeeft (camelCase). */
export interface MeldingRecord {
  id: string;
  titel: string;
  tekst?: string;
  soort: MeldingSoort;
  /** Pad in de app (bv. 'mijn-dag', 'dienstruil'); leeg = geen doel. */
  doel?: string;
  createdAt: string;
  gelezenOp?: string;
}

/** Server-intern: profiel mét de Supabase Auth-uid waaraan het gekoppeld is
 *  (sinds 05-09 de identiteit voor de sessie; e-mail is alleen nog de eerste
 *  koppeling). Gaat nooit naar de client — toRoleScopedUser strookt hem. */
export interface AppUserIntern extends AppUser {
  authId?: string;
}

export interface IncomingUser extends AppUser {
  password?: string;
}

/** Spiegel van SwapType in src/types.ts — waarden moeten 1-op-1 matchen. */
export type SwapType = "ruil" | "overname";

export interface SwapRecord {
  id: string;
  shiftId: string;
  requesterId: string;
  targetDriverId?: string;
  status: "pending" | "accepted" | "approved" | "rejected" | "completed" | "cancelled";
  createdAt: string;
  reason?: string;
  decidedAt?: string;
  returnDate?: string;
  returnCode?: string;
  /** 'ruil' = 1-op-1 (returnDate + returnCode gevuld), 'overname' = zonder tegenprestatie. */
  swapType?: SwapType;
  /** Dag van de aangeboden dienst — server-side ingevuld bij het indienen.
   *  Sleutel voor de automatische planning-doorvoer (shiftid is niet stabiel
   *  over heropbouwen heen). */
  shiftDate?: string;
  /** Dienstnummer van de aangeboden dienst (planning.line) — idem. */
  shiftLine?: string;
  /** Moment waarop de ontvangende chauffeur de wissel bevestigde ("gezien").
   *  Alleen schrijfbaar via het eigen bevestig-endpoint; de array-route
   *  behoudt altijd de opgeslagen waarde. */
  targetSeenAt?: string;
}

export interface LeaveRecord {
  id: string;
  userId: string;
  startDate: string;
  endDate: string;
  type: "betaald_verlof" | "klein_verlet" | "ziekte";
  status: "pending" | "approved" | "rejected" | "cancelled";
  comment?: string;
  createdAt: string;
  decidedAt?: string;
}

export interface PlanningMatrixRow {
  id: string;
  source_date: string;
  day_type: string;
  assignments: Record<string, string>;
  raw_row: string;
}

export interface PlanningCodeRecord {
  code: string;
  category: "service" | "absence" | "leave" | "training" | "unknown";
  description: string;
  countsAsShift: boolean;
  isPaidAbsence: boolean;
  isDayOff: boolean;
}

export interface PlanningMatrixImportHistoryRecord {
  id: string;
  createdAt: string;
  importedDays: number;
  detectedDrivers: number;
  generatedShifts: number;
  matchedServices: number;
  skippedAbsences: number;
  unknownCodes: string[];
  unmatchedDrivers: string[];
  /** Audit sinds 27-08: welk bestand, welke periode, door wie — en het pad
   *  naar het herstelpunt (stand van vóór de import) in de backups-bucket.
   *  Nullable: oudere rijen hebben deze velden niet. */
  filename?: string | null;
  importedBy?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  fileStart?: string | null;
  fileEnd?: string | null;
  snapshotPath?: string | null;
}

export type ActivityCategory =
  | "users"
  | "planning"
  | "planning_codes"
  | "services"
  | "diversions"
  | "updates"
  | "auth"
  | "leave"
  | "swaps"
  | "system";

export type ActivityEntityType =
  | "user"
  | "service"
  | "diversion"
  | "update"
  | "swap"
  | "leave"
  | "planning_code"
  | "shift";

export interface ActivityLogRecord {
  id: string;
  createdAt: string;
  actorName: string;
  actorRole: Role;
  category: ActivityCategory;
  action: string;
  details: string;
  entityType?: ActivityEntityType | null;
  entityId?: string | null;
}

export type ActivityLogRow = {
  id: string;
  created_at: string;
  actor_name: string;
  actor_role: Role;
  category: ActivityCategory;
  action: string;
  details: string;
  entity_type?: ActivityEntityType | null;
  entity_id?: string | null;
};

export type PlanningMatrixImportHistoryRow = {
  id: string;
  created_at: string;
  imported_days: number;
  detected_drivers: number;
  generated_shifts: number;
  matched_services: number;
  skipped_absences: number;
  unknown_codes: string[];
  unmatched_drivers: string[];
  filename?: string | null;
  imported_by?: string | null;
  period_start?: string | null;
  period_end?: string | null;
  file_start?: string | null;
  file_end?: string | null;
  snapshot_path?: string | null;
};

export interface DiversionRecord {
  id: string;
  line: string;
  title: string;
  description: string;
  startDate: string;
  endDate?: string;
  pdfUrl?: string;
}

export interface ServiceRecord {
  id: string;
  serviceNumber: string;
  startTime: string;
  endTime: string;
  startTime2?: string;
  endTime2?: string;
  startTime3?: string;
  endTime3?: string;
  /** Loopnummer per tijdsblok: een loop is het deel van de dienst waar
   *  bepaalde ritten onder vallen. Blok 1 = loopnr, blok 2 = loopnr2, enz. */
  loopnr?: string;
  loopnr2?: string;
  loopnr3?: string;
}

export interface ShiftRecord {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  line: string;
  busNumber: string;
  loopnr: string;
  driverId: string;
}

export type AuthenticatedRequest = express.Request & {
  /** Alleen id + e-mail: sinds de lokale JWT-verificatie (getClaims) is er
   *  geen volledig Auth-User-object meer per request (controle-ronde 27-08, nr. 55). */
  authUser?: Pick<SupabaseAuthUser, "id" | "email">;
  appUser?: AppUser;
  accessToken?: string;
};
