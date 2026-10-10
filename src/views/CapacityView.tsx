import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, Table2 } from 'lucide-react';
import { downloadBlob, notify } from '../lib/ui';
import { EmptyState, Foutkaart, PageHeader, PageShell } from '../components/ui';
import { ActieMenu } from '../components/ActieMenu';
import { apiFetch } from '../lib/api';
import { SkeletonRow } from '../components/Skeleton';
import { Button, IconButton } from '../components/primitives';
import { Card } from '../components/Card';
import { SearchField } from '../components/Field';
import { meldSchrijffout } from '../lib/fouten';
import { isoDate } from '../lib/availability';
import type { MonthPlanning } from '../lib/monthPlanning';
import { isStaf } from '../types';
import type { User } from '../types';
import { formatDatumDMJ, hoofdletter, MONTH_NAMES } from '../lib/format';
import { useRecordParam, useRouteParam } from '../app/router';
import { eersteZichtbareDag } from '../../shared/maandplanningTerugblik';
import {
  berekenCodeLegend, bouwDagRijen, groepeerPerSectie, maandNaarParam, maandUitParam, monthOf, noteKey,
  voegCellenSamen, voegChauffeursSamen, werkdagenUitCellen, WISSEL_REDENEN, wisselOverzichtSortering,
  type MaandOverzicht, type OverzichtRij, type OverzichtSortering,
} from '../lib/maandplanning';
import { DesktopRaster } from '../components/maandplanning/DesktopRaster';
import { Legende } from '../components/maandplanning/Legende';
import { CelDetailModal } from '../components/maandplanning/CelDetailModal';
import { MaandoverzichtModal } from '../components/maandplanning/MaandoverzichtModal';
import { DagWeergave } from '../components/maandplanning/DagWeergave';
import { useCelDetail } from '../components/maandplanning/useCelDetail';
import { useDienstwissel } from '../components/maandplanning/useDienstwissel';
import { useImportGrenzen, useMaandLaden, useTweewekenVenster } from '../components/maandplanning/useTweewekenVenster';

/**
 * Maandplanning — read-only weergave van de planning-matrix (chauffeur ×
 * datum met codes), zoals het overzicht dat in het chauffeurslokaal hangt.
 * Zichtbaar voor iedereen zodat collega's wissels kunnen vinden.
 *
 * Sinds 09-10 (stap 1 tot 3 van de splitsing, zoals App.tsx): de pure helpers
 * (datums, URL-maand, samenvoegen van twee maanden, dagrijen, legende,
 * maandoverzicht) staan in src/lib/maandplanning.ts; het desktopraster, de
 * legende, het celdetail met de dienstwissel, het maandoverzicht-venster en
 * de mobiele dagweergave (datumstrip + daglijst) in
 * src/components/maandplanning/, net als de hooks voor het celdetail met de
 * notities (useCelDetail), de dienstwissel met het terugdraaien
 * (useDienstwissel) en het tweewekenvenster met het laden en de grenzen van
 * de import (useTweewekenVenster, useMaandLaden, useImportGrenzen). Wat meer
 * dan één hook leest (de hoofdmaand, de geladen maanden, het bord, de
 * herlaadtik) blijft hier, net als de export, het maandoverzicht en de
 * mobiele dag-weergave.
 */
