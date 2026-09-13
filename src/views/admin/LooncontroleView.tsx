import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Coins, Download, FileSpreadsheet, Hash, Pencil, Plus, RefreshCw, Trash2, Users } from 'lucide-react';
import type { User } from '../../types';
import { DIENST_TYPES, DIENST_TYPE_LABEL, loonCodeSleutel } from '../../../shared/loon';
import { cn, downloadBlob, notify } from '../../lib/ui';
import { apiFetch } from '../../lib/api';
import { formatShortDay, MONTH_NAMES } from '../../lib/format';
import { useRouteParam } from '../../app/router';
import {
  bewaarInstellingen, bewaarLoonCode, bewaarMedewerker, dagenInMaand, importeerMedewerkers, laadExportControle, laadInstellingen, laadLoonCodes,
  laadMaand, laadMedewerkers, LoonFout, schuifMaand, vandaagIso, verwijderLoonCode,
  type DagTelling, type ExportControle, type LoonCode, type LoonCodeBody, type LoonInstellingen, type LoonMedewerkerRij,
} from '../../lib/loon';
import { EmptyState, PageHeader, PageShell } from '../../components/ui';
import { Modal } from '../../components/Modal';
import { OpsStat } from '../../components/ops';
import { SkeletonRow } from '../../components/Skeleton';
import { Card, CardHeader } from '../../components/Card';
import { Avatar } from '../../components/Avatar';
import { Field, Input, Select, Textarea } from '../../components/Field';
import { Badge, Button, FilterChip, IconButton, Switch, Td, Th, segItemClass } from '../../components/primitives';
import { SortTh, StickyThead, TableToolbar, useSort } from '../../components/Table';

type Tab = 'maand' | 'codes' | 'medewerkers';

/**
 * Looncontrole (fase B Access-migratie, 13-09): per maand de stand van de
 * dagafsluitingen, de controle vóór de Easypay-export en de export zelf;
 * daarnaast het beheer van de looncodes (dienstnummer of afwezigheidscode →
 * Easypay-activiteit, typeprestatie, tiktijden) en de matricules van de
 * medewerkers. Vervangt de Easypay-keten in Access.
 */
export function LooncontroleView({ currentUser, onNavigate }: { currentUser: User; onNavigate?: (view: 'dagafsluiting', params?: string[]) => void }) {
  const [maandParam, zetMaandParam] = useRouteParam(0);
  const maand = maandParam && /^\d{4}-\d{2}$/.test(maandParam) ? maandParam : schuifMaand(vandaagIso().slice(0, 7), -1);
  const [tab, setTab] = useState<Tab>('maand');
  return (
    <PageShell>
      <PageHeader eyebrow="Beheer · Loon" title="Looncontrole" />
      <div className="glass-segmented inline-flex shrink-0 rounded-2xl p-1" role="group" aria-label="Onderdeel">
        {(['maand', 'codes', 'medewerkers'] as const).map((t) => (
          // rauw: segmented-control-item via segItemClass (het voorgeschreven patroon)
          <button key={t} type="button" onClick={() => setTab(t)} aria-pressed={tab === t} className={segItemClass(tab === t, 'inline-flex items-center gap-1.5 min-h-11 sm:pointer-fine:min-h-8')}>
            {t === 'maand' ? <Coins size={14} /> : t === 'codes' ? <Hash size={14} /> : <Users size={14} />}
            {t === 'maand' ? 'Maand' : t === 'codes' ? 'Looncodes' : 'Medewerkers'}
          </button>
        ))}
      </div>
      {tab === 'maand' && <MaandTab maand={maand} zetMaand={(m) => zetMaandParam(m)} isAdmin={currentUser.role === 'admin'} onNavigate={onNavigate} />}
      {tab === 'codes' && <CodesTab />}
      {tab === 'medewerkers' && <MedewerkersTab />}
    </PageShell>
  );
}

