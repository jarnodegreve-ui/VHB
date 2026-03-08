import { Diversion, Service, Shift, Update, User } from './types';

export const MOCK_USERS: User[] = [
  { id: '1', name: 'Jan de Vries', role: 'chauffeur', employeeId: 'CH-4492', lastLogin: '2024-03-05T08:30:00Z', activeSessions: 1, phone: '0470 12 34 56' },
  { id: '2', name: 'Sarah de Groot', role: 'planner', employeeId: 'PL-1102', lastLogin: '2024-03-05T09:15:00Z', activeSessions: 0, phone: '0480 98 76 54' },
  { id: '3', name: 'Mark Admin', role: 'admin', employeeId: 'AD-0001', lastLogin: '2024-03-05T10:00:00Z', activeSessions: 1, phone: '0490 55 44 33' },
];

export const MOCK_DIVERSIONS: Diversion[] = [
  {
    id: '1',
    line: 'Lijn 12',
    title: 'Wegwerkzaamheden Stationsplein',
    description: 'Vanwege herbestrating is de halte Stationsplein tijdelijk verplaatst naar de overkant van de straat.',
    startDate: '2024-03-01',
    severity: 'medium',
    pdfUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
  },
  {
    id: '2',
    line: 'Lijn 5 & 8',
    title: 'Evenement in het Centrum',
    description: 'Door de jaarlijkse marathon zijn diverse straten in het centrum afgesloten. Volg de omleidingsborden.',
    startDate: '2024-03-10',
    endDate: '2024-03-11',
    severity: 'high',
    pdfUrl: 'https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf',
  },
  {
    id: '3',
    line: 'Lijn 2',
    title: 'Snoeien van bomen',
    description: 'Kleine vertraging mogelijk door snoeiwerkzaamheden langs de route.',
    startDate: '2024-03-05',
    severity: 'low',
  },
];

export const MOCK_SHIFTS: Shift[] = [
  {
    id: '101',
    date: '2024-03-05',
    startTime: '06:00',
    endTime: '14:30',
    line: '12',
    busNumber: '8421',
    loopnr: 'L-101',
    driverId: '1',
  },
  {
    id: '102',
    date: '2024-03-06',
    startTime: '14:00',
    endTime: '22:30',
    line: '5',
    busNumber: '7712',
    loopnr: 'L-205',
    driverId: '1',
  },
  {
    id: '103',
    date: '2024-03-07',
    startTime: '08:00',
    endTime: '16:30',
    line: '8',
    busNumber: '8421',
    loopnr: 'L-101',
    driverId: '1',
  },
];

export const MOCK_UPDATES: Update[] = [
  {
    id: 'u1',
    date: '2024-03-04',
    title: 'Nieuwe Uniformen Beschikbaar',
    content: 'Vanaf volgende week kunnen de nieuwe zomeruniformen worden opgehaald bij het magazijn.',
    category: 'algemeen',
  },
  {
    id: 'u2',
    date: '2024-03-02',
    title: 'Veiligheidsprotocol Update',
    content: 'Let extra op bij de nieuwe rotonde op de N302. Er zijn meldingen van onduidelijke voorrangssituaties.',
    category: 'veiligheid',
  },
  {
    id: 'u3',
    date: '2024-02-28',
    title: 'Onderhoud aan Boordcomputers',
    content: 'Alle bussen van de 8000-serie krijgen dit weekend een software-update voor de GPS.',
    category: 'technisch',
  },
];

export const MOCK_SERVICES: Service[] = [
  { id: '1', serviceNumber: 'D-101', startTime: '05:30', endTime: '13:45' },
  { id: '2', serviceNumber: 'D-102', startTime: '06:15', endTime: '14:30' },
  { id: '3', serviceNumber: 'D-201', startTime: '13:30', endTime: '21:45' },
  { id: '4', serviceNumber: 'D-202', startTime: '14:15', endTime: '22:30' },
  { id: '5', serviceNumber: 'D-301', startTime: '21:30', endTime: '05:45' },
  { id: '6', serviceNumber: 'D-103', startTime: '07:00', endTime: '15:15' },
  { id: '7', serviceNumber: 'D-104', startTime: '08:30', endTime: '16:45' },
];
