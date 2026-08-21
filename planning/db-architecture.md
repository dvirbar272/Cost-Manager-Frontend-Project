# Data Layer Architecture — Cost Manager

Owner: data layer (localStorage persistence, `db.js` in both flavours, exchange rates, reports).
Consumer: the React UI (charts, report screen, settings screen).

This document is the contract. Nothing here is implemented yet — it exists so the UI can be
built in parallel against a stable API.

---

## 0. The one constraint that drives every other decision

The assignment's test file is not negotiable, and it is **synchronous**:

```js
const data = db.getReport("USD");
console.log(data.total.sum);   // must print a number, not undefined
```

If `getReport` returned a Promise, this line prints `undefined`. Therefore:

> **Every graded DB function is synchronous. Only exchange-rate fetching is async.**

Two consequences that ripple through the rest of this document:

1. The store is `localStorage` (synchronous), not IndexedDB (asynchronous) — despite the
   IndexedDB-flavoured names `openCostsDB` / `databaseVersion`. `CLAUDE.md` mandates
   `localStorage` anyway, so the two requirements agree.
2. `getReport` can never `await` a `fetch`. It reads exchange rates from a **synchronously
   available cache** (memory → localStorage → hard-coded fallback). The React app warms that
   cache with one async refresh at startup.

---

## 1. File / folder structure

```
cost-manager/
├─ index.html                  # loads /db.js (classic) BEFORE /src/main.jsx (module)
├─ package.json
├─ vite.config.js
├─ public/                     # served verbatim at the deploy root
│  ├─ db.js                    # ★ SINGLE SOURCE OF DB LOGIC — the graded file
│  ├─ db-test.html             # assignment test file, byte-for-byte unmodified
│  ├─ db-manual-test.html      # extra scenarios (conversion, filtering, bad input)
│  └─ rates.json               # self-hosted exchange rates (see §4)
├─ src/
│  ├─ db/
│  │  └─ db.module.js          # ESM adapter over window.db — contains no logic
│  ├─ components/              # teammate's UI
│  └─ main.jsx
└─ planning/
   └─ db-architecture.md       # this document
```

### How the two versions of db.js stay in sync

**Single source of logic, thin wrapper, no build step.**

The vanilla file has to work when the grader loads *only* `<script src="db.js">`, with no other
files present. A classic script cannot `import`, so the vanilla file cannot pull in a shared
core. The dependency direction is therefore inverted from the obvious one:

- **`public/db.js` is the single source of all DB logic.** A self-contained classic-script IIFE
  that assigns `window.db`. This is the graded file, submitted separately, unchanged.
- **`src/db/db.module.js` is a ~20-line ESM adapter** that reads `window.db` and re-exports its
  functions as named ESM exports. It holds no logic, so there is nothing to keep in sync.
- `index.html` loads `<script src="/db.js"></script>` before the React module bundle. Classic
  scripts execute before deferred module scripts, so `window.db` is always defined by the time
  React imports the adapter. The adapter throws one clear error if it somehow isn't.

Trade-off, stated plainly: React reaches the DB through a global loaded by a script tag rather
than through a real ESM import graph (no tree-shaking — irrelevant at this file size). If pure
ESM imports ever become necessary, the escape hatch is a ~10-line `npm run build:db` concat
script that generates `public/db.js` from an ESM core. That is a fallback, not the plan.

### Notes on the layout

- `public/db-test.html` sits **next to** `public/db.js` on purpose. The test file's
  `<script src="db.js">` is a relative path and the file may not be modified, so the two must be
  siblings. This deviates from the `/tests/db-test.html` location suggested in `CLAUDE.md`;
  putting it under `tests/` would require keeping a duplicate copy of `db.js` there.
- Shared constants (`CURRENCIES`, `DEFAULT_RATES_URL`) are **exposed by `db.js`** and re-exported
  by the adapter — never re-declared on the React side.
- Vite serves `public/` at the site root in both dev and production, so `/db.js`, `/rates.json`
  and `/db-test.html` resolve identically locally and once deployed.

---

## 2. Public API

### Lifecycle

