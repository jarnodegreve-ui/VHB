import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, ShieldAlert, ShieldCheck, Smartphone, Trash2 } from 'lucide-react';
import type { User } from '../../types';
import { apiJson } from '../../lib/api';
import { getDeviceToken } from '../../lib/device';
import { cn, notify } from '../../lib/ui';
import { formatDateHuman } from '../../lib/format';
import { ConfirmationModal, EmptyState, PageHeader, PageShell } from '../../components/ui';
import { Badge, Button, FilterChip, IconButton, MicroLabel, Switch } from '../../components/primitives';
import { TableToolbar } from '../../components/Table';
import { Card, CardHeader } from '../../components/Card';
import { Field, Input } from '../../components/Field';
import { SkeletonRow } from '../../components/Skeleton';
import { DetailPaneel, MasterDetail } from '../../components/DetailPaneel';

type Device = {
  userId: string;
  deviceToken: string;
  name: string;
  status: 'approved' | 'pending' | 'revoked';
  createdAt: string;
  lastSeenAt: string;
};

const STATUS_BADGE: Record<Device['status'], { tone: 'emerald' | 'amber' | 'red'; label: string }> = {
  approved: { tone: 'emerald', label: 'Goedgekeurd' },
  pending: { tone: 'amber', label: 'Wacht op goedkeuring' },
  revoked: { tone: 'red', label: 'Geblokkeerd' },
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
  const userName = (id: string) => users.find((u) => String(u.id) === String(id))?.name ?? `Onbekende gebruiker (${id})`;
  const keyOf = (d: Device) => `${d.userId}:${d.deviceToken}`;
  const isOwnCurrent = (d: Device) => String(d.userId) === String(currentUserId) && d.deviceToken === ownToken;

  const load = async () => {
    try {
      setDevices(await apiJson<Device[]>('/api/devices'));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Toestellen laden is mislukt.', 'error');
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
      notify(err instanceof Error ? err.message : 'Instelling opslaan is mislukt.', 'error');
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
      notify(err instanceof Error ? err.message : 'Actie is mislukt.', 'error');
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
      notify(err instanceof Error ? err.message : 'Hernoemen is mislukt.', 'error');
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

  const alle = devices ?? [];
  const pending = alle.filter((d) => d.status === 'pending');
  const gekozen = alle.find((d) => keyOf(d) === gekozenKey) ?? null;
  const zoekTerm = zoek.trim().toLowerCase();
  const filterActief = zoekTerm !== '' || statusFilter !== 'all';
  const zichtbaar = alle.filter((d) => {
    if (statusFilter !== 'all' && d.status !== statusFilter) return false;
    if (!zoekTerm) return true;
    return `${userName(d.userId)} ${d.name}`.toLowerCase().includes(zoekTerm);
  });
  const wisFilters = () => { setZoek(''); setStatusFilter('all'); };
  // Groepeer per gebruiker, in de volgorde van de gebruikerslijst (actief eerst).
  const byUser = new Map<string, Device[]>();
  for (const d of zichtbaar) {
    const list = byUser.get(String(d.userId)) ?? [];
    list.push(d);
    byUser.set(String(d.userId), list);
  }
  const telPerStatus = (status: Device['status']) => alle.filter((d) => d.status === status).length;

  /** Rij in de wachtrij: de rij zelf opent het detail; "Keur goed" blijft als
   *  snelle actie ernaast — dat is wat de admin hier negen van de tien keer doet. */
  const renderPending = (device: Device) => {
    const isCurrent = gekozen !== null && keyOf(gekozen) === keyOf(device);
    return (
      <div
        key={keyOf(device)}
        className={cn(
          'flex items-center gap-2 rounded-xl border px-3 py-2 border-amber-200 bg-amber-50/80',
          isCurrent && 'ring-1 ring-oker-400',
        )}
      >
        {/* rauw: rij-inhoud (icoon + naam + status + meta) als knop naast de snelle actie — opent het detailpaneel */}
        <button type="button" onClick={() => kies(device)} aria-current={isCurrent ? 'true' : undefined} className="group flex min-h-11 min-w-0 flex-1 items-center gap-3 text-left">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-slate-500">
            <Smartphone size={16} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate font-semibold text-slate-900">{device.name}</p>
              {isOwnCurrent(device) ? <Badge tone="blue">Dit toestel</Badge> : null}
            </div>
            <MicroLabel className="mt-0.5">
              {userName(device.userId)} · geregistreerd {formatDateHuman(device.createdAt)}
            </MicroLabel>
          </div>
          <ChevronRight size={14} className="shrink-0 text-slate-300 transition-colors group-hover:text-slate-600" />
        </button>
        <Button
          variant="primary"
          size="sm"
          icon={<ShieldCheck size={14} />}
          disabled={busyKey === keyOf(device)}
          onClick={() => void act(device, 'approve')}
        >
          Keur goed
        </Button>
      </div>
    );
  };

  /** Eénregel-rij voor de gegroepeerde lijst: status als stip (goedgekeurd is
   *  de norm), alleen afwijkingen krijgen een badge; de acties staan in het
   *  detailpaneel. */
  const renderDeviceCompact = (device: Device) => {
    const isCurrent = gekozen !== null && keyOf(gekozen) === keyOf(device);
    return (
      // rauw: hele rij is de knop (stip + naam + badges + chevron) — opent het detailpaneel
      <button
        key={keyOf(device)}
        type="button"
        onClick={() => kies(device)}
        aria-current={isCurrent ? 'true' : undefined}
        className={cn(
          'group flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-2 py-1 text-left transition-colors hover:bg-surface-soft-hover',
          isCurrent && 'bg-oker-50/70',
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          {/* Stip = status; voor screenreaders staat het label ernaast (sr-only),
              afwijkingen krijgen daarnaast een zichtbare badge. */}
          <span
            aria-hidden="true"
            className={cn('h-2 w-2 shrink-0 rounded-full', device.status === 'approved' ? 'bg-emerald-500' : device.status === 'pending' ? 'bg-amber-500' : 'bg-red-500')}
          />
          <span className="sr-only">{STATUS_BADGE[device.status].label}</span>
          <span className="truncate text-sm font-semibold text-slate-800">{device.name}</span>
          {device.status === 'revoked' && <Badge tone="red">Geblokkeerd</Badge>}
          {device.status === 'pending' && <Badge tone="amber">Wacht</Badge>}
          {isOwnCurrent(device) && <Badge tone="blue">Dit toestel</Badge>}
        </span>
        <ChevronRight size={14} className={cn('shrink-0 transition-colors', isCurrent ? 'text-oker-500' : 'text-slate-300 group-hover:text-slate-600')} />
      </button>
    );
  };

  const lijst = (
    <div className="space-y-6 md:space-y-8">
      {pending.length > 0 && (
        <Card>
          <CardHeader
            title="Wacht op goedkeuring"
            aside={<Badge tone="amber" dot className="shrink-0 tabular-nums">{pending.length}</Badge>}
          />
          <div className="mt-4 space-y-2">
            {pending.map(renderPending)}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Alle toestellen" description="Per gebruiker; klap een naam open voor de toestellen." />
        {devices === null ? (
          <div className="mt-4 divide-y divide-slate-100" aria-busy="true" aria-label="Toestellen worden geladen">
            <SkeletonRow className="px-2 py-3" />
            <SkeletonRow className="px-2 py-3" />
            <SkeletonRow className="px-2 py-3" />
          </div>
        ) : devices.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Nog geen toestellen"
              message="Toestellen verschijnen hier zodra gebruikers inloggen. Blijft de lijst leeg, draai dan eerst de user_devices-migratie."
            />
          </div>
        ) : (
          <>
            <TableToolbar
              className="mt-4"
              zoek={zoek}
              onZoek={setZoek}
              placeholder="Zoek op gebruiker of toestel…"
              telling={`${zichtbaar.length} van ${alle.length} toestellen`}
              filters={(
                <>
                  <FilterChip active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>Alles</FilterChip>
                  <FilterChip active={statusFilter === 'pending'} onClick={() => setStatusFilter(statusFilter === 'pending' ? 'all' : 'pending')}>Wacht ({telPerStatus('pending')})</FilterChip>
                  <FilterChip active={statusFilter === 'revoked'} onClick={() => setStatusFilter(statusFilter === 'revoked' ? 'all' : 'revoked')}>Geblokkeerd ({telPerStatus('revoked')})</FilterChip>
                </>
              )}
            />
            {zichtbaar.length === 0 ? (
              <div className="mt-4">
                <EmptyState
                  title={zoekTerm ? `Geen resultaten voor “${zoek.trim()}”` : 'Geen toestellen met deze status'}
                  message="Pas de zoekterm of het statusfilter aan."
                  action={<Button variant="secondary" onClick={wisFilters}>Zoekterm en filter wissen</Button>}
                />
              </div>
            ) : (
              <div className="mt-3 divide-y divide-slate-100">
                {[...byUser.entries()].map(([userId, list]) => {
                  const open = filterActief || openUsers.includes(userId);
                  const attention = list.filter((d) => d.status !== 'approved').length;
                  return (
                    <div key={userId} className="py-1">
                      {/* rauw: hele groepsrij is de knop (naam + telling + badge + chevron) */}
                      <button
                        type="button"
                        onClick={() => toggleUser(userId)}
                        aria-expanded={open}
                        className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-soft-hover transition-colors"
                      >
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="truncate text-sm font-semibold text-slate-800">{userName(userId)}</span>
                          <span className="shrink-0 text-2xs font-medium text-slate-500 tabular-nums">{list.length} {list.length === 1 ? 'toestel' : 'toestellen'}</span>
                          {attention > 0 && <Badge tone="amber" dot className="tabular-nums">{attention}</Badge>}
                        </div>
                        <ChevronDown size={16} className={cn('shrink-0 text-slate-400 transition-transform duration-200', open && 'rotate-180')} />
                      </button>
                      {open && <div className="pb-1.5 pl-2">{list.map(renderDeviceCompact)}</div>}
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </Card>
    </div>
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
      icon={(
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-slate-500">
          <Smartphone size={16} />
        </span>
      )}
      footer={gekozen ? (
        <div className="flex items-center gap-2">
          {!isOwnCurrent(gekozen) && (
            <IconButton label="Toestel schrappen" title="Schrappen" variant="danger" disabled={bezig} onClick={() => setConfirmDelete(gekozen)}>
              <Trash2 size={16} />
            </IconButton>
          )}
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
          {isOwnCurrent(gekozen) && (
            <p className="flex-1 text-xs text-slate-500">Dit is het toestel waarmee je nu bent aangemeld — blokkeren of schrappen kan niet.</p>
          )}
        </div>
      ) : undefined}
    >
      {gekozen && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_BADGE[gekozen.status].tone} dot>{STATUS_BADGE[gekozen.status].label}</Badge>
            {isOwnCurrent(gekozen) ? <Badge tone="blue">Dit toestel</Badge> : null}
          </div>

          <form onSubmit={(e) => { e.preventDefault(); void submitRename(gekozen); }}>
            <Field label="Naam" hint="Bv. „iPhone van Jan” — zo herken je het toestel in de lijst.">
              {({ id }) => (
                <div className="flex items-center gap-2">
                  <Input
                    id={id}
                    value={naamOntwerp}
                    onChange={(e) => setNaamOntwerp(e.target.value)}
                    enterKeyHint="done"
                    maxLength={80}
                  />
                  <Button type="submit" variant="secondary" disabled={isRenaming || !naamOntwerp.trim() || naamOntwerp.trim() === gekozen.name}>
                    {isRenaming ? 'Opslaan…' : 'Opslaan'}
                  </Button>
                </div>
              )}
            </Field>
          </form>

          <Card tone="muted" padding="sm">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-label">Gebruiker</dt>
              <dd className="font-medium text-slate-800">{userName(gekozen.userId)}</dd>
              <dt className="text-label">Geregistreerd</dt>
              <dd className="font-medium text-slate-800 tabular-nums">{formatDateHuman(gekozen.createdAt)}</dd>
              <dt className="text-label">Laatst gezien</dt>
              <dd className="font-medium text-slate-800 tabular-nums">{formatDateHuman(gekozen.lastSeenAt)}</dd>
            </dl>
          </Card>

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
        title="Toestellen"
        description="Elk volgend toestel wacht hier op goedkeuring."
      />

      <Card>
        <CardHeader
          title="Toestel-goedkeuring"
          description={gateEnabled === false
            ? 'Uit — elk toestel wordt bij aanmelden automatisch goedgekeurd en aan de lijst toegevoegd. Geblokkeerde toestellen blijven geblokkeerd.'
            : 'Aan — elk nieuw toestel (behalve het eerste per chauffeur) wacht op jouw goedkeuring voordat het toegang krijgt.'}
          aside={(
            <Switch
              checked={gateEnabled !== false}
              onChange={() => void toggleGate()}
              label="Toestel-goedkeuring vereist"
              disabled={gateEnabled === null || isTogglingGate}
            />
          )}
        />
        {gateEnabled === false && (
          <p className="mt-3 rounded-xl bg-amber-50 border border-amber-100 px-3.5 py-2.5 text-xs font-medium text-amber-800">
            Tijdelijk bedoeld — bv. bij de uitrol naar alle chauffeurs. Zet de goedkeuring daarna weer aan; alles wat intussen aanmeldde staat dan al goedgekeurd in de lijst.
          </p>
        )}
      </Card>

      {/* Lijst links, toestel-detail (naam, status, data, acties) rechts;
          op mobiel opent het detail als SlideOver. */}
      <MasterDetail lijst={lijst} paneel={paneel} />

      <ConfirmationModal
        isOpen={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => {
          if (confirmDelete) void act(confirmDelete, 'delete');
          setConfirmDelete(null);
        }}
        title="Toestel schrappen?"
        message={confirmDelete ? `"${confirmDelete.name}" van ${userName(confirmDelete.userId)} wordt uit de lijst verwijderd. Meldt deze gebruiker zich er opnieuw mee aan (en heeft die nog een ander toestel), dan verschijnt het weer als "wacht op goedkeuring". Voor een verloren of gestolen toestel kies je beter Blokkeren.` : ''}
        confirmText="Schrappen"
      />
    </PageShell>
  );
}
