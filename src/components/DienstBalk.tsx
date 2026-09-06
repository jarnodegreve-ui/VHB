import { balkGeometrie, minNaarTijd, type BalkDeel } from '../lib/dienstBalk';
import { cn } from '../lib/ui';

/**
 * Dienstbalk — de wijzerplaat van de dag (Jarno 04-09): één balk van de
 * eerste start tot het laatste einde, uurstreepjes erboven, pauzes als
 * gaten, begintijd links en eindtijd rechts, en een gouden wijzer op "nu"
 * met de tijd erboven. Gereden delen zijn gedempt goud, het lopende deel
 * vult zich, de rest is grijs. `compact` = dashboard-tegel (geen
 * uurstreepjes, kleinere labels).
 *
 * Beweging (wijzer, tijdlabel, vulling) loopt over `transform`, niet over
 * `left`/`width` — die dwongen per frame een reflow af (controle-ronde
 * 05-09, nr. 38). Wijzer en label staan op `left: 0` in een wrapper over de
 * volle balkbreedte die `translateX(<pct>%)` van zichzelf verschuift; de
 * vulling is even breed als het segment en schuift met
 * `translateX(-(100 − gevuld)%)` naar binnen (zo blijft de ronde eindkap
 * intact, wat `scaleX` zou platdrukken). `overflow-x-clip` houdt de
 * verschoven wrappers uit de scroll-overflow. Reduced motion: de globale
 * prefers-reduced-motion-regel (index.css) zet elke transition op ~0.
 */
export function DienstBalk({
  delen,
  nuMin,
  nuLabel,
  compact = false,
  className,
}: {
  delen: BalkDeel[];
  /** "Nu" in minuten t.o.v. middernacht; null = geen wijzer (morgen). */
  nuMin: number | null;
  /** Tekst boven de wijzer, bv. "19:12". */
  nuLabel?: string;
  compact?: boolean;
  className?: string;
}) {
  const g = balkGeometrie(delen, nuMin);
  if (!g) return null;
  const wijzer = g.nuPct;
  const label = wijzer !== null ? (nuLabel ?? minNaarTijd(nuMin!)) : null;
  const omschrijving = `Dienst van ${minNaarTijd(g.start)} tot ${minNaarTijd(g.end)}${
    g.gaten.length ? `, ${g.gaten.length} pauze${g.gaten.length === 1 ? '' : 's'}` : ''
  }${wijzer !== null ? `, nu ${label}, ${g.voortgang} % gereden` : ''}`;
  const balkH = compact ? 'h-1' : 'h-1.5';
  const schuif = (pct: number) => ({ transform: `translateX(${pct}%)` });

  return (
    // Bovenruimte = tijdlabel (16) + lucht + streepjes (8) + lucht: het label
    // van de wijzer stak anders boven de kaartlijn uit (Jarno 04-09).
    // Vaste zones van boven naar onder: tijdlabel (top-1.5, 16 px) · lucht ·
    // uurstreepjes (top-[26px], 8 px) · lucht · balk (pt-10). Zo raakt het
    // label nooit de kaartlijn erboven of de streepjes (Jarno 04-09).
    <div className={cn('relative overflow-x-clip', compact ? 'pt-7 pb-4' : 'pt-10 pb-5', className)} role="img" aria-label={omschrijving}>
      {wijzer !== null && (
        <span
          aria-hidden="true"
          data-rol="wijzer-label"
          className={cn('absolute inset-x-0 transition-transform duration-1000', compact ? 'top-0.5' : 'top-1.5')}
          style={schuif(wijzer)}
        >
          <span
            className={cn(
              'absolute left-0 top-0 whitespace-nowrap font-mono font-bold tabular-nums leading-4 text-oker-700',
              compact ? 'text-2xs' : 'text-xs',
              wijzer < 8 ? 'translate-x-0' : wijzer > 92 ? '-translate-x-full' : '-translate-x-1/2',
            )}
          >
            {label}
          </span>
        </span>
      )}
      {/* Uurstreepjes boven de balk (niet in de tegel). */}
      {!compact && (
        <div aria-hidden="true" className="absolute inset-x-0 top-[26px] h-2">
          {g.streepjes.map((s) => (
            <span
              key={s.pct}
              className={cn('absolute bottom-0 w-px bg-slate-300', s.groot ? 'h-2' : 'h-1')}
              style={{ left: `${s.pct}%` }}
            />
          ))}
        </div>
      )}
      {/* De balk: per deel een segment; gaten = pauzes (stippellijn). */}
      <div className={cn('relative', balkH)} aria-hidden="true">
        {g.gaten.map(([links, breedte]) => (
          <span
            key={`gat-${links}`}
            className="absolute top-1/2 -translate-y-1/2 border-t border-dashed border-slate-300"
            style={{ left: `${links}%`, width: `${breedte}%` }}
          />
        ))}
        {g.segmenten.map((s) => (
          <span
            key={`seg-${s.links}`}
            className={cn('absolute inset-y-0 overflow-hidden rounded-full bg-slate-200/70')}
            style={{ left: `${s.links}%`, width: `${s.breedte}%` }}
          >
            <span
              data-rol="vulling"
              className={cn('block h-full w-full rounded-full transition-transform duration-1000', s.gereden ? 'bg-oker-500/55' : 'bg-oker-500')}
              style={schuif(s.gevuld - 100)}
            />
          </span>
        ))}
        {/* Wijzer: kort gouden streepje door de balk, tijd erboven. */}
        {wijzer !== null && (
          <span
            data-rol="wijzer"
            className="absolute inset-x-0 top-1/2 z-10 transition-transform duration-1000"
            style={schuif(wijzer)}
          >
            <span className={cn('absolute left-0 top-0 block w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-oker-500', compact ? 'h-3' : 'h-4')} />
          </span>
        )}
      </div>
      {/* Begin- en eindtijd onder de balk. */}
      <div aria-hidden="true" className={cn('mt-1.5 flex justify-between font-mono font-medium tabular-nums text-slate-500', compact ? 'text-2xs' : 'text-xs')}>
        <span>{minNaarTijd(g.start)}</span>
        <span>{minNaarTijd(g.end)}</span>
      </div>
    </div>
  );
}
