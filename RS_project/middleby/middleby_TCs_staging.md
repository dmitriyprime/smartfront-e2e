# MiddleBy → RestaurantSupply — Test Cases (staging)

Manual test cases for `middleby_task_13_07.md`, targeting the **stage** environment.

Verified against branch `stage` (`3aca91ddf`) and DB `oners_stage` on 2026-07-31.

---

## ⚠️ Read this first — what is actually deployed on stage

**The MiddleBy integration itself is not new and is present on stage.** It landed on `master` on
2025-09-22 (`73b816da7 RSPA-720: add event requests and mapper`) and has been running since —
feature photos, certifications, document import and attribute copying all work on stage today.

What is missing is the **July 2026 increment**. The `stage` branch contains only the early RSPA-719
commits; the later ones exist on `dev` only:

```
on stage + master          on dev only
---------------------      ----------------------------------------------
b194e3013  event            5e9729319  RSPA-719. 3. Certifications
21e261d7d  product search   3a0d5c885  RSPA-719. 4. Warranty
6d02beba1  mapping          c39a4b861  RSPA-719. 5. Documents
74193308c  mapping          fcdfad3be  Add additional images and video
86749694a  mapping + logger 2e801c5f2  Fix video parameters
06ed390e0  product attrs    d8326101c  RSPA-719. 2. Specifications. Clearance
                            20b1f09ec  RSPA-719. 5. Documents. Filtering
                            06ec03c1f  Fix of the media upload [ids]
```

Confirmed two ways:

```bash
git show stage:Modules/ImportMiddleBy/app/Services/MiddleByProductMapper.php | grep -c 'PhotoAlt\|VideoFeature'   # 0
git show dev:Modules/ImportMiddleBy/app/Services/MiddleByProductMapper.php   | grep -c 'PhotoAlt\|VideoFeature'   # 2
```

```sql
-- stage DB: every MiddleBy image still uses the old timestamp id scheme
SELECT COUNT(*) FROM images WHERE external_id LIKE 'mb\_%';        -- 0
SELECT COUNT(*) FROM images WHERE remote_path LIKE '%middleby%';   -- 171, all `image<timestamp>`
```

### Coverage of `middleby_task_13_07.md` on stage

| § | Requirement | On stage | On dev | Notes |
|---|---|---|---|---|
| 1 | Feature Photos merged with AQ | ✅ | ✅ | both read `PhotoFeature` |
| 1 | Alternate Photos (`PhotoAlt`) | 🔴 | ✅ | stage never requests the attribute; dev merges it in `updatePictures()` |
| 1 | Marketing videos (`VideoFeature`) | 🔴 | ✅ | dev derives `mediaType` from the file extension (`mp4`, `webm`) |
| 1 | 3D assets | 🔴 | 🔴 | not implemented on either branch — no attribute is read |
| 1 | Stable media ids (no duplication) | 🔴 | ✅ | dev: `mb_p_<slug>` / `mb_v_<slug>` (`06ec03c1f`); stage: `image<timestamp>` |
| 2 | Keep first 3 AQ spec groups, replace the rest | 🔴 | 🔴 | stage copies a flat list of ~45 attributes. dev copies 6 named groups and attaches a `group` key (`d8326101c`), **but that key is discarded on save** — `Option::saveProduct()` reads only `property` and `value`, `Modules/Product/app/Repositories/Product/Option.php` is byte-identical on both branches, and `product_options` / `product_option_values` have no group column (verified on `oners_stage`). No migration on `dev` adds one. Implementing §2 requires a schema + repository change, not just a promotion |
| 3 | Import only **missing** certifications | ✅ | ✅ | dev reads the `regulation_compliance_certifications` group; stage reads the `product_certifications` attribute |
| 3 | Robust when AQ has no certifications | 🔴 | 🔴 | `in_array($label, $aqProductData['certifications'])` has no null guard on **either** branch — see TC-MBS-09 |
| 4 | Replace AQ warranty with MiddleBy warranty | 🔴 | ✅ | **two separate gaps on stage.** (a) mapper: no `copyWarrantyByGroup()` — `grep -rni warrant Modules/ImportMiddleBy/` is empty; dev builds `warranties[]` from `warranty_and_disclaimers_attribute_group`. (b) persistence: `app/Models/Product/Updater.php` on stage contains no `warranty`/`warranties` at all, while dev formats them at lines 196–215 and writes `products.warranty` at line 341. Porting only the mapper would silently drop the data |
| 5 | Replace AQ PDFs with MiddleBy PDFs | ⚠️ partial | ✅ | stage **appends**; dev drops AQ documents of the same `mediaType` via `array_filter` before merging |
| 5 | All 5 document types | 🔴 3 of 5 | ✅ 5 of 5 | stage: CutSheet, User Manual, Brochure. dev adds `Parts_List` and `warranty_sheet` |
| — | Fallback to AQ when no match / no content | ✅ | ✅ | guard clauses in every `update*` method |

> **Cases marked 🔴 / ⚠️ below are expected to fail on stage.** They are included so QA can confirm
> the gap rather than re-discover it, and so the same document can be re-run after `dev` is promoted.
> Do **not** raise them as new bugs — reference this table instead.

The July increment is a mix of bug fixes and net-new behaviour. Fixes to code that already runs on
stage: `06ec03c1f` (media ids), `2e801c5f2` (video parameters), `790c86550` (Shopify export unlock),
`20b1f09ec`, `d8326101c`. Net-new — verified with `git log --all -S<needle>`, which returns exactly
one commit each and nothing on `master` in the entire history:

| Behaviour | Introduced by | Ever on master |
|---|---|---|
| `copyWarrantyByGroup()` + `products.warranty` write | `3a0d5c885` (2026-07-15, +59 / −0) | no |
| `PhotoAlt` / `VideoFeature` | `fcdfad3be` (2026-07-16, +61 / −18) | no |
| `Parts_List`, `warranty_sheet` document types | `c39a4b861` (2026-07-16, +85 / −34) | no |

The distinction matters only for planning: these three cannot be reached by re-running or
reconfiguring stage, they need the code deployed.

---

## Environment & preconditions

