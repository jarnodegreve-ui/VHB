import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecordRij } from './RecordRij';

/**
 * De titel van een rij kapt standaard af op één regel; doorlopen is een keuze
 * van de lijst (controle 29-09, nr. 23: twee lange namen in de beheerlijst van
 * Dienstruil). De andere lijsten (verlof, updates, Mijn verzoeken) mogen daar
 * niets van merken.
 */
const rij = (extra: { titelTerugloop?: boolean } = {}) => render(
  <ul>
    <RecordRij titel="Maximiliaan Vandenbroucke → Christophe Vanderstraeten" meta="Dienst 2505" richting="omlaag" onClick={() => {}} {...extra} />
  </ul>,
);
const titel = () => screen.getByText('Maximiliaan Vandenbroucke → Christophe Vanderstraeten');

describe('RecordRij, titel', () => {
  it('kapt standaard af op één regel', () => {
    rij();
    expect(titel().className.split(' ')).toContain('truncate');
    expect(titel().className).not.toContain('overflow-wrap');
  });

  it('loopt door op de volgende regel met titelTerugloop', () => {
    rij({ titelTerugloop: true });
    expect(titel().className.split(' ')).not.toContain('truncate');
    expect(titel().className).toContain('[overflow-wrap:anywhere]');
  });

  it('de meta-regel blijft in beide gevallen op één regel', () => {
    rij({ titelTerugloop: true });
    expect(screen.getByText('Dienst 2505').className.split(' ')).toContain('truncate');
  });
});
