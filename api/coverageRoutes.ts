import type express from "express";
import { authenticate, requireRole } from "./middleware.js";
import { computeDayGap, normalizeCode, resolveDayTypeMetBron, vergelijkVerwachtingenMetPraktijk, stelVerwachtingenVoor, parseOverrides, encodeOverride, WEEKDAY_PERIOD_KEY_RE, encodeWeekdagPeriodeKey, DEFAULT_DAY_TYPES, DEFAULT_WEEKDAYS, type DayTypeOverride, type DayGap, type WeekdagPeriode } from "./coverageGaps.js";
import { beoordeelKandidaat, sorteerKandidaten, dagVenster, addDagen, maandagVan, zoekKettingen, adviesSamenvatting, MIN_RUST_UREN, MAX_WERKDAGEN_NA_ELKAAR, type TijdRij, type KettingWerkende, type KettingPersoon } from "./advisor.js";
import { brusselsDay, toLookupToken, sortedNameToken, nameIdIndex, afwezigOp, vindOngeregistreerdeZiekte, normalizeSwapType } from "./helpers.js";
import {
  getCoverageExpectations,
  saveCoverageExpectations,
  getPlanningMatrixRows,
  getPlanningData,
  getServiceSegments,
  getServicesData,
  getSwapsData,
  getLeaveData,
  getUsersData,
  logActivity,
} from "./storage.js";

/**
 * Dekking & advies — verhuisd uit api/index.ts (verbeterronde 22-08, nr. 8;
 * zelfde opknip-patroon als deviceRoutes/telegram). Pure verplaatsing: de
 * routes en berekeningen zijn ongewijzigd; de bereken-functies blijven
 * geëxporteerd voor de digest, de planner-chat, de import-preview en de
 * Telegram-bot.
 */

const ISO_DAG_RE = /^\d{4}-\d{2}-\d{2}$/;

// Gereserveerde sleutels in coverage_expectations om de weekdag-toewijzing en
// de uitzonderingen op te slaan — zo is er geen aparte tabel/migratie nodig.
// Ze worden nooit als echt dag-type getoond.
const COVERAGE_WEEKDAYS_KEY = "__weekdagen__";
const COVERAGE_OVERRIDES_KEY = "__uitzonderingen__";
// Behandel élke __...__ sleutel als gereserveerd: zo vervuilen ook oudere
// interne sleutels (bv. een vroegere __vakantieperiodes__) de dag-type-lijst niet.
const isReservedCoverageKey = (k: string) => /^__.+__$/.test(k);
/** Periode-toewijzingen uit de opgeslagen config: __weekdagen_<vanaf>__ → 7 dag-types. */
const parseWeekdagPerioden = (stored: Record<string, string[]>): WeekdagPeriode[] =>
  Object.entries(stored)
    .flatMap(([k, v]) => {
      const m = WEEKDAY_PERIOD_KEY_RE.exec(k);
      return m && Array.isArray(v) && v.length === 7
        ? [{ vanaf: m[1], weekdays: v.map((s) => String(s ?? "")) }]
        : [];
    })
    .sort((a, b) => a.vanaf.localeCompare(b.vanaf));


/** Verwachtingen-vs-praktijk over een set matrix-rijen, met de opgeslagen
 *  dekking-config. Gedeeld door GET /api/coverage-expectation-check (rijen uit
 *  de database) en de import-preview (rijen uit het geüploade bestand). */
export async function berekenVerwachtingsCheck(rows: Array<{ source_date?: unknown; day_type?: unknown; assignments?: unknown }>) {
  const stored = await getCoverageExpectations();
  const weekdaysRaw = Array.isArray(stored[COVERAGE_WEEKDAYS_KEY]) ? stored[COVERAGE_WEEKDAYS_KEY] : null;
  const weekdays = weekdaysRaw && weekdaysRaw.length === 7 ? weekdaysRaw.map((s) => String(s ?? "")) : [...DEFAULT_WEEKDAYS];
  return vergelijkVerwachtingenMetPraktijk(
    rows,
    Object.fromEntries(Object.entries(stored).filter(([k]) => !isReservedCoverageKey(k))),
    weekdays,
    parseWeekdagPerioden(stored),
    parseOverrides(stored[COVERAGE_OVERRIDES_KEY]),
  );
}

/** Dekkingsgaten in [from, to] — gedeeld door GET /api/coverage-gaps en de
 *  dagelijkse digest (proactieve sectie "Openstaande diensten"). */
