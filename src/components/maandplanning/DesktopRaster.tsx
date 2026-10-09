import { TriangleAlert } from 'lucide-react';
import { cn } from '../../lib/ui';
import { microLabelClass } from '../primitives';
import { StickyThead } from '../Table';
import { Th, Tabel, TableShell } from '../TabelBasis';
import { typedagLabel } from '../../lib/typedag';
import { formatDayLong, MONTH_NAMES } from '../../lib/format';
import { celTextClass } from '../../lib/planningKind';
import type { MonthCell } from '../../lib/monthPlanning';
import { celTitel, dayHeader, noteKey, sectieLabel, type Cellen, type Chauffeur, type Sectie } from '../../lib/maandplanning';
import { SECTIE_BAND, SECTIE_KOP, SECTIE_STREEP } from './sectiekop';

/**
 * Desktop: Excel-achtig maandgrid (chauffeur × dag) van de Maandplanning,
 * verplaatst uit CapacityView.tsx op 09-10 (stap 1 van de splitsing). De
 * view houdt alle toestand; dit raster tekent alleen en meldt een tik op
 * een cel via `onCel`.
 */
type Props = {
  /** De 14 dagen van het venster. */
  visibleDates: string[];
  todayIso: string;
  /** Chauffeurs per sectie, in de volgorde van de API. */
  gridSecties: Sectie[];
  showSections: boolean;
  cells: Cellen;
  /** Id van de ingelogde gebruiker: zijn rij krijgt stip en vet. */
  ownId: string;
  notes: Map<string, string>;
  onCel: (drv: Chauffeur, iso: string, cell: MonthCell) => void;
};

