import { test, expect } from '../../src/fixtures/test';

/**
 * Task 2 — API Parameterized Search
 *
 * Call `/search.json?q=space&limit=12` and validate:
 *   - `docs.length` is exactly 12.
 *   - `numFound` is a number greater than the limit.
 */
test.describe('API - Parameterized Search', () => {
  test('q=space&limit=12 returns exactly 12 docs and numFound > limit', async ({
    api,
  }) => {
    const limit = 12;
    const response = await api.search({ q: 'space', limit });

    expect(response.docs).toHaveLength(limit);

    expect(typeof response.numFound, '`numFound` should be a number').toBe('number');
    expect(Number.isFinite(response.numFound), '`numFound` should be finite').toBe(true);
    expect(response.numFound).toBeGreaterThan(limit);

    // Sanity: every doc has a title (the field we depend on for downstream
    // tests). This guards against a silent schema regression.
    for (const [index, doc] of response.docs.entries()) {
      expect(typeof doc.title, `docs[${index}].title should be a string`).toBe('string');
      expect(doc.title.trim().length, `docs[${index}].title should not be empty`).toBeGreaterThan(0);
    }
  });
});
