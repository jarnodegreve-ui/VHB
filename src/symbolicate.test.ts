import { afterEach, describe, expect, it, vi } from 'vitest';
import { SourceMapGenerator } from 'source-map-js';
import { clearSymbolicateCache, symbolicateTopFrame } from '../api/symbolicate';

/**
 * Symbolicatie voor de foutendigest: geminifieerde stack-posities →
 * src/-bestanden, via de sourcemap die naast de bundel op de deploy staat.
 * De map wordt hier écht gegenereerd (source-map-js) en via een gemockte
 * fetch aangeboden — dus het test het echte decodeerpad, niet een stub.
 */

const JS_URL = 'https://vhbportaal.com/assets/index-test123.js';

const buildMap = () => {
  const gen = new SourceMapGenerator({ file: 'index-test123.js' });
  gen.addMapping({
    generated: { line: 1, column: 100 },
    original: { line: 42, column: 5 },
    source: 'vite:///src/views/DashboardView.tsx',
    name: 'renderTile',
  });
  return gen.toString();
};

afterEach(() => {
  clearSymbolicateCache();
  vi.unstubAllGlobals();
});

describe('symbolicateTopFrame', () => {
  it('vertaalt een geminifieerd frame naar src-bestand:regel (functienaam erbij)', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      expect(String(url)).toBe(`${JS_URL}.map`);
      return new Response(buildMap(), { status: 200 });
    }));
    const stack = `TypeError: undefined is not an object\n    at t (${JS_URL}:1:120)\n    at onClick (${JS_URL}:1:999)`;
    const origin = await symbolicateTopFrame(stack);
    expect(origin).toBe('src/views/DashboardView.tsx:42 (renderTile)');
  });

  it('geeft null zonder sourcemap (oude deploy) en blijft niet opnieuw fetchen', async () => {
    const fetchMock = vi.fn(async () => new Response('nee', { status: 404 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await symbolicateTopFrame(`x (${JS_URL}:1:120)`)).toBeNull();
    expect(await symbolicateTopFrame(`y (${JS_URL}:1:500)`)).toBeNull();
    // Tweede aanroep komt uit de miss-cache — geen tweede fetch.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('geeft null bij een stack zonder asset-frames of zonder stack', async () => {
    vi.stubGlobal('fetch', vi.fn());
    expect(await symbolicateTopFrame('Error: iets\n    at eval (eval:1:1)')).toBeNull();
    expect(await symbolicateTopFrame(undefined)).toBeNull();
  });
});