- **App:** FEDA stage instance, handbook UI.
- **Container:** `./dev/docker/connect.sh` (or `docker exec -it -u www-data feda_php bash`).
- **DB (read-only, via tunnel):** host `127.0.0.1`, port `3307`, user `oners_read`, db `oners_stage`.

  ```bash
  export MYSQL_PWD='<oners_read password from .mcp.json>'
  mysql --skip-ssl -h 127.0.0.1 -P 3307 -u oners_read oners_stage -e "<query>"
  ```

  > `--skip-ssl` is required — the server does not offer TLS and the MariaDB client otherwise
  > fails with `ERROR 2026: TLS/SSL error`.

### How the integration is triggered

```
AutoQuote::getProduct()            app/Traits/AutoQuote.php:97
  └─ event ImportMiddleByProductDataModified
       └─ ProductDataModifiedListener::handle()
            ├─ BrandMapping::getMiddleByBrand(mfrName)      ← gate: brand must be mapped
            ├─ AutoQuoteMiddleByProductMapping::findByMfrData(mfrId, mfrModel)
            │    └─ miss → ImportMiddleBy::getProductMiddleByUuid() → cache the mapping
            └─ MiddleByProductMapper::mapProduct()
```

### Triggers and what each one covers

| Trigger | Products / options | Certifications | Images | **Documents** |
|---|---|---|---|---|
| `php artisan product:import --product_id=<id>` | ✅ | ✅ | ✅ | 🔴 |
| `php artisan product:images --product_id=<id>` | 🔴 | 🔴 | ✅ | 🔴 |
| Vendors → **Update** (full vendor import) | ✅ | ✅ | ✅ | ✅ |

**`updateByProduct()` ends with `//TODO: update pdf`** (`app/Models/Product/Updater.php:184`) —
the single-product path never touches documents. **Section 5 cases must use the full vendor
import**, otherwise they will show no change and produce a false negative.

Inspect raw MiddleBy payloads directly:

```bash
php artisan middleby:get-token
php artisan middleby:get:product <middlebyUuid>
```

Process the queue after a vendor import: `php artisan queue:work --queue=auto_quotes`

### Reference products on stage

| Purpose | product id | SKU | Vendor | mapping `mfrModel` | MiddleBy uuid |
|---|---|---|---|---|---|
| Task-doc example | **611510** | `1048_ZEPH-200-E ADDL_220/60/1` | 81 Blodgett (Middleby) | `ZEPH-200-E ADDL` | `829693a9-29c5-4e3a-abea-ff9697ab9fd0` |
| Media completeness | **666040** | `2028_IPC-14_LP` | 311 Imperial (Middleby) | `IPC-14` | `60a8609e-e79e-4219-ad2d-9d4059d5602b` |
| Documents / spec options | **263547** | `2028_IHR-XX-SC-36` | 311 Imperial (Middleby) | `IHR-XX-SC-36` | `1780bd3c-5735-41df-9963-76db97744974` |
| Rich media + docs | **306658** | `5226_XPRESSTOUCH 0` | 136 Concordia (Middleby) | — (see note) | — |
| No AQ certifications | **16468** | `1023_A3301001` | 36 ANETS (Middleby) | `A3301001` | `b4384bd2-ac9e-4c7a-b3ee-fa2617c2061a` |

> ⚠️ **Do not look the uuid up by `products.model = mappings.mfrModel`.** The mapping key is the AQ
> API's `models.mfrModel`, while `products.model` often carries a variant suffix that AQ appends —
> `IPC-14_LP` vs `IPC-14`, `ZEPH-200-E ADDL_220/60/1` vs `ZEPH-200-E ADDL`. A strict join returns
> `NULL` for products that are in fact mapped. Use a prefix match instead:
>
> ```sql
> SELECT p.id, p.sku, p.model, m.mfrModel, m.middlebyUuid
> FROM products p
> JOIN vendors v ON v.id = p.vendor_id
> JOIN autoquote_middleby_product_mappings m
>   ON m.mfrId = v.external_id AND p.model LIKE CONCAT(m.mfrModel, '%')
> WHERE p.id = <product_id>;
> ```
>
> Product **306658** matches no mapping row at all yet carries 6 MiddleBy images — its content
> predates the current mapping set. Useful as a baseline for existing data, but do **not** pick it
> for cases that need a live re-import.

Baseline captured at time of writing:

| product | images (MiddleBy / total) | documents (MiddleBy / total) | `products.certifications` |
|---|---|---|---|
| 611510 | 1 / 2 | 0 / 5 | `["NSF","CE","ETL","ENERGY STAR"]` |
| 306658 | 6 / 7 | 4 / 7 | `["NSF","UL","Made in USA"]` |
| 666040 | 7 / 8 | 4 / 8 | `["NSF","cETLus","CE","UKCA"]` |
| 263547 | 2 / 3 | 4 / 8 | `["cETLus","ETL-Sanitation","ETL"]` |

Only **6 vendors** have MiddleBy mappings on stage (218 rows in
`autoquote_middleby_product_mappings`) — any test product must belong to one of them:

| vendor_id | Vendor | mappings |
|---|---|---|
| 311 | Imperial (Middleby) | 131 |
| 78 | BKI (Middleby) | 32 |
| 36 | ANETS (Middleby) | 29 |
| 220 | Evo America, LLC (Middleby) | 24 |
| 81 | Blodgett (Middleby) | 1 |
| 136 | Concordia Beverage Systems (Middleby) | 1 |

---

## 1. Media

### TC-MBS-01 — Feature photos are merged with AQ, not replacing them
**Covers:** task §1. `MiddleByProductMapper::updatePictures()`. **Expected to pass.**

**Steps**
1. Open `/handbook/product-view/306658` and note the images.
2. Verify in DB:
   ```sql
   SELECT i.id, i.external_id, i.name,
          CASE WHEN i.remote_path LIKE '%middleby%' THEN 'MiddleBy' ELSE 'AQ' END AS source,
          LEFT(i.remote_path, 80) AS src
   FROM image_product ip JOIN images i ON i.id = ip.image_id
   WHERE ip.product_id = 306658
   ORDER BY source, i.id;
   ```

**Expected**
- Both AQ (`api.aq-fes.com/products-api/resources/pictures/…`) **and** MiddleBy
  (`middleby-cdn.com/PhotoFeature/…`) images are linked — AQ images are not removed.
- Baseline: 7 images = 1 AQ + 6 MiddleBy.

> If the MiddleBy image count looks lower than the API reports, do **not** raise a bug before
> checking the two causes listed under **TC-MBS-16** — a file published after the last import, or a
> product AQ no longer lists. A sweep of all 151 mapped uuids found no code defect behind any of the
> seven discrepancies.

