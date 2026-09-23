import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Bus, Pencil, Plus, ShieldCheck, Wrench, Zap } from 'lucide-react';
import type { User } from '../../types';
import { isStaf } from '../../types';
import {
  AANDRIJVINGEN, AANDRIJVING_LABEL, VOERTUIG_CATEGORIEEN, VOERTUIG_CATEGORIE_LABEL, VOERTUIG_CATEGORIE_MEERVOUD, VOERTUIG_STATUSSEN, VOERTUIG_STATUS_LABEL, VOERTUIG_TYPES, VOERTUIG_TYPE_LABEL,
  type VoertuigCategorie,
  VOERTUIG_VERVAL_LABEL, VOERTUIG_VERVAL_SOORTEN, WERKTYPE_LABEL, voertuigNaam, type VoertuigVervalSoort,
} from '../../../shared/techniek';
import { notify } from '../../lib/ui';
import { bulkUitvoeren, meldBulkResultaat } from '../../lib/bulk';
import { useZelfLadend } from '../../lib/zelfLadend';
import { useRouteParam } from '../../app/router';
import { formatDateHuman, formatRelatief } from '../../lib/format';
import {
  bewaarVoertuig, dagenTot, laadDefecten, laadVoertuigVervaldata, laadVoertuigWerken, laadVoertuigen, maakVoertuig, TechniekFout,
  urenTekst, verwijderVoertuig, zetVoertuigVervaldatum, type Defect, type Vehicle, type VehicleBody, type VehicleExpiry, type Werkprestatie,
} from '../../lib/techniek';
import { ConfirmationModal, EmptyState, Foutkaart, PageHeader, PageShell, VersheidRegel, ViewLoader } from '../../components/ui';
import { Modal, SluitKnop } from '../../components/Modal';
import { Formulier } from '../../components/Formulier';
import { useVeldfouten, useVuil } from '../../lib/formulier';
import { meldSchrijffout } from '../../lib/fouten';
import { OpsStat } from '../../components/ops';
import { SkeletonRow } from '../../components/Skeleton';
import { Card, CardHeader } from '../../components/Card';
import { DateInput, Field, Input, Select } from '../../components/Field';
import { Badge, Button, FilterChip, StatusBadge } from '../../components/primitives';
import { Tabel, TableShell, Td, Th } from '../../components/TabelBasis';
import { VervalPil } from '../../components/VervalPil';
import { VOERTUIG_STATUS } from '../../../shared/status';
import { CelKnop, SortTh, StickyThead, TableToolbar, rijKlik, useSort, useTabelVoorkeur } from '../../components/Table';

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

  // Deeplink /techniek/voertuigen/<id> (bv. "Open bus" uit de gele boek):
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

  /** Vervaldatum per soort (VervalPil); `metLabel` voor de kaart op de telefoon (daar is geen kolomkop). */
  const datumPil = (r: Rij, soort: VoertuigVervalSoort, metLabel: boolean) => {
    const e = perVoertuig.get(r.v.id)?.[soort];
    return <VervalPil key={soort} datum={e?.validUntil} dagen={e ? r.dagen[soort] : undefined} label={metLabel ? VOERTUIG_VERVAL_LABEL[soort] : undefined} />;
  };
  const statusBadge = (v: Vehicle) => <StatusBadge status={v.status} map={VOERTUIG_STATUS} stil className="whitespace-nowrap" />;

  const naOpslaan = (v: Vehicle) => {
    setVoertuigen((lijst) => (lijst.some((x) => x.id === v.id) ? lijst.map((x) => (x.id === v.id ? v : x)) : [...lijst, v]));
    if (detail?.id === v.id) setDetail(v);
  };

  // De lege staat draagt dezelfde actie als de kopknop; dan hoort er maar
  // één gouden knop in beeld te staan (punt 13, 16-09).
  const legeStaat = voertuigen.length === 0 && !zl.laden && !zl.fout;

  return (
    <PageShell>
      <PageHeader
        view="voertuigen"
        title="Voertuigen"
        actions={(
          <>
            <VersheidRegel {...zl.versheid} />
            {staf && !legeStaat && <Button variant="primary" icon={<Plus size={16} />} onClick={() => setBewerk({ voertuig: null })}>Voertuig toevoegen</Button>}
          </>
        )}
      />
      {zl.fout && voertuigen.length > 0 && <Foutkaart compact boodschap={zl.fout} offline={!zl.online} onOpnieuw={zl.opnieuw} bezig={zl.laden} />}

      <div className="kpi-raster grid grid-cols-2 gap-3 md:grid-cols-4">
        <OpsStat icon={<Bus size={16} />} tone="slate" label="Actief" value={tellers.actief} sub="in dienst" onClick={() => setFilter('actief')} actief={filter === 'actief'} />
        <OpsStat icon={<Zap size={16} />} tone="slate" label="Elektrisch" value={tellers.elektrisch} sub="e-bussen" />
        <OpsStat icon={<ShieldCheck size={16} />} tone={tellers.verloopt > 0 ? 'amber' : 'slate'} label="Verloopt binnen 30 d" value={tellers.verloopt} sub={tellers.verloopt > 0 ? 'keuring of controle plannen' : 'alles in orde'} onClick={() => setFilter('verloopt')} actief={filter === 'verloopt'} />
        <OpsStat icon={<Wrench size={16} />} tone={tellers.metDefect > 0 ? 'amber' : 'slate'} label="Met open defect" value={tellers.metDefect} sub="in de gele boek" />
      </div>

      {zl.fout && voertuigen.length === 0 ? (
        <Foutkaart boodschap={zl.fout} offline={!zl.online} onOpnieuw={zl.opnieuw} bezig={zl.laden} />
      ) : zl.laden && voertuigen.length === 0 ? (
        <Card padding="none" className="divide-y divide-hairline-subtle overflow-hidden" role="status" aria-busy="true" aria-label="Voertuigen worden geladen">
          <SkeletonRow className="px-5 py-4" /><SkeletonRow className="px-5 py-4" /><SkeletonRow className="px-5 py-4" />
        </Card>
      ) : voertuigen.length === 0 ? (
        <EmptyState title="Nog geen voertuigen" message={staf ? 'Voeg het eerste voertuig toe of draai de migratie met de seed.' : 'De planning voegt de voertuigen toe.'} action={staf ? <Button variant="primary" onClick={() => setBewerk({ voertuig: null })}>Voertuig toevoegen</Button> : undefined} />
      ) : (
        // TableShell standaard (schuiven in het kader): met alle vervalkolommen
        // aan is de tabel breder dan de kaart, ook op 1280 px naast de
        // zijbalk (B2, ronde 5). De kolomkop plakt dan niet (zie StickyThead).
        // Onder md een kaartlijst met dezelfde rijen.
        <TableShell
          label="Voertuigen"
          kop={(
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
          )}
        >
          {gesorteerd.length === 0 ? (
            <div className="p-6"><EmptyState title={zoekTerm ? `Geen voertuigen voor “${zoek.trim()}”` : 'Geen voertuigen voor dit filter'} message="Pas de zoekterm of het filter aan." action={<Button variant="secondary" onClick={() => { setZoek(''); setFilter('alles'); }}>Zoekterm en filter wissen</Button>} /></div>
          ) : (
            <>
              <div className="hidden md:block">
                <Tabel className={voorkeur.tabelClass}>
                  <StickyThead>
                    <tr>
                      <SortTh kolom="kort" sort={sort}>Bus</SortTh>
                      {voorkeur.zichtbaar('nummerplaat') && <SortTh kolom="nummerplaat" sort={sort}>Nummerplaat</SortTh>}
                      {voorkeur.zichtbaar('type') && <SortTh kolom="type" sort={sort}>Type</SortTh>}
                      {voorkeur.zichtbaar('aandrijving') && <SortTh kolom="aandrijving" sort={sort}>Aandrijving</SortTh>}
                      <Th>Status</Th>
                      {VOERTUIG_VERVAL_SOORTEN.filter((s) => voorkeur.zichtbaar(s)).map((s) => <SortTh key={s} kolom={s} sort={sort}>{VOERTUIG_VERVAL_LABEL[s]}</SortTh>)}
                      {voorkeur.zichtbaar('defecten') && <SortTh kolom="defecten" sort={sort} align="right">Open defecten</SortTh>}
                    </tr>
                  </StickyThead>
                  <tbody>
                    {gesorteerd.map((r) => (
                      // De bus is de knop (Tab + Enter opent de fiche); een klik
                      // ergens in de rij doet hetzelfde voor de muis.
                      <tr key={r.v.id} onClick={rijKlik(() => setDetail(r.v))} className="cursor-pointer border-b border-hairline-subtle last:border-b-0 transition-colors hover:bg-surface-soft-hover">
                        <Td nowrap>
                          <CelKnop onClick={() => setDetail(r.v)} label={`${voertuigNaam(r.v)} openen`}>
                            <span className="block font-semibold text-slate-800">{voertuigNaam(r.v)}</span>
                            <span className="block text-xs font-medium text-slate-500">{r.v.busnr}{r.v.merk ? ` · ${r.v.merk}` : ''}</span>
                          </CelKnop>
                        </Td>
                        {voorkeur.zichtbaar('nummerplaat') && <Td nowrap className="font-mono text-xs">{r.v.nummerplaat ?? '—'}</Td>}
                        {voorkeur.zichtbaar('type') && <Td nowrap>{VOERTUIG_TYPE_LABEL[r.v.type]}</Td>}
                        {voorkeur.zichtbaar('aandrijving') && <Td nowrap>{r.v.aandrijving ? AANDRIJVING_LABEL[r.v.aandrijving] : '—'}</Td>}
                        <Td nowrap>{statusBadge(r.v)}</Td>
                        {VOERTUIG_VERVAL_SOORTEN.filter((s) => voorkeur.zichtbaar(s)).map((s) => <Td key={s} nowrap>{datumPil(r, s, false)}</Td>)}
                        {voorkeur.zichtbaar('defecten') && <Td num className={r.defecten > 0 ? 'font-semibold text-amber-700' : 'text-slate-500'}>{r.defecten || '—'}</Td>}
                      </tr>
                    ))}
                  </tbody>
                </Tabel>
              </div>
              <div className="md:hidden divide-y divide-hairline-subtle">
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
        </TableShell>
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
  // Alle werken aan deze bus, niet alleen die van de kijker: /api/werkprestaties
  // beperkt een technieker tot zijn eigen rijen en toonde hem dus een halve fiche.
  useEffect(() => { void laadVoertuigWerken(voertuig.id, { limit: 8 }).then(setPrestaties).catch(() => setPrestaties([])); }, [voertuig.id]);

  const vervalFouten = useVeldfouten();
  // Alleen de gewijzigde soorten; vergeleken met wat de server nu heeft, zodat
  // een soort die bewaard is meteen weer "schoon" is en een mislukte blijft staan.
  const gewijzigd = VOERTUIG_VERVAL_SOORTEN.filter((s) => {
    const d = draft[s]; const oud = vervaldata[s];
    return (d.datum || '') !== (oud?.validUntil ?? '') || (d.opmerking || '') !== (oud?.opmerking ?? '');
  });
  const vuil = gewijzigd.length > 0;

  const opslaan = async () => {
    if (bezig) return;
    vervalFouten.wis();
    setBezig(true);
    // Fouten per soort (src/lib/bulk.ts); een veldfout van de server staat bij
    // die soort en komt niet nog eens in de toast.
    const veldfouten: Record<string, string> = {};
    const errs = new Map<VoertuigVervalSoort, unknown>();
    const resultaat = await bulkUitvoeren(gewijzigd, async (s) => {
      try {
        await onVervaldatum(s, draft[s].datum, draft[s].opmerking);
      } catch (err) {
        if (err instanceof TechniekFout && err.veldfouten) veldfouten[s] = Object.values(err.veldfouten)[0] ?? err.message;
        errs.set(s, err);
        throw err;
      }
    });
    setBezig(false);
    if (Object.keys(veldfouten).length > 0) vervalFouten.zet(veldfouten);
    const overig = resultaat.mislukt.filter((f) => !(f.item in veldfouten));
    if (resultaat.gelukt.length === 0 && overig.length > 0) {
      // Niets bewaard: één fout met vervolgstap. Opnieuw is veilig (PUT per soort).
      meldSchrijffout('Vervaldata opslaan', errs.get(overig[0].item), () => void opslaan());
      return;
    }
    meldBulkResultaat(notify, { gelukt: resultaat.gelukt, mislukt: overig, totaal: resultaat.gelukt.length + overig.length }, {
      item: ['vervaldatum', 'vervaldata'],
      gedaan: 'opgeslagen',
      allesGelukt: Object.keys(veldfouten).length === 0 ? 'Vervaldata opgeslagen.' : undefined,
      rest: (f) => `, niet gelukt: ${f.map((x) => VOERTUIG_VERVAL_LABEL[x.item]).join(', ')}`,
    });
  };
  const veld = (label: string, waarde: string | number | null | undefined) => (
    <div className="min-w-0"><dt className="text-micro">{label}</dt><dd className="truncate text-sm font-medium text-slate-800">{waarde ?? '—'}</dd></div>
  );

  return (
    <Modal open onClose={onClose} vuil={vuil} maxWidth="2xl" ariaLabel={`Voertuig ${voertuigNaam(voertuig)}`}>
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

        <Formulier onVerstuur={opslaan} noValidate className="space-y-3">
          <CardHeader title="Vervaldata" description="Leeg laten = niet bewaken." />
          <div className="grid gap-3 sm:grid-cols-3">
            {VOERTUIG_VERVAL_SOORTEN.map((s) => (
              <div key={s} className="space-y-2 rounded-2xl bg-surface-muted p-3">
                <Field label={VOERTUIG_VERVAL_LABEL[s]} error={vervalFouten.fouten[s]}>
                  <DateInput value={draft[s].datum} onChange={(v) => { setDraft((d) => ({ ...d, [s]: { ...d[s], datum: v } })); vervalFouten.wisVeld(s); }} />
                </Field>
                <Input aria-label={`Opmerking ${VOERTUIG_VERVAL_LABEL[s]}`} value={draft[s].opmerking} maxLength={120} placeholder="Opmerking (bv. 2 stuks)" onChange={(e) => { setDraft((d) => ({ ...d, [s]: { ...d[s], opmerking: e.target.value } })); vervalFouten.wisVeld(s); }} />
              </div>
            ))}
          </div>
          <div className="flex justify-end"><Button type="submit" variant="primary" size="sm" bezig={bezig}>Vervaldata opslaan</Button></div>
        </Formulier>

        <section className="space-y-2">
          <CardHeader title="Open defecten" aside={<span className="text-xs font-medium text-slate-500">{defecten.length}</span>} />
          {defecten.length === 0 ? (
            <EmptyState compact variant="klaar" title="Niets open" message="Geen openstaande meldingen voor deze bus." />
          ) : (
            <ul className="divide-y divide-hairline-subtle rounded-2xl border border-hairline">
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
            <ul className="divide-y divide-hairline-subtle rounded-2xl border border-hairline">
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
        <div className="flex justify-end"><SluitKnop onClose={onClose} variant="ghost">Sluiten</SluitKnop></div>
      </div>
      {melden && (
        <Suspense fallback={<ViewLoader />}>
          <LazyDefectMeldenModal open onClose={() => setMelden(false)} currentUser={currentUser} vasteBusId={voertuig.id} onGemeld={onDefectGemeld} />
        </Suspense>
      )}
    </Modal>
  );
}

export function BewerkModal({ voertuig, onClose, onKlaar, onVerwijderd }: { voertuig: Vehicle | null; onClose: () => void; onKlaar: (v: Vehicle) => void; onVerwijderd: (id: string) => void }) {
  const [form, setForm] = useState<VehicleBody>(() => voertuig ? { busnr: voertuig.busnr, kortNr: voertuig.kortNr ?? null, nummerplaat: voertuig.nummerplaat ?? '', chassisnr: voertuig.chassisnr ?? '', merk: voertuig.merk ?? '', type: voertuig.type, categorie: voertuig.categorie ?? 'bus', aandrijving: voertuig.aandrijving ?? null, status: voertuig.status, inDienst: voertuig.inDienst ?? '', uitDienst: voertuig.uitDienst ?? '', zitplaatsen: voertuig.zitplaatsen ?? null, opmerking: voertuig.opmerking ?? '' } : LEEG_FORM);
  const fouten = useVeldfouten();
  const [bezig, setBezig] = useState(false);
  const { vuil } = useVuil(form);
  const zet = <K extends keyof VehicleBody>(k: K, v: VehicleBody[K]) => { setForm((f) => ({ ...f, [k]: v })); fouten.wisVeld(k); };
  const getal = (s: string): number | null => (s.trim() === '' ? null : Number(s));

  const opslaan = async () => {
    if (bezig) return;
    fouten.wis();
    setBezig(true);
    try {
      const v = voertuig ? await bewaarVoertuig(voertuig.id, form) : await maakVoertuig(form);
      notify(voertuig ? 'Voertuig bijgewerkt.' : 'Voertuig toegevoegd.', 'success');
      onKlaar(v);
    } catch (err) {
      // Veldfouten bij het veld; de rest één toast met vervolgstap. Opnieuw
      // alleen bij bijwerken (PUT op id), nooit bij toevoegen.
      if (err instanceof TechniekFout && err.veldfouten) fouten.zet(err.veldfouten);
      else meldSchrijffout('Opslaan', err, voertuig ? () => void opslaan() : undefined);
    } finally { setBezig(false); }
  };
  const [bevestigVerwijderen, setBevestigVerwijderen] = useState(false);
  // Pas na de bevestiging, server-confirmed: de dialoog toont `bezig` tot de
  // server antwoordt. Geen optimistische verwijdering en geen ongedaan maken:
  // de API kent geen zachte verwijdering (DELETE wist de rij, vervaldata gaan
  // mee via on delete cascade). Opnieuw is veilig: DELETE op een id.
  const verwijderen = async () => {
    if (!voertuig) return;
    setBezig(true);
    try {
      await verwijderVoertuig(voertuig.id);
      notify('Voertuig verwijderd.', 'success');
      onVerwijderd(voertuig.id);
    } catch (err) {
      meldSchrijffout('Verwijderen', err, () => void verwijderen());
    } finally { setBezig(false); }
  };

  return (
    <Modal open onClose={onClose} maxWidth="lg" ariaLabel={voertuig ? `Fiche van ${voertuigNaam(voertuig)} bewerken` : 'Voertuig toevoegen'} boven vuil={vuil}>
      <Formulier onVerstuur={opslaan} noValidate className="p-6">
        <CardHeader title={voertuig ? `${voertuigNaam(voertuig)}: fiche` : 'Nieuw voertuig'} />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Busnummer" required hint="Zoals op de bus, bv. 613 026" error={fouten.fouten.busnr}><Input value={form.busnr} onChange={(e) => zet('busnr', e.target.value)} /></Field>
          <Field label="Kort nummer" hint="Zoals chauffeurs het zeggen, bv. 26" error={fouten.fouten.kortNr}><Input inputMode="numeric" value={form.kortNr ?? ''} onChange={(e) => zet('kortNr', getal(e.target.value))} /></Field>
          <Field label="Nummerplaat" error={fouten.fouten.nummerplaat}><Input value={form.nummerplaat ?? ''} onChange={(e) => zet('nummerplaat', e.target.value)} /></Field>
          <Field label="Chassisnummer" error={fouten.fouten.chassisnr}><Input value={form.chassisnr ?? ''} onChange={(e) => zet('chassisnr', e.target.value)} /></Field>
          <Field label="Merk en model" error={fouten.fouten.merk}><Input value={form.merk ?? ''} onChange={(e) => zet('merk', e.target.value)} /></Field>
          <Field label="Zitplaatsen" error={fouten.fouten.zitplaatsen}><Input inputMode="numeric" value={form.zitplaatsen ?? ''} onChange={(e) => zet('zitplaatsen', getal(e.target.value))} /></Field>
          <Field label="Categorie" error={fouten.fouten.categorie}><Select value={form.categorie} onChange={(e) => zet('categorie', e.target.value as VehicleBody['categorie'])}>{VOERTUIG_CATEGORIEEN.map((c) => <option key={c} value={c}>{VOERTUIG_CATEGORIE_LABEL[c]}</option>)}</Select></Field>
          <Field label="Type" error={fouten.fouten.type}><Select value={form.type} onChange={(e) => zet('type', e.target.value as VehicleBody['type'])}>{VOERTUIG_TYPES.map((t) => <option key={t} value={t}>{VOERTUIG_TYPE_LABEL[t]}</option>)}</Select></Field>
          <Field label="Aandrijving" error={fouten.fouten.aandrijving}><Select value={form.aandrijving ?? ''} onChange={(e) => zet('aandrijving', (e.target.value || null) as VehicleBody['aandrijving'])}><option value="">Onbekend</option>{AANDRIJVINGEN.map((a) => <option key={a} value={a}>{AANDRIJVING_LABEL[a]}</option>)}</Select></Field>
          <Field label="Status" error={fouten.fouten.status}><Select value={form.status} onChange={(e) => zet('status', e.target.value as VehicleBody['status'])}>{VOERTUIG_STATUSSEN.map((s) => <option key={s} value={s}>{VOERTUIG_STATUS_LABEL[s]}</option>)}</Select></Field>
          <Field label="In dienst sinds" error={fouten.fouten.inDienst}><DateInput value={form.inDienst ?? ''} onChange={(v) => zet('inDienst', v)} /></Field>
          <Field label="Uit dienst op" error={fouten.fouten.uitDienst}><DateInput value={form.uitDienst ?? ''} onChange={(v) => zet('uitDienst', v)} /></Field>
          <Field label="Opmerking" className="sm:col-span-2" error={fouten.fouten.opmerking}><Input value={form.opmerking ?? ''} maxLength={300} onChange={(e) => zet('opmerking', e.target.value)} /></Field>
        </div>
        {voertuig && (
          <Card tone="muted" padding="sm" className="mt-4 flex items-center justify-between gap-3 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1.5"><AlertTriangle size={14} /> Verwijderen kan alleen zonder meldingen of prestaties; anders zet je de status op “Uit dienst”.</span>
            <Button variant="danger" size="sm" onClick={() => setBevestigVerwijderen(true)} disabled={bezig}>Verwijderen</Button>
          </Card>
        )}
        <div className="mt-5 flex gap-3">
          <SluitKnop onClose={onClose} variant="ghost" className="flex-1" disabled={bezig}>Annuleren</SluitKnop>
          <Button type="submit" variant="primary" className="flex-1" bezig={bezig}>Opslaan</Button>
        </div>
      </Formulier>
      {voertuig && (
        <ConfirmationModal
          open={bevestigVerwijderen}
          onClose={() => setBevestigVerwijderen(false)}
          onConfirm={verwijderen}
          title="Voertuig verwijderen?"
          message={`Bus ${voertuig.busnr} verdwijnt uit het voertuigregister, samen met zijn vervaldata. Dit kan niet ongedaan worden gemaakt.`}
          confirmText="Verwijderen"
        />
      )}
    </Modal>
  );
}
