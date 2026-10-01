import { apiJson } from './api';
import { parseFilmnummerLijst, type FilmnummerLijst } from '../../shared/filmnummers';

/**
 * De filmnummers op het toestel. De lijst is één gedeelde, niet-persoonlijke
 * bron (zoals het ritblad), dus een kopie in localStorage is veilig. Het
 * scherm toont die kopie meteen en ververst erachter: onderweg, met een zwak
 * of geen signaal, staat de lijst er zonder wachten, zodra ze één keer
 * geopend is.
 */
const SLEUTEL = 'vhb-filmnummers';

/** De kopie op het toestel; null als er geen (bruikbare) is. */
export const leesFilmnummersLokaal = (): FilmnummerLijst | null => {
  try {
    const ruw = window.localStorage.getItem(SLEUTEL);
    if (!ruw) return null;
    const lijst = parseFilmnummerLijst(JSON.parse(ruw));
    return lijst.items.length > 0 ? lijst : null;
  } catch {
    return null;
  }
};

export const bewaarFilmnummersLokaal = (lijst: FilmnummerLijst): void => {
  try {
    if (lijst.items.length > 0) window.localStorage.setItem(SLEUTEL, JSON.stringify(lijst));
    else window.localStorage.removeItem(SLEUTEL);
  } catch {
    /* privémodus of opslag geblokkeerd: de lijst komt dan telkens van de server */
  }
};

/**
 * De lijst van de server, meteen ook bewaard op het toestel. Een antwoord in
 * een onverwachte vorm is een laadfout, geen lege lijst: anders zou één
 * vreemd antwoord de kopie op het toestel wissen.
 */
export async function haalFilmnummers(): Promise<FilmnummerLijst> {
  const antwoord = await apiJson<unknown>('/api/filmnummers');
  if (!antwoord || typeof antwoord !== 'object' || !Array.isArray((antwoord as { items?: unknown }).items)) {
    throw new Error('De filmnummers konden niet laden.');
  }
  const lijst = parseFilmnummerLijst(antwoord);
  bewaarFilmnummersLokaal(lijst);
  return lijst;
}
