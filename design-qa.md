# Design QA — lege schermen en meldingen

## Comparison target and evidence

- Source visual truth: `/Users/jarnodegreve/.codex/generated_images/01a0a9ca-3493-7222-8d92-35d800d05abc/exec-788f0512-1d04-42af-83e9-fbf97053add4.png` (1525 × 1031 pixels).
- Implementation: `http://localhost:4196/beheer/designsysteem#illustraties`, using local fixture data.
- Final desktop screenshot: `/Users/jarnodegreve/VHB/output/statusontwerp/desktop-dark.png` (1600 × 1080 pixels and CSS viewport).
- Additional evidence in the same output directory: `desktop-light.png` (1600 × 1080), `tablet-dark.png` (768 × 1024), `mobile-dark.png` and `mobile-light.png` (320 × 800), and `gele-boek-error.png` (1280 × 720).
- Density: implementation captures are 1 pixel per CSS pixel; no density resampling used. Source is a standalone design board with no specified CSS viewport. Compare the component region and hierarchy, not the existing portal navigation or the source board's larger presentation typography.
- State: empty, success, error, no search results, and full/compact retry states. Desktop dark matches the source theme; light mode and smaller widths are additional resilience checks.
- Full-view evidence: source image and final desktop capture were opened together in one comparison input. All five symbols, three cards and two compact rows are readable. Separate cropped comparisons were unnecessary; mobile captures additionally show the text wrapping and compact action at readable scale.

## Findings and comparison history

1. **Resolved P2 — illustration strokes too heavy.** The portal's global Lucide rule overrode the icon stroke attribute. Explicit `stroke-[0.75]` on illustration components restores the thin-line direction. Compact symbols use `stroke-[1.5]` at 32 pixels for legibility. The final desktop captures confirm the lighter contour.
2. **Resolved P2 — compact retry label wrapped at 320 pixels.** The original action occupied only the text column. It now spans the compact card's two columns below the message, returning to the right at a 28rem container width. Final mobile dark/light captures show the complete label on one line with no horizontal overflow.
3. **Accepted P3 — illustration contour detail differs from the generated board.** Existing Lucide icons provide the same semantic subjects and a consistent two-tone line style. They are simpler than the generated paper/tray and document/alert composites. No handmade SVG substitutes or rasterized UI were introduced. This is an adaptation to the portal's existing icon family, not a claim of pixel-identical illustration reproduction.

No actionable P0/P1/P2 findings remain.

## Required fidelity surfaces

- **Fonts and typography:** existing Manrope heading and Inter body roles retained. Card titles use the established 17px role; descriptions use 13px body text. The standalone source board has larger presentation text. Hierarchy and left alignment are preserved within the portal's established scale. No truncated labels, cramped line heights or fallback-font problem observed.
- **Spacing and layout:** three aligned desktop cards, consistent icon area and padding, followed by two compact rows. Tablet/mobile stack the cards. The compact action relocates below the text when needed. At 320, 768 and 1600 pixels document width equals viewport width. Existing portal shell and section surface are intentional context differences from the standalone board.
- **Colors and tokens:** dark neutral surfaces, subtle borders, gold primary action, green completion and red error accents use existing theme tokens. Light/dark captures remain legible. The restrained status colors are less saturated than the concept art, consistent with other portal controls.
- **Image quality and assets:** sharp library vector icons at 80px in the gallery, 64px in full cards and 32px in compact rows. No raster compression, halos or masking artifacts. Existing brand logo remains unchanged. Minor contour differences are classified above.
- **Copy and content:** all visible examples stand alone; error title is exactly “De gele boek kon niet laden”. Related live copy now uses “de gele boek”. The design tab contains working examples and human-readable labels.
- **Accessibility and behavior:** decorative illustrations are hidden from assistive technology; error alerts, native buttons and descriptive labels are retained. Retry buttons become disabled with `aria-busy` during the promise and recover afterward. No new motion introduced; shared button focus behavior remains. Manual screen-reader and browser text-zoom audits were not performed.

## Interaction and technical checks

- Full and compact retry controls: observed busy/disabled state and enabled recovery.
- Real Gele boek route with a simulated 503: correct title/description and retry returning to the loading state.
- Real Omleidingen route with an empty fixture: empty view, a search returning “Geen resultaten”, and “Wis filters” restoring “Geen omleidingen”.
- Console errors checked on the final verification tab: none. A service-worker warning is expected because the fixture server deliberately returns 404 for `sw.js`. Earlier preview-only analytics script errors were resolved in the temporary fixture server. No production backend was used.
- `npm run lint`, `npm run lint:strict`, `npm run lint:design`: passed.
- Production build with local dummy environment: passed.
- Bundle size check: passed (total gzip 572kB, below 600kB limit).
- `git diff --check`: passed.

## Open questions and follow-up polish

- No blocking questions. A bespoke illustration asset set could reproduce the generated contours more closely, but is not needed for the approved semantic design direction.
- Validation is local with fixtures; no production deployment was performed.

## Implementation checklist

- [x] Update shared empty/error components and all illustration exports.
- [x] Update the design tab with the same components.
- [x] Use “de gele boek” in current related UI copy.
- [x] Verify full/compact interactions and desktop/tablet/mobile layouts.
- [x] Compare final rendering with the corrected design reference.

final result: passed
