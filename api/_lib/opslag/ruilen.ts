import type { ShiftRecord, SwapRecord } from "../../types.js";
import { toDatabaseSwap, toPublicSwap } from "../../helpers.js";
import { IN_FILTER_MAX, inStukken, verwijderInStukken } from "./activiteit.js";
import { paginatedFetch, requireDb } from "./basis.js";

// --- Swaps ---

/** Waarde veilig in een PostgREST `or=(...)`-filter: tussen dubbele
 *  aanhalingstekens, met \\ en " ge-escaped (komma's, punten en haakjes in een
 *  id breken de filtersyntaxis anders). */
const orWaarde = (v: string) => `"${String(v).replace(/[\\"]/g, "\\$&")}"`;

/**
 * `betrokkenUserId`: alleen de wissels waar die gebruiker aanvrager ÓF
 * aangezochte collega is, gefilterd in de query i.p.v. de hele (groeiende)
 * tabel op te halen en in JS te filteren. Kolommen zijn hier lowercase
 * (requesterid/targetdriverid, zie supabase/setup_security.sql); dezelfde
 * voorwaarde als de RLS-policy swaps_read_involved_or_staff.
 */
export const getSwapsData = async (filters?: { betrokkenUserId?: string }) => {
  const client = requireDb();
  const betrokken = filters?.betrokkenUserId ? String(filters.betrokkenUserId) : null;
  const rows = await paginatedFetch((from, to) => {
    let q = client.from('swaps').select('*');
    if (betrokken) q = q.or(`requesterid.eq.${orWaarde(betrokken)},targetdriverid.eq.${orWaarde(betrokken)}`);
    return q.order('id', { ascending: true }).range(from, to);
  });
  return rows.map(toPublicSwap);
};

/** Alleen de gevraagde wissels — het weekoverzicht heeft er een handvol nodig
 *  en hoefde daarvoor niet de hele tabel te lezen. */
/** Eerste en laatste dag waarvoor er planning geïmporteerd is (grenzen van
 *  planning_matrix_rows). De maandplanning stopt daarop: voorbij de import is
 *  er niets te zien en een leeg bord leest als "er staat niemand ingepland"
 *  in plaats van "hier is nog niets geïmporteerd" (Jarno 18-09). */
export const getPlanningMatrixGrenzen = async (): Promise<{ eerste: string | null; laatste: string | null }> => {
  const client = requireDb();
  const rand = async (ascending: boolean) => {
    const { data, error } = await client
      .from('planning_matrix_rows')
      .select('source_date')
      .order('source_date', { ascending })
      .limit(1);
    if (error) throw error;
    const rij = (data ?? [])[0] as { source_date?: string } | undefined;
    return rij?.source_date ? String(rij.source_date) : null;
  };
  const [eerste, laatste] = await Promise.all([rand(true), rand(false)]);
  return { eerste, laatste };
};

export const getSwapsByIds = async (ids: string[]) => {
  const unieke = [...new Set(ids.map((id) => String(id)).filter(Boolean))];
  if (unieke.length === 0) return [];
  const client = requireDb();
  const stukken = await Promise.all(inStukken(unieke, IN_FILTER_MAX).map((deel) =>
    paginatedFetch((from, to) => client.from('swaps').select('*').in('id', deel).range(from, to), deel.length)));
  return stukken.flat().map(toPublicSwap);
};

export const saveSwapsData = async (data: any, idsToDelete: string[] = [], opties: { alleenPending?: boolean } = {}) => {
  const client = requireDb();
  const normalizedData = Array.isArray(data) ? data.map(toPublicSwap) : [];
  if (normalizedData.length > 0) {
    const { error } = await client.from('swaps').upsert(normalizedData.map(toDatabaseSwap));
    if (error) throw error;
  }
  // Intrekkingen: gevalideerd door de handler (zie POST /api/swaps).
  // alleenPending (chauffeur-pad): zelfde race-afdichting als saveLeaveData.
  await verwijderInStukken(client, 'swaps', 'id', idsToDelete.map(String), opties.alleenPending ? (q) => q.eq('status', 'pending') : undefined);
};

