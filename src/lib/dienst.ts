import type { Bevinding, Segment } from '../../shared/dienst';
import type { RitbladRij } from '../../shared/dienst/ritblad';
import type { LoonParameters } from '../../shared/dienst/loonparameters';
import type { LoonComponent } from '../../shared/dienst/looncomponenten';
import type { ImportETWaarschuwing } from '../../shared/dienst/importET';
import { apiFetch } from './api';

/** Datalaag van de dienstopbouw (fase C). Alleen type-imports uit shared. */
export type { Bevinding, Segment, RitbladRij, LoonParameters, LoonComponent, ImportETWaarschuwing };

export type SegmentImport = {
  id: string; createdAt: string; importedBy: string | null; filename: string | null; rijen: number; diensten: number; dagtypes: string[];
  waarschuwingen: ImportETWaarschuwing[]; bevindingen: Bevinding[]; actief: boolean; actiefSinds: string | null;
};
export type DagtypeCode = { code: string; omschrijving: string; periode: string | null; aantalPerJaar: number | null; portaalDagtype: string | null };

async function vraag<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(url, init);
  if (!res.ok) {
    let d: { error?: string; details?: string } | null = null;
    try { d = await res.json(); } catch { /* geen json */ }
    throw new Error(d?.details || d?.error || `Er ging iets mis (code ${res.status}).`);
  }
  return (await res.json()) as T;
}
const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const laadImports = () => vraag<SegmentImport[]>('/api/dienstopbouw/imports');
export const importeerBestand = (bestandBase64: string, filename: string) => vraag<SegmentImport>('/api/dienstopbouw/imports', json('POST', { bestandBase64, filename }));
export const activeerImport = (id: string, forceer = false) => vraag<SegmentImport>(`/api/dienstopbouw/imports/${encodeURIComponent(id)}/activeren${forceer ? '?forceer=1' : ''}`, { method: 'POST' });
export const verwijderImport = (id: string) => vraag<{ success: true }>(`/api/dienstopbouw/imports/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const laadSegmenten = (q: { importId?: string; serviceNumber?: string; dagtype?: string } = {}) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) p.set(k, v);
  const qs = p.toString();
  return vraag<{ import: SegmentImport | null; segmenten: Array<Segment & { id: string }> }>(`/api/dienstopbouw/segmenten${qs ? `?${qs}` : ''}`);
};
export const laadRitblad = (serviceNumber: string) => vraag<{ serviceNumber: string; dagtypes: Array<{ dagtypeCode: string; rijen: RitbladRij[] }> }>(`/api/dienstopbouw/ritblad?serviceNumber=${encodeURIComponent(serviceNumber)}`);
export const laadLoonparameters = (importId: string) => vraag<{ importId: string; diensten: Array<{ serviceNumber: string; dagtypeCode: string; parameters: LoonParameters; huidig: Record<string, unknown> | null }> }>(`/api/dienstopbouw/imports/${encodeURIComponent(importId)}/loonparameters`);
export const leidLooncodesAf = (importId: string) => vraag<{ bijgewerkt: number; nieuw: number; overgeslagen: string[]; teVeelDelen: string[] }>(`/api/dienstopbouw/imports/${encodeURIComponent(importId)}/afleiden-looncodes`, { method: 'POST' });
export const laadDagtypes = () => vraag<DagtypeCode[]>('/api/dienstopbouw/dagtypes');
export const bewaarDagtype = (code: string, portaalDagtype: string | null) => vraag<DagtypeCode>(`/api/dienstopbouw/dagtypes/${encodeURIComponent(code)}`, json('PUT', { portaalDagtype }));

/** Bestand → base64 in stukken (zelfde truc als de planning-import). */
export const bestandNaarBase64 = async (file: File): Promise<string> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  return btoa(binary);
};

export const minNaarHHMM = (min: number): string => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