---

### TC-MBS-02 — Alternate photos (`PhotoAlt`)
**Covers:** task §1. **🔴 Expected to FAIL on stage — gap, not a new bug.**

**Steps**
```sql
SELECT COUNT(*) FROM images WHERE remote_path LIKE '%/PhotoAlt/%';
```

**Expected per task:** alternate photos imported alongside feature photos.
**Actual on stage:** `0`. `updatePictures()` reads only the `PhotoFeature` attribute
(`MIDDLE_BY_PICTURES_ATTRIBUTE`); `PhotoAlt` is never requested.

Cross-check that the source data does contain them:
`php artisan middleby:get:product 829693a9-29c5-4e3a-abea-ff9697ab9fd0` → look for a `PhotoAlt` block.

---

### TC-MBS-03 — Marketing videos (`VideoFeature`)
**Covers:** task §1. **🔴 Expected to FAIL on stage.**

**Steps**
```sql
SELECT COUNT(*) FROM images WHERE remote_path LIKE '%/VideoFeature/%' OR local_path LIKE '%.mp4';
```

**Expected per task:** MiddleBy marketing videos imported.
**Actual on stage:** `0` MiddleBy videos — the attribute is not read, and `mediaType` is hard-coded
to `'picture'` for every item.

---

### TC-MBS-04 — 3D / interactive assets
**Covers:** task §1 (*when available*). **🔴 Not implemented on stage.**

**Steps** — inspect a raw payload for an interactive-asset block:
```bash
php artisan middleby:get:product 829693a9-29c5-4e3a-abea-ff9697ab9fd0
```

**Expected:** no 3D asset is stored anywhere in FEDA. Record whether the MiddleBy payload actually
offers such assets — that determines whether the requirement is even actionable.

---

### TC-MBS-05 — Media ids are timestamp-based (duplication risk)
**Covers:** the state that `06ec03c1f` fixes **on dev only**. **⚠️ Documents current stage behaviour.**

**Steps**
```sql
SELECT external_id, local_path, LEFT(remote_path, 70) AS src
FROM images WHERE remote_path LIKE '%middleby%' ORDER BY id DESC LIMIT 10;
```

**Expected on stage:** every `external_id` matches `^image[0-9]{10}$` and `local_path` starts with
`i/m/` — the id is derived from import time, not from the file.

**Consequence to verify:** run a vendor import twice for vendor 136 and re-count:
```sql
SELECT COUNT(*) FROM images WHERE remote_path LIKE '%middleby%';
```
The count is expected to **grow**, because `ImageManager::createByApiProduct()` matches existing
media by `remote_path`, and MiddleBy URLs carry a changing `?update_date=` query string.
This is the duplication defect fixed on `dev`.

---

### TC-MBS-16 — **All** available MiddleBy media is imported, not just some
**Covers:** task content table — *"Merge AQ + **all available** MiddleBy product images"* and
*"Import **all** MiddleBy videos"*. **⚠️ Expected to fail on stage (feature photos only).**

TC-MBS-01 proves the merge happens; this case proves nothing is silently dropped.

**Steps**
Reference product **666040** (`2028_IPC-14_LP`, Imperial), uuid `60a8609e-e79e-4219-ad2d-9d4059d5602b`.

1. Pull the raw payload and count the media entries per block:
   ```bash
   php artisan middleby:get:product 60a8609e-e79e-4219-ad2d-9d4059d5602b > /tmp/mb.json
   grep -o 'PhotoFeature' /tmp/mb.json | wc -l
   grep -o 'PhotoAlt'     /tmp/mb.json | wc -l
   grep -o 'VideoFeature' /tmp/mb.json | wc -l
   ```
2. Count what actually landed:
   ```sql
   SELECT SUM(i.remote_path LIKE '%/PhotoFeature/%') AS feature,
          SUM(i.remote_path LIKE '%/PhotoAlt/%')     AS alternate,
          SUM(i.remote_path LIKE '%/VideoFeature/%') AS video,
          COUNT(*)                                   AS total
   FROM image_product ip JOIN images i ON i.id = ip.image_id
   WHERE ip.product_id = 666040;
   ```
   Baseline on stage: **8** images total — 7 MiddleBy (all `PhotoFeature`) + 1 AQ.

**Expected per task:** every media item present in the payload is linked to the product.
**Actual on stage:** `feature` matches, `alternate` and `video` are `0` — see TC-MBS-02/03.

> ### ⚠️ A PhotoFeature count lower than the API is usually **stale data**, not a defect
>
> A full sweep of all 151 mapped MiddleBy uuids on 2026-08-02 compared the API against the DB:
> **171 of 178 products matched exactly, 0 had extras, 7 had fewer.** All seven were explained
> without any code defect — re-importing the vendor fixed 12 of the 22 missing files immediately.
>
> Rule out these two causes **before** raising a bug:
>
> **1. The file was published after the last import.** MiddleBy URLs carry `?update_date=<unix ts>`.
> Compare it with `vendors.downloaded_at`:
> ```sql
> SELECT id, name, downloaded_at FROM vendors WHERE id = <vendor_id>;
> ```
> ```bash
> # publication date of each PhotoFeature file
> php artisan middleby:get:product <uuid> \
>   | grep -oE 'PhotoFeature/[^"]*update_date=[0-9]+' \
>   | sed -E 's/.*update_date=//' | while read t; do date -d @$t '+%Y-%m-%d'; done
> ```
> Worked example: Evo products 397034 / 397047 held 1 of 7 images. Six were published
> **2026-05-28**, the vendor was last imported **2026-02-13**. After re-import both jumped to 7 of 7.
>
> **2. The product is no longer in the AutoQuotes catalogue.** The import walks the AQ vendor list,
> so a product AQ has dropped is never reached — its `products.updated_at` stays at the old date
> even after a successful vendor import:
> ```bash
> curl -s -H 'ocp-apim-subscription-key: <key from app/Traits/AutoQuote.php>' \
>   'https://api.aq-fes.com/products-api/manufacturers/<vendor external_id>/products' \
>   | jq --arg m '<model>' '[.data[] | select(.models.mfrModel == $m)] | length'   # 0 → dropped by AQ
> ```
> Worked example: product **896451** (`11530_10-7112-OC`) stayed at 1 of 7 after the re-import.
> The Evo list in AQ holds 19 products and this model is not among them, while MiddleBy still
> publishes 7 PhotoFeature files for it. Such a product can never be refreshed until AQ lists it again.
>
> Useful side note: `net_suite_status` is **not** a "discontinued" flag —
> `1 = Not Exist, 2 = Error, 3 = Not Updated (pending), 4 = Ready`
> (`app/Models/Product/Source/NetSuiteStatus.php`). Products touched by an import move to `3`;
> an untouched one keeps `4`. Do not read `4` as "discontinued".

