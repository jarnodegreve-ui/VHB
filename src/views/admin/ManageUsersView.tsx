import React, { useEffect, useState } from 'react';
import { Bell, BellOff, FolderOpen, History, Info, MoreHorizontal, Pause, Play, Plus, RotateCcw, Send, Trash2, Upload, Users } from 'lucide-react';
import type { LeaveRequest, Shift, SwapRequest, User } from '../../types';
import { cn, getSupabaseAuthHeaders, notify } from '../../lib/ui';
import { EXPIRY_SOORT_LABELS, formatDateTimeHuman } from '../../lib/format';
import { AdminSubsectionHeader, ConfirmationModal, CredentialsModal, EmptyState, PageHeader, PageShell } from '../../components/ui';
import { Badge, Button, MicroLabel, TableShell, Td, Th } from '../../components/primitives';
import { Modal } from '../../components/Modal';
import { UserHistoryModal } from './UserHistoryModal';
import { UserDocumentsModal } from './UserDocumentsModal';
import { BroadcastDocumentModal } from './BroadcastDocumentModal';
import { EntityHistoryModal } from '../../components/EntityHistoryModal';

export type UserDraft = User & { password?: string };

/** Rol → badge-tint (presentatie, geen logica). */
const ROLE_BADGE_TONE = { admin: 'oker', planner: 'blue', chauffeur: 'slate' } as const;

