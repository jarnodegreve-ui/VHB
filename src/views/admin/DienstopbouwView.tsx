import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, ListChecks, Play, Route, Trash2, Upload, Wand2 } from 'lucide-react';
import type { User } from '../../types';
import { BEVINDING_LABEL, SEGMENT_TYPE_LABEL } from '../../../shared/dienst';
import { cn, downloadBlob, notify } from '../../lib/ui';
import { apiFetch } from '../../lib/api';
import { aantal, formatDateTimeHuman } from '../../lib/format';
import {
  activeerImport, bestandNaarBase64, bewaarDagtype, importeerBestand, laadDagtypes, laadImports, laadLoonparameters, laadRitblad, laadSegmenten, leidLooncodesAf,
  minNaarHHMM, verwijderImport, type Bevinding, type DagtypeCode, type LoonParameters, type RitbladRij, type Segment, type SegmentImport,
} from '../../lib/dienst';
import { ConfirmationModal, EmptyState, Foutkaart, PageHeader, PageShell, VersheidRegel } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { OpsStat } from '../../components/ops';
import { SkeletonRow } from '../../components/Skeleton';
import { Card, CardHeader } from '../../components/Card';
import { Field, Select } from '../../components/Field';
import { Badge, Button, Chip, FilterChip, IconButton, Segmented } from '../../components/primitives';
import { StickyThead, TableToolbar } from '../../components/Table';
import { Td, Th, Tabel, TableShell } from '../../components/TabelBasis';
import { meldSchrijffout } from '../../lib/fouten';
import { useZelfLadend } from '../../lib/zelfLadend';

type Tab = 'imports' | 'diensten' | 'dagtypes';
type ImportStand = 'laden' | 'fout' | 'klaar';
const PORTAAL_DAGTYPES = ['schooldag', 'vakantie', 'zaterdag', 'zondag'] as const;

/**
 * Dienstopbouw op rit-niveau (fase C Access-migratie, 13-09): de ET-export
 * van De Lijn importeren (ritdelen per dienst en dagtype), controleren
 * (gaten, overlap, snelheid), activeren, de looncomponenten voor Easypay
 * en de loonparameters per dienst afleiden, het ritblad per dienst uit data
 * en de koppeling van de dagtypecodes van De Lijn aan die van het portaal.
 * Vervangt dienstregeling.accdb.
 */
export function DienstopbouwView({ currentUser }: { currentUser: User }) {
  const [tab, setTab] = useState<Tab>('imports');
  const [imports, setImports] = useState<SegmentImport[]>([]);
  // Zelf-ladend (golf 3): laden, laadfout en versheid; na een eigen
  // schrijfactie stil verversen, geen eigen Ververs-knop.
  const zl = useZelfLadend(async () => { setImports(await laadImports()); }, { boodschap: 'Kon de imports niet laden.' });
  const actief = imports.find((i) => i.actief) ?? null;
  // Zonder imports weten we pas of er een actieve is als het laden lukte:
  // leeg mag nooit "nog niet geladen" of "laden mislukt" betekenen.
  const importStand: ImportStand = imports.length > 0 ? 'klaar' : zl.fout ? 'fout' : zl.laden ? 'laden' : 'klaar';
  return (
    <PageShell>
      <PageHeader view="dienstopbouw" title="Dienstopbouw" actions={<VersheidRegel {...zl.versheid} />} />
      {zl.fout && imports.length > 0 && <Foutkaart compact boodschap={zl.fout} offline={!zl.online} onOpnieuw={zl.opnieuw} bezig={zl.laden} />}
      <Segmented<Tab>
        label="Onderdeel"
        telefoon="vol"
        className="shrink-0"
        itemClassName="min-h-11 sm:pointer-fine:min-h-8"
        waarde={tab}
        opties={[
          { waarde: 'imports', label: <><FileSpreadsheet size={14} />Imports</> },
          { waarde: 'diensten', label: <><Route size={14} />Diensten</> },
          { waarde: 'dagtypes', label: <><ListChecks size={14} />Dagtypes</> },
        ]}
        onChange={setTab}
      />
      {tab === 'imports' && (importStand === 'fout'
        ? <Foutkaart boodschap={zl.fout!} offline={!zl.online} onOpnieuw={zl.opnieuw} bezig={zl.laden} />
        : <ImportsTab imports={imports} isLoading={zl.laden} isAdmin={currentUser.role === 'admin'} onChanged={zl.ververs} />)}
      {tab === 'diensten' && (importStand === 'fout'
        ? <Foutkaart boodschap={zl.fout!} offline={!zl.online} onOpnieuw={zl.opnieuw} bezig={zl.laden} />
        : <DienstenTab actief={actief} importsLaden={importStand === 'laden'} />)}
      {tab === 'dagtypes' && <DagtypesTab />}
    </PageShell>
  );
}