---

## 2. Specifications

### TC-MBS-06 — MiddleBy attributes are added as product options
**Covers:** task §2 as implemented on stage (`copyMiddleByAttributes()`). **Expected to pass.**

**Steps**
```sql
SELECT po.name, po.option_code, pov.value
FROM product_option_values pov JOIN product_options po ON po.id = pov.option_id
WHERE pov.product_id = 263547
ORDER BY po.name;
```

**Expected**
- MiddleBy-sourced options are present, e.g. `electrical_phase`, `electrical_total_amperage`,
  `electrical_volts` (baseline for 263547: these three).
- Values are scalars — never a JSON blob. `copyMiddleByAttributes()` throws
  `The :attribute not configured correctly` when an attribute resolves to an array; such a throw
  aborts the **entire** mapping for that product.
- Multiselect attributes (`installation_type_`, `electrical_connection_type`, `electrical_plug_type`,
  `gas_type`, `Residential_or_Commercial_Use`) show a single readable value, not `Array`.
- Option label comes from the MiddleBy label, falling back to the raw attribute code.

---

### TC-MBS-07 — "Keep the first 3 AQ groups, replace the rest"
**Covers:** task §2 verbatim. **⚠️ Expected to FAIL — different design on stage.**

**Steps**
1. Open `/handbook/product-view/611510` and look at the specification block.
2. Compare with the task-doc screenshot (`image12.png`, `image18.png`).

**Expected per task:** the first 3 AQ groups retained, all remaining groups replaced by the MiddleBy
groups — *Function and Features, Energy Specifications, Gas Specifications, Water/Plumbing/Drainage,
Weights and Dimensions, Installation Details, Additional Tech Specifications*.

**Actual on stage:** AQ specifications are untouched; MiddleBy data is appended as a flat list of
individual options via `categoryValues`. There is no grouping logic and no clearing step
(that arrived on `dev` in `d8326101c RSPA-719. 2. Specifications. Clearance`).

Note `updateAqSpecification()` on stage only fills `specifications.AQSpecification` from
`long_description` **when AQ has none** — a fallback, not a replacement.

---

### TC-MBS-17 — The 7 spec groups named in the task are present
**Covers:** task §2 — the explicit list of required specifications. **⚠️ Partially fails on both branches.**

The task names seven groups: *Function and Features, Energy Specifications, **Gas Specifications**,
Water/Plumbing and Drainage Specifications, Weights and Dimensions, Installation Details,
Additional Tech Specifications.*

**Steps**
```sql
-- what MiddleBy-derived options exist per group theme
SELECT po.name, po.option_code, COUNT(pov.product_id) AS products
FROM product_options po JOIN product_option_values pov ON pov.option_id = po.id
WHERE po.option_code REGEXP '^(gas|electrical|water|steam|installation|energy|annual_energy|total_heat)'
GROUP BY po.id ORDER BY products DESC;
```

**Expected per task:** all seven themes are represented for products where MiddleBy supplies them.

**Actual on stage** — gas specifications *are* populated, because the flat
`MIDDLE_BY_PRODUCT_OPTIONS_LIST` includes eight gas attributes. Baseline:

| option_code | products |
|---|---|
| `gas_type` | 21 |
| `gas_total_btus` | 16 |
| `gas_inlet_size` | 15 |
| `gas_inlet_pressure_required` | 2 |
| `gas_conversion_kit` | 2 |

> ⚠️ **Check this after promoting `dev` — possible regression.** `dev` replaces the flat list with
> group-based copying, and `PRODUCT_ATTRIBUTES_BY_GROUP` contains only six groups —
> `function_and_features`, `energy_specs_attribute_group`, `water_specs_attribute_group`,
> `weights_dimensions_attribute_group`, `installation_details_attribute_group`, `other`.
> **There is no gas group**, and `git grep "gas_specs\|gas_attribute_group"` on `dev` returns nothing.
> `dev`'s flat `PRODUCT_ATTRIBUTES_LIST` is down to four attributes, none of them gas-related.
> Unless MiddleBy files gas attributes under `other`, gas specifications will be **lost** on
> gas-powered products that currently show them on stage. Re-run the query above after promotion
> and compare the counts against this baseline.

---

## 3. Certifications

### TC-MBS-08 — Only missing certifications are imported
**Covers:** task §3. `updateProductCertifications()`. **Expected to pass.**

**Steps**
1. Record the current value:
   ```sql
   SELECT sku, certifications FROM products WHERE id = 666040;
   -- baseline: ["NSF","cETLus","CE","UKCA"]
   ```
2. Fetch the MiddleBy source list:
   `php artisan middleby:get:product <uuid>` → attribute `product_certifications`, field `label`.
3. Re-run the import: `php artisan product:import --product_id=666040`
4. Re-read `products.certifications`.

**Expected**
- Certifications already present are **not** duplicated — the JSON array has no repeated values.
- Certifications present in MiddleBy but missing on the product **are appended**.
- AQ certifications are never removed.

**Duplicate check across the whole vendor set:**
```sql
SELECT id, sku, certifications FROM products
WHERE vendor_id IN (36,78,81,136,220,311)
  AND JSON_LENGTH(certifications) <> JSON_LENGTH(JSON_ARRAY_AGG(DISTINCT certifications))
LIMIT 5;
```
Simpler manual check — eyeball a few rows:
```sql
SELECT id, sku, certifications FROM products
WHERE vendor_id IN (36,78,81,136,220,311) AND certifications IS NOT NULL LIMIT 20;
```

---

### TC-MBS-09 — Product with no AQ certifications (robustness)
**Covers:** risk raised during review. **✅ Investigated 2026-08-02 — does NOT reproduce. Informational only.**

