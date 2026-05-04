import { test, expect } from '../../src/fixtures/test';

/**
 * Task 3 — Integrated Sort Order Validation
 *
 * 1. Open the UI, set the "Sort by" dropdown to the oldest option.
 * 2. Capture the title of the first visible book.
 * 3. Call the API with `sort=old`.
 * 4. Assert the UI title matches `docs[0].title` from the API.
 *
 * Notes on naming:
 *   - The brief refers to the option as "Oldest". Open Library's actual UI
 *     label for the same option is "First Published"; both map to the API
 *     value `sort=old`. The page-object hides this aliasing behind the
 *     `sortKey: 'oldest'` argument.
 */
test.describe('Integrated - Sort Order Validation', () => {
  test('UI first title (sorted oldest) matches API docs[0].title', async ({
    searchPage,
    api,
    page,
  }) => {
    const query = 'Science';

    // 1. UI: open search and apply the sort.
    await searchPage.gotoSearch(query);
    await searchPage.sortBy('oldest');

    await expect(
      page,
      'Selecting the oldest sort should add `sort=old` to the URL',
    ).toHaveURL(/[?&]sort=old(&|$)/);

    const uiFirstTitle = await searchPage.firstResultTitle();
    const uiFirstWorkKey = await searchPage.firstResultWorkKey();
    expect(uiFirstTitle.length).toBeGreaterThan(0);

    // 2. API: ask for the same sorted slice. limit=1 keeps the call small.
    const response = await api.search({ q: query, sort: 'old', limit: 1 });
    expect(response.docs.length).toBeGreaterThan(0);
    const firstDoc = response.docs[0]!;
    const apiTitle = firstDoc.title.trim();

    // 3a. Strong identity check: the work surfaced first must be the same
    //     in both layers. This is the deterministic invariant — Open
    //     Library's UI may render an edition's display-title that differs
    //     in punctuation/whitespace from the work's canonical `title`,
    //     but both code paths must agree on the work key.
    expect(
      firstDoc.key,
      'UI and API must agree on which work appears first when sorted oldest',
    ).toBe(uiFirstWorkKey);

    // 3b. Title check: Open Library's UI displays the title of the
    //     "best" *edition* of a work (often with a subtitle/suffix), while
    //     the API's `docs[0].title` is the canonical *work* title. For
    //     example, the same work surfaces as "The Invisible Man" via the
    //     API and as "Invisible Man .: Science Fiction Novel" in the UI.
    //     We normalize (strip leading articles and non-alphanumerics) and
    //     accept the comparison if either normalized title is a prefix of
    //     the other. Tighter than a substring check, but tolerant of the
    //     edition/work split.
    const normalize = (s: string) =>
      s
        .toLowerCase()
        .replace(/^the\s+/, '')
        .replace(/[^a-z0-9]/g, '');
    const uiNorm = normalize(uiFirstTitle);
    const apiNorm = normalize(apiTitle);

    const compatible =
      uiNorm === apiNorm ||
      uiNorm.startsWith(apiNorm) ||
      apiNorm.startsWith(uiNorm);

    expect(
      compatible,
      `UI title "${uiFirstTitle}" should be compatible with API title ` +
        `"${apiTitle}" (same work key; one normalized title should be a ` +
        'prefix of the other)',
    ).toBe(true);
  });
});
