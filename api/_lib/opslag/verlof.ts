import { toDatabaseLeave, toPublicLeave } from "../../helpers.js";
import { verwijderInStukken } from "./activiteit.js";
import { paginatedFetch, requireDb } from "./basis.js";

// --- Leave ---

export const getLeaveData = async (filters?: { endOnOrAfter?: string; userId?: string }) => {
  const client = requireDb();
  // Optioneel afkappen op einddatum: lezers die alleen actuele/toekomstige
  // afwezigheid nodig hebben (maandplanning-overlay, dekking, availability)
  // hoeven de volledige, onbegrensd groeiende historiek niet mee te slepen.
  const endOnOrAfter = filters?.endOnOrAfter && /^\d{4}-\d{2}-\d{2}$/.test(filters.endOnOrAfter)
    ? filters.endOnOrAfter
    : null;
  const userId = filters?.userId ? String(filters.userId) : null;
  const rows = await paginatedFetch((from, to) => {
    let q = client.from('leave').select('*');
    if (endOnOrAfter) q = q.gte('enddate', endOnOrAfter);
    // Alleen het verlof van één gebruiker (GET /api/leave voor niet-staf):
    // filter in de query i.p.v. de hele historiek ophalen. Kolom = lowercase.
    if (userId) q = q.eq('userid', userId);
    return q.order('id', { ascending: true }).range(from, to);
  });
  return rows.map(toPublicLeave);
};

export const saveLeaveData = async (data: any, idsToDelete: string[] = [], opties: { alleenPending?: boolean } = {}) => {
  const client = requireDb();
  const normalizedData = Array.isArray(data) ? data.map(toPublicLeave) : [];
  if (normalizedData.length > 0) {
    // PostgREST eist in één upsert dezelfde sleutels per rij. `beslisreden`
    // zit alleen in rijen mét een reden (zie toDatabaseLeave); heeft één rij
    // hem, dan krijgen de andere expliciet null, anders faalt de hele batch.
    const rijen = normalizedData.map(toDatabaseLeave) as Array<Record<string, unknown>>;
    const metReden = rijen.some((r) => 'beslisreden' in r);
    const { error } = await client.from('leave').upsert(metReden ? rijen.map((r) => ({ beslisreden: null, ...r })) : rijen);
    if (error) throw error;
  }
  // Intrekkingen: de handler valideert scope + status; hier alleen uitvoeren.
  // Zonder dit was 'aanvraag intrekken' een stille no-op (upsert raakt
  // ontbrekende rijen niet) en kwam de aanvraag na refresh terug.
  // alleenPending (chauffeur-pad): de handler toetste 'pending' op een
  // snapshot; keurt een planner de aanvraag tussen die read en deze delete
  // goed, dan mag de intrekking hem niet meer raken. De voorwaarde zit
  // daarom in dezelfde databaseoperatie (security-audit 07-09, bevinding 7).
  await verwijderInStukken(client, 'leave', 'id', idsToDelete.map(String), opties.alleenPending ? (q) => q.eq('status', 'pending') : undefined);
};
