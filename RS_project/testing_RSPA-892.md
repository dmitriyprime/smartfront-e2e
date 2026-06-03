# RSPA-892 — Manual Test Cases

**Feature:** Calculation → "Pricing Table" page rework (search modes, new pricing
columns, free-shipping/surcharge/freight handling, performance rewrite, Telescope).
**Page under test:** `http://feda.loc/` → **Magento Export / Calculation** page
(grids `#category_calculation` and `#product_calculation`).
**API under test:** `GET /api/v1/calculation/products` and
`GET /api/v1/calculation/categories`.

## Test data (from dev DB `oners_dev`)
| Purpose | Product ID | SKU | Notes |
|---------|-----------|-----|-------|
| Override **enables** free shipping | 643185 | `669_1031013` | `override.free_shipping = '1'` |
| Override `'0'` **overrides** vendor `'1'` | 6721 | `1016_CK10` | override=`0`, vendor=`1` |
| Empty calc → **vendor fallback** | 340398 | `17167_B1-C2-22-SR422` | calc=`''`, vendor=`0` |
| Surcharge vendor (`is_surcharge=1`) | 6391 | `3019_1/2'' SHUT-OFF BALL VALVE KIT` | category "3M Purification" |
| **Discontinued** (must be hidden) | 1, 22 | `9971465_167HNDLHLDBK` | `netsuite_item_status='Discontinued'` |
| Category-search sample | — | — | category name e.g. `3M Purification`, `Advance Tabco` |

> Free-shipping values in the DB are **strings** (`'0'`, `'1'`, `''`) — keep that
> in mind when judging expected output.

---

## A. Page load & grid rendering

### TC-A1 — Pricing Table loads with bootgrid UI
**Pre:** Logged in as a user allowed to view Calculation.
**Steps:** Open the Calculation page.
**Expected:**
- Two grids render: top "Calculation" (categories) and a second titled **"Pricing Table"** (products).
- Product grid uses the new **bootgrid** style (bordered), with flaticon icons (`fi fi-rr-*`) for sort/search/refresh — no old FontAwesome `fas fa-*` icons.
- A "Loading Vendors..." placeholder shows briefly, then rows load.
- Pagination control appears; default page size and the options `10 / 25 / 50 / 1000 / 10000` are selectable.

### TC-A2 — All new columns present
**Steps:** Inspect the Pricing Table header row.
**Expected:** Columns include: SKU, Model, Category, Weight, Net Price, List Price,
Surcharge, Freight, Freight Updated At, Cost, MAP, MRP, NBC Price, Free Shipping,
Vendor Free Shipping, Lift Gate, Override, and per-bridge prices for **IMP / KRS / RST**
(`map_price`, `login_price`, `call_price` each). Empty price cells render as `0`.

### TC-A3 — Horizontal scroll behavior
**Steps:** Scroll the Pricing Table horizontally to the right, then back left.
**Expected:** The table is wrapped in a scrollable container; scrolling right toggles a
`table-scrolled-left` state (left columns stay visually anchored / shadow appears). No layout break.

### TC-A4 — "Download Key Table" button
**Steps:** Look at the category grid action bar; click **Download Key Table**.
**Expected:** A "Download Key Table" button appears in the bootgrid action bar (not as a
separate old button block) and triggers the `calculation.export_categories` download.

---

## B. Search modes (the core new feature)

The product grid has a **search-mode dropdown** (`#product_search_mode`) with options:
**Category**, **SKU (Full)**, **SKU (Model)**, **ID**. Default = **Category**.

### TC-B1 — Default mode is Category
**Steps:** Load the page; in the search box type a category prefix, e.g. `3M`.
**Expected:** Dropdown shows "Category" selected by default. Results are products whose
**category name** starts with `3M` (e.g. category "3M Purification"). Prefix match
(`LIKE '3M%'`) — categories not starting with the term are excluded.

### TC-B2 — SKU (Full) mode — prefix match on `sku`
**Steps:** Select **SKU (Full)**; search `1016_`.
**Expected:** Grid reloads; returns products whose `sku` **starts with** `1016_`
(e.g. `1016_CK10`). Partial/middle matches are excluded (it is a prefix `LIKE '1016_%'`).

### TC-B3 — SKU (Model) mode — prefix match on `model`
**Steps:** Select **SKU (Model)**; search a known model prefix.
**Expected:** Grid reloads; returns products whose `model` starts with the term.

