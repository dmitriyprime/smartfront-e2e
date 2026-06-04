# QA Report — Essendant Fixes (RSPA-706)

**Date:** 2026-06-04 · **Branch:** `stage`

## What was fixed

| # | Fix | Commit | What to verify |
|---|-----|--------|----------------|
| 1 | **Outer GTIN now populated** — internal `gtin_outer` is mapped from the feed's `gtin_ctn` (carton GTIN) instead of a non-existent `gtin_outer` field. | `b7c3366c8` | Imported Essendant products show a non-empty carton/outer GTIN. |
| 2 | **UPC sent on Shopify export** — UPC is now emitted as a product spec/option during export, with fallback `gtin_each → gtin_inner → gtin_outer`. | `8af1847cc` | Exported Shopify products have a **UPC** spec value. |
| 3 | **Vendor UPC no longer overwritten** — an explicit UPC from the feed (`upc_rtl`) is kept; GTIN is only used when no UPC exists. | `7679571cd` | When the feed provides a UPC, that exact value appears (not a GTIN). |
| 4 | **Option filter keeps "0" values** — strict empty check so legitimate `0` / `"0"` option values are no longer dropped. | `e81f900c2` | Options like Pack quantity / Carton weight with value `0` still appear. |
| 5 | **Correct product total** — import progress/total count corrected in DataRetriever. | `a2518a46e` | Import progress bar / total matches actual product count. |
| 6 | **NetSuite vendor SKU** — Essendant vendor SKUs export to NetSuite. | `3dca016ac`, `a65708390` | NetSuite receives the Essendant vendor SKU. |
| 7 | **Prop65 type fix** | `00d7c31ab` | Proposition 65 flag exports with the correct type/value. |
| 8 | **Lead time value fix** | `6ff3207fc` | Shipping/lead time value exports correctly. |
| 9 | **Image processing optimisation & scaling** | `85a88619c` | Image import completes faster without errors on large batches. |

## Affected areas (what to regression-test)
- **Essendant import** (Vendor Merge → products → images → documents).
- **Shopify export** of Essendant products — specs: **UPC, GTIN, Pack quantity, Carton weight, Country of origin, UNSPSC, Prop 65, lead/shipping time**.
- **NetSuite export** — vendor SKU.

## Focus / highest-risk checks
1. UPC precedence: feed UPC vs. GTIN fallback (#2, #3) — verify both "feed has UPC" and "feed has only GTIN" cases.
2. Zero-valued options no longer disappear (#4).
3. Outer GTIN is populated after import (#1).
