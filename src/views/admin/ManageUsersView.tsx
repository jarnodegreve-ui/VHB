import React, { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Plus, RotateCcw, Trash2, Upload, Users, X } from 'lucide-react';
import type { User } from '../../types';
import { cn, getSupabaseAuthHeaders, notify } from '../../lib/ui';
import { AdminSubsectionHeader, ConfirmationModal, CredentialsModal, EmptyState, PageHeader, PageShell } from '../../components/ui';

export type UserDraft = User & { password?: string };

export function ManageUsersView({ users, onSave, title = 'Gebruikersbeheer', currentUser }: { users: User[]; onSave: (u: UserDraft[]) => Promise<boolean>; title?: string; currentUser: User }) {
  const [isImporting, setIsImporting] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserDraft | null>(null);
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
            <label className="btn-primary ios-pressable px-4 py-3 text-xs uppercase tracking-widest flex items-center gap-2 cursor-pointer">
              <Upload size={18} />
              {isImporting ? 'Bezig...' : 'Excel Upload'}
              <input type="file" accept=".xlsx, .xls" className="hidden" onChange={handleFileUpload} disabled={isImporting} />
            </label>
            <button onClick={() => setShowAddModal(true)} className="bg-slate-900 text-white px-4 py-3 rounded-2xl text-xs font-black uppercase tracking-widest flex items-center gap-2 hover:bg-slate-800 transition-colors">
              <Plus size={18} /> Gebruiker Toevoegen
            </button>
          </>
        )}
      />

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.9fr]">
        <div className="surface-card rounded-[32px] p-6">
          <AdminSubsectionHeader
            eyebrow="Werkset"
            title="Zichtbare gebruikers"
            description="Filter de huidige lijst per rol voordat je wijzigingen doorvoert."
            aside={<div className="rounded-full border border-white/70 bg-white/55 px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-slate-400">{filteredUsers.length} zichtbaar</div>}
          />
          <div className="mt-5 glass-segmented inline-flex rounded-2xl p-1">
            {(['all', 'chauffeur', 'planner', 'admin'] as const).map((role) => (
              <button key={role} onClick={() => setRoleFilter(role)} className={cn('px-4 py-2 rounded-[18px] text-xs font-black uppercase tracking-[0.16em] transition-all', roleFilter === role ? 'glass-chip text-oker-600 shadow-sm' : 'text-slate-500 hover:text-slate-700')}>
                {role === 'all' ? 'Alles' : role}
              </button>
            ))}
          </div>
        </div>

        <div className="rounded-[32px] border border-oker-100 bg-oker-50/80 p-6 text-sm">
          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-oker-700">Bronimport</p>
          <p className="mt-3 font-bold text-oker-800">Excel Instructies</p>
          <p className="mt-2 text-oker-700">Gebruik bij voorkeur de kolommen <span className="font-mono font-bold">Naam, E-mail, Rol</span>. Voor nieuwe accounts kun je optioneel ook <span className="font-mono font-bold">Wachtwoord</span> toevoegen zodat Supabase meteen een login kan aanmaken.</p>
        </div>
      </div>

      <div className="surface-table rounded-[32px] overflow-hidden">
        <div className="border-b border-white/70 px-6 py-5 md:px-8">
          <AdminSubsectionHeader
            eyebrow="Overzicht"
            title="Gebruikerslijst"
            description="Controleer status, sessies en accountacties per medewerker."
          />
        </div>
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50/50 border-b border-slate-100">
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Medewerker</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Status</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em]">Laatst Actief</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] text-center">Sessies</th>
                <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] text-right">Acties</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredUsers.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50/50 transition-colors group">
                  <td className="px-8 py-6"><div className="font-black text-slate-800 tracking-tight text-lg">{u.name}</div><div className="text-[10px] text-oker-500 font-black uppercase tracking-widest mt-0.5">{u.role}</div></td>
                  <td className="px-8 py-6"><span className={cn('px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest', u.isActive !== false ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-red-50 text-red-600 border border-red-100')}>{u.isActive !== false ? 'Actief' : 'Inactief'}</span></td>
                  <td className="px-8 py-6 text-sm font-bold text-slate-500">{u.lastLogin ? u.lastLogin : <span className="text-slate-300 italic font-medium">Nooit</span>}</td>
                  <td className="px-8 py-6 text-center"><span className={cn('w-8 h-8 inline-flex items-center justify-center rounded-xl text-xs font-black', (u.activeSessions || 0) > 0 ? 'bg-emerald-50 text-emerald-600 border border-emerald-100' : 'bg-slate-50 text-slate-400 border border-slate-100')}>{u.activeSessions || 0}</span></td>
                  <td className="px-8 py-6 text-right">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => setConfirmResetUser(u)} className="glass-icon-button p-2 text-slate-400 hover:text-oker-600 rounded-xl transition-all" title="Stel nieuw tijdelijk wachtwoord in"><RotateCcw size={18} /></button>
                      <button onClick={() => setEditingUser(u)} className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-black uppercase tracking-widest hover:bg-oker-500 transition-all active:scale-95">Bewerken</button>
                      <button onClick={() => !isProtectedAdmin(u) && setConfirmDeleteId(u.id)} disabled={isProtectedAdmin(u)} className={cn('p-2 rounded-xl transition-all', isProtectedAdmin(u) ? 'bg-white/30 text-slate-300 cursor-not-allowed' : 'glass-icon-button text-red-500')} title={isProtectedAdmin(u) ? 'Laatste actieve admin kan niet verwijderd worden' : 'Verwijder gebruiker'}><Trash2 size={18} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="md:hidden divide-y divide-slate-100">
          {filteredUsers.map((u) => (
            <div key={u.id} className="p-6 space-y-4 active:bg-slate-50 transition-colors">
              <div className="flex justify-between items-start">
                <div><div className="font-black text-slate-800 tracking-tight text-lg leading-tight">{u.name}</div><div className="text-[10px] text-oker-500 font-black uppercase tracking-widest mt-1">{u.role}</div></div>
                <span className={cn('glass-chip px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest', u.isActive !== false ? 'text-emerald-600' : 'text-red-600')}>{u.isActive !== false ? 'Actief' : 'Inactief'}</span>
              </div>
              <div className="grid grid-cols-2 gap-4 pt-2">
                <div className="p-3 bg-slate-50 rounded-2xl"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Laatst Actief</p><p className="text-xs font-bold text-slate-700 mt-1">{u.lastLogin || 'Nooit'}</p></div>
                <div className="p-3 bg-slate-50 rounded-2xl"><p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Sessies</p><p className="text-xs font-bold text-slate-700 mt-1">{u.activeSessions || 0}</p></div>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={() => setEditingUser(u)} className="flex-1 bg-slate-900 text-white py-4 rounded-2xl text-xs font-black uppercase tracking-widest active:scale-95 transition-all">Bewerken</button>
                <button onClick={() => !isProtectedAdmin(u) && setConfirmDeleteId(u.id)} disabled={isProtectedAdmin(u)} className={cn('px-4 rounded-2xl active:scale-95 transition-all', isProtectedAdmin(u) ? 'bg-white/30 text-slate-300 cursor-not-allowed' : 'glass-icon-button text-red-500')} title={isProtectedAdmin(u) ? 'Laatste actieve admin kan niet verwijderd worden' : 'Verwijder gebruiker'}><Trash2 size={20} /></button>
                <button onClick={() => setConfirmResetUser(u)} className="glass-icon-button px-4 text-slate-500 rounded-2xl active:scale-95 transition-all" title="Stel nieuw tijdelijk wachtwoord in"><RotateCcw size={20} /></button>
              </div>
            </div>
          ))}
        </div>
        {filteredUsers.length === 0 && <div className="p-6"><EmptyState icon={<Users size={28} />} title="Geen gebruikers gevonden" message="Pas je filter aan of voeg een nieuwe gebruiker toe." /></div>}
      </div>

      <ConfirmationModal isOpen={!!confirmDeleteId} onClose={() => setConfirmDeleteId(null)} onConfirm={handleDeleteUser} title="Gebruiker Verwijderen" message="Weet je zeker dat je deze gebruiker wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt." />
      <ConfirmationModal isOpen={!!pendingImportUsers} onClose={() => { setPendingImportUsers(null); setPendingImportMessage(''); }} onConfirm={handleConfirmImport} title="Gebruikers importeren" message={pendingImportMessage || 'Wil je deze import toepassen?'} confirmText="Importeren" variant="warning" />

      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="glass-modal rounded-[32px] w-full max-w-md max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-white/70">
                <h4 className="text-xl font-black">Nieuwe Gebruiker</h4>
                <p className="mt-1 text-sm font-medium text-slate-500">Voeg handmatig een medewerker toe.</p>
              </div>
              <form onSubmit={handleAddUser} className="p-6 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2"><label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.16em]">Volledige Naam</label><input type="text" required value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" placeholder="bijv. Jan Janssen" /></div>
                  <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.16em]">Rol</label><select value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all bg-white/60 text-sm font-medium"><option value="chauffeur">Chauffeur</option><option value="planner">Planner</option><option value="admin">Admin</option></select></div>
                  <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.16em]">Personeelsnummer</label><input type="text" value={newUser.employeeId} onChange={(e) => setNewUser({ ...newUser, employeeId: e.target.value })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" placeholder="Optioneel" /></div>
                  <div className="space-y-1.5 sm:col-span-2"><label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.16em]">E-mailadres</label><input type="email" required value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" placeholder="bijv. jan@voorbeeld.be" /></div>
                  <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.16em]">Tijdelijk Wachtwoord</label><input type="password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" placeholder="Minstens 6 tekens" /></div>
                  <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.16em]">GSM Nummer</label><input type="text" value={newUser.phone} onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" placeholder="Optioneel" /></div>
                </div>
                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setShowAddModal(false)} className="flex-1 rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-500 transition-colors hover:bg-slate-50">Annuleren</button>
                  <button type="submit" className="btn-primary ios-pressable flex-1 px-4 py-3 text-xs uppercase tracking-widest">Toevoegen</button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {editingUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="glass-modal rounded-[32px] w-full max-w-md max-h-[90vh] overflow-y-auto">
              <div className="p-6 border-b border-white/70 flex justify-between items-center">
                <div><h4 className="text-xl font-bold">Gebruiker Bewerken</h4><p className="text-sm text-slate-500">Pas de gegevens van {editingUser.name} aan.</p></div>
                <button onClick={() => !isProtectedAdmin(editingUser) && setConfirmDeleteId(editingUser.id)} disabled={isProtectedAdmin(editingUser)} className={cn('p-2 rounded-lg transition-colors', isProtectedAdmin(editingUser) ? 'text-slate-300 cursor-not-allowed' : 'text-red-500 hover:bg-red-50')} title={isProtectedAdmin(editingUser) ? 'Laatste actieve admin kan niet verwijderd worden' : 'Verwijder gebruiker'}><Trash2 size={20} /></button>
              </div>
              <form onSubmit={handleUpdateUser} className="p-6 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5 sm:col-span-2"><label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.16em]">Volledige Naam</label><input type="text" required value={editingUser.name} onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" /></div>
                  <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.16em]">Rol</label><select value={editingUser.role} onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value as any })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all bg-white/60 text-sm font-medium"><option value="chauffeur">Chauffeur</option><option value="planner">Planner</option><option value="admin">Admin</option></select></div>
                  <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.16em]">Personeelsnummer</label><input type="text" value={editingUser.employeeId} onChange={(e) => setEditingUser({ ...editingUser, employeeId: e.target.value })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" /></div>
                  <div className="space-y-1.5 sm:col-span-2"><label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.16em]">E-mailadres</label><input type="email" value={editingUser.email || ''} onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" placeholder="bijv. jan@voorbeeld.be" /></div>
                  <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.16em]">Nieuw Wachtwoord</label><input type="password" value={editingUser.password || ''} onChange={(e) => setEditingUser({ ...editingUser, password: e.target.value })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" placeholder="Optioneel" /></div>
                  <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.16em]">GSM Nummer</label><input type="text" value={editingUser.phone || ''} onChange={(e) => setEditingUser({ ...editingUser, phone: e.target.value })} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" placeholder="Optioneel" /></div>
                </div>
                <div className="flex items-center justify-between p-4 surface-muted rounded-2xl">
                  <div><p className="text-sm font-bold text-slate-700">Account Actief</p><p className="text-[10px] text-slate-400 font-medium">Inactieve gebruikers kunnen niet inloggen.</p></div>
                  <button type="button" onClick={() => setEditingUser({ ...editingUser, isActive: editingUser.isActive === false ? true : false })} className={cn('w-12 h-6 rounded-full transition-all relative', editingUser.isActive !== false ? 'bg-emerald-500' : 'bg-slate-300')}><div className={cn('absolute top-1 w-4 h-4 bg-white rounded-full transition-all', editingUser.isActive !== false ? 'left-7' : 'left-1')} /></button>
                </div>
                <div className="grid grid-cols-2 gap-4"><div className="p-3 surface-muted rounded-xl"><p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Laatst Ingelogd</p><p className="text-xs font-bold text-slate-700 mt-1">{editingUser.lastLogin || 'Nooit'}</p></div><div className="p-3 surface-muted rounded-xl"><p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Actieve Sessies</p><p className="text-xs font-bold text-slate-700 mt-1">{editingUser.activeSessions || 0}</p></div></div>
                <div className="flex gap-3 pt-2"><button type="button" onClick={() => setEditingUser(null)} className="flex-1 rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-500 transition-colors hover:bg-slate-50">Annuleren</button><button type="submit" className="flex-1 rounded-2xl bg-slate-900 px-4 py-3 text-xs font-black uppercase tracking-widest text-white shadow-lg transition-colors hover:bg-slate-800">Opslaan</button></div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {confirmResetUser && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm">
            <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.95, y: 20 }} className="glass-modal rounded-[32px] w-full max-w-md overflow-hidden">
              <div className="p-6 border-b border-white/70"><h4 className="text-xl font-black">Wachtwoord resetten</h4><p className="mt-1 text-sm text-slate-500 font-medium">Stel een nieuw tijdelijk wachtwoord in voor {confirmResetUser.name}.</p></div>
              <div className="p-6 space-y-4">
                <div className="space-y-1.5"><label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.16em]">Tijdelijk wachtwoord</label><input type="password" value={resetPasswordValue} onChange={(e) => setResetPasswordValue(e.target.value)} className="control-input w-full px-4 py-2.5 rounded-2xl outline-none transition-all text-sm font-medium" placeholder="Minstens 6 tekens" autoFocus /></div>
                <p className="text-xs text-slate-400 font-medium">De gebruiker logt daarna in met dit nieuwe wachtwoord.</p>
                <div className="flex gap-3 pt-2"><button type="button" onClick={() => { setConfirmResetUser(null); setResetPasswordValue(''); }} className="flex-1 rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-widest text-slate-500 transition-colors hover:bg-slate-50">Annuleren</button><button type="button" onClick={handleResetPassword} disabled={isResettingPassword} className={cn('flex-1 rounded-2xl px-4 py-3 text-xs font-black uppercase tracking-widest text-white shadow-lg transition-colors', isResettingPassword ? 'bg-amber-300 cursor-not-allowed' : 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/20')}>{isResettingPassword ? 'Bezig...' : 'Resetten'}</button></div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <CredentialsModal
        isOpen={!!credentialsModal}
        onClose={() => setCredentialsModal(null)}
        title={credentialsModal?.title || 'Toegangsgegevens'}
        email={credentialsModal?.email || ''}
        password={credentialsModal?.password || ''}
      />
    </PageShell>
  );
}