### TC-B4 — ID mode — exact match
**Steps:** Select **ID**; search `643185`.
**Expected:** Grid returns **exactly** the product with id `643185`. Searching a partial id
(e.g. `64318`) returns **no** rows — ID mode is an exact `=` match, not a prefix.

### TC-B5 — Switching mode reloads the grid
**Steps:** With a term in the box, switch between modes.
**Expected:** Each switch reloads the grid (`requestHandler` sends `searchMode`), the
dropdown label updates to the chosen mode, and results change accordingly.

### TC-B6 — Empty search returns full (paginated) list
**Steps:** Clear the search box.
**Expected:** Grid shows all active products, paginated. The total count reflects all
active products, not the filtered subset.

### TC-B7 — Invalid/unknown searchMode falls back to Category
**Steps (API):** Call `GET /api/v1/calculation/products?searchMode=bogus&searchPhrase=3M&...`.
**Expected:** Request is accepted (validation is `nullable`) and behaves as **Category**
mode (server defaults unknown values to `ProductSearchMode::Category`).

---

## C. Active-product scope (filtering)

### TC-C1 — Discontinued products are hidden
**Steps:** Search for SKU `9971465_167HNDLHLDBK` (product id 1) in **SKU (Full)** mode.
**Expected:** **No row** is returned — products with `netsuite_item_status = 'Discontinued'`
are excluded by the `active()` scope.

### TC-C2 — Products without a category are hidden
**Steps:** (DB-assisted) Identify a product with no `category_id`; search for it.
**Expected:** It does not appear — `active()` requires `has('category')`.

### TC-C3 — Total count matches active set
**Steps:** Note the grid "X to Y of TOTAL" label with no search term.
**Expected:** TOTAL equals the count of active products (has category, not discontinued),
not the raw `products` table count (912,484).

---

## D. Free shipping resolution (`formatFreeShipping`)

Resolution order: **calculation value** → if `''`, use **vendor** value → if an
**override** exists and is not `null`/`''`, use the **override**.

### TC-D1 — Override enables free shipping
**Steps:** Find product `643185` (`669_1031013`).
**Expected:** Free Shipping column shows **enabled (1)** — override `'1'` wins over
calc/vendor.

### TC-D2 — Override `'0'` overrides vendor `'1'`
**Steps:** Find product `6721` (`1016_CK10`): calc=`0`, vendor=`1`, override=`0`.
**Expected:** Free Shipping shows **disabled (0)** — override `'0'` is applied (this is the
case fixed in commit `4255496f8`; a regression would show `1` from the vendor).

### TC-D3 — Empty calc falls back to vendor
**Steps:** Find product `340398` (`17167_B1-C2-22-SR422`): calc=`''`, vendor=`0`, no override.
**Expected:** Free Shipping shows the **vendor** value (`0`).

### TC-D4 — Empty-string override does NOT blank the value (regression guard)
**Steps:** Find a product whose override `free_shipping` is `''` (empty) but whose
calc/vendor value is `1`.
**Expected:** Free Shipping reflects calc/vendor (`1`), **not** blank. The empty-string
override must be ignored.

### TC-D5 — Vendor Free Shipping column
**Expected:** The separate **Vendor Free Shipping** column always shows the raw vendor
value, independent of the resolved Free Shipping column.

---

## E. Surcharge price formatting (`formatPrices`) — high-risk area

When the product's vendor has `is_surcharge = 1`, every price field is multiplied by
`(1 + surcharge)` and rounded to 2 decimals.

### TC-E1 — Surcharge applied to all price fields
**Steps:** Open product `6391` (3M Purification, `is_surcharge=1`). Record `surcharge`.
**Expected:** `cost, net_price, nbc_price, list_price, map, mrp`, and all
`imp/krs/rst -- map_price|login_price|call_price` values equal
`round(base * (1 + surcharge), 2)`. Cross-check at least 2 fields against the raw DB
values × (1 + surcharge).

### TC-E2 — No surcharge vendor unchanged
**Steps:** Open a product whose vendor has `is_surcharge = 0`.
**Expected:** Price fields are shown **as stored**, with no surcharge multiplier applied.

