import { Fragment, useEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { ChevronLeft, ChevronRight, TriangleAlert } from 'lucide-react';
import { cn } from '../../lib/ui';
import { Card } from '../Card';
import { Chip, IconButton, MicroLabel, microLabelClass } from '../primitives';
import { Uitklap, uitklapChevron } from '../Uitklap';
import { typedagLabel } from '../../lib/typedag';
import { KIND_CLS, celChipClass } from '../../lib/planningKind';
import type { MonthCell } from '../../lib/monthPlanning';
import { formatDatumDMJ, formatDayLong, hoofdletter, MONTH_NAMES, WEEKDAY_SHORT_MON } from '../../lib/format';
import { DUR, EASE_SPRING } from '../../lib/motion';
import { noteKey, sectieLabel, type bouwDagRijen, type Chauffeur } from '../../lib/maandplanning';
import { SECTIE_BAND, SECTIE_KOP, SECTIE_STREEP } from './sectiekop';

/**
 * Mobiel: dag-weergave van de Maandplanning (datumstrip met maandwissel +
 * alle chauffeurs van één dag in één kolom, per sectie, op dienstnummer),
 * verplaatst uit CapacityView.tsx op 09-10 (stap 2 van de splitsing). De
 * cel-modal met details/notitie/dienstwissel blijft dezelfde en staat in de
 * view. De view houdt alle toestand (gekozen dag, rustgroep, maand) en elke
 * schrijfactie; dit component krijgt de gegevens van de dag als `dag` en de
 * handlers als `acties`. Alleen wat enkel de strip dient staat hier: de
 * voorkeur voor minder beweging, de ref op de gekozen dag en het effect dat
 * die dag in beeld houdt.
 */
export type DagGegevens = {
  /** Alle dagen van de geladen maand. */
  dates: string[];
  /** De gekozen dag, null zolang er geen maand geladen is. */
  mobielDag: string | null;
  todayIso: string;
  /** Hoofdlijst per sectie + rustgroep (bouwDagRijen in src/lib/maandplanning.ts). */
  dagRijen: ReturnType<typeof bouwDagRijen>;
  showSections: boolean;
  /** Id van de ingelogde gebruiker: zijn rij krijgt stip en vet. */
  ownId: string;
  notes: Map<string, string>;
  /** Getrimde zoekterm, alleen voor de lege-staat-tekst. */
  zoekTerm: string;
  toonRust: boolean;
  year: number;
  monthIndex: number;
  kanMaandTerug: boolean;
  kanMaandVooruit: boolean;
  /** Uitleg bij een uitgeschakelde "Vorige maand". */
  beginUitleg: string;
  /** Laatste geïmporteerde dag, voor de uitleg bij "Volgende maand". */
  laatsteDag: string | null;
  /** Of er een dag is met een nog niet herverdeelde dienst (het sprong-pijltje). */
  heeftAandacht: boolean;
};

export type DagActies = {
  kiesDag: (iso: string) => void;
  springNaarAandacht: () => void;
  setViewMonth: (maand: Date) => void;
  setToonRust: (volgende: (v: boolean) => boolean) => void;
  onCel: (drv: Chauffeur, iso: string, cell: MonthCell) => void;
};

export function DagWeergave({ dag, acties }: { dag: DagGegevens; acties: DagActies }) {
  const { dates, mobielDag, todayIso, dagRijen, showSections, ownId, notes, zoekTerm, toonRust, year, monthIndex, kanMaandTerug, kanMaandVooruit, beginUitleg, laatsteDag, heeftAandacht } = dag;
  const { kiesDag, springNaarAandacht, setViewMonth, setToonRust, onCel } = acties;

  // De gekozen dag in de strip in beeld houden (bv. na "Vandaag" of een
  // maandwissel). Bewust NIET scrollIntoView bij elke tik: die sprong hard
  // (geen smooth) en verschoof de strip ook als de dag al gewoon in beeld
  // stond — dan gleed de hele rij onder je vinger weg (melding Jarno 15-08).
  // Nu: alleen scrollen als de gekozen dag (deels) buiten beeld staat, zacht,
  // en via de container zelf zodat de pagina nooit verticaal meespringt.
  const reduceMotion = useReducedMotion();
  const stripDagRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const el = stripDagRef.current;
    const container = el?.parentElement;
    if (!el || !container) return;
    const elRect = el.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    if (elRect.left >= cRect.left && elRect.right <= cRect.right) return;
    container.scrollTo({
      left: el.offsetLeft - container.clientWidth / 2 + el.clientWidth / 2,
      behavior: reduceMotion ? 'auto' : 'smooth',
    });
  }, [mobielDag, reduceMotion]);

  return (
    <div className="md:hidden space-y-3">
      <Card padding="none" className="p-2">
        {/* Maandwissel hoort hier bij de dagen — de venster-pijlen in de
            kop zijn op mobiel verborgen. */}
        <div className="flex items-center justify-between gap-2 px-1 pb-1">
          <IconButton
            label="Vorige maand"
            title={kanMaandTerug ? 'Vorige maand' : beginUitleg}
            variant="ghost"
            size="md"
            className="text-slate-400"
            disabled={!kanMaandTerug}
            onClick={() => setViewMonth(new Date(year, monthIndex - 1, 1))}
          >
            <ChevronLeft size={16} />
          </IconButton>
          <span className="text-sm font-semibold text-slate-800 tabular-nums">{MONTH_NAMES[monthIndex]} {year}</span>
          <div className="flex items-center">
            {/* Spring naar de eerstvolgende dag met een nog niet
                herverdeelde dienst — scheelt dag voor dag vegen. */}
            {heeftAandacht && (
              <IconButton
                label="Naar de volgende dag met een openstaande dienst"
                title="Volgende dag met een openstaande dienst"
                variant="ghost"
                size="md"
                className="text-amber-700"
                onClick={springNaarAandacht}
              >
                <TriangleAlert size={16} />
              </IconButton>
            )}
            <IconButton
              label="Volgende maand"
              title={kanMaandVooruit ? 'Volgende maand' : `De planning is geïmporteerd tot ${formatDatumDMJ(laatsteDag)}`}
              variant="ghost"
              size="md"
              className="text-slate-400"
              disabled={!kanMaandVooruit}
              onClick={() => setViewMonth(new Date(year, monthIndex + 1, 1))}
            >
              <ChevronRight size={16} />
            </IconButton>
          </div>
        </div>
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Kies een dag">
          {dates.map((iso) => {
            const d = new Date(`${iso}T00:00:00`);
            const gekozen = iso === mobielDag;
            const vandaag = iso === todayIso;
            const td = typedagLabel(iso);
            return (
              // rauw: dag-tab in de datumstrip (kalender-dagcel met schuivende motion-pil)
              <button
                key={iso}
                ref={gekozen ? stripDagRef : undefined}
                type="button"
                role="tab"
                aria-selected={gekozen}
                onClick={() => kiesDag(iso)}
                className={cn(
                  // Kleuren via transition-colors; de keuzepil zelf is
                  // een motion-span met layoutId die tussen de dagen
                  // schúíft (zelfde patroon als de dock-tabs) i.p.v. per
                  // knop hard aan/uit te wippen.
                  'ios-pressable relative flex min-h-11 w-12 shrink-0 flex-col items-center justify-center rounded-xl py-1.5 transition-colors',
                  gekozen ? 'text-slate-900' : 'text-slate-500',
                  // Vandaag: zachte oker hairline (inset, 35%) + het oker
                  // cijfer. De eerdere 60%-ring las als een lege tweede
                  // pil; op verzoek Jarno tóch een omlijsting, maar
                  // duidelijk stiller dan de gevulde selectie-pil.
                  !gekozen && vandaag && 'ring-1 ring-inset ring-oker-500/35',
                )}
              >
                {gekozen && (
                  <motion.span
                    layoutId="dagstrip-actief"
                    // Zelfde veer als sidebar-rail, dock-tab en Segmented-pil
                    // (EASE_SPRING op DUR.fast, golf 2 punt 9).
                    transition={reduceMotion ? { duration: 0 } : { duration: DUR.fast, ease: EASE_SPRING }}
                    // Selectie = neutraal, zoals het actieve dock-item (tranche 3B, 23-09):
                    // goud is voor actie, focus en "nu"; vandaag houdt zijn oker cijfer.
                    className="absolute inset-0 rounded-xl bg-surface-muted ring-1 ring-hairline"
                  />
                )}
                <span className={cn(microLabelClass, 'relative z-10 transition-colors', gekozen ? 'text-slate-700' : 'text-slate-500')}>
                  {WEEKDAY_SHORT_MON[(d.getDay() + 6) % 7]}
                </span>
                {/* Vandaag (niet gekozen) = oker dagcijfer — hetzelfde
                    stille signaal als de oude daglabels en het desktop-
                    grid. Een ring om de hele knop las als een tweede,
                    lege pil naast de gevulde selectie (melding Jarno). */}
                {/* Het oker cijfer blijft ook als vandaag gekozen is: de keuzepil is neutraal, het "nu"-signaal niet. */}
                <span className={cn('relative z-10 text-sm font-bold tabular-nums leading-tight transition-colors', vandaag && 'text-oker-700')}>
                  {d.getDate()}
                </span>
                {/* Feestdag (F) — zelfde signaal als de desktop-dagkop.
                    De V van schoolvakantie is eruit (Jarno 17-09). De
                    maand staat hier niet onder elke dag: de strip loopt
                    binnen één maand en die staat in de kop erboven. */}
                {/* 2xs: matrixcel, typedagletter in een vaste 3 px-hoge strook */}
                <span className="relative z-10 h-3 text-2xs font-bold leading-3 text-slate-900">
                  {td?.kort === 'F' ? 'F' : ''}
                </span>
              </button>
            );
          })}
        </div>
      </Card>

      {mobielDag && (
        /* key per dag + korte opacity-fade: de kolom wisselt anders in
           één harde klap van inhoud. Alleen opacity (composited) — geen
           transform/hoogte-animatie, dat jankt op oudere toestellen. */
        <motion.div
          key={mobielDag}
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: DUR.fast, ease: 'easeOut' }}
        >
          <Card padding="none" className="overflow-hidden">
          <div className="flex items-baseline justify-between gap-3 border-b border-hairline px-4 py-3">
            <span className="text-sm font-semibold text-slate-800">{hoofdletter(formatDayLong(mobielDag))}</span>
            <MicroLabel className="tabular-nums">
              {dagRijen.secties.reduce((n, s) => n + s.rijen.length, 0)} {dagRijen.secties.reduce((n, s) => n + s.rijen.length, 0) === 1 ? 'dienst' : 'diensten'}
            </MicroLabel>
          </div>

          {dagRijen.secties.length === 0 ? (
            <p className="px-4 py-6 text-sm font-medium text-slate-500">
              {zoekTerm ? 'Geen chauffeurs gevonden voor deze zoekterm.' : 'Geen diensten op deze dag.'}
            </p>
          ) : dagRijen.secties.map((sectie) => (
            <Fragment key={sectie.naam}>
              {showSections && (
                <div className={cn(SECTIE_BAND, 'flex h-9 items-center px-4', SECTIE_KOP)}>{SECTIE_STREEP}{sectieLabel(sectie.naam)}</div>
              )}
              {sectie.rijen.map(({ drv, cell }) => {
                if (!cell) return null;
                const isOwn = ownId && drv.id === ownId;
                return (
                  // rauw: klikbare dagrij (code-chip + naam + uren) — kaart-als-knop met eigen layout
                  <button
                    key={drv.id}
                    type="button"
                    onClick={() => onCel(drv, mobielDag, cell)}
                    className="w-full flex items-center gap-3 px-4 py-2.5 min-h-11 text-left border-b border-hairline-subtle last:border-b-0 active:bg-surface-soft-hover transition-colors"
                  >
                    <Chip mono={false} className={cn(
                      'min-w-[46px] justify-center ring-1 ring-hairline',
                      celChipClass(cell),
                    )}>{cell.code}</Chip>
                    {/* Eigen rij: neutrale stip en vet, geen gouden vlak (tranche 3B). */}
                    <span className={cn('min-w-0 flex-1 truncate text-sm text-slate-800', isOwn ? 'font-bold' : 'font-semibold')}>
                      {isOwn && <span className="mr-1.5 inline-block size-1.5 rounded-full bg-slate-700 align-middle" aria-hidden="true" />}
                      {drv.name}
                      {isOwn && <span className="sr-only"> (jij)</span>}
                    </span>
                    {/* Uren compact rechts; bij een open dienst de melding. */}
                    <span className="shrink-0 text-xs font-medium text-slate-500 tabular-nums">
                      {cell.hiddenService ? `dienst ${cell.hiddenService} open` : (cell.segments[0] ?? '')}
                    </span>
                    {cell.hiddenService && (
                      <TriangleAlert size={14} className="shrink-0 text-amber-700" aria-label="dienst nog niet herverdeeld" />
                    )}
                    {notes.has(noteKey(String(drv.id), mobielDag)) && (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-600" aria-label="notitie aanwezig" />
                    )}
                  </button>
                );
              })}
            </Fragment>
          ))}

          {dagRijen.rust.length > 0 && (
            <>
              {/* rauw: uitklapband over de volle breedte (micro-label + chevron), geen knopvorm */}
              <button
                type="button"
                onClick={() => setToonRust((v) => !v)}
                aria-expanded={toonRust}
                className={cn('w-full flex items-center justify-between gap-3 px-4 py-2.5 min-h-11 active:bg-surface-soft-hover transition-colors', SECTIE_BAND, SECTIE_KOP)}
              >
                <span>Vrij / afwezig · {dagRijen.rust.length}</span>
                <ChevronRight size={14} className={uitklapChevron(toonRust, 90)} />
              </button>
              <Uitklap open={toonRust}>
              <div>
              {dagRijen.rust.map(({ drv, cell }) => {
                const isOwn = ownId && drv.id === ownId;
                const inhoud = (
                  <>
                    <Chip mono={false} className={cn(
                      'min-w-[46px] justify-center',
                      cell ? cn('ring-1 ring-hairline', KIND_CLS[cell.kind]) : 'bg-transparent text-slate-300',
                    )}>{cell?.code ?? '—'}</Chip>
                    <span className={cn('min-w-0 flex-1 truncate text-sm', isOwn ? 'font-bold text-slate-800' : 'font-medium text-slate-600')}>
                      {isOwn && <span className="mr-1.5 inline-block size-1.5 rounded-full bg-slate-700 align-middle" aria-hidden="true" />}
                      {drv.name}
                      {isOwn && <span className="sr-only"> (jij)</span>}
                    </span>
                    <span className="shrink-0 text-xs font-medium text-slate-500">{cell?.label ?? ''}</span>
                  </>
                );
                const rijCls = 'w-full flex items-center gap-3 px-4 py-2.5 min-h-11 text-left border-b border-hairline-subtle last:border-b-0';
                // Zonder cel valt er niets te openen — dan geen knop.
                // rauw: klikbare dagrij (zie hierboven) — kaart-als-knop met eigen layout
                return cell ? (
                  <button
                    key={drv.id}
                    type="button"
                    onClick={() => onCel(drv, mobielDag, cell)}
                    className={cn(rijCls, 'active:bg-surface-soft-hover transition-colors')}
                  >
                    {inhoud}
                  </button>
                ) : (
                  <div key={drv.id} className={rijCls}>{inhoud}</div>
                );
              })}
              </div>
              </Uitklap>
            </>
          )}
          </Card>
        </motion.div>
      )}
    </div>
  );
}
