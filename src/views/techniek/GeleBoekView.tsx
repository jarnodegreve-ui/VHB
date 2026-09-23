import { lazy, Suspense, useMemo, useState } from 'react';
import { Armchair, Bus, Car, CheckCircle2, Pencil, Phone, Plus, Printer, RotateCcw, Route, Wrench, XCircle } from 'lucide-react';
import type { User } from '../../types';
import { isStaf } from '../../types';
import { DEFECT_STATUS_LABEL, WERKTYPES, WERKTYPE_LABEL, WERK_OMSCHRIJVING_MAX, voertuigNaam, type Werktype } from '../../../shared/techniek';
import { notify, openPdfInNewTab, telHref } from '../../lib/ui';
import { useZelfLadend } from '../../lib/zelfLadend';
import { addDagen } from '../../lib/datum';
import { vandaagBrussel } from '../../lib/brussel';
import { navigeer } from '../../app/router';
import { useAppDataContext } from '../../app/AppDataContext';
import { formatDateHuman, formatRelatief } from '../../lib/format';
import { dagenTot, laadDefecten, maakWerkprestatie, TechniekFout, vandaagIso, wijzigDefect, urenTekst, type Defect } from '../../lib/techniek';
import { EmptyState, Foutkaart, PageHeader, PageShell, VersheidRegel, ViewLoader } from '../../components/ui';
import { AllesGedaan } from '../../components/illustraties';
import { Modal, SluitKnop } from '../../components/Modal';
import { Formulier } from '../../components/Formulier';
import { useVeldfouten, useVuil } from '../../lib/formulier';
import { meldSchrijffout } from '../../lib/fouten';
import { OpsStat } from '../../components/ops';
import { SkeletonRow } from '../../components/Skeleton';
import { Card, CardHeader } from '../../components/Card';
import { Avatar } from '../../components/Avatar';
import { ActieMenu } from '../../components/ActieMenu';
import { DateInput, Field, Input, Select, Textarea } from '../../components/Field';
import { Badge, Button, FilterChip, Switch, TOON_NAAR_BADGE } from '../../components/primitives';
import { DEFECT_STATUS, statusVan } from '../../../shared/status';
import { SortTh, StickyThead, TableToolbar, useSort } from '../../components/Table';
import { Td, Th } from '../../components/TabelBasis';
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
    // Grens op de Brusselse kalenderdag, niet de UTC-dag (die liep tussen 00:00
    // en 02:00 een dag achter).
    const sinds = filter === 'recent' ? addDagen(vandaagBrussel(), -RECENT_DAGEN) : undefined;
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
      meldSchrijffout('Bijwerken', err, () => void zetStatus(d, status));
    }
  };

  const werktypeBadge = (t: Werktype) => <Badge tone={WERKTYPE_TONE[t]} stil className="whitespace-nowrap">{WERKTYPE_LABEL[t]}</Badge>;
  // Label en toon uit DEFECT_STATUS; de ouderdom (rood na 14 dagen, aantal
  // dagen achter "Open") is een signaal bóven op de status.
  const statusBadge = (d: Defect) => {
    const s = statusVan(DEFECT_STATUS, d.status);
    const open = d.status === 'open';
    return (
      <Badge tone={open && ouderdom(d) > 14 ? 'red' : TOON_NAAR_BADGE[s.toon]} stil={!open} dot className="whitespace-nowrap">
        {open ? `${s.label}, ${ouderdom(d)} d` : s.label}
      </Badge>
    );
  };
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
        view="defecten"
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
        <Card padding="none" className="divide-y divide-hairline-subtle overflow-hidden" role="status" aria-busy="true" aria-label="Gele boek wordt geladen">
          <SkeletonRow className="px-5 py-4" /><SkeletonRow className="px-5 py-4" /><SkeletonRow className="px-5 py-4" />
        </Card>
      ) : (
        <div className="surface-table rounded-3xl overflow-clip">
          <div className="border-b border-hairline px-5 py-4 md:px-6">
            <TableToolbar
              rand="kaart"
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
                          <p className="font-semibold text-slate-800 whitespace-nowrap">{d.busnr}</p>
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
  const fouten = useVeldfouten();
  const { vuil } = useVuil({ datum, werk, manuren, alsPrestatie });

  const opslaan = async () => {
    if (bezig) return;
    fouten.wis();
    const uren = manuren.trim() === '' ? null : Number(manuren.replace(',', '.'));
    if (uren !== null && (!Number.isFinite(uren) || uren < 0)) { fouten.zet({ manuren: 'Vul een getal in.' }); return; }
    setBezig(true);
    try {
      const d = await wijzigDefect(defect.id, { status: 'uitgevoerd', uitgevoerdOp: datum, uitgevoerdWerk: werk.trim() || null, manuren: uren });
      if (alsPrestatie && uren && uren > 0) {
        try {
          await maakWerkprestatie({ datum, vehicleId: defect.vehicleId, werkcode: 'H', omschrijving: werk.trim() || defect.omschrijving, werkuren: uren, defectId: defect.id, beginTijd: null, eindeTijd: null, kmstand: null });
        } catch {
          notify('Melding afgehandeld, maar de werkprestatie kon niet aangemaakt worden. Voeg ze toe via Werkprestaties.', 'error');
        }
      }
      notify(`${voertuigNaam(defect)}: melding afgehandeld.`, 'success');
      onKlaar(d);
    } catch (err) {
      // Veldfouten bij het veld, de rest één toast met vervolgstap. Geen
      // "Opnieuw proberen": afhandelen maakt mogelijk ook een werkprestatie aan.
      if (err instanceof TechniekFout && err.veldfouten) fouten.zet(err.veldfouten);
      else meldSchrijffout('Afhandelen', err);
    } finally {
      setBezig(false);
    }
  };

  return (
    <Modal open onClose={onClose} vuil={vuil} maxWidth="md" ariaLabel={`Melding afhandelen, ${voertuigNaam(defect)}`}>
      <Formulier onVerstuur={opslaan} noValidate className="p-6">
        <CardHeader title={`${voertuigNaam(defect)}: uitgevoerd`} description={defect.omschrijving} />
        <div className="mt-4 space-y-3">
          <Field label="Uitgevoerd op" required error={fouten.fouten.uitgevoerdOp}>
            <DateInput value={datum} onChange={(v) => { setDatum(v); fouten.wisVeld('uitgevoerdOp'); }} />
          </Field>
          <Field label="Wat is er gedaan?" error={fouten.fouten.uitgevoerdWerk}>
            <Textarea value={werk} rows={3} maxLength={WERK_OMSCHRIJVING_MAX} onChange={(e) => { setWerk(e.target.value); fouten.wisVeld('uitgevoerdWerk'); }} placeholder="Bijvoorbeeld: bel vervangen, kabel hersteld" />
          </Field>
          <Field label="Manuren" hint="Bijvoorbeeld 1,5" error={fouten.fouten.manuren}>
            <Input inputMode="decimal" value={manuren} onChange={(e) => { setManuren(e.target.value); fouten.wisVeld('manuren'); }} className="max-w-[8rem]" />
          </Field>
          <div className="flex items-center justify-between gap-3 rounded-2xl bg-surface-muted px-3.5 py-2.5">
            <span className="text-sm font-medium text-slate-700">Ook als werkprestatie registreren</span>
            <Switch checked={alsPrestatie} onChange={setAlsPrestatie} label="Ook als werkprestatie registreren" />
          </div>
        </div>
        <div className="mt-5 flex gap-3">
          <SluitKnop onClose={onClose} variant="ghost" className="flex-1" disabled={bezig}>Annuleren</SluitKnop>
          <Button type="submit" variant="primary" className="flex-1" bezig={bezig}>Afhandelen</Button>
        </div>
      </Formulier>
    </Modal>
  );
}

