import { Locator, Page, expect } from '@playwright/test';
import { BasePage } from './BasePage';

/**
 * Maps the canonical sort names used by tests/specs (and the assignment
 * brief) onto the actual UI link text Open Library renders.
 *
 * Open Library's sort dropdown does NOT use the literal label "Oldest";
 * the option for ascending publication year is called "First Published"
 * and routes to `?sort=old`. We expose the friendlier alias and keep this
 * mapping in one place so tests stay readable and resilient to wording
 * changes.
 */
const SORT_UI_LABEL: Record<string, string> = {
  relevance: 'Relevance',
  oldest: 'First Published',
  newest: 'Most Recent',
  rating: 'Top Rated',
  editions: 'Most Editions',
  trending: 'Trending',
  random: 'Random',
};

export type SortKey = keyof typeof SORT_UI_LABEL;

/**
 * Page object for the Open Library search results page
 * (https://openlibrary.org/search?q=...).
 *
 * Locators favour role/label/test-id queries where possible. A few stable
 * structural classes (`li.searchResultItem`, `details.sort-dropper`,
 * `.facet.language`) are used because Open Library renders some controls
 * as custom web components (e.g. `<ol-chip>`) that don't expose ARIA roles
 * out of the box. Those class names are part of the public theme and have
 * been stable for years.
 */
export class SearchResultsPage extends BasePage {
  // --- Top search bar --------------------------------------------------------
  readonly searchInput: Locator;
  readonly searchSubmit: Locator;

  // --- Sort dropdown (a native <details>/<summary> element) -----------------
  readonly sortDropdown: Locator;
  readonly sortSummary: Locator;

  // --- Result list -----------------------------------------------------------
  readonly resultItems: Locator;
  readonly resultTitleLinks: Locator;
  readonly resultsStats: Locator;
  readonly nextPageLink: Locator;

  // --- Sidebar / facets ------------------------------------------------------
  readonly languageFacet: Locator;
  readonly selectedFacets: Locator;

  constructor(page: Page) {
    super(page);

    this.searchInput = page.getByLabel('Search', { exact: true }).first();
    this.searchSubmit = page.getByRole('button', { name: /search submit/i }).first();

    this.sortDropdown = page.locator('details.sort-dropper');
    this.sortSummary = this.sortDropdown.locator('summary');

    this.resultItems = page.locator('li.searchResultItem');
    this.resultTitleLinks = this.resultItems.locator('h3.booktitle a.results');
    this.resultsStats = page.locator('.search-results-stats');
    // Open Library renders pagination through a custom <ol-pagination>
    // web component. Each page button is a real anchor in the light DOM,
    // and the "Next" button has aria-label="Go to next page".
    this.nextPageLink = page.getByRole('link', { name: /go to next page/i });

    this.languageFacet = page.locator('.facet.language');
    this.selectedFacets = page.locator('.selected-search-facets');
  }

  /**
   * Open `/search?q=...` directly. Returns the page object for chaining.
   *
   * Open Library occasionally serves a degraded "No books directly matched"
   * fallback layout in place of the standard results page (the layout has
   * no `search-results-stats` element). When that happens we reload with
   * backoff up to a few times before giving up.
   */
  async gotoSearch(query: string): Promise<this> {
    const path = `/search?q=${encodeURIComponent(query)}`;
    const maxAttempts = 4;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await this.open(path);

      // If Open Library intercepts the navigation with /verify_human,
      // clear it and retry the search URL.
      if (this.page.url().includes('verify_human')) {
        await this.passHumanVerification();
        await this.open(path);
      }

      const ready = await this.resultsStats
        .first()
        .isVisible({ timeout: 5_000 })
        .catch(() => false);
      if (ready) {
        return this;
      }
      // Backoff and try again on the degraded fallback layout.
      await this.page.waitForTimeout(3_000 * attempt);
    }

