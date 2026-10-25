/**
 * ReadableStream als async-iterable, ook op Safari 26 en ouder.
 *
 * pdf.js (6.x) leest de tekstlaag van een pagina met `for await` over de
 * ReadableStream van streamTextContent(). Safari ondersteunt die iteratie pas
 * vanaf 27 (MDN, iOS volgt dezelfde lijn). Op iOS 26 en 18 gooit
 * getTextContent() daardoor op élke pagina "readableStream is not async
 * iterable", en vindt zoeken op dienstnummer nooit iets: dat was het beeld
 * achter de foutgroepen van 19 en 20-10 (alle drie Safari 26.6.1) en achter
 * "geen apart blad gevonden" op twee iPhones van 08-10 tot 13-10. De
 * pdf.js-maintainers sloten mozilla/pdf.js#20973 met precies deze
 * aanbeveling: de iterator zelf aanvullen. Op engines die hem al hebben
 * (Chrome, Firefox, Safari 27) doet dit niets.
 */
export function zorgVoorStreamIteratie(): boolean {
  if (typeof ReadableStream === 'undefined') return false;
  const proto = ReadableStream.prototype as unknown as Record<symbol, unknown>;
  if (typeof proto[Symbol.asyncIterator] === 'function') return false;
  proto[Symbol.asyncIterator] = async function* (this: ReadableStream<unknown>) {
    const reader = this.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  };
  return true;
}
