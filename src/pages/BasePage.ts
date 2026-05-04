import { Page } from '@playwright/test';

/**
 * Thin base class shared by every page object. Holds the Playwright `Page`
 * handle, a navigation helper that retries on Open Library's HTTP 429
 * responses, and a recovery helper that reloads the current page if the
 * server replied with a 429 body after a click-driven navigation.
 *
 * Notes on hard sleeps:
 *   - The framework forbids hard sleeps that wait for DOM state.
 *   - `waitForTimeout` is used here only as polite client-side backoff
 *     between retries to a rate-limited public API. It is NOT used to
 *     wait for elements to appear.
 */
export abstract class BasePage {
  protected static readonly RATE_LIMIT_REGEX = /"status"\s*:\s*429/;
  protected static readonly MAX_RETRIES = 4;

  constructor(protected readonly page: Page) {}

  /**
   * Navigate to a relative path under the configured `baseURL`.
   *
   * `domcontentloaded` is sufficient for Open Library — the static markup
   * already contains the result list. We rely on auto-waiting `expect`
   * assertions in tests instead of `networkidle` waits, which can be flaky
   * for sites with long-running analytics pings.
   *
   * Retries on 429 with exponential backoff so transient rate-limiting
   * does not surface as a confusing "element not found" error.
   */
  protected async open(path: string): Promise<void> {
    let lastStatus: number | undefined;

    for (let attempt = 1; attempt <= BasePage.MAX_RETRIES; attempt++) {
      const response = await this.page.goto(path, { waitUntil: 'domcontentloaded' });
      lastStatus = response?.status();
      if (lastStatus !== 429 && !(await this.isRateLimitedPage())) {
        return;
      }
      await this.backoff(attempt);
    }

    throw new Error(
      `Open Library kept returning HTTP ${lastStatus ?? 'rate-limit body'} for ${path} ` +
        `after ${BasePage.MAX_RETRIES} attempts. You may have been temporarily rate-limited; ` +
        'wait a few minutes and retry, or run a single spec at a time with ' +
        '`npx playwright test <spec>`.',
    );
  }

  /**
   * Reload the current page (with backoff) until it stops rendering the
   * Open Library 429 JSON body. Use after click-based navigations where
   * we cannot inspect the response object directly.
   */
  protected async recoverFromRateLimit(): Promise<void> {
    for (let attempt = 1; attempt <= BasePage.MAX_RETRIES; attempt++) {
      if (!(await this.isRateLimitedPage())) {
        return;
      }
      await this.backoff(attempt);
      await this.page.reload({ waitUntil: 'domcontentloaded' });
    }
    if (await this.isRateLimitedPage()) {
      throw new Error(
        `Open Library is rate-limiting this client (HTTP 429) for ${this.page.url()}. ` +
          'Wait a few minutes before re-running the suite.',
      );
    }
  }

  /** Detect Open Library's plain-JSON 429 error page. */
  private async isRateLimitedPage(): Promise<boolean> {
    try {
      const body = await this.page.locator('body').innerText({ timeout: 1_000 });
      return BasePage.RATE_LIMIT_REGEX.test(body);
    } catch {
      return false;
    }
  }

  private async backoff(attempt: number): Promise<void> {
    const ms = 5_000 * attempt;
    await this.page.waitForTimeout(ms);
  }

  /** Underlying Playwright page (escape hatch for ad-hoc assertions). */
  get raw(): Page {
    return this.page;
  }
}
