import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { BarChart3, CalendarDays, ChevronLeft, ChevronRight, Clock, ClipboardList, Pencil, Plus, Trash2 } from 'lucide-react';
import type { User } from '../../types';
import { isStaf } from '../../types';
import { WERKCODES, WERKCODE_LABEL, WERK_OMSCHRIJVING_MAX, voertuigNaam, type Werkcode } from '../../../shared/techniek';
import { cn, notify } from '../../lib/ui';
import { useZelfLadend } from '../../lib/zelfLadend';
import { formatDayLong, formatShortDay } from '../../lib/format';
import { metOngedaan } from '../../lib/ongedaan';
import {
  bewaarWerkprestatie, laadVoertuigen, laadWerkRapport, laadWerkprestaties, maakWerkprestatie, TechniekFout, urenMetEenheid, urenTekst, urenTussen,
  vandaagIso, verwijderWerkprestatie, type Vehicle, type WerkRapport, type Werkprestatie, type WerkprestatieBody,
} from '../../lib/techniek';
import { EmptyState, Foutkaart, PageHeader, PageShell, VersheidRegel } from '../../components/ui';
import { LegeLijst } from '../../components/illustraties';
import { Modal, SluitKnop } from '../../components/Modal';
import { Formulier } from '../../components/Formulier';
import { useVeldfouten, useVuil } from '../../lib/formulier';
import { meldSchrijffout } from '../../lib/fouten';
import { OpsStat } from '../../components/ops';
import { SkeletonRow } from '../../components/Skeleton';
import { Card, CardHeader } from '../../components/Card';
import { Avatar } from '../../components/Avatar';
import { DateInput, Field, Input, Select, Textarea } from '../../components/Field';
import { Badge, Button, Chip, FilterChip, IconButton, Segmented } from '../../components/primitives';
import { StickyThead } from '../../components/Table';
import { Td, Th, Tabel, TableShell } from '../../components/TabelBasis';

type Tab = 'lijst' | 'rapport';
type Periode = 'week' | 'maand' | 'kwartaal';

/** ISO-dag n dagen verder (negatief = terug). */
const schuifDag = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** De prestatie terug als body, om hem na een undo opnieuw aan te maken. */
const prestatieBody = (w: Werkprestatie): WerkprestatieBody => ({
  datum: w.datum, vehicleId: w.vehicleId ?? null, werkcode: w.werkcode, omschrijving: w.omschrijving,
  beginTijd: w.beginTijd ?? null, eindeTijd: w.eindeTijd ?? null, werkuren: w.werkuren,
  kmstand: w.kmstand ?? null, defectId: w.defectId ?? null, mecanicienId: w.mecanicienId,
});

const busLabel = (w: Werkprestatie) => (w.vehicleId ? voertuigNaam({ busnr: w.busnr ?? '', kortNr: w.kortNr }) : 'Garage / algemeen');

/** Chronologisch binnen een dag: begintijd eerst, anders volgorde van registreren. */
const opTijd = (a: Werkprestatie, b: Werkprestatie) =>
  (a.beginTijd ?? '99:99').localeCompare(b.beginTijd ?? '99:99') || (a.createdAt ?? '').localeCompare(b.createdAt ?? '');

/**
 * Dagadministratie (fase A Access-migratie, 13-09): wat de garage per dag aan
 * welke bus deed, met werkcode en bestede uren (tblUtgevoerdeWerken). De
 * route en de API heten nog werkprestaties, dat is de naam van het record.
 *
 * Twee schermen achter één route (Jarno 18-09):
 * - technieker: een dagboek. Eén dag tegelijk, taken ingeven, terug naar
 *   vorige dagen bladeren en een eigen taak rechtzetten. Geen cijfers, geen
 *   periodelijst en geen rapport: die horen bij het opvolgen, niet bij het
 *   ingeven.
 * - staf: het volledige overzicht (periodes, filter per technieker, de drie
 *   Access-kruistabellen) over alle techniekers heen.
 */
