import React, { useEffect, useRef, useState } from 'react';
import { AanwezigOpScherm } from '../../components/AanwezigOpScherm';
import { WACHTWOORD_MIN } from '../../lib/wachtwoord';
import { nieuweUserFormulierSchema, userFormulierSchema, wachtwoordResetSchema } from '../../../shared/schemas/user';
import { CalendarOff, FolderOpen, History, Info, LogIn, Pause, Play, Plus, RotateCcw, Send, ShieldOff, Trash2, Upload, UserX } from 'lucide-react';
import { ROLLEN, ROL_LABELS } from '../../../shared/schemas/constanten';
import { ACCOUNT_STATUS } from '../../../shared/status';
import type { Role, User } from '../../types';
import { useAppDataContext } from '../../app/AppDataContext';
import { cn, notify } from '../../lib/ui';
import { EXPIRY_SOORT_LABELS, formatDateTimeHuman } from '../../lib/format';
import { sortedNameToken, vindNaamBotsingen } from '../../lib/planning';
import { ConfirmationModal, CredentialsModal, EmptyState, ModalHeader, PageHeader, PageShell } from '../../components/ui';
import { apiFetch } from '../../lib/api';
import { Badge, Button, FilterChip, IconButton, MicroLabel, Segmented, TOON_NAAR_BADGE, Td, Th, Switch } from '../../components/primitives';
import { BulkBar, Checkbox, SortTh, StickyThead, TableToolbar, useSort, useTabelVoorkeur } from '../../components/Table';
import { useQueryParam } from '../../app/router';
import { ActieMenu } from '../../components/ActieMenu';
import { Card, CardHeader } from '../../components/Card';
import { Avatar } from '../../components/Avatar';
import { DateInput, Field, Input, Select } from '../../components/Field';
import { Modal, SluitKnop } from '../../components/Modal';
import { Formulier } from '../../components/Formulier';
import { useVeldfouten, useVuil } from '../../lib/formulier';
import { meldSchrijffout } from '../../lib/fouten';
import { UserHistoryModal } from './UserHistoryModal';
import { UserDocumentsModal } from './UserDocumentsModal';
import { BroadcastDocumentModal } from './BroadcastDocumentModal';
import { EntityHistoryModal } from '../../components/EntityHistoryModal';
import { LegeLijst, NietGevonden } from '../../components/illustraties';
import { LijstAnimatie, LijstRij } from '../../components/LijstRij';

type UserDraft = User & { password?: string };

/** Rol → badge-tint (presentatie, geen logica). */
// `Record<Role, …>`: de technieker ontbrak hier en kreeg dus `tone={undefined}`
// (gevonden door `strict`, 21-09). Neutraal zoals de chauffeur: het label
// onderscheidt, niet de kleur.
const ROLE_BADGE_TONE: Record<Role, 'oker' | 'blue' | 'slate'> = { admin: 'oker', planner: 'blue', chauffeur: 'slate', technieker: 'slate' };

/** Uitschakelbare kolommen van de gebruikerstabel (Medewerker en Acties blijven altijd). */
const KOLOMMEN = [
  { key: 'status', label: 'Status' },
  { key: 'meldingen', label: 'Meldingen' },
  { key: 'laatst', label: 'Laatst actief' },
  { key: 'sessies', label: 'Toestellen' },
] as const;