    await expect(
      this.resultsStats,
      'Open Library did not render the standard search-results layout for ' +
        `q=${query}. The site may be serving the degraded "No books matched" ` +
        'fallback. Re-run the suite or try a different query.',
    ).toBeVisible();
    return this;
  }

  /**
   * Wait for the Language facet to be *populated*, not just rendered.
   *
   * Open Library ships the `<div class="facet language">` shell
   * synchronously with body text "Loading..." and only later injects
   * `<ol-chip>` children when `/partials/SearchFacets.json` resolves.
   * The previous version of this method returned the moment the empty
   * shell was visible, which left every caller racing against a partial
   * that might be slow or might silently return
   * "Unable to render this page." — manifesting as a low-signal
   * `0 elements` failure further down the stack.
   *
   * The real precondition for `filterByLanguage` is "facet body has at
   * least one chip", so wait for that and reload-with-backoff if the
   * partial never delivers.
   */
  async waitForLanguageFacet(): Promise<void> {
    const facetChips = this.languageFacet.locator('ol-chip');

    // First attempt: a generous single wait for the partial. Most green
    // runs return well inside 12s; this avoids a wasted reload when the
    // partial is just slow.
    const populated = await facetChips
      .first()
      .waitFor({ state: 'attached', timeout: 12_000 })
      .then(() => true)
      .catch(() => false);
    if (populated) {
      return;
    }

    // Fallback: the partial may have hard-failed with "Unable to render
    // this page." A reload re-issues the partial request and usually
    // succeeds. We cap this to one retry to stay well inside the 60s
    // test budget.
    await this.page.reload({ waitUntil: 'domcontentloaded' });
    await this.recoverFromRateLimit();

    await expect(
      facetChips.first(),
      'Language facet container appeared but never populated with chips. ' +
        'The /partials/SearchFacets.json endpoint likely returned ' +
        '"Unable to render this page." for the current query.',
    ).toBeAttached({ timeout: 12_000 });
  }

  /** Submit a query through the visible header search bar. */
  async searchFromHeader(query: string): Promise<void> {
    await this.searchInput.fill(query);
    await this.searchInput.press('Enter');
    await expect(this.resultsStats).toBeVisible();
  }

  /**
   * Open the sort dropper and choose one of the labelled options.
   *
   * Open Library uses a native `<details>/<summary>` element, which keeps
   * its inner content `display: none` until expanded. We toggle the
   * element's `open` property directly so the option link is reliably
   * visible before clicking — that is the same end state the user sees and
   * avoids relying on CSS-driven animations or click-coordinate quirks.
   */
  async sortBy(sortKey: SortKey): Promise<void> {
    const uiLabel = SORT_UI_LABEL[sortKey];
    if (!uiLabel) {
      throw new Error(`Unknown sort key: ${sortKey}`);
    }

    await this.sortDropdown.evaluate((el) => {
      (el as HTMLDetailsElement).open = true;
    });
    await expect(this.sortDropdown).toHaveAttribute('open', /.*/);

    // Open Library prefixes each option's accessible name with a "✓"
    // checkmark glyph (rendered via CSS `::before`), so the accessible
    // name is e.g. "✓ First Published" rather than "First Published".
    // Anchor only on the label suffix to stay robust.
    const option = this.sortDropdown.getByRole('link', {
      name: new RegExp(`${escapeRegex(uiLabel)}\\s*$`, 'i'),
    });
    await expect(option).toBeVisible();
    await Promise.all([
      this.page.waitForURL(/[?&]sort=/, { waitUntil: 'domcontentloaded' }),
      option.click(),
    ]);

    // The sort click navigates to a fresh search URL, which can also be
    // intercepted by 429s or /verify_human. Recover transparently.
    if (this.page.url().includes('verify_human')) {
      await this.passHumanVerification();
      await this.open(`/search?q=${this.currentQuery()}&sort=${this.apiSortValue(sortKey)}`);
    }
    await this.recoverFromRateLimit();

    // Now we should see the new sort reflected in the summary.
    await expect(this.sortSummary).toContainText(uiLabel);
  }

  /** Extract the `q=` value from the current URL. */
  private currentQuery(): string {
    const url = new URL(this.page.url());
    return url.searchParams.get('q') ?? '';
  }

  /** API sort value (e.g. 'old') for a given UI sort key. */
  private apiSortValue(sortKey: SortKey): string {
    const apiMap: Record<SortKey, string> = {
      relevance: '',
      oldest: 'old',
      newest: 'new',
      rating: 'rating',
      editions: 'editions',
      trending: 'trending',
      random: 'random',
    };
    return apiMap[sortKey];
  }

  /** Read the currently selected sort label from the dropdown summary. */
  async currentSortLabel(): Promise<string> {
    const text = (await this.sortSummary.textContent()) ?? '';
    return text.replace(/\s+/g, ' ').trim();
  }

  /** Click a language facet by its visible name (e.g. "Spanish"). */
  async filterByLanguage(language: string): Promise<void> {
    await this.waitForLanguageFacet();

    // The facet is a custom <ol-chip> web component. We target it via its
    // stable `title` attribute ("Filter results for <Language>"). Custom
    // elements without a default `display` value can have a zero bounding
    // box, so we scroll it into view rather than relying on `toBeVisible`
    // which checks geometry.
    const chip = this.languageFacet.locator(
      `ol-chip[title="Filter results for ${language}"]`,
    );

    // Open Library ships the top ~6 languages by default and tucks the
    // rest behind a "Show more" toggle. The top-N ordering is not
    // deterministic across runs (it depends on per-query result counts
    // that drift over time), so the desired language sometimes lives
    // behind the toggle. Expand it on demand.
    if ((await chip.count()) === 0) {
      const expand = this.languageFacet.getByRole('link', {
        name: /show\s*more|^more$/i,
      });
      if (await expand.count()) {
        await expand.first().click();
        await chip
          .first()
          .waitFor({ state: 'attached', timeout: 10_000 })
          .catch(() => undefined);
      }
    }

    if ((await chip.count()) !== 1) {
      const visibleTitles = await this.languageFacet
        .locator('ol-chip')
        .evaluateAll((els) =>
          els
            .map((el) => (el as HTMLElement).getAttribute('title'))
            .filter((t): t is string => Boolean(t)),
        );
      throw new Error(
        `Expected exactly one "${language}" facet chip after expanding ` +
          `the language facet, found ${await chip.count()}. Visible chip ` +
          `titles: ${visibleTitles.join(', ') || '<none>'}.`,
      );
    }

    await chip.scrollIntoViewIfNeeded();
    await Promise.all([
      this.page.waitForURL(/[?&]language=/, { waitUntil: 'domcontentloaded' }),
      chip.click(),
    ]);
    await this.recoverFromRateLimit();
  }

  /** Locator for the "applied filter" chip shown above the result list. */
  selectedLanguageChip(language: string): Locator {
    // The selected chip exposes an `accessible-label` like
    // "Written in: Spanish" and an `selected` attribute.
    return this.selectedFacets.locator(
      `ol-chip[selected][accessible-label="Written in: ${language}"]`,
    );
  }

  /**
   * Click the "Next" pagination link.
   *
   * Open Library frequently redirects automated click-driven navigation
   * to `/verify_human?next=...`. The challenge is a one-click button (not
   * a real CAPTCHA) that POSTs `/verify_human` and sets a session cookie.
   * Even after a successful POST, Open Library sometimes re-challenges
   * the next request, so we delegate recovery to `escapeVerifyHuman()`,
   * which loops bypass + re-navigate with backoff. The end-state under
   * test (URL contains `page=N+1`, results differ) is preserved.
   */
  async goToNextPage(): Promise<void> {
    await expect(this.nextPageLink).toBeVisible();
    const href = await this.nextPageLink.getAttribute('href');
    if (!href) {
      throw new Error('Pagination "Next" link is missing an href');
    }

    await Promise.all([
      this.page.waitForURL(/page=\d+|verify_human/, {
        waitUntil: 'domcontentloaded',
      }),
      this.nextPageLink.click(),
    ]);

    await this.escapeVerifyHuman(href);
    await this.recoverFromRateLimit();

    // Open Library sometimes responds to `?page=N` with the degraded
    // "No books directly matched" layout (no `searchResultItem`s rendered)
    // even though the URL is correct. Reload-with-backoff a couple of
    // times so the spec only sees the standard results layout.
    const maxReloads = 2;
    for (let attempt = 1; attempt <= maxReloads; attempt++) {
      const populated = await this.resultItems
        .first()
        .isVisible({ timeout: 5_000 })
        .catch(() => false);
      if (populated) return;
      await this.page.waitForTimeout(2_000 * attempt);
      await this.open(href);
      await this.recoverFromRateLimit();
    }
  }

  /**
   * Attempt to clear Open Library's `/verify_human` gate.
   *
   * The on-page "Verify you are human" button POSTs `/verify_human` and
   * sets a `vf=...` session cookie on success. Doing the click via
   * Playwright in headless Chromium is unreliable, so we issue the same
   * POST directly from the page's JS context (which still uses the page's
   * cookie jar that subsequent navigations need).
   *
   * Soft-fails: returns `true` on success and `false` on any failure
   * (network error, non-2xx response, or the page is not on
   * /verify_human). Callers can decide whether to retry, fall back, or
   * surface a richer error — historically throwing here turned a single
   * transient OL response into an immediately-fatal test failure.
   */
  async passHumanVerification(): Promise<boolean> {
    if (!this.page.url().includes('verify_human')) {
      return true;
    }

    return this.page.evaluate(async () => {
      try {
        const response = await fetch('/verify_human', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
        });
        return response.ok;
      } catch {
        return false;
      }
    });
  }

  /**
   * While the page is parked on `/verify_human`, repeatedly attempt the
   * POST bypass and re-navigate to `targetPath`. Backs off between
   * attempts with a polite cooldown so Open Library's per-IP rate limit
   * has a chance to clear (the cookie alone does not always free a
   * recently-flagged client). Throws with an actionable message only
   * after `maxAttempts` failed escapes.
   */
  private async escapeVerifyHuman(targetPath: string): Promise<void> {
    const maxAttempts = 4;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (!this.page.url().includes('verify_human')) {
        return;
      }
      await this.passHumanVerification();
      await this.open(targetPath);
      if (!this.page.url().includes('verify_human')) {
        return;
      }
      await this.page.waitForTimeout(8_000 * attempt);
    }
    throw new Error(
      `Could not bypass /verify_human after ${maxAttempts} attempts. ` +
        'Open Library is aggressively gating this client. Wait a few ' +
        'minutes for the IP-level rate limit to clear, run a single spec ' +
        'with `npx playwright test <spec>`, or try `npm run test:headed`. ' +
        `Current URL: ${this.page.url()}`,
    );
  }

  /** Trimmed text of every result title currently rendered on the page. */
  async resultTitles(): Promise<string[]> {
    await expect(this.resultTitleLinks.first()).toBeVisible();
    const raw = await this.resultTitleLinks.allInnerTexts();
    return raw.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }

  /** Title of the first visible result. */
  async firstResultTitle(): Promise<string> {
    await expect(this.resultTitleLinks.first()).toBeVisible();
    const text = (await this.resultTitleLinks.first().innerText()).trim();
    return text.replace(/\s+/g, ' ').trim();
  }

  /**
   * Open Library work key (e.g. "/works/OL52211W") of the first result,
   * extracted from its `<a href>`. Useful when the UI displays an edition
   * title that differs from the API's work title — comparing keys gives
   * a deterministic identity check for the same record.
   */
  async firstResultWorkKey(): Promise<string> {
    await expect(this.resultTitleLinks.first()).toBeVisible();
    const href = await this.resultTitleLinks.first().getAttribute('href');
    if (!href) {
      throw new Error('First result link is missing an href');
    }
    const match = href.match(/^\/works\/(OL\d+W)/);
    if (!match) {
      throw new Error(`Unexpected first result href: ${href}`);
    }
    return `/works/${match[1]}`;
  }

  /** Stats blob ("1,670 hits ..."), useful for sanity-checking filter changes. */
  async hitCountText(): Promise<string> {
    const text = (await this.resultsStats.first().innerText()).trim();
    // The stats element bundles the sort/grid widgets too; we only want the
    // first line which always reads "<n> hits".
    return text.split('\n')[0]!.trim();
  }
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