export async function berekenDekkingsGaten(from: string, to: string): Promise<DayGap[]> {
    const [stored, rows, usersForLeave, leaveAll, swapsAll] = await Promise.all([
      getCoverageExpectations(),
      getPlanningMatrixRows(),
      getUsersData(),
      // Alleen afwezigheid die het gevraagde bereik nog raakt.
      getLeaveData({ endOnOrAfter: from }),
      getSwapsData(),
    ]);
    // Zelfde weekdag-toewijzing + uitzonderingen als bij het instellen, zodat
    // het dag-type per dag consistent bepaald wordt.
    const weekdaysRaw = Array.isArray(stored[COVERAGE_WEEKDAYS_KEY]) ? stored[COVERAGE_WEEKDAYS_KEY] : null;
    const weekdays = weekdaysRaw && weekdaysRaw.length === 7 ? weekdaysRaw.map((s) => String(s ?? "")) : [...DEFAULT_WEEKDAYS];
    const overrides = parseOverrides(stored[COVERAGE_OVERRIDES_KEY]);
    const weekdagPerioden = parseWeekdagPerioden(stored);
    // Goedgekeurde afwezigheden: de matrix-cel van die chauffeur telt die dag
    // niet mee als invulling — zijn dienst valt dus (terecht) als gat uit de
    // dekking. Matrix-cellen zijn op náám, leave op user-id; naam-resolutie
    // via nameIdIndex (volgorde-onafhankelijk, botsingen vallen weg).
    // ALLEEN voor vandaag en later: een achteraf ingevoerd ziektebriefje mag
    // van een gereden dag geen fantoom-gat maken — die dag ís gereden (door
    // een invaller die nooit in de matrix is bijgewerkt), en de dekking is
    // een vooruitkijk-instrument, geen historiek.
    // brusselsDay, niet de kale UTC-dag: tussen 00:00 en 02:00 Brusselse
    // (zomer)tijd is de UTC-dag nog gisteren — dan gold een gereden dag als
    // "vandaag of later" en maakte een laat ziektebriefje alsnog het
    // fantoom-gat dat dit blok juist moet voorkomen.
    const vandaagIso = brusselsDay(new Date().toISOString());
    const approvedLeaveAll = (leaveAll as any[]).filter((l) => l?.status === "approved");
    const chauffeursVoorNaam = (usersForLeave as any[]).filter((u) => u?.role === "chauffeur");
    const idByNameToken = nameIdIndex(chauffeursVoorNaam);
    const userNameById = new Map<string, string>(chauffeursVoorNaam.map((u) => [String(u.id), String(u.name ?? "")]));
    const UITVAL_REDEN: Record<string, string> = { ziekte: "ziek", betaald_verlof: "verlof", klein_verlet: "klein verlet" };

    // Doorgevoerde ruilen en handmatige wissels: de matrix is een momentopname
    // van de Excel en kent ze niet, maar de dienst is wél overgenomen. Zonder
    // deze overlay bleef een dienst die net herverdeeld was als gat staan —
    // mét de naam van de zieke erbij (melding Jarno 14-08). Zelfde principe en
    // volgorde (decidedAt, zodat een ketting A→B→C bij C uitkomt) als de
    // overlay in /api/month-planning.
    const nieuweEigenaarPerDienst = new Map<string, string>();
    const sleutel = (date: string, code: string) => `${date}|${normalizeCode(code)}`;
    for (const sw of (swapsAll as any[])
      .filter((s) => s?.status === "approved" || s?.status === "completed")
      .sort((a, b) => String(a.decidedAt ?? "").localeCompare(String(b.decidedAt ?? "")))) {
      const dienstDag = String(sw.shiftDate ?? "");
      const dienstCode = String(sw.shiftLine ?? "").trim();
      const naar = String(sw.targetDriverId ?? "");
      if (dienstDag && dienstCode && naar) nieuweEigenaarPerDienst.set(sleutel(dienstDag, dienstCode), naar);
      // Bij een 1-op-1 ruil gaat de tegenprestatie de andere kant op.
      const terugDag = String(sw.returnDate ?? "");
      const terugCode = String(sw.returnCode ?? "").trim();
      if (normalizeSwapType(sw.swapType) !== "overname" && terugDag && terugCode && terugCode.toLowerCase() !== "vrij") {
        nieuweEigenaarPerDienst.set(sleutel(terugDag, terugCode), String(sw.requesterId ?? ""));
      }
    }
    const inRange = rows
      .filter((r: any) => {
        const d = String(r.source_date ?? "");
        return d >= from && d <= to;
      })
      .sort((a: any, b: any) => String(a.source_date).localeCompare(String(b.source_date)));
    const days: DayGap[] = inRange.map((r: any) => {
      const date = String(r.source_date ?? "");
      // Mét herkomst: de dekking toont per dag wáárom dit het dag-type is
      // (Excel-kolom B, uitzondering, weekdagperiode of basis-toewijzing).
      const { dayType, bron } = resolveDayTypeMetBron(r.day_type, date, weekdays, weekdagPerioden, overrides);
      const expected = stored[dayType] || [];
      // Cellen van afwezigen tellen niet mee als invulling; onthoud per
      // weggefilterde code wie uitviel en waarom — de reden reist mee naar de
      // tegel ("4407 · Pascal · ziek"). afwezigOp geeft ziekte voorrang bij
      // overlappende records en negeert kapotte datums.
      const uitvalByCode = new Map<string, { name: string; reason: string }>();
      const assignmentValues: string[] = [];
      const entries = r.assignments && typeof r.assignments === "object" && !Array.isArray(r.assignments)
        ? Object.entries(r.assignments)
        : [];
      const historisch = date < vandaagIso;
      for (const [naam, v] of entries) {
        const token = toLookupToken(String(naam));
        const matrixId = idByNameToken.get(token) ?? idByNameToken.get(sortedNameToken(String(naam)));
        // Is deze dienst intussen overgenomen? Dan bepaalt de níéuwe eigenaar
        // of hij gedekt is — niet de chauffeur die nog in de Excel staat.
        const id = nieuweEigenaarPerDienst.get(sleutel(date, String(v))) ?? matrixId;
        const afwezig = !historisch && id ? afwezigOp(approvedLeaveAll, id, date) : null;
        if (id && afwezig) {
          uitvalByCode.set(normalizeCode(String(v)), {
            name: userNameById.get(id) || String(naam),
            reason: UITVAL_REDEN[afwezig.type] ?? afwezig.type,
          });
        } else {
          assignmentValues.push(String(v));
        }
      }
      const gap = computeDayGap(date, dayType, expected, assignmentValues);
      // Alleen uitval-info voor codes die ook echt als gat eindigen — een
      // weggefilterde 'bv'-cel is geen dienst en hoort nergens te verschijnen.
      const uitval: NonNullable<DayGap["uitval"]> = {};
      for (const svc of gap.missing) {
        const info = uitvalByCode.get(normalizeCode(svc));
        if (info) uitval[normalizeCode(svc)] = info;
      }
      return Object.keys(uitval).length > 0 ? { ...gap, bron, uitval } : { ...gap, bron };
    });
    return days;
}

