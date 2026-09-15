import type { DagPrestatie, DagPrestatieBody, LoonCode, LoonCodeBody, LoonInstellingen } from '../../shared/schemas/loon';
import { apiFetch } from './api';
import { veldfoutenUitAntwoord } from './valideer';

/**
 * Datalaag van de loonmodule (dagafsluiting, looncodes, matricules,
 * Easypay-export). Self-fetching zoals de techniekmodule; alleen type-
 * imports uit shared/schemas, dus geen zod in deze chunk.
 */
export type { DagPrestatie, DagPrestatieBody, LoonCode, LoonCodeBody, LoonInstellingen };

export class LoonFout extends Error {
  status: number;
  veldfouten: Record<string, string> | null;
  data: unknown;
  constructor(message: string, status: number, veldfouten: Record<string, string> | null, data: unknown) {
    super(message);
    this.status = status;
    this.veldfouten = veldfouten;
    this.data = data;
  }
}

async function vraag<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(url, init);
  if (!res.ok) {
    let data: unknown = null;
    try { data = await res.json(); } catch { /* geen json */ }
    const d = data as { error?: string; details?: string } | null;
    throw new LoonFout(d?.details || d?.error || `Er ging iets mis (code ${res.status}).`, res.status, veldfoutenUitAntwoord(data), data);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export type DagAfsluiting = {
  datum: string; status: 'open' | 'afgesloten'; geopendOp: string; geopendDoor: string | null;
  afgeslotenOp: string | null; afgeslotenDoor: string | null; heropendOp: string | null; heropendDoor: string | null; heropendReden: string | null;
};
export type DagTelling = DagAfsluiting & { rijen: number; overmin: number; premies: number; zonderCode: number };
export type PlanningAfwijking = { userId: string; naam: string; planningCode: string | null; huidigeCode: string | null; rijId: string | null; bewerkt: boolean };
export type DagDetail = { dag: DagAfsluiting; rijen: DagPrestatie[]; planningAfwijkingen: PlanningAfwijking[]; ontbrekendeCodes: string[]; inPlanning: boolean };
export type DagVoorstel = { error: string; inPlanning: boolean; voorstel: Array<{ userId: string; naam: string; planningCode: string | null }> };

export const laadMaand = (maand: string) => vraag<{ maand: string; dagen: DagTelling[]; planningDagen: string[] }>(`/api/dagafsluiting?maand=${maand}`);
/** Detail van een dag; geeft `{ voorstel }` (404) als hij nog niet geopend is. */
export const laadDag = async (datum: string): Promise<{ detail: DagDetail } | { voorstel: DagVoorstel }> => {
  try {
    return { detail: await vraag<DagDetail>(`/api/dagafsluiting/${datum}`) };
  } catch (err) {
    if (err instanceof LoonFout && err.status === 404 && err.data && typeof err.data === 'object' && 'voorstel' in (err.data as object)) return { voorstel: err.data as DagVoorstel };
    throw err;
  }
};
export const openDag = (datum: string) => vraag<DagDetail>(`/api/dagafsluiting/${datum}/openen`, { method: 'POST' });
export const bewaarRij = (datum: string, id: string, body: DagPrestatieBody) => vraag<DagPrestatie>(`/api/dagafsluiting/${datum}/rijen/${encodeURIComponent(id)}`, json('PUT', body));
export const voegRijToe = (datum: string, userId: string, geredenCode: string | null) => vraag<DagPrestatie>(`/api/dagafsluiting/${datum}/rijen`, json('POST', { userId, geredenCode }));
export const verwijderRij = (datum: string, id: string) => vraag<{ success: true }>(`/api/dagafsluiting/${datum}/rijen/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const neemPlanningOver = (datum: string, rijId?: string) => vraag<{ aangepast: number; toegevoegd: number }>(`/api/dagafsluiting/${datum}/planning-overnemen`, json('POST', rijId ? { rijId } : {}));
export const sluitDag = (datum: string) => vraag<DagAfsluiting>(`/api/dagafsluiting/${datum}/afsluiten`, { method: 'POST' });
export const heropenDag = (datum: string, reden: string) => vraag<DagAfsluiting>(`/api/dagafsluiting/${datum}/heropenen`, json('POST', { reden }));

export const laadLoonCodes = () => vraag<LoonCode[]>('/api/loon/codes');
export const bewaarLoonCode = (code: string, body: LoonCodeBody) => vraag<LoonCode>(`/api/loon/codes/${encodeURIComponent(code)}`, json('PUT', body));
export const verwijderLoonCode = (code: string) => vraag<{ success: true }>(`/api/loon/codes/${encodeURIComponent(code)}`, { method: 'DELETE' });
export const laadOntbrekendeCodes = (maand: string) => vraag<Array<{ code: string; aantal: number }>>(`/api/loon/codes/ontbrekend?maand=${maand}`);

export type LoonMedewerkerRij = { userId: string; naam: string; employeeId: string | null; easypayNr: number | null; inExport: boolean };
export const laadMedewerkers = () => vraag<LoonMedewerkerRij[]>('/api/loon/medewerkers');
export const bewaarMedewerker = (userId: string, body: { easypayNr: number | null; inExport: boolean }) => vraag<{ userId: string; easypayNr: number | null; inExport: boolean }>(`/api/loon/medewerkers/${encodeURIComponent(userId)}`, json('PUT', body));
export const importeerMedewerkers = (tekst: string) => vraag<{ gekoppeld: number; onbekend: string[] }>('/api/loon/medewerkers/import', json('POST', { tekst }));

export const laadInstellingen = () => vraag<LoonInstellingen>('/api/loon/instellingen');
export const bewaarInstellingen = (body: LoonInstellingen) => vraag<LoonInstellingen>('/api/loon/instellingen', json('PUT', body));

export type ExportIssue = ({ soort: 'geen_matricule' } | { soort: 'onbekende_code'; datum: string; code: string } | { soort: 'geen_code'; datum: string }) & { userId: string; naam: string };
export type ExportControle = {
  maand: string; dagenGeopend: number; dagenAfgesloten: number; openDagen: string[]; nietGeopendeDagen?: string[]; lidnr: number; issues: ExportIssue[];
  samenvatting: { rijen: number; personen: number; overminRijen: number; premies: number }; blokkerend: boolean;
};
export const laadExportControle = (maand: string) => vraag<ExportControle>(`/api/loon/export/controle?maand=${maand}`);

/** Vandaag als ISO-dag in lokale tijd. */
export const vandaagIso = (): string => {
  const nu = new Date();
  return `${nu.getFullYear()}-${String(nu.getMonth() + 1).padStart(2, '0')}-${String(nu.getDate()).padStart(2, '0')}`;
};
export const schuifDag = (iso: string, n: number): string => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const schuifMaand = (maand: string, n: number): string => {
  const [j, m] = maand.split('-').map(Number);
  const d = new Date(j, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
export const dagenInMaand = (maand: string): string[] => {
  const [j, m] = maand.split('-').map(Number);
  const n = new Date(j, m, 0).getDate();
  return Array.from({ length: n }, (_, i) => `${maand}-${String(i + 1).padStart(2, '0')}`);
};
