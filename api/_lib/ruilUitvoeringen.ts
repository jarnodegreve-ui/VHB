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
 *
 * Sinds 16-10 kiest het ruiloverzicht ook op de datum van de DIENST
 * (`laatsteUitvoeringPerRuil`): dan is de vraag niet "wat is in deze periode
 * doorgevoerd" maar "welke ruilen van diensten in deze periode zijn ooit
 * doorgevoerd", en telt elke ruil één keer.
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

/**
 * Per ruil de laatste logregel die hem doorvoerde (een actie uit `acties`), in
 * de volgorde van de ruilen; een ruil die nooit doorgevoerd werd valt weg. Een
 * ruil die na een terugdraai opnieuw doorgevoerd werd, staat er één keer in,
 * met zijn laatste doorvoer. De logregels per ruil komen oudste eerst
 * (`getSwapHistories`), maar de keuze hangt daar niet van af.
 */
export const laatsteUitvoeringPerRuil = <S extends { id?: unknown }, R extends { action?: string | null; createdAt: string }>(
  ruilen: readonly S[],
  logPerRuil: Readonly<Record<string, readonly R[]>>,
  acties: readonly string[],
): Array<{ swap: S; regel: R }> => {
  const doorvoer = new Set(acties);
  const uit: Array<{ swap: S; regel: R }> = [];
  for (const swap of ruilen) {
    const id = String(swap.id ?? "");
    // hasOwn: een ruil-id als "constructor" mag geen regels van Object.prototype vinden.
    const regels = id && Object.prototype.hasOwnProperty.call(logPerRuil, id) ? logPerRuil[id] : [];
    let laatste: R | null = null;
    for (const regel of regels) {
      if (!doorvoer.has(String(regel.action ?? ""))) continue;
      if (!laatste || String(regel.createdAt).localeCompare(String(laatste.createdAt)) >= 0) laatste = regel;
    }
    if (laatste) uit.push({ swap, regel: laatste });
  }
  return uit;
};

/** De logregels waarvan de Brusselse kalenderdag in [van, tot] valt, oudste eerst. */
export const uitvoeringenOpDagen = <T extends { createdAt: string }>(regels: readonly T[], van: string, tot: string): T[] =>
  regels
    .filter((regel) => {
      const dag = brusselseDagVan(regel.createdAt);
      return dag !== null && dag >= van && dag <= tot;
    })
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
