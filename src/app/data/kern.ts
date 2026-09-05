import { useRef } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { User } from '../../types';
import { apiFetch } from '../../lib/api';
import { veldfoutenUitAntwoord } from '../../lib/valideer';
import type { Toast, ToastOpties } from '../../components/ToastStack';

/**
 * Gedeelde kern van de datalaag: wat elke domeinmodule (planning, verlof,
 * ruil, mensen, communicatie, activiteit) nodig heeft, maar dat maar één
 * keer mag bestaan — de laadvangrails, de revisie-administratie voor
 * optimistic-concurrency en de generieke per-record-saver.
 *
 * `useDataKern` bouwt hieruit één `DataCtx` die de domeinhooks meekrijgen.
 * `fetchActivityLog` zit in de basis (de activiteit-module heeft zelf geen
 * kern nodig en wordt daarom als eerste opgebouwd), zodat de savers na een
 * geslaagde opslag het logboek van een admin kunnen verversen — zonder
 * circulaire imports tussen de domeinen.
 */

export type ShowToast = (message: string, tone?: Toast['tone'], action?: Toast['action'], opties?: ToastOpties) => void;

export type DataBasis = {
  session: Session | null;
  currentUser: User | null;
  showToast: ShowToast;
  meldLaadfout: (bron: string) => void;
  beginLoading: () => void;
  endLoading: () => void;
  fetchActivityLog: (accessToken?: string) => Promise<void>;
};

/** Collecties met per-record-revisies (`_rev` uit de GET-respons). */
export type RecordKey = 'users' | 'diversions' | 'updates';

/** Ontvanger van server-veldfouten (400 'Ongeldige invoer' → { veld: tekst }). */
export type OpVeldfouten = (fouten: Record<string, string>) => void;

/** Onderwerp van `perRecord`: één PUT / POST …/one / DELETE. */
export type PerRecordOpts<T extends { id: string }> = {
  key: RecordKey;
  /** Onderwerp voor de toasts, bv. 'Deze gebruiker'. */
  label: string;
  method: 'PUT' | 'POST' | 'DELETE';
  url: string;
  id: string;
  body?: unknown;
  /** Extra request-headers (bv. `X-Herstel: 1` bij ongedaan maken). */
  headers?: Record<string, string>;
  /** Sleutel van het record in de respons-JSON ('user' | 'diversion' | 'update'). */
  responseKey: string;
  setList: React.Dispatch<React.SetStateAction<T[]>>;
  optimistic: (prev: T[]) => T[];
  /** Canoniek record uit de respons in de lijst zetten (PUT/POST). */
  applySaved?: (prev: T[], saved: T) => T[];
  refetch: () => Promise<void> | void;
  successToast?: string;
  /** Veldfouten van een 400 terug naar het formulier (Field error-prop)
   *  i.p.v. een toast; zonder callback blijft de toast het gedrag. */
  opVeldfouten?: OpVeldfouten;
};

export type DataCtx = DataBasis & {
  /** Collectie markeren als aantoonbaar geladen (GET geslaagd). */
  markCollectionLoaded: (key: string) => void;
  /** false (+ fout-toast) zolang de collectie nooit geladen is — opslaan
   *  vanuit een lege staat zou de server alles laten verwijderen. */
  guardCollectionLoaded: (key: string, label: string) => boolean;
  /** Collectie-revisie uit de responsheader bewaren. */
  captureRevision: (key: string, response: Response) => void;
  /** Header met de laatst geladen collectie-revisie (leeg als onbekend). */
  revisionHeader: (key: string) => Record<string, string>;
  /** `_rev` per record uit een GET-lijst halen en bewaren; geeft de schone lijst. */
  stripRecordRevisions: <T extends { id: string }>(key: RecordKey, rows: Array<T & { _rev?: string }>) => T[];
  /** Generieke per-record-saver (optimistisch, met 409/404-afhandeling). */
  perRecord: <T extends { id: string }>(opts: PerRecordOpts<T>) => Promise<boolean>;
  /** Delta-beslissing (PATCH) op één verlof- of ruilrecord met seenStatus-guard. */
  decideViaPatch: (
    kind: 'leave' | 'swaps',
    id: string,
    status: string,
    ifStatus: string | undefined,
    refetch: () => Promise<void> | void,
    applyLocal: (updated: any) => void,
  ) => Promise<boolean>;
  /** Alle laadvangrails wissen (uitloggen). */
  clearLoadedCollections: () => void;
};

