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
 * Dagen vóór `min` (een eigen aanvraag in het verleden) en na `max` (de
 * uiterste einddatum van verlof) zijn uitgeschakeld en de cursor komt er niet.
 *
 * `dagInfo` (ronde 6, punt 13) zet onder het dagcijfer de bezettingsstip van
 * de verlofkalender, met de tekst in het label van de dag. Het is alleen
 * informatie: een volzette dag blijft kiesbaar. Zonder `dagInfo`, of als die
 * voor een dag niets geeft (bezetting niet geladen), staat er geen stip; een
 * uitgeschakelde dag krijgt er nooit een.
 */
export function VerlofBereikRaster({ maand, start, eind, min, max, vandaag, onKies, onNaarMaand, verledenTitel, laterTitel, dagInfo }: {
  /** 'YYYY-MM' van de getoonde maand. */
  maand: string;
  start: string;
  eind: string;
  /** Vroegste kiesbare dag (ISO) of undefined. */
  min?: string;
  /** Laatste kiesbare dag (ISO) of undefined. */
  max?: string;
  vandaag: string;
  onKies: (iso: string) => void;
  onNaarMaand: (maand: string) => void;
  /** Uitleg bij een uitgeschakelde dag vóór `min` (title). */
  verledenTitel?: string;
  /** Uitleg bij een uitgeschakelde dag na `max` (title). */
  laterTitel?: string;
  /** Bezetting van een dag: `staat` (data-bezetting), `stip` (kleurklasse van de stip) en `tekst` (in het label); null = onbekend, geen stip. */
  dagInfo?: (iso: string) => { staat: string; stip: string; tekst: string } | null;
}) {
  const klem = (iso: string) => (min && iso < min ? min : max && iso > max ? max : iso);
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
            const teVroeg = !!min && iso < min;
            const uit = teVroeg || (!!max && iso > max);
            const isStart = iso === start;
            const isEind = !!eind && iso === eind;
            const edge = isStart || isEind;
            const inRange = !!start && iso >= start && iso <= bereikEind;
            const isVandaag = iso === vandaag;
            const rol = isStart && isEind ? ', begin en einde van de periode' : isStart ? ', begin van de periode' : isEind ? ', einde van de periode' : '';
            const info = uit ? null : dagInfo?.(iso) ?? null;
            return (
              // rauw: rastercel (role=gridcell, roving tabindex) met eigen bereik-/randstijl, zelfde recept als de dagcel van DatePicker.
              <button
                key={iso}
                type="button"
                role="gridcell"
                data-iso={iso}
                data-bezetting={info?.staat}
                aria-label={`${formatDatumKiezer(iso)}${info ? `, ${info.tekst}` : ''}${rol}`}
                aria-selected={inRange || undefined}
                aria-current={isVandaag ? 'date' : undefined}
                title={teVroeg ? verledenTitel : uit ? laterTitel : undefined}
                tabIndex={iso === cursor ? 0 : -1}
                disabled={uit}
                onClick={() => { setCursor(iso); onKies(iso); }}
                onFocus={() => setCursor(iso)}
                className={cn(
                  'relative aspect-square rounded-xl text-xs font-semibold transition-colors flex items-center justify-center',
                  uit && 'text-slate-300 cursor-not-allowed',
                  // Begin en einde = neutrale selectie (bg-keuze), de dagen ertussen
                  // een gedempt vlak; vandaag = de gouden ring van DatePicker.
                  !uit && !inRange && !edge && 'text-slate-500 hover:bg-surface-soft-hover',
                  !uit && inRange && !edge && 'bg-surface-muted text-slate-900',
                  !uit && edge && 'bg-keuze text-keuze-tekst',
                  !uit && isVandaag && !inRange && !edge && 'ring-1 ring-inset ring-oker-500/35',
                )}
              >
                {Number(iso.slice(8, 10))}
                {/* Absoluut onderaan: het cijfer blijft in het midden, ook als de stippen pas later binnenkomen. */}
                {info && <span aria-hidden="true" className={cn('absolute bottom-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full', info.stip)} />}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
