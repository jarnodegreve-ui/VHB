/**
 * Aanwezigheid: wie was wanneer actief op het portaal.
 *
 * De pure beslissingen staan hier, los van Express en Supabase, zodat ze
 * testbaar zijn zonder database. Het opslaggedeelte staat in api/storage.ts
 * (noteerAanwezigheid / getAanwezigheid), de registratie hangt in de
 * auth-middleware.
 *
 * Achtergrond: hiervóór kwam "wie was actief" uit het auditlogboek, waar per
 * persoon hoogstens één regel per dag stond. Je zag daardoor alleen het
 * éérste moment van iemands dag, en wie de PWA warm liet staan verscheen er
 * na de eerste keer helemaal niet meer in.
 */

/** Hoogstens één schrijfactie per gebruiker per dit venster. */
export const HARTSLAG_MS = 5 * 60 * 1000;

/**
 * Langer stil dan dit = een nieuwe sessie (nieuwe rij) in plaats van het
 * oprekken van de vorige. Drie hartslagen ruim, zodat één gemiste ping door
 * een haperend netwerk of een korte schermvergrendeling geen sessie in
 * tweeën knipt, maar kort genoeg dat een middagpauze zichtbaar blijft als
 * twee losse periodes.
 */
export const SESSIE_GAT_MS = 15 * 60 * 1000;

/**
 * Per-instantie geheugen van "wanneer schreven we voor deze gebruiker het
 * laatst". De serverless-functie draait in meerdere instanties, dus dit is
 * een rem en geen garantie: in het slechtste geval schrijft elke warme
 * instantie één keer per venster voor dezelfde persoon. Dat is precies het
 * soort onnauwkeurigheid dat hier niet erg is (de rij wordt dan tweemaal
 * bijgewerkt naar vrijwel dezelfde tijd) en het scheelt een DB-lezing per
 * request.
 */
const laatsteSchrijf = new Map<string, number>();

/**
 * Mag er nu voor deze gebruiker geschreven worden? Registreert meteen dat we
 * het gaan doen, zodat gelijktijdige requests van dezelfde persoon er samen
 * maar één doorlaten.
 *
 * `nu` is injecteerbaar voor de test; in productie altijd Date.now().
 */
export const magSchrijven = (userId: string, nu: number = Date.now()): boolean => {
  const vorige = laatsteSchrijf.get(userId);
  if (vorige !== undefined && nu - vorige < HARTSLAG_MS) return false;
  laatsteSchrijf.set(userId, nu);
  // De kaart groeit met het aantal gebruikers, niet met het aantal requests,
  // maar een instantie die lang leeft houdt zo wel vertrokken gebruikers vast.
  // Opruimen zodra het er meer zijn dan een bedrijf ooit heeft.
  if (laatsteSchrijf.size > 500) {
    for (const [id, t] of laatsteSchrijf) {
      if (nu - t > SESSIE_GAT_MS) laatsteSchrijf.delete(id);
    }
  }
  return true;
};

/** Alleen voor tests: de rem leegmaken tussen gevallen door. */
export const vergeetHartslagen = () => laatsteSchrijf.clear();

/**
 * Hoort dit teken van leven bij de lopende sessie, of begint er een nieuwe?
 * `laatstGezien` is het last_seen_at van de jongste rij van deze gebruiker
 * (null = nog nooit gezien).
 */
export const hoortBijSessie = (laatstGezien: string | null, nu: number = Date.now()): boolean => {
  if (!laatstGezien) return false;
  const t = Date.parse(laatstGezien);
  if (!Number.isFinite(t)) return false;
  // Een tijdstip in de toekomst (klokverschil tussen instanties) hoort bij de
  // lopende sessie; anders zou elke scheve klok een nieuwe rij openen.
  if (t > nu) return true;
  return nu - t <= SESSIE_GAT_MS;
};
