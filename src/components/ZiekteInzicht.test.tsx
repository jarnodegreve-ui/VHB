import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import type { LeaveRequest, User } from '../types';
import { ZiekteInzicht } from './ZiekteInzicht';

// De getallen van het jaaroverzicht gaan door formatGetal (src/lib/format.ts):
// het duizendtal is een smalle vaste spatie, nooit de punt van nl-BE. "6.582"
// naast een komma als decimaalteken werd gelezen als 6,582 (Jarno 27-08).

const SMALLE_SPATIE = ' ';

const chauffeur = (id: string, name: string) => ({ id, name, role: 'chauffeur', isActive: true }) as User;
const ziek = (userId: string, startDate: string, endDate: string) =>
  ({ id: `z-${userId}`, userId, type: 'ziekte', status: 'approved', startDate, endDate }) as LeaveRequest;

// 2026 telt 365 dagen. Zeventien chauffeurs het hele jaar (6 205), één 329
// dagen (t/m 25 november) en één 48 dagen (1 februari t/m 20 maart): 6 582.
const HEEL_JAAR = Array.from({ length: 17 }, (_, i) => chauffeur(`j${i}`, `Chauffeur ${String(i + 1).padStart(2, '0')}`));
const LANG = chauffeur('lang', 'Zoë Lang');
// Alfabetisch vooraan, zodat de rij op de eerste pagina van de tabel staat.
const KORT = chauffeur('kort', 'Aagje Kort');
const USERS = [...HEEL_JAAR, LANG, KORT];
const MELDINGEN = [
  ...HEEL_JAAR.map((u) => ziek(u.id, '2026-01-01', '2026-12-31')),
  ziek(LANG.id, '2026-01-01', '2026-11-25'),
  ziek(KORT.id, '2026-02-01', '2026-03-20'),
];

afterEach(cleanup);

describe('ZiekteInzicht: getallen in de vorm van formatGetal', () => {
  it('toont 6582 als "6 582" (smalle spatie) en 48 als "48", nooit met een punt', () => {
    const { container } = render(<ZiekteInzicht leaveRequests={MELDINGEN} users={USERS} vandaag="2026-12-31" />);

    const totalen = within(screen.getByLabelText('Jaartotalen'));
    const waarde = (label: string) => totalen.getByText(label).parentElement!.querySelector('dd')!.textContent;
    expect(waarde('Kalenderdagen')).toBe(`6${SMALLE_SPATIE}582`);
    expect(waarde('Chauffeurs')).toBe('19');
    expect(waarde('Geregistreerde meldingen')).toBe('19');

    // De rij van de chauffeur met 48 dagen: een getal onder de duizend blijft zoals het is.
    const rij = within(screen.getByRole('table')).getByText('Aagje Kort').closest('tr')!;
    expect([...rij.querySelectorAll('td')].slice(1).map((td) => td.textContent)).toEqual(['48', '1']);

    // Nergens het duizendtal met een punt.
    expect(container.textContent).not.toContain('6.582');
  });
});
