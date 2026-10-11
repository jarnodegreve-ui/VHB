import { useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Upload } from 'lucide-react';
import { Callout } from '../../components/Callout';
import { Badge, Button, Chip, IconButton } from '../../components/primitives';
import { ConfirmationModal, EmptyState, Foutkaart, PageHeader, PageShell, VersheidRegel } from '../../components/ui';
import { StickyThead } from '../../components/Table';
import { Tabel, TableShell, Td, Th } from '../../components/TabelBasis';
import { MaandInput } from '../../components/MaandInput';
import { Zijvak, ZijvakLayout, ZijvakRij, ZijvakTekst } from '../../components/Zijvak';
import { ActieMenu } from '../../components/ActieMenu';
import { useZelfLadend } from '../../lib/zelfLadend';
import { apiFetch, apiJson, foutUitAntwoord } from '../../lib/api';
import { downloadBlob, notify } from '../../lib/ui';
import { meldSchrijffout } from '../../lib/fouten';
import { csvTekst } from '../../lib/csv';
import { maandLabel } from '../../lib/kalender';
import { formatDatumDMJ } from '../../lib/format';
import { rijenUitBestand } from '../../lib/filmnummerImport';
import { dagtypeLabel, dagtypePeriode } from '../../../shared/dagtype';
import {
  kalenderRijen, kalenderUitRijen, regimeVan, weekdagKortVan,
  type DagtypeKalenderDag, type KalenderSamenvatting, type Overgeslagen,
} from '../../../shared/dagtypeKalender';

/**
 * Beheer › Dagtypekalender (verbeterronde 11-10, punt 1, keuze Jarno): het
 * De Lijn-dagtype en het verlofmaximum per dag, uit het CSV dat De Lijn per
 * jaar levert. Lezen mag de staf, importeren alleen de admin. De kalender
 * wint nooit van de code in de planningsmatrix: een verschil staat hier als
 * opmerking (keuze Jarno 11-10), nooit als blokkade.
 */

type Antwoord = {
  dagen: Array<DagtypeKalenderDag & { bron: string }>;
  afwijkingen: Array<{ datum: string; matrix: string; kalender: string }>;
  samenvatting: KalenderSamenvatting;
};

type Import = { dagen: DagtypeKalenderDag[]; overgeslagen: Overgeslagen[]; bestand: string };

const REGIME_LABEL: Record<string, string> = {
  school: 'Schooldag', vakantie: 'Schoolvakantie', 'juli-augustus': 'Juli en augustus', examen: 'Examen', zaterdag: 'Zaterdag', zondag: 'Zondag', feestdag: 'Feestdag',
};
const regimeTekst = (typedag: string): string => REGIME_LABEL[regimeVan(typedag)] ?? dagtypePeriode(typedag);

