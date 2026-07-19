import { useEffect, useState } from 'react';
import { Check, Pencil, ShieldAlert, ShieldCheck, Smartphone, Trash2, X } from 'lucide-react';
import type { User } from '../../types';
import { apiFetch } from '../../lib/api';
import { getDeviceToken } from '../../lib/device';
import { notify } from '../../lib/ui';
import { formatDateHuman } from '../../lib/format';
import { ConfirmationModal, EmptyState, PageHeader, PageShell } from '../../components/ui';
import { Badge, Button, MicroLabel } from '../../components/primitives';

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
      setDevices(await apiFetch<Device[]>('/api/devices'));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Toestellen laden is mislukt.', 'error');
      setDevices([]);
    }
  };
  useEffect(() => { void load(); }, []);

  const act = async (device: Device, action: 'approve' | 'revoke' | 'delete') => {
    setBusyKey(keyOf(device));
    try {
      await apiFetch(`/api/devices/${action}`, {
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
      await apiFetch('/api/devices/rename', {
        method: 'POST',
        body: JSON.stringify({ userId: renaming.userId, deviceToken: renaming.deviceToken, name: renameValue.trim() }),
      });
      setRenaming(null);
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Hernoemen is mislukt.', 'error');
    }
  };

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
      className={`flex flex-col gap-3 rounded-2xl border p-4 md:flex-row md:items-center md:justify-between ${
        highlight ? 'border-amber-200 bg-amber-50/80' : 'border-slate-200/80 bg-white/50'
      }`}
    >
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
          <Smartphone size={18} />
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
          <MicroLabel className="mt-1">
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

  return (
    <PageShell width="5xl">
      <PageHeader
        title="Toestellen"
        description="Chauffeurs kunnen alleen inloggen op goedgekeurde toestellen. Het eerste toestel wordt automatisch vertrouwd; elk volgend toestel wacht hier op goedkeuring."
      />

      {pending.length > 0 && (
        <div className="surface-card rounded-3xl p-5 md:p-6">
          <div className="flex items-center justify-between gap-4">
            <h3 className="text-lg font-bold tracking-tight">Wacht op goedkeuring</h3>
            <Badge tone="amber" dot className="shrink-0 tabular-nums">{pending.length}</Badge>
          </div>
          <div className="mt-4 space-y-3">
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
            <EmptyState
              icon={<Smartphone size={26} />}
              title="Nog geen toestellen"
              message="Toestellen verschijnen hier zodra gebruikers inloggen. Draai eerst de user_devices-migratie als deze lijst leeg blijft."
            />
          </div>
        ) : (
          <div className="mt-4 space-y-6">
            {[...byUser.entries()].map(([userId, list]) => (
              <div key={userId}>
                <MicroLabel className="mb-2">{userName(userId)}</MicroLabel>
                <div className="space-y-3">{list.map((d) => renderDevice(d))}</div>
              </div>
            ))}
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
