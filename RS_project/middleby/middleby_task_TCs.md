# MiddleBy — Test Cases (RSPA-719 / task 13_07)

Manual test cases for the fixes described in `middleby_task_13_07.md`.
Reference: `middleby_doc.md`.

Each case has **UI steps** and a **DB verification** query. Run on the **dev** server.

---

## Preconditions & environment

- **App (dev):** the FEDA dev instance / handbook.
- **DB (read-only, via tunnel):** host `127.0.0.1`, port `3307`, user `oners_read`,
  db `oners_dev`.
  ```bash
  export MYSQL_PWD='<oners_read password from .mcp.json>'
  mysql -h 127.0.0.1 -P 3307 -u oners_read oners_dev -e "<query>"
  ```
- **Reference product** (the example from `middleby_task_13_07.md`):
  - product `id = 611510`, `sku = 1048_ZEPH-200-E ADDL_220/60/1`
  - vendor `81` = *Blodgett (Middleby)*
  - AQ `external_id = 0c218722-1048-df11-beff-001ec95274b6`
  - MiddleBy `uuid = 829693a9-29c5-4e3a-abea-ff9697ab9fd0`
  - Handbook: `/handbook/product-view/611510`
- **Sibling variants** (same import, useful for spot-checks):
  `611508, 611509, 611511, 611512, 611513`.
- **Second product** (fallback / cache checks): mfrModel `P601HT`,
  uuid `40a6c35b-ebdf-44d2-afb4-b543a3a32430`.

### How to (re)trigger an import
- **UI:** `Import` → `List of vendors` → *Blodgett (Middleby)* → **Load**.
- **CLI (in container):** `php artisan product:import --external_id=0c218722-1048-df11-beff-001ec95274b6`

> All expected DB values below reflect the state already present on dev at time of writing;
> after a fresh import they should match (counts may grow if MiddleBy adds assets).

---

## 1. Media

### TC-MB-01 — Images are merged (AQ + MiddleBy), not replaced
**Covers:** task §1 (Feature + Alternate photos), fixed in `fcdfad3be`.

**Steps (UI)**
1. Open `/handbook/product-view/611510`.
2. Inspect the images/media block.

**Expected**
- Both the original AQ image(s) **and** the additional MiddleBy images are shown together
  (AQ images are not removed).

**DB verification**
```sql
SELECT i.id, i.name, i.mimetype
FROM images i JOIN image_product ip ON ip.image_id = i.id
WHERE ip.product_id = 611510
ORDER BY i.id;
```
- Expect a mix: at least one `image/png` (AQ) **plus** several `image/jpeg` (MiddleBy) rows,
  i.e. more than one image total.

---

### TC-MB-02 — MiddleBy video is imported and stored (not rasterized)
**Covers:** task §1 (Marketing videos); `ImageHandler` mp4 support + `ImageProcessor` Imagick
skip (`fcdfad3be`, `2e801c5f2`).

**Steps (UI)**
1. Re-run the import for the product (or vendor).
2. No errors in the import; the product saves successfully.

**Expected**
- A video media row exists with `mimetype = video/mp4` and `name = video`.
- The import does **not** fail on the mp4 (Imagick is skipped for video).

**DB verification**
```sql
SELECT i.id, i.name, i.mimetype, RIGHT(i.local_path, 24) AS path_tail
FROM images i JOIN image_product ip ON ip.image_id = i.id
WHERE ip.product_id = 611510 AND i.mimetype = 'video/mp4';
```
- Expect ≥ 1 row, `name = video`, `path_tail` ending in `.mp4`.

**Negative / regression note**
- Before the fix, an mp4 URL fell back to `.jpg` and Imagick tried to read it → import error.
  Check `storage` logs (`importMiddleByErrors`) show **no** Imagick/mapping error for this product.

---

### TC-MB-03 — Video renders on the handbook
**Covers:** `PageConstructor` + handbook blade (`d817ab18c`).

**Steps (UI)**
1. Open `/handbook/product-view/611510`.
2. Locate the imported video in the media grid.

**Expected**
- The video is rendered as an HTML5 `<video controls>` player (not a broken `<img>`).
- Images continue to render as `<img>` thumbnails/links.

**DB verification** (data feeding the view)
```sql
SELECT i.mimetype, COUNT(*) c
FROM images i JOIN image_product ip ON ip.image_id = i.id
WHERE ip.product_id = 611510
GROUP BY i.mimetype;
```
- Expect at least `video/mp4` and one image type; the blade switches on `mimetype === 'video/mp4'`.

