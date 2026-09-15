import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bus, Pencil, Plus, ShieldCheck, Wrench, Zap } from 'lucide-react';
import type { User } from '../../types';
import { isStaf } from '../../types';
import {
  AANDRIJVINGEN, AANDRIJVING_LABEL, VOERTUIG_CATEGORIEEN, VOERTUIG_CATEGORIE_LABEL, VOERTUIG_CATEGORIE_MEERVOUD, VOERTUIG_STATUSSEN, VOERTUIG_STATUS_LABEL, VOERTUIG_TYPES, VOERTUIG_TYPE_LABEL,
  type VoertuigCategorie,
  VOERTUIG_VERVAL_LABEL, VOERTUIG_VERVAL_SOORTEN, WERKTYPE_LABEL, voertuigNaam, type VoertuigVervalSoort,
} from '../../../shared/techniek';
import { cn, notify } from '../../lib/ui';
import { bulkUitvoeren, meldBulkResultaat } from '../../lib/bulk';
import { useZelfLadend } from '../../lib/zelfLadend';
import { useRouteParam } from '../../app/router';
import { formatDateHuman, formatRelatief } from '../../lib/format';
import {
  bewaarVoertuig, dagenTot, laadDefecten, laadVoertuigVervaldata, laadVoertuigen, laadWerkprestaties, maakVoertuig, TechniekFout,
  urenTekst, verwijderVoertuig, zetVoertuigVervaldatum, type Defect, type Vehicle, type VehicleBody, type VehicleExpiry, type Werkprestatie,
} from '../../lib/techniek';
import { EmptyState, Foutkaart, PageHeader, PageShell, VersheidRegel, ViewLoader } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { OpsStat } from '../../components/ops';
import { SkeletonRow } from '../../components/Skeleton';
import { Card, CardHeader } from '../../components/Card';
import { DateInput, Field, Input, Select } from '../../components/Field';
import { Badge, Button, FilterChip, IconButton, Td, Th, type BadgeTone } from '../../components/primitives';
import { SortTh, StickyThead, TableToolbar, useSort, useTabelVoorkeur } from '../../components/Table';

const LazyDefectMeldenModal = lazy(() => import('../../components/DefectMeldenModal').then((m) => ({ default: m.DefectMeldenModal })));

type Filter = 'actief' | 'reserve' | 'uit_dienst' | 'alles' | 'verloopt';
type CategorieFilter = 'alle' | VoertuigCategorie;
const KOLOMMEN = [
  { key: 'nummerplaat', label: 'Nummerplaat' },
  { key: 'type', label: 'Type' },
  { key: 'aandrijving', label: 'Aandrijving' },
  ...VOERTUIG_VERVAL_SOORTEN.map((s) => ({ key: s, label: VOERTUIG_VERVAL_LABEL[s] })),
  { key: 'defecten', label: 'Open defecten' },
];

const LEEG_FORM: VehicleBody = { busnr: '', kortNr: null, nummerplaat: '', chassisnr: '', merk: '', type: 'lijnbus', categorie: 'bus', aandrijving: 'elektrisch', status: 'actief', inDienst: '', uitDienst: '', zitplaatsen: null, opmerking: '' };

/**
 * Voertuigen (fase A Access-migratie, 13-09): het wagenpark met per bus de
 * drie vervaldata (keuring SBAT, brandblussers, tachograaf), het aantal open
 * defecten en, in het detail, de laatste werkprestaties. Staf beheert de
 * fiche; technieker en staf zetten vervaldata. Zelfde opbouw als
 * VervaldataView: tegels, toolbar, tabel op desktop, kaartlijst op mobiel.
 */