**The original concern.** `updateProductCertifications()` calls
`in_array($certification['label'], $aqProductData['certifications'])` with no null guard. If AQ ever
omitted the `certifications` key, the argument would be `null`, PHP 8 would raise a **`TypeError`**,
and `TypeError` is an `Error` — not caught by the `catch (Exception $e)` blocks in either
`mapProduct()` or `ProductDataModifiedListener::handle()`. Since certifications run **before**
documents, pictures and attributes in `mapProduct()`, such a throw would lose *all* MiddleBy
enrichment for the product.

**Why it cannot happen — AQ always sends the key.** Verified directly against the AutoQuotes API for
product 16468 (`1023_A3301001`, ANETS, `external_id = 66c91dd8-bf0d-dd11-a23a-00304834a8c9`):

```json
{ "has_certifications_key": true, "certifications": [] }
```

An **empty array**, not a missing key. `in_array($x, [])` returns `false` without error.

> A `NULL` in `products.certifications` does **not** mean the key was absent — `Updater.php` writes
> `(isset($data['certifications']) && $data['certifications']) ? json_encode(...) : null`, so an
> empty array also lands as `NULL`. The two cases are indistinguishable in the DB, which is what
> made this look risky in the first place.

**Second independent reason.** Six mapped products with `certifications IS NULL` were checked
against the MiddleBy API — none of them has a `product_certifications` attribute at all. For 16468
the string does not occur in the payload once, and the whole
`regulation_compliance_certifications_attribute_group` is absent. The early
`if (empty($productCertifications)) return;` guard fires before `in_array()` is reached.

**Conditions that would be required to trigger it:** AutoQuotes stops sending the `certifications`
key **and** MiddleBy supplies certifications for the same product. Neither holds today.

**Recommendation (not a bug):** add `?? []` when reading the key, as cheap insurance against a
change in the AQ contract. The same guard is missing on `dev`.

**Steps (only if the AQ contract changes)**
1. Confirm AQ omits the key for the product:
   ```bash
   curl -s -H 'ocp-apim-subscription-key: <key from app/Traits/AutoQuote.php>' \
     'https://api.aq-fes.com/products-api/products/<external_id>' | jq '.data[0] | has("certifications")'
   ```
2. Confirm MiddleBy *does* return certifications:
   `php artisan middleby:get:product <uuid>`
3. `php artisan product:import --product_id=<id>` and watch the `importMiddleByErrors` channel.

---

## 4. Warranty

### TC-MBS-10 — AQ warranty replaced by MiddleBy warranty
**Covers:** task §4. **🔴 Expected to FAIL — not implemented on stage.**

### Worked example — product 611510 on stage

The task's own example product. Everything below is verified state on stage as of 2026-07-31.

| | |
|---|---|
| product id | **611510** |
| SKU | `1048_ZEPH-200-E ADDL_220/60/1` |
| vendor | 81 — Blodgett (Middleby) |
| mapping `mfrModel` | `ZEPH-200-E ADDL` |
| MiddleBy uuid | `829693a9-29c5-4e3a-abea-ff9697ab9fd0` |
| handbook | `/handbook/product-view/611510` |
| **`products.warranty`** | **`NULL`** |

**Walkthrough**

1. Record the starting state — expect `NULL`:
   ```sql
   SELECT id, sku, warranty FROM products WHERE id = 611510;
   -- 611510 | 1048_ZEPH-200-E ADDL_220/60/1 | NULL
   ```
2. Confirm MiddleBy actually has warranty content for it, so the case is not vacuous:
   ```bash
   php artisan middleby:get:product 829693a9-29c5-4e3a-abea-ff9697ab9fd0 \
     | grep -o 'warranty_and_disclaimers_attribute_group'
   ```
   This is the group `dev`'s `copyWarrantyByGroup()` reads (`PRODUCT_WARRANTY_BY_GROUP`).
   If it is absent from the payload, pick another product — the case cannot reproduce.
3. Re-import the product:
   ```bash
   php artisan product:import --product_id=611510
   ```
4. Re-read the field and open the handbook page:
   ```sql
   SELECT id, sku, warranty, updated_at FROM products WHERE id = 611510;
   ```

**Expected per task:** `warranty` holds the MiddleBy *Warranty Details* text, replacing anything AQ
supplied; the handbook shows a Warranty section.

**Actual on stage:** `warranty` stays `NULL` and no Warranty section renders — no error is logged
either, because nothing ever attempts to write the field.

**Repeat across the MiddleBy reference set** — all four are `NULL`:
```sql
SELECT id, sku, warranty FROM products WHERE id IN (611510, 666040, 263547, 16468);
```

| product id | SKU | Vendor | `warranty` |
|---|---|---|---|
| 611510 | `1048_ZEPH-200-E ADDL_220/60/1` | 81 Blodgett (Middleby) | `NULL` |
| 666040 | `2028_IPC-14_LP` | 311 Imperial (Middleby) | `NULL` |
| 263547 | `2028_IHR-XX-SC-36` | 311 Imperial (Middleby) | `NULL` |
| 16468 | `1023_A3301001` | 36 ANETS (Middleby) | `NULL` |

**After promoting `dev`,** step 4 must return the MiddleBy warranty text for 611510. If it still
returns `NULL` while the payload contains `warranty_and_disclaimers_attribute_group`, the
`Updater.php` half of the change did not come along — see the deployment note below.

---

**Supporting query — the whole MiddleBy scope at once**
```sql
-- not a single product in any of the 6 MiddleBy-mapped vendors has a warranty
SELECT v.id, v.name,
       COUNT(*) AS products,
       SUM(p.warranty IS NOT NULL AND p.warranty <> '') AS with_warranty
FROM products p JOIN vendors v ON v.id = p.vendor_id
WHERE p.vendor_id IN (36,78,81,136,220,311)
GROUP BY v.id, v.name;
-- with_warranty = 0 for every row
```
```bash
grep -rni "warrant" Modules/ImportMiddleBy/       # no matches on stage
grep -n  "warrant" app/Models/Product/Updater.php # no matches on stage either
```

**Expected per task:** `products.warranty` holds the MiddleBy warranty text.

**Actual on stage — two independent gaps:**
1. **Mapper.** No warranty handling anywhere in the module. Delivered on `dev` in
   `3a0d5c885 RSPA-719. 4. Warranty` as `copyWarrantyByGroup()`.
2. **Persistence.** `Updater.php` on stage never reads `$data['warranties']` and never writes
   `products.warranty`. On `dev` that logic sits at lines 196–215 (formatting) and 341 (save).