```
db.openCostsDB(databaseName = "costsdb", databaseVersion = 1) -> DBHandle
```

Creates or opens the store, runs migrations if needed, and returns a handle exposing every method
below. Idempotent — calling it twice with the same name returns an equivalent handle.

Both `db.*` and the returned handle expose `addCost` / `getReport`, because the assignment's test
calls `ob.addCost(...)` on the handle but `db.getReport(...)` on the global. The `db`-level
functions operate on the most recently opened database, defaulting to `("costsdb", 1)` if
`openCostsDB` was never called.

### Graded functions — exact assignment shapes

```
addCost(cost) -> Cost
  cost: { sum: number|numeric-string, currency: Currency, category: string, description: string }
  Returns the stored item: { sum, currency, category, description } (+ internal id/date).
  The date is set automatically to "now". Throws Error with a readable message on invalid input.

getReport(currency, year?, month?) -> Report
  currency : "USD" | "ILS" | "GBP" | "EURO"
  year     : full year, e.g. 2026   — defaults to the current year
  month    : 1–12 (1 = January)     — defaults to the current month
```

```jsonc
// Report — exactly the assignment's shape, nothing added
{
  "year": 2026,
  "month": 9,
  "costs": [
    { "sum": 200, "currency": "USD", "category": "Food",
      "description": "Milk 3%", "date": { "day": 12 } }
  ],
  "total": { "currency": "USD", "sum": 440 }
}
```

**Conversion rule:** each row keeps its **original** `sum` and `currency`. Only `total.sum` is
converted into the requested `currency`. This matches `CLAUDE.md` — "each cost item keeps its
original currency in storage; conversion happens at display/report time only".

### Extra functions for the UI

The assignment permits additional functions. These exist so `getReport`'s graded shape stays
pristine while the UI still gets everything it needs.

```
getReportDetailed(currency, year?, month?) -> DetailedReport
  The same object as getReport, but each cost also carries:
    convertedSum : number   // row value in the requested currency, 2dp
    date         : { day, month, year, iso }
    id           : number
  Use this one for the detailed-report screen.

getCategoryTotals(currency, year?, month?) -> [{ category, total }]
  For the pie chart. Sorted descending by total. Empty array when there is no data.

getYearlyTotals(currency, year?) -> [{ month, total }]
  For the bar chart. Always 12 entries, month 1–12 in order, missing months as total 0.

deleteCost(id) -> boolean
clearAll() -> void            // wipes costs for the open DB; used to reset between test runs
getAllCosts() -> Cost[]       // raw rows, original currencies
convert(sum, fromCurrency, toCurrency) -> number   // uses the cached rates
```

### Exchange rates and settings — the only async surface

```
getExchangeRates(options?) -> Promise<RatesResult>
  options: { force?: boolean }   // force: true bypasses the TTL
```

```jsonc
// RatesResult
{
  "rates":     { "USD": 1, "GBP": 0.6, "EURO": 0.7, "ILS": 3.4 },
  "source":    "network" | "cache" | "fallback",
  "fetchedAt": 1755400000000,   // epoch ms, null when source is "fallback"
  "url":       "https://…/rates.json",
  "error":     null              // string message when source !== "network"
}
```

**This promise never rejects.** A failed fetch resolves with the best rates available plus a
populated `error`, so the settings screen can show "couldn't reach that URL — still using the
previous rates" instead of crashing.

```
getCachedRates() -> Rates            // synchronous; what getReport uses internally
getRatesUrl() -> string              // the custom URL, or DEFAULT_RATES_URL
setRatesUrl(url) -> void             // validates http(s); "" resets to default; clears the cache
db.CURRENCIES -> ["USD", "ILS", "GBP", "EURO"]
db.DEFAULT_RATES_URL -> string
```

Settings-screen flow: `setRatesUrl(url)` → `await getExchangeRates({ force: true })` → show
`source` / `error` to the user.

### Validation rules for `addCost`

| Field | Rule |
|---|---|
| `sum` | finite number `> 0`; numeric strings from `<input type="number">` are coerced |
| `currency` | must be one of `USD` / `ILS` / `GBP` / `EURO` (note: **`EURO`**, not `EUR`) |
| `category` | non-empty after trim |
| `description` | non-empty after trim |

