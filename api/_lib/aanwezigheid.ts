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

// --- Plaats van aanmelden (2026-09-20) ---

/**
 * De plaats waar een sessie vandaan komt, op stadsniveau.
 *
 * Bron zijn de geo-headers die Vercel op elk verzoek zet, afgeleid van het
 * IP-adres van de bezoeker. Het IP-adres zelf komt hier nooit voorbij en wordt
 * nergens bewaard: stad, regio en land volstaan om een aanmelding van een
 * onverwachte plek te herkennen, en ze zijn veel minder persoonlijk dan een
 * adres dat naar één aansluiting wijst.
 */
export type AanwezigheidLocatie = {
  /** ISO 3166-1 alpha-2, hoofdletters ("BE"). */
  land: string;
  /** ISO 3166-2-deel zonder landprefix ("VOV"), of null. */
  regio: string | null;
  /** Plaatsnaam zoals Vercel hem levert ("Gent"), of null. */
  stad: string | null;
};

/** Spiegelt de check-constraints in 2026-09-20_user_presence_locatie.sql. */
export const LOCATIE_MAX = { regio: 3, stad: 80 } as const;

type HeaderWaarde = string | string[] | undefined;
const eersteWaarde = (w: HeaderWaarde): string => (Array.isArray(w) ? w[0] ?? '' : w ?? '');

/**
 * Plaatsnaam uit de header: URL-gecodeerd ("S%C3%A3o%20Paulo"). Alles wat geen
 * plaatsnaam kan zijn wordt null in plaats van half opgeslagen: kapotte
 * codering, of langer dan een echte plaatsnaam ooit is.
 */
const leesStad = (ruw: string): string | null => {
  if (!ruw) return null;
  let tekst: string;
  try {
    tekst = decodeURIComponent(ruw);
  } catch {
    return null;
  }
  // Stuurtekens (categorie Cc, dus ook regeleindes) horen niet in een
  // plaatsnaam en al zeker niet in een beheerscherm.
  tekst = tekst.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!tekst || tekst.length > LOCATIE_MAX.stad) return null;
  return tekst;
};

const REGIO_PATROON = new RegExp(`^[A-Z0-9]{1,${LOCATIE_MAX.regio}}$`);

/**
 * Leest de plaats uit de request-headers. Geeft null wanneer er geen bruikbaar
 * land is: lokaal, in tests en achter elke andere host dan Vercel ontbreken de
 * headers gewoon, en zonder land valt er niets te zeggen over binnen of buiten
 * België. Gooit nooit.
 */
export const locatieUitHeaders = (headers: Record<string, HeaderWaarde> | undefined | null): AanwezigheidLocatie | null => {
  try {
    if (!headers) return null;
    const land = eersteWaarde(headers['x-vercel-ip-country']).trim().toUpperCase();
    // Vercel laat de header weg, of stuurt "XX", voor een adres dat het niet
    // kan plaatsen.
    if (!/^[A-Z]{2}$/.test(land) || land === 'XX') return null;
    const regioRuw = eersteWaarde(headers['x-vercel-ip-country-region']).trim().toUpperCase();
    const regio = REGIO_PATROON.test(regioRuw) ? regioRuw : null;
    const stad = leesStad(eersteWaarde(headers['x-vercel-ip-city']).trim());
    return { land, regio, stad };
  } catch {
    return null;
  }
};
