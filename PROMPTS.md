# Prompts Used While Building the Framework

A log of how I used AI (Cursor + Claude) while building this Open Library QA framework. The framing is honest: I designed and wrote the framework end-to-end, and reached for AI at specific decision points — to sanity-check choices, to research a behaviour I wasn't certain about, or to debug a flake faster than I would have alone. The prompts below are the actual shape of those questions.

For the test coverage matrix and risk register see [TEST_PLAN.md](TEST_PLAN.md); for setup and troubleshooting see [README.md](README.md). This file is just the AI-prompt slice of the build story.

## Phase 1 — Reading the brief

I read the assignment, decided on TypeScript + `@playwright/test`, list + html reporters, a single Chromium project, and a `baseURL` of `https://openlibrary.org`. Before committing to that stack I wanted a second opinion on whether Playwright was the right call given the brief's API + UI mix.

I asked AI:

> Here's a QA assignment with four scenarios — UI multi-page navigation, an API parameterised search, a UI-vs-API integrated sort assertion, and a UI language facet. The brief explicitly calls out POM, stable locators, a centralised API helper, and auto-waiting. I'm leaning toward Playwright Test in TypeScript because of (a) first-class `APIRequestContext`, (b) `getByRole`/`getByLabel`, (c) auto-waiting expects out of the box. Is there anything in the brief you'd push back on for that stack, or any sharp edge I should plan around before I scaffold?

Takeaway: confirmed Playwright was the right pick; AI flagged that Open Library is known to gate automation traffic, which I noted but underestimated until Day 2.

## Phase 2 — Project scaffold

I wrote [package.json](package.json), [tsconfig.json](tsconfig.json), and [playwright.config.ts](playwright.config.ts) myself. The config choices I cared about: `fullyParallel: false`, `workers: 1`, `retries: 2`, single Chromium project, `baseURL`, no global `slowMo`, no `networkidle` waits.

I asked AI:

> Quick review of my Playwright config for a public-API smoke suite that hits a single third-party origin. I've gone with `workers: 1` + `fullyParallel: false` to stay polite, `retries: 2` to absorb transient flake, `actionTimeout: 15_000`, `navigationTimeout: 30_000`, and `trace: 'on-first-retry'`. Anything I'm leaving on the table, or anything you'd argue against given the constraints?

Takeaway: kept everything; added `screenshot: 'only-on-failure'` and `video: 'retain-on-failure'` per AI's nudge.

## Phase 3 — API client

I designed and wrote [src/api/OpenLibraryApi.ts](src/api/OpenLibraryApi.ts) and [src/api/types.ts](src/api/types.ts). The client owns the `APIRequestContext`, exposes `search()` (asserts 2xx + parses JSON) and `rawSearch()` (escape hatch). I wanted to lock down the sort tokens before pinning them in the `SearchSort` union.

I asked AI:

> I'm wrapping Open Library's `/search.json` in a small client class that owns Playwright's `APIRequestContext`. My current sketch exposes `search(params)` that asserts 2xx and parses JSON, plus `rawSearch(params)` as an escape hatch when a test wants to assert on a non-2xx status. Two questions: (1) the brief says "sort by Oldest" — does the API actually accept `oldest`, or does it use `old`? (2) for transient failures from a public site, would you retry inside the client or in the test? Why?

Takeaway: API uses `old`/`new` (not `oldest`/`newest`) — pinned in [src/api/types.ts](src/api/types.ts). Retries belong in the client so individual specs stay declarative.

## Phase 4 — DOM exploration

I wrote a one-off TypeScript script that launched headless Chromium against `/search?q=Science` and dumped the markup of the four widgets I cared about (sort dropdown, language facet, pagination, result items). I deleted the script after harvesting the locators. AI's job: help me decode the markup once I had it.

I asked AI:

> Here's the rendered markup for Open Library's pagination control: it's a custom `<ol-pagination>` web component with no obvious ARIA roles on the host. The light-DOM children are real anchors. The "Next" anchor has `aria-label="Go to next page"`. For a Playwright POM that prefers role-based locators, would you target the anchor by `getByRole('link', { name: /go to next page/i })`, or fall back to a structural CSS locator on `ol-pagination`? Trade-offs?

Takeaway: role-based wins because it survives DOM restructures inside the web component. Same reasoning carried over to the `<ol-chip title="Filter results for X">` facets.

## Phase 5 — Page Object Model

I designed and wrote [src/pages/BasePage.ts](src/pages/BasePage.ts) and [src/pages/SearchResultsPage.ts](src/pages/SearchResultsPage.ts). The public surface I'd settled on: `gotoSearch`, `searchFromHeader`, `sortBy`, `currentSortLabel`, `filterByLanguage`, `selectedLanguageChip`, `goToNextPage`, `resultTitles`, `firstResultTitle`, `firstResultWorkKey`, `hitCountText`, `waitForLanguageFacet`. Before I wired four specs to it, I wanted a critique.

