import type { Dienstregeling, Service } from '../types';
import { apiFetch, foutUitAntwoord } from './api';
import { veldfoutenUitAntwoord } from './valideer';

/**
 * Dienstregelingversies (fase 1, 08-10): de API-calls van het versiescherm.
 * Het dienstoverzicht van de versie die vandaag geldt blijft de gewone
 * collectie `services` (src/app/data/planning.ts); alleen een andere versie
 * wordt hier apart geladen, mét haar revisie voor de conflictcontrole.
 */
export type VersieDiensten = { services: Service[]; revisie: string | null };

export class VeldfoutenError extends Error {
  constructor(public readonly veldfouten: Record<string, string>, message: string) {
    super(message);
    this.name = 'VeldfoutenError';
  }
}

const antwoordOfFout = async <T,>(response: Response): Promise<T> => {
  if (response.ok) return (await response.json()) as T;
  const data = await response.clone().json().catch(() => null);
  const veldfouten = veldfoutenUitAntwoord(data);
  if (veldfouten) throw new VeldfoutenError(veldfouten, String(data?.details || data?.error || 'Ongeldige invoer'));
  throw await foutUitAntwoord(response);
};

export async function haalDienstregelingen(): Promise<{ vandaag: string; versies: Dienstregeling[] }> {
  return antwoordOfFout(await apiFetch('/api/dienstregelingen', { cache: 'no-store' }));
}

export async function haalVersieDiensten(versieId: string): Promise<VersieDiensten> {
  const response = await apiFetch(`/api/services?versie=${encodeURIComponent(versieId)}`, { cache: 'no-store' });
  const services = await antwoordOfFout<Service[]>(response);
  return { services, revisie: response.headers.get('x-collection-revision') };
}

export type NieuweVersie = { geldigVanaf: string; naam?: string; opmerking?: string; kopieVan?: string; melden?: boolean };

export async function maakDienstregeling(body: NieuweVersie): Promise<Dienstregeling> {
  return antwoordOfFout(await apiFetch('/api/dienstregelingen', { method: 'POST', body: JSON.stringify(body) }));
}

export type VersiePatch = { geldigVanaf?: string; naam?: string; opmerking?: string };

export async function wijzigDienstregeling(id: string, body: VersiePatch): Promise<Dienstregeling & { planning?: { status: string; melding?: string } }> {
  return antwoordOfFout(await apiFetch(`/api/dienstregelingen/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) }));
}

export async function verwijderDienstregeling(id: string): Promise<{ success: true; planning?: { status: string; melding?: string } }> {
  return antwoordOfFout(await apiFetch(`/api/dienstregelingen/${encodeURIComponent(id)}`, { method: 'DELETE' }));
}
