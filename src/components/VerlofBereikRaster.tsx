import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { cn } from '../lib/ui';
import { addDagen } from '../lib/datum';
import { WEEKDAY_SHORT_MON } from '../lib/format';
import { dagPlusMaand, dagenInMaand, formatDatumKiezer, maandLabel, maandVan, weekdagMa } from '../lib/kalender';
import { microLabelClass } from './primitives';

/**
 * Het bereikraster van de verlofaanvraag (datumtranche PR 5, 23-09): één
 * maand, klik (of Enter/Spatie) op de start en daarna op het einde. Het
 * gedrag van een keuze (start, einde, herstart vóór de start) zit in de
 * aanroeper (`onKies`), zodat typen in Van/Tot en klikken hier dezelfde
 * regels volgen.
 *
 * Toegankelijk als een echt raster: `role="grid"` met rijen, volledige
 * labels per dag ("vr 10 okt 2026", plus "begin" of "einde" van de gekozen
 * periode), en één tab-stop (roving tabindex) i.p.v. een tab-stop per dag.
 * Toetsen: ← → per dag, ↑ ↓ per week, PageUp/PageDown per maand, Home/End
 * naar het begin of einde van de week; wie de maand uit loopt, bladert mee.
 * Dagen vóór `min` (een eigen aanvraag in het verleden) zijn uitgeschakeld
 * en de cursor komt er niet.
 */
export function VerlofBereikRaster({ maand, start, eind, min, vandaag, onKies, onNaarMaand, verledenTitel }: {
  /** 'YYYY-MM' van de getoonde maand. */
  maand: string;
  start: string;
  eind: string;
  /** Vroegste kiesbare dag (ISO) of undefined. */
  min?: string;
  vandaag: string;
  onKies: (iso: string) => void;
  onNaarMaand: (maand: string) => void;
  /** Uitleg bij een uitgeschakelde dag (title). */
  verledenTitel?: string;
}) {
  const klem = (iso: string) => (min && iso < min ? min : iso);
  const beginVanMaand = () => klem(`${maand}-01`);
  const [cursor, setCursor] = useState(() => klem(start && maandVan(start) === maand ? start : maandVan(vandaag) === maand ? vandaag : `${maand}-01`));
  const focusNaarCel = useRef(false);
  const rasterRef = useRef<HTMLDivElement | null>(null);

  // Andere maand getoond (pijltjes boven het raster, typen in Van/Tot): de
  // cursor gaat mee naar die maand, zodat Tab er meteen in landt.
  useEffect(() => {
    if (maandVan(cursor) === maand) return;
    setCursor(start && maandVan(start) === maand ? klem(start) : maandVan(vandaag) === maand ? klem(vandaag) : beginVanMaand());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maand]);

  useEffect(() => {
    if (!focusNaarCel.current) return;
    focusNaarCel.current = false;
    rasterRef.current?.querySelector<HTMLButtonElement>(`[data-iso="${cursor}"]`)?.focus();
  }, [cursor, maand]);

  const verplaats = (naar: string) => {
    const doel = klem(naar);
    focusNaarCel.current = true;
    setCursor(doel);
    if (maandVan(doel) !== maand) onNaarMaand(maandVan(doel));
  };

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    switch (e.key) {
      case 'ArrowLeft': e.preventDefault(); verplaats(addDagen(cursor, -1)); return;
      case 'ArrowRight': e.preventDefault(); verplaats(addDagen(cursor, 1)); return;
      case 'ArrowUp': e.preventDefault(); verplaats(addDagen(cursor, -7)); return;
      case 'ArrowDown': e.preventDefault(); verplaats(addDagen(cursor, 7)); return;
      case 'PageUp': e.preventDefault(); verplaats(dagPlusMaand(cursor, -1)); return;
      case 'PageDown': e.preventDefault(); verplaats(dagPlusMaand(cursor, 1)); return;
      case 'Home': e.preventDefault(); verplaats(addDagen(cursor, -weekdagMa(cursor))); return;
      case 'End': e.preventDefault(); verplaats(addDagen(cursor, 6 - weekdagMa(cursor))); return;
      default: return;
    }
  };

  // Weken van maandag tot zondag, lege plaatsen buiten de maand.
  const eerste = `${maand}-01`;
  const lengte = dagenInMaand(maand);
  const cellen: (string | null)[] = [
    ...Array.from({ length: weekdagMa(eerste) }, () => null),
    ...Array.from({ length: lengte }, (_, i) => `${maand}-${String(i + 1).padStart(2, '0')}`),
  ];
  while (cellen.length % 7 !== 0) cellen.push(null);
  const weken = Array.from({ length: cellen.length / 7 }, (_, w) => cellen.slice(w * 7, w * 7 + 7));
  const bereikEind = eind || start;

  return (
    <div ref={rasterRef} role="grid" aria-label={maandLabel(maand)} onKeyDown={onKey} className="space-y-1">
      <div role="row" className="grid grid-cols-7 gap-1">
        {WEEKDAY_SHORT_MON.map((d) => (
          <div key={d} role="columnheader" className={cn(microLabelClass, 'text-center py-1')}>{d}</div>
        ))}
      </div>
      {weken.map((week, w) => (
        <div key={w} role="row" className="grid grid-cols-7 gap-1">
          {week.map((iso, k) => {
            if (!iso) return <div key={`leeg-${w}-${k}`} role="gridcell" aria-hidden="true" />;
            const uit = !!min && iso < min;
            const isStart = iso === start;
            const isEind = !!eind && iso === eind;
            const edge = isStart || isEind;
            const inRange = !!start && iso >= start && iso <= bereikEind;
            const isVandaag = iso === vandaag;
            const rol = isStart && isEind ? ', begin en einde van de periode' : isStart ? ', begin van de periode' : isEind ? ', einde van de periode' : '';
            return (
              // rauw: rastercel (role=gridcell, roving tabindex) met eigen bereik-/randstijl, zelfde recept als de dagcel van DatePicker.
              <button
                key={iso}
                type="button"
                role="gridcell"
                data-iso={iso}
                aria-label={`${formatDatumKiezer(iso)}${rol}`}
                aria-selected={inRange || undefined}
                aria-current={isVandaag ? 'date' : undefined}
                title={uit ? verledenTitel : undefined}
                tabIndex={iso === cursor ? 0 : -1}
                disabled={uit}
                onClick={() => { setCursor(iso); onKies(iso); }}
                onFocus={() => setCursor(iso)}
                className={cn(
                  'aspect-square rounded-xl text-xs font-semibold transition-colors flex items-center justify-center',
                  uit && 'text-slate-300 cursor-not-allowed',
                  !uit && !inRange && !edge && 'text-slate-500 hover:bg-oker-50',
                  !uit && inRange && !edge && 'bg-oker-100 text-oker-700',
                  !uit && edge && 'bg-oker-500 text-slate-950 elev-accent',
                  !uit && isVandaag && !inRange && !edge && 'ring-1 ring-oker-300',
                )}
              >
                {Number(iso.slice(8, 10))}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
