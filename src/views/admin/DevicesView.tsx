import { useEffect, useState } from 'react';
import { Check, ChevronDown, Pencil, ShieldAlert, ShieldCheck, Smartphone, Trash2, X } from 'lucide-react';
import type { User } from '../../types';
import { apiJson } from '../../lib/api';
import { getDeviceToken } from '../../lib/device';
import { notify } from '../../lib/ui';
import { formatDateHuman } from '../../lib/format';
import { ConfirmationModal, EmptyState, PageHeader, PageShell } from '../../components/ui';
import { Badge, Button, MicroLabel, Switch } from '../../components/primitives';

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

export function DevicesView({ users, currentUserId }: { users: User[]; currentUserId: string }) {
  const [devices, setDevices] = useState<Device[] | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Device | null>(null);
  const [renaming, setRenaming] = useState<Device | null>(null);
  const [renameValue, setRenameValue] = useState('');

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

  const submitRename = async () => {
    if (!renaming || !renameValue.trim()) { setRenaming(null); return; }
    try {
      await apiJson('/api/devices/rename', {
        method: 'POST',
        body: JSON.stringify({ userId: renaming.userId, deviceToken: renaming.deviceToken, name: renameValue.trim() }),
      });
      setRenaming(null);
      await load();
      notify('Toestel hernoemd.', 'success');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Hernoemen is mislukt.', 'error');
    }
  };

  // Groepen standaard dichtgeklapt: met tientallen gebruikers is de lijst
  // anders metershoog. Openklappen per gebruiker (wens Jarno).
  const [openUsers, setOpenUsers] = useState<string[]>([]);
  const toggleUser = (id: string) => setOpenUsers((cur) => (
    cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]
  ));

  const pending = (devices ?? []).filter((d) => d.status === 'pending');
  // Groepeer per gebruiker, in de volgorde van de gebruikerslijst (actief eerst).
  const byUser = new Map<string, Device[]>();
  for (const d of devices ?? []) {
    const list = byUser.get(String(d.userId)) ?? [];
    list.push(d);
    byUser.set(String(d.userId), list);
  }

  const renderDevice = (device: Device, highlight = false) => (
    <div
      key={keyOf(device)}
      className={`flex flex-col gap-2 rounded-xl border px-3 py-2 md:flex-row md:items-center md:justify-between ${
        highlight ? 'border-amber-200 bg-amber-50/80' : 'border-slate-200/80 bg-white/50'
      }`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-slate-500">
          <Smartphone size={15} />
        </div>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {renaming && keyOf(renaming) === keyOf(device) ? (
              <form
                onSubmit={(e) => { e.preventDefault(); void submitRename(); }}
                className="flex items-center gap-2"
              >
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(null); }}
                  enterKeyHint="done"
                  // text-base = 16px: onder 16px zoomt iOS bij focus in.
                  className="control-input rounded-xl px-3 py-2 text-base font-semibold outline-none"
                />
                <Button type="submit" variant="secondary" size="sm" className="min-h-11 min-w-11 justify-center" icon={<Check size={16} />} aria-label="Naam opslaan" />
                <Button type="button" variant="ghost" size="sm" className="min-h-11 min-w-11 justify-center" icon={<X size={16} />} aria-label="Annuleren" onClick={() => setRenaming(null)} />
              </form>
            ) : (
              <>
                <p className="truncate font-semibold text-slate-900">{device.name}</p>
                <Badge tone={STATUS_BADGE[device.status].tone} dot>{STATUS_BADGE[device.status].label}</Badge>
                {isOwnCurrent(device) ? <Badge tone="blue">Dit toestel</Badge> : null}
              </>
            )}
          </div>
          <MicroLabel className="mt-0.5">
            {highlight ? `${userName(device.userId)} · ` : ''}
            geregistreerd {formatDateHuman(device.createdAt)} · laatst gezien {formatDateHuman(device.lastSeenAt)}
          </MicroLabel>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="min-h-11 min-w-11 justify-center"
          icon={<Pencil size={16} />}
          aria-label="Toestel hernoemen"
          title="Hernoemen"
          onClick={() => { setRenaming(device); setRenameValue(device.name); }}
        />
        {device.status !== 'approved' && (
          <Button
            variant="primary"
            size="sm"
            className="min-h-11"
            icon={<ShieldCheck size={14} />}
            disabled={busyKey === keyOf(device)}
            onClick={() => void act(device, 'approve')}
          >
            Keur goed
          </Button>
        )}
        {device.status === 'approved' && !isOwnCurrent(device) && (
          <Button
            variant="secondary"
            size="sm"
            className="min-h-11"
            icon={<ShieldAlert size={14} />}
            disabled={busyKey === keyOf(device)}
            onClick={() => void act(device, 'revoke')}
          >
            Blokkeer
          </Button>
        )}
        {!isOwnCurrent(device) && (
          <Button
            variant="danger"
            size="sm"
            className="min-h-11 min-w-11 justify-center"
            icon={<Trash2 size={16} />}
            aria-label="Toestel schrappen"
            title="Schrappen"
            disabled={busyKey === keyOf(device)}
            onClick={() => setConfirmDelete(device)}
          />
        )}
      </div>
    </div>
  );

  /** Eénregel-rij voor de gegroepeerde lijst: status als stip (goedgekeurd is
   *  de norm), alleen afwijkingen krijgen een badge, acties als icoonknoppen.
   *  De wachtrij hierboven houdt de uitgebreide rij mét "Keur goed"-knop. */
  const renderDeviceCompact = (device: Device) => {
    const isRenaming = renaming && keyOf(renaming) === keyOf(device);
    return (
      <div key={keyOf(device)} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1 hover:bg-surface-soft-hover transition-colors">
        <div className="flex min-w-0 items-center gap-2">
          {isRenaming ? (
            <form onSubmit={(e) => { e.preventDefault(); void submitRename(); }} className="flex items-center gap-2">
              <input
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(null); }}
                enterKeyHint="done"
                className="control-input rounded-xl px-3 py-1.5 text-base font-semibold outline-none"
              />
              <Button type="submit" variant="secondary" size="sm" className="h-11 w-11 sm:pointer-fine:h-9 sm:pointer-fine:w-9 justify-center" icon={<Check size={15} />} aria-label="Naam opslaan" />
              <Button type="button" variant="ghost" size="sm" className="h-11 w-11 sm:pointer-fine:h-9 sm:pointer-fine:w-9 justify-center" icon={<X size={15} />} aria-label="Annuleren" onClick={() => setRenaming(null)} />
            </form>
          ) : (
            <>
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${device.status === 'approved' ? 'bg-emerald-500' : device.status === 'pending' ? 'bg-amber-500' : 'bg-red-500'}`}
                title={STATUS_BADGE[device.status].label}
              />
              <p className="truncate text-sm font-semibold text-slate-800">{device.name}</p>
              {device.status === 'revoked' && <Badge tone="red">Geblokkeerd</Badge>}
              {device.status === 'pending' && <Badge tone="amber">Wacht</Badge>}
              {isOwnCurrent(device) && <Badge tone="blue">Dit toestel</Badge>}
              <span className="hidden md:inline shrink-0 text-2xs font-medium text-slate-400 tabular-nums">gezien {formatDateHuman(device.lastSeenAt)}</span>
            </>
          )}
        </div>
        {!isRenaming && (
          <div className="flex shrink-0 items-center gap-0.5">
            <Button variant="ghost" size="sm" className="h-11 w-11 sm:pointer-fine:h-9 sm:pointer-fine:w-9 justify-center" icon={<Pencil size={14} />} aria-label="Toestel hernoemen" title="Hernoemen"
              onClick={() => { setRenaming(device); setRenameValue(device.name); }} />
            {device.status !== 'approved' && (
              <Button variant="ghost" size="sm" className="h-11 w-11 sm:pointer-fine:h-9 sm:pointer-fine:w-9 justify-center text-emerald-600" icon={<ShieldCheck size={15} />} aria-label="Keur goed" title="Keur goed"
                disabled={busyKey === keyOf(device)} onClick={() => void act(device, 'approve')} />
            )}
            {device.status === 'approved' && !isOwnCurrent(device) && (
              <Button variant="ghost" size="sm" className="h-11 w-11 sm:pointer-fine:h-9 sm:pointer-fine:w-9 justify-center" icon={<ShieldAlert size={15} />} aria-label="Blokkeer" title="Blokkeer"
                disabled={busyKey === keyOf(device)} onClick={() => void act(device, 'revoke')} />
            )}
            {!isOwnCurrent(device) && (
              <Button variant="ghost" size="sm" className="h-11 w-11 sm:pointer-fine:h-9 sm:pointer-fine:w-9 justify-center text-red-500" icon={<Trash2 size={14} />} aria-label="Toestel schrappen" title="Schrappen"
                disabled={busyKey === keyOf(device)} onClick={() => setConfirmDelete(device)} />
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <PageShell>
      <PageHeader
        title="Toestellen"
        description="Elk volgend toestel wacht hier op goedkeuring."
      />

      <div className="surface-card rounded-3xl p-5 md:p-6">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-lg font-bold tracking-tight">Toestel-goedkeuring</h3>
            <p className="mt-1 text-sm font-medium text-slate-500">
              {gateEnabled === false
                ? 'Uit — elk toestel wordt bij aanmelden automatisch goedgekeurd en aan de lijst toegevoegd. Geblokkeerde toestellen blijven geblokkeerd.'
                : 'Aan — elk nieuw toestel (behalve het eerste per chauffeur) wacht op jouw goedkeuring voordat het toegang krijgt.'}
            </p>
          </div>
          <Switch
            checked={gateEnabled !== false}
            onChange={() => void toggleGate()}
            label="Toestel-goedkeuring vereist"
            disabled={gateEnabled === null || isTogglingGate}
          />
        </div>
        {gateEnabled === false && (
          <p className="mt-3 rounded-xl bg-amber-50 border border-amber-100 px-3.5 py-2.5 text-xs font-medium text-amber-800">
            Tijdelijk bedoeld — bv. bij de uitrol naar alle chauffeurs. Zet de goedkeuring daarna weer aan; alles wat intussen aanmeldde staat dan al goedgekeurd in de lijst.
          </p>
        )}
      </div>

      {pending.length > 0 && (
        <div className="surface-card rounded-3xl p-5 md:p-6">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-lg font-bold tracking-tight">Wacht op goedkeuring</h3>
            <Badge tone="amber" dot className="shrink-0 tabular-nums">{pending.length}</Badge>
          </div>
          <div className="mt-4 space-y-2">
            {pending.map((d) => renderDevice(d, true))}
          </div>
        </div>
      )}

      <div className="surface-card rounded-3xl p-5 md:p-6">
        <h3 className="text-lg font-bold tracking-tight">Alle toestellen</h3>
        {devices === null ? (
          <p className="mt-4 text-sm font-medium text-slate-500">Laden…</p>
        ) : devices.length === 0 ? (
          <div className="mt-4">
            <EmptyState mascotte={false}
              icon={<Smartphone size={26} />}
              title="Nog geen toestellen"
              message="Toestellen verschijnen hier zodra gebruikers inloggen. Draai eerst de user_devices-migratie als deze lijst leeg blijft."
            />
          </div>
        ) : (
          <div className="mt-3 divide-y divide-slate-100">
            {[...byUser.entries()].map(([userId, list]) => {
              const open = openUsers.includes(userId);
              const attention = list.filter((d) => d.status !== 'approved').length;
              return (
                <div key={userId} className="py-1">
                  <button
                    type="button"
                    onClick={() => toggleUser(userId)}
                    aria-expanded={open}
                    className="flex w-full items-center justify-between gap-3 rounded-lg px-2 py-2 text-left hover:bg-surface-soft-hover transition-colors"
                  >
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span className="truncate text-sm font-bold tracking-tight text-slate-800">{userName(userId)}</span>
                      <span className="shrink-0 text-2xs font-medium text-slate-400 tabular-nums">{list.length} {list.length === 1 ? 'toestel' : 'toestellen'}</span>
                      {attention > 0 && <Badge tone="amber" dot className="tabular-nums">{attention}</Badge>}
                    </div>
                    <ChevronDown size={15} className={`shrink-0 text-slate-400 transition-transform duration-200 ${open ? 'rotate-180' : ''}`} />
                  </button>
                  {open && <div className="pb-1.5 pl-2">{list.map(renderDeviceCompact)}</div>}
                </div>
              );
            })}
          </div>
        )}
      </div>

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
