import { useEffect, useMemo, useState } from 'react';
import { BarChart3, Clock, ClipboardList, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import type { User } from '../../types';
import { isStaf } from '../../types';
import { WERKCODES, WERKCODE_LABEL, WERK_OMSCHRIJVING_MAX, voertuigNaam, type Werkcode } from '../../../shared/techniek';
import { cn, notify } from '../../lib/ui';
import { formatShortDay } from '../../lib/format';
import { metOngedaan } from '../../lib/ongedaan';
import {
  bewaarWerkprestatie, laadVoertuigen, laadWerkRapport, laadWerkprestaties, maakWerkprestatie, TechniekFout, urenTekst, urenTussen,
  vandaagIso, verwijderWerkprestatie, type Vehicle, type WerkRapport, type Werkprestatie, type WerkprestatieBody,
} from '../../lib/techniek';
import { EmptyState, PageHeader, PageShell } from '../../components/ui';
import { LegeLijst } from '../../components/illustraties';
import { Modal } from '../../components/Modal';
import { OpsStat } from '../../components/ops';
import { SkeletonRow } from '../../components/Skeleton';
import { Card, CardHeader } from '../../components/Card';
import { Avatar } from '../../components/Avatar';
import { DateInput, Field, Input, Select, Textarea } from '../../components/Field';
import { Badge, Button, Chip, FilterChip, IconButton, Td, Th, segItemClass } from '../../components/primitives';
import { StickyThead } from '../../components/Table';

type Tab = 'lijst' | 'rapport';
type Periode = 'week' | 'maand' | 'kwartaal';

const isoMin = (iso: string, dagen: number) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() - dagen); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/**
 * Werkprestaties (fase A Access-migratie, 13-09): wat de garage per dag aan
 * welke bus deed, met werkcode en bestede uren (tblUtgevoerdeWerken). Een
 * technieker registreert eigen prestaties en ziet alleen die; staf ziet alles
 * en kan voor een technieker registreren. Tab Rapport = de drie Access-
 * kruistabellen (per bus, per mecanicien, per kwartaal) voor een jaar.
 */
