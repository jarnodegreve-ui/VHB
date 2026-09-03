import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, IdCard, Pencil, RefreshCw, UserX } from 'lucide-react';
import type { User } from '../../types';
import { cn, notify } from '../../lib/ui';
import { EXPIRY_SOORT_LABELS, formatDateHuman } from '../../lib/format';
import { EmptyState, PageHeader, PageShell } from '../../components/ui';
import { apiFetch } from '../../lib/api';
import { Modal } from '../../components/Modal';
import { OpsStat } from '../../components/ops';
import { SkeletonRow } from '../../components/Skeleton';
import { Card, CardHeader } from '../../components/Card';
import { Field, Input } from '../../components/Field';
import { Badge, Button, FilterChip, IconButton, Td, Th, type BadgeTone } from '../../components/primitives';
import { SortTh, StickyThead, TableToolbar, useSort, useTabelVoorkeur } from '../../components/Table';

/** Uitschakelbare kolommen: één per bewaakt document (Chauffeur, Eerst vervallend en Acties blijven altijd). */
const KOLOMMEN = Object.entries(EXPIRY_SOORT_LABELS).map(([key, label]) => ({ key, label }));

type ExpiryRow = { userId: string; soort: string; validUntil: string };
type Filter = 'all' | 'verlopen' | 'binnen30' | 'binnen90' | 'zonder';

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
  const [filter, setFilter] = useState<Filter>('all');
  // Standaard: wie het eerst vervalt bovenaan; wie geen datums heeft komt
  // onderaan (null sorteert altijd als laatste).
  const sort = useSort<string>('eerste');
  // Rijdichtheid + kolomkeuze, onthouden per toestel.
  const voorkeur = useTabelVoorkeur('vervaldata', KOLOMMEN);

  const load = async () => {
    setIsLoading(true);
    try {
      const res = await apiFetch('/api/user-expiries');
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

  const soorten = Object.entries(EXPIRY_SOORT_LABELS);

  // Eén rij per chauffeur: datums per soort, dagen tot elke datum en de
  // éérst vervallende (null = nog niets ingevuld — dat is geen "in orde"
  // maar "nog niet ingevuld", en dat onderscheid blijft zichtbaar in de rij).
  type Rij = { user: User; datums: Record<string, string>; dagen: Record<string, number>; eerste: number | null };
  const rijen = useMemo<Rij[]>(() => alleChauffeurs.map((u) => {
    const datums = perUser.get(String(u.id)) ?? {};
    const dagen: Record<string, number> = {};
    for (const [soort, datum] of Object.entries(datums)) {
      const n = dagenTot(datum);
      if (Number.isFinite(n)) dagen[soort] = n;
    }
    const alle = Object.values(dagen);
    return { user: u, datums, dagen, eerste: alle.length ? Math.min(...alle) : null };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [alleChauffeurs, perUser, vandaagIso]);

  // Tellers blijven het totaalbeeld tonen (per datum, niet per chauffeur) —
  // een teller die meebeweegt met een zoekterm is geen overzicht meer.
  const tellers = useMemo(() => {
    let verlopen = 0; let binnen30 = 0; let binnen90 = 0; let zonder = 0;
    for (const r of rijen) {
      if (r.eerste === null) { zonder += 1; continue; }
      for (const n of Object.values(r.dagen)) {
        if (n < 0) verlopen += 1;
        else if (n <= 30) binnen30 += 1;
        else if (n <= 90) binnen90 += 1;
      }
    }
    return { verlopen, binnen30, binnen90, zonder };
  }, [rijen]);

  const zoekTerm = zoek.trim().toLowerCase();
  const voldoetAanFilter = (r: Rij) => {
    const dagen = Object.values(r.dagen);
    switch (filter) {
      case 'all': return true;
      case 'verlopen': return dagen.some((n) => n < 0);
      case 'binnen30': return dagen.some((n) => n >= 0 && n <= 30);
      case 'binnen90': return dagen.some((n) => n > 30 && n <= 90);
      case 'zonder': return r.eerste === null;
    }
  };
  const gefilterd = rijen
    .filter(voldoetAanFilter)
    .filter((r) => !zoekTerm || `${r.user.name} ${r.user.employeeId ?? ''}`.toLowerCase().includes(zoekTerm))
    // Naam als secundaire orde (stabiele sort).
    .sort((a, b) => a.user.name.localeCompare(b.user.name, 'nl'));
  const gesorteerd = sort.sorteer(gefilterd, (r, k) => {
    if (k === 'naam') return r.user.name;
    if (k === 'eerste') return r.eerste;
    return r.dagen[k] ?? null;
  });
  const filterActief = zoekTerm !== '' || filter !== 'all';
  const wisFilters = () => { setZoek(''); setFilter('all'); };
  const kiesFilter = (f: Filter) => setFilter((cur) => (cur === f ? 'all' : f));

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
  const eersteTekst = (eerste: number | null) => {
    if (eerste === null) return 'nog geen datums ingevuld';
    if (eerste < 0) return `al ${Math.abs(eerste)} ${Math.abs(eerste) === 1 ? 'dag' : 'dagen'} verlopen`;
    if (eerste === 0) return 'verloopt vandaag';
    return `eerst vervallend over ${eerste} ${eerste === 1 ? 'dag' : 'dagen'}`;
  };

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
        const res = await apiFetch('/api/user-expiries', {
          method: 'PUT',
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

  /** Datumpil per soort; `metLabel` voor de mobiele kaart (daar is geen kolomkop). */
  const datumPil = (rij: Rij, soort: string, label: string, metLabel: boolean) => {
    const datum = rij.datums[soort];
    if (!datum) {
      return (
        <Badge key={soort} tone="slate" className="whitespace-nowrap opacity-70">
          {metLabel ? `${label}: ` : ''}—
        </Badge>
      );
    }
    const dagen = rij.dagen[soort] ?? dagenTot(datum);
    return (
      <Badge key={soort} tone={chipTone(dagen)} dot className="whitespace-nowrap tabular-nums">
        {metLabel ? `${label}: ` : ''}
        <span title={formatDateHuman(datum)}>{kortDatum(datum)}</span>
        <span className="text-slate-500">· {dagenTekst(dagen)}</span>
      </Badge>
    );
  };

  return (
    <PageShell>
      <PageHeader
        eyebrow="Beheer"
        title="Vervaldata"
        description="Code 95 en medische schifting per chauffeur — gesorteerd op wie het eerst vervalt. Klik op een chauffeur om de datums aan te passen."
        actions={(
          <Button variant="secondary" icon={<RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />} onClick={() => void load()} disabled={isLoading}>
            Ververs
          </Button>
        )}
      />

      {error && (
        <Card tone="danger" padding="sm" className="text-sm font-semibold text-red-700">{error}</Card>
      )}

      {/* Ops-tegels (zelfde als de status-strip op het dashboard): vaste
          twee-regel-labelzone, dus cijfers en subteksten van alle vier de
          tegels liggen op exact dezelfde lijn. Klik op een tegel = filter. */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <OpsStat
          icon={<AlertTriangle size={16} />}
          tone={tellers.verlopen > 0 ? 'red' : 'slate'}
          label="Verlopen"
          value={tellers.verlopen}
          sub={tellers.verlopen > 0 ? 'direct actie nodig' : 'niets verlopen'}
          onClick={() => kiesFilter('verlopen')}
          className={cn(filter === 'verlopen' && 'ring-2 ring-oker-500/40')}
        />
        <OpsStat
          icon={<IdCard size={16} />}
          tone={tellers.binnen30 > 0 ? 'amber' : 'slate'}
          label="Binnen 30 dagen"
          value={tellers.binnen30}
          sub="vernieuwing plannen"
          onClick={() => kiesFilter('binnen30')}
          className={cn(filter === 'binnen30' && 'ring-2 ring-oker-500/40')}
        />
        <OpsStat
          icon={<IdCard size={16} />}
          tone={tellers.binnen90 > 0 ? 'amber' : 'slate'}
          label="Binnen 90 dagen"
          value={tellers.binnen90}
          sub="komt eraan"
          onClick={() => kiesFilter('binnen90')}
          className={cn(filter === 'binnen90' && 'ring-2 ring-oker-500/40')}
        />
        <OpsStat
          icon={<UserX size={16} />}
          tone={tellers.zonder > 0 ? 'amber' : 'slate'}
          label="Zonder datums"
          value={tellers.zonder}
          sub={tellers.zonder > 0 ? 'nog in te vullen' : 'alles ingevuld'}
          onClick={() => kiesFilter('zonder')}
          className={cn(filter === 'zonder' && 'ring-2 ring-oker-500/40')}
        />
      </div>

      {isLoading && expiries.length === 0 && !error ? (
        <Card padding="none" className="divide-y divide-slate-100 overflow-hidden" aria-busy="true" aria-label="Vervaldata worden geladen">
          <SkeletonRow className="px-5 py-4" />
          <SkeletonRow className="px-5 py-4" />
          <SkeletonRow className="px-5 py-4" />
        </Card>
      ) : rijen.length === 0 ? (
        <EmptyState icon={<IdCard size={24} />} title="Geen actieve chauffeurs" message="Zodra er chauffeurs in het systeem staan, verschijnen ze hier." />
      ) : (
        // `overflow-clip` i.p.v. TableShell: die maakt een scrollcontainer en
        // dan plakt de kolomkop niet meer onder de topbar. De tabel is
        // desktop-only; mobiel krijgt een kaartlijst met dezelfde rijen.
        <div className="surface-table rounded-3xl overflow-clip">
          <div className="border-b border-slate-200/70 px-5 py-4 md:px-6">
            <TableToolbar
              zoek={zoek}
              onZoek={setZoek}
              placeholder="Zoek chauffeur…"
              telling={`${gesorteerd.length} van ${rijen.length}`}
              dichtheid={voorkeur.dichtheid}
              kolommen={voorkeur.kolommen}
              filters={(
                <>
                  <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>Alles</FilterChip>
                  <FilterChip active={filter === 'verlopen'} onClick={() => kiesFilter('verlopen')}>Verlopen</FilterChip>
                  <FilterChip active={filter === 'binnen30'} onClick={() => kiesFilter('binnen30')}>Binnen 30 dagen</FilterChip>
                  <FilterChip active={filter === 'binnen90'} onClick={() => kiesFilter('binnen90')}>Binnen 90 dagen</FilterChip>
                  <FilterChip active={filter === 'zonder'} onClick={() => kiesFilter('zonder')}>Zonder datums</FilterChip>
                </>
              )}
            />
          </div>

          {gesorteerd.length === 0 ? (
            <div className="p-6">
              <EmptyState
                icon={<IdCard size={24} />}
                title={zoekTerm ? `Geen resultaten voor “${zoek.trim()}”` : 'Geen chauffeurs voor dit filter'}
                message={filter === 'verlopen' && !zoekTerm ? 'Niets verlopen — goed nieuws.' : 'Pas de zoekterm of het filter aan.'}
                action={filterActief ? <Button variant="secondary" onClick={wisFilters}>Zoekterm en filter wissen</Button> : undefined}
              />
            </div>
          ) : (
            <>
              <div className="hidden md:block">
                <table className={cn('w-full text-left border-collapse', voorkeur.tabelClass)}>
                  <StickyThead>
                    <tr>
                      <SortTh kolom="naam" sort={sort}>Chauffeur</SortTh>
                      {soorten.filter(([soort]) => voorkeur.zichtbaar(soort)).map(([soort, label]) => <SortTh key={soort} kolom={soort} sort={sort}>{label}</SortTh>)}
                      <SortTh kolom="eerste" sort={sort}>Eerst vervallend</SortTh>
                      <Th className="text-right">Acties</Th>
                    </tr>
                  </StickyThead>
                  <tbody>
                    {gesorteerd.map((rij) => (
                      <tr
                        key={rij.user.id}
                        onClick={() => openBewerken(rij.user)}
                        className="cursor-pointer border-b border-slate-100 last:border-b-0 transition-colors hover:bg-surface-soft-hover"
                      >
                        <Td>
                          <p className={cn('font-semibold', rij.eerste !== null && rij.eerste < 0 ? 'text-red-700' : 'text-slate-800')}>{rij.user.name}</p>
                          {rij.user.employeeId ? <p className="text-2xs font-medium tabular-nums text-slate-500">{rij.user.employeeId}</p> : null}
                        </Td>
                        {soorten.filter(([soort]) => voorkeur.zichtbaar(soort)).map(([soort, label]) => (
                          <Td key={soort}>{datumPil(rij, soort, label, false)}</Td>
                        ))}
                        <Td className={cn('text-xs font-medium tabular-nums', rij.eerste === null ? 'text-oker-700' : rij.eerste < 0 ? 'text-red-700' : 'text-slate-600')}>
                          {rij.eerste === null ? 'Nog in te vullen' : eersteTekst(rij.eerste)}
                        </Td>
                        <Td className="text-right">
                          <IconButton label={`Vervaldata van ${rij.user.name} bewerken`} title="Bewerken" variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); openBewerken(rij.user); }}>
                            <Pencil size={16} />
                          </IconButton>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="md:hidden divide-y divide-slate-100">
                {gesorteerd.map((rij) => (
                  // rauw: hele kaartrij (naam + datumpillen) is de knop die het bewerkvenster opent
                  <button
                    key={rij.user.id}
                    type="button"
                    onClick={() => openBewerken(rij.user)}
                    className="ios-pressable flex min-h-11 w-full flex-col gap-2 px-5 py-3.5 text-left transition-colors hover:bg-surface-soft-hover"
                  >
                    <div className="flex items-baseline justify-between gap-3">
                      <p className={cn('min-w-0 truncate text-sm font-semibold', rij.eerste !== null && rij.eerste < 0 ? 'text-red-700' : 'text-slate-800')}>{rij.user.name}</p>
                      {rij.eerste === null ? <span className="shrink-0 text-2xs font-semibold text-oker-700">Invullen</span> : null}
                    </div>
                    <p className="text-2xs font-medium tabular-nums text-slate-500">{eersteTekst(rij.eerste)}</p>
                    {rij.eerste !== null && (
                      <div className="flex flex-wrap gap-1.5">
                        {soorten.map(([soort, label]) => datumPil(rij, soort, label, true))}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <Modal open={!!bewerkt} onClose={() => setBewerkt(null)} maxWidth="sm" ariaLabel={bewerkt ? `Vervaldata van ${bewerkt.name}` : 'Vervaldata'}>
        {bewerkt && (
          <div className="p-6">
            <CardHeader title={bewerkt.name} description="Leeg laten = niet bewaken voor dit document." />
            <div className="mt-4 space-y-3">
              {Object.entries(EXPIRY_SOORT_LABELS).map(([soort, label]) => (
                <Field key={soort} label={`${label} geldig tot`}>
                  {({ id }) => (
                    <Input
                      id={id}
                      type="date"
                      value={draft[soort] ?? ''}
                      onChange={(e) => setDraft((d) => ({ ...d, [soort]: e.target.value }))}
                    />
                  )}
                </Field>
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
