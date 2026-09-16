import { test, expect, type Locator, type Page } from '@playwright/test';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { CHAUFFEUR, seed } from './helpers';

const PDF_PAD = '/__test__/ritblad-zoom.pdf';
const PDF_BREEDTE = 595;
const PDF_HOOGTE = 842;

async function openRitblad(page: Page, baseURL: string) {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const blad = pdf.addPage([PDF_BREEDTE, PDF_HOOGTE]);
  blad.drawText('Ritblad dienst 2101', { x: 40, y: 780, size: 18, font });
  blad.drawText('Garage - Station - Markt', { x: 40, y: 745, size: 12, font });
  blad.drawLine({ start: { x: 40, y: 730 }, end: { x: 555, y: 730 }, thickness: 1 });
  const bytes = Buffer.from(await pdf.save());
  await page.route(`**${PDF_PAD}`, (route) => route.fulfill({ contentType: 'application/pdf', body: bytes }));
  await seed(page, {
    user: CHAUFFEUR, view: 'ritblaadjes', thema: 'dark',
    extra: (pad) => pad.endsWith('/api/ritblaadje') ? {
      url: new URL(PDF_PAD, baseURL).href,
      filename: 'ritblad-zoom.pdf', uploadedAt: '2026-09-16T08:00:00Z',
    } : undefined,
  });
  await page.goto('/ritbladen');
  await page.getByRole('textbox', { name: 'Dienstnummer', exact: true }).fill('2101');
  await page.getByRole('button', { name: 'Ritblad openen', exact: true }).click();
  const dialoog = page.getByRole('dialog', { name: 'Ritblad · dienst 2101', exact: true });
  const canvas = dialoog.getByRole('img', { name: 'Pagina 1 van de ritblad-bundel' });
  await expect(canvas).toBeVisible({ timeout: 15_000 });
  // De echte pdfjs-render is klaar: PDF-papier is opaak, een nieuw canvas transparant.
  await expect.poll(() => canvas.evaluate((el: HTMLCanvasElement) => el.getContext('2d')!.getImageData(10, 10, 1, 1).data[3])).toBe(255);
  await page.evaluate(() => document.fonts.ready);
  return { dialoog, canvas };
}

async function canvasBlijftStil(canvas: Locator) {
  const afmetingen = await canvas.evaluate(async (el) => {
    const metingen: string[] = [];
    // Een lange reeks frames bewaakt ook een afwisselend brede/smalle render.
    for (let i = 0; i < 45; i++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const rect = el.getBoundingClientRect();
      metingen.push(`${rect.width}×${rect.height}`);
    }
    return [...new Set(metingen)];
  });
  expect(afmetingen, 'het ritblad verandert zonder invoer niet steeds van formaat').toHaveLength(1);
}

