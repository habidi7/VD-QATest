import { test, expect } from '../../src/fixtures/test';

/**
 * Task 1 — UI Multipage Navigation
 *
 * 1. Search for a common term ("Science").
 * 2. Click the "Next" page button at the bottom of the results.
 * 3. Assert the URL contains `page=2`.
 * 4. Assert the page-2 results are different from page-1 results.
 */
test.describe('UI - Multipage Navigation', () => {
  test('clicking "Next" navigates to page 2 with different results', async ({
    searchPage,
    page,
  }) => {
    await searchPage.gotoSearch('Science');
    await expect(page).toHaveURL(/\/search\?q=Science(&|$)/);

    const pageOneTitles = await searchPage.resultTitles();
    expect(
      pageOneTitles.length,
      'Page 1 should render at least one result',
    ).toBeGreaterThan(0);

    await searchPage.goToNextPage();

    await expect(page, 'URL should reflect the new page index').toHaveURL(/[?&]page=2(&|$)/);

    const pageTwoTitles = await searchPage.resultTitles();
    expect(
      pageTwoTitles.length,
      'Page 2 should also render at least one result',
    ).toBeGreaterThan(0);

    // The two pages must show genuinely different content. We compare the
    // ordered lists rather than testing for "no overlap" — Open Library has
    // ~20 results per page so even a single shared title would be a real
    // bug, but tolerating accidental shared best-sellers keeps the test
    // honest.
    expect(
      pageTwoTitles,
      'Page 2 result titles must differ from page 1 (even one duplicate is acceptable, but not the entire list)',
    ).not.toEqual(pageOneTitles);

    const overlap = pageOneTitles.filter((t) => pageTwoTitles.includes(t));
    expect(
      overlap.length,
      `Pages 1 and 2 share ${overlap.length} titles — pagination may be broken`,
    ).toBeLessThan(pageOneTitles.length);
  });
});
