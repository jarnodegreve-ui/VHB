/**
 * Kleine tekstregels die scherm, blad en rapport delen (verbeterronde 14-10,
 * punten 6 en 7): een telefoonnummer zoals je het leest, en een citaat tussen
 * typografische aanhalingstekens. Zod-vrij en zonder afhankelijkheden, zodat
 * zowel `src/` als `api/` ze kunnen importeren.
 */

/** Alleen de cijfers van een telefoonnummer, zonder de "(0)" na een landcode. */
export const telefoonCijfers = (phone: string | null | undefined): string =>
  String(phone ?? '').replace(/\(0\)/g, '').replace(/\D/g, '');

/**
 * Telefoonnummer zoals je het leest. Het veld is vrije tekst: "0472123456",
 * "0472/12.34.56" en "+32 (0)472 12 34 56" komen allemaal voor en stonden tot
 * 14-10 letterlijk zo in Contacten. Belgische nummers krijgen één opmaak:
 * mobiel "0472 12 34 56", de tweecijferige zones (02, 03, 04, 09) "09 123 45 67",
 * de rest "053 12 34 56", dienstnummers "0800 12 345"; een nummer uit een ander land of iets wat geen
 * telefoonnummer is komt ongewijzigd (getrimd) terug, zodat er nooit iets
 * verloren gaat.
 */
export function formatTelefoon(phone: string | null | undefined): string {
  const raw = String(phone ?? '').trim();
  if (!raw) return '';
  const internationaal = raw.startsWith('+') || raw.startsWith('00');
  let cijfers = telefoonCijfers(raw);
  if (raw.startsWith('00')) cijfers = cijfers.slice(2);
  let nationaal = cijfers;
  if (internationaal) {
    if (!cijfers.startsWith('32')) return raw;
    nationaal = `0${cijfers.slice(2)}`;
  }
  if (!nationaal.startsWith('0')) return raw;
  if (nationaal.length === 10 && nationaal[1] === '4') {
    return `${nationaal.slice(0, 4)} ${nationaal.slice(4, 6)} ${nationaal.slice(6, 8)} ${nationaal.slice(8, 10)}`;
  }
  if (nationaal.length === 9) {
    // Dienstnummers (0800, 0900): "0800 12 345".
    if (nationaal.startsWith('0800') || nationaal.startsWith('090')) {
      return `${nationaal.slice(0, 4)} ${nationaal.slice(4, 6)} ${nationaal.slice(6, 9)}`;
    }
    const zone = ['02', '03', '04', '09'].includes(nationaal.slice(0, 2)) ? 2 : 3;
    const rest = nationaal.slice(zone);
    const groepen = zone === 2 ? [rest.slice(0, 3), rest.slice(3, 5), rest.slice(5, 7)] : [rest.slice(0, 2), rest.slice(2, 4), rest.slice(4, 6)];
    return `${nationaal.slice(0, zone)} ${groepen.join(' ')}`;
  }
  return raw;
}

/** Een aangehaalde waarde tussen typografische aanhalingstekens: “Familiefeest”. */
export const citaat = (tekst: string): string => `“${tekst}”`;
