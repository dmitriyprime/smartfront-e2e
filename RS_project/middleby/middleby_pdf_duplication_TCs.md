# Test Cases: MiddleBy Warranty Sheet — Duplication & Data Loss (RSPA-719)

Manual test cases for two residual defects that remain **after** the duplication fix
`20b1f09ec` ("RSPA-719. 5. Documents. Filtering").

- **Reference issue:** `middleby_pdf_duplication_issue.md`
- **Fix under test:** `Modules/ImportMiddleBy/app/Services/MiddleByProductMapper.php::updateDocuments()`
- **Environment:** dev / `oners_dev`
- **Severity:** Bug A — Medium (duplicate PDF); Bug B — High (document silently lost)

---

## 🔴 RESOLVED (2026-07-24) — these are NOT real defects; analysis was wrong

Re-running the Imperial (vendor 311) import on **dev** (log 7451) shows **Bug A does not occur**: a
crosstab over all 1973 vendor-311 products gives **perfect mutual exclusion** — 0 products carry both
an AQ and a MiddleBy warranty sheet; the 17 former "Bug A" products lost their AQ warranty while
**keeping** their AQ cutsheet.

**Root cause of the mistaken analysis:** this document reasons from
`ProductAqFileAttributeMapper::detectMediaType()` (which types a warranty sheet as `cutsheet`). That
parser is a fallback for the **flat AQ-file import** only. The actual document-persistence path is
`ProcessProductDocument` → `PdfHandler::getProduct` → `AutoQuote::getProduct` (**live AQ API**) →
`PdfHandler::getDocumentsData` → `DocumentService::syncProductDocuments` (detaches docs not in the new
set). On that path, `getDocumentsData()` and `MiddleByProductMapper::updateDocuments()` both read
`$document['mediaType']` **directly from the AQ-API document objects** — nothing recomputes it. The AQ
API supplies `mediaType` natively from the canonical vocabulary
`PdfHandler::$specialMediaTypes = [cutsheet, warrantysheet, brochure, manual, catalogpage]`, so a
warranty sheet arrives typed **`warrantysheet`**, matches the MiddleBy `warrantysheet`, and is
correctly de-duplicated. The `sheet → cutsheet` collapse never happens on this path.

Confirmed on `oners_dev`: deployed `detectMediaType()` is byte-identical to git (no hotfix); the
`product_aq_files` cache is effectively empty (1 row, no documents) so every product is sourced from
the live API.

**Both Bug A and Bug B are empirically confirmed NOT real** (2026-07-25):
- **Bug A** — vendor 311 (Imperial) re-import: 0 products with both AQ + MiddleBy warranty.
- **Bug B** — vendor 36 (ANETS) re-import: products 16479 & 16480 (each has a MiddleBy spec sheet and
  **no** MiddleBy warranty) **kept** their AQ warranty sheet `13932` — 2 kept, 0 lost. No data loss.

**The fix `20b1f09ec` works as intended, including for warranty sheets.** The test cases below are
**invalid** and kept only as a record of the investigation. (Optional 100% confirmation: `tinker` on
dev — `app(App\Models\Product\PdfHandler::class)->getDocumentsData(app(App\Models\Product\PdfHandler::class)->getProduct('4158d63d-fe5b-e011-bf97-001018721196'))` — inspect the `mediaType` values.)
The only residual, theoretical exposure is the flat-**file** import path (`detectMediaType`), which is
not in active use.

---

## Background — why these bugs exist

The fix deduplicates documents by `mediaType`: for each incoming MiddleBy document it removes AQ
documents of the **same** `mediaType`, then merges the rest. This works for **cutsheet** and
**user manual**, but **not** for **warranty sheet**, because the two sources classify a warranty
sheet differently:

| Source | Warranty sheet gets `mediaType` | Where |
| ------ | ------------------------------- | ----- |
| MiddleBy | `warrantysheet` (by URL `…/warrantysheet/…`) | `MiddleByProductMapper::updateDocuments()` |
| AutoQuote (AQ) | **`cutsheet`** (name contains `sheet`) | `ProductAqFileAttributeMapper::detectMediaType()` |

`detectMediaType()` never returns `warrantysheet` — the AQ warranty sheet is always typed
`cutsheet`. So the MiddleBy `warrantysheet` filter never matches the AQ warranty sheet, while the
MiddleBy `cutsheet` (spec sheet) filter matches it by accident. Two failure modes follow:

- **Bug A (duplicate persists):** MiddleBy has a warranty sheet but no spec/parts sheet → AQ warranty
  sheet is not removed → duplicated.
- **Bug B (data loss):** MiddleBy has a spec/parts sheet but no warranty sheet → the `cutsheet` filter
  removes the AQ warranty sheet with no replacement → warranty sheet disappears entirely.

