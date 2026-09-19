import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet, ListChecks, Play, RefreshCw, Route, Trash2, Upload, Wand2 } from 'lucide-react';
import type { User } from '../../types';
import { BEVINDING_LABEL, SEGMENT_TYPE_LABEL } from '../../../shared/dienst';
import { cn, downloadBlob, notify } from '../../lib/ui';
import { apiFetch } from '../../lib/api';
import { formatDateTimeHuman } from '../../lib/format';
import {
  activeerImport, bestandNaarBase64, bewaarDagtype, importeerBestand, laadDagtypes, laadImports, laadLoonparameters, laadRitblad, laadSegmenten, leidLooncodesAf,
  minNaarHHMM, verwijderImport, type Bevinding, type DagtypeCode, type LoonParameters, type RitbladRij, type Segment, type SegmentImport,
} from '../../lib/dienst';
import { EmptyState, PageHeader, PageShell } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { OpsStat } from '../../components/ops';
import { SkeletonRow } from '../../components/Skeleton';
import { Card, CardHeader } from '../../components/Card';
import { Field, Select } from '../../components/Field';
import { Badge, Button, Chip, FilterChip, IconButton, Segmented, Td, Th } from '../../components/primitives';
import { StickyThead, TableToolbar } from '../../components/Table';