The `products.warranty` column itself *does* exist on stage (migration
`2026_05_25_181651_add_warranty_to_products_table.php`) and is written by an unrelated vendor
pipeline that is out of scope here. So a `NULL` on a MiddleBy product means a missing writer in the
AQ/MiddleBy path — not a broken column or a rendering bug. Scope every warranty query to the six
MiddleBy vendors (`vendor_id IN (36,78,81,136,220,311)`); a global `WHERE warranty IS NOT NULL`
returns unrelated rows and will read as a false positive.

> **Deployment note:** porting only the MiddleBy mapper will *not* make this case pass —
> `copyWarrantyByGroup()` writes into `$aqProductData['warranties']`, and on stage there is no
> consumer for that key. Both the mapper and the `Updater` changes are required.

---

## 5. Downloads / PDFs

> Use the **full vendor import** for every case in this section — see the trigger table above.

### TC-MBS-11 — MiddleBy documents are imported and linked
**Covers:** task §5. **Expected to pass (for the 3 supported types).**

**Steps**
1. Baseline:
   ```sql
   SELECT d.id, d.name, d.title, LEFT(d.remote_path, 70) AS src
   FROM document_product dp JOIN documents d ON d.id = dp.document_id
   WHERE dp.product_id = 306658 ORDER BY d.id;
   ```
2. Vendors → *Concordia Beverage Systems (Middleby)* (id 136) → **Update**.
3. Process the queue: `php artisan queue:work --queue=auto_quotes`
4. Re-run the query.

**Expected**
- Documents with `title` in `Middleby CutSheet`, `Middleby User Manual`, `Middleby Brochure`
  are linked to the product (baseline for 306658: 4 MiddleBy documents of 7).
- `remote_path` points at `middleby-cdn.com/specsheets|usermanuals|brochure/…`.
- Note the field mapping: the configured name lands in `documents.title`, while `documents.name`
  holds the file name from the URL.

---

### TC-MBS-12 — Replace vs. append, and missing document types
**Covers:** task §5 verbatim. **⚠️ Expected to FAIL — behavioural deviation.**

**Expected per task:** AQ PDFs are **replaced** by MiddleBy PDFs, covering *Parts List, Brochure,
Specification Sheet, User Manual, Warranty Sheet*.

**Actual on stage:**
- `updateDocuments()` only appends: `$aqProductData['documents'][] = [...]` — AQ documents remain.
- Only **3** MiddleBy attributes are read — `Spec_Sheets`, `User_Manuals`, `Brochure`.
  **Parts List** and **Warranty Sheet** are not mapped at all.
- Every appended document is created with `'id' => ''`, the same empty-external-id pattern that
  causes duplication for images.

**Measured on product 611510 (2026-08-02):**

| | stage | dev | required |
|---|---|---|---|
| documents total | 9 | 6 | |
| from `middleby-cdn.com` | 4 | **6** | all |
| **from AQ** | **5** | **0** | **0** |

The five AQ documents still attached on stage: `cutsheet`, `Stacked HV100G-DFG100ES`,
`Middleby Financial Flyer`, `Start Up Doc`, `warranty sheet`.

On dev the replacement works — `updateDocuments()` there filters AQ documents of the same
`mediaType` out before merging:
```php
$aqDocuments = array_filter($aqDocuments, fn($d) => $d['mediaType'] !== $mediaType);
```

```sql
-- AQ documents still attached to a MiddleBy-enriched product
SELECT d.id, d.title, LEFT(d.remote_path,70) AS src
FROM document_product dp JOIN documents d ON d.id = dp.document_id
WHERE dp.product_id = 611510 AND d.remote_path NOT LIKE '%middleby-cdn.com%';
```

> ⚠️ **Filter on `middleby-cdn.com`, not on `middleby`.** The AQ document
> *"Middleby Financial Flyer"* lives at `doclinks.aqnet.com/MIDMARSH/…Middleby Update.pdf` — the
> word appears in an AutoQuotes URL. A `LIKE '%middleby%'` filter misclassifies it as
> MiddleBy-sourced and undercounts the AQ leftovers.

**Duplication check** — run the vendor import twice and confirm the document count per product does
not grow:
```sql
SELECT dp.product_id, COUNT(*) FROM document_product dp
JOIN documents d ON d.id = dp.document_id
WHERE d.remote_path LIKE '%middleby%' GROUP BY dp.product_id ORDER BY 2 DESC LIMIT 10;
```

---

### TC-MBS-18 — Per-type checklist of the 5 document types
**Covers:** task §5 — the explicit list. **⚠️ 3 of 5 on stage, 5 of 5 on dev.**

Walk each named type and record whether a MiddleBy document of that kind reaches the product.

| Task type | MiddleBy attribute | stage | dev | Resulting `mediaType` |
|---|---|---|---|---|
| Specification Sheet | `Spec_Sheets` | ✅ | ✅ | `cutsheet` |
| User Manual | `User_Manuals` | ✅ | ✅ | `manual` |
| Brochure | `Brochure` | ✅ | ✅ | `brochure` |
| **Parts List** | `Parts_List` | 🔴 | ✅ | `cutsheet` (default) |
| **Warranty Sheet** | `warranty_sheet` | 🔴 | ✅ | `warrantysheet` |

**Measured on product 611510 (2026-08-02).** MiddleBy supplies **all five** types for it —
confirmed against the API (`GET {base_url}/products/829693a9-…`):

| CDN directory | source attribute | file |
|---|---|---|
| `partslist/` | `Parts_List` | `Blodgett_Zeph-200-E_ConvectionOven_PartsList_1.pdf` |
| `brochure/` | `Brochure` | `Energy-Star-sell.pdf` |
| `specsheets/` | `Spec_Sheets` | `Blodgett_Zephaire-200-E_ConvectionOven_SpecSheet_1.pdf` |
| `usermanuals/` | `User_Manuals` | `…_Manual_1.pdf` **and** `…_ManualFrench_1.pdf` |
| `warrantysheet/` | `warranty_sheet` | `Blodgett_Equipment_AllProducts_WarrantySheet_1.pdf` |

What actually arrives:

| type | stage | dev |
|---|---|---|
| Specification Sheet | ✅ `Middleby CutSheet` | ✅ |
| User Manual | ✅ ×2 | ✅ ×2 |
| Brochure | ✅ `Middleby Brochure` | ✅ |
| **Parts List** | 🔴 | ✅ |
| **Warranty Sheet** | 🔴 | ✅ |