A product that has **both** a MiddleBy spec sheet **and** a MiddleBy warranty sheet (e.g. the
reference product `611510`) is deduplicated correctly — but only by luck.

---

## Preconditions & environment

- **App (dev):** FEDA dev instance / Handbook. Product page: `/handbook/product-view/<PID>`.
- **DB (read-only, via tunnel):** host `127.0.0.1`, port `3307`, user `oners_read`, db `oners_dev`
  (password in `.mcp.json`).
  ```bash
  export MYSQL_PWD='<oners_read password from .mcp.json>'
  mysql --skip-ssl -h 127.0.0.1 -P 3307 -u oners_read oners_dev -e "<query>"
  ```
- **How to (re)trigger an import (enrichment runs as part of AQ import):**
  - **UI:** `Import` → `List of vendors` → select the vendor → **Load**.
  - **CLI (in container):** `php artisan product:import --external_id=<external_id>`
- **Check a product's documents:**
  ```sql
  SELECT d.id, d.title, d.remote_path
  FROM documents d
  JOIN document_product dp ON dp.document_id = d.id
  WHERE dp.product_id = <PID>
  ORDER BY d.remote_path;
  ```

> **Note on state:** the documents currently in `oners_dev` reflect the state **before** the fix was
> re-run (the old import appended documents). To observe the fixed behaviour, first record the
> product's current documents, then re-run the import, then compare against Expected/Actual.
> Document rows (e.g. `13932`, `82328`, `94042`) are **shared** across SKU variants — always verify
> the `document_product` link for the specific PID, not the global `documents` row.

---

## Bug A — Warranty sheet is DUPLICATED (duplicate survives the fix)

**Condition:** the product has an AQ warranty sheet **and** a MiddleBy `/warrantysheet/` document,
but **no** MiddleBy `/specsheets/` or `/partslist/` document.

**Root cause:** the MiddleBy warranty sheet is typed `warrantysheet`; the AQ warranty sheet is typed
`cutsheet`. They don't match, and there is no MiddleBy `cutsheet` document to evict the AQ warranty
sheet. Result: AQ warranty sheet stays **and** MiddleBy warranty sheet is added → two warranty sheets.

**Scope:** **17** products, all vendor **311 — Imperial (Middleby)**.

### TC-A-01 — Imperial `2028_IFSTS-25` (product 263531)

**Test data**
- Product `id = 263531`, `sku = 2028_IFSTS-25`, vendor `311` (Imperial).
- `external_id = 4158d63d-fe5b-e011-bf97-001018721196`
- Current documents: AQ warranty `82328`, AQ cutsheet `94039`, MiddleBy warranty `94042`,
  MiddleBy brochure `94040`, MiddleBy manual `94041`. **No** MiddleBy spec/parts sheet.

**Steps**
1. Record current documents:
   ```sql
   SELECT d.id, d.title, d.remote_path
   FROM documents d JOIN document_product dp ON dp.document_id = d.id
   WHERE dp.product_id = 263531 ORDER BY d.remote_path;
   ```
2. Re-run the import for the product:
   `php artisan product:import --external_id=4158d63d-fe5b-e011-bf97-001018721196`
   (or UI: `Import` → `List of vendors` → *Imperial (Middleby)* → **Load**).
3. Open `/handbook/product-view/263531` and inspect the documents/PDF block.
4. Re-run the SQL from step 1.

**Expected (correct behaviour)**
- Exactly **one** warranty sheet — the MiddleBy one (`94042`, `middleby-cdn.com/warrantysheet/…`).
- The AQ warranty sheet (`82328`, `api.aq-fes.com`) is **removed**.

**Actual (bug)**
- **Both** warranty sheets are present: AQ `82328` **and** MiddleBy `94042` → the product shows two
  warranty sheets.

**DB check (product still has an AQ + MiddleBy warranty pair = bug reproduced)**
```sql
SELECT
  MAX(remote_path LIKE '%aq-fes.com%'                   AND title LIKE '%warranty%') AS has_aq_warranty,
  MAX(remote_path LIKE '%middleby-cdn.com/warrantysheet%')                          AS has_mb_warranty
FROM documents d JOIN document_product dp ON dp.document_id = d.id
WHERE dp.product_id = 263531;
-- Bug reproduced when BOTH columns = 1.
```

### TC-A-02 — Imperial `2028_IHMS-24` (product 263556)

Same profile as TC-A-01. Test data:
- Product `id = 263556`, `sku = 2028_IHMS-24`, vendor `311`.
- `external_id = e93bd174-9c41-de11-9d8b-001ec95274b6`
- Documents: AQ warranty `82328` + MiddleBy warranty `94042` + MiddleBy brochure/manual.
  **No** MiddleBy spec/parts sheet.

