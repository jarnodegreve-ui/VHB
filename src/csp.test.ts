import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

/** De CSP in vercel.json staat het inline bootstrap-script in index.html toe via
 *  een sha256-hash. Wijzigt dat script (ook één spatie), dan klopt de hash niet
 *  meer en blokkeert de CSP de service-worker-registratie — stil, want de
 *  policy draait voorlopig als Report-Only. Deze test koppelt de twee. */
describe('Content-Security-Policy', () => {
  const root = resolve(__dirname, '..');
  const html = readFileSync(resolve(root, 'index.html'), 'utf-8');
  const vercel = JSON.parse(readFileSync(resolve(root, 'vercel.json'), 'utf-8'));

  const csp: string = vercel.headers
    ?.flatMap((h: any) => h.headers ?? [])
    .find((h: any) => h.key.toLowerCase().startsWith('content-security-policy'))?.value ?? '';

  it('bevat een hash voor elk inline script in index.html', () => {
    const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(inline.length).toBeGreaterThan(0);

    for (const body of inline) {
      const hash = createHash('sha256').update(body, 'utf-8').digest('base64');
      expect(csp, `inline script niet toegestaan — voeg 'sha256-${hash}' toe aan script-src in vercel.json`)
        .toContain(`sha256-${hash}`);
    }
  });

  it('houdt de gevaarlijke directives dicht', () => {
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    // 'unsafe-eval' en een blanket 'unsafe-inline' op script-src mogen er nooit
    // in sluipen; style-src mag 'unsafe-inline' wél (Tailwind/React-stijlen).
    const scriptSrc = csp.match(/script-src([^;]*)/)?.[1] ?? '';
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it('stuurt de basisheaders mee', () => {
    const keys = vercel.headers.flatMap((h: any) => h.headers.map((x: any) => x.key.toLowerCase()));
    expect(keys).toContain('x-content-type-options');
    expect(keys).toContain('referrer-policy');
    expect(keys).toContain('permissions-policy');
  });
});
