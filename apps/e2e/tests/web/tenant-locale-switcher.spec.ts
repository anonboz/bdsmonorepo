import { expect, test } from '@playwright/test';

/**
 * Phase 11.3 — happy-path coverage for the locale switcher on the
 * tenant PWA's login page (the pre-auth surface). Verifies:
 *
 *  - With no `bds-locale` cookie, the default locale is Vietnamese
 *    (per the `vi` default in `@repo/i18n`).
 *  - Flipping the switcher to English re-renders the page in English.
 *  - The cookie persists across navigation (refresh keeps English).
 *
 * Browser-only — runs under the `tenant-web` project. Authenticated
 * surfaces (`/me` switcher with `onSave`) ship coverage in 11.3b or a
 * follow-up that also exercises `PATCH /v1/me`.
 */
test.describe('tenant locale switcher', () => {
  test('defaults to vi, flips to en, and persists', async ({ context, page }) => {
    // Start from a clean cookie jar so the default-detection path
    // is what's under test (no prior `bds-locale` value).
    await context.clearCookies();

    await page.goto('/login');

    // Vietnamese subtitle for the login page (see
    // packages/i18n/src/messages/vi/tenant.json → login.subtitle).
    await expect(page.getByText('Đăng nhập để tiếp tục.')).toBeVisible();

    // Flip the switcher. The component reloads the page after the
    // cookie write so Playwright waits for the new render.
    await page.getByLabel('Ngôn ngữ').selectOption('en');
    await page.waitForLoadState('domcontentloaded');

    // English subtitle now.
    await expect(page.getByText('Sign in to continue.')).toBeVisible();

    // Cookie is set + persists.
    const cookies = await context.cookies();
    const localeCookie = cookies.find((c) => c.name === 'bds-locale');
    expect(localeCookie?.value).toBe('en');

    // Refresh — English should still render.
    await page.reload();
    await expect(page.getByText('Sign in to continue.')).toBeVisible();
  });
});
