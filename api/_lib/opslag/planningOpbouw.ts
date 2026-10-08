import type { AppUser, PlanningCodeRecord, PlanningMatrixRow, ServiceRecord, ShiftRecord } from "../../types.js";
import { sortedNameToken, toLookupToken } from "../../helpers.js";
import { versieVoorDatum } from "../../../shared/dienstregeling.js";
import { getServicesPerVersie } from "./diensten.js";
import { getUsersData } from "./gebruikers.js";
import { getPlanningCodesData, getPlanningMatrixRows } from "./planning.js";

// --- Service segment helpers + planning build from matrix ---

// Zelfde regels als de gedeelde client-validator (shiftTime.isValidBusvakTime):
// uur 0–47 (busvak), minuten 0–59. De oude regex accepteerde "08:75"/"99:00",
// die vervolgens per component anders geïnterpreteerd werden.
export const isValidHHMM = (v?: string) => {
  if (!v) return false;
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return false;
  return Number(m[1]) <= 47 && Number(m[2]) <= 59;
};
const validSegment = (start: string | undefined, end: string | undefined, segment: number) =>
  isValidHHMM(start) && isValidHHMM(end)
    ? { startTime: start as string, endTime: end as string, segment }
    : null;

export const getServiceSegments = (service: ServiceRecord) => (
  [
    { seg: validSegment(service.startTime, service.endTime, 1), loopnr: service.loopnr },
    { seg: validSegment(service.startTime2, service.endTime2, 2), loopnr: service.loopnr2 },
    { seg: validSegment(service.startTime3, service.endTime3, 3), loopnr: service.loopnr3 },
  ]
    .filter((x) => x.seg !== null)
    // Loopnummer hoort bij het blok: een loop is het deel van de dienst waar
    // bepaalde ritten onder vallen, dus het reist mee naar de planning-rij.
    .map((x) => ({ ...(x.seg as { startTime: string; endTime: string; segment: number }), loopnr: String(x.loopnr ?? '').trim() }))
);

export const buildPlanningFromMatrix = async (inputRows?: PlanningMatrixRow[]) => {
  const [users, perVersie, planningCodes] = await Promise.all([
    getUsersData(),
    getServicesPerVersie(),
    getPlanningCodesData(),
  ]);
  const rows = inputRows ?? await getPlanningMatrixRows();
  return bouwPlanningUitMatrix({ rows, users, services: perVersie.services, versies: perVersie.versies, planningCodes });
};

/** Eén dienstregelingversie met haar diensten, voor de opbouw per datum. */
export type OpbouwVersie = { id: string; geldigVanaf: string; services: ServiceRecord[] };

/**
 * Pure kern van de planning-opbouw (matrix × dienstoverzicht × codes →
 * planning-rijen + samenvatting). Losgetrokken van de data-fetches zodat het
 * integratieharnas de échte opbouw draait op zijn in-memory store — de
 * keten-bugs (wegvallende chauffeurs, segmenten, absences) zaten hier, niet
 * in de fetches.
 */
