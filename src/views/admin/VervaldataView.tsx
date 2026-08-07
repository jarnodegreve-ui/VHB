import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, IdCard, RefreshCw, UserX } from 'lucide-react';
import type { User } from '../../types';
import { cn, getSupabaseAuthHeaders, notify } from '../../lib/ui';
import { EXPIRY_SOORT_LABELS, formatDateHuman } from '../../lib/format';
import { EmptyState, PageHeader, PageShell } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { OpsStat } from '../../components/ops';
import { SkeletonRow } from '../../components/Skeleton';
import { Badge, Button, MicroLabel, type BadgeTone } from '../../components/primitives';

type ExpiryRow = { userId: string; soort: string; validUntil: string };

/** Overzicht + beheer van de vervaldata (Code 95 / medische schifting),
 *  gesorteerd op wie het eerst vervalt — zodat de planner het
 *  zelf kan raadplegen in plaats van op de herinneringen te wachten
 *  (verzoek Jarno 07-08). Zelfde PUT-API als Gebruikersbeheer, maar dan
 *  bereikbaar voor planners (Gebruikersbeheer is admin-only). */
export function VervaldataView({ users }: { users: User[] }) {
  const [expiries, setExpiries] = useState<ExpiryRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bewerken: per chauffeur een draft met de bewaakte datums.
  const [bewerkt, setBewerkt] = useState<User | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  const load = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/user-expiries', { headers: await getSupabaseAuthHeaders() });
      if (!res.ok) throw new Error(String(res.status));
      const rows = await res.json();
      setExpiries(Array.isArray(rows) ? rows : []);
      setError(null);
    } catch {
      setError('Kon de vervaldata niet laden.');
    } finally {
      setIsLoading(false);
    }
  };
  useEffect(() => { void load(); }, []);

  const vandaagIso = useMemo(() => {
    const nu = new Date();
    return `${nu.getFullYear()}-${String(nu.getMonth() + 1).padStart(2, '0')}-${String(nu.getDate()).padStart(2, '0')}`;
  }, []);
  const dagenTot = (d: string) => Math.round((Date.parse(d) - Date.parse(vandaagIso)) / 86400000);

  const perUser = useMemo(() => {
    const map = new Map<string, Record<string, string>>();
    for (const e of expiries) {
      const per = map.get(e.userId) ?? {};
      per[e.soort] = e.validUntil;
      map.set(e.userId, per);
    }
    return map;
  }, [expiries]);

  const chauffeurs = useMemo(
    () => users.filter((u) => u.role === 'chauffeur' && u.isActive !== false && u.name.trim().toLowerCase() !== 'beheerder'),
    [users],
  );

  // Rijen gesorteerd op de éérst vervallende datum van de chauffeur; wie
  // helemaal geen datums heeft komt in een aparte sectie onderaan — dat is
  // geen "in orde" maar "nog niet ingevuld", en dat onderscheid moet zichtbaar
  // blijven.
  const { metDatums, zonderDatums, tellers } = useMemo(() => {
    const met: Array<{ user: User; datums: Record<string, string>; eerste: number }> = [];
    const zonder: User[] = [];
    let verlopen = 0;
    let binnen30 = 0;
    let binnen90 = 0;
    for (const u of chauffeurs) {
      const datums = perUser.get(String(u.id)) ?? {};
      const dagen = Object.values(datums).map(dagenTot).filter((n) => Number.isFinite(n));
      if (dagen.length === 0) {
        zonder.push(u);
        continue;
      }
      const eerste = Math.min(...dagen);
      met.push({ user: u, datums, eerste });
      for (const n of dagen) {
        if (n < 0) verlopen += 1;
        else if (n <= 30) binnen30 += 1;
        else if (n <= 90) binnen90 += 1;
      }
    }
    met.sort((a, b) => a.eerste - b.eerste || a.user.name.localeCompare(b.user.name, 'nl'));
    zonder.sort((a, b) => a.name.localeCompare(b.name, 'nl'));
    return { metDatums: met, zonderDatums: zonder, tellers: { verlopen, binnen30, binnen90, zonder: zonder.length } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chauffeurs, perUser, vandaagIso]);

  const chipTone = (dagen: number): BadgeTone => (dagen < 0 ? 'red' : dagen <= 30 ? 'amber' : dagen <= 90 ? 'oker' : 'emerald');
  const chipTekst = (dagen: number, datum: string) =>
    dagen < 0
      ? `verlopen (${formatDateHuman(datum)})`
      : dagen === 0
        ? 'verloopt vandaag'
        : `${formatDateHuman(datum)} · ${dagen} d`;

  const openBewerken = (u: User) => {
    setBewerkt(u);
    setDraft({ ...(perUser.get(String(u.id)) ?? {}) });
  };

  const opslaan = async () => {
    if (!bewerkt || isSaving) return;
    setIsSaving(true);
    const bestaand = perUser.get(String(bewerkt.id)) ?? {};
    let mislukt = false;
    for (const soort of Object.keys(EXPIRY_SOORT_LABELS)) {
      const nieuw = (draft[soort] ?? '').trim();
      const oud = bestaand[soort] ?? '';
      if (nieuw === oud) continue;
      try {
        const res = await fetch('/api/user-expiries', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...(await getSupabaseAuthHeaders()) },
          body: JSON.stringify({ userId: bewerkt.id, soort, validUntil: nieuw || null }),
        });
        if (!res.ok) throw new Error(String(res.status));
      } catch {
        mislukt = true;
        notify(`${EXPIRY_SOORT_LABELS[soort]} kon niet opgeslagen worden.`, 'error');
      }
    }
    setIsSaving(false);
    if (!mislukt) {
      setBewerkt(null);
      notify('Vervaldata opgeslagen.', 'success');
    }
    await load();
  };

  return (
    <PageShell width="4xl">
      <PageHeader
        eyebrow="Beheer"
        title="Vervaldata"
        description="Code 95 en medische schifting per chauffeur — gesorteerd op wie het eerst vervalt. Tik op een chauffeur om de datums aan te passen."
        actions={(
          <Button variant="secondary" onClick={() => void load()} disabled={isLoading}>
            <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
            <span className="ml-1.5">Ververs</span>
          </Button>
        )}
      />

      {error && (
        <div className="p-4 rounded-2xl text-sm font-semibold bg-red-50 text-red-700 border border-red-100">{error}</div>
      )}

      {/* Ops-tegels (zelfde als de status-strip op het dashboard): vaste
          twee-regel-labelzone, dus cijfers en subteksten van alle vier de
          tegels liggen op exact dezelfde lijn — de brede StatCards lieten
          de labels wikkelen en alles verspringen (melding Jarno). */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <OpsStat
          icon={<AlertTriangle size={16} />}
          tone={tellers.verlopen > 0 ? 'red' : 'slate'}
          label="Verlopen"
          value={tellers.verlopen}
          sub={tellers.verlopen > 0 ? 'direct actie nodig' : 'niets verlopen'}
        />
        <OpsStat
          icon={<IdCard size={16} />}
          tone={tellers.binnen30 > 0 ? 'amber' : 'slate'}
          label="Binnen 30 dagen"
          value={tellers.binnen30}
          sub="vernieuwing plannen"
        />
        <OpsStat
          icon={<IdCard size={16} />}
          tone={tellers.binnen90 > 0 ? 'oker' : 'slate'}
          label="Binnen 90 dagen"
          value={tellers.binnen90}
          sub="komt eraan"
        />
        <OpsStat
          icon={<UserX size={16} />}
          tone={tellers.zonder > 0 ? 'amber' : 'slate'}
          label="Zonder datums"
          value={tellers.zonder}
          sub={tellers.zonder > 0 ? 'nog in te vullen' : 'alles ingevuld'}
        />
      </div>

      {isLoading && expiries.length === 0 && !error ? (
        <div className="surface-card rounded-3xl divide-y divide-slate-100 overflow-hidden">
          <SkeletonRow className="px-5 py-4" />
          <SkeletonRow className="px-5 py-4" />
          <SkeletonRow className="px-5 py-4" />
        </div>
      ) : metDatums.length === 0 && zonderDatums.length === 0 ? (
        <EmptyState mascotte={false} title="Geen actieve chauffeurs" message="Zodra er chauffeurs in het systeem staan, verschijnen ze hier." />
      ) : (
        <>
          {metDatums.length > 0 && (
            <div className="surface-card rounded-3xl divide-y divide-slate-100 overflow-hidden">
              {metDatums.map(({ user, datums, eerste }) => (
                <button
                  key={user.id}
                  type="button"
                  onClick={() => openBewerken(user)}
                  className="ios-pressable flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 text-left transition-colors hover:bg-slate-50 dark:hover:bg-white/5"
                >
                  <div className="min-w-0 flex-1 basis-44">
                    <p className={cn('truncate text-sm font-semibold', eerste < 0 ? 'text-red-700 dark:text-red-400' : 'text-slate-800')}>{user.name}</p>
                    <p className="text-[11px] font-medium tabular-nums text-slate-500">
                      {eerste < 0
                        ? `al ${Math.abs(eerste)} ${Math.abs(eerste) === 1 ? 'dag' : 'dagen'} verlopen`
                        : eerste === 0
                          ? 'verloopt vandaag'
                          : `eerst vervallend over ${eerste} ${eerste === 1 ? 'dag' : 'dagen'}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {Object.entries(EXPIRY_SOORT_LABELS).map(([soort, label]) => {
                      const datum = datums[soort];
                      if (!datum) {
                        return <Badge key={soort} tone="slate" className="whitespace-nowrap opacity-70">{label}: —</Badge>;
                      }
                      const dagen = dagenTot(datum);
                      return (
                        <Badge key={soort} tone={chipTone(dagen)} dot className="whitespace-nowrap tabular-nums">
                          {label}: {chipTekst(dagen, datum)}
                        </Badge>
                      );
                    })}
                  </div>
                </button>
              ))}
            </div>
          )}

          {zonderDatums.length > 0 && (
            <div>
              <MicroLabel className="mb-2 block px-1">Nog geen datums ingevuld</MicroLabel>
              <div className="surface-card rounded-3xl divide-y divide-slate-100 overflow-hidden">
                {zonderDatums.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => openBewerken(u)}
                    className="ios-pressable flex min-h-11 w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-white/5"
                  >
                    <p className="min-w-0 truncate text-sm font-semibold text-slate-700">{u.name}</p>
                    <span className="shrink-0 text-[11px] font-semibold text-oker-700 dark:text-oker-600">Invullen</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      <Modal open={!!bewerkt} onClose={() => setBewerkt(null)} maxWidth="sm" ariaLabel={bewerkt ? `Vervaldata van ${bewerkt.name}` : 'Vervaldata'}>
        {bewerkt && (
          <div className="p-6">
            <h3 className="text-base font-bold text-slate-800">{bewerkt.name}</h3>
            <p className="mt-1 text-xs text-slate-500">Leeg laten = niet bewaken voor dit document.</p>
            <div className="mt-4 space-y-3">
              {Object.entries(EXPIRY_SOORT_LABELS).map(([soort, label]) => (
                <div key={soort} className="space-y-1">
                  <MicroLabel>{label} geldig tot</MicroLabel>
                  <input
                    type="date"
                    aria-label={`${label} geldig tot`}
                    value={draft[soort] ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, [soort]: e.target.value }))}
                    className="control-input w-full rounded-2xl px-4 py-2.5 text-sm font-medium outline-none transition-all"
                  />
                </div>
              ))}
            </div>
            <div className="mt-5 flex gap-3">
              <Button variant="ghost" className="flex-1" onClick={() => setBewerkt(null)}>Annuleren</Button>
              <Button variant="primary" className="flex-1" onClick={() => void opslaan()} disabled={isSaving}>{isSaving ? 'Bezig…' : 'Opslaan'}</Button>
            </div>
          </div>
        )}
      </Modal>
    </PageShell>
  );
}