const huidigeMaand = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const maandPlus = (maand: string, delta: number): string => {
  const [j, m] = maand.split('-').map(Number);
  const d = new Date(Date.UTC(j, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export function DagtypeKalenderView({ magBeheren }: { magBeheren: boolean }) {
  const [data, setData] = useState<Antwoord | null>(null);
  const [maand, setMaand] = useState(huidigeMaand);
  const [importKlaar, setImportKlaar] = useState<Import | null>(null);
  const [bezig, setBezig] = useState(false);
  const bestandRef = useRef<HTMLInputElement>(null);

  const zl = useZelfLadend(async () => {
    setData(await apiJson<Antwoord>('/api/dagtypekalender'));
  }, { boodschap: 'De dagtypekalender kon niet laden.' });
  const foutZonderData = !!zl.fout && data === null;

  const dagenVanMaand = useMemo(() => (data?.dagen ?? []).filter((d) => d.datum.startsWith(`${maand}-`)), [data, maand]);
  const afwijkingPerDag = useMemo(() => new Map((data?.afwijkingen ?? []).map((a) => [a.datum, a])), [data]);
  const leeg = (data?.samenvatting.aantal ?? 0) === 0;

  const kiesBestand = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const bestand = e.target.files?.[0];
    if (e.target) e.target.value = '';
    if (!bestand) return;
    try {
      const rijen = await rijenUitBestand(bestand);
      const uit = kalenderUitRijen(rijen);
      if (uit.dagen.length === 0) {
        notify(uit.overgeslagen[0]?.reden ?? 'Geen dagen gevonden in het bestand. Verwacht de kolommen datum, typedag en max_verlof.', 'error');
        return;
      }
      setImportKlaar({ ...uit, bestand: bestand.name });
    } catch {
      notify('Het bestand kon niet gelezen worden. Controleer of het een CSV of Excel-bestand is.', 'error');
    }
  };

  const bevestigImport = async () => {
    if (!importKlaar || bezig) return;
    setBezig(true);
    try {
      const res = await apiFetch('/api/dagtypekalender', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dagen: importKlaar.dagen }) });
      if (!res.ok) throw await foutUitAntwoord(res);
      const uit = await res.json() as { aantal: number; nieuw: number; gewijzigd: number };
      notify(`${uit.aantal} dagen ingelezen: ${uit.nieuw} nieuw, ${uit.gewijzigd} gewijzigd.`, 'success');
      setImportKlaar(null);
      setMaand(importKlaar.dagen[0].datum.slice(0, 7));
      await zl.opnieuw();
    } catch (err) {
      meldSchrijffout('Dagtypekalender importeren', err);
    } finally {
      setBezig(false);
    }
  };

  const exporteer = () => {
    const dagen = data?.dagen ?? [];
    const blob = new Blob([csvTekst(kalenderRijen(dagen))], { type: 'text/csv;charset=utf-8;' });
    void downloadBlob(`typedagen_${dagen[0]?.datum.slice(0, 4) ?? 'kalender'}.csv`, blob);
  };

  const zijvak = data && !leeg ? (
    <Zijvak titel="Overzicht">
      <ZijvakRij label="Dagen" waarde={data.samenvatting.aantal} />
      <ZijvakRij label="Periode" waarde={`${formatDatumDMJ(data.samenvatting.eerste ?? '')} t/m ${formatDatumDMJ(data.samenvatting.laatste ?? '')}`} />
      {data.samenvatting.perRegime.map((r) => <ZijvakRij key={r.regime} label={REGIME_LABEL[r.regime] ?? r.regime} waarde={r.aantal} />)}
      <ZijvakTekst>Het dagtype bepaalt welke tijden een dienst rijdt (afwijkingen per dagtype in het Dienstoverzicht) en hoeveel chauffeurs die dag tegelijk met verlof mogen. De code in de planningsmatrix gaat altijd voor.</ZijvakTekst>
    </Zijvak>
  ) : undefined;

  return (
    <PageShell>
      <PageHeader
        view="dagtypekalender"
        title="Dagtypekalender"
        description="Welk De Lijn-dagtype elke dag heeft en hoeveel verlof er dan kan."
        actions={(
          <>
            <VersheidRegel {...zl.versheid} verversen={zl.verversen || zl.laden} />
            <input ref={bestandRef} type="file" accept=".csv,.txt,.xlsx,.xls" className="hidden" onChange={(e) => { void kiesBestand(e); }} />
            {!foutZonderData && (
              <ActieMenu
                label="Meer acties"
                align="left"
                items={[{ label: 'CSV downloaden', icon: <Download size={16} />, disabled: leeg, onClick: exporteer }]}
              />
            )}
            {magBeheren && !foutZonderData && (
              <Button variant="primary" icon={<Upload size={16} />} disabled={data === null} onClick={() => bestandRef.current?.click()}>CSV importeren</Button>
            )}
          </>
        )}
      />
      {zl.fout && <Foutkaart boodschap={zl.fout} offline={!zl.online} onOpnieuw={zl.opnieuw} bezig={zl.laden} compact={data !== null} className={data !== null ? 'mb-6' : undefined} />}
      {!foutZonderData && data && (
        <ZijvakLayout zijvak={zijvak}>
          {data.afwijkingen.length > 0 && (
            <Callout tone="warning" title={`De planningsmatrix draagt op ${data.afwijkingen.length === 1 ? 'één dag' : `${data.afwijkingen.length} dagen`} een ander dagtype dan de kalender`}>
              De matrix gaat voor, dit is een opmerking: {data.afwijkingen.slice(0, 6).map((a) => `${formatDatumDMJ(a.datum)} (matrix ${a.matrix}, kalender ${a.kalender})`).join(', ')}{data.afwijkingen.length > 6 ? ` en ${data.afwijkingen.length - 6} meer` : ''}.
            </Callout>
          )}
          {leeg ? (
            <EmptyState
              title="Nog geen dagtypekalender"
              message={magBeheren ? 'Importeer het CSV met de typedagen van De Lijn: één rij per datum met de kolommen datum, typedag en max_verlof.' : 'Een admin importeert het CSV met de typedagen van De Lijn.'}
              action={magBeheren ? <Button variant="secondary" icon={<Upload size={16} />} onClick={() => bestandRef.current?.click()}>CSV importeren</Button> : undefined}
            />
          ) : (
            <TableShell
              label="Dagtypes per dag"
              kop={(
                <div className="flex flex-wrap items-center gap-2">
                  <IconButton label="Vorige maand" size="sm" onClick={() => setMaand((m) => maandPlus(m, -1))}><ChevronLeft size={16} /></IconButton>
                  <MaandInput value={maand} onChange={setMaand} wisbaar={false} aria-label="Maand" className="w-40" />
                  <IconButton label="Volgende maand" size="sm" onClick={() => setMaand((m) => maandPlus(m, 1))}><ChevronRight size={16} /></IconButton>
                  <span className="text-micro ml-auto">{dagenVanMaand.length} dagen</span>
                </div>
              )}
            >
              {dagenVanMaand.length === 0 ? (
                <div className="p-6">
                  <EmptyState title={`Geen dagen voor ${maandLabel(maand)}`} message="De kalender kent deze maand niet. Importeer het CSV van dat jaar." />
                </div>
              ) : (
                <Tabel>
                  <StickyThead>
                    <tr>
                      <Th className="px-3">Datum</Th>
                      <Th className="px-3">Dagtype</Th>
                      <Th className="px-3">Regime</Th>
                      <Th className="px-3 text-right">Max. verlof</Th>
                      <Th className="px-3">Opmerking</Th>
                    </tr>
                  </StickyThead>
                  <tbody>
                    {dagenVanMaand.map((d) => {
                      const afwijking = afwijkingPerDag.get(d.datum);
                      const regime = regimeVan(d.typedag);
                      const weekend = regime === 'zaterdag' || regime === 'zondag' || regime === 'feestdag';
                      return (
                        <tr key={d.datum} className="border-b border-hairline-subtle last:border-b-0">
                          <Td nowrap className="px-3 font-semibold text-slate-800">
                            <span className="text-slate-500 font-medium">{weekdagKortVan(d.datum)}</span> {formatDatumDMJ(d.datum)}
                          </Td>
                          <Td nowrap className="px-3"><Chip title={dagtypeLabel(d.typedag)}>{d.typedag}</Chip></Td>
                          <Td nowrap className={`px-3 ${weekend ? 'text-slate-500' : 'text-slate-700'}`}>{regimeTekst(d.typedag)}</Td>
                          <Td num className="px-3">{d.maxVerlof ?? '—'}</Td>
                          <Td className="px-3">
                            {afwijking && <Badge tone="amber" stil>matrix zegt {afwijking.matrix}</Badge>}
                            {!afwijking && d.bron === 'hand' && <Badge tone="slate" stil>aangepast</Badge>}
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Tabel>
              )}
            </TableShell>
          )}
        </ZijvakLayout>
      )}

      <ConfirmationModal
        open={!!importKlaar}
        onClose={() => setImportKlaar(null)}
        onConfirm={bevestigImport}
        title="Dagtypekalender importeren"
        message={importKlaar ? `${importKlaar.dagen.length} dagen gevonden in ${importKlaar.bestand}, van ${formatDatumDMJ(importKlaar.dagen[0].datum)} t/m ${formatDatumDMJ(importKlaar.dagen[importKlaar.dagen.length - 1].datum)}. Dagen die al in de kalender staan worden overschreven, andere dagen blijven staan.` : ''}
        confirmText="Importeren"
        variant="warning"
      >
        {importKlaar && importKlaar.overgeslagen.length > 0 && (
          <div className="space-y-1 text-body-sm text-slate-600">
            <p className="font-medium text-amber-700">{importKlaar.overgeslagen.length === 1 ? 'Eén rij wordt' : `${importKlaar.overgeslagen.length} rijen worden`} overgeslagen:</p>
            <ul className="list-disc space-y-0.5 pl-5">
              {importKlaar.overgeslagen.slice(0, 5).map((o) => <li key={o.regel}>Regel {o.regel}: {o.reden}</li>)}
              {importKlaar.overgeslagen.length > 5 && <li>en {importKlaar.overgeslagen.length - 5} meer</li>}
            </ul>
          </div>
        )}
      </ConfirmationModal>
    </PageShell>
  );
}
