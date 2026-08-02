# Issue: MiddleBy warranty is never imported — `products.warranty` stays NULL on stage

- **Environment:** stage (`oners_stage`), branch `stage` @ `3aca91ddf`
- **Area:** MiddleBy import → product warranty
- **Severity:** Medium — a required content section from the spec is entirely absent on the storefront
- **Related:** RSPA-719, `middleby_task_13_07.md` §4 (*"Replace the AQ warranty with the one from the MiddleBy"*)
- **Verified:** 2026-07-31, after a full vendor import of *Blodgett (Middleby)* (`log_id=7532`)

## Summary

Section §4 of the spec requires the MiddleBy warranty to replace the AQ warranty on the product.
On stage **no warranty value is ever written** for any MiddleBy product — `products.warranty`
remains `NULL` even after a successful vendor import that demonstrably applied other MiddleBy
content to the same product.

This is not a data problem and not a mapping-match problem. There is **no code path on stage that
writes the field at all**, so the import completes cleanly with no error in any log.

## Evidence — live import, product 611510

Vendor *Blodgett (Middleby)* (id 81) was imported in full on 2026-07-31, finishing at 10:50 DB time
(`vendor_logs.id = 7532`). Reference product **611510** — `1048_ZEPH-200-E ADDL_220/60/1`, the very
product used as the worked example in `middleby_task_13_07.md`.

The import **did** reach this product and **did** apply MiddleBy data to it:

| Section | Before import | After import | Verdict |
|---|---|---|---|
| Certifications | `["NSF","CE","ETL","ENERGY STAR"]` | `["NSF","CE","ETL","ENERGY STAR","cETLus","Made in USA"]` | ✅ §3 works — 2 missing added |
| Documents | 5 (all AQ) | 9 (+1 CutSheet, +2 User Manual, +1 Brochure from MiddleBy) | ✅ §5 partially works |
| **Warranty** | `NULL` | **`NULL`** | 🔴 **this issue** |

```sql
SELECT id, sku, certifications, warranty, updated_at FROM products WHERE id = 611510;
-- 611510 | 1048_ZEPH-200-E ADDL_220/60/1
--        | ["NSF","CE","ETL","ENERGY STAR","cETLus","Made in USA"]
--        | NULL
--        | 2026-07-31 10:49:31
```

The `updated_at` timestamp and the changed certifications prove the MiddleBy mapper ran for this
product in this import. The warranty was simply never touched.

No failures were recorded: `SELECT COUNT(*) FROM failed_jobs WHERE failed_at > NOW() - INTERVAL 2 HOUR` → `0`,
and the `importMiddleByErrors` channel is silent. The import reports success.

## The source data exists — confirmed against the MiddleBy API

Queried directly (`GET {base_url}/products/829693a9-29c5-4e3a-abea-ff9697ab9fd0`) on 2026-07-31.
The product carries the `warranty_and_disclaimers_attribute_group` group with two populated
attributes:

| attribute code | value |
|---|---|
| `primary_warranty_short_description` | **`2 Years Parts and Labor`** |
| `additional_warranty_short_description` | **`3 Years Oven Door Only`** |

This is exactly the group `dev`'s `copyWarrantyByGroup()` reads (`PRODUCT_WARRANTY_BY_GROUP`).
So the data is available from the supplier and the field stays `NULL` purely because no code on
stage consumes it — the defect cannot be explained away as "MiddleBy has no warranty for this
product".

## Scope

Every product of every MiddleBy-mapped vendor is affected — **2 890 products, 0 with a warranty**:

```sql
SELECT v.id, v.name, COUNT(*) AS products,
       SUM(p.warranty IS NOT NULL AND p.warranty <> '') AS with_warranty
FROM products p JOIN vendors v ON v.id = p.vendor_id
WHERE p.vendor_id IN (36,78,81,136,220,311)
GROUP BY v.id, v.name;
```

| vendor_id | Vendor | products | with_warranty |
|---|---|---|---|
| 36 | ANETS (Middleby) | 46 | 0 |
| 78 | BKI (Middleby) | 175 | 0 |
| 81 | Blodgett (Middleby) | 639 | 0 |
| 136 | Concordia Beverage Systems (Middleby) | 24 | 0 |
| 220 | Evo America, LLC (Middleby) | 51 | 0 |
| 311 | Imperial (Middleby) | 1955 | 0 |
| | **total** | **2890** | **0** |

## Root cause — two independent gaps

### 1. The mapper never produces warranty data

`Modules/ImportMiddleBy/app/Services/MiddleByProductMapper::mapProduct()` on stage calls ten
`update*` / `copy*` methods; none of them touches warranty. The word does not occur anywhere in
the module:

