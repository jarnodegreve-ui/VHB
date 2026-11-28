import { test, expect, type Page, type Route } from '@playwright/test';
import { ADMIN, CHAUFFEUR, gaIntern, historiekOpgeruimd, kanScrollen, seed } from './helpers';

/**
 * De lagenstapel (polish P2a, regels Jarno 24-09; src/lib/lagen.ts).
 *
 * Eén sluitactie = één laag: Escape, de terugknop, het kruisje, de
 * achtergrond en Annuleren sluiten alleen de bovenste laag. Sluiten er
 * meerdere tegelijk ("Niet bewaren", verwijderen vanuit het paneel), dan
 * blijft er geen dode history-entry achter: één keer terug gaat daarna naar
 * het vorige scherm, niet naar dezelfde lijst.
 *
 * Elke flow opent het Dienstoverzicht vanuit het dashboard (interne vorige
 * pagina) en eindigt met: geen dialoog, geen scroll-lock, de pagina schuift,
 * de bovenste entry is weer een pagina, en één keer terug = het dashboard.
 */

const pad = (page: Page) => new URL(page.url()).pathname;
const paneel = (page: Page) => page.getByRole('dialog', { name: 'Dienst 2515', exact: true });
const vraag = (page: Page) => page.getByRole('dialog', { name: 'Wijzigingen niet bewaren?' });
const bevestiging = (page: Page) => page.getByRole('dialog', { name: 'Dienst 2515 verwijderen' });
const lijstKop = (page: Page) => page.getByRole('heading', { name: 'Dienstoverzicht', level: 1 });

