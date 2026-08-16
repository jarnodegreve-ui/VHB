import { SourceMapConsumer } from "source-map-js";

/**
 * Vertaalt geminifieerde client-stacks ("assets/index-Ab12Cd.js:1:23456")
 * terug naar bronposities ("src/views/DashboardView.tsx:142") voor de
 * foutendigest. De sourcemaps staan naast de bundels op de deploy zelf
 * (vite build.sourcemap) — we fetchen ze on demand en cachen per
 * lambda-instantie. Alles is best-effort: lukt het niet, dan valt de digest
 * gewoon terug op de rauwe melding.
 */

const FRAME_RE = /(https?:\/\/[^\s)]+\/assets\/[^\s):]+\.js):(\d+):(\d+)/g;
const MAX_MAP_BYTES = 15 * 1024 * 1024; // ruim boven onze grootste bundel-map

/** SSRF-slot: de stack komt van een ongeauthenticeerde client (POST
 *  /api/client-errors) en werd hier server-side gefetcht — zonder deze check
 *  was elke `https://<wat-dan-ook>/assets/x.js:1:1` in een stack een blinde
 *  outbound-fetch-primitive (incl. interne hosts) vanuit de digest-cron.
 *  Alleen onze eigen deploy-hosts, alleen https, en géén redirects volgen
 *  (zelfde regel als api/ocpi.ts). */
const eigenDeployHost = (jsUrl: string): boolean => {
  try {
    const u = new URL(jsUrl);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    if (host === "vhbportaal.com" || host === "www.vhbportaal.com") return true;
    // Eigen Vercel-previews; VERCEL_URL dekt de actuele deployment exact.
    const vercelUrl = String(process.env.VERCEL_URL ?? "").toLowerCase();
    if (vercelUrl && host === vercelUrl) return true;
    // Anker op de team-slug (zelfde vorm als de CORS-allowlist): een los
    // `startsWith("vhb-portaal")` liet ook een door een aanvaller zelf
    // gedeployde `vhb-portaal-xyz.vercel.app` passeren — die mist het
    // `-jarnodegreve-uis-projects`-segment en wordt nu geweigerd.
    return /^vhb-[a-z0-9-]+-jarnodegreve-uis-projects\.vercel\.app$/.test(host);
  } catch {
    return false;
  }
};

// Cache per warme lambda: dezelfde digest-run raakt vaak dezelfde bundel.
const consumerCache = new Map<string, SourceMapConsumer | null>();

const loadConsumer = async (jsUrl: string): Promise<SourceMapConsumer | null> => {
  if (consumerCache.has(jsUrl)) return consumerCache.get(jsUrl) ?? null;
  let consumer: SourceMapConsumer | null = null;
  try {
    if (!eigenDeployHost(jsUrl)) {
      consumerCache.set(jsUrl, null);
      return null;
    }
    const res = await fetch(`${jsUrl}.map`, { signal: AbortSignal.timeout(4000), redirect: "manual" });
    if (res.ok) {
      const text = await res.text();
      if (text.length <= MAX_MAP_BYTES) {
        consumer = new SourceMapConsumer(JSON.parse(text));
      }
    }
  } catch {
    // map ontbreekt (oude deploy) of timeout — cache de miss, niet blijven proberen
  }
  consumerCache.set(jsUrl, consumer);
  return consumer;
};

/** "vite:///src/views/X.tsx" of "../../src/views/X.tsx" → "src/views/X.tsx". */
const cleanSource = (source: string): string => {
  const idx = source.lastIndexOf("src/");
  return idx >= 0 ? source.slice(idx) : source.replace(/^.*:\/\//, "").replace(/^\.\.?\//, "");
};

/**
 * Eerste herleidbare frame uit een stack → "src/bestand.tsx:regel" (+ eventueel
 * functienaam). null als er niets te herleiden valt.
 */
export const symbolicateTopFrame = async (stack: string | undefined | null): Promise<string | null> => {
  if (!stack) return null;
  const frames = [...stack.matchAll(FRAME_RE)].slice(0, 6);
  for (const m of frames) {
    const [, jsUrl, line, column] = m;
    const consumer = await loadConsumer(jsUrl);
    if (!consumer) continue;
    try {
      const pos = consumer.originalPositionFor({ line: Number(line), column: Number(column) });
      if (pos.source && pos.line) {
        const fn = pos.name ? ` (${pos.name})` : "";
        return `${cleanSource(pos.source)}:${pos.line}${fn}`;
      }
    } catch {
      // corrupte map — probeer het volgende frame
    }
  }
  return null;
};

/** Alleen voor tests: cache leegmaken zodat elke test verse fetches ziet. */
export const clearSymbolicateCache = () => consumerCache.clear();