---

### TC-MB-04 — Media exported to Shopify (image → IMAGE, video → VIDEO), failure isolated
**Covers:** `ShopifyProduct/Media` + `Source` + `Exporter` unlock (`0560db054`, `790c86550`).

**Steps (UI)**
1. Export product 611510 to a Shopify store (via the normal Shopify export flow).
2. Open the product in the Shopify admin.

**Expected**
- Images are created as media of type **IMAGE**; the mp4 as media of type **VIDEO**.
- If a single asset fails to upload, the export **continues** for the rest (product is not left
  half-exported); the failure is logged to the `shopifyProductMedia` channel with the product id
  and media source.

**Verification**
- Shopify admin: product has both image media and the video media.
- Log check (in container): `storage/logs/...shopifyProductMedia...` contains a per-asset error
  line only for genuinely failing assets, and export of the product completes.

---

### TC-MB-12 — 3D / interactive assets
**Covers:** task §1 *"3d Assets (WHEN AVAILABLE)"*. **N/A — the source provides no such data.**

Checked against the MiddleBy API on 2026-08-02: seven full product cards across four brands and
three product families, plus a 100-product `/products/search` sweep. The complete media attribute
inventory is:

| group | attributes |
|---|---|
| `media_assets_attribute_group` | `PhotoFeature`, `PhotoAlt`, `VideoFeature`, `Brochure`, `Spec_Sheets`, `User_Manuals`, `warranty_sheet`, `brand_catalog`, `image_remarks`, `Images_Shown_Are_Actual_Product` |
| `technical_service_assets_attribute_group` | `Parts_List` |

No attribute code matches `3d`, `interactive`, `augmented`, `glb`, `usdz`, `gltf`, `render`, `cad`,
`revit`, `bim`, `spin`, `360` or `tour`.

**Verdict:** nothing to implement while the catalogue carries no 3D attribute — the spec's own
"when available" qualifier covers this. Re-check if MiddleBy extends the Akeneo family, and confirm
with the customer whether "3D assets" meant something outside the product API.

```bash
php artisan middleby:get:product 829693a9-29c5-4e3a-abea-ff9697ab9fd0 \
  | grep -ciE '3d|interactive|augmented|\.glb|\.usdz|\.gltf'    # expect 0 real matches
```

---

## 2. Specifications

### TC-MB-05 — Only the 3 base rows kept, all other AQ specs replaced by MiddleBy
**Covers:** task §2; `copyAttributes` + `copyAttributesByGroup`.
**⚠️ Corrected 2026-08-02 — this case previously asserted the opposite of the requirement.**

