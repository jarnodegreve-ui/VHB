import { lazy, Suspense, useMemo, useState } from 'react';
import { Armchair, Bus, Car, CheckCircle2, Pencil, Phone, Plus, Printer, RotateCcw, Route, Wrench, XCircle } from 'lucide-react';
import type { User } from '../../types';
import { isStaf } from '../../types';
import { DEFECT_STATUS_LABEL, WERKTYPES, WERKTYPE_LABEL, WERK_OMSCHRIJVING_MAX, voertuigNaam, type Werktype } from '../../../shared/techniek';
import { notify, openPdfInNewTab, telHref } from '../../lib/ui';
import { useZelfLadend } from '../../lib/zelfLadend';
import { navigeer } from '../../app/router';
import { useAppDataContext } from '../../app/AppDataContext';
import { formatDateHuman, formatRelatief } from '../../lib/format';
import { dagenTot, laadDefecten, maakWerkprestatie, TechniekFout, vandaagIso, wijzigDefect, urenTekst, type Defect } from '../../lib/techniek';
import { EmptyState, Foutkaart, PageHeader, PageShell, VersheidRegel, ViewLoader } from '../../components/ui';
import { AllesGedaan } from '../../components/illustraties';
import { Modal } from '../../components/Modal';
import { OpsStat } from '../../components/ops';
import { SkeletonRow } from '../../components/Skeleton';
import { Card, CardHeader } from '../../components/Card';
import { Avatar } from '../../components/Avatar';
import { ActieMenu } from '../../components/ActieMenu';
import { DateInput, Field, Input, Select, Textarea } from '../../components/Field';
import { Badge, Button, FilterChip, Switch, Td, Th } from '../../components/primitives';
import { SortTh, StickyThead, TableToolbar, useSort } from '../../components/Table';
import type { ActieMenuItem } from '../../components/ActieMenu';

const LazyDefectMeldenModal = lazy(() => import('../../components/DefectMeldenModal').then((m) => ({ default: m.DefectMeldenModal })));

type Filter = 'open' | 'recent' | 'alles';
const RECENT_DAGEN = 62;

const WERKTYPE_TONE: Record<Werktype, 'red' | 'amber' | 'blue' | 'oker'> = { T: 'red', C: 'amber', I: 'blue', L: 'oker' };
const WERKTYPE_ICOON: Record<Werktype, typeof Wrench> = { T: Wrench, I: Armchair, C: Car, L: Route };

/**
 * De gele boek (fase A Access-migratie, 13-09): alle gemelde defecten per
 * bus, standaard alleen de open meldingen (het Access-rapport "Aangevraagde
 * werken"), met de ouderdom en de opvolging. De technieker zet een melding op
 * uitgevoerd (datum, wat er gedaan is, manuren) en kan meteen een
 * werkprestatie laten aanmaken. Self-fetching via useZelfLadend (laad, fout,
 * focus-refresh, versheid; geen realtime: twee techniekers).
 */
