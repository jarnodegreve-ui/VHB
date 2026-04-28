import type express from "express";
import type { User as SupabaseAuthUser } from "@supabase/supabase-js";

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
}

export interface IncomingUser extends AppUser {
  password?: string;
}

export interface SwapRecord {
  id: string;
  shiftId: string;
  requesterId: string;
  targetDriverId?: string;
  status: "pending" | "approved" | "rejected" | "completed" | "cancelled";
  createdAt: string;
  reason?: string;
  decidedAt?: string;
}

export interface LeaveRecord {
  id: string;
  userId: string;
  startDate: string;
  endDate: string;
  type: "betaald_verlof" | "klein_verlet";
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
}

export interface ActivityLogRecord {
  id: string;
  createdAt: string;
  actorName: string;
  actorRole: Role;
  category: "users" | "planning" | "planning_codes" | "services" | "diversions" | "updates" | "auth" | "leave" | "swaps";
  action: string;
  details: string;
}

export type ActivityLogRow = {
  id: string;
  created_at: string;
  actor_name: string;
  actor_role: Role;
  category: "users" | "planning" | "planning_codes" | "services" | "diversions" | "updates" | "auth" | "leave" | "swaps";
  action: string;
  details: string;
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
};

export interface DiversionRecord {
  id: string;
  line: string;
  title: string;
  description: string;
  startDate: string;
  endDate?: string;
  severity: "low" | "medium" | "high";
  pdfUrl?: string;
  mapCoordinates?: string;
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
  authUser?: SupabaseAuthUser;
  appUser?: AppUser;
  accessToken?: string;
};