export function WerkprestatiesView({ currentUser, users }: { currentUser: User; users: User[] }) {
  const staf = isStaf(currentUser.role);
  const techniekers = useMemo(
    () => users.filter((u) => (u.role === 'technieker' || (staf && isStaf(u.role))) && u.isActive !== false).sort((a, b) => a.name.localeCompare(b.name, 'nl')),
    [users, staf],
  );
  return staf
    ? <StafOverzicht currentUser={currentUser} techniekers={techniekers} />
    : <Dagboek currentUser={currentUser} />;
}

/** Het dagboek van één technieker: per dag ingeven, terugbladeren, rechtzetten. */
function Dagboek({ currentUser }: { currentUser: User }) {
  const vandaag = vandaagIso();
  const [datum, setDatum] = useState(vandaag);
  const [rijen, setRijen] = useState<Werkprestatie[]>([]);
  const [voertuigen, setVoertuigen] = useState<Vehicle[]>([]);
  const [bewerk, setBewerk] = useState<{ prestatie: Werkprestatie | null } | null>(null);

  const zl = useZelfLadend(async () => {
    const [w, v] = await Promise.all([laadWerkprestaties({ van: datum, tot: datum, limit: 200 }), laadVoertuigen()]);
    setRijen([...w].sort(opTijd));
    setVoertuigen(v);
  }, { deps: [datum], boodschap: (err) => (err instanceof Error && err.message ? err.message : 'Kon je werkprestaties niet laden.') });

  const totaalUren = rijen.reduce((s, w) => s + w.werkuren, 0);
  const isVandaag = datum === vandaag;
  const legeStaat = rijen.length === 0 && !zl.laden && !zl.fout;
  const toevoegen = <Button variant="primary" icon={<Plus size={16} />} onClick={() => setBewerk({ prestatie: null })}>Taak toevoegen</Button>;

  /** Een gewijzigde taak die naar een andere dag verhuist, verlaat deze dag. */
  const naOpslaan = (w: Werkprestatie) => {
    if (w.datum !== datum) { setDatum(w.datum); return; }
    setRijen((lijst) => (lijst.some((x) => x.id === w.id) ? lijst.map((x) => (x.id === w.id ? w : x)) : [...lijst, w]).sort(opTijd));
  };

  const verwijderen = (w: Werkprestatie) => {
    void metOngedaan({
      boodschap: 'Taak verwijderd.',
      uitvoeren: async () => { await verwijderWerkprestatie(w.id); setRijen((lijst) => lijst.filter((x) => x.id !== w.id)); },
      herstellen: async () => { const terug = await maakWerkprestatie(prestatieBody(w)); naOpslaan(terug); },
      toast: (message, tone, action, opties) => notify(message, tone, { action, opties }),
    });
  };

  return (
    <PageShell>
      <PageHeader
        view="werkprestaties"
        title="Werkprestaties"
        actions={(
          <>
            <VersheidRegel {...zl.versheid} />
            {!legeStaat && toevoegen}
          </>
        )}
      />
      {zl.fout && rijen.length > 0 && <Foutkaart compact boodschap={zl.fout} offline={!zl.online} onOpnieuw={zl.opnieuw} bezig={zl.laden} />}

      {/* Datumnavigatie: vooruit stopt bij vandaag, een dagboek loopt niet voor. */}
      <Card padding="sm" className="flex flex-wrap items-center gap-2">
        <IconButton label="Vorige dag" onClick={() => setDatum(schuifDag(datum, -1))}><ChevronLeft size={18} /></IconButton>
        <div className="min-w-0 flex-1 sm:w-44 sm:flex-none"><DateInput value={datum} max={vandaag} wisbaar={false} onChange={setDatum} aria-label="Dag" /></div>
        <IconButton label="Volgende dag" disabled={isVandaag} onClick={() => setDatum(schuifDag(datum, 1))}><ChevronRight size={18} /></IconButton>
        {/* De dagnaam staat al in het datumveld; op een telefoon zou hij alleen
            afkappen, daar dragen de knop en het veld het. */}
        <p className="hidden min-w-0 flex-1 truncate text-sm font-semibold text-slate-800 sm:block">{isVandaag ? 'Vandaag' : formatDayLong(datum)}</p>
        {!isVandaag && <Button variant="ghost" size="sm" icon={<CalendarDays size={14} />} onClick={() => setDatum(vandaag)}>Vandaag</Button>}
      </Card>

      {zl.fout && rijen.length === 0 ? (
        <Foutkaart boodschap={zl.fout} offline={!zl.online} onOpnieuw={zl.opnieuw} bezig={zl.laden} />
      ) : zl.laden && rijen.length === 0 ? (
        <Card padding="none" className="divide-y divide-hairline-subtle overflow-hidden" role="status" aria-busy="true" aria-label="Werkprestaties wordt geladen"><SkeletonRow className="px-5 py-4" /><SkeletonRow className="px-5 py-4" /></Card>
      ) : rijen.length === 0 ? (
        <EmptyState
          illustratie={<LegeLijst />}
          title={isVandaag ? 'Nog niets geregistreerd vandaag' : 'Deze dag staat leeg'}
          message="Noteer per taak aan welke bus je werkte, welk soort werk het was en hoelang het duurde."
          action={toevoegen}
        />
      ) : (
        <Card padding="none" className="overflow-clip">
          <div className="flex items-baseline justify-between border-b border-hairline px-5 py-3">
            <h2 className="text-card-title">{rijen.length} {rijen.length === 1 ? 'taak' : 'taken'}</h2>
            <span className="text-xs font-medium text-slate-500">{urenMetEenheid(totaalUren)} samen</span>
          </div>
          <ul className="divide-y divide-hairline-subtle">
            {rijen.map((w) => (
              <PrestatieRegel
                key={w.id}
                w={w}
                acties={(
                  <>
                    <IconButton label="Aanpassen" size="sm" onClick={() => setBewerk({ prestatie: w })}><Pencil size={16} /></IconButton>
                    <IconButton label="Verwijderen" size="sm" onClick={() => verwijderen(w)}><Trash2 size={16} /></IconButton>
                  </>
                )}
              />
            ))}
          </ul>
        </Card>
      )}

      {bewerk && (
        <PrestatieModal
          prestatie={bewerk.prestatie}
          standaardDatum={datum}
          voertuigen={voertuigen}
          currentUser={currentUser}
          staf={false}
          onClose={() => setBewerk(null)}
          onKlaar={(w) => { naOpslaan(w); setBewerk(null); }}
        />
      )}
    </PageShell>
  );
}

