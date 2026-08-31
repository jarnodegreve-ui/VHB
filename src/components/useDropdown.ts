import { useEffect, useRef, useState } from 'react';

/**
 * Gedeeld gedrag van de topbar-uitklapmenu's (UserMenu, WerkvoorraadMenu):
 * open/dicht-state met sluiten op buiten-klik en Escape. Eén bron zodat een
 * volgende popover niet opnieuw dezelfde listeners kopieert.
 */
export function useDropdown() {
  const [open, setOpen] = useState(false);
  const wortel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const buiten = (e: PointerEvent) => {
      if (wortel.current && !wortel.current.contains(e.target as Node)) setOpen(false);
    };
    const toets = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', buiten);
    document.addEventListener('keydown', toets);
    return () => {
      document.removeEventListener('pointerdown', buiten);
      document.removeEventListener('keydown', toets);
    };
  }, [open]);

  return { open, setOpen, wortel };
}