I asked AI:

> Critique my POM for an Open Library search results page. Public surface attached. Goals: (a) tests stay declarative — no CSS in specs; (b) one method per intent — `sortBy('oldest')` rather than `clickSortDropdown` + `selectOption`; (c) friendly aliases for inconsistent UI vocabulary, e.g. expose `'oldest'` even though the UI says `"First Published"`. Anything missing, anything redundant, anything that should split into a second page object?

Takeaway: AI flagged that `firstResultTitle` and `firstResultWorkKey` deserved a comment explaining *why* both exist (UI shows edition title, API returns work title — they identify the same record but rarely have byte-equal strings). Added the comment, kept the methods.

## Phase 6 — Specs

I wrote each spec myself, one per task in the brief. Two of them needed a quick AI consult.

For [tests/integration/sort-order.spec.ts](tests/integration/sort-order.spec.ts), the obvious assertion (`uiTitle === apiTitle`) was failing even when both records pointed at the same work. I asked AI:

> The UI shows `"Harry Potter and the Sorcerer's Stone"` for the first sorted-oldest result. The API returns `"Harry Potter and the Philosopher's Stone"` for `q=Harry+Potter&sort=old&limit=1`. Both `<a href>`s point at `/works/OL82563W`. I want a robust assertion that catches a real divergence (different work) but tolerates UI-edition vs API-work title differences. Concrete proposal: strict-compare the work key (`/works/OL\d+W`) extracted from the UI's `href`, plus a soft title check that normalises both strings (lowercase, strip leading articles, strip non-alphanumerics) and accepts "one is a prefix of the other". Holes in that approach?

Takeaway: shipped exactly that. Strict on identity, soft on prose.

For [tests/ui/language-filter.spec.ts](tests/ui/language-filter.spec.ts), my first attempt used `q=Science` to match the rest of the suite, but the language facet kept showing up empty. I asked AI:

> The language facet for `q=Science` keeps rendering as an empty container — body is the literal text "Loading...". Network tab shows `/partials/SearchFacets.json` returning `"Unable to render this page."`. Other queries render the facet fine. Is this a known OL pattern (specific high-cardinality queries break the partial) or am I misreading something? Either way, what's a defensible fallback query for a "filter results by Spanish" test that won't drift in popularity?

Takeaway: used `Harry Potter` as the language-spec query, with a comment in the test explaining why.

## Phase 7 — Day 2: anti-flake hardening

The first full `npm test` was nowhere near green. Each failure became its own diagnose-prompt-fix loop.

### Problem 1 — HTTP 429 throttling

I'd already added single-worker execution and pinned the test query so I could reproduce. The body was Open Library's plain-JSON 429 page.

I asked AI:

> My headless Chromium gets `{"status":429,...}` after ~6 navigations against openlibrary.org from a single host. I'm planning to add exponential backoff to two places: `BasePage.open()` for direct `goto`s (where I have the response object), and a separate `recoverFromRateLimit()` for click-driven navigations (where I don't, so I sniff the body for the 429 JSON shape). Reasonable shape? Anything I should add — jitter, max total time, status logging?

Takeaway: kept the design; added a clear final-throw error message that points at "wait a few minutes or run a single spec".

### Problem 2 — `/verify_human` bot challenge

This was the biggest single issue. I'd already escalated through several layers when I asked the question that mattered.

I asked AI:

> I'm being redirected to `/verify_human?next=/search?...` on every UI navigation. I've already added a real-Chrome user agent, `Sec-Ch-Ua` headers, `--disable-blink-features=AutomationControlled`, `channel: 'chrome'`, and an `addInitScript` that nulls `navigator.webdriver` and populates `languages`/`plugins`. Still gated. The challenge page is a one-button form that POSTs `/verify_human` and sets a `vf` cookie. What's the highest-leverage next thing to try, and what failure modes should I expect from each option (in-page POST vs API-context POST + cookie injection vs real click)?

Takeaway: layered all three. The in-page POST works most of the time but is brittle, so I made [passHumanVerification](src/pages/SearchResultsPage.ts) soft-fail and added `escapeVerifyHuman` as a retry loop. Then I pre-warmed the `vf` cookie via the Node-side `apiContext` in [src/fixtures/test.ts](src/fixtures/test.ts) so the first navigation is already verified — the API context's TLS fingerprint reliably gets through where headless does not.

### Problem 3 — Native `<details>` click flake

I asked AI:

> Open Library's sort dropdown is a native `<details class="sort-dropper">` with `<a>` options inside. Clicking the option directly times out — Playwright reports the element isn't visible, which makes sense because `<details>` keeps inner content `display: none` until expanded. I'd rather not click the `<summary>` first because that adds a coordinate dependency. Cleanest fix: programmatically set `details.open = true` via `evaluate()` and then click. Any pitfalls vs the click-the-summary approach?

