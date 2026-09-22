import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search, ShieldAlert, ShieldCheck, Smartphone, Trash2, X } from 'lucide-react';
import type { User } from '../../types';
import { apiJson } from '../../lib/api';
import { getDeviceToken } from '../../lib/device';
import { cn, notify } from '../../lib/ui';
import { formatDateHuman } from '../../lib/format';
import { ConfirmationModal, EmptyState, PageHeader, PageShell } from '../../components/ui';
import { Badge, Button, FilterChip, IconButton, StatusBadge, Switch, statusAccentClass } from '../../components/primitives';
import { TOESTEL_STATUS, statusLabel } from '../../../shared/status';
import { Uitklap, uitklapChevron } from '../../components/Uitklap';
import { Card } from '../../components/Card';
import { Avatar } from '../../components/Avatar';
import { InfoTip } from '../../components/InfoTip';
import { Field, Input } from '../../components/Field';
import { Formulier } from '../../components/Formulier';
import { SkeletonRow } from '../../components/Skeleton';
import { DetailPaneel, MasterDetail, useStandaardKeuze } from '../../components/DetailPaneel';
import { meldSchrijffout } from '../../lib/fouten';

type Device = {
  userId: string;
  deviceToken: string;
  name: string;
  status: 'approved' | 'pending' | 'revoked';
  createdAt: string;
  lastSeenAt: string;
};

type StatusFilter = 'all' | Device['status'];

