/**
 * Deeplinks (controle-ronde 27-08, voorstel 44): een push-melding of een
 * link van buiten (Telegram) opent het portaal op de juiste pagina via
 * `/?view=<view>`. De app leest dat bij het opstarten (wint van de onthouden
 * pagina) én via een NAVIGATE-bericht van de service worker als het portaal
 * al open staat — dan zonder herlaad, zodat een open formulier blijft staan.
 * De rol-guard in App.tsx vangt views af die niet mogen voor deze gebruiker.
 */
import type { View } from '../types';

/** De view uit een querystring (`?view=verlof`), of null als hij ontbreekt
 *  of niet in `toegestaan` staat (onbekende/verzonnen waarden negeren). */
export const viewUitUrl = (search: string, toegestaan: readonly string[]): View | null => {
  const v = new URLSearchParams(search.startsWith('?') ? search : `?${search}`).get('view');
  return v && toegestaan.includes(v) ? (v as View) : null;
};

/** Zoekdeel van een URL (`/?view=x` → `?view=x`; `/rooster` → ''). */
export const zoekdeelVan = (url: string): string => {
  const i = url.indexOf('?');
  return i >= 0 ? url.slice(i) : '';
};
