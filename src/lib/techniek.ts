import type { Defect, DefectPatch, DefectMeldingBody, Vehicle, VehicleBody, VehicleExpiry, VehicleExpiryBody, VehicleKort, Werkprestatie, WerkprestatieBody } from '../../shared/schemas/techniek';
import { apiFetch } from './api';
import { veldfoutenUitAntwoord } from './valideer';
import { metEenheid } from './format';

/**
 * Datalaag van de techniekmodule (voertuigen, gele boek, werkprestaties,
 * vervaldata). Bewust niet in useAppData: de schermen halen zelf hun data
 * (patroon VervaldataView), zodat de chauffeursschil er niets van laadt.
 * Alleen type-imports uit shared/schemas: geen zod in deze chunk.
 */

export type { Defect, DefectPatch, DefectMeldingBody, Vehicle, VehicleBody, VehicleExpiry, VehicleExpiryBody, VehicleKort, Werkprestatie, WerkprestatieBody };

/** Serverfout met eventuele veldfouten (400 uit valideerRecord, 409 bij dubbel busnummer). */
export class TechniekFout extends Error {
  veldfouten: Record<string, string> | null;
  status: number;
  constructor(message: string, status: number, veldfouten: Record<string, string> | null) {
    super(message);
    this.status = status;
    this.veldfouten = veldfouten;
  }
}

async function vraag<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(url, init);
  if (!res.ok) {
    let data: unknown = null;
    try { data = await res.json(); } catch { /* geen json */ }
    const d = data as { error?: string; details?: string } | null;
    throw new TechniekFout(d?.details || d?.error || `Er ging iets mis (code ${res.status}).`, res.status, veldfoutenUitAntwoord(data));
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

// --- Voertuigen ---
export const laadVoertuigen = (alleenActief = false) => vraag<Vehicle[]>(`/api/vehicles${alleenActief ? '?actief=1' : ''}`);
export const laadVoertuigenKort = () => vraag<VehicleKort[]>('/api/vehicles?actief=1');
export const maakVoertuig = (body: VehicleBody) => vraag<Vehicle>('/api/vehicles', json('POST', body));
export const bewaarVoertuig = (id: string, body: VehicleBody) => vraag<Vehicle>(`/api/vehicles/${encodeURIComponent(id)}`, json('PUT', body));
export const verwijderVoertuig = (id: string) => vraag<{ success: true }>(`/api/vehicles/${encodeURIComponent(id)}`, { method: 'DELETE' });

// --- Vervaldata ---
export const laadVoertuigVervaldata = () => vraag<VehicleExpiry[]>('/api/vehicle-expiries');
export const zetVoertuigVervaldatum = (vehicleId: string, body: VehicleExpiryBody) =>
  vraag<{ success: true }>(`/api/vehicles/${encodeURIComponent(vehicleId)}/vervaldata`, json('PUT', body));

// --- Gele boek ---
export type DefectQuery = { status?: 'open' | 'alles' | 'uitgevoerd' | 'geannuleerd'; vehicleId?: string; sinds?: string; mijn?: boolean; limit?: number };
export const laadDefecten = (q: DefectQuery = {}) => {
  const p = new URLSearchParams();
  if (q.status) p.set('status', q.status);
  if (q.vehicleId) p.set('vehicleId', q.vehicleId);
  if (q.sinds) p.set('sinds', q.sinds);
  if (q.mijn) p.set('mijn', '1');
  if (q.limit) p.set('limit', String(q.limit));
  const qs = p.toString();
  return vraag<Defect[]>(`/api/defecten${qs ? `?${qs}` : ''}`);
};
export const laadOpenDefectenAantal = () => vraag<{ open: number }>('/api/defecten/aantal-open');
export const meldDefect = (body: DefectMeldingBody) => vraag<Defect>('/api/defecten', json('POST', body));
export const wijzigDefect = (id: string, patch: DefectPatch) => vraag<Defect>(`/api/defecten/${encodeURIComponent(id)}`, json('PATCH', patch));

// --- Werkprestaties ---
export type WerkQuery = { van?: string; tot?: string; vehicleId?: string; mecanicienId?: string; limit?: number };
export const laadWerkprestaties = (q: WerkQuery = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v));
  const qs = p.toString();
  return vraag<Werkprestatie[]>(`/api/werkprestaties${qs ? `?${qs}` : ''}`);
};
/**
 * Alle werken aan één bus, ongeacht wie ze deed (scherm Uitgevoerde werken
 * per bus). Eigen route, want /api/werkprestaties beperkt een technieker tot
 * zijn eigen rijen.
 */
export const laadVoertuigWerken = (vehicleId: string, q: { van?: string; tot?: string; limit?: number } = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v));
  const qs = p.toString();
  return vraag<Werkprestatie[]>(`/api/vehicles/${encodeURIComponent(vehicleId)}/werken${qs ? `?${qs}` : ''}`);
};
export const maakWerkprestatie = (body: WerkprestatieBody) => vraag<Werkprestatie>('/api/werkprestaties', json('POST', body));
export const bewaarWerkprestatie = (id: string, body: WerkprestatieBody) => vraag<Werkprestatie>(`/api/werkprestaties/${encodeURIComponent(id)}`, json('PUT', body));
export const verwijderWerkprestatie = (id: string) => vraag<{ success: true }>(`/api/werkprestaties/${encodeURIComponent(id)}`, { method: 'DELETE' });

export type WerkRapport = {
  jaar: number;
  totaalUren: number;
  aantal: number;
  perBus: Array<{ label: string; uren: number; aantal: number; perKwartaal: number[] }>;
  perMecanicien: Array<{ label: string; uren: number; aantal: number; perKwartaal: number[] }>;
  perWerkcode: Array<{ werkcode: string; uren: number; aantal: number }>;
};
export const laadWerkRapport = (jaar: number) => vraag<WerkRapport>(`/api/werkprestaties/rapport?jaar=${jaar}`);

/** Vandaag als ISO-dag in lokale tijd (zoals de rest van de app rekent). */
export const vandaagIso = (): string => {
  const nu = new Date();
  return `${nu.getFullYear()}-${String(nu.getMonth() + 1).padStart(2, '0')}-${String(nu.getDate()).padStart(2, '0')}`;
};

/** Dagen van vandaag tot `iso` (negatief = verlopen). */
export const dagenTot = (iso: string, vandaag = vandaagIso()): number =>
  Math.round((Date.parse(iso) - Date.parse(vandaag)) / 86400000);

/** Uren tussen twee kloktijden 'uu:mm' (over middernacht = +24 u), afgerond op een kwartier. */
export const urenTussen = (begin: string, einde: string): number | null => {
  const m = (t: string) => {
    const r = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t.trim());
    return r ? Number(r[1]) * 60 + Number(r[2]) : null;
  };
  const b = m(begin); const e = m(einde);
  if (b === null || e === null) return null;
  let d = e - b;
  if (d < 0) d += 24 * 60;
  return Math.round((d / 60) * 4) / 4;
};

/** Getal → tekst met komma en hooguit 2 decimalen ("1,5"). */
export const urenTekst = (n: number): string => n.toLocaleString('nl-BE', { maximumFractionDigits: 2 });

/** Uren met eenheid ("1,5 u", smalle vaste spatie via metEenheid). */
export const urenMetEenheid = (n: number): string => metEenheid(urenTekst(n), 'u');
