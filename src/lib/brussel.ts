// Eigen module (niet in kalender.ts): de schermen die dit gebruiken zouden
// kalender.ts anders als losse chunk naast de datumkiezer in de warmup zetten.

/**
 * Vandaag als kalenderdag in Europe/Brussels ('YYYY-MM-DD'), los van de klok
 * van het toestel en nooit via UTC: tussen 00:00 en 02:00 gaf
 * `toISOString().slice(0, 10)` nog de vorige dag (datumtranche PR 1).
 */
export const vandaagBrussel = (nu: Date = new Date()): string => nu.toLocaleDateString('en-CA', { timeZone: 'Europe/Brussels' });
