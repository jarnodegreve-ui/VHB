import { expect, type Page, type Request } from '@playwright/test';
import { ADMIN, CHAUFFEUR, USERS, seedPagina } from '../scripts/audit-fixtures.mjs';

/**
 * Dunne TS-laag over de gedeelde fixtures (scripts/audit-fixtures.mjs), voor
 * specs die een compleet ingelogd scherm nodig hebben (desktop, a11y). De
 * oudere flow-specs houden hun eigen, kleinere fixtures — die testen één
 * schrijfpad en willen precies weten wat er in de POST zit.
 */
export { ADMIN, CHAUFFEUR, USERS };

export type Fixture = Record<string, unknown>;
export type Extra = (pad: string, request: Request) => unknown;

/** Sessie + api-mocks; `extra` overschrijft één of meer collecties. */
export async function seed(page: Page, opties: { user: Fixture; view?: string; thema?: 'light' | 'dark'; extra?: Extra }) {
  await seedPagina(page, opties);
}

/**
 * Na elke overlay-flow (hotfix 24-09, polish P2a): geen dialoog meer open,
 * geen actieve scroll-lock (`body[data-scroll-locks]` leeg), geen inline
 * overflow op body of scroll-root, en de scroll-root schuift echt.
 */
export async function kanScrollen(page: Page) {
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => {
    const root = document.querySelector<HTMLElement>('[data-scroll-root]');
    return {
      locks: document.body.dataset.scrollLocks ?? '',
      body: document.body.style.overflow,
      root: root?.style.overflow ?? 'geen root',
    };
  })).toEqual({ locks: '', body: '', root: '' });
  const schuift = await page.evaluate(async () => {
    const root = document.querySelector<HTMLElement>('[data-scroll-root]')!;
    const extra = document.createElement('div');
    extra.style.height = '3000px';
    root.appendChild(extra);
    root.scrollTop = 0;
    root.scrollBy(0, 400);
    await new Promise((r) => setTimeout(r, 50));
    const ok = root.scrollTop > 0;
    extra.remove();
    return ok;
  });
  expect(schuift, 'de scroll-root schuift weer').toBe(true);
}

/** De bovenste history-entry is weer een pagina, geen (verweesde) overlay-entry. */
export const historiekOpgeruimd = (page: Page) => expect.poll(
  () => page.evaluate(() => window.history.state?.vhbOverlay ?? null),
).toBeNull();

/** Navigeren binnen de app (pushState + popstate, zoals een tik in het menu),
 *  zodat er een interne vorige pagina is zonder de app te herladen. */
export async function gaIntern(page: Page, pad: string) {
  await page.evaluate((p) => { history.pushState(null, '', p); dispatchEvent(new PopStateEvent('popstate')); }, pad);
}