export function GeleBoekView({ currentUser }: { currentUser: User }) {
  // Telefoonnummer van de melder voor "Melder bellen"; ontbreekt het, dan
  // ontbreekt het menu-item.
  const { users } = useAppDataContext();
  const [rijen, setRijen] = useState<Defect[]>([]);
  const [filter, setFilter] = useState<Filter>('open');
  // Vervolg op de tegel "Ouder dan 14 dagen": alleen die meldingen tonen.
  const [alleenOud, setAlleenOud] = useState(false);
  const [zoek, setZoek] = useState('');
  const [busFilter, setBusFilter] = useState('');
  // Vervolg op de categorietegels (Jarno 17-09): alleen die soort tonen.
  const [soortFilter, setSoortFilter] = useState<Werktype | null>(null);
  const [melden, setMelden] = useState(false);
  const [afhandelen, setAfhandelen] = useState<Defect | null>(null);
  const [bewerken, setBewerken] = useState<Defect | null>(null);
  const sort = useSort<string>('gemeld', 'desc');

  const zl = useZelfLadend(async () => {
    const sinds = filter === 'recent' ? new Date(Date.now() - RECENT_DAGEN * 864e5).toISOString().slice(0, 10) : undefined;
    setRijen(await laadDefecten({ status: filter === 'open' ? 'open' : 'alles', sinds, limit: filter === 'alles' ? 2000 : 1000 }));
  }, { deps: [filter], boodschap: 'Probeer het over enkele ogenblikken opnieuw.' });

  const vandaag = vandaagIso();
  const ouderdom = (d: Defect) => -dagenTot(d.gemeldOp.slice(0, 10), vandaag);

  const bussen = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rijen) m.set(r.vehicleId, r.busnr);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], 'nl', { numeric: true }));
  }, [rijen]);

  const tellers = useMemo(() => {
    const open = rijen.filter((r) => r.status === 'open');
    return Object.fromEntries(WERKTYPES.map((t) => {
      const vanSoort = open.filter((r) => r.werktype === t);
      return [t, { open: vanSoort.length, oud: vanSoort.filter((r) => ouderdom(r) > 14).length }];
    })) as Record<Werktype, { open: number; oud: number }>;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rijen, vandaag]);

  const zoekTerm = zoek.trim().toLowerCase();
  const gefilterd = rijen
    .filter((r) => !alleenOud || (r.status === 'open' && ouderdom(r) > 14))
    .filter((r) => !busFilter || r.vehicleId === busFilter)
    .filter((r) => !soortFilter || r.werktype === soortFilter)
    .filter((r) => !zoekTerm || `${voertuigNaam(r)} ${r.busnr} ${r.omschrijving} ${r.gemeldDoorNaam ?? ''} ${r.uitgevoerdWerk ?? ''}`.toLowerCase().includes(zoekTerm));
  const gesorteerd = sort.sorteer(gefilterd, (r, k) => {
    if (k === 'bus') return r.busnr;
    if (k === 'soort') return r.werktype;
    if (k === 'melder') return r.gemeldDoorNaam ?? '';
    if (k === 'status') return r.status;
    return r.gemeldOp;
  });

  const vervang = (d: Defect) => setRijen((lijst) => lijst.map((r) => (r.id === d.id ? d : r)));

  const zetStatus = async (d: Defect, status: Defect['status']) => {
    try {
      const nieuw = await wijzigDefect(d.id, { status });
      vervang(nieuw);
      notify(status === 'open' ? 'Melding staat weer open.' : `Melding ${DEFECT_STATUS_LABEL[status].toLowerCase()}.`, 'success');
      if (filter === 'open' && status !== 'open') setRijen((lijst) => lijst.filter((r) => r.id !== d.id));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Bijwerken is mislukt.', 'error');
    }
  };

  const werktypeBadge = (t: Werktype) => <Badge tone={WERKTYPE_TONE[t]} stil className="whitespace-nowrap">{WERKTYPE_LABEL[t]}</Badge>;
  const statusBadge = (d: Defect) => (
    <Badge tone={d.status === 'open' ? (ouderdom(d) > 14 ? 'red' : 'amber') : d.status === 'uitgevoerd' ? 'emerald' : 'slate'} stil={d.status !== 'open'} dot className="whitespace-nowrap">
      {d.status === 'open' ? `Open, ${ouderdom(d)} d` : DEFECT_STATUS_LABEL[d.status]}
    </Badge>
  );
  const acties = (d: Defect): ActieMenuItem[] => {
    const items: ActieMenuItem[] = [];
    if (d.status === 'open') {
      items.push({ label: 'Uitgevoerd', icon: <CheckCircle2 size={16} />, onClick: () => setAfhandelen(d) });
      items.push({ label: 'Bewerken', icon: <Pencil size={16} />, onClick: () => setBewerken(d) });
      // Uitweg bij een melding die blijft liggen: de melder bellen (nummer
      // uit de gebruikerslijst) of de voertuigfiche openen; geen wachtstatus
      // of toewijzing (vervolg, vraagt een schemawijziging).
      const tel = telHref(users.find((u) => String(u.id) === String(d.gemeldDoor))?.phone);
      if (tel) items.push({ label: 'Melder bellen', icon: <Phone size={16} />, onClick: () => { window.location.href = tel; }, scheiding: true });
      items.push({ label: 'Open bus', icon: <Bus size={16} />, onClick: () => navigeer('voertuigen', { params: [d.vehicleId] }), scheiding: !tel });
      items.push({ label: 'Annuleren', icon: <XCircle size={16} />, onClick: () => void zetStatus(d, 'geannuleerd'), gevaarlijk: true, scheiding: true });
    } else {
      items.push({ label: 'Opnieuw openen', icon: <RotateCcw size={16} />, onClick: () => void zetStatus(d, 'open') });
    }
    return items;
  };

  return (
    <PageShell>
      <PageHeader
        eyebrow="Techniek"
        title="Gele boek"
        actions={(
          <>
            <VersheidRegel {...zl.versheid} />
            {/* Papieren gele boek voor de ISO-map (Jarno 13-09): print van het huidige filter, in een nieuw tabblad. */}
            <Button variant="secondary" icon={<Printer size={16} />} onClick={() => openPdfInNewTab(`${window.location.origin}${window.location.pathname}?print-gele-boek=${filter === 'open' ? 'open' : 'alles'}`)}>Afdrukken</Button>
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setMelden(true)}>Melding toevoegen</Button>
          </>
        )}
      />

      {zl.fout && rijen.length > 0 && <Foutkaart compact boodschap={zl.fout} offline={!zl.online} onOpnieuw={zl.opnieuw} bezig={zl.laden} />}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {/* Eén tegel per categorie met het aantal open meldingen (Jarno 17-09); klikken filtert de lijst op die soort. */}
        {WERKTYPES.map((t) => {
          const { open, oud } = tellers[t];
          const Icoon = WERKTYPE_ICOON[t];
          return (
            <OpsStat
              key={t}
              icon={<Icoon size={16} />}
              tone={open > 0 ? WERKTYPE_TONE[t] : 'slate'}
              label={WERKTYPE_LABEL[t]}
              value={open}
              sub={open === 0 ? 'niets open' : oud > 0 ? `open, ${oud} ouder dan 14 dagen` : 'open'}
              onClick={() => setSoortFilter((v) => (v === t ? null : t))}
              actief={soortFilter === t}
            />
          );
        })}
      </div>

      {zl.fout && rijen.length === 0 ? (
        <Foutkaart titel="De gele boek kon niet laden" boodschap={zl.fout} offline={!zl.online} onOpnieuw={zl.opnieuw} bezig={zl.laden} />
      ) : zl.laden && rijen.length === 0 ? (
        <Card padding="none" className="divide-y divide-hairline-subtle overflow-hidden" aria-busy="true" aria-label="Gele boek wordt geladen">
          <SkeletonRow className="px-5 py-4" /><SkeletonRow className="px-5 py-4" /><SkeletonRow className="px-5 py-4" />
        </Card>
      ) : (
        <div className="surface-table rounded-3xl overflow-clip">
          <div className="border-b border-hairline px-5 py-4 md:px-6">
            <TableToolbar
              zoek={zoek}
              onZoek={setZoek}
              placeholder="Zoek bus, tekst of melder…"
              telling={`${gesorteerd.length} van ${rijen.length}`}
              filters={(
                <>
                  <FilterChip active={filter === 'open' && !alleenOud} onClick={() => { setFilter('open'); setAlleenOud(false); }}>Open</FilterChip>
                  <FilterChip active={alleenOud} onClick={() => { setFilter('open'); setAlleenOud((v) => !v); }}>Ouder dan 14 dagen</FilterChip>
                  <FilterChip active={filter === 'recent'} onClick={() => { setFilter('recent'); setAlleenOud(false); }}>Laatste {RECENT_DAGEN} dagen</FilterChip>
                  <FilterChip active={filter === 'alles'} onClick={() => { setFilter('alles'); setAlleenOud(false); }}>Alles</FilterChip>
                  <Select aria-label="Bus" value={busFilter} onChange={(e) => setBusFilter(e.target.value)} className="min-w-0 px-2.5 py-1.5 text-xs">
                    <option value="">Alle bussen</option>
                    {bussen.map(([id, naam]) => <option key={id} value={id}>{naam}</option>)}
                  </Select>
                </>
              )}
            />
          </div>

          {gesorteerd.length === 0 ? (
            <div className="p-6">
              <EmptyState
                variant="klaar"
                illustratie={filter === 'open' && !alleenOud && !zoekTerm && !busFilter && !soortFilter ? <AllesGedaan /> : undefined}
                title={zoekTerm ? `Geen meldingen voor “${zoek.trim()}”` : alleenOud ? 'Niets blijft liggen' : soortFilter ? `Niets in ${WERKTYPE_LABEL[soortFilter].toLowerCase()}` : filter === 'open' ? 'Niets open in de gele boek' : 'Geen meldingen voor dit filter'}
                message={alleenOud && !zoekTerm ? 'Geen open melding is ouder dan 14 dagen.' : filter === 'open' && !zoekTerm ? 'Alle gemelde defecten zijn afgehandeld.' : 'Pas de zoekterm of het filter aan.'}
                action={<Button variant="secondary" icon={<Plus size={16} />} onClick={() => setMelden(true)}>Melding toevoegen</Button>}
              />
            </div>
          ) : (
            <>
              <div className="hidden md:block">
                <table className="w-full text-left border-collapse">
                  <StickyThead>
                    <tr>
                      <SortTh kolom="bus" sort={sort}>Bus</SortTh>
                      <SortTh kolom="soort" sort={sort}>Soort</SortTh>
                      <Th>Melding</Th>
                      <SortTh kolom="melder" sort={sort}>Gemeld door</SortTh>
                      <SortTh kolom="gemeld" sort={sort}>Gemeld</SortTh>
                      <SortTh kolom="status" sort={sort}>Status</SortTh>
                      <Th className="text-right">Acties</Th>
                    </tr>
                  </StickyThead>
                  <tbody>
                    {gesorteerd.map((d) => (
                      <tr key={d.id} className="border-b border-hairline-subtle last:border-b-0 align-top transition-colors hover:bg-surface-soft-hover">
                        <Td>
                          {/* Volledig busnummer in de lijst, niet "Bus 38" (Jarno 17-09). */}
                          <p className="font-semibold text-slate-800">{d.busnr}</p>
                        </Td>
                        <Td>{werktypeBadge(d.werktype)}</Td>
                        <Td className="max-w-md">
                          <p className="whitespace-pre-wrap text-sm text-slate-800">{d.omschrijving}</p>
                          {d.status === 'uitgevoerd' && (d.uitgevoerdWerk || d.uitgevoerdOp) && (
                            <p className="mt-1 text-xs text-emerald-700">
                              {d.uitgevoerdOp ? `${formatDateHuman(d.uitgevoerdOp)}${d.uitgevoerdDoorNaam ? `, ${d.uitgevoerdDoorNaam}` : ''}` : ''}{d.uitgevoerdWerk ? `: ${d.uitgevoerdWerk}` : ''}{d.manuren ? ` (${urenTekst(d.manuren)} u)` : ''}
                            </p>
                          )}
                        </Td>
                        <Td>
                          <span className="inline-flex items-center gap-2 text-sm text-slate-700"><Avatar naam={d.gemeldDoorNaam ?? '?'} size="sm" />{d.gemeldDoorNaam ?? 'onbekend'}</span>
                        </Td>
                        <Td className="whitespace-nowrap text-xs text-slate-600" ><span title={formatDateHuman(d.gemeldOp.slice(0, 10))}>{formatRelatief(d.gemeldOp)}</span></Td>
                        <Td>{statusBadge(d)}</Td>
                        <Td className="text-right"><ActieMenu size="sm" items={acties(d)} /></Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="md:hidden divide-y divide-hairline-subtle">
                {gesorteerd.map((d) => (
                  <li key={d.id} className="flex items-start gap-3 px-5 py-3.5">
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="text-sm font-semibold text-slate-800">{d.busnr}</p>
                        {werktypeBadge(d.werktype)}
                        {statusBadge(d)}
                      </div>
                      <p className="whitespace-pre-wrap text-sm text-slate-700">{d.omschrijving}</p>
                      <p className="text-xs text-slate-500">{d.gemeldDoorNaam ?? 'onbekend'} · {formatRelatief(d.gemeldOp)}</p>
                      {d.status === 'uitgevoerd' && d.uitgevoerdWerk && <p className="text-xs text-emerald-700">{d.uitgevoerdWerk}</p>}
                    </div>
                    <ActieMenu size="sm" items={acties(d)} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      {afhandelen && (
        <AfhandelModal
          defect={afhandelen}
          currentUser={currentUser}
          onClose={() => setAfhandelen(null)}
          onKlaar={(d) => { vervang(d); if (filter === 'open') setRijen((lijst) => lijst.filter((r) => r.id !== d.id)); setAfhandelen(null); }}
        />
      )}
      {bewerken && <BewerkModal defect={bewerken} onClose={() => setBewerken(null)} onKlaar={(d) => { vervang(d); setBewerken(null); }} />}
      {melden && (
        <Suspense fallback={<ViewLoader />}>
          <LazyDefectMeldenModal open onClose={() => setMelden(false)} currentUser={currentUser} onGemeld={() => void zl.ververs()} />
        </Suspense>
      )}
    </PageShell>
  );
}

/** "Uitgevoerd": datum, wat er gedaan is, manuren en optioneel meteen een werkprestatie (werkcode H). */
function AfhandelModal({ defect, currentUser, onClose, onKlaar }: { defect: Defect; currentUser: User; onClose: () => void; onKlaar: (d: Defect) => void }) {
  const [datum, setDatum] = useState(vandaagIso());
  const [werk, setWerk] = useState('');
  const [manuren, setManuren] = useState('');
  const [alsPrestatie, setAlsPrestatie] = useState(!isStaf(currentUser.role));
  const [bezig, setBezig] = useState(false);
  const [fouten, setFouten] = useState<Record<string, string>>({});

  const opslaan = async () => {
    if (bezig) return;
    setBezig(true);
    setFouten({});
    const uren = manuren.trim() === '' ? null : Number(manuren.replace(',', '.'));
    if (uren !== null && (!Number.isFinite(uren) || uren < 0)) { setFouten({ manuren: 'Vul een getal in' }); setBezig(false); return; }
    try {
      const d = await wijzigDefect(defect.id, { status: 'uitgevoerd', uitgevoerdOp: datum, uitgevoerdWerk: werk.trim() || null, manuren: uren });
      if (alsPrestatie && uren && uren > 0) {
        try {
          await maakWerkprestatie({ datum, vehicleId: defect.vehicleId, werkcode: 'H', omschrijving: werk.trim() || defect.omschrijving, werkuren: uren, defectId: defect.id, beginTijd: null, eindeTijd: null, kmstand: null });
        } catch {
          notify('Melding afgehandeld, maar de werkprestatie kon niet aangemaakt worden.', 'error');
        }
      }
      notify(`${voertuigNaam(defect)}: melding afgehandeld.`, 'success');
      onKlaar(d);
    } catch (err) {
      if (err instanceof TechniekFout && err.veldfouten) setFouten(err.veldfouten);
      notify(err instanceof Error ? err.message : 'Afhandelen is mislukt.', 'error');
    } finally {
      setBezig(false);
    }
  };

  return (
    <Modal open onClose={onClose} maxWidth="md" ariaLabel={`Melding afhandelen, ${voertuigNaam(defect)}`}>
      <div className="p-6">
        <CardHeader title={`${voertuigNaam(defect)}: uitgevoerd`} description={defect.omschrijving} />
        <div className="mt-4 space-y-3">
          <Field label="Uitgevoerd op" required error={fouten.uitgevoerdOp}>{({ id }) => <DateInput id={id} value={datum} onChange={setDatum} />}</Field>
          <Field label="Wat is er gedaan?" error={fouten.uitgevoerdWerk}>
            {({ id, invalid }) => <Textarea id={id} invalid={invalid} value={werk} rows={3} maxLength={WERK_OMSCHRIJVING_MAX} onChange={(e) => setWerk(e.target.value)} placeholder="Bijvoorbeeld: bel vervangen, kabel hersteld" />}
          </Field>
          <Field label="Manuren" hint="Bijvoorbeeld 1,5" error={fouten.manuren}>
            {({ id, invalid }) => <Input id={id} invalid={invalid} inputMode="decimal" value={manuren} onChange={(e) => setManuren(e.target.value)} className="max-w-[8rem]" />}
          </Field>
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface-muted px-3.5 py-2.5">
            <span className="text-sm font-medium text-slate-700">Ook als werkprestatie registreren</span>
            <Switch checked={alsPrestatie} onChange={setAlsPrestatie} label="Ook als werkprestatie registreren" />
          </div>
        </div>
        <div className="mt-5 flex gap-3">
          <Button variant="ghost" className="flex-1" onClick={onClose}>Annuleren</Button>
          <Button variant="primary" className="flex-1" onClick={() => void opslaan()} disabled={bezig}>{bezig ? 'Bezig…' : 'Afhandelen'}</Button>
        </div>
      </div>
    </Modal>
  );
}

function BewerkModal({ defect, onClose, onKlaar }: { defect: Defect; onClose: () => void; onKlaar: (d: Defect) => void }) {
  const [werktype, setWerktype] = useState<Werktype>(defect.werktype);
  const [omschrijving, setOmschrijving] = useState(defect.omschrijving);
  const [opmerking, setOpmerking] = useState(defect.opmerking ?? '');
  const [bezig, setBezig] = useState(false);
  const [fouten, setFouten] = useState<Record<string, string>>({});
  const opslaan = async () => {
    if (bezig) return;
    setBezig(true);
    try {
      const d = await wijzigDefect(defect.id, { werktype, omschrijving: omschrijving.trim(), opmerking: opmerking.trim() || null });
      notify('Melding bijgewerkt.', 'success');
      onKlaar(d);
    } catch (err) {
      if (err instanceof TechniekFout && err.veldfouten) setFouten(err.veldfouten);
      notify(err instanceof Error ? err.message : 'Bewaren is mislukt.', 'error');
    } finally {
      setBezig(false);
    }
  };
  return (
    <Modal open onClose={onClose} maxWidth="md" ariaLabel={`Melding bewerken, ${voertuigNaam(defect)}`}>
      <div className="p-6">
        <CardHeader title={`${voertuigNaam(defect)}: melding bewerken`} />
        <div className="mt-4 space-y-3">
          <Field label="Soort">
            <div className="flex flex-wrap gap-2" role="group" aria-label="Soort">
              {WERKTYPES.map((t) => <FilterChip key={t} active={werktype === t} onClick={() => setWerktype(t)}>{WERKTYPE_LABEL[t]}</FilterChip>)}
            </div>
          </Field>
          <Field label="Melding" required error={fouten.omschrijving}>
            {({ id, invalid }) => <Textarea id={id} invalid={invalid} value={omschrijving} rows={4} onChange={(e) => setOmschrijving(e.target.value)} />}
          </Field>
          <Field label="Opmerking garage" error={fouten.opmerking}>
            {({ id, invalid }) => <Input id={id} invalid={invalid} value={opmerking} maxLength={300} onChange={(e) => setOpmerking(e.target.value)} placeholder="Bijvoorbeeld: stuk besteld, wacht op levering" />}
          </Field>
        </div>
        <div className="mt-5 flex gap-3">
          <Button variant="ghost" className="flex-1" onClick={onClose}>Annuleren</Button>
          <Button variant="primary" className="flex-1" onClick={() => void opslaan()} disabled={bezig}>{bezig ? 'Bezig…' : 'Opslaan'}</Button>
        </div>
      </div>
    </Modal>
  );
}
