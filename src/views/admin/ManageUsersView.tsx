import React, { useState } from 'react';
import { History, Info, Plus, RotateCcw, Trash2, Upload, Users } from 'lucide-react';
import type { LeaveRequest, Shift, SwapRequest, User } from '../../types';
import { cn, getSupabaseAuthHeaders, notify } from '../../lib/ui';
import { AdminSubsectionHeader, ConfirmationModal, CredentialsModal, EmptyState, PageHeader, PageShell } from '../../components/ui';
import { Badge, Button, MicroLabel, TableShell, Td, Th } from '../../components/primitives';
import { Modal } from '../../components/Modal';
import { UserHistoryModal } from './UserHistoryModal';
import { EntityHistoryModal } from '../../components/EntityHistoryModal';

export type UserDraft = User & { password?: string };

/** Rol → badge-tint (presentatie, geen logica). */
const ROLE_BADGE_TONE = { admin: 'oker', planner: 'blue', chauffeur: 'slate' } as const;

export function ManageUsersView({ users, onSave, title = 'Gebruikersbeheer', currentUser, shifts = [], leaveRequests = [], swaps = [] }: { users: User[]; onSave: (u: UserDraft[]) => Promise<boolean>; title?: string; currentUser: User; shifts?: Shift[]; leaveRequests?: LeaveRequest[]; swaps?: SwapRequest[] }) {
  const [isImporting, setIsImporting] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserDraft | null>(null);
  const [viewingHistoryUser, setViewingHistoryUser] = useState<User | null>(null);
  const [viewingChangeLogUser, setViewingChangeLogUser] = useState<User | null>(null);
  const [newUser, setNewUser] = useState({ name: '', role: 'chauffeur', employeeId: '', password: '', phone: '', email: '' });
  const [roleFilter, setRoleFilter] = useState<'all' | 'chauffeur' | 'planner' | 'admin'>('all');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmResetUser, setConfirmResetUser] = useState<User | null>(null);
  const [resetPasswordValue, setResetPasswordValue] = useState('');
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [pendingImportUsers, setPendingImportUsers] = useState<UserDraft[] | null>(null);
  const [pendingImportMessage, setPendingImportMessage] = useState('');
  const [credentialsModal, setCredentialsModal] = useState<{ title: string; email: string; password: string } | null>(null);

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
    .sort((a, b) => a.name.localeCompare(b.name));

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUser.name) return;
    if (!newUser.email) return notify('Een e-mailadres is verplicht voor Supabase login.', 'error');
    if (newUser.password.length < 6) return notify('Gebruik een tijdelijk wachtwoord van minstens 6 tekens.', 'error');

    const userToAdd: UserDraft = {
      id: Date.now().toString(),
      name: newUser.name,
      role: newUser.role as any,
      employeeId: newUser.employeeId || `VHB-${Math.floor(1000 + Math.random() * 9000)}`,
      password: newUser.password,
      phone: newUser.phone,
      email: newUser.email,
      isActive: true,
    };

    const success = await onSave([...users, userToAdd]);
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
    if (!editingUser) return;
    if (!editingUser.email) return notify('Een e-mailadres is verplicht voor Supabase login.', 'error');
    if (editingUser.password && editingUser.password.length < 6) return notify('Een nieuw wachtwoord moet minstens 6 tekens hebben.', 'error');

    const originalUser = users.find((u) => u.id === editingUser.id);
    const isOnlyActiveAdmin = originalUser?.role === 'admin' && originalUser.isActive !== false && activeAdmins.length === 1;
    const adminWouldBeRemoved = editingUser.role !== 'admin' || editingUser.isActive === false;
    if (isOnlyActiveAdmin && adminWouldBeRemoved) return notify('Je kunt de laatste actieve admin niet degraderen of deactiveren.', 'error');

    const success = await onSave(users.map((u) => (u.id === editingUser.id ? editingUser : u)));
    if (!success) return;
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
        const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
        if (!Array.isArray(jsonData) || jsonData.length === 0) return notify('Het Excel-bestand lijkt leeg te zijn of heeft geen herkenbare gegevens.', 'error');

        const keys = Object.keys(jsonData[0] as any);
        const importedUsers: UserDraft[] = jsonData
          .map((row: any, index) => {
            const rowKeys = Object.keys(row);
            const findValue = (patterns: string[]) => {
              const foundKey = rowKeys.find((k) => patterns.some((p) => k.toString().trim().toLowerCase().includes(p)));
              return foundKey ? row[foundKey] : undefined;
            };
            const rawRole = (findValue(['rol', 'role', 'functie', 'type']) || 'chauffeur').toString().toLowerCase();
            let role: 'admin' | 'planner' | 'chauffeur' = 'chauffeur';
            if (rawRole.includes('admin') || rawRole.includes('beheer')) role = 'admin';
            else if (rawRole.includes('plan') || rawRole.includes('dispo')) role = 'planner';

            const generatedId = (Date.now() + index).toString();
            return {
              id: generatedId,
              name: findValue(['naam', 'name', 'voornaam', 'achternaam', 'medewerker', 'chauffeur', 'gebruiker', 'user'])?.toString().trim() || '',
              role,
              employeeId: findValue(['id', 'employee', 'personeel', 'nummer', 'code', 'nr'])?.toString().trim() || `VHB-${generatedId.slice(-4)}`,
              password: findValue(['wachtwoord', 'password', 'pass', 'wacht', 'pw'])?.toString() || '',
              phone: findValue(['gsm', 'telefoon', 'phone', 'mobiel', 'gsm-nummer', 'tel'])?.toString().trim() || undefined,
              email: findValue(['email', 'mail', 'e-mail', 'adres'])?.toString().trim() || undefined,
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
            newUsersList[existingIdx] = { ...newUsersList[existingIdx], phone: impUser.phone || newUsersList[existingIdx].phone, email: impUser.email || newUsersList[existingIdx].email, role: impUser.role || newUsersList[existingIdx].role, employeeId: impUser.employeeId || newUsersList[existingIdx].employeeId, password: impUser.password || newUsersList[existingIdx].password };
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
        description="Beheer medewerkers, rollen en accountacties vanuit een consistente beheershell. Gebruik Excel-import alleen wanneer de brongegevens al gevalideerd zijn."
        actions={(
          <>
            <label className={cn('control-button-soft ios-pressable inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold text-slate-700 transition-all hover:text-slate-900', isImporting && 'cursor-not-allowed opacity-50')}>
              <Upload size={16} />
              {isImporting ? 'Bezig...' : 'Excel Upload'}
              <input type="file" accept=".xlsx, .xls" className="hidden" onChange={handleFileUpload} disabled={isImporting} />
            </label>
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
            aside={<Badge tone="slate">{filteredUsers.length} zichtbaar</Badge>}
          />
          <div className="mt-5 glass-segmented inline-flex rounded-2xl p-1">
            {(['all', 'chauffeur', 'planner', 'admin'] as const).map((role) => (
              <button key={role} onClick={() => setRoleFilter(role)} className={cn('px-3.5 py-2 rounded-xl text-xs font-semibold capitalize transition-all', roleFilter === role ? 'glass-chip text-oker-600 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
                {role === 'all' ? 'Alles' : role}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-oker-100 bg-oker-50/80 p-5 text-sm">
          <MicroLabel className="text-oker-700">Bronimport</MicroLabel>
          <p className="mt-3 font-bold tracking-tight text-oker-800">Excel Instructies</p>
          <p className="mt-2 text-[13px] text-oker-700">Gebruik bij voorkeur de kolommen <span className="font-mono font-semibold">Naam, E-mail, Rol</span>. Voor nieuwe accounts kun je optioneel ook <span className="font-mono font-semibold">Wachtwoord</span> toevoegen zodat Supabase meteen een login kan aanmaken.</p>
        </div>
      </div>

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
                <Th>Medewerker</Th>
                <Th>Status</Th>
                <Th>Laatst Actief</Th>
                <Th className="text-center">Sessies</Th>
                <Th className="text-right">Acties</Th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.map((u) => (
                <tr key={u.id} className="group transition-colors hover:bg-slate-50/60">
                  <Td>
                    <div className="font-bold tracking-tight text-slate-800">{u.name}</div>
                    <div className="mt-1"><Badge tone={ROLE_BADGE_TONE[u.role]} className="capitalize">{u.role}</Badge></div>
                  </Td>
                  <Td><Badge tone={u.isActive !== false ? 'emerald' : 'slate'} dot>{u.isActive !== false ? 'Actief' : 'Inactief'}</Badge></Td>
                  <Td className="tabular-nums">{u.lastLogin ? u.lastLogin : <span className="italic text-slate-400">Nooit</span>}</Td>
                  <Td className="text-center"><span className={cn('inline-flex h-7 w-7 items-center justify-center rounded-lg border text-xs font-semibold tabular-nums', (u.activeSessions || 0) > 0 ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-slate-100 bg-slate-50 text-slate-400')}>{u.activeSessions || 0}</span></Td>
                  <Td className="text-right">
                    <div className="flex items-center justify-end gap-1.5 opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 transition-opacity">
                      <Button variant="ghost" size="sm" className="px-2" onClick={() => setViewingHistoryUser(u)} aria-label="Verlof- en dienstruil-historiek" title="Verlof- en dienstruil-historiek" icon={<Info size={16} />} />
                      <Button variant="ghost" size="sm" className="px-2" onClick={() => setViewingChangeLogUser(u)} aria-label="Wijzigingsgeschiedenis (rol, naam, etc.)" title="Wijzigingsgeschiedenis (rol, naam, etc.)" icon={<History size={16} />} />
                      <Button variant="ghost" size="sm" className="px-2" onClick={() => setConfirmResetUser(u)} aria-label="Stel nieuw tijdelijk wachtwoord in" title="Stel nieuw tijdelijk wachtwoord in" icon={<RotateCcw size={16} />} />
                      <Button variant="secondary" size="sm" onClick={() => setEditingUser(u)}>Bewerken</Button>
                      <Button variant="danger" size="sm" className="px-2" onClick={() => !isProtectedAdmin(u) && setConfirmDeleteId(u.id)} disabled={isProtectedAdmin(u)} aria-label={isProtectedAdmin(u) ? 'Laatste actieve admin kan niet verwijderd worden' : 'Verwijder gebruiker'} title={isProtectedAdmin(u) ? 'Laatste actieve admin kan niet verwijderd worden' : 'Verwijder gebruiker'} icon={<Trash2 size={16} />} />
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
                <div>
                  <div className="font-bold tracking-tight text-slate-800 leading-tight">{u.name}</div>
                  <div className="mt-1.5"><Badge tone={ROLE_BADGE_TONE[u.role]} className="capitalize">{u.role}</Badge></div>
                </div>
                <Badge tone={u.isActive !== false ? 'emerald' : 'slate'} dot>{u.isActive !== false ? 'Actief' : 'Inactief'}</Badge>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="p-3 bg-slate-50 rounded-2xl"><MicroLabel>Laatst Actief</MicroLabel><p className="mt-1 text-[13px] font-semibold text-slate-700 tabular-nums">{u.lastLogin || 'Nooit'}</p></div>
                <div className="p-3 bg-slate-50 rounded-2xl"><MicroLabel>Sessies</MicroLabel><p className="mt-1 text-[13px] font-semibold text-slate-700 tabular-nums">{u.activeSessions || 0}</p></div>
              </div>
              <div className="flex gap-2 pt-1">
                <Button variant="secondary" className="flex-1" onClick={() => setEditingUser(u)}>Bewerken</Button>
                <Button variant="ghost" className="px-3" onClick={() => setViewingHistoryUser(u)} aria-label="Verlof- en dienstruil-historiek" title="Verlof- en dienstruil-historiek" icon={<Info size={18} />} />
                <Button variant="ghost" className="px-3" onClick={() => setViewingChangeLogUser(u)} aria-label="Wijzigingsgeschiedenis" title="Wijzigingsgeschiedenis" icon={<History size={18} />} />
                <Button variant="danger" className="px-3" onClick={() => !isProtectedAdmin(u) && setConfirmDeleteId(u.id)} disabled={isProtectedAdmin(u)} aria-label={isProtectedAdmin(u) ? 'Laatste actieve admin kan niet verwijderd worden' : 'Verwijder gebruiker'} title={isProtectedAdmin(u) ? 'Laatste actieve admin kan niet verwijderd worden' : 'Verwijder gebruiker'} icon={<Trash2 size={18} />} />
                <Button variant="ghost" className="px-3" onClick={() => setConfirmResetUser(u)} aria-label="Stel nieuw tijdelijk wachtwoord in" title="Stel nieuw tijdelijk wachtwoord in" icon={<RotateCcw size={18} />} />
              </div>
            </div>
          ))}
        </div>
        {filteredUsers.length === 0 && <div className="p-6"><EmptyState icon={<Users size={28} />} title="Geen gebruikers gevonden" message="Pas je filter aan of voeg een nieuwe gebruiker toe." /></div>}
      </TableShell>

      <ConfirmationModal isOpen={!!confirmDeleteId} onClose={() => setConfirmDeleteId(null)} onConfirm={handleDeleteUser} title="Gebruiker Verwijderen" message="Weet je zeker dat je deze gebruiker wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt." />
      <ConfirmationModal isOpen={!!pendingImportUsers} onClose={() => { setPendingImportUsers(null); setPendingImportMessage(''); }} onConfirm={handleConfirmImport} title="Gebruikers importeren" message={pendingImportMessage || 'Wil je deze import toepassen?'} confirmText="Importeren" variant="warning" />

      <Modal open={showAddModal} onClose={() => setShowAddModal(false)}>
        <div className="p-6 border-b border-white/70">
          <h4 className="text-xl font-bold tracking-tight">Nieuwe Gebruiker</h4>
          <p className="mt-1 text-sm text-slate-500">Voeg handmatig een medewerker toe.</p>
        </div>
        <form onSubmit={handleAddUser} className="p-6 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2"><MicroLabel>Volledige Naam</MicroLabel><input type="text" autoComplete="name" required value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" placeholder="bijv. Jan Janssen" /></div>
            <div className="space-y-1.5"><MicroLabel>Rol</MicroLabel><select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all bg-white/60 text-sm font-medium"><option value="chauffeur">Chauffeur</option><option value="planner">Planner</option><option value="admin">Admin</option></select></div>
            <div className="space-y-1.5"><MicroLabel>Personeelsnummer</MicroLabel><input type="text" autoComplete="off" value={newUser.employeeId} onChange={(e) => setNewUser({ ...newUser, employeeId: e.target.value })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" placeholder="Optioneel" /></div>
            <div className="space-y-1.5 sm:col-span-2"><MicroLabel>E-mailadres</MicroLabel><input type="email" autoComplete="email" inputMode="email" required value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" placeholder="bijv. jan@voorbeeld.be" /></div>
            <div className="space-y-1.5"><MicroLabel>Tijdelijk Wachtwoord</MicroLabel><input type="password" autoComplete="new-password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" placeholder="Minstens 6 tekens" /></div>
            <div className="space-y-1.5"><MicroLabel>GSM Nummer</MicroLabel><input type="tel" autoComplete="tel" inputMode="tel" value={newUser.phone} onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" placeholder="Optioneel" /></div>
          </div>
          <div className="flex gap-3 pt-2">
            <Button variant="ghost" className="flex-1" onClick={() => setShowAddModal(false)}>Annuleren</Button>
            <Button type="submit" variant="primary" className="flex-1">Toevoegen</Button>
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
                <div className="space-y-1.5 sm:col-span-2"><MicroLabel>Volledige Naam</MicroLabel><input type="text" autoComplete="name" required value={editingUser.name} onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" /></div>
                <div className="space-y-1.5"><MicroLabel>Rol</MicroLabel><select value={editingUser.role} onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value as any })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all bg-white/60 text-sm font-medium"><option value="chauffeur">Chauffeur</option><option value="planner">Planner</option><option value="admin">Admin</option></select></div>
                <div className="space-y-1.5"><MicroLabel>Personeelsnummer</MicroLabel><input type="text" autoComplete="off" value={editingUser.employeeId} onChange={(e) => setEditingUser({ ...editingUser, employeeId: e.target.value })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" /></div>
                <div className="space-y-1.5 sm:col-span-2"><MicroLabel>E-mailadres</MicroLabel><input type="email" autoComplete="email" inputMode="email" value={editingUser.email || ''} onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" placeholder="bijv. jan@voorbeeld.be" /></div>
                <div className="space-y-1.5"><MicroLabel>Nieuw Wachtwoord</MicroLabel><input type="password" autoComplete="new-password" value={editingUser.password || ''} onChange={(e) => setEditingUser({ ...editingUser, password: e.target.value })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" placeholder="Optioneel" /></div>
                <div className="space-y-1.5"><MicroLabel>GSM Nummer</MicroLabel><input type="tel" autoComplete="tel" inputMode="tel" value={editingUser.phone || ''} onChange={(e) => setEditingUser({ ...editingUser, phone: e.target.value })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" placeholder="Optioneel" /></div>
                <div className="space-y-1.5 sm:col-span-2">
                  <MicroLabel>Verlofbudget (dagen)</MicroLabel>
                  <input
                    type="number"
                    min={0}
                    value={editingUser.verlofBudget ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      setEditingUser({ ...editingUser, verlofBudget: v === '' ? undefined : Math.max(0, parseInt(v, 10) || 0) });
                    }}
                    className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium"
                    placeholder="Leeg = standaard (24 dagen)"
                  />
                  <p className="text-[10px] text-slate-400 font-medium px-1">Vul in om af te wijken van de standaard 24 dagen (bv. anciënniteits-toeslag, deeltijds).</p>
                </div>
              </div>
              <div className="flex items-center justify-between p-4 surface-muted rounded-2xl">
                <div><p className="text-sm font-semibold text-slate-700">Account Actief</p><p className="text-[11px] text-slate-400">Inactieve gebruikers kunnen niet inloggen.</p></div>
                <button type="button" onClick={() => setEditingUser({ ...editingUser, isActive: editingUser.isActive === false ? true : false })} className={cn('w-12 h-6 rounded-full transition-all relative', editingUser.isActive !== false ? 'bg-emerald-500' : 'bg-slate-300')}><div className={cn('absolute top-1 w-4 h-4 bg-white rounded-full transition-all', editingUser.isActive !== false ? 'left-7' : 'left-1')} /></button>
              </div>
              <div className="grid grid-cols-2 gap-4"><div className="p-3 surface-muted rounded-xl"><MicroLabel>Laatst Ingelogd</MicroLabel><p className="text-[13px] font-semibold text-slate-700 tabular-nums mt-1">{editingUser.lastLogin || 'Nooit'}</p></div><div className="p-3 surface-muted rounded-xl"><MicroLabel>Actieve Sessies</MicroLabel><p className="text-[13px] font-semibold text-slate-700 tabular-nums mt-1">{editingUser.activeSessions || 0}</p></div></div>
              <div className="flex gap-3 pt-2"><Button variant="ghost" className="flex-1" onClick={() => setEditingUser(null)}>Annuleren</Button><Button type="submit" variant="primary" className="flex-1">Opslaan</Button></div>
            </form>
          </>
        )}
      </Modal>

      <Modal open={!!confirmResetUser} onClose={() => { setConfirmResetUser(null); setResetPasswordValue(''); }}>
        {confirmResetUser && (
          <>
            <div className="p-6 border-b border-white/70"><h4 className="text-xl font-bold tracking-tight">Wachtwoord resetten</h4><p className="mt-1 text-sm text-slate-500">Stel een nieuw tijdelijk wachtwoord in voor {confirmResetUser.name}.</p></div>
            <div className="p-6 space-y-4">
              <div className="space-y-1.5"><MicroLabel>Tijdelijk wachtwoord</MicroLabel><input type="password" value={resetPasswordValue} onChange={(e) => setResetPasswordValue(e.target.value)} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" placeholder="Minstens 6 tekens" autoFocus /></div>
              <p className="text-xs text-slate-400">De gebruiker logt daarna in met dit nieuwe wachtwoord.</p>
              <div className="flex gap-3 pt-2"><Button variant="ghost" className="flex-1" onClick={() => { setConfirmResetUser(null); setResetPasswordValue(''); }}>Annuleren</Button><Button variant="primary" className="flex-1" onClick={handleResetPassword} disabled={isResettingPassword}>{isResettingPassword ? 'Bezig...' : 'Resetten'}</Button></div>
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
