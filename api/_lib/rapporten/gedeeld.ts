import { onbekendLabel } from "../../../shared/rapporten/filters.js";

/**
 * Wat de ziekte- en verlofrapporten delen: de verlofrij zoals de server ze
 * leest, een persoon bij zijn id, maandnamen en de kalenderdag van een
 * tijdstip. Puur, geen database.
 */

/** Een rij uit `leave` zoals `getLeaveData` ze geeft (camelCase). */
export type VerlofRij = {
  id: string;
  userId: string;
  startDate: string;
  endDate: string;
  type: string;
  status: string;
  comment?: string | null;
  createdAt?: string | null;
  decidedAt?: string | null;
};

// `isActive` mag null zijn: zo komt de kolom uit de database (RapportMedewerker),
// en alleen `false` betekent "uit dienst".
export type RapportGebruiker = { id: string | number; name: string; role: string; isActive?: boolean | null; section?: string | null; employeeId?: string | null };

export type Persoon = { naam: string; personeelsnr: string | null; gebruiker: RapportGebruiker | null };

/**
 * Persoon bij een id, zoals Verlofsaldo het doet: wie uit dienst is blijft
 * staan met "(uit dienst)", een verwijderd account wordt "Onbekend (<id>)".
 */
export const persoonZoeker = (users: readonly RapportGebruiker[]) => {
  const perId = new Map(users.map((u) => [String(u.id), u]));
  return (id: string): Persoon => {
    const u = perId.get(String(id));
    if (!u) return { naam: onbekendLabel(String(id)), personeelsnr: null, gebruiker: null };
    return { naam: u.isActive === false ? `${u.name} (uit dienst)` : u.name, personeelsnr: u.employeeId?.trim() || null, gebruiker: u };
  };
};

export const MAAND_NAMEN = ["Januari", "Februari", "Maart", "April", "Mei", "Juni", "Juli", "Augustus", "September", "Oktober", "November", "December"] as const;

/** 'JJJJ-MM' → "Augustus 2026". */
export const maandLabel = (sleutel: string): string => `${MAAND_NAMEN[Number(sleutel.slice(5, 7)) - 1] ?? sleutel} ${sleutel.slice(0, 4)}`;

const WEEKDAGEN = ["zo", "ma", "di", "wo", "do", "vr", "za"] as const;
/** Weekdag van een ISO-dag, op de cijfers van de string (UTC), dus zonder tijdzone. */
export const weekdagKort = (iso: string): string => WEEKDAGEN[new Date(`${iso}T00:00:00Z`).getUTCDay()] ?? "";

const MET_ZONE = /(Z|[+-]\d{2}:?\d{2})$/;
const ISO_DAG = /^\d{4}-\d{2}-\d{2}/;

/**
 * De kalenderdag (ISO) van een tijdstip uit de database, in Belgische tijd:
 * een aanvraag van 23:30 UTC is in Brussel al de volgende dag. Een waarde
 * zonder tijdzone (of een kale datum) is al een kalenderdag en blijft wat ze
 * is; rommel wordt null. Onafhankelijk van de tijdzone van de server.
 */
export const dagVanTijdstip = (waarde: string | null | undefined): string | null => {
  if (!waarde || !ISO_DAG.test(waarde)) return null;
  if (!MET_ZONE.test(waarde)) return waarde.slice(0, 10);
  const d = new Date(waarde);
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString("en-CA", { timeZone: "Europe/Brussels" }) : null;
};