// Advies bij één openstaande dienst: wie is die dag vrij én bij wie past de
// dienst in het schema? Twee harde regels — minstens 8u rust t.o.v. de dienst
// van de dag ervoor (en erna: dezelfde regel bekeken vanaf morgen) en maximum
// 6 gewerkte dagen na elkaar. Server-side omdat alleen de server de
// diensttijden van álle chauffeurs kent (/api/availability geeft enkel
// dienstnummers). Niet-passende kandidaten reizen mee mét reden: de planner
// mag bewust overrulen, maar moet zien wát hij overrult.
/** Volledig advies voor één openstaande dienst — gedeeld door
 *  GET /api/coverage-advisor en de dagelijkse digest. */
/** Datavenster voor één advies-datum: ±6 dagen (6-dagenregel + rustcheck met
 *  de buurdagen), opgerekt tot de volledige week (ma–zo) én kalendermaand van
 *  de dag — de sortering telt sinds 19-08 gewerkte dagen per week en maand. */
export function adviesVenster(date: string): { vanaf: string; tot: string } {
  const maandStart = `${date.slice(0, 7)}-01`;
  // Laatste dag van de maand = de dag vóór de 1e van de volgende maand
  // (dag 28 + 7 valt gegarandeerd in de volgende maand).
  const volgendeMaandStart = `${addDagen(`${date.slice(0, 7)}-28`, 7).slice(0, 7)}-01`;
  const maandEind = addDagen(volgendeMaandStart, -1);
  const weekStart = maandagVan(date);
  const vanaf = [addDagen(date, -6), maandStart, weekStart].sort()[0];
  const tot = [addDagen(date, 6), maandEind, addDagen(weekStart, 6)].sort().slice(-1)[0];
  return { vanaf, tot };
}

type AdviesBron = { vanaf: string; tot: string; users: any[]; leave: any[]; services: any[]; swaps: any[]; shifts: any[] };

