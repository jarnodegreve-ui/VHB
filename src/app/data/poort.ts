import type { User, View } from '../../types';

/**
 * De poort van de eerste dataload (ronde 3, 19-09): wat NIET in de poort zit.
 * `isInitialLoad` valt weg zodra de collecties voor het eerste scherm van de
 * rol binnen zijn (useAppData.loadAppData); de collecties hieronder laden
 * direct daarna op de achtergrond en dragen een `…Geladen`-vlag in de
 * datacontext. Zuiver en React-vrij, zodat het los te testen is.
 */

/** Collecties die NIET in de poort zitten maar direct erna (of bij het openen
 *  van een scherm dat ze nodig heeft) laden. Elk heeft een `…Geladen`-vlag
 *  in de datacontext. */
export type Uitgesteld = 'services' | 'planningCodes' | 'planningMatrix' | 'activityLog' | 'users' | 'swaps' | 'documenten' | 'diversions' | 'updates' | 'meldingen';

/** Wat per rol uitgesteld laadt. Staf: de zware beheercollecties (het
 *  dashboard heeft ze niet nodig voor zijn eerste beeld). Chauffeur en
 *  technieker: gebruikers, ruilen en de documentenbadge (alleen badges en
 *  contacten), en sinds 15-10 ook updates en meldingen (een lijst en een
 *  badge, geen eerste beeld). De omleidingen laden voor élke rol ná de poort
 *  (snelheidsonderzoek 15-10: in elke trage opstart de langste call, en de
 *  poort wachtte erop; Mijn dag en het dashboard tonen hun omleidingenkaart
 *  zodra ze binnen zijn). Verlof blijft in de poort: Mijn week en de
 *  verlofbadge leiden "verlof" eruit af en zouden anders even "vrij" tonen.
 *  Zuiver, getest in poort.test.ts. */
export const uitgesteldVoor = (rol: User['role']): Uitgesteld[] =>
  rol === 'admin' ? ['diversions', 'services', 'planningCodes', 'planningMatrix', 'activityLog']
    : rol === 'planner' ? ['diversions', 'services', 'planningCodes', 'planningMatrix']
      : ['diversions', 'updates', 'meldingen', 'users', 'swaps', 'documenten'];

/** Schermen die een uitgestelde collectie nodig hebben voor hun eerste beeld:
 *  staat de gebruiker daar al (deeplink) of gaat hij erheen tijdens de poort,
 *  dan start die collectie meteen. Alleen sleutels uit `uitgesteldVoor(rol)`
 *  tellen; voor staf zitten users en swaps gewoon in de poort. */
export const UITGESTELD_PER_VIEW: Partial<Record<View, Uitgesteld[]>> = {
  // De omleidingen starten op de startschermen meteen naast de poort (ze
  // blokkeren haar alleen niet meer); updates en meldingen op hun eigen scherm.
  dashboard: ['diversions'],
  'mijn-dag': ['diversions'],
  omleidingen: ['diversions'],
  'beheer-omleidingen': ['diversions'],
  vandaag: ['diversions'],
  updates: ['updates'],
  meldingen: ['meldingen'],
  dienstoverzicht: ['services'],
  'beheer-debug': ['services'],
  'planning-matrix': ['services', 'planningCodes', 'planningMatrix'],
  'planning-codes': ['planningCodes'],
  dekking: ['planningMatrix'],
  ziekte: ['planningMatrix'],
  rooster: ['users', 'swaps'],
  'ruil-verzoeken': ['users', 'swaps'],
  contacten: ['users'],
  verlof: ['users'],
  werkprestaties: ['users'],
  defecten: ['users'],
};