/** Dashboard → Dienstoverzicht (intern) → dienst 2515 uit de lijst openen. */
async function openVanuitLijst(page: Page) {
  await seed(page, { user: ADMIN });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
  await gaIntern(page, '/beheer/dienstoverzicht');
  await expect(lijstKop(page)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Dienst 2515 openen' }).filter({ visible: true }).click();
  await expect(paneel(page)).toBeVisible();
  expect(pad(page)).toBe('/beheer/dienstoverzicht/3');
}

/** Alles dicht en schoon, en één keer terug = het dashboard (geen dode stap). */
async function schoonEnTerugNaarDashboard(page: Page) {
  await kanScrollen(page);
  await historiekOpgeruimd(page);
  expect(pad(page)).toBe('/beheer/dienstoverzicht');
  await page.goBack();
  await expect.poll(() => pad(page)).toBe('/');
  await expect(paneel(page)).toHaveCount(0);
}

/**
 * De tip-laag (src/lib/tipLaag.ts) laadt lui bij de eerste muisbeweging; in
 * deze flows is dat de klik die het paneel opent. Komt dat stuk op een trage
 * machine pas binnen als een venster al open of al weer dicht is, dan hoorde
 * de laag het openen niet en krijgt de knop onder de stille muis toch een tip,
 * die de volgende Escape slikt (gemeten 27-11: 13 van 600 onder belasting, in
 * elk daarvan startte de laag te laat). Een proef die naar Escape per laag
 * kijkt, wacht daarom eerst tot de tip-laag er is, zoals `laagGeladen` in
 * tooltip.spec.ts. Voor een gebruiker speelt dit alleen in de eerste
 * ogenblikken na het laden van de pagina.
 */
async function tipLaagGeladen(page: Page) {
  await expect(async () => {
    await page.mouse.move(2, 640);
    await page.mouse.move(4, 642);
    await expect(page.locator('[data-tip-laag]')).toBeAttached({ timeout: 500 });
  }).toPass({ timeout: 15_000 });
}

const maakVuil = (page: Page) => paneel(page).getByLabel('Loopnummer (deel 3)', { exact: true }).fill('9');

const serverAntwoord = (page: Page, status: number, body: unknown) => page.route('**/api/services', (r: Route) => (r.request().method() === 'POST'
  ? r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  : r.fallback()));

test.describe('onbewaarde invoer', () => {
  test('kruisje → Niet bewaren: vraag en paneel dicht, geen dode terugstap', async ({ page }) => {
    await openVanuitLijst(page);
    await maakVuil(page);
    await paneel(page).getByRole('button', { name: 'Sluiten', exact: true }).click();
    await page.getByRole('button', { name: 'Niet bewaren' }).click();
    await schoonEnTerugNaarDashboard(page);
  });

  test('terugknop → vraag, paneel blijft; Niet bewaren sluit; geen dode terugstap', async ({ page }) => {
    await openVanuitLijst(page);
    await maakVuil(page);
    await page.goBack();
    await expect(vraag(page)).toBeVisible();
    await expect(paneel(page)).toBeVisible();
    await expect(paneel(page).getByLabel('Loopnummer (deel 3)', { exact: true })).toHaveValue('9');
    expect(pad(page)).toBe('/beheer/dienstoverzicht/3');
    await page.getByRole('button', { name: 'Niet bewaren' }).click();
    await schoonEnTerugNaarDashboard(page);
  });

  test('Escape en achtergrond vragen eerst; Verder bewerken houdt alles', async ({ page }, info) => {
    // Op de telefoon vult het paneel de breedte: geen achtergrond om op te tikken.
    test.skip(info.project.name.startsWith('iPhone'), 'achtergrond alleen naast een smal paneel');
    await openVanuitLijst(page);
    await maakVuil(page);
    await page.keyboard.press('Escape');
    await expect(vraag(page)).toBeVisible();
    // Escape op de vraag = Verder bewerken: alleen de vraag gaat dicht.
    await page.keyboard.press('Escape');
    await expect(vraag(page)).toHaveCount(0);
    await expect(paneel(page)).toBeVisible();
    await expect(paneel(page).getByLabel('Loopnummer (deel 3)', { exact: true })).toHaveValue('9');
    await page.mouse.click(5, 300);
    await expect(vraag(page)).toBeVisible();
    await vraag(page).getByRole('button', { name: 'Verder bewerken' }).click();
    await expect(paneel(page)).toBeVisible();
    await paneel(page).getByRole('button', { name: 'Annuleren' }).click();
    await page.getByRole('button', { name: 'Niet bewaren' }).click();
    await schoonEnTerugNaarDashboard(page);
  });
});

test.describe('verwijderen vanuit het paneel', () => {
  test('gelukt: paneel en bevestiging dicht, de dienst weg, terug gaat naar het vorige scherm', async ({ page }) => {
    await openVanuitLijst(page);
    // Na seed: een later geregistreerde route wint van de fixture-mock.
    await serverAntwoord(page, 200, { ok: true });
    await paneel(page).getByRole('button', { name: 'Dienst 2515 verwijderen' }).click();
    await bevestiging(page).getByRole('button', { name: 'Verwijderen' }).click();
    await expect(page.getByRole('button', { name: 'Dienst 2515 openen' })).toHaveCount(0);
    await schoonEnTerugNaarDashboard(page);
  });

  test('mislukt: paneel blijft open met de reden, daarna gewoon sluiten', async ({ page }) => {
    await openVanuitLijst(page);
    await serverAntwoord(page, 403, { error: 'Diensten verwijderen is alleen beschikbaar voor admins.' });
    await paneel(page).getByRole('button', { name: 'Dienst 2515 verwijderen' }).click();
    await bevestiging(page).getByRole('button', { name: 'Verwijderen' }).click();
    await expect(page.getByText(/alleen beschikbaar voor admins/).first()).toBeVisible();
    await expect(bevestiging(page)).toHaveCount(0);
    await expect(paneel(page)).toBeVisible();
    expect(pad(page)).toBe('/beheer/dienstoverzicht/3');
    await page.keyboard.press('Escape');
    await schoonEnTerugNaarDashboard(page);
  });
});

test.describe('één laag tegelijk', () => {
  test('Escape: eerst de geschiedenis, dan het paneel', async ({ page }) => {
    await openVanuitLijst(page);
    await tipLaagGeladen(page);
    await paneel(page).getByRole('button', { name: 'Wijzigingsgeschiedenis' }).click();
    await expect(page.getByRole('dialog', { name: 'Wijzigingsgeschiedenis' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Wijzigingsgeschiedenis' })).toHaveCount(0);
    await expect(paneel(page)).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.body.dataset.scrollLocks ?? '')).toBe('slideover');
    await page.keyboard.press('Escape');
    await schoonEnTerugNaarDashboard(page);
  });

  test('bevestiging boven het paneel: Escape, achtergrond en terug sluiten alleen de bevestiging', async ({ page }) => {
    await openVanuitLijst(page);
    const open = async () => {
      await paneel(page).getByRole('button', { name: 'Dienst 2515 verwijderen' }).click();
      await expect(bevestiging(page)).toBeVisible();
    };
    const alleenBevestigingDicht = async () => {
      await expect(bevestiging(page)).toHaveCount(0);
      await expect(paneel(page)).toBeVisible();
      expect(pad(page)).toBe('/beheer/dienstoverzicht/3');
    };
    await open();
    await page.keyboard.press('Escape');
    await alleenBevestigingDicht();
    await open();
    await page.mouse.click(5, 5);
    await alleenBevestigingDicht();
    await open();
    await page.goBack();
    await alleenBevestigingDicht();
    // Daarna sluit terug het paneel en blijft de lijst.
    await page.goBack();
    await schoonEnTerugNaarDashboard(page);
  });
});

test.describe('meldingen', () => {
  test('het paneel sluit eerst (telefoon: terugknop; desktop: Escape), de pagina blijft', async ({ page }, info) => {
    await seed(page, { user: ADMIN });
    await page.goto('/');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 15_000 });
    await gaIntern(page, '/beheer/dienstoverzicht');
    await expect(lijstKop(page)).toBeVisible({ timeout: 15_000 });
    const bel = page.locator('header').getByRole('button', { name: /^Meldingen/ }).filter({ visible: true }).first();
    await bel.click();
    const menu = page.getByRole('menu', { name: 'Meldingen' });
    await expect(menu).toBeVisible();
    if (info.project.name.startsWith('iPhone')) await page.goBack();
    else await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    expect(pad(page)).toBe('/beheer/dienstoverzicht');
    await expect(lijstKop(page)).toBeVisible();
    await kanScrollen(page);
    await historiekOpgeruimd(page);
    await page.goBack();
    await expect.poll(() => pad(page)).toBe('/');
  });
});

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
  test(`de mobiele lade houdt een tweede tik tegen tot haar gebruikelijke sluitmoment (${reducedMotion})`, async ({ page }, info) => {
    test.skip(info.project.name === 'Desktop (chromium)', 'de lade sluit alleen op de telefoon');
    await page.emulateMedia({ reducedMotion });
    await seed(page, {
      user: CHAUFFEUR,
      view: 'meldingen',
      extra: (pad) => pad === '/api/meldingen' ? {
        meldingen: [{
          id: 'lade-tikproef', titel: 'Testmelding', tekst: 'Een melding voor de tikproef.',
          soort: 'planning', doel: 'rooster', createdAt: new Date().toISOString(),
        }],
        ongelezen: 1,
      } : undefined,
    });
    await page.goto('/meldingen');
    const verwijder = page.getByRole('button', { name: 'Melding verwijderen' });
    await expect(verwijder).toBeVisible();
    const vak = (await verwijder.boundingBox())!;
    const x = Math.round(vak.x + vak.width / 2);
    const y = Math.round(vak.y + vak.height / 2);
    await page.getByRole('button', { name: 'Meer', exact: true }).tap();
    const scrim = 'div.fixed.inset-0.z-zwevend.backdrop-blur-sm';
    await expect(page.locator(scrim)).toHaveCSS('opacity', '1');
    await page.evaluate(({ x, y, scrim }) => {
      if (!document.elementFromPoint(x, y)?.matches(scrim)) throw new Error('De achtergrond moet vóór het sluiten boven de wisknop liggen.');
      const w = window as Window & { ladeVrijNa?: Promise<number> };
      w.ladeVrijNa = new Promise((klaar) => {
        // Meet vanaf de echte sluitklik, ook als Playwright pas later naar
        // de volgende stap gaat. Een trage browser kan alleen later meten.
        document.addEventListener('click', () => {
          const start = performance.now();
          const meet = () => {
            const doel = document.elementFromPoint(x, y);
            if (doel?.closest('button[aria-label="Melding verwijderen"]')) klaar(performance.now() - start);
            else requestAnimationFrame(meet);
          };
          requestAnimationFrame(meet);
        }, { once: true, capture: true });
      });
    }, { x, y, scrim });
    await page.touchscreen.tap(x, y);
    const duur = await page.evaluate(() => (window as Window & { ladeVrijNa?: Promise<number> }).ladeVrijNa);
    expect(duur, 'de wisknop is pas na de bestaande klikafscherming bereikbaar').toBeGreaterThanOrEqual(300);
    await expect(verwijder).toBeVisible();
  });
}

