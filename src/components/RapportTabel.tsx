import { useEffect, useMemo, useState } from 'react';
import type { RapportDefinitie, RapportKolom, RapportRij, RapportWaarde } from '../../shared/rapporten/types';
import { formatWaarde, heeftTotaalrij, isGetalKolom, isRechts, sorteerRijen } from '../../shared/rapporten/opmaak';
import { cn } from '../lib/ui';
import { Paginering, SortTh, StickyThead, Td, Th, useSort } from './Table';

/**
 * De tabel van een rapport, volledig uit de definitie: kolomkoppen,
 * uitlijning per kolomtype, sorteren, een totaalrij en paginering. Hoort in
 * een `surface-table`-kader; de tabel schuift horizontaal bínnen dat kader
 * (nooit de pagina), de kolomkop blijft onder de topbar plakken zodra er
 * geen horizontale scroll nodig is (xl, zelfde afspraak als `TableShell sticky`).
 *
 * `rijen` = wat er te zien is (na de zoekterm); `totalen` hoort bij precies
 * die rijen. Het printblad heeft zijn eigen tabel (PrintBlad) en toont alles.
 */
const PER_PAGINA = 50;

/**
 * De eerste kolom (de naam) blijft onder xl links staan terwijl de cijfers
 * eronderdoor schuiven, op een opaak vlak: op de telefoon weet je anders na
 * één veeg niet meer van wie de rij is.
 */
const VASTE_KOLOM = 'max-xl:sticky max-xl:left-0 max-xl:z-[1] max-xl:bg-paper';

const celKlasse = (kolom: RapportKolom, waarde: RapportWaarde | undefined, eerste: boolean): string => cn(
  eerste ? cn('whitespace-nowrap font-medium text-slate-800', VASTE_KOLOM) : kolom.type === 'tekst' && 'sm:min-w-36',
  // Een nul blijft staan ("0"), maar stiller dan een cijfer dat iets zegt.
  isGetalKolom(kolom) && waarde === 0 && 'text-slate-500',
  (waarde === null || waarde === undefined || waarde === '') && 'text-slate-500',
);

export function RapportTabel({ def, rijen, totalen, className }: {
  def: RapportDefinitie;
  rijen: readonly RapportRij[];
  /** Som per optelbare kolom over `rijen`; zonder opgave geen totaalrij. */
  totalen?: Record<string, number> | null;
  className?: string;
}) {
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

  return (
    <div className={className}>
      <div className="overflow-x-auto xl:overflow-visible">
        <table className="w-full border-collapse text-left">
          {/* Onder xl schuift de tabel in haar eigen kader: daar is `sticky` relatief
              aan dat kader en zou de kop 64 px naar beneden over de eerste rijen
              schuiven. Plakken doet hij dus pas vanaf xl. */}
          <StickyThead className="max-xl:static">
            <tr>
              {def.kolommen.map((k, i) => (
                // Cijferkolommen smal en vast, de tekstkolommen krijgen de rest:
                // zo staan de getallen bij elkaar in plaats van over de breedte verspreid.
                <SortTh key={k.id} kolom={k.id} sort={sort} align={isRechts(k) ? 'right' : 'left'} className={cn(isGetalKolom(k) && 'w-24 sm:w-28 xl:w-32', i === 0 && VASTE_KOLOM)}>{k.titel}</SortTh>
              ))}
            </tr>
          </StickyThead>
          <tbody>
            {zichtbaar.map((rij) => (
              <tr key={rij.id} className="border-b border-hairline-subtle transition-colors last:border-b-0 hover:bg-surface-soft-hover">
                {def.kolommen.map((k, i) => (
                  <Td key={k.id} num={isRechts(k)} className={celKlasse(k, rij[k.id], i === 0)}>{formatWaarde(k, rij[k.id])}</Td>
                ))}
              </tr>
            ))}
          </tbody>
          {metTotaal && totalen && (
            <tfoot>
              {/* Geen getint vlak: de sterke lijn en het gewicht dragen de totaalrij,
                  ook in zwart-wit, en de vaste eerste kolom blijft één kleur. */}
              <tr className="border-t border-hairline-strong">
                {def.kolommen.map((k, i) => (
                  <Th key={k.id} num={isRechts(k)} className={cn('py-3.5 text-sm font-semibold text-slate-900', i === 0 && VASTE_KOLOM)}>
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
