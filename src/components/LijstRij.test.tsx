import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useBeslisteRijen, useVasthouden, type BeslisKlik } from './LijstRij';
import { BESLIST_MS } from '../lib/beslisteRijen';

// De hook van de vasthoudstand (ronde 6, punt 1): de klik van de beslissing
// beslist welke regel geldt (aanwijzer in de rij, of alleen de tijd), de focus
// gaat nooit naar een beslisknop, en wie het scherm verlaat laat niets achter.
// De rekenkern en de loslaatregel zelf: src/lib/beslisteRijen.test.ts; de
// tijdlijn in de browser: e2e/deeplinks-verlof-beslissen.spec.ts. Hier zonder
// LijstAnimatie (gewone elementen), zodat de nepklok alles stuurt.

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Record_ = { id: string; status: 'pending' | 'approved' };
const START: Record_[] = [{ id: 'a', status: 'pending' }, { id: 'b', status: 'pending' }, { id: 'c', status: 'pending' }];

/** Een lijst met per rij een beslisknop; `beslis` doet wat de datalaag na een geslaagde PATCH doet, en dan houdVast. */
function Lijst({ greep }: { greep: { houdVast?: (id: string, klik?: BeslisKlik) => void } }) {
  const [collectie, setCollectie] = useState(START);
  const wachtend = collectie.filter((r) => r.status === 'pending');
  const beslist = useBeslisteRijen(wachtend, { sleutel: (r) => r.id, zoek: (id) => collectie.find((r) => r.id === id) });
  greep.houdVast = beslist.houdVast;
  return (
    <div ref={beslist.lijstRef} tabIndex={-1} data-testid="lijst">
      {beslist.getoond.map(({ record, vast }) => (
        <div key={record.id} data-testid={`rij-${record.id}`} {...beslist.vak(record.id, vast)}>
          <span>{record.id}: {record.status}</span>
          {!vast && (
            <button
              type="button"
              onClick={(klik) => {
                setCollectie((c) => c.map((r) => (r.id === record.id ? { ...r, status: 'approved' } : r)));
                beslist.houdVast(record.id, klik);
              }}
            >
              Goedkeuren {record.id}
            </button>
          )}
        </div>
      ))}
      {beslist.getoond.length === 0 && <p>Alles beoordeeld</p>}
    </div>
  );
}