test.describe('focus blijft in een sheet', () => {
  // P6 (24-09): Sheet had focus-naar-paneel maar geen Tab-trap, dus Tab liep
  // het sheet uit naar de pagina eronder (aria-modal belooft het tegendeel).
  test('Tab en Shift+Tab draaien rond binnen het sheet, Escape geeft de focus terug', async ({ page }) => {
    await seed(page, { user: ADMIN });
    await page.goto('/beheer/designsysteem');
    const knop = page.getByRole('button', { name: 'Sheet openen' });
    await knop.scrollIntoViewIfNeeded();
    await knop.focus();
    await page.keyboard.press('Enter');
    const sheet = page.getByRole('dialog').last();
    await expect(sheet).toBeVisible();
    const binnen = () => page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
    for (let i = 0; i < 8; i++) { await page.keyboard.press('Tab'); expect(await binnen(), `Tab ${i + 1}`).toBe(true); }
    for (let i = 0; i < 8; i++) { await page.keyboard.press('Shift+Tab'); expect(await binnen(), `Shift+Tab ${i + 1}`).toBe(true); }
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(knop).toBeFocused();
  });
});

test.describe('focus terug na Escape', () => {
  // a11y-rest (24-09): een kiezer of menu dat met Escape sluit zet de focus
  // terug op de knop die het opende, anders valt de toetsenbordgebruiker
  // terug op <body>.
  test('DatePicker: Escape geeft de focus terug aan de kalenderknop', async ({ page }) => {
    await seed(page, { user: ADMIN });
    await page.goto('/beheer/designsysteem');
    const knop = page.getByLabel('Startdatum', { exact: true }).locator('xpath=..').getByRole('button', { name: 'Kalender openen' });
    await knop.scrollIntoViewIfNeeded();
    await knop.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(knop).toBeFocused();
  });

  test('accountmenu: Escape geeft de focus terug aan de knop Account', async ({ page }) => {
    await seed(page, { user: ADMIN });
    await page.goto('/beheer/designsysteem');
    const knop = page.getByRole('button', { name: 'Account', exact: true });
    await knop.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('menu', { name: 'Account' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu', { name: 'Account' })).toHaveCount(0);
    await expect(knop).toBeFocused();
  });
});

test.describe('installatiekaart (Android/Chrome)', () => {
  // Simulatorronde 11-11: de kaart "Voeg toe aan beginscherm" lag als toast
  // boven elk venster, bij "Verlof aanvragen" over de datumvelden.
  test('ligt onder een open venster en is er weer als het sluit', async ({ page }, info) => {
    test.skip(info.project.name.includes('webkit'), 'beforeinstallprompt bestaat alleen in Chromium');
    await seed(page, { user: ADMIN });
    await page.goto('/verlof');
    await expect(page.getByRole('heading', { name: 'Verlof', level: 1 })).toBeVisible({ timeout: 15_000 });
    // Het echte event komt van de browser; de app leest alleen prompt() en userChoice.
    await page.evaluate(() => {
      const e = new Event('beforeinstallprompt') as Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
      e.prompt = async () => {};
      e.userChoice = new Promise(() => {});
      window.dispatchEvent(e);
    });
    const kaart = page.getByText('Voeg toe aan beginscherm');
    await expect(kaart).toBeVisible();
    /** Ligt de kaart bovenaan op haar eigen plek? */
    const bovenaan = () => kaart.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!top && (top === el || el.contains(top) || top.contains(el));
    });
    await expect.poll(bovenaan).toBe(true);
    await page.getByRole('button', { name: 'Verlof registreren' }).click();
    const venster = page.getByRole('dialog');
    await expect(venster).toBeVisible();
    // Het venster (met zijn scrim) ligt over de kaart: een tik op die plek raakt de kaart niet.
    await expect.poll(() => kaart.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return !!top && !el.contains(top) && !!top.closest('[role="dialog"], [data-scrim], .glass-modal, [aria-modal="true"]') ;
    })).toBe(true);
    await page.keyboard.press('Escape');
    await expect(venster).toHaveCount(0);
    await expect.poll(bovenaan).toBe(true);
  });
});

