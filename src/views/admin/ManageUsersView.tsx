import React, { useEffect, useState } from 'react';
import { WACHTWOORD_MIN } from '../../lib/wachtwoord';
import { Bell, BellOff, CalendarOff, FolderOpen, History, Info, LogIn, MoreHorizontal, Pause, Play, Plus, RotateCcw, Send, Trash2, Upload, Users } from 'lucide-react';
import type { LeaveRequest, Shift, SwapRequest, User } from '../../types';
import { cn, notify } from '../../lib/ui';
import { EXPIRY_SOORT_LABELS, formatDateTimeHuman } from '../../lib/format';
import { sortedNameToken, vindNaamBotsingen } from '../../lib/planning';
import { ConfirmationModal, CredentialsModal, EmptyState, ModalHeader, PageHeader, PageShell } from '../../components/ui';
import { apiFetch } from '../../lib/api';
import { Badge, Button, FilterChip, IconButton, MicroLabel, segItemClass, Td, Th, Switch } from '../../components/primitives';
import { BulkBar, Checkbox, SortTh, StickyThead, TableToolbar, useSort, useTabelVoorkeur } from '../../components/Table';
import { useQueryParam } from '../../app/router';
import { InfoTip } from '../../components/InfoTip';
import { Card, CardHeader } from '../../components/Card';
import { Field, Input, Select } from '../../components/Field';
import { Modal } from '../../components/Modal';
import { UserHistoryModal } from './UserHistoryModal';
import { UserDocumentsModal } from './UserDocumentsModal';
import { BroadcastDocumentModal } from './BroadcastDocumentModal';
import { EntityHistoryModal } from '../../components/EntityHistoryModal';

type UserDraft = User & { password?: string };

/** Rol → badge-tint (presentatie, geen logica). */
const ROLE_BADGE_TONE = { admin: 'oker', planner: 'blue', chauffeur: 'slate' } as const;

