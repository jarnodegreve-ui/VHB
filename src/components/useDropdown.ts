import { useEffect, useRef, useState } from 'react';
import { useLaag } from '../lib/lagen';

/** Is dit een telefoon (onder `sm`), waar een `mobielVol`-paneel het scherm vult? */
const opTelefoon = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 639.98px)').matches;

/**
 * Gedeeld gedrag van de topbar-uitklapmenu's (UserMenu, WerkvoorraadMenu):
 * open/dicht-state met sluiten op buiten-klik en Escape. Eén bron zodat een
 * volgende popover niet opnieuw dezelfde listeners kopieert.
 *
 * Het vlak is een laag in de gedeelde stapel (src/lib/lagen.ts, polish P2a):
 * Escape sluit alleen het vlak, niet ook een zijpaneel eronder. `mobielVol`:
 * het vlak vult op de telefoon de breedte (Meldingen, Open taken) en telt dan
 * als overlay met een eigen history-entry, dus de terugknop sluit eerst het
 * paneel voor de pagina wisselt. Een klein vlak op desktop krijgt geen entry.
 */
export function useDropdown({ mobielVol = false }: { mobielVol?: boolean } = {}) {
  const [open, setOpen] = useState(false);
  const wortel = useRef<HTMLDivElement>(null);
  /** Het zwevende vlak als het in een portal buiten de wortel staat
   *  (`<AnkerPopover vlakRef={vlak}>`): een klik daarin is geen buiten-klik. */
  const vlak = useRef<HTMLDivElement>(null);
  // Sluiten via Escape of de terugknop (de laag) geeft de focus terug aan de
  // knop die het vlak opende (a11y-rest, 24-09); een buiten-klik niet, die
  // heeft zijn eigen doel.
  const sluitMetFocus = () => {
    wortel.current?.querySelector<HTMLElement>('[aria-expanded="true"]')?.focus({ preventScroll: true });
    setOpen(false);
  };
  useLaag({ open, sluit: sluitMetFocus, historie: mobielVol && opTelefoon(), soort: 'popover' });

  useEffect(() => {
    if (!open) return;
    const buiten = (e: PointerEvent) => {
      const doel = e.target as Node;
      if (vlak.current?.contains(doel)) return;
      if (wortel.current && !wortel.current.contains(doel)) setOpen(false);
    };
    document.addEventListener('pointerdown', buiten);
    return () => document.removeEventListener('pointerdown', buiten);
  }, [open]);

  return { open, setOpen, wortel, vlak };
}
