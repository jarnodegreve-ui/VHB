import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Calendar, CheckCircle2, ChevronLeft, ChevronRight, Lock, Plus, RotateCcw, Trash2, Unlock } from 'lucide-react';
import type { User } from '../../types';
import { QUAL_VLAGGEN, QUAL_VLAG_LABEL, OPMERKING_MAX, loonCodeSleutel, type QualVlag } from '../../../shared/loon';
import { DAG_STATUS, dagOpenStatus, statusVan } from '../../../shared/status';
import { cn, notify } from '../../lib/ui';
import { useZelfLadend } from '../../lib/zelfLadend';
import { formatDatumDMJ, formatDayLong, formatMomentKort } from '../../lib/format';
import { useRouteParam } from '../../app/router';
import {
  bewaarRij, heropenDag, laadDag, laadLoonCodes, LoonFout, neemPlanningOver, openDag, schuifDag, sluitDag, vandaagIso, verwijderRij, voegRijToe,
  type DagDetail, type DagPrestatie, type DagVoorstel, type LoonCode,
} from '../../lib/loon';
import { EmptyState, Foutkaart, PageHeader, PageShell, VersheidRegel } from '../../components/ui';
import { Modal, SluitKnop } from '../../components/Modal';
import { Formulier } from '../../components/Formulier';
import { useVeldfouten, useVuil } from '../../lib/formulier';
import { meldSchrijffout } from '../../lib/fouten';
import { useAutosaveCel } from '../../lib/autosave';
import { AutosaveFout, AutosaveTeken } from '../../components/AutosaveStatus';
import { SkeletonRow } from '../../components/Skeleton';
import { Card, CardHeader } from '../../components/Card';
import { Avatar } from '../../components/Avatar';
import { ActieMenu } from '../../components/ActieMenu';
import { DateInput, Field, Input, Select, Textarea } from '../../components/Field';
import { Badge, Button, FilterChip, IconButton, Switch, TOON_NAAR_BADGE } from '../../components/primitives';
import { Tabel, TableShell, Td, Th } from '../../components/TabelBasis';
import { Popover } from '../../components/Popover';
import { useDropdown } from '../../components/useDropdown';
import { Checkbox, StickyThead } from '../../components/Table';

/**
 * Dagafsluiting (fase B Access-migratie, 13-09): de planner bevestigt per
 * dag wat er werkelijk gereden is. Bij het openen wordt de planning van die
 * dag (matrix + goedgekeurde ruilen + verlof) gekopieerd; per chauffeur past
 * de planner de gereden code aan, vult overminuten (gewoon, nacht, extra
 * opdracht), de onvoorziene-dienst-premie, de kwaliteitsvlaggen en een
 * opmerking in, en sluit de dag af. Een afgesloten dag verandert alleen nog
 * via heropenen met reden. Vervangt het dagelijks intikken in Access.
 */
