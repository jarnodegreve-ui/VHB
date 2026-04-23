import type { Service, PlanningCode } from '../types';

export type ResolvedPlanningAssignment = {
  driver: string;
  code: string;
  kind: 'service' | 'leave' | 'absence' | 'training' | 'unknown';
  label: string;
  details: string;
  segments: string[];
};

export const normalizePlanningToken = (value: unknown) => String(value ?? '').trim().toLowerCase();

export const getServiceSegments = (service: Service) => (
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
    const segments = getServiceSegments(matchedService);
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
