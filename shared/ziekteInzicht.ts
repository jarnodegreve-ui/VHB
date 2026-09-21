/**
 * Rekenkern van de ziektecijfers. Stond tot 21-09 in src/lib/ziekteInzicht.ts
 * en rekende alleen per kalenderjaar; verhuisd naar shared/ omdat de
 * ziekterapporten dezelfde telling op de server maken (api/_lib/rapporten), en
 * periode-vrij gemaakt: `berekenZiektePeriode` telt over om het even welke
 * periode, `berekenZiekteInzicht` (het jaaroverzicht van het Ziekte-scherm) is
 * daar een jaar van. src/lib/ziekteInzicht.ts exporteert alles door.
 *
 * De regels, overal dezelfde:
 *  - alleen goedgekeurde ziekmeldingen tellen mee;
 *  - kalenderdagen, weekends en feestdagen inbegrepen: dit zijn geen gemiste
 *    werkdagen of loongegevens;
 *  - alleen t/m vandaag: een melding die nog loopt telt tot vandaag (of tot het
 *    einde van de periode als dat vroeger valt), een melding die nog moet
 *    beginnen telt niet;
 *  - een dag telt per chauffeur één keer, ook bij overlappende meldingen.
 *
 * Zod-vrij en zonder imports uit src/ of api/. Rekent in UTC-dagen op de
 * cijfers van de ISO-string, dus zomertijd en de tijdzone van de server doen
 * er niet toe.
 */

const DAG_MS = 86_400_000;

/** Wat de telling van een ziekmelding nodig heeft (LeaveRequest in src/types en de publieke verlofrij van de server voldoen allebei). */
export type ZiekteMeldingKern = {
  id: string;
  userId: string;
  startDate: string;
  endDate: string;
  type: string;
  status: string;
};

/** Een echt bestaande ISO-dag, uitgedrukt in UTC-dagen zodat DST niet meetelt. */
export const dagNummer = (iso: string): number | null => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const ms = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== iso) return null;
  return ms / DAG_MS;
};

const isoVan = (dag: number): string => new Date(dag * DAG_MS).toISOString().slice(0, 10);

/** De periode van een melding in dagnummers; null als ze niet meetelt (geen ziekte, niet goedgekeurd, onmogelijke datums). */
export const ziektePeriode = (melding: ZiekteMeldingKern): { van: number; tot: number } | null => {
  if (melding.type !== 'ziekte' || melding.status !== 'approved') return null;
  const van = dagNummer(melding.startDate);
  const tot = dagNummer(melding.endDate);
  return van === null || tot === null || van > tot ? null : { van, tot };
};

export interface ZiektePeriodeMaand {
  /** 'JJJJ-MM'. */
  maand: string;
  kalenderdagen: number;
  /** Afzonderlijke registraties die deze maand raken, geen nieuwe episodes. */
  meldingen: number;
  /** Chauffeurs met minstens één ziektedag in deze maand. */
  chauffeurs: number;
}

export interface ZiektePeriodeChauffeur {
  userId: string;
  kalenderdagen: number;
  meldingen: number;
  /** Langste aaneengesloten reeks ziektedagen binnen de periode (overlappende of aansluitende meldingen tellen als één reeks). */
  langstePeriode: number;
  /** Begindatum van de recentste melding die de periode raakt. */
  laatsteMelding: string;
}

export interface ZiektePeriodeMelding {
  id: string;
  userId: string;
  /** De geregistreerde datums van de melding, niet afgekapt. */
  startDate: string;
  endDate: string;
  /** Kalenderdagen van déze melding binnen de periode, t/m vandaag. */
  kalenderdagen: number;
}

export interface ZiektePeriodeInzicht {
  /** Laatste meegetelde dag; null als de periode nog volledig in de toekomst ligt (of ongeldig is). */
  totEnMet: string | null;
  /** Som van unieke geregistreerde kalenderdagen per persoon. */
  totaalKalenderdagen: number;
  /** Registraties die de periode t/m vandaag raken, geen ziekte-episodes. */
  aantalMeldingen: number;
  /** Elke maand van de periode t/m vandaag, ook zonder ziekte. */
  maanden: ZiektePeriodeMaand[];
  /** Meeste kalenderdagen eerst. */
  chauffeurs: ZiektePeriodeChauffeur[];
  /** Eén per meegetelde melding, in de volgorde van aanlevering. */
  meldingen: ZiektePeriodeMelding[];
}