type Tab = 'imports' | 'diensten' | 'dagtypes';
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
  const [isLoading, setIsLoading] = useState(true);
  const load = useCallback(async () => {
    setIsLoading(true);
    try { setImports(await laadImports()); } catch (err) { notify(err instanceof Error ? err.message : 'Kon de imports niet laden.', 'error'); } finally { setIsLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const actief = imports.find((i) => i.actief) ?? null;
  return (
    <PageShell>
      <PageHeader view="dienstopbouw" title="Dienstopbouw" actions={<Button variant="secondary" icon={<RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />} onClick={() => void load()} disabled={isLoading}>Ververs</Button>} />
      <Segmented<Tab>
        label="Onderdeel"
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
      {tab === 'imports' && <ImportsTab imports={imports} isLoading={isLoading} isAdmin={currentUser.role === 'admin'} onChanged={load} />}
      {tab === 'diensten' && <DienstenTab actief={actief} />}
      {tab === 'dagtypes' && <DagtypesTab />}
    </PageShell>
  );
}

function ImportsTab({ imports, isLoading, isAdmin, onChanged }: { imports: SegmentImport[]; isLoading: boolean; isAdmin: boolean; onChanged: () => Promise<void> }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [bezig, setBezig] = useState(false);
  const [detail, setDetail] = useState<SegmentImport | null>(null);
  const actief = imports.find((i) => i.actief) ?? null;

  const upload = async (file: File) => {
    setBezig(true);
    try {
      const imp = await importeerBestand(await bestandNaarBase64(file), file.name);
      const fouten = imp.bevindingen.filter((b) => b.ernst === 'fout').length;
      notify(`${imp.rijen} ritdelen voor ${imp.diensten} diensten ingelezen${fouten ? `, ${fouten} fouten` : ''}.`, fouten ? 'info' : 'success');
      await onChanged();
      setDetail(imp);
    } catch (err) { notify(err instanceof Error ? err.message : 'Import mislukt.', 'error'); }
    finally { setBezig(false); if (fileRef.current) fileRef.current.value = ''; }
  };
  const activeer = async (imp: SegmentImport, forceer = false) => {
    setBezig(true);
    try { await activeerImport(imp.id, forceer); notify('Dienstopbouw geactiveerd.', 'success'); await onChanged(); }
    catch (err) { notify(err instanceof Error ? err.message : 'Activeren is mislukt.', 'error'); }
    finally { setBezig(false); }
  };
  const verwijder = async (imp: SegmentImport) => {
    try { await verwijderImport(imp.id); notify('Import verwijderd.', 'success'); await onChanged(); }
    catch (err) { notify(err instanceof Error ? err.message : 'Verwijderen is mislukt.', 'error'); }
  };
  const afleiden = async (imp: SegmentImport) => {
    setBezig(true);
    try {
      const r = await leidLooncodesAf(imp.id);
      notify(`Looncodes: ${r.bijgewerkt} bijgewerkt, ${r.nieuw} nieuw${r.overgeslagen.length ? `, ${r.overgeslagen.length} handmatig bewerkte overgeslagen` : ''}${r.teVeelDelen.length ? `; meer dan drie dienstdelen: ${r.teVeelDelen.join(', ')}` : ''}.`, 'success');
    } catch (err) { notify(err instanceof Error ? err.message : 'Afleiden is mislukt.', 'error'); }
    finally { setBezig(false); }
  };
  const downloadCsv = async (imp: SegmentImport) => {
    try {
      const res = await apiFetch(`/api/dienstopbouw/imports/${encodeURIComponent(imp.id)}/looncomponenten?format=csv`);
      if (!res.ok) throw new Error(`Export mislukt (${res.status}).`);
      await downloadBlob(`loondiensten-easypay-${imp.createdAt.slice(0, 10)}.csv`, await res.blob());
    } catch (err) { notify(err instanceof Error ? err.message : 'Export mislukt.', 'error'); }
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
          {actief && <span className="text-xs text-slate-500">Actief: {actief.filename ?? 'import'} van {formatDateTimeHuman(actief.createdAt)}, {actief.rijen} ritdelen, {actief.diensten} diensten.</span>}
        </div>
      </Card>

      {isLoading && imports.length === 0 ? <Card padding="none" className="divide-y divide-hairline-subtle"><SkeletonRow className="px-5 py-4" /><SkeletonRow className="px-5 py-4" /></Card> : imports.length === 0 ? (
        <EmptyState title="Nog geen import" message="Importeer de ET-export om de ritdelen, controles en looncomponenten te krijgen." />
      ) : (
        <div className="surface-table rounded-3xl overflow-clip">
          {/* Mobiel: kaartlijst (de brede tabel hieronder is desktop-only, zoals de andere beheerschermen). */}
          <ul className="md:hidden divide-y divide-hairline-subtle">
            {imports.map((i) => (
              <li key={i.id} className="space-y-2 px-5 py-3.5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="min-w-0 truncate text-sm font-semibold text-slate-800">{i.filename ?? 'import'}</p>
                  {i.actief ? <Badge tone="emerald" dot>actief</Badge> : <Badge tone="slate" kaal>niet actief</Badge>}
                </div>
                <p className="text-xs text-slate-500">{formatDateTimeHuman(i.createdAt)} · {i.rijen} ritdelen · {i.diensten} diensten · {i.dagtypes.join(', ')}</p>
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
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full min-w-[48rem] text-left border-collapse">
              <StickyThead><tr><Th>Import</Th><Th num>Ritdelen</Th><Th num>Diensten</Th><Th>Dagtypes</Th><Th>Controle</Th><Th>Status</Th><Th className="text-right">Acties</Th></tr></StickyThead>
              <tbody>
                {imports.map((i) => (
                  <tr key={i.id} className="border-b border-hairline-subtle last:border-b-0 align-top">
                    <Td><p className="font-semibold text-slate-800">{i.filename ?? 'import'}</p><p className="text-xs text-slate-500">{formatDateTimeHuman(i.createdAt)}</p></Td>
                    <Td num>{i.rijen}</Td>
                    <Td num>{i.diensten}</Td>
                    <Td className="text-xs">{i.dagtypes.join(', ')}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {fouten(i) > 0 ? <Badge tone="red" dot>{fouten(i)} fouten</Badge> : <Badge tone="emerald" stil dot>geen fouten</Badge>}
                        {waarsch(i) > 0 && <Badge tone="amber" stil dot>{waarsch(i)} waarschuwingen</Badge>}
                      </div>
                    </Td>
                    <Td>{i.actief ? <Badge tone="emerald" dot>actief</Badge> : <Badge tone="slate" stil>niet actief</Badge>}</Td>
                    <Td className="text-right">
                      <div className="inline-flex flex-wrap justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setDetail(i)}>Bevindingen</Button>
                        {!i.actief && <Button variant="secondary" size="sm" icon={<Play size={14} />} onClick={() => void activeer(i, fouten(i) > 0 && isAdmin)} disabled={bezig || (fouten(i) > 0 && !isAdmin)}>{fouten(i) > 0 && isAdmin ? 'Toch activeren' : 'Activeren'}</Button>}
                        <IconButton label="Looncomponenten-CSV (Easypay)" size="sm" onClick={() => void downloadCsv(i)}><Download size={16} /></IconButton>
                        {i.actief && <IconButton label="Looncodes afleiden uit deze import" size="sm" onClick={() => void afleiden(i)} disabled={bezig}><Wand2 size={16} /></IconButton>}
                        {!i.actief && <IconButton label="Import verwijderen" size="sm" onClick={() => void verwijder(i)}><Trash2 size={16} /></IconButton>}
                      </div>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {detail && <BevindingenModal imp={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

function BevindingenModal({ imp, onClose }: { imp: SegmentImport; onClose: () => void }) {
  const [filter, setFilter] = useState<'alles' | 'fout' | 'waarschuwing'>('alles');
  const lijst = imp.bevindingen.filter((b) => filter === 'alles' || b.ernst === filter);
  return (
    <Modal open onClose={onClose} maxWidth="2xl" ariaLabel={`Bevindingen van ${imp.filename ?? 'import'}`}>
      <div className="p-6">
        <CardHeader title={`Bevindingen: ${imp.filename ?? 'import'}`} description={`${imp.rijen} ritdelen, ${imp.diensten} diensten. Fouten (gat, overlap, einde vóór start) blokkeren het activeren; waarschuwingen niet.`} aside={<div className="flex gap-1.5"><FilterChip active={filter === 'alles'} onClick={() => setFilter('alles')}>Alles</FilterChip><FilterChip active={filter === 'fout'} onClick={() => setFilter('fout')}>Fouten</FilterChip><FilterChip active={filter === 'waarschuwing'} onClick={() => setFilter('waarschuwing')}>Waarschuwingen</FilterChip></div>} />
        {imp.waarschuwingen.length > 0 && (
          <Card tone="warning" padding="sm" className="mt-3 text-xs text-amber-800">{imp.waarschuwingen.length} rijen overgeslagen bij het inlezen: {imp.waarschuwingen.slice(0, 5).map((w) => `rij ${w.rij}: ${w.tekst}`).join(' · ')}{imp.waarschuwingen.length > 5 ? ' …' : ''}</Card>
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

function DienstenTab({ actief }: { actief: SegmentImport | null }) {
  const [segmenten, setSegmenten] = useState<Array<Segment & { id: string }>>([]);
  const [params, setParams] = useState<Map<string, LoonParameters>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [zoek, setZoek] = useState('');
  const [dagtype, setDagtype] = useState('');
  const [gekozen, setGekozen] = useState<string | null>(null);
  const [ritblad, setRitblad] = useState<Array<{ dagtypeCode: string; rijen: RitbladRij[] }> | null>(null);

  useEffect(() => {
    if (!actief) { setIsLoading(false); return; }
    setIsLoading(true);
    void Promise.all([laadSegmenten({ importId: actief.id }), laadLoonparameters(actief.id)])
      .then(([s, p]) => { setSegmenten(s.segmenten); setParams(new Map(p.diensten.map((d) => [`${d.serviceNumber}|${d.dagtypeCode}`, d.parameters]))); })
      .catch((err) => notify(err instanceof Error ? err.message : 'Kon de diensten niet laden.', 'error'))
      .finally(() => setIsLoading(false));
  }, [actief]);

  const diensten = useMemo(() => {
    const m = new Map<string, { serviceNumber: string; dagtypeCode: string; segmenten: Array<Segment & { id: string }> }>();
    for (const s of segmenten) { const k = `${s.serviceNumber}|${s.dagtypeCode}`; const d = m.get(k) ?? { serviceNumber: s.serviceNumber, dagtypeCode: s.dagtypeCode, segmenten: [] }; d.segmenten.push(s); m.set(k, d); }
    return [...m.values()].sort((a, b) => a.serviceNumber.localeCompare(b.serviceNumber, 'nl', { numeric: true }));
  }, [segmenten]);
  const dagtypes = useMemo(() => [...new Set(diensten.map((d) => d.dagtypeCode))].sort(), [diensten]);
  const zoekTerm = zoek.trim().toLowerCase();
  const lijst = diensten.filter((d) => (!dagtype || d.dagtypeCode === dagtype) && (!zoekTerm || d.serviceNumber.toLowerCase().includes(zoekTerm)));
  const detail = gekozen ? diensten.find((d) => `${d.serviceNumber}|${d.dagtypeCode}` === gekozen) ?? null : null;

  useEffect(() => {
    if (!detail) { setRitblad(null); return; }
    void laadRitblad(detail.serviceNumber).then((r) => setRitblad(r.dagtypes)).catch(() => setRitblad([]));
  }, [detail]);

  if (!actief) return <EmptyState title="Geen actieve import" message="Importeer en activeer eerst een ET-export in het tabblad Imports." />;
  const p = detail ? params.get(gekozen!) : null;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <OpsStat icon={<Route size={16} />} tone="slate" label="Diensten" value={diensten.length} sub="in de actieve import" />
        <OpsStat icon={<ListChecks size={16} />} tone="slate" label="Ritdelen" value={segmenten.length} sub="alle dagtypes" />
        <OpsStat icon={<CheckCircle2 size={16} />} tone="slate" label="Dagtypes" value={dagtypes.length} sub={dagtypes.join(', ')} />
        <OpsStat icon={<AlertTriangle size={16} />} tone={actief.bevindingen.some((b) => b.ernst === 'fout') ? 'red' : 'slate'} label="Bevindingen" value={actief.bevindingen.length} sub="in de actieve import" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="surface-table rounded-3xl overflow-clip lg:col-span-1">
          <div className="border-b border-hairline px-5 py-4">
            <TableToolbar zoek={zoek} onZoek={setZoek} placeholder="Dienstnummer…" telling={`${lijst.length} van ${diensten.length}`} filters={<Select aria-label="Dagtype" value={dagtype} onChange={(e) => setDagtype(e.target.value)} className="min-w-0 px-2.5 py-1.5 text-xs"><option value="">Alle dagtypes</option>{dagtypes.map((d) => <option key={d} value={d}>{d}</option>)}</Select>} />
          </div>
          {isLoading ? <div className="divide-y divide-hairline-subtle"><SkeletonRow className="px-5 py-4" /><SkeletonRow className="px-5 py-4" /></div> : (
            <ul className="max-h-[70vh] divide-y divide-hairline-subtle overflow-y-auto">
              {lijst.map((d) => {
                const k = `${d.serviceNumber}|${d.dagtypeCode}`;
                const pp = params.get(k);
                return (
                  <li key={k}>
                    {/* rauw: lijstrij als knop die het detail rechts opent */}
                    <button type="button" onClick={() => setGekozen(k)} className={cn('ios-pressable flex min-h-11 w-full items-center gap-3 px-5 py-2.5 text-left transition-colors hover:bg-surface-soft-hover', gekozen === k && 'bg-oker-50')}>
                      <span className="min-w-0 flex-1"><span className="text-sm font-semibold text-slate-800">{d.serviceNumber}</span> <span className="text-xs text-slate-500">{d.dagtypeCode} · {d.segmenten.length} delen</span></span>
                      {pp && <span className="text-xs text-slate-600">{minNaarHHMM(pp.lbRijtijd)} rij</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="space-y-4 lg:col-span-2">
          {!detail ? <EmptyState compact title="Kies een dienst" message="Links een dienst kiezen voor de ritdelen, het ritblad en de loonparameters." /> : (
            <>
              <Card padding="none" className="overflow-clip">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-5 py-3">
                  <h2 className="text-card-title">Dienst {detail.serviceNumber} <span className="font-normal text-slate-500">· dagtype {detail.dagtypeCode}</span></h2>
                  {p && <div className="flex flex-wrap gap-1.5 text-xs">
                    <Chip mono={false}>rijtijd {minNaarHHMM(p.lbRijtijd)}</Chip><Chip mono={false}>stat. {p.lbStat100At}/{p.lbStat100Nat}/{p.lbStat50Nat}</Chip><Chip mono={false}>onderbr. {p.lbOnd}</Chip><Chip mono={false}>admin {p.lbAdmT}</Chip><Chip mono={false}>nacht {p.lbNacht}</Chip>
                    <Chip mono={false}>tik {p.tiktijden.map((t) => `${t.begin}-${t.einde}`).join(' · ')}</Chip>
                  </div>}
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[40rem] text-left border-collapse">
                    <StickyThead><tr><Th num>#</Th><Th>Soort</Th><Th>Van</Th><Th>Tot</Th><Th num>Min</Th><Th>Loop</Th><Th>Lijn / rit</Th><Th>Vertrek</Th><Th>Aankomst</Th><Th num>Km</Th></tr></StickyThead>
                    <tbody>
                      {detail.segmenten.map((s) => (
                        <tr key={s.id} className={cn('border-b border-hairline-subtle last:border-b-0', (s.type === 'ONE' || s.type === 'ONV') && 'bg-surface-muted')}>
                          <Td num className="text-slate-500">{s.volgorde}</Td>
                          <Td><span title={SEGMENT_TYPE_LABEL[s.type]}><Chip>{s.type}</Chip></span></Td>
                          <Td className="font-mono text-xs">{minNaarHHMM(s.startMin)}</Td>
                          <Td className="font-mono text-xs">{minNaarHHMM(s.eindeMin)}</Td>
                          <Td num>{s.duurMin}</Td>
                          <Td className="text-xs">{s.loop ?? '—'}</Td>
                          <Td className="text-xs">{s.lijn ? `${s.lijn}${s.rit ? ` / ${s.rit}` : ''}${s.variant ? ` (${s.variant})` : ''}` : '—'}</Td>
                          <Td className="text-xs">{s.vertrek ?? '—'}</Td>
                          <Td className="text-xs">{s.aankomst ?? '—'}</Td>
                          <Td num className="text-xs">{s.afstandKm ?? '—'}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
              <Card padding="none" className="overflow-clip">
                <div className="border-b border-hairline px-5 py-3"><h2 className="text-card-title">Ritblad uit data</h2></div>
                {ritblad === null ? <div className="p-4"><SkeletonRow /></div> : ritblad.length === 0 ? <div className="p-4"><EmptyState compact title="Geen ritblad" message="Geen ritdelen voor deze dienst." /></div> : ritblad.filter((r) => r.dagtypeCode === detail.dagtypeCode).map((r) => (
                  <div key={r.dagtypeCode} className="overflow-x-auto">
                    <table className="w-full min-w-[36rem] text-left border-collapse">
                      <StickyThead><tr><Th>Lijn</Th><Th>Rit</Th><Th>Loop</Th><Th>Vertrek</Th><Th>Start</Th><Th>Aankomst</Th><Th>Einde</Th><Th>Via</Th></tr></StickyThead>
                      <tbody>
                        {r.rijen.map((rij, i) => (
                          <tr key={i} className="border-b border-hairline-subtle last:border-b-0">
                            <Td className="text-sm font-semibold">{rij.lijn || '—'}</Td><Td className="text-sm">{rij.rit || '—'}</Td><Td className="text-xs">{rij.loop || '—'}</Td>
                            <Td className="text-xs">{rij.vertrek || '—'}</Td><Td className="font-mono text-xs">{rij.start}</Td><Td className="text-xs">{rij.aankomst || '—'}</Td><Td className="font-mono text-xs">{rij.einde}</Td><Td className="text-xs">{rij.via || ''}</Td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DagtypesTab() {
  const [rijen, setRijen] = useState<DagtypeCode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  useEffect(() => { void laadDagtypes().then(setRijen).catch((err) => notify(err instanceof Error ? err.message : 'Kon de dagtypes niet laden.', 'error')).finally(() => setIsLoading(false)); }, []);
  const zet = async (r: DagtypeCode, v: string) => {
    try { const n = await bewaarDagtype(r.code, v || null); setRijen((l) => l.map((x) => (x.code === r.code ? n : x))); }
    catch (err) { notify(err instanceof Error ? err.message : 'Bewaren is mislukt.', 'error'); }
  };
  return (
    <div className="surface-table rounded-3xl overflow-clip">
      <div className="border-b border-hairline px-5 py-4 text-sm text-slate-600">De dagtypecodes van De Lijn (21 = maandag schooldag, 26 = zaterdag, 31 = maandag schoolvakantie, …) gekoppeld aan de dagtypes van het portaal, zodat de dekking en Mijn dag de juiste ritdelen kiezen.</div>
      {isLoading ? <div className="divide-y divide-hairline-subtle"><SkeletonRow className="px-5 py-4" /><SkeletonRow className="px-5 py-4" /></div> : (
        <table className="w-full text-left border-collapse">
          <StickyThead><tr><Th>Code</Th><Th>Omschrijving</Th><Th num>Per jaar</Th><Th>Portaal-dagtype</Th></tr></StickyThead>
          <tbody>
            {rijen.map((r) => (
              <tr key={r.code} className="border-b border-hairline-subtle last:border-b-0">
                <Td className="font-mono text-sm font-semibold">{r.code}</Td>
                <Td className="text-sm">{r.omschrijving}</Td>
                <Td num className="text-slate-500">{r.aantalPerJaar ?? '—'}</Td>
                <Td>
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
        </table>
      )}
    </div>
  );
}