export function DesktopRaster({ visibleDates, todayIso, gridSecties, showSections, cells, ownId, notes, onCel }: Props) {
  return (
    /* .mp-*-klassen (weekend-arcering, opake sticky-cellen) staan in
       index.css bij de andere component-klassen. */
    /* Desktop: Excel-achtig maandgrid (chauffeur × dag) — dunne gridlijnen,
       platte dienstnummers, gearceerde weekend-kolommen.
       TableShell `sticky` (tranche 3B): onder xl schuift het raster in
       zijn kader met de naamkolom vast links; vanaf xl past het venster
       van 14 dagen in het kader en plakt de dagkop onder de topbar
       terwijl je door de chauffeurs scrollt. Vroeger plakte er
       verticaal niets: de kaart had overflow-hidden. */
    <TableShell label="Maandplanning per chauffeur en dag" sticky className="hidden md:block">
      <Tabel>
        {/* De dagkop draagt een dikke lijn eronder (zoals het bord), niet de dunne van StickyThead. */}
        <StickyThead className="[&_th]:border-b-2 [&_th]:border-hairline-strong">
          <tr>
            <Th className="mp-sticky sticky left-0 z-sticky-hoek min-w-[180px] border-r-2 border-hairline-strong bg-surface-muted">
              <span className={microLabelClass}>Chauffeur</span>
            </Th>
            {visibleDates.map((iso) => {
              const h = dayHeader(iso);
              const today = iso === todayIso;
              // De Lijn-typedag, alleen nog de feestdag (F, carbon vet):
              // die bepaalt welke dienstregeling rijdt. Een typedag is
              // informatie, geen status en geen "nu": neutraal, geen
              // goud (tranche 3B, 23-09). Goud blijft hier alleen voor
              // vandaag (= "nu") en de sectiestreep (Jarno 08-09). De V van
              // schoolvakantie is eruit op vraag van Jarno (17-09),
              // die zegt niets over wie er rijdt.
              const td = typedagLabel(iso);
              const feestdag = td?.kort === 'F';
              // Maandafkorting onder élke dag (Jarno 17-09): stond
              // eerst alleen bij dagen uit de ándere maand van het
              // 2-wekenvenster, waardoor de ene week een maand toonde
              // en de andere niet.
              const maandKort = (MONTH_NAMES[Number(iso.slice(5, 7)) - 1] ?? '').slice(0, 3).toLowerCase();
              return (
                <Th
                  key={iso}
                  title={feestdag ? td?.titel : undefined}
                  className={cn(
                    'px-1 py-2 text-center',
                    h.isMonday ? 'border-l-2 border-l-slate-400' : 'border-l border-hairline',
                    today ? 'bg-oker-100' : h.weekend ? 'mp-weekend' : 'bg-surface-soft',
                  )}
                >
                  {/* Zichtbaar: letter, dag, maand; voorgelezen: de volledige dag. */}
                  <span className="sr-only">{formatDayLong(iso)}{feestdag ? ', feestdag' : ''}{today ? ', vandaag' : ''}</span>
                  <span aria-hidden="true">
                    <span className={cn(microLabelClass, 'block')}>{h.letter}</span>
                    <span className={cn('mt-0.5 block text-xs font-semibold', today ? 'text-oker-700' : 'text-slate-700')}>{h.day}</span>
                    {/* 2xs: matrixcel van 3 px-hoog label onder de dag, dichte planningsmatrix */}
                    <span className="mt-0.5 block h-3 text-2xs font-bold leading-3">
                      <span className={microLabelClass}>{maandKort}</span>
                      {feestdag && <span className="ml-1 text-slate-900">F</span>}
                    </span>
                  </span>
                </Th>
              );
            })}
          </tr>
        </StickyThead>
        {/* Eén tbody per sectie (Chauffeurs, Flexi/invallers…): de
            sectiekop is dan een echte kop over die groep rijen. */}
        {gridSecties.map((sectie) => (
          <tbody key={sectie.naam}>
            {showSections && (
              <tr>
                {/* Label alleen in de vaste eerste cel; de dag-cellen
                    van de band behouden weekend-arcering en de
                    vandaag-markering, zodat die verticale gidsen
                    niet per sectie onderbroken worden. */}
                <Th scope="rowgroup" className={cn('mp-sticky sticky left-0 z-sticky p-0 border-r-2 border-r-slate-300', SECTIE_BAND)}>
                  <span className={cn('flex h-8 items-center px-4', SECTIE_KOP)}>
                    {SECTIE_STREEP}
                    {sectieLabel(sectie.naam)}
                  </span>
                </Th>
                {visibleDates.map((iso) => {
                  const h = dayHeader(iso);
                  return (
                    <td
                      key={iso}
                      className={cn(
                        'mp-sectie p-0 border-l',
                        h.isMonday && 'mp-sectie-ma',
                      )}
                    />
                  );
                })}
              </tr>
            )}
            {sectie.drivers.map((drv) => {
              const row = cells[drv.id] || {};
              const isOwn = ownId && drv.id === ownId;
              return (
                <tr key={drv.id} className="group border-b border-hairline bg-surface-white">
                  {/* Rijkop: de naam. Je eigen rij krijgt een neutrale stip
                      en vet, geen goud (goud = actie, focus, nu). */}
                  <Th
                    scope="row"
                    className={cn(
                      'mp-sticky sticky left-0 z-sticky min-w-[180px] truncate border-r-2 border-hairline-strong bg-surface-white px-4 py-2 text-sm text-slate-800 transition-colors group-hover:bg-surface-soft-hover',
                      isOwn ? 'font-bold' : 'font-semibold',
                    )}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {isOwn && <span className="size-1.5 shrink-0 rounded-full bg-slate-700" aria-hidden="true" />}
                      {drv.name}
                      {isOwn && <span className="sr-only"> (jij)</span>}
                    </span>
                  </Th>
                  {visibleDates.map((iso) => {
                    const cell = row[iso];
                    const h = dayHeader(iso);
                    const today = iso === todayIso;
                    return (
                      <td
                        key={iso}
                        className={cn(
                          'p-0 text-center',
                          h.isMonday ? 'border-l-2 border-l-slate-400' : 'border-l border-hairline',
                          today ? 'bg-oker-100/60' : h.weekend ? 'mp-weekend' : '',
                          // Lege cel: stippen (anders dan de weekendarcering), Jarno 08-09.
                          !cell && 'mp-leeg',
                        )}
                      >
                        {cell ? (
                          // rauw: gridcel van de maandplanning (Excel-look, h-7, eigen kleurtaal)
                          <button
                            type="button"
                            onClick={() => onCel(drv, iso, cell)}
                            className={cn(
                              // 2xs: dichte bezettingsmatrix, 12 px laat de kolommen wrappen.
                              // Hover = neutrale binnenrand, geen goud (tranche 3B).
                              'relative flex h-7 w-full cursor-pointer items-center justify-center px-1 text-2xs transition-colors hover:ring-1 hover:ring-inset hover:ring-hairline-strong',
                              // Gewisselde cel in het geel en ziekte in
                              // het rood (Jarno 08-09; ruil was rood sinds
                              // 15-08): afwijkingen van de Excel moet je
                              // in één oogopslag zien.
                              celTextClass(cell),
                            )}
                            title={celTitel(cell, notes.has(noteKey(String(drv.id), iso)))}
                          >
                            {cell.code}
                            {/* Dienst staat nog open onder een afwezigheid:
                                dít is het werk dat wacht. */}
                            {cell.hiddenService && (
                              <TriangleAlert size={12} className="absolute left-0.5 top-0.5 text-amber-700" aria-label="dienst nog niet herverdeeld" />
                            )}
                            {notes.has(noteKey(String(drv.id), iso)) && (
                              // Notitie = informatie, geen "nu": neutrale stip (slate-600 spiegelt mee in donker), geen goud.
                              <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-slate-600" aria-label="notitie aanwezig" />
                            )}
                          </button>
                        ) : (
                          <div className="h-7" />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        ))}
      </Tabel>
    </TableShell>
  );
}