/** Uitschakelbare kolommen van de gebruikerstabel (Medewerker en Acties blijven altijd). */
const KOLOMMEN = [
  { key: 'status', label: 'Status' },
  { key: 'meldingen', label: 'Meldingen' },
  { key: 'laatst', label: 'Laatst actief' },
  { key: 'sessies', label: 'Sessies' },
] as const;

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
        const res = await apiFetch('/api/push/subscribers');
        if (!res.ok) return;
        const body = await res.json();
        if (!cancelled && Array.isArray(body?.userIds)) setPushUserIds(new Set(body.userIds.map(String)));
      } catch { /* zonder deze lijst tonen we simpelweg geen 'aan' */ }
    })();
    return () => { cancelled = true; };
  }, []);
  // Wie staat er (niet) in de geïmporteerde planning-matrix, en tot wanneer?
  // Een chauffeur-account zonder cel aan het EINDE van de bekende planning is
  // óf een nieuwe collega, óf een weggevallen Excel-kolom (case Cherlet/
  // Mendez/De Laere, 20-08) — de laatste-datum is essentieel: wie ooit in een
  // oude maand stond maar uit de nieuwste import viel, moet júíst gevlagd
  // worden. Best-effort: zonder data geen badge of filter.
  const [planningPresence, setPlanningPresence] = useState<{ geladen: boolean; tot: string; laatstePerId: Map<string, string> }>({ geladen: false, tot: '', laatstePerId: new Map() });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch('/api/planning-presence');
        if (!res.ok) return;
        const body = await res.json();
        if (cancelled || !Array.isArray(body?.perUser)) return;
        // Lege matrix (nog nooit geïmporteerd) → geen zinvol signaal.
        if (!body.van || !body.tot) return;
        setPlanningPresence({
          geladen: true,
          tot: String(body.tot),
          laatstePerId: new Map(body.perUser.map((p: any) => [String(p.userId), String(p.laatste ?? '')])),
        });
      } catch { /* geen badge/filter zonder data */ }
    })();
    return () => { cancelled = true; };
  }, []);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch('/api/user-expiries');
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
  // Uitrol-filter: toon alleen wie nog nooit inlogde (idee 47).
  const [alleenNooitIn, setAlleenNooitIn] = useState(false);
  // Planning-filter: toon alleen chauffeurs die nergens in de matrix staan.
  const [alleenNietInPlanning, setAlleenNietInPlanning] = useState(false);
  // Naam-zoekveld: met 42 accounts is scrollen traag; zoeken is de kortste weg.
  // De zoekterm staat in de URL (?zoek=…): een refresh of gedeelde link
  // behoudt de zoekopdracht.
  const [userSearch, setUserSearch] = useQueryParam('zoek');
  // Rijdichtheid + kolomkeuze, onthouden per toestel.
  const voorkeur = useTabelVoorkeur('gebruikers', KOLOMMEN);
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
  // Adoptie-zicht voor de uitrol (idee 47): hoeveel actieve chauffeurs hebben
  // ooit ingelogd? Wie nooit inlogde bereik je met niets wat het portaal stuurt
  // — dat is precies wie je nog persoonlijk moet meekrijgen.
  const actieveChauffeurs = actieveUsers.filter((u) => u.role === 'chauffeur');
  const chauffeursOoitIn = actieveChauffeurs.filter((u) => Boolean(u.lastLogin)).length;
  const nooitIngelogd = actieveChauffeurs.length - chauffeursOoitIn;
  // Chauffeur-accounts zonder cel aan het einde van de bekende planning:
  // nooit aanwezig, óf laatste cel vóór het matrix-einde (kolom weggevallen).
  const laatsteInPlanning = (u: User) => planningPresence.laatstePerId.get(String(u.id));
  const nietInPlanning = (u: User) => {
    if (!planningPresence.geladen || u.role !== 'chauffeur' || u.isActive === false) return false;
    const laatste = laatsteInPlanning(u);
    return !laatste || laatste < planningPresence.tot;
  };
  const aantalNietInPlanning = actieveChauffeurs.filter(nietInPlanning).length;

  const activeAdmins = users.filter((u) => u.role === 'admin' && u.isActive !== false);
  const isProtectedAdmin = (user: User) => user.role === 'admin' && user.isActive !== false && activeAdmins.length === 1;

  // Het technische 'beheerder'-account blijft verborgen tenzij je het zelf bent.
  const zichtbareUsers = users.filter((u) => {
    const isBeheerder = u.name.toLowerCase() === 'beheerder';
    const isMe = u.id === currentUser.id;
    return !isBeheerder || isMe;
  });
  const filteredUsers = zichtbareUsers
    .filter((u) => roleFilter === 'all' || u.role === roleFilter)
    .filter((u) => !alleenNooitIn || (u.role === 'chauffeur' && u.isActive !== false && !u.lastLogin))
    .filter((u) => !alleenNietInPlanning || nietInPlanning(u))
    .filter((u) => {
      const q = userSearch.trim().toLowerCase();
      if (!q) return true;
      return [u.name, u.employeeId, u.email ?? ''].join(' ').toLowerCase().includes(q);
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'nl'));
  // Sorteerbare kolommen; standaard op naam (zoals voorheen). De naam-
  // volgorde hierboven blijft de secundaire orde (stabiele sort).
  const sort = useSort<'naam' | 'status' | 'meldingen' | 'laatst' | 'sessies'>('naam');
  const sortedUsers = sort.sorteer(filteredUsers, (u, k) => {
    switch (k) {
      case 'naam': return u.name;
      case 'status': return u.isActive !== false ? 0 : 1;
      case 'meldingen': return pushUserIds.has(String(u.id)) ? 0 : 1;
      case 'laatst': return u.lastLogin || null;
      case 'sessies': return u.activeSessions || 0;
    }
  });
  const filterActief = roleFilter !== 'all' || alleenNooitIn || alleenNietInPlanning || userSearch.trim() !== '';
  const wisFilters = () => { setRoleFilter('all'); setAlleenNooitIn(false); setAlleenNietInPlanning(false); setUserSearch(''); };

  const [isSubmittingUser, setIsSubmittingUser] = useState(false);
  // Naam-botsing-poort: de planning koppelt matrixcellen aan accounts op naam
  // (accent-/volgorde-ongevoelig), en bij twee accounts op dezelfde sleutel
  // weigert de server te kiezen — de chauffeur valt dan uit maandplanning,
  // dekking en dagweergave (case Ivan Van Hoorde, 23-08). Opslaan mag wél
  // (twee échte collega's kunnen dezelfde naam hebben), maar alleen na een
  // expliciete bevestiging.
  const [confirmNaamBotsing, setConfirmNaamBotsing] = useState<{ melding: string; doorgaan: () => void } | null>(null);
  const naamBotsingMelding = (botsingen: User[]) => {
    const wie = botsingen.map((b) => `${b.name}${b.employeeId ? ` (${b.employeeId})` : ''}`).join(', ');
    return `Er bestaat al een account met deze naam: ${wie}. Twee accounts met dezelfde naam kunnen niet aan de planning gekoppeld worden — de diensten op die naam verdwijnen dan uit de maandplanning en de dekking. Toch opslaan?`;
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingUser) return;
    if (!newUser.name) return;
    if (!newUser.email) return notify('Een e-mailadres is verplicht om te kunnen inloggen.', 'error');
    if (newUser.password.length < WACHTWOORD_MIN) return notify(`Gebruik een tijdelijk wachtwoord van minstens ${WACHTWOORD_MIN} tekens.`, 'error');

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

    const botsingen = vindNaamBotsingen(userToAdd.name, users);
    if (botsingen.length > 0) {
      setConfirmNaamBotsing({ melding: naamBotsingMelding(botsingen), doorgaan: () => void voerToevoegenUit(userToAdd) });
      return;
    }
    await voerToevoegenUit(userToAdd);
  };

  const voerToevoegenUit = async (userToAdd: UserDraft) => {
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
    if (!editingUser.email) return notify('Een e-mailadres is verplicht om te kunnen inloggen.', 'error');
    if (editingUser.password && editingUser.password.length < WACHTWOORD_MIN) return notify(`Een nieuw wachtwoord moet minstens ${WACHTWOORD_MIN} tekens hebben.`, 'error');

    const originalUser = users.find((u) => u.id === editingUser.id);
    const isOnlyActiveAdmin = originalUser?.role === 'admin' && originalUser.isActive !== false && activeAdmins.length === 1;
    const adminWouldBeRemoved = editingUser.role !== 'admin' || editingUser.isActive === false;
    if (isOnlyActiveAdmin && adminWouldBeRemoved) return notify('Je kunt de laatste actieve admin niet degraderen of deactiveren.', 'error');

    // Alleen poorten als déze save de botsing introduceert (naam-sleutel
    // gewijzigd): een al bestaande dubbel mag het bewerken van andere velden
    // niet blijven tegenhouden — daarvoor staat de hint onder het naamveld.
    const botsingen = vindNaamBotsingen(editingUser.name, users, editingUser.id);
    const naamGewijzigd = sortedNameToken(editingUser.name) !== sortedNameToken(originalUser?.name ?? '');
    if (botsingen.length > 0 && naamGewijzigd) {
      setConfirmNaamBotsing({ melding: naamBotsingMelding(botsingen), doorgaan: () => void voerBijwerkenUit() });
      return;
    }
    await voerBijwerkenUit();
  };

  const voerBijwerkenUit = async () => {
    if (!editingUser) return;
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
        const res = await apiFetch('/api/user-expiries', {
          method: 'PUT',
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
      const response = await apiFetch('/api/admin/users/reset-password', {
        method: 'POST',
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
          // De merge hierboven matcht op exacte naam; een omgekeerde volgorde
          // in het Excel ("Van Hoorde Ivan") glipt daar langs en wordt een
          // tweede account. Dubbele naam-sleutels in het eindresultaat zijn
          // onkoppelbaar in de planning — benoem ze in de bevestigvraag.
          const perToken = new Map<string, string[]>();
          for (const u of newUsersList) {
            const token = sortedNameToken(u.name);
            if (!token) continue;
            perToken.set(token, [...(perToken.get(token) ?? []), u.name]);
          }
          const dubbeleNamen = [...perToken.values()].filter((namen) => namen.length > 1).map((namen) => namen[0]);
          const basis = updatedCount > 0 ? `Er zijn ${addedCount} nieuwe gebruikers gevonden en ${updatedCount} bestaande gebruikers die worden bijgewerkt. Wilt u doorgaan?` : `Er zijn ${addedCount} nieuwe gebruikers gevonden. Wilt u deze toevoegen?`;
          setPendingImportUsers(newUsersList);
          setPendingImportMessage(dubbeleNamen.length > 0 ? `${basis} Let op: na deze import bestaan er meerdere accounts met dezelfde naam (${dubbeleNamen.join(', ')}) — die namen zijn dan niet aan de planning te koppelen.` : basis);
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
        description="Medewerkers, rollen en accountacties."
        actions={(
          <>
            <span className="inline-flex items-center gap-1">
              <label className={cn('control-button-soft ios-pressable inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-700 transition-all hover:text-slate-900', isImporting && 'cursor-not-allowed opacity-50')}>
                <Upload size={16} />
                {isImporting ? 'Bezig…' : 'Excel importeren'}
                <input type="file" accept=".xlsx, .xls" className="hidden" onChange={handleFileUpload} disabled={isImporting} />
              </label>
              <InfoTip label="Uitleg bij de Excel-import" align="right">
                Gebruik bij voorkeur de kolommen <span className="font-mono font-semibold text-slate-800">Naam, E-mail, Rol</span>. Voor nieuwe accounts kun je optioneel ook <span className="font-mono font-semibold text-slate-800">Wachtwoord</span> toevoegen, zodat er meteen een login aangemaakt wordt. Bestaande gebruikers worden op naam bijgewerkt; hun wachtwoord blijft ongemoeid.
              </InfoTip>
            </span>
            <Button variant="secondary" icon={<Send size={16} />} onClick={() => setShowBroadcast(true)}>
              Document naar iedereen
            </Button>
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setShowAddModal(true)}>
              Gebruiker toevoegen
            </Button>
          </>
        )}
      />

      {/* Eén tabelkaart: kop met uitrol-tellers, toolbar (zoeken/filters/
          telling), bulk-balk en de tabel zelf. De aparte "Werkset"- en
          Excel-kaarten erboven zijn weg — de uitleg zit in de (i) naast de
          importknop, de filters horen bij de tabel. `overflow-clip` i.p.v.
          TableShell: die maakt een scrollcontainer en dan plakt de kolomkop
          niet meer onder de topbar (de tabel is desktop-only, past dus). */}
      <div className="surface-table rounded-3xl overflow-clip">
        <div className="space-y-4 border-b border-slate-200/70 px-5 py-4 md:px-6">
          <CardHeader
            size="lg"
            title="Gebruikerslijst"
            description="Status, meldingen en sessies per medewerker."
            aside={(
              <div className="flex flex-wrap items-center gap-2">
                {/* Uitrol-teller: hoeveel actieve medewerkers kunnen de
                    meldingen die de app verstuurt écht ontvangen? */}
                <Badge tone={pushMetAan > 0 ? 'emerald' : 'slate'} icon={<Bell size={12} />}>
                  {pushMetAan} van {pushTotaal} met meldingen
                </Badge>
                {/* Adoptie: hoeveel chauffeurs logden ooit in? Rood zolang er
                    nog een groep is die je persoonlijk moet meekrijgen. */}
                <Badge tone={nooitIngelogd > 0 ? 'red' : 'emerald'} icon={<LogIn size={12} />}>
                  {chauffeursOoitIn} van {actieveChauffeurs.length} chauffeurs ooit ingelogd
                </Badge>
                {/* Accounts zonder één cel in de geïmporteerde planning:
                    nieuwe collega, vertrokken, of weggevallen Excel-kolom. */}
                {aantalNietInPlanning > 0 && (
                  <Badge tone="amber" icon={<CalendarOff size={12} />}>
                    {aantalNietInPlanning} niet in de planning
                  </Badge>
                )}
              </div>
            )}
          />
          <TableToolbar
            zoek={userSearch}
            onZoek={setUserSearch}
            placeholder="Zoek op naam, personeelsnr of e-mail…"
            telling={`${sortedUsers.length} van ${zichtbareUsers.length}`}
            dichtheid={voorkeur.dichtheid}
            kolommen={voorkeur.kolommen}
            filters={(
              <>
                <div className="glass-segmented inline-flex rounded-2xl p-1">
                  {(['all', 'chauffeur', 'planner', 'admin'] as const).map((role) => (
                    // rauw: segmented control op de glass-rail, klassen via segItemClass
                    <button key={role} type="button" onClick={() => setRoleFilter(role)} className={segItemClass(roleFilter === role, 'capitalize')}>
                      {role === 'all' ? 'Alles' : role}
                    </button>
                  ))}
                </div>
                {/* Snelfilters voor de uitrol. Blijven renderen zolang het
                    filter aanstaat — anders kon een actieve filter zijn eigen
                    knop laten verdwijnen en bleef een lege tabel zonder uitweg
                    achter (controle-ronde 20-08). */}
                {(nooitIngelogd > 0 || alleenNooitIn) && (
                  <FilterChip active={alleenNooitIn} onClick={() => setAlleenNooitIn((v) => !v)} icon={<LogIn size={14} />}>
                    Nog nooit ingelogd ({nooitIngelogd})
                  </FilterChip>
                )}
                {(aantalNietInPlanning > 0 || alleenNietInPlanning) && (
                  <FilterChip active={alleenNietInPlanning} onClick={() => setAlleenNietInPlanning((v) => !v)} icon={<CalendarOff size={14} />}>
                    Niet in de planning ({aantalNietInPlanning})
                  </FilterChip>
                )}
              </>
            )}
          />
          <BulkBar aantal={selectedIds.size} onWis={clearSelection}>
            <Button variant="secondary" size="sm" icon={<Pause size={14} />} onClick={() => bulkSetActive(false)}>Pauzeren</Button>
            <Button variant="secondary" size="sm" icon={<Play size={14} />} onClick={() => bulkSetActive(true)}>Activeren</Button>
            <Button variant="danger" size="sm" icon={<Trash2 size={14} />} onClick={() => setConfirmBulkDelete(true)}>Verwijderen</Button>
          </BulkBar>
        </div>
        {sortedUsers.length > 0 && (
          <div className="hidden md:block">
            <table className={cn('w-full text-left border-collapse', voorkeur.tabelClass)}>
              <StickyThead>
                <tr>
                  <Th className="w-12 !py-1">
                    <Checkbox
                      checked={allSelected}
                      indeterminate={selectedIds.size > 0 && !allSelected}
                      onChange={toggleSelectAll}
                      label="Alles selecteren"
                    />
                  </Th>
                  <SortTh kolom="naam" sort={sort}>Medewerker</SortTh>
                  {voorkeur.zichtbaar('status') && <SortTh kolom="status" sort={sort}>Status</SortTh>}
                  {voorkeur.zichtbaar('meldingen') && <SortTh kolom="meldingen" sort={sort} title="Heeft deze medewerker meldingen aan staan op minstens één toestel?">Meldingen</SortTh>}
                  {voorkeur.zichtbaar('laatst') && <SortTh kolom="laatst" sort={sort}>Laatst actief</SortTh>}
                  {voorkeur.zichtbaar('sessies') && <SortTh kolom="sessies" sort={sort}>Sessies</SortTh>}
                  <Th className="text-right">Acties</Th>
                </tr>
              </StickyThead>
              <tbody>
                {sortedUsers.map((u) => (
                  <tr key={u.id} className={cn('group border-b border-slate-100 last:border-b-0 transition-colors hover:bg-slate-50/60', selectedIds.has(u.id) && 'bg-oker-50/40')}>
                    <Td className="w-12 !py-1">
                      <Checkbox
                        checked={selectedIds.has(u.id)}
                        disabled={isBulkProtected(u)}
                        onChange={() => toggleSelect(u.id)}
                        label={`Selecteer ${u.name}`}
                        className={cn(isBulkProtected(u) && 'opacity-30 cursor-not-allowed')}
                      />
                    </Td>
                    <Td>
                      <div className="font-semibold text-slate-800">{u.name}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge tone={ROLE_BADGE_TONE[u.role]} className="capitalize">{u.role}</Badge>
                        {nietInPlanning(u) && (
                          <Badge
                            tone="amber"
                            icon={<CalendarOff size={12} />}
                            title={laatsteInPlanning(u)
                              ? `Laatste dag in de planning: ${laatsteInPlanning(u)} — daarna komt dit account niet meer voor (weggevallen Excel-kolom of vertrokken).`
                              : 'Dit account komt in geen enkele dag van de geïmporteerde planning voor — nieuwe collega, vertrokken, of een weggevallen kolom in de Excel.'}
                          >
                            Niet in planning
                          </Badge>
                        )}
                      </div>
                    </Td>
                    {voorkeur.zichtbaar('status') && <Td><Badge tone={u.isActive !== false ? 'emerald' : 'slate'} dot>{u.isActive !== false ? 'Actief' : 'Gepauzeerd'}</Badge></Td>}
                    {/* Zonder abonnement komt géén enkele melding aan. */}
                    {voorkeur.zichtbaar('meldingen') && (
                      <Td>
                        {pushUserIds.has(String(u.id))
                          ? <Badge tone="emerald" icon={<Bell size={12} />}>Aan</Badge>
                          : <Badge tone="slate" icon={<BellOff size={12} />}>Uit</Badge>}
                      </Td>
                    )}
                    {voorkeur.zichtbaar('laatst') && <Td className="tabular-nums whitespace-nowrap">{u.lastLogin ? formatDateTimeHuman(u.lastLogin) : <span className="text-slate-400">Nooit</span>}</Td>}
                    {voorkeur.zichtbaar('sessies') && <Td><span className={cn('inline-flex h-7 w-7 items-center justify-center rounded-lg border text-xs font-semibold tabular-nums', (u.activeSessions || 0) > 0 ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-slate-100 bg-surface-soft text-slate-500')}>{u.activeSessions || 0}</span></Td>}
                    <Td className="text-right">
                      <div className="relative flex items-center justify-end gap-1.5">
                        <Button variant="secondary" size="sm" onClick={() => setEditingUser(u)}>Bewerken</Button>
                        <IconButton
                          label="Meer acties"
                          variant="ghost"
                          size="sm"
                          onClick={() => setMenuUserId(menuUserId === u.id ? null : u.id)}
                          aria-expanded={menuUserId === u.id}
                        >
                          <MoreHorizontal size={16} />
                        </IconButton>
                        {menuUserId === u.id && (
                          <>
                            {/* rauw: onzichtbaar klik-buiten-vlak dat het menu sluit */}
                            <button type="button" className="fixed inset-0 z-40 cursor-default" onClick={() => setMenuUserId(null)} aria-label="Sluit menu" tabIndex={-1} />
                            <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-2xl border border-slate-200 bg-surface-white p-1.5 shadow-xl text-left">
                              <RowMenuItem icon={<Info size={16} />} label="Verlof- en dienstruilhistoriek" onClick={() => { setMenuUserId(null); setViewingHistoryUser(u); }} />
                              <RowMenuItem icon={<FolderOpen size={16} />} label="Documenten beheren" onClick={() => { setMenuUserId(null); setDocumentsUser(u); }} />
                              <RowMenuItem icon={<History size={16} />} label="Wijzigingsgeschiedenis" onClick={() => { setMenuUserId(null); setViewingChangeLogUser(u); }} />
                              <RowMenuItem icon={<RotateCcw size={16} />} label="Nieuw tijdelijk wachtwoord" onClick={() => { setMenuUserId(null); setConfirmResetUser(u); }} />
                              <RowMenuItem
                                icon={u.isActive !== false ? <Pause size={16} /> : <Play size={16} />}
                                label={u.isActive !== false ? 'Gebruiker pauzeren' : 'Gebruiker activeren'}
                                disabled={u.isActive !== false && isProtectedAdmin(u)}
                                onClick={() => { setMenuUserId(null); void quickToggleActive(u); }}
                              />
                              <div className="my-1 border-t border-slate-100" />
                              <RowMenuItem
                                icon={<Trash2 size={16} />}
                                label="Gebruiker verwijderen"
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
        )}
        <div className="md:hidden divide-y divide-slate-100">
          {sortedUsers.map((u) => (
            <div key={u.id} className={cn('p-5 space-y-4 active:bg-slate-50 transition-colors', selectedIds.has(u.id) && 'bg-oker-50/40')}>
              <div className="flex justify-between items-start gap-3">
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={selectedIds.has(u.id)}
                    disabled={isBulkProtected(u)}
                    onChange={() => toggleSelect(u.id)}
                    label={`Selecteer ${u.name}`}
                    className={cn('-ml-3 -mt-3', isBulkProtected(u) && 'opacity-30')}
                  />
                  <div>
                    <div className="font-semibold text-slate-800 leading-tight">{u.name}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <Badge tone={ROLE_BADGE_TONE[u.role]} className="capitalize">{u.role}</Badge>
                      {nietInPlanning(u) && (
                        <Badge tone="amber" icon={<CalendarOff size={12} />}>Niet in planning</Badge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1.5">
                  <Badge tone={u.isActive !== false ? 'emerald' : 'slate'} dot>{u.isActive !== false ? 'Actief' : 'Gepauzeerd'}</Badge>
                  {pushUserIds.has(String(u.id))
                    ? <Badge tone="emerald" icon={<Bell size={12} />}>Meldingen aan</Badge>
                    : <Badge tone="slate" icon={<BellOff size={12} />}>Meldingen uit</Badge>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-1">
                <Card tone="muted" padding="sm"><MicroLabel>Laatst actief</MicroLabel><p className="mt-1 text-sm font-semibold text-slate-700 tabular-nums">{u.lastLogin ? formatDateTimeHuman(u.lastLogin) : 'Nooit'}</p></Card>
                <Card tone="muted" padding="sm"><MicroLabel>Sessies</MicroLabel><p className="mt-1 text-sm font-semibold text-slate-700 tabular-nums">{u.activeSessions || 0}</p></Card>
              </div>
              <div className="flex gap-2 pt-1">
                <Button variant="secondary" className="flex-1" onClick={() => setEditingUser(u)}>Bewerken</Button>
                <IconButton label="Verlof- en dienstruilhistoriek" variant="ghost" onClick={() => setViewingHistoryUser(u)}><Info size={18} /></IconButton>
                <IconButton label="Documenten beheren" variant="ghost" onClick={() => setDocumentsUser(u)}><FolderOpen size={18} /></IconButton>
                <IconButton label="Wijzigingsgeschiedenis" variant="ghost" onClick={() => setViewingChangeLogUser(u)}><History size={18} /></IconButton>
                <IconButton label={isProtectedAdmin(u) ? 'Laatste actieve admin kan niet verwijderd worden' : 'Gebruiker verwijderen'} variant="danger" onClick={() => !isProtectedAdmin(u) && setConfirmDeleteId(u.id)} disabled={isProtectedAdmin(u)}><Trash2 size={18} /></IconButton>
                <IconButton label="Nieuw tijdelijk wachtwoord instellen" variant="ghost" onClick={() => setConfirmResetUser(u)}><RotateCcw size={18} /></IconButton>
              </div>
            </div>
          ))}
        </div>
        {sortedUsers.length === 0 && (
          <div className="p-6">
            {filterActief ? (
              <EmptyState
                icon={<Users size={24} />}
                title={userSearch.trim() ? `Geen resultaten voor “${userSearch.trim()}”` : 'Geen gebruikers voor deze filter'}
                message="Pas de zoekterm of de filters aan."
                action={<Button variant="secondary" onClick={wisFilters}>Zoekterm en filters wissen</Button>}
              />
            ) : (
              <EmptyState
                icon={<Users size={24} />}
                title="Nog geen gebruikers"
                message="Voeg een medewerker toe of importeer een Excel-bestand."
                action={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setShowAddModal(true)}>Gebruiker toevoegen</Button>}
              />
            )}
          </div>
        )}
      </div>

      <ConfirmationModal isOpen={!!confirmDeleteId} onClose={() => setConfirmDeleteId(null)} onConfirm={handleDeleteUser} title="Gebruiker verwijderen" message="Weet je zeker dat je deze gebruiker wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt." />
      <ConfirmationModal isOpen={confirmBulkDelete} onClose={() => setConfirmBulkDelete(false)} onConfirm={handleBulkDelete} title="Gebruikers verwijderen" message={`Weet je zeker dat je ${selectedIds.size} geselecteerde gebruiker(s) wilt verwijderen? Beschermde accounts (jezelf, de laatste actieve admin) worden overgeslagen. Dit kan niet ongedaan worden gemaakt.`} confirmText="Verwijderen" variant="warning" />
      <ConfirmationModal isOpen={!!pendingImportUsers} onClose={() => { setPendingImportUsers(null); setPendingImportMessage(''); }} onConfirm={handleConfirmImport} title="Gebruikers importeren" message={pendingImportMessage || 'Wil je deze import toepassen?'} confirmText="Importeren" variant="warning" />
      <ConfirmationModal isOpen={!!confirmNaamBotsing} onClose={() => setConfirmNaamBotsing(null)} onConfirm={() => { const poort = confirmNaamBotsing; setConfirmNaamBotsing(null); poort?.doorgaan(); }} title="Naam bestaat al" message={confirmNaamBotsing?.melding ?? ''} confirmText="Toch opslaan" variant="warning" />

      <Modal open={showAddModal} onClose={() => setShowAddModal(false)} className="flex flex-col !p-0">
        <ModalHeader title="Nieuwe gebruiker" description="Voeg handmatig een medewerker toe." />
        <form onSubmit={handleAddUser} className="p-6 md:p-7 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Volledige naam"
              htmlFor="nieuw-naam"
              className="sm:col-span-2"
              hint={vindNaamBotsingen(newUser.name, users).length > 0 ? <span className="font-medium text-amber-700">Er bestaat al een account met deze naam — een tweede maakt de naam onkoppelbaar in de planning.</span> : undefined}
            >
              <Input id="nieuw-naam" type="text" autoComplete="name" required value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} placeholder="bv. Jan Janssen" />
            </Field>
            <Field label="Rol" htmlFor="nieuw-rol"><Select id="nieuw-rol" value={newUser.role} onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}><option value="chauffeur">Chauffeur</option><option value="planner">Planner</option><option value="admin">Admin</option></Select></Field>
            <Field label="Personeelsnummer" htmlFor="nieuw-personeelsnr"><Input id="nieuw-personeelsnr" type="text" autoComplete="off" value={newUser.employeeId} onChange={(e) => setNewUser({ ...newUser, employeeId: e.target.value })} placeholder="Optioneel" /></Field>
            <Field label="E-mailadres" htmlFor="nieuw-email" className="sm:col-span-2"><Input id="nieuw-email" type="email" autoComplete="email" inputMode="email" required value={newUser.email} onChange={(e) => setNewUser({ ...newUser, email: e.target.value })} placeholder="bv. jan@voorbeeld.be" /></Field>
            <Field label="Tijdelijk wachtwoord" htmlFor="nieuw-wachtwoord"><Input id="nieuw-wachtwoord" type="password" autoComplete="new-password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} placeholder={`Minstens ${WACHTWOORD_MIN} tekens`} /></Field>
            <Field label="GSM-nummer" htmlFor="nieuw-gsm"><Input id="nieuw-gsm" type="tel" autoComplete="tel" inputMode="tel" value={newUser.phone} onChange={(e) => setNewUser({ ...newUser, phone: e.target.value })} placeholder="Optioneel" /></Field>
          </div>
          <div className="flex gap-3 pt-2">
            <Button variant="ghost" className="flex-1" onClick={() => setShowAddModal(false)}>Annuleren</Button>
            <Button type="submit" variant="primary" className="flex-1" disabled={isSubmittingUser}>{isSubmittingUser ? 'Bezig…' : 'Toevoegen'}</Button>
          </div>
        </form>
      </Modal>

      <Modal open={!!editingUser} onClose={() => setEditingUser(null)} maxWidth="lg" className="flex flex-col !p-0">
        {editingUser && (
          <>
            <ModalHeader title="Gebruiker bewerken" description={`Pas de gegevens van ${editingUser.name} aan.`} />
            <form onSubmit={handleUpdateUser} className="p-6 md:p-7 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Volledige naam"
                  htmlFor="bewerk-naam"
                  className="sm:col-span-2"
                  hint={vindNaamBotsingen(editingUser.name, users, editingUser.id).length > 0 ? <span className="font-medium text-amber-700">Er bestaat al een ander account met deze naam — de naam is dan niet aan de planning te koppelen.</span> : undefined}
                >
                  <Input id="bewerk-naam" type="text" autoComplete="name" required value={editingUser.name} onChange={(e) => setEditingUser({ ...editingUser, name: e.target.value })} />
                </Field>
                <Field label="Rol" htmlFor="bewerk-rol"><Select id="bewerk-rol" value={editingUser.role} onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value as any })}><option value="chauffeur">Chauffeur</option><option value="planner">Planner</option><option value="admin">Admin</option></Select></Field>
                <Field label="Personeelsnummer" htmlFor="bewerk-personeelsnr"><Input id="bewerk-personeelsnr" type="text" autoComplete="off" value={editingUser.employeeId} onChange={(e) => setEditingUser({ ...editingUser, employeeId: e.target.value })} /></Field>
                <Field label="E-mailadres" htmlFor="bewerk-email" className="sm:col-span-2"><Input id="bewerk-email" type="email" autoComplete="email" inputMode="email" value={editingUser.email || ''} onChange={(e) => setEditingUser({ ...editingUser, email: e.target.value })} placeholder="bv. jan@voorbeeld.be" /></Field>
                <Field label="Nieuw wachtwoord" htmlFor="bewerk-wachtwoord"><Input id="bewerk-wachtwoord" type="password" autoComplete="new-password" value={editingUser.password || ''} onChange={(e) => setEditingUser({ ...editingUser, password: e.target.value })} placeholder="Optioneel" /></Field>
                <Field label="GSM-nummer" htmlFor="bewerk-gsm"><Input id="bewerk-gsm" type="tel" autoComplete="tel" inputMode="tel" value={editingUser.phone || ''} onChange={(e) => setEditingUser({ ...editingUser, phone: e.target.value })} placeholder="Optioneel" /></Field>
                {editingUser.role === 'chauffeur' && (
                  <Field label="Sectie (maandplanning)" htmlFor="bewerk-sectie"><Select id="bewerk-sectie" value={editingUser.section || ''} onChange={(e) => setEditingUser({ ...editingUser, section: e.target.value || undefined })}><option value="">Geen sectie</option><option value="Reguliere">Reguliere</option><option value="Nacht">Nacht</option><option value="Flexi">Flexi</option><option value="Schoolvervoer">Schoolvervoer</option></Select></Field>
                )}
                <Field label="In dienst sinds" htmlFor="bewerk-startdatum" hint="Bepaalt de anciënniteit-volgorde binnen een sectie in de Maandplanning."><Input id="bewerk-startdatum" type="date" value={editingUser.startDate || ''} onChange={(e) => setEditingUser({ ...editingUser, startDate: e.target.value || undefined })} /></Field>
                <Field label="Verlofbudget (dagen)" htmlFor="bewerk-verlofbudget" className="sm:col-span-2" hint="Vul in om af te wijken van de standaard 24 dagen (bv. anciënniteits-toeslag, deeltijds).">
                  <Input
                    id="bewerk-verlofbudget"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={editingUser.verlofBudget ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      setEditingUser({ ...editingUser, verlofBudget: v === '' ? undefined : Math.max(0, parseInt(v, 10) || 0) });
                    }}
                    placeholder="Leeg = standaard (24 dagen)"
                  />
                </Field>
                {editingUser.role === 'chauffeur' && (
                  <fieldset className="space-y-1.5 sm:col-span-2">
                    <legend className="text-label mb-1.5">Documenten geldig tot</legend>
                    <div className="grid gap-3 sm:grid-cols-3">
                      {Object.entries(EXPIRY_SOORT_LABELS).map(([soort, label]) => (
                        <Field key={soort} label={label} htmlFor={`bewerk-verval-${soort}`}>
                          <Input
                            id={`bewerk-verval-${soort}`}
                            type="date"
                            value={vervalDraft[soort] ?? ''}
                            onChange={(e) => setVervalDraft((d) => ({ ...d, [soort]: e.target.value }))}
                          />
                        </Field>
                      ))}
                    </div>
                    <p className="text-xs text-slate-500">Het portaal verwittigt de chauffeur en de planning automatisch op 90, 30 en 7 dagen voor de vervaldatum. Leeg = niet bewaken.</p>
                  </fieldset>
                )}
              </div>
              <Card tone="muted" padding="sm" className="flex items-center justify-between">
                <div><p className="text-sm font-semibold text-slate-700">Account actief</p><p className="text-2xs text-slate-500">Inactieve gebruikers kunnen niet inloggen.</p></div>
                <Switch checked={editingUser.isActive !== false} onChange={(aan) => setEditingUser({ ...editingUser, isActive: aan })} label="Account actief" />
              </Card>
              <Card tone="muted" padding="sm" className="flex items-center justify-between">
                <div><p className="text-sm font-semibold text-slate-700">Tonen in contactlijst</p><p className="text-2xs text-slate-500">Uit = deze persoon staat niet in de contactlijst voor collega's.</p></div>
                <Switch checked={editingUser.showInContacts !== false} onChange={(aan) => setEditingUser({ ...editingUser, showInContacts: aan })} label="Tonen in contactlijst" />
              </Card>
              {editingUser.role === 'admin' && (
                <Card tone="muted" padding="sm" className="flex items-center justify-between">
                  <div><p className="text-sm font-semibold text-slate-700">Systeemmails</p><p className="text-2xs text-slate-500">Foutendigest en back-up-mails van het portaal. Uit = deze admin ontvangt ze niet.</p></div>
                  <Switch checked={editingUser.wantsSystemMail !== false} onChange={(aan) => setEditingUser({ ...editingUser, wantsSystemMail: aan })} label="Systeemmails" />
                </Card>
              )}
              <div className="grid grid-cols-2 gap-4"><Card tone="muted" padding="sm"><MicroLabel>Laatst ingelogd</MicroLabel><p className="text-sm font-semibold text-slate-700 tabular-nums mt-1">{editingUser.lastLogin ? formatDateTimeHuman(editingUser.lastLogin) : 'Nooit'}</p></Card><Card tone="muted" padding="sm"><MicroLabel>Actieve sessies</MicroLabel><p className="text-sm font-semibold text-slate-700 tabular-nums mt-1">{editingUser.activeSessions || 0}</p></Card></div>
              {/* Verwijderknop stond in de kop; de gedeelde ModalHeader heeft
                  daar geen slot voor, dus links in de knoppenrij (zelfde
                  gedrag, zelfde bescherming; controle-ronde 27-08). */}
              <div className="flex gap-3 pt-2"><IconButton label={isProtectedAdmin(editingUser) ? 'Laatste actieve admin kan niet verwijderd worden' : 'Gebruiker verwijderen'} variant="danger" onClick={() => !isProtectedAdmin(editingUser) && setConfirmDeleteId(editingUser.id)} disabled={isProtectedAdmin(editingUser)}><Trash2 size={16} /></IconButton><Button variant="ghost" className="flex-1" onClick={() => setEditingUser(null)}>Annuleren</Button><Button type="submit" variant="primary" className="flex-1" disabled={isSubmittingUser}>{isSubmittingUser ? 'Bezig…' : 'Opslaan'}</Button></div>
            </form>
          </>
        )}
      </Modal>

      <Modal open={!!confirmResetUser} onClose={() => { setConfirmResetUser(null); setResetPasswordValue(''); }} className="flex flex-col !p-0">
        {confirmResetUser && (
          <>
            <ModalHeader title="Wachtwoord resetten" description={`Stel een nieuw tijdelijk wachtwoord in voor ${confirmResetUser.name}.`} />
            <div className="p-6 md:p-7 space-y-4">
              <Field label="Tijdelijk wachtwoord" htmlFor="reset-wachtwoord" hint="De gebruiker logt daarna in met dit nieuwe wachtwoord.">
                <Input id="reset-wachtwoord" type="password" value={resetPasswordValue} onChange={(e) => setResetPasswordValue(e.target.value)} placeholder={`Minstens ${WACHTWOORD_MIN} tekens`} autoFocus />
              </Field>
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
    // rauw: menu-item in het ⋯-overflowmenu (icoon + label op volle breedte, geen knop-uiterlijk)
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition-colors min-h-11',
        tone === 'danger'
          ? 'text-red-700 hover:bg-red-50'
          : 'text-slate-700 hover:bg-slate-100/70',
        disabled && 'opacity-40 cursor-not-allowed hover:bg-transparent',
      )}
    >
      <span className="shrink-0">{icon}</span>
      <span className="truncate">{label}</span>
    </button>
  );
}
