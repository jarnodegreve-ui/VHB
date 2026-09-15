import { createContext, useContext, type ReactNode } from 'react';
import type { AppActies, AppData } from './useAppData';

/**
 * De datalaag als context: App roept `useAppData` één keer aan en zet het
 * resultaat hier rond de schil. Views lezen wat ze nodig hebben via
 * `useAppDataContext()` i.p.v. het via 6-15 props door te krijgen.
 *
 * Twee contexten (punt 19, 15-09):
 * - de data-context draagt het platte object (data + acties); de referentie
 *   verandert alleen wanneer een dataveld verandert (useAppData memoiseert),
 *   dus een scroll of een toast in App rendert de lezers niet meer mee;
 * - de acties-context draagt alleen de acties met blijvende identiteiten:
 *   een component die enkel iets wil aanroepen (`markDocumentsSeen`,
 *   `fetchMeldingen`) leest `useAppActies()` en rendert nooit door data.
 */
const AppDataContext = createContext<AppData | null>(null);
const AppActiesContext = createContext<AppActies | null>(null);

export function AppDataProvider({ value, children }: { value: AppData; children: ReactNode }) {
  return (
    <AppActiesContext.Provider value={value.acties}>
      <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>
    </AppActiesContext.Provider>
  );
}

/** Zelfde context, maar null buiten de provider — voor views die ook los
 *  gerenderd worden (tests, print) en de datalaag alleen als extra gebruiken. */
export function useOptioneleAppData(): AppData | null {
  return useContext(AppDataContext);
}

/** Throwt buiten de provider: een view die dit gebruikt hoort in de schil. */
export function useAppDataContext(): AppData {
  const ctx = useContext(AppDataContext);
  if (!ctx) throw new Error('useAppDataContext buiten AppDataProvider, deze view hoort binnen de app-schil.');
  return ctx;
}

/** Alleen de acties (stabiele identiteiten): geen re-render bij datawijzigingen. */
export function useAppActies(): AppActies {
  const ctx = useContext(AppActiesContext);
  if (!ctx) throw new Error('useAppActies buiten AppDataProvider, deze component hoort binnen de app-schil.');
  return ctx;
}
