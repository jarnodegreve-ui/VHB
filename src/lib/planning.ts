import type { Service, PlanningCode } from '../types';

export type ResolvedPlanningAssignment = {
  driver: string;
  code: string;
  kind: 'service' | 'leave' | 'absence' | 'training' | 'unknown';
  label: string;
  details: string;
  segments: string[];
};

// Zelfde normalisatie als de server (api/helpers.ts toLookupToken): accenten
// én interpunctie weg. Zo matcht het Planning-overzicht exact dezelfde namen/
// codes als de matrix-import — de oude trim().toLowerCase() gaf vals-positieve
// "niet-gematchte chauffeur" bij accent-/koppelteken-verschillen.
export const normalizePlanningToken = (value: unknown) =>
  String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Volgorde-onafhankelijke naam-sleutel ("Jan Janssen" == "Janssen Jan") —
 *  zoals sortedNameToken op de server, zodat een omgekeerde naamvolgorde in de
 *  matrix niet als onbekende chauffeur telt. */
export const sortedNameToken = (name: string) =>
  normalizePlanningToken(name).split(/\s+/).filter(Boolean).sort().join(' ');

/** Levenshtein-afstand (voor de fuzzy naam-suggestie hieronder). */
const levenshtein = (a: string, b: string): number => {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 0; i < a.length; i++) {
    const cur = [i + 1];
    for (let j = 0; j < b.length; j++) {
      cur[j + 1] = Math.min(
        prev[j + 1] + 1,
        cur[j] + 1,
        prev[j] + (a[i] === b[j] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
};

/**
 * Beste fuzzy-match voor een niet-herkende naam onder bekende namen — helpt de
 * planner "Duysbergh Pascal" (typo) te herkennen als "Duysburgh Pascal". Werkt
 * op de sortedNameToken (accent-/interpunctie-/volgorde-ongevoelig). Geeft null
 * als niets voldoende lijkt (drempel 0.62 similariteit).
 */
export const suggestClosestName = (
  name: string,
  candidates: { id: string; name: string }[],
): { id: string; name: string } | null => {
  const target = sortedNameToken(name);
  if (!target) return null;
  let best: { id: string; name: string } | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    const cand = sortedNameToken(c.name);
    if (!cand) continue;
    const dist = levenshtein(target, cand);
    const score = 1 - dist / Math.max(target.length, cand.length);
    if (score > bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return bestScore >= 0.62 ? best : null;
};

/**
 * Accounts waarvan de naam op dezelfde sleutel uitkomt als `naam` (accent-,
 * interpunctie- en volgorde-ongevoelig — exact de matching waarmee de server
 * matrixcellen aan accounts koppelt). Bij zo'n botsing weigert de server te
 * kiezen en valt de chauffeur uit planning, dekking en dagweergave (case
 * Ivan Van Hoorde, 23-08). Gepauzeerde accounts tellen mee: de server filtert
 * daar ook niet op. `negeerId` = het account dat zelf bewerkt wordt.
 */
export const vindNaamBotsingen = <T extends { id: string; name: string }>(
  naam: string,
  users: T[],
  negeerId?: string,
): T[] => {
  const token = sortedNameToken(naam);
  if (!token) return [];
  return users.filter((u) => u.id !== negeerId && sortedNameToken(u.name) === token);
};

// Let op: client-variant die 'HH:MM - HH:MM'-labels teruggeeft. De server heeft
// een gelijknamige-maar-andere getServiceSegments (api/storage.ts) die HH:MM
// valideert en {startTime,endTime,segment}-objecten geeft — bewust los, dus
// hier een eigen naam om de divergente duplicaat niet te verwarren.
const getServiceSegmentLabels = (service: Service) => (
  [
    service.startTime && service.endTime ? `${service.startTime} - ${service.endTime}` : '',
    service.startTime2 && service.endTime2 ? `${service.startTime2} - ${service.endTime2}` : '',
    service.startTime3 && service.endTime3 ? `${service.startTime3} - ${service.endTime3}` : '',
  ].filter(Boolean)
);

export const resolvePlanningAssignment = (
  driver: string,
  rawCode: string,
  services: Service[],
  planningCodes: PlanningCode[],
): ResolvedPlanningAssignment => {
  const normalizedCode = normalizePlanningToken(rawCode);
  const matchedService = services.find((service) => normalizePlanningToken(service.serviceNumber) === normalizedCode);
  if (matchedService) {
    const segments = getServiceSegmentLabels(matchedService);
    return {
      driver,
      code: rawCode,
      kind: 'service',
      label: `Dienst ${matchedService.serviceNumber}`,
      details: segments.length > 0 ? segments.join(' | ') : 'Dienst herkend, maar zonder uren.',
      segments,
    };
  }

  const matchedCode = planningCodes.find((planningCode) => normalizePlanningToken(planningCode.code) === normalizedCode);
  if (matchedCode) {
    return {
      driver,
      code: rawCode,
      kind: matchedCode.category,
      label: matchedCode.description || matchedCode.code.toUpperCase(),
      details:
        matchedCode.category === 'leave'
          ? 'Gekoppeld als verlofcode.'
          : matchedCode.category === 'training'
            ? 'Gekoppeld als opleidingscode.'
            : matchedCode.category === 'absence'
              ? 'Gekoppeld als afwezigheid.'
              : matchedCode.category === 'service'
                ? 'Gemarkeerd als dienstcode zonder uren in Dienstoverzicht.'
                : 'Code bestaat in Planningscodes, maar is nog niet verder verfijnd.',
      segments: [],
    };
  }

  return {
    driver,
    code: rawCode,
    kind: 'unknown',
    label: 'Onbekende code',
    details: 'Geen match gevonden in Dienstoverzicht of Planningscodes.',
    segments: [],
  };
};
