import type { ReactNode } from 'react';
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
  'planning-matrix': { kpis: 3 },
};

export function skeletVoor(view: View): ReactNode {
  return <ViewLoader view={view} {...SKELET_PER_VIEW[view]} />;
}