export function ImportsTab({ imports, isLoading, isAdmin, onChanged }: { imports: SegmentImport[]; isLoading: boolean; isAdmin: boolean; onChanged: () => Promise<void> }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [bezig, setBezig] = useState(false);
  const [detail, setDetail] = useState<SegmentImport | null>(null);
  const actief = imports.find((i) => i.actief) ?? null;

  const upload = async (file: File) => {
    setBezig(true);
    try {
      const imp = await importeerBestand(await bestandNaarBase64(file), file.name);
      const fouten = imp.bevindingen.filter((b) => b.ernst === 'fout').length;
      notify(`${aantal(imp.rijen, 'ritdeel', 'ritdelen')} voor ${aantal(imp.diensten, 'dienst', 'diensten')} ingelezen${fouten ? `, ${fouten} fouten` : ''}.`, fouten ? 'info' : 'success');
      await onChanged();
      setDetail(imp);
    } catch (err) { meldSchrijffout('Importeren', err); }
    finally { setBezig(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const activeer = async (imp: SegmentImport, forceer = false) => {
    setBezig(true);
    try { await activeerImport(imp.id, forceer); notify('Dienstopbouw geactiveerd.', 'success'); await onChanged(); }
    catch (err) { meldSchrijffout('Activeren', err); }
    finally { setBezig(false); }
  };
  // Een import heeft geen veilige herstelweg (harde delete, de ritdelen gaan
  // mee via on delete cascade; terug = het bestand opnieuw importeren):
  // expliciete, server-confirmed bevestiging en géén undo (CLAUDE.md,
  // Verwijderen, uitzondering 23-09).
  const [teVerwijderen, setTeVerwijderen] = useState<SegmentImport | null>(null);
  const verwijder = async (imp: SegmentImport) => {
    try { await verwijderImport(imp.id); notify('Import verwijderd.', 'success'); await onChanged(); }
    catch (err) { meldSchrijffout('Verwijderen', err, () => void verwijder(imp)); }
  };
  const afleiden = async (imp: SegmentImport) => {
    setBezig(true);
    try {
      const r = await leidLooncodesAf(imp.id);
      notify(`Looncodes: ${r.bijgewerkt} bijgewerkt, ${r.nieuw} nieuw${r.overgeslagen.length ? `, ${r.overgeslagen.length} handmatig bewerkte overgeslagen` : ''}${r.teVeelDelen.length ? `; meer dan drie dienstdelen: ${r.teVeelDelen.join(', ')}` : ''}.`, 'success');
    } catch (err) { meldSchrijffout('Looncodes afleiden', err); }
    finally { setBezig(false); }
  };
  const downloadCsv = async (imp: SegmentImport) => {
    try {
      const res = await apiFetch(`/api/dienstopbouw/imports/${encodeURIComponent(imp.id)}/looncomponenten?format=csv`);
      if (!res.ok) throw Object.assign(new Error(''), { status: res.status });
      await downloadBlob(`loondiensten-easypay-${imp.createdAt.slice(0, 10)}.csv`, await res.blob());
    } catch (err) { meldSchrijffout('Exporteren', err, () => void downloadCsv(imp)); }
  };
  const fouten = (i: SegmentImport) => i.bevindingen.filter((b) => b.ernst === 'fout').length;
  const waarsch = (i: SegmentImport) => i.bevindingen.filter((b) => b.ernst === 'waarschuwing').length + i.waarschuwingen.length;

  return (
    <div className="space-y-4">
      <Card className="space-y-3">
        <CardHeader icon={<Upload size={16} />} title="ET-export importeren" description="Het bestand van De Lijn met per dienst en dagtype de ritdelen (kolommen typedag, dienstnummer, type, duur, start, einde, loop, lijn, rit, vertrek, aankomst, afstand). Een import wordt gecontroleerd en pas na activeren gebruikt." />
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" aria-label="ET-export kiezen" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }} />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="primary" icon={<Upload size={16} />} onClick={() => fileRef.current?.click()} disabled={bezig}>{bezig ? 'Bezig…' : 'Bestand kiezen'}</Button>
          {actief && <span className="text-xs text-slate-500">Actief: {actief.filename ?? 'import'} van {formatDateTimeHuman(actief.createdAt)}, {aantal(actief.rijen, 'ritdeel', 'ritdelen')}, {aantal(actief.diensten, 'dienst', 'diensten')}.</span>}
        </div>
      </Card>

      {isLoading && imports.length === 0 ? <Card padding="none" className="divide-y divide-hairline-subtle"><SkeletonRow className="px-5 py-4" /><SkeletonRow className="px-5 py-4" /></Card> : imports.length === 0 ? (
        <EmptyState title="Nog geen import" message="Importeer de ET-export om de ritdelen, controles en looncomponenten te krijgen." />
      ) : (
        <TableShell label="Imports">
          {/* Mobiel: kaartlijst (de brede tabel hieronder is desktop-only, zoals de andere beheerschermen). */}
          <ul className="md:hidden divide-y divide-hairline-subtle">
            {imports.map((i) => (
              <li key={i.id} className="space-y-2 px-5 py-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-semibold text-slate-800">{i.filename ?? 'import'}</p>
                  {i.actief ? <Badge tone="emerald" dot>actief</Badge> : <Badge tone="slate" kaal>niet actief</Badge>}
                </div>
                <p className="text-xs text-slate-500">{formatDateTimeHuman(i.createdAt)} · {aantal(i.rijen, 'ritdeel', 'ritdelen')} · {aantal(i.diensten, 'dienst', 'diensten')} · {i.dagtypes.join(', ')}</p>
                <div className="flex flex-wrap gap-1">
                  {fouten(i) > 0 ? <Badge tone="red" dot>{fouten(i)} fouten</Badge> : <Badge tone="emerald" stil dot>geen fouten</Badge>}
                  {waarsch(i) > 0 && <Badge tone="amber" stil dot>{waarsch(i)} waarschuwingen</Badge>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button variant="ghost" size="sm" onClick={() => setDetail(i)}>Bevindingen</Button>
                  {!i.actief && <Button variant="secondary" size="sm" icon={<Play size={14} />} onClick={() => void activeer(i, fouten(i) > 0 && isAdmin)} disabled={bezig || (fouten(i) > 0 && !isAdmin)}>Activeren</Button>}
                  <Button variant="ghost" size="sm" icon={<Download size={14} />} onClick={() => void downloadCsv(i)}>CSV</Button>
                  {i.actief && <Button variant="ghost" size="sm" icon={<Wand2 size={14} />} onClick={() => void afleiden(i)} disabled={bezig}>Looncodes afleiden</Button>}
                </div>
              </li>
            ))}
          </ul>
          {/* Vanaf md schuift de tabel in haar kader (TableShell standaard): met
              de knoppen erbij is ze breder dan de kaart op 768 px. */}
          <div className="hidden md:block">
            <Tabel className="min-w-[48rem]">
              <StickyThead><tr><Th>Import</Th><Th num>Ritdelen</Th><Th num>Diensten</Th><Th>Dagtypes</Th><Th>Controle</Th><Th>Status</Th><Th className="text-right">Acties</Th></tr></StickyThead>
              <tbody>
                {imports.map((i) => (
                  <tr key={i.id} className="border-b border-hairline-subtle last:border-b-0 align-top">
                    <Td><p className="font-semibold text-slate-800">{i.filename ?? 'import'}</p><p className="whitespace-nowrap text-xs text-slate-500">{formatDateTimeHuman(i.createdAt)}</p></Td>
                    <Td num>{i.rijen}</Td>
                    <Td num>{i.diensten}</Td>
                    <Td className="text-xs">{i.dagtypes.join(', ')}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {fouten(i) > 0 ? <Badge tone="red" dot>{fouten(i)} fouten</Badge> : <Badge tone="emerald" stil dot>geen fouten</Badge>}
                        {waarsch(i) > 0 && <Badge tone="amber" stil dot>{waarsch(i)} waarschuwingen</Badge>}
                      </div>
                    </Td>
                    <Td nowrap>{i.actief ? <Badge tone="emerald" dot>actief</Badge> : <Badge tone="slate" stil>niet actief</Badge>}</Td>
                    <Td className="text-right">
                      <div className="inline-flex flex-wrap justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setDetail(i)}>Bevindingen</Button>
                        {!i.actief && <Button variant="secondary" size="sm" icon={<Play size={14} />} onClick={() => void activeer(i, fouten(i) > 0 && isAdmin)} disabled={bezig || (fouten(i) > 0 && !isAdmin)}>{fouten(i) > 0 && isAdmin ? 'Toch activeren' : 'Activeren'}</Button>}
                        <IconButton label="Looncomponenten-CSV (Easypay)" size="sm" onClick={() => void downloadCsv(i)}><Download size={16} /></IconButton>
                        {i.actief && <IconButton label="Looncodes afleiden uit deze import" size="sm" onClick={() => void afleiden(i)} disabled={bezig}><Wand2 size={16} /></IconButton>}
                        {!i.actief && <IconButton label="Import verwijderen" size="sm" onClick={() => setTeVerwijderen(i)}><Trash2 size={16} /></IconButton>}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Tabel>
          </div>
        </TableShell>
      )}
      {detail && <BevindingenModal imp={detail} onClose={() => setDetail(null)} />}
      {teVerwijderen && (
        <ConfirmationModal
          open
          onClose={() => setTeVerwijderen(null)}
          onConfirm={() => verwijder(teVerwijderen)}
          title="Import verwijderen?"
          message={`${teVerwijderen.filename ?? 'De import'} van ${formatDateTimeHuman(teVerwijderen.createdAt)} verdwijnt, samen met al zijn ${teVerwijderen.rijen} ritdelen van ${teVerwijderen.diensten} diensten en de bevindingen van de controle. De actieve dienstopbouw en de looncodes blijven ongewijzigd. Dit kan niet ongedaan worden gemaakt: om hem terug te krijgen importeer je het bestand opnieuw.`}
          confirmText="Verwijderen"
        />
      )}
    </div>
  );
}

function BevindingenModal({ imp, onClose }: { imp: SegmentImport; onClose: () => void }) {
  const [filter, setFilter] = useState<'alles' | 'fout' | 'waarschuwing'>('alles');
  const lijst = imp.bevindingen.filter((b) => filter === 'alles' || b.ernst === filter);
  return (
    <Modal open onClose={onClose} maxWidth="2xl" ariaLabel={`Bevindingen van ${imp.filename ?? 'import'}`}>
      <div className="p-6">
        <CardHeader title={`Bevindingen: ${imp.filename ?? 'import'}`} description={`${aantal(imp.rijen, 'ritdeel', 'ritdelen')}, ${aantal(imp.diensten, 'dienst', 'diensten')}. Fouten (gat, overlap, einde vóór start) blokkeren het activeren; waarschuwingen niet.`} aside={<div className="flex gap-1.5"><FilterChip active={filter === 'alles'} onClick={() => setFilter('alles')}>Alles</FilterChip><FilterChip active={filter === 'fout'} onClick={() => setFilter('fout')}>Fouten</FilterChip><FilterChip active={filter === 'waarschuwing'} onClick={() => setFilter('waarschuwing')}>Waarschuwingen</FilterChip></div>} />
        {imp.waarschuwingen.length > 0 && (
          <Card tone="warning" padding="sm" className="mt-3 text-xs text-amber-800">{aantal(imp.waarschuwingen.length, 'rij', 'rijen')} overgeslagen bij het inlezen: {imp.waarschuwingen.slice(0, 5).map((w) => `rij ${w.rij}: ${w.tekst}`).join(' · ')}{imp.waarschuwingen.length > 5 ? ' …' : ''}</Card>
        )}
        {lijst.length === 0 ? <div className="mt-4"><EmptyState compact variant="klaar" title="Niets gevonden" message="Geen bevindingen voor dit filter." /></div> : (
          <ul className="mt-4 max-h-[60vh] divide-y divide-hairline-subtle overflow-y-auto rounded-2xl border border-hairline">
            {lijst.map((b: Bevinding, i) => (
              <li key={i} className="flex items-start gap-3 px-3.5 py-2.5 text-sm">
                <Badge tone={b.ernst === 'fout' ? 'red' : 'amber'} stil dot className="shrink-0">{BEVINDING_LABEL[b.soort]}</Badge>
                <span className="min-w-0 flex-1"><span className="font-semibold">{b.serviceNumber}</span> <span className="text-slate-500">({b.dagtypeCode}{b.volgorde ? `, deel ${b.volgorde}` : ''})</span>: {b.tekst}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-5 flex justify-end"><Button variant="ghost" onClick={onClose}>Sluiten</Button></div>
      </div>
    </Modal>
  );
}

/** "5 / 123 (a)": lijn, rit en variant van een ritdeel, of een streepje. */
const lijnRit = (s: Segment) => (s.lijn ? `${s.lijn}${s.rit ? ` / ${s.rit}` : ''}${s.variant ? ` (${s.variant})` : ''}` : '—');

function DienstenTab({ actief, importsLaden }: { actief: SegmentImport | null; importsLaden: boolean }) {
  const [segmenten, setSegmenten] = useState<Array<Segment & { id: string }>>([]);
  const [params, setParams] = useState<Map<string, LoonParameters>>(new Map());
  const [zoek, setZoek] = useState('');
  const [dagtype, setDagtype] = useState('');
  const [gekozen, setGekozen] = useState<string | null>(null);
  const [ritblad, setRitblad] = useState<Array<{ dagtypeCode: string; rijen: RitbladRij[] }> | null>(null);
  // Een mislukt ritblad is geen "Geen ritblad": eigen foutstand met opnieuw.
  const [ritbladFout, setRitbladFout] = useState(false);
  const [ritbladPoging, setRitbladPoging] = useState(0);

  const actiefId = actief?.id ?? null;
  const zl = useZelfLadend(async () => {
    if (!actiefId) { setSegmenten([]); setParams(new Map()); return; }
    const [s, p] = await Promise.all([laadSegmenten({ importId: actiefId }), laadLoonparameters(actiefId)]);
    setSegmenten(s.segmenten);
    setParams(new Map(p.diensten.map((d) => [`${d.serviceNumber}|${d.dagtypeCode}`, d.parameters])));
  }, { deps: [actiefId], boodschap: 'Kon de diensten niet laden.' });
  const isLoading = zl.laden;

  const diensten = useMemo(() => {
    const m = new Map<string, { serviceNumber: string; dagtypeCode: string; segmenten: Array<Segment & { id: string }> }>();
    for (const s of segmenten) { const k = `${s.serviceNumber}|${s.dagtypeCode}`; const d = m.get(k) ?? { serviceNumber: s.serviceNumber, dagtypeCode: s.dagtypeCode, segmenten: [] }; d.segmenten.push(s); m.set(k, d); }
    return [...m.values()].sort((a, b) => a.serviceNumber.localeCompare(b.serviceNumber, 'nl', { numeric: true }));
  }, [segmenten]);
  const dagtypes = useMemo(() => [...new Set(diensten.map((d) => d.dagtypeCode))].sort(), [diensten]);
  const zoekTerm = zoek.trim().toLowerCase();
  const lijst = diensten.filter((d) => (!dagtype || d.dagtypeCode === dagtype) && (!zoekTerm || d.serviceNumber.toLowerCase().includes(zoekTerm)));
  const detail = gekozen ? diensten.find((d) => `${d.serviceNumber}|${d.dagtypeCode}` === gekozen) ?? null : null;

  const detailNummer = detail?.serviceNumber ?? null;
  useEffect(() => {
    setRitblad(null);
    setRitbladFout(false);
    if (!detailNummer) return;
    let actueel = true;
    void laadRitblad(detailNummer)
      .then((r) => { if (actueel) setRitblad(r.dagtypes); })
      .catch(() => { if (actueel) setRitbladFout(true); });
    return () => { actueel = false; };
  }, [detailNummer, ritbladPoging]);

  if (importsLaden) return <Card padding="none" className="divide-y divide-hairline-subtle" role="status" aria-busy="true" aria-label="Diensten worden geladen"><SkeletonRow className="px-5 py-4" /><SkeletonRow className="px-5 py-4" /></Card>;
  if (!actief) return <EmptyState title="Geen actieve import" message="Importeer en activeer eerst een ET-export in het tabblad Imports." />;
  if (zl.fout && segmenten.length === 0) return <Foutkaart boodschap={zl.fout} offline={!zl.online} onOpnieuw={zl.opnieuw} bezig={zl.laden} />;
  const p = detail ? params.get(gekozen!) : null;
  return (
    <div className="space-y-4">
      <div className="kpi-raster grid grid-cols-2 gap-3 md:grid-cols-4">
        <OpsStat icon={<Route size={16} />} tone="slate" label="Diensten" value={diensten.length} sub="in de actieve import" />
        <OpsStat icon={<ListChecks size={16} />} tone="slate" label="Ritdelen" value={segmenten.length} sub="alle dagtypes" />
        <OpsStat icon={<CheckCircle2 size={16} />} tone="slate" label="Dagtypes" value={dagtypes.length} sub={dagtypes.join(', ')} />
        <OpsStat icon={<AlertTriangle size={16} />} tone={actief.bevindingen.some((b) => b.ernst === 'fout') ? 'red' : 'slate'} label="Bevindingen" value={actief.bevindingen.length} sub="in de actieve import" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {/* Een lijst, geen tabel: het kader is wel TableShell (toolbar als kop),
            `past` want er is niets om horizontaal te schuiven. */}
        <TableShell
          className="lg:col-span-1"
          past
          kop={<TableToolbar zoek={zoek} onZoek={setZoek} placeholder="Dienstnummer…" telling={`${lijst.length} van ${diensten.length}`} filters={<Select aria-label="Dagtype" value={dagtype} onChange={(e) => setDagtype(e.target.value)} className="min-w-0 px-2.5 py-1.5 text-xs"><option value="">Alle dagtypes</option>{dagtypes.map((d) => <option key={d} value={d}>{d}</option>)}</Select>} />}
        >
          {isLoading ? <div className="divide-y divide-hairline-subtle"><SkeletonRow className="px-5 py-4" /><SkeletonRow className="px-5 py-4" /></div> : lijst.length === 0 ? (
            <div className="p-5"><EmptyState compact title={zoekTerm ? `Geen dienst “${zoek.trim()}”` : 'Geen diensten voor dit dagtype'} message="Pas het dienstnummer of het dagtype aan." /></div>
          ) : (
            <ul aria-label="Diensten" className="max-h-[70vh] divide-y divide-hairline-subtle overflow-y-auto">
              {lijst.map((d) => {
                const k = `${d.serviceNumber}|${d.dagtypeCode}`;
                const pp = params.get(k);
                return (
                  <li key={k}>
                    {/* rauw: lijstrij als knop die het detail rechts opent */}
                    {/* Selectie is neutraal (bg-slate-100/60), niet goud: goud is actie, focus en nu (huisstijl). */}
                    <button type="button" onClick={() => setGekozen(k)} aria-current={gekozen === k ? 'true' : undefined} className={cn('ios-pressable flex min-h-11 w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-surface-soft-hover', gekozen === k && 'bg-slate-100/60')}>
                      <span className="min-w-0 flex-1"><span className="whitespace-nowrap text-sm font-semibold text-slate-800">{d.serviceNumber}</span> <span className="text-xs text-slate-500">{d.dagtypeCode} · {d.segmenten.length} delen</span></span>
                      {pp && <span className="whitespace-nowrap text-xs text-slate-600">{minNaarHHMM(pp.lbRijtijd)} rij</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </TableShell>
        <div className="space-y-4 lg:col-span-2">
          {!detail ? <EmptyState compact title="Kies een dienst" message="Links een dienst kiezen voor de ritdelen, het ritblad en de loonparameters." /> : (
            <>
              {/* Ritdelen en ritblad: vanaf md een tabel die in haar kader
                  schuift (tien en acht kolommen naast de dienstenlijst), onder
                  md een lijst met dezelfde rijen: tijdvak en soort bovenaan,
                  loop, lijn en plaatsen eronder. De lijst staat eerst in de
                  DOM, zoals bij Imports. */}
              <TableShell
                label={`Ritdelen van dienst ${detail.serviceNumber}`}
                kop={(
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h2 className="text-card-title">Dienst {detail.serviceNumber} <span className="font-normal text-slate-500">· dagtype {detail.dagtypeCode}</span></h2>
                    {p && <div className="flex flex-wrap gap-1.5 text-xs">
                      <Chip mono={false}>rijtijd {minNaarHHMM(p.lbRijtijd)}</Chip><Chip mono={false}>stat. {p.lbStat100At}/{p.lbStat100Nat}/{p.lbStat50Nat}</Chip><Chip mono={false}>onderbr. {p.lbOnd}</Chip><Chip mono={false}>admin {p.lbAdmT}</Chip><Chip mono={false}>nacht {p.lbNacht}</Chip>
                      <Chip mono={false}>tik {p.tiktijden.map((t) => `${t.begin}–${t.einde}`).join(' · ')}</Chip>
                    </div>}
                  </div>
                )}
              >
                <ul className="divide-y divide-hairline-subtle md:hidden">
                  {detail.segmenten.map((s) => (
                    <li key={s.id} className={cn('space-y-1 px-4 py-3', (s.type === 'ONE' || s.type === 'ONV') && 'bg-surface-muted')}>
                      <p className="flex items-baseline gap-2 text-sm">
                        <span className="w-5 shrink-0 text-right text-xs text-slate-500">{s.volgorde}</span>
                        <span title={SEGMENT_TYPE_LABEL[s.type]}><Chip>{s.type}</Chip></span>
                        <span className="whitespace-nowrap font-semibold text-slate-800">{minNaarHHMM(s.startMin)}–{minNaarHHMM(s.eindeMin)}</span>
                        <span className="ml-auto whitespace-nowrap text-xs text-slate-500">{s.duurMin} min{s.afstandKm != null ? ` · ${s.afstandKm} km` : ''}</span>
                      </p>
                      {(s.loop || s.lijn || s.vertrek || s.aankomst) && (
                        <p className="pl-7 text-xs text-slate-600">
                          {s.loop && <span className="whitespace-nowrap">loop {s.loop}</span>}
                          {s.loop && s.lijn && ' · '}
                          {s.lijn && <span className="whitespace-nowrap">lijn {lijnRit(s)}</span>}
                          {(s.vertrek || s.aankomst) && <span className="block">{s.vertrek ?? '—'} → {s.aankomst ?? '—'}</span>}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
                <div className="hidden md:block">
                  <Tabel className="min-w-[40rem]">
                    <StickyThead><tr><Th num>#</Th><Th>Soort</Th><Th>Van</Th><Th>Tot</Th><Th num>Min</Th><Th>Loop</Th><Th>Lijn / rit</Th><Th>Vertrek</Th><Th>Aankomst</Th><Th num>Km</Th></tr></StickyThead>
                    <tbody>
                      {detail.segmenten.map((s) => (
                        <tr key={s.id} className={cn('border-b border-hairline-subtle last:border-b-0', (s.type === 'ONE' || s.type === 'ONV') && 'bg-surface-muted')}>
                          <Td num className="text-slate-500">{s.volgorde}</Td>
                          <Td nowrap><span title={SEGMENT_TYPE_LABEL[s.type]}><Chip>{s.type}</Chip></span></Td>
                          <Td nowrap>{minNaarHHMM(s.startMin)}</Td>
                          <Td nowrap>{minNaarHHMM(s.eindeMin)}</Td>
                          <Td num>{s.duurMin}</Td>
                          <Td nowrap>{s.loop ?? '—'}</Td>
                          <Td nowrap>{lijnRit(s)}</Td>
                          <Td>{s.vertrek ?? '—'}</Td>
                          <Td>{s.aankomst ?? '—'}</Td>
                          <Td num>{s.afstandKm ?? '—'}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Tabel>
                </div>
              </TableShell>
              <TableShell label={`Ritblad van dienst ${detail.serviceNumber}`} kop={<h2 className="text-card-title">Ritblad uit data</h2>}>
                {ritbladFout ? <div className="p-4"><Foutkaart compact boodschap="Kon het ritblad niet laden." offline={!zl.online} onOpnieuw={() => setRitbladPoging((n) => n + 1)} /></div> : ritblad === null ? <div className="p-4"><SkeletonRow /></div> : ritblad.length === 0 ? <div className="p-4"><EmptyState compact title="Geen ritblad" message="Geen ritdelen voor deze dienst." /></div> : ritblad.filter((r) => r.dagtypeCode === detail.dagtypeCode).map((r) => (
                  <div key={r.dagtypeCode}>
                    <ul className="divide-y divide-hairline-subtle md:hidden">
                      {r.rijen.map((rij, i) => (
                        <li key={i} className="space-y-1 px-4 py-3">
                          <p className="flex items-baseline gap-2 text-sm">
                            <span className="whitespace-nowrap font-semibold text-slate-800">{rij.start}–{rij.einde}</span>
                            <span className="whitespace-nowrap text-slate-700">lijn {rij.lijn || '—'}{rij.rit ? ` / ${rij.rit}` : ''}</span>
                            {rij.loop && <span className="ml-auto whitespace-nowrap text-xs text-slate-500">loop {rij.loop}</span>}
                          </p>
                          <p className="text-xs text-slate-600">{rij.vertrek || '—'} → {rij.aankomst || '—'}{rij.via ? `, via ${rij.via}` : ''}</p>
                        </li>
                      ))}
                    </ul>
                    <div className="hidden md:block">
                      <Tabel className="min-w-[36rem]">
                        <StickyThead><tr><Th>Lijn</Th><Th>Rit</Th><Th>Loop</Th><Th>Vertrek</Th><Th>Start</Th><Th>Aankomst</Th><Th>Einde</Th><Th>Via</Th></tr></StickyThead>
                        <tbody>
                          {r.rijen.map((rij, i) => (
                            <tr key={i} className="border-b border-hairline-subtle last:border-b-0">
                              <Td nowrap className="font-semibold">{rij.lijn || '—'}</Td><Td nowrap>{rij.rit || '—'}</Td><Td nowrap>{rij.loop || '—'}</Td>
                              <Td>{rij.vertrek || '—'}</Td><Td nowrap>{rij.start}</Td><Td>{rij.aankomst || '—'}</Td><Td nowrap>{rij.einde}</Td><Td>{rij.via || ''}</Td>
                            </tr>
                          ))}
                        </tbody>
                      </Tabel>
                    </div>
                  </div>
                ))}
              </TableShell>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DagtypesTab() {
  const [rijen, setRijen] = useState<DagtypeCode[]>([]);
  const zl = useZelfLadend(async () => { setRijen(await laadDagtypes()); }, { boodschap: 'Kon de dagtypes niet laden.' });
  if (zl.fout && rijen.length === 0) return <Foutkaart boodschap={zl.fout} offline={!zl.online} onOpnieuw={zl.opnieuw} bezig={zl.laden} />;
  const isLoading = zl.laden && rijen.length === 0;
  const zet = async (r: DagtypeCode, v: string) => {
    try { const n = await bewaarDagtype(r.code, v || null); setRijen((l) => l.map((x) => (x.code === r.code ? n : x))); }
    catch (err) { meldSchrijffout('Bewaren', err, () => void zet(r, v)); }
  };
  return (
    // Vier kolommen, op de telefoon drie: "Per jaar" schuift onder de
    // omschrijving, dan past de tabel op 375 px en blijft het één set
    // keuzelijsten (`past`, de kolomkop plakt).
    <TableShell
      label="Dagtypes"
      past
      kop={<p className="text-body-sm text-slate-600">De dagtypecodes van De Lijn (21 = maandag schooldag, 26 = zaterdag, 31 = maandag schoolvakantie, …) gekoppeld aan de dagtypes van het portaal, zodat de dekking en Mijn dag de juiste ritdelen kiezen.</p>}
    >
      {isLoading ? <div className="divide-y divide-hairline-subtle"><SkeletonRow className="px-5 py-4" /><SkeletonRow className="px-5 py-4" /></div> : (
        <Tabel>
          <StickyThead><tr><Th className="px-3 md:px-4">Code</Th><Th className="px-3 md:px-4">Omschrijving</Th><Th num className="hidden md:table-cell">Per jaar</Th><Th className="px-3 md:px-4">Portaal-dagtype</Th></tr></StickyThead>
          <tbody>
            {rijen.map((r) => (
              <tr key={r.code} className="border-b border-hairline-subtle last:border-b-0">
                <Td nowrap className="px-3 font-semibold text-slate-800 md:px-4">{r.code}</Td>
                <Td className="px-3 md:px-4">
                  {r.omschrijving}
                  <span className="block text-xs text-slate-500 md:hidden">{r.aantalPerJaar ?? '—'} per jaar</span>
                </Td>
                <Td num className="hidden text-slate-500 md:table-cell">{r.aantalPerJaar ?? '—'}</Td>
                <Td className="px-3 md:px-4">
                  <Field label="" htmlFor={`dt-${r.code}`} className="!space-y-0 [&>label]:sr-only">
                    <Select id={`dt-${r.code}`} aria-label={`Portaal-dagtype voor ${r.omschrijving}`} value={r.portaalDagtype ?? ''} onChange={(e) => void zet(r, e.target.value)} className="min-w-0 px-2 py-1 text-sm">
                      <option value="">niet gekoppeld</option>
                      {PORTAAL_DAGTYPES.map((d) => <option key={d} value={d}>{d}</option>)}
                    </Select>
                  </Field>
                </Td>
              </tr>
            ))}
          </tbody>
        </Tabel>
      )}
    </TableShell>
  );
}