> Document titles differ by branch: stage takes `documents.title` from the hardcoded
> `MIDDLE_BY_PRODUCT_DOCUMENTS` constant, so both manuals show as *"Middleby User Manual"* and are
> indistinguishable on the storefront. Dev derives the title from the MiddleBy label —
> *"…Manual 1"* / *"…ManualFrench 1"*.

Secondary reference product **263547** (`2028_IHR-XX-SC-36`, Imperial),
uuid `1780bd3c-5735-41df-9963-76db97744974`.

**Steps**
1. Confirm which of the five the payload actually offers:
   ```bash
   php artisan middleby:get:product 1780bd3c-5735-41df-9963-76db97744974 \
     | grep -oE 'Spec_Sheets|User_Manuals|Brochure|Parts_List|warranty_sheet' | sort -u
   ```
2. Confirm what landed:
   ```sql
   SELECT d.title, COUNT(*) FROM document_product dp JOIN documents d ON d.id = dp.document_id
   WHERE dp.product_id = 263547 AND d.remote_path LIKE '%middleby%'
   GROUP BY d.title;
   ```
   Baseline on stage: **8** documents total — 4 MiddleBy + 4 AQ.

**Expected on stage:** only CutSheet / User Manual / Brochure titles appear. A `Parts_List` or
`warranty_sheet` present in the payload is silently ignored — the constant
`MIDDLE_BY_PRODUCT_DOCUMENTS` has only three entries.

**Note for the dev run:** dev derives `mediaType` from the URL substring, not the attribute
(`str_contains($url, 'brochure' | 'usermanuals' | 'warrantysheet')`), defaulting to `cutsheet`.
A Parts List therefore lands as `cutsheet` and will *replace* the AQ spec sheet in the same
`mediaType` bucket. Verify that a product with both a Parts List and a Spec Sheet keeps both.

---

## 6. Fallback behaviour

### TC-MBS-13 — No MiddleBy match → AQ content retained
**Covers:** the task's IMPORTANT NOTE. **Expected to pass.**

**Steps**
1. Pick a product from a MiddleBy vendor that has **no** mapping row:
   ```sql
   SELECT p.id, p.sku, p.model FROM products p
   WHERE p.vendor_id = 311
     AND p.model NOT IN (SELECT mfrModel FROM autoquote_middleby_product_mappings)
   LIMIT 5;
   ```
2. Record its images / documents / options / certifications.
3. `php artisan product:import --product_id=<id>`
4. Re-check.

**Expected**
- Nothing is lost. `getMiddleByProductData()` returns `null` when the API search finds no uuid,
  and `mapProduct()` is never called.
- No rows added to `autoquote_middleby_product_mappings` for that model.

**Measured on stage 2026-08-02** — after import `log_id=7533`, Blodgett has 639 products of which
only 18 are mapped, so 621 exercised this path:

| check | result |
|---|---|
| unmapped products with MiddleBy images | **0** ✅ |
| unmapped products retaining AQ images | 573 |
| unmapped products retaining AQ documents | 548 |
| unmapped products with a MiddleBy document | 1 ⚠️ — see below |

```sql
SELECT COUNT(*) FROM products p
WHERE p.vendor_id = 81
  AND NOT EXISTS (SELECT 1 FROM autoquote_middleby_product_mappings m
                  WHERE m.mfrId = '6bc8e7a0-be0d-dd11-a23a-00304834a8c9'
                    AND p.model LIKE CONCAT(m.mfrModel, '%'))
  AND EXISTS (SELECT 1 FROM image_product ip JOIN images i ON i.id = ip.image_id
              WHERE ip.product_id = p.id AND i.remote_path LIKE '%middleby-cdn.com%');
-- expect 0
```

> ⚠️ **Known outlier — do not raise as a bug.** Product **18713** (`1048_PRSS-20`) has the MiddleBy
> brochure `Blodgett_Invoq_ConvectionOven_Brochure_1.pdf` without being mapped. It shares the
> AutoQuotes `external_id` `4de7fc0b-238b-4020-86b8-2de99d463c54` with product **1488001**
> (`1048_R1013`), which is mapped — AQ renamed the model and kept the identifier, leaving FEDA with
> both the discontinued and the active record (`net_suite_status` 4 and 1).
>
> `Document\Handler::saveDocuments()` (`app/Models/Product/Document/Handler.php:117`) matches
> documents by **`remote_path`** and links them to every product sharing that `external_id`:
> ```php
> $documentModel = Document::where(['remote_path' => $remoteDocumentPath])->first();
> ...
> $this->makeLinks($productModels, $documentModel->id);
> ```
> The enrichment itself never ran for PRSS-20 — `mapProduct()` was not called. This is the AQ
> duplicate-identifier case documented in `ImageManager::createByApiProduct()`.
>
> When picking a product for this case, confirm it does **not** share `external_id` with a mapped
> sibling:
> ```sql
> SELECT id, sku, model, external_id FROM products
> WHERE external_id = (SELECT external_id FROM products WHERE id = <candidate>);
> ```

---

### TC-MBS-14 — Unmapped brand is skipped entirely
**Covers:** the `BrandMapping` gate in `ProductDataModifiedListener::handle()`. **Expected to pass.**

**Steps**
1. Pick any product from a **non-MiddleBy** vendor.
2. `php artisan product:import --product_id=<id>`

**Expected**
- `BrandMapping::getMiddleByBrand()` returns empty → the listener returns before any API call.
- No MiddleBy request is issued, no mapping row is created, product content unchanged.
- Brand mapping source: `autoquote_to_middleby_brands` (MiddleBy name → AQ vendor name).

---

### TC-MBS-15 — Partial MiddleBy content → only the available sections change
**Covers:** per-section guard clauses. **Expected to pass.**

**Steps**
1. Find a mapped product whose MiddleBy payload lacks pictures (`middleby:get:product <uuid>` shows
   no `PhotoFeature` block) — for example 611510 has documents from AQ only.
2. Run the import and confirm each section independently.

**Expected**
- Each `update*()` method returns early on its own empty input (`if (empty(...)) return;`) without
  affecting the others.
- Sections with no MiddleBy data keep their AQ values; sections with data are enriched.

---

## 7. End-to-end acceptance

### TC-MBS-19 — The task's own example product, section by section
**Covers:** the worked example in `middleby_task_13_07.md`. **Acceptance walkthrough.**