/** Eén dataload voor [vanaf, tot] — gedeeld door het losse advies en de
 *  batch (herverdeel-wizard): 17 gaten hoeven niet 17× alles op te halen. */
export async function laadAdviesBron(vanaf: string, tot: string): Promise<AdviesBron> {
  const months: string[] = [];
  for (let m = vanaf.slice(0, 7); m <= tot.slice(0, 7); ) {
    months.push(m);
    const [jr, mnd] = m.split("-").map(Number);
    m = mnd === 12 ? `${jr + 1}-01` : `${jr}-${String(mnd + 1).padStart(2, "0")}`;
  }
  const [users, leave, services, swaps, ...planningChunks] = await Promise.all([
    getUsersData(),
    getLeaveData({ endOnOrAfter: vanaf }),
    getServicesData(),
    getSwapsData(),
    ...months.map((m) => getPlanningData({ monthIso: m })),
  ]);
  const shifts = (planningChunks.flat() as any[]).filter((s) => String(s.date ?? "") >= vanaf && String(s.date ?? "") <= tot);
  return { vanaf, tot, users, leave, services, swaps, shifts };
}

export async function berekenCoverageAdvies(date: string, code: string) {
  const { vanaf, tot } = adviesVenster(date);
  return berekenCoverageAdviesUitBron(await laadAdviesBron(vanaf, tot), date, code);
}

/** Zelfde berekening als vanouds, maar op een (mogelijk ruimere) voorgeladen
 *  bron; het venster van déze datum wordt er hier uit gefilterd. */
export function berekenCoverageAdviesUitBron(bron: AdviesBron, date: string, code: string) {
    const { vanaf, tot } = adviesVenster(date);
    const { users, leave, services, swaps } = bron;
    const shifts = bron.shifts.filter((s) => String(s.date ?? "") >= vanaf && String(s.date ?? "") <= tot);

    const dienstToken = toLookupToken(code);
    const service = (services as any[]).find((s) => toLookupToken(s.serviceNumber) === dienstToken);
    const segmenten = service ? getServiceSegments(service) : [];
    const venster = dagVenster(segmenten);

    const chauffeurs = (users as any[])
      .filter((u) => u.isActive !== false && u.role === "chauffeur" && String(u.name).toLowerCase() !== "beheerder")
      .map((u) => ({ id: String(u.id), name: String(u.name), sectie: (u.section ?? null) as string | null }));

    // Per chauffeur: zijn werkdagen in het venster + de rijen per dag
    // (gesplitste diensten = meerdere rijen op dezelfde dag).
    const rijenPerDag = new Map<string, TijdRij[]>();
    const werkdagen = new Map<string, Set<string>>();
    for (const s of shifts) {
      const id = String(s.driverId);
      const dag = String(s.date ?? "");
      const key = `${id}|${dag}`;
      rijenPerDag.set(key, [...(rijenPerDag.get(key) ?? []), { startTime: String(s.startTime ?? ""), endTime: String(s.endTime ?? "") }]);
      if (!werkdagen.has(id)) werkdagen.set(id, new Set());
      werkdagen.get(id)!.add(dag);
    }
    const verlofOpDag = new Set<string>();
    for (const l of leave as any[]) {
      if (l?.status === "approved" && String(l.startDate) <= date && date <= String(l.endDate)) verlofOpDag.add(String(l.userId));
    }

    // Eerlijkheidsteller: hoe vaak nam iemand dit jaar al een dienst over —
    // zelfde telling als overnameTellingDitJaar (src/lib/vervangers.ts),
    // met het jaar van de gevraagde dag als peiljaar.
    const jaar = date.slice(0, 4);
    const keren = new Map<string, number>();
    for (const sw of swaps as any[]) {
      if (sw?.status !== "approved" && sw?.status !== "completed") continue;
      if (!sw?.targetDriverId) continue;
      if (!String(sw.decidedAt ?? sw.createdAt ?? "").startsWith(jaar)) continue;
      const id = String(sw.targetDriverId);
      keren.set(id, (keren.get(id) ?? 0) + 1);
    }

    const vrijeIds = chauffeurs.filter((c) => !werkdagen.get(c.id)?.has(date) && !verlofOpDag.has(c.id));
    const kandidaten = sorteerKandidaten(
      vrijeIds.map((c) =>
        beoordeelKandidaat({
          id: c.id,
          name: c.name,
          sectie: c.sectie,
          dienstVenster: venster,
          vorigeDag: rijenPerDag.get(`${c.id}|${addDagen(date, -1)}`) ?? [],
          volgendeDag: rijenPerDag.get(`${c.id}|${addDagen(date, 1)}`) ?? [],
          gewerkteDagen: werkdagen.get(c.id) ?? new Set(),
          datum: date,
          keren: keren.get(c.id) ?? 0,
        }),
      ),
    );

    // Ketting-voorstellen: alleen relevant (en getoond) als niemand direct
    // past — een werkende collega staat zijn dienst af aan een vrije en
    // rijdt zelf het gat. De zoeker checkt beide schakels op álle regels.
    const kettingBasis = (c: { id: string; name: string; sectie: string | null }): KettingPersoon => ({
      id: c.id,
      name: c.name,
      sectie: c.sectie,
      vorigeDag: rijenPerDag.get(`${c.id}|${addDagen(date, -1)}`) ?? [],
      volgendeDag: rijenPerDag.get(`${c.id}|${addDagen(date, 1)}`) ?? [],
      gewerkteDagen: werkdagen.get(c.id) ?? new Set(),
      keren: keren.get(c.id) ?? 0,
    });
    const werkenden: KettingWerkende[] = chauffeurs
      .filter((c) => werkdagen.get(c.id)?.has(date) && !verlofOpDag.has(c.id))
      .map((c) => {
        const rijen = rijenPerDag.get(`${c.id}|${date}`) ?? [];
        const codes = Array.from(new Set(
          shifts.filter((s) => String(s.driverId) === c.id && String(s.date) === date).map((s) => String(s.line ?? "").trim() || "•"),
        ));
        return { ...kettingBasis(c), dienstCode: codes.join("/"), rijen };
      });
    const kettingen = kandidaten.some((k) => k.past)
      ? []
      : zoekKettingen({ datum: date, dienstVenster: venster, werkenden, vrijen: vrijeIds.map(kettingBasis) });

    return {
      date,
      code,
      // Tijdsblokken van de dienst zelf — context voor de planner in de
      // advieslijst ("06:12–09:30 + 15:41–18:20"). Leeg = dienst onbekend of
      // zonder tijden; het advies valt dan terug op alleen de 6-dagenregel.
      segmenten: segmenten.map((s) => ({ startTime: s.startTime, endTime: s.endTime })),
      tijdenOnbekend: venster === null,
      minRustUren: MIN_RUST_UREN,
      maxDagenNaElkaar: MAX_WERKDAGEN_NA_ELKAAR,
      kandidaten,
      kettingen,
      // De collega-zin: zelfde feiten, maar dan zoals je ze tegen elkaar zegt.
      samenvatting: adviesSamenvatting({ code, kandidaten, kettingen }),
    };
}

