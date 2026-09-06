/**
 * Dé datumhelpers van de client, in twee families:
 *
 *  - Date-objecten in lokale tijd: `isoDate` (Date → 'YYYY-MM-DD' van de dag
 *    die de gebruiker beleeft, nooit toISOString — die kantelt 's nachts naar
 *    de UTC-dag) en `addDays` (kalenderrekenen via setDate, dus DST-veilig).
 *  - ISO-strings zonder tijdzone: `addDagen`/`maandPlus` rekenen op de
 *    string zelf; een dag verschuift zo nooit door zomertijd of de klok.
 *
 * Eén bron — stond als addDagen/maandPlus verspreid over schoolkalender,
 * vervangers en het laadpalen-dashboard (controle-ronde 27-08, 41 en 43) en
 * als isoDate/vandaagIso/localIso/toLocaleDateString('en-CA') plus drie
 * dag-optellers over availability, kalender, shiftTime, typedag en
 * CoverageView (controle-ronde 05-09, 27). `availability.ts` re-exporteert
 * isoDate/addDays voor de bestaande importeurs. De API-kant heeft zijn eigen
 * exemplaar in api/helpers.ts (addDagenIso): api/ en src/ delen bewust geen
 * code.
 */

/** Lokale 'YYYY-MM-DD' van een Date (geen UTC-shift). */
export const isoDate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Date ± n dagen, in lokale kalenderdagen (setDate: DST-veilig). */
export const addDays = (d: Date, n: number): Date => {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
};

/** "YYYY-MM-DD" ± n dagen (via lokale middernacht + addDays; in BE bestaat
 *  lokale middernacht altijd, de zomertijd wisselt om 02:00). */
export const addDagen = (iso: string, n: number): string => isoDate(addDays(new Date(`${iso}T00:00:00`), n));

/** Dag-taal voor een datum t.o.v. vandaag: 'vandaag' (ook voor het verleden),
 *  'morgen', 'overmorgen', anders 'over n dagen'. Chauffeurs denken in
 *  "morgen/overmorgen", niet in een aftellend "17u 25m" (verzoek Jarno).
 *  Kalenderdag-verschil, dus 's avonds klopt "morgen" ook al is het < 12 u.
 *  Stond dubbel in DashboardView en MijnDagView (controle-ronde 05-09, 44). */
export const relatieveDag = (dateIso: string, vandaagIso: string): string => {
  const diff = Math.round(
    (new Date(`${dateIso}T00:00:00`).getTime() - new Date(`${vandaagIso}T00:00:00`).getTime()) / 86400000,
  );
  if (diff <= 0) return 'vandaag';
  if (diff === 1) return 'morgen';
  if (diff === 2) return 'overmorgen';
  return `over ${diff} dagen`;
};

/** "YYYY-MM" ± n maanden, over jaargrenzen heen. */
export const maandPlus = (maand: string, delta: number): string => {
  const [j, m] = maand.split('-').map(Number);
  const d = new Date(Date.UTC(j, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
