/**
 * Eén statuswoordenschat voor client én server (tranche 3A, 22-09-2026).
 *
 * Vóór dit bestand had elk domein zijn eigen map: drie swap-statusmaps
 * (StatusBadge, PrintDienstwissels, rapport ruilen), twee verlof-maps, twee
 * toestel-varianten in dezelfde view ("Wacht op goedkeuring" naast "Wacht op
 * akkoord"), en voertuig `reserve` was oker in Voertuigen maar slate in
 * Voertuigwerken. Hier staat per domein één label en één toon; de UI vertaalt
 * de toon naar een Badge-tint (primitives.tsx), het printblad naar vet/stip
 * (shared/rapporten/opmaak.ts) en de mails gebruiken het label letterlijk.
 *
 * Woordkeuzes die vastliggen:
 * - Een planner wijst AF (Afwijzen → Afgewezen); een collega WEIGERT een
 *   ruil (Weigeren → Geweigerd). Dezelfde beslisser, hetzelfde woord.
 * - `completed` heet Goedgekeurd, net als `approved` (Jarno 18-09): het is
 *   dezelfde beslissing, alleen administratief weggezet.
 * - Geen status zonder Nederlandse tekst: `statusVan` valt terug op de ruwe
 *   waarde, en de tests in shared/status.test.ts bewaken elke map.
 */

/** Semantische toon, los van kleur: de UI kiest de tint. */
export type StatusToon = 'neutraal' | 'info' | 'aandacht' | 'waarschuwing' | 'gevaar' | 'goed';

export type StatusDef = { label: string; toon: StatusToon };

const def = (label: string, toon: StatusToon): StatusDef => ({ label, toon });

/** Verlof- en ruilaanvragen (kolom `status` in leave_requests en swap_requests). */
export const AANVRAAG_STATUS = {
  pending: def('In behandeling', 'waarschuwing'),
  accepted: def('Wacht op planner', 'info'),
  approved: def('Goedgekeurd', 'goed'),
  rejected: def('Afgewezen', 'gevaar'),
  cancelled: def('Geannuleerd', 'neutraal'),
  completed: def('Goedgekeurd', 'goed'),
} as const satisfies Record<string, StatusDef>;
export type AanvraagStatus = keyof typeof AANVRAAG_STATUS;

/** Dienstruil: dezelfde statussen, maar `pending` betekent hier "de collega
 *  moet nog antwoorden" en verdient dat woord ook. */
export const RUIL_STATUS = {
  ...AANVRAAG_STATUS,
  pending: def('Wacht op collega', 'waarschuwing'),
} as const satisfies Record<AanvraagStatus, StatusDef>;

/** Antwoord van de collega op een ruilvoorstel (afgeleid uit het verloop). */
export const COLLEGA_ANTWOORD = {
  geaccepteerd: def('Geaccepteerd', 'goed'),
  geweigerd: def('Geweigerd', 'gevaar'),
  wacht: def('Wacht op antwoord', 'waarschuwing'),
  'niet-afgewacht': def('Niet afgewacht', 'neutraal'),
  geen: def('Geen antwoord', 'neutraal'),
  'niet-nodig': def('Niet nodig', 'neutraal'),
} as const satisfies Record<string, StatusDef>;

/** Toestellen (device_registrations.status). */
export const TOESTEL_STATUS = {
  approved: def('Goedgekeurd', 'goed'),
  pending: def('Wacht op goedkeuring', 'waarschuwing'),
  revoked: def('Geblokkeerd', 'gevaar'),
} as const satisfies Record<string, StatusDef>;

/** Voertuigen (vehicles.status). `reserve` is een aandachtspunt, geen
 *  waarschuwing; `uit_dienst` een rusttoestand, geen alarm. */
export const VOERTUIG_STATUS = {
  actief: def('Actief', 'goed'),
  reserve: def('Reserve', 'aandacht'),
  uit_dienst: def('Uit dienst', 'neutraal'),
} as const satisfies Record<string, StatusDef>;

