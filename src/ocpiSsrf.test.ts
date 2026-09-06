// @vitest-environment node
/**
 * SSRF-guard op de uitgaande OCPI-verzoeken. De audit van 29-07-2026 vond dat
 * er wél een guard bestond, maar dat die op slechts 2 van de ~7 uitgaande
 * URL's zat: version-details, het credentials-endpoint, de opgeslagen
 * sender-endpoints en de `Link: rel=next`-paginatie kwamen ongefilterd uit de
 * respons van de tegenpartij — telkens mét Token A/B/C in de header.
 */
import { describe, it, expect, beforeAll } from 'vitest';

// Vóór de import: de allowlist wordt uit deze env-var afgeleid bij module-load.
process.env.OCPI_CPO_VERSIONS_URL = 'https://cpo.example.com/ocpi/versions';

let assertSafeOcpiUrl: (raw: string, wat: string) => string;

beforeAll(async () => {
  ({ assertSafeOcpiUrl } = await import('../api/ocpi.js'));
});

const geweigerd = (url: string) => expect(() => assertSafeOcpiUrl(url, 'test-URL')).toThrow();

describe('assertSafeOcpiUrl', () => {
  it('laat de geconfigureerde CPO-host door', () => {
    const ok = 'https://cpo.example.com/ocpi/2.2.1/locations?limit=100';
    expect(assertSafeOcpiUrl(ok, 'test-URL')).toBe(ok);
  });

  it('weigert een andere publieke host, ook al is die op zich "veilig"', () => {
    // Dit is de kern: het oude IP-blocklistje liet elke publieke host door,
    // dus een aanvallershost kreeg gewoon Token C toegestuurd.
    geweigerd('https://evil.example/ocpi/locations');
    geweigerd('https://cpo.example.com.evil.example/ocpi');
  });

  it('weigert een andere poort op dezelfde host', () => {
    geweigerd('https://cpo.example.com:8443/ocpi/locations');
  });

  it('weigert http, ook naar de toegestane host', () => {
    geweigerd('http://cpo.example.com/ocpi/locations');
  });

  it('weigert loopback, private ranges en cloud-metadata', () => {
    geweigerd('https://localhost/ocpi');
    geweigerd('https://127.0.0.1/ocpi');
    geweigerd('https://169.254.169.254/latest/meta-data/');
    geweigerd('https://10.0.0.5/ocpi');
    geweigerd('https://192.168.1.1/ocpi');
    geweigerd('https://172.16.0.1/ocpi');
    geweigerd('https://[::1]/ocpi');
    geweigerd('https://[::ffff:169.254.169.254]/');
  });

  it('weigert de DNS-omweg die het oude blocklistje miste', () => {
    // localtest.me en nip.io resolven naar 127.0.0.1; zonder allowlist glipte
    // dit langs elke IP-regex heen.
    geweigerd('https://localtest.me/ocpi');
    geweigerd('https://127.0.0.1.nip.io/ocpi');
  });

  it('weigert onzin en niet-http-schemas', () => {
    geweigerd('file:///etc/passwd');
    geweigerd('gopher://cpo.example.com/');
    geweigerd('geen-url');
    geweigerd('');
  });
});
