import { useState } from 'react';
import type { Diversion, Update, User } from '../../types';
import { apiFetch } from '../../lib/api';
import { replaceById, withoutId, type DataCtx, type OpVeldfouten } from './kern';
import { metOngedaan } from '../../lib/ongedaan';

/**
 * Communicatie: updates (nieuws) en omleidingen — collectie- én
 * per-record-savers — plus de dringende e-mail bij een urgente update.
 * `users` komt uit de mensen-module (de ontvangerslijst van de mail).
 */
export function useCommunicatieData(ctx: DataCtx & { users: User[] }) {
  const { session, currentUser, showToast, meldLaadfout, beginLoading, endLoading, fetchActivityLog, users } = ctx;
  const [updates, setUpdates] = useState<Update[]>([]);
  const [diversions, setDiversions] = useState<Diversion[]>([]);

  const fetchUpdates = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/updates', { accessToken });
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setUpdates(ctx.stripRecordRevisions<Update>('updates', data));
        ctx.markCollectionLoaded('updates');
        ctx.captureRevision('updates', response);
      }
    } catch (error) {
      console.error('Error fetching updates:', error);
      meldLaadfout('de updates');
    }
  };

  const saveUpdates = async (newUpdates: Update[]) => {
    if (!ctx.guardCollectionLoaded('updates', 'De updates zijn')) return false;
    try {
      const response = await apiFetch('/api/updates', {
        method: 'POST',
        headers: ctx.revisionHeader('updates'),
        body: JSON.stringify(newUpdates),
      });
      if (response.status === 409) {
        showToast('De updates zijn intussen door iemand anders gewijzigd — ik ververs ze, probeer je wijziging opnieuw.', 'info');
        await fetchUpdates();
        return false;
      }
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.details || data?.error || 'Opslaan mislukt.');
      }
      setUpdates(newUpdates);
      ctx.captureRevision('updates', response);
      // Verse per-record-revisies ophalen (de collectie-save kent ze niet).
      void fetchUpdates();
      if (currentUser?.role === 'admin') {
        await fetchActivityLog();
      }
      return true;
    } catch (error) {
      console.error('Error saving updates:', error);
      showToast(`Opslaan van updates is mislukt: ${error instanceof Error ? error.message : 'Onbekende fout'}`, 'error');
      return false;
    }
  };

  const sendUrgentEmail = async (update: Update) => {
    try {
      const response = await apiFetch('/api/send-urgent-update-email', {
        method: 'POST',
        body: JSON.stringify({
          update,
          recipients: users.filter(u => u.email)
        }),
      });
      const data = await response.json().catch(() => ({} as any));
      if (response.ok && data.success) {
        showToast(data.mocked ? `E-mail gelogd: ${data.message}` : 'E-mails verzonden naar alle chauffeurs.', 'success');
      } else {
        showToast(data.details || data.error || 'Verzenden van de e-mailupdate is mislukt.', 'error');
      }
    } catch (error) {
      console.error('Error sending urgent email:', error);
      showToast('Verzenden van de e-mailupdate is mislukt.', 'error');
    }
  };

  const fetchDiversions = async (accessToken = session?.access_token, opts?: { silent?: boolean }) => {
    try {
      if (!opts?.silent) beginLoading();
      const response = await apiFetch('/api/diversions', { accessToken });
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setDiversions(ctx.stripRecordRevisions<Diversion>('diversions', data));
        ctx.markCollectionLoaded('diversions');
        ctx.captureRevision('diversions', response);
      }
    } catch (error) {
      console.error('Error fetching diversions:', error);
    } finally {
      if (!opts?.silent) endLoading();
    }
  };

  const saveDiversions = async (newDiversions: Diversion[]) => {
    if (!ctx.guardCollectionLoaded('diversions', 'De omleidingen zijn')) return;
    try {
      beginLoading();
      const response = await apiFetch('/api/diversions', {
        method: 'POST',
        headers: ctx.revisionHeader('diversions'),
        body: JSON.stringify(newDiversions),
      });
      if (response.status === 409) {
        showToast('De omleidingen zijn intussen door iemand anders gewijzigd — ik ververs ze, probeer je wijziging opnieuw.', 'info');
        await fetchDiversions(undefined, { silent: true });
        return;
      }
      if (response.ok) {
        setDiversions(newDiversions);
        ctx.captureRevision('diversions', response);
        // Verse per-record-revisies ophalen (de collectie-save kent ze niet).
        void fetchDiversions(undefined, { silent: true });
        if (currentUser?.role === 'admin') {
          await fetchActivityLog();
        }
        showToast('Omleidingen succesvol opgeslagen.', 'success');
      } else {
        const err = await response.json().catch(() => ({} as any));
        showToast(err.details || err.error || 'Opslaan van omleidingen is mislukt.', 'error');
      }
    } catch (error) {
      console.error('Error saving diversions:', error);
      showToast('Opslaan van omleidingen is mislukt.', 'error');
    } finally {
      endLoading();
    }
  };

  // Omleidingen (planner/admin). `opVeldfouten` krijgt de veldfouten van een
  // 400 (gedeeld schema) voor het formulier.
  const saveDiversion = (record: Diversion, opVeldfouten?: OpVeldfouten): Promise<boolean> =>
    ctx.perRecord<Diversion>({
      key: 'diversions', label: 'Deze omleiding', method: 'PUT', url: `/api/diversions/${encodeURIComponent(record.id)}`, id: record.id, body: record, opVeldfouten,
      responseKey: 'diversion', setList: setDiversions, optimistic: (prev) => replaceById(prev, record), applySaved: replaceById,
      refetch: () => fetchDiversions(undefined, { silent: true }), successToast: 'Omleiding opgeslagen.',
    });
  const postDiversion = (record: Diversion, successToast: string, opVeldfouten?: OpVeldfouten, herstel = false): Promise<boolean> =>
    ctx.perRecord<Diversion>({
      key: 'diversions', label: 'Deze omleiding', method: 'POST', url: '/api/diversions/one', id: record.id, body: record, opVeldfouten,
      headers: herstel ? { 'X-Herstel': '1' } : undefined,
      responseKey: 'diversion', setList: setDiversions, optimistic: (prev) => [...withoutId(prev, record.id), record], applySaved: replaceById,
      refetch: () => fetchDiversions(undefined, { silent: true }), successToast,
    });
  const createDiversion = (record: Diversion, opVeldfouten?: OpVeldfouten): Promise<boolean> => postDiversion(record, 'Omleiding toegevoegd.', opVeldfouten);
  // Verwijderen gaat meteen (geen bevestigingsmodal); de toast biedt 6 s
  // "Ongedaan maken" = hetzelfde record (zelfde id) opnieuw POST …/one.
  const deleteDiversion = (id: string): Promise<boolean> => {
    const record = diversions.find((d) => d.id === id);
    const verwijder = () => ctx.perRecord<Diversion>({
      key: 'diversions', label: 'Deze omleiding', method: 'DELETE', url: `/api/diversions/${encodeURIComponent(id)}`, id,
      responseKey: 'diversion', setList: setDiversions, optimistic: (prev) => withoutId(prev, id),
      refetch: () => fetchDiversions(undefined, { silent: true }), successToast: record ? undefined : 'Omleiding verwijderd.',
    });
    if (!record) return verwijder();
    return metOngedaan({
      boodschap: `Omleiding ‘${record.title}’ verwijderd.`,
      uitvoeren: verwijder,
      // perRecord meldt zijn eigen fouten (409/netwerk) — daarom void.
      herstellen: async () => {
        if (await postDiversion(record, 'Omleiding hersteld.', undefined, true)) await fetchDiversions(undefined, { silent: true });
      },
      toast: showToast,
    });
  };

  // Updates (planner/admin). Geen success-toast: de view meldt zelf
  // "gepubliceerd/bijgewerkt" (en stuurt eventueel de dringende mail).
  const saveUpdate = (record: Update, opVeldfouten?: OpVeldfouten): Promise<boolean> =>
    ctx.perRecord<Update>({
      key: 'updates', label: 'Deze update', method: 'PUT', url: `/api/updates/${encodeURIComponent(record.id)}`, id: record.id, body: record, opVeldfouten,
      responseKey: 'update', setList: setUpdates, optimistic: (prev) => replaceById(prev, record), applySaved: replaceById, refetch: () => fetchUpdates(),
    });
  const postUpdate = (record: Update, successToast?: string, opVeldfouten?: OpVeldfouten, herstel = false): Promise<boolean> =>
    ctx.perRecord<Update>({
      key: 'updates', label: 'Deze update', method: 'POST', url: '/api/updates/one', id: record.id, body: record, opVeldfouten,
      // Herstel = geen tweede push naar alle chauffeurs (controle 05-09).
      headers: herstel ? { 'X-Herstel': '1' } : undefined,
      responseKey: 'update', setList: setUpdates, optimistic: (prev) => [record, ...withoutId(prev, record.id)], applySaved: replaceById, refetch: () => fetchUpdates(),
      successToast,
    });
  const createUpdate = (record: Update, opVeldfouten?: OpVeldfouten): Promise<boolean> => postUpdate(record, undefined, opVeldfouten);
  // Verwijderen gaat meteen; de toast biedt 6 s "Ongedaan maken" (zelfde
  // record opnieuw POST …/one). Zonder bekend record blijft het bij de
  // gewone verwijdering — de view meldt dan zelf.
  const deleteUpdate = (id: string): Promise<boolean> => {
    const record = updates.find((u) => u.id === id);
    const verwijder = () => ctx.perRecord<Update>({
      key: 'updates', label: 'Deze update', method: 'DELETE', url: `/api/updates/${encodeURIComponent(id)}`, id,
      responseKey: 'update', setList: setUpdates, optimistic: (prev) => withoutId(prev, id), refetch: () => fetchUpdates(),
      successToast: record ? undefined : 'Update verwijderd.',
    });
    if (!record) return verwijder();
    return metOngedaan({
      boodschap: `Update ‘${record.title}’ verwijderd.`,
      uitvoeren: verwijder,
      herstellen: async () => {
        if (await postUpdate(record, 'Update hersteld.', undefined, true)) await fetchUpdates();
      },
      toast: showToast,
    });
  };

  const resetCommunicatie = () => {
    setDiversions([]);
    setUpdates([]);
  };

  return {
    updates, diversions,
    fetchUpdates, saveUpdates, sendUrgentEmail, saveUpdate, createUpdate, deleteUpdate,
    fetchDiversions, saveDiversions, saveDiversion, createDiversion, deleteDiversion,
    resetCommunicatie,
  };
}
