import { test, expect } from '../../src/fixtures/test';

/**
 * Task 4 — UI Filtering
 *
 * 1. Search for a common term, then use the sidebar Language facet to
 *    select "Spanish".
 * 2. Assert the "Result for ..." header reflects the filter.
 * 3. Assert at least one result is visible.
 *
 * Open Library does not render a literal `Result for ...` heading. The
 * equivalent affordances are:
 *   - The page `<title>` becomes `Science, Spanish - search`.
 *   - A selected `<ol-chip>` appears at the top of the result panel with
 *     `accessible-label="Written in: Spanish"`.
 *   - The `language=spa` query parameter is added to the URL.
 *   - The hit-count drops dramatically (542k+ -> ~1.6k).
 *
 * We assert all four to fully cover the spirit of the brief.
 */
test.describe('UI - Language Filtering', () => {
  test('selecting Spanish filters the results and updates the page header', async ({
    searchPage,
    page,
  }) => {
    // We deliberately avoid the very-large "Science" result set here:
    // Open Library's `/partials/SearchFacets.json` endpoint intermittently
    // returns "Unable to render this page." for that query, leaving the
    // sidebar empty. "Harry Potter" reliably renders the language facet
    // and is also a culturally common query. The pagination spec keeps
    // using "Science" as the brief instructed.
    const query = 'Harry Potter';

    await searchPage.gotoSearch(query);
    const unfilteredHits = await searchPage.hitCountText();
    expect(unfilteredHits).toMatch(/\d/);

    await searchPage.filterByLanguage('Spanish');

    await expect(page, 'URL must include `language=spa`').toHaveURL(/[?&]language=spa(&|$)/);

    await expect(
      page,
      'Page title should reflect the active language filter',
    ).toHaveTitle(/spanish/i);

    await expect(
      searchPage.selectedLanguageChip('Spanish'),
      'A selected "Written in: Spanish" facet chip should be displayed',
    ).toBeVisible();

    await expect(
      searchPage.resultItems.first(),
      'At least one result must be visible after filtering',
    ).toBeVisible();
    expect((await searchPage.resultItems.count()), 'Result count must be >= 1').toBeGreaterThan(0);

    const filteredHits = await searchPage.hitCountText();
    expect(filteredHits, 'Hit count should change once the filter is applied').not.toBe(
      unfilteredHits,
    );
  });
});
