import { createContext, useContext, type ReactNode } from 'react';
import type { AppData } from './useAppData';

/**
 * De datalaag als context: App roept `useAppData` één keer aan en zet het
 * resultaat hier rond de schil. Views lezen wat ze nodig hebben via
 * `useAppDataContext()` i.p.v. het via 6-15 props door te krijgen.
 *
 * De context draagt het platte object (data + acties); de referentie
 * verandert alleen wanneer een dataveld verandert (useAppData memoiseert),
 * dus een scroll of een toast in App rendert de lezers niet meer mee. De
 * acties houden hun identiteit via `useStabieleActies` in de datalaag zelf,
 * dus een tweede context daarvoor had nooit een lezer (controle 16-09, nr. 17).
 */
const AppDataContext = createContext<AppData | null>(null);

export function AppDataProvider({ value, children }: { value: AppData; children: ReactNode }) {
  return <AppDataContext.Provider value={value}>{children}</AppDataContext.Provider>;
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