test.describe('toast: van onder op de telefoon, weg in de richting van de veeg', () => {
  // Ronde 6, punt 5. Een logboek in de pagina noteert de inline transform die
  // motion zet op het moment dat een toast in de DOM komt (de beginstand) en
  // op het moment dat ze eruit gaat (de eindstand van de uitgang). Zo hangt
  // de toets niet af van frames of van hoe druk de machine is.
  type Regel = { soort: 'in' | 'uit'; transform: string; opacity: string };
  const toast = (page: Page) => page.locator('[aria-live="polite"].z-toast > [role="status"]');
  const logboek = (page: Page) => page.evaluate(() => (window as unknown as { __toasts: Regel[] }).__toasts);
  const ty = (t: string) => Number(/translateY\((-?[\d.]+)px\)/.exec(t)?.[1] ?? 0);
  const tx = (t: string) => Number(/translateX\((-?[\d.]+)px\)/.exec(t)?.[1] ?? 0);

  async function designsysteemMetLogboek(page: Page) {
    await seed(page, { user: ADMIN });
    await page.goto('/beheer/designsysteem');
    await expect(page.getByRole('button', { name: 'Succes', exact: true })).toBeVisible({ timeout: 15_000 });
    await page.evaluate(() => {
      const w = window as unknown as { __toasts: Regel[] };
      w.__toasts = [];
      const isToast = (n: Node): n is HTMLElement => n instanceof HTMLElement && n.getAttribute('role') === 'status';
      new MutationObserver((lijst) => {
        for (const m of lijst) {
          if (!(m.target instanceof HTMLElement) || !m.target.classList.contains('z-toast')) continue;
          m.addedNodes.forEach((n) => { if (isToast(n)) w.__toasts.push({ soort: 'in', transform: n.style.transform, opacity: n.style.opacity }); });
          m.removedNodes.forEach((n) => { if (isToast(n)) w.__toasts.push({ soort: 'uit', transform: n.style.transform, opacity: n.style.opacity }); });
        }
      }).observe(document.body, { childList: true, subtree: true });
    });
  }

  /** Een nieuwe toast, in rust (motion zet de transform dan op none). */
  async function nieuweToast(page: Page) {
    await page.getByRole('button', { name: 'Succes', exact: true }).click();
    await expect(toast(page)).toHaveCount(1);
    await expect.poll(() => toast(page).evaluate((el) => (el as HTMLElement).style.transform || 'none')).toBe('none');
  }

  test('komt op de telefoon van onder en gaat naar onder, vanaf 768 px van boven', async ({ page }) => {
    await designsysteemMetLogboek(page);
    const y = (page.viewportSize()?.width ?? 0) >= 768 ? -8 : 8;
    await nieuweToast(page);
    await toast(page).getByRole('button', { name: 'Sluit melding' }).click();
    await expect(toast(page)).toHaveCount(0);
    const log = await logboek(page);
    expect(log.map((r) => r.soort)).toEqual(['in', 'uit']);
    expect(ty(log[0].transform)).toBe(y);
    expect(ty(log[1].transform)).toBe(y);
    expect(tx(log[1].transform)).toBe(0);
    expect(log[1].opacity).toBe('0');
  });

  test('weggeveegd naar rechts of links gaat ze in die richting tot buiten de rand', async ({ page }, info) => {
    // Gemeten 14-11: in WebKit met aanraakemulatie komt page.mouse niet als
    // sleep bij motion aan (de toast blijft staan tot haar tijd om is).
    test.skip(info.project.name.includes('webkit'), 'page.mouse sleept niet in WebKit met aanraakemulatie');
    await designsysteemMetLogboek(page);
    const breedte = page.viewportSize()!.width;
    for (const richting of [1, -1]) {
      await nieuweToast(page);
      const box = (await toast(page).boundingBox())!;
      const x = box.x + box.width / 2;
      const y = box.y + box.height / 2;
      // page.mouse: daarop reageert de sleep van motion (pointer events).
      await page.mouse.move(x, y);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) await page.mouse.move(x + richting * 20 * i, y);
      await page.mouse.up();
      await expect(toast(page)).toHaveCount(0);
      const uit = (await logboek(page)).filter((r) => r.soort === 'uit').at(-1)!;
      // Een schermbreedte verder: de linkerrand voorbij de rechterrand van het
      // scherm (of andersom), vervaagd. Op main vervaagde ze op haar plek.
      expect(tx(uit.transform)).toBe(richting * breedte);
      expect(ty(uit.transform)).toBe(0);
      expect(uit.opacity).toBe('0');
    }
  });

  test('een weggeveegde melding vangt de tik op, haar actie is al onbedienbaar', async ({ page }, info) => {
    test.skip(info.project.name.includes('webkit'), 'page.mouse sleept niet in WebKit met aanraakemulatie');
    await designsysteemMetLogboek(page);
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('vhb-toast', {
      detail: { message: 'Proefmelding', action: { label: 'Testactie', run: () => {} }, opties: { ongedaan: true } },
    })));
    const melding = toast(page).filter({ hasText: 'Proefmelding' });
    const actie = melding.getByRole('button', { name: 'Testactie' });
    await actie.focus();
    await expect(actie).toBeFocused();
    await expect.poll(() => melding.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
    const vak = (await melding.boundingBox())!;

    // Lees het hitgebied van de actie terwijl ze beweegt. De veeg zelf loopt
    // 160 px, met weerstand blijft de toast daarbij onder 120 px verplaatsing.
    // Een meting daar voorbij valt dus tijdens de uitgang, niet tijdens slepen.
    await melding.evaluate((el) => {
      const knop = [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Testactie')!;
      const w = window as unknown as { __toastUitKlik?: { onbedienbaar: boolean; vangtKlik: boolean } };
      const meet = () => {
        if (!el.isConnected) return;
        const transform = getComputedStyle(el).transform;
        const x = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m41;
        const r = knop.getBoundingClientRect();
        const px = r.left + r.width / 2;
        if (x < -120 && px > 0 && px < window.innerWidth) {
          const geraakt = document.elementFromPoint(px, r.top + r.height / 2);
          knop.focus();
          w.__toastUitKlik = {
            onbedienbaar: !!knop.closest('[inert]') && document.activeElement !== knop,
            vangtKlik: geraakt === el,
          };
          return;
        }
        requestAnimationFrame(meet);
      };
      window.addEventListener('pointerup', () => requestAnimationFrame(meet), { capture: true, once: true });
    });

    const x = vak.x + vak.width / 2;
    const y = vak.y + vak.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(x - i * 20, y);
    await page.mouse.up();
    await expect(melding).toHaveCount(0);
    expect(await page.evaluate(() => (window as unknown as { __toastUitKlik?: unknown }).__toastUitKlik))
      .toEqual({ onbedienbaar: true, vangtKlik: true });
  });
});