export function mountCoverageRoutes(app: express.Express) {
  // === Dekking: verwachte diensten per dag-type + niet-ingevulde diensten ===
  // Config + gaten-overzicht voor planner/admin. Een "gat" = een verwachte
  // dienst (ingesteld per dag-type) die op een dag door niemand is ingevuld.
  app.get("/api/coverage-expectations", authenticate, requireRole("planner", "admin"), async (_req, res) => {
    try {
      const [stored, services] = await Promise.all([
        getCoverageExpectations(),
        getServicesData(),
      ]);
      // Reserved keys eruit halen: de weekdag-toewijzing en de uitzonderingen.
      const weekdaysRaw = Array.isArray(stored[COVERAGE_WEEKDAYS_KEY]) ? stored[COVERAGE_WEEKDAYS_KEY] : null;
      const weekdays = weekdaysRaw && weekdaysRaw.length === 7 ? weekdaysRaw.map((s) => String(s ?? "")) : [...DEFAULT_WEEKDAYS];
      const overrides = parseOverrides(stored[COVERAGE_OVERRIDES_KEY]);
      const weekdayPeriods = parseWeekdagPerioden(stored);
      // De overige sleutels zijn de zelf-gedefinieerde dag-types + hun diensten.
      const dayTypeEntries = Object.entries(stored).filter(([k]) => !isReservedCoverageKey(k));
      const dayTypes = dayTypeEntries.length > 0
        ? dayTypeEntries
            .map(([name, svcs]) => ({ name, services: Array.isArray(svcs) ? svcs : [] }))
            .sort((a, b) => a.name.localeCompare(b.name))
        : DEFAULT_DAY_TYPES.map((name) => ({ name, services: [] as string[] }));
      const serviceNumbers = Array.from(
        new Set((services as any[]).map((s) => String(s.serviceNumber ?? "").trim()).filter(Boolean)),
      ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      res.json({ services: serviceNumbers, dayTypes, weekdays, weekdayPeriods, overrides });
    } catch (err) {
      console.error("Error reading coverage expectations:", err);
      res.status(500).json({ error: "Kon dekkingsinstellingen niet laden." });
    }
  });

  app.put("/api/coverage-expectations", authenticate, requireRole("planner", "admin"), async (req, res) => {
    try {
      const rawDayTypes = Array.isArray(req.body?.dayTypes) ? req.body.dayTypes : null;
      if (!rawDayTypes) {
        return res.status(400).json({ error: "Verwacht { dayTypes: [{ name, services }], weekdays, overrides }." });
      }
      const clean: Record<string, string[]> = {};
      const validNames = new Set<string>();
      for (const dt of rawDayTypes) {
        const name = String(dt?.name ?? "").trim();
        // Lege namen en gereserveerde (__...__) sleutels overslaan; eerste wint bij dubbel.
        if (!name || isReservedCoverageKey(name) || validNames.has(name)) continue;
        validNames.add(name);
        clean[name] = Array.isArray(dt?.services) ? dt.services.map((s: unknown) => String(s).trim()).filter(Boolean) : [];
      }
      // Weekdag-toewijzing: precies 7 strings (dow 0=zo..6=za); alleen bestaande
      // dag-type-namen toelaten, anders leeg.
      const rawWeekdays = Array.isArray(req.body?.weekdays) ? req.body.weekdays : [];
      const weekdays: string[] = [];
      for (let i = 0; i < 7; i++) {
        const v = String(rawWeekdays[i] ?? "").trim();
        weekdays.push(validNames.has(v) ? v : "");
      }
      clean[COVERAGE_WEEKDAYS_KEY] = weekdays;
      // Weekdag-periodes: vanaf <datum> geldt een andere toewijzing (bv. het
      // schooljaar-regime vanaf 1 september — melding Jarno 19-08: de dekking
      // bleef anders eeuwig het zomerregime verwachten). Zelfde validatie als
      // de basis-toewijzing; dubbele ingangsdatums: eerste wint.
      const rawPeriods = Array.isArray(req.body?.weekdayPeriods) ? req.body.weekdayPeriods : [];
      const gezienVanaf = new Set<string>();
      for (const p of rawPeriods) {
        const vanaf = String(p?.vanaf ?? "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(vanaf) || gezienVanaf.has(vanaf)) continue;
        gezienVanaf.add(vanaf);
        const wd = Array.isArray(p?.weekdays) ? p.weekdays : [];
        const schoon: string[] = [];
        for (let i = 0; i < 7; i++) {
          const v = String(wd[i] ?? "").trim();
          schoon.push(validNames.has(v) ? v : "");
        }
        clean[encodeWeekdagPeriodeKey(vanaf)] = schoon;
      }
      // Uitzonderingen: geldige range + bestaand dag-type, opgeslagen als string.
      const rawOverrides = Array.isArray(req.body?.overrides) ? req.body.overrides : [];
      const overrideStrings: string[] = [];
      for (const o of rawOverrides) {
        const from = String(o?.from ?? "").trim();
        const to = String(o?.to ?? "").trim();
        const dayType = String(o?.dayType ?? "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) continue;
        if (!validNames.has(dayType)) continue;
        overrideStrings.push(encodeOverride({ from, to, dayType } as DayTypeOverride));
      }
      clean[COVERAGE_OVERRIDES_KEY] = overrideStrings;
      await saveCoverageExpectations(clean);
      await logActivity(req, "planning", "Dekkingsinstellingen bijgewerkt", "Dag-types, weekdag-toewijzing en/of uitzonderingen aangepast.", undefined);
      res.json({ success: true });
    } catch (err: any) {
      console.error("Error saving coverage expectations:", err);
      res.status(500).json({ error: err?.message || "Opslaan mislukt. Bestaat de tabel coverage_expectations al?" });
    }
  });



  app.get("/api/coverage-gaps", authenticate, requireRole("planner", "admin"), async (req, res) => {
    try {
      const from = typeof req.query.from === "string" ? req.query.from : "";
      const to = typeof req.query.to === "string" ? req.query.to : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
        return res.status(400).json({ error: "Geef een geldige periode (from/to als YYYY-MM-DD)." });
      }
      const days = await berekenDekkingsGaten(from, to);
      res.json({ from, to, days });
    } catch (err) {
      console.error("Error computing coverage gaps:", err);
      res.status(500).json({ error: "Kon dekking niet berekenen." });
    }
  });

  // Verwachtingen-vs-praktijk over de matrix in de database: welke verwachte
  // diensten worden in [from, to] op geen enkele dag van hun dag-type gereden,
  // en welke dienstcodes rijden er structureel zónder in de verwachting te
  // staan? Precies de check die de fantoomgaten na de schooljaarswissel
  // (melding Jarno 20-08) meteen had verklaard.
  app.get("/api/coverage-expectation-check", authenticate, requireRole("planner", "admin"), async (req, res) => {
    try {
      const from = typeof req.query.from === "string" ? req.query.from : "";
      const to = typeof req.query.to === "string" ? req.query.to : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
        return res.status(400).json({ error: "Geef een geldige periode (from/to als YYYY-MM-DD)." });
      }
      const rows = (await getPlanningMatrixRows()).filter((r: any) => {
        const d = String(r.source_date ?? "");
        return d >= from && d <= to;
      });
      const afwijkingen = await berekenVerwachtingsCheck(rows as any[]);
      res.json({ from, to, dagen: rows.length, afwijkingen });
    } catch (err) {
      console.error("Error computing expectation check:", err);
      res.status(500).json({ error: "Kon de verwachtingscheck niet berekenen." });
    }
  });

  // "ziek" in de geïmporteerde planning zonder geregistreerde ziekteperiode —
  // het Ziekte-blad, de digest en de advisor kennen die afwezigheid dan niet
  // (case 20-08: hele maand ziek in de Excel, nergens in het portaal). Alleen
  // vandaag en later: historiek is geen actiepunt meer.
  app.get("/api/ziekte-zonder-registratie", authenticate, requireRole("planner", "admin"), async (_req, res) => {
    try {
      const [rows, users, leave] = await Promise.all([getPlanningMatrixRows(), getUsersData(), getLeaveData()]);
      const vandaag = brusselsDay(new Date().toISOString());
      const reeksen = vindOngeregistreerdeZiekte(rows as any[], users as any[], leave as any[], vandaag);
      res.json({ vanaf: vandaag, reeksen });
    } catch (err) {
      console.error("Error computing unregistered sickness:", err);
      res.status(500).json({ error: "Kon de ziekte-controle niet berekenen." });
    }
  });

  // Welke chauffeurs komen voor in de geïmporteerde planning-matrix, en tot
  // wanneer? Voedt de badge/filter "Niet in planning" in het gebruikersbeheer:
  // een account dat nergens ingepland staat is óf een nieuwe collega, óf een
  // weggevallen Excel-kolom.
  app.get("/api/planning-presence", authenticate, requireRole("planner", "admin"), async (_req, res) => {
    try {
      const [rows, users] = await Promise.all([getPlanningMatrixRows(), getUsersData()]);
      // Alleen actieve chauffeurs: een gepauzeerd oud account met dezelfde naam
      // zou anders een naam-botsing veroorzaken waardoor de actieve chauffeur
      // ten onrechte "Niet in de planning" kreeg (controle-ronde 20-08).
      const idByName = nameIdIndex((users as any[]).filter((u) => u?.role === "chauffeur" && u?.isActive !== false));
      const laatstePerId = new Map<string, string>();
      let van: string | null = null;
      let tot: string | null = null;
      for (const r of rows as any[]) {
        const date = String(r?.source_date ?? "");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
        if (!van || date < van) van = date;
        if (!tot || date > tot) tot = date;
        const assignments = r?.assignments && typeof r.assignments === "object" && !Array.isArray(r.assignments) ? r.assignments : {};
        for (const naam of Object.keys(assignments)) {
          const id = idByName.get(toLookupToken(naam)) ?? idByName.get(sortedNameToken(naam));
          if (!id) continue;
          const cur = laatstePerId.get(id);
          if (!cur || date > cur) laatstePerId.set(id, date);
        }
      }
      res.json({ van, tot, perUser: [...laatstePerId.entries()].map(([userId, laatste]) => ({ userId, laatste })) });
    } catch (err) {
      console.error("Error computing planning presence:", err);
      res.status(500).json({ error: "Kon de planning-aanwezigheid niet berekenen." });
    }
  });


  app.get("/api/coverage-advisor", authenticate, requireRole("planner", "admin"), async (req, res) => {
    try {
      const date = typeof req.query.date === "string" ? req.query.date : "";
      const code = typeof req.query.code === "string" ? req.query.code.trim() : "";
      if (!ISO_DAG_RE.test(date) || !code) {
        return res.status(400).json({ error: "Geef een geldige datum (YYYY-MM-DD) en dienstcode mee." });
      }
      res.json(await berekenCoverageAdvies(date, code));
    } catch (err) {
      console.error("Error computing coverage advisor:", err);
      res.status(500).json({ error: "Kon het advies niet berekenen." });
    }
  });

  // Batch-advies voor de herverdeel-wizard: alle open diensten van één
  // afwezige in één call — één dataload over het verenigde venster i.p.v.
  // 17 losse advies-aanroepen die elk alles ophalen.
  app.post("/api/coverage-advisor/batch", authenticate, requireRole("planner", "admin"), async (req, res) => {
    try {
      const ruw = Array.isArray(req.body?.items) ? req.body.items : [];
      const items = ruw
        .map((i: any) => ({ date: String(i?.date ?? ""), code: String(i?.code ?? "").trim() }))
        .filter((i: { date: string; code: string }) => ISO_DAG_RE.test(i.date) && i.code);
      if (items.length === 0) {
        return res.status(400).json({ error: "Geef items mee als [{ date, code }]." });
      }
      if (items.length > 40) {
        return res.status(400).json({ error: "Maximaal 40 diensten per batch." });
      }
      const vensters = items.map((i: { date: string }) => adviesVenster(i.date));
      const vanaf = vensters.map((v: { vanaf: string }) => v.vanaf).sort()[0];
      const tot = vensters.map((v: { tot: string }) => v.tot).sort().slice(-1)[0];
      const bron = await laadAdviesBron(vanaf, tot);
      const resultaten = items.map((i: { date: string; code: string }) => {
        try {
          const advies = berekenCoverageAdviesUitBron(bron, i.date, i.code);
          const passend = (advies.kandidaten ?? []).filter((k: any) => k.past);
          return {
            date: i.date,
            code: i.code,
            samenvatting: advies.samenvatting,
            tijdenOnbekend: advies.tijdenOnbekend,
            // Top 3 passend volstaat voor de wizard; het volledige advies
            // blijft per gat op te vragen via GET /api/coverage-advisor.
            passend: passend.slice(0, 3),
            nietPassend: (advies.kandidaten ?? []).length - passend.length,
          };
        } catch {
          return { date: i.date, code: i.code, samenvatting: "Advies kon niet berekend worden.", tijdenOnbekend: false, passend: [], nietPassend: 0 };
        }
      });
      res.json({ items: resultaten });
    } catch (err) {
      console.error("Error computing coverage advisor batch:", err);
      res.status(500).json({ error: "Kon het batch-advies niet berekenen." });
    }
  });

  // Voorstel voor de verwachtingslijsten, afgeleid uit de geïmporteerde
  // planning zelf: per dag-type de cijfercodes die op minstens de helft van
  // de dagen gereden worden. Ná een dienstregelingswissel is dit één klik
  // i.p.v. 60 chips handwerk (en de bron is dezelfde als de praktijk-check,
  // dus geen ruis uit losse Excel-tabbladen).
  app.get("/api/coverage-expectations/voorstel", authenticate, requireRole("planner", "admin"), async (req, res) => {
    try {
      const from = typeof req.query.from === "string" ? req.query.from : "";
      const to = typeof req.query.to === "string" ? req.query.to : "";
      if (!ISO_DAG_RE.test(from) || !ISO_DAG_RE.test(to) || from > to) {
        return res.status(400).json({ error: "Geef een geldige periode (from/to als YYYY-MM-DD)." });
      }
      const stored = await getCoverageExpectations();
      const weekdaysRaw = Array.isArray(stored[COVERAGE_WEEKDAYS_KEY]) ? stored[COVERAGE_WEEKDAYS_KEY] : null;
      const weekdays = weekdaysRaw && weekdaysRaw.length === 7 ? weekdaysRaw.map((s) => String(s ?? "")) : [...DEFAULT_WEEKDAYS];
      const rows = (await getPlanningMatrixRows()).filter((r: any) => {
        const d = String(r.source_date ?? "");
        return d >= from && d <= to;
      });
      const voorstellen = stelVerwachtingenVoor(
        rows as any[],
        weekdays,
        parseWeekdagPerioden(stored),
        parseOverrides(stored[COVERAGE_OVERRIDES_KEY]),
      );
      res.json({ from, to, dagen: rows.length, voorstellen });
    } catch (err) {
      console.error("Error computing expectation proposal:", err);
      res.status(500).json({ error: "Kon het lijstenvoorstel niet berekenen." });
    }
  });
}
