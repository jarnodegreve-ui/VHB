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
}

export interface Diversion {
  id: string;
  line: string;
  title: string;
  description: string;
  startDate: string;
  endDate?: string;
  severity: 'low' | 'medium' | 'high';
  pdfUrl?: string;
  mapCoordinates?: string;
}

export interface SwapRequest {
  id: string;
  shiftId: string;
  requesterId: string;
  targetDriverId?: string;
  status: 'pending' | 'approved' | 'rejected' | 'completed';
  createdAt: string;
  reason?: string;
}

export interface LeaveRequest {
  id: string;
  userId: string;
  startDate: string;
  endDate: string;
  type: 'vakantie' | 'ziekte' | 'persoonlijk' | 'overig';
  status: 'pending' | 'approved' | 'rejected';
  comment?: string;
  createdAt: string;
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
  category: 'algemeen' | 'veiligheid' | 'technisch';
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

export interface ActivityLogEntry {
  id: string;
  createdAt: string;
  actorName: string;
  actorRole: Role;
  category: 'users' | 'planning' | 'planning_codes' | 'services' | 'diversions' | 'updates' | 'auth';
  action: string;
  details: string;
}

export type View = 'dashboard' | 'omleidingen' | 'rooster' | 'updates' | 'beheer-roosters' | 'beheer-updates' | 'gebruikers' | 'beheer-omleidingen' | 'contacten' | 'dienstoverzicht' | 'beheer-dienstoverzicht' | 'beheer-contactlijst' | 'ruil-verzoeken' | 'verlof-beheer' | 'verlof' | 'planning-matrix' | 'planning-codes' | 'activiteit';