Violations throw `Error` with a message the UI can render directly.

---

## 3. localStorage schema

| Key | Contents |
|---|---|
| `<databaseName>.meta` | `{ "version": 1, "createdAt": "ISO", "lastId": 12 }` |
| `<databaseName>.costs` | array of cost records (below) |
| `costmanager.settings` | `{ "ratesUrl": "https://…" }` — app-level, not part of the graded DB |
| `costmanager.ratesCache` | `{ "url": "…", "fetchedAt": 1755400000000, "rates": { … } }` |

```jsonc
// one cost record
{
  "id": 7,
  "sum": 200,
  "currency": "USD",
  "category": "FOOD",
  "description": "pizza",
  "date": "2026-08-17T10:32:05.123Z"
}
```

- `id` is a monotonic integer taken from `meta.lastId`.
- `date` is stored as an ISO string. `year` / `month` / `day` are **derived with local-time
  getters** everywhere (`getFullYear`, `getMonth() + 1`, `getDate`), so report filtering matches
  the date the user saw when the item was added.
- **`month` is 1-based (1 = January) across the entire public API.** Internal `Date` handling is
  the only place 0-based months appear. This is the single most likely place for an off-by-one
  bug between the data layer and the UI, so it is worth stating twice.

### `databaseVersion` handling

`meta.version` records the schema version currently on disk. `openCostsDB(name, requestedVersion)`
behaves as follows:

1. No `meta` → create it at `requestedVersion` and initialise `costs` to `[]`.
2. `meta.version === requestedVersion` → open as-is.
3. `meta.version < requestedVersion` → run each step of an ordered `MIGRATIONS` map
   (`{ 2: fn, 3: fn }`) in sequence, rewriting rows in place, then stamp the new version. The map
   is empty today; the hook exists so that a later schema change never orphans existing data.
4. `meta.version > requestedVersion` → throw. A newer build of the app wrote this store, and
   silently downgrading it would lose data.

### Storage resilience

Every `localStorage` read and write is wrapped in try/catch and falls back to an in-memory `Map`
for the lifetime of the page. This keeps `db.js` working under `file://`, in Incognito, and with
site data blocked — which matters because the grader may open `db-test.html` straight from disk
rather than through a server. Writes additionally catch `QuotaExceededError` and surface a
readable message instead of a raw DOM exception.

---

## 4. Exchange rates: fetching, caching, failure

### Hosting

`public/rates.json` lives in this repo and is deployed alongside the app, which satisfies the
requirement for "a static JSON file you host yourself on the web":

```json
{ "USD": 1, "GBP": 0.6, "EURO": 0.7, "ILS": 3.4 }
```

All rates are relative to 1 USD (3.4 ILS = 1 USD).

### Default URL

`DEFAULT_RATES_URL` is an **absolute** deployed URL —
`https://cost-manager-frontend-project.onrender.com/rates.json` — filled in once after the first deploy. It must not be
a relative path: the standalone `db.js` is graded outside the app's origin, where `/rates.json`
would 404.

### Cache layers, in order

1. In-memory, for the current page load.
2. `costmanager.ratesCache` in localStorage, considered fresh for a **1-hour TTL**.
3. Hard-coded `FALLBACK_RATES` compiled into `db.js`.

`getCachedRates()` walks that chain synchronously and always returns a usable rates object. This
is what makes a synchronous `getReport` possible.

### When a fetch happens

At app startup (React calls `getExchangeRates()` once), when the user saves a new URL in
Settings, when the cache is older than the TTL, and on an explicit `{ force: true }`.
**`getReport` never fetches.**

### Failure handling

`fetch` is wrapped with an `AbortController` timeout of roughly 8 seconds. A non-OK status, a
timeout, a network error, unparseable JSON, and a payload that fails validation all take the same
path: keep the previous rates, resolve with `source: "cache"` (or `"fallback"` if there was no
cache) and a human-readable `error`. Nothing throws into the UI, and a mistyped custom URL in
Settings can never brick the app.

### Payload validation