const langsteReeks = (dagen: ReadonlySet<number>): number => {
  let langste = 0;
  for (const dag of dagen) {
    if (dagen.has(dag - 1)) continue; // geen begin van een reeks
    let lengte = 1;
    while (dagen.has(dag + lengte)) lengte++;
    if (lengte > langste) langste = lengte;
  }
  return langste;
};

/**
 * Geregistreerde ziekte in een periode (`van` t/m `tot`, ISO), alleen t/m
 * vandaag. Meldingen blijven afzonderlijke records: een registratie over twee
 * maanden telt in beide maanden, maar één keer in het totaal.
 */
export function berekenZiektePeriode(meldingen: readonly ZiekteMeldingKern[], van: string, tot: string, vandaag: string): ZiektePeriodeInzicht {
  const uit: ZiektePeriodeInzicht = { totEnMet: null, totaalKalenderdagen: 0, aantalMeldingen: 0, maanden: [], chauffeurs: [], meldingen: [] };
  const begin = dagNummer(van);
  const einde = dagNummer(tot);
  const peildag = dagNummer(vandaag);
  if (begin === null || einde === null || peildag === null || begin > einde || begin > peildag) return uit;
  const laatsteDag = Math.min(einde, peildag);
  uit.totEnMet = isoVan(laatsteDag);

  const maanden = new Map<string, { kalenderdagen: number; meldingen: number; chauffeurs: Set<string> }>();
  for (let dag = begin; dag <= laatsteDag;) {
    const d = new Date(dag * DAG_MS);
    maanden.set(isoVan(dag).slice(0, 7), { kalenderdagen: 0, meldingen: 0, chauffeurs: new Set() });
    dag = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / DAG_MS;
  }

  const perChauffeur = new Map<string, { dagen: Set<number>; meldingen: number; laatsteMelding: string }>();
  const geteldeIds = new Set<string>();
  for (const melding of meldingen) {
    const periode = ziektePeriode(melding);
    if (!periode || geteldeIds.has(melding.id)) continue;
    const eerste = Math.max(begin, periode.van);
    const laatste = Math.min(laatsteDag, periode.tot);
    if (eerste > laatste) continue;
    geteldeIds.add(melding.id);
    uit.aantalMeldingen++;
    uit.meldingen.push({ id: melding.id, userId: String(melding.userId), startDate: melding.startDate, endDate: melding.endDate, kalenderdagen: laatste - eerste + 1 });
    const userId = String(melding.userId);
    const chauffeur = perChauffeur.get(userId) ?? { dagen: new Set<number>(), meldingen: 0, laatsteMelding: melding.startDate };
    chauffeur.meldingen++;
    if (melding.startDate > chauffeur.laatsteMelding) chauffeur.laatsteMelding = melding.startDate;
    const geraakteMaanden = new Set<string>();
    for (let dag = eerste; dag <= laatste; dag++) {
      const sleutel = isoVan(dag).slice(0, 7);
      geraakteMaanden.add(sleutel);
      if (chauffeur.dagen.has(dag)) continue;
      chauffeur.dagen.add(dag);
      const maand = maanden.get(sleutel);
      if (maand) { maand.kalenderdagen++; maand.chauffeurs.add(userId); }
      uit.totaalKalenderdagen++;
    }
    for (const sleutel of geraakteMaanden) {
      const maand = maanden.get(sleutel);
      if (maand) maand.meldingen++;
    }
    perChauffeur.set(userId, chauffeur);
  }

  uit.maanden = [...maanden].map(([maand, m]) => ({ maand, kalenderdagen: m.kalenderdagen, meldingen: m.meldingen, chauffeurs: m.chauffeurs.size }));
  uit.chauffeurs = [...perChauffeur].map(([userId, telling]) => ({
    userId,
    kalenderdagen: telling.dagen.size,
    meldingen: telling.meldingen,
    langstePeriode: langsteReeks(telling.dagen),
    laatsteMelding: telling.laatsteMelding,
  })).sort((a, b) => b.kalenderdagen - a.kalenderdagen || a.userId.localeCompare(b.userId));
  return uit;
}

