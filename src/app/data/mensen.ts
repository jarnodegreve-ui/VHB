import { useEffect, useState } from 'react';
import type { User } from '../../types';
import { apiFetch, apiJson } from '../../lib/api';
import type { VervaldataRij, PendingDevice } from '../../lib/werkvoorraad';
import { replaceById, withoutId, type DataCtx, type OpVeldfouten } from './kern';

/**
 * Mensen: de gebruikerslijst (collectie- én per-record-savers), de
 * vervaldata en wachtende toestellen voor de werkvoorraad, en de
 * 'Nieuw'-badge op Mijn documenten van de chauffeur.
 */
export function useMensenData(ctx: DataCtx) {
  const { session, currentUser, showToast, meldLaadfout, beginLoading, endLoading, fetchActivityLog } = ctx;
  const [users, setUsers] = useState<User[]>([]);
  const [unseenDocuments, setUnseenDocuments] = useState(0);
  // Voer voor de werkvoorraad-knop in de topbar én het Open taken-paneel op
  // het dashboard: vervaldata (staf) en wachtende toestellen (admin-only API)
  // komen uit eigen endpoints. Best-effort — de app mag hier nooit op breken.
  const [vervaldata, setVervaldata] = useState<VervaldataRij[]>([]);
  const [pendingDevices, setPendingDevices] = useState<PendingDevice[]>([]);
  // Ververst elke 10 min én bij tab-focus: het portaal staat bij de planner
  // de hele dag open en de werkvoorraad-badge moet blijven kloppen.
  useEffect(() => {
    const rol = currentUser?.role;
    if (rol !== 'planner' && rol !== 'admin') { setVervaldata([]); return; }
    let cancelled = false;
    const haal = () => {
      apiJson<VervaldataRij[]>('/api/user-expiries')
        .then((rows) => { if (!cancelled && Array.isArray(rows)) setVervaldata(rows); })
        .catch(() => { /* geen data = geen rijen */ });
    };
    haal();
    const timer = window.setInterval(haal, 10 * 60 * 1000);
    window.addEventListener('focus', haal);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', haal);
    };
  }, [currentUser?.role]);
  useEffect(() => {
    if (currentUser?.role !== 'admin') { setPendingDevices([]); return; }
    let cancelled = false;
    const haal = async () => {
      try {
        const res = await apiFetch('/api/devices');
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && Array.isArray(data)) setPendingDevices(data.filter((d: { status?: string }) => d.status === 'pending'));
      } catch {
        // stil: de werkvoorraad mag niet breken op een toestellen-fetch
      }
    };
    void haal();
    const timer = window.setInterval(haal, 10 * 60 * 1000);
    const opFocus = () => { void haal(); };
    window.addEventListener('focus', opFocus);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', opFocus);
    };
  }, [currentUser?.role]);

  const fetchUsers = async (accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/users', { accessToken });
      ctx.captureRevision('users', response);
      const data = await response.json();
      if (data && Array.isArray(data)) {
        setUsers(ctx.stripRecordRevisions<User>('users', data));
        ctx.markCollectionLoaded('users');
      }
    } catch (error) {
      console.error('Error fetching users:', error);
      meldLaadfout('de gebruikerslijst');
    }
  };

  const saveUsers = async (newUsers: Array<User & { password?: string }>) => {
    if (!ctx.guardCollectionLoaded('users', 'De gebruikerslijst is')) return false;
    try {
      beginLoading();
      const response = await apiFetch('/api/users', {
        method: 'POST',
        headers: ctx.revisionHeader('users'),
        body: JSON.stringify(newUsers),
      });
      if (response.status === 409 || response.status === 428) {
        showToast('De gebruikerslijst is intussen door iemand anders gewijzigd — ik ververs ze, probeer je wijziging opnieuw.', 'info');
        await fetchUsers();
        return false;
      }
      if (response.ok) {
        await fetchUsers();
        if (currentUser?.role === 'admin') {
          await fetchActivityLog();
        }
        showToast('Gebruikers succesvol opgeslagen.', 'success');
        return true;
      } else {
        const text = await response.text();
        console.error('Server error saving users. Status:', response.status, 'Body:', text);

        let errorMsg = `Server fout (${response.status})`;
        try {
          const errorData = JSON.parse(text);
          errorMsg = errorData.details || errorData.error || errorMsg;
        } catch (e) {
          // If not JSON, maybe it's a Vercel error page
          if (text.includes('500') || text.includes('Internal Server Error')) {
            errorMsg = "Interne Server Fout (500). Controleer de Vercel logs of de tabelstructuur in Supabase.";
          } else if (text.length > 0) {
            errorMsg = `Server fout: ${text.slice(0, 100)}`;
          }
        }
        throw new Error(errorMsg);
      }
    } catch (error: any) {
      console.error('Error saving users:', error);
      showToast('Fout bij het opslaan van gebruikers: ' + error.message, 'error');
      return false;
    } finally {
      endLoading();
    }
  };

  // Gebruikers (admin). Het record mag een `password` dragen (nieuw of reset);
  // het serverrecord dat terugkomt is zonder. `opVeldfouten` krijgt de
  // veldfouten van een 400 (gedeeld schema) voor het formulier.
  const saveUser = (record: User & { password?: string }, opVeldfouten?: OpVeldfouten): Promise<boolean> =>
    ctx.perRecord<User>({
      key: 'users', label: 'Deze gebruiker', method: 'PUT', url: `/api/users/${encodeURIComponent(record.id)}`, id: record.id, body: record, opVeldfouten,
      responseKey: 'user', setList: setUsers,
      optimistic: (prev) => { const { password: _pw, ...zonder } = record; return replaceById(prev, zonder as User); },
      applySaved: replaceById, refetch: () => fetchUsers(), successToast: 'Gebruiker opgeslagen.',
    });
  const createUser = (record: User & { password?: string }, opVeldfouten?: OpVeldfouten): Promise<boolean> =>
    ctx.perRecord<User>({
      key: 'users', label: 'Deze gebruiker', method: 'POST', url: '/api/users/one', id: record.id, body: record, opVeldfouten,
      responseKey: 'user', setList: setUsers,
      optimistic: (prev) => { const { password: _pw, ...zonder } = record; return [...withoutId(prev, record.id), zonder as User]; },
      applySaved: replaceById, refetch: () => fetchUsers(), successToast: 'Gebruiker toegevoegd.',
    });
  const deleteUser = (id: string): Promise<boolean> =>
    ctx.perRecord<User>({
      key: 'users', label: 'Deze gebruiker', method: 'DELETE', url: `/api/users/${encodeURIComponent(id)}`, id,
      responseKey: 'user', setList: setUsers, optimistic: (prev) => withoutId(prev, id), refetch: () => fetchUsers(), successToast: 'Gebruiker verwijderd.',
    });

  // 'Nieuw'-badge op Mijn documenten: telt de eigen documenten die nieuwer zijn
  // dan het moment waarop de chauffeur de documentenweergave het laatst opende.
  const fetchUnseenDocuments = async (userId: string, accessToken = session?.access_token) => {
    try {
      const response = await apiFetch('/api/documents', { accessToken });
      const data = await response.json();
      if (!Array.isArray(data)) return;
      let lastSeen: string | null = null;
      try { lastSeen = localStorage.getItem(`planx-documents-lastseen-${userId}`); } catch { /* privacy-modus */ }
      const unseen = lastSeen ? data.filter((d: any) => String(d.uploadedAt) > lastSeen).length : data.length;
      setUnseenDocuments(unseen);
    } catch (error) {
      console.error('Error fetching documents badge:', error);
    }
  };

  const markDocumentsSeen = () => {
    setUnseenDocuments(0);
    if (!currentUser) return;
    try { localStorage.setItem(`planx-documents-lastseen-${currentUser.id}`, new Date().toISOString()); } catch { /* privacy-modus */ }
  };

  /** Bij uitloggen: de gebruikerslijst leeg (badge/werkvoorraad blijven, zoals voorheen). */
  const resetMensen = () => {
    setUsers([]);
  };

  return {
    users, unseenDocuments, vervaldata, pendingDevices,
    fetchUsers, saveUsers, saveUser, createUser, deleteUser,
    fetchUnseenDocuments, markDocumentsSeen, resetMensen,
  };
}
