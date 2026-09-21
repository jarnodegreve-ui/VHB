import { useEffect, useMemo, useState } from 'react';
import type { KolomToon, RapportDefinitie, RapportKolom, RapportRij, RapportWaarde } from '../../shared/rapporten/types';
import { celToon, formatWaarde, heeftTotaalrij, isGetalKolom, isRechts, kolomIndeling, onderEersteTekst, sorteerRijen } from '../../shared/rapporten/opmaak';
import { cn } from '../lib/ui';
import { useMinWidth } from '../lib/useMinWidth';
import { Badge, type BadgeTone } from './primitives';
import { Paginering, SortTh, StickyThead, Td, Th, useSort } from './Table';

/**
 * De tabel van een rapport, volledig uit de definitie: kolomkoppen,
 * uitlijning per kolomtype, sorteren, een totaalrij en paginering. Hoort in
 * een `surface-table`-kader; de tabel schuift horizontaal bínnen dat kader
 * (nooit de pagina), de kolomkop blijft onder de topbar plakken zodra er
 * geen horizontale scroll nodig is (xl, zelfde afspraak als `TableShell sticky`).
 *
 * Smal scherm (onder md): de kolommen volgen hun rol `smal` uit de definitie
 * (`kolomIndeling`): een kolom `onderEerste` wordt een gedempte regel onder de
 * eerste kolom, `achteraan` schuift achter het scrollen, `verberg` valt weg,
 * en de koppen gebruiken hun korte titel. De tabel krijgt dan vaste
 * kolombreedtes, zodat de eerste kolom plus drie cijferkolommen op een
 * telefoon van 375 px zonder scrollen in beeld staan. Elk rapport krijgt dit
 * gratis; het printblad en de CSV tonen altijd alles.
 *
 * `rijen` = wat er te zien is (na de zoekterm); `totalen` hoort bij precies
 * die rijen. Het printblad heeft zijn eigen tabel (PrintBlad) en toont alles.
 */
const PER_PAGINA = 50;
/** Vanaf hier passen de kolommen naast elkaar (md); eronder geldt de smalle indeling. */
const BREED_VANAF = 768;

/** Vaste kolombreedtes op een smal scherm, in rem: eerste kolom, cijfers, datum/ja-nee, tekst. */
const SMAL_BREEDTE = { eerste: 9.5, getal: 3.75, kort: 5.5, tekst: 8 };
const smalleBreedte = (k: RapportKolom, eerste: boolean): number =>
  eerste ? SMAL_BREEDTE.eerste : isGetalKolom(k) ? SMAL_BREEDTE.getal : k.type === 'tekst' ? SMAL_BREEDTE.tekst : SMAL_BREEDTE.kort;

/**
 * De eerste kolom (de naam) blijft onder xl links staan terwijl de cijfers
 * eronderdoor schuiven, op een opaak vlak: op de telefoon weet je anders na
 * één veeg niet meer van wie de rij is.
 */
const VASTE_KOLOM = 'max-xl:sticky max-xl:left-0 max-xl:z-[1] max-xl:bg-paper';
/**
 * Met `border-collapse` verliest een sticky cel haar eigen rand (de browser
 * tekent die op de tabel, en het opake vlak van de cel schuift eroverheen).
 * De lijn onder de kop en boven de totaalrij komt daar dus terug als schaduw van
 * 1 px buiten de cel, precies op de plaats van de samengevoegde rand.
 */
const VASTE_KOP = 'max-xl:shadow-[0_1px_0_var(--color-slate-200)]';
const VASTE_VOET = 'max-xl:shadow-[0_-1px_0_var(--color-hairline-strong)]';

/**
 * Toon van een cel (definitie: `tonen` of `signaal`). Wat aandacht vraagt is
 * een pil (vervallen = danger, binnenkort = amber), een rusttoestand een
 * puntje met tekst; een getal met een grens kleurt zelf. Nooit goud.
 */
const TOON_BADGE: Record<KolomToon, { tone: BadgeTone; kaal: boolean }> = {
  gevaar: { tone: 'red', kaal: false },
  waarschuwing: { tone: 'amber', kaal: false },
  aandacht: { tone: 'amber', kaal: true },
  goed: { tone: 'emerald', kaal: true },
  rust: { tone: 'slate', kaal: true },
};
const TOON_GETAL: Partial<Record<KolomToon, string>> = { gevaar: 'font-semibold text-red-700', waarschuwing: 'font-semibold text-amber-700' };

const celInhoud = (kolom: RapportKolom, waarde: RapportWaarde | undefined) => {
  const toon = kolom.tonen ? celToon(kolom, waarde) : null;
  if (!toon) return formatWaarde(kolom, waarde);
  const { tone, kaal } = TOON_BADGE[toon];
  return <Badge tone={tone} kaal={kaal}>{formatWaarde(kolom, waarde)}</Badge>;
};

/**
 * Vanaf zoveel kolommen staat de brede tabel dichter (smallere cijferkolommen,
 * minder lucht tussen de cellen), zodat tien kolommen op een scherm van 1440 px
 * zonder horizontaal scrollen naast elkaar passen.
 */
const DICHT_VANAF = 9;

