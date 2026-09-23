import { useCallback, useMemo, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import { useRoute } from '../../app/router';
import { Foutkaart, PageHeader, PageShell, VersheidRegel } from '../../components/ui';
import { apiFetch } from '../../lib/api';
import { isoDate } from '../../lib/datum';
import { useZelfLadend, type Versheid } from '../../lib/zelfLadend';
import { SkeletonTile } from '../../components/Skeleton';
import { Button } from '../../components/primitives';
import { TermijnKeuze, downloadXlsx } from './laadpalen/gedeeld';
import { LiveTab, type Dashboard } from './laadpalen/LiveTab';
import { MaandTab, paramUitPeriode, periodeUitParam, type MaandData, type PeriodeKeuze } from './laadpalen/MaandTab';
import { HistoriekTab } from './laadpalen/HistoriekTab';
import { SessiesTab } from './laadpalen/SessiesTab';
import { DagDetail } from './laadpalen/DagDetail';

/**
 * Laadpalen (herwerking 08-09-2026): één go-to-plek voor alles wat laden en
 * verbruik betreft, in vier tabbladen die elk hun eigen vraag beantwoorden:
 *
 *  - Live: wat hangt er nú aan de lader (KPI's, 24u-curve, sessies, palen, storingen).
 *  - Maand: de maandrapportage (verbruik, kwartierpiek, per dag, per laadpunt), ook vrije periode.
 *  - Historiek: alle maanden naast elkaar, jaartotalen, laadpunt × maand.
 *  - Sessies: elke laadsessie met alle details, filterbaar en exporteerbaar.
 *
 * De URL is de bron: /beheer/laadpalen[/maand/2026-08 | /historiek | /sessies].
 * Excel-export (server, api/_lib/ocpiExport.ts) per maand/periode en voor de
 * historiek; CSV per tabel in de tabbladen zelf; dagdetail als dialoog.
 */

type Tab = 'live' | 'maand' | 'historiek' | 'sessies';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'live', label: 'Live' },
  { id: 'maand', label: 'Maand' },
  { id: 'historiek', label: 'Historiek' },
  { id: 'sessies', label: 'Sessies' },
];
const isTab = (s: string | undefined): s is Tab => TABS.some((t) => t.id === s);

export function OcpiDashboardView() {
  const { params, navigeer } = useRoute();
  const tab: Tab = isTab(params[0]) ? params[0] : 'live';
  // Gememoïseerd op de string: als object per render zou elke setState in
  // deze schil (bv. onGeladen) het maand-effect opnieuw laten ophalen.
  const periodeParam = tab === 'maand' ? (params[1] ?? null) : null;
  const periodeKeuze = useMemo(() => periodeUitParam(periodeParam), [periodeParam]);
  const gaNaar = useCallback((naar: Tab, extra: string[] = [], replace = false) => {
    navigeer('ocpi-monitoring', { params: naar === 'live' && extra.length === 0 ? [] : [naar, ...extra], replace });
  }, [navigeer]);
  const zetPeriode = useCallback((k: PeriodeKeuze) => gaNaar('maand', [paramUitPeriode(k)], true), [gaNaar]);

  // Live-data wordt hier geladen (de KPI's boven het Live-tabblad); de andere
  // tabbladen halen hun eigen data op (zelf-ladend, golf 3) en melden hun
  // versheid, zodat de kop altijd die van het open tabblad toont.
  const [data, setData] = useState<Dashboard | null>(null);
  const zl = useZelfLadend(async () => {
    const response = await apiFetch('/api/ocpi/dashboard');
    if (!response.ok) throw new Error(String(response.status));
    setData(await response.json());
  }, { boodschap: 'Kon de laadpaalgegevens niet laden.' });
  const [tabVersheid, setTabVersheid] = useState<Versheid | null>(null);
  const versheid = tab === 'live' ? zl.versheid : tabVersheid;

  const [dag, setDag] = useState<string | null>(null);
  const [maandData, setMaandData] = useState<MaandData | null>(null);
  const [exporteert, setExporteert] = useState(false);
  const exporteer = async () => {
    setExporteert(true);
    try {
      if (tab === 'historiek') await downloadXlsx('/api/ocpi/historiek?format=xlsx', `vhb-laadplein-historiek-${isoDate(new Date())}.xlsx`);
      else {
        const k = periodeKeuze ?? { modus: 'maand' as const, maand: maandData?.maand ?? isoDate(new Date()).slice(0, 7) };
        const q = k.modus === 'maand' ? `maand=${k.maand}` : `van=${k.van}&tot=${k.tot}`;
        await downloadXlsx(`/api/ocpi/export?${q}`, `vhb-laadplein-${paramUitPeriode(k)}.xlsx`);
      }
    } finally {
      setExporteert(false);
    }
  };

  return (
    <PageShell>
      <PageHeader
        view="ocpi-monitoring"
        title="Laadpalen"
        actions={(
          <>
            {(tab === 'maand' || tab === 'historiek') && (
              <Button variant="secondary" icon={<FileSpreadsheet size={16} />} onClick={exporteer} disabled={exporteert} title="Volledig werkboek met alle tabellen">
                Excel
              </Button>
            )}
            {versheid && <VersheidRegel {...versheid} />}
          </>
        )}
      />

      <TermijnKeuze label="Onderdeel" telefoon="vol" waarde={tab} opties={TABS} onKies={(t) => gaNaar(t, t === 'maand' && periodeKeuze ? [paramUitPeriode(periodeKeuze)] : [])} />

      {tab === 'live' && (
        zl.fout && !data ? (
          <Foutkaart boodschap={zl.fout} offline={!zl.online} onOpnieuw={zl.opnieuw} bezig={zl.laden} />
        ) : !data ? (
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => <SkeletonTile key={i} />)}
          </div>
        ) : (
          <LiveTab data={data} onDag={setDag} />
        )
      )}
      {tab === 'maand' && <MaandTab keuze={periodeKeuze} zetKeuze={zetPeriode} onDag={setDag} onGeladen={setMaandData} onVersheid={setTabVersheid} />}
      {tab === 'historiek' && <HistoriekTab onMaand={(m) => gaNaar('maand', [m])} onVersheid={setTabVersheid} />}
      {tab === 'sessies' && <SessiesTab onVersheid={setTabVersheid} />}

      <DagDetail dag={dag} onSluit={() => setDag(null)} onDag={setDag} eersteDag={maandData?.eersteDag ?? null} />
    </PageShell>
  );
}
