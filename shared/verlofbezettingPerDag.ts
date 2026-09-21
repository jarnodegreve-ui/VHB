import { teltInVerlofbezetting } from './verlofbezetting.js';

/**
 * De verlofbezetting per dag: wie is er met goedgekeurd verlof afwezig, en
 * hoeveel daarvan tellen in de verloflimiet. Stond tot 21-09 in de route
 * GET /api/leave/bezetting zelf; hierheen verhuisd omdat het rapport
 * "Verlofbezetting per dag" exact dezelfde telling nodig heeft.
 *
 * Zelfde regels als `bezettingOp`/`anderenAfwezigOp` aan de clientkant:
 * goedgekeurd, geen ziekte, elke kalenderdag van de aanvraag (ook een zondag
 * of feestdag binnen de periode), en de aanvrager telt in de verlofbezetting
 * (rijdend personeel zonder flexi's; een onbekende aanvrager telt mee).
 *
 * Zod-vrij: de limiet komt als functie binnen (`limietVoorDag` uit
 * shared/schemas/verlofLimieten.ts trekt zod mee, en dit bestand niet).
 * Rekent op de cijfers van de ISO-string, in UTC.
 */

type BezettingAanvraag = { userId: string | number; startDate: string; endDate: string; type: string; status: string };
type BezettingGebruiker = { id: string | number; role: string; section?: string | null };

export type BezettingDag = {
  datum: string;
  /** Aantal dat in de verloflimiet telt. */
  aantal: number;
  limiet: number;
  /** Wie in de limiet telt (userId's, in de volgorde van de aanvragen). */
  tellend: string[];
  /** Wie afwezig is zonder in de limiet te tellen (flexi, technieker). */
  nietTellend: string[];
};

const DAG_MS = 86_400_000;
const dagMs = (iso: string): number => Date.parse(`${iso}T00:00:00Z`);

export function bezettingPerDag(bron: {
  leave: readonly BezettingAanvraag[];
  users: readonly BezettingGebruiker[];
  van: string;
  tot: string;
  limietVoor: (dagIso: string) => number;
}): BezettingDag[] {
  const perId = new Map(bron.users.map((u) => [String(u.id), u]));
  const verlof = bron.leave
    .filter((l) => l.status === 'approved' && l.type !== 'ziekte')
    .map((l) => {
      const u = perId.get(String(l.userId));
      return { userId: String(l.userId), van: l.startDate, tot: l.endDate, telt: !u || teltInVerlofbezetting(u) };
    });
  const dagen: BezettingDag[] = [];
  const einde = dagMs(bron.tot);
  for (let ms = dagMs(bron.van); ms <= einde; ms += DAG_MS) {
    const datum = new Date(ms).toISOString().slice(0, 10);
    const afwezig = verlof.filter((l) => l.van <= datum && l.tot >= datum);
    // Telt per aanvraag, zoals de kalender: twee overlappende aanvragen van
    // dezelfde persoon zijn twee rijen (de server weigert die overlap al).
    const tellend = afwezig.filter((l) => l.telt).map((l) => l.userId);
    dagen.push({
      datum,
      aantal: tellend.length,
      limiet: bron.limietVoor(datum),
      tellend,
      nietTellend: [...new Set(afwezig.filter((l) => !l.telt).map((l) => l.userId))],
    });
  }
  return dagen;
}
