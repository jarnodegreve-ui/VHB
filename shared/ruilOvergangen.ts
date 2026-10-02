/**
 * Wie een dienstruil van welke status naar welke status mag brengen (01-10).
 *
 * Eén tabel voor de vier partijen. `PATCH /api/swaps/:id` (en via
 * `beslisRuilIntern` ook de Telegram-knoppen) en de lijstroute
 * `POST /api/swaps` lezen dezelfde tabel, zodat een regel niet op de ene weg
 * geldt en op de andere niet. Puur, zonder opslag: de routes beslissen zelf
 * wat een toegelaten overgang in de planning doet.
 *
 * De statussen: `pending` (wacht op de collega), `accepted` (collega akkoord,
 * wacht op de planning), `approved` (goedgekeurd, de wissel staat in de
 * planning), `completed` (afgehandeld, de wissel blijft staan), `rejected` en
 * `cancelled` (gaat niet door). De laatste drie zijn eindstatussen.
 */

export const RUIL_STATUSSEN = ['pending', 'accepted', 'approved', 'rejected', 'cancelled', 'completed'] as const;
export type RuilStatus = (typeof RUIL_STATUSSEN)[number];

/** De vier partijen. Aanvrager en collega zijn de chauffeurs van de ruil zelf;
 *  wie planner of admin is, beslist altijd in die rol, ook als hij toevallig
 *  in de ruil zit. */
export type RuilPartij = 'aanvrager' | 'collega' | 'planner' | 'admin';

/**
 * De tabel: per partij, van welke status naar welke.
 *
 * - De aanvrager trekt zijn eigen open aanvraag in.
 * - De collega antwoordt op een aanvraag die nog op hem wacht. `accepted` is
 *   zijn instemming: niemand anders schrijft die status.
 * - De planner keurt goed nadat de collega instemde, en handelt alleen af wat
 *   goedgekeurd is.
 * - Een admin mag ook zonder de instemming van de collega goedkeuren, en mag
 *   een open ruil rechtstreeks afhandelen. Dat laatste is een goedkeuring
 *   gevolgd door een afhandeling (`ruilVoertDoor`), nooit een afhandeling
 *   zonder doorvoer.
 */
export const RUIL_OVERGANGEN: Record<RuilPartij, Partial<Record<RuilStatus, readonly RuilStatus[]>>> = {
  aanvrager: {
    pending: ['cancelled'],
    accepted: ['cancelled'],
  },
  collega: {
    pending: ['accepted', 'rejected'],
  },
  planner: {
    pending: ['rejected', 'cancelled'],
    accepted: ['approved', 'rejected', 'cancelled'],
    approved: ['rejected', 'cancelled', 'completed'],
  },
  admin: {
    pending: ['approved', 'rejected', 'cancelled', 'completed'],
    accepted: ['approved', 'rejected', 'cancelled', 'completed'],
    approved: ['rejected', 'cancelled', 'completed'],
  },
};

// Alleen eigen sleutels: een status als 'constructor' mag nooit iets van het
// prototype van de tabel opleveren.
const naarVan = (partij: RuilPartij, van: unknown): readonly string[] => {
  const rij = RUIL_OVERGANGEN[partij];
  const sleutel = String(van ?? '');
  return Object.hasOwn(rij, sleutel) ? rij[sleutel as RuilStatus] ?? [] : [];
};

/** Staat deze overgang voor deze partij in de tabel? */
export const magRuilOvergang = (partij: RuilPartij, van: unknown, naar: unknown): boolean =>
  naarVan(partij, van).includes(String(naar ?? ''));

/** Eindstatussen: hieruit is geen overgang meer toegestaan. */
export const RUIL_EINDSTATUSSEN: ReadonlySet<string> = new Set(['rejected', 'cancelled', 'completed']);

/** Statussen die een planner of admin als beslissing kan opgeven. `pending` is
 *  geen beslissing, en `accepted` staat er alleen in omdat een ruil die al
 *  geaccepteerd is zo mag blijven staan. */