```bash
grep -rni "warrant" Modules/ImportMiddleBy/     # no matches on stage
```

On `dev` this is handled by `copyWarrantyByGroup()`, which reads the
`warranty_and_disclaimers_attribute_group` attribute group and appends to `$aqProductData['warranties']`.

### 2. Even if it did, nothing would save it

`app/Models/Product/Updater.php` on stage never reads `$data['warranties']` and never writes
`products.warranty`:

```bash
grep -n "warrant" app/Models/Product/Updater.php   # no matches on stage
```

On `dev` that logic lives at lines **196–215** (formatting the `warranties` array into text) and
line **341** (`'warranty' => $data['warranties'] ?? null` in the product upsert).

> ⚠️ **These two gaps are independent.** Porting only the MiddleBy mapper will *not* fix the issue —
> `copyWarrantyByGroup()` writes into the `warranties` key of the AQ payload array, and on stage
> there is no consumer for that key, so the data would be built and then silently discarded.
> Both changes are required together.

## This is not a regression

The `products.warranty` column exists on stage — migration
`Modules/Product/database/migrations/2026_05_25_181651_add_warranty_to_products_table.php`.
It is written by an unrelated vendor import pipeline that is out of scope here, which is why a
global `WHERE warranty IS NOT NULL` returns rows and can read as a false positive. Always scope
warranty queries to `vendor_id IN (36,78,81,136,220,311)`.

Warranty handling was introduced by exactly **one** commit in the entire repository history, and it
has never been on `master`:

```bash
git log --all --oneline -S"warranties" -- app/Models/Product/Updater.php
# 3a0d5c885  RSPA-719. 4. Warranty      ← the only commit, ever

git log master --oneline -S"warranties" -- app/Models/Product/Updater.php
# (empty)
```

`3a0d5c885` is **+59 / −0** — a pure addition. So this is missing functionality that never shipped
to stage, not something that worked before and broke.

## Steps to reproduce

1. Pick a mapped MiddleBy product — e.g. **611510**, vendor 81 Blodgett, MiddleBy uuid
   `829693a9-29c5-4e3a-abea-ff9697ab9fd0`, mapping key `mfrModel = 'ZEPH-200-E ADDL'`.
2. Confirm the starting state:
   ```sql
   SELECT id, sku, warranty FROM products WHERE id = 611510;   -- NULL
   ```
3. The MiddleBy payload carries warranty content — **already confirmed**, see below. To re-check:
   ```bash
   php artisan middleby:get:product 829693a9-29c5-4e3a-abea-ff9697ab9fd0 \
     | grep -o 'warranty_and_disclaimers_attribute_group'
   ```
4. Run the import — either the full vendor import from the Vendors page, or per product:
   ```bash
   php artisan product:import --product_id=611510
   ```
5. Re-read the field:
   ```sql
   SELECT id, sku, warranty, updated_at FROM products WHERE id = 611510;
   ```

**Expected:** `warranty` contains the MiddleBy *Warranty Details* text; the handbook page
`/handbook/product-view/611510` shows a Warranty section.

**Actual:** `warranty` is `NULL`, no Warranty section renders, no error is logged.

## Suggested fix

Port both halves of `3a0d5c885 RSPA-719. 4. Warranty` from `dev`:

1. `Modules/ImportMiddleBy/app/Services/MiddleByProductMapper.php` — add
   `PRODUCT_WARRANTY_BY_GROUP` and `copyWarrantyByGroup()`, and call it from `mapProduct()`.
2. `app/Models/Product/Updater.php` — add the `warranties` formatting block and the
   `'warranty' => ...` field in the product upsert.

Note that `mapProduct()` on stage is wrapped in `try { … } catch (Exception $e)`. If the new method
is added, verify it degrades safely for products whose MiddleBy payload has no warranty group —
the other `update*` methods use `if (empty(...)) return;` guards and the new one should match.

## Verification after the fix

Re-run step 4 above for 611510 and check:

```sql
-- the reference product now has warranty text
SELECT id, sku, LEFT(warranty, 200) FROM products WHERE id = 611510;

-- and the field is populated across the MiddleBy scope, not just one product
SELECT v.name, COUNT(*) AS products,
       SUM(p.warranty IS NOT NULL AND p.warranty <> '') AS with_warranty
FROM products p JOIN vendors v ON v.id = p.vendor_id
WHERE p.vendor_id IN (36,78,81,136,220,311)
GROUP BY v.name;
```

If `warranty` is still `NULL` while step 3 shows the group present in the payload, only the mapper
half of the change was deployed — see the warning under *Root cause*.

Test case covering this: **TC-MBS-10** in `middleby_TCs_staging.md`.
