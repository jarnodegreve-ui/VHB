import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { LeaveRequest, User } from '../types';
import { ZiekteMeldingen } from './ZiekteMeldingen';

// De lege staat van de lijst: niets gemeld is iets anders dan niets gevonden.
// Zonder meldingen valt er geen zoekopdracht of filter aan te passen, dus
// geen "Pas de zoekopdracht aan." en geen knop die filters wist.

const CHAUFFEUR = { id: 'u1', name: 'Chauffeur A', role: 'chauffeur', isActive: true } as User;
const MELDING = { id: 'z1', userId: 'u1', type: 'ziekte', status: 'approved', startDate: '2026-11-02', endDate: '2026-11-06' } as LeaveRequest;

const toon = (meldingen: LeaveRequest[], historiek = false) => render(
  <ZiekteMeldingen meldingen={meldingen} users={[CHAUFFEUR]} vandaag="2026-11-05" dienstenVan={() => 0} onOpen={vi.fn()} historiek={historiek} />,
);

afterEach(cleanup);

describe('ZiekteMeldingen: lege staat', () => {
  it('zonder enige melding: een eigen tekst, geen zoekadvies en geen wisknop', () => {
    toon([]);
    // De kale lege staat zet zelf een punt achter de titel.
    expect(screen.getByText(/Niemand is ziek gemeld/)).toBeTruthy();
    expect(screen.queryByText(/Pas de zoekopdracht aan/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Toon alle meldingen' })).toBeNull();
  });

  it('historiek zonder meldingen: idem, met de tekst van de historiek', () => {
    toon([], true);
    expect(screen.getByText(/Nog geen eerdere ziekmeldingen/)).toBeTruthy();
    expect(screen.queryByText(/Pas de zoekopdracht aan/)).toBeNull();
  });

  it('een zoekterm die niets oplevert houdt het zoekadvies en de wisknop', () => {
    toon([MELDING], true);
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Niemand' } });
    expect(screen.getByText(/Geen meldingen gevonden/)).toBeTruthy();
    expect(screen.getByText(/Pas de zoekopdracht aan/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Toon alle meldingen' }));
    expect(screen.getByRole('button', { name: /Bekijk ziekmelding van Chauffeur A/ })).toBeTruthy();
  });
});