// Headless Chromium verbergt anders de scrollbars, inclusief hun breedte.
test.use({ contextOptions: { reducedMotion: 'reduce' }, launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

test('ritblad: blijft stil na zoeken, handmatig zoomen en vensterverkleining', async ({ page, baseURL }) => {
  const { dialoog, canvas } = await openRitblad(page, baseURL!);
  await canvasBlijftStil(canvas);
  const beginBreedte = await canvas.evaluate((el) => el.getBoundingClientRect().width);

  await dialoog.getByRole('button', { name: 'Inzoomen', exact: true }).click();
  await expect(dialoog.getByText('150 %', { exact: true })).toBeVisible();
  await expect.poll(() => canvas.evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(beginBreedte * 1.4);
  await canvasBlijftStil(canvas);
  const ingezoomd = await canvas.evaluate((el) => el.getBoundingClientRect().width);
  expect(await canvas.evaluate((el) => {
    const scroller = el.parentElement!.parentElement!;
    scroller.scrollLeft = 40;
    return scroller.scrollLeft;
  }), 'een ingezoomde pagina kan horizontaal worden verschoven').toBeGreaterThan(0);

  const viewport = page.viewportSize()!;
  await page.setViewportSize({ width: Math.min(viewport.width - 40, 600), height: viewport.height });
  await expect.poll(() => canvas.evaluate((el) => el.getBoundingClientRect().width)).toBeLessThan(ingezoomd);
  await canvasBlijftStil(canvas);
  const verkleind = await canvas.evaluate((el) => el.getBoundingClientRect().width);
  await dialoog.getByRole('button', { name: 'Uitzoomen', exact: true }).click();
  await expect(dialoog.getByText('100 %', { exact: true })).toBeVisible();
  await expect.poll(() => canvas.evaluate((el) => el.getBoundingClientRect().width)).toBeLessThan(verkleind / 1.4);
  await canvasBlijftStil(canvas);
  await expect(dialoog.getByRole('button', { name: 'Sluiten', exact: true })).toBeInViewport({ ratio: 1 });
  await dialoog.getByRole('button', { name: 'Sluiten', exact: true }).click();
  await expect(dialoog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ritblad openen', exact: true })).toBeEnabled();
});

test('ritblad: blijft stabiel op de grens waar een klassieke scrollbar nodig wordt', async ({ browser, baseURL }) => {
  const context = await browser.newContext({
    baseURL, viewport: { width: 900, height: 900 }, deviceScaleFactor: 1,
    isMobile: false, hasTouch: false, reducedMotion: 'reduce', serviceWorkers: 'block',
  });
  const page = await context.newPage();
  try {
    // Een klassieke, ruimte innemende scrollbar, ook op een Mac met overlay-scrollbars.
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const style = document.createElement('style');
        style.textContent = '[role="dialog"] * { scrollbar-width: auto !important; scrollbar-color: auto !important; } [role="dialog"] ::-webkit-scrollbar { width: 16px; height: 16px; }';
        document.head.append(style);
      });
    });
    const { canvas, dialoog } = await openRitblad(page, baseURL!);
    const maat = await canvas.evaluate((el) => {
      const scroller = el.parentElement!.parentElement!;
      const stijl = getComputedStyle(el.parentElement!);
      return {
        breedte: el.getBoundingClientRect().width,
        hoogte: scroller.clientHeight,
        gutter: scroller.offsetWidth - scroller.clientWidth,
        scrollHoogte: scroller.scrollHeight,
        scrollBreedte: scroller.clientWidth,
        padding: parseFloat(stijl.paddingTop) + parseFloat(stijl.paddingBottom),
      };
    });
    expect(maat.gutter, `de regressie gebruikt echt een scrollbar die breedte inneemt: ${JSON.stringify(maat)}`).toBeGreaterThan(0);
    // Bij deze hoogte past de PDF mét versmalling, maar niet zonder. Met
    // overflow:auto wisselen clientWidth en canvasgrootte daardoor telkens.
    const grensHoogte = (maat.breedte + maat.gutter / 2) * PDF_HOOGTE / PDF_BREEDTE + maat.padding;
    const vensterHoogte = Math.round(900 + (grensHoogte - maat.hoogte) / 0.88);
    await page.setViewportSize({ width: 900, height: vensterHoogte });
    await canvasBlijftStil(canvas);
    await expect(dialoog.getByText('100 %', { exact: true })).toBeVisible();
    const beginBreedte = await canvas.evaluate((el) => el.getBoundingClientRect().width);
    await dialoog.getByRole('button', { name: 'Inzoomen', exact: true }).click();
    await expect(dialoog.getByText('150 %', { exact: true })).toBeVisible();
    await expect.poll(() => canvas.evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(beginBreedte * 1.4);
    await canvasBlijftStil(canvas);
    await dialoog.getByRole('button', { name: 'Sluiten', exact: true }).click();
    await expect(dialoog).toHaveCount(0);
  } finally {
    await context.close();
  }
});