/**
 * Statuswissel van één ruil als compare-and-set (01-10): de rij wordt alleen
 * geschreven als ze nog de status heeft die de handler las. `false` = geen rij
 * geraakt, dus iemand anders besliste intussen (of trok de aanvraag in); de
 * rij blijft dan zoals ze is.
 *
 * Tot 01-10 schreven beide ruilroutes de hele rij met een onvoorwaardelijke
 * upsert, ná hun controle op een eerder gelezen momentopname. Twee beslissingen
 * die elkaar kruisten (de chauffeur trekt in terwijl de planner goedkeurt)
 * konden zo eindigen op `cancelled` met een verplaatste dienst.
 *
 * `target_seen_at` schrijft dit pad nooit: die kolom is van `markSwapTargetSeen`,
 * en een bevestiging die net binnenkwam mag niet door de momentopname van een
 * beslissing overschreven worden.
 */
export const schrijfSwapAlsStatus = async (swap: any, verwachteStatus: string): Promise<boolean> => {
  const client = requireDb();
  const { id, target_seen_at: _vanDeOntvanger, ...rij } = toDatabaseSwap(toPublicSwap(swap));
  const { data, error } = await client
    .from('swaps')
    .update(rij)
    .eq('id', id)
    .eq('status', String(verwachteStatus))
    .select('id');
  if (error) throw error;
  return (data ?? []).length > 0;
};

/** Nieuwe ruilen: een insert, geen upsert. Bestaat het id intussen al, dan
 *  gooit de database (23505) in plaats van de bestaande rij te overschrijven. */
export const voegSwapsToe = async (swaps: any[]): Promise<void> => {
  if (swaps.length === 0) return;
  const client = requireDb();
  const { error } = await client.from('swaps').insert(swaps.map(toPublicSwap).map(toDatabaseSwap));
  if (error) throw error;
};

/**
 * Gezien-bevestiging van de ontvangende chauffeur op een doorgevoerde wissel.
 * Directe kolom-update (niet via saveSwapsData): het bevestig-endpoint is de
 * enige schrijver en de array-route behoudt altijd de opgeslagen waarde.
 */
export const markSwapTargetSeen = async (swapId: string, seenAtIso: string): Promise<void> => {
  const client = requireDb();
  const { error } = await client
    .from('swaps')
    .update({ target_seen_at: seenAtIso })
    .eq('id', String(swapId));
  if (error) throw error;
};

// --- Planning-doorvoer van goedgekeurde ruilen -------------------------------
//
// Een goedgekeurde ruil/overname wordt direct in de planning doorgevoerd:
// de aangeboden dienst verhuist naar de collega en (bij een 1-op-1 ruil met
// een dienst als tegenprestatie) de terugdienst naar de aanvrager. De sleutel
// is (datum, dienstnummer, chauffeur) — bewust NIET de planning-rij-id, want
// die wordt bij elke heropbouw opnieuw gevormd. Annuleren draait de wissel
// om; de heropbouw past goedgekeurde ruilen opnieuw toe via de pure functie.

export type SwapCarryFields = Pick<SwapRecord, 'requesterId' | 'targetDriverId' | 'swapType' | 'returnDate' | 'returnCode' | 'shiftDate' | 'shiftLine'>;

/** Heeft deze ruil een dienst als tegenprestatie (1-op-1, geen vrije dag)? */
export const swapHasReturnShift = (swap: SwapCarryFields) =>
  swap.swapType !== 'overname' &&
  !!swap.returnDate &&
  !!swap.returnCode &&
  String(swap.returnCode).toLowerCase() !== 'vrij';

/** Raakt deze ruil een kalenderdag binnen [van, tot]? Beide benen tellen:
 *  bij een 1-op-1-ruil kan de aangeboden dienst vóór het bereik liggen en
 *  de terugdienst erin (maandoverschrijdende ruil). De heropbouw-replay
 *  filterde alleen op shiftDate, waardoor het terugbeen bij een
 *  periode-import stil op de collega terugviel terwijl de maandplanning-
 *  overlay hem bij de aanvrager toonde (controle-ronde 27-08, bevinding 7).
 *  Zonder shiftDate (legacy-ruil) blijft hij relevant — de replay telt hem
 *  dan als niet-toepasbaar, zoals voorheen. */
