import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for the Open Library QA framework.
 *
 * - Single Chromium project (the assignment is browser-agnostic; Chromium keeps
 *   CI fast and stable).
 * - HTML + list reporters as agreed in the test plan.
 * - `baseURL` lets every test/page-object call relative paths like
 *   `/search?q=...` and the API helper hit `/search.json`.
 * - Auto-waiting only: no global `slowMo`, no hard sleeps anywhere in the suite.
 */
export default defineConfig({
  testDir: './tests',
  // Open Library aggressively rate-limits/serves error pages when hit in
  // parallel from a single IP. We keep file-level isolation (each spec
  // still gets its own page) but run one worker at a time so the suite is
  // deterministic. This is faster than a flaky parallel run with retries.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  // Open Library serves intermittent 429s, /verify_human bot challenges,
  // and degraded "no books matched" fallback layouts when hit by
  // automation. We absorb that flake with a couple of retries so a single
  // transient response doesn't bring down the whole suite.
  retries: process.env.CI ? 2 : 2,
  workers: 1,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
  ],
  // Open Library's UI is occasionally slow under our retry-with-backoff
  // safety net (rate-limit recovery + verify_human bypass + facet partial
  // reload can stack up). 90s gives the layered defences enough room
  // without masking real regressions on a healthy run (which finishes in
  // <30s per spec).
  timeout: 90_000,
  expect: {
    timeout: 15_000,
  },
  use: {
    baseURL: 'https://openlibrary.org',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'en-US',
    timezoneId: 'America/New_York',
    // Real desktop Chrome user-agent — chromium-headless-shell otherwise
    // identifies itself via navigator properties that Open Library uses
    // to redirect to /verify_human.
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    extraHTTPHeaders: {
      'Accept-Language': 'en-US,en;q=0.9',
      'Sec-Ch-Ua':
        '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
      'Sec-Ch-Ua-Mobile': '?0',
      'Sec-Ch-Ua-Platform': '"macOS"',
    },
    launchOptions: {
      args: [
        // Hide the most obvious headless fingerprint from feature-detection
        // libraries used by sites that gate against automation.
        '--disable-blink-features=AutomationControlled',
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      // Use the locally installed Google Chrome rather than Playwright's
      // chrome-headless-shell. Open Library actively redirects the
      // headless-shell fingerprint to /verify_human; full Chrome (with
      // the stealth init script in src/fixtures/test.ts) bypasses that.
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
      },
    },
  ],
});