/** Gele boek (defect_meldingen.status). De ouderdom van een open melding
 *  (rood na 14 dagen) is een signaal bóven op de status, zie GeleBoekView. */
export const DEFECT_STATUS = {
  open: def('Open', 'waarschuwing'),
  uitgevoerd: def('Uitgevoerd', 'goed'),
  geannuleerd: def('Geannuleerd', 'neutraal'),
} as const satisfies Record<string, StatusDef>;

/** Dagadministratie en looncontrole. Een dag zonder detail is "Nog niet
 *  geopend" zolang hij na vandaag valt (openen kan nog niet aan de orde zijn)
 *  en "Niet geopend" vanaf vandaag; zie `dagOpenStatus`. */
export const DAG_STATUS = {
  afgesloten: def('Afgesloten', 'goed'),
  open: def('Open', 'waarschuwing'),
  niet_geopend: def('Niet geopend', 'neutraal'),
  nog_niet_geopend: def('Nog niet geopend', 'neutraal'),
} as const satisfies Record<string, StatusDef>;
export type DagOpenStatus = keyof typeof DAG_STATUS;

/**
 * Status van één dag in de dagadministratie. `datum` en `vandaag` zijn
 * ISO-dagen (JJJJ-MM-DD) op de Belgische kalender; een dag met detail is open
 * of afgesloten, een dag zonder detail na vandaag "nog niet geopend", vandaag
 * of eerder "niet geopend". Of een niet-geopende dag een rood signaal verdient
 * (er was planning) beslist het scherm, niet deze status.
 */
export function dagOpenStatus(datum: string, vandaag: string, heeftDetail: boolean, afgesloten: boolean): DagOpenStatus {
  if (heeftDetail) return afgesloten ? 'afgesloten' : 'open';
  return datum > vandaag ? 'nog_niet_geopend' : 'niet_geopend';
}

/** Omleidingen, afgeleid uit de periode (src/lib/diversions.ts). */
export const OMLEIDING_FASE = {
  lopend: def('Actief', 'goed'),
  komend: def('Komend', 'info'),
  verlopen: def('Verlopen', 'neutraal'),
} as const satisfies Record<string, StatusDef>;

/** Gebruikersaccount. */
export const ACCOUNT_STATUS = {
  actief: def('Actief', 'goed'),
  gepauzeerd: def('Gepauzeerd', 'neutraal'),
} as const satisfies Record<string, StatusDef>;

/** Foutgroepen in Systeemstatus. */
export const FOUTGROEP_STATUS = {
  open: def('Open', 'waarschuwing'),
  opgelost: def('Opgelost', 'goed'),
  genegeerd: def('Genegeerd', 'neutraal'),
  regressie: def('Opnieuw', 'gevaar'),
} as const satisfies Record<string, StatusDef>;

/** Vervaldata (rapporten en Vervaldata-scherm). */
export const VERVAL_STATUS = {
  vervallen: def('Vervallen', 'gevaar'),
  binnenkort: def('Binnenkort', 'waarschuwing'),
  in_orde: def('In orde', 'goed'),
  geen_datum: def('Geen datum', 'waarschuwing'),
} as const satisfies Record<string, StatusDef>;

const ONBEKEND: StatusDef = def('Onbekend', 'neutraal');

/** Label en toon van een status; een onbekende waarde toont de ruwe tekst
 *  in neutraal i.p.v. te crashen (oude records, nieuwe serverwaarde). */
export function statusVan<M extends Record<string, StatusDef>>(map: M, status: string | null | undefined): StatusDef {
  if (!status) return ONBEKEND;
  return (map as Record<string, StatusDef>)[status] ?? def(status, 'neutraal');
}

/** Alleen het label, voor toasts, mails en logregels. Met `kleineLetter`
 *  voor midden in een zin ("Verlof afgewezen." → "…is afgewezen"). */
export function statusLabel<M extends Record<string, StatusDef>>(map: M, status: string | null | undefined, kleineLetter = false): string {
  const label = statusVan(map, status).label;
  return kleineLetter ? label.charAt(0).toLowerCase() + label.slice(1) : label;
}
