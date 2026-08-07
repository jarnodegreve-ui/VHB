import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, IdCard, RefreshCw, Search, UserX } from 'lucide-react';
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
  // 39 chauffeurs doorscrollen om er één te vinden was op een telefoon de
  // enige weg (zelfde zoekpatroon als Contacten en Gebruikersbeheer).
  const [zoek, setZoek] = useState('');

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

  const alleChauffeurs = useMemo(
    () => users.filter((u) => u.role === 'chauffeur' && u.isActive !== false && u.name.trim().toLowerCase() !== 'beheerder'),
    [users],
  );
  const chauffeurs = useMemo(() => {
    const q = zoek.trim().toLowerCase();
    if (!q) return alleChauffeurs;
    return alleChauffeurs.filter((u) => `${u.name} ${u.employeeId ?? ''}`.toLowerCase().includes(q));
  }, [alleChauffeurs, zoek]);

  // Rijen gesorteerd op de éérst vervallende datum van de chauffeur; wie
  // helemaal geen datums heeft komt in een aparte sectie onderaan — dat is
  // geen "in orde" maar "nog niet ingevuld", en dat onderscheid moet zichtbaar
  // blijven.
  const indelen = (lijst: User[]) => {
    const met: Array<{ user: User; datums: Record<string, string>; eerste: number }> = [];
    const zonder: User[] = [];
    let verlopen = 0;
    let binnen30 = 0;
    let binnen90 = 0;
    for (const u of lijst) {
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
  };

  // Lijst volgt de zoekterm; de tegels blijven het totaalbeeld tonen — een
  // teller die meebeweegt met een zoekterm is geen overzicht meer.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { metDatums, zonderDatums } = useMemo(() => indelen(chauffeurs), [chauffeurs, perUser, vandaagIso]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { tellers } = useMemo(() => indelen(alleChauffeurs), [alleChauffeurs, perUser, vandaagIso]);

  const chipTone = (dagen: number): BadgeTone => (dagen < 0 ? 'red' : dagen <= 30 ? 'amber' : dagen <= 90 ? 'oker' : 'emerald');
  /** Compacte datum ("27 nov 2027") — de lange variant met weekdag maakte de
   *  pillen zó breed dat ze op desktop niet meer in één kolom pasten en per
   *  rij op een andere x begonnen. De volledige datum staat in de tooltip. */
  const kortDatum = (iso: string) => {
    const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' });
  };
  const dagenTekst = (dagen: number) => (dagen < 0 ? 'verlopen' : dagen === 0 ? 'vandaag' : `${dagen} d`);

  // Kolommen: naam + één vaste kolom per bewaakte soort. Inline zodat het
  // meebeweegt als er ooit een soort bij komt; de klasse `md:grid` bepaalt
  // vanaf wanneer het raster geldt (mobiel blijven het wikkelende pillen).
  const soorten = Object.entries(EXPIRY_SOORT_LABELS);
  const kolommen = { gridTemplateColumns: `minmax(0,1fr) repeat(${soorten.length}, 11.5rem)` };

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
          <div className="flex w-full items-center gap-2 md:w-auto">
            <div className="relative flex-1 md:w-64 md:flex-none">
              <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4">
                <Search size={16} className="text-slate-400" />
              </div>
              <input
                type="search"
                aria-label="Zoek een chauffeur"
                placeholder="Zoek chauffeur…"
                value={zoek}
                onChange={(e) => setZoek(e.target.value)}
                className="control-input w-full rounded-2xl py-3 pl-11 pr-4 text-base font-medium outline-none sm:text-sm"
              />
            </div>
            <Button variant="secondary" onClick={() => void load()} disabled={isLoading} aria-label="Ververs">
              <RefreshCw size={15} className={isLoading ? 'animate-spin' : ''} />
              <span className="ml-1.5 hidden sm:inline">Ververs</span>
            </Button>
          </div>
        )}
      />

      {error && (
        <div className="p-4 rounded-2xl text-sm font-semibold bg-red-50 text-red-700 border border-red-100">{error}</div>
      )}

      {/* Ops-tegels (zelfde als de status-strip op het dashboard): vaste
          twee-regel-labelzone, dus cijfers en subteksten van alle vier de
          tegels liggen op exact dezelfde lijn — de brede StatCards lieten
          de labels wikkelen en alles verspringen (melding Jarno). */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
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
            <div>
              {/* Kolomkoppen (alleen desktop): met vaste kolommen hoeft het
                  soort-label niet meer in élke pil te staan — dat was precies
                  wat de rijen ongelijk maakte. */}
              <div className="hidden md:grid px-5 pb-2 gap-4" style={kolommen}>
                <MicroLabel>Chauffeur</MicroLabel>
                {soorten.map(([soort, label]) => <MicroLabel key={soort}>{label}</MicroLabel>)}
              </div>
              <div className="surface-card rounded-3xl divide-y divide-slate-100 overflow-hidden">
                {metDatums.map(({ user, datums, eerste }) => (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => openBewerken(user)}
                    style={kolommen}
                    className="ios-pressable flex w-full flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3.5 text-left transition-colors hover:bg-surface-soft-hover md:grid md:gap-4 dark:hover:bg-white/5"
                  >
                    <div className="min-w-0 flex-1 basis-44 md:flex-none md:basis-auto">
                      <p className={cn('truncate text-sm font-semibold', eerste < 0 ? 'text-red-700 dark:text-red-400' : 'text-slate-800')}>{user.name}</p>
                      <p className="text-[11px] font-medium tabular-nums text-slate-500">
                        {eerste < 0
                          ? `al ${Math.abs(eerste)} ${Math.abs(eerste) === 1 ? 'dag' : 'dagen'} verlopen`
                          : eerste === 0
                            ? 'verloopt vandaag'
                            : `eerst vervallend over ${eerste} ${eerste === 1 ? 'dag' : 'dagen'}`}
                      </p>
                    </div>
                    {/* Op desktop vult elke pil zijn kolom volledig (md:w-full):
                        zo staan de datums links én de dagentellers rechts van
                        álle rijen op exact dezelfde x. Mobiel blijven het
                        compacte pillen mét soort-label, want daar is geen
                        kolomkop. */}
                    {soorten.map(([soort, label]) => {
                      const datum = datums[soort];
                      if (!datum) {
                        return (
                          <Badge key={soort} tone="slate" className="whitespace-nowrap opacity-70 md:flex md:w-full">
                            <span className="md:hidden">{label}:</span>—
                          </Badge>
                        );
                      }
                      const dagen = dagenTot(datum);
                      return (
                        <Badge
                          key={soort}
                          tone={chipTone(dagen)}
                          dot
                          className="whitespace-nowrap tabular-nums md:flex md:w-full"
                        >
                          <span className="md:hidden">{label}:</span>
                          <span title={formatDateHuman(datum)}>{kortDatum(datum)}</span>
                          <span className="ml-1.5 md:hidden">· {dagenTekst(dagen)}</span>
                          <span className="hidden md:ml-auto md:inline">{dagenTekst(dagen)}</span>
                        </Badge>
                      );
                    })}
                  </button>
                ))}
              </div>
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
                    style={kolommen}
                    className="ios-pressable flex min-h-11 w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-surface-soft-hover md:grid md:gap-4 dark:hover:bg-white/5"
                  >
                    <p className="min-w-0 truncate text-sm font-semibold text-slate-700">{u.name}</p>
                    {/* Zelfde kolomraster als de lijst hierboven, zodat beide
                        blokken één tabel lijken; "Invullen" staat in de eerste
                        documentkolom en dus recht onder de pillen. */}
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