export function DevicesView({ users, currentUserId }: { users: User[]; currentUserId: string }) {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Device | null>(null);
  // Het gekozen toestel leeft als sleutel, niet als object: na elke herlaad
  // (goedkeuren, hernoemen) toont het paneel zo de verse rij, en na schrappen
  // sluit het vanzelf.
  const [gekozenKey, setGekozenKey] = useState<string | null>(null);
  const [naamOntwerp, setNaamOntwerp] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  // Zoeken op gebruiker of toestelnaam + statusfilter over de gegroepeerde lijst.
  const [zoek, setZoek] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const ownToken = getDeviceToken();
  const userName = useCallback((id: string) => users.find((u) => String(u.id) === String(id))?.name ?? `Onbekende gebruiker (${id})`, [users]);
  const keyOf = (d: Device) => `${d.userId}:${d.deviceToken}`;
  const isOwnCurrent = (d: Device) => String(d.userId) === String(currentUserId) && d.deviceToken === ownToken;

  const load = async () => {
    try {
      setDevices(await apiJson<Device[]>('/api/devices'));
    } catch (err) {
      meldSchrijffout('Toestellen laden', err, () => void load());
      setDevices([]);
    }
  };
  useEffect(() => { void load(); }, []);

  // Schakelaar "toestel-goedkeuring vereist" (default aan; instelling leeft
  // server-side in app_settings).
  const [gateEnabled, setGateEnabled] = useState<boolean | null>(null);
  const [isTogglingGate, setIsTogglingGate] = useState(false);
  useEffect(() => {
    void (async () => {
      try {
        const data = await apiJson<{ enabled: boolean }>('/api/devices/gate');
        setGateEnabled(data.enabled);
      } catch {
        setGateEnabled(true);
      }
    })();
  }, []);
  const toggleGate = async () => {
    if (gateEnabled === null || isTogglingGate) return;
    const next = !gateEnabled;
    setIsTogglingGate(true);
    try {
      await apiJson('/api/devices/gate', { method: 'POST', body: JSON.stringify({ enabled: next }) });
      setGateEnabled(next);
      notify(next
        ? 'Toestel-goedkeuring staat weer aan: nieuwe toestellen wachten op jouw akkoord.'
        : 'Toestel-goedkeuring staat uit: elk toestel wordt bij aanmelden automatisch goedgekeurd.', 'success');
    } catch (err) {
      meldSchrijffout('Instelling opslaan', err, () => void toggleGate());
    } finally {
      setIsTogglingGate(false);
    }
  };

  const act = async (device: Device, action: 'approve' | 'revoke' | 'delete') => {
    setBusyKey(keyOf(device));
    try {
      await apiJson(`/api/devices/${action}`, {
        method: 'POST',
        body: JSON.stringify({ userId: device.userId, deviceToken: device.deviceToken }),
      });
      notify(
        action === 'approve' ? 'Toestel goedgekeurd.' : action === 'revoke' ? 'Toestel geblokkeerd.' : 'Toestel geschrapt.',
        'success',
      );
      await load();
    } catch (err) {
      meldSchrijffout(action === 'approve' ? 'Goedkeuren' : action === 'revoke' ? 'Blokkeren' : 'Schrappen', err, () => void act(device, action));
    } finally {
      setBusyKey(null);
    }
  };

  const kies = (device: Device) => {
    setGekozenKey(keyOf(device));
    setNaamOntwerp(device.name);
  };

  const submitRename = async (device: Device) => {
    const naam = naamOntwerp.trim();
    if (!naam || naam === device.name || isRenaming) return;
    setIsRenaming(true);
    try {
      await apiJson('/api/devices/rename', {
        method: 'POST',
        body: JSON.stringify({ userId: device.userId, deviceToken: device.deviceToken, name: naam }),
      });
      await load();
      notify('Toestel hernoemd.', 'success');
    } catch (err) {
      meldSchrijffout('Hernoemen', err, () => void submitRename(device));
    } finally {
      setIsRenaming(false);
    }
  };

  // Groepen standaard dichtgeklapt: met tientallen gebruikers is de lijst
  // anders metershoog. Openklappen per gebruiker (wens Jarno). Zodra je
  // zoekt of filtert klappen de gevonden groepen vanzelf open — anders zie
  // je wel de naam maar niet het toestel dat matchte.
  const [openUsers, setOpenUsers] = useState<string[]>([]);
  const toggleUser = (id: string) => setOpenUsers((cur) => (
    cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
  ));

  const alle = useMemo(() => devices ?? [], [devices]);
  const pending = useMemo(() => alle.filter((d) => d.status === 'pending'), [alle]);
  const gekozen = alle.find((d) => keyOf(d) === gekozenKey) ?? null;
  const zoekTerm = zoek.trim().toLowerCase();
  const filterActief = zoekTerm !== '' || statusFilter !== 'all';
  const zichtbaar = useMemo(() => alle.filter((d) => {
    if (statusFilter !== 'all' && d.status !== statusFilter) return false;
    if (!zoekTerm) return true;
    return `${userName(d.userId)} ${d.name}`.toLowerCase().includes(zoekTerm);
  }), [alle, statusFilter, zoekTerm, userName]);
  const wisFilters = () => { setZoek(''); setStatusFilter('all'); };

  // Eén lijst: wachtende toestellen eerst, binnen het gekozen filter.
  // De detailkeuze mag nooit een weggefilterd toestel terughalen.
  const volgorde = useMemo(
    () => [...zichtbaar].sort((a, b) =>
      Number(b.status === 'pending') - Number(a.status === 'pending')
      || userName(a.userId).localeCompare(userName(b.userId), 'nl'),
    ),
    [zichtbaar, userName],
  );
  const wisKeuze = useCallback(() => setGekozenKey(null), []);
  useStandaardKeuze({
    items: volgorde,
    sleutelVan: keyOf,
    gekozen: gekozenKey,
    kies: (d) => {
      kies(d);
      setOpenUsers((cur) => (cur.includes(String(d.userId)) ? cur : [...cur, String(d.userId)]));
    },
    wis: wisKeuze,
  });
  // Groepeer binnen het filter; ook binnen elke groep staan wachtende
  // toestellen vooraan.
  const byUser = new Map<string, Device[]>();
  for (const d of volgorde) {
    const list = byUser.get(String(d.userId)) ?? [];
    list.push(d);
    byUser.set(String(d.userId), list);
  }
  const telPerStatus = (status: Device['status']) => alle.filter((d) => d.status === status).length;

  // De lijst behoudt de groepering per gebruiker. Naam, telling en chevron
  // hebben elk een eigen kolom, zodat lange namen de uitlijning niet breken.
  const groepen = [...byUser.entries()].sort(([a, da], [b, db]) =>
    Number(db.some((d) => d.status === 'pending')) - Number(da.some((d) => d.status === 'pending'))
    || userName(a).localeCompare(userName(b), 'nl'),
  );

  const lijst = (
    <Card padding="none" className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-4 py-4 sm:px-5">
        <h2 className="text-card-title">Gebruikers</h2>
        <span className="text-xs text-slate-500">{devices === null ? 'Laden…' : `${groepen.length} ${groepen.length === 1 ? 'gebruiker' : 'gebruikers'}`}</span>
      </div>
      {devices === null ? (
        <div className="divide-y divide-hairline-subtle" role="status" aria-busy="true" aria-label="Toestellen worden geladen">
          <SkeletonRow className="px-5 py-4" />
          <SkeletonRow className="px-5 py-4" />
          <SkeletonRow className="px-5 py-4" />
        </div>
      ) : devices.length === 0 ? (
        <div className="p-5">
          <EmptyState icon={<Smartphone size={20} />} title="Nog geen toestellen" message="Toestellen verschijnen hier zodra gebruikers inloggen." />
        </div>
      ) : zichtbaar.length === 0 ? (
        <div className="p-5">
          <EmptyState
            compact
            title={zoekTerm ? `Geen resultaten voor “${zoek.trim()}”` : 'Geen toestellen met deze status'}
            message="Pas de zoekterm of het statusfilter aan."
            action={<Button variant="secondary" size="sm" onClick={wisFilters}>Wis filters</Button>}
          />
        </div>
      ) : (
        <div className="divide-y divide-hairline-subtle">
          {groepen.map(([userId, list]) => {
            const open = filterActief || openUsers.includes(userId);
            const wacht = list.filter((d) => d.status === 'pending').length;
            return (
              <div key={userId} className="p-2 sm:px-3">
                {/* rauw: groepsknop met avatar, naam, telling en uitklapindicator */}
                <button
                  type="button"
                  onClick={() => toggleUser(userId)}
                  aria-expanded={open}
                  className="grid min-h-14 w-full grid-cols-[2rem_minmax(0,1fr)_auto_1rem] items-center gap-3 rounded-xl px-2 py-2.5 text-left transition-colors hover:bg-surface-soft-hover"
                >
                  <Avatar naam={userName(userId)} />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-800 [overflow-wrap:anywhere]">{userName(userId)}</span>
                    {wacht > 0 && <span className="mt-0.5 block text-xs font-medium text-amber-800">{wacht} wacht op goedkeuring</span>}
                  </span>
                  <span className="whitespace-nowrap text-xs text-slate-500">{list.length} {list.length === 1 ? 'toestel' : 'toestellen'}</span>
                  <ChevronDown size={16} className={uitklapChevron(open, 180, 'text-slate-500')} />
                </button>
                <Uitklap open={open}>
                  <div className="space-y-1 pb-2 pt-1">
                    {list.map((device) => {
                      const isCurrent = keyOf(device) === gekozenKey;
                      return (
                        <div key={keyOf(device)} className={cn('flex items-center gap-2 rounded-xl px-2', isCurrent && 'bg-surface-muted ring-1 ring-hairline')}>
                          {/* rauw: toestelrij opent het detail; snelle goedkeuring is een aparte knop */}
                          <button
                            type="button"
                            onClick={() => kies(device)}
                            aria-current={isCurrent ? 'true' : undefined}
                            className="group flex min-h-14 min-w-0 flex-1 items-center gap-3 rounded-lg py-2 text-left transition-colors hover:bg-surface-soft-hover"
                          >
                            <span className="flex h-8 w-8 shrink-0 items-center justify-center text-slate-500"><Smartphone size={18} /></span>
                            <span className="min-w-0 flex-1">
                              <span className="block text-sm font-semibold text-slate-800 [overflow-wrap:anywhere]">{device.name}</span>
                              <span className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                                <span aria-hidden="true" className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusAccentClass(device.status, TOESTEL_STATUS))} />
                                {statusLabel(TOESTEL_STATUS, device.status)}
                                {isOwnCurrent(device) && <span>· Dit toestel</span>}
                              </span>
                            </span>
                            <ChevronRight size={14} className="shrink-0 text-slate-500" />
                          </button>
                          {device.status === 'pending' && (
                            <Button variant="secondary" size="sm" className="shrink-0" disabled={busyKey === keyOf(device)} onClick={() => void act(device, 'approve')} aria-label={`Keur ${device.name} van ${userName(userId)} goed`}>
                              Keur goed
                            </Button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Uitklap>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );

  const bezig = gekozen !== null && busyKey === keyOf(gekozen);
  const paneel = (
    <DetailPaneel
      open={!!gekozen}
      onClose={() => setGekozenKey(null)}
      title={gekozen?.name ?? 'Toestel'}
      subtitle={gekozen ? userName(gekozen.userId) : undefined}
      sleutel={gekozenKey ?? undefined}
      leegTekst="Kies een toestel."
      titelTerugloop
      icon={(
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-slate-500">
          <Smartphone size={16} />
        </span>
      )}
      footer={gekozen ? (
        <div className="flex flex-wrap items-center gap-3">
          {gekozen.status !== 'approved' && (
            <Button variant="primary" size="lg" className="flex-1" icon={<ShieldCheck size={16} />} disabled={bezig} onClick={() => void act(gekozen, 'approve')}>
              Keur goed
            </Button>
          )}
          {gekozen.status === 'approved' && !isOwnCurrent(gekozen) && (
            <Button variant="secondary" size="lg" className="flex-1" icon={<ShieldAlert size={16} />} disabled={bezig} onClick={() => void act(gekozen, 'revoke')}>
              Blokkeer
            </Button>
          )}
          {!isOwnCurrent(gekozen) && (
            <Button variant="ghost" icon={<Trash2 size={16} />} disabled={bezig} onClick={() => setConfirmDelete(gekozen)}>
              Schrappen
            </Button>
          )}
          {isOwnCurrent(gekozen) && (
            <p className="flex-1 text-xs text-slate-500">Dit is het toestel waarmee je nu bent aangemeld, blokkeren of schrappen kan niet.</p>
          )}
        </div>
      ) : undefined}
    >
      {gekozen && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={gekozen.status} map={TOESTEL_STATUS} stil />
            {isOwnCurrent(gekozen) && <Badge tone="blue" stil>Dit toestel</Badge>}
          </div>
          <dl className="divide-y divide-hairline-subtle text-sm">
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 pb-3">
              <dt className="text-slate-500">Gebruiker</dt>
              <dd className="font-medium text-slate-800 [overflow-wrap:anywhere]">{userName(gekozen.userId)}</dd>
            </div>
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 py-3">
              <dt className="text-slate-500">Geregistreerd</dt>
              <dd className="font-medium text-slate-800">{formatDateHuman(gekozen.createdAt)}</dd>
            </div>
            <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4 py-3">
              <dt className="text-slate-500">Laatst gezien</dt>
              <dd className="font-medium text-slate-800">{formatDateHuman(gekozen.lastSeenAt)}</dd>
            </div>
          </dl>
          <Formulier onVerstuur={() => submitRename(gekozen)}>
            <Field label="Toestelnaam" hint="Kies een herkenbare naam, bijvoorbeeld “iPhone van Jan”.">
              {({ id, describedBy }) => (
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input id={id} aria-describedby={describedBy} className="min-w-0 flex-1" value={naamOntwerp} onChange={(e) => setNaamOntwerp(e.target.value)} enterKeyHint="done" maxLength={80} />
                  <Button type="submit" variant="secondary" className="shrink-0" bezig={isRenaming} disabled={isRenaming || !naamOntwerp.trim() || naamOntwerp.trim() === gekozen.name}>Opslaan</Button>
                </div>
              )}
            </Field>
          </Formulier>

          {gekozen.status === 'revoked' && (
            <p className="text-xs text-slate-500">Geblokkeerd: dit toestel komt niet meer in de app, ook niet na opnieuw aanmelden. Keur het goed om de toegang te herstellen.</p>
          )}
        </div>
      )}
    </DetailPaneel>
  );

  return (
    <PageShell>
      <PageHeader
        view="toestellen"
        title="Toestellen"
      />

      <Card padding="sm">
        <div className="flex items-center gap-3 sm:gap-4">
          <ShieldCheck size={20} className="hidden shrink-0 text-slate-500 sm:block" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="text-subsection-title">Goedkeuring nieuwe toestellen</h2>
              <InfoTip label="Uitleg over toestelgoedkeuring">
                <p>Het eerste toestel van een chauffeur wordt automatisch goedgekeurd. Elk volgend toestel wacht op jouw akkoord.</p>
                <p className="mt-2">Zet je dit uit, dan worden nieuwe toestellen automatisch goedgekeurd. Geblokkeerde toestellen blijven geblokkeerd.</p>
              </InfoTip>
            </div>
            <p className="mt-1 text-xs text-slate-500">{gateEnabled === null ? 'Instelling laden…' : gateEnabled ? 'Nieuwe toestellen wachten op jouw akkoord.' : 'Nieuwe toestellen worden automatisch goedgekeurd.'}</p>
          </div>
          <span className="hidden shrink-0 text-xs font-medium text-slate-500 sm:inline">{gateEnabled === null ? '…' : gateEnabled ? 'Aan' : 'Uit'}</span>
          <Switch checked={gateEnabled !== false} onChange={() => void toggleGate()} label="Toestel-goedkeuring vereist" disabled={gateEnabled === null || isTogglingGate} />
        </div>
        {gateEnabled === false && (
          <p className="mt-3 border-t border-hairline pt-3 text-xs text-amber-800">Goedkeuring staat uit. Zet dit na de uitrol weer aan om nieuwe toestellen te beoordelen.</p>
        )}
      </Card>

      {/* Buiten de smalle lijstkolom: het zoekveld blijft bruikbaar en de
          statusfilters blijven één leesbare groep, ook rond het lg-breekpunt. */}
      <div className="space-y-3" role="search" aria-label="Toestellen zoeken en filteren">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-md">
            <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <Input type="search" aria-label="Zoek gebruiker of toestel" placeholder="Zoek gebruiker of toestel…" className="pl-10 pr-11" value={zoek} onChange={(e) => setZoek(e.target.value)} />
            {zoek && <IconButton label="Zoekopdracht wissen" size="sm" className="absolute right-1 top-1/2 -translate-y-1/2" onClick={() => setZoek('')}><X size={16} /></IconButton>}
          </div>
          <p className="shrink-0 text-xs text-slate-500" aria-live="polite">{devices === null ? 'Toestellen laden…' : `${zichtbaar.length} van ${alle.length} ${alle.length === 1 ? 'toestel' : 'toestellen'}`}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Filter op toestelstatus">
          <FilterChip active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>Alle toestellen</FilterChip>
          <FilterChip active={statusFilter === 'pending'} onClick={() => setStatusFilter(statusFilter === 'pending' ? 'all' : 'pending')}>{statusLabel(TOESTEL_STATUS, 'pending')} ({pending.length})</FilterChip>
          <FilterChip active={statusFilter === 'revoked'} onClick={() => setStatusFilter(statusFilter === 'revoked' ? 'all' : 'revoked')}>Geblokkeerd ({telPerStatus('revoked')})</FilterChip>
        </div>
      </div>

      <MasterDetail className="lg:grid-cols-[minmax(0,46%)_minmax(0,1fr)]" lijst={lijst} paneel={devices !== null && devices.length === 0 ? undefined : paneel} />

      <ConfirmationModal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) void act(confirmDelete, 'delete');
          setConfirmDelete(null);
        }}
        title="Toestel schrappen?"
        message={confirmDelete ? `“${confirmDelete.name}” van ${userName(confirmDelete.userId)} wordt uit de lijst verwijderd. Meldt deze gebruiker zich er opnieuw mee aan (en heeft die nog een ander toestel), dan verschijnt het weer als “wacht op goedkeuring”. Voor een verloren of gestolen toestel kies je beter Blokkeren.` : ''}
        confirmText="Schrappen"
      />
    </PageShell>
  );
}
