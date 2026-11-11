import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { WerkvoorraadMenu } from './WerkvoorraadMenu';
import { berekenWerkvoorraad, werkvoorraadItems } from '../lib/werkvoorraad';
import type { LeaveRequest, Shift, User, View } from '../types';

/**
 * Het menu "Open taken" in de topbar (ronde 6, punt 17). De rij "te
 * herverdelen" is er één voor alle chauffeurs samen. Vroeger opende ze altijd
 * het scherm Ziekte, ook als alleen iemand met verlof nog een dienst op naam
 * had (Ziekte toont alleen ziekmeldingen). Nu: precies één chauffeur = waar
 * zijn rij in het Overzicht landt, meer dan één = het Overzicht zelf.
 *
 * De werkvoorraad komt uit de echte berekening, zodat de test faalt als het
 * menu een eigen regel naast `herverdeelPerChauffeur` zou krijgen.
 */
// Vaste "nu": maandag 31-08-2026, middag.
const NOW = new Date(2026, 7, 31, 12, 0, 0);
const gebruiker = (id: string, name: string): User =>
  ({ id, name, role: 'chauffeur', employeeId: `VHB-${id}`, isActive: true }) as User;
const USERS = [gebruiker('1', 'An'), gebruiker('2', 'Bert'), gebruiker('3', 'Cas')];
const dienst = (driverId: string, date: string, line = '2101'): Shift => ({
  id: `${driverId}-${date}-${line}`, date, startTime: '06:00', endTime: '14:00', line, busNumber: '', loopnr: '', driverId,
});
const afwezig = (id: string, userId: string, type: LeaveRequest['type'], startDate: string, endDate: string): LeaveRequest => ({
  id, userId, startDate, endDate, type, status: 'approved', createdAt: '2026-08-30T08:00:00Z',
});
const voorraad = (shifts: Shift[], leaveRequests: LeaveRequest[], extra: Partial<Parameters<typeof berekenWerkvoorraad>[0]> = {}) =>
  berekenWerkvoorraad({ users: USERS, shifts, leaveRequests, swaps: [], matrixHistory: [], coverageDays: null, vervaldata: [], pendingDevices: [], now: NOW, ...extra });
const naamVan = (id: string) => USERS.find((u) => u.id === id)?.name ?? 'Onbekend';

function open(wv: ReturnType<typeof berekenWerkvoorraad>, huidig?: View) {
  const onNavigate = vi.fn();
  render(<WerkvoorraadMenu werkvoorraad={wv} userNaam={naamVan} onNavigate={onNavigate} huidig={huidig} />);
  fireEvent.click(screen.getByRole('button', { name: `Open taken (${wv.attentionCount})` }));
  return { onNavigate, rij: (naam: RegExp) => screen.getByRole('menuitem', { name: naam }) };
}
/** Waar de rij van die chauffeur in het Overzicht landt. */
const inOverzicht = (wv: ReturnType<typeof berekenWerkvoorraad>) =>
  werkvoorraadItems(wv, { naamVan, now: NOW, formatDag: (iso) => iso }).filter((it) => it.soort === 'herverdelen');

