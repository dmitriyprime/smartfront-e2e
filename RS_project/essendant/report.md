# Investigation Report — Last Commits Related to Essendant Functionality

**Date:** 2026-06-04
**Branch:** `stage`
**Epic:** RSPA-706 — *Essendant Product Integration (Mini Project)* (sub-task RSPA-714 — SFTP/ICAPS import)
**Scope:** Review of the most recent commits touching Essendant import/export functionality.

---

## 1. Summary

All recent Essendant work belongs to the **RSPA-706** epic, which began on 2026-01-05 and is
still receiving fixes as of 2026-06-04. The most recent commits (June 3–4, 2026) are small,
targeted bug-fixes concentrated on **GTIN/UPC field mapping** and a **product option filter**.
These follow earlier feature milestones: the core import pipeline (Jan–Mar), SFTP/ICAPS import
(RSPA-714, Mar), and NetSuite vendor-SKU integration (May).

The Essendant feature currently spans **two code layers**:

- **Legacy procedural layer** — `app/Models/Essendant/*`, `app/Jobs/EssendantImport/*`
  (the original mini-project implementation).
- **Modular layer** — `Modules/ProductEssendant/*`, which follows the project's Facade/Service
  convention described in `CLAUDE.md`. The recent fixes target this module, confirming the
  migration toward the modular architecture.

---

## 2. Commit Timeline

| Commit | Date | Author | Summary |
|--------|------------|----------------|----------------------------------------------|
| `670af9024` | 2026-06-04 | Alexandr Tereta | Merge `RSPA-706` → `stage` |
| `e81f900c2` | 2026-06-04 | Tereta Alexander | **RSPA-706: Fixing the option filter** |
| `7679571cd` | 2026-06-03 | Tereta Alexander | **RSPA-706 Fix UPC** |
| `8af1847cc` | 2026-06-03 | Tereta Alexander | **RSPA-706: Fix UPC on export to shopify** |
| `b7c3366c8` | 2026-06-03 | Tereta Alexander | **RSPA-706: GTIN_CTN** |
| `2f805868f` | 2026-06-03 | Stanislav Miroshnyk | RSPA-706. Solve issue with autotests |
| `9911e7ec3` | 2026-06-03 | Stanislav Miroshnyk | RSPA-706. Fix issues with tests |
| `094a6bc62` | 2026-06-02 | Tereta Alexander | RSPA-706: Update from master, conflict fixes |
| `20d6fe5a7` | 2026-06-02 | Tereta Alexander | RSPA-706 fix export signature for allpoints |
| `00d7c31ab` | 2026-06-01 | Tereta Alexander | RSPA-706: Prop65 type fix |
| `6ff3207fc` | 2026-06-01 | Tereta Alexander | RSPA-706: Fix issue with leadTimeValue |
| `2ca894bb6` | 2026-06-01 | Tereta Alexander | RSPA-706: Force creating mode |
| `85a88619c` | 2026-06-01 | Tereta Alexander | RSPA-706: Image optimisation and process scaling |
| `a2518a46e` | 2026-05-14 | Tereta Alexander | RSPA-706 Fix total of products for essendant |
| `3dca016ac` | 2026-05-13 | Tereta Alexander | RSPA-706 Add netsuite vendor sku for essendant |
| `a65708390` | 2026-03-13 | Tereta Alexander | RSPA-706: Add netsuite to essendant |
| `f038d2b59` | 2026-03-11 | Stanislav Miroshnyk | RSPA-714 SFTP import (CLI + schedule) |
| `b3ae5c6af` | 2026-03-06 | Tereta Alexander | RSPA-706: Recreating logic for essendant breadcrumbs |
| `d22d381bf` | 2026-02-07 | Mykola Silin | RSPA-706: change DataRetriever, add Essendant Service |
| `c08872296` | 2026-01-20 | Sergey Borodich | RSPA-706 — Essendant Product Integration (Mini Project) |
| `394e9257e` | 2026-01-05 | Sergey Borodich | RSPA-706 — Essendant Product Integration (Mini Project) |

---

## 3. Detailed Analysis of the Latest Fixes

### 3.1 `b7c3366c8` — GTIN_CTN (outer GTIN source field)

**File:** `Modules/ProductEssendant/app/Services/Product.php:137`

```diff
- 'gtin_outer' => $itemModel->getAttribute('gtin_outer'),
+ 'gtin_outer' => $itemModel->getAttribute('gtin_ctn'),
```

The internal `gtin_outer` product field was being populated from a source attribute
`gtin_outer` that **does not exist in the Essendant feed**, so it was always null. The correct
source field is `gtin_ctn` (carton-level GTIN). After this fix, the per-package GTIN trio maps as:

| Internal field | Source attribute | Level |
|----------------|------------------|-------|
| `gtin_each`  | `gtin_item` | Each |
| `gtin_inner` | `gtin_bx`   | Box / inner |
| `gtin_outer` | `gtin_ctn`  | Carton / outer |

### 3.2 `8af1847cc` + `7679571cd` — UPC on export to Shopify

**File:** `app/Models/Product/Data/Extractor/Data/SpecHelper.php` (~lines 277–300)

This is the shared spec-building logic used when exporting product specs to Shopify. Two changes:

**(a) `8af1847cc`** — The UPC computation block was **moved up**, to run *before* the options
loop, so the resulting UPC is emitted through the same `$options` channel as every other spec
option (instead of being appended separately at the end). Fallback order is preserved:

```php
$gtin = $product->gtin_each;
if (!$gtin) { $gtin = $product->gtin_inner; }
if (!$gtin) { $gtin = $product->gtin_outer; }
```