function BewerkModal({ defect, onClose, onKlaar }: { defect: Defect; onClose: () => void; onKlaar: (d: Defect) => void }) {
  const [werktype, setWerktype] = useState<Werktype>(defect.werktype);
  const [omschrijving, setOmschrijving] = useState(defect.omschrijving);
  const [opmerking, setOpmerking] = useState(defect.opmerking ?? '');
  const [bezig, setBezig] = useState(false);
  const fouten = useVeldfouten();
  const { vuil } = useVuil({ werktype, omschrijving, opmerking });
  const opslaan = async () => {
    if (bezig) return;
    fouten.wis();
    setBezig(true);
    try {
      const d = await wijzigDefect(defect.id, { werktype, omschrijving: omschrijving.trim(), opmerking: opmerking.trim() || null });
      notify('Melding bijgewerkt.', 'success');
      onKlaar(d);
    } catch (err) {
      if (err instanceof TechniekFout && err.veldfouten) fouten.zet(err.veldfouten);
      else meldSchrijffout('Opslaan', err, () => void opslaan());
    } finally {
      setBezig(false);
    }
  };
  return (
    <Modal open onClose={onClose} vuil={vuil} maxWidth="md" ariaLabel={`Melding bewerken, ${voertuigNaam(defect)}`}>
      <Formulier onVerstuur={opslaan} noValidate className="p-6">
        <CardHeader title={`${voertuigNaam(defect)}: melding bewerken`} />
        <div className="mt-4 space-y-3">
          <Field label="Soort" error={fouten.fouten.werktype}>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Soort">
              {WERKTYPES.map((t) => <FilterChip key={t} active={werktype === t} onClick={() => setWerktype(t)}>{WERKTYPE_LABEL[t]}</FilterChip>)}
            </div>
          </Field>
          <Field label="Melding" required error={fouten.fouten.omschrijving}>
            <Textarea value={omschrijving} rows={4} onChange={(e) => { setOmschrijving(e.target.value); fouten.wisVeld('omschrijving'); }} />
          </Field>
          <Field label="Opmerking garage" error={fouten.fouten.opmerking}>
            <Input value={opmerking} maxLength={300} onChange={(e) => { setOpmerking(e.target.value); fouten.wisVeld('opmerking'); }} placeholder="Bijvoorbeeld: stuk besteld, wacht op levering" />
          </Field>
        </div>
        <div className="mt-5 flex gap-3">
          <SluitKnop onClose={onClose} variant="ghost" className="flex-1" disabled={bezig}>Annuleren</SluitKnop>
          <Button type="submit" variant="primary" className="flex-1" bezig={bezig}>Opslaan</Button>
        </div>
      </Formulier>
    </Modal>
  );
}
