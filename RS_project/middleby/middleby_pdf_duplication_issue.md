# Issue: MiddleBy PDF import duplicates Warranty Sheet, Cutsheet (Spec Sheet) & User Manual

- **Environment:** dev (`oners_dev`)
- **Area:** MiddleBy import → product documents (PDFs)
- **Severity:** Medium — duplicate PDFs shown on product / exported downstream
- **Related:** RSPA-719, `middleby_task_13_07.md` §5 ("Replace the AQ PDFs with those imported from MiddleBy")

## Summary

When a product is enriched from MiddleBy, the MiddleBy documents are **added on top of** the
existing AutoQuotes (AQ) documents instead of **replacing** them. As a result the product ends up
with **two copies** of the same document type:

- **Warranty Sheet:** AQ `warranty sheet` **+** MiddleBy `…/warrantysheet/…`
- **Cutsheet / Spec Sheet:** AQ `cutsheet` **+** MiddleBy `…/specsheets/…` (imported with mediaType `cutsheet`)
- **User Manual:** AQ manuals (Installation & Operation, French/Spanish/Portuguese/Owner's Manual)
  **+** MiddleBy `…/usermanuals/…` (mediaType `manual`)

This contradicts the spec (`middleby_task_13_07.md` §5), which says the AQ PDFs should be
**replaced** by the MiddleBy ones.

### Per-type check (enriched vendors 81 / 78 / 311)

| Type | Duplicated? | Notes |
| ------------ | ----------- | ----- |
| Warranty Sheet | **Yes** | AQ `warranty sheet` + MiddleBy `/warrantysheet/` |
| Cutsheet / Spec Sheet | **Yes** | AQ `cutsheet` + MiddleBy `/specsheets/` (both mediaType `cutsheet`) |
| User Manual | **Yes** | AQ manuals + MiddleBy `/usermanuals/` (mediaType `manual`) |
| Brochure | No | AQ provides no brochure (0 products) → nothing to duplicate |
| Parts List | No | AQ has no parts-list doc; MiddleBy `/partslist/` is imported as mediaType `cutsheet` (adds to the cutsheet bucket, but no AQ parts-list counterpart) |

## Evidence (product 611510, `1048_ZEPH-200-E ADDL_220/60/1`)

| doc id | title | source | note |
| ------ | ----------------------------------- | -------- | ---- |
| 75429  | cutsheet                            | AQ (`api.aq-fes.com`) | duplicate of ↓ |
| 93948  | Blodgett Zephaire 200 E … SpecSheet | MiddleBy (`middleby-cdn.com/specsheets/`) | duplicate of ↑ |
| 63760  | warranty sheet                      | AQ (`api.aq-fes.com`) | duplicate of ↓ |
| 93946  | Blodgett Equipment … WarrantySheet  | MiddleBy (`middleby-cdn.com/warrantysheet/`) | duplicate of ↑ |

### Scope (vendors 81 Blodgett / 78 BKI / 311 Imperial)
- **65** products have a duplicated **warranty sheet** (AQ + MiddleBy)
- **73** products have a duplicated **cutsheet / spec sheet** (AQ + MiddleBy)
- **8** products have a duplicated **user manual** (AQ manual + MiddleBy usermanual) — all Blodgett
  (611482–611485, 611752/611753, 611778/611779). Example 611482: AQ {Spanish, French, Portuguese,
  Installation & Operation} manuals **+** MiddleBy {Manual, ManualFrench, ManualSpanish,
  ManualPortuguese} — duplicated per language.

## Root cause

`MiddleByProductMapper::updateDocuments()` **appends** MiddleBy documents to
`$aqProductData['documents'][]` and never removes the pre-existing AQ documents of the same type:

```php
// Modules/ImportMiddleBy/app/Services/MiddleByProductMapper.php (updateDocuments)
$aqProductData['documents'][] = [
    'name' => $attributeValueLabel,
    'url'  => $attributeValueUrl,
    'mediaType' => $mediaType, // brochure / manual / warrantysheet / cutsheet
    ...
];
```

So AQ `cutsheet` / `warranty sheet` documents remain, and the MiddleBy equivalents are added
alongside → duplication.

## Expected behavior

Per `middleby_task_13_07.md` §5, MiddleBy PDFs (Parts List, Brochure, Spec Sheet, User Manual,
Warranty Sheet) should **replace** the AQ documents — i.e. when a MiddleBy document of a given
type is imported, the corresponding AQ document of that type should be removed (fallback to AQ
only when MiddleBy has no such document).

## Fix direction

- Before appending MiddleBy documents, drop the AQ documents whose `mediaType` matches an incoming
  MiddleBy `mediaType` (at minimum `cutsheet` and `warrantysheet`), so the MiddleBy version
  replaces rather than duplicates.
- Keep the fallback: if MiddleBy provides no document of that type, retain the AQ one.

## Verification query

```sql
-- Products with BOTH an AQ and a MiddleBy warranty sheet
SELECT dp.product_id
FROM documents aq
JOIN document_product dp ON dp.document_id = aq.id
WHERE aq.title = 'warranty sheet' AND aq.remote_path LIKE '%aq-fes.com%'
  AND EXISTS (
    SELECT 1 FROM documents mb
    JOIN document_product dp2 ON dp2.document_id = mb.id
    WHERE dp2.product_id = dp.product_id
      AND mb.remote_path LIKE '%middleby-cdn.com/warrantysheet%'
  );
-- (swap title='cutsheet' + '%specsheets%' for the cutsheet duplication)
```

## Reference

- `Modules/ImportMiddleBy/app/Services/MiddleByProductMapper.php::updateDocuments()` — appends, does not replace.
- AQ docs come from `api.aq-fes.com`; MiddleBy docs from `middleby-cdn.com/{brochure,warrantysheet,partslist,specsheets,usermanuals}/`.
- See `middleby_doc.md` §4.5 (Documents / PDFs).