A fetched payload must be a plain object containing all four keys `USD`, `GBP`, `EURO`, `ILS`,
each a finite number greater than 0. Extra keys are ignored. A rejected payload never overwrites
a good cache.

### Conversion math

Rates are per 1 USD, so:

```
convert(sum, from, to) = sum / rates[from] * rates[to]
```

Rounded to 2 decimals with `Math.round(x * 100) / 100`. Totals are accumulated at full precision
and rounded **once** at the end, so displayed rows never fail to add up to the displayed total.

---

## 5. Verifying db.js

`public/db-test.html` is the assignment's file, copied in **unmodified** — same
`<script src="db.js">`, same `test()` body, same `console.log` calls. Run it after **every**
change to `db.js`:

```
npm run dev   →   open http://localhost:5173/db-test.html   (with DevTools console open)
```

Expected console output on a clean store:

```
creating db succeeded
adding 1st cost item succeeded
adding 2nd cost item succeeded
600
```

`600` = 200 + 400, both already in USD, both added "now" and therefore inside the current month
that the argument-less `getReport("USD")` defaults to.

Note that the test is **cumulative**: a second run without clearing prints `1200`. Reset via
DevTools → Application → Local Storage, or by running
`db.openCostsDB("costsdb", 1).clearAll()` in the console.

Also verify:

- **`file://`** — open `public/db-test.html` directly from disk in Chrome, the way a grader
  might. It must produce the same four lines. This is exactly what the storage fallback in §3
  protects against.
- **After deploy** — `https://<app>.onrender.com/db-test.html` in the latest desktop Chrome,
  which is the grading browser.

`public/db-manual-test.html` is an extra, non-graded page that prints a checklist to the console
covering: multi-currency totals with conversion, month/year filtering including an empty month,
items on a year boundary, `getCategoryTotals` / `getYearlyTotals` shapes (12 entries, zeros
present), every `addCost` validation error, `setRatesUrl` with a deliberately broken URL
producing `source: "fallback"` plus an `error`, and a `getReport` call with the rates cache
cleared.

---

## API Contract — copy-paste for the UI

```js
// db.js is loaded by index.html and sets window.db.
// React code imports the thin ESM adapter:
import {
  addCost, getReport, getReportDetailed,
  getCategoryTotals, getYearlyTotals,
  getExchangeRates, getRatesUrl, setRatesUrl,
  CURRENCIES,
} from './db/db.module.js';

CURRENCIES // ["USD", "ILS", "GBP", "EURO"]   <- note "EURO", not "EUR"
// month is ALWAYS 1-12 (1 = January), everywhere in this API.
// Everything below is SYNCHRONOUS except getExchangeRates.

// --- add ---
addCost({ sum: 200, currency: "USD", category: "FOOD", description: "pizza" });
// -> the stored cost. Date is set automatically. THROWS Error(message) on invalid input.

// --- detailed report screen ---
getReportDetailed("ILS", 2026, 8);
// -> { year, month,
//      costs: [{ id, sum, currency, category, description,
//                convertedSum, date: { day, month, year, iso } }],
//      total: { currency: "ILS", sum: 1234.5 } }
// rows keep their ORIGINAL currency in `sum`/`currency`; `convertedSum` is in the requested one.

// --- pie chart: totals by category, one month ---
getCategoryTotals("USD", 2026, 8);   // -> [{ category: "FOOD", total: 320.5 }, ...]

// --- bar chart: totals per month, one year ---
getYearlyTotals("USD", 2026);        // -> [{ month: 1, total: 0 }, ... { month: 12, total: 88 }]
// always 12 entries, in order, zeros included.

// --- settings screen ---
getRatesUrl();                         // -> current URL (custom, or the built-in default)
setRatesUrl("https://.../rates.json"); // sync; validates http(s); "" resets to default
const r = await getExchangeRates({ force: true });
// -> { rates, source: "network"|"cache"|"fallback", fetchedAt, url, error }
// NEVER rejects. Show r.error when r.source !== "network".
```

Two things you can rely on: charts and reports never need `await` (rates are already cached), and
the app still renders if the rates endpoint is down (it falls back and tells you via `error`).