export function WerkprestatiesView({ currentUser, users }: { currentUser: User; users: User[] }) {
  const staf = isStaf(currentUser.role);
  const [tab, setTab] = useState<Tab>('lijst');
  const [periode, setPeriode] = useState<Periode>('maand');
  const [rijen, setRijen] = useState<Werkprestatie[]>([]);
  const [voertuigen, setVoertuigen] = useState<Vehicle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [mecanicienFilter, setMecanicienFilter] = useState('');
  const [bewerk, setBewerk] = useState<{ prestatie: Werkprestatie | null } | null>(null);
  const [rapport, setRapport] = useState<WerkRapport | null>(null);
  const [rapportJaar, setRapportJaar] = useState(new Date().getFullYear());
  const [rapportLaden, setRapportLaden] = useState(false);

  const vandaag = vandaagIso();
  const van = periode === 'week' ? isoMin(vandaag, 7) : periode === 'maand' ? isoMin(vandaag, 31) : isoMin(vandaag, 92);

  const load = async () => {
    setIsLoading(true);
    try {
      const [w, v] = await Promise.all([laadWerkprestaties({ van, mecanicienId: staf ? mecanicienFilter || undefined : undefined, limit: 2000 }), laadVoertuigen()]);
      setRijen(w); setVoertuigen(v); setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kon de werkprestaties niet laden.');
    } finally { setIsLoading(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [van, mecanicienFilter]);
  useEffect(() => {
    if (tab !== 'rapport') return;
    setRapportLaden(true);
    void laadWerkRapport(rapportJaar).then(setRapport).catch(() => notify('Kon het rapport niet laden.', 'error')).finally(() => setRapportLaden(false));
  }, [tab, rapportJaar]);

  const techniekers = useMemo(() => users.filter((u) => (u.role === 'technieker' || (staf && isStaf(u.role))) && u.isActive !== false).sort((a, b) => a.name.localeCompare(b.name, 'nl')), [users, staf]);
  const totaalUren = rijen.reduce((s, w) => s + w.werkuren, 0);
  const perDag = useMemo(() => {
    const m = new Map<string, Werkprestatie[]>();
    for (const w of rijen) { const l = m.get(w.datum) ?? []; l.push(w); m.set(w.datum, l); }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [rijen]);
  const dagenMetWerk = perDag.length;

  const naOpslaan = (w: Werkprestatie) => setRijen((lijst) => (lijst.some((x) => x.id === w.id) ? lijst.map((x) => (x.id === w.id ? w : x)) : [w, ...lijst]).sort((a, b) => b.datum.localeCompare(a.datum)));

  const verwijderen = (w: Werkprestatie) => {
    const body: WerkprestatieBody = { datum: w.datum, vehicleId: w.vehicleId ?? null, werkcode: w.werkcode, omschrijving: w.omschrijving, beginTijd: w.beginTijd ?? null, eindeTijd: w.eindeTijd ?? null, werkuren: w.werkuren, kmstand: w.kmstand ?? null, defectId: w.defectId ?? null, mecanicienId: w.mecanicienId };
    void metOngedaan({
      boodschap: 'Werkprestatie verwijderd.',
      uitvoeren: async () => { await verwijderWerkprestatie(w.id); setRijen((lijst) => lijst.filter((x) => x.id !== w.id)); },
      herstellen: async () => { const terug = await maakWerkprestatie(body); naOpslaan(terug); },
      toast: (message, tone, action, opties) => notify(message, tone, { action, opties }),
    });
  };

  const busLabel = (w: Werkprestatie) => (w.vehicleId ? voertuigNaam({ busnr: w.busnr ?? '', kortNr: w.kortNr }) : 'Garage / algemeen');

  return (
    <PageShell>
      <PageHeader
        eyebrow="Techniek"
        title="Werkprestaties"
        actions={(
          <>
            <Button variant="secondary" icon={<RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />} onClick={() => void load()} disabled={isLoading}>Ververs</Button>
            <Button variant="primary" icon={<Plus size={16} />} onClick={() => setBewerk({ prestatie: null })}>Prestatie registreren</Button>
          </>
        )}
      />
      {error && <Card tone="danger" padding="sm" className="text-sm font-semibold text-red-700">{error}</Card>}

      <div className="flex flex-wrap items-center gap-2">
        <div className="glass-segmented inline-flex shrink-0 rounded-2xl p-1" role="group" aria-label="Weergave">
          {(['lijst', 'rapport'] as const).map((t) => (
            // rauw: segmented-control-item via segItemClass (het voorgeschreven patroon)
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className={segItemClass(tab === t, 'inline-flex items-center gap-1.5 min-h-11 sm:pointer-fine:min-h-8')}
            >
              {t === 'lijst' ? <ClipboardList size={14} /> : <BarChart3 size={14} />}
              {t === 'lijst' ? 'Lijst' : 'Rapport'}
            </button>
          ))}
        </div>
      </div>

      {tab === 'lijst' ? (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <OpsStat icon={<Clock size={16} />} tone="slate" label="Uren" text={urenTekst(totaalUren)} sub={periode === 'week' ? 'laatste 7 dagen' : periode === 'maand' ? 'laatste 31 dagen' : 'laatste kwartaal'} />
            <OpsStat icon={<ClipboardList size={16} />} tone="slate" label="Prestaties" value={rijen.length} sub={`op ${dagenMetWerk} ${dagenMetWerk === 1 ? 'dag' : 'dagen'}`} />
            <OpsStat icon={<Clock size={16} />} tone="slate" label="Per dag" text={dagenMetWerk ? urenTekst(totaalUren / dagenMetWerk) : '0'} sub="uren gemiddeld" className="col-span-2 md:col-span-1" />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <FilterChip active={periode === 'week'} onClick={() => setPeriode('week')}>Week</FilterChip>
            <FilterChip active={periode === 'maand'} onClick={() => setPeriode('maand')}>Maand</FilterChip>
            <FilterChip active={periode === 'kwartaal'} onClick={() => setPeriode('kwartaal')}>Kwartaal</FilterChip>
            {staf && (
              <Select aria-label="Technieker" value={mecanicienFilter} onChange={(e) => setMecanicienFilter(e.target.value)} className="ml-auto min-w-0 px-2.5 py-1.5 text-xs">
                <option value="">Alle techniekers</option>
                {techniekers.map((u) => <option key={u.id} value={String(u.id)}>{u.name}</option>)}
              </Select>
            )}
          </div>

          {isLoading && rijen.length === 0 && !error ? (
            <Card padding="none" className="divide-y divide-slate-100 overflow-hidden" aria-busy="true" aria-label="Werkprestaties worden geladen"><SkeletonRow className="px-5 py-4" /><SkeletonRow className="px-5 py-4" /></Card>
          ) : rijen.length === 0 ? (
            <EmptyState illustratie={<LegeLijst />} title="Nog geen werkprestaties in deze periode" message="Registreer wat je vandaag aan welke bus deed." action={<Button variant="primary" icon={<Plus size={16} />} onClick={() => setBewerk({ prestatie: null })}>Prestatie registreren</Button>} />
          ) : (
            <div className="space-y-4">
              {perDag.map(([datum, lijst]) => (
                <Card key={datum} padding="none" className="overflow-clip">
                  <div className="flex items-baseline justify-between border-b border-slate-200/70 px-5 py-3">
                    <h2 className="text-card-title">{datum === vandaag ? 'Vandaag' : formatShortDay(datum)}</h2>
                    <span className="text-xs font-medium text-slate-500">{urenTekst(lijst.reduce((s, w) => s + w.werkuren, 0))} u</span>
                  </div>
                  <ul className="divide-y divide-slate-100">
                    {lijst.map((w) => (
                      <li key={w.id} className="flex items-start gap-3 px-5 py-3">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="text-sm font-semibold text-slate-800">{busLabel(w)}</p>
                            <Chip mono={false} title={WERKCODE_LABEL[w.werkcode]}>{w.werkcode} · {WERKCODE_LABEL[w.werkcode]}</Chip>
                            {w.defectId && <Badge tone="oker" stil className="whitespace-nowrap">uit gele boek</Badge>}
                          </div>
                          <p className="whitespace-pre-wrap text-sm text-slate-700">{w.omschrijving}</p>
                          <p className="flex flex-wrap items-center gap-1.5 text-2xs text-slate-500">
                            {staf && w.mecanicienNaam && <span className="inline-flex items-center gap-1"><Avatar naam={w.mecanicienNaam} size="sm" />{w.mecanicienNaam}</span>}
                            {w.beginTijd && w.eindeTijd && <span>{w.beginTijd} tot {w.eindeTijd}</span>}
                            {w.kmstand ? <span>{w.kmstand.toLocaleString('nl-BE')} km</span> : null}
                          </p>
                        </div>
                        <span className="shrink-0 text-sm font-semibold text-slate-800">{urenTekst(w.werkuren)} u</span>
                        <div className="flex shrink-0 items-center gap-0.5">
                          <IconButton label="Bewerken" size="sm" onClick={() => setBewerk({ prestatie: w })}><Pencil size={16} /></IconButton>
                          <IconButton label="Verwijderen" size="sm" onClick={() => verwijderen(w)}><Trash2 size={16} /></IconButton>
                        </div>
                      </li>
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
          voertuigen={voertuigen}
          techniekers={techniekers}
          currentUser={currentUser}
          staf={staf}
          onClose={() => setBewerk(null)}
          onKlaar={(w) => { naOpslaan(w); setBewerk(null); }}
        />
      )}
    </PageShell>
  );
}

function RapportTab({ rapport, laden, jaar, onJaar }: { rapport: WerkRapport | null; laden: boolean; jaar: number; onJaar: (j: number) => void }) {
  const jaren = [0, 1, 2].map((n) => new Date().getFullYear() - n);
  const tabel = (titel: string, rijen: Array<{ label: string; uren: number; aantal: number; perKwartaal: number[] }>) => (
    <Card padding="none" className="overflow-clip">
      <div className="border-b border-slate-200/70 px-5 py-3"><h2 className="text-card-title">{titel}</h2></div>
      {rijen.length === 0 ? <div className="p-5"><EmptyState compact title="Geen prestaties" message="Niets geregistreerd in dit jaar." /></div> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-left border-collapse">
            <StickyThead><tr><Th>{titel.replace('Per ', '')}</Th><Th num>K1</Th><Th num>K2</Th><Th num>K3</Th><Th num>K4</Th><Th num>Uren</Th><Th num>Aantal</Th></tr></StickyThead>
            <tbody>
              {rijen.map((r) => (
                <tr key={r.label} className="border-b border-slate-100 last:border-b-0">
                  <Td className="font-semibold text-slate-800">{r.label}</Td>
                  {r.perKwartaal.map((k, i) => <Td key={i} num className="text-slate-600">{k ? urenTekst(k) : '—'}</Td>)}
                  <Td num className="font-semibold">{urenTekst(r.uren)}</Td>
                  <Td num className="text-slate-600">{r.aantal}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {jaren.map((j) => <FilterChip key={j} active={jaar === j} onClick={() => onJaar(j)}>{j}</FilterChip>)}
        {rapport && <span className="ml-auto text-xs font-medium text-slate-500">{urenTekst(rapport.totaalUren)} u in {rapport.aantal} prestaties</span>}
      </div>
      {laden || !rapport ? <Card padding="none" className="divide-y divide-slate-100 overflow-hidden" aria-busy="true"><SkeletonRow className="px-5 py-4" /><SkeletonRow className="px-5 py-4" /></Card> : (
        <div className={cn('grid gap-4', 'lg:grid-cols-2')}>
          {tabel('Per bus', rapport.perBus)}
          {tabel('Per technieker', rapport.perMecanicien)}
          <Card padding="none" className="overflow-clip lg:col-span-2">
            <div className="border-b border-slate-200/70 px-5 py-3"><h2 className="text-card-title">Per werkcode</h2></div>
            <ul className="divide-y divide-slate-100">
              {rapport.perWerkcode.map((r) => (
                <li key={r.werkcode} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                  <Chip mono={false}>{r.werkcode}</Chip>
                  <span className="min-w-0 flex-1 truncate text-slate-700">{WERKCODE_LABEL[r.werkcode as Werkcode] ?? r.werkcode}</span>
                  <span className="text-slate-500">{r.aantal}×</span>
                  <span className="w-16 text-right font-semibold text-slate-800">{urenTekst(r.uren)} u</span>
                </li>
              ))}
              {rapport.perWerkcode.length === 0 && <li className="p-5"><EmptyState compact title="Geen prestaties" message="Niets geregistreerd in dit jaar." /></li>}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}

function PrestatieModal({ prestatie, voertuigen, techniekers, currentUser, staf, onClose, onKlaar }: {
  prestatie: Werkprestatie | null; voertuigen: Vehicle[]; techniekers: User[]; currentUser: User; staf: boolean; onClose: () => void; onKlaar: (w: Werkprestatie) => void;
}) {
  const [datum, setDatum] = useState(prestatie?.datum ?? vandaagIso());
  const [vehicleId, setVehicleId] = useState(prestatie?.vehicleId ?? '');
  const [werkcode, setWerkcode] = useState<Werkcode>(prestatie?.werkcode ?? 'H');
  const [omschrijving, setOmschrijving] = useState(prestatie?.omschrijving ?? '');
  const [beginTijd, setBeginTijd] = useState(prestatie?.beginTijd ?? '');
  const [eindeTijd, setEindeTijd] = useState(prestatie?.eindeTijd ?? '');
  const [werkuren, setWerkuren] = useState(prestatie ? urenTekst(prestatie.werkuren) : '');
  const [kmstand, setKmstand] = useState(prestatie?.kmstand ? String(prestatie.kmstand) : '');
  const [mecanicienId, setMecanicienId] = useState(prestatie?.mecanicienId ?? String(currentUser.id));
  const [fouten, setFouten] = useState<Record<string, string>>({});
  const [bezig, setBezig] = useState(false);

  // Begin en einde ingevuld → uren automatisch (kwartieren), maar handmatig
  // overschrijven blijft mogelijk (Access had alleen de duur).
  const afgeleid = beginTijd && eindeTijd ? urenTussen(beginTijd, eindeTijd) : null;
  useEffect(() => { if (afgeleid !== null) setWerkuren(urenTekst(afgeleid)); }, [afgeleid]);

  const keuzes = useMemo(() => [...voertuigen].filter((v) => v.status !== 'uit_dienst' || v.id === vehicleId).sort((a, b) => (a.kortNr ?? 99999) - (b.kortNr ?? 99999)), [voertuigen, vehicleId]);

  const opslaan = async () => {
    if (bezig) return;
    setBezig(true); setFouten({});
    const uren = Number(werkuren.replace(',', '.'));
    const body: WerkprestatieBody = {
      datum, vehicleId: vehicleId || null, werkcode, omschrijving: omschrijving.trim(),
      beginTijd: beginTijd || null, eindeTijd: eindeTijd || null, werkuren: Number.isFinite(uren) ? uren : -1,
      kmstand: kmstand.trim() ? Number(kmstand) : null, defectId: prestatie?.defectId ?? null,
      mecanicienId: staf ? mecanicienId : undefined,
    };
    try {
      const w = prestatie ? await bewaarWerkprestatie(prestatie.id, body) : await maakWerkprestatie(body);
      notify(prestatie ? 'Werkprestatie bijgewerkt.' : 'Werkprestatie geregistreerd.', 'success');
      onKlaar(w);
    } catch (err) {
      if (err instanceof TechniekFout && err.veldfouten) setFouten(err.veldfouten);
      notify(err instanceof Error ? err.message : 'Bewaren is mislukt.', 'error');
    } finally { setBezig(false); }
  };

  return (
    <Modal open onClose={onClose} maxWidth="lg" ariaLabel={prestatie ? 'Werkprestatie bewerken' : 'Werkprestatie registreren'}>
      <div className="p-6">
        <CardHeader title={prestatie ? 'Werkprestatie bewerken' : 'Werkprestatie registreren'} description="Wat heb je aan welke bus gedaan en hoelang duurde het?" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Field label="Datum" required error={fouten.datum}>{({ id }) => <DateInput id={id} value={datum} onChange={setDatum} />}</Field>
          {staf && (
            <Field label="Technieker" error={fouten.mecanicienId}>{({ id }) => <Select id={id} value={mecanicienId} onChange={(e) => setMecanicienId(e.target.value)}>{techniekers.map((u) => <option key={u.id} value={String(u.id)}>{u.name}</option>)}{!techniekers.some((u) => String(u.id) === mecanicienId) && <option value={mecanicienId}>{currentUser.name}</option>}</Select>}</Field>
          )}
          <Field label="Bus" error={fouten.vehicleId}>
            {({ id, invalid }) => (
              <Select id={id} invalid={invalid} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
                <option value="">Garage / algemeen</option>
                {keuzes.map((v) => <option key={v.id} value={v.id}>{voertuigNaam(v)}{v.kortNr !== null && v.kortNr !== undefined ? ` (${v.busnr})` : ''}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Werkcode" required error={fouten.werkcode}>{({ id }) => <Select id={id} value={werkcode} onChange={(e) => setWerkcode(e.target.value as Werkcode)}>{WERKCODES.map((c) => <option key={c} value={c}>{c} · {WERKCODE_LABEL[c]}</option>)}</Select>}</Field>
          <Field label="Wat is er gedaan?" required className="sm:col-span-2" error={fouten.omschrijving}>
            {({ id, invalid }) => <Textarea id={id} invalid={invalid} value={omschrijving} rows={3} maxLength={WERK_OMSCHRIJVING_MAX} onChange={(e) => setOmschrijving(e.target.value)} placeholder="Bijvoorbeeld: remblokken vooraan vervangen, olie ververst" />}
          </Field>
          <Field label="Begin" error={fouten.beginTijd}>{({ id, invalid }) => <Input id={id} invalid={invalid} type="time" value={beginTijd} onChange={(e) => setBeginTijd(e.target.value)} />}</Field>
          <Field label="Einde" error={fouten.eindeTijd}>{({ id, invalid }) => <Input id={id} invalid={invalid} type="time" value={eindeTijd} onChange={(e) => setEindeTijd(e.target.value)} />}</Field>
          <Field label="Uren" required hint="Bijvoorbeeld 1,5" error={fouten.werkuren}>{({ id, invalid }) => <Input id={id} invalid={invalid} inputMode="decimal" value={werkuren} onChange={(e) => setWerkuren(e.target.value)} />}</Field>
          <Field label="Kilometerstand" error={fouten.kmstand}>{({ id, invalid }) => <Input id={id} invalid={invalid} inputMode="numeric" value={kmstand} onChange={(e) => setKmstand(e.target.value)} />}</Field>
        </div>
        <div className="mt-5 flex gap-3">
          <Button variant="ghost" className="flex-1" onClick={onClose}>Annuleren</Button>
          <Button variant="primary" className="flex-1" onClick={() => void opslaan()} disabled={bezig}>{bezig ? 'Bezig…' : 'Opslaan'}</Button>
        </div>
      </div>
    </Modal>
  );
}