export function CapacityView({ currentUser }: { currentUser: User }) {
  const ownId = String(currentUser?.id ?? '');
  const [maandParam, zetMaandParam] = useRouteParam(0);
  // Gekozen dag van de mobiele dag-weergave in de URL (segment ná de maand:
  // /maandplanning/2026-09/2026-09-15), zie het state-blok "Mobiel:
  // dag-weergave" verderop. Alleen een tik schrijft; de automatische keuze
  // (vandaag / eerste dag) blijft buiten de URL.
  const [dagParam, zetDagParam] = useRecordParam(1, { view: 'bezetting' });
  // De maand waarop het scherm opent: die uit de URL. Wie geen staf is ziet
  // niets van vóór de maandag van deze week (shared/maandplanningTerugblik.ts);
  // een oude link naar een vroegere maand of dag telt voor hem dus niet en
  // het bord opent op nu, in plaats van leeg. De maand-naar-URL-spiegel
  // (useTweewekenVenster) zet de adresbalk daarna recht, met replace.
  const [startMaand] = useState(() => {
    const uitUrl = maandUitParam(maandParam);
    if (!uitUrl || isStaf(currentUser.role)) return uitUrl;
    const vanaf = eersteZichtbareDag();
    return maandNaarParam(uitUrl) < monthOf(vanaf) || (!!dagParam && dagParam < vanaf) ? null : uitUrl;
  });
  const [viewMonth, setViewMonth] = useState(() => {
    const now = new Date();
    return startMaand ?? new Date(now.getFullYear(), now.getMonth(), 1);
  });
  // De hoofdmaand en de maand achter de vensterrand (geladen door
  // useMaandLaden; het bord, de dienstwissel en de grenzen lezen ze).
  const [data, setData] = useState<MonthPlanning | null>(null);
  const [extraData, setExtraData] = useState<MonthPlanning | null>(null);

  const year = viewMonth.getFullYear();
  const monthIndex = viewMonth.getMonth();
  const monthParam = `${year}-${String(monthIndex + 1).padStart(2, '0')}`;
  const todayIso = isoDate(new Date());

  const canEditNotes = isStaf(currentUser.role);
  const monthFrom = `${year}-${String(monthIndex + 1).padStart(2, '0')}-01`;
  const monthTo = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(new Date(year, monthIndex + 1, 0).getDate()).padStart(2, '0')}`;
  // Celdetail: de geopende cel en de dienstnotities van de maand.
  const cel = useCelDetail({ monthFrom, monthTo });
  const { selected } = cel;

  // Handmatige dienstwissel — alleen voor admins zichtbaar (server dwingt de
  // rol óók af via requireRole). 'reloadTick' herlaadt de maand na een wissel,
  // zodat de dienst meteen bij de nieuwe chauffeur staat.
  const isAdmin = currentUser.role === 'admin';

  // Excel-terugexport (staf): de actuele maand — wissels, toewijzingen en
  // afwezigheid verwerkt — in het her-importeerbare praktijk-tab-formaat.
  const [isExporteren, setIsExporteren] = useState(false);
  const exporteerExcel = async () => {
    if (isExporteren) return;
    setIsExporteren(true);
    try {
      const res = await apiFetch(`/api/month-planning?month=${monthParam}&format=xlsx`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({} as any));
        meldSchrijffout('Exporteren', { status: res.status, message: body.error }, () => void exporteerExcel());
        return;
      }
      // Alleen een eigen toast als het bestand ook echt lokaal geland is;
      // downloadBlob handelt het deelblad en de verlopen-gesture-tik zelf af.
      const uitkomst = await downloadBlob(`planning-${monthParam}.xlsx`, await res.blob());
      if (uitkomst === 'gedownload') notify('Dit is de actuele stand, direct her-importeerbaar.', 'success');
    } catch (err) {
      meldSchrijffout('Exporteren', err, () => void exporteerExcel());
    } finally {
      setIsExporteren(false);
    }
  };
  // Maandoverzicht-venster (verbeterronde 22-08, nr. 3): dezelfde telling als
  // het xlsx-tabblad (gedeelde server-berekening), maar als sorteerbare tabel
  // — voor de snelle blik zonder download. Types, kolommen en sortering staan
  // in src/lib/maandplanning.ts, het venster zelf is MaandoverzichtModal.
  const [overzichtOpen, setOverzichtOpen] = useState(false);
  const [overzichtLaden, setOverzichtLaden] = useState(false);
  const [overzicht, setOverzicht] = useState<MaandOverzicht | null>(null);
  const [overzichtSort, setOverzichtSort] = useState<OverzichtSortering>({ kolom: 'naam', richting: 1 });
  const openOverzicht = async () => {
    setOverzichtOpen(true);
    setOverzichtLaden(true);
    try {
      const res = await apiFetch(`/api/month-planning?month=${monthParam}&format=summary`);
      const body = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        meldSchrijffout('Overzicht laden', { status: res.status, message: body.error }, () => void openOverzicht());
        setOverzichtOpen(false);
        return;
      }
      setOverzicht(body);
    } catch (err) {
      meldSchrijffout('Overzicht laden', err, () => void openOverzicht());
      setOverzichtOpen(false);
    } finally {
      setOverzichtLaden(false);
    }
  };
  const sorteerOverzicht = (kolom: keyof OverzichtRij) =>
    setOverzichtSort((cur) => wisselOverzichtSortering(cur, kolom));

  const [reloadTick, setReloadTick] = useState(0);
  const herlaad = () => setReloadTick((t) => t + 1);

  const dates = data?.dates ?? [];
  // Chauffeurs en cellen van hoofd- én extra maand samen (venster over een
  // maandgrens); de hoofdmaand bepaalt de volgorde. Defensief: een lege of
  // onverwachte respons voor de extra maand mag het scherm niet laten
  // crashen (extraData zonder drivers).
  const drivers = useMemo(() => voegChauffeursSamen(data?.drivers ?? [], extraData?.drivers ?? []), [data, extraData]);
  const cells = useMemo(() => voegCellenSamen(data?.cells ?? {}, extraData?.cells ?? {}), [data, extraData]);
  // Werkdagen per chauffeur uit de maandcellen, voedt de vervanger-sortering
  // (minst gewerkt die week eerst); de regel staat in src/lib/maandplanning.ts.
  const werkdagenPerChauffeur = useMemo(() => werkdagenUitCellen(cells), [cells]);

  // Dienstwissel en terugdraaien op de geopende cel.
  const wissel = useDienstwissel({ selected, sluit: cel.sluit, drivers, cells, herlaad });
  // Onbewaarde invoer in de celdetail: een gewijzigde notitie of een
  // begonnen dienstwissel. Sluiten vraagt dan eerst bevestiging.
  const celVuil = !!selected && (
    (canEditNotes && cel.noteDraft !== (cel.notes.get(noteKey(selected.driverId, selected.iso)) ?? ''))
    || wissel.wisselNaar !== '' || wissel.wisselToelichting !== '' || wissel.wisselReden !== WISSEL_REDENEN[0]
  );

  // Het tweewekenvenster (desktop) met de maand in de URL, het laden van de
  // twee maanden en de grenzen van de import; in deze volgorde.
  const venster = useTweewekenVenster({ startMaand, monthParam, maandParam, zetMaandParam, dagParam, setViewMonth, todayIso });
  const zl = useMaandLaden({ monthParam, windowDates: venster.windowDates, reloadTick, setReloadTick, setData, setExtraData });
  const { laatsteDag, beginUitleg, maandVoorbij, kanTerug, kanVooruit, kanMaandTerug, kanMaandVooruit } = useImportGrenzen({
    data, extraData, monthParam, year, monthIndex, windowStart: venster.windowStart, setWindowStart: venster.setWindowStart, setViewMonth,
  });
  const goToday = () => {
    venster.naarVandaag();
    // Mobiele dag-weergave springt mee; valt vandaag buiten de al geladen
    // maand, dan corrigeert het dates-effect zodra de nieuwe maand binnen is.
    setMobielDag(todayIso);
  };

  const visibleDates = venster.windowDates;

  // Ook een venster dat alleen in de extra maand planning heeft telt als data.
  const hasData = (dates.length > 0 || (extraData?.dates?.length ?? 0) > 0) && drivers.length > 0;

  // Sectie-koppen tonen zodra minstens één chauffeur een sectie heeft (anders
  // gedraagt de lijst zich als voorheen — één alfabetische groep, geen koppen).
  // De API levert 'drivers' al gesorteerd op sectie → naam, dus we hoeven enkel
  // een kop te tonen wanneer de sectie t.o.v. de vorige chauffeur wisselt.
  const showSections = drivers.some((d) => !!d.section);

  // === Mobiel: dag-weergave (keuze Jarno 15-08) =============================
  // Op een telefoon is de vraag "wie doet wat op dag X?", niet "wat doet
  // chauffeur Y de hele maand?" (daarvoor bestaat Mijn rooster). De oude
  // mobiele lijst was chauffeur-per-chauffeur: ~39 kaarten × 14 dagregels
  // scrollen zonder ooit één dag in z'n geheel te zien. Nu: één gekozen dag,
  // alle chauffeurs in één kolom, gegroepeerd per sectie en gesorteerd op
  // dienstnummer — leest als het bord in het chauffeurslokaal.
  const [mobielDag, setMobielDag] = useState<string | null>(null);
  const [toonRust, setToonRust] = useState(false);
  useEffect(() => {
    if (dates.length === 0) { setMobielDag(null); return; }
    // De dag uit de URL (deeplink, refresh, terugknop) wint zolang hij in de
    // geladen maand valt; anders vandaag als die erin valt, anders de eerste
    // dag. Een al geldige keuze blijft staan (maandwissel reset, dagwissel
    // niet). Een dag die niet in deze maand ligt (oude maand, typefout) gaat
    // stil uit de URL: /maandplanning/2026-10/2026-09-15 zegt niets.
    const uitUrl = dagParam && dates.includes(dagParam) ? dagParam : null;
    if (dagParam && !uitUrl) zetDagParam(null);
    setMobielDag((cur) => uitUrl ?? (cur && dates.includes(cur) ? cur : (dates.includes(todayIso) ? todayIso : dates[0])));
  }, [dates, todayIso, dagParam, zetDagParam]);
  // Rust-groep dichtklappen bij een maandwissel (nieuwe dagenlijst), niet bij
  // elke dagwissel.
  useEffect(() => { setToonRust(false); }, [dates]);
  // Tik in de strip of op het aandachtspijltje: dag kiezen én in de URL
  // zetten (replace). De maand moet er dan vóór staan, ook voor de huidige
  // maand die anders een schone URL houdt.
  const kiesDag = (iso: string) => {
    setMobielDag(iso);
    if (!maandParam) zetMaandParam(monthParam);
    zetDagParam(iso);
  };

  // Zoeken op chauffeur óf dienstnummer: bij 39 namen scroll je anders het
  // halve scherm door, en "wie rijdt 4102?" is de omgekeerde vraag die je
  // bij een telefoontje net zo vaak krijgt. Een dienst-treffer matcht ook de
  // dienst die onder een afwezigheid ligt (hiddenService).
  const [zoek, setZoek] = useState('');
  const zoekTerm = zoek.trim().toLowerCase();
  const zichtbareDrivers = useMemo(() => {
    if (!zoekTerm) return drivers;
    return drivers.filter((d) => {
      if (d.name.toLowerCase().includes(zoekTerm)) return true;
      const rij = cells[d.id] ?? {};
      return Object.values(rij).some((c) =>
        c.code.toLowerCase().includes(zoekTerm) ||
        (c.hiddenService ?? '').toLowerCase().includes(zoekTerm),
      );
    });
  }, [drivers, cells, zoekTerm]);
  // Het desktopraster per sectie (één tbody per sectie): een nieuwe groep
  // begint waar de sectie wisselt, zie groepeerPerSectie.
  const gridSecties = groepeerPerSectie(zichtbareDrivers);

  // Dagen waar werk wacht (dienst nog niet herverdeeld onder een afwezigheid)
  // — voedt het sprong-pijltje in de strip zodat je niet dag voor dag hoeft
  // te vegen om het volgende aandachtspunt te vinden.
  const aandachtDagen = useMemo(
    () => dates.filter((iso) => zichtbareDrivers.some((d) => cells[d.id]?.[iso]?.hiddenService)),
    [dates, zichtbareDrivers, cells],
  );
  const springNaarAandacht = () => {
    if (aandachtDagen.length === 0) return;
    const volgende = aandachtDagen.find((iso) => !!mobielDag && iso > mobielDag) ?? aandachtDagen[0];
    kiesDag(volgende);
  };

  // Rijen van de mobiele dag-weergave: hoofdlijst per sectie (op dienstnummer,
  // zoals het bord in het lokaal) + ingeklapte rest-groep. Zie het state-blok
  // "Mobiel: dag-weergave" hierboven voor het waarom; de opbouw staat in
  // src/lib/maandplanning.ts (bouwDagRijen).
  const dagRijen = useMemo(() => bouwDagRijen(zichtbareDrivers, cells, mobielDag), [cells, zichtbareDrivers, mobielDag]);

  // Legende: de codes die in de héle maand voorkomen, elk met hun betekenis,
  // data-gedreven uit de cellen (berekenCodeLegend in src/lib/maandplanning.ts).
  const codeLegend = useMemo(() => berekenCodeLegend(cells), [cells]);

  // Tik op een cel (desktopraster of daglijst): het detailvenster open, met
  // de bestaande notitie van die chauffeur en dag als concept (useCelDetail).
  const onCel = cel.open;

  return (
    <PageShell breed>
      <PageHeader
        title="Maandplanning"
        description="Wie rijdt welke dienst, zoals in het chauffeurslokaal."
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            {/* Gedeeld zoekveld (loep + wisknop); op de telefoon vult het de
                regel naast Vandaag en het actiemenu. */}
            <SearchField
              value={zoek}
              onChange={setZoek}
              label="Zoek chauffeur of dienst"
              placeholder="Chauffeur of dienst…"
              enterKeyHint="search"
              size="sm"
              className="min-w-40 flex-1 sm:w-52 sm:flex-none"
            />
            {/* Het 2-weken-venster is een desktop-begrip; op mobiel navigeert
                de datumstrip (met eigen maandwissel) en is dit cluster ruis. */}
            <div className="hidden md:flex items-center gap-2">
              <IconButton
                label="Vorige 2 weken"
                title={kanTerug ? 'Vorige 2 weken' : beginUitleg}
                variant="secondary"
                size="sm"
                disabled={!kanTerug}
                onClick={venster.goPrevWindow}
              >
                <ChevronLeft size={18} />
              </IconButton>
              <span className="px-3 text-sm font-semibold min-w-[150px] text-center tabular-nums">{hoofdletter(venster.windowLabel)}</span>
              <IconButton
                label="Volgende 2 weken"
                title={kanVooruit ? 'Volgende 2 weken' : `De planning is geïmporteerd tot ${formatDatumDMJ(laatsteDag)}`}
                variant="secondary"
                size="sm"
                disabled={!kanVooruit}
                onClick={venster.goNextWindow}
              >
                <ChevronRight size={18} />
              </IconButton>
            </div>
            <Button variant="secondary" size="sm" className="ml-1" onClick={goToday}>
              Vandaag
            </Button>
            {/* Terugexport + maandoverzicht: alleen staf — sluit de Excel-
                cyclus (bewerken op de actuele stand i.p.v. de verouderde
                upload). In een actiemenu zodat de kop op mobiel niet
                stapelt (afwerking 04-09, nr. 7). */}
            {canEditNotes && (
              <ActieMenu
                size="sm"
                label="Meer acties"
                // ml-auto: op mobiel wikkelt de kop en stond de knop links,
                // waardoor het (rechts uitgelijnde) menu buiten beeld viel.
                className="ml-auto"
                items={[

                  { label: isExporteren ? 'Excel wordt gemaakt…' : 'Excel exporteren', icon: <Download size={16} />, disabled: isExporteren, onClick: () => void exporteerExcel() },
                  { label: 'Maandoverzicht', icon: <Table2 size={16} />, onClick: () => void openOverzicht() },
                ]}
              />
            )}
          </div>
        )}
      />

      {zl.fout ? (
        <Foutkaart boodschap={zl.fout} offline={!zl.online} onOpnieuw={zl.opnieuw} bezig={zl.laden} />
      ) : zl.laden || maandVoorbij ? (
        /* Skeleton i.p.v. spinner — zelfde shimmer als de rest van de app.
           Ook het ogenblik waarin een voorbije maand plaatsmaakt voor nu. */
        <Card padding="none" className="overflow-hidden">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i}>
              <SkeletonRow className="border-b border-hairline-subtle last:border-0" />
            </div>
          ))}
        </Card>
      ) : !hasData ? (
        <EmptyState
          title={`Geen planning voor ${MONTH_NAMES[monthIndex].toLowerCase()} ${year}`}
          message="Zodra de planning voor deze maand geïmporteerd is, verschijnt ze hier."
        />
      ) : (
        <>
          {/* Desktop: Excel-achtig maandgrid (chauffeur × dag), sinds 09-10 in
              src/components/maandplanning/DesktopRaster.tsx. */}
          <DesktopRaster
            visibleDates={visibleDates}
            todayIso={todayIso}
            gridSecties={gridSecties}
            showSections={showSections}
            cells={cells}
            ownId={ownId}
            notes={cel.notes}
            onCel={onCel}
          />

          {/* Mobiel: dag-weergave (datumstrip + alle chauffeurs van één dag in
              één kolom), sinds 09-10 in src/components/maandplanning/DagWeergave.tsx.
              De cel-modal met details/notitie/dienstwissel blijft dezelfde. */}
          <DagWeergave
            dag={{ dates, mobielDag, todayIso, dagRijen, showSections, ownId, notes: cel.notes, zoekTerm, toonRust, year, monthIndex, kanMaandTerug, kanMaandVooruit, beginUitleg, laatsteDag, heeftAandacht: aandachtDagen.length > 0 }}
            acties={{ kiesDag, springNaarAandacht, setViewMonth, setToonRust, onCel }}
          />

          {/* Legende: codes en markeringen van deze maand (src/components/maandplanning/Legende.tsx). */}
          <Legende legend={codeLegend} />
        </>
      )}

      {/* Celdetail (notitie, dienstwissel, terugdraaien) en het maandoverzicht:
          sinds 09-10 in src/components/maandplanning/. Het celdetail krijgt
          wat de twee hooks teruggeven, plus wat alleen de view weet. */}
      <CelDetailModal
        cel={{ ...cel, vuil: celVuil, canEditNotes, dagtype: selected ? (data?.dagtypes?.[selected.iso] ?? extraData?.dagtypes?.[selected.iso])?.periode : undefined }}
        wissel={{ ...wissel, isAdmin, drivers, cells, werkdagenPerChauffeur }}
      />

      <MaandoverzichtModal
        open={overzichtOpen}
        onClose={() => setOverzichtOpen(false)}
        monthIndex={monthIndex}
        year={year}
        laden={overzichtLaden}
        overzicht={overzicht}
        sort={overzichtSort}
        sorteer={sorteerOverzicht}
      />
    </PageShell>
  );
}
