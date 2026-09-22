import { useEffect, useMemo, useState } from 'react';
import { Clock, Wrench } from 'lucide-react';
import { WERKCODE_LABEL, voertuigNaam, VOERTUIG_CATEGORIE_LABEL, VOERTUIG_TYPE_LABEL } from '../../../shared/techniek';
import { VOERTUIG_STATUS } from '../../../shared/status';
import { useZelfLadend } from '../../lib/zelfLadend';
import { useRouteParam } from '../../app/router';
import { formatShortDay } from '../../lib/format';
import { laadVoertuigWerken, laadVoertuigen, urenTekst, vandaagIso, type Vehicle, type Werkprestatie } from '../../lib/techniek';
import { EmptyState, Foutkaart, PageHeader, PageShell, VersheidRegel } from '../../components/ui';
import { LegeLijst } from '../../components/illustraties';
import { OpsStat } from '../../components/ops';
import { SkeletonRow } from '../../components/Skeleton';
import { Card } from '../../components/Card';
import { Avatar } from '../../components/Avatar';
import { Select } from '../../components/Field';
import { Badge, Chip, FilterChip, StatusBadge } from '../../components/primitives';
import { meldSchrijffout } from '../../lib/fouten';

type Periode = 'jaar' | 'alles';

/** ISO-dag n maanden terug. */
const maandenTerug = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00`);
  d.setMonth(d.getMonth() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/**
 * Uitgevoerde werken per bus (Jarno 18-09): kies een bus en zie wat er aan
 * gedaan is, wie het deed en hoelang het duurde, nieuwste dag bovenaan.
 *
 * Voor technieker én staf. De data komt van GET /api/vehicles/:id/werken en
 * niet van de werkprestatielijst: die laatste snoert een technieker tot zijn
 * eigen rijen, want dat is zijn dagadministratie. Wat er aan een bus gebeurde
 * is een vraag over de bus, niet over een persoon, en mag hij volledig zien.
 */
export function VoertuigWerkenView() {
  const [voertuigen, setVoertuigen] = useState<Vehicle[]>([]);
  const [vehicleId, setVehicleId] = useState('');
  const [periode, setPeriode] = useState<Periode>('jaar');
  const [werken, setWerken] = useState<Werkprestatie[]>([]);

  // Deeplink /techniek/werken/<id>, zodat "Bekijk de werken van deze bus"
  // vanuit een ander scherm rechtstreeks kan wijzen.
  const [busParam, zetBusParam] = useRouteParam(0);

  const zlVoertuigen = useZelfLadend(async () => {
    const v = await laadVoertuigen();
    setVoertuigen(v);
  }, { boodschap: (err) => (err instanceof Error && err.message ? err.message : 'Kon de voertuigen niet laden.') });

  const keuzes = useMemo(
    () => [...voertuigen].sort((a, b) => (a.kortNr ?? 99999) - (b.kortNr ?? 99999) || a.busnr.localeCompare(b.busnr, 'nl')),
    [voertuigen],
  );

  // Eerst de bus uit de URL, anders de eerste uit de lijst: een leeg scherm
  // met alleen een keuzelijst vertelt niets.
  useEffect(() => {
    if (vehicleId || keuzes.length === 0) return;
    const uitUrl = busParam && keuzes.find((v) => v.id === busParam);
    setVehicleId(uitUrl ? uitUrl.id : keuzes[0].id);
  }, [busParam, keuzes, vehicleId]);
  useEffect(() => { if (vehicleId && vehicleId !== busParam) zetBusParam(vehicleId); }, [vehicleId, busParam, zetBusParam]);

  const van = periode === 'jaar' ? maandenTerug(vandaagIso(), 12) : undefined;
  useEffect(() => {
    if (!vehicleId) return;
    let actueel = true;
    void laadVoertuigWerken(vehicleId, { van, limit: 1000 })
      .then((w) => { if (actueel) setWerken(w); })
      .catch((err) => { if (actueel) { setWerken([]); meldSchrijffout('Werken van deze bus laden', err); } });
    return () => { actueel = false; };
  }, [vehicleId, van]);

  const bus = keuzes.find((v) => v.id === vehicleId) ?? null;
  const totaalUren = werken.reduce((s, w) => s + w.werkuren, 0);
  const perDag = useMemo(() => {
    const m = new Map<string, Werkprestatie[]>();
    for (const w of werken) { const l = m.get(w.datum) ?? []; l.push(w); m.set(w.datum, l); }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [werken]);

  return (
    <PageShell>
      <PageHeader
        view="voertuig-werken"
        title="Uitgevoerde werken per bus"
        actions={<VersheidRegel {...zlVoertuigen.versheid} />}
      />

      {zlVoertuigen.fout ? (
        <Foutkaart boodschap={zlVoertuigen.fout} offline={!zlVoertuigen.online} onOpnieuw={zlVoertuigen.opnieuw} bezig={zlVoertuigen.laden} />
      ) : (
        <>
          <Card padding="sm" className="flex flex-wrap items-center gap-2">
            {/* Op een telefoon krijgt de buskeuze een eigen regel, anders knijpen de
                chips hem tot "Bus 26" zonder busnummer. */}
            <div className="w-full min-w-0 sm:w-72">
              <Select aria-label="Bus" value={vehicleId} onChange={(e) => setVehicleId(e.target.value)} disabled={keuzes.length === 0}>
                {keuzes.length === 0 && <option value="">Geen voertuigen</option>}
                {keuzes.map((v) => <option key={v.id} value={v.id}>{voertuigNaam(v)}{v.kortNr !== null && v.kortNr !== undefined ? ` (${v.busnr})` : ''}</option>)}
              </Select>
            </div>
            <FilterChip active={periode === 'jaar'} onClick={() => setPeriode('jaar')}>Laatste 12 maanden</FilterChip>
            <FilterChip active={periode === 'alles'} onClick={() => setPeriode('alles')}>Alles</FilterChip>
          </Card>

          {bus && (
            <Card padding="sm" className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm text-slate-700">
              <span className="font-semibold text-slate-800">{voertuigNaam(bus)}</span>
              <span className="text-slate-500">{bus.busnr}</span>
              {bus.nummerplaat && <Chip mono>{bus.nummerplaat}</Chip>}
              <span className="text-slate-500">{VOERTUIG_CATEGORIE_LABEL[bus.categorie]} · {VOERTUIG_TYPE_LABEL[bus.type]}</span>
              {bus.merk && <span className="text-slate-500">{bus.merk}</span>}
              <StatusBadge status={bus.status} map={VOERTUIG_STATUS} stil className="whitespace-nowrap" />
            </Card>
          )}

          <div className="grid grid-cols-2 gap-3">
            <OpsStat icon={<Wrench size={16} />} tone="slate" label="Werken" value={werken.length} sub={periode === 'jaar' ? 'laatste 12 maanden' : 'sinds het begin'} />
            <OpsStat icon={<Clock size={16} />} tone="slate" label="Uren" text={urenTekst(totaalUren)} sub="aan deze bus besteed" />
          </div>

          {zlVoertuigen.laden && keuzes.length === 0 ? (
            <Card padding="none" className="divide-y divide-hairline-subtle overflow-hidden" role="status" aria-busy="true" aria-label="Werken worden geladen"><SkeletonRow className="px-5 py-4" /><SkeletonRow className="px-5 py-4" /></Card>
          ) : werken.length === 0 ? (
            <EmptyState
              illustratie={<LegeLijst />}
              title="Nog geen werken geregistreerd"
              message={periode === 'jaar' ? 'Aan deze bus is het laatste jaar niets geregistreerd. Kies Alles om verder terug te kijken.' : 'Aan deze bus is nog niets geregistreerd.'}
            />
          ) : (
            <div className="space-y-4">
              {perDag.map(([datum, lijst]) => (
                <Card key={datum} padding="none" className="overflow-clip">
                  <div className="flex items-baseline justify-between border-b border-hairline px-5 py-3">
                    <h2 className="text-card-title">{formatShortDay(datum)}</h2>
                    <span className="text-xs font-medium text-slate-500">{urenTekst(lijst.reduce((s, w) => s + w.werkuren, 0))} u</span>
                  </div>
                  <ul className="divide-y divide-hairline-subtle">
                    {lijst.map((w) => (
                      <li key={w.id} className="flex items-start gap-3 px-5 py-3">
                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <Chip mono={false} title={WERKCODE_LABEL[w.werkcode]}>{w.werkcode} · {WERKCODE_LABEL[w.werkcode]}</Chip>
                            {w.defectId && <Badge tone="oker" stil className="whitespace-nowrap">uit gele boek</Badge>}
                          </div>
                          <p className="whitespace-pre-wrap text-sm text-slate-700">{w.omschrijving}</p>
                          <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                            {w.mecanicienNaam && <span className="inline-flex items-center gap-1"><Avatar naam={w.mecanicienNaam} size="sm" />{w.mecanicienNaam}</span>}
                            {w.beginTijd && w.eindeTijd && <span>{w.beginTijd} tot {w.eindeTijd}</span>}
                          </p>
                        </div>
                        <span className="shrink-0 text-sm font-semibold text-slate-800">{urenTekst(w.werkuren)} u</span>
                      </li>
                    ))}
                  </ul>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </PageShell>
  );
}