Steps / Expected / Actual identical to TC-A-01 (substitute PID `263556` and its `external_id`).

---

## Bug B — Warranty sheet is LOST (removed with no replacement)

**Condition:** the product has an AQ warranty sheet **and** a MiddleBy `/specsheets/` (or
`/partslist/`) document, but **no** MiddleBy `/warrantysheet/` document.

**Root cause:** the MiddleBy spec sheet is typed `cutsheet`; the fix removes **all** AQ documents
typed `cutsheet` — which includes the AQ warranty sheet (also typed `cutsheet`). MiddleBy provides no
warranty sheet to replace it, so the warranty sheet is gone.

**Scope:** **2** products, vendor **36 — ANETS (Middleby)**.

### TC-B-01 — Anets `1023_RSF-14` (product 16479)

**Test data**
- Product `id = 16479`, `sku = 1023_RSF-14`, vendor `36` (ANETS).
- `external_id = 56fcdcda-bf0d-dd11-a23a-00304834a8c9`
- Documents: AQ warranty `13932`, MiddleBy spec sheet `93397` (`…/specsheets/…`),
  MiddleBy brochure `93398`. **No** MiddleBy warranty sheet.

**Steps**
1. Record current documents:
   ```sql
   SELECT d.id, d.title, d.remote_path
   FROM documents d JOIN document_product dp ON dp.document_id = d.id
   WHERE dp.product_id = 16479 ORDER BY d.remote_path;
   ```
   Confirm the AQ warranty sheet `13932` is currently linked to the product.
2. Re-run the import:
   `php artisan product:import --external_id=56fcdcda-bf0d-dd11-a23a-00304834a8c9`
   (or UI: `Import` → `List of vendors` → *ANETS (Middleby)* → **Load**).
3. Open `/handbook/product-view/16479` and inspect the documents/PDF block.
4. Re-run the SQL from step 1.

**Expected (correct behaviour)**
- The AQ warranty sheet (`13932`) is **kept** — MiddleBy sent no warranty sheet, so the AQ fallback
  must remain. The product still has a warranty sheet.

**Actual (bug)**
- The AQ warranty sheet `13932` is **removed** from the product; the product has **no warranty sheet
  at all**. Only the MiddleBy spec sheet + brochure remain.

**DB check (warranty sheet gone while a MiddleBy spec sheet exists = bug reproduced)**
```sql
SELECT
  MAX(remote_path LIKE '%warranty%')                       AS has_any_warranty,
  MAX(remote_path LIKE '%middleby-cdn.com/specsheets%')    AS has_mb_specsheet
FROM documents d JOIN document_product dp ON dp.document_id = d.id
WHERE dp.product_id = 16479;
-- Bug reproduced when has_any_warranty = 0 AND has_mb_specsheet = 1.
```

### TC-B-02 — Anets `1023_RSF-18` (product 16480)

Same profile as TC-B-01. Test data:
- Product `id = 16480`, `sku = 1023_RSF-18`, vendor `36`.
- `external_id = 59fcdcda-bf0d-dd11-a23a-00304834a8c9`
- Documents: AQ warranty `13932` + MiddleBy spec sheet `93399` + MiddleBy brochure `93398`.
  **No** MiddleBy warranty sheet.

Steps / Expected / Actual identical to TC-B-01 (substitute PID `16480` and its `external_id`).

---

## Appendix — enumerate all affected products

Counts of each defect class across the whole catalog:

```sql
SELECT
  SUM(aq_warranty=1 AND mb_warranty=1 AND mb_cutsheet=0) AS bugA_dup_persists,   -- 17
  SUM(aq_warranty=1 AND mb_cutsheet=1 AND mb_warranty=0) AS bugB_data_loss,      -- 2
  SUM(aq_warranty=1 AND mb_warranty=1 AND mb_cutsheet=1) AS not_affected_both    -- 48
FROM (
  SELECT dp.product_id AS pid,
    MAX(d.remote_path LIKE '%aq-fes.com%' AND d.title LIKE '%warranty%')          AS aq_warranty,
    MAX(d.remote_path LIKE '%middleby-cdn.com/warrantysheet%')                    AS mb_warranty,
    MAX(d.remote_path LIKE '%middleby-cdn.com/specsheets%'
        OR d.remote_path LIKE '%middleby-cdn.com/partslist%')                     AS mb_cutsheet
  FROM document_product dp
  JOIN documents d ON d.id = dp.document_id
  GROUP BY dp.product_id
) x;
```

List the concrete product IDs for **Bug A**:

