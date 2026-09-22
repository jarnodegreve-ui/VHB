/**
 * Rijen van de dekkingsinstellingen (tranche 3A, 22-09-2026): leeg, deels
 * of volledig ingevuld.
 *
 * Opslaan liet een half ingevulde rij vroeger stil vallen (een dag-type
 * zonder naam, een periode zonder ingangsdatum, een uitzondering zonder
 * dag-type): de planner dacht dat het bewaard was. Nu geldt:
 *
 * - `leeg`: niets ingevuld. Die rij wordt bij Opslaan weggelaten, zoals
 *   vroeger (een net toegevoegde rij die je niet gebruikte).
 * - `deels`: iets ingevuld maar niet alles wat nodig is. Opslaan stopt en de
 *   rij zegt wat er ontbreekt.
 * - `volledig`: gaat mee.
 *
 * Wat "nodig" is volgt precies wat `handleSave` vroeger als voorwaarde nam
 * om een rij mee te sturen, niets strenger.
 */

export type RijStatus = 'leeg' | 'deels' | 'volledig';
export type RijOordeel = { status: RijStatus; ontbreekt: string[] };

const ISO_DAG = /^\d{4}-\d{2}-\d{2}$/;

/** Dag-type: de naam is nodig, de dienstenlijst mag leeg zijn. */
export function dagtypeStatus(rij: { name: string; services: string[] }): RijOordeel {
  const naam = rij.name.trim() !== '';
  if (naam) return { status: 'volledig', ontbreekt: [] };
  return rij.services.length === 0 ? { status: 'leeg', ontbreekt: [] } : { status: 'deels', ontbreekt: ['een naam'] };
}

/** Weekdagperiode: de ingangsdatum is nodig; weekdagen op "geen" mogen. */
export function periodeStatus(rij: { vanaf: string; weekdays: string[] }): RijOordeel {
  if (ISO_DAG.test(rij.vanaf)) return { status: 'volledig', ontbreekt: [] };
  const iets = rij.vanaf.trim() !== '' || rij.weekdays.some((w) => w.trim() !== '');
  return iets ? { status: 'deels', ontbreekt: ['een ingangsdatum'] } : { status: 'leeg', ontbreekt: [] };
}

/** Uitzondering: van, tot en met en een bestaand dag-type zijn alle drie nodig.
 *  Een dag-type dat niet (meer) in de lijst staat, telt als niet gekozen. */
export function uitzonderingStatus(rij: { from: string; to: string; dayType: string }, geldigeTypes: ReadonlySet<string>): RijOordeel {
  const van = rij.from.trim() !== '';
  const tot = rij.to.trim() !== '';
  const typeIngevuld = rij.dayType.trim() !== '';
  const typeGeldig = typeIngevuld && geldigeTypes.has(rij.dayType);
  if (!van && !tot && !typeIngevuld) return { status: 'leeg', ontbreekt: [] };
  const ontbreekt = [
    ...(van ? [] : ['een datum van']),
    ...(tot ? [] : ['een datum tot en met']),
    ...(typeGeldig ? [] : ['een dag-type']),
  ];
  return ontbreekt.length === 0 ? { status: 'volledig', ontbreekt } : { status: 'deels', ontbreekt };
}

const opsomming = (delen: string[]) =>
  delen.length <= 1 ? (delen[0] ?? '') : `${delen.slice(0, -1).join(', ')} en ${delen[delen.length - 1]}`;

/** De tekst bij een onvolledige rij: wat ontbreekt en de uitweg. */
export function rijMelding(oordeel: RijOordeel): string {
  if (oordeel.status !== 'deels') return '';
  return `Onvolledig, nog nodig: ${opsomming(oordeel.ontbreekt)}. Vul aan of verwijder de rij.`;
}

export type DekkingRijen = {
  dayTypes: { _k: number; name: string; services: string[] }[];
  weekdayPeriods: { _k: number; vanaf: string; weekdays: string[] }[];
  overrides: { _k: number; from: string; to: string; dayType: string }[];
};

/** Sleutels voor useVeldfouten, per rij (de lokale rijsleutel `_k`). */
export const rijSleutel = {
  dagtype: (k: number) => `dagtype-${k}`,
  periode: (k: number) => `periode-${k}`,
  uitzondering: (k: number) => `uitzondering-${k}`,
};

/**
 * Alle onvolledige rijen als veldfouten (leeg object = opslaan mag). De
 * geldige dag-types zijn de ingevulde namen, zoals handleSave ze bewaart.
 */
export function onvolledigeRijen(rijen: DekkingRijen): Record<string, string> {
  const fouten: Record<string, string> = {};
  for (const d of rijen.dayTypes) {
    const o = dagtypeStatus(d);
    if (o.status === 'deels') fouten[rijSleutel.dagtype(d._k)] = rijMelding(o);
  }
  for (const p of rijen.weekdayPeriods) {
    const o = periodeStatus(p);
    if (o.status === 'deels') fouten[rijSleutel.periode(p._k)] = rijMelding(o);
  }
  const geldig = new Set(rijen.dayTypes.map((d) => d.name.trim()).filter(Boolean));
  for (const u of rijen.overrides) {
    const o = uitzonderingStatus(u, geldig);
    if (o.status === 'deels') fouten[rijSleutel.uitzondering(u._k)] = rijMelding(o);
  }
  return fouten;
}