export const STAF_BESLIS_STATUSSEN: readonly string[] = ['accepted', 'approved', 'rejected', 'cancelled', 'completed'];

/** In deze statussen staat de wissel in de planning (bord, cel-waarheid en
 *  heropbouw spelen `approved` en `completed` af). */
export const isRuilDoorgevoerd = (status: unknown): boolean => status === 'approved' || status === 'completed';

/**
 * Voert deze overgang de wissel door in de planning? Dat is elke overgang van
 * een niet-doorgevoerde naar een doorgevoerde status: goedkeuren, en het
 * rechtstreeks afhandelen van een open ruil door een admin. Zo'n overgang
 * loopt altijd de controles van een goedkeuring af (verouderd, afwezigheid,
 * dubbele inplanning) en verplaatst de rijen, vóór de status geschreven wordt.
 */
export const ruilVoertDoor = (van: unknown, naar: unknown): boolean => isRuilDoorgevoerd(naar) && !isRuilDoorgevoerd(van);

/**
 * De stappen die één overgang in het activiteitenlog zet. Rechtstreeks
 * afhandelen is een goedkeuring gevolgd door een afhandeling: twee regels,
 * zodat het verloop per persoon en het overzicht van de uitgevoerde wissels
 * (die de regel "Dienstruil goedgekeurd" lezen) de wissel kennen.
 */
export const ruilLogStappen = (van: string, naar: string): Array<{ van: string; naar: string }> =>
  naar === 'completed' && ruilVoertDoor(van, naar)
    ? [{ van, naar: 'approved' }, { van: 'approved', naar: 'completed' }]
    : [{ van, naar }];

export type RuilOordeel = { ok: true } | { ok: false; status: 400 | 403 | 409; error: string };

/** Vaste zinnen: de app toont de reden van een 4xx aan de gebruiker. */
export const RUIL_WEIGERING = {
  accepteren: 'Niet toegestaan: alleen de aangezochte collega kan een ruil accepteren.',
  ongeldig: 'Ongeldige status.',
  zonderCollega: 'Niet toegestaan: een ruil zonder bevestiging van de collega kan alleen een admin rechtstreeks goedkeuren.',
  afgehandeld: 'Deze dienstruil is al afgehandeld en kan niet meer van status veranderen.',
  afhandelen: 'Niet toegestaan: een ruil die nog niet goedgekeurd is kan alleen een admin rechtstreeks afhandelen. Keur de ruil eerst goed.',
  overig: 'Deze dienstruil kan vanuit haar huidige status niet zo gewijzigd worden. Vernieuw de lijst en beoordeel opnieuw.',
} as const;

/**
 * Het oordeel over een statuswissel door een planner of admin, met de reden
 * als hij niet in de tabel staat. De volgorde van de redenen is die van de
 * routes van vóór de tabel, zodat een geweigerd verzoek dezelfde code en
 * dezelfde zin houdt. Alleen voor een echte wissel (`van` verschilt van
 * `naar`); wat een route met een ongewijzigde status doet, beslist ze zelf.
 */
export const beoordeelStafOvergang = (rol: 'planner' | 'admin', van: unknown, naar: unknown): RuilOordeel => {
  if (magRuilOvergang(rol, van, naar)) return { ok: true };
  const doel = String(naar ?? '');
  const bron = String(van ?? '');
  if (doel === 'accepted') return { ok: false, status: 403, error: RUIL_WEIGERING.accepteren };
  if (!STAF_BESLIS_STATUSSEN.includes(doel)) return { ok: false, status: 400, error: RUIL_WEIGERING.ongeldig };
  if (bron === 'pending' && doel === 'approved') return { ok: false, status: 403, error: RUIL_WEIGERING.zonderCollega };
  if (RUIL_EINDSTATUSSEN.has(bron)) return { ok: false, status: 409, error: RUIL_WEIGERING.afgehandeld };
  if (doel === 'completed') return { ok: false, status: 403, error: RUIL_WEIGERING.afhandelen };
  return { ok: false, status: 409, error: RUIL_WEIGERING.overig };
};