export function ManageUsersView({ title = 'Gebruikers', currentUser }: {
  title?: string;
  currentUser: User;
}) {
  // Gebruikers, savers en de collecties voor de historiek-modal komen uit de
  // datalaag (AppDataContext). Twee opslagpaden, bewust:
  // - `saveUsers` (hele lijst) blijft het pad voor de Excel-import en de
  //   bulkacties op een selectie: één atomaire save mét revisie- en
  //   massa-verwijder-vangrail (per record in een lus zou N× de volledige
  //   Auth-sync draaien en halverwege kunnen stranden).
  // - `saveUser`/`createUser`/`deleteUser` (PUT/POST one/DELETE) voor
  //   bewerken, toevoegen, verwijderen en de snelle pauzeer/activeer-knop.
  const { users, saveUsers: onSave, saveUser: onSaveUser, createUser: onCreateUser, deleteUser: onDeleteUser, fetchUsers, shifts, leaveRequests, swaps } = useAppDataContext();
  const [isImporting, setIsImporting] = useState(false);
  // Verborgen file-input voor de Excel-import; het "…"-menu in de kop klikt hem aan.
  const importRef = useRef<HTMLInputElement>(null);
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
  // Goedgekeurde toestellen per gebruiker: vervangt de oude sessieteller.
  // Die telde alleen op (start +1, alleen de uitlogknop -1), waardoor een
  // account op "115 sessies" kon staan; het aantal toestellen is wél waar.
  const [toestellenPerUser, setToestellenPerUser] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await apiFetch('/api/devices');
        if (!res.ok) return;
        const body = await res.json();
        if (cancelled || !Array.isArray(body)) return;
        const telling = new Map<string, number>();
        for (const d of body) {
          if (d?.status !== 'approved') continue;
          const id = String(d.userId);
          telling.set(id, (telling.get(id) ?? 0) + 1);
        }
        setToestellenPerUser(telling);
      } catch { /* zonder deze lijst blijft de kolom op 0 staan */ }
    })();
    return () => { cancelled = true; };
  }, []);
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
  // Bij het openen de lijst vers ophalen: lastLogin/activeSessions veranderen
  // server-side zonder realtime-event of revisiebump, dus een tabblad dat
  // dagen openstaat toonde anders de stand van de eigen opstart (15-09).
  useEffect(() => { void fetchUsers(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
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
  // Uit dienst in één handeling (verbeterronde 07-09, nr. 1): deactiveren,
  // toestellen intrekken en push stoppen via één endpoint. Het aantal
  // toestellen wordt vooraf geteld zodat de bevestiging concreet is;
  // null = nog aan het tellen.
  const [uitDienstUser, setUitDienstUser] = useState<User | null>(null);
  const [uitDienstToestellen, setUitDienstToestellen] = useState<number | null>(null);
  const [uitDienstReden, setUitDienstReden] = useState('');
  const [isUitDienstBezig, setIsUitDienstBezig] = useState(false);

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
      case 'sessies': return toestellenPerUser.get(String(u.id)) ?? 0;
    }
  });
  const filterActief = roleFilter !== 'all' || alleenNooitIn || alleenNietInPlanning || userSearch.trim() !== '';
  const wisFilters = () => { setRoleFilter('all'); setAlleenNooitIn(false); setAlleenNietInPlanning(false); setUserSearch(''); };

  const [isSubmittingUser, setIsSubmittingUser] = useState(false);
  // Veldfouten per formulier: het gedeelde schema vóór submit én de
  // server-veldfouten van een 400 — bij het veld (Field error), niet als toast.
  const nieuwF = useVeldfouten();
  const bewerkF = useVeldfouten();
  const nieuwFouten = nieuwF.fouten;
  const bewerkFouten = bewerkF.fouten;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (showAddModal) nieuwF.wis(); }, [showAddModal]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { bewerkF.wis(); }, [editingUser?.id]);
  // Onbewaarde invoer (tranche 3A): Annuleren, kruisje, Escape en backdrop
  // vragen eerst "Wijzigingen niet bewaren?". Bij bewerken telt de
  // vervaldata-draft mee; die vergelijken we met de bewaarde vervaldata
  // i.p.v. met een momentopname, want de draft wordt pas ná het openen gevuld.
  const { vuil: nieuwVuil } = useVuil(newUser, showAddModal);
  const { vuil: bewerkUserVuil } = useVuil(editingUser, !!editingUser, editingUser?.id);
  const vervalBestaand = editingUser ? userExpiries[editingUser.id] ?? {} : {};
  const vervalVuil = !!editingUser && Object.keys(EXPIRY_SOORT_LABELS).some((soort) => (vervalDraft[soort] ?? '').trim() !== (vervalBestaand[soort] ?? ''));
  const bewerkVuil = bewerkUserVuil || vervalVuil;
  // Naam-botsing-poort: de planning koppelt matrixcellen aan accounts op naam
  // (accent-/volgorde-ongevoelig), en bij twee accounts op dezelfde sleutel
  // weigert de server te kiezen — de chauffeur valt dan uit maandplanning,
  // dekking en dagweergave (case Ivan Van Hoorde, 23-08). Opslaan mag wél
  // (twee échte collega's kunnen dezelfde naam hebben), maar alleen na een
  // expliciete bevestiging.
  const [confirmNaamBotsing, setConfirmNaamBotsing] = useState<{ melding: string; doorgaan: () => void } | null>(null);
  const naamBotsingMelding = (botsingen: User[]) => {
    const wie = botsingen.map((b) => `${b.name}${b.employeeId ? ` (${b.employeeId})` : ''}`).join(', ');
    return `Er bestaat al een account met deze naam: ${wie}. Twee accounts met dezelfde naam kunnen niet aan de planning gekoppeld worden, de diensten op die naam verdwijnen dan uit de maandplanning en de dekking. Toch opslaan?`;
  };

  const handleAddUser = async () => {
    if (isSubmittingUser) return;

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

    // Gedeeld contract (shared/schemas/user.ts): naam, e-mail (verplicht om
    // te kunnen inloggen), tijdelijk wachtwoord, GSM — fouten bij het veld.
    if (!nieuwF.controleer(nieuweUserFormulierSchema, userToAdd)) return;

    const botsingen = vindNaamBotsingen(userToAdd.name, users);
    if (botsingen.length > 0) {
      setConfirmNaamBotsing({ melding: naamBotsingMelding(botsingen), doorgaan: () => void voerToevoegenUit(userToAdd) });
      return;
    }
    await voerToevoegenUit(userToAdd);
  };

  const voerToevoegenUit = async (userToAdd: UserDraft) => {
    setIsSubmittingUser(true);
    const success = await onCreateUser(userToAdd, nieuwF.zet).finally(() => setIsSubmittingUser(false));
    if (!success) return;
    setShowAddModal(false);
    setNewUser({ name: '', role: 'chauffeur', employeeId: '', password: '', phone: '', email: '' });
    setCredentialsModal({
      title: 'Nieuwe gebruiker aangemaakt',
      email: userToAdd.email || '',
      password: userToAdd.password || '',
    });
  };

  const handleUpdateUser = async () => {
    if (isSubmittingUser) return;
    if (!editingUser) return;
    // Gedeeld contract (shared/schemas/user.ts): fouten bij het veld.
    if (!bewerkF.controleer(userFormulierSchema, editingUser)) return;

    const originalUser = users.find((u) => u.id === editingUser.id);
    const isOnlyActiveAdmin = originalUser?.role === 'admin' && originalUser.isActive !== false && activeAdmins.length === 1;
    const adminWouldBeRemoved = editingUser.role !== 'admin' || editingUser.isActive === false;
    if (isOnlyActiveAdmin && adminWouldBeRemoved) {
      // Bij het veld dat het veroorzaakt (rol of Account actief), zodat de
      // focus erheen gaat; de tekst is dezelfde als de vroegere toast.
      bewerkF.zet({ [editingUser.role !== 'admin' ? 'role' : 'isActive']: 'Je kunt de laatste actieve admin niet degraderen of deactiveren.' });
      return;
    }

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
    const success = await onSaveUser(editingUser, bewerkF.zet).finally(() => setIsSubmittingUser(false));
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
        notify(`${EXPIRY_SOORT_LABELS[soort]} kon niet opgeslagen worden, probeer opnieuw.`, 'error');
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
    const success = await onDeleteUser(confirmDeleteId);
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

  const [bulkBezig, setBulkBezig] = useState<'pauzeren' | 'activeren' | null>(null);
  const bulkSetActive = async (active: boolean) => {
    setBulkBezig(active ? 'activeren' : 'pauzeren');
    try { await bulkSetActiveInner(active); } finally { setBulkBezig(null); }
  };
  const bulkSetActiveInner = async (active: boolean) => {
    const targetIds = new Set([...selectedIds].filter((id) => { const u = users.find((x) => x.id === id); return !!u && (active || !isBulkProtected(u)); }));
    if (targetIds.size === 0) return notify('Geen gebruikers om te wijzigen.', 'error');
    const success = await onSave(users.map((u) => (targetIds.has(u.id) ? { ...u, isActive: active } : u)));
    if (success) { notify(`${targetIds.size} gebruiker(s) ${active ? 'geactiveerd' : 'gepauzeerd'}.`, 'success'); clearSelection(); }
  };
  const quickToggleActive = async (u: User) => {
    if (u.isActive !== false && isProtectedAdmin(u)) return notify('Je kunt de laatste actieve admin niet pauzeren.', 'error');
    const gewijzigd = { ...u, isActive: u.isActive === false };
    await onSaveUser(gewijzigd);
  };
  // De ConfirmationModal wacht op deze Promise (knop `bezig`) en sluit daarna
  // zelf via onClose (fase 2).
  const handleBulkDelete = async () => {
    const targetIds = new Set([...selectedIds].filter((id) => { const u = users.find((x) => x.id === id); return !!u && !isBulkProtected(u); }));
    if (targetIds.size === 0) return notify('Geen gebruikers om te verwijderen (beschermde accounts overgeslagen).', 'error');
    const success = await onSave(users.filter((u) => !targetIds.has(u.id)));
    if (success) { notify(`${targetIds.size} gebruiker(s) verwijderd.`, 'success'); clearSelection(); }
  };

  // Twee-stapsverificatie resetten (verbeterronde 07-09, nr. 8): voor een
  // planner/admin die zijn authenticator kwijt is. Verwijdert de factoren in
  // Supabase Auth; bij de volgende aanmelding schrijft de collega zich
  // opnieuw in (of meteen, als MFA_STAF=aan).
  const [mfaResetUser, setMfaResetUser] = useState<User | null>(null);
  const handleMfaReset = async () => {
    if (!mfaResetUser) return;
    const doel = mfaResetUser;
    setMfaResetUser(null);
    try {
      const response = await apiFetch(`/api/admin/users/${doel.id}/mfa-reset`, { method: 'POST' });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return notify(data.error || 'Resetten is mislukt.', 'error');
      notify(data.verwijderd > 0
        ? `Twee-stapsverificatie van ${doel.name} is gereset. Bij de volgende aanmelding stelt ${doel.name} hem opnieuw in.`
        : `${doel.name} had geen twee-stapsverificatie ingesteld.`, 'success');
    } catch (error: any) {
      notify(`Resetten is mislukt: ${error?.message || 'netwerkfout'}.`, 'error');
    }
  };

  const resetF = useVeldfouten();
  const sluitReset = () => { setConfirmResetUser(null); setResetPasswordValue(''); resetF.wis(); };
  const handleResetPassword = async () => {
    if (!confirmResetUser || isResettingPassword) return;
    // Zelfde schema als de server (WACHTWOORD_MIN uit shared): te kort = fout bij het veld.
    const invoer = resetF.controleer(wachtwoordResetSchema, { userId: String(confirmResetUser.id), password: resetPasswordValue });
    if (!invoer) return;
    try {
      setIsResettingPassword(true);
      const response = await apiFetch('/api/admin/users/reset-password', {
        method: 'POST',
        body: JSON.stringify(invoer),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 400 && resetF.vanServer(data)) return;
      // Geen "Opnieuw proberen": de server dedupliceert een reset niet.
      if (!response.ok) return meldSchrijffout('Resetten', { status: response.status, message: data.details || data.error });
      notify(`Wachtwoord voor ${confirmResetUser.name} is bijgewerkt.`, 'success');
      setCredentialsModal({
        title: `Wachtwoord reset voor ${confirmResetUser.name}`,
        email: confirmResetUser.email || '',
        password: resetPasswordValue,
      });
      sluitReset();
    } catch (error: any) {
      // fetch kan ook gooien (offline) — zonder catch leek de reset gelukt
      // terwijl het wachtwoord nooit gezet was.
      meldSchrijffout('Resetten', error);
    } finally {
      setIsResettingPassword(false);
    }
  };

  const openUitDienst = (u: User) => {
    setUitDienstUser(u);
    setUitDienstToestellen(null);
    setUitDienstReden('');
    void (async () => {
      try {
        const res = await apiFetch('/api/devices');
        const rows: Array<{ userId: string; status: string }> = res.ok ? await res.json() : [];
        setUitDienstToestellen(Array.isArray(rows) ? rows.filter((d) => String(d.userId) === String(u.id) && d.status !== 'revoked').length : 0);
      } catch {
        // Zonder telling toch door: de server trekt alles in wat er is.
        setUitDienstToestellen(0);
      }
    })();
  };
  const sluitUitDienst = () => { setUitDienstUser(null); setUitDienstReden(''); };
  const uitDienstVuil = !!uitDienstUser && uitDienstReden.trim() !== '';
  // Uit dienst is idempotent op de server (POST /api/users/:id/uitdienst):
  // nogmaals op een al gedeactiveerde gebruiker geeft 200 met nullen, zonder
  // meldingen, alleen een extra auditregel "was al gedeactiveerd"
  // (src/apiIntegration.test.ts). Daarom mag de fouttoast "Opnieuw proberen"
  // tonen; de poging onthoudt gebruiker en reden, ook als de modal intussen dicht is.
  const uitDienstBezig = useRef(false);
  const openUitDienstId = useRef<string | null>(null);
  useEffect(() => { openUitDienstId.current = uitDienstUser ? String(uitDienstUser.id) : null; }, [uitDienstUser]);
  const voerUitDienstUit = async (doel: User, reden: string) => {
    if (uitDienstBezig.current) return;
    uitDienstBezig.current = true;
    const opnieuw = () => { void voerUitDienstUit(doel, reden); };
    try {
      setIsUitDienstBezig(true);
      const response = await apiFetch(`/api/users/${encodeURIComponent(doel.id)}/uitdienst`, {
        method: 'POST',
        body: JSON.stringify(reden ? { reden } : {}),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return meldSchrijffout('Uit dienst zetten', { status: response.status, message: data.details || data.error }, opnieuw);
      const { toestellen = 0, push = 0 } = data.samenvatting ?? {};
      const mislukt = Array.isArray(data.stappen) ? data.stappen.filter((s: { ok: boolean }) => !s.ok) : [];
      notify(
        `${doel.name} is uit dienst: account gedeactiveerd, ${toestellen} toestel${toestellen === 1 ? '' : 'len'} ingetrokken, ${push} push-abonnement${push === 1 ? '' : 'en'} gewist.`,
        mislukt.length > 0 ? 'info' : 'success',
      );
      if (mislukt.length > 0) notify(`Niet gelukt: ${mislukt.map((s: { detail: string }) => s.detail).join(' ')}`, 'error');
      setPushUserIds((prev) => { const n = new Set(prev); n.delete(String(doel.id)); return n; });
      // Alleen de modal van déze gebruiker sluiten (een nieuwe poging kan
      // slagen terwijl beheer intussen iemand anders open heeft).
      if (String(openUitDienstId.current) === String(doel.id)) sluitUitDienst();
      await fetchUsers();
    } catch (error: any) {
      meldSchrijffout('Uit dienst zetten', error, opnieuw);
    } finally {
      uitDienstBezig.current = false;
      setIsUitDienstBezig(false);
    }
  };
  const handleUitDienst = async () => {
    if (!uitDienstUser || isUitDienstBezig) return;
    await voerUitDienstUit(uitDienstUser, uitDienstReden.trim());
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
          return notify(`Geen geldige gebruikers gevonden. Gebruik de kolommen Naam, E-mail en Rol (optioneel Wachtwoord). Gevonden kolommen: ${keys.join(', ')}`, 'error');
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
          // De uitleg over bestaande accounts stond vroeger in een (i) naast
          // de importknop; nu de import in het "…"-menu zit, hoort ze hier.
          const basis = updatedCount > 0 ? `Er zijn ${addedCount} nieuwe gebruikers gevonden en ${updatedCount} bestaande gebruikers die op naam worden bijgewerkt (hun wachtwoord blijft ongemoeid). Wilt u doorgaan?` : `Er zijn ${addedCount} nieuwe gebruikers gevonden. Wilt u deze toevoegen?`;
          setPendingImportUsers(newUsersList);
          setPendingImportMessage(dubbeleNamen.length > 0 ? `${basis} Let op: na deze import bestaan er meerdere accounts met dezelfde naam (${dubbeleNamen.join(', ')}), die namen zijn dan niet aan de planning te koppelen.` : basis);
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
    // De dialoog ruimt pendingImportUsers zelf op via onClose (fase 2).
  };

  return (
    <PageShell>
      <PageHeader
        view="gebruikers"
        title={title}
        actions={(
          <>
            <AanwezigOpScherm />
            {/* Eén gouden knop in de kop; Excel-import en het document-
                rondsturen zitten in het "…"-menu ernaast — zo stapelen er op
                mobiel geen drie knoppen (afwerking 04-09, nr. 5 en 7). */}
            <input ref={importRef} type="file" accept=".xlsx, .xls" className="hidden" onChange={handleFileUpload} disabled={isImporting} />
            <ActieMenu
              label="Meer acties"
              align="left"
              items={[
                { label: isImporting ? 'Bezig met importeren…' : 'Excel importeren', icon: <Upload size={16} />, disabled: isImporting, onClick: () => importRef.current?.click() },
                { label: 'Document naar iedereen', icon: <Send size={16} />, onClick: () => setShowBroadcast(true) },
              ]}
            />
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
        <div className="space-y-4 border-b border-hairline px-5 py-4 md:px-6">
          <CardHeader
            size="lg"
            title="Gebruikerslijst"
            description="Status, meldingen en sessies per medewerker."
            aside={(
              <div className="flex flex-wrap items-center gap-2">
                {/* Uitrol-teller: hoeveel actieve medewerkers kunnen de
                    meldingen die de app verstuurt écht ontvangen? */}
                <Badge tone={pushMetAan > 0 ? 'emerald' : 'slate'} stil className="tabular-nums">
                  {pushMetAan} van {pushTotaal} met meldingen
                </Badge>
                {/* Adoptie: hoeveel chauffeurs logden ooit in? Rood zolang er
                    nog een groep is die je persoonlijk moet meekrijgen;
                    daarna een stille chip. */}
                <Badge tone={nooitIngelogd > 0 ? 'red' : 'emerald'} stil={nooitIngelogd === 0} className="tabular-nums">
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
                <Segmented<typeof roleFilter>
                  label="Rol"
                  itemClassName="capitalize"
                  waarde={roleFilter}
                  opties={(['all', 'chauffeur', 'planner', 'admin'] as const).map((role) => ({ waarde: role, label: role === 'all' ? 'Alles' : role }))}
                  onChange={setRoleFilter}
                />
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
            <Button variant="secondary" size="sm" icon={<Pause size={14} />} bezig={bulkBezig === 'pauzeren'} disabled={bulkBezig === 'activeren'} onClick={() => bulkSetActive(false)}>Pauzeren</Button>
            <Button variant="secondary" size="sm" icon={<Play size={14} />} bezig={bulkBezig === 'activeren'} disabled={bulkBezig === 'pauzeren'} onClick={() => bulkSetActive(true)}>Activeren</Button>
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
                  {voorkeur.zichtbaar('sessies') && <SortTh kolom="sessies" sort={sort} title="Aantal goedgekeurde toestellen van deze medewerker.">Toestellen</SortTh>}
                  <Th className="text-right">Acties</Th>
                </tr>
              </StickyThead>
              <tbody>
                {/* Tabelrijen: alleen opacity + 8 px (geen hoogte/layout, zie LijstRij). */}
                <LijstAnimatie aantal={sortedUsers.length}>
                {sortedUsers.map((u) => (
                  <LijstRij as="tr" key={u.id} className={cn('group border-b border-hairline-subtle last:border-b-0 transition-colors hover:bg-surface-soft-hover', selectedIds.has(u.id) && 'bg-slate-100/60')}>
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
                      <div className="flex items-start gap-2.5">
                        <Avatar naam={u.name} size="md" className="mt-px" />
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-800">{u.name}</div>
                          {/* Rol als gewone metaregel: een pil per rij voor iets dat
                              bij 40 van de 45 rijen "chauffeur" is, maakt de echte
                              signalen (Niet in planning) onzichtbaar. Staf krijgt
                              wat meer gewicht, geen kleur. */}
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                            <span className={cn('text-xs capitalize', (u.role === 'admin' || u.role === 'planner') ? 'font-semibold text-slate-700' : 'font-medium text-slate-500')}>{u.role}</span>
                            {nietInPlanning(u) && (
                              <Badge
                                tone="amber"
                                icon={<CalendarOff size={12} />}
                                title={laatsteInPlanning(u)
                                  ? `Laatste dag in de planning: ${laatsteInPlanning(u)}, daarna komt dit account niet meer voor (weggevallen Excel-kolom of vertrokken).`
                                  : 'Dit account komt in geen enkele dag van de geïmporteerde planning voor, nieuwe collega, vertrokken, of een weggevallen kolom in de Excel.'}
                              >
                                Niet in planning
                              </Badge>
                            )}
                          </div>
                        </div>
                      </div>
                    </Td>
                    {voorkeur.zichtbaar('status') && <Td><AccountBadge actief={u.isActive !== false} kaal /></Td>}
                    {/* Zonder abonnement komt géén enkele melding aan. */}
                    {voorkeur.zichtbaar('meldingen') && (
                      <Td>
                        {pushUserIds.has(String(u.id))
                          ? <Badge tone="emerald" kaal>Aan</Badge>
                          : <Badge tone="slate" kaal>Uit</Badge>}
                      </Td>
                    )}
                    {voorkeur.zichtbaar('laatst') && <Td className="tabular-nums whitespace-nowrap">{u.lastLogin ? formatDateTimeHuman(u.lastLogin) : <span className="text-slate-500">Nooit</span>}</Td>}
                    {voorkeur.zichtbaar('sessies') && <Td className={(toestellenPerUser.get(String(u.id)) ?? 0) > 0 ? 'text-slate-800' : 'text-slate-400'}>{toestellenPerUser.get(String(u.id)) ?? 0}</Td>}
                    <Td className="text-right">
                      <div className="relative flex items-center justify-end gap-1.5">
                        <Button variant="secondary" size="sm" onClick={() => setEditingUser(u)}>Bewerken</Button>
                        <ActieMenu
                          label="Meer acties"
                          size="sm"
                          items={[
                            { label: 'Verlof- en dienstruilhistoriek', icon: <Info size={16} />, onClick: () => setViewingHistoryUser(u) },
                            { label: 'Documenten beheren', icon: <FolderOpen size={16} />, onClick: () => setDocumentsUser(u) },
                            { label: 'Wijzigingsgeschiedenis', icon: <History size={16} />, onClick: () => setViewingChangeLogUser(u) },
                            { label: 'Nieuw tijdelijk wachtwoord', icon: <RotateCcw size={16} />, onClick: () => setConfirmResetUser(u) },
                            ...(u.role === 'planner' || u.role === 'admin'
                              ? [{ label: 'Twee-stapsverificatie resetten', icon: <ShieldOff size={16} />, onClick: () => setMfaResetUser(u) }]
                              : []),
                            {
                              label: u.isActive !== false ? 'Gebruiker pauzeren' : 'Gebruiker activeren',
                              icon: u.isActive !== false ? <Pause size={16} /> : <Play size={16} />,
                              disabled: u.isActive !== false && isProtectedAdmin(u),
                              onClick: () => { void quickToggleActive(u); },
                            },
                            ...(u.isActive !== false
                              ? [{ label: 'Uit dienst', icon: <UserX size={16} />, disabled: u.id === currentUser.id || isProtectedAdmin(u), onClick: () => openUitDienst(u) }]
                              : []),
                            { label: 'Gebruiker verwijderen', icon: <Trash2 size={16} />, gevaarlijk: true, scheiding: true, disabled: isProtectedAdmin(u), onClick: () => setConfirmDeleteId(u.id) },
                          ]}
                        />
                      </div>
                    </Td>
                  </LijstRij>
                ))}
                </LijstAnimatie>
              </tbody>
            </table>
          </div>
        )}
        <div className="md:hidden divide-y divide-hairline-subtle">
          <LijstAnimatie aantal={sortedUsers.length}>
          {sortedUsers.map((u) => (
            <LijstRij as="div" key={u.id} className={cn('p-5 space-y-4 active:bg-slate-50 transition-colors', selectedIds.has(u.id) && 'bg-slate-100/60')}>
              <div className="flex justify-between items-start gap-3">
                <div className="flex items-start gap-2">
                  <Checkbox
                    checked={selectedIds.has(u.id)}
                    disabled={isBulkProtected(u)}
                    onChange={() => toggleSelect(u.id)}
                    label={`Selecteer ${u.name}`}
                    className={cn('-ml-3 -mt-3', isBulkProtected(u) && 'opacity-30')}
                  />
                  <Avatar naam={u.name} size="md" />
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
                  <AccountBadge actief={u.isActive !== false} />
                  {pushUserIds.has(String(u.id))
                    ? <Badge tone="emerald" stil>Meldingen aan</Badge>
                    : <Badge tone="slate" stil>Meldingen uit</Badge>}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 pt-1">
                <Card tone="muted" padding="sm"><MicroLabel>Laatst actief</MicroLabel><p className="mt-1 text-sm font-semibold text-slate-700 tabular-nums">{u.lastLogin ? formatDateTimeHuman(u.lastLogin) : 'Nooit'}</p></Card>
                <Card tone="muted" padding="sm"><MicroLabel>Toestellen</MicroLabel><p className="mt-1 text-sm font-semibold text-slate-700 tabular-nums">{toestellenPerUser.get(String(u.id)) ?? 0}</p></Card>
              </div>
              <div className="flex gap-2 pt-1">
                <Button variant="secondary" className="flex-1" onClick={() => setEditingUser(u)}>Bewerken</Button>
                <IconButton label="Verlof- en dienstruilhistoriek" variant="ghost" onClick={() => setViewingHistoryUser(u)}><Info size={18} /></IconButton>
                <IconButton label="Documenten beheren" variant="ghost" onClick={() => setDocumentsUser(u)}><FolderOpen size={18} /></IconButton>
                <IconButton label="Wijzigingsgeschiedenis" variant="ghost" onClick={() => setViewingChangeLogUser(u)}><History size={18} /></IconButton>
                <IconButton label={isProtectedAdmin(u) ? 'Laatste actieve admin kan niet verwijderd worden' : 'Gebruiker verwijderen'} variant="danger" onClick={() => !isProtectedAdmin(u) && setConfirmDeleteId(u.id)} disabled={isProtectedAdmin(u)}><Trash2 size={18} /></IconButton>
                <IconButton label="Nieuw tijdelijk wachtwoord instellen" variant="ghost" onClick={() => setConfirmResetUser(u)}><RotateCcw size={18} /></IconButton>
                {u.isActive !== false && (
                  <IconButton label="Uit dienst" variant="ghost" onClick={() => openUitDienst(u)} disabled={u.id === currentUser.id || isProtectedAdmin(u)}><UserX size={18} /></IconButton>
                )}
              </div>
            </LijstRij>
          ))}
          </LijstAnimatie>
        </div>
        {sortedUsers.length === 0 && (
          <div className="p-6">
            {filterActief ? (
              <EmptyState
                illustratie={<NietGevonden />}
                title={userSearch.trim() ? `Geen resultaten voor “${userSearch.trim()}”` : 'Geen gebruikers voor deze filter'}
                message="Pas de zoekterm of de filters aan."
                action={<Button variant="secondary" onClick={wisFilters}>Zoekterm en filters wissen</Button>}
              />
            ) : (
              <EmptyState
                illustratie={<LegeLijst />}
                title="Nog geen gebruikers"
                message="Voeg een medewerker toe of importeer een Excel-bestand."
                action={<Button variant="secondary" icon={<Plus size={16} />} onClick={() => setShowAddModal(true)}>Gebruiker toevoegen</Button>}
              />
            )}
          </div>
        )}
      </div>

      <ConfirmationModal open={!!confirmDeleteId} onClose={() => setConfirmDeleteId(null)} onConfirm={handleDeleteUser} title="Gebruiker verwijderen" message="Weet je zeker dat je deze gebruiker wilt verwijderen? Deze actie kan niet ongedaan worden gemaakt." />
      <ConfirmationModal open={confirmBulkDelete} onClose={() => setConfirmBulkDelete(false)} onConfirm={handleBulkDelete} title="Gebruikers verwijderen" message={`Weet je zeker dat je ${selectedIds.size} geselecteerde gebruiker(s) wilt verwijderen? Beschermde accounts (jezelf, de laatste actieve admin) worden overgeslagen. Dit kan niet ongedaan worden gemaakt.`} confirmText="Verwijderen" variant="warning" />
      <ConfirmationModal open={!!pendingImportUsers} onClose={() => { setPendingImportUsers(null); setPendingImportMessage(''); }} onConfirm={handleConfirmImport} title="Gebruikers importeren" message={pendingImportMessage || 'Wil je deze import toepassen?'} confirmText="Importeren" variant="warning" />
      <ConfirmationModal open={!!confirmNaamBotsing} onClose={() => setConfirmNaamBotsing(null)} onConfirm={() => { const poort = confirmNaamBotsing; setConfirmNaamBotsing(null); poort?.doorgaan(); }} title="Naam bestaat al" message={confirmNaamBotsing?.melding ?? ''} confirmText="Toch opslaan" variant="warning" />

      <Modal open={showAddModal} onClose={() => setShowAddModal(false)} vuil={nieuwVuil} className="flex flex-col !p-0">
        <ModalHeader title="Nieuwe gebruiker" description="Voeg handmatig een medewerker toe." />
        <Formulier onVerstuur={handleAddUser} className="p-6 md:p-7 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Volledige naam"
              htmlFor="nieuw-naam"
              className="sm:col-span-2"
              error={nieuwFouten.name}
              hint={vindNaamBotsingen(newUser.name, users).length > 0 ? <span className="font-medium text-amber-700">Er bestaat al een account met deze naam, een tweede maakt de naam onkoppelbaar in de planning.</span> : undefined}
            >
              <Input id="nieuw-naam" type="text" autoComplete="name" required value={newUser.name} onChange={(e) => { setNewUser({ ...newUser, name: e.target.value }); nieuwF.wisVeld('name'); }} placeholder="bv. Jan Janssen" />
            </Field>
            <Field label="Rol" htmlFor="nieuw-rol" error={nieuwFouten.role}><Select id="nieuw-rol" value={newUser.role} onChange={(e) => { setNewUser({ ...newUser, role: e.target.value }); nieuwF.wisVeld('role'); }}>{ROLLEN.map((r) => <option key={r} value={r}>{ROL_LABELS[r]}</option>)}</Select></Field>
            <Field label="Personeelsnummer" htmlFor="nieuw-personeelsnr" error={nieuwFouten.employeeId}><Input id="nieuw-personeelsnr" invalid={!!nieuwFouten.employeeId} type="text" autoComplete="off" value={newUser.employeeId} onChange={(e) => { setNewUser({ ...newUser, employeeId: e.target.value }); nieuwF.wisVeld('employeeId'); }} placeholder="Optioneel" /></Field>
            <Field label="E-mailadres" htmlFor="nieuw-email" className="sm:col-span-2" error={nieuwFouten.email}><Input id="nieuw-email" invalid={!!nieuwFouten.email} type="email" autoComplete="email" inputMode="email" required value={newUser.email} onChange={(e) => { setNewUser({ ...newUser, email: e.target.value }); nieuwF.wisVeld('email'); }} placeholder="bv. jan@voorbeeld.be" /></Field>
            <Field label="Tijdelijk wachtwoord" htmlFor="nieuw-wachtwoord" error={nieuwFouten.password}><Input id="nieuw-wachtwoord" invalid={!!nieuwFouten.password} type="password" autoComplete="new-password" value={newUser.password} onChange={(e) => { setNewUser({ ...newUser, password: e.target.value }); nieuwF.wisVeld('password'); }} placeholder={`Minstens ${WACHTWOORD_MIN} tekens`} /></Field>
            <Field label="GSM-nummer" htmlFor="nieuw-gsm" error={nieuwFouten.phone}><Input id="nieuw-gsm" invalid={!!nieuwFouten.phone} type="tel" autoComplete="tel" inputMode="tel" value={newUser.phone} onChange={(e) => { setNewUser({ ...newUser, phone: e.target.value }); nieuwF.wisVeld('phone'); }} placeholder="Optioneel" /></Field>
          </div>
          <div className="flex gap-3 pt-2">
            <SluitKnop onClose={() => setShowAddModal(false)} variant="ghost" className="flex-1" disabled={isSubmittingUser}>Annuleren</SluitKnop>
            <Button type="submit" variant="primary" className="flex-1" bezig={isSubmittingUser}>Toevoegen</Button>
          </div>
        </Formulier>
      </Modal>

      <Modal open={!!editingUser} onClose={() => setEditingUser(null)} vuil={bewerkVuil} maxWidth="lg" className="flex flex-col !p-0">
        {editingUser && (
          <>
            <ModalHeader title="Gebruiker bewerken" description={`Pas de gegevens van ${editingUser.name} aan.`} />
            <Formulier onVerstuur={handleUpdateUser} className="p-6 md:p-7 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Volledige naam"
                  htmlFor="bewerk-naam"
                  className="sm:col-span-2"
                  error={bewerkFouten.name}
                  hint={vindNaamBotsingen(editingUser.name, users, editingUser.id).length > 0 ? <span className="font-medium text-amber-700">Er bestaat al een ander account met deze naam, de naam is dan niet aan de planning te koppelen.</span> : undefined}
                >
                  <Input id="bewerk-naam" type="text" autoComplete="name" required value={editingUser.name} onChange={(e) => { setEditingUser({ ...editingUser, name: e.target.value }); bewerkF.wisVeld('name'); }} />
                </Field>
                <Field label="Rol" htmlFor="bewerk-rol" error={bewerkFouten.role}><Select id="bewerk-rol" value={editingUser.role} onChange={(e) => { setEditingUser({ ...editingUser, role: e.target.value as any }); bewerkF.wisVeld('role'); }}>{ROLLEN.map((r) => <option key={r} value={r}>{ROL_LABELS[r]}</option>)}</Select></Field>
                <Field label="Personeelsnummer" htmlFor="bewerk-personeelsnr" error={bewerkFouten.employeeId}><Input id="bewerk-personeelsnr" invalid={!!bewerkFouten.employeeId} type="text" autoComplete="off" value={editingUser.employeeId} onChange={(e) => { setEditingUser({ ...editingUser, employeeId: e.target.value }); bewerkF.wisVeld('employeeId'); }} /></Field>
                <Field label="E-mailadres" htmlFor="bewerk-email" className="sm:col-span-2" error={bewerkFouten.email}><Input id="bewerk-email" invalid={!!bewerkFouten.email} type="email" autoComplete="email" inputMode="email" value={editingUser.email || ''} onChange={(e) => { setEditingUser({ ...editingUser, email: e.target.value }); bewerkF.wisVeld('email'); }} placeholder="bv. jan@voorbeeld.be" /></Field>
                <Field label="Nieuw wachtwoord" htmlFor="bewerk-wachtwoord" error={bewerkFouten.password}><Input id="bewerk-wachtwoord" invalid={!!bewerkFouten.password} type="password" autoComplete="new-password" value={editingUser.password || ''} onChange={(e) => { setEditingUser({ ...editingUser, password: e.target.value }); bewerkF.wisVeld('password'); }} placeholder="Optioneel" /></Field>
                <Field label="GSM-nummer" htmlFor="bewerk-gsm" error={bewerkFouten.phone}><Input id="bewerk-gsm" invalid={!!bewerkFouten.phone} type="tel" autoComplete="tel" inputMode="tel" value={editingUser.phone || ''} onChange={(e) => { setEditingUser({ ...editingUser, phone: e.target.value }); bewerkF.wisVeld('phone'); }} placeholder="Optioneel" /></Field>
                {editingUser.role === 'chauffeur' && (
                  <Field label="Sectie (maandplanning)" htmlFor="bewerk-sectie" error={bewerkFouten.section}><Select id="bewerk-sectie" value={editingUser.section || ''} onChange={(e) => { setEditingUser({ ...editingUser, section: e.target.value || undefined }); bewerkF.wisVeld('section'); }}><option value="">Geen sectie</option><option value="Reguliere">Reguliere</option><option value="Nacht">Nacht</option><option value="Flexi">Flexi</option><option value="Schoolvervoer">Schoolvervoer</option></Select></Field>
                )}
                <Field label="In dienst sinds" htmlFor="bewerk-startdatum" error={bewerkFouten.startDate} hint="Bepaalt de anciënniteit-volgorde binnen een sectie in de Maandplanning."><DateInput id="bewerk-startdatum" invalid={Boolean(bewerkFouten.startDate)} value={editingUser.startDate || ''} onChange={(v) => { setEditingUser({ ...editingUser, startDate: v || undefined }); bewerkF.wisVeld('startDate'); }} /></Field>
                <Field label="Verlofbudget (dagen)" htmlFor="bewerk-verlofbudget" className="sm:col-span-2" error={bewerkFouten.verlofBudget} hint="Vul in om af te wijken van de standaard 24 dagen (bv. anciënniteits-toeslag, deeltijds).">
                  <Input
                    id="bewerk-verlofbudget"
                    type="number"
                    inputMode="numeric"
                    min={0}
                    value={editingUser.verlofBudget ?? ''}
                    onChange={(e) => {
                      const v = e.target.value;
                      setEditingUser({ ...editingUser, verlofBudget: v === '' ? undefined : Math.max(0, parseInt(v, 10) || 0) });
                      bewerkF.wisVeld('verlofBudget');
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
                          <DateInput
                            id={`bewerk-verval-${soort}`}
                            value={vervalDraft[soort] ?? ''}
                            onChange={(v) => setVervalDraft((d) => ({ ...d, [soort]: v }))}
                          />
                        </Field>
                      ))}
                    </div>
                    <p className="text-xs text-slate-500">Het portaal verwittigt de chauffeur en de planning automatisch op 90, 30 en 7 dagen voor de vervaldatum. Leeg = niet bewaken.</p>
                  </fieldset>
                )}
              </div>
              {/* data-fout: focusEersteFout vindt de schakelaar bij de
                  laatste-admin-fout (tranche 3A). */}
              <div className="space-y-1.5" data-fout={bewerkFouten.isActive ? '' : undefined}>
                <Card tone="muted" padding="sm" className="flex items-center justify-between">
                  <div><p className="text-sm font-semibold text-slate-700">Account actief</p><p className="text-xs text-slate-500">Inactieve gebruikers kunnen niet inloggen.</p></div>
                  <Switch checked={editingUser.isActive !== false} onChange={(aan) => { setEditingUser({ ...editingUser, isActive: aan }); bewerkF.wisVeld('isActive'); }} label="Account actief" />
                </Card>
                {bewerkFouten.isActive ? <p role="alert" className="text-xs font-medium text-red-700">{bewerkFouten.isActive}</p> : null}
              </div>
              <Card tone="muted" padding="sm" className="flex items-center justify-between">
                <div><p className="text-sm font-semibold text-slate-700">Tonen in contactlijst</p><p className="text-xs text-slate-500">Uit = deze persoon staat niet in de contactlijst voor collega's.</p></div>
                <Switch checked={editingUser.showInContacts !== false} onChange={(aan) => setEditingUser({ ...editingUser, showInContacts: aan })} label="Tonen in contactlijst" />
              </Card>
              {editingUser.role === 'admin' && (
                <Card tone="muted" padding="sm" className="flex items-center justify-between">
                  <div><p className="text-sm font-semibold text-slate-700">Systeemmails</p><p className="text-xs text-slate-500">Foutendigest en back-up-mails van het portaal. Uit = deze admin ontvangt ze niet.</p></div>
                  <Switch checked={editingUser.wantsSystemMail !== false} onChange={(aan) => setEditingUser({ ...editingUser, wantsSystemMail: aan })} label="Systeemmails" />
                </Card>
              )}
              <div className="grid grid-cols-2 gap-4"><Card tone="muted" padding="sm"><MicroLabel>Laatst actief</MicroLabel><p className="text-sm font-semibold text-slate-700 tabular-nums mt-1">{editingUser.lastLogin ? formatDateTimeHuman(editingUser.lastLogin) : 'Nooit'}</p></Card><Card tone="muted" padding="sm"><MicroLabel>Toestellen</MicroLabel><p className="text-sm font-semibold text-slate-700 tabular-nums mt-1">{toestellenPerUser.get(String(editingUser.id)) ?? 0}</p></Card></div>
              {/* Verwijderknop stond in de kop; de gedeelde ModalHeader heeft
                  daar geen slot voor, dus links in de knoppenrij (zelfde
                  gedrag, zelfde bescherming; controle-ronde 27-08). */}
              <div className="flex gap-3 pt-2"><IconButton label={isProtectedAdmin(editingUser) ? 'Laatste actieve admin kan niet verwijderd worden' : 'Gebruiker verwijderen'} variant="danger" onClick={() => !isProtectedAdmin(editingUser) && setConfirmDeleteId(editingUser.id)} disabled={isProtectedAdmin(editingUser)}><Trash2 size={16} /></IconButton><SluitKnop onClose={() => setEditingUser(null)} variant="ghost" className="flex-1" disabled={isSubmittingUser}>Annuleren</SluitKnop><Button type="submit" variant="primary" className="flex-1" bezig={isSubmittingUser}>Opslaan</Button></div>
            </Formulier>
          </>
        )}
      </Modal>

      <Modal open={!!confirmResetUser} onClose={sluitReset} className="flex flex-col !p-0">
        {confirmResetUser && (
          <>
            <ModalHeader title="Wachtwoord resetten" description={`Stel een nieuw tijdelijk wachtwoord in voor ${confirmResetUser.name}.`} />
            <Formulier onVerstuur={handleResetPassword} className="p-6 md:p-7 space-y-4">
              <Field label="Tijdelijk wachtwoord" htmlFor="reset-wachtwoord" hint="De gebruiker logt daarna in met dit nieuwe wachtwoord." error={resetF.fouten.password}>
                <Input id="reset-wachtwoord" type="password" autoComplete="new-password" value={resetPasswordValue} onChange={(e) => { setResetPasswordValue(e.target.value); resetF.wisVeld('password'); }} placeholder={`Minstens ${WACHTWOORD_MIN} tekens`} autoFocus />
              </Field>
              <div className="flex gap-3 pt-2"><SluitKnop onClose={sluitReset} variant="ghost" className="flex-1" disabled={isResettingPassword}>Annuleren</SluitKnop><Button type="submit" variant="primary" className="flex-1" bezig={isResettingPassword}>Resetten</Button></div>
            </Formulier>
          </>
        )}
      </Modal>

      <ConfirmationModal
        open={!!mfaResetUser}
        onClose={() => setMfaResetUser(null)}
        onConfirm={() => { void handleMfaReset(); }}
        title="Twee-stapsverificatie resetten?"
        variant="warning"
        confirmText="Ja, resetten"
        message={`De authenticator-koppeling van ${mfaResetUser?.name ?? ''} wordt verwijderd. Bij de volgende aanmelding stelt ${mfaResetUser?.name ?? 'de collega'} twee-stapsverificatie opnieuw in. Doe dit alleen op vraag van de collega zelf.`}
      />

      <Modal open={!!uitDienstUser} onClose={sluitUitDienst} vuil={uitDienstVuil} className="flex flex-col !p-0" ariaLabel="Uit dienst">
        {uitDienstUser && (
          <>
            <ModalHeader title="Uit dienst" description={`${uitDienstUser.name} gaat uit dienst. Dit gebeurt in één keer:`} />
            <Formulier onVerstuur={handleUitDienst} className="p-6 md:p-7 space-y-5">
              <ul className="space-y-2 text-sm text-slate-700">
                <li className="flex items-start gap-2.5"><Pause size={16} className="mt-0.5 shrink-0 text-slate-500" /><span>Account deactiveren, inloggen is niet meer mogelijk.</span></li>
                <li className="flex items-start gap-2.5">
                  <UserX size={16} className="mt-0.5 shrink-0 text-slate-500" />
                  <span>
                    {uitDienstToestellen === null
                      ? 'Toestellen tellen…'
                      : uitDienstToestellen === 0
                        ? 'Geen toestellen om in te trekken.'
                        : `${uitDienstToestellen} toestel${uitDienstToestellen === 1 ? '' : 'len'} intrekken.`}
                  </span>
                </li>
                <li className="flex items-start gap-2.5"><Send size={16} className="mt-0.5 shrink-0 text-slate-500" /><span>Pushmeldingen stoppen.</span></li>
                <li className="flex items-start gap-2.5"><CalendarOff size={16} className="mt-0.5 shrink-0 text-slate-500" /><span>De agenda-koppeling vervalt.</span></li>
              </ul>
              <Field label="Reden (optioneel)" htmlFor="uitdienst-reden" hint="Komt in het activiteitenlogboek.">
                <Input id="uitdienst-reden" value={uitDienstReden} onChange={(e) => setUitDienstReden(e.target.value)} placeholder="Bv. einde contract" maxLength={200} />
              </Field>
              <p className="text-micro text-slate-500">Terugdraaien kan via “Gebruiker activeren”; toestellen keur je daarna opnieuw goed.</p>
              <div className="flex gap-3 pt-1">
                <SluitKnop onClose={sluitUitDienst} variant="ghost" className="flex-1" disabled={isUitDienstBezig}>Annuleren</SluitKnop>
                <Button type="submit" variant="primary" className="flex-1" bezig={isUitDienstBezig}>Uit dienst zetten</Button>
              </div>
            </Formulier>
          </>
        )}
      </Modal>

      <CredentialsModal
        open={!!credentialsModal}
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

/** Accountstatus uit ACCOUNT_STATUS: kaal in de tabelcel, stil op de kaart. */
function AccountBadge({ actief, kaal = false }: { actief: boolean; kaal?: boolean }) {
  const s = ACCOUNT_STATUS[actief ? 'actief' : 'gepauzeerd'];
  return <Badge tone={TOON_NAAR_BADGE[s.toon]} kaal={kaal} stil={!kaal}>{s.label}</Badge>;
}