export function VoertuigenView({ currentUser }: { currentUser: User }) {
  const staf = isStaf(currentUser.role);
  const [voertuigen, setVoertuigen] = useState<Vehicle[]>([]);
  const [expiries, setExpiries] = useState<VehicleExpiry[]>([]);
  const [openDefecten, setOpenDefecten] = useState<Defect[]>([]);
  const [filter, setFilter] = useState<Filter>('actief');
  const [categorie, setCategorie] = useState<CategorieFilter>('alle');
  const [zoek, setZoek] = useState('');
  const [detail, setDetail] = useState<Vehicle | null>(null);
  const [bewerk, setBewerk] = useState<{ voertuig: Vehicle | null } | null>(null);
  const sort = useSort<string>('kort');
  const voorkeur = useTabelVoorkeur('voertuigen', KOLOMMEN);

  const zl = useZelfLadend(async () => {
    const [v, e, d] = await Promise.all([laadVoertuigen(), laadVoertuigVervaldata(), laadDefecten({ status: 'open', limit: 2000 })]);
    setVoertuigen(v); setExpiries(e); setOpenDefecten(d);
  }, { boodschap: (err) => (err instanceof Error && err.message ? err.message : 'Kon de voertuigen niet laden.') });

  // Deeplink /techniek/voertuigen/<id> (bv. "Open bus" uit het gele boek):
  // de fiche opent zodra de lijst er is; de parameter gaat daarna weg zodat
  // sluiten niet opnieuw opent.
  const [voertuigParam, zetVoertuigParam] = useRouteParam(0);
  useEffect(() => {
    if (!voertuigParam || voertuigen.length === 0) return;
    const v = voertuigen.find((x) => x.id === voertuigParam);
    if (v) setDetail(v);
    zetVoertuigParam(null);
  }, [voertuigParam, voertuigen, zetVoertuigParam]);

  const perVoertuig = useMemo(() => {
    const m = new Map<string, Partial<Record<VoertuigVervalSoort, VehicleExpiry>>>();
    for (const e of expiries) { const per = m.get(e.vehicleId) ?? {}; per[e.soort] = e; m.set(e.vehicleId, per); }
    return m;
  }, [expiries]);
  const defectenPer = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of openDefecten) m.set(d.vehicleId, (m.get(d.vehicleId) ?? 0) + 1);
    return m;
  }, [openDefecten]);

  type Rij = { v: Vehicle; dagen: Partial<Record<VoertuigVervalSoort, number>>; eerste: number | null; defecten: number };
  const rijen = useMemo<Rij[]>(() => voertuigen.map((v) => {
    const per = perVoertuig.get(v.id) ?? {};
    const dagen: Partial<Record<VoertuigVervalSoort, number>> = {};
    for (const s of VOERTUIG_VERVAL_SOORTEN) { const e = per[s]; if (e) dagen[s] = dagenTot(e.validUntil); }
    const alle = Object.values(dagen).filter((n): n is number => Number.isFinite(n));
    return { v, dagen, eerste: alle.length ? Math.min(...alle) : null, defecten: defectenPer.get(v.id) ?? 0 };
  }), [voertuigen, perVoertuig, defectenPer]);

  const tellers = useMemo(() => ({
    actief: rijen.filter((r) => r.v.status === 'actief').length,
    elektrisch: rijen.filter((r) => r.v.status !== 'uit_dienst' && r.v.aandrijving === 'elektrisch').length,
    verloopt: rijen.filter((r) => r.v.status !== 'uit_dienst' && r.eerste !== null && r.eerste <= 30).length,
    metDefect: rijen.filter((r) => r.defecten > 0).length,
  }), [rijen]);

  const zoekTerm = zoek.trim().toLowerCase();
  const gefilterd = rijen
    .filter((r) => categorie === 'alle' || (r.v.categorie ?? 'bus') === categorie)
    .filter((r) => filter === 'alles' ? true : filter === 'verloopt' ? (r.v.status !== 'uit_dienst' && r.eerste !== null && r.eerste <= 30) : r.v.status === filter)
    .filter((r) => !zoekTerm || `${voertuigNaam(r.v)} ${r.v.busnr} ${r.v.nummerplaat ?? ''} ${r.v.merk ?? ''} ${r.v.chassisnr ?? ''}`.toLowerCase().includes(zoekTerm));
  const gesorteerd = sort.sorteer(gefilterd, (r, k) => {
    if (k === 'kort') return r.v.kortNr ?? 99999;
    if (k === 'nummerplaat') return r.v.nummerplaat ?? '';
    if (k === 'type') return r.v.type;
    if (k === 'aandrijving') return r.v.aandrijving ?? '';
    if (k === 'defecten') return r.defecten;
    if (k === 'eerste') return r.eerste;
    return r.dagen[k as VoertuigVervalSoort] ?? null;
  });

  const chipTone = (dagen: number): BadgeTone => (dagen < 0 ? 'red' : dagen <= 30 ? 'amber' : dagen <= 90 ? 'oker' : 'emerald');
  const kortDatum = (iso: string) => { const d = new Date(`${iso.slice(0, 10)}T00:00:00`); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' }); };
  const dagenTekst = (n: number) => (n < 0 ? 'verlopen' : n === 0 ? 'vandaag' : `${n} d`);
  const datumPil = (r: Rij, soort: VoertuigVervalSoort, metLabel: boolean) => {
    const e = perVoertuig.get(r.v.id)?.[soort];
    if (!e) return <Badge key={soort} tone="slate" className="whitespace-nowrap opacity-70">{metLabel ? `${VOERTUIG_VERVAL_LABEL[soort]}: ` : ''}—</Badge>;
    const n = r.dagen[soort] ?? dagenTot(e.validUntil);
    return (
      <Badge key={soort} tone={chipTone(n)} dot stil={n > 30} className="whitespace-nowrap">
        {metLabel ? `${VOERTUIG_VERVAL_LABEL[soort]}: ` : ''}<span title={formatDateHuman(e.validUntil)}>{kortDatum(e.validUntil)}</span><span className="text-slate-500">· {dagenTekst(n)}</span>
      </Badge>
    );
  };
  const statusBadge = (v: Vehicle) => <Badge tone={v.status === 'actief' ? 'emerald' : v.status === 'reserve' ? 'oker' : 'slate'} stil dot className="whitespace-nowrap">{VOERTUIG_STATUS_LABEL[v.status]}</Badge>;

  const naOpslaan = (v: Vehicle) => {
    setVoertuigen((lijst) => (lijst.some((x) => x.id === v.id) ? lijst.map((x) => (x.id === v.id ? v : x)) : [...lijst, v]));
    if (detail?.id === v.id) setDetail(v);
  };

  return (
    <PageShell>
      <PageHeader
        eyebrow="Techniek"
        title="Voertuigen"
        actions={(
          <>
            <VersheidRegel {...zl.versheid} />
            {staf && <Button variant="primary" icon={<Plus size={16} />} onClick={() => setBewerk({ voertuig: null })}>Voertuig toevoegen</Button>}
          </>
        )}
      />
      {zl.fout && voertuigen.length > 0 && <Foutkaart compact boodschap={zl.fout} offline={!zl.online} onOpnieuw={zl.opnieuw} bezig={zl.laden} />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <OpsStat icon={<Bus size={16} />} tone="slate" label="Actief" value={tellers.actief} sub="in dienst" onClick={() => setFilter('actief')} className={cn(filter === 'actief' && 'ring-2 ring-oker-500/40')} />
        <OpsStat icon={<Zap size={16} />} tone="slate" label="Elektrisch" value={tellers.elektrisch} sub="e-bussen" />
        <OpsStat icon={<ShieldCheck size={16} />} tone={tellers.verloopt > 0 ? 'amber' : 'slate'} label="Verloopt binnen 30 d" value={tellers.verloopt} sub={tellers.verloopt > 0 ? 'keuring of controle plannen' : 'alles in orde'} onClick={() => setFilter('verloopt')} className={cn(filter === 'verloopt' && 'ring-2 ring-oker-500/40')} />
        <OpsStat icon={<Wrench size={16} />} tone={tellers.metDefect > 0 ? 'amber' : 'slate'} label="Met open defect" value={tellers.metDefect} sub="in het gele boek" />
      </div>

      {zl.fout && voertuigen.length === 0 ? (
        <Foutkaart boodschap={zl.fout} offline={!zl.online} onOpnieuw={zl.opnieuw} bezig={zl.laden} />
      ) : zl.laden && voertuigen.length === 0 ? (
        <Card padding="none" className="divide-y divide-slate-100 overflow-hidden" aria-busy="true" aria-label="Voertuigen worden geladen">
          <SkeletonRow className="px-5 py-4" /><SkeletonRow className="px-5 py-4" /><SkeletonRow className="px-5 py-4" />
        </Card>
      ) : voertuigen.length === 0 ? (
        <EmptyState title="Nog geen voertuigen" message={staf ? 'Voeg het eerste voertuig toe of draai de migratie met de seed.' : 'De planning voegt de voertuigen toe.'} action={staf ? <Button variant="primary" onClick={() => setBewerk({ voertuig: null })}>Voertuig toevoegen</Button> : undefined} />
      ) : (
        <div className="surface-table rounded-3xl overflow-clip">
          <div className="border-b border-hairline px-5 py-4 md:px-6">
            <TableToolbar
              zoek={zoek}
              onZoek={setZoek}
              placeholder="Zoek bus, nummerplaat, merk…"
              telling={`${gesorteerd.length} van ${rijen.length}`}
              dichtheid={voorkeur.dichtheid}
              kolommen={voorkeur.kolommen}
              filters={(
                <>
                  <FilterChip active={filter === 'actief'} onClick={() => setFilter('actief')}>Actief</FilterChip>
                  <FilterChip active={filter === 'reserve'} onClick={() => setFilter('reserve')}>Reserve</FilterChip>
                  <FilterChip active={filter === 'uit_dienst'} onClick={() => setFilter('uit_dienst')}>Uit dienst</FilterChip>
                  <FilterChip active={filter === 'verloopt'} onClick={() => setFilter('verloopt')}>Verloopt binnen 30 d</FilterChip>
                  <FilterChip active={filter === 'alles'} onClick={() => setFilter('alles')}>Alles</FilterChip>
                  <span className="mx-1 hidden h-5 w-px bg-slate-200 sm:inline-block" aria-hidden="true" />
                  <FilterChip active={categorie === 'alle'} onClick={() => setCategorie('alle')}>Alle categorieën</FilterChip>
                  {VOERTUIG_CATEGORIEEN.map((c) => <FilterChip key={c} active={categorie === c} onClick={() => setCategorie(c)}>{VOERTUIG_CATEGORIE_MEERVOUD[c]}</FilterChip>)}
                </>
              )}
            />
          </div>
          {gesorteerd.length === 0 ? (
            <div className="p-6"><EmptyState title={zoekTerm ? `Geen voertuigen voor “${zoek.trim()}”` : 'Geen voertuigen voor dit filter'} message="Pas de zoekterm of het filter aan." action={<Button variant="secondary" onClick={() => { setZoek(''); setFilter('alles'); }}>Zoekterm en filter wissen</Button>} /></div>
          ) : (
            <>
              <div className="hidden md:block">
                <table className={cn('w-full text-left border-collapse', voorkeur.tabelClass)}>
                  <StickyThead>
                    <tr>
                      <SortTh kolom="kort" sort={sort}>Bus</SortTh>
                      {voorkeur.zichtbaar('nummerplaat') && <SortTh kolom="nummerplaat" sort={sort}>Nummerplaat</SortTh>}
                      {voorkeur.zichtbaar('type') && <SortTh kolom="type" sort={sort}>Type</SortTh>}
                      {voorkeur.zichtbaar('aandrijving') && <SortTh kolom="aandrijving" sort={sort}>Aandrijving</SortTh>}
                      <Th>Status</Th>
                      {VOERTUIG_VERVAL_SOORTEN.filter((s) => voorkeur.zichtbaar(s)).map((s) => <SortTh key={s} kolom={s} sort={sort}>{VOERTUIG_VERVAL_LABEL[s]}</SortTh>)}
                      {voorkeur.zichtbaar('defecten') && <SortTh kolom="defecten" sort={sort} align="right">Open defecten</SortTh>}
                      <Th className="text-right">Acties</Th>
                    </tr>
                  </StickyThead>
                  <tbody>
                    {gesorteerd.map((r) => (
                      <tr key={r.v.id} onClick={() => setDetail(r.v)} className="cursor-pointer border-b border-hairline-subtle last:border-b-0 transition-colors hover:bg-surface-soft-hover">
                        <Td>
                          <p className="font-semibold text-slate-800">{voertuigNaam(r.v)}</p>
                          <p className="text-xs font-medium text-slate-500">{r.v.busnr}{r.v.merk ? ` · ${r.v.merk}` : ''}</p>
                        </Td>
                        {voorkeur.zichtbaar('nummerplaat') && <Td className="font-mono text-xs">{r.v.nummerplaat ?? '—'}</Td>}
                        {voorkeur.zichtbaar('type') && <Td className="text-sm">{VOERTUIG_TYPE_LABEL[r.v.type]}</Td>}
                        {voorkeur.zichtbaar('aandrijving') && <Td className="text-sm">{r.v.aandrijving ? AANDRIJVING_LABEL[r.v.aandrijving] : '—'}</Td>}
                        <Td>{statusBadge(r.v)}</Td>
                        {VOERTUIG_VERVAL_SOORTEN.filter((s) => voorkeur.zichtbaar(s)).map((s) => <Td key={s}>{datumPil(r, s, false)}</Td>)}
                        {voorkeur.zichtbaar('defecten') && <Td num className={r.defecten > 0 ? 'font-semibold text-amber-700' : 'text-slate-500'}>{r.defecten || '—'}</Td>}
                        <Td className="text-right">
                          <IconButton label={`${voertuigNaam(r.v)} openen`} title="Openen" variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); setDetail(r.v); }}><Pencil size={16} /></IconButton>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="md:hidden divide-y divide-slate-100">
                {gesorteerd.map((r) => (
                  // rauw: hele kaartrij (naam + pillen) is de knop die het detail opent
                  <button key={r.v.id} type="button" onClick={() => setDetail(r.v)} className="ios-pressable flex min-h-11 w-full flex-col gap-2 px-5 py-3.5 text-left transition-colors hover:bg-surface-soft-hover">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="min-w-0 truncate text-sm font-semibold text-slate-800">{voertuigNaam(r.v)} <span className="font-medium text-slate-500">· {r.v.nummerplaat ?? r.v.busnr}</span></p>
                      {statusBadge(r.v)}
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {VOERTUIG_VERVAL_SOORTEN.map((s) => datumPil(r, s, true))}
                      {r.defecten > 0 && <Badge tone="amber" dot className="whitespace-nowrap">{r.defecten} open</Badge>}
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {detail && (
        <DetailModal
          voertuig={detail}
          staf={staf}
          currentUser={currentUser}
          vervaldata={perVoertuig.get(detail.id) ?? {}}
          defecten={openDefecten.filter((d) => d.vehicleId === detail.id)}
          onClose={() => setDetail(null)}
          onBewerk={() => setBewerk({ voertuig: detail })}
          onVervaldatum={async (soort, validUntil, opmerking) => {
            await zetVoertuigVervaldatum(detail.id, { soort, validUntil: validUntil || null, opmerking: opmerking || null });
            setExpiries((lijst) => {
              const zonder = lijst.filter((e) => !(e.vehicleId === detail.id && e.soort === soort));
              return validUntil ? [...zonder, { vehicleId: detail.id, soort, validUntil, opmerking: opmerking || null }] : zonder;
            });
          }}
          onDefectGemeld={(d) => setOpenDefecten((lijst) => [d, ...lijst])}
        />
      )}
      {bewerk && (
        <BewerkModal
          voertuig={bewerk.voertuig}
          onClose={() => setBewerk(null)}
          onKlaar={(v) => { naOpslaan(v); setBewerk(null); }}
          onVerwijderd={(id) => { setVoertuigen((lijst) => lijst.filter((x) => x.id !== id)); setDetail(null); setBewerk(null); }}
        />
      )}
    </PageShell>
  );
}

function DetailModal({ voertuig, staf, currentUser, vervaldata, defecten, onClose, onBewerk, onVervaldatum, onDefectGemeld }: {
  voertuig: Vehicle;
  staf: boolean;
  currentUser: User;
  vervaldata: Partial<Record<VoertuigVervalSoort, VehicleExpiry>>;
  defecten: Defect[];
  onClose: () => void;
  onBewerk: () => void;
  onVervaldatum: (soort: VoertuigVervalSoort, validUntil: string, opmerking: string) => Promise<void>;
  onDefectGemeld: (d: Defect) => void;
}) {
  const [draft, setDraft] = useState<Record<string, { datum: string; opmerking: string }>>(() => Object.fromEntries(VOERTUIG_VERVAL_SOORTEN.map((s) => [s, { datum: vervaldata[s]?.validUntil ?? '', opmerking: vervaldata[s]?.opmerking ?? '' }])));
  const [bezig, setBezig] = useState(false);
  const [prestaties, setPrestaties] = useState<Werkprestatie[] | null>(null);
  const [melden, setMelden] = useState(false);
  useEffect(() => { void laadWerkprestaties({ vehicleId: voertuig.id, limit: 8 }).then(setPrestaties).catch(() => setPrestaties([])); }, [voertuig.id]);

  const opslaan = async () => {
    if (bezig) return;
    setBezig(true);
    // Alleen de gewijzigde soorten; fouten per soort, één toast (src/lib/bulk.ts).
    const gewijzigd = VOERTUIG_VERVAL_SOORTEN.filter((s) => {
      const d = draft[s]; const oud = vervaldata[s];
      return (d.datum || '') !== (oud?.validUntil ?? '') || (d.opmerking || '') !== (oud?.opmerking ?? '');
    });
    const resultaat = await bulkUitvoeren(gewijzigd, (s) => onVervaldatum(s, draft[s].datum, draft[s].opmerking));
    setBezig(false);
    meldBulkResultaat(notify, resultaat, {
      item: ['vervaldatum', 'vervaldata'],
      gedaan: 'opgeslagen',
      allesGelukt: 'Vervaldata opgeslagen.',
      rest: (f) => `, niet gelukt: ${f.map((x) => VOERTUIG_VERVAL_LABEL[x.item]).join(', ')}`,
    });
  };
  const veld = (label: string, waarde: string | number | null | undefined) => (
    <div className="min-w-0"><dt className="text-micro">{label}</dt><dd className="truncate text-sm font-medium text-slate-800">{waarde ?? '—'}</dd></div>
  );

  return (
    <Modal open onClose={onClose} maxWidth="2xl" ariaLabel={`Voertuig ${voertuigNaam(voertuig)}`}>
      <div className="space-y-5 p-6">
        <CardHeader
          size="lg"
          title={voertuigNaam(voertuig)}
          description={`${voertuig.busnr}${voertuig.merk ? ` · ${voertuig.merk}` : ''} · ${VOERTUIG_CATEGORIE_LABEL[voertuig.categorie ?? 'bus']}, ${VOERTUIG_TYPE_LABEL[voertuig.type].toLowerCase()}${voertuig.aandrijving ? `, ${AANDRIJVING_LABEL[voertuig.aandrijving].toLowerCase()}` : ''}`}
          aside={(
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" icon={<Wrench size={14} />} onClick={() => setMelden(true)}>Defect melden</Button>
              {staf && <Button variant="secondary" size="sm" icon={<Pencil size={14} />} onClick={onBewerk}>Fiche bewerken</Button>}
            </div>
          )}
        />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
          {veld('Nummerplaat', voertuig.nummerplaat)}
          {veld('Chassisnummer', voertuig.chassisnr)}
          {veld('Status', VOERTUIG_STATUS_LABEL[voertuig.status])}
          {veld('Zitplaatsen', voertuig.zitplaatsen)}
          {veld('In dienst sinds', voertuig.inDienst ? formatDateHuman(voertuig.inDienst) : null)}
          {veld('Uit dienst', voertuig.uitDienst ? formatDateHuman(voertuig.uitDienst) : null)}
          {voertuig.opmerking && <div className="col-span-2 min-w-0"><dt className="text-micro">Opmerking</dt><dd className="text-sm text-slate-700">{voertuig.opmerking}</dd></div>}
        </dl>

        <section className="space-y-3">
          <CardHeader title="Vervaldata" description="Leeg laten = niet bewaken." />
          <div className="grid gap-3 sm:grid-cols-3">
            {VOERTUIG_VERVAL_SOORTEN.map((s) => (
              <div key={s} className="space-y-2 rounded-2xl bg-surface-muted p-3">
                <Field label={VOERTUIG_VERVAL_LABEL[s]}>{({ id }) => <DateInput id={id} value={draft[s].datum} onChange={(v) => setDraft((d) => ({ ...d, [s]: { ...d[s], datum: v } }))} />}</Field>
                <Input aria-label={`Opmerking ${VOERTUIG_VERVAL_LABEL[s]}`} value={draft[s].opmerking} maxLength={120} placeholder="Opmerking (bv. 2 stuks)" onChange={(e) => setDraft((d) => ({ ...d, [s]: { ...d[s], opmerking: e.target.value } }))} />
              </div>
            ))}
          </div>
          <div className="flex justify-end"><Button variant="primary" size="sm" onClick={() => void opslaan()} disabled={bezig}>{bezig ? 'Bezig…' : 'Vervaldata opslaan'}</Button></div>
        </section>

        <section className="space-y-2">
          <CardHeader title="Open defecten" aside={<span className="text-xs font-medium text-slate-500">{defecten.length}</span>} />
          {defecten.length === 0 ? (
            <EmptyState compact variant="klaar" title="Niets open" message="Geen openstaande meldingen voor deze bus." />
          ) : (
            <ul className="divide-y divide-slate-100 rounded-2xl border border-hairline">
              {defecten.map((d) => (
                <li key={d.id} className="px-3.5 py-2.5">
                  <p className="text-sm text-slate-800"><span className="font-semibold">{WERKTYPE_LABEL[d.werktype]}</span> · {d.omschrijving}</p>
                  <p className="text-xs text-slate-500">{d.gemeldDoorNaam ?? 'onbekend'} · {formatRelatief(d.gemeldOp)}</p>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="space-y-2">
          <CardHeader title="Laatste werkprestaties" />
          {prestaties === null ? <SkeletonRow className="px-2 py-2" /> : prestaties.length === 0 ? (
            <EmptyState compact title="Nog geen werkprestaties" message="Wat de garage aan deze bus doet, verschijnt hier." />
          ) : (
            <ul className="divide-y divide-slate-100 rounded-2xl border border-hairline">
              {prestaties.map((w) => (
                <li key={w.id} className="flex items-start gap-3 px-3.5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-800"><span className="font-semibold">{w.werkcode}</span> · {w.omschrijving}</p>
                    <p className="text-xs text-slate-500">{formatDateHuman(w.datum)}{w.mecanicienNaam ? ` · ${w.mecanicienNaam}` : ''}</p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-slate-700">{urenTekst(w.werkuren)} u</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <div className="flex justify-end"><Button variant="ghost" onClick={onClose}>Sluiten</Button></div>
      </div>
      {melden && (
        <Suspense fallback={<ViewLoader />}>
          <LazyDefectMeldenModal open onClose={() => setMelden(false)} currentUser={currentUser} vasteBusId={voertuig.id} onGemeld={onDefectGemeld} />
        </Suspense>
      )}
    </Modal>
  );
}

function BewerkModal({ voertuig, onClose, onKlaar, onVerwijderd }: { voertuig: Vehicle | null; onClose: () => void; onKlaar: (v: Vehicle) => void; onVerwijderd: (id: string) => void }) {
  const [form, setForm] = useState<VehicleBody>(() => voertuig ? { busnr: voertuig.busnr, kortNr: voertuig.kortNr ?? null, nummerplaat: voertuig.nummerplaat ?? '', chassisnr: voertuig.chassisnr ?? '', merk: voertuig.merk ?? '', type: voertuig.type, categorie: voertuig.categorie ?? 'bus', aandrijving: voertuig.aandrijving ?? null, status: voertuig.status, inDienst: voertuig.inDienst ?? '', uitDienst: voertuig.uitDienst ?? '', zitplaatsen: voertuig.zitplaatsen ?? null, opmerking: voertuig.opmerking ?? '' } : LEEG_FORM);
  const [fouten, setFouten] = useState<Record<string, string>>({});
  const [bezig, setBezig] = useState(false);
  const zet = <K extends keyof VehicleBody>(k: K, v: VehicleBody[K]) => setForm((f) => ({ ...f, [k]: v }));
  const getal = (s: string): number | null => (s.trim() === '' ? null : Number(s));

  const opslaan = async () => {
    if (bezig) return;
    setBezig(true); setFouten({});
    try {
      const v = voertuig ? await bewaarVoertuig(voertuig.id, form) : await maakVoertuig(form);
      notify(voertuig ? 'Voertuig bijgewerkt.' : 'Voertuig toegevoegd.', 'success');
      onKlaar(v);
    } catch (err) {
      if (err instanceof TechniekFout && err.veldfouten) setFouten(err.veldfouten);
      notify(err instanceof Error ? err.message : 'Bewaren is mislukt.', 'error');
    } finally { setBezig(false); }
  };
  const verwijderen = async () => {
    if (!voertuig || bezig) return;
    setBezig(true);
    try {
      await verwijderVoertuig(voertuig.id);
      notify('Voertuig verwijderd.', 'success');
      onVerwijderd(voertuig.id);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Verwijderen is mislukt.', 'error');
    } finally { setBezig(false); }
  };

  return (
    <Modal open onClose={onClose} maxWidth="lg" ariaLabel={voertuig ? `Fiche van ${voertuigNaam(voertuig)} bewerken` : 'Voertuig toevoegen'} boven>
      <div className="p-6">
        <CardHeader title={voertuig ? `${voertuigNaam(voertuig)}: fiche` : 'Nieuw voertuig'} />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Busnummer" required hint="Zoals op de bus, bv. 613 026" error={fouten.busnr}>{({ id, invalid }) => <Input id={id} invalid={invalid} value={form.busnr} onChange={(e) => zet('busnr', e.target.value)} />}</Field>
          <Field label="Kort nummer" hint="Zoals chauffeurs het zeggen, bv. 26" error={fouten.kortNr}>{({ id, invalid }) => <Input id={id} invalid={invalid} inputMode="numeric" value={form.kortNr ?? ''} onChange={(e) => zet('kortNr', getal(e.target.value))} />}</Field>
          <Field label="Nummerplaat" error={fouten.nummerplaat}>{({ id, invalid }) => <Input id={id} invalid={invalid} value={form.nummerplaat ?? ''} onChange={(e) => zet('nummerplaat', e.target.value)} />}</Field>
          <Field label="Chassisnummer" error={fouten.chassisnr}>{({ id, invalid }) => <Input id={id} invalid={invalid} value={form.chassisnr ?? ''} onChange={(e) => zet('chassisnr', e.target.value)} />}</Field>
          <Field label="Merk en model" error={fouten.merk}>{({ id, invalid }) => <Input id={id} invalid={invalid} value={form.merk ?? ''} onChange={(e) => zet('merk', e.target.value)} />}</Field>
          <Field label="Zitplaatsen" error={fouten.zitplaatsen}>{({ id, invalid }) => <Input id={id} invalid={invalid} inputMode="numeric" value={form.zitplaatsen ?? ''} onChange={(e) => zet('zitplaatsen', getal(e.target.value))} />}</Field>
          <Field label="Categorie" error={fouten.categorie}>{({ id }) => <Select id={id} value={form.categorie} onChange={(e) => zet('categorie', e.target.value as VehicleBody['categorie'])}>{VOERTUIG_CATEGORIEEN.map((c) => <option key={c} value={c}>{VOERTUIG_CATEGORIE_LABEL[c]}</option>)}</Select>}</Field>
          <Field label="Type" error={fouten.type}>{({ id }) => <Select id={id} value={form.type} onChange={(e) => zet('type', e.target.value as VehicleBody['type'])}>{VOERTUIG_TYPES.map((t) => <option key={t} value={t}>{VOERTUIG_TYPE_LABEL[t]}</option>)}</Select>}</Field>
          <Field label="Aandrijving" error={fouten.aandrijving}>{({ id }) => <Select id={id} value={form.aandrijving ?? ''} onChange={(e) => zet('aandrijving', (e.target.value || null) as VehicleBody['aandrijving'])}><option value="">Onbekend</option>{AANDRIJVINGEN.map((a) => <option key={a} value={a}>{AANDRIJVING_LABEL[a]}</option>)}</Select>}</Field>
          <Field label="Status" error={fouten.status}>{({ id }) => <Select id={id} value={form.status} onChange={(e) => zet('status', e.target.value as VehicleBody['status'])}>{VOERTUIG_STATUSSEN.map((s) => <option key={s} value={s}>{VOERTUIG_STATUS_LABEL[s]}</option>)}</Select>}</Field>
          <Field label="In dienst sinds" error={fouten.inDienst}>{({ id }) => <DateInput id={id} value={form.inDienst ?? ''} onChange={(v) => zet('inDienst', v)} />}</Field>
          <Field label="Uit dienst op" error={fouten.uitDienst}>{({ id }) => <DateInput id={id} value={form.uitDienst ?? ''} onChange={(v) => zet('uitDienst', v)} />}</Field>
          <Field label="Opmerking" className="sm:col-span-2" error={fouten.opmerking}>{({ id, invalid }) => <Input id={id} invalid={invalid} value={form.opmerking ?? ''} maxLength={300} onChange={(e) => zet('opmerking', e.target.value)} />}</Field>
        </div>
        {voertuig && (
          <Card tone="muted" padding="sm" className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1.5"><AlertTriangle size={14} /> Verwijderen kan alleen zonder meldingen of prestaties; anders zet je de status op “Uit dienst”.</span>
            <Button variant="danger" size="sm" onClick={() => void verwijderen()} disabled={bezig}>Verwijderen</Button>
          </Card>
        )}
        <div className="mt-5 flex gap-3">
          <Button variant="ghost" className="flex-1" onClick={onClose}>Annuleren</Button>
          <Button variant="primary" className="flex-1" onClick={() => void opslaan()} disabled={bezig}>{bezig ? 'Bezig…' : 'Opslaan'}</Button>
        </div>
      </div>
    </Modal>
  );
}
