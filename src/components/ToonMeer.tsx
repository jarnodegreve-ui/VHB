import { useEffect, useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../lib/ui';
import { Pressable } from './primitives';
import { BrandSpinner } from './BrandSpinner';

/**
 * De voet onder een lijst die met de historiek groeit: "Toon 10 oudere" links,
 * "10 van 143" rechts (Jarno 15-10: hoogstens tien tegelijk, de rest op
 * vraag). Hoort als laatste regel ín de kaart van de lijst, met een hairline
 * erboven (`LijstKaart voet`, of na de `ul` in een eigen `Card`), zodat de
 * lijst één geheel blijft. Toont niets zodra alles in beeld staat.
 *
 * `totaal` null = het totaal is niet gekend (een archief dat de server per
 * pagina geeft zonder telling); dan alleen de knop. `bezig` = de volgende
 * pagina komt nog van de server.
 */
export function ToonMeer({ getoond, totaal, volgende, onMeer, woord = 'meer', bezig = false, los = false, className }: {
  getoond: number;
  totaal: number | null;
  /** Hoeveel er bij een tik bijkomen; 0 = niets meer te tonen. */
  volgende: number;
  onMeer: () => void;
  /** "Toon 10 meer" of, bij een lijst van nieuw naar oud, "Toon 10 oudere". */
  woord?: 'meer' | 'oudere';
  bezig?: boolean;
  /** Onder een stapel losse kaarten (geen lijstkaart om in te staan): een
   *  eigen kaart, zonder de hairline erboven. */
  los?: boolean;
  className?: string;
}) {
  if (volgende <= 0) return null;
  return (
    <div className={cn(los ? 'surface-card overflow-hidden rounded-3xl' : 'border-t border-hairline-subtle', className)}>
      <Pressable
        onClick={onMeer}
        disabled={bezig}
        aria-busy={bezig || undefined}
        className="tikbaar flex min-h-11 w-full items-center justify-between gap-3 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-surface-soft-hover sm:pointer-fine:min-h-10"
      >
        <span className="flex items-center gap-2">
          {bezig ? <BrandSpinner size={14} /> : <ChevronDown size={16} aria-hidden="true" className="text-slate-400" />}
          Toon {volgende} {woord}
        </span>
        {totaal !== null && (
          <span className="text-xs font-medium text-slate-500 tabular-nums" aria-live="polite">{getoond} van {totaal}</span>
        )}
      </Pressable>
    </div>
  );
}

/**
 * "Toon meer" voor lijsten die met de historiek blijven groeien (dienstruilen,
 * verlof, omleidingen, updates, …; Jarno 15-10: "eindeloos in een lijst
 * scrollen is niet gebruiksvriendelijk"). Een lijst toont eerst `stap`
 * records (standaard 10) en de knop onderaan (`<ToonMeer>`) zet er telkens
 * `stap` bij.
 *
 * - `sleutel`: de stand van de filters of de zoekterm. Wisselt ze, dan begint
 *   de lijst weer bij de eerste `stap` records.
 * - `doel`: het record waar een link naartoe wijst (`/dienstruil/<id>`). Staat
 *   het verder in de lijst, dan toont de lijst er zoveel dat het erbij is,
 *   afgerond op een hele stap, en dat blijft zo ook als de link daarna
 *   wegvalt (de lijst krimpt niet onder de lezer weg).
 *
 * Hook en knop staan in één module: elk lijstscherm dat ze leent is een
 * eigen chunk, en twee kleine gedeelde chunks kostten de warmup ±0,2 kB meer
 * dan één (gemeten 15-10).
 */
export const TOON_MEER_STAP = 10;

export type ToonMeerStand<T> = {
  /** De records die nu in beeld horen. */
  zichtbaar: T[];
  /** Hoeveel er in beeld staan. */
  getoond: number;
  /** Hoeveel er in de lijst zitten. */
  totaal: number;
  /** Hoeveel er bij de volgende tik bijkomen (0 = alles staat er). */
  volgende: number;
  meer: () => void;
};

export function useToonMeer<T>(
  items: readonly T[],
  opties: { stap?: number; begin?: number; sleutel?: string; doel?: (item: T) => boolean } = {},
): ToonMeerStand<T> {
  const stap = Math.max(1, opties.stap ?? TOON_MEER_STAP);
  // `begin`: hoeveel er eerst staan, als dat anders is dan een stap (de
  // jongste vorige ritbladen alleen, daarna vijf tegelijk).
  const begin = Math.max(1, opties.begin ?? stap);
  const sleutel = opties.sleutel ?? '';
  const [stand, setStand] = useState({ sleutel, aantal: begin });
  // Andere filters: terug naar het begin, zonder een render met de oude
  // stand ertussen (de React-manier om toestand bij te stellen op een
  // gewijzigde prop). Ook terug naar een eerdere filter begint opnieuw.
  if (stand.sleutel !== sleutel) setStand({ sleutel, aantal: begin });
  const basis = stand.sleutel === sleutel ? stand.aantal : begin;
  const doelIndex = opties.doel ? items.findIndex(opties.doel) : -1;
  const nodig = doelIndex >= basis ? begin + Math.ceil((doelIndex + 1 - begin) / stap) * stap : 0;
  const aantal = Math.max(basis, nodig);

  useEffect(() => {
    if (nodig > basis) setStand({ sleutel, aantal: nodig });
  }, [nodig, basis, sleutel]);

  const zichtbaar = useMemo(() => (items.length <= aantal ? [...items] : items.slice(0, aantal)), [items, aantal]);
  const getoond = zichtbaar.length;
  return {
    zichtbaar,
    getoond,
    totaal: items.length,
    volgende: Math.min(stap, items.length - getoond),
    meer: () => setStand({ sleutel, aantal: aantal + stap }),
  };
}
