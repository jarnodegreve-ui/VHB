import { MAX_PERIODE_DAGEN, dagPlus, dagenInPeriode } from "../../shared/rapporten/periode.js";

/**
 * "Welke wissels zijn in deze periode UITGEVOERD": één kern voor het wekelijkse
 * ruiloverzicht (GET /api/swaps/uitgevoerd) en het rapport Uitgevoerde wissels,
 * zodat blad en rapport nooit een andere dag kunnen kiezen voor dezelfde
 * logregel. Het uitvoeringsmoment is de logregel (`SWAP_UITVOERING_ACTIES`),
 * niet `decidedat`; de dag is de Brusselse kalenderdag van dat moment.
 * Ruil-logregels ruimt de nachtcron nooit op (`pruneOldRecords` slaat
 * `entity_type = 'swap'` over), dus dit werkt ook voor meer dan een jaar terug.
 * Puur, geen database.
 */

/** Langste periode die in één keer opgevraagd mag worden: de rapportgrens (was 31 dagen, genoeg voor het weekblad). */
export const MAX_UITVOERING_DAGEN = MAX_PERIODE_DAGEN;

const ISO_DAG = /^\d{4}-\d{2}-\d{2}$/;

/** Reden waarom [van, tot] niet kan, of null. Zelfde teksten als het endpoint altijd gaf, met de nieuwe grens. */
export const uitvoeringPeriodeFout = (van: string, tot: string): string | null => {
  if (!ISO_DAG.test(van) || !ISO_DAG.test(tot) || tot < van || dagenInPeriode({ van, tot }) === 0) {
    return "Geef een geldige periode mee (van en tot als jjjj-mm-dd, tot niet vóór van).";
  }
  if (dagenInPeriode({ van, tot }) > MAX_UITVOERING_DAGEN) return `De periode mag hoogstens ${MAX_UITVOERING_DAGEN} dagen beslaan.`;
  return null;
};

/**
 * Het UTC-venster waarbinnen elke logregel van de Brusselse dagen [van, tot]
 * zeker valt: een dag ruimer aan elke kant, daarna filtert
 * `uitvoeringenOpDagen` op de echte kalenderdag. Dat klopt ook in de weken van
 * de zomer- en wintertijdwissel, zonder offsetwerk.
 */
export const utcVensterVoor = (van: string, tot: string): { vanIso: string; totIso: string } => ({
  vanIso: `${dagPlus(van, -1)}T00:00:00.000Z`,
  totIso: `${dagPlus(tot, 2)}T00:00:00.000Z`,
});

const MET_ZONE = /(Z|[+-]\d{2}:?\d{2})$/;
const ZONELOOS = /^(\d{4}-\d{2}-\d{2})/;

/**
 * Kalenderdag in België van een moment; null bij rommel. Een moment zonder
 * tijdzone is al plaatselijke tijd en blijft wat het is (zoals `dagVanTijdstip`
 * bij de verlofrapporten), dus de uitkomst hangt nooit af van de tijdzone van
 * de server.
 */
export const brusselseDagVan = (moment: string | null | undefined): string | null => {
  const tekst = String(moment ?? "").trim();
  if (!MET_ZONE.test(tekst)) return ZONELOOS.exec(tekst)?.[1] ?? null;
  const d = new Date(tekst);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" }) : null;
};

/** De logregels waarvan de Brusselse kalenderdag in [van, tot] valt, oudste eerst. */
export const uitvoeringenOpDagen = <T extends { createdAt: string }>(regels: readonly T[], van: string, tot: string): T[] =>
  regels
    .filter((regel) => {
      const dag = brusselseDagVan(regel.createdAt);
      return dag !== null && dag >= van && dag <= tot;
    })
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