```sql
SELECT x.pid FROM (
  SELECT dp.product_id AS pid,
    MAX(d.remote_path LIKE '%aq-fes.com%' AND d.title LIKE '%warranty%')          AS aq_warranty,
    MAX(d.remote_path LIKE '%middleby-cdn.com/warrantysheet%')                    AS mb_warranty,
    MAX(d.remote_path LIKE '%middleby-cdn.com/specsheets%'
        OR d.remote_path LIKE '%middleby-cdn.com/partslist%')                     AS mb_cutsheet
  FROM document_product dp JOIN documents d ON d.id = dp.document_id
  GROUP BY dp.product_id
) x
WHERE aq_warranty=1 AND mb_warranty=1 AND mb_cutsheet=0;   -- swap the last line for Bug B:
--     aq_warranty=1 AND mb_cutsheet=1 AND mb_warranty=0;
```

**Bug A product IDs (17):** 263531, 263532, 263556, 263588, 263589, 263590, 263591, 263592,
263593, 263598, 263599, 263600, 263601, 263702, 263703, 263704, 263705.

**Bug B product IDs (2):** 16479, 16480.

---

## Proposed fix (for the developer)

Both bugs share **one root cause**: `ProductAqFileAttributeMapper::detectMediaType()`
(`Modules/ProductAqFile/app/Models/Mappers/ProductAqFileAttributeMapper.php:298`) classifies an AQ
"warranty sheet" as `cutsheet` (its name contains `sheet`) and never returns `warrantysheet`. The
dedup key in `MiddleByProductMapper::updateDocuments()` is `mediaType`, so the AQ warranty sheet is
mis-keyed — it can't be matched by the MiddleBy `warrantysheet` (Bug A), and it is wrongly evicted by
the MiddleBy `cutsheet`/spec sheet (Bug B).

### Recommended — fix the classification at the root (fixes A and B together)

Add a `warranty` branch **before** the `sheet` branch in `detectMediaType()`. The order matters:
"warranty sheet" contains both `warranty` and `sheet`, so `warranty` must win.

```php
private function detectMediaType(string $name): string
{
    $name = strtolower($name);

    if (str_contains($name, 'manual')) {
        return 'manual';
    }

    if (str_contains($name, 'warranty')) {
        return 'warrantysheet';
    }

    if (str_contains($name, 'sheet')) {
        return 'cutsheet';
    }

    return 'document';
}
```

Why this fixes both:

- **Bug A:** the AQ warranty sheet is now typed `warrantysheet`, matching the MiddleBy warranty sheet
  → the dedup filter removes the AQ copy → a single (MiddleBy) warranty sheet remains.
- **Bug B:** the AQ warranty sheet is no longer typed `cutsheet`, so the MiddleBy spec-sheet
  (`cutsheet`) filter no longer touches it → the AQ warranty sheet is retained when MiddleBy sends no
  warranty sheet.

`warrantysheet` is already a valid type in `App\Models\Product\PdfHandler::$specialMediaTypes`, so the
document still passes `isValidDocumentData()` and is exported downstream.

**Regression note:** this changes the `mediaType` of AQ warranty sheets **globally** (for every
product, not only MiddleBy-enriched ones) from `cutsheet` to `warrantysheet`. Verify no downstream
logic assumes warranty sheets are bucketed as `cutsheet` (export grouping, bridge attribute mapping).
Since the two types are already distinct and both are "special", this is expected to be an
improvement rather than a behaviour change for consumers.

### Alternative — keep the dedup robust in the mapper (defensive, no global AQ change)

If touching AQ classification globally is undesirable, make `updateDocuments()` reconcile the two
naming schemes locally: when an incoming MiddleBy document is a `warrantysheet`, also drop AQ
documents whose **title** identifies a warranty sheet (regardless of their `cutsheet` `mediaType`);
and when filtering AQ `cutsheet` documents for a MiddleBy spec sheet, **exclude** AQ warranty sheets
from that removal. This duplicates the warranty-vs-cutsheet knowledge inside the mapper and is harder
to maintain, so the root fix above is preferred.

### Suggested tests

- Unit test on `detectMediaType()`: `'warranty sheet' → 'warrantysheet'`, `'cutsheet' → 'cutsheet'`,
  `'Installation & Operation Manual' → 'manual'`.
- Mapper test on `updateDocuments()` for both scenarios:
  - Bug A input (AQ warranty + MB warrantysheet, no MB cutsheet) → exactly one warranty sheet, the
    MiddleBy one.
  - Bug B input (AQ warranty + MB specsheet, no MB warrantysheet) → AQ warranty sheet retained.

### Post-fix verification

Re-run the import for a Bug A product (263531) and a Bug B product (16479), then re-run the
enumeration query in the Appendix — `bugA_dup_persists` and `bugB_data_loss` should both drop to `0`
for the re-imported products.
