# Issue: AQ specifications are not replaced by MiddleBy — test report on product 611510

- **Environment:** stage (`oners_stage`), compared against dev (`oners_dev`)
- **Area:** MiddleBy import → product options → spec table
- **Severity:** Medium — the spec table keeps AQ rows that the spec requires to be replaced
- **Related:** RSPA-719, `middleby_task_13_07.md` §2.
  Root-cause analysis and fix scope: **`middleby_specifications_groups_issue.md`**
- **Verified:** 2026-07-31, re-tested with the clarified requirement 2026-08-02

> This document is the **empirical test report**. Keep it in sync with
> `middleby_specifications_groups_issue.md`.

## Requirement under test — clarified

> **Specifications** — Keep the first 3 AQ groups, replace all remaining groups with MiddleBy
> specifications.

The spec text points at a screenshot (`image12.png`) rather than naming the three. Clarified with
the author: **"the first 3" are the top three rows of the Technical details block**, not AQ
specification groups:

| # | row | value on 611510 |
|---|---|---|
| 1 | Manufacturer | Blodgett (Middleby) |
| 2 | Model Number | ZEPH-200-E ADDL_220/60/1 |
| 3 | Manufacturer Part # | ZEPH-200-E ADDL_220/60/1 |

These are exactly the hardcoded `# Base specs` block at the top of
`SpecHelper::getSpecsData()` (`app/Models/Product/Data/Extractor/Data/SpecHelper.php`):

```php
# Base specs
$result = [
    ['name' => 'Manufacturer',        'value' => $manufacturer],
    ['name' => 'Model Number',        'value' => $product->model],
    ['name' => 'Manufacturer Part #', 'value' => $product->model],
];

# Options
```

Everything the method appends after that block — options, dimensions, UPC, certifications — is
"the rest" and must come from MiddleBy.

**Therefore the defect is: AQ-sourced product options are still present in the spec table.**

## Test

Product **611510** — `1048_ZEPH-200-E ADDL_220/60/1`, vendor 81 Blodgett (Middleby),
MiddleBy uuid `829693a9-29c5-4e3a-abea-ff9697ab9fd0`. The worked example from the spec itself.

```sql
-- split the options by origin: AQ values were written in 2023 and never touched since
SELECT SUM(pov.updated_at <  '2026-01-01') AS aq_origin,
       SUM(pov.updated_at >= '2026-01-01') AS middleby_era,
       COUNT(*)                            AS total
FROM product_option_values pov WHERE pov.product_id = 611510;
```

## Result

| spec-table block | stage | dev | required |
|---|---|---|---|
| base rows (hardcoded) | 3 | 3 | 3 — **kept, correct** |
| options — **AQ-origin** | **9** | **9** | **0 — must be replaced** |
| options — MiddleBy | 18 | 47 | all of them |
| certifications | 6 | 6 | from MiddleBy |
| **total rows** | **36** | **65** | |

### The 9 offending AQ rows — identical on both branches

| option_code | name | value |
|---|---|---|
| `base` | Base | Legs |
| `control_type` | Control Type | Solid State Controls |
| `deck_qty` | Deck Qty | 1 Deck |
| `energy_efficiency` | Energy Efficiency | ENERGY STAR® |
| `exterior_finish` | Exterior Finish | All Stainless Steel Exterior |
| `interior_finish` | Interior Finish | Porcelain Interior |
| `kw_per_deck` | kW (per deck) | 11.0 - 15.99 KW |
| `size` | Size | Deep/bakery Size |
| `type` | Type | Standard |

All nine carry `updated_at = 2023-03-02 16:58:35` on **both** databases — written by an AutoQuotes
import years ago and never touched by MiddleBy enrichment. They should not be in the table at all.

### Set difference between the branches

- `stage \ dev` — one entry, `product_options_and_accessories`, removed for an unrelated reason
  (see `middleby_options_accessories_issue_stage.md`). **No AQ option was replaced on dev.**
- `dev \ stage` — 30 additional MiddleBy options (clearance, cooking chamber dimensions, door,
  fan, temperature, lighting, …). Purely additive.

## Conclusion

The requirement is **not implemented on either branch**. The first three rows are correct by
construction — they are hardcoded and always come first. The failure is entirely in the second half
of the rule: the AQ options are never dropped.

Promoting `dev` grows the table from 36 to 65 rows but leaves the same 9 AQ rows in place.

## How the MiddleBy groups map to the spec's list

Checked against the live API (`GET {base_url}/products/829693a9-…`). MiddleBy's own taxonomy:

| spec §2 group | MiddleBy `attributeGroup` | attributes on 611510 |
|---|---|---|
| Function and Features | `function_and_features` | 10 |
| Energy Specifications | `energy_specs_attribute_group` | 10 |
| **Gas Specifications** | — *(no such group)* | gas attributes live in `energy_specs_attribute_group` |
| Water, Plumbing and Drainage | `water_specs_attribute_group` | 2 |
| Weights and Dimensions | `weights_dimensions_attribute_group` | 10 |
| Installation Details | `installation_details_attribute_group` | 3 |
| Additional Tech Specifications | `other` *(presumed)* | 13 |

Verified on a gas product too (`65d46612-…`, Imperial ISP-18-W): `gas_type`, `gas_total_btus`,
`gas_conversion_kit`, `gas_inlet_size_inches` all carry
`attributeGroup = energy_specs_attribute_group`. There is no gas group in MiddleBy at all, so the
spec's "Gas Specifications" is covered by Energy Specifications — which `dev` already copies.

Only the mapping of "Additional Tech Specifications" → `other` is an assumption worth confirming.

## Reproduction

1. Open `/handbook/product-view/611510` and look at Technical details.
2. Rows 1–3 are Manufacturer / Model Number / Manufacturer Part # — correct.
3. Further down, the AQ rows from the table above are still present.
4. In the DB:
   ```sql
   SELECT po.name, pov.value, pov.updated_at
   FROM product_option_values pov JOIN product_options po ON po.id = pov.option_id
   WHERE pov.product_id = 611510 AND pov.updated_at < '2026-01-01'
   ORDER BY po.name;   -- 9 rows, all should be gone
   ```

## Fix

Simpler than first assessed — **no schema change is needed**. See
`middleby_specifications_groups_issue.md`. In short: stop passing AQ values into
`categoryValues` for MiddleBy-mapped products; the existing
`Option::saveProduct()` already deletes anything absent from the incoming set:

```php
OptionValueModel::whereNotIn('option_id', $handledOptionIds)
    ->where('product_id', $productModel->id)
    ->delete();
```

Test case covering this: **TC-MBS-07** in `middleby_TCs_staging.md`.
