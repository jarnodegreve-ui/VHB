import { variantenAfdruk } from "../../../shared/dagtype.js";
import type { AppUser, IncomingUser, PlanningCodeRecord, ServiceRecord } from "../../types.js";
import { sanitizeIncomingUser, toLookupToken } from "../../helpers.js";

// --- Change summarizers (pure utilities used by routes) ---

export const summarizeTokens = (values: Array<string | undefined | null>, limit = 4) => {
  const normalized = values
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);

  if (normalized.length === 0) {
    return "geen details";
  }

  const unique = Array.from(new Set(normalized));
  const visible = unique.slice(0, limit).join(", ");
  return unique.length > limit ? `${visible} +${unique.length - limit}` : visible;
};

/** Tekstvelden vergelijken zoals ze bedoeld zijn: een lege telefoon uit het
 *  formulier ('') en een NULL uit de database zijn hetzelfde. Zonder deze
 *  gelijkstelling logde elke opslag van de gebruikerslijst "telefoon" voor
 *  iedereen zonder nummer (1.283× "Gebruiker gewijzigd" in 60 dagen,
 *  gezien 08-09-2026). */
const anders = (a: unknown, b: unknown): boolean => String(a ?? '').trim() !== String(b ?? '').trim();

export const summarizeUserChanges = (previousUsers: AppUser[], nextUsers: IncomingUser[]) => {
  const normalizedNextUsers = nextUsers.map(sanitizeIncomingUser);
  const previousById = new Map(previousUsers.map((user): [string, AppUser] => [String(user.id), user]));
  const nextById = new Map(normalizedNextUsers.map((user): [string, AppUser] => [String(user.id), user]));

  const added = normalizedNextUsers.filter((user) => !previousById.has(String(user.id))).map((user) => user.name);
  const removed = previousUsers.filter((user) => !nextById.has(String(user.id))).map((user) => user.name);
  const roleChanges = normalizedNextUsers
    .filter((user) => {
      const previous = previousById.get(String(user.id));
      return previous && previous.role !== user.role;
    })
    .map((user) => {
      const previous = previousById.get(String(user.id))!;
      return `${user.name} ${previous.role}->${user.role}`;
    });
  const statusChanges = normalizedNextUsers
    .filter((user) => {
      const previous = previousById.get(String(user.id));
      return previous && Boolean(previous.isActive ?? true) !== Boolean(user.isActive ?? true);
    })
    .map((user) => {
      const previous = previousById.get(String(user.id))!;
      return `${user.name} ${previous.isActive === false ? "inactief" : "actief"}->${user.isActive === false ? "inactief" : "actief"}`;
    });

  return [
    `toegevoegd: ${summarizeTokens(added)}`,
    `verwijderd: ${summarizeTokens(removed)}`,
    `rolwijzigingen: ${summarizeTokens(roleChanges)}`,
    `statuswijzigingen: ${summarizeTokens(statusChanges)}`,
  ].join(" · ");
};

export const summarizePlanningCodeChanges = (previousCodes: PlanningCodeRecord[], nextCodes: PlanningCodeRecord[]) => {
  const previousByCode = new Map(previousCodes.map((code): [string, PlanningCodeRecord] => [toLookupToken(code.code), code]));
  const nextByCode = new Map(nextCodes.map((code): [string, PlanningCodeRecord] => [toLookupToken(code.code), code]));

  const added = nextCodes.filter((code) => !previousByCode.has(toLookupToken(code.code))).map((code) => code.code);
  const removed = previousCodes.filter((code) => !nextByCode.has(toLookupToken(code.code))).map((code) => code.code);
  const changed = nextCodes
    .filter((code) => {
      const previous = previousByCode.get(toLookupToken(code.code));
      return previous && (
        previous.category !== code.category ||
        previous.description !== code.description ||
        previous.countsAsShift !== code.countsAsShift ||
        previous.isPaidAbsence !== code.isPaidAbsence ||
        previous.isDayOff !== code.isDayOff
      );
    })
    .map((code) => code.code);

  return [
    `toegevoegd: ${summarizeTokens(added)}`,
    `verwijderd: ${summarizeTokens(removed)}`,
    `gewijzigd: ${summarizeTokens(changed)}`,
  ].join(" · ");
};

/**
 * Structureel diff van service-changes — geeft per categorie de records terug
 * (i.p.v. alleen een summary-string). Gebruikt door de API om per-service
 * activity-log entries te schrijven met entity_id, zodat we per-service
 * wijzigingsgeschiedenis kunnen tonen.
 */