/** Eén taak in de lijst; `mecanicien` toont wie het deed (alleen zinvol voor staf). */
function PrestatieRegel({ w, mecanicien, acties }: { w: Werkprestatie; mecanicien?: boolean; acties?: ReactNode }) {
  return (
    <li className="flex items-start gap-3 px-5 py-3">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <p className="text-sm font-semibold text-slate-800">{busLabel(w)}</p>
          <Chip mono={false} title={WERKCODE_LABEL[w.werkcode]}>{w.werkcode} · {WERKCODE_LABEL[w.werkcode]}</Chip>
          {/* Herkomst, geen status en geen actie: neutraal, niet goud (tranche 3B.2). */}
          {w.defectId && <Badge tone="slate" stil className="whitespace-nowrap">uit gele boek</Badge>}
        </div>
        <p className="whitespace-pre-wrap text-sm text-slate-700">{w.omschrijving}</p>
        <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
          {mecanicien && w.mecanicienNaam && <span className="inline-flex items-center gap-1"><Avatar naam={w.mecanicienNaam} size="sm" />{w.mecanicienNaam}</span>}
          {w.beginTijd && w.eindeTijd && <span>{w.beginTijd} tot {w.eindeTijd}</span>}
        </p>
      </div>
      <span className="shrink-0 text-sm font-semibold text-slate-800">{urenMetEenheid(w.werkuren)}</span>
      {acties && <div className="flex shrink-0 items-center gap-0.5">{acties}</div>}
    </li>
  );
}