export const replaceById = <T extends { id: string }>(prev: T[], record: T): T[] =>
  prev.map((r) => (r.id === record.id ? record : r));
export const withoutId = <T extends { id: string }>(prev: T[], id: string): T[] => prev.filter((r) => r.id !== id);

export function useDataKern(basis: DataBasis): DataCtx {
  const { showToast, currentUser, fetchActivityLog } = basis;

  // Vangrail tegen dataverlies: het write-model POST telkens de volledige
  // collectie — opslaan vanuit een nooit-geladen staat zou de server alle
  // "ontbrekende" records laten verwijderen. Een collectie is pas
  // beschrijfbaar nadat haar GET aantoonbaar geslaagd is.
  const loadedCollectionsRef = useRef<Set<string>>(new Set());
  const markCollectionLoaded = (key: string) => {
    loadedCollectionsRef.current.add(key);
  };
  const guardCollectionLoaded = (key: string, label: string): boolean => {
    if (loadedCollectionsRef.current.has(key)) return true;
    showToast(`${label} is nog niet geladen — opslaan is geblokkeerd om dataverlies te voorkomen. Vernieuw de pagina en probeer het opnieuw.`, 'error');
    return false;
  };
  const clearLoadedCollections = () => {
    loadedCollectionsRef.current.clear();
  };

  // Optimistic-concurrency: per collectie de laatst geladen revisie bewaren
  // (ondoorzichtige token uit de X-Collection-Revision-header). Bij opslaan
  // sturen we 'm mee; matcht hij niet meer met de serverstaat, dan heeft een
  // collega ondertussen opgeslagen → 409, wij verversen i.p.v. te overschrijven.
  const REVISION_HEADER = 'x-collection-revision';
  const collectionRevisionsRef = useRef<Record<string, string>>({});
  const captureRevision = (key: string, response: Response) => {
    const rev = response.headers.get(REVISION_HEADER);
    if (rev) collectionRevisionsRef.current[key] = rev;
  };
  const revisionHeader = (key: string): Record<string, string> => {
    const rev = collectionRevisionsRef.current[key];
    return rev ? { [REVISION_HEADER]: rev } : {};
  };

  // Per-record-revisies (gebruikers, omleidingen, updates): de server hangt
  // aan elk record een `_rev` (hash van het record zoals hij het serveert;
  // records hebben geen updatedAt). We halen hem uit de GET-respons, bewaren
  // hem hier per id en sturen hem bij PUT/DELETE /api/<collectie>/:id terug
  // in X-Record-Revision. De views zien `_rev` nooit — de state blijft het
  // gewone User/Diversion/Update-type.
  const RECORD_REVISION_HEADER = 'x-record-revision';
  const recordRevisionsRef = useRef<Record<RecordKey, Record<string, string>>>({ users: {}, diversions: {}, updates: {} });
  const stripRecordRevisions = <T extends { id: string }>(key: RecordKey, rows: Array<T & { _rev?: string }>): T[] => {
    const map: Record<string, string> = {};
    const clean = rows.map(({ _rev, ...rest }) => {
      if (typeof _rev === 'string') map[String(rest.id)] = _rev;
      return rest as T;
    });
    recordRevisionsRef.current[key] = map;
    return clean;
  };
  const captureRecordRevision = <T extends { id: string }>(key: RecordKey, record: (T & { _rev?: string }) | null | undefined): T | null => {
    if (!record) return null;
    const { _rev, ...rest } = record;
    if (typeof _rev === 'string') recordRevisionsRef.current[key][String(rest.id)] = _rev;
    return rest as T;
  };
  const forgetRecordRevision = (key: RecordKey, id: string) => {
    delete recordRevisionsRef.current[key][id];
  };

  // --- Per-record opslaan (gebruikers, omleidingen, updates) ---
  // Eerste stap weg van "POST de hele collectie": bewerken/toevoegen/
  // verwijderen gaat per record (PUT / POST …/one / DELETE). Optimistisch:
  // de lokale lijst wordt meteen aangepast; slaagt de call, dan vervangt
  // het canonieke serverrecord (mét verse `_rev`) de optimistische versie;
  // bij een 409 (iemand anders wijzigde het record) of een fout verversen
  // we de collectie — dat draait de optimistische stap vanzelf terug.
  // De collectie-savers (saveUsers e.d.) blijven bestaan voor import/bulk.
  const perRecord = async <T extends { id: string }>(opts: PerRecordOpts<T>): Promise<boolean> => {
    if (!guardCollectionLoaded(opts.key, opts.label + ' is')) return false;
    const needsRevision = opts.method !== 'POST';
    const rev = recordRevisionsRef.current[opts.key][opts.id];
    if (needsRevision && !rev) {
      // Geen revisie bekend (lijst nooit vers geladen sinds een bulk-save):
      // eerst verversen, dan opnieuw proberen — nooit blind overschrijven.
      showToast(`${opts.label} is nog niet vers geladen — ik ververs de lijst, probeer het daarna opnieuw.`, 'info');
      await opts.refetch();
      return false;
    }
    opts.setList(opts.optimistic);
    try {
      const response = await apiFetch(opts.url, {
        method: opts.method,
        headers: { ...(opts.headers ?? {}), ...(needsRevision && rev ? { [RECORD_REVISION_HEADER]: rev } : {}) },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      });
      const data = await response.json().catch(() => ({} as any));
      if (response.ok) {
        captureRevision(opts.key, response);
        if (opts.method === 'DELETE') {
          forgetRecordRevision(opts.key, opts.id);
        } else {
          const saved = captureRecordRevision<T>(opts.key, data?.[opts.responseKey]);
          if (saved && opts.applySaved) opts.setList((prev) => opts.applySaved!(prev, saved));
        }
        if (currentUser?.role === 'admin') void fetchActivityLog();
        if (opts.successToast) showToast(opts.successToast, 'success');
        return true;
      }
      if (response.status === 409 || response.status === 404) {
        showToast(
          response.status === 404
            ? `${opts.label} is intussen door iemand anders verwijderd — ik ververs de lijst.`
            : data?.conflict === 'record' || data?.conflict === 'revision'
              ? `${opts.label} is intussen door iemand anders gewijzigd — ik ververs de lijst, probeer je wijziging opnieuw.`
              : (data?.details || data?.error || `${opts.label} kon niet opgeslagen worden.`),
          'info',
        );
        await opts.refetch();
        return false;
      }
      // Validatiefout (400 met veldfouten): bij het veld tonen, niet als
      // toast. De refetch draait de optimistische lijstwijziging terug.
      const veldfouten = veldfoutenUitAntwoord(data);
      if (veldfouten && opts.opVeldfouten) {
        opts.opVeldfouten(veldfouten);
        await opts.refetch();
        return false;
      }
      showToast(data?.details || data?.error || `${opts.label} kon niet opgeslagen worden (${response.status}).`, 'error');
      await opts.refetch();
      return false;
    } catch (error) {
      console.error(`Error saving ${opts.key} record:`, error);
      showToast(`${opts.label} kon niet opgeslagen worden: ${error instanceof Error ? error.message : 'onbekende fout'}.`, 'error');
      await opts.refetch();
      return false;
    }
  };

  /** Delta-beslissing op één record (PATCH) met optimistic-concurrency:
   *  bij een 409/404 is een collega ons voor geweest — verse lijst ophalen
   *  i.p.v. stilletjes overschrijven. Geldt voor verlof én dienstruil. */
  const decideViaPatch = async (
    kind: 'leave' | 'swaps',
    id: string,
    status: string,
    ifStatus: string | undefined,
    refetch: () => Promise<void> | void,
    applyLocal: (updated: any) => void,
  ): Promise<boolean> => {
    try {
      const response = await apiFetch(`/api/${kind}/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ status, ifStatus }),
      });
      const data = await response.json().catch(() => ({} as any));
      if (response.ok) {
        captureRevision(kind, response);
        applyLocal(data?.leave ?? data?.swap ?? { status });
        if (currentUser?.role === 'admin') void fetchActivityLog();
        return true;
      }
      if (response.status === 409 || response.status === 404) {
        showToast(data.error || 'Dit is intussen al behandeld door een collega — de lijst is ververst.', 'info');
        void refetch();
        return false;
      }
      showToast(data.details || data.error || 'Beslissing opslaan is mislukt.', 'error');
      return false;
    } catch (error) {
      console.error(`Error deciding ${kind}:`, error);
      showToast('Beslissing opslaan is mislukt.', 'error');
      return false;
    }
  };

  return {
    ...basis,
    markCollectionLoaded,
    guardCollectionLoaded,
    captureRevision,
    revisionHeader,
    stripRecordRevisions,
    perRecord,
    decideViaPatch,
    clearLoadedCollections,
  };
}