export function ManageUsersView({ users, onSave, title = 'Gebruikersbeheer', currentUser, shifts = [], leaveRequests = [], swaps = [] }: { users: User[]; onSave: (u: UserDraft[]) => Promise<boolean>; title?: string; currentUser: User; shifts?: Shift[]; leaveRequests?: LeaveRequest[]; swaps?: SwapRequest[] }) {
  const [isImporting, setIsImporting] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserDraft | null>(null);
  // Vervaldata (Code 95 / medische schifting): aparte mini-API naast
  // de users-collectie. Eén keer laden; per bewerkte gebruiker een draft die
  // pas bij Opslaan wordt weggeschreven (zelfde moment als de rest van het
  // formulier — geen halve saves bij Annuleren).
  const [userExpiries, setUserExpiries] = useState<Record<string, Record<string, string>>>({});
  const [vervalDraft, setVervalDraft] = useState<Record<string, string>>({});
  // Wie heeft meldingen aanstaan? Zonder abonnement komt er niets aan — bij de
  // uitrol is dat het verschil tussen "hij reageert niet" en "hij krijgt
  // niets". Best-effort: mislukt de call, dan blijft de kolom gewoon "uit".
  const [pushUserIds, setPushUserIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/push/subscribers', { headers: await getSupabaseAuthHeaders() });
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled && Array.isArray(body?.userIds)) setPushUserIds(new Set(body.userIds.map(String)));
      } catch { /* zonder deze lijst tonen we simpelweg geen 'aan' */ }
    })();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/user-expiries', { headers: await getSupabaseAuthHeaders() });
        if (!res.ok) return;
        const rows: Array<{ userId: string; soort: string; validUntil: string }> = await res.json();
        if (cancelled || !Array.isArray(rows)) return;
        const map: Record<string, Record<string, string>> = {};
        for (const r of rows) {
          if (!map[r.userId]) map[r.userId] = {};
          map[r.userId][r.soort] = r.validUntil;
        }
        setUserExpiries(map);
      } catch { /* zonder vervaldata gewoon lege velden */ }
    })();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    setVervalDraft(editingUser ? { ...(userExpiries[editingUser.id] ?? {}) } : {});
    // Bewust alleen op de gebruikers-id: de draft mag niet resetten terwijl
    // je typt doordat een fetch de kaart ververst.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingUser?.id]);
  const [viewingHistoryUser, setViewingHistoryUser] = useState<User | null>(null);
  const [viewingChangeLogUser, setViewingChangeLogUser] = useState<User | null>(null);
  const [documentsUser, setDocumentsUser] = useState<User | null>(null);
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', role: 'chauffeur', employeeId: '', password: '', phone: '', email: '' });
  const [roleFilter, setRoleFilter] = useState<'all' | 'chauffeur' | 'planner' | 'admin'>('all');
  // Naam-zoekveld: met 42 accounts is scrollen traag; zoeken is de kortste weg.
  const [userSearch, setUserSearch] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmResetUser, setConfirmResetUser] = useState<User | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [pendingImportUsers, setPendingImportUsers] = useState<UserDraft[] | null>(null);
  const [pendingImportMessage, setPendingImportMessage] = useState('');
  const [credentialsModal, setCredentialsModal] = useState<{ title: string; email: string; password: string } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  // ⋯-overflowmenu per rij: zes losse knoppen naast elkaar was te druk
  // (design-review); Bewerken blijft direct, de rest zit in het menu.
  const [menuUserId, setMenuUserId] = useState<string | null>(null);

  // Uitrol-teller: alleen actieve medewerkers tellen mee — een gepauzeerd
  // account zonder meldingen is geen openstaand punt.
  const actieveUsers = users.filter((u) => u.isActive !== false && u.name.trim().toLowerCase() !== 'beheerder');
  const pushTotaal = actieveUsers.length;
  const pushMetAan = actieveUsers.filter((u) => pushUserIds.has(String(u.id))).length;

  const activeAdmins = users.filter((u) => u.role === 'admin' && u.isActive !== false);
  const isProtectedAdmin = (user: User) => user.role === 'admin' && user.isActive !== false && activeAdmins.length === 1;

  const filteredUsers = users
    .filter((u) => {
      const isBeheerder = u.name.toLowerCase() === 'beheerder';
      const isMe = u.id === currentUser.id;
      if (isBeheerder && !isMe) return false;
      return true;
    })
    .filter((u) => roleFilter === 'all' || u.role === roleFilter)
    .filter((u) => {
      const q = userSearch.trim().toLowerCase();
      if (!q) return true;
      return [u.name, u.employeeId, u.email ?? ''].join(' ').toLowerCase().includes(q);
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const [isSubmittingUser, setIsSubmittingUser] = useState(false);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingUser) return;
    if (!newUser.name) return;
    if (!newUser.email) return notify('Een e-mailadres is verplicht voor Supabase login.', 'error');
    if (newUser.password.length < 6) return notify('Gebruik een tijdelijk wachtwoord van minstens 6 tekens.', 'error');

    const userToAdd: UserDraft = {
      id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: newUser.name,
      role: newUser.role as any,
      employeeId: newUser.employeeId || `VHB-${Math.floor(1000 + Math.random() * 9000)}`,
      password: newUser.password,
      phone: newUser.phone,
      email: newUser.email,
      isActive: true,
    };

    setIsSubmittingUser(true);
    const success = await onSave([...users, userToAdd]).finally(() => setIsSubmittingUser(false));
    if (!success) return;
    setShowAddModal(false);
    setNewUser({ name: '', role: 'chauffeur', employeeId: '', password: '', phone: '', email: '' });
    setCredentialsModal({
      title: 'Nieuwe gebruiker aangemaakt',
      email: userToAdd.email || '',
      password: userToAdd.password || '',
    });
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingUser) return;
    if (!editingUser) return;
    if (!editingUser.email) return notify('Een e-mailadres is verplicht voor Supabase login.', 'error');
    if (editingUser.password && editingUser.password.length < 6) return notify('Een nieuw wachtwoord moet minstens 6 tekens hebben.', 'error');

    const originalUser = users.find((u) => u.id === editingUser.id);
    const isOnlyActiveAdmin = originalUser?.role === 'admin' && originalUser.isActive !== false && activeAdmins.length === 1;
    const adminWouldBeRemoved = editingUser.role !== 'admin' || editingUser.isActive === false;
    if (isOnlyActiveAdmin && adminWouldBeRemoved) return notify('Je kunt de laatste actieve admin niet degraderen of deactiveren.', 'error');

    setIsSubmittingUser(true);
    const success = await onSave(users.map((u) => (u.id === editingUser.id ? editingUser : u))).finally(() => setIsSubmittingUser(false));
    if (!success) return;
    // Vervaldata pas ná een geslaagde user-save: alleen de gewijzigde soorten.
    const bestaand = userExpiries[editingUser.id] ?? {};
    for (const soort of Object.keys(EXPIRY_SOORT_LABELS)) {
      const nieuw = (vervalDraft[soort] ?? '').trim();
      const oud = bestaand[soort] ?? '';
      if (nieuw === oud) continue;
      try {
        const res = await fetch('/api/user-expiries', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...(await getSupabaseAuthHeaders()) },
          body: JSON.stringify({ userId: editingUser.id, soort, validUntil: nieuw || null }),
        });
        if (!res.ok) throw new Error(String(res.status));
        setUserExpiries((prev) => {
          const per = { ...(prev[editingUser.id] ?? {}) };
          if (nieuw) per[soort] = nieuw; else delete per[soort];
          return { ...prev, [editingUser.id]: per };
        });
      } catch {
        notify(`${EXPIRY_SOORT_LABELS[soort]} kon niet opgeslagen worden — probeer opnieuw.`, 'error');
      }
    }
    setEditingUser(null);
  };

  const handleDeleteUser = async () => {
    if (!confirmDeleteId) return;
    const userToDelete = users.find((u) => u.id === confirmDeleteId);
    const isOnlyActiveAdmin = userToDelete?.role === 'admin' && userToDelete.isActive !== false && activeAdmins.length === 1;
    if (isOnlyActiveAdmin) {
      notify('Je kunt de laatste actieve admin niet verwijderen.', 'error');
      setConfirmDeleteId(null);
      return;
    }
    const success = await onSave(users.filter((u) => u.id !== confirmDeleteId));
    if (!success) return;
    if (editingUser?.id === confirmDeleteId) setEditingUser(null);
    setConfirmDeleteId(null);
  };

  // --- Bulk-acties: pauzeren/activeren/verwijderen. Beschermd tegen het
  //     raken van jezelf, het 'beheerder'-account of de laatste actieve admin.
  const isBulkProtected = (u: User) => isProtectedAdmin(u) || u.id === currentUser.id || u.name.toLowerCase() === 'beheerder';
  const toggleSelect = (id: string) => setSelectedIds((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const selectableIds = filteredUsers.filter((u) => !isBulkProtected(u)).map((u) => u.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));
  const toggleSelectAll = () => setSelectedIds(allSelected ? new Set() : new Set(selectableIds));
  const clearSelection = () => setSelectedIds(new Set());

  const bulkSetActive = async (active: boolean) => {
    const targetIds = new Set([...selectedIds].filter((id) => { const u = users.find((x) => x.id === id); return !!u && (active || !isBulkProtected(u)); }));
    if (targetIds.size === 0) return notify('Geen gebruikers om te wijzigen.', 'error');
    const success = await onSave(users.map((u) => (targetIds.has(u.id) ? { ...u, isActive: active } : u)));
    if (success) { notify(`${targetIds.size} gebruiker(s) ${active ? 'geactiveerd' : 'gepauzeerd'}.`, 'success'); clearSelection(); }
  };
  const quickToggleActive = async (u: User) => {
    if (u.isActive !== false && isProtectedAdmin(u)) return notify('Je kunt de laatste actieve admin niet pauzeren.', 'error');
    await onSave(users.map((x) => (x.id === u.id ? { ...x, isActive: u.isActive === false } : x)));
  };
  const handleBulkDelete = async () => {
    const targetIds = new Set([...selectedIds].filter((id) => { const u = users.find((x) => x.id === id); return !!u && !isBulkProtected(u); }));
    setConfirmBulkDelete(false);
    if (targetIds.size === 0) return notify('Geen gebruikers om te verwijderen (beschermde accounts overgeslagen).', 'error');
    const success = await onSave(users.filter((u) => !targetIds.has(u.id)));
    if (success) { notify(`${targetIds.size} gebruiker(s) verwijderd.`, 'success'); clearSelection(); }
  };

  const handleResetPassword = async () => {
    if (!confirmResetUser) return;
    if (resetPasswordValue.length < 6) return notify('Gebruik minstens 6 tekens.', 'error');
    try {
      setIsResettingPassword(true);
      const response = await fetch('/api/admin/users/reset-password', {
        method: 'POST',
        headers: await getSupabaseAuthHeaders(),
        body: JSON.stringify({ userId: confirmResetUser.id, password: resetPasswordValue }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return notify(data.details || data.error || 'Reset mislukt.', 'error');
      notify(`Wachtwoord voor ${confirmResetUser.name} is bijgewerkt.`, 'success');
      setCredentialsModal({
        title: `Wachtwoord reset voor ${confirmResetUser.name}`,
        email: confirmResetUser.email || '',
        password: resetPasswordValue,
      });
      setConfirmResetUser(null);
      setResetPasswordValue('');
    } catch (error: any) {
      // fetch kan ook gooien (offline) — zonder catch leek de reset gelukt
      // terwijl het wachtwoord nooit gezet was.
      notify(`Reset mislukt: ${error?.message || 'netwerkfout'}.`, 'error');
    } finally {
      setIsResettingPassword(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsImporting(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const XLSX = await import('xlsx');
        const data = new Uint8Array(event.target?.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        // raw:false: anders worden gsm-nummers numeriek gelezen en valt de leidende 0 weg
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '', raw: false });
        if (!Array.isArray(jsonData) || jsonData.length === 0) return notify('Het Excel-bestand lijkt leeg te zijn of heeft geen herkenbare gegevens.', 'error');

        const keys = Object.keys(jsonData[0] as any);
        const importedUsers: UserDraft[] = jsonData
          .map((row: any, index) => {
            const rowKeys = Object.keys(row);
            // Elke kolom mag maar één veld voeden (used-set), en specifieke
            // velden claimen hun kolom vóór de generieke. Anders kaapte een
            // greedy patroon ('nummer'/'id') de kolom 'Telefoonnummer' voor
            // employeeId, of stopte de naam-match al op een 'Voornaam'-kolom.
            const used = new Set<string>();
            const findValue = (patterns: string[]) => {
              const foundKey = rowKeys.find((k) => !used.has(k) && patterns.some((p) => k.toString().trim().toLowerCase().includes(p)));
              if (foundKey) used.add(foundKey);
              return foundKey ? row[foundKey] : undefined;
            };

            // 1) Specifieke velden eerst (claimen hun kolom).
            const email = (() => { const v = findValue(['email', 'mail', 'e-mail'])?.toString().trim(); return v && v.includes('@') ? v : undefined; })();
            const phone = findValue(['gsm', 'telefoon', 'phone', 'mobiel', 'tel'])?.toString().trim() || undefined;
            const password = findValue(['wachtwoord', 'password', 'pass', 'wacht', 'pw'])?.toString() || '';
            const rawRole = (findValue(['rol', 'role', 'functie']) || 'chauffeur').toString().toLowerCase();
            let role: 'admin' | 'planner' | 'chauffeur' = 'chauffeur';
            if (rawRole.includes('admin') || rawRole.includes('beheer')) role = 'admin';
            else if (rawRole.includes('plan') || rawRole.includes('dispo')) role = 'planner';

            // Sectie (Maandplanning): kolom 'Sectie'/'Afdeling'/'Ploeg' —
            // genormaliseerd naar de vier vaste secties; een onbekende waarde
            // wordt genegeerd zodat een typfout nooit een rare sectie aanmaakt.
            const rawSection = findValue(['sectie', 'section', 'afdeling', 'ploeg'])?.toString().trim().toLowerCase();
            let section: string | undefined;
            if (rawSection) {
              if (rawSection.includes('regul')) section = 'Reguliere';
              else if (rawSection.includes('nacht')) section = 'Nacht';
              else if (rawSection.includes('flex')) section = 'Flexi';
              else if (rawSection.includes('school')) section = 'Schoolvervoer';
            }

            // 2) Naam: aparte voornaam/achternaam-kolommen worden samengevoegd;
            //    een gecombineerde 'Naam'-kolom heeft voorrang.
            const voornaam = findValue(['voornaam', 'firstname', 'first name'])?.toString().trim();
            const achternaam = findValue(['achternaam', 'familienaam', 'lastname', 'last name', 'surname'])?.toString().trim();
            const volleNaam = findValue(['naam', 'name', 'medewerker', 'chauffeur', 'gebruiker', 'user'])?.toString().trim();
            const name = volleNaam || [voornaam, achternaam].filter(Boolean).join(' ');

            const generatedId = (Date.now() + index).toString();
            // 3) employeeId als laatste — pakt enkel een nog niet-geclaimde
            //    kolom (geen losse 'id'/'code' meer die van alles kaapt).
            const employeeId = findValue(['personeelsnummer', 'personeelsnr', 'personeel', 'stamnummer', 'badge', 'matricule', 'employee', 'nummer', 'nr'])?.toString().trim() || `VHB-${generatedId.slice(-4)}`;
            return {
              id: generatedId,
              name,
              role,
              employeeId,
              password,
              phone,
              email,
              section,
              isActive: true,
            };
          })
          .filter((u) => u.name && u.name.length > 1);

        if (importedUsers.length === 0) {
          return notify(`Geen geldige gebruikers gevonden. Gevonden kolommen: ${keys.join(', ')}`, 'error');
        }

        const newUsersList: UserDraft[] = [...users];
        let updatedCount = 0;
        let addedCount = 0;
        importedUsers.forEach((impUser) => {
          const existingIdx = newUsersList.findIndex((u) => u.name.toLowerCase() === impUser.name.toLowerCase());
          if (existingIdx !== -1) {
            // BEWUST géén password op bestaande gebruikers: een her-import van
            // het personeels-Excel (met de oude tijdelijke wachtwoorden in een
            // kolom) zou anders ieders wachtwoord resetten en wie z'n eigen
            // wachtwoord instelde buitensluiten. Wachtwoord wijzigen loopt via
            // de reset-knop, niet via de import.
            newUsersList[existingIdx] = { ...newUsersList[existingIdx], phone: impUser.phone || newUsersList[existingIdx].phone, email: impUser.email || newUsersList[existingIdx].email, role: impUser.role || newUsersList[existingIdx].role, employeeId: impUser.employeeId || newUsersList[existingIdx].employeeId, section: impUser.section || newUsersList[existingIdx].section };
            updatedCount++;
          } else {
            newUsersList.push(impUser);
            addedCount++;
          }
        });

        if (addedCount === 0 && updatedCount === 0) {
          notify('Geen nieuwe gegevens of wijzigingen gevonden in het bestand.', 'info');
        } else {
          setPendingImportUsers(newUsersList);
          setPendingImportMessage(updatedCount > 0 ? `Er zijn ${addedCount} nieuwe gebruikers gevonden en ${updatedCount} bestaande gebruikers die worden bijgewerkt. Wilt u doorgaan?` : `Er zijn ${addedCount} nieuwe gebruikers gevonden. Wilt u deze toevoegen?`);
        }
      } catch (error) {
        console.error('Error parsing Excel:', error);
        notify('Fout bij het verwerken van het Excel-bestand. Controleer of het een geldig Excel-bestand is.', 'error');
      } finally {
        setIsImporting(false);
        if (e.target) e.target.value = '';
      }
    };
    reader.onerror = () => {
      notify('Fout bij het lezen van het bestand.', 'error');
      setIsImporting(false);
    };
    reader.readAsArrayBuffer(file);
  };

  const handleConfirmImport = async () => {
    if (!pendingImportUsers) return;
    const success = await onSave(pendingImportUsers);
    if (success) notify('Import succesvol verwerkt.', 'success');
    setPendingImportUsers(null);
    setPendingImportMessage('');
  };

  return (
    <PageShell>
      <PageHeader
        eyebrow="Gebruikersbeheer"
        title={title}
        description="Beheer medewerkers, rollen en accountacties vanuit beheershell."
        actions={(
          <>
            <label className={cn('control-button-soft ios-pressable inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-slate-700 transition-all hover:text-slate-900', isImporting && 'cursor-not-allowed opacity-50')}>
              <Upload size={16} />
              {isImporting ? 'Bezig…' : 'Excel importeren'}
              <input type="file" accept=".xlsx, .xls" className="hidden" onChange={handleFileUpload} disabled={isImporting} />
            </label>
            <Button variant="secondary" icon={<Send size={16} />} onClick={() => setShowBroadcast(true)}>
              Document naar iedereen
            </Button>
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setShowAddModal(true)}>
              Gebruiker Toevoegen
            </Button>
          </>
        )}
      />

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.9fr]">
        <div className="surface-card rounded-3xl p-6">
          <AdminSubsectionHeader
            eyebrow="Werkset"
            title="Zichtbare gebruikers"
            description="Filter de huidige lijst per rol voordat je wijzigingen doorvoert."
            aside={(
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="slate">{filteredUsers.length} zichtbaar</Badge>
                {/* Uitrol-teller: hoeveel actieve medewerkers kunnen de
                    meldingen die de app verstuurt écht ontvangen? */}
                <Badge tone={pushMetAan > 0 ? 'emerald' : 'slate'} icon={<Bell size={11} />}>
                  {pushMetAan} van {pushTotaal} met meldingen
                </Badge>
              </div>
            )}
          />
          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="glass-segmented inline-flex rounded-2xl p-1 self-start">
              {(['all', 'chauffeur', 'planner', 'admin'] as const).map((role) => (
                <button key={role} onClick={() => setRoleFilter(role)} className={cn('px-3.5 py-2 rounded-xl text-xs font-semibold capitalize transition-all', roleFilter === role ? 'glass-chip text-oker-600 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
                  {role === 'all' ? 'Alles' : role}
                </button>
              ))}
            </div>
            <input
              type="search"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Zoek op naam, personeelsnr of e-mail…"
              aria-label="Zoek gebruiker"
              className="control-input w-full sm:max-w-xs rounded-2xl px-4 py-2.5 text-base sm:text-sm font-medium outline-none"
            />
          </div>
        </div>

        <div className="rounded-3xl border border-oker-100 bg-oker-50/80 p-5 text-sm">
          <MicroLabel className="text-oker-700">Bronimport</MicroLabel>
          <p className="mt-3 font-bold tracking-tight text-oker-800">Excel Instructies</p>
          <p className="mt-2 text-[13px] text-oker-700">Gebruik bij voorkeur de kolommen <span className="font-mono font-semibold">Naam, E-mail, Rol</span>. Voor nieuwe accounts kun je optioneel ook <span className="font-mono font-semibold">Wachtwoord</span> toevoegen zodat Supabase meteen een login kan aanmaken.</p>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-oker-200/70 bg-oker-500/10 px-4 py-2.5">
          <span className="text-[13px] font-semibold text-slate-700">{selectedIds.size} geselecteerd</span>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" icon={<Pause size={15} />} onClick={() => bulkSetActive(false)}>Pauzeren</Button>
            <Button variant="secondary" size="sm" icon={<Play size={15} />} onClick={() => bulkSetActive(true)}>Activeren</Button>
            <Button variant="danger" size="sm" icon={<Trash2 size={15} />} onClick={() => setConfirmBulkDelete(true)}>Verwijderen</Button>
            <Button variant="ghost" size="sm" onClick={clearSelection}>Wissen</Button>
          </div>
        </div>
      )}

      <TableShell>
        <div className="border-b border-white/70 px-5 py-4 md:px-6">
          <AdminSubsectionHeader
            eyebrow="Overzicht"
            title="Gebruikerslijst"
            description="Controleer status, sessies en accountacties per medewerker."
          />
        </div>
        <div className="hidden md:block">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50">
                <Th className="w-10"><input type="checkbox" aria-label="Alles selecteren" checked={allSelected} onChange={toggleSelectAll} className="h-4 w-4 rounded border-slate-300 accent-oker-500 cursor-pointer" /></Th>
                <Th>Medewerker</Th>
                <Th>Status</Th>
                <Th title="Heeft deze medewerker meldingen aan staan op minstens één toestel?">Meldingen</Th>
                <Th>Laatst Actief</Th>
                <Th className="text-center">Sessies</Th>
                <Th className="text-right">Acties</Th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((u) => (
                <tr key={u.id} className={cn('group transition-colors hover:bg-slate-50/60', selectedIds.has(u.id) && 'bg-oker-50/40')}>
                  <Td className="w-10"><input type="checkbox" aria-label={`Selecteer ${u.name}`} checked={selectedIds.has(u.id)} disabled={isBulkProtected(u)} onChange={() => toggleSelect(u.id)} className="h-4 w-4 rounded border-slate-300 accent-oker-500 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed" /></Td>
                  <Td>
                    <div className="font-bold tracking-tight text-slate-800">{u.name}</div>
                    <div className="mt-1"><Badge tone={ROLE_BADGE_TONE[u.role]} className="capitalize">{u.role}</Badge></div>
                  </Td>
                  <Td><Badge tone={u.isActive !== false ? 'emerald' : 'slate'} dot>{u.isActive !== false ? 'Actief' : 'Gepauzeerd'}</Badge></Td>
                  {/* Zonder abonnement komt géén enkele melding aan. */}
                  <Td>
                    {pushUserIds.has(String(u.id))
                      ? <Badge tone="emerald" icon={<Bell size={11} />}>Aan</Badge>
                      : <Badge tone="slate" icon={<BellOff size={11} />}>Uit</Badge>}
                  </Td>
                  <Td className="tabular-nums">{u.lastLogin ? formatDateTimeHuman(u.lastLogin) : <span className="text-slate-400">Nooit</span>}</Td>
                  <Td className="text-center"><span className={cn('inline-flex h-7 w-7 items-center justify-center rounded-lg border text-xs font-semibold tabular-nums', (u.activeSessions || 0) > 0 ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-slate-100 bg-slate-50 text-slate-400')}>{u.activeSessions || 0}</span></Td>
                  <Td className="text-right">
                    <div className="relative flex items-center justify-end gap-1.5">
                      <Button variant="secondary" size="sm" onClick={() => setEditingUser(u)}>Bewerken</Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="px-2"
                        onClick={() => setMenuUserId(menuUserId === u.id ? null : u.id)}
                        aria-label="Meer acties"
                        aria-expanded={menuUserId === u.id}
                        title="Meer acties"
                        icon={<MoreHorizontal size={16} />}
                      />
                      {menuUserId === u.id && (
                        <>
                          {/* Klik-buiten sluit het menu. */}
                          <button type="button" className="fixed inset-0 z-40 cursor-default" onClick={() => setMenuUserId(null)} aria-label="Sluit menu" tabIndex={-1} />
                          <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-xl text-left dark:border-white/10 dark:bg-[rgb(30,31,34)]">
                            <RowMenuItem icon={<Info size={15} />} label="Verlof- & dienstruil-historiek" onClick={() => { setMenuUserId(null); setViewingHistoryUser(u); }} />
                            <RowMenuItem icon={<FolderOpen size={15} />} label="Documenten beheren" onClick={() => { setMenuUserId(null); setDocumentsUser(u); }} />
                            <RowMenuItem icon={<History size={15} />} label="Wijzigingsgeschiedenis" onClick={() => { setMenuUserId(null); setViewingChangeLogUser(u); }} />
                            <RowMenuItem icon={<RotateCcw size={15} />} label="Nieuw tijdelijk wachtwoord" onClick={() => { setMenuUserId(null); setConfirmResetUser(u); }} />
                            <RowMenuItem
                              icon={u.isActive !== false ? <Pause size={15} /> : <Play size={15} />}
                              label={u.isActive !== false ? 'Pauzeer gebruiker' : 'Activeer gebruiker'}
                              disabled={u.isActive !== false && isProtectedAdmin(u)}
                              onClick={() => { setMenuUserId(null); void quickToggleActive(u); }}
                            />
                            <div className="my-1 border-t border-slate-100 dark:border-white/10" />
                            <RowMenuItem
                              icon={<Trash2 size={15} />}
                              label="Verwijder gebruiker"
                              tone="danger"
                              disabled={isProtectedAdmin(u)}
                              onClick={() => { setMenuUserId(null); setConfirmDeleteId(u.id); }}
                            />
                          </div>
                        </>
                      )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="md:hidden divide-y divide-slate-100">
          {filteredUsers.map((u) => (
            <div key={u.id} className="p-5 space-y-4 active:bg-slate-50 transition-colors">
              <div className="flex justify-between items-start gap-3">
                <div className="flex items-start gap-3">
                  <input type="checkbox" aria-label={`Selecteer ${u.name}`} checked={selectedIds.has(u.id)} disabled={isBulkProtected(u)} onChange={() => toggleSelect(u.id)} className="mt-1 h-4 w-4 rounded border-slate-300 accent-oker-500 disabled:opacity-30" />
                  <div>
                    <div className="font-bold tracking-tight text-slate-800 leading-tight">{u.name}</div>
                    <div className="mt-1.5"><Badge tone={ROLE_BADGE_TONE[u.role]} className="capitalize">{u.role}</Badge></div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <Badge tone={u.isActive !== false ? 'emerald' : 'slate'} dot>{u.isActive !== false ? 'Actief' : 'Gepauzeerd'}</Badge>
                  {pushUserIds.has(String(u.id))
                    ? <Badge tone="emerald" icon={<Bell size={11} />}>Meldingen aan</Badge>
                    : <Badge tone="slate" icon={<BellOff size={11} />}>Meldingen uit</Badge>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="p-3 bg-slate-50 rounded-2xl"><MicroLabel>Laatst Actief</MicroLabel><p className="mt-1 text-[13px] font-semibold text-slate-700 tabular-nums">{u.lastLogin ? formatDateTimeHuman(u.lastLogin) : 'Nooit'}</p></div>
                <div className="p-3 bg-slate-50 rounded-2xl"><MicroLabel>Sessies</MicroLabel><p className="mt-1 text-[13px] font-semibold text-slate-700 tabular-nums">{u.activeSessions || 0}</p></div>
              </div>
              <div className="flex gap-2 pt-1">
                <Button variant="secondary" className="flex-1" onClick={() => setEditingUser(u)}>Bewerken</Button>
                <Button variant="ghost" className="px-3" onClick={() => setViewingHistoryUser(u)} aria-label="Verlof- en dienstruil-historiek" title="Verlof- en dienstruil-historiek" icon={<Info size={18} />} />
                <Button variant="ghost" className="px-3" onClick={() => setDocumentsUser(u)} aria-label="Documenten beheren" title="Documenten beheren" icon={<FolderOpen size={18} />} />
                <Button variant="ghost" className="px-3" onClick={() => setViewingChangeLogUser(u)} aria-label="Wijzigingsgeschiedenis" title="Wijzigingsgeschiedenis" icon={<History size={18} />} />
                <Button variant="danger" className="px-3" onClick={() => !isProtectedAdmin(u) && setConfirmDeleteId(u.id)} disabled={isProtectedAdmin(u)} aria-label={isProtectedAdmin(u) ? 'Laatste actieve admin kan niet verwijderd worden' : 'Verwijder gebruiker'} title={isProtectedAdmin(u) ? 'Laatste actieve admin kan niet verwijderd worden' : 'Verwijder gebruiker'} icon={<Trash2 size={18} />} />
                <Button variant="ghost" className="px-3" onClick={() => setConfirmResetUser(u)} aria-label="Stel nieuw tijdelijk wachtwoord in" title="Stel nieuw tijdelijk wachtwoord in" icon={<RotateCcw size={18} />} />
              </div>
            </div>
          ))}
        </div>
        {filteredUsers.length === 0 && <div className="p-6"><EmptyState mascotte={false} icon={<Users size={28} />} title="Geen gebruikers gevonden" message="Pas je filter aan of voeg een nieuwe gebruiker toe." /></div>}
      </TableShell>

      <ConfirmationModal isOpen={!!confirmDeleteId} onClose={() => setConfirmDeleteId(null)} onConfirm={handleDeleteUser} title="Gebruiker verwijderen" message="Weet je zeker dat je deze gebruiker wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt." />
      <ConfirmationModal isOpen={confirmBulkDelete} onClose={() => setConfirmBulkDelete(false)} onConfirm={handleBulkDelete} title="Gebruikers verwijderen" message={`Weet je zeker dat je ${selectedIds.size} geselecteerde gebruiker(s) wilt verwijderen? Beschermde accounts (jezelf, de laatste actieve admin) worden overgeslagen. Dit kan niet ongedaan worden gemaakt.`} confirmText="Verwijderen" variant="warning" />
      <ConfirmationModal isOpen={!!pendingImportUsers} onClose={() => { setPendingImportUsers(null); setPendingImportMessage(''); }} onConfirm={handleConfirmImport} title="Gebruikers importeren" message={pendingImportMessage || 'Wil je deze import toepassen?'} confirmText="Importeren" variant="warning" />

      <Modal open={showAddModal} onClose={() => setShowAddModal(false)}>
        <div className="p-6 border-b border-white/70">
          <h4 className="text-xl font-bold tracking-tight">Nieuwe Gebruiker</h4>
          <p className="mt-1 text-sm text-slate-500">Voeg handmatig een medewerker toe.</p>
        </div>
        <form onSubmit={handleAddUser} className="p-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2"><MicroLabel>Volledige Naam</MicroLabel><input type="text" autoComplete="name" required aria-label="Volledige naam" value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" placeholder="bijv. Jan Janssen" /></div>
            <div className="space-y-1.5"><MicroLabel>Rol</MicroLabel><select aria-label="Rol" value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all bg-white/60 text-sm font-medium"><option value="chauffeur">Chauffeur</option><option value="planner">Planner</option><option value="admin">Admin</option></select></div>
            <div className="space-y-1.5"><MicroLabel>Personeelsnummer</MicroLabel><input type="text" autoComplete="off" aria-label="Personeelsnummer" value={newUser.employeeId} onChange={(e) => setNewUser({ ...newUser, employeeId: e.target.value })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" placeholder="Optioneel" /></div>
            <div className="space-y-1.5 sm:col-span-2"><MicroLabel>E-mailadres</MicroLabel><input type="email" autoComplete="email" inputMode="email" required aria-label="E-mailadres" value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" placeholder="bijv. jan@voorbeeld.be" /></div>
            <div className="space-y-1.5"><MicroLabel>Tijdelijk Wachtwoord</MicroLabel><input type="password" autoComplete="new-password" aria-label="Tijdelijk wachtwoord" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" placeholder="Minstens 6 tekens" /></div>
            <div className="space-y-1.5"><MicroLabel>GSM Nummer</MicroLabel><input type="tel" autoComplete="tel" inputMode="tel" aria-label="GSM-nummer" value={newUser.phone} onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" placeholder="Optioneel" /></div>
          </div>
          <div className="flex gap-3 pt-2">
            <Button variant="ghost" className="flex-1" onClick={() => setShowAddModal(false)}>Annuleren</Button>
            <Button type="submit" variant="primary" className="flex-1" disabled={isSubmittingUser}>{isSubmittingUser ? 'Bezig…' : 'Toevoegen'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!editingUser} onClose={() => setEditingUser(null)} maxWidth="lg">
        {editingUser && (
          <>
            <div className="p-6 border-b border-white/70 flex justify-between items-center">
              <div><h4 className="text-xl font-bold tracking-tight">Gebruiker Bewerken</h4><p className="text-sm text-slate-500">Pas de gegevens van {editingUser.name} aan.</p></div>
              <Button variant="danger" size="sm" className="px-2" onClick={() => !isProtectedAdmin(editingUser) && setConfirmDeleteId(editingUser.id)} disabled={isProtectedAdmin(editingUser)} aria-label={isProtectedAdmin(editingUser) ? 'Laatste actieve admin kan niet verwijderd worden' : 'Verwijder gebruiker'} title={isProtectedAdmin(editingUser) ? 'Laatste actieve admin kan niet verwijderd worden' : 'Verwijder gebruiker'} icon={<Trash2 size={16} />} />
            </div>
            <form onSubmit={handleUpdateUser} className="p-6 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2"><MicroLabel>Volledige Naam</MicroLabel><input type="text" autoComplete="name" required aria-label="Volledige naam" value={editingUser.name} onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" /></div>
                <div className="space-y-1.5"><MicroLabel>Rol</MicroLabel><select aria-label="Rol" value={editingUser.role} onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value as any })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all bg-white/60 text-sm font-medium"><option value="chauffeur">Chauffeur</option><option value="planner">Planner</option><option value="admin">Admin</option></select></div>
                <div className="space-y-1.5"><MicroLabel>Personeelsnummer</MicroLabel><input type="text" autoComplete="off" aria-label="Personeelsnummer" value={editingUser.employeeId} onChange={(e) => setEditingUser({ ...editingUser, employeeId: e.target.value })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" /></div>
                <div className="space-y-1.5 sm:col-span-2"><MicroLabel>E-mailadres</MicroLabel><input type="email" autoComplete="email" inputMode="email" aria-label="E-mailadres" value={editingUser.email || ''} onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" placeholder="bijv. jan@voorbeeld.be" /></div>
                <div className="space-y-1.5"><MicroLabel>Nieuw Wachtwoord</MicroLabel><input type="password" autoComplete="new-password" aria-label="Nieuw wachtwoord" value={editingUser.password || ''} onChange={(e) => setEditingUser({ ...editingUser, password: e.target.value })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" placeholder="Optioneel" /></div>
                <div className="space-y-1.5"><MicroLabel>GSM Nummer</MicroLabel><input type="tel" autoComplete="tel" inputMode="tel" aria-label="GSM-nummer" value={editingUser.phone || ''} onChange={(e) => setEditingUser({ ...editingUser, phone: e.target.value })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" placeholder="Optioneel" /></div>
                {editingUser.role === 'chauffeur' && (
                  <div className="space-y-1.5"><MicroLabel>Sectie (Maandplanning)</MicroLabel><select aria-label="Sectie" value={editingUser.section || ''} onChange={(e) => setEditingUser({ ...editingUser, section: e.target.value || undefined })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all bg-white/60 text-sm font-medium"><option value="">Geen sectie</option><option value="Reguliere">Reguliere</option><option value="Nacht">Nacht</option><option value="Flexi">Flexi</option><option value="Schoolvervoer">Schoolvervoer</option></select></div>
                )}
                <div className="space-y-1.5"><MicroLabel>In dienst sinds</MicroLabel><input type="date" aria-label="In dienst sinds" value={editingUser.startDate || ''} onChange={(e) => setEditingUser({ ...editingUser, startDate: e.target.value || undefined })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" /><p className="text-[11px] text-slate-400 font-medium px-1">Bepaalt de anciënniteit-volgorde binnen een sectie in de Maandplanning.</p></div>
                <div className="space-y-1.5 sm:col-span-2">
                  <MicroLabel>Verlofbudget (dagen)</MicroLabel>
                  <input
                    type="number"
                    min={0}
                    aria-label="Verlofbudget" value={editingUser.verlofBudget ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      setEditingUser({ ...editingUser, verlofBudget: v === '' ? undefined : Math.max(0, parseInt(v, 10) || 0) });
                    }}
                    className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium"
                    placeholder="Leeg = standaard (24 dagen)"
                  />
                  <p className="text-[11px] text-slate-400 font-medium px-1">Vul in om af te wijken van de standaard 24 dagen (bv. anciënniteits-toeslag, deeltijds).</p>
                </div>
                {editingUser.role === 'chauffeur' && (
                  <div className="space-y-1.5 sm:col-span-2">
                    <MicroLabel>Documenten geldig tot</MicroLabel>
                    <div className="grid gap-3 sm:grid-cols-3">
                      {Object.entries(EXPIRY_SOORT_LABELS).map(([soort, label]) => (
                        <div key={soort} className="space-y-1">
                          <p className="px-1 text-[11px] font-medium text-slate-500">{label}</p>
                          <input
                            type="date"
                            aria-label={`${label} geldig tot`}
                            value={vervalDraft[soort] ?? ''}
                            onChange={(e) => setVervalDraft((d) => ({ ...d, [soort]: e.target.value }))}
                            className="control-input w-full px-3 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium"
                          />
                        </div>
                      ))}
                    </div>
                    <p className="text-[11px] text-slate-400 font-medium px-1">Het portaal verwittigt de chauffeur en de planning automatisch op 90, 30 en 7 dagen voor de vervaldatum. Leeg = niet bewaken.</p>
                  </div>
                )}
              </div>
              <div className="flex items-center justify-between p-4 surface-muted rounded-2xl">
                <div><p className="text-sm font-semibold text-slate-700">Account Actief</p><p className="text-[11px] text-slate-400">Inactieve gebruikers kunnen niet inloggen.</p></div>
                <button type="button" onClick={() => setEditingUser({ ...editingUser, isActive: editingUser.isActive === false ? true : false })} className={cn('w-12 h-6 rounded-full transition-all relative', editingUser.isActive !== false ? 'bg-emerald-500' : 'bg-slate-300')}><div className={cn('absolute top-1 w-4 h-4 bg-white rounded-full transition-all', editingUser.isActive !== false ? 'left-7' : 'left-1')} /></button>
              </div>
              <div className="flex items-center justify-between p-4 surface-muted rounded-2xl">
                <div><p className="text-sm font-semibold text-slate-700">Tonen in contactlijst</p><p className="text-[11px] text-slate-400">Uit = deze persoon staat niet in de contactlijst voor collega's.</p></div>
                <button type="button" onClick={() => setEditingUser({ ...editingUser, showInContacts: editingUser.showInContacts === false ? true : false })} className={cn('w-12 h-6 rounded-full transition-all relative', editingUser.showInContacts !== false ? 'bg-emerald-500' : 'bg-slate-300')}><div className={cn('absolute top-1 w-4 h-4 bg-white rounded-full transition-all', editingUser.showInContacts !== false ? 'left-7' : 'left-1')} /></button>
              </div>
              {editingUser.role === 'admin' && (
                <div className="flex items-center justify-between p-4 surface-muted rounded-2xl">
                  <div><p className="text-sm font-semibold text-slate-700">Systeemmails</p><p className="text-[11px] text-slate-400">Foutendigest en back-up-mails van het portaal. Uit = deze admin ontvangt ze niet.</p></div>
                  <button type="button" onClick={() => setEditingUser({ ...editingUser, wantsSystemMail: editingUser.wantsSystemMail === false ? true : false })} className={cn('w-12 h-6 rounded-full transition-all relative', editingUser.wantsSystemMail !== false ? 'bg-emerald-500' : 'bg-slate-300')}><div className={cn('absolute top-1 w-4 h-4 bg-white rounded-full transition-all', editingUser.wantsSystemMail !== false ? 'left-7' : 'left-1')} /></button>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4"><div className="p-3 surface-muted rounded-xl"><MicroLabel>Laatst Ingelogd</MicroLabel><p className="text-[13px] font-semibold text-slate-700 tabular-nums mt-1">{editingUser.lastLogin ? formatDateTimeHuman(editingUser.lastLogin) : 'Nooit'}</p></div><div className="p-3 surface-muted rounded-xl"><MicroLabel>Actieve Sessies</MicroLabel><p className="text-[13px] font-semibold text-slate-700 tabular-nums mt-1">{editingUser.activeSessions || 0}</p></div></div>
              <div className="flex gap-3 pt-2"><Button variant="ghost" className="flex-1" onClick={() => setEditingUser(null)}>Annuleren</Button><Button type="submit" variant="primary" className="flex-1" disabled={isSubmittingUser}>{isSubmittingUser ? 'Bezig…' : 'Opslaan'}</Button></div>
            </form>
          </>
        )}
      </Modal>

      <Modal open={!!confirmResetUser} onClose={() => { setConfirmResetUser(null); setResetPasswordValue(''); }}>
        {confirmResetUser && (
          <>
            <div className="p-6 border-b border-white/70"><h4 className="text-xl font-bold tracking-tight">Wachtwoord resetten</h4><p className="mt-1 text-sm text-slate-500">Stel een nieuw tijdelijk wachtwoord in voor {confirmResetUser.name}.</p></div>
            <div className="p-6 space-y-4">
              <div className="space-y-1.5"><MicroLabel>Tijdelijk wachtwoord</MicroLabel><input type="password" aria-label="Tijdelijk wachtwoord" value={resetPasswordValue} onChange={(e) => setResetPasswordValue(e.target.value)} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" placeholder="Minstens 6 tekens" autoFocus /></div>
              <p className="text-xs text-slate-400">De gebruiker logt daarna in met dit nieuwe wachtwoord.</p>
              <div className="flex gap-3 pt-2"><Button variant="ghost" className="flex-1" onClick={() => { setConfirmResetUser(null); setResetPasswordValue(''); }}>Annuleren</Button><Button variant="primary" className="flex-1" onClick={handleResetPassword} disabled={isResettingPassword}>{isResettingPassword ? 'Bezig…' : 'Resetten'}</Button></div>
            </div>
          </>
        )}
      </Modal>

      <CredentialsModal
        isOpen={!!credentialsModal}
        onClose={() => setCredentialsModal(null)}
        title={credentialsModal?.title || 'Toegangsgegevens'}
        email={credentialsModal?.email || ''}
        password={credentialsModal?.password || ''}
      />

      <UserHistoryModal
        user={viewingHistoryUser}
        shifts={shifts}
        leaveRequests={leaveRequests}
        swaps={swaps}
        users={users}
        onClose={() => setViewingHistoryUser(null)}
      />

      {documentsUser && <UserDocumentsModal user={documentsUser} onClose={() => setDocumentsUser(null)} />}
      {showBroadcast && <BroadcastDocumentModal onClose={() => setShowBroadcast(false)} />}

      <EntityHistoryModal
        open={!!viewingChangeLogUser}
        onClose={() => setViewingChangeLogUser(null)}
        entityType="user"
        entityId={viewingChangeLogUser?.id ?? ''}
        title={viewingChangeLogUser ? `${viewingChangeLogUser.name} (${viewingChangeLogUser.role})` : undefined}
      />
    </PageShell>
  );
}

/** Menu-item voor het ⋯-overflowmenu per gebruikersrij. */
function RowMenuItem({ icon, label, onClick, disabled = false, tone = 'default' }: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  tone?: 'default' | 'danger';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-[13px] font-semibold transition-colors min-h-11',
        tone === 'danger'
          ? 'text-red-600 hover:bg-red-50'
          : 'text-slate-700 hover:bg-slate-100/70 dark:text-slate-200 dark:hover:bg-white/5',
        disabled && 'opacity-40 cursor-not-allowed hover:bg-transparent',
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}
