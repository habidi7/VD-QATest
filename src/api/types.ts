/**
 * Subset of the Open Library `/search.json` response that our suite asserts on.
 *
 * The Solr schema is large and not formally guaranteed to be stable
 * (see https://openlibrary.org/dev/docs/api/search). We only model the
 * fields the assignment requires, plus the most useful identifying fields,
 * to keep the contract tight and the failures legible.
 */
export interface SearchDoc {
  key: string;
  title: string;
  author_name?: string[];
  first_publish_year?: number;
  edition_count?: number;
  language?: string[];
  cover_i?: number;
  cover_edition_key?: string;
}

export interface SearchResponse {
  numFound: number;
  start: number;
  numFoundExact?: boolean;
  /**
   * Legacy alias of `numFound` returned by Open Library; kept optional so
   * downstream code can tolerate both spellings.
   */
  num_found?: number;
  docs: SearchDoc[];
  q?: string;
  offset?: number | null;
  documentation_url?: string;
}

/**
 * Sort values accepted by the Search API.
 *
 * Note the UI label for "Oldest" maps to `old` (NOT `oldest`) at the API
 * layer. This is documented in TEST_PLAN.md and surfaced as a typed union
 * here so callers cannot accidentally send `"oldest"`.
 */
export type SearchSort =
  | 'new'
  | 'old'
  | 'random'
  | 'key'
  | 'rating'
  | 'readinglog'
  | 'already_read'
  | 'currently_reading'
  | 'want_to_read'
  | 'editions'
  | 'lcc_sort'
  | 'ddc_sort';

export interface SearchParams {
  q: string;
  limit?: number;
  page?: number;
  offset?: number;
  sort?: SearchSort;
  /** Two-letter ISO 639-1 language hint for the request locale. */
  lang?: string;
  /** Comma-separated list of fields to return; default lets Open Library decide. */
  fields?: string;
}