export const bouwPlanningUitMatrix = ({ rows, users, services, planningCodes, versies }: {
  rows: PlanningMatrixRow[];
  users: AppUser[];
  /** Het dienstoverzicht zonder versies, of de terugval wanneer `versies` leeg is. */
  services: ServiceRecord[];
  planningCodes: PlanningCodeRecord[];
  /** Dienstregelingversies (08-10): per matrixdag telt de versie die op die
   *  dag geldt (versieVoorDatum), zodat een nieuwe dienstregeling alleen de
   *  dagen vanaf haar datum raakt en het verleden zijn toenmalige tijden houdt. */
  versies?: OpbouwVersie[];
}) => {
  // Botsings-detectie: twee verschillende gebruikers die op dezelfde
  // naam-sleutel uitkomen (zelfde naam, of "Jan Karel" vs "Karel Jan" via de
  // gesorteerde token). Voorheen was dit laatste-wint → alle diensten van
  // beide kolommen belandden stil bij één van de twee. Ambigue sleutels
  // matchen nu bewust NIET meer en verschijnen als unmatched in de preview.
  const usersByName = new Map<string, AppUser>();
  const ambiguousNameKeys = new Set<string>();
  const addNameKey = (key: string, u: AppUser) => {
    if (!key) return;
    const existing = usersByName.get(key);
    if (existing && String(existing.id) !== String(u.id)) {
      ambiguousNameKeys.add(key);
      usersByName.delete(key);
      return;
    }
    if (!ambiguousNameKeys.has(key)) usersByName.set(key, u);
  };
  for (const u of users) {
    addNameKey(toLookupToken(u.name), u);
    addNameKey(sortedNameToken(u.name), u);
  }
  const indexVan = (lijst: ServiceRecord[]) => new Map(
    lijst.map((service): [string, ServiceRecord] => [toLookupToken(service.serviceNumber), service]),
  );
  const standaardIndex = indexVan(services as ServiceRecord[]);
  const indexPerVersie = new Map((versies ?? []).map((v) => [v.id, indexVan(v.services)] as const));
  const servicesOpDag = (datum: string): Map<string, ServiceRecord> => {
    if (!versies || versies.length === 0) return standaardIndex;
    const versie = versieVoorDatum(versies, datum);
    return (versie && indexPerVersie.get(versie.id)) ?? standaardIndex;
  };
  const planningCodesByCode = new Map(planningCodes.map((code): [string, PlanningCodeRecord] => [toLookupToken(code.code), code]));

  const generatedShifts: ShiftRecord[] = [];
  const unknownCodes = new Set<string>();
  const unmatchedDrivers = new Set<string>();
  // Services die WEL matchen op nummer maar GEEN valid HH:MM-segmenten
  // bevatten (bijv. omdat alle startTime/endTime velden leeg zijn) —
  // voorheen telden die als "matched" maar produceerden 0 planning-rijen.
  // Dit is precies de silent gap waar het Yves-incident door ontstond.
  const servicesWithoutSegments = new Set<string>();
  // Per-chauffeur counters voor de preview-breakdown.
  const perDriver = new Map<
    string,
    {
      driverName: string;
      driverId: string;
      daysWithCode: number;
      shiftsGenerated: number;
      servicesMatched: number;
      absences: number;
      servicesWithoutSegments: number;
    }
  >();
  const bumpDriver = (driver: AppUser, name: string) => {
    let entry = perDriver.get(driver.id);
    if (!entry) {
      entry = {
        driverName: driver.name || name,
        driverId: driver.id,
        daysWithCode: 0,
        shiftsGenerated: 0,
        servicesMatched: 0,
        absences: 0,
        servicesWithoutSegments: 0,
      };
      perDriver.set(driver.id, entry);
    }
    return entry;
  };
  let matchedServices = 0;
  let skippedAbsences = 0;

  for (const row of rows) {
    const servicesByNumber = servicesOpDag(String(row.source_date ?? ""));
    for (const [driverName, rawCode] of Object.entries(row.assignments || {}) as Array<[string, string]>) {
      const nameKey = toLookupToken(driverName);
      const sortedKey = sortedNameToken(driverName);
      if (ambiguousNameKeys.has(nameKey) || ambiguousNameKeys.has(sortedKey)) {
        unmatchedDrivers.add(`${driverName} (ambigu: meerdere gebruikers met deze naam, maak de namen uniek in gebruikersbeheer)`);
        continue;
      }
      const driver = usersByName.get(nameKey) || usersByName.get(sortedKey);
      if (!driver) {
        unmatchedDrivers.add(driverName);
        continue;
      }

      const driverStats = bumpDriver(driver, driverName);
      driverStats.daysWithCode += 1;

      const normalizedCode = toLookupToken(rawCode);
      const matchedService = servicesByNumber.get(normalizedCode);
      if (matchedService) {
        const segments = getServiceSegments(matchedService);
        if (segments.length === 0) {
          // Service-nummer matcht maar bevat geen HH:MM-segmenten. Niet
          // stil voorbij laten gaan: vlag voor de preview-waarschuwing.
          servicesWithoutSegments.add(matchedService.serviceNumber);
          driverStats.servicesWithoutSegments += 1;
        }
        for (const segment of segments) {
          // LET OP: driver.id hierin is de chauffeur uit de MATRIX, en die
          // blijft in de id staan ook nadat een goedgekeurde ruil de rij naar
          // een collega verhuisde (movePlanningRows wijzigt alleen de kolom
          // driverId). De id is dus geen betrouwbare eigenaar-bron — lees
          // altijd de kolom.
          //
          // Bewust niet herschreven bij een doorvoer: swaps.shiftId verwijst
          // naar deze id, dus hernoemen zou bestaande ruilen laten dangelen.
          // De exclusiviteitscheck bij goedkeuren keek hier vroeger wél naar
          // en blokkeerde daardoor elke dóórgeef-ketting; die kijkt sinds
          // 01-08-2026 naar de huidige eigenaar (staleApprovalError).
          generatedShifts.push({
            id: `${row.source_date}-${driver.id}-${matchedService.serviceNumber}-${segment.segment}`,
            date: row.source_date,
            startTime: segment.startTime,
            endTime: segment.endTime,
            line: matchedService.serviceNumber,
            busNumber: "",
            loopnr: segment.loopnr,
            driverId: driver.id,
          });
          driverStats.shiftsGenerated += 1;
        }
        matchedServices += 1;
        driverStats.servicesMatched += 1;
        continue;
      }

      const matchedCode = planningCodesByCode.get(normalizedCode);
      if (matchedCode) {
        if (!matchedCode.isDayOff && !matchedCode.countsAsShift) {
          skippedAbsences += 1;
        }
        driverStats.absences += 1;
        continue;
      }

      unknownCodes.add(rawCode);
    }
  }

  generatedShifts.sort((a, b) => {
    const left = `${a.date} ${a.startTime} ${a.driverId}`;
    const right = `${b.date} ${b.startTime} ${b.driverId}`;
    return left.localeCompare(right);
  });

  return {
    shifts: generatedShifts,
    summary: {
      importedDays: rows.length,
      generatedShifts: generatedShifts.length,
      matchedServices,
      skippedAbsences,
      unknownCodes: Array.from(unknownCodes).sort(),
      unmatchedDrivers: Array.from(unmatchedDrivers).sort(),
      servicesWithoutSegments: Array.from(servicesWithoutSegments).sort(),
      perDriver: Array.from(perDriver.values()).sort((a, b) => a.driverName.localeCompare(b.driverName)),
    },
  };
};