export const swapRaaktBereik = (swap: SwapCarryFields, bereik: { van: string; tot: string }): boolean => {
  const aangeboden = String(swap.shiftDate ?? '');
  if (!aangeboden || (aangeboden >= bereik.van && aangeboden <= bereik.tot)) return true;
  if (!swapHasReturnShift(swap)) return false;
  const terug = String(swap.returnDate);
  return terug >= bereik.van && terug <= bereik.tot;
};

/**
 * Pure variant voor de heropbouw: past goedgekeurde ruilen toe op een
 * in-memory rijenset (muteert de rijen in place, volgorde van `swaps` =
 * toepassingsvolgorde; roep aan met decidedAt-oplopend zodat een latere
 * ruil op het resultaat van een eerdere werkt).
 */
export const applySwapsToPlanningRows = (
  rows: Array<Pick<ShiftRecord, 'date' | 'line' | 'driverId'>>,
  swaps: SwapCarryFields[],
  /** Toets "is dit een code-dienst?" (api/_lib/codeDienst.ts). Zonder toets
   *  telt een ruil zonder rijen als overgeslagen, zoals voorheen. */
  isCodeDienst?: (line: unknown) => boolean,
): { applied: number; skipped: number; alVerwerkt: number; opBord: number } => {
  let applied = 0;
  let skipped = 0;
  // Een ruil van code-diensten (schoolrit, bureau, garage) heeft geen rijen om
  // te verhuizen: het bord legt hem erover. Apart geteld, om dezelfde reden
  // als alVerwerkt hieronder.
  let opBord = 0;
  // De planner had de ruil al in de Excel verwerkt (voorlopig de werkwijze,
  // Jarno 12-09): de dienst staat vers op de ontvanger, er valt niets te
  // verhuizen. Apart geteld, zodat het importlogje dit niet als "niet
  // toepasbaar" meldt — dat woord hoort een échte mismatch te betekenen
  // (dienst intussen handmatig verlegd).
  let alVerwerkt = 0;
  for (const swap of swaps) {
    const target = String(swap.targetDriverId ?? '');
    if (!swap.shiftDate || !swap.shiftLine || !target) {
      // Legacy-ruil van vóór de shift_info-migratie (of backfill vond de rij
      // niet meer): niet toepasbaar, telt als overgeslagen.
      skipped++;
      continue;
    }
    let touched = false;
    let alBijOntvanger = false;
    const verhuis = (date: string, line: string, van: string, naar: string) => {
      for (const row of rows) {
        if (row.date !== date || String(row.line) !== line) continue;
        if (String(row.driverId) === van) {
          row.driverId = naar;
          touched = true;
        } else if (String(row.driverId) === naar) {
          alBijOntvanger = true;
        }
      }
    };
    verhuis(swap.shiftDate, String(swap.shiftLine), String(swap.requesterId), target);
    if (swapHasReturnShift(swap)) verhuis(String(swap.returnDate), String(swap.returnCode), target, String(swap.requesterId));
    if (touched) applied++;
    else if (alBijOntvanger) alVerwerkt++;
    else if (isCodeDienst?.(swap.shiftLine) && (!swapHasReturnShift(swap) || isCodeDienst(swap.returnCode))) opBord++;
    else skipped++;
  }
  return { applied, skipped, alVerwerkt, opBord };
};

/**
 * Voert één richting van de wissel uit in de database. Geeft het aantal
 * geraakte rijen terug zodat de route kan waarschuwen (0 = de dienst staat
 * niet (meer) zo in de planning — bv. handmatig al aangepast).
 */
const movePlanningRows = async (date: string, line: string, fromDriverId: string, toDriverId: string): Promise<number> => {
  const client = requireDb();
  const { data, error } = await client
    .from('planning')
    .update({ driverId: toDriverId })
    .eq('date', date)
    .eq('line', line)
    .eq('driverId', fromDriverId)
    .select('id');
  if (error) throw error;
  return (data ?? []).length;
};

