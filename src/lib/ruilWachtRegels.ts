import type { User } from '../types';
import { formatShortDayPadded } from './format';
import type { RuilWachtOpMij } from './ruilWachtOpMij';

/**
 * De twee regels van een rij in het paneel: wie en wat (regel 1), welke dienst
 * (regel 2). Kort geschreven, want `OpsRow` kapt af.
 */
export function ruilWachtRegels(item: RuilWachtOpMij, users: ReadonlyArray<Pick<User, 'id' | 'name'>>): { primary: string; secondary: string } {
  const { ruil, soort } = item;
  const naam = users.find((u) => u.id === ruil.requesterId)?.name ?? 'Een collega';
  const dienst = [ruil.shiftDate ? formatShortDayPadded(ruil.shiftDate) : null, ruil.shiftLine ? `dienst ${ruil.shiftLine}` : null].filter(Boolean).join(' · ');
  if (soort === 'bevestiging') {
    return { primary: `Je rijdt de dienst van ${naam}`, secondary: dienst ? `${dienst} · goedgekeurd, bevestig dat je het zag` : 'Goedgekeurd, bevestig dat je het zag' };
  }
  // Zelfde lezing als de lijst in Dienstruil: 'overname' = zonder
  // tegenprestatie; anders een 1-op-1-ruil waarbij de aanvrager een dienst of
  // een vrije dag van de collega terugneemt (`returnCode` 'vrij').
  const isOvername = ruil.swapType === 'overname' || !ruil.returnDate || !ruil.returnCode;
  const tegen = isOvername
    ? null
    : ruil.returnCode!.toLowerCase() === 'vrij'
      ? `in ruil voor jouw vrije ${formatShortDayPadded(ruil.returnDate!)}`
      : `in ruil voor jouw dienst ${ruil.returnCode} (${formatShortDayPadded(ruil.returnDate!)})`;
  return {
    primary: isOvername ? `${naam} vraagt een overname` : `${naam} wil ruilen`,
    secondary: [dienst, tegen].filter(Boolean).join(' · ') || 'Wacht op jouw antwoord',
  };
}
