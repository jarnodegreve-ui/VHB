import { useMemo, useState, type ReactNode } from 'react';
import { Bell, Calendar, CheckCheck, FolderOpen, Info, MapPin, Plane, RotateCcw } from 'lucide-react';
import { useAppDataContext } from '../app/AppDataContext';
import { routeUitUrl } from '../app/router';
import { MELDING_SOORT_LABEL } from '../../shared/schemas/meldingen';
import { isoDate } from '../lib/datum';
import { filterMeldingen, groepeerPerDag, soortenIn, tijdVan, type MeldingFilter } from '../lib/meldingen';
import { cn } from '../lib/ui';
import type { Melding, MeldingSoort, View } from '../types';
import { Card } from '../components/Card';
import { Button, FilterChip } from '../components/primitives';
import { EmptyState, PageHeader, PageShell } from '../components/ui';

/**
 * Meldingencentrum: alles wat het portaal voor jou verstuurde — ook als je
 * geen push aan hebt staan. Eén lijst, per dag gegroepeerd, met een stille
 * oker-stip voor wat je nog niet las. Een tik markeert de melding gelezen en
 * brengt je naar het scherm waar het over gaat (`doel`). "Alles gelezen" is
 * bewust een stille secundaire actie: dit scherm is een overzicht, geen
 * werklijst.
 */

const ICOON_PER_SOORT: Record<MeldingSoort, ReactNode> = {
  planning: <Calendar size={16} />,
  verlof: <Plane size={16} />,
  ruil: <RotateCcw size={16} />,
  update: <Bell size={16} />,
  omleiding: <MapPin size={16} />,
  document: <FolderOpen size={16} />,
  systeem: <Info size={16} />,
};

export function MeldingenView({ onNavigate }: { onNavigate?: (view: View) => void }) {
  const { meldingen, ongelezenMeldingen, markeerMeldingenGelezen } = useAppDataContext();
  const [filter, setFilter] = useState<MeldingFilter>('alles');
  const vandaag = isoDate(new Date());

  const soorten = useMemo(() => soortenIn(meldingen), [meldingen]);
  // Een filter op een soort die niet (meer) voorkomt valt terug op alles.
  const actiefFilter: MeldingFilter = filter === 'alles' || filter === 'ongelezen' || soorten.includes(filter) ? filter : 'alles';
  const zichtbaar = useMemo(() => filterMeldingen(meldingen, actiefFilter), [meldingen, actiefFilter]);
  const groepen = useMemo(() => groepeerPerDag(zichtbaar, vandaag), [zichtbaar, vandaag]);

  const open = (m: Melding) => {
    if (!m.gelezenOp) void markeerMeldingenGelezen([m.id]);
    if (!m.doel || !onNavigate) return;
    const route = routeUitUrl('/' + m.doel.replace(/^\/+/, ''));
    if (route) onNavigate(route.view);
  };

  return (
    <PageShell>
      <PageHeader
        title="Meldingen"
        description="Wat er voor jou binnenkwam: planning, verlof, ruil en updates."
        actions={ongelezenMeldingen > 0 ? (
          <Button variant="secondary" size="sm" icon={<CheckCheck size={14} />} onClick={() => void markeerMeldingenGelezen()}>
            Alles gelezen
          </Button>
        ) : undefined}
      />

      {meldingen.length > 0 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter meldingen">
          <FilterChip active={actiefFilter === 'alles'} onClick={() => setFilter('alles')}>Alles</FilterChip>
          <FilterChip active={actiefFilter === 'ongelezen'} onClick={() => setFilter('ongelezen')}>
            Ongelezen{ongelezenMeldingen > 0 ? ` · ${ongelezenMeldingen}` : ''}
          </FilterChip>
          {soorten.map((s) => (
            <FilterChip key={s} active={actiefFilter === s} onClick={() => setFilter(s)}>
              {MELDING_SOORT_LABEL[s]}
            </FilterChip>
          ))}
        </div>
      )}

      {meldingen.length === 0 ? (
        <EmptyState
          title="Nog geen meldingen"
          message="Zodra de planning iets voor jou heeft — een beslissing, een ruil, een update — verschijnt het hier."
        />
      ) : groepen.length === 0 ? (
        <EmptyState
          variant="klaar"
          title={actiefFilter === 'ongelezen' ? 'Alles gelezen' : 'Niets in deze categorie'}
          message={actiefFilter === 'ongelezen' ? 'Je bent helemaal bij.' : 'Kies een andere categorie of bekijk alles.'}
        />
      ) : (
        <div className="space-y-5">
          {groepen.map((groep) => (
            <section key={groep.dag || 'onbekend'} aria-label={groep.label} className="space-y-2">
              <h2 className="px-1 text-micro">{groep.label}</h2>
              <Card padding="none" as="section" className="overflow-hidden">
                <ul className="divide-y divide-slate-100">
                  {groep.items.map((m) => {
                    const ongelezen = !m.gelezenOp;
                    return (
                      <li key={m.id}>
                        {/* rauw: lijstrij met eigen layout (icoon, twee tekstregels, tijd + stip);
                            Button centreert en dwingt semibold/min-h af */}
                        <button
                          type="button"
                          onClick={() => open(m)}
                          className={cn(
                            'ios-pressable flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-row',
                            !m.doel && 'cursor-default',
                          )}
                        >
                          <span
                            className={cn(
                              'mt-0.5 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                              ongelezen ? 'bg-oker-500/15 text-oker-700' : 'bg-slate-500/12 text-slate-500',
                            )}
                            aria-hidden="true"
                          >
                            {ICOON_PER_SOORT[m.soort] ?? ICOON_PER_SOORT.systeem}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className={cn('block truncate text-sm', ongelezen ? 'font-semibold text-slate-900' : 'font-medium text-slate-700')}>
                              {m.titel}
                            </span>
                            {m.tekst && (
                              <span className="mt-0.5 line-clamp-2 block text-sm font-normal leading-snug text-slate-500">{m.tekst}</span>
                            )}
                          </span>
                          <span className="flex shrink-0 items-center gap-2 pt-0.5">
                            <span className="text-xs font-medium tabular-nums text-slate-500">{tijdVan(m.createdAt)}</span>
                            {ongelezen ? (
                              <span className="h-2 w-2 rounded-full bg-oker-500" aria-label="ongelezen" />
                            ) : (
                              <span className="h-2 w-2" aria-hidden="true" />
                            )}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}
    </PageShell>
  );
}
