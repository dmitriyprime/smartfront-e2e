# Issue: MiddleBy `clearance*` attributes are not imported on stage

- **Environment:** stage (`oners_stage`), branch `stage` @ `3aca91ddf`
- **Area:** MiddleBy import → product options → spec table
- **Severity:** Medium — installation clearance data is absent from the storefront spec table
- **Related:** RSPA-719, `middleby_task_13_07.md` §2 (Specifications).
  Fixed on dev — see `middleby_clearance_attributes_bug.md`
- **Verified:** 2026-07-31, after two full vendor imports of *Blodgett (Middleby)* (`log_id` 7532, 7533)

## Summary

The five MiddleBy **Product Clearance Required** attributes (Front / Back / Left Side / Right Side /
Top) are imported on `dev` but do not exist on stage at all. They are not merely hidden on the
frontend — they never reach `product_options`, so there is nothing to render or export.

This is a straight consequence of the branch gap: the fix
`d8326101c RSPA-719. 2. Specifications. Clearance` (2026-07-23) is on `dev` only.

## Evidence

```sql
SELECT po.id, po.name, po.option_code, COUNT(pov.product_id) AS products
FROM product_options po LEFT JOIN product_option_values pov ON pov.option_id = po.id
WHERE po.option_code LIKE '%clearance%' OR po.name LIKE '%learance%'
GROUP BY po.id ORDER BY products DESC;
```

**dev** — all five present:

| option_code | products |
|---|---|
| `product_clearance_required_back` | 536 |
| `product_clearance_required_right_side` | 528 |
| `product_clearance_required_left_side` | 522 |
| `product_clearance_required_top` | 471 |
| `product_clearance_required_front` | 397 |

**stage** — none of them. The only matches are unrelated AQ attributes:

| option_code | products | origin |
|---|---|---|
| `ground_clearance` | 97 | AQ |
| `faucet_clearance` | 54 | AQ |
| `jam_clearance` | 3 | AQ |

Scoped to the MiddleBy vendors, the count is zero:

```sql
SELECT COUNT(*) FROM product_option_values pov
JOIN product_options po ON po.id = pov.option_id
JOIN products p ON p.id = pov.product_id
WHERE p.vendor_id IN (36,78,81,136,220,311) AND po.name LIKE 'Product Clearance%';
-- 0
```

### Same product, both environments — 666268

`2028_ISP-18-W_LP`, Imperial (Middleby), MiddleBy uuid `65d46612-92f2-49c6-bbca-ed61123f1236`.

| attribute | dev | stage |
|---|---|---|
| Product Clearance Required: Top | `20"` | — |
| Product Clearance Required: Back | `8"` | — |
| Product Clearance Required: Left Side | `6"` | — |
| Product Clearance Required: Right Side | `6"` | — |

The product exists on both with the same id and the same mapping, and was re-imported on stage
during `log_id=7533`.

### The source data exists — confirmed against the MiddleBy API

Queried directly (`GET {base_url}/products/65d46612-92f2-49c6-bbca-ed61123f1236`) on 2026-07-31.
The payload carries four clearance attributes:

| attribute code in the payload |
|---|
| `product_clearance_required__back` |
| `product_clearance_required__left_side` |
| `product_clearance_required__right_side` |
| `product_clearance_required__top` |

They live in `weights_dimensions_attribute_group` — the group `d8326101c` added to
`PRODUCT_ATTRIBUTES_BY_GROUP` on dev. The supplier provides the data; stage never reads it.

> Note the **double underscore** in the source codes. The option codes stored in the app are
> generated from the MiddleBy *label*, not from this code, which is why dev ends up with
> single-underscore `product_clearance_required_back`. Do not match the two by string equality.
>
> This product has no `…_front` attribute — the set of clearance sides varies per product, so a
> test case should assert "the clearance attributes present in the payload are imported", not a
> fixed list of five.

## Root cause

The clearance attributes live in the MiddleBy group `weights_dimensions_attribute_group`.

- **dev** copies whole attribute groups. `d8326101c` added `weights_dimensions_attribute_group` to
  `PRODUCT_ATTRIBUTES_BY_GROUP`, while keeping the dimension attributes themselves excluded
  (`MIDDLE_BY_PRODUCT_DIMENSIONS` + `product_dimensions_WxDxH`) so they are not duplicated.
  Clearance is picked up as a side effect of copying that group.
- **stage** has no group mechanism at all. `copyMiddleByAttributes()` iterates a flat list,
  `MIDDLE_BY_PRODUCT_OPTIONS_LIST`, of ~45 explicitly named attribute codes. No clearance code is
  in that list, so the attributes are never read.

> Note: this cannot be fixed by adding a group to a constant on stage — the group-copying code path
> does not exist there. It requires porting `copyAttributesByGroup()` and its supporting facade
> methods, i.e. the RSPA-719 specifications rework as a whole.

## Steps to reproduce

1. Pick a mapped MiddleBy product — e.g. **666268**, vendor 311 Imperial, uuid
   `65d46612-92f2-49c6-bbca-ed61123f1236`.
2. MiddleBy does supply clearance for it — **already confirmed**, see above. To re-check:
   ```bash
   php artisan middleby:get:product 65d46612-92f2-49c6-bbca-ed61123f1236 | grep -i clearance
   ```
3. Run a full vendor import — Vendors → *Imperial (Middleby)* → **Update**.
4. Check the options:
   ```sql
   SELECT po.name, pov.value FROM product_option_values pov
   JOIN product_options po ON po.id = pov.option_id
   WHERE pov.product_id = 666268 AND po.option_code LIKE '%clearance%';
   ```

**Expected:** four to five `Product Clearance Required: …` rows, as on dev.
**Actual:** no rows. No error is logged — the import reports success.

## Impact on export

No separate mapping is involved: once an attribute is stored as a product option it flows to the
storefronts automatically. `SpecHelper::getSpecsData()` builds the spec table from the product's
options, and that table is exported as `default_app_spec_table` (Magento RS) and as the
`product_spec_table` metafield (Shopify). Since the options do not exist on stage, nothing is sent.

## Suggested fix

Port the specifications rework from `dev`:
`MiddleByProductMapper::copyAttributes()` + `copyAttributesByGroup()` with
`PRODUCT_ATTRIBUTES_LIST` / `PRODUCT_ATTRIBUTES_BY_GROUP`, including `d8326101c`.

Before signing off, compare the option coverage before and after — the rework replaces a flat
45-attribute list with six groups, so the resulting attribute set is different in both directions.
Two known changes: `product_options_and_accessories` disappears (desirable — see
`middleby_options_accessories_issue_stage.md`), and attribute codes are regenerated from the
MiddleBy label rather than the attribute code, e.g. `gas_conversion_kit` becomes
`gas_propane_conversion_kit`.

## Still open on both branches

`Product Dimensions (WxDxH) (mm)` is explicitly excluded from the import and exists on neither
branch — see `middleby_clearance_attributes_bug.md`.
