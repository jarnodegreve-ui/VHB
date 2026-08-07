import { test, expect, type Page } from '@playwright/test';

/**
 * Verlopen sessie: de app mag geen salvo rode toasts tonen (elk mislukt
 * verzoek had er één) en het inlogscherm moet uitleggen waaróm je er staat.
 * Zelfde opzet als de andere e2e-specs: sessie in localStorage, /api
 * onderschept.
 */

const SESSION_KEY = 'sb-localhost-auth-token';

const seedSession = async (page: Page) => {
  await page.addInitScript((key) => {
    const inAnHour = Math.floor(Date.now() / 1000) + 3600;
    window.localStorage.setItem(key as string, JSON.stringify({
      access_token: 'e2e-access-token',
      refresh_token: 'e2e-refresh-token',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: inAnHour,
      user: { id: 'auth-e2e', email: 'test@vhb.be', aud: 'authenticated' },
    }));
  }, SESSION_KEY);
};

test('verlopen sessie: één uitleg op het inlogscherm, geen stapel fout-toasts', async ({ page }) => {
  await seedSession(page);

  // Alles wat de app ophaalt geeft 401 — precies het scenario waarin vijf
  // laadfouten tegelijk binnenkwamen. Ook de token-refresh faalt, zodat de
  // app doorschakelt naar opnieuw inloggen.
  await page.route('**/api/**', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'Sessie verlopen' }) }),
  );
  await page.route('**/auth/v1/**', (route) =>
    route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'invalid refresh token' }) }),
  );

  await page.goto('/');

  // Het inlogscherm legt uit waarom je hier staat.
  await expect(page.getByText(/sessie is verlopen omdat je een tijdje weg was/i)).toBeVisible({ timeout: 15_000 });

  // En er staat geen muur van rode meldingen: de losse "Kon … niet laden"
  // toasts zijn onderdrukt zolang de sessie wordt afgesloten.
  await expect(page.getByText(/Kon de .* niet laden/)).toHaveCount(0);
});
