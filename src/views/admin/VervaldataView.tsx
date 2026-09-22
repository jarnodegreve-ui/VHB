import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, IdCard, Pencil, UserX } from 'lucide-react';
import type { User } from '../../types';
import { useRecordParam } from '../../app/router';
import { cn, notify } from '../../lib/ui';
import { EXPIRY_SOORT_LABELS, formatDateHuman } from '../../lib/format';
import { EmptyState, Foutkaart, PageHeader, PageShell, VersheidRegel } from '../../components/ui';
import { apiFetch } from '../../lib/api';
import { bulkUitvoeren, meldBulkResultaat } from '../../lib/bulk';
import { useZelfLadend } from '../../lib/zelfLadend';
import { Modal } from '../../components/Modal';
import { OpsStat } from '../../components/ops';
import { SkeletonRow } from '../../components/Skeleton';
import { Card, CardHeader } from '../../components/Card';
import { DateInput, Field } from '../../components/Field';
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

  const zl = useZelfLadend(async () => {
    const res = await apiFetch('/api/user-expiries');
    if (!res.ok) throw new Error(String(res.status));
    const rows = await res.json();
    setExpiries(Array.isArray(rows) ? rows : []);
  }, { boodschap: 'Kon de vervaldata niet laden.' });

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

  // De gekozen chauffeur staat in de URL (/beheer/vervaldata/<userId>):
  // deelbaar ("kijk die van Alex eens na") en een refresh houdt de modal
  // open. De Modal pusht zelf zijn history-entry (useHistoryDismiss); de
  // URL wisselt met replace, en sluiten wist het id weer.
  const [userParam, zetUserParam] = useRecordParam(0, { view: 'vervaldata' });

  const toonBewerken = (u: User) => {
    setBewerkt(u);
    setDraft({ ...(perUser.get(String(u.id)) ?? {}) });
  };
  const openBewerken = (u: User) => { toonBewerken(u); zetUserParam(String(u.id)); };
  const sluitBewerken = () => { setBewerkt(null); zetUserParam(null); };

  // URL → modal, pas zodra de vervaldata geladen zijn: de draft komt uit
  // perUser, en een lege draft opslaan zou bestaande datums wissen. Een
  // onbekend id doet niets (lijst zonder selectie).
  useEffect(() => {
    if (!userParam || !zl.laatstGeladen) return;
    if (bewerkt && String(bewerkt.id) === userParam) return;
    const u = users.find((x) => String(x.id) === userParam);
    if (u) toonBewerken(u);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userParam, users, zl.laatstGeladen]);

  const opslaan = async () => {
    if (!bewerkt || isSaving) return;
    setIsSaving(true);
    const bestaand = perUser.get(String(bewerkt.id)) ?? {};
    // Alleen de gewijzigde soorten, één PUT per soort; fouten per soort
    // verzameld en één toast na afloop (src/lib/bulk.ts).
    const gewijzigd = Object.keys(EXPIRY_SOORT_LABELS).filter((soort) => (draft[soort] ?? '').trim() !== (bestaand[soort] ?? ''));
    const resultaat = await bulkUitvoeren(gewijzigd, async (soort) => {
      const res = await apiFetch('/api/user-expiries', {
        method: 'PUT',
        body: JSON.stringify({ userId: bewerkt.id, soort, validUntil: (draft[soort] ?? '').trim() || null }),
      });
      if (!res.ok) return false;
    });
    setIsSaving(false);
    meldBulkResultaat(notify, resultaat, {
      item: ['vervaldatum', 'vervaldata'],
      gedaan: 'opgeslagen',
      allesGelukt: 'Vervaldata opgeslagen.',
      rest: (f) => `, niet gelukt: ${f.map((x) => EXPIRY_SOORT_LABELS[x.item]).join(', ')}`,
    });
    if (resultaat.mislukt.length === 0) sluitBewerken();
    await zl.ververs();
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
      // Stil (neutraal vlak + gekleurd puntje) zolang er niets dringend is;
      // binnen 30 dagen of verlopen blijft het vlak gekleurd.
      <Badge key={soort} tone={chipTone(dagen)} dot stil={dagen > 30} className="whitespace-nowrap tabular-nums">
        {metLabel ? `${label}: ` : ''}
        <span title={formatDateHuman(datum)}>{kortDatum(datum)}</span>
        <span className="text-slate-500">· {dagenTekst(dagen)}</span>
      </Badge>
    );
  };

  return (
    <PageShell>
      <PageHeader
        view="vervaldata"
        title="Vervaldata"
        actions={<VersheidRegel {...zl.versheid} />}
      />

      {zl.fout && expiries.length > 0 && <Foutkaart compact boodschap={zl.fout} offline={!zl.online} onOpnieuw={zl.opnieuw} bezig={zl.laden} />}

      {/* Ops-tegels (zelfde als de status-strip op het dashboard): vaste
          twee-regel-labelzone, dus cijfers en subteksten van alle vier de
          tegels liggen op exact dezelfde lijn. Klik op een tegel = filter. */}
      <div className="kpi-raster grid grid-cols-2 gap-3 md:grid-cols-4">
        <OpsStat
          icon={<AlertTriangle size={16} />}
          tone={tellers.verlopen > 0 ? 'red' : 'slate'}
          label="Verlopen"
          value={tellers.verlopen}
          sub={tellers.verlopen > 0 ? 'direct actie nodig' : 'niets verlopen'}
          onClick={() => kiesFilter('verlopen')}
          actief={filter === 'verlopen'}
        />
        <OpsStat
          icon={<IdCard size={16} />}
          tone={tellers.binnen30 > 0 ? 'amber' : 'slate'}
          label="Binnen 30 dagen"
          value={tellers.binnen30}
          sub="vernieuwing plannen"
          onClick={() => kiesFilter('binnen30')}
          actief={filter === 'binnen30'}
        />
        <OpsStat
          icon={<IdCard size={16} />}
          tone={tellers.binnen90 > 0 ? 'amber' : 'slate'}
          label="Binnen 90 dagen"
          value={tellers.binnen90}
          sub="komt eraan"
          onClick={() => kiesFilter('binnen90')}
          actief={filter === 'binnen90'}
        />
        <OpsStat
          icon={<UserX size={16} />}
          tone={tellers.zonder > 0 ? 'amber' : 'slate'}
          label="Zonder datums"
          value={tellers.zonder}
          sub={tellers.zonder > 0 ? 'nog in te vullen' : 'alles ingevuld'}
          onClick={() => kiesFilter('zonder')}
          actief={filter === 'zonder'}
        />
      </div>

      {zl.fout && expiries.length === 0 ? (
        <Foutkaart boodschap={zl.fout} offline={!zl.online} onOpnieuw={zl.opnieuw} bezig={zl.laden} />
      ) : zl.laden && expiries.length === 0 ? (
        <Card padding="none" className="divide-y divide-hairline-subtle overflow-hidden" role="status" aria-busy="true" aria-label="Vervaldata worden geladen">
          <SkeletonRow className="px-5 py-4" />
          <SkeletonRow className="px-5 py-4" />
          <SkeletonRow className="px-5 py-4" />
        </Card>
      ) : rijen.length === 0 ? (
        <EmptyState title="Geen actieve chauffeurs" message="Zodra er chauffeurs in het systeem staan, verschijnen ze hier." />
      ) : (
        // `overflow-clip` i.p.v. TableShell: die maakt een scrollcontainer en
        // dan plakt de kolomkop niet meer onder de topbar. De tabel is
        // desktop-only; mobiel krijgt een kaartlijst met dezelfde rijen.
        <div className="surface-table rounded-3xl overflow-clip">
          <div className="border-b border-hairline px-5 py-4 md:px-6">
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
                title={zoekTerm ? `Geen resultaten voor “${zoek.trim()}”` : 'Geen chauffeurs voor dit filter'}
                message={filter === 'verlopen' && !zoekTerm ? 'Niets verlopen, goed nieuws.' : 'Pas de zoekterm of het filter aan.'}
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
                        className="cursor-pointer border-b border-hairline-subtle last:border-b-0 transition-colors hover:bg-surface-soft-hover"
                      >
                        <Td>
                          <p className={cn('font-semibold', rij.eerste !== null && rij.eerste < 0 ? 'text-red-700' : 'text-slate-800')}>{rij.user.name}</p>
                          {rij.user.employeeId ? <p className="text-xs font-medium tabular-nums text-slate-500">{rij.user.employeeId}</p> : null}
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

              <div className="md:hidden divide-y divide-hairline-subtle">
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
                      {rij.eerste === null ? <span className="shrink-0 text-xs font-semibold text-oker-700">Invullen</span> : null}
                    </div>
                    <p className="text-xs font-medium tabular-nums text-slate-500">{eersteTekst(rij.eerste)}</p>
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

      <Modal open={!!bewerkt} onClose={sluitBewerken} maxWidth="sm" ariaLabel={bewerkt ? `Vervaldata van ${bewerkt.name}` : 'Vervaldata'}>
        {bewerkt && (
          <div className="p-6">
            <CardHeader title={bewerkt.name} description="Leeg laten = niet bewaken voor dit document." />
            <div className="mt-4 space-y-3">
              {Object.entries(EXPIRY_SOORT_LABELS).map(([soort, label]) => (
                <Field key={soort} label={`${label} geldig tot`}>
                  {({ id }) => (
                    <DateInput
                      id={id}
                      value={draft[soort] ?? ''}
                      onChange={(v) => setDraft((d) => ({ ...d, [soort]: v }))}
                    />
                  )}
                </Field>
              ))}
            </div>
            <div className="mt-5 flex gap-3">
              <Button variant="ghost" className="flex-1" onClick={sluitBewerken}>Annuleren</Button>
              <Button variant="primary" className="flex-1" onClick={() => void opslaan()} disabled={isSaving}>{isSaving ? 'Bezig…' : 'Opslaan'}</Button>
            </div>
          </div>
        )}
      </Modal>
    </PageShell>
  );
}
