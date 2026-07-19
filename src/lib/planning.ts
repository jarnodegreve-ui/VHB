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

// Let op: client-variant die 'HH:MM - HH:MM'-labels teruggeeft. De server heeft
// een gelijknamige-maar-andere getServiceSegments (api/storage.ts) die HH:MM
// valideert en {startTime,endTime,segment}-objecten geeft — bewust los, dus
// hier een eigen naam om de divergente duplicaat niet te verwarren.
export const getServiceSegmentLabels = (service: Service) => (
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