**(b) `7679571cd`** — A guard was added so the GTIN fallback does **not overwrite** an explicit
UPC option already supplied by the vendor feed:

```diff
- if ($gtin) {
+ if ($gtin && !isset($options['UPC'])) {
      $options['UPC'] = $gtin;
  }
```

The explicit `UPC` option originates in `Modules/ProductEssendant/app/Services/Product.php`
(`saveAttributes()`), where it is mapped from the source attribute `upc_rtl`. The net effect:
**a real retail UPC from the feed takes precedence; the GTIN trio is only a fallback.**

### 3.3 `e81f900c2` — Option filter (falsy-value bug)

**File:** `Modules/ProductEssendant/app/Services/Product.php:256` (in `saveAttributes()`)

```diff
- if (!$optionValue) {
+ if ($optionValue === null || $optionValue === '') {
      continue;
  }
```

The previous `!$optionValue` check used PHP's loose falsy evaluation, which **silently dropped
legitimate values** such as `"0"` or `0`. The static option set affected here includes:
*Country of origin* (`ctry_orig_cde`), *UPC* (`upc_rtl`), *UNSPSC* (`unspsc`),
*Carton weight* (`ctn_wgt_whl_num`), *Carton pack quantity* (`ctn_pk_qty` + `ctn_pk_un_cde`),
and *Pack quantity* (`bx_pk_qty`). The strict comparison now only skips genuine null/empty values.

### 3.4 Supporting fixes in the same window

- **`a2518a46e`** — Corrected the product total count in
  `app/Models/MonitoringControl/Process/EssendantImport/DataRetriever.php` (drives batch/progress).
- **`3dca016ac` / `a65708390`** — NetSuite vendor-SKU export for Essendant via
  `Modules/Netsuite/app/Console/Export.php`, `Services/Request.php`, and the module's
  `app/Pipelines/NetsuiteCollector.php`.
- **`00d7c31ab`** Prop65 type fix, **`6ff3207fc`** leadTime value fix, **`85a88619c`** image
  optimisation/process scaling — incremental export-data correctness and performance work.

---

## 4. Architecture & Data Flow

### 4.1 Import pipeline (from `Modules/ProductEssendant/README.md`)

1. **Vendor Merge file upload** — UI: *Import → Vendor Merge Files → Essendant*.
2. **Import tables** — MDB → `vendor_merge_essendant_*` tables.
   Queue `vendor_merge`, job `Modules\ProductEssendant\Jobs\Process`.
3. **Import products** — Essendant tables → products.
   Queue `essendant_import`, job `App\Jobs\EssendantImport\ProcessProduct`.
4. **Import images** — `Modules\ProductEssendant\Jobs\Images`.
5. **Import documents** — `App\Jobs\EssendantImport\ProcessDocuments`.

Process orchestration uses the standard monitoring stack:
`App\Models\MonitoringControl\Process\EssendantImport\{DataRetriever,ChainManager,StatusManager}`.

### 4.2 SFTP / ICAPS import (RSPA-714)

```bash
php artisan essendant:import:sftp
```

- Implemented in `Modules/ProductEssendant/app/Console/Commands/ImportFromSftp.php`
  and `ImportIcapsFromSftp.php`.
- Runs via CLI or scheduled cron; guarded so it **won't start if an Essendant import is already
  in progress** (commit `f210a14da`).

### 4.3 NetSuite integration

Added late in the epic (May 2026). Exports Essendant vendor SKUs to NetSuite through
`Modules/Netsuite` and the module's `app/Pipelines/NetsuiteCollector.php`.
Config: `Modules/ProductEssendant/config/netsuite.php`.

### 4.4 Product naming convention (from README)

- **Import level:** `products.name` is mapped from
  `vendor_merge_essendant_product_line.pl.nm` (default `null`).
- **Export level:** if `products.name` is set, that value is used.

---

## 5. Observations & Risks

1. **Dual implementation.** Essendant logic is split between the legacy `app/Models/Essendant/*`
   layer and the newer `Modules/ProductEssendant` module. The active development is in the
   module, but the legacy jobs (`ProcessProduct`, `ProcessDocuments`, `ProcessImages`) are still
   in the import chain — worth tracking for eventual consolidation per the project's
   "notice for refactoring" rule.

2. **`@deprecated` guard that throws.** `SpecHelper::getSpecsData()` compares the legacy
   `Data::getOptions($product)` result against the new repository-based options and
   **throws an exception on mismatch** (`"Check options refactoring failed."`). This is a
   transitional safety net; once the refactor is verified it should be removed (as the inline
   `@deprecated` note states), otherwise any future divergence will hard-fail exports.

3. **Falsy-value pitfalls recur.** The option-filter fix (`e81f900c2`) is the same class of bug
   that affects ETL field mapping generally. Other `if (!$value)` checks in the Essendant
   services should be audited for legitimate `0`/`"0"` values (e.g. quantities, dimensions).

4. **Field-name drift.** The GTIN_CTN fix shows the source feed's attribute names don't always
   match internal field names. A mapping reference (source attribute → internal field) would
   reduce these silent-null bugs.

---

## Appendix — How this report was produced

- `git log -i --grep=essendant` and `git log -i --grep=RSPA-706` for commit discovery.
- `git show <hash>` for each recent commit diff.
- Source verified against the current `stage` tree:
  - `Modules/ProductEssendant/app/Services/Product.php`
  - `app/Models/Product/Data/Extractor/Data/SpecHelper.php`
  - `Modules/ProductEssendant/README.md`