const celKlasse = (kolom: RapportKolom, waarde: RapportWaarde | undefined, eerste: boolean, smal: boolean, dicht: boolean): string => cn(
  // Korte tekst (type, status, naam) blijft op één regel; lopende tekst (`breed`) mag afbreken en houdt een minimumbreedte.
  eerste ? cn('font-medium text-slate-800', VASTE_KOLOM, smal ? 'pl-4 pr-2' : 'whitespace-nowrap') : cn(smal ? 'px-2' : kolom.type === 'tekst' && (kolom.breed ? 'min-w-40' : 'whitespace-nowrap')),
  dicht && !eerste && 'px-2',
  // Een nul blijft staan ("0"), maar stiller dan een cijfer dat iets zegt.
  isGetalKolom(kolom) && waarde === 0 && 'text-slate-500',
  (waarde === null || waarde === undefined || waarde === '') && 'text-slate-500',
  kolom.signaal && TOON_GETAL[celToon(kolom, waarde) ?? 'rust'],
);

export function RapportTabel({ def, rijen, totalen, className }: {
  def: RapportDefinitie;
  rijen: readonly RapportRij[];
  /** Som per optelbare kolom over `rijen`; zonder opgave geen totaalrij. */
  totalen?: Record<string, number> | null;
  className?: string;
}) {
  const breed = useMinWidth(BREED_VANAF);
  const smal = !breed;
  const { kolommen, onderEerste } = useMemo(() => kolomIndeling(def, smal ? 'smal' : 'breed'), [def, smal]);
  const sort = useSort<string>(def.sortering.kolom, def.sortering.richting);
  const [pagina, setPagina] = useState(1);
  const gesorteerd = useMemo(() => sorteerRijen(def, rijen, sort.key, sort.dir), [def, rijen, sort.key, sort.dir]);
  const paginas = Math.max(1, Math.ceil(gesorteerd.length / PER_PAGINA));
  // Andere rijen of een andere sortering: terug naar de eerste pagina; en
  // nooit op een pagina blijven staan die niet meer bestaat.
  useEffect(() => { setPagina(1); }, [rijen, sort.key, sort.dir]);
  const huidig = Math.min(pagina, paginas);
  const zichtbaar = gesorteerd.slice((huidig - 1) * PER_PAGINA, huidig * PER_PAGINA);
  const metTotaal = Boolean(totalen) && heeftTotaalrij(def) && rijen.length > 0;
  const dicht = !smal && kolommen.length >= DICHT_VANAF;
  const smalleTabelBreedte = kolommen.reduce((som, k, i) => som + smalleBreedte(k, i === 0), 0);

  return (
    <div className={className}>
      <div className="overflow-x-auto xl:overflow-visible">
        <table
          className={cn('w-full border-collapse text-left', smal && 'table-fixed')}
          // Smal: de som van de vaste kolommen, maar nooit smaller dan het kader.
          style={smal ? { width: `max(100%, ${smalleTabelBreedte}rem)` } : undefined}
        >
          {smal && (
            <colgroup>
              {kolommen.map((k, i) => <col key={k.id} style={{ width: `${smalleBreedte(k, i === 0)}rem` }} />)}
            </colgroup>
          )}
          {/* Onder xl schuift de tabel in haar eigen kader: daar is `sticky` relatief
              aan dat kader en zou de kop 64 px naar beneden over de eerste rijen
              schuiven. Plakken doet hij dus pas vanaf xl. */}
          <StickyThead className="max-xl:static">
            <tr>
              {kolommen.map((k, i) => (
                // Cijferkolommen smal en vast, de tekstkolommen krijgen de rest:
                // zo staan de getallen bij elkaar in plaats van over de breedte verspreid.
                <SortTh
                  key={k.id}
                  kolom={k.id}
                  sort={sort}
                  align={isRechts(k) ? 'right' : 'left'}
                  dicht={(smal || dicht) && i > 0}
                  naam={smal && k.kort ? k.titel : undefined}
                  className={cn(!smal && isGetalKolom(k) && (dicht ? 'w-20' : 'w-28 xl:w-32'), i === 0 && cn(VASTE_KOLOM, VASTE_KOP))}
                >
                  {smal ? k.kort ?? k.titel : k.titel}
                </SortTh>
              ))}
            </tr>
          </StickyThead>
          <tbody>
            {zichtbaar.map((rij) => (
              <tr key={rij.id} className="border-b border-hairline-subtle transition-colors last:border-b-0 hover:bg-surface-soft-hover">
                {kolommen.map((k, i) => {
                  const onder = i === 0 ? onderEersteTekst(onderEerste, rij) : '';
                  return (
                    <Td key={k.id} num={isRechts(k)} className={celKlasse(k, rij[k.id], i === 0, smal, dicht)}>
                      {i === 0 && smal ? (
                        <>
                          <span className="block truncate">{formatWaarde(k, rij[k.id])}</span>
                          {onder ? <span className="block truncate text-xs font-normal text-slate-500">{onder}</span> : null}
                        </>
                      ) : celInhoud(k, rij[k.id])}
                    </Td>
                  );
                })}
              </tr>
            ))}
          </tbody>
          {metTotaal && totalen && (
            <tfoot>
              {/* Geen getint vlak: de sterke lijn en het gewicht dragen de totaalrij,
                  ook in zwart-wit, en de vaste eerste kolom blijft één kleur. */}
              <tr className="border-t border-hairline-strong">
                {kolommen.map((k, i) => (
                  <Th key={k.id} num={isRechts(k)} className={cn('py-3.5 text-sm font-semibold text-slate-900', i === 0 && cn(VASTE_KOLOM, VASTE_VOET), smal && (i === 0 ? 'pl-4 pr-2' : 'px-2'), dicht && i > 0 && 'px-2')}>
                    {k.id in totalen ? formatWaarde(k, totalen[k.id]) : i === 0 ? `Totaal (${rijen.length})` : ''}
                  </Th>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <Paginering totaal={gesorteerd.length} perPagina={PER_PAGINA} pagina={huidig} onPagina={setPagina} className="border-t border-hairline" />
    </div>
  );
}
