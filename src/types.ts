export type Role = 'chauffeur' | 'planner' | 'admin';

export interface User {
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
  /** Ploeg/sectie voor de Maandplanning-groepering (Reguliere/Nacht/Flexi/Schoolvervoer). */
  section?: string;
  /** In dienst sinds (YYYY-MM-DD) — anciënniteit-sortering binnen een sectie. */
  startDate?: string;
}

export interface Diversion {
  id: string;
  line: string;
  title: string;
  description: string;
  startDate: string;
  endDate?: string;
  pdfUrl?: string;
}

/**
 * 'ruil' = klassieke 1-op-1 ruil (returnDate + returnCode gevuld).
 * 'overname' = zonder tegenprestatie: de collega neemt de dienst over en de
 * aanvrager geeft er niets voor terug. Kan alleen als de collega die dag
 * vrij/bv/tk/ta staat — de server dwingt dat af (POST /api/swaps).
 * Spiegel van SwapType in api/types.ts.
 */
export type SwapType = 'ruil' | 'overname';

export interface SwapRequest {
  id: string;
  shiftId: string;
  requesterId: string;
  targetDriverId?: string;
  // 'accepted' = de collega ging akkoord; wacht nog op validatie (rij-/
  // rusttijden) door planner/admin → daarna 'approved'.
  status: 'pending' | 'accepted' | 'approved' | 'rejected' | 'completed' | 'cancelled';
  createdAt: string;
  reason?: string;
  decidedAt?: string;
  // 1-op-1 ruil: wat de aanvrager in ruil neemt van de collega.
  // returnCode = dienstnummer of 'vrij'; returnDate = de dag ervan.
  returnDate?: string;
  returnCode?: string;
  /** Ontbreekt op oude records → 'ruil'. */
  swapType?: SwapType;
  /** Dag + dienstnummer van de aangeboden dienst — door de server ingevuld. */
  shiftDate?: string;
  shiftLine?: string;
  /** Moment waarop de ontvangende chauffeur de wissel bevestigde ("gezien"). */
  targetSeenAt?: string;
}

export interface LeaveRequest {
  id: string;
  userId: string;
  startDate: string;
  endDate: string;
  type: 'betaald_verlof' | 'klein_verlet' | 'ziekte';
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  comment?: string;
  createdAt: string;
  decidedAt?: string;
}

export interface Shift {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
  line: string;
  busNumber: string;
  loopnr: string;
  driverId: string;
}

export interface Update {
  id: string;
  date: string;
  title: string;
  content: string;
  /** Historisch veld — de UI kent geen categorieën meer (#241); bestaande
   *  rijen behouden hun waarde, nieuwe krijgen 'algemeen'. */
  category?: 'algemeen' | 'veiligheid' | 'technisch';
  isUrgent?: boolean;
}

export interface Service {
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

export interface PlanningMatrixRow {
  id: string;
  source_date: string;
  day_type: string;
  assignments: Record<string, string>;
  raw_row: string;
}

export interface PlanningCode {
  code: string;
  category: 'service' | 'absence' | 'leave' | 'training' | 'unknown';
  description: string;
  countsAsShift: boolean;
  isPaidAbsence: boolean;
  isDayOff: boolean;
}

export interface PlanningMatrixImportHistory {
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

export type ActivityCategory =
  | 'users'
  | 'planning'
  | 'planning_codes'
  | 'services'
  | 'diversions'
  | 'updates'
  | 'auth'
  | 'leave'
  | 'swaps'
  // Systeem-acties (bv. backup-restore) — bestond al server-side (api/types.ts)
  // maar ontbrak hier, waardoor restore-events een lege badge kregen.
  | 'system';

export type ActivityEntityType =
  | 'user'
  | 'service'
  | 'diversion'
  | 'update'
  | 'swap'
  | 'leave'
  | 'planning_code'
  | 'shift';

export interface ActivityLogEntry {
  id: string;
  createdAt: string;
  actorName: string;
  actorRole: Role;
  category: ActivityCategory;
  action: string;
  details: string;
  /** Type van de entity die gewijzigd is (voor per-entity geschiedenis). Optional voor legacy. */
  entityType?: ActivityEntityType | null;
  /** ID van de entity (bv. shift-id, service-id). Optional voor legacy. */
  entityId?: string | null;
}

export type View = 'dashboard' | 'omleidingen' | 'rooster' | 'updates' | 'beheer-roosters' | 'beheer-updates' | 'gebruikers' | 'toestellen' | 'beheer-omleidingen' | 'contacten' | 'dienstoverzicht' | 'beheer-dienstoverzicht' | 'ruil-verzoeken' | 'verlof-kalender' | 'verlof' | 'planning-matrix' | 'planning-codes' | 'activiteit' | 'beheer-debug' | 'ritblaadjes' | 'documenten' | 'bezetting' | 'dekking' | 'assistent' | 'ocpi-monitoring' | 'vervaldata' | 'ziekte';
