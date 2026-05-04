import { test as base, expect, request as playwrightRequest, APIRequestContext } from '@playwright/test';
import { OpenLibraryApi } from '../api/OpenLibraryApi';
import { SearchResultsPage } from '../pages/SearchResultsPage';

/**
 * Custom fixtures wired into Playwright's test runner so every spec can
 * receive ready-to-use `searchPage` and `api` objects without boilerplate.
 *
 * The `api` fixture creates its own `APIRequestContext` so API-only specs
 * do not require launching a browser. UI specs reuse the page-scoped one.
 */
type Fixtures = {
  searchPage: SearchResultsPage;
  api: OpenLibraryApi;
  apiContext: APIRequestContext;
};

export const test = base.extend<Fixtures>({
  searchPage: async ({ page, apiContext }, use) => {
    // Open Library's `/verify_human` gate inspects `navigator.webdriver`
    // and a few related properties. We override them in an init script so
    // every navigation in the test starts from a plausibly-non-automated
    // page. This is exactly the same trick used by stealth plugins for
    // Puppeteer/Playwright.
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, 'webdriver', {
        get: () => undefined,
        configurable: true,
      });
      // Plugins/languages that headless Chromium leaves empty.
      Object.defineProperty(Navigator.prototype, 'languages', {
        get: () => ['en-US', 'en'],
        configurable: true,
      });
      Object.defineProperty(Navigator.prototype, 'plugins', {
        get: () => [1, 2, 3, 4, 5],
        configurable: true,
      });
    });

    // Pre-warm the `vf` verification cookie via the Node-side API request
    // context (its TLS/HTTP fingerprint is different from chrome-headless,
    // which Open Library sometimes refuses outright). Inject the cookie
    // into the browser context so the very first navigation already looks
    // verified. Best-effort: failure here is not fatal — the
    // `escapeVerifyHuman` retry loop in the page object is the safety net.
    try {
      const response = await apiContext.post('/verify_human', {
        headers: { 'Content-Type': 'application/json' },
        data: {},
      });
      if (response.ok()) {
        const headers = response.headersArray();
        const setCookieHeaders = headers
          .filter((h) => h.name.toLowerCase() === 'set-cookie')
          .map((h) => h.value);
        for (const raw of setCookieHeaders) {
          const match = /vf=([^;]+)/.exec(raw);
          if (match) {
            await page.context().addCookies([
              {
                name: 'vf',
                value: match[1]!,
                domain: 'openlibrary.org',
                path: '/',
                secure: true,
                httpOnly: true,
                sameSite: 'Lax',
              },
            ]);
            break;
          }
        }
      }
    } catch {
      // Best-effort. The in-page bypass loop covers the failure case.
    }

    await use(new SearchResultsPage(page));
  },

  apiContext: async ({}, use) => {
    const ctx = await playwrightRequest.newContext({
      baseURL: 'https://openlibrary.org',
      extraHTTPHeaders: {
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    await use(ctx);
    await ctx.dispose();
  },

  api: async ({ apiContext }, use) => {
    await use(new OpenLibraryApi(apiContext));
  },
});

export { expect };
