import { apiJson } from './api';

export type CalendarLinks = {
  /** https-URL van de persoonlijke .ics-feed (kopiëren/plakken) */
  url: string;
  /** webcal://-variant — opent direct het abonneer-dialoog (Apple/iOS) */
  webcal: string;
  /** "Toevoegen aan Google Agenda"-link */
  googleUrl: string;
};

/** Haalt de persoonlijke agenda-abonnee-links op voor de ingelogde gebruiker. */
export function fetchCalendarLinks(): Promise<CalendarLinks> {
  return apiJson<CalendarLinks>('/api/calendar-url');
}
