import { afterEach, describe, expect, it } from 'vitest';
import { zorgVoorStreamIteratie } from './streamIteratie';

const sleutel = Symbol.asyncIterator;
const proto = ReadableStream.prototype as unknown as Record<symbol, unknown>;
const origineel = Object.getOwnPropertyDescriptor(ReadableStream.prototype, sleutel);

const stroom = () => new ReadableStream<number>({
  start(c) { c.enqueue(1); c.enqueue(2); c.enqueue(3); c.close(); },
});

const verzamel = async (s: ReadableStream<number>) => {
  const uit: number[] = [];
  // De tsconfig-lib kent de async-iteratie van ReadableStream niet (Safari 27+, Chrome 124+);
  // het test-doel is net de runtime-vorm, dus hier een cast.
  for await (const v of s as unknown as AsyncIterable<number>) uit.push(v);
  return uit;
};

afterEach(() => {
  if (origineel) Object.defineProperty(ReadableStream.prototype, sleutel, origineel);
  else delete proto[sleutel];
});

describe('zorgVoorStreamIteratie (Safari 26 en ouder)', () => {
  it('vult de async-iterator aan als de engine hem mist, en for await werkt dan', async () => {
    delete proto[sleutel];
    expect(typeof proto[sleutel]).toBe('undefined');
    // Zonder iterator klapt for await, zoals pdf.js getTextContent() op iOS 26.
    await expect(verzamel(stroom())).rejects.toThrow();
    expect(zorgVoorStreamIteratie()).toBe(true);
    await expect(verzamel(stroom())).resolves.toEqual([1, 2, 3]);
  });

  it('laat de lezer los na de iteratie, zodat de stroom opnieuw te lezen is', async () => {
    delete proto[sleutel];
    zorgVoorStreamIteratie();
    const s = stroom();
    await expect(verzamel(s)).resolves.toEqual([1, 2, 3]);
    expect(s.locked).toBe(false);
  });

  it('doet niets op een engine die de iterator al heeft', () => {
    const voor = proto[sleutel];
    expect(typeof voor).toBe('function');
    expect(zorgVoorStreamIteratie()).toBe(false);
    expect(proto[sleutel]).toBe(voor);
  });
});
