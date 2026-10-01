import { apiJson } from './api';
import { parseFilmnummerLijst, type FilmnummerLijst } from '../../shared/filmnummers';

/**
 * De filmnummers op het toestel. De lijst is één gedeelde, niet-persoonlijke
 * bron (zoals het ritblad), dus een kopie in localStorage is veilig. Het
 * scherm toont die kopie meteen en ververst erachter: onderweg, met een zwak
 * of geen signaal, staat de lijst er zonder wachten. De kopie komt er bij de
 * eerste opening van het scherm, of eerder door de stille warmup na de start
 * (`warmFilmnummers`), zodat ze er ook staat voor wie het scherm voor het
 * eerst zonder bereik opent.
 */
const SLEUTEL = 'vhb-filmnummers';

/** Een kopie die ouder is dan dit, haalt de warmup opnieuw op. */
const WARM_NA_MS = 12 * 60 * 60 * 1000;

type Bewaard = { lijst: FilmnummerLijst; opgehaaldOp: number | null };

const leesBewaard = (): Bewaard | null => {
  try {
    const ruw = window.localStorage.getItem(SLEUTEL);
    if (!ruw) return null;
    const waarde: unknown = JSON.parse(ruw);
    const lijst = parseFilmnummerLijst(waarde);
    if (lijst.items.length === 0) return null;
    const op = (waarde as { opgehaaldOp?: unknown }).opgehaaldOp;
    return { lijst, opgehaaldOp: typeof op === 'number' ? op : null };
  } catch {
    return null;
  }
};

/** De kopie op het toestel; null als er geen (bruikbare) is. */
export const leesFilmnummersLokaal = (): FilmnummerLijst | null => leesBewaard()?.lijst ?? null;

const bewaarLokaal = (lijst: FilmnummerLijst): void => {
  try {
    if (lijst.items.length > 0) window.localStorage.setItem(SLEUTEL, JSON.stringify({ ...lijst, opgehaaldOp: Date.now() }));
    else window.localStorage.removeItem(SLEUTEL);
  } catch {
    /* privémodus of opslag geblokkeerd: de lijst komt dan telkens van de server */
  }
};

// Eigen imports in deze sessie. Een antwoord dat vóór een import vertrok is
// ouder dan die import: het mag het scherm en de kopie niet terugzetten.
let imports = 0;
let laatsteImport: FilmnummerLijst | null = null;

/** Na een geslaagde import: dit is nu de lijst, ook voor een antwoord dat nog onderweg is. */
export const noteerFilmnummerImport = (lijst: FilmnummerLijst): void => {
  imports += 1;
  laatsteImport = lijst;
  bewaarLokaal(lijst);
};

/**
 * De lijst van de server, meteen ook bewaard op het toestel. Een antwoord in
 * een onverwachte vorm is een laadfout, geen lege lijst: anders zou één
 * vreemd antwoord de kopie op het toestel wissen.
 */
export async function haalFilmnummers(signaal?: AbortSignal): Promise<FilmnummerLijst> {
  const bij = imports;
  const antwoord = await apiJson<unknown>('/api/filmnummers', { signal: signaal });
  if (bij !== imports && laatsteImport) return laatsteImport;
  if (!antwoord || typeof antwoord !== 'object' || !Array.isArray((antwoord as { items?: unknown }).items)) {
    throw new Error('De filmnummers konden niet laden.');
  }
  const lijst = parseFilmnummerLijst(antwoord);
  bewaarLokaal(lijst);
  return lijst;
}

/**
 * Stil, na de start van de app (warmViews in src/app/viewLoaders.ts): zet de
 * lijst op het toestel als ze er nog niet staat of ouder is dan een halve
 * dag. Mislukt het (geen bereik), dan is er niets verloren: het scherm haalt
 * de lijst zelf op zodra het opent. `signaal`: de warmup breekt zijn aanvraag
 * zelf af zodra de pagina verlaten wordt (zie warmViews).
 */
export async function warmFilmnummers(signaal?: AbortSignal): Promise<void> {
  const op = leesBewaard()?.opgehaaldOp;
  if (op && Date.now() - op < WARM_NA_MS) return;
  try {
    await haalFilmnummers(signaal);
  } catch {
    /* geen bereik of geen toegang: het scherm probeert het zelf */
  }
}

/** Alleen voor tests: de teller van de eigen imports terugzetten. */
export const _resetFilmnummersVoorTests = (): void => { imports = 0; laatsteImport = null; };