function MaandTab({ maand, zetMaand, isAdmin, onNavigate }: { maand: string; zetMaand: (m: string) => void; isAdmin: boolean; onNavigate?: (view: 'dagafsluiting', params?: string[]) => void }) {
  const [dagen, setDagen] = useState<DagTelling[]>([]);
  const [planningDagen, setPlanningDagen] = useState<string[]>([]);
  const [controle, setControle] = useState<ExportControle | null>(null);
  const [instellingen, setInstellingen] = useState<LoonInstellingen | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [bezig, setBezig] = useState(false);
  const [lidnrDraft, setLidnrDraft] = useState('');

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const [m, c, i] = await Promise.all([laadMaand(maand), laadExportControle(maand), laadInstellingen()]);
      setDagen(m.dagen); setPlanningDagen(m.planningDagen); setControle(c); setInstellingen(i); setLidnrDraft(String(i.easypayLidnr || ''));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Kon de maand niet laden.', 'error');
    } finally { setIsLoading(false); }
  }, [maand]);
  useEffect(() => { void load(); }, [load]);

  const perDag = useMemo(() => new Map(dagen.map((d) => [d.datum, d])), [dagen]);
  const alle = dagenInMaand(maand);
  const vandaag = vandaagIso();
  const planningSet = new Set(planningDagen);
  const tellers = {
    afgesloten: dagen.filter((d) => d.status === 'afgesloten').length,
    open: dagen.filter((d) => d.status === 'open').length,
    nietGeopend: alle.filter((d) => d <= vandaag && !perDag.has(d)).length,
    overmin: dagen.reduce((s, d) => s + d.overmin, 0),
  };
  const [j, m] = maand.split('-').map(Number);
  const titel = `${MONTH_NAMES[m - 1]} ${j}`;

  const download = async () => {
    setBezig(true);
    try {
      const res = await apiFetch(`/api/loon/export?maand=${maand}&format=csv${isAdmin && controle?.blokkerend ? '&forceer=1' : ''}`);
      if (!res.ok) { const d = await res.json().catch(() => null); throw new Error(d?.error || `Export mislukt (${res.status}).`); }
      await downloadBlob(`easypay-${maand}.csv`, await res.blob());
    } catch (err) { notify(err instanceof Error ? err.message : 'Export mislukt.', 'error'); }
    finally { setBezig(false); }
  };
  const bewaarLidnr = async () => {
    const n = Number(lidnrDraft);
    if (!Number.isInteger(n) || n < 0) { notify('Vul een geheel getal in.', 'error'); return; }
    try { setInstellingen(await bewaarInstellingen({ easypayLidnr: n })); notify('Lidnummer bewaard.', 'success'); await load(); }
    catch (err) { notify(err instanceof Error ? err.message : 'Bewaren is mislukt.', 'error'); }
  };
  const dagTone = (iso: string): 'emerald' | 'amber' | 'slate' | 'red' => {
    const d = perDag.get(iso);
    if (d?.status === 'afgesloten') return 'emerald';
    if (d?.status === 'open') return 'amber';
    if (iso <= vandaag && planningSet.has(iso)) return 'red';
    return 'slate';
  };

  return (
    <div className="space-y-4">
      <Card padding="sm" className="flex flex-wrap items-center gap-2">
        <IconButton label="Vorige maand" onClick={() => zetMaand(schuifMaand(maand, -1))}><ChevronLeft size={18} /></IconButton>
        <p className="min-w-0 flex-1 text-sm font-semibold text-slate-800">{titel}</p>
        <IconButton label="Volgende maand" onClick={() => zetMaand(schuifMaand(maand, 1))}><ChevronRight size={18} /></IconButton>
        <Button variant="secondary" size="sm" icon={<RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />} onClick={() => void load()} disabled={isLoading}>Ververs</Button>
      </Card>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <OpsStat icon={<CheckCircle2 size={16} />} tone="slate" label="Afgesloten" value={tellers.afgesloten} sub={`van ${alle.filter((d) => d <= vandaag).length} dagen tot vandaag`} />
        <OpsStat icon={<AlertTriangle size={16} />} tone={tellers.open > 0 ? 'amber' : 'slate'} label="Open" value={tellers.open} sub="geopend, nog niet afgesloten" />
        <OpsStat icon={<AlertTriangle size={16} />} tone={tellers.nietGeopend > 0 ? 'red' : 'slate'} label="Niet geopend" value={tellers.nietGeopend} sub="dagen tot vandaag" />
        <OpsStat icon={<Coins size={16} />} tone="slate" label="Overminuten" value={tellers.overmin} sub="som van de maand" />
      </div>

      {/* Dagenraster */}
      <Card padding="sm">
        <div className="grid grid-cols-7 gap-1.5">
          {alle.map((iso) => {
            const d = perDag.get(iso);
            const tone = dagTone(iso);
            const dagNr = Number(iso.slice(8, 10));
            return (
              // rauw: dagtegel in het maandraster, opent de dagafsluiting
              <button
                key={iso}
                type="button"
                onClick={() => onNavigate?.('dagafsluiting', [iso])}
                title={`${formatShortDay(iso)}${d ? `, ${d.rijen} rijen, ${d.overmin} overminuten` : ''}`}
                className={cn(
                  'ios-pressable flex min-h-11 flex-col items-center justify-center rounded-xl text-xs font-semibold ring-1 ring-hairline transition-colors',
                  tone === 'emerald' && 'bg-emerald-50 text-emerald-800',
                  tone === 'amber' && 'bg-amber-50 text-amber-800',
                  tone === 'red' && 'bg-red-50 text-red-800',
                  tone === 'slate' && 'bg-surface-muted text-slate-500',
                )}
              >
                <span>{dagNr}</span>
                {d && d.overmin !== 0 && <span className="text-2xs font-medium">{d.overmin > 0 ? '+' : ''}{d.overmin}</span>}
              </button>
            );
          })}
        </div>
        <p className="mt-2 flex flex-wrap gap-3 text-2xs text-slate-500">
          <span><Badge tone="emerald" dot stil>afgesloten</Badge></span>
          <span><Badge tone="amber" dot stil>open</Badge></span>
          <span><Badge tone="red" dot stil>niet geopend (planning aanwezig)</Badge></span>
        </p>
      </Card>

      {/* Controle + export */}
      <Card className="space-y-3">
        <CardHeader
          icon={<FileSpreadsheet size={16} />}
          title="Easypay-export"
          description={controle ? `${controle.samenvatting.rijen} rijen voor ${controle.samenvatting.personen} personen, ${controle.samenvatting.overminRijen} overminuten-rijen, ${controle.samenvatting.premies} premies.` : undefined}
          aside={(
            <Button variant={controle?.blokkerend ? 'secondary' : 'primary'} icon={<Download size={16} />} onClick={() => void download()} disabled={bezig || !controle || (controle.blokkerend && !isAdmin)}>
              {controle?.blokkerend ? (isAdmin ? 'Toch downloaden' : 'Nog niet klaar') : 'CSV downloaden'}
            </Button>
          )}
        />
        {controle && (
          <ul className="space-y-1 text-sm">
            <li className={cn('inline-flex items-center gap-1.5', controle.openDagen.length ? 'text-amber-700' : 'text-emerald-700')}>
              {controle.openDagen.length ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
              {controle.openDagen.length ? `${controle.openDagen.length} dagen nog open: ${controle.openDagen.map((d) => d.slice(8)).join(', ')}` : 'Alle geopende dagen zijn afgesloten'}
            </li>
            <li className={cn('inline-flex items-center gap-1.5', controle.dagenGeopend === 0 ? 'text-amber-700' : 'text-slate-700')}>{controle.dagenGeopend === 0 ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}{controle.dagenGeopend} dagen geopend</li>
            <li className={cn('inline-flex items-center gap-1.5', controle.lidnr ? 'text-slate-700' : 'text-red-700')}>{controle.lidnr ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}Easypay-lidnummer {controle.lidnr || 'ontbreekt'}</li>
            {controle.issues.map((i, n) => (
              <li key={n} className="inline-flex items-center gap-1.5 text-red-700"><AlertTriangle size={14} />
                {i.soort === 'geen_matricule' ? `${i.naam}: geen Easypay-matricule (tab Medewerkers)` : i.soort === 'onbekende_code' ? `${i.naam}, ${i.datum.slice(8)}: onbekende code “${i.code}” (tab Looncodes)` : `${i.naam}, ${i.datum.slice(8)}: geen code`}
              </li>
            ))}
          </ul>
        )}
        {isAdmin && (
          <div className="flex flex-wrap items-end gap-2 border-t border-slate-200/70 pt-3">
            <Field label="Easypay-lidnummer (alphal2)" className="w-48">{({ id }) => <Input id={id} inputMode="numeric" value={lidnrDraft} onChange={(e) => setLidnrDraft(e.target.value)} />}</Field>
            <Button variant="secondary" size="sm" onClick={() => void bewaarLidnr()} disabled={!instellingen || lidnrDraft === String(instellingen.easypayLidnr || '')}>Bewaren</Button>
          </div>
        )}
      </Card>
    </div>
  );
}

