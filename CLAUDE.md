# Cost Manager — Frontend Project

## Overview
Front-end-only web application that works as a personal cost manager.
- UI language: English
- Main/default currency: USD
- Data persistence: browser `localStorage` only (no real backend/database)
- Stack: vanilla JavaScript, HTML, CSS. React + MUI is allowed as an alternative, but not required.
- Must run correctly in the **latest version of Google Chrome (desktop)** — this is the browser used for grading.

## Core Features
1. **Add cost item** — user provides: `sum` (number), `currency` (string), `category` (string), `description` (string). The item's date is automatically set to the date it was added.
2. **Detailed report** — for a specific month + year, converted into a currency the user selects.
3. **Pie chart** — total costs by category, for a selected month + year.
4. **Bar chart** — total costs per month, across all 12 months of a selected year.
5. **Currency conversion** — both charts and the report must support converting into a user-selected currency. Each cost item keeps its **original currency** in storage; conversion happens at display/report time only.
6. **Settings screen** — lets the user provide a custom URL for fetching exchange rates. If the user never sets one, the app must still work using a default/hard-coded URL.

## Currency Requirements
- Supported currencies (use these exact symbols, no others): `USD`, `ILS`, `GBP`, `EURO`
- Exchange rates are fetched via the **Fetch API** from a static JSON file **you host yourself** on the web (e.g. a JSON file on Render/GitHub Pages/similar). This is not optional — it must be a real deployed endpoint, not a mock.
- Expected JSON response shape from that endpoint:
  ```json
  {"USD": 1, "GBP": 0.6, "EURO": 0.7, "ILS": 3.4}
  ```
  All rates are relative to 1 USD (e.g. 3.4 ILS = 1 USD).

## db.js Library (separate, graded deliverable)
Build **two versions** of the same library:
1. **ES module version** — for use inside a React app (if you go the React route).
2. **Vanilla version** — attaches a global `db` object when loaded via `<script src="db.js">`. **This is the version submitted separately** and the one used for automated grading.

Required functions (you may add more beyond these three):

- `openCostsDB(databaseName, databaseVersion)` → returns an object representing the DB.
- `addCost(cost)` → `cost = {sum, currency, category, description}` → returns the added cost object (same shape).
- `getReport(currency, year, month)` → `year`/`month` are optional; default to current month/year if omitted. Returns:
  ```json
  {
    "year": 2025,
    "month": 9,
    "costs": [
      {"sum": 200, "currency": "USD", "category": "Food", "description": "Milk 3%", "date": {"day": 12}},
      {"sum": 120, "currency": "GBP", "category": "Education", "description": "Zoom License", "date": {"day": 18}}
    ],
    "total": {"currency": "USD", "sum": 440}
  }
  ```

**The vanilla db.js must pass this exact test file, unmodified:**
```html
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Title</title></head>
<body>
  <script src="db.js"></script>
  <script>
    function test() {
      try {
        const ob = db.openCostsDB("costsdb", 1);
        const result1 = ob.addCost({sum: 200, currency: "USD", category: "FOOD", description: "pizza"});
        const result2 = ob.addCost({sum: 400, currency: "USD", category: "CAR", description: "fuel"});
        if (ob) console.log("creating db succeeded");
        if (result1) console.log("adding 1st cost item succeeded");
        if (result2) console.log("adding 2nd cost item succeeded");
        const data = db.getReport("USD");
        console.log(data.total.sum);
      } catch (exception) {
        console.log(exception.message);
      }
    }
    test();
  </script>
</body>
</html>
```
Keep this as an actual test file in the repo (e.g. `/tests/db-test.html`) and run it after every change to db.js.

## Code Style
- Comments only in `/* */` or `//` style — **no JSDoc**.
- Keep code clean, consistent, and commented — this will be manually reviewed from a PDF printout, so readability matters more than usual.

## Explicitly Out of Scope for Claude Code
These are submission/logistics requirements from the assignment, not coding tasks — don't let Claude Code spend time on them:
- Recording the demo video, packaging the ZIP, building the submission PDF, Moodle upload steps.
- Team member info, forum-related admin.

## Deployment Note
Final project must be deployed live on the web (e.g. Render) and Chrome-tested. Structure the app so it doesn't depend on `localhost`-only paths or anything that breaks once deployed.