### TC-E3 — Surcharge = 0 edge
**Steps:** Open a surcharge-vendor product with `surcharge = 0`.
**Expected:** Prices are unchanged (× 1.0) — no rounding artifacts that alter the value.

---

## F. Per-bridge (store) prices

Bridge mapping: **IMP=3, KRS=4, RST=5**; each product has 3 `product_bridge_calculations` rows.

### TC-F1 — Each bridge column maps to the correct bridge
**Steps:** Pick any product; compare grid `imp--map_price / krs--map_price / rst--map_price`
(and login/call) to the DB `product_bridge_calculations` rows by `bridge_id`.
**Expected:** `imp--*` = bridge_id 3, `krs--*` = bridge_id 4, `rst--*` = bridge_id 5.
(If surcharge applies, values are surcharge-adjusted per TC-E1.)

### TC-F2 — Missing bridge calc renders 0
**Steps:** (DB-assisted) Find a product missing one bridge row, if any.
**Expected:** The corresponding cell renders `0` rather than erroring.

---

## G. Freight & other columns

### TC-G1 — Freight value rounded
**Expected:** Freight column shows the calculation `freight` rounded to 2 decimals.

### TC-G2 — Freight Updated At
**Expected:** Freight Updated At column shows `calculation.freight_updated_at`
(date/time) for the product.

### TC-G3 — Override flag
**Steps:** Compare a product that has a `product_calculation_overrides` row (e.g. `6721`)
vs one without.
**Expected:** **Override** column is true/flagged when an override record exists, false otherwise.

### TC-G4 — Lift Gate
**Expected:** Lift Gate column reflects `net_suite_data.lift_gate`.

---

## H. Pagination & performance

### TC-H1 — Pagination works (simplePaginate)
**Steps:** Page through results using next/prev with various page sizes.
**Expected:** Pages advance correctly; `current` page param drives the offset; no
duplicate/missing rows across pages.

### TC-H2 — Large page size does not hang
**Steps:** Set page size to 1000 (and 10000) with no search term.
**Expected:** Grid loads within an acceptable time. (Use Telescope to confirm the query
count — see TC-I1; expect the list query + a separate count query.)

### TC-H3 — Category grid still functions
**Steps:** Verify the top category-calculation grid loads and the **Calculate** (pencil)
action opens the category edit modal.
**Expected:** Category grid loads; edit modal is a draggable=false **modal** dialog and
saves correctly.

---

## I. Infrastructure

### TC-I1 — Laravel Telescope reachable
**Steps:** Visit `/telescope` (in the appropriate/local environment).
**Expected:** Telescope dashboard loads; loading the Pricing Table records its requests
and DB queries (useful to confirm the per-page list + count query behavior).

### TC-I2 — Scheduled vendor pricing command registered
**Steps (container):** `php artisan schedule:list`.
**Expected:** `vendors:update:pricing-date` is listed on cron `0 8 * * 2,5`
(Tue & Fri 08:00), `withoutOverlapping`, `runInBackground`.

### TC-I3 — Vendor commands available
**Steps (container):** `php artisan list | grep vendors`.
**Expected:** `vendors:update:pricing-date` (and related Vendor Pricing/Update commands)
are registered and runnable.

---

## J. Regression / negative

### TC-J1 — Deprecated path not used
**Expected:** The new Eloquent path serves the grid (the legacy
`App\Models\Product\Collection::getValues()` / `DEBUG_DEPRECATED` fallback is **off**).
Data shown matches the new query, not the old collection output.

### TC-J2 — No console / PHP errors
**Steps:** With browser devtools open, exercise search, pagination, and modal.
**Expected:** No JS console errors, no 4xx/5xx on the API calls, no PHP exceptions in logs.

### TC-J3 — Permissions respected
**Steps:** Log in as a user **without** `CALCULATION_EDIT`.
**Expected:** The **Calculate** action column/button is hidden for the category grid;
read-only viewing of the Pricing Table still works.

---

## Sign-off
| Area | Result (Pass/Fail) | Tester | Notes |
|------|--------------------|--------|-------|
| A. Page load & rendering | | | |
| B. Search modes | | | |
| C. Active scope | | | |
| D. Free shipping | | | |
| E. Surcharge | | | |
| F. Bridge prices | | | |
| G. Freight & columns | | | |
| H. Pagination & perf | | | |
| I. Infrastructure | | | |
| J. Regression | | | |
