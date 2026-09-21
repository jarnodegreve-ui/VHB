import { AnimatePresence, motion } from 'motion/react';
import { ArrowUpRight, Bell, Calendar, CheckCheck, FolderOpen, Info, MapPin, Plane, RotateCcw, Wrench, X } from 'lucide-react';
import { useAppDataContext } from '../app/AppDataContext';
import { routeUitUrl } from '../app/router';
import { datumsLeesbaar, tijdVan } from '../lib/meldingen';
import { verwijderMeldingMetOngedaan } from '../lib/meldingVerwijderen';
import { DUR, EASE, EASE_SPRING } from '../lib/motion';
import { cn } from '../lib/ui';
import type { Melding, MeldingSoort, View } from '../types';
import { IconButton } from './primitives';

/**
 * Het uitklappaneel onder de bel (puntje Jarno 21-09): de laatste meldingen,
 * elk met een kruisje om ze weg te doen, "Alles gelezen" in de kop en de weg
 * naar het volledige scherm onderaan. Zelfde vorm en gedrag als het paneel
 * Open taken ernaast.
 *
 * Los bestand omdat het lazy geladen wordt: de bel zelf staat in de topbar en
 * dus in de hoofdbundel, dit paneel (motion, acht iconen, de router-helper)
 * hoort daar niet bij. Zelfde afspraak als WerkvoorraadMenu.
 */

const ICOON_PER_SOORT: Record<MeldingSoort, ReturnType<typeof Bell>> = {
  planning: <Calendar size={16} />,
  verlof: <Plane size={16} />,
  ruil: <RotateCcw size={16} />,
  update: <Bell size={16} />,
  omleiding: <MapPin size={16} />,
  document: <FolderOpen size={16} />,
  techniek: <Wrench size={16} />,
  systeem: <Info size={16} />,
};

/** Hoeveel meldingen het paneel toont; de rest staat op het scherm. */
const IN_PANEEL = 6;

export function MeldingenPaneel({ onNavigate, onSluit }: { onNavigate: (view: View) => void; onSluit: () => void }) {
  const { meldingen, ongelezenMeldingen, markeerMeldingenGelezen, verwijderMelding, herstelMelding } = useAppDataContext();
  const zichtbaar = meldingen.slice(0, IN_PANEEL);

  const ga = (view: View) => { onSluit(); onNavigate(view); };

  const openMelding = (m: Melding) => {
    if (!m.gelezenOp) void markeerMeldingenGelezen([m.id]);
    if (!m.doel) return onSluit();
    const route = routeUitUrl('/' + m.doel.replace(/^\/+/, ''));
    if (!route) return onSluit();
    ga(route.view);
  };

  return (
    <AnimatePresence>
      <motion.div
        role="menu"
        aria-label="Meldingen"
        initial={{ opacity: 0, scale: 0.97, y: -4 }}
        animate={{ opacity: 1, scale: 1, y: 0, transition: { duration: DUR.fast, ease: EASE_SPRING } }}
        exit={{ opacity: 0, scale: 0.97, y: -4, transition: { duration: DUR.fast, ease: EASE } }}
        style={{ transformOrigin: 'top right' }}
        /* Mobiel: fixed met inset-x zodat het paneel de viewport volgt, net
           als het paneel Open taken. */
        className="absolute right-0 top-full z-50 mt-2 w-80 rounded-2xl bg-paper p-1.5 ring-1 ring-hairline elev-2 max-sm:fixed max-sm:inset-x-3 max-sm:top-auto max-sm:w-auto"
      >
        <div className="mb-1 flex items-center justify-between gap-2 border-b fine-divider px-3 py-2">
          <span className="text-sm font-semibold text-slate-800">Meldingen</span>
          {ongelezenMeldingen > 0 && (
            /* rauw: kopactie in een popover, moet dezelfde maat en tint houden
               als de titel ernaast — een Button vult de kop. */
            <button
              type="button"
              onClick={() => void markeerMeldingenGelezen()}
              className="inline-flex items-center gap-1.5 rounded-lg px-1.5 py-1 text-xs font-semibold text-slate-500 transition-colors duration-fast hover:bg-surface-soft-hover hover:text-slate-800"
            >
              <CheckCheck size={14} aria-hidden="true" />
              Alles gelezen
            </button>
          )}
        </div>

        {zichtbaar.length === 0 ? (
          <div className="px-3 py-3">
            <p className="text-sm font-semibold text-slate-800">Geen meldingen</p>
            <p className="text-xs font-normal text-slate-500">Zodra er iets voor jou is, staat het hier.</p>
          </div>
        ) : (
          zichtbaar.map((m) => {
            const ongelezen = !m.gelezenOp;
            return (
              /* rauw: menurij met een eigen kruisje ernaast — een Button kan
                 geen tweede knop in zijn raakvlak dragen. */
              <div key={m.id} className="group/rij flex items-start gap-1 rounded-xl transition-colors duration-fast hover:bg-surface-soft-hover">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => openMelding(m)}
                  className={cn(
                    'flex min-w-0 flex-1 items-start gap-3 rounded-xl px-3 py-2.5 text-left',
                    !m.doel && 'cursor-default',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className={cn(
                      'mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                      ongelezen ? 'bg-oker-500/15 text-oker-700' : 'bg-slate-500/12 text-slate-500',
                    )}
                  >
                    {ICOON_PER_SOORT[m.soort] ?? ICOON_PER_SOORT.systeem}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block truncate text-sm', ongelezen ? 'font-semibold text-slate-900' : 'font-medium text-slate-700')}>
                      {datumsLeesbaar(m.titel)}
                    </span>
                    {m.tekst && (
                      <span className="mt-0.5 block truncate text-xs font-normal text-slate-500">{datumsLeesbaar(m.tekst)}</span>
                    )}
                  </span>
                  <span className="shrink-0 pt-0.5 text-xs font-medium text-slate-500">{tijdVan(m.createdAt)}</span>
                </button>
                {/* Het kruisje verschijnt bij hover of focus; op een
                    aanraakscherm (geen hover) staat het er altijd. */}
                <IconButton
                  label="Melding verwijderen"
                  variant="ghost"
                  size="sm"
                  className="mt-1 mr-1 shrink-0 text-slate-400 opacity-100 hover:text-slate-800 pointer-fine:opacity-0 pointer-fine:group-hover/rij:opacity-100 pointer-fine:focus-visible:opacity-100"
                  onClick={() => verwijderMeldingMetOngedaan(m.id, verwijderMelding, herstelMelding)}
                >
                  <X size={14} />
                </IconButton>
              </div>
            );
          })
        )}

        <div className="mt-1 border-t fine-divider pt-1">
          {/* rauw: dropdown-menurij (role=menuitem), zelfde uiterlijk als de rijen erboven. */}
          <button
            role="menuitem"
            type="button"
            onClick={() => ga('meldingen')}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-medium text-slate-600 transition-colors duration-fast hover:bg-surface-soft-hover hover:text-slate-900"
          >
            <span className="shrink-0 text-slate-500"><Bell size={16} /></span>
            <span className="flex-1">Alle meldingen</span>
            <ArrowUpRight size={14} className="shrink-0 text-slate-400" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
