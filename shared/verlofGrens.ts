/**
 * Tot wanneer verlof vastgelegd kan worden (regel Jarno 02-10): tot en met
 * 31 december van het jaar na het lopende. Eén bron voor de server
 * (POST /api/leave en de ziekmelding) en het aanvraagformulier, zodat de
 * grens en de tekst niet uit elkaar kunnen lopen.
 *
 * `vandaag` is de Brusselse kalenderdag 'JJJJ-MM-DD': het lopende jaar is dat
 * van het portaal, niet dat van de klok van een toestel of van de server
 * (server: `brusselsDay`, scherm: `vandaagBrussel`).
 *
 * Bewust zonder zod of andere imports: het verlofscherm en eventuele
 * startschermen mogen dit laden zonder iets mee te slepen.
 *
 * Waarom een grens: de einddatum was alleen op het patroon getoetst. Een
 * aanvraag tot 31/12/9999 werd bewaard, en elk rapport en elk paneel dat de
 * dagen van een periode telt liep daarna duizenden jaren af, per lezing.
 */

/** Het jaar waarin verlof uiterlijk eindigt. */
const uitersteVerlofjaar = (vandaag: string): number => Number(vandaag.slice(0, 4)) + 1;

/** Laatste dag ('JJJJ-MM-DD') waarop verlof mag eindigen. */
export const uitersteVerlofdag = (vandaag: string): string => `${uitersteVerlofjaar(vandaag)}-12-31`;

/** De tekst bij het veld en in het antwoord van de server. */
export const verlofGrensMelding = (vandaag: string): string => `Verlof aanvragen kan tot en met 31/12/${uitersteVerlofjaar(vandaag)}.`;

/** Fouttekst als `einddatum` ('JJJJ-MM-DD') na de grens valt, anders null. */
export const verlofGrensFout = (einddatum: string, vandaag: string): string | null =>
  einddatum > uitersteVerlofdag(vandaag) ? verlofGrensMelding(vandaag) : null;
