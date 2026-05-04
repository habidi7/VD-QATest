# Open Library QA — Playwright Framework

Automated UI + API + integration tests for [openlibrary.org](https://openlibrary.org) and the `/search.json` endpoint, written in TypeScript on top of Playwright Test.

The suite covers four scenarios from the take-home brief:

| # | Spec | Layer | What it verifies |
|---|------|-------|------------------|
| 1 | `tests/ui/pagination.spec.ts` | UI | Searching "Science", clicking the **Next** button, asserting `?page=2` and that page-2 titles differ from page 1. |
| 2 | `tests/api/parameterized-search.spec.ts` | API | `GET /search.json?q=space&limit=12` returns exactly 12 docs and `numFound > 12`. |
| 3 | `tests/integration/sort-order.spec.ts` | Integrated | Selecting **Oldest** in the UI sort dropdown surfaces the same first record as `GET /search.json?q=Science&sort=old`. |
| 4 | `tests/ui/language-filter.spec.ts` | UI | Clicking the sidebar **Spanish** language facet updates the URL, page title, and applied-filter chip, and at least one result remains visible. |

---

## Prerequisites

- **Node.js 20+** (uses native `fetch`, modern Playwright APIs).
- A working internet connection — the suite hits the live `openlibrary.org` site.
- macOS, Linux, or Windows. Tested on macOS 25.

## Installation

```bash
npm install
npm run install:browsers   # downloads Playwright Chrome and dependencies
```

Behind a corporate proxy? Set `HTTPS_PROXY` before running `install:browsers`.

## Running the tests

```bash
# Full suite (UI + API + integration), single Chromium worker
npm test

# By layer
npm run test:ui
npm run test:api
npm run test:integration

# Visible browser (handy for debugging)
npm run test:headed

# Step-through debugger
npm run test:debug
```

The Playwright runner emits the standard `list` reporter output to stdout and writes an `html` report to `playwright-report/`.

## Reporting

```bash
npm run report
```

Opens the most recent HTML report in your default browser. The report includes:

- Test status & duration per spec
- Inline screenshots, videos, and Playwright traces for failed/retried runs
- A direct link to view the trace viewer (`Trace > View trace`).

In CI, copy the `playwright-report/` directory as a build artifact.

## Project layout

```text
.
├── playwright.config.ts          # baseURL, retries, list+html reporters, single worker
├── tsconfig.json                 # strict TypeScript, path aliases
├── src
│   ├── api
│   │   ├── OpenLibraryApi.ts     # centralized /search.json client (auto-retries 429)
│   │   └── types.ts              # SearchResponse / SearchParams / SearchSort union
│   ├── fixtures
│   │   └── test.ts               # `searchPage` and `api` fixtures + stealth init script
│   └── pages
│       ├── BasePage.ts           # 429-aware open(), bot-challenge recovery
│       └── SearchResultsPage.ts  # POM for the search results page
└── tests
    ├── api
    │   └── parameterized-search.spec.ts
    ├── integration
    │   └── sort-order.spec.ts
    └── ui
        ├── language-filter.spec.ts
        └── pagination.spec.ts
```

## Engineering notes

- **Locators** prefer `getByRole`, `getByLabel`, `getByPlaceholder`. Stable structural classes (`li.searchResultItem`, `details.sort-dropper`, `.facet.language`) are used only where Open Library renders custom web components (`<ol-chip>`, `<ol-pagination>`) that lack standard ARIA roles.
- **Wait strategy** is auto-waiting only — no `page.waitForTimeout(...)` used to wait for content. The few `waitForTimeout` calls that remain are *polite client-side backoffs* between rate-limit retries; they are explicitly commented as such.
- **Sort label aliasing.** The brief refers to the dropdown option as **"Oldest"**, but Open Library labels it **"First Published"** (which still maps to API `sort=old`). The `SortKey` enum exposes the friendlier alias and `SearchResultsPage.sortBy('oldest')` clicks the actual UI label.
- **Bot mitigation.** Open Library aggressively gates automation traffic. The framework absorbs three different responses: HTTP `429`, the `/verify_human` interstitial, and the degraded "No books directly matched" fallback layout. See [TEST_PLAN.md](TEST_PLAN.md).

## Troubleshooting

| Symptom | Most likely cause | Action |
|---------|-------------------|--------|
| Test times out waiting for `.search-results-stats` | Open Library is rate-limiting your IP (HTTP 429) or returned a degraded fallback layout | Wait 2–3 minutes and rerun. The framework already retries up to 4× per navigation. |
| `Open Library /verify_human POST failed` | Open Library tightened bot detection on this network | Run from a different network or with `npm run test:headed`. |
| `Could not bypass /verify_human after 4 attempts` | Open Library is IP-rate-limiting this client and the cookie pre-warm is not enough to clear it | Wait 5–10 minutes for the IP gate to clear, then rerun. Optionally `npm run test:headed` (real Chrome window passes more of OL's heuristics). |
| `Unable to render this page.` in the language facet | Open Library's `/partials/SearchFacets.json` failed for the chosen query | The framework reloads automatically. If it persists, swap the search term in `tests/ui/language-filter.spec.ts`. |
| Browsers not installed | First-time setup not run | `npm run install:browsers` |

## CI

The config respects `process.env.CI`:

- `forbidOnly: true` (fails the build if `.only` slipped in)
- `retries: 2`
- `workers: 1` to stay polite with the public Open Library API

A minimal GitHub Actions step:

```yaml
- run: npm ci
- run: npx playwright install --with-deps chromium
- run: npm test
- if: always()
  uses: actions/upload-artifact@v4
  with:
    name: playwright-report
    path: playwright-report/
```
