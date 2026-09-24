import { useEffect, useState } from 'react';
import type { User } from '../../types';
import { apiFetch, apiJson, apiLijst } from '../../lib/api';
import type { VervaldataRij, PendingDevice } from '../../lib/werkvoorraad';
import { startRustigePoll } from '../../lib/rustigePoll';
import { replaceById, useCollectieState, withoutId, type DataCtx, type OpVeldfouten } from './kern';
import { laatSchrijffout } from '../../lib/foutenLui';

/**
 * Mensen: de gebruikerslijst (collectie- én per-record-savers), de
 * vervaldata en wachtende toestellen voor de werkvoorraad, en de
 * 'Nieuw'-badge op Mijn documenten van de chauffeur.
 */
export function useMensenData(ctx: DataCtx) {
  const { session, currentUser, showToast, meldLaadfout, fetchActivityLog } = ctx;
  const [users, setUsers, zetUsersUitAntwoord] = useCollectieState<User[]>([]);
  const [unseenDocuments, setUnseenDocuments] = useState(0);
  // Chauffeur/technieker laden gebruikers en documenten ná de poort
  // (useAppData): waar zodra de eerste laadpoging rond is. Voor staf zit
  // users in de poort en is de vlag dus al waar wanneer de poort opent.
  const [usersGeladen, setUsersGeladen] = useState(false);
  const [documentenGeladen, setDocumentenGeladen] = useState(false);
  // Voer voor de werkvoorraad-knop in de topbar én het Open taken-paneel op
  // het dashboard: vervaldata (staf) en wachtende toestellen (admin-only API)
  // komen uit eigen endpoints. Best-effort — de app mag hier nooit op breken.
  const [vervaldata, setVervaldata, zetVervaldataUitAntwoord] = useCollectieState<VervaldataRij[]>([]);
  const [pendingDevices, setPendingDevices, zetDevicesUitAntwoord] = useCollectieState<PendingDevice[]>([]);
  // Ververst elke 10 min (alleen in een zichtbaar tabblad) én bij tab-focus,
  // hooguit 1× per 5 min (startRustigePoll): het portaal staat bij de planner
  // de hele dag open en de werkvoorraad-badge moet blijven kloppen.
  useEffect(() => {
    const rol = currentUser?.role;
    if (rol !== 'planner' && rol !== 'admin') { setVervaldata([]); return; }
    let cancelled = false;
    const haal = () => {
      apiJson<VervaldataRij[]>('/api/user-expiries')
        .then((rows) => { if (!cancelled && Array.isArray(rows)) zetVervaldataUitAntwoord(null, rows, rows); })
        .catch(() => { /* geen data = geen rijen */ });
    };
    const stop = startRustigePoll(haal);
    return () => {
      cancelled = true;
      stop();
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
        if (!cancelled && Array.isArray(data)) zetDevicesUitAntwoord(res, data, data.filter((d: { status?: string }) => d.status === 'pending'));
      } catch {
        // stil: de werkvoorraad mag niet breken op een toestellen-fetch
      }
    };
    const stop = startRustigePoll(() => { void haal(); });
    return () => {
      cancelled = true;
      stop();
    };
  }, [currentUser?.role]);

  const fetchUsers = async (accessToken = session?.access_token) => {
    try {
      const { response, data } = await apiLijst('/api/users', { accessToken });
      ctx.noteerAntwoord(response);
      ctx.captureRevision('users', response);
      if (data && Array.isArray(data)) {
        // De revisies altijd bijwerken (stripRecordRevisions), de lijst alleen
        // bij gewijzigde inhoud.
        zetUsersUitAntwoord(response, data, ctx.stripRecordRevisions<User>('users', data));
        ctx.markCollectionLoaded('users');
        ctx.noteerCollectie('users', true);
      }
    } catch (error) {
      console.error('Error fetching users:', error);
      meldLaadfout('de gebruikerslijst', error);
      ctx.noteerCollectie('users', false);
    } finally {
      setUsersGeladen(true);
    }
  };

  const saveUsers = async (newUsers: Array<User & { password?: string }>) => {
    if (!ctx.guardCollectionLoaded('users', 'De gebruikerslijst is')) return false;
    try {
      const response = await apiFetch('/api/users', {
        method: 'POST',
        headers: ctx.revisionHeader('users'),
        body: JSON.stringify(newUsers),
      });
      if (response.status === 409 || response.status === 428) {
        showToast('De gebruikerslijst is intussen door iemand anders gewijzigd, ik ververs ze, probeer je wijziging opnieuw.', 'info');
        await fetchUsers();
        return false;
      }
      if (response.ok) {
        await fetchUsers();
        // Logboek stil op de achtergrond: de overlay wacht er niet op.
        if (currentUser?.role === 'admin') void fetchActivityLog();
        showToast('Gebruikers succesvol opgeslagen.', 'success');
        return true;
      } else {
        const text = await response.text();
        console.error('Server error saving users. Status:', response.status, 'Body:', text);

        // Alleen een JSON-reden van de server is gebruikerstekst; een
        // HTML-foutpagina (Vercel) blijft in de console hierboven.
        let reden = '';
        try {
          const errorData = JSON.parse(text);
          reden = errorData.details || errorData.error || '';
        } catch {
          // geen JSON: de status volstaat voor de vervolgstap
        }
        throw Object.assign(new Error(reden), { status: response.status });
      }
    } catch (error: any) {
      console.error('Error saving users:', error);
      laatSchrijffout('Opslaan van gebruikers', error, (tekst) => showToast(tekst, 'error'));
      return false;
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
  // Bron = users.dashboardvoorkeuren.documentenGezienOp (server, 15-09):
  // localStorage was per toestel, waardoor een nieuwe iPhone alles ooit als
  // "nieuw" telde. localStorage blijft de terugval zolang de PATCH niet lukt
  // en voor accounts van vóór deze wijziging.
  const fetchUnseenDocuments = async (userId: string, accessToken = session?.access_token) => {
    try {
      const { data } = await apiLijst('/api/documents', { accessToken });
      if (!Array.isArray(data)) return;
      let lokaal: string | null = null;
      try { lokaal = localStorage.getItem(`planx-documents-lastseen-${userId}`); } catch { /* privacy-modus */ }
      // De jongste van server en toestel wint: een oud servertijdstip mag een
      // recentere lokale "gezien" (PATCH ooit mislukt) niet terugdraaien.
      const server = currentUser?.dashboardVoorkeuren?.documentenGezienOp ?? null;
      const lastSeen = [lokaal, server].filter(Boolean).sort().pop() ?? null;
      const unseen = lastSeen ? data.filter((d: any) => String(d.uploadedAt) > lastSeen).length : data.length;
      setUnseenDocuments(unseen);
      ctx.noteerCollectie('documenten', true);
    } catch (error) {
      console.error('Error fetching documents badge:', error);
      ctx.noteerCollectie('documenten', false);
    } finally {
      setDocumentenGeladen(true);
    }
  };

  const markDocumentsSeen = () => {
    setUnseenDocuments(0);
    if (!currentUser) return;
    const nu = new Date().toISOString();
    try { localStorage.setItem(`planx-documents-lastseen-${currentUser.id}`, nu); } catch { /* privacy-modus */ }
    // Server is de bron; mislukt de PATCH (offline), dan vangt localStorage
    // het op dit toestel op en probeert het volgende bezoek opnieuw.
    void apiFetch('/api/me/voorkeuren', { method: 'PATCH', body: JSON.stringify({ dashboard: { documentenGezienOp: nu } }) }).catch(() => undefined);
  };

  /** Bij uitloggen: de gebruikerslijst leeg (badge/werkvoorraad blijven, zoals voorheen). */
  const resetMensen = () => {
    setUsers([]);
    setUsersGeladen(false);
    setDocumentenGeladen(false);
  };

  return {
    users, usersGeladen, unseenDocuments, documentenGeladen, vervaldata, pendingDevices,
    fetchUsers, saveUsers, saveUser, createUser, deleteUser,
    fetchUnseenDocuments, markDocumentsSeen, resetMensen,
  };
}
