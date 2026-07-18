import { apiFetch } from './api';

/**
 * Markeert de gegeven updates als gelezen door de ingelogde gebruiker.
 * Fire-and-forget vanuit de chauffeur-weergave; faalt stil (een gemiste
 * leesbevestiging is geen reden om de chauffeur een foutmelding te tonen).
 */
export function markUpdatesRead(updateIds: string[]): Promise<void> {
  if (updateIds.length === 0) return Promise.resolve();
  return apiFetch<void>('/api/updates/read', {
    method: 'POST',
    body: JSON.stringify({ updateIds }),
  });
}

export type UpdateReadCounts = {
  /** aantal chauffeurs dat de update gelezen heeft, per update-id */
  counts: Record<string, number>;
  /** totaal aantal actieve chauffeurs — de noemer van 'X/Y gelezen' */
  totalChauffeurs: number;
};

/** Haalt per update op hoeveel chauffeurs hem gelezen hebben (planner/admin). */
export function fetchUpdateReadCounts(): Promise<UpdateReadCounts> {
  return apiFetch<UpdateReadCounts>('/api/updates/read-counts');
}