const rij = (id: string) => screen.queryByTestId(`rij-${id}`);
const zichtbaar = () => screen.getByTestId('lijst').textContent;

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe('useBeslisteRijen', () => {
  it('de besliste rij blijft BESLIST_MS op haar plaats, hetzelfde element, inert en met de status uit de collectie; daarna weg', () => {
    render(<Lijst greep={{}} />);
    const node = rij('b');
    // Toetsenbord: detail 0, dus alleen de tijd.
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Goedkeuren b' }), { detail: 0 }); });
    expect(rij('b')).toBe(node);
    expect(rij('b')!.hasAttribute('inert')).toBe(true);
    expect(zichtbaar()).toBe('a: pendingGoedkeuren ab: approvedc: pendingGoedkeuren c');
    act(() => { vi.advanceTimersByTime(BESLIST_MS - 1); });
    expect(rij('b')).toBe(node);
    act(() => { vi.advanceTimersByTime(1); });
    expect(rij('b')).toBeNull();
    expect(zichtbaar()).toBe('a: pendingGoedkeuren ac: pendingGoedkeuren c');
  });

  it('met het toetsenbord op de knop in de rij: de focus gaat naar de lijst zelf, nooit naar een andere beslisknop', () => {
    render(<Lijst greep={{}} />);
    const knop = screen.getByRole('button', { name: 'Goedkeuren b' });
    knop.focus();
    act(() => { fireEvent.click(knop, { detail: 0 }); });
    expect(document.activeElement).toBe(screen.getByTestId('lijst'));
  });

  it('een klik met de aanwijzer in de rij: de stand duurt tot de muis het vak verliet', () => {
    render(<Lijst greep={{}} />);
    const vak = { left: 0, top: 40, right: 400, bottom: 104, width: 400, height: 64, x: 0, y: 40, toJSON: () => ({}) };
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(vak as DOMRect);
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Goedkeuren b' }), { detail: 1, clientX: 200, clientY: 70 }); });
    act(() => { vi.advanceTimersByTime(BESLIST_MS + 1000); });
    expect(rij('b')!.hasAttribute('inert'), 'de muis staat nog op de rij').toBe(true);
    act(() => { window.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: 300, pointerType: 'mouse' })); });
    expect(rij('b')).toBeNull();
  });

  it('een houdVast zonder klik, of met een klik buiten de rij: alleen de tijd', () => {
    const greep: { houdVast?: (id: string, klik?: BeslisKlik) => void } = {};
    render(<><Lijst greep={greep} /><button type="button">Elders</button></>);
    // Een klik op een knop buiten de lijst (een paneel, een bevestiging).
    const elders = screen.getByRole('button', { name: 'Elders' });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Goedkeuren a' }), { detail: 1 }); });
    act(() => { greep.houdVast!('a', { detail: 1, target: elders }); });
    act(() => { vi.advanceTimersByTime(BESLIST_MS); });
    expect(rij('a')).toBeNull();
  });

  it('wie het scherm verlaat tijdens de stand: geen klok, geen luisteraar, geen state; een late houdVast doet niets', () => {
    const fouten = vi.spyOn(console, 'error');
    const af = vi.spyOn(window, 'removeEventListener');
    const greep: { houdVast?: (id: string, klik?: BeslisKlik) => void } = {};
    const scherm = render(<Lijst greep={greep} />);
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Goedkeuren b' }), { detail: 0 }); });
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    scherm.unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(af.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['pointermove', 'pointerdown', 'pointerup', 'pointercancel', 'click']));
    // Het antwoord van een tweede beslissing komt pas na het verlaten binnen.
    act(() => { greep.houdVast!('c'); });
    expect(vi.getTimerCount()).toBe(0);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(fouten).not.toHaveBeenCalled();
  });

  it('twee rijen kort na elkaar (bulk): elk op haar plaats, elk met haar eigen klok, "Alles beoordeeld" pas na de laatste', () => {
    const greep: { houdVast?: (id: string, klik?: BeslisKlik) => void } = {};
    render(<Lijst greep={greep} />);
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Goedkeuren a' }), { detail: 0 }); });
    act(() => { vi.advanceTimersByTime(200); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Goedkeuren b' }), { detail: 0 }); });
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Goedkeuren c' }), { detail: 0 }); });
    expect(zichtbaar()).toBe('a: approvedb: approvedc: approved');
    expect(screen.queryByText('Alles beoordeeld')).toBeNull();
    act(() => { vi.advanceTimersByTime(BESLIST_MS - 200); });
    expect(zichtbaar()).toBe('b: approvedc: approved');
    expect(screen.queryByText('Alles beoordeeld')).toBeNull();
    act(() => { vi.advanceTimersByTime(200); });
    expect(screen.getByText('Alles beoordeeld')).toBeTruthy();
  });
});

describe('useVasthouden: een vak dat geen rij is (de voet van een paneel)', () => {
  function Voet() {
    const [status, setStatus] = useState<'open' | 'goedgekeurd'>('open');
    const stand = useVasthouden();
    const vast = stand.isVast('voet');
    return (
      <div data-testid="voet" {...stand.vak('voet')}>
        {status === 'open' || vast
          ? (vast ? <span>Goedgekeurd</span> : <button type="button" onClick={(klik) => { setStatus('goedgekeurd'); stand.houdVast('voet', klik); }}>Goedkeuren</button>)
          : <button type="button">Intrekken</button>}
      </div>
    );
  }

  it('zolang de stand duurt: de nieuwe status in plaats van nieuwe knoppen; de klik in het vak houdt haar tot de aanwijzer weg is', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 0, top: 500, right: 400, bottom: 560 } as DOMRect);
    render(<Voet />);
    act(() => { fireEvent.click(screen.getByRole('button', { name: 'Goedkeuren' }), { detail: 1, clientX: 100, clientY: 530 }); });
    expect(screen.getByText('Goedgekeurd')).toBeTruthy();
    expect(screen.getByTestId('voet').hasAttribute('inert')).toBe(true);
    expect(screen.queryByRole('button', { name: 'Intrekken' })).toBeNull();
    act(() => { vi.advanceTimersByTime(BESLIST_MS + 500); });
    expect(screen.queryByRole('button', { name: 'Intrekken' }), 'de vinger of muis staat nog op de voet').toBeNull();
    // Een vinger komt ergens anders neer: los na de click van die tik.
    act(() => {
      window.dispatchEvent(new PointerEvent('pointerdown', { clientX: 100, clientY: 100, pointerType: 'touch' }));
      window.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, clientY: 100, pointerType: 'touch' }));
      window.dispatchEvent(new MouseEvent('click', { clientX: 100, clientY: 100, detail: 1 }));
    });
    expect(screen.queryByRole('button', { name: 'Intrekken' })).toBeNull();
    act(() => { vi.advanceTimersByTime(0); });
    expect(screen.getByRole('button', { name: 'Intrekken' })).toBeTruthy();
    expect(screen.getByTestId('voet').hasAttribute('inert')).toBe(false);
  });
});