export const diffServiceChanges = (
  previousServices: ServiceRecord[],
  nextServices: ServiceRecord[],
): { added: ServiceRecord[]; removed: ServiceRecord[]; changed: ServiceRecord[] } => {
  const previousById = new Map(previousServices.map((service): [string, ServiceRecord] => [String(service.id), service]));
  const nextById = new Map(nextServices.map((service): [string, ServiceRecord] => [String(service.id), service]));

  const added = nextServices.filter((service) => !previousById.has(String(service.id)));
  const removed = previousServices.filter((service) => !nextById.has(String(service.id)));
  const changed = nextServices.filter((service) => {
    const previous = previousById.get(String(service.id));
    return previous && (
      previous.serviceNumber !== service.serviceNumber ||
      previous.startTime !== service.startTime ||
      previous.endTime !== service.endTime ||
      previous.startTime2 !== service.startTime2 ||
      previous.endTime2 !== service.endTime2 ||
      previous.startTime3 !== service.startTime3 ||
      previous.endTime3 !== service.endTime3 ||
      previous.loopnr !== service.loopnr ||
      previous.loopnr2 !== service.loopnr2 ||
      previous.loopnr3 !== service.loopnr3 ||
      variantenAfdruk(previous.varianten) !== variantenAfdruk(service.varianten)
    );
  });

  return { added, removed, changed };
};

export const summarizeServiceChanges = (previousServices: ServiceRecord[], nextServices: ServiceRecord[]) => {
  // Dezelfde diff als de per-dienst-logregels (loopnummers en afwijkingen per
  // dagtype tellen dus ook hier mee).
  const diff = diffServiceChanges(previousServices, nextServices);
  const added = diff.added.map((service) => service.serviceNumber);
  const removed = diff.removed.map((service) => service.serviceNumber);
  const changed = diff.changed.map((service) => service.serviceNumber);

  return [
    `toegevoegd: ${summarizeTokens(added)}`,
    `verwijderd: ${summarizeTokens(removed)}`,
    `gewijzigd: ${summarizeTokens(changed)}`,
  ].join(" · ");
};

/** Structurele diff per omleiding voor per-entity audit-logging. */
export const diffDiversionChanges = (previousDiversions: any[], nextDiversions: any[]) => {
  const previousById = new Map(previousDiversions.map((item): [string, any] => [String(item.id), item]));
  const nextById = new Map(nextDiversions.map((item): [string, any] => [String(item.id), item]));
  const added = nextDiversions.filter((item) => !previousById.has(String(item.id)));
  const removed = previousDiversions.filter((item) => !nextById.has(String(item.id)));
  const changed = nextDiversions.filter((item) => {
    const previous = previousById.get(String(item.id));
    return previous && (
      previous.title !== item.title ||
      previous.description !== item.description ||
      previous.startDate !== item.startDate ||
      previous.endDate !== item.endDate ||
      previous.line !== item.line ||
      previous.location !== item.location ||
      bijlagenSleutel(previous) !== bijlagenSleutel(item)
    );
  });
  return { added, removed, changed };
};
/** Bijlagen vergelijken op slot en naam; de ondertekende URL wisselt per request. */
const bijlagenSleutel = (d: any) => (Array.isArray(d?.bijlagen) ? d.bijlagen.map((b: any) => `${b.slot}:${b.filename}`).join("|") : "");

/** Structurele diff per update voor per-entity audit-logging. */
export const diffUpdateChanges = (previousUpdates: any[], nextUpdates: any[]) => {
  const previousById = new Map(previousUpdates.map((item): [string, any] => [String(item.id), item]));
  const nextById = new Map(nextUpdates.map((item): [string, any] => [String(item.id), item]));
  const added = nextUpdates.filter((item) => !previousById.has(String(item.id)));
  const removed = previousUpdates.filter((item) => !nextById.has(String(item.id)));
  const changed = nextUpdates.filter((item) => {
    const previous = previousById.get(String(item.id));
    return previous && (
      previous.title !== item.title ||
      previous.content !== item.content ||
      previous.category !== item.category ||
      Boolean(previous.isUrgent) !== Boolean(item.isUrgent)
    );
  });
  return { added, removed, changed };
};