export type SwapCarryResult = {
  offeredMoved: number;
  returnMoved: number | null; // null = geen dienst-tegenprestatie (overname of vrije dag)
};

/** De benen van een ruil: de aangeboden dienst en, bij een 1-op-1 met een
 *  dienst als tegenprestatie, de terugdienst. */
export type SwapBenen = { aangeboden: boolean; terug: boolean };

/** Goedgekeurde ruil doorvoeren in de planning. `benen`: alleen die benen
 *  (01-10, om precies terug te zetten wat een verloren beslissing verplaatste);
 *  een overgeslagen been telt als 0 verplaatste rijen. Zonder = beide. */
export const applySwapToPlanning = async (swap: SwapCarryFields, benen?: SwapBenen): Promise<SwapCarryResult | null> => {
  const target = String(swap.targetDriverId ?? '');
  if (!swap.shiftDate || !swap.shiftLine || !target) return null;
  const offeredMoved = benen && !benen.aangeboden
    ? 0
    : await movePlanningRows(swap.shiftDate, String(swap.shiftLine), String(swap.requesterId), target);
  let returnMoved: number | null = null;
  if (swapHasReturnShift(swap)) {
    returnMoved = benen && !benen.terug
      ? 0
      : await movePlanningRows(String(swap.returnDate), String(swap.returnCode), target, String(swap.requesterId));
  }
  return { offeredMoved, returnMoved };
};

/** Geannuleerde (eerder goedgekeurde) ruil terugdraaien in de planning.
 *  `benen`: zie applySwapToPlanning. */
export const revertSwapFromPlanning = async (swap: SwapCarryFields, benen?: SwapBenen): Promise<SwapCarryResult | null> => {
  const target = String(swap.targetDriverId ?? '');
  if (!swap.shiftDate || !swap.shiftLine || !target) return null;
  const offeredMoved = benen && !benen.aangeboden
    ? 0
    : await movePlanningRows(swap.shiftDate, String(swap.shiftLine), target, String(swap.requesterId));
  let returnMoved: number | null = null;
  if (swapHasReturnShift(swap)) {
    returnMoved = benen && !benen.terug
      ? 0
      : await movePlanningRows(String(swap.returnDate), String(swap.returnCode), String(swap.requesterId), target);
  }
  return { offeredMoved, returnMoved };
};

/** Staat de wissel van deze ruil al in de planning? 'doorgevoerd' = de
 *  aangeboden dienst staat bij de collega (en de eventuele terugdienst bij
 *  de aanvrager), 'niet_doorgevoerd' = nog bij de aanvrager, 'onbekend' =
 *  verlegd/verdwenen of geen dienst-info. Hiermee wordt goedkeuren
 *  idempotent en kan afwijzen een halve doorvoer (planning al gewisseld,
 *  status nooit opgeslagen) terugdraaien — controle-ronde 27-08, bevinding 8. */
export const swapToestandInPlanning = async (swap: SwapCarryFields): Promise<'doorgevoerd' | 'niet_doorgevoerd' | 'onbekend'> => {
  const target = String(swap.targetDriverId ?? '');
  const requester = String(swap.requesterId);
  if (!swap.shiftDate || !swap.shiftLine || !target) return 'onbekend';
  const client = requireDb();
  const { data, error } = await client.from('planning').select('driverId').eq('date', swap.shiftDate).eq('line', String(swap.shiftLine));
  if (error) throw error;
  const chauffeurs = new Set((data ?? []).map((r: any) => String(r.driverId)));
  if (chauffeurs.has(requester)) return 'niet_doorgevoerd';
  if (!chauffeurs.has(target)) return 'onbekend';
  if (!swapHasReturnShift(swap)) return 'doorgevoerd';
  const { data: terug, error: terugError } = await client.from('planning').select('driverId').eq('date', String(swap.returnDate)).eq('line', String(swap.returnCode));
  if (terugError) throw terugError;
  return (terug ?? []).some((r: any) => String(r.driverId) === requester) ? 'doorgevoerd' : 'onbekend';
};
