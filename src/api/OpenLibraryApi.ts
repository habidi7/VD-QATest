import { APIRequestContext, APIResponse, expect } from '@playwright/test';
import { SearchParams, SearchResponse } from './types';

/**
 * Centralized client for the Open Library REST API.
 *
 * Why a class instead of loose helper functions:
 * - It owns the `APIRequestContext` injected by the Playwright `request`
 *   fixture, so request configuration (baseURL, headers, retries) is set in
 *   one place.
 * - Tests stay declarative: `await api.search({ q, limit })` instead of
 *   restating URL templates and JSON parsing in every spec.
 * - Adding new endpoints later (e.g. `/works/{id}.json`) is a one-method
 *   change without touching tests.
 */
export class OpenLibraryApi {
  private static readonly SEARCH_PATH = '/search.json';

  constructor(private readonly request: APIRequestContext) {}

  /**
   * Perform a search and return the parsed JSON payload.
   *
   * Transparently retries on HTTP 429 with exponential backoff so the
   * suite stays green when Open Library throttles us during a busy CI run.
   * Throws (via `expect`) if the final response is not 2xx so individual
   * specs do not have to repeat status-code assertions for happy paths.
   */
  async search(params: SearchParams): Promise<SearchResponse> {
    const response = await this.rawSearch(params);
    expect(
      response.ok(),
      `Open Library search failed: ${response.status()} ${response.statusText()}`,
    ).toBeTruthy();

    const body = (await response.json()) as SearchResponse;
    expect(Array.isArray(body.docs), 'Response is missing `docs` array').toBe(true);
    return body;
  }

  /**
   * Lower-level escape hatch when a test specifically wants to assert on
   * status, headers, or non-2xx responses. Retries on transient failures:
   * - HTTP 429 (rate limit) — Open Library's most common throttle.
   * - HTTP 5xx — Open Library occasionally returns 500/502/503/504 from
   *   solr while it warms up; the same query 5s later usually succeeds.
   */
  async rawSearch(params: SearchParams): Promise<APIResponse> {
    const maxAttempts = 4;
    let last: APIResponse | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      last = await this.request.get(OpenLibraryApi.SEARCH_PATH, {
        params: this.serialize(params),
      });
      const status = last.status();
      const transient = status === 429 || (status >= 500 && status <= 599);
      if (!transient) {
        return last;
      }
      await sleep(5_000 * attempt);
    }
    return last!;
  }

  /**
   * Convert our typed params object into the loose `Record<string, string>`
   * shape Playwright's request fixture expects. Undefined values are dropped
   * so we never send `?sort=undefined`.
   */
  private serialize(params: SearchParams): Record<string, string | number> {
    const entries = Object.entries(params).filter(
      ([, value]) => value !== undefined && value !== null && value !== '',
    );
    return Object.fromEntries(entries) as Record<string, string | number>;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
