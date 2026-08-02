# Issue: spec-group rule from §2 is not implemented — AQ specifications are never replaced

- **Environment:** **both** `stage` (`oners_stage`) and `dev` (`oners_dev`) — this is not a branch gap
- **Area:** MiddleBy import → product options → spec table
- **Severity:** Medium — the storefront spec table does not match the agreed structure;
  AQ and MiddleBy specifications are mixed instead of AQ being replaced
- **Related:** RSPA-719, `middleby_task_13_07.md` §2 (Specifications)
- **Verified:** 2026-07-31

## The requirement

> **Specifications** — Keep the first 3 AQ groups, replace all remaining groups with MiddleBy
> specifications.

with an explicit list of the groups to import:

> Function and Features · Energy Specifications · Gas Specifications ·
> Water, Plumbing and Drainage Specifications · Weights and Dimensions ·
> Installation Details · Additional Tech Specifications

### Clarification (2026-08-02) — what "the first 3" means

The spec points at a screenshot rather than naming them. Confirmed with the author: **the three are
the top rows of the Technical details block** — *Manufacturer*, *Model Number*,
*Manufacturer Part #* — not AQ specification groups.

They are the hardcoded `# Base specs` block at the start of `SpecHelper::getSpecsData()` and are
always emitted first, so **that half of the rule already holds**. Everything the method appends
afterwards (options, dimensions, UPC, certifications) is "the rest" and must come from MiddleBy.

This makes the task considerably smaller than the earlier assessment in this document assumed —
see *Suggested fix* below.

## Summary

Neither branch implements this. MiddleBy specifications are **appended** to the AQ ones; no AQ
specification is ever removed, and the notion of a "group" is not persisted anywhere.

Unlike the other RSPA-719 findings, this one is **not fixed by promoting `dev`** — the missing
pieces are a schema change and repository logic, not code that already exists on another branch.

## Evidence

### 1. There is no group concept in storage

```sql
SHOW COLUMNS FROM product_options;        -- id, name, option_code
SHOW COLUMNS FROM product_option_values;  -- id, product_id, option_id, value, updated_at
```

Identical on both databases. No column holds a group, and no migration on `dev` adds one.

### 2. On dev the group is built and then discarded

`MiddleByProductMapper` on `dev` attaches a group to every copied attribute — lines 412, 438, 466:

```php
$aqProductData['categoryValues'][] = [
    'property' => $attributeLabel ?? $attribute['code'] ?? '',
    'value'    => $attributeValue,
    'group'    => $attribute['attributeGroup'],   // ← never read again
];
```

But the consumer ignores it. `Modules/Product/app/Repositories/Product/Option.php::saveProduct()`
reads only `property` and `value`:

```php
foreach ($categoryValues as $item) {
    $optionValue = $this->saveOption($productModel, (string) $item['property'], (string) $item['value']);
    $handledOptionIds[] = $optionValue->option_id;
}
```

That file is **byte-identical on `stage` and `dev`**:

```bash
git diff --stat stage dev -- Modules/Product/app/Repositories/Product/Option.php   # empty
```

On `stage` the mapper does not even attach the key.

### 3. No "first 3 groups" logic exists anywhere

```bash
grep -rni "attributeGroup\|'group'\|first.*3.*group" --include="*.php" \
  Modules/ImportMiddleBy app/Models/Product/Data     # stage → no matches
```

### 4. AQ specifications survive the enrichment on both branches

Product **666268** (`2028_ISP-18-W_LP`, Imperial (Middleby)) — present on both with the same id,
re-imported recently on both:

| | stage | dev |
|---|---|---|
| options total | 17 | 26 |
| MiddleBy-era (`updated_at` ≥ 2026) | 12 | 21 |
| **AQ legacy (`updated_at` 2023)** | **5** | **5** |

The same five AQ options remain on both: *Burner Section Qty, Controls, Depth (front - back),
Exterior Finish, Flue/Back-Splash Height*.

This is not stale data. `saveProduct()` deletes any option not present in the incoming payload:

```php
OptionValueModel::whereNotIn('option_id', $handledOptionIds)
    ->where('product_id', $productModel->id)
    ->delete();
```

So the five survive because AQ keeps supplying them and MiddleBy does not displace them. The
replacement mechanism exists and works — it is simply not used for this requirement. Their
`updated_at` stays at 2023 because `updateOrCreate` does not touch the row when the value is
unchanged.

### 5. `updateAqSpecification()` is a fallback, not a replacement

Functionally identical on both branches (only the call style differs — `$this->getAttributeValueByCode()`
vs `AttributeValueFacade::get()`): it fills `specifications.AQSpecification` from MiddleBy's
`long_description` **only when AQ supplied none**.

## What differs between the branches

Only the volume of MiddleBy data, not the rule:

| aspect | stage | dev |
|---|---|---|
| "first 3 + replace" rule | 🔴 | 🔴 |
| AQ specifications replaced | no | no |
| `group` produced by the mapper | no | yes, discarded on save |
| MiddleBy attribute source | flat list of ~45 codes | 4 named attributes + 6 groups |
| MiddleBy options on 666268 | 12 | 21 |

Promoting `dev` yields **more** specifications on the product, but does not satisfy §2.

## Impact

The storefront spec table shows AQ and MiddleBy specifications intermixed in insertion order, with
no grouping and no way to tell the origin. Neither the "first 3 AQ groups" boundary nor the seven
named MiddleBy groups from the spec are reproducible from the stored data.

## Suggested fix

**Revised after the 2026-08-02 clarification — no schema change is required.**

The three kept rows are hardcoded and always come first, so only the second half of the rule is
missing: AQ options must stop reaching the spec table for MiddleBy-mapped products.

1. **Import logic** — for a product that resolved to a MiddleBy uuid, drop the AQ-sourced entries
   from `$aqProductData['categoryValues']` before the MiddleBy attributes are appended in
   `MiddleByProductMapper::mapProduct()`.
2. **Nothing else.** `Option::saveProduct()` already ends with

   ```php
   OptionValueModel::whereNotIn('option_id', $handledOptionIds)
       ->where('product_id', $productModel->id)
       ->delete();
   ```

   so anything no longer passed in is removed automatically — exactly how
   `product_options_and_accessories` disappeared on dev.

The `group` key that `dev`'s mapper attaches to `categoryValues` is still discarded on save, but
that no longer blocks this requirement — grouping is not needed to decide what to keep.

### Open question

The mapping of the spec's *"Additional Tech Specifications"* to MiddleBy's `other` group is an
assumption. The other six map cleanly, and **"Gas Specifications" has no separate group in MiddleBy
at all** — gas attributes (`gas_type`, `gas_total_btus`, `gas_conversion_kit`,
`gas_inlet_size_inches`) carry `attributeGroup = energy_specs_attribute_group`, verified against the
live API on Imperial ISP-18-W (`65d46612-…`). So Energy Specifications already covers them.

## Related

- **`middleby_aq_groups_not_replaced_issue_stage.md`** — the empirical test report on product
  611510 (stage 27 options vs dev 56, none of the 9 AQ options removed). Keep the two in sync
- `middleby_TCs_staging.md` — **TC-MBS-07** (the rule) and **TC-MBS-17** (the seven named groups)
- `middleby_clearance_issue_stage.md` — a different §2 gap, stage-only, fixed on dev
- `middleby_options_accessories_issue_stage.md` — an out-of-spec attribute in the same spec table
