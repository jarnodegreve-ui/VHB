import { test, expect } from '@playwright/test';
import { PNG } from 'pngjs';
import { CHAUFFEUR, seed } from './helpers';

test('dock blijft opaak tijdens een schermwissel', async ({ page, browserName }) => {
  await seed(page, { user: CHAUFFEUR, view: 'rooster', thema: 'dark' });
  await page.goto('/rooster');
  const dock = page.getByRole('navigation', { name: 'Hoofdnavigatie', exact: true });
  await expect(dock).toBeVisible();
  await expect(dock.getByRole('button', { name: 'Rooster', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.evaluate(() => document.fonts.ready);

  // Houd de echte browserovergang halverwege vast. Zo vergelijken we wat
  // werkelijk getekend wordt, niet alleen de CSS van de verborgen DOM.
  const ondersteund = await page.evaluate(() => typeof document.startViewTransition === 'function');
  test.skip(!ondersteund, 'Deze browser heeft geen View Transitions.');
  await page.evaluate(() => {
    const start = document.startViewTransition.bind(document);
    document.startViewTransition = (update) => {
      const overgang = start(update);
      void overgang.ready.then(() => {
        let gepauzeerd = 0;
        for (const animatie of document.getAnimations()) {
          if ((animatie.effect as KeyframeEffect | null)?.pseudoElement?.startsWith('::view-transition')) {
            animatie.pause();
            animatie.currentTime = 110;
            gepauzeerd++;
          }
        }
        document.documentElement.dataset.dockTestPauze = String(gepauzeerd);
      });
      return overgang;
    };
  });
  await dock.getByRole('button', { name: 'Dashboard', exact: true }).tap();
  await expect(page.locator('html')).toHaveAttribute('data-dock-test-pauze', /^[1-9]\d*$/);
  await expect(page.locator('html')).toHaveClass(/vt-route/);
  await expect(dock.getByRole('button', { name: 'Dashboard', exact: true })).toHaveAttribute('aria-current', 'page');
  // WebKit neemt in screenshots de live nieuwe laag van fixed elementen
  // niet mee (ook gereproduceerd met los HTML, zonder React). Controleer
  // daar de echte laaginstellingen; Chromium bewaakt bovendien de pixels.
  const laag = await dock.evaluate(el => {
    const achtergrond = el.querySelector<HTMLElement>('[aria-current="page"] > span')!;
    const snapshot = getComputedStyle(document.documentElement, '::view-transition-new(dock)');
    return {
      naam: getComputedStyle(el).viewTransitionName,
      achtergrond: getComputedStyle(el).backgroundColor,
      animatie: snapshot.animationName,
      dekking: snapshot.opacity,
      selectieDekking: getComputedStyle(achtergrond).opacity,
    };
  });
  expect(laag.naam).toBe('dock');
  expect(laag.animatie).toBe('none');
  expect(laag.dekking).toBe('1');
  expect(laag.achtergrond).toMatch(/^rgb\(/); // het dock zelf is volledig dekkend
  expect(laag.selectieDekking).toBe('1');
  const box = await dock.getByRole('button', { name: 'Dashboard', exact: true }).boundingBox();
  expect(box).not.toBeNull();
  // De tik zelf laat een drukstand na: `.tikbaar:active` zet de knop op
  // surface-muted en laat die bij het loslaten in 150 ms uitdoven. In donker
  // is surface-muted doorschijnend, dus zolang dat uitdoven loopt ligt het
  // bovenop de pil en is het vlak 3 tinten lichter (36,38,41 i.p.v.
  // 33,35,38). Onder parallelle belasting viel de schermafdruk soms binnen
  // die 150 ms: dat is tikfeedback, geen doorschijnend dock. Omdat de stijl
  // tijdens de gepauzeerde overgang pas bij een meting herberekend wordt,
  // start dat uitdoven soms zelfs ná de tik-actie; wacht dus tot de knop
  // zelf weer zijn rustwaarde (doorzichtig) heeft. De view transition blijft
  // intussen gepauzeerd: die animaties hangen aan de pseudo-elementen van
  // <html>, niet aan de knop.
  await expect.poll(
    () => dock.getByRole('button', { name: 'Dashboard', exact: true }).evaluate((el) => getComputedStyle(el).backgroundColor),
    { message: 'drukstand van de tik is uitgedoofd' },
  ).toBe('rgba(0, 0, 0, 0)');
  const tijdens = browserName === 'chromium' ? PNG.sync.read(await page.screenshot({ clip: box! })) : null;
  await page.evaluate(() => {
    for (const animatie of document.getAnimations()) {
      if ((animatie.effect as KeyframeEffect | null)?.pseudoElement?.startsWith('::view-transition')) animatie.finish();
    }
  });
  await expect(page.locator('html')).not.toHaveClass(/vt-route/);
  await expect(dock.getByRole('button', { name: 'Dashboard', exact: true })).toHaveAttribute('aria-current', 'page');
  if (!tijdens) return;
  const klaar = PNG.sync.read(await page.screenshot({ clip: box! }));

  // De gekozen tab moet vanaf het begin zijn ingevulde achtergrond houden.
  // Meet naast het icoon/label: tekst heeft een eigen kleurovergang. Vóór de
  // fix was deze plek nog doorzichtig terwijl de los vastgelegde pil schoof.
  let afwijkend = 0;
  let gemeten = 0;
  const schaal = tijdens.width / box!.width;
  for (let y = Math.ceil(10 * schaal); y < Math.floor(24 * schaal); y++) {
    for (let x = Math.ceil(6 * schaal); x < Math.floor(12 * schaal); x++) {
      const i = (y * tijdens.width + x) * 4;
      if ([0, 1, 2].some((kanaal) => Math.abs(tijdens.data[i + kanaal] - klaar.data[i + kanaal]) > 2)) afwijkend++;
      gemeten++;
    }
  }
  expect(gemeten).toBeGreaterThan(0);
  if (afwijkend / gemeten >= 0.05) {
    await test.info().attach('dock-tijdens-overgang', { body: PNG.sync.write(tijdens), contentType: 'image/png' });
    await test.info().attach('dock-na-overgang', { body: PNG.sync.write(klaar), contentType: 'image/png' });
  }
  expect(afwijkend / gemeten, 'dock-achtergrond verandert tijdens de overgang').toBeLessThan(0.05);
});
