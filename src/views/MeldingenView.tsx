import { useMemo, useState, type ReactNode } from 'react';
import { Bell, Calendar, CheckCheck, FolderOpen, Info, MapPin, Plane, RotateCcw, Wrench, X } from 'lucide-react';
import { useAppDataContext } from '../app/AppDataContext';
import { navigeer, routeUitUrl } from '../app/router';
import { MELDING_SOORT_LABEL } from '../../shared/meldingSoorten';
import { isoDate } from '../lib/datum';
import { datumsLeesbaar, filterMeldingen, groepeerPerDag, soortenIn, tijdVan, type MeldingFilter } from '../lib/meldingen';
import { verwijderMeldingMetOngedaan } from '../lib/meldingVerwijderen';
import { cn } from '../lib/ui';
import type { Melding, MeldingSoort, View } from '../types';
import { Card } from '../components/Card';
import { LijstAnimatie, LijstRij } from '../components/LijstRij';
import { Button, FilterChip, IconButton } from '../components/primitives';
import { EmptyState, PageHeader, PageShell } from '../components/ui';

/**
 * Meldingencentrum: alles wat het portaal voor jou verstuurde — ook als je
 * geen push aan hebt staan. Eén lijst, per dag gegroepeerd, met een stille
 * oker-stip voor wat je nog niet las. Een tik markeert de melding gelezen en
 * brengt je naar het scherm waar het over gaat (`doel`). "Markeer alles als
 * gelezen" is bewust een stille secundaire actie: dit scherm is een overzicht,
 * geen werklijst. Het kruisje rechts doet een melding weg, met een
 * ongedaan-toast (src/lib/meldingVerwijderen.ts).
 */

const ICOON_PER_SOORT: Record<MeldingSoort, ReactNode> = {
  planning: <Calendar size={16} />,
  verlof: <Plane size={16} />,
  ruil: <RotateCcw size={16} />,
  update: <Bell size={16} />,
  omleiding: <MapPin size={16} />,
  document: <FolderOpen size={16} />,
  techniek: <Wrench size={16} />,
  systeem: <Info size={16} />,
};

export function MeldingenView({ onNavigate }: { onNavigate?: (view: View) => void }) {
  const { meldingen, ongelezenMeldingen, markeerMeldingenGelezen, verwijderMelding, herstelMelding } = useAppDataContext();
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
    if (!route) return;
    onNavigate(route.view);
    // Doel met record (`updates/u2`): het id erbij zetten, zonder extra
    // history-entry (useRecordParam leest het in de view).
    if (route.params.length > 0) navigeer(route.view, { params: route.params, replace: true });
  };

  return (
    <PageShell>
      <PageHeader
        title="Meldingen"
        description="Wat er voor jou binnenkwam: planning, verlof, ruil en updates."
        actions={ongelezenMeldingen > 0 ? (
          <Button variant="secondary" size="sm" icon={<CheckCheck size={14} />} onClick={() => void markeerMeldingenGelezen()}>
            Markeer alles als gelezen
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
          message="Zodra de planning iets voor jou heeft, een beslissing, een ruil, een update, verschijnt het hier."
        />
      ) : groepen.length === 0 ? (
        <EmptyState
          variant="klaar"
          title={actiefFilter === 'ongelezen' ? 'Alles gelezen' : 'Niets in deze categorie'}
          message={actiefFilter === 'ongelezen' ? 'Je bent helemaal bij.' : 'Kies een andere categorie of bekijk alles.'}
        />
      ) : (
        <div className="space-y-5">
          {/* Onder het filter "Ongelezen" verdwijnt een melding zodra ze geopend
              is: de rij klapt dicht, een leeg geworden dag gaat mee (LijstRij). */}
          <LijstAnimatie aantal={groepen.length}>
          {groepen.map((groep) => (
            <LijstRij as="section" key={groep.dag || 'onbekend'} aria-label={groep.label} className="space-y-2">
              <h2 className="px-1 text-micro">{groep.label}</h2>
              <Card padding="none" as="section" className="overflow-hidden">
                <ul className="divide-y divide-hairline-subtle">
                  <LijstAnimatie aantal={groep.items.length}>
                  {groep.items.map((m) => {
                    const ongelezen = !m.gelezenOp;
                    return (
                      <LijstRij key={m.id}>
                        {/* rauw: lijstrij met eigen layout (icoon, twee tekstregels, tijd + stip)
                            en het kruisje ernaast; Button centreert en dwingt semibold/min-h af */}
                        <div className="group/rij flex items-stretch transition-colors hover:bg-surface-row">
                        <button
                          type="button"
                          onClick={() => open(m)}
                          className={cn(
                            'ios-pressable flex min-w-0 flex-1 items-start gap-3 py-3 pl-4 pr-2 text-left',
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
                            <span className={cn('block truncate text-md', ongelezen ? 'font-semibold text-slate-900' : 'font-medium text-slate-700')}>
                              {datumsLeesbaar(m.titel)}
                            </span>
                            {m.tekst && (
                              <span className="mt-0.5 line-clamp-2 block text-sm font-normal leading-snug text-slate-500">{datumsLeesbaar(m.tekst)}</span>
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
                        {/* Met een muis verschijnt het kruisje pas bij hover of
                            focus; op een aanraakscherm staat het er altijd. */}
                        <span className="flex shrink-0 items-center pr-2">
                          <IconButton
                            label="Melding verwijderen"
                            variant="ghost"
                            size="sm"
                            className="text-slate-400 opacity-100 hover:text-slate-800 pointer-fine:opacity-0 pointer-fine:group-hover/rij:opacity-100 pointer-fine:focus-visible:opacity-100"
                            onClick={() => verwijderMeldingMetOngedaan(m.id, verwijderMelding, herstelMelding)}
                          >
                            <X size={16} />
                          </IconButton>
                        </span>
                        </div>
                      </LijstRij>
                    );
                  })}
                  </LijstAnimatie>
                </ul>
              </Card>
            </LijstRij>
          ))}
          </LijstAnimatie>
        </div>
      )}
    </PageShell>
  );
}