Takeaway: shipped the `evaluate()` approach. No animation race, deterministic.

### Problem 4 — `<ol-pagination>` accessible name

Already covered in Phase 4 — the same prompt produced the locator I used.

### Problem 5 — Sort-order title mismatch

Already covered in Phase 6.

### Problem 6 — Degraded "No books matched" layout

I asked AI:

> Even for queries that returned 540k hits a moment ago, Open Library occasionally serves an alternate layout: "No books directly matched your search. Add a new book?" — no `.search-results-stats`, no `li.searchResultItem`. A reload usually fixes it. Best place to put a reload-with-backoff retry: inside `gotoSearch()` (so every search benefits) or in a single shared decorator? I want to keep specs unaware.

Takeaway: put it in `gotoSearch()`. Simple, local, the specs never see the degraded body.

## Phase 8 — Day 3: targeted refinements

After Day 2 the suite was passing on green runs but flaking under retries. The tail of long-tail issues, each with its own AI consult.

### Problem 7 — Language facet stuck on "Loading..."

I asked AI:

> The language-filter spec fails with `expect(locator).toHaveCount(1)` for `ol-chip[title="Filter results for Spanish"]` — 19 polls in 15 seconds, always 0 elements. A WebFetch of the same query confirms OL ships `<div class="facet language">` synchronously with body text "Loading..." and injects the `<ol-chip>` children later when `/partials/SearchFacets.json` resolves. My existing `waitForLanguageFacet` only checks the container's visibility. Two-part fix I'm planning: (a) wait for `ol-chip` *children* to attach, not just the container; (b) if the desired language isn't in the default top-N, click an in-facet "Show more" toggle and re-check. Holes?

Takeaway: built it. Added a diagnostic error that lists the visible chip titles when the desired one isn't found, so the next failure is actionable.

### Problem 8 — 60s test-timeout overrun

I asked AI:

> Page snapshot at the timeout cutoff shows the Spanish chip *was* in the DOM by then. So the assertions would have passed if the test had ~10s more. Stacked retries (gotoSearch up to ~32s + waitForLanguageFacet up to ~30s) are eating the 60s test budget. I'd rather lift the test-level timeout than lower the per-step timeouts (because a real green run is well under 30s and I don't want to hide regressions). Bump to 90s, plus trim `waitForLanguageFacet` to a single 12s wait + one reload retry — is that the right shape?

Takeaway: yes. Also pulled in AI's note that `expect.timeout` of 15s pairs naturally with that budget.

### Problem 9 — `waitForURL` hung on the `load` event

I asked AI:

> Browser logs show the URL has already navigated to `…?page=2` and `domcontentloaded` has fired, but `page.waitForURL(/page=\d+/)` blocked all the way to the 90s test timeout. I assume `waitForURL` defaults to `waitUntil: 'load'` and OL's web components keep `load` pending. Switching all three of my `waitForURL` calls (`sortBy`, `filterByLanguage`, `goToNextPage`) to `{ waitUntil: 'domcontentloaded' }` — risk?

Takeaway: low-risk for this site since the static markup already contains the result list. Made the change in [src/pages/SearchResultsPage.ts](src/pages/SearchResultsPage.ts).

### Problem 10 — Page-2 degraded layout

I asked AI:

> The same degraded "No books matched" layout I'd already handled in `gotoSearch` is now showing up on `?page=2` after a `goToNextPage`. URL is correct, body is wrong. The cleanest fix is to check `resultItems` after `escapeVerifyHuman` returns and reload the target href if empty. Cap retries at 2. Anything I'm missing, e.g. waiting on a network idle event before deciding the page is "done"?

Takeaway: shipped exactly that. No `networkidle` — `domcontentloaded` + a visible-check on `resultItems` is sufficient and stays inside the budget.

### Problem 11 — API 5xx retries

I asked AI:

> The API spec just failed once with a clean 500 from `/search.json`. My `rawSearch` retries on 429 today. Strict argument for / against also retrying on any 5xx for a public read-only endpoint?

Takeaway: extended to retry on 429 *or* any 5xx with the existing exponential backoff. Read-only endpoint, idempotent query, transient backend warmup — safe.

## Phase 9 — Documentation

I wrote [README.md](README.md) and [TEST_PLAN.md](TEST_PLAN.md) in the developer voice. AI's job was to gut-check the troubleshooting tables and risk register — does the matrix actually cover the failure modes the suite handles?

I asked AI:

> I've added a Troubleshooting table to README.md and a Risks & Mitigations section to TEST_PLAN.md. Cross-reference these against the actual defences in the code (BasePage retry, OpenLibraryApi retry, escapeVerifyHuman, vf cookie pre-warm, waitForLanguageFacet reload, `domcontentloaded` waitForURL). Is anything documented but not implemented, or implemented but not documented?

Takeaway: tightened a couple of rows so each defence in code has exactly one row in the docs and vice versa.
