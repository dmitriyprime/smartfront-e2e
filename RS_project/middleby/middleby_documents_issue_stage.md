# Issue: MiddleBy PDFs are appended instead of replacing AQ ones, and 2 of 5 types are missing

- **Environment:** stage (`oners_stage`), branch `stage` @ `3aca91ddf`
- **Area:** MiddleBy import → product documents (PDFs)
- **Severity:** Medium — the product shows duplicate documents of the same kind, and two required
  document types never arrive
- **Related:** RSPA-719, `middleby_task_13_07.md` §5.
  **Both defects are already fixed on `dev`** — `c39a4b861 RSPA-719. 5. Documents`,
  `20b1f09ec RSPA-719. 5. Documents. Filtering`
- **Verified:** 2026-08-02 on product 611510

## Summary

Spec §5 requires the AQ PDFs to be **replaced** by MiddleBy ones, covering five types:
*Parts List, Brochure, Specification Sheet, User Manual, Warranty Sheet*.

Stage does neither. `updateDocuments()` appends to `$aqProductData['documents']` without removing
anything, and reads only three of the five source attributes.

## Evidence — product 611510

`1048_ZEPH-200-E ADDL_220/60/1`, vendor 81 Blodgett (Middleby),
MiddleBy uuid `829693a9-29c5-4e3a-abea-ff9697ab9fd0` — the worked example from the spec.

### MiddleBy supplies all five types

Confirmed against the live API (`GET {base_url}/products/829693a9-…`):

| CDN directory | source attribute | file |
|---|---|---|
| `partslist/` | `Parts_List` | `Blodgett_Zeph-200-E_ConvectionOven_PartsList_1.pdf` |
| `brochure/` | `Brochure` | `Energy-Star-sell.pdf` |
| `specsheets/` | `Spec_Sheets` | `Blodgett_Zephaire-200-E_ConvectionOven_SpecSheet_1.pdf` |
| `usermanuals/` | `User_Manuals` | `…_Manual_1.pdf`, `…_ManualFrench_1.pdf` |
| `warrantysheet/` | `warranty_sheet` | `Blodgett_Equipment_AllProducts_WarrantySheet_1.pdf` |

### What is stored

```sql
SELECT COUNT(*) AS total,
       SUM(d.remote_path LIKE '%middleby-cdn.com%')     AS from_middleby,
       SUM(d.remote_path NOT LIKE '%middleby-cdn.com%') AS from_aq
FROM document_product dp JOIN documents d ON d.id = dp.document_id
WHERE dp.product_id = 611510;
```

| | stage | dev | required |
|---|---|---|---|
| documents total | **9** | 6 | |
| from MiddleBy | 4 | **6** | all |
| **from AQ** | **5** | **0** | **0** |

**Defect 1 — appended, not replaced.** Five AQ documents remain on stage:
`cutsheet`, `Stacked HV100G-DFG100ES`, `Middleby Financial Flyer`, `Start Up Doc`, `warranty sheet`.

Two pairs are outright duplicates of the same kind:

| kind | AQ document | MiddleBy document |
|---|---|---|
| Spec sheet | `cutsheet` (`api.aq-fes.com/…`) | `Middleby CutSheet` (`…/specsheets/`) |
| Warranty sheet | `warranty sheet` (`api.aq-fes.com/…`) | *(not imported — defect 2)* |

**Defect 2 — only 3 of 5 types.** `MIDDLE_BY_PRODUCT_DOCUMENTS` on stage maps three attributes:

```php
private const array MIDDLE_BY_PRODUCT_DOCUMENTS = [
    self::MIDDLE_BY_SPEC_SHEETS_ATTRIBUTE  => ['name' => 'Middleby CutSheet',    'mediaType' => 'cutsheet'],
    self::MIDDLE_BY_USER_MANUALS_ATTRIBUTE => ['name' => 'Middleby User Manual', 'mediaType' => 'manual'],
    self::MIDDLE_BY_BROCHURE_ATTRIBUTE     => ['name' => 'Middleby Brochure',    'mediaType' => 'brochure'],
];
```

`Parts_List` and `warranty_sheet` are absent, so those files are ignored even though the payload
carries them.

## How dev fixes it

`updateDocuments()` on dev filters AQ documents of the same `mediaType` out before merging:

```php
$aqDocuments = array_filter($aqDocuments, function ($document) use ($mediaType) {
    return $document['mediaType'] !== $mediaType;
});
...
$aqProductData['documents'] = array_merge($aqDocuments, $mbDocuments);
```

and its `PRODUCT_DOCUMENTS` lists all five: `Parts_List`, `Brochure`, `Spec_Sheets`,
`User_Manuals`, `warranty_sheet`. On dev product 611510 ends up with 6 documents, **all** from
`middleby-cdn.com`, no AQ leftovers.

## ⚠️ Pitfall when verifying

Filter on **`middleby-cdn.com`**, not on `middleby`. The AQ document *"Middleby Financial Flyer"*
lives at `doclinks.aqnet.com/MIDMARSH/Centra Benefits of Financing- Middleby Update.pdf` — the word
appears inside an AutoQuotes URL. A `LIKE '%middleby%'` filter counts it as MiddleBy-sourced and
undercounts the AQ leftovers by one.

## Secondary observation — indistinguishable titles

On stage `documents.title` comes from the hardcoded constant, so the English and French manuals both
render as *"Middleby User Manual"* and cannot be told apart on the storefront. Dev derives the title
from the MiddleBy label (`…Manual 1` / `…ManualFrench 1`).

Also note every appended document is created with `'id' => ''` — the same empty-external-id pattern
that causes image duplication, see `middleby_media_ids_issue_stage.md`.

## Steps to reproduce

1. Baseline:
   ```sql
   SELECT d.title, LEFT(d.remote_path,70) AS src
   FROM document_product dp JOIN documents d ON d.id = dp.document_id
   WHERE dp.product_id = 611510 ORDER BY d.id;
   ```
2. Vendors → *Blodgett (Middleby)* → **Update**, then drain the queue
   (`php artisan queue:work --queue=auto_quotes`).
   Documents are **not** processed by `product:import` — `Updater::updateByProduct()` ends with
   `//TODO: update pdf`, so the full vendor import is required.
3. Re-run the query.

**Expected:** 6 documents, all from `middleby-cdn.com`, covering all five types.
**Actual:** 9 documents — 4 from MiddleBy (3 types), 5 AQ leftovers.

## Suggested fix

Port both dev commits: `c39a4b861` and `20b1f09ec`. In practice:

1. Extend `MIDDLE_BY_PRODUCT_DOCUMENTS` with `Parts_List` and `warranty_sheet`.
2. Filter AQ documents by `mediaType` before merging, as dev does.

Note dev derives `mediaType` from a substring of the URL rather than from the attribute
(`str_contains($url, 'brochure' | 'usermanuals' | 'warrantysheet')`), defaulting to `cutsheet`.
A Parts List therefore lands as `cutsheet` and will displace the spec sheet in the same bucket —
worth verifying on a product that has both.

Test cases covering this: **TC-MBS-12** and **TC-MBS-18** in `middleby_TCs_staging.md`.
