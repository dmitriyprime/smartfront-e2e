# Bug: `clearance*` attributes are not shown on the frontend

- **Environment:** dev (`oners_dev`)
- **Area:** MiddleBy import → product attributes → frontend spec display
- **Severity:** Medium — a group of product attributes is missing from the storefront
- **Related:** RSPA-719, `middleby_task_13_07.md` §2 (Specifications). See `middleby_doc.md` §4.2.

---

## ⚠️ STATUS UPDATE — 2026-07-31

| Part of this report | Status on dev |
|---|---|
| **Clearance attributes** (Front / Back / Left / Right / Top) | ✅ **FIXED** by `d8326101c RSPA-719. 2. Specifications. Clearance` (2026-07-23) |
| **Product Dimensions (WxDxH) (mm)** | 🔴 **still open** — the exclusion described below is unchanged |

The "suspected root cause" below turned out to be correct: the clearance attributes lived in
`weights_dimensions_attribute_group`, which was not in the copy list. `d8326101c` added that group
to `PRODUCT_ATTRIBUTES_BY_GROUP` while excluding the dimension attributes themselves
(`MIDDLE_BY_PRODUCT_DIMENSIONS` + `product_dimensions_WxDxH`) so they would not be duplicated.

Confirmed in `oners_dev` — the option values were written the day after the commit, 2026-07-24 16:34:

| option_code | products |
|---|---|
| `product_clearance_required_back` | 536 |
| `product_clearance_required_right_side` | 528 |
| `product_clearance_required_left_side` | 522 |
| `product_clearance_required_top` | 471 |
| `product_clearance_required_front` | 397 |

> **This fix is on `dev` only.** On stage clearance is still not imported at all — tracked
> separately in **`middleby_clearance_issue_stage.md`**.

Everything below describes the original state of `dev` before `d8326101c` and is kept for history.
The `Product Dimensions (WxDxH)` sections remain accurate and open.

---

## Summary

Product **clearance** attributes do **not** appear on the frontend after import. Specifically the
four attributes below (present on the MiddleBy catalog page) are missing:

- **Product Clearance Required: Front**
- **Product Clearance Required: Back**
- **Product Clearance Required: Left Side**
- **Product Clearance Required: Right Side**
- **Product Dimensions (WxDxH) (mm)**

They are missing because they are **never imported into the product data** — not because the
frontend hides them. Note: `Product Dimensions (WxDxH) (mm)` has a **confirmed** cause (it is
explicitly excluded during import — see Root cause), while the four clearance attributes have a
suspected cause pending the MiddleBy payload.

## Evidence

On the enriched MiddleBy vendors (81 Blodgett / 78 BKI / 311 Imperial):

- **No** `product_options` named `Product Clearance Required: {Front|Back|Left Side|Right Side}`
  exist anywhere in the DB. The only clearance option in the whole DB is `Faucet Clearance`
  (option id 434), used by 54 unrelated products — none of the four Product Clearance attributes
  is stored for any product.
- **No** `product_options` named `Product Dimensions (WxDxH)` / containing `WxDxH` exist anywhere
  in the DB (0 rows).
- Test product **611510** (`1048_ZEPH-200-E ADDL`): no clearance option, and its `specs`
  text (`products.specs`) contains no "clearance" substring.
- Grep of the whole app (`app/`, `Modules/`, `config/`, `resources/`) for `clearance` → **0 hits**,
  so there is no clearance-specific filtering or rendering anywhere. Specs render generically from
  options (`SpecHelper::getSpecsData` → `RepositoryOptionFacade::getProduct`), so any stored
  clearance option *would* display. It isn't stored → it can't display.

## What it is NOT

- **Not a frontend filter/render bug.** No code references clearance; specs are rendered
  generically. The attribute is simply not present in the product data.

## Root cause — `Product Dimensions (WxDxH) (mm)` (CONFIRMED)

