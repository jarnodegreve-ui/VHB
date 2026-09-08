import { z } from 'zod';

/**
 * Eén geconfigureerde zod voor alle gedeelde schema's. `jitless`: Zod 4
 * probeert standaard objectparsers te compileren met `new Function`, wat
 * onder onze Content-Security-Policy (script-src zonder unsafe-eval) elke
 * keer een geblokkeerde eval oplevert. Zod valt dan stil terug op de gewone
 * parser, maar de browser rapporteert elke poging via report-uri: ±50
 * "CSP blokkeerde eval"-meldingen per dag in Systeemstatus › Fouten
 * (gezien 08-09-2026). Zonder JIT gebeurt er niets, en het verschil in
 * snelheid is voor onze formulieren onmeetbaar.
 */
z.config({ jitless: true });

export { z };
