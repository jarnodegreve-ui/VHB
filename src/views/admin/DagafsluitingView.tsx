import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Calendar, CheckCircle2, ChevronLeft, ChevronRight, Lock, Plus, RotateCcw, Trash2, Unlock } from 'lucide-react';
import type { User } from '../../types';
import { QUAL_VLAGGEN, QUAL_VLAG_LABEL, OPMERKING_MAX, loonCodeSleutel, type QualVlag } from '../../../shared/loon';
import { cn, notify } from '../../lib/ui';
import { useZelfLadend } from '../../lib/zelfLadend';
import { formatDayLong } from '../../lib/format';
import { useRouteParam } from '../../app/router';
import {
  bewaarRij, heropenDag, laadDag, laadLoonCodes, LoonFout, neemPlanningOver, openDag, schuifDag, sluitDag, vandaagIso, verwijderRij, voegRijToe,
  type DagDetail, type DagPrestatie, type DagVoorstel, type LoonCode,
} from '../../lib/loon';
import { EmptyState, Foutkaart, PageHeader, PageShell, VersheidRegel } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { SkeletonRow } from '../../components/Skeleton';
import { Card, CardHeader } from '../../components/Card';
import { Avatar } from '../../components/Avatar';
import { ActieMenu } from '../../components/ActieMenu';
import { DateInput, Field, Input, Select, Textarea } from '../../components/Field';
import { Badge, Button, FilterChip, IconButton, Switch, Td, Th } from '../../components/primitives';
import { StickyThead } from '../../components/Table';

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

  const patch = async (r: DagPrestatie, body: Parameters<typeof bewaarRij>[2]) => {
    try {
      vervang(await bewaarRij(datum, r.id, body));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Bewaren is mislukt.', 'error');
      await load();
    }
  };

  const doeOpen = async () => {
    setBezig(true);
    try { setDetail(await openDag(datum)); setVoorstel(null); notify('Dag geopend met de planning van vandaag.', 'success'); }
    catch (err) { notify(err instanceof Error ? err.message : 'Openen is mislukt.', 'error'); }
    finally { setBezig(false); }
  };
  const doeSluiten = async () => {
    setBezig(true);
    try { const dag = await sluitDag(datum); setDetail((d) => (d ? { ...d, dag } : d)); setBevestigSluiten(false); notify(`${formatDayLong(datum)} afgesloten.`, 'success'); }
    catch (err) { notify(err instanceof Error ? err.message : 'Afsluiten is mislukt.', 'error'); }
    finally { setBezig(false); }
  };
  const doeOvernemen = async (rijId?: string) => {
    setBezig(true);
    try { const r = await neemPlanningOver(datum, rijId); notify(`${r.aangepast} rijen aangepast, ${r.toegevoegd} toegevoegd.`, 'success'); await load(); }
    catch (err) { notify(err instanceof Error ? err.message : 'Overnemen is mislukt.', 'error'); }
    finally { setBezig(false); }
  };
  const doeVerwijderen = async (r: DagPrestatie) => {
    try { await verwijderRij(datum, r.id); setDetail((d) => (d ? { ...d, rijen: d.rijen.filter((x) => x.id !== r.id) } : d)); notify('Rij verwijderd.', 'success'); }
    catch (err) { notify(err instanceof Error ? err.message : 'Verwijderen is mislukt.', 'error'); }
  };

  const codeLabel = (code: string | null | undefined) => {
    const s = loonCodeSleutel(code);
    if (!s) return '—';
    return codeMap.get(s)?.codeWeergave ?? String(code);
  };
  const zichtbareRijen = alleenAfwijkend ? rijen.filter((r) => afwijkend(r) || r.overmin + r.overminNacht + r.overminExtra !== 0 || r.onvPremie) : rijen;

  const statusBadge = detail ? (
    <Badge tone={afgesloten ? 'emerald' : 'amber'} dot stil={afgesloten} className="whitespace-nowrap">{afgesloten ? 'Afgesloten' : 'Open'}</Badge>
  ) : <Badge tone="slate" stil className="whitespace-nowrap">Nog niet geopend</Badge>;

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
        <Card padding="none" className="divide-y divide-hairline-subtle overflow-hidden" aria-busy="true" aria-label="Dag wordt geladen"><SkeletonRow className="px-5 py-4" /><SkeletonRow className="px-5 py-4" /><SkeletonRow className="px-5 py-4" /></Card>
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
            <div className="surface-table rounded-3xl overflow-clip">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[56rem] text-left border-collapse">
                  <StickyThead>
                    <tr>
                      <Th>Chauffeur</Th>
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
                  <tbody>
                    {zichtbareRijen.map((r) => (
                      <Rij key={r.id} r={r} afgesloten={Boolean(afgesloten)} afwijkend={afwijkend(r)} dienstCodes={dienstCodes} variaCodes={variaCodes} codeMap={codeMap} onPatch={(body) => void patch(r, body)} onVerwijder={() => void doeVerwijderen(r)} />
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          {detail.dag.status === 'afgesloten' && (
            <p className="text-xs text-slate-500">Afgesloten op {detail.dag.afgeslotenOp ? new Date(detail.dag.afgeslotenOp).toLocaleString('nl-BE', { dateStyle: 'medium', timeStyle: 'short' }) : '?'}{detail.dag.heropendReden ? ` · eerder heropend: ${detail.dag.heropendReden}` : ''}</p>
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

function Rij({ r, afgesloten, afwijkend, dienstCodes, variaCodes, codeMap, onPatch, onVerwijder }: {
  r: DagPrestatie; afgesloten: boolean; afwijkend: boolean; dienstCodes: LoonCode[]; variaCodes: LoonCode[]; codeMap: Map<string, LoonCode>;
  onPatch: (body: Parameters<typeof bewaarRij>[2]) => void; onVerwijder: () => void;
}) {
  const [opmerking, setOpmerking] = useState(r.opmerking ?? '');
  const [vlaggenOpen, setVlaggenOpen] = useState(false);
  useEffect(() => { setOpmerking(r.opmerking ?? ''); }, [r.opmerking]);
  const sleutel = loonCodeSleutel(r.geredenCode);
  const onbekend = Boolean(sleutel) && !codeMap.has(sleutel);
  const actieveVlaggen = QUAL_VLAGGEN.filter((k) => r[k]);
  const minutenVeld = (veld: 'overmin' | 'overminNacht' | 'overminExtra') => (
    <Input
      aria-label={veld === 'overmin' ? 'Overminuten' : veld === 'overminNacht' ? 'Overminuten nacht' : 'Overminuten extra opdracht'}
      inputMode="numeric"
      defaultValue={r[veld] || ''}
      disabled={afgesloten}
      className="w-16 px-2 py-1 text-right text-sm"
      onBlur={(e) => { const n = Number(e.target.value || 0); if (Number.isInteger(n) && n !== r[veld]) onPatch({ [veld]: n }); }}
    />
  );
  return (
    <tr className={cn('border-b border-hairline-subtle last:border-b-0 align-top', afwijkend && 'bg-oker-50/40')}>
      <Td>
        <span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800"><Avatar naam={r.naam ?? '?'} size="sm" />{r.naam}{r.volgnr > 1 && <Badge tone="slate" stil>rij {r.volgnr}</Badge>}</span>
      </Td>
      <Td className="text-sm text-slate-500">{r.planningCode ? (codeMap.get(loonCodeSleutel(r.planningCode))?.codeWeergave ?? r.planningCode) : '—'}</Td>
      <Td>
        <div className="flex items-center gap-1.5">
          <Select
            aria-label={`Gereden code van ${r.naam}`}
            value={sleutel}
            disabled={afgesloten}
            invalid={onbekend}
            className={cn('min-w-0 px-2 py-1 text-sm', afwijkend && 'font-semibold')}
            onChange={(e) => onPatch({ geredenCode: e.target.value || null })}
          >
            <option value="">— geen —</option>
            {onbekend && <option value={sleutel}>{r.geredenCode} (onbekend)</option>}
            <optgroup label="Diensten">{dienstCodes.map((c) => <option key={c.code} value={c.code}>{c.codeWeergave}</option>)}</optgroup>
            <optgroup label="Afwezig / ander">{variaCodes.map((c) => <option key={c.code} value={c.code}>{c.codeWeergave}{c.omschrijving ? ` · ${c.omschrijving}` : ''}</option>)}</optgroup>
          </Select>
          {afwijkend && <Badge tone="oker" stil dot className="whitespace-nowrap">afwijkt</Badge>}
        </div>
      </Td>
      <Td num>{minutenVeld('overmin')}</Td>
      <Td num>{minutenVeld('overminNacht')}</Td>
      <Td num>{minutenVeld('overminExtra')}</Td>
      <Td><Switch checked={r.onvPremie} disabled={afgesloten} label={`Premie voor ${r.naam}`} onChange={(v) => onPatch({ onvPremie: v })} /></Td>
      <Td>
        <div className="relative">
          <Button variant={actieveVlaggen.length ? 'warning' : 'ghost'} size="sm" onClick={() => setVlaggenOpen((v) => !v)} aria-expanded={vlaggenOpen} disabled={afgesloten && actieveVlaggen.length === 0}>
            {actieveVlaggen.length ? `${actieveVlaggen.length} vlag${actieveVlaggen.length === 1 ? '' : 'gen'}` : 'Geen'}
          </Button>
          {vlaggenOpen && (
            <div className="popover-in absolute left-0 top-full z-zwevend mt-1 w-64 rounded-2xl bg-paper p-2 elev-2 ring-1 ring-hairline">
              {QUAL_VLAGGEN.map((k: QualVlag) => (
                <label key={k} className="flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2 text-sm hover:bg-surface-soft-hover">
                  <input type="checkbox" className="h-4 w-4" checked={r[k]} disabled={afgesloten} onChange={(e) => onPatch({ [k]: e.target.checked })} />
                  {QUAL_VLAG_LABEL[k]}
                </label>
              ))}
              <div className="mt-1 flex justify-end"><Button variant="ghost" size="sm" onClick={() => setVlaggenOpen(false)}>Sluiten</Button></div>
            </div>
          )}
        </div>
      </Td>
      <Td>
        <Input
          aria-label={`Opmerking voor ${r.naam}`}
          value={opmerking}
          disabled={afgesloten}
          maxLength={OPMERKING_MAX}
          className="w-44 px-2 py-1 text-sm"
          onChange={(e) => setOpmerking(e.target.value)}
          onBlur={() => { if ((opmerking.trim() || null) !== (r.opmerking ?? null)) onPatch({ opmerking: opmerking.trim() || null }); }}
        />
      </Td>
      {!afgesloten && (
        <Td className="text-right">
          {r.volgnr > 1 && <IconButton label="Rij verwijderen" size="sm" onClick={onVerwijder}><Trash2 size={16} /></IconButton>}
        </Td>
      )}
    </tr>
  );
}

function HeropenModal({ datum, onClose, onKlaar }: { datum: string; onClose: () => void; onKlaar: (dag: Awaited<ReturnType<typeof heropenDag>>) => void }) {
  const [reden, setReden] = useState('');
  const [fout, setFout] = useState<string | null>(null);
  const [bezig, setBezig] = useState(false);
  const doe = async () => {
    setBezig(true); setFout(null);
    try { onKlaar(await heropenDag(datum, reden.trim())); notify('Dag heropend.', 'success'); }
    catch (err) { if (err instanceof LoonFout && err.veldfouten?.reden) setFout(err.veldfouten.reden); else notify(err instanceof Error ? err.message : 'Heropenen is mislukt.', 'error'); }
    finally { setBezig(false); }
  };
  return (
    <Modal open onClose={onClose} maxWidth="sm" ariaLabel="Dag heropenen">
      <div className="p-6">
        <CardHeader title={`${formatDayLong(datum)} heropenen`} description="Geef een reden; die komt in het activiteitenlog." />
        <div className="mt-4"><Field label="Reden" required error={fout}>{({ id, invalid }) => <Textarea id={id} invalid={invalid} value={reden} rows={3} onChange={(e) => setReden(e.target.value)} />}</Field></div>
        <div className="mt-5 flex gap-3">
          <Button variant="ghost" className="flex-1" onClick={onClose}>Annuleren</Button>
          <Button variant="primary" className="flex-1" icon={<RotateCcw size={16} />} onClick={() => void doe()} disabled={bezig}>{bezig ? 'Bezig…' : 'Heropenen'}</Button>
        </div>
      </div>
    </Modal>
  );
}

function RijToevoegenModal({ datum, users, onClose, onKlaar }: { datum: string; users: User[]; onClose: () => void; onKlaar: (p: DagPrestatie) => void }) {
  const [userId, setUserId] = useState('');
  const [bezig, setBezig] = useState(false);
  const doe = async () => {
    if (!userId) return;
    setBezig(true);
    try { onKlaar(await voegRijToe(datum, userId, null)); notify('Rij toegevoegd.', 'success'); }
    catch (err) { notify(err instanceof Error ? err.message : 'Toevoegen is mislukt.', 'error'); }
    finally { setBezig(false); }
  };
  return (
    <Modal open onClose={onClose} maxWidth="sm" ariaLabel="Rij toevoegen">
      <div className="p-6">
        <CardHeader title="Rij toevoegen" description="Een tweede rij voor iemand die twee codes op één dag heeft, of een chauffeur die niet in de planning stond." />
        <div className="mt-4">
          <Field label="Chauffeur" required>{({ id }) => <Select id={id} value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Kies een chauffeur</option>{[...users].sort((a, b) => a.name.localeCompare(b.name, 'nl')).map((u) => <option key={u.id} value={String(u.id)}>{u.name}</option>)}</Select>}</Field>
        </div>
        <div className="mt-5 flex gap-3">
          <Button variant="ghost" className="flex-1" onClick={onClose}>Annuleren</Button>
          <Button variant="primary" className="flex-1" onClick={() => void doe()} disabled={bezig || !userId}>{bezig ? 'Bezig…' : 'Toevoegen'}</Button>
        </div>
      </div>
    </Modal>
  );
}