`updateDimensions()` reads the `weights_dimensions_attribute_group` but **explicitly excludes**
the `product_dimensions_WxDxH` attribute:

```php
// Modules/ImportMiddleBy/app/Services/MiddleByProductMapper.php:159-163
$attributes = AttributeValueFacade::getAttributesByGroup(
    $attributeGroup,                 // weights_dimensions_attribute_group
    $middleByProductData,
    ['product_dimensions_WxDxH']     // <-- excluded, never imported
);
```

So `Product Dimensions (WxDxH) (mm)` is intentionally skipped and never persisted → never shown.
(Fix: remove it from the exclude list, or map it to a category value / the appropriate dimension
fields.)

## Suspected root cause — clearance attributes (CONFIRMED, fixed by `d8326101c`)

> The second bullet below is what actually happened: the clearance attributes live in
> `weights_dimensions_attribute_group`. The fix took the first branch of the suggested direction —
> the group was added to `PRODUCT_ATTRIBUTES_BY_GROUP` so the attributes are copied as category
> values, while the dimension attributes themselves stay excluded.


`MiddleByProductMapper` only imports a fixed set of attributes/groups; clearance likely falls
outside them and is dropped:

- `copyAttributes()` / `copyAttributesByGroup()` copy only:
  `PRODUCT_ATTRIBUTES_LIST` and `PRODUCT_ATTRIBUTES_BY_GROUP =` {`function_and_features`,
  `energy_specs_attribute_group`, `water_specs_attribute_group`, `installation_details_attribute_group`,
  `other`}. If the MiddleBy clearance attributes live in a group **not** in this list, they are
  never copied to `categoryValues` → never persisted → never shown.
- Alternatively, if clearance attributes live in `weights_dimensions_attribute_group`,
  `updateDimensions()` reads them into `productDimension[camelCase(code)]` (e.g.
  `clearanceLeftSide`), but the persist step only writes the fixed keys
  height/width/depth/cube/weight (`Updater.php:364-400`) — any other `productDimension` key
  (incl. clearance) is **silently dropped**.

Confirming which of the two applies requires the raw MiddleBy payload:
```bash
php artisan middleby:get:product 829693a9-29c5-4e3a-abea-ff9697ab9fd0
# look for attributes whose code contains "clearance" and note their attributeGroup
```

## Fix direction

- If clearance is in a copied group already but with unexpected codes → verify
  `copyAttributesByGroup` isn't excluding it.
- If in a group not listed → add that group (or the specific clearance codes) to
  `PRODUCT_ATTRIBUTES_BY_GROUP` / `PRODUCT_ATTRIBUTES_LIST` so it persists as a category value.
- If in `weights_dimensions_attribute_group` → either move clearance out of the dimension path or
  persist non-standard dimension keys as category values instead of discarding them.

## Verification query

```sql
-- Should return clearance rows once fixed; currently returns nothing for these vendors
SELECT p.id, p.sku, po.name, pov.value
FROM product_option_values pov
JOIN product_options po ON po.id = pov.option_id
JOIN products p ON p.id = pov.product_id
WHERE p.vendor_id IN (81, 78, 311)
  AND (po.name LIKE '%clearance%' OR po.name LIKE '%WxDxH%' OR po.name LIKE '%Product Dimensions%');
```

## Reference

- `Modules/ImportMiddleBy/app/Services/MiddleByProductMapper.php` — `PRODUCT_ATTRIBUTES_LIST`,
  `PRODUCT_ATTRIBUTES_BY_GROUP`, `PRODUCT_DIMENSIONS_BY_GROUP`, `copyAttributesByGroup()`,
  `updateDimensions()`.
- `app/Models/Product/Updater.php:364-400` — package build; only height/width/depth/cube/weight
  persisted from `productDimension`.
- `app/Models/Product/Data/Extractor/Data/SpecHelper.php::getSpecsData()` — generic spec render
  from options (no clearance-specific logic).