> **Requirement clarified.** "Keep the first 3 AQ groups" means the **top three rows of the
> Technical details block** — *Manufacturer*, *Model Number*, *Manufacturer Part #* — not AQ
> specification groups. They are the hardcoded `# Base specs` block at the start of
> `SpecHelper::getSpecsData()` and always come first. Everything after them must come from MiddleBy.
>
> The earlier wording of this case ("initial AQ specification groups remain … MiddleBy specs are
> appended") described the current behaviour, not the requirement, and would be marked **PASS**
> while §2 is violated.

**Steps (UI)**
1. Open `/handbook/product-view/611510`.
2. Review the Technical details section.

**Expected**
- Rows 1–3 are *Manufacturer*, *Model Number*, *Manufacturer Part #*.
- Every following row comes from MiddleBy — *Function and Features*, *Energy Specifications*,
  *Water/Plumbing*, *Weights and Dimensions*, *Installation Details*, clearance, etc.
- **No AQ-sourced specification remains.**

**DB verification**
```sql
-- AQ-sourced options: written by an AutoQuotes import and never touched since
SELECT po.name, pov.value, pov.updated_at
FROM product_option_values pov
JOIN product_options po ON po.id = pov.option_id
WHERE pov.product_id = 611510 AND pov.updated_at < '2026-01-01'
ORDER BY po.name;
```

**Expected:** 0 rows.

**Actual on dev (2026-08-02): 9 rows — the case FAILS.**

| option_code | value |
|---|---|
| `base` | Legs |
| `control_type` | Solid State Controls |
| `deck_qty` | 1 Deck |
| `energy_efficiency` | ENERGY STAR® |
| `exterior_finish` | All Stainless Steel Exterior |
| `interior_finish` | Porcelain Interior |
| `kw_per_deck` | 11.0 - 15.99 KW |
| `size` | Deep/bakery Size |
| `type` | Standard |

All nine carry `updated_at = 2023-03-02 16:58:35` on dev **and** stage — never replaced.

Totals for reference: 56 options on dev, 27 on stage. The MiddleBy side works (47 vs 18
MiddleBy-era options); only the removal of AQ specs is missing.

See `middleby_aq_groups_not_replaced_issue_stage.md` and
`middleby_specifications_groups_issue.md`.

---

## 3. Certifications

### TC-MB-06 — Only missing certifications imported (no duplicates)
**Covers:** task §3; `updateProductCertifications` (`in_array` skip).

**Steps (UI)**
1. Open `/handbook/product-view/611510`.
2. Review the Certifications section.

**Expected**
- Certifications already present on the product are **not** duplicated.
- Certifications present in MiddleBy but missing on the product are **added**.

**DB verification**
```sql
SELECT certifications FROM products WHERE id = 611510;
```
- Expect a JSON array with **unique** values, e.g.
  `["NSF","CE","ETL","ENERGY STAR","cETLus","Made in USA"]` — no repeated entries.

**Regression check**
- Re-run the import; the array must stay de-duplicated (no growth from repeats).

---

## 4. Warranty

### TC-MB-07 — AQ warranty replaced by MiddleBy warranty
**Covers:** task §4; `copyWarrantyByGroup` + `Updater` HTML formatting.

**Steps (UI)**
1. Open `/handbook/product-view/611510`.
2. Review the Warranty section.

**Expected**
- Warranty content comes from MiddleBy (`warranty_and_disclaimers_attribute_group`), rendered as
  `property: value` lines.

**DB verification**
```sql
SELECT warranty FROM products WHERE id = 611510;
```
- Expect HTML like:
  ```html
  <p><b>Primary Warranty</b>: 2 Years Parts and Labor</p>
  <p><b>Additional Warranty</b>: 3 Years Oven Door Only</p>
  ```

---

## 5. Downloads / PDFs

### TC-MB-08 — MiddleBy documents imported with correct media types
**Covers:** task §5; `updateDocuments` (`c39a4b861`).

**Steps (UI)**
1. Open `/handbook/product-view/611510`.
2. Review the Downloads / Documents section.

> ⚠️ **Use the full vendor import for this case.** `product:import` does **not** process documents —
> `Updater::updateByProduct()` ends with `//TODO: update pdf` (`app/Models/Product/Updater.php`).
> Run Vendors → *Blodgett (Middleby)* → **Update** and drain the queue
> (`php artisan queue:work --queue=auto_quotes`), otherwise the case yields a false negative.

**Expected**
- MiddleBy PDFs are present: **Parts List, Brochure, Spec Sheet, User Manual, Warranty Sheet**.
- Their media types map correctly (brochure→brochure, usermanuals→manual,
  warrantysheet→warrantysheet, else cutsheet).
- **AQ documents of the same media type are gone** — §5 says *replace*, not append.
  `updateDocuments()` on dev filters them out before merging:
  ```php
  $aqDocuments = array_filter($aqDocuments, fn($d) => $d['mediaType'] !== $mediaType);
  ```

**DB verification**
```sql
SELECT d.title, d.mimetype, d.status,
       CASE WHEN d.remote_path LIKE '%middleby-cdn.com%' THEN 'MiddleBy' ELSE 'AQ' END AS src
FROM documents d JOIN document_product dp ON dp.document_id = d.id
WHERE dp.product_id = 611510
ORDER BY src, d.title;
```

**Actual on dev (2026-08-02) — 6 documents, all from MiddleBy, 0 from AQ:**

| cdn dir | title |
|---|---|
| `brochure/` | Blodgett Energy Star Brochure |
| `partslist/` | Blodgett Zeph 200 E ConvectionOven PartsList 1 |
| `specsheets/` | Blodgett Zephaire 200 E ConvectionOven SpecSheet 1 |
| `usermanuals/` | Blodgett Zephaire E ConvectionOven Manual 1 |
| `usermanuals/` | Blodgett Zephaire E ConvectionOven ManualFrench 1 |
| `warrantysheet/` | Blodgett Equipment AllProducts WarrantySheet 1 |

This case **passes on dev**. On stage it fails on both counts — 9 documents, 5 of them AQ
leftovers, and only 3 of the 5 types imported (`middleby_documents_issue_stage.md`).

> ⚠️ Classify by **`middleby-cdn.com`**, not by `middleby`. The AQ document
> *"Middleby Financial Flyer"* lives at `doclinks.aqnet.com/MIDMARSH/…Middleby Update.pdf` and a
> `LIKE '%middleby%'` filter miscounts it as MiddleBy-sourced.

> **Watch on a product with both:** dev derives `mediaType` from a URL substring with `cutsheet` as
> the default, so a **Parts List also lands as `cutsheet`** and will displace the Spec Sheet in the
> same bucket during filtering. On 611510 both survived — verify on other products.

---

## 6. Fallback

### TC-MB-09 — No MiddleBy match → AQ data retained
**Covers:** fallback guarantee (`middleby_doc.md` §7).

**Steps (UI)**
1. Import a product whose brand is **not** in `autoquote_to_middleby_brands`, or whose
   `(mfrId, mfrModel)` has no MiddleBy match.
2. Open the product in the handbook.

**Expected**
- The product shows **only** its original AQ content (no MiddleBy images/video/specs/warranty/
  PDFs added).
- `storage/logs` `importMiddleBy` channel logs one of: *"Brand is not mapped"*,
  *"MiddleBy data is empty"*, or *"Empty one of the fields"* — and the import completes without
  error.

**DB verification**
```sql
-- brand not mapped example: pick a non-Middleby vendor's product <PID>
SELECT i.mimetype, COUNT(*) c
FROM images i JOIN image_product ip ON ip.image_id = i.id
WHERE ip.product_id = <PID> GROUP BY i.mimetype;
```
- Expect **no** `video/mp4` rows and no MiddleBy-only content for that product.

---

### TC-MB-10 — MiddleBy match but a section is missing → only available sections enriched
**Covers:** per-section fallback (each `update*/copy*` returns early).

**Steps (UI)**
1. Import a mapped MiddleBy product that lacks a particular section (e.g. no video, or no
   warranty in MiddleBy).
2. Open the product.

**Expected**
- Sections that MiddleBy provides are enriched; the missing section keeps the AQ value (or stays
  empty as before). No error is thrown; other sections still import.

**DB verification**
```sql
-- e.g. verify warranty untouched when MiddleBy has no warranty group
SELECT warranty, certifications FROM products WHERE id = <mapped_product_without_warranty>;
```

---

### TC-MB-11 — Product mapping cache created / reused
**Covers:** `Services/Product::getData` + `autoquote_middleby_product_mappings`.

**Steps**
1. Import a mapped MiddleBy product for the first time (or use 611510's model).
2. Re-run the import.

**Expected**
- A mapping row `(mfrId, mfrModel) → middlebyUuid` exists after the first import.
- The second import reuses the cached UUID (no new API search; `updated_at` may refresh but the
  `middlebyUuid` stays the same).

**DB verification**
```sql
SELECT id, mfrId, mfrModel, middlebyUuid, updated_at
FROM autoquote_middleby_product_mappings
WHERE mfrModel = 'ZEPH-200-E ADDL';
```
- Expect a row with `middlebyUuid = 829693a9-29c5-4e3a-abea-ff9697ab9fd0`.

---

## Summary matrix

| TC        | Task section | Area                    | Key DB check                                  |
| --------- | ------------ | ----------------------- | --------------------------------------------- |
| TC-MB-01  | §1           | Images merged           | `images`+`image_product` mixed types          |
| TC-MB-02  | §1           | Video imported/stored   | `images.mimetype = video/mp4`, `name = video` |
| TC-MB-03  | §1           | Video on handbook       | mimetype distribution feeds `<video>`         |
| TC-MB-04  | §1           | Shopify media export     | IMAGE/VIDEO types, failure isolated           |
| TC-MB-12  | §1           | 3D assets                | **N/A** — no such attribute in the source      |
| TC-MB-05  | §2           | **AQ specs replaced**    | 0 rows with `updated_at < 2026` — **FAILS (9)** |
| TC-MB-06  | §3           | Certifications (missing) | `products.certifications` unique JSON         |
| TC-MB-07  | §4           | Warranty replaced        | `products.warranty` HTML                       |
| TC-MB-08  | §5           | PDFs replaced, 5 types   | 6 docs, all `middleby-cdn.com`, 0 AQ          |
| TC-MB-09  | fallback     | No MiddleBy match        | AQ-only content, log warning                  |
| TC-MB-10  | fallback     | Missing section          | untouched section                             |
| TC-MB-11  | infra        | Mapping cache            | `autoquote_middleby_product_mappings`         |