/** Staf: alle techniekers, periodes, cijfers en de Access-kruistabellen. */
function StafOverzicht({ currentUser, techniekers }: { currentUser: User; techniekers: User[] }) {
  const [tab, setTab] = useState<Tab>('lijst');
  const [periode, setPeriode] = useState<Periode>('maand');
  const [rijen, setRijen] = useState<Werkprestatie[]>([]);
  const [voertuigen, setVoertuigen] = useState<Vehicle[]>([]);
  const [mecanicienFilter, setMecanicienFilter] = useState('');
  const [bewerk, setBewerk] = useState<{ prestatie: Werkprestatie | null } | null>(null);
  const [rapport, setRapport] = useState<WerkRapport | null>(null);
  const [rapportJaar, setRapportJaar] = useState(new Date().getFullYear());
  const [rapportLaden, setRapportLaden] = useState(false);

  const vandaag = vandaagIso();
  const van = schuifDag(vandaag, periode === 'week' ? -7 : periode === 'maand' ? -31 : -92);

  const zl = useZelfLadend(async () => {
    const [w, v] = await Promise.all([laadWerkprestaties({ van, mecanicienId: mecanicienFilter || undefined, limit: 2000 }), laadVoertuigen()]);
    setRijen(w); setVoertuigen(v);
  }, { deps: [van, mecanicienFilter], boodschap: (err) => (err instanceof Error && err.message ? err.message : 'Kon de werkprestaties niet laden.') });
  useEffect(() => {
    if (tab !== 'rapport') return;
    setRapportLaden(true);
    void laadWerkRapport(rapportJaar).then(setRapport).catch((err) => meldSchrijffout('Rapport laden', err)).finally(() => setRapportLaden(false));
  }, [tab, rapportJaar]);

  const totaalUren = rijen.reduce((s, w) => s + w.werkuren, 0);
  const perDag = useMemo(() => {
    const m = new Map<string, Werkprestatie[]>();
    for (const w of rijen) { const l = m.get(w.datum) ?? []; l.push(w); m.set(w.datum, l); }
    return [...m.entries()].map(([datum, l]) => [datum, [...l].sort(opTijd)] as const).sort((a, b) => b[0].localeCompare(a[0]));
  }, [rijen]);
  const dagenMetWerk = perDag.length;

  const naOpslaan = (w: Werkprestatie) => setRijen((lijst) => (lijst.some((x) => x.id === w.id) ? lijst.map((x) => (x.id === w.id ? w : x)) : [w, ...lijst]).sort((a, b) => b.datum.localeCompare(a.datum)));

  const verwijderen = (w: Werkprestatie) => {
    const body = prestatieBody(w);
    void metOngedaan({
      boodschap: 'Werkprestatie verwijderd.',
      uitvoeren: async () => { await verwijderWerkprestatie(w.id); setRijen((lijst) => lijst.filter((x) => x.id !== w.id)); },
      herstellen: async () => { const terug = await maakWerkprestatie(body); naOpslaan(terug); },
      toast: (message, tone, action, opties) => notify(message, tone, { action, opties }),
    });
  };

  // De lege staat draagt dezelfde actie als de kopknop; dan hoort er maar
  // één gouden knop in beeld te staan (punt 13, 16-09).
  const legeStaat = rijen.length === 0 && !zl.laden && !zl.fout;

  return (
    <PageShell>
      <PageHeader
        view="werkprestaties"
        title="Werkprestaties"
        actions={(
          <>
            <VersheidRegel {...zl.versheid} />
            {!legeStaat && <Button variant="primary" icon={<Plus size={16} />} onClick={() => setBewerk({ prestatie: null })}>Prestatie registreren</Button>}
          </>
        )}
      />
      {zl.fout && rijen.length > 0 && <Foutkaart compact boodschap={zl.fout} offline={!zl.online} onOpnieuw={zl.opnieuw} bezig={zl.laden} />}

      <div className="flex flex-wrap items-center gap-2">
        <Segmented<Tab>
          label="Weergave"
          telefoon="vol"
          className="shrink-0"
          itemClassName="min-h-11 sm:pointer-fine:min-h-8"
          waarde={tab}
          opties={[
            { waarde: 'lijst', label: <><ClipboardList size={14} />Lijst</> },
            { waarde: 'rapport', label: <><BarChart3 size={14} />Rapport</> },
          ]}
          onChange={setTab}
        />
      </div>

      {tab === 'lijst' ? (
        <>
          <div className="kpi-raster grid grid-cols-2 gap-3 md:grid-cols-3">
            <OpsStat icon={<Clock size={16} />} tone="slate" label="Uren" text={urenTekst(totaalUren)} sub={periode === 'week' ? 'laatste 7 dagen' : periode === 'maand' ? 'laatste 31 dagen' : 'laatste kwartaal'} />
            <OpsStat icon={<ClipboardList size={16} />} tone="slate" label="Prestaties" value={rijen.length} sub={`op ${dagenMetWerk} ${dagenMetWerk === 1 ? 'dag' : 'dagen'}`} />
            <OpsStat icon={<Clock size={16} />} tone="slate" label="Per dag" text={dagenMetWerk ? urenTekst(totaalUren / dagenMetWerk) : '0'} sub="uren gemiddeld" className="col-span-2 md:col-span-1" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterChip active={periode === 'week'} onClick={() => setPeriode('week')}>Week</FilterChip>
            <FilterChip active={periode === 'maand'} onClick={() => setPeriode('maand')}>Maand</FilterChip>
            <FilterChip active={periode === 'kwartaal'} onClick={() => setPeriode('kwartaal')}>Kwartaal</FilterChip>
            <Select aria-label="Technieker" value={mecanicienFilter} onChange={(e) => setMecanicienFilter(e.target.value)} className="ml-auto min-w-0 px-2.5 py-1.5 text-xs">
              <option value="">Alle techniekers</option>
              {techniekers.map((u) => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
            </Select>
          </div>

          {zl.fout && rijen.length === 0 ? (
            <Foutkaart boodschap={zl.fout} offline={!zl.online} onOpnieuw={zl.opnieuw} bezig={zl.laden} />
          ) : zl.laden && rijen.length === 0 ? (
            <Card padding="none" className="divide-y divide-hairline-subtle overflow-hidden" role="status" aria-busy="true" aria-label="Werkprestaties wordt geladen"><SkeletonRow className="px-5 py-4" /><SkeletonRow className="px-5 py-4" /></Card>
          ) : rijen.length === 0 ? (
            <EmptyState illustratie={<LegeLijst />} title="Nog geen werkprestaties in deze periode" message="Registreer wat de garage vandaag aan welke bus deed." action={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setBewerk({ prestatie: null })}>Prestatie registreren</Button>} />
          ) : (
            <div className="space-y-4">
              {perDag.map(([datum, lijst]) => (
                <Card key={datum} padding="none" className="overflow-clip">
                  <div className="flex items-baseline justify-between border-b border-hairline px-5 py-3">
                    <h2 className="text-card-title">{datum === vandaag ? 'Vandaag' : formatShortDay(datum)}</h2>
                    <span className="text-xs font-medium text-slate-500">{urenMetEenheid(lijst.reduce((s, w) => s + w.werkuren, 0))}</span>
                  </div>
                  <ul className="divide-y divide-hairline-subtle">
                    {lijst.map((w) => (
                      <PrestatieRegel
                        key={w.id}
                        w={w}
                        mecanicien
                        acties={(
                          <>
                            <IconButton label="Bewerken" size="sm" onClick={() => setBewerk({ prestatie: w })}><Pencil size={16} /></IconButton>
                            <IconButton label="Verwijderen" size="sm" onClick={() => verwijderen(w)}><Trash2 size={16} /></IconButton>
                          </>
                        )}
                      />
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          )}
        </>
      ) : (
        <RapportTab rapport={rapport} laden={rapportLaden} jaar={rapportJaar} onJaar={setRapportJaar} />
      )}

      {bewerk && (
        <PrestatieModal
          prestatie={bewerk.prestatie}
          standaardDatum={vandaag}
          voertuigen={voertuigen}
          techniekers={techniekers}
          currentUser={currentUser}
          staf
          onClose={() => setBewerk(null)}
          onKlaar={(w) => { naOpslaan(w); setBewerk(null); }}
        />
      )}
    </PageShell>
  );
}

/** Een rij van een Access-kruistabel: uren per kwartaal, totaal en aantal prestaties. */
type KruisRij = { label: string; uren: number; aantal: number; perKwartaal: number[] };

/**
 * Een kruistabel (per bus, per technieker). Tabel of lijst volgt de breedte
 * van het kader (container query, bewust geen md): op lg staan twee kaarten
 * naast elkaar en is elke kaart op 1280 px smaller dan de zeven kolommen
 * (label + K1-K4 + Uren + Aantal, samen ±30 rem). Onder 32 rem wordt het een
 * lijst: label met uren en aantal op regel 1, de vier kwartalen eronder. Zo
 * schuift er op de telefoon niets horizontaal (tranche 3B.2). `past`: de
 * tabel verschijnt pas als ze past, dus geen scrollcontainer.
 */
function KruisTabel({ titel, rijen }: { titel: string; rijen: KruisRij[] }) {
  const kolom = titel.replace('Per ', '');
  return (
    <TableShell className="@container" label={titel} past kop={<h2 className="text-card-title">{titel}</h2>}>
      {rijen.length === 0 ? <div className="p-5"><EmptyState compact title="Geen prestaties" message="Niets geregistreerd in dit jaar." /></div> : (
        <>
          <div className="hidden @[32rem]:block">
            <Tabel>
              <StickyThead>
                <tr>
                  <Th>{kolom}</Th>
                  {['K1', 'K2', 'K3', 'K4'].map((k) => <Th key={k} num className="px-3">{k}</Th>)}
                  <Th num className="px-3">Uren</Th>
                  <Th num className="px-3">Aantal</Th>
                </tr>
              </StickyThead>
              <tbody>
                {rijen.map((r) => (
                  <tr key={r.label} className="border-b border-hairline-subtle last:border-b-0">
                    <Td className="font-semibold text-slate-800">{r.label}</Td>
                    {r.perKwartaal.map((k, i) => <Td key={i} num className="px-3 text-slate-600">{k ? urenTekst(k) : '—'}</Td>)}
                    <Td num className="px-3 font-semibold">{urenTekst(r.uren)}</Td>
                    <Td num className="px-3 text-slate-600">{r.aantal}</Td>
                  </tr>
                ))}
              </tbody>
            </Tabel>
          </div>
          <ul className="divide-y divide-hairline-subtle @[32rem]:hidden">
            {rijen.map((r) => (
              <li key={r.label} className="px-4 py-3">
                <div className="flex items-baseline gap-3">
                  <p className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">{r.label}</p>
                  <span className="shrink-0 whitespace-nowrap text-sm font-semibold text-slate-800">{urenTekst(r.uren)} u</span>
                  <span className="w-10 shrink-0 whitespace-nowrap text-right text-xs text-slate-500">{r.aantal}×</span>
                </div>
                <dl className="mt-1.5 grid grid-cols-4 gap-2 text-xs">
                  {r.perKwartaal.map((k, i) => (
                    <div key={i} className="flex items-baseline gap-1.5">
                      <dt className="text-slate-500">K{i + 1}</dt>
                      <dd className="font-medium text-slate-700">{k ? urenTekst(k) : '—'}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
    </TableShell>
  );
}

function RapportTab({ rapport, laden, jaar, onJaar }: { rapport: WerkRapport | null; laden: boolean; jaar: number; onJaar: (j: number) => void }) {
  const jaren = [0, 1, 2].map((n) => new Date().getFullYear() - n);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {jaren.map((j) => <FilterChip key={j} active={jaar === j} onClick={() => onJaar(j)}>{j}</FilterChip>)}
        {rapport && <span className="ml-auto text-xs font-medium text-slate-500">{urenTekst(rapport.totaalUren)} u in {rapport.aantal} prestaties</span>}
      </div>
      {laden || !rapport ? <Card padding="none" className="divide-y divide-hairline-subtle overflow-hidden" aria-busy="true"><SkeletonRow className="px-5 py-4" /><SkeletonRow className="px-5 py-4" /></Card> : (
        <div className={cn('grid gap-4', 'lg:grid-cols-2')}>
          <KruisTabel titel="Per bus" rijen={rapport.perBus} />
          <KruisTabel titel="Per technieker" rijen={rapport.perMecanicien} />
          {/* Drie kolommen passen ook op 375 px (de omschrijving mag afbreken),
              dus een echte tabel: aantal en uren staan cijfer onder cijfer. */}
          <TableShell className="lg:col-span-2" label="Per werkcode" past kop={<h2 className="text-card-title">Per werkcode</h2>}>
            {rapport.perWerkcode.length === 0 ? <div className="p-5"><EmptyState compact title="Geen prestaties" message="Niets geregistreerd in dit jaar." /></div> : (
              <Tabel>
                <StickyThead>
                  <tr>
                    <Th>Werkcode</Th>
                    <Th num className="px-3">Aantal</Th>
                    <Th num className="px-3">Uren</Th>
                  </tr>
                </StickyThead>
                <tbody>
                  {rapport.perWerkcode.map((r) => (
                    <tr key={r.werkcode} className="border-b border-hairline-subtle last:border-b-0">
                      <Td>
                        <span className="flex min-w-0 items-center gap-3">
                          <Chip mono={false}>{r.werkcode}</Chip>
                          <span className="min-w-0 text-slate-700">{WERKCODE_LABEL[r.werkcode as Werkcode] ?? r.werkcode}</span>
                        </span>
                      </Td>
                      <Td num className="px-3 text-slate-600">{r.aantal}</Td>
                      <Td num className="px-3 font-semibold text-slate-800">{urenTekst(r.uren)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Tabel>
            )}
          </TableShell>
        </div>
      )}
    </div>
  );
}

function PrestatieModal({ prestatie, standaardDatum, voertuigen, techniekers = [], currentUser, staf, onClose, onKlaar }: {
  prestatie: Werkprestatie | null; standaardDatum: string; voertuigen: Vehicle[]; techniekers?: User[]; currentUser: User; staf: boolean; onClose: () => void; onKlaar: (w: Werkprestatie) => void;
}) {
  const [datum, setDatum] = useState(prestatie?.datum ?? standaardDatum);
  const [vehicleId, setVehicleId] = useState(prestatie?.vehicleId ?? '');
  const [werkcode, setWerkcode] = useState<Werkcode>(prestatie?.werkcode ?? 'H');
  const [omschrijving, setOmschrijving] = useState(prestatie?.omschrijving ?? '');
  const [beginTijd, setBeginTijd] = useState(prestatie?.beginTijd ?? '');
  const [eindeTijd, setEindeTijd] = useState(prestatie?.eindeTijd ?? '');
  const [werkuren, setWerkuren] = useState(prestatie ? urenTekst(prestatie.werkuren) : '');
  const [mecanicienId, setMecanicienId] = useState(prestatie?.mecanicienId ?? String(currentUser.id));
  const fouten = useVeldfouten();
  const [bezig, setBezig] = useState(false);

  // Begin en einde ingevuld → uren automatisch (kwartieren), maar handmatig
  // overschrijven blijft mogelijk (Access had alleen de duur).
  const afgeleid = beginTijd && eindeTijd ? urenTussen(beginTijd, eindeTijd) : null;
  useEffect(() => { if (afgeleid !== null) setWerkuren(urenTekst(afgeleid)); }, [afgeleid]);
  // Afgeleide uren tellen niet als eigen wijziging (begin en einde wel).
  const { vuil } = useVuil({ datum, vehicleId, werkcode, omschrijving, beginTijd, eindeTijd, mecanicienId, werkuren: afgeleid !== null && werkuren === urenTekst(afgeleid) ? 'afgeleid' : werkuren });

  const keuzes = useMemo(() => [...voertuigen].filter((v) => v.status !== 'uit_dienst' || v.id === vehicleId).sort((a, b) => (a.kortNr ?? 99999) - (b.kortNr ?? 99999)), [voertuigen, vehicleId]);

  const opslaan = async () => {
    if (bezig) return;
    fouten.wis();
    const uren = Number(werkuren.replace(',', '.'));
    if (!Number.isFinite(uren)) { fouten.zet({ werkuren: 'Vul een getal in.' }); return; }
    setBezig(true);
    const body: WerkprestatieBody = {
      datum, vehicleId: vehicleId || null, werkcode, omschrijving: omschrijving.trim(),
      beginTijd: beginTijd || null, eindeTijd: eindeTijd || null, werkuren: uren,
      // Kilometerstand staat niet meer in het formulier (Jarno 18-09, overbodig);
      // wat er bij een oude prestatie in staat, blijft staan.
      kmstand: prestatie?.kmstand ?? null, defectId: prestatie?.defectId ?? null,
      mecanicienId: staf ? mecanicienId : undefined,
    };
    try {
      const w = prestatie ? await bewaarWerkprestatie(prestatie.id, body) : await maakWerkprestatie(body);
      notify(prestatie ? 'Taak bijgewerkt.' : 'Taak geregistreerd.', 'success');
      onKlaar(w);
    } catch (err) {
      // Veldfouten bij het veld; de rest één toast met vervolgstap. Opnieuw
      // alleen bij bewerken (PUT op id), nooit bij registreren.
      if (err instanceof TechniekFout && err.veldfouten) fouten.zet(err.veldfouten);
      else meldSchrijffout('Opslaan', err, prestatie ? () => void opslaan() : undefined);
    } finally { setBezig(false); }
  };

  const titel = staf
    ? (prestatie ? 'Werkprestatie bewerken' : 'Werkprestatie registreren')
    : (prestatie ? 'Taak aanpassen' : 'Taak toevoegen');

  return (
    <Modal open onClose={onClose} vuil={vuil} maxWidth="lg" ariaLabel={titel}>
      <Formulier onVerstuur={opslaan} noValidate className="p-6">
        <CardHeader title={titel} description="Wat heb je aan welke bus gedaan en hoelang duurde het?" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Datum" required error={fouten.fouten.datum}><DateInput value={datum} max={staf ? undefined : vandaagIso()} onChange={(v) => { setDatum(v); fouten.wisVeld('datum'); }} /></Field>
          {staf && (
            <Field label="Technieker" error={fouten.fouten.mecanicienId}><Select value={mecanicienId} onChange={(e) => { setMecanicienId(e.target.value); fouten.wisVeld('mecanicienId'); }}>{techniekers.map((u) => <option key={u.id} value={String(u.id)}>{u.name}</option>)}{!techniekers.some((u) => String(u.id) === mecanicienId) && <option value={mecanicienId}>{currentUser.name}</option>}</Select></Field>
          )}
          <Field label="Bus" error={fouten.fouten.vehicleId}>
            <Select value={vehicleId} onChange={(e) => { setVehicleId(e.target.value); fouten.wisVeld('vehicleId'); }}>
                <option value="">Garage / algemeen</option>
                {keuzes.map((v) => <option key={v.id} value={v.id}>{voertuigNaam(v)}{v.kortNr !== null && v.kortNr !== undefined ? ` (${v.busnr})` : ''}</option>)}
            </Select>
          </Field>
          <Field label="Soort werk" required error={fouten.fouten.werkcode}><Select value={werkcode} onChange={(e) => { setWerkcode(e.target.value as Werkcode); fouten.wisVeld('werkcode'); }}>{WERKCODES.map((c) => <option key={c} value={c}>{c} · {WERKCODE_LABEL[c]}</option>)}</Select></Field>
          <Field label="Wat is er gedaan?" required className="sm:col-span-2" error={fouten.fouten.omschrijving}>
            <Textarea value={omschrijving} rows={3} maxLength={WERK_OMSCHRIJVING_MAX} onChange={(e) => { setOmschrijving(e.target.value); fouten.wisVeld('omschrijving'); }} placeholder="Bijvoorbeeld: remblokken vooraan vervangen, olie ververst" />
          </Field>
          <Field label="Begin" error={fouten.fouten.beginTijd}><Input type="time" value={beginTijd} onChange={(e) => { setBeginTijd(e.target.value); fouten.wisVeld('beginTijd'); }} /></Field>
          <Field label="Einde" error={fouten.fouten.eindeTijd}><Input type="time" value={eindeTijd} onChange={(e) => { setEindeTijd(e.target.value); fouten.wisVeld('eindeTijd'); }} /></Field>
          <Field label="Uren" required hint="Bijvoorbeeld 1,5" error={fouten.fouten.werkuren}><Input inputMode="decimal" value={werkuren} onChange={(e) => { setWerkuren(e.target.value); fouten.wisVeld('werkuren'); }} /></Field>
        </div>
        <div className="mt-5 flex gap-3">
          <SluitKnop onClose={onClose} variant="ghost" className="flex-1" disabled={bezig}>Annuleren</SluitKnop>
          <Button type="submit" variant="primary" className="flex-1" bezig={bezig}>Opslaan</Button>
        </div>
      </Formulier>
    </Modal>
  );
}