export function DagafsluitingView({ currentUser, users }: { currentUser: User; users: User[] }) {
  const [datumParam, zetDatumParam] = useRouteParam(0);
  const datum = datumParam && /^\d{4}-\d{2}-\d{2}$/.test(datumParam) ? datumParam : schuifDag(vandaagIso(), -1);
  const zetDatum = (d: string) => zetDatumParam(d);
  const [detail, setDetail] = useState<DagDetail | null>(null);
  const [voorstel, setVoorstel] = useState<DagVoorstel | null>(null);
  const [codes, setCodes] = useState<LoonCode[]>([]);
  const [bezig, setBezig] = useState(false);
  const [bevestigSluiten, setBevestigSluiten] = useState(false);
  const [heropenOpen, setHeropenOpen] = useState(false);
  const [rijToevoegen, setRijToevoegen] = useState(false);
  const [alleenAfwijkend, setAlleenAfwijkend] = useState(false);
  const isAdmin = currentUser.role === 'admin';
  void isAdmin;

  const zl = useZelfLadend(async () => {
    const [r, c] = await Promise.all([laadDag(datum), codes.length ? Promise.resolve(codes) : laadLoonCodes()]);
    setCodes(c);
    if ('detail' in r) { setDetail(r.detail); setVoorstel(null); } else { setDetail(null); setVoorstel(r.voorstel); }
  }, { deps: [datum], boodschap: (err) => (err instanceof Error && err.message ? err.message : 'Kon de dag niet laden.') });
  // Stil herladen na een schrijfactie die de hele dag raakt (overnemen,
  // mislukte rij-patch): geen skelet over een gevulde tabel.
  const load = () => zl.ververs();

  const codeMap = useMemo(() => new Map(codes.map((c) => [c.code, c])), [codes]);
  const dienstCodes = useMemo(() => codes.filter((c) => c.dienstType === 'lijn').sort((a, b) => a.code.localeCompare(b.code, 'nl', { numeric: true })), [codes]);
  const variaCodes = useMemo(() => codes.filter((c) => c.dienstType !== 'lijn').sort((a, b) => a.code.localeCompare(b.code, 'nl')), [codes]);
  const afgesloten = detail?.dag.status === 'afgesloten';
  const rijen = detail?.rijen ?? [];
  const afwijkend = (r: DagPrestatie) => loonCodeSleutel(r.planningCode) !== loonCodeSleutel(r.geredenCode);
  const tellers = useMemo(() => ({
    rijen: rijen.length,
    afwijkend: rijen.filter(afwijkend).length,
    overmin: rijen.reduce((s, r) => s + r.overmin + r.overminNacht + r.overminExtra, 0),
    premies: rijen.filter((r) => r.onvPremie).length,
    zonderCode: rijen.filter((r) => !loonCodeSleutel(r.geredenCode)).length,
    onbekend: rijen.filter((r) => loonCodeSleutel(r.geredenCode) && !codeMap.has(loonCodeSleutel(r.geredenCode))).length,
  }), [rijen, codeMap]);

  const vervang = (p: DagPrestatie) => setDetail((d) => (d ? { ...d, rijen: d.rijen.map((r) => (r.id === p.id ? p : r)) } : d));

  // Autosave per cel (tranche 3A): elke cel bewaart zelf en toont zijn
  // stand (src/lib/autosave.ts). Een mislukte cel houdt de getypte waarde
  // met de reden en "Opnieuw"; er wordt niets stil teruggezet of herladen.
  // `datum` zit in de closure: een save die loopt terwijl je naar een
  // andere dag gaat, schrijft nog altijd naar zijn eigen dag.
  const bewaarVoor = (r: DagPrestatie) => (body: RijBody) => bewaarRij(datum, r.id, body);

  const doeOpen = async () => {
    setBezig(true);
    try { setDetail(await openDag(datum)); setVoorstel(null); notify('Dag geopend met de planning van vandaag.', 'success'); }
    catch (err) { meldSchrijffout('Dag openen', err); }
    finally { setBezig(false); }
  };
  const doeSluiten = async () => {
    setBezig(true);
    try { const dag = await sluitDag(datum); setDetail((d) => (d ? { ...d, dag } : d)); setBevestigSluiten(false); notify(`${formatDayLong(datum)} afgesloten.`, 'success'); }
    catch (err) { meldSchrijffout('Afsluiten', err); }
    finally { setBezig(false); }
  };
  const doeOvernemen = async (rijId?: string) => {
    setBezig(true);
    try { const r = await neemPlanningOver(datum, rijId); notify(`${r.aangepast} rijen aangepast, ${r.toegevoegd} toegevoegd.`, 'success'); await load(); }
    catch (err) { meldSchrijffout('Overnemen', err); }
    finally { setBezig(false); }
  };
  const doeVerwijderen = async (r: DagPrestatie) => {
    try { await verwijderRij(datum, r.id); setDetail((d) => (d ? { ...d, rijen: d.rijen.filter((x) => x.id !== r.id) } : d)); notify('Rij verwijderd.', 'success'); }
    catch (err) { meldSchrijffout('Verwijderen', err, () => void doeVerwijderen(r)); }
  };

  const codeLabel = (code: string | null | undefined) => {
    const s = loonCodeSleutel(code);
    if (!s) return '—';
    return codeMap.get(s)?.codeWeergave ?? String(code);
  };
  const zichtbareRijen = alleenAfwijkend ? rijen.filter((r) => afwijkend(r) || r.overmin + r.overminNacht + r.overminExtra !== 0 || r.onvPremie) : rijen;

  // Label en toon uit DAG_STATUS; een open dag blijft een gekleurde chip. Een
  // dag na vandaag zonder detail is "Nog niet geopend", anders "Niet geopend".
  const dagStatus = statusVan(DAG_STATUS, dagOpenStatus(datum, vandaagIso(), !!detail, afgesloten));
  const statusBadge = (
    <Badge tone={TOON_NAAR_BADGE[dagStatus.toon]} dot stil={!detail || afgesloten} className="whitespace-nowrap">{dagStatus.label}</Badge>
  );

  return (
    <PageShell>
      <PageHeader
        view="dagafsluiting"
        title="Dagadministratie"
        actions={(
          <>
            <VersheidRegel {...zl.versheid} />
            {detail && !afgesloten && <Button variant="primary" icon={<Lock size={16} />} onClick={() => setBevestigSluiten(true)} disabled={bezig}>Dag afsluiten</Button>}
            {detail && afgesloten && (
              <ActieMenu size="sm" items={[{ label: 'Dag heropenen', icon: <Unlock size={16} />, onClick: () => setHeropenOpen(true) }]} />
            )}
          </>
        )}
      />

      {/* Datumnavigatie */}
      <Card padding="sm" className="flex flex-wrap items-center gap-2">
        <IconButton label="Vorige dag" onClick={() => zetDatum(schuifDag(datum, -1))}><ChevronLeft size={18} /></IconButton>
        {/* Telefoon: het datumveld vult de rij tussen de pijlen (was w-44:
            "ma 21 sep 20…") en de lange dagnaam staat er al in, dus die
            komt pas vanaf md. */}
        <div className="min-w-0 flex-1 md:flex-none md:w-44"><DateInput value={datum} onChange={(v) => v && zetDatum(v)} /></div>
        <IconButton label="Volgende dag" onClick={() => zetDatum(schuifDag(datum, 1))}><ChevronRight size={18} /></IconButton>
        <p className="hidden md:block min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{formatDayLong(datum)}</p>
        {statusBadge}
        <Button variant="ghost" size="sm" icon={<Calendar size={14} />} onClick={() => zetDatum(schuifDag(vandaagIso(), -1))}>Gisteren</Button>
      </Card>

      {zl.fout && (detail || voorstel) && <Foutkaart compact boodschap={zl.fout} offline={!zl.online} onOpnieuw={zl.opnieuw} bezig={zl.laden} />}

      {zl.fout && !detail && !voorstel ? (
        <Foutkaart boodschap={zl.fout} offline={!zl.online} onOpnieuw={zl.opnieuw} bezig={zl.laden} />
      ) : zl.laden && !detail && !voorstel ? (
        <Card padding="none" className="divide-y divide-hairline-subtle overflow-hidden" role="status" aria-busy="true" aria-label="Dag wordt geladen"><SkeletonRow className="px-5 py-4" /><SkeletonRow className="px-5 py-4" /><SkeletonRow className="px-5 py-4" /></Card>
      ) : voorstel ? (
        <Card className="space-y-4">
          <CardHeader title="Dag openen" description={voorstel.inPlanning ? `De planning kent ${voorstel.voorstel.filter((v) => v.planningCode).length} van de ${voorstel.voorstel.length} chauffeurs een code toe. Bij het openen wordt die gekopieerd als startpunt; daarna pas je aan wat anders liep.` : 'Deze dag staat niet in de geïmporteerde planning. Je kunt hem toch openen en alles handmatig invullen.'} />
          {!voorstel.inPlanning && <Card tone="warning" padding="sm" className="text-xs text-amber-800">Geen planning voor deze dag: importeer eerst de periode in Beheer planning, of open de dag leeg.</Card>}
          <div className="flex flex-wrap gap-1.5">
            {voorstel.voorstel.slice(0, 60).map((v) => (
              <Badge key={v.userId} tone={v.planningCode ? 'slate' : 'amber'} stil className="whitespace-nowrap">{v.naam}: {v.planningCode ?? 'geen'}</Badge>
            ))}
          </div>
          <div className="flex justify-end"><Button variant="primary" icon={<Unlock size={16} />} onClick={() => void doeOpen()} disabled={bezig}>{bezig ? 'Bezig…' : 'Dag openen'}</Button></div>
        </Card>
      ) : detail ? (
        <>
          {detail.planningAfwijkingen.length > 0 && (
            <Card tone={afgesloten ? 'muted' : 'warning'} padding="sm" className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-800"><AlertTriangle size={16} /> Planning is intussen gewijzigd voor {detail.planningAfwijkingen.length} {detail.planningAfwijkingen.length === 1 ? 'chauffeur' : 'chauffeurs'}</p>
                {!afgesloten && <Button variant="secondary" size="sm" onClick={() => void doeOvernemen()} disabled={bezig}>Planning overnemen (onaangeraakte rijen)</Button>}
              </div>
              <ul className="flex flex-wrap gap-1.5 text-xs">
                {detail.planningAfwijkingen.map((a) => (
                  <li key={a.userId} className="inline-flex items-center gap-1 rounded-md bg-paper px-2 py-1 ring-1 ring-hairline">
                    <span className="font-semibold">{a.naam}</span>: {codeLabel(a.huidigeCode)} → {codeLabel(a.planningCode)}{a.bewerkt ? ' (bewerkt)' : ''}
                    {!afgesloten && a.rijId && <Button variant="ghost" size="sm" className="!px-1.5 !py-0.5 text-xs" onClick={() => void doeOvernemen(a.rijId!)}>overnemen</Button>}
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {detail.ontbrekendeCodes.length > 0 && (
            <Card tone="danger" padding="sm" className="text-xs text-red-800">Onbekende looncodes op deze dag: {detail.ontbrekendeCodes.join(', ')}. Voeg ze toe in Looncontrole › Looncodes, anders vallen die rijen uit de export.</Card>
          )}

          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            <span className="font-semibold text-slate-800">{tellers.rijen} rijen</span>
            <span>· {tellers.afwijkend} afwijkend van de planning</span>
            <span>· {tellers.overmin} overminuten</span>
            <span>· {tellers.premies} premies</span>
            {tellers.zonderCode > 0 && <span className="text-amber-700">· {tellers.zonderCode} zonder code</span>}
            <span className="ml-auto" />
            <FilterChip active={alleenAfwijkend} onClick={() => setAlleenAfwijkend((v) => !v)}>Alleen afwijkingen</FilterChip>
            {!afgesloten && <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={() => setRijToevoegen(true)}>Rij toevoegen</Button>}
          </div>

          {zichtbareRijen.length === 0 ? (
            <EmptyState variant="klaar" title={alleenAfwijkend ? 'Geen afwijkingen' : 'Geen chauffeurs'} message={alleenAfwijkend ? 'Iedereen reed zoals gepland, zonder overminuten of premie.' : 'Er staan geen chauffeurs op deze dag.'} />
          ) : (
            // Eén set cellen, twee opmaken (tranche 3B.2). Vanaf md een tabel
            // die in haar kader schuift, met de chauffeur als vaste kolom
            // (TableShell standaard: met de keuzelijsten en het opmerkingveld
            // is ze ±1280 px breed, gemeten, dus ook op 1440 px breder dan de
            // kaart; `sticky` zou haar vanaf xl afknippen). Onder md
            // wordt elke rij met CSS een kaart per chauffeur (grid op de `tr`,
            // kopje per cel). Bewust CSS en geen tweede lijst: de cellen zijn
            // autosave-velden (defaultValue, eigen stand per cel); een aparte
            // kaartlijst zou elke cel twee keer mounten en bij het draaien van
            // de telefoon over het breekpunt een getypte, nog niet bewaarde
            // waarde weggooien.
            <TableShell label={`Dagadministratie ${formatDatumDMJ(datum)}`}>
                <Tabel className="md:min-w-[56rem] max-md:block">
                  <StickyThead className="max-md:hidden">
                    <tr>
                      <Th className={VASTE_KOLOM}>Chauffeur</Th>
                      <Th>Planning</Th>
                      <Th>Gereden</Th>
                      <Th num title="Overminuten gewoon">Over</Th>
                      <Th num title="Overminuten nacht">Nacht</Th>
                      <Th num title="Overminuten extra opdracht">Extra</Th>
                      <Th title="Onvoorziene-dienst-premie">Premie</Th>
                      <Th>Kwaliteit</Th>
                      <Th>Opmerking</Th>
                      {!afgesloten && <Th className="text-right">Acties</Th>}
                    </tr>
                  </StickyThead>
                  <tbody className="max-md:block max-md:divide-y max-md:divide-hairline-subtle">
                    {zichtbareRijen.map((r) => (
                      <Rij key={r.id} r={r} afgesloten={Boolean(afgesloten)} afwijkend={afwijkend(r)} dienstCodes={dienstCodes} variaCodes={variaCodes} codeMap={codeMap} bewaar={bewaarVoor(r)} onBewaard={vervang} onVerwijder={() => void doeVerwijderen(r)} />
                    ))}
                  </tbody>
                </Tabel>
            </TableShell>
          )}
          {detail.dag.status === 'afgesloten' && (
            <p className="text-xs text-slate-500">Afgesloten op {detail.dag.afgeslotenOp ? formatMomentKort(detail.dag.afgeslotenOp) : '?'}{detail.dag.heropendReden ? ` · eerder heropend: ${detail.dag.heropendReden}` : ''}</p>
          )}
        </>
      ) : null}

      <Modal open={bevestigSluiten} onClose={() => setBevestigSluiten(false)} maxWidth="sm" ariaLabel="Dag afsluiten">
        <div className="p-6">
          <CardHeader title={`${formatDayLong(datum)} afsluiten?`} description="Daarna kan de dag alleen nog via heropenen (met reden) veranderen." />
          <ul className="mt-3 space-y-1 text-sm text-slate-700">
            <li>{tellers.rijen} chauffeurs, {tellers.afwijkend} afwijkend van de planning</li>
            <li>{tellers.overmin} overminuten in totaal, {tellers.premies} premies</li>
            {tellers.zonderCode > 0 && <li className="font-semibold text-amber-700">{tellers.zonderCode} zonder code (die vallen uit de export)</li>}
            {tellers.onbekend > 0 && <li className="font-semibold text-red-700">{tellers.onbekend} met een onbekende looncode</li>}
          </ul>
          <div className="mt-5 flex gap-3">
            <Button variant="ghost" className="flex-1" onClick={() => setBevestigSluiten(false)}>Annuleren</Button>
            <Button variant="primary" className="flex-1" icon={<CheckCircle2 size={16} />} onClick={() => void doeSluiten()} disabled={bezig}>{bezig ? 'Bezig…' : 'Afsluiten'}</Button>
          </div>
        </div>
      </Modal>

      {heropenOpen && <HeropenModal datum={datum} onClose={() => setHeropenOpen(false)} onKlaar={(dag) => { setDetail((d) => (d ? { ...d, dag } : d)); setHeropenOpen(false); }} />}
      {rijToevoegen && detail && (
        <RijToevoegenModal
          datum={datum}
          users={users.filter((u) => u.role === 'chauffeur' && u.isActive !== false)}
          onClose={() => setRijToevoegen(false)}
          onKlaar={(p) => { setDetail((d) => (d ? { ...d, rijen: [...d.rijen, p] } : d)); setRijToevoegen(false); }}
        />
      )}
    </PageShell>
  );
}

type RijBody = Parameters<typeof bewaarRij>[2];

/** Eén minutencel: heel getal of leeg (= 0), anders een fout bij de cel. */
function MinutenCel({ r, veld, afgesloten, bewaar, onBewaard }: {
  r: DagPrestatie; veld: 'overmin' | 'overminNacht' | 'overminExtra'; afgesloten: boolean;
  bewaar: (body: RijBody) => Promise<DagPrestatie>; onBewaard: (p: DagPrestatie) => void;
}) {
  const label = veld === 'overmin' ? 'Overminuten' : veld === 'overminNacht' ? 'Overminuten nacht' : 'Overminuten extra opdracht';
  const cel = useAutosaveCel<string, DagPrestatie>({
    actie: `${label} van ${r.naam ?? 'deze chauffeur'} bewaren`,
    bewaar: (tekst) => bewaar({ [veld]: tekst === '' ? 0 : Number(tekst) }),
    opGelukt: onBewaard,
  });
  const foutId = `${r.id}-${veld}-fout`;
  return (
    <div className="inline-flex flex-col items-end">
      <div className="inline-flex items-center gap-1">
        <AutosaveTeken staat={cel.staat} />
        <Input
          aria-label={label}
          inputMode="numeric"
          defaultValue={r[veld] || ''}
          disabled={afgesloten}
          invalid={cel.staat.status === 'fout'}
          aria-describedby={cel.staat.status === 'fout' ? foutId : undefined}
          className="w-16 px-2 py-1 text-right text-sm"
          onBlur={(e) => {
            const tekst = e.target.value.trim();
            const n = tekst === '' ? 0 : Number(tekst);
            if (!Number.isInteger(n)) { cel.ongeldig(tekst, 'Vul een heel aantal minuten in.'); return; }
            cel.verander(tekst, String(r[veld]), (a, b) => Number(a || 0) === Number(b || 0));
          }}
        />
      </div>
      <AutosaveFout staat={cel.staat} id={foutId} />
    </div>
  );
}

/**
 * De chauffeur blijft links staan terwijl de rest eronderdoor schuift
 * (zelfde opaak vlak als RapportTabel); op de telefoon is het de kop van
 * de kaart.
 */
const VASTE_KOLOM = 'md:sticky md:left-0 md:z-sticky md:bg-paper';

/**
 * Opmaak van één rij als kaart onder md: de `tr` wordt een raster van zes
 * kolommen, elke cel een blok met een kopje (KaartKop); vanaf md blijft het
 * een gewone tabelrij. Zelfde elementen, zelfde cellen, alleen CSS.
 */
const KAART = {
  rij: 'max-md:grid max-md:grid-cols-6 max-md:gap-x-3 max-md:gap-y-3 max-md:border-b-0 max-md:px-4 max-md:py-4',
  cel: 'max-md:block max-md:px-0 max-md:py-0',
  getal: 'max-md:col-span-2 max-md:text-left',
};

/** Kopje boven een cel in de kaart op de telefoon; vanaf md staat de kolomkop er al boven. */
function KaartKop({ children }: { children: string }) {
  return <span className="mb-1 block text-label text-slate-500 md:hidden">{children}</span>;
}

function Rij({ r, afgesloten, afwijkend, dienstCodes, variaCodes, codeMap, bewaar, onBewaard, onVerwijder }: {
  r: DagPrestatie; afgesloten: boolean; afwijkend: boolean; dienstCodes: LoonCode[]; variaCodes: LoonCode[]; codeMap: Map<string, LoonCode>;
  bewaar: (body: RijBody) => Promise<DagPrestatie>; onBewaard: (p: DagPrestatie) => void; onVerwijder: () => void;
}) {
  const [opmerking, setOpmerking] = useState(r.opmerking ?? '');
  const { open: vlaggenOpen, setOpen: setVlaggenOpen, wortel: vlaggenWortel } = useDropdown();
  useEffect(() => { setOpmerking(r.opmerking ?? ''); }, [r.opmerking]);
  const naam = r.naam ?? 'deze chauffeur';
  const codeCel = useAutosaveCel<string, DagPrestatie>({ actie: `Gereden code van ${naam} bewaren`, bewaar: (v) => bewaar({ geredenCode: v || null }), opGelukt: onBewaard });
  const premieCel = useAutosaveCel<boolean, DagPrestatie>({ actie: `Premie van ${naam} bewaren`, bewaar: (v) => bewaar({ onvPremie: v }), opGelukt: onBewaard });
  // De vlaggen als één set: twee snelle vinkjes na elkaar sturen elk de
  // volledige set zoals je ze ziet, zodat de tweede de eerste niet wist.
  const vlagCel = useAutosaveCel<Record<QualVlag, boolean>, DagPrestatie>({ actie: `Kwaliteitsvlaggen van ${naam} bewaren`, bewaar: (v) => bewaar(v), opGelukt: onBewaard });
  const opmerkingCel = useAutosaveCel<string | null, DagPrestatie>({ actie: `Opmerking van ${naam} bewaren`, bewaar: (v) => bewaar({ opmerking: v }), opGelukt: onBewaard });
  const sleutel = loonCodeSleutel(r.geredenCode);
  // Tijdens het bewaren en na een mislukte save toont de cel wat je koos.
  const gekozenCode = codeCel.toon(sleutel);
  const onbekend = Boolean(sleutel) && !codeMap.has(sleutel);
  const serverVlaggen = Object.fromEntries(QUAL_VLAGGEN.map((k) => [k, r[k]])) as Record<QualVlag, boolean>;
  const vlaggen = vlagCel.toon(serverVlaggen);
  const zelfdeVlaggen = (a: Record<QualVlag, boolean>, b: Record<QualVlag, boolean>) => QUAL_VLAGGEN.every((k) => a[k] === b[k]);
  const actieveVlaggen = QUAL_VLAGGEN.filter((k) => vlaggen[k]);
  const cellen = { geredenCode: `${r.id}-code-fout`, premie: `${r.id}-premie-fout`, vlaggen: `${r.id}-vlaggen-fout`, opmerking: `${r.id}-opmerking-fout` };
  const celProps = { r, afgesloten, bewaar, onBewaard };
  return (
    <tr className={cn('border-b border-hairline-subtle last:border-b-0 align-top', KAART.rij)}>
      <Td className={cn(VASTE_KOLOM, KAART.cel, 'max-md:col-span-5 max-md:-order-2')}>
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800"><Avatar naam={r.naam ?? '?'} size="sm" />{r.naam}{r.volgnr > 1 && <Badge tone="slate" stil className="whitespace-nowrap">rij {r.volgnr}</Badge>}</span>
      </Td>
      <Td nowrap className={cn('text-slate-500', KAART.cel, 'max-md:col-span-2')}><KaartKop>Planning</KaartKop>{r.planningCode ? (codeMap.get(loonCodeSleutel(r.planningCode))?.codeWeergave ?? r.planningCode) : '—'}</Td>
      <Td className={cn(KAART.cel, 'max-md:col-span-4')}>
        <KaartKop>Gereden</KaartKop>
        <div className="flex items-center gap-1.5">
          <Select
            aria-label={`Gereden code van ${r.naam}`}
            value={gekozenCode}
            disabled={afgesloten}
            invalid={onbekend || codeCel.staat.status === 'fout'}
            aria-describedby={codeCel.staat.status === 'fout' ? cellen.geredenCode : undefined}
            className={cn('min-w-0 px-2 py-1 text-sm', afwijkend && 'font-semibold')}
            onChange={(e) => codeCel.verander(e.target.value, sleutel)}
          >
            <option value="">— geen —</option>
            {onbekend && <option value={sleutel}>{r.geredenCode} (onbekend)</option>}
            <optgroup label="Diensten">{dienstCodes.map((c) => <option key={c.code} value={c.code}>{c.codeWeergave}</option>)}</optgroup>
            <optgroup label="Afwezig / ander">{variaCodes.map((c) => <option key={c.code} value={c.code}>{c.codeWeergave}{c.omschrijving ? ` · ${c.omschrijving}` : ''}</option>)}</optgroup>
          </Select>
          <AutosaveTeken staat={codeCel.staat} />
          {/* Afwijken van de planning is informatie, geen fout: info-toon, geen goud (tranche 3B.2). */}
          {afwijkend && <Badge tone="blue" stil dot className="whitespace-nowrap">afwijkt</Badge>}
        </div>
        <AutosaveFout staat={codeCel.staat} id={cellen.geredenCode} />
      </Td>
      <Td num className={cn(KAART.cel, KAART.getal)}><KaartKop>Over</KaartKop><MinutenCel veld="overmin" {...celProps} /></Td>
      <Td num className={cn(KAART.cel, KAART.getal)}><KaartKop>Nacht</KaartKop><MinutenCel veld="overminNacht" {...celProps} /></Td>
      <Td num className={cn(KAART.cel, KAART.getal)}><KaartKop>Extra</KaartKop><MinutenCel veld="overminExtra" {...celProps} /></Td>
      <Td className={cn(KAART.cel, 'max-md:col-span-2')}>
        <KaartKop>Premie</KaartKop>
        <div className="inline-flex items-center gap-1">
          <Switch checked={premieCel.toon(r.onvPremie)} disabled={afgesloten} label={`Premie voor ${r.naam}`} onChange={(v) => premieCel.verander(v, r.onvPremie)} />
          <AutosaveTeken staat={premieCel.staat} />
        </div>
        <AutosaveFout staat={premieCel.staat} id={cellen.premie} />
      </Td>
      <Td className={cn(KAART.cel, 'max-md:col-span-4')}>
        <KaartKop>Kwaliteit</KaartKop>
        <div className="relative inline-flex items-center gap-1" ref={vlaggenWortel}>
          <Button variant={actieveVlaggen.length ? 'warning' : 'ghost'} size="sm" onClick={() => setVlaggenOpen((v) => !v)} aria-expanded={vlaggenOpen} aria-describedby={vlagCel.staat.status === 'fout' ? cellen.vlaggen : undefined} disabled={afgesloten && actieveVlaggen.length === 0}>
            {actieveVlaggen.length ? `${actieveVlaggen.length} vlag${actieveVlaggen.length === 1 ? '' : 'gen'}` : 'Geen'}
          </Button>
          <AutosaveTeken staat={vlagCel.staat} />
          <Popover open={vlaggenOpen} label="Kwaliteitsvlaggen" align="left" breedte="md">
              {QUAL_VLAGGEN.map((k: QualVlag) => (
                <div key={k} className="flex min-h-9 items-center gap-1 rounded-lg pr-2 text-sm hover:bg-surface-soft-hover">
                  <Checkbox
                    id={`${r.id}-vlag-${k}`}
                    label={QUAL_VLAG_LABEL[k]}
                    checked={vlaggen[k]}
                    disabled={afgesloten}
                    onChange={(aan) => vlagCel.verander({ ...vlaggen, [k]: aan }, serverVlaggen, zelfdeVlaggen)}
                  />
                  <label htmlFor={`${r.id}-vlag-${k}`} className={cn('flex-1 py-1', afgesloten ? 'cursor-default' : 'cursor-pointer')}>{QUAL_VLAG_LABEL[k]}</label>
                </div>
              ))}
            <div className="mt-1 flex justify-end"><Button variant="ghost" size="sm" onClick={() => setVlaggenOpen(false)}>Sluiten</Button></div>
          </Popover>
        </div>
        <AutosaveFout staat={vlagCel.staat} id={cellen.vlaggen} />
      </Td>
      <Td className={cn(KAART.cel, 'max-md:col-span-6')}>
        <KaartKop>Opmerking</KaartKop>
        <div className="inline-flex items-center gap-1 max-md:flex">
          <Input
            aria-label={`Opmerking voor ${r.naam}`}
            value={opmerking}
            disabled={afgesloten}
            maxLength={OPMERKING_MAX}
            invalid={opmerkingCel.staat.status === 'fout'}
            aria-describedby={opmerkingCel.staat.status === 'fout' ? cellen.opmerking : undefined}
            className="w-44 px-2 py-1 text-sm max-md:w-full max-md:flex-1"
            onChange={(e) => setOpmerking(e.target.value)}
            onBlur={() => {
              opmerkingCel.verander(opmerking.trim() || null, r.opmerking ?? null);
            }}
          />
          <AutosaveTeken staat={opmerkingCel.staat} />
        </div>
        <AutosaveFout staat={opmerkingCel.staat} id={cellen.opmerking} />
      </Td>
      {!afgesloten && (
        <Td className={cn('text-right', KAART.cel, 'max-md:col-span-1 max-md:-order-1 max-md:empty:hidden')}>
          {r.volgnr > 1 && <IconButton label="Rij verwijderen" size="sm" onClick={onVerwijder}><Trash2 size={16} /></IconButton>}
        </Td>
      )}
    </tr>
  );
}

function HeropenModal({ datum, onClose, onKlaar }: { datum: string; onClose: () => void; onKlaar: (dag: Awaited<ReturnType<typeof heropenDag>>) => void }) {
  const [reden, setReden] = useState('');
  const fouten = useVeldfouten();
  const [bezig, setBezig] = useState(false);
  const { vuil } = useVuil(reden);
  const doe = async () => {
    if (bezig) return;
    fouten.wis();
    setBezig(true);
    try { onKlaar(await heropenDag(datum, reden.trim())); notify('Dag heropend.', 'success'); }
    catch (err) {
      // De reden-fout bij het veld; de rest één toast met vervolgstap.
      if (err instanceof LoonFout && err.veldfouten?.reden) fouten.zet({ reden: err.veldfouten.reden });
      else meldSchrijffout('Heropenen', err);
    }
    finally { setBezig(false); }
  };
  return (
    <Modal open onClose={onClose} vuil={vuil} maxWidth="sm" ariaLabel="Dag heropenen">
      <Formulier onVerstuur={doe} noValidate className="p-6">
        <CardHeader title={`${formatDayLong(datum)} heropenen`} description="Geef een reden; die komt in het activiteitenlog." />
        <div className="mt-4"><Field label="Reden" required error={fouten.fouten.reden}><Textarea value={reden} rows={3} onChange={(e) => { setReden(e.target.value); fouten.wisVeld('reden'); }} /></Field></div>
        <div className="mt-5 flex gap-3">
          <SluitKnop onClose={onClose} variant="ghost" className="flex-1" disabled={bezig}>Annuleren</SluitKnop>
          <Button type="submit" variant="primary" className="flex-1" icon={<RotateCcw size={16} />} bezig={bezig}>Heropenen</Button>
        </div>
      </Formulier>
    </Modal>
  );
}

function RijToevoegenModal({ datum, users, onClose, onKlaar }: { datum: string; users: User[]; onClose: () => void; onKlaar: (p: DagPrestatie) => void }) {
  const [userId, setUserId] = useState('');
  const [bezig, setBezig] = useState(false);
  const { vuil } = useVuil(userId);
  const doe = async () => {
    if (!userId || bezig) return;
    setBezig(true);
    // Geen "Opnieuw proberen": een rij toevoegen maakt iets aan.
    try { onKlaar(await voegRijToe(datum, userId, null)); notify('Rij toegevoegd.', 'success'); }
    catch (err) { meldSchrijffout('Toevoegen', err); }
    finally { setBezig(false); }
  };
  return (
    <Modal open onClose={onClose} vuil={vuil} maxWidth="sm" ariaLabel="Rij toevoegen">
      <Formulier onVerstuur={doe} noValidate className="p-6">
        <CardHeader title="Rij toevoegen" description="Een tweede rij voor iemand die twee codes op één dag heeft, of een chauffeur die niet in de planning stond." />
        <div className="mt-4">
          <Field label="Chauffeur" required><Select value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Kies een chauffeur</option>{[...users].sort((a, b) => a.name.localeCompare(b.name, 'nl')).map((u) => <option key={u.id} value={String(u.id)}>{u.name}</option>)}</Select></Field>
        </div>
        <div className="mt-5 flex gap-3">
          <SluitKnop onClose={onClose} variant="ghost" className="flex-1" disabled={bezig}>Annuleren</SluitKnop>
          <Button type="submit" variant="primary" className="flex-1" bezig={bezig} disabled={!userId}>Toevoegen</Button>
        </div>
      </Formulier>
    </Modal>
  );
}