beforeEach(() => {
  vi.stubGlobal('matchMedia', (query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('WerkvoorraadMenu: de rij "te herverdelen"', () => {
  it('één chauffeur met verlof: de Maandplanning op de dag van zijn vroegste dienst, zoals zijn rij in het Overzicht', () => {
    // Verlof over drie weken met nog twee diensten op naam; de vroegste beslist.
    const wv = voorraad(
      [dienst('2', '2026-09-23', '2607'), dienst('2', '2026-09-22')],
      [afwezig('v1', '2', 'betaald_verlof', '2026-09-21', '2026-09-25')],
    );
    const { onNavigate, rij } = open(wv);
    const r = rij(/2 diensten te herverdelen/);
    expect(r.textContent).toContain('Bert (2)');
    fireEvent.click(r);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('bezetting', { params: ['2026-09', '2026-09-22'] });
    const [item] = inOverzicht(wv);
    expect(onNavigate).toHaveBeenCalledWith(item.doel, { params: item.doelParams });
    // Het menu sluit bij de keuze (het vlak zelf fadet nog uit).
    expect(screen.getByRole('button', { name: /^Open taken/ }).getAttribute('aria-expanded')).toBe('false');
  });

  it('één chauffeur met klein verlet: ook de Maandplanning op de dag, niet het scherm Ziekte', () => {
    const wv = voorraad([dienst('1', '2026-09-01')], [afwezig('k1', '1', 'klein_verlet', '2026-09-01', '2026-09-01')]);
    const { onNavigate, rij } = open(wv);
    fireEvent.click(rij(/1 dienst te herverdelen/));
    expect(onNavigate).toHaveBeenCalledWith('bezetting', { params: ['2026-09', '2026-09-01'] });
  });

  it('één zieke: het detail van zijn ziekmelding, zoals zijn rij in het Overzicht', () => {
    const wv = voorraad(
      [dienst('3', '2026-09-01'), dienst('3', '2026-09-02')],
      [afwezig('z1', '3', 'ziekte', '2026-08-31', '2026-09-05')],
    );
    const { onNavigate, rij } = open(wv);
    fireEvent.click(rij(/2 diensten te herverdelen/));
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('ziekte', { params: ['z1'] });
    const [item] = inOverzicht(wv);
    expect(onNavigate).toHaveBeenCalledWith(item.doel, { params: item.doelParams });
  });

  it('meer dan één chauffeur: het Overzicht, waar elke chauffeur zijn eigen rij heeft', () => {
    const wv = voorraad(
      [dienst('3', '2026-09-01'), dienst('2', '2026-09-22')],
      [afwezig('z1', '3', 'ziekte', '2026-08-31', '2026-09-05'), afwezig('v1', '2', 'betaald_verlof', '2026-09-21', '2026-09-25')],
    );
    expect(inOverzicht(wv).map((it) => it.doel).sort()).toEqual(['bezetting', 'ziekte']);
    const { onNavigate, rij } = open(wv);
    const r = rij(/2 diensten te herverdelen/);
    expect(r.textContent).toContain('Bert (1)');
    expect(r.textContent).toContain('Cas (1)');
    fireEvent.click(r);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    // Zonder parameters: het scherm zelf.
    expect(onNavigate).toHaveBeenCalledWith('werkvoorraad', undefined);
  });

  it('één chauffeur met verlof terwijl de Maandplanning zelf openstaat: het Overzicht, want dat scherm volgt een nieuw adres niet', () => {
    const wv = voorraad(
      [dienst('2', '2026-09-22')],
      [afwezig('v1', '2', 'betaald_verlof', '2026-09-21', '2026-09-25')],
    );
    // Zijn rij in het Overzicht opent de Maandplanning wel (vers, op de dag).
    expect(inOverzicht(wv).map((it) => [it.doel, it.doelParams])).toEqual([['bezetting', ['2026-09', '2026-09-22']]]);
    const { onNavigate, rij } = open(wv, 'bezetting');
    fireEvent.click(rij(/1 dienst te herverdelen/));
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('werkvoorraad', undefined);
    cleanup();
    // Vanop elk ander scherm, ook het Overzicht zelf: rechtstreeks naar de dag.
    for (const scherm of ['dashboard', 'werkvoorraad', 'ziekte', 'dekking'] as const) {
      const ander = open(wv, scherm);
      fireEvent.click(ander.rij(/1 dienst te herverdelen/));
      expect(ander.onNavigate, scherm).toHaveBeenCalledWith('bezetting', { params: ['2026-09', '2026-09-22'] });
      cleanup();
    }
  });

  it('één zieke opent zijn ziekmelding vanop elk scherm, ook vanop de Maandplanning en vanop Ziekte zelf', () => {
    const wv = voorraad([dienst('3', '2026-09-01')], [afwezig('z1', '3', 'ziekte', '2026-08-31', '2026-09-05')]);
    for (const scherm of ['bezetting', 'ziekte', 'dashboard'] as const) {
      const { onNavigate, rij } = open(wv, scherm);
      fireEvent.click(rij(/1 dienst te herverdelen/));
      expect(onNavigate, scherm).toHaveBeenCalledWith('ziekte', { params: ['z1'] });
      cleanup();
    }
  });

  it('de andere rijen en de voet openen hun scherm zoals vroeger, zonder parameters', () => {
    const wv = voorraad(
      [dienst('2', '2026-09-22')],
      [
        afwezig('v1', '2', 'betaald_verlof', '2026-09-21', '2026-09-25'),
        { ...afwezig('l1', '1', 'betaald_verlof', '2026-10-05', '2026-10-06'), status: 'pending' },
      ],
      { pendingDevices: [{ userId: '1', name: 'iPhone', createdAt: '2026-08-31T09:00:00Z' }], vervaldata: [{ userId: '3', soort: 'code95', validUntil: '2026-09-10' }] },
    );
    const klik = (naam: RegExp) => {
      const { onNavigate, rij } = open(wv);
      fireEvent.click(rij(naam));
      cleanup();
      return onNavigate.mock.calls;
    };
    expect(klik(/1 verlofaanvraag/)).toEqual([['verlof', undefined]]);
    expect(klik(/1 toestel wacht op goedkeuring/)).toEqual([['toestellen', undefined]]);
    expect(klik(/1 vervaldatum binnen 30 dagen/)).toEqual([['vervaldata', undefined]]);
    expect(klik(/Volledig overzicht/)).toEqual([['werkvoorraad', undefined]]);
  });
});
