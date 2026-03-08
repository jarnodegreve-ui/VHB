export type Role = 'chauffeur' | 'planner' | 'admin';

export interface User {
  id: string;
  name: string;
  role: Role;
  employeeId: string;
  password?: string;
  lastLogin?: string;
  activeSessions?: number;
  isActive?: boolean;
  phone?: string;
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
}

export interface Service {
  id: string;
  serviceNumber: string;
  startTime: string;
  endTime: string;
}

export type View = 'dashboard' | 'omleidingen' | 'rooster' | 'updates' | 'beheer-roosters' | 'beheer-updates' | 'gebruikers' | 'beheer-omleidingen' | 'contacten' | 'dienstoverzicht' | 'beheer-dienstoverzicht' | 'beheer-contactlijst';
