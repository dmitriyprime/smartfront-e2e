# Issue: attribute "Product Options and Accessories" is imported and displayed, but should not be

- **Environment:** stage (`oners_stage`), branch `stage` @ `3aca91ddf`
- **Area:** MiddleBy import → product options (spec table)
- **Severity:** Medium — an out-of-spec attribute is shown on the product with broken HTML
- **Related:** RSPA-719, `middleby_task_13_07.md` §2
- **Verified:** 2026-07-31

## Summary

The MiddleBy attribute `product_options_and_accessories` is imported into the product spec table as
option **"Product Options and Accessories"** (`product_options.id = 940`). It is **not** one of the
specification groups requested in `middleby_task_13_07.md` §2, which lists exactly seven:

> Function and Features · Energy Specifications · Gas Specifications ·
> Water, Plumbing and Drainage Specifications · Weights and Dimensions ·
> Installation Details · Additional Tech Specifications

On top of being out of scope, its value is an HTML block stored in a `varchar(255)` column, so it is
silently truncated mid-tag.

## Scope on stage

| | |
|---|---|
| products with the attribute | **84** (BKI, Imperial) |
| of them containing HTML | **84** (100%) |
| **truncated at the 255 limit** | **43** (51%) |
| value length | 10 – 255, avg 185 |

```sql
SELECT COUNT(*) FROM product_option_values WHERE option_id = 940;                          -- 84
SELECT COUNT(*) FROM product_option_values WHERE option_id = 940 AND CHAR_LENGTH(value) >= 255;  -- 43
```

## Example — unclosed tags

**Product 263554** — `2028_IPC-RS-14`, Imperial (Middleby),
uuid `dadd7eba-804c-4ede-86ef-f89f79fe65e2`, value length **255**:

```html
<p>•Stainless Steel Vessel Cover</p><p>• Pasta Basket Rack For IPC-14</p><p>• Pasta Basket Rack
For IPC-18</p><p>• Wire Mesh Pasta Insert</p><p>• Automatic Basket Lift With Computer</p>
<p>controls</p><p>• Stainless Steel Joiner Strip</p><p>• RINSE STATION
```

Last element `<p>• RINSE STATION` has no closing tag and the text itself is cut off.

**Product 263555** — `2028_IPC-RS-18`, same product line,
uuid `bb507acf-0be1-45e2-902b-cfb4bc0650ed`, value length **255**:

```html
… <div>• Automatic Basket Lift With Computer</div><div>controls</div><div><div>Stainless Steel Join
```

Ends on **two nested unclosed `<div>`s**; `Join` is a fragment of `Joiner Strip`.

Note the two neighbouring SKUs of the same line use different markup — `<p>` vs nested `<div>` —
so the source data is not normalised either.

## Root cause

`MiddleByProductMapper::MIDDLE_BY_PRODUCT_OPTIONS_LIST` on stage (line 75) includes
`product_options_and_accessories` among ~45 attributes. `copyMiddleByAttributes()` handles them all
identically — takes `$attributeValue[0]['data']` and appends a `property` / `value` pair to
`categoryValues`. The mechanism is designed for scalars ("Gas Type: Natural"); an HTML description
does not fit that contract and there is no exception for it.

Truncation is silent: `product_option_values.value` is `varchar(255)`, and MySQL in non-strict mode
emits a warning rather than an error, so the import reports success. Nothing appears in
`failed_jobs` or the `importMiddleByErrors` channel.

## Checked on dev — the attribute is absent there

| | stage | dev |
|---|---|---|
| in the mapper's attribute lists | ✅ present | 🔴 absent |
| `product_options` row exists | ✅ id 940 | 🔴 no row at all |
| products carrying the value | 84 | **0** |

```sql
-- dev
SELECT id, name, option_code FROM product_options WHERE option_code LIKE '%options_and_access%';
-- (no rows)
```

```bash
git show dev:Modules/ImportMiddleBy/app/Services/MiddleByProductMapper.php \
  | grep -n "product_options_and_accessories"     # no matches
```

This is not an empty-dataset artefact — dev has MiddleBy options populated more richly than stage:

| option_code | dev | stage |
|---|---|---|
| `country_of_origin` | 1321 | — |
| `electrical_phase` | 874 | 33 |
| `electrical_volts` | 874 | 33 |
| `gas_type` | 129 | 21 |
| `gas_total_btus` | 124 | 16 |
| **`product_options_and_accessories`** | **0** | **84** |

`dev` replaced the flat 45-attribute list with four named attributes plus six attribute groups, and
`product_options_and_accessories` was dropped in that rework.

## Suggested fix

Remove `product_options_and_accessories` from `MIDDLE_BY_PRODUCT_OPTIONS_LIST` on stage — this
matches what `dev` already does and requires no schema change.

If the business does want this content on the product, it must not be stored as an option:
`varchar(255)` cannot hold it. It would need its own text column, in the manner of
`products.warranty` or `products.bullets`.

**Cleanup:** the 84 existing values remain in `product_option_values` after the code change; they
need to be deleted separately.

```sql
-- rows to remove
SELECT COUNT(*) FROM product_option_values WHERE option_id = 940;   -- 84
```
