import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { BottomNav, dockViews } from './BottomNav';
import type { View } from '../types';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { document.body.innerHTML = ''; });

/** Rendert de onderbalk van een chauffeur en geeft de knop Meer terug. */
const meerKnop = (currentView: View) => {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => root.render(<BottomNav currentView={currentView} onSelect={() => {}} role="chauffeur" onMore={() => {}} />));
  return el.querySelector<HTMLButtonElement>('button[aria-label="Meer"]');
};

describe('BottomNav: Meer licht op voor de schermen erachter (Apple-review 17-10, nr. 4)', () => {
  it('Meer is actief op een scherm dat niet in de vaste plekken staat', () => {
    expect(meerKnop('ritblaadjes')?.getAttribute('aria-current')).toBe('page');
    expect(meerKnop('instellingen')?.getAttribute('aria-current')).toBe('page');
  });

  it('Meer is niet actief op een vaste plek, die plek wel', () => {
    const meer = meerKnop('rooster');
    expect(meer?.getAttribute('aria-current')).toBeNull();
    const rooster = document.querySelector('button[aria-label="Rooster"]');
    expect(rooster?.getAttribute('aria-current')).toBe('page');
  });
});

describe('BottomNav: vaste plekken per rol (Apple-review 17-10, nr. 11)', () => {
  it('een chauffeur heeft vier plekken plus Meer; Omleidingen staat onder Meer', () => {
    expect(dockViews('chauffeur')).toEqual(['dashboard', 'mijn-dag', 'rooster', 'verlof']);
    meerKnop('dashboard');
    const labels = [...document.querySelectorAll('button[aria-label]')].map((b) => b.getAttribute('aria-label'));
    expect(labels).toEqual(['Dashboard', 'Mijn dag', 'Rooster', 'Verlof', 'Meer']);
    expect(meerKnop('omleidingen')?.getAttribute('aria-current')).toBe('page');
  });

  it('staf en technieker houden hun vijf plekken', () => {
    expect(dockViews('planner')).toEqual(['dashboard', 'vandaag', 'verlof', 'ruil-verzoeken', 'vervaldata']);
    expect(dockViews('admin')).toEqual(dockViews('planner'));
    expect(dockViews('technieker')).toEqual(['dashboard', 'defecten', 'werkprestaties', 'verlof', 'meldingen']);
  });
});
