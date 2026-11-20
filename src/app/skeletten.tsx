import type { ReactNode } from 'react';
import { Card } from '../components/Card';
import { Skeleton, SkeletonRow } from '../components/Skeleton';
import { ViewLoader } from '../components/ui';
import type { View } from '../types';

/**
 * Welk skelet een scherm krijgt zolang de chunk of de data er nog niet is
 * (fase 2, 22-09). Tot dan toonden 27 van 29 schermen hetzelfde generieke
 * blok (kop van 28 px + vijf rijen), terwijl de echte kop 58 tot 90 px hoog
 * is: bij elke eerste opening sprong de inhoud omlaag zodra het scherm er
 * stond. Nu tekent `ViewLoader` de échte kop (eyebrow uit de routetabel,
 * de titel als tekst, een skeletregel op de plek van de beschrijving) en
 * eronder de vorm van het scherm: `lijst` (LijstKaart met rijen), `tabel`
 * (toolbar, kolomkop, rijen), met optioneel een rij KPI-tegels erboven.
 *
 * `beschrijving` = het scherm zet een beschrijving onder de titel (de
 * PageHeader-prop), anders is de kop lager. Niet genoemd = lijst zonder
 * beschrijving, dus wie een scherm toevoegt hoeft hier niets te doen, maar
 * één regel maakt het skelet exact.
 *
 * Eén skelet per scherm (ronde 6, punt 3): de schil van de app (AppSkeleton),
 * de Suspense-terugval en het scherm zelf vragen het hier op, zodat een
 * koude start niet drie vormen na elkaar toont. Mijn dag heeft een eigen
 * vorm (`MijnDagSkelet`); het dashboard houdt zijn rasterskelet
 * (`DashboardSkelet` in ui.tsx).
 */
export type SkeletVorm = { soort?: 'lijst' | 'tabel'; kpis?: number; beschrijving?: boolean };

export const SKELET_PER_VIEW: Partial<Record<View, SkeletVorm>> = {
  omleidingen: { beschrijving: true },
  meldingen: { beschrijving: true },
  updates: { beschrijving: true },
  contacten: { beschrijving: true },
  'ruil-verzoeken': { beschrijving: true },
  verlof: { beschrijving: true },
  rooster: { beschrijving: true },
  ritblaadjes: { beschrijving: true },
  filmnummers: { beschrijving: true },
  vandaag: { beschrijving: true },
  werkvoorraad: { soort: 'tabel', kpis: 7, beschrijving: true },
  ziekte: { beschrijving: true, kpis: 3 },
  rapporten: { beschrijving: true },
  vervaldata: { soort: 'tabel', kpis: 4 },
  voertuigen: { soort: 'tabel', kpis: 4 },
  defecten: { soort: 'tabel', kpis: 4 },
  gebruikers: { soort: 'tabel' },
  'beheer-mails': { beschrijving: true },
  activiteit: { soort: 'tabel', kpis: 4 },
  looncontrole: { soort: 'tabel', kpis: 4 },
  dienstopbouw: { soort: 'tabel' },
  dagafsluiting: { soort: 'tabel' },
  dienstoverzicht: { soort: 'tabel' },
  'verlof-kalender': { soort: 'tabel' },
  'planning-codes': { soort: 'tabel' },
  dagtypekalender: { soort: 'tabel' },
  'planning-matrix': { kpis: 3 },
};

/**
 * Het skelet van Mijn dag: dezelfde kop- en kaartopbouw als de inhoud. Stond
 * tot ronde 6 in MijnDagView zelf; ongewijzigd verhuisd, zodat de schil en de
 * terugval het ook tonen. In MijnDagView cross-fadet `Verwissel` ernaar zodra
 * de data binnen is (minstens 180 ms skelet, geen flikker).
 */
export function MijnDagSkelet() {
  return (
    <div className="mx-auto max-w-2xl space-y-5" role="status" aria-busy="true" aria-label="Mijn dag wordt geladen">
      <div className="space-y-2 px-1 pt-1">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-48" />
      </div>
      <Card padding="none" className="overflow-hidden">
        <SkeletonRow className="border-b border-hairline-subtle" />
        <SkeletonRow className="border-b border-hairline-subtle" />
        <SkeletonRow />
      </Card>
    </div>
  );
}

/** `kopAlsSkelet`: alleen de schil van de app zet dit aan (rol nog onbekend,
 *  dus geen titel of sectiewoord als tekst; zie `ViewLoader`). */
export function skeletVoor(view: View, kopAlsSkelet = false): ReactNode {
  if (view === 'mijn-dag') return <MijnDagSkelet />;
  return <ViewLoader view={view} {...SKELET_PER_VIEW[view]} kopAlsSkelet={kopAlsSkelet} />;
}