const LEEG_CODE: LoonCodeBody & { code: string } = { code: '', codeWeergave: '', omschrijving: '', dienstType: 'lijn', inExport: true, easypayActiviteit: 'LIJN', easypayTypePrest: 40140, tik1: '', tik2: '', tik3: '', tik4: '', tik5: '', tik6: '', lbRijtijd: null, lbStat100At: null, lbStat100Nat: null, lbStat50Nat: null, lbOnd: null, lbAndWrk: null, lbNacht: null };

function CodesTab() {
  const [codes, setCodes] = useState<LoonCode[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [zoek, setZoek] = useState('');
  const [filter, setFilter] = useState<'alles' | 'lijn' | 'varia' | 'ander'>('alles');
  const [bewerk, setBewerk] = useState<(LoonCodeBody & { code: string; nieuw?: boolean }) | null>(null);
  const sort = useSort<string>('code');
  const load = async () => {
    setIsLoading(true);
    try { setCodes(await laadLoonCodes()); } catch (err) { notify(err instanceof Error ? err.message : 'Kon de looncodes niet laden.', 'error'); } finally { setIsLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const zoekTerm = zoek.trim().toLowerCase();
  const lijst = sort.sorteer(
    codes.filter((c) => filter === 'alles' || c.dienstType === filter).filter((c) => !zoekTerm || `${c.code} ${c.omschrijving ?? ''} ${c.easypayTypePrest}`.toLowerCase().includes(zoekTerm)),
    (c, k) => (k === 'code' ? c.code : k === 'type' ? c.dienstType : k === 'prest' ? c.easypayTypePrest : k === 'hd' ? (c.tik1 ?? c.tik3 ?? '') : c.code),
  );
  const verwijder = async (c: LoonCode) => {
    try { await verwijderLoonCode(c.code); setCodes((l) => l.filter((x) => x.code !== c.code)); notify(`Looncode ${c.codeWeergave} verwijderd.`, 'success'); }
    catch (err) { notify(err instanceof Error ? err.message : 'Verwijderen is mislukt.', 'error'); }
  };
  return (
    <div className="space-y-3">
      <div className="surface-table rounded-3xl overflow-clip">
        <div className="border-b border-slate-200/70 px-5 py-4 md:px-6">
          <TableToolbar
            zoek={zoek} onZoek={setZoek} placeholder="Zoek code of typenummer…" telling={`${lijst.length} van ${codes.length}`}
            filters={(<>{(['alles', 'lijn', 'varia', 'ander'] as const).map((f) => <FilterChip key={f} active={filter === f} onClick={() => setFilter(f)}>{f === 'alles' ? 'Alles' : DIENST_TYPE_LABEL[f]}</FilterChip>)}</>)}
            acties={<Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => setBewerk({ ...LEEG_CODE, nieuw: true })}>Code toevoegen</Button>}
          />
        </div>
        {isLoading && codes.length === 0 ? <div className="divide-y divide-slate-100"><SkeletonRow className="px-5 py-4" /><SkeletonRow className="px-5 py-4" /></div> : lijst.length === 0 ? (
          <div className="p-6"><EmptyState title="Geen looncodes" message={codes.length ? 'Pas de zoekterm of het filter aan.' : 'Draai de migratie met de seed of voeg codes toe.'} /></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[48rem] text-left border-collapse">
              <StickyThead>
                <tr>
                  <SortTh kolom="code" sort={sort}>Code</SortTh>
                  <SortTh kolom="type" sort={sort}>Type</SortTh>
                  <Th>Activiteit</Th>
                  <SortTh kolom="prest" sort={sort} align="right">Typeprest.</SortTh>
                  <SortTh kolom="hd" sort={sort}>Tiktijden</SortTh>
                  <Th num>Rijtijd</Th>
                  <Th>Export</Th>
                  <Th className="text-right">Acties</Th>
                </tr>
              </StickyThead>
              <tbody>
                {lijst.map((c) => (
                  <tr key={c.code} className="border-b border-slate-100 last:border-b-0 transition-colors hover:bg-surface-soft-hover">
                    <Td><p className="font-semibold text-slate-800">{c.codeWeergave}</p>{c.omschrijving && <p className="text-2xs text-slate-500">{c.omschrijving}</p>}</Td>
                    <Td className="text-sm">{DIENST_TYPE_LABEL[c.dienstType]}</Td>
                    <Td className="font-mono text-xs">{c.easypayActiviteit}</Td>
                    <Td num>{c.easypayTypePrest}</Td>
                    <Td className="font-mono text-xs">{[c.tik1, c.tik2, c.tik3, c.tik4, c.tik5, c.tik6].filter(Boolean).join(' · ') || '—'}</Td>
                    <Td num className="text-slate-600">{c.lbRijtijd ?? '—'}</Td>
                    <Td><Badge tone={c.inExport ? 'emerald' : 'slate'} stil dot>{c.inExport ? 'ja' : 'nee'}</Badge></Td>
                    <Td className="text-right">
                      <IconButton label={`${c.codeWeergave} bewerken`} size="sm" onClick={() => setBewerk({ ...c, omschrijving: c.omschrijving ?? '', tik1: c.tik1 ?? '', tik2: c.tik2 ?? '', tik3: c.tik3 ?? '', tik4: c.tik4 ?? '', tik5: c.tik5 ?? '', tik6: c.tik6 ?? '' })}><Pencil size={16} /></IconButton>
                      <IconButton label={`${c.codeWeergave} verwijderen`} size="sm" onClick={() => void verwijder(c)}><Trash2 size={16} /></IconButton>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {bewerk && <CodeModal init={bewerk} onClose={() => setBewerk(null)} onKlaar={(c) => { setCodes((l) => (l.some((x) => x.code === c.code) ? l.map((x) => (x.code === c.code ? c : x)) : [...l, c])); setBewerk(null); }} />}
    </div>
  );
}

function CodeModal({ init, onClose, onKlaar }: { init: LoonCodeBody & { code: string; nieuw?: boolean }; onClose: () => void; onKlaar: (c: LoonCode) => void }) {
  const [form, setForm] = useState(init);
  const [fouten, setFouten] = useState<Record<string, string>>({});
  const [bezig, setBezig] = useState(false);
  const zet = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));
  const getal = (s: string): number | null => (s.trim() === '' ? null : Number(s));
  const opslaan = async () => {
    setBezig(true); setFouten({});
    const code = loonCodeSleutel(form.code);
    if (!code) { setFouten({ code: 'Vul een code in' }); setBezig(false); return; }
    const { code: _c, nieuw: _n, ...body } = form;
    try { onKlaar(await bewaarLoonCode(code, { ...body, codeWeergave: body.codeWeergave.trim() || form.code.trim() })); notify('Looncode bewaard.', 'success'); }
    catch (err) { if (err instanceof LoonFout && err.veldfouten) setFouten(err.veldfouten); notify(err instanceof Error ? err.message : 'Bewaren is mislukt.', 'error'); }
    finally { setBezig(false); }
  };
  const tijd = (k: 'tik1' | 'tik2' | 'tik3' | 'tik4' | 'tik5' | 'tik6', label: string) => (
    <Field label={label} error={fouten[k]}>{({ id, invalid }) => <Input id={id} invalid={invalid} placeholder="uu:mm" value={form[k] ?? ''} onChange={(e) => zet(k, e.target.value)} />}</Field>
  );
  const minuten = (k: 'lbRijtijd' | 'lbStat100At' | 'lbStat100Nat' | 'lbStat50Nat' | 'lbOnd' | 'lbAndWrk' | 'lbNacht', label: string) => (
    <Field label={label} error={fouten[k]}>{({ id, invalid }) => <Input id={id} invalid={invalid} inputMode="numeric" value={form[k] ?? ''} onChange={(e) => zet(k, getal(e.target.value))} />}</Field>
  );
  return (
    <Modal open onClose={onClose} maxWidth="lg" ariaLabel={init.nieuw ? 'Looncode toevoegen' : `Looncode ${init.codeWeergave} bewerken`}>
      <div className="p-6">
        <CardHeader title={init.nieuw ? 'Looncode toevoegen' : `Looncode ${init.codeWeergave}`} description="Dienstnummer of afwezigheidscode zoals in de planning, met de Easypay-parameters." />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Code" required hint="Zoals in de planning: 2102, bv, ziek" error={fouten.code}>{({ id, invalid }) => <Input id={id} invalid={invalid} value={form.code} disabled={!init.nieuw} onChange={(e) => zet('code', e.target.value)} />}</Field>
          <Field label="Weergave" error={fouten.codeWeergave}>{({ id, invalid }) => <Input id={id} invalid={invalid} value={form.codeWeergave} onChange={(e) => zet('codeWeergave', e.target.value)} />}</Field>
          <Field label="Omschrijving" className="sm:col-span-2" error={fouten.omschrijving}>{({ id, invalid }) => <Input id={id} invalid={invalid} value={form.omschrijving ?? ''} onChange={(e) => zet('omschrijving', e.target.value)} />}</Field>
          <Field label="Type" error={fouten.dienstType}>{({ id }) => <Select id={id} value={form.dienstType} onChange={(e) => zet('dienstType', e.target.value as LoonCodeBody['dienstType'])}>{DIENST_TYPES.map((t) => <option key={t} value={t}>{DIENST_TYPE_LABEL[t]}</option>)}</Select>}</Field>
          <div className="flex items-end justify-between gap-3 rounded-2xl bg-surface-muted px-3.5 py-2.5"><span className="text-sm font-medium text-slate-700">In de Easypay-export</span><Switch checked={form.inExport} onChange={(v) => zet('inExport', v)} label="In de Easypay-export" /></div>
          <Field label="Easypay-activiteit" required error={fouten.easypayActiviteit}>{({ id, invalid }) => <Input id={id} invalid={invalid} value={form.easypayActiviteit} onChange={(e) => zet('easypayActiviteit', e.target.value)} />}</Field>
          <Field label="Easypay-typeprestatie" required error={fouten.easypayTypePrest}>{({ id, invalid }) => <Input id={id} invalid={invalid} inputMode="numeric" value={form.easypayTypePrest} onChange={(e) => zet('easypayTypePrest', Number(e.target.value || 0))} />}</Field>
          <div className="sm:col-span-2 grid grid-cols-3 gap-3">{tijd('tik1', 'Tiktijd 1 (begin)')}{tijd('tik2', 'Tiktijd 2')}{tijd('tik3', 'Tiktijd 3')}{tijd('tik4', 'Tiktijd 4')}{tijd('tik5', 'Tiktijd 5')}{tijd('tik6', 'Tiktijd 6 (einde)')}</div>
          <div className="sm:col-span-2 grid grid-cols-2 gap-3 md:grid-cols-4">{minuten('lbRijtijd', 'Rijtijd (min)')}{minuten('lbStat100At', 'Stat. 100% AT')}{minuten('lbStat100Nat', 'Stat. 100% NAT')}{minuten('lbStat50Nat', 'Stat. 50% NAT')}{minuten('lbOnd', 'Onderbrekingen')}{minuten('lbAndWrk', 'Ander werk')}{minuten('lbNacht', 'Nacht (min)')}</div>
        </div>
        <div className="mt-5 flex gap-3">
          <Button variant="ghost" className="flex-1" onClick={onClose}>Annuleren</Button>
          <Button variant="primary" className="flex-1" onClick={() => void opslaan()} disabled={bezig}>{bezig ? 'Bezig…' : 'Opslaan'}</Button>
        </div>
      </div>
    </Modal>
  );
}

function MedewerkersTab() {
  const [rijen, setRijen] = useState<LoonMedewerkerRij[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [zoek, setZoek] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importTekst, setImportTekst] = useState('');
  const [bezig, setBezig] = useState(false);
  const load = async () => {
    setIsLoading(true);
    try { setRijen(await laadMedewerkers()); } catch (err) { notify(err instanceof Error ? err.message : 'Kon de medewerkers niet laden.', 'error'); } finally { setIsLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const zoekTerm = zoek.trim().toLowerCase();
  const lijst = rijen.filter((r) => !zoekTerm || `${r.naam} ${r.employeeId ?? ''} ${r.easypayNr ?? ''}`.toLowerCase().includes(zoekTerm));
  const zonder = rijen.filter((r) => r.inExport && !r.easypayNr).length;
  const bewaar = async (r: LoonMedewerkerRij, body: { easypayNr: number | null; inExport: boolean }) => {
    try { const m = await bewaarMedewerker(r.userId, body); setRijen((l) => l.map((x) => (x.userId === r.userId ? { ...x, easypayNr: m.easypayNr ?? null, inExport: m.inExport } : x))); }
    catch (err) { notify(err instanceof Error ? err.message : 'Bewaren is mislukt.', 'error'); }
  };
  const importeer = async () => {
    setBezig(true);
    try { const r = await importeerMedewerkers(importTekst); notify(`${r.gekoppeld} matricules gekoppeld${r.onbekend.length ? `, niet gevonden: ${r.onbekend.join(', ')}` : ''}.`, r.onbekend.length ? 'info' : 'success'); setImportOpen(false); setImportTekst(''); await load(); }
    catch (err) { notify(err instanceof Error ? err.message : 'Importeren is mislukt.', 'error'); }
    finally { setBezig(false); }
  };
  return (
    <div className="space-y-3">
      {zonder > 0 && <Card tone="warning" padding="sm" className="text-xs text-amber-800">{zonder} {zonder === 1 ? 'chauffeur' : 'chauffeurs'} in de export zonder Easypay-matricule.</Card>}
      <div className="surface-table rounded-3xl overflow-clip">
        <div className="border-b border-slate-200/70 px-5 py-4 md:px-6">
          <TableToolbar zoek={zoek} onZoek={setZoek} placeholder="Zoek chauffeur…" telling={`${lijst.length} van ${rijen.length}`} acties={<Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>Lijst plakken</Button>} />
        </div>
        {isLoading && rijen.length === 0 ? <div className="divide-y divide-slate-100"><SkeletonRow className="px-5 py-4" /><SkeletonRow className="px-5 py-4" /></div> : (
          <table className="w-full text-left border-collapse">
            <StickyThead><tr><Th>Chauffeur</Th><Th num>Matricule</Th><Th>In export</Th></tr></StickyThead>
            <tbody>
              {lijst.map((r) => (
                <tr key={r.userId} className="border-b border-slate-100 last:border-b-0">
                  <Td><span className="inline-flex items-center gap-2 text-sm font-semibold text-slate-800"><Avatar naam={r.naam} size="sm" />{r.naam}</span>{r.employeeId && <p className="text-2xs text-slate-500">{r.employeeId}</p>}</Td>
                  <Td num>
                    <Input aria-label={`Matricule van ${r.naam}`} inputMode="numeric" defaultValue={r.easypayNr ?? ''} className="w-24 px-2 py-1 text-right text-sm" onBlur={(e) => { const n = e.target.value.trim() === '' ? null : Number(e.target.value); if (n !== (r.easypayNr ?? null) && (n === null || Number.isInteger(n))) void bewaar(r, { easypayNr: n, inExport: r.inExport }); }} />
                  </Td>
                  <Td><Switch checked={r.inExport} label={`${r.naam} in de export`} onChange={(v) => void bewaar(r, { easypayNr: r.easypayNr, inExport: v })} /></Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <Modal open={importOpen} onClose={() => setImportOpen(false)} maxWidth="md" ariaLabel="Matricules plakken">
        <div className="p-6">
          <CardHeader title="Matricules plakken" description="Eén regel per persoon: naam;matricule (uit Access of Excel). Namen worden zoals bij de planning-import gematcht, in beide volgordes." />
          <div className="mt-4"><Field label="Lijst">{({ id }) => <Textarea id={id} rows={8} value={importTekst} onChange={(e) => setImportTekst(e.target.value)} placeholder={'Janssen Jan;42\nPeeters An;43'} />}</Field></div>
          <div className="mt-5 flex gap-3">
            <Button variant="ghost" className="flex-1" onClick={() => setImportOpen(false)}>Annuleren</Button>
            <Button variant="primary" className="flex-1" onClick={() => void importeer()} disabled={bezig || !importTekst.trim()}>{bezig ? 'Bezig…' : 'Importeren'}</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