/** Structurele diff per gebruiker voor per-entity audit-logging. */
export const diffUserChanges = (previousUsers: AppUser[], nextUsers: IncomingUser[]) => {
  const normalizedNextUsers = nextUsers.map(sanitizeIncomingUser);
  const previousById = new Map(previousUsers.map((user): [string, AppUser] => [String(user.id), user]));
  const nextById = new Map(normalizedNextUsers.map((user): [string, AppUser] => [String(user.id), user]));

  const added = normalizedNextUsers.filter((user) => !previousById.has(String(user.id)));
  const removed = previousUsers.filter((user) => !nextById.has(String(user.id)));
  const changed = normalizedNextUsers
    .filter((user) => {
      const previous = previousById.get(String(user.id));
      if (!previous) return false;
      return (
        anders(previous.name, user.name) ||
        previous.role !== user.role ||
        anders(previous.employeeId, user.employeeId) ||
        anders(previous.phone, user.phone) ||
        anders(previous.email, user.email) ||
        previous.verlofBudget !== user.verlofBudget ||
        JSON.stringify(previous.verlofBudgetten ?? null) !== JSON.stringify(user.verlofBudgetten ?? null) ||
        Boolean(previous.isActive ?? true) !== Boolean(user.isActive ?? true) ||
        Boolean(previous.ookTechnieker) !== Boolean(user.ookTechnieker)
      );
    })
    .map((user) => {
      const previous = previousById.get(String(user.id))!;
      const fields: string[] = [];
      if (anders(previous.name, user.name)) fields.push(`naam: ${previous.name}→${user.name}`);
      if (previous.role !== user.role) fields.push(`rol: ${previous.role}→${user.role}`);
      if (anders(previous.employeeId, user.employeeId)) fields.push(`employeeId: ${previous.employeeId}→${user.employeeId}`);
      if (anders(previous.phone, user.phone)) fields.push(`telefoon`);
      if (anders(previous.email, user.email)) fields.push(`email`);
      if (previous.verlofBudget !== user.verlofBudget) fields.push(`verlofBudget: ${previous.verlofBudget ?? 'standaard'}→${user.verlofBudget ?? 'standaard'}`);
      if (JSON.stringify(previous.verlofBudgetten ?? null) !== JSON.stringify(user.verlofBudgetten ?? null)) {
        const tekst = (b?: Record<string, number>) => (b && Object.keys(b).length > 0 ? Object.entries(b).sort().map(([jaar, dagen]) => `${jaar}: ${dagen}`).join(', ') : 'geen');
        fields.push(`verlofbudget per jaar: ${tekst(previous.verlofBudgetten)}→${tekst(user.verlofBudgetten)}`);
      }
      if (Boolean(previous.isActive ?? true) !== Boolean(user.isActive ?? true)) {
        fields.push(`status: ${previous.isActive === false ? 'inactief' : 'actief'}→${user.isActive === false ? 'inactief' : 'actief'}`);
      }
      if (Boolean(previous.ookTechnieker) !== Boolean(user.ookTechnieker)) {
        fields.push(`ook technieker: ${previous.ookTechnieker ? 'aan' : 'uit'}→${user.ookTechnieker ? 'aan' : 'uit'}`);
      }
      return { user, fields };
    });

  return { added, removed, changed };
};

/** Structurele diff per planning-code voor per-entity audit-logging. */
export const diffPlanningCodeChanges = (
  previousCodes: PlanningCodeRecord[],
  nextCodes: PlanningCodeRecord[],
) => {
  const previousByCode = new Map(previousCodes.map((c): [string, PlanningCodeRecord] => [toLookupToken(c.code), c]));
  const nextByCode = new Map(nextCodes.map((c): [string, PlanningCodeRecord] => [toLookupToken(c.code), c]));
  const added = nextCodes.filter((c) => !previousByCode.has(toLookupToken(c.code)));
  const removed = previousCodes.filter((c) => !nextByCode.has(toLookupToken(c.code)));
  const changed = nextCodes.filter((c) => {
    const previous = previousByCode.get(toLookupToken(c.code));
    return previous && (
      previous.category !== c.category ||
      previous.description !== c.description ||
      previous.countsAsShift !== c.countsAsShift ||
      previous.isPaidAbsence !== c.isPaidAbsence ||
      previous.isDayOff !== c.isDayOff
    );
  });
  return { added, removed, changed };
};

export const summarizeDiversionChanges = (previousDiversions: any[], nextDiversions: any[]) => {
  const previousById = new Map(previousDiversions.map((item): [string, any] => [String(item.id), item]));
  const nextById = new Map(nextDiversions.map((item): [string, any] => [String(item.id), item]));
  const added = nextDiversions.filter((item) => !previousById.has(String(item.id))).map((item) => item.title);
  const removed = previousDiversions.filter((item) => !nextById.has(String(item.id))).map((item) => item.title);
  const changed = nextDiversions
    .filter((item) => {
      const previous = previousById.get(String(item.id));
      return previous && (
        previous.title !== item.title ||
        previous.description !== item.description ||
        previous.startDate !== item.startDate ||
        previous.endDate !== item.endDate
      );
    })
    .map((item) => item.title);

  return [
    `toegevoegd: ${summarizeTokens(added)}`,
    `verwijderd: ${summarizeTokens(removed)}`,
    `gewijzigd: ${summarizeTokens(changed)}`,
  ].join(" · ");
};

export const summarizeUpdateChanges = (previousUpdates: any[], nextUpdates: any[]) => {
  const previousById = new Map(previousUpdates.map((item): [string, any] => [String(item.id), item]));
  const nextById = new Map(nextUpdates.map((item): [string, any] => [String(item.id), item]));
  const added = nextUpdates.filter((item) => !previousById.has(String(item.id))).map((item) => item.title);
  const removed = previousUpdates.filter((item) => !nextById.has(String(item.id))).map((item) => item.title);
  const changed = nextUpdates
    .filter((item) => {
      const previous = previousById.get(String(item.id));
      return previous && (
        previous.title !== item.title ||
        previous.content !== item.content ||
        previous.category !== item.category ||
        Boolean(previous.isUrgent) !== Boolean(item.isUrgent)
      );
    })
    .map((item) => item.title);

  return [
    `toegevoegd: ${summarizeTokens(added)}`,
    `verwijderd: ${summarizeTokens(removed)}`,
    `gewijzigd: ${summarizeTokens(changed)}`,
  ].join(" · ");
};