/** Eerste en laatste dag waarvoor er goedgekeurde ziekte geregistreerd staat, t/m vandaag; null = nog niets. */
export function ziekteBereik(meldingen: readonly ZiekteMeldingKern[], vandaag: string): { van: string; tot: string } | null {
  const peildag = dagNummer(vandaag);
  if (peildag === null) return null;
  let van: number | null = null;
  let tot: number | null = null;
  for (const melding of meldingen) {
    const periode = ziektePeriode(melding);
    if (!periode || periode.van > peildag) continue;
    if (van === null || periode.van < van) van = periode.van;
    const einde = Math.min(periode.tot, peildag);
    if (tot === null || einde > tot) tot = einde;
  }
  return van !== null && tot !== null ? { van: isoVan(van), tot: isoVan(tot) } : null;
}

export interface ZiekteMaandInzicht {
  /** Kalendermaand, 1 t/m 12. */
  maand: number;
  kalenderdagen: number;
  /** Afzonderlijke registraties die deze maand raken, geen nieuwe episodes. */
  meldingen: number;
}

export interface ZiekteChauffeurInzicht {
  userId: string;
  kalenderdagen: number;
  meldingen: number;
}

export interface ZiekteJaarInzicht {
  jaar: number;
  /** Laatste meegetelde dag; null als het gekozen jaar nog in de toekomst ligt. */
  totEnMet: string | null;
  /** Som van unieke geregistreerde kalenderdagen per persoon. */
  totaalKalenderdagen: number;
  /** Registraties die het gekozen jaar t/m vandaag raken, geen ziekte-episodes. */
  aantalMeldingen: number;
  maanden: ZiekteMaandInzicht[];
  chauffeurs: ZiekteChauffeurInzicht[];
}

/** Huidig jaar plus alle eerdere jaren met geregistreerde ziekte, nieuwste eerst. */
export function beschikbareZiekteJaren(meldingen: readonly ZiekteMeldingKern[], vandaag: string): number[] {
  const peildag = dagNummer(vandaag);
  if (peildag === null) return [];
  const huidigJaar = Number(vandaag.slice(0, 4));
  const jaren = new Set([huidigJaar]);
  for (const melding of meldingen) {
    const periode = ziektePeriode(melding);
    if (!periode || periode.van > peildag) continue;
    const laatsteJaar = Math.min(Number(melding.endDate.slice(0, 4)), huidigJaar);
    for (let jaar = Number(melding.startDate.slice(0, 4)); jaar <= laatsteJaar; jaar++) jaren.add(jaar);
  }
  return [...jaren].sort((a, b) => b - a);
}

/**
 * Het jaaroverzicht van het Ziekte-scherm: `berekenZiektePeriode` over één
 * kalenderjaar, met altijd twaalf maanden (een maand die nog moet beginnen
 * staat op nul; het scherm toont daar een streepje).
 */
export function berekenZiekteInzicht(meldingen: readonly ZiekteMeldingKern[], jaar: number, vandaag: string): ZiekteJaarInzicht {
  const jaarTekst = String(jaar).padStart(4, '0');
  const periode = berekenZiektePeriode(meldingen, `${jaarTekst}-01-01`, `${jaarTekst}-12-31`, vandaag);
  const perMaand = new Map(periode.maanden.map((m) => [Number(m.maand.slice(5, 7)), m]));
  return {
    jaar,
    totEnMet: periode.totEnMet,
    totaalKalenderdagen: periode.totaalKalenderdagen,
    aantalMeldingen: periode.aantalMeldingen,
    maanden: Array.from({ length: 12 }, (_, i) => {
      const m = perMaand.get(i + 1);
      return { maand: i + 1, kalenderdagen: m?.kalenderdagen ?? 0, meldingen: m?.meldingen ?? 0 };
    }),
    chauffeurs: periode.chauffeurs.map(({ userId, kalenderdagen, meldingen: aantal }) => ({ userId, kalenderdagen, meldingen: aantal })),
  };
}
