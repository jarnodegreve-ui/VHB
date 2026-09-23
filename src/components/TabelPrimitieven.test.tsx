import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CelKnop, rijKlik } from './Table';
import { Tabel, TableShell, Td, Th } from './TabelBasis';
import { VervalPil } from './VervalPil';

afterEach(cleanup);

describe('Th', () => {
  it('is standaard een kolomkop (scope="col"), overschrijfbaar', () => {
    render(
      <table>
        <thead><tr><Th>Naam</Th><Th scope="row">Totaal</Th></tr></thead>
      </table>,
    );
    expect(screen.getByRole('columnheader', { name: 'Naam' }).getAttribute('scope')).toBe('col');
    expect(screen.getByText('Totaal').getAttribute('scope')).toBe('row');
  });
});

describe('TableShell + Tabel', () => {
  it('geeft het label door als toegankelijke naam van de tabel', () => {
    render(
      <TableShell label="Gebruikers">
        <Tabel><tbody><tr><Td>a</Td></tr></tbody></Tabel>
      </TableShell>,
    );
    expect(screen.getByRole('table', { name: 'Gebruikers' })).toBeTruthy();
  });

  it('een eigen label op Tabel wint', () => {
    render(
      <TableShell label="Kader">
        <Tabel label="Eigen"><tbody><tr><Td>a</Td></tr></tbody></Tabel>
      </TableShell>,
    );
    expect(screen.getByRole('table', { name: 'Eigen' })).toBeTruthy();
  });

  it('toont de kop boven de tabel en maakt van een strook die niet schuift geen region', () => {
    render(
      <TableShell label="Diensten" kop={<p>Zoekbalk</p>}>
        <Tabel><tbody><tr><Td>a</Td></tr></tbody></Tabel>
      </TableShell>,
    );
    expect(screen.getByText('Zoekbalk')).toBeTruthy();
    // jsdom meet 0 × 0: niets schuift, dus geen focusbare region.
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('een schuivende strook wordt een focusbare region met het label', () => {
    const sw = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(900);
    const cw = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
    try {
      render(
        <TableShell label="Diensten">
          <Tabel><tbody><tr><Td>a</Td></tr></tbody></Tabel>
        </TableShell>,
      );
      const strook = screen.getByRole('region', { name: 'Diensten' });
      expect(strook.getAttribute('tabindex')).toBe('0');
    } finally {
      sw.mockRestore();
      cw.mockRestore();
    }
  });

  it('`past` is nooit een scrollcontainer', () => {
    const sw = vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(900);
    const cw = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(300);
    try {
      render(
        <TableShell label="Diensten" past>
          <Tabel><tbody><tr><Td>a</Td></tr></tbody></Tabel>
        </TableShell>,
      );
      expect(screen.queryByRole('region')).toBeNull();
      expect(screen.getByRole('table').parentElement?.className ?? '').not.toMatch(/overflow-x-auto/);
    } finally {
      sw.mockRestore();
      cw.mockRestore();
    }
  });
});

describe('Td nowrap', () => {
  it('breekt niet af en blijft links', () => {
    render(<table><tbody><tr><Td nowrap>12/09/2026</Td><Td num>4</Td></tr></tbody></table>);
    const datum = screen.getByText('12/09/2026');
    expect(datum.className).toMatch(/whitespace-nowrap/);
    expect(datum.className).not.toMatch(/text-right/);
    expect(screen.getByText('4').className).toMatch(/text-right/);
  });
});

describe('CelKnop + rijKlik', () => {
  function Rij({ open, anders }: { open: () => void; anders: () => void }) {
    return (
      <table>
        <tbody>
          <tr onClick={rijKlik(open)}>
            <Td><CelKnop onClick={open} label="Alex bewerken">Alex</CelKnop></Td>
            <Td>vrije cel</Td>
            {/* rauw: testknop */}
            <Td><button type="button" onClick={anders}>Menu</button></Td>
          </tr>
        </tbody>
      </table>
    );
  }

  it('de knop opent precies één keer, ook via het toetsenbord', () => {
    const open = vi.fn();
    render(<Rij open={open} anders={() => {}} />);
    const knop = screen.getByRole('button', { name: 'Alex bewerken' });
    fireEvent.click(knop);
    expect(open).toHaveBeenCalledTimes(1);
    knop.focus();
    expect(document.activeElement).toBe(knop);
  });

  it('een klik elders in de rij opent, een eigen knop in de rij niet', () => {
    const open = vi.fn();
    const anders = vi.fn();
    render(<Rij open={open} anders={anders} />);
    fireEvent.click(screen.getByText('vrije cel'));
    expect(open).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Menu' }));
    expect(anders).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
  });
});

describe('VervalPil', () => {
  it('zonder datum een gedempt streepje, met label ervoor', () => {
    render(<VervalPil datum={null} label="Code 95" />);
    expect(screen.getByText('Code 95: —')).toBeTruthy();
  });

  it('met datum: korte datum, dagen en de lange datum als tooltip', () => {
    render(<VervalPil datum="2027-11-27" dagen={45} />);
    const datum = screen.getByText(/27 nov\.? 2027/);
    expect(datum.getAttribute('title')).toBeTruthy();
    expect(screen.getByText('· 45 d')).toBeTruthy();
  });

  it('verlopen', () => {
    render(<VervalPil datum="2020-01-01" dagen={-3} />);
    expect(screen.getByText('· verlopen')).toBeTruthy();
  });
});
