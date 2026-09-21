/** De kalenderdag in België, waartegen een rapport met een peildatum rekent (de server draait op UTC). */
export const vandaagInBelgie = (nu: Date = new Date()): string => nu.toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" });