The task gives three reference URLs for the same product — use them as the source of truth:

- MiddleBy catalog: `https://productcatalog.middlebyapps.com/products/829693a9-29c5-4e3a-abea-ff9697ab9fd0`
- Middleby shop: `https://shop.middleby.com/blodgettr-zeph-200-e-addl-…`
- RS website: `https://www.restaurantsupply.com/products/blodgett-zeph-200-e-addl-220-60-1-38-inch-electric-convection-oven-with-solid-state-controls`
- FEDA handbook: `/handbook/product-view/611510`

**Steps** — open the handbook page and the MiddleBy catalog page side by side and fill this in:

| § | Section | Expected per task | Observed | Verdict |
|---|---|---|---|---|
| 1 | Images | AQ + all MiddleBy feature *and* alternate photos | | |
| 1 | Videos | all MiddleBy marketing videos | | |
| 1 | 3D assets | imported when available | | |
| 2 | Specifications | first 3 AQ groups kept, rest from MiddleBy | | |
| 3 | Certifications | AQ list plus any missing MiddleBy ones | | |
| 4 | Warranty | MiddleBy warranty details replace AQ | | |
| 5 | PDFs | 5 MiddleBy document types replace AQ | | |

Baseline on stage for 611510 — record deviations against it:

```sql
SELECT (SELECT COUNT(*) FROM image_product WHERE product_id = 611510)      AS images,      -- 2 (1 AQ + 1 MiddleBy)
       (SELECT COUNT(*) FROM document_product WHERE product_id = 611510)   AS documents,   -- 5, all AQ
       (SELECT certifications FROM products WHERE id = 611510)             AS certs,       -- ["NSF","CE","ETL","ENERGY STAR"]
       (SELECT warranty FROM products WHERE id = 611510)                   AS warranty;    -- NULL
```

**Expected on stage:** only the Images row is partially satisfied. This case is the single
sign-off artefact to attach to the ticket — it shows at a glance which of the seven rows the
current deployment actually delivers.

> The MiddleBy mapping for this product is `mfrModel = 'ZEPH-200-E ADDL'` →
> `uuid 829693a9-29c5-4e3a-abea-ff9697ab9fd0` (row 220 in `autoquote_middleby_product_mappings`).
> Note the AQ model carries a voltage suffix (`ZEPH-200-E ADDL_220/60/1`) that the mapping key
> does not — confirm the match still resolves after any change to the search logic.

---

## Regression checklist

- [ ] `/handbook/product-view/611510` and `/handbook/product-view/306658` render without errors;
      images, specs and documents all display.
- [ ] `importMiddleByErrors` log channel has no new entries after a full vendor import.
- [ ] Non-MiddleBy vendor import is unaffected (run one and compare product counts before/after).
- [ ] `autoquote_middleby_product_mappings` grows only for genuinely matched models; no duplicate
      `(mfrId, mfrModel)` pairs.
- [ ] MiddleBy API is reachable: `php artisan middleby:get-token` returns a token;
      `/import-middle-by/ping` responds.

---

## Coverage matrix

| TC | Task § | Area | Expected on stage |
|---|---|---|---|
| TC-MBS-01 | §1 | Feature photos merged | ✅ pass |
| TC-MBS-02 | §1 | Alternate photos | 🔴 not implemented |
| TC-MBS-03 | §1 | Marketing videos | 🔴 not implemented |
| TC-MBS-04 | §1 | 3D assets | 🔴 not implemented |
| TC-MBS-05 | §1 | Media id / duplication | ⚠️ old scheme, duplicates |
| TC-MBS-16 | §1 | **All** available media imported | ⚠️ feature photos only |
| TC-MBS-06 | §2 | MiddleBy attributes as options | ✅ pass |
| TC-MBS-07 | §2 | First 3 AQ groups + replace | 🔴 not implemented |
| TC-MBS-17 | §2 | The 7 named spec groups | ⚠️ gas OK on stage, **regression risk on dev** |
| TC-MBS-08 | §3 | Only missing certifications | ✅ pass |
| TC-MBS-09 | §3 | No AQ certifications | ✅ investigated — does not reproduce |
| TC-MBS-10 | §4 | Warranty replacement | 🔴 not implemented |
| TC-MBS-11 | §5 | MiddleBy documents imported | ✅ pass (3 types) |
| TC-MBS-12 | §5 | Replace vs append | ⚠️ appends |
| TC-MBS-18 | §5 | Per-type checklist of 5 types | ⚠️ 3 of 5 |
| TC-MBS-13 | fallback | No match → AQ retained | ✅ pass |
| TC-MBS-14 | fallback | Unmapped brand skipped | ✅ pass |
| TC-MBS-15 | fallback | Partial content | ✅ pass |
| TC-MBS-19 | all | Task example, section by section | acceptance sign-off |

**Summary: 6 pass, 4 not implemented, 8 deviations, 1 acceptance walkthrough.** If the intent was to test the complete
`middleby_task_13_07.md` scope, `dev` needs to be promoted to stage first — sections §1 (alternate
photos, videos), §2 (group replacement) and §4 (warranty) cannot pass with the currently deployed code.

Promoting `dev` would turn TC-MBS-02, -03, -05, -10 and -12 green. Three cases stay red regardless
and need a product decision rather than a deployment:

- **TC-MBS-04 (3D assets)** — not implemented on either branch; first confirm MiddleBy actually
  exposes such assets.
- **TC-MBS-07 (§2 group rule)** — dev attaches a `group` key to `categoryValues`, but nothing
  consumes it: `Option::saveProduct()` persists only `property`/`value`, and there is no group
  column in `product_options` / `product_option_values` on either branch. §2 needs a schema and
  repository change, so no deployment will make this case pass.
- **TC-MBS-09 (no AQ certifications)** — the missing null guard is present on `dev` too.

And one case is expected to get **worse** after promotion, not better:

- **TC-MBS-17 (Gas Specifications)** — stage populates gas attributes through its flat list; `dev`
  drops that list in favour of six attribute groups, none of which is a gas group. Compare the gas
  option counts before and after promotion before signing the ticket off.

Related documents: `middleby_task_13_07.md` (requirements), `middleby_doc.md` (implementation notes,
describes the **dev** version), `middleby_task_TCs.md` (dev-oriented cases),
`RSPA-719_media_fix_TCs.md` (media-id fix, dev only).
