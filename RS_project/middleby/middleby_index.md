# MiddleBy → RestaurantSupply · status index

Entry point for the RSPA-719 documentation set. Requirements come from `middleby_task_13_07.md`.

- **Verified:** 2026-08-02, against branch `stage` @ `3aca91ddf`, branch `dev`, databases
  `oners_stage` / `oners_dev`, and the live MiddleBy API
- **Reference product throughout:** `611510` — `1048_ZEPH-200-E ADDL_220/60/1`,
  vendor 81 Blodgett (Middleby), MiddleBy uuid `829693a9-29c5-4e3a-abea-ff9697ab9fd0`,
  AQ `external_id = 0c218722-1048-df11-beff-001ec95274b6`

---

## Requirement status

| § | Requirement | stage | dev | Details |
|---|---|:---:|:---:|---|
| 1 | Feature Photos | ✅ | ✅ | — |
| 1 | PhotoAlt / video | 🔴 | ✅ | [photoalt/video](middleby_photoalt_video_issue_stage.md) |
| 1 | 3D assets | ⬜ N/A | ⬜ N/A | source has no such attribute — see notes |
| 1 | Stable media ids | 🔴 | ✅ | [media ids](middleby_media_ids_issue_stage.md) |
| 2 | First 3 rows kept (Manufacturer / Model / Part #) | ✅ | ✅ | hardcoded `# Base specs` in `SpecHelper::getSpecsData()`, always emitted first — nothing to fix ([same issue, other half](middleby_aq_groups_not_replaced_issue_stage.md)) |
| 2 | **Remaining AQ specs replaced** | 🔴 | 🔴 | **this is the §2 defect** — [test report](middleby_aq_groups_not_replaced_issue_stage.md) · [analysis](middleby_specifications_groups_issue.md) |
| 2 | Clearance attributes imported | 🔴 | ✅ | [clearance (stage)](middleby_clearance_issue_stage.md) · [clearance (dev, fixed)](middleby_clearance_attributes_bug.md) |
| 3 | Only missing certifications | ✅ | ✅ | — |
| 4 | Warranty | 🔴 | ✅ | [warranty](middleby_warranty_issue_stage.md) |
| 5 | PDFs replaced (not appended) | 🔴 | ✅ | [documents](middleby_documents_issue_stage.md) |
| 5 | All 5 document types | 🔴 3 of 5 | ✅ 5 of 5 | [documents](middleby_documents_issue_stage.md) |
| — | Fallback to AQ when no match | ✅ | ✅ | verified on 621 unmapped products — see notes |

**Legend:** ✅ works · 🔴 fails · ⬜ N/A — not applicable

> **Why §2 occupies two rows.** The spec sentence *"keep the first 3 AQ groups, replace all
> remaining groups"* has two halves that behave differently. The first is satisfied by
> construction — the three rows are hardcoded and always come first, on both branches. The second
> is not implemented anywhere: 9 AQ-sourced options survive on 611510 on stage **and** dev. Splitting
> the row keeps the passing half from masking the failing one; a single merged "partial" verdict
> would hide that promoting `dev` does **not** close this requirement.

### What promoting `dev` would change

Five rows turn green: PhotoAlt/video, stable media ids, clearance, warranty, and both §5 rows.

**One row stays red on both branches** — replacing the remaining AQ specifications. It needs a code
change that exists on neither branch. See the fix section in
[`middleby_specifications_groups_issue.md`](middleby_specifications_groups_issue.md); it is smaller
than first assessed — no schema change, just stop passing AQ values into `categoryValues`.

---

## Notes on the N/A rows

**3D assets (§1).** MiddleBy provides no such attribute. Checked on 2026-08-02 across 7 full product
cards (4 brands, 3 product families) plus a 100-product `/products/search` sweep. The complete media
inventory is `PhotoFeature`, `PhotoAlt`, `VideoFeature`, `Brochure`, `Spec_Sheets`, `User_Manuals`,
`warranty_sheet`, `brand_catalog`, `image_remarks`, `Images_Shown_Are_Actual_Product` and
`Parts_List`. No code matches `3d`, `interactive`, `augmented`, `glb`, `usdz`, `gltf`, `render`,
`cad`, `revit`, `bim`, `spin`, `360`, `tour`. The spec's own *"when available"* qualifier covers
this. Worth confirming with the customer whether "3D assets" meant something outside the product API.

**Robustness when AQ certifications are empty.** Previously tracked as a risk
(`in_array($label, $aqProductData['certifications'])` has no null guard). Does **not** reproduce:
AutoQuotes always sends the key — `"certifications": []`, not a missing key — verified directly
against the AQ API. `in_array($x, [])` returns `false` without error. A `NULL` in
`products.certifications` only means the array was empty, since `Updater.php` maps an empty array to
`NULL`. Adding `?? []` remains a cheap hardening measure, not a bug. Details in TC-MBS-09.

**Fallback (verified on stage 2026-08-02).** Of Blodgett's 639 products only 18 resolve to a
MiddleBy uuid; the remaining **621** went through the fallback path during import `log_id=7533`:

| check | result |
|---|---|
| unmapped products with MiddleBy images | **0** |
| unmapped products retaining AQ images | 573 |
| unmapped products retaining AQ documents | 548 |
| unmapped products with a MiddleBy document | 1 — explained below |

> ⚠️ **Do not raise the one outlier as a bug.** Product `18713` (`1048_PRSS-20`) carries the
> MiddleBy brochure `Blodgett_Invoq_ConvectionOven_Brochure_1.pdf` despite having no mapping. It
> shares the AutoQuotes `external_id` `4de7fc0b-238b-4020-86b8-2de99d463c54` with product
> `1488001` (`1048_R1013`), which **is** mapped. AQ renamed the model and kept the identifier, so
> FEDA holds both the old and the new record (`net_suite_status` 4 and 1).
>
> `Document\Handler::saveDocuments()` matches documents by **`remote_path`** and then links them to
> *every* product sharing that `external_id`, so the brochure legitimately imported for R1013 is
> attached to PRSS-20 as well. This is the AQ duplicate-identifier situation documented in
> `ImageManager::createByApiProduct()`, not a MiddleBy enrichment failure — `mapProduct()` was never
> called for PRSS-20.

---

## Defects outside the spec

| Issue | stage | dev | Document |
|---|:---:|:---:|---|
| `product_options_and_accessories` imported although out of spec; HTML truncated at `varchar(255)` — 43 of 84 values broken mid-tag | 🔴 | ✅ absent | [options & accessories](middleby_options_accessories_issue_stage.md) |
| Duplicate PDFs of the same type (AQ + MiddleBy side by side) | — | 🔴 | [pdf duplication](middleby_pdf_duplication_issue.md) · [TCs](middleby_pdf_duplication_TCs.md) |
| Videos not published to Shopify (export skips media when the product already has ≥ 2 images) | — | 🔴 | [shopify video](middleby_shopify_video_issue.md) |

---

## Document map

### Requirements and implementation
| Document | Scope |
|---|---|
| [`middleby_task_13_07.md`](middleby_task_13_07.md) | the requirements themselves (§1–§5 + fallback) |
| [`middleby_doc.md`](middleby_doc.md) | implementation notes — describes the **dev** version |

### Test cases
| Document | Target |
|---|---|
| [`middleby_TCs_staging.md`](middleby_TCs_staging.md) | **stage** — 19 cases, TC-MBS-01…19, with the stage/dev coverage matrix |
| [`middleby_task_TCs.md`](middleby_task_TCs.md) | **dev** — 12 cases, TC-MB-01…12 |
| [`RSPA-719_media_fix_TCs.md`](RSPA-719_media_fix_TCs.md) | review + cases for the media-id fix `06ec03c1f` (dev only) |
| [`middleby_pdf_duplication_TCs.md`](middleby_pdf_duplication_TCs.md) | PDF duplication on dev |

### Issues — stage
| Document | § |
|---|---|
| [`middleby_photoalt_video_issue_stage.md`](middleby_photoalt_video_issue_stage.md) | §1 |
| [`middleby_media_ids_issue_stage.md`](middleby_media_ids_issue_stage.md) | §1 |
| [`middleby_clearance_issue_stage.md`](middleby_clearance_issue_stage.md) | §2 |
| [`middleby_aq_groups_not_replaced_issue_stage.md`](middleby_aq_groups_not_replaced_issue_stage.md) | §2 — test report |
| [`middleby_options_accessories_issue_stage.md`](middleby_options_accessories_issue_stage.md) | §2 — out of spec |
| [`middleby_warranty_issue_stage.md`](middleby_warranty_issue_stage.md) | §4 |
| [`middleby_documents_issue_stage.md`](middleby_documents_issue_stage.md) | §5 |

### Issues — both branches / dev
| Document | § |
|---|---|
| [`middleby_specifications_groups_issue.md`](middleby_specifications_groups_issue.md) | §2 — affects **both** branches |
| [`middleby_clearance_attributes_bug.md`](middleby_clearance_attributes_bug.md) | §2 — clearance fixed on dev; `Product Dimensions (WxDxH)` still open |
| [`middleby_pdf_duplication_issue.md`](middleby_pdf_duplication_issue.md) | §5 — dev |
| [`middleby_shopify_video_issue.md`](middleby_shopify_video_issue.md) | §1 — dev, Shopify export |

### Reference data and tooling
| Document | Contents |
|---|---|
| [`middleby_video_products.md`](middleby_video_products.md) | dev products carrying a MiddleBy video |
| [`middleby_api.postman_collection.json`](middleby_api.postman_collection.json) | Postman collection: token, product by uuid, search |

---

## Branch situation

The `stage` branch carries only the **early** RSPA-719 commits. The later work is on `dev` only and
was never merged — the commit `69d41de0b` on stage is titled *"RSPA-706: merge RSPA-719 into 706"*
but its parents are the RSPA-706 branch and a `master` commit, not the `RSPA-719` branch.

```bash
# none of these are ancestors of stage
for c in 5e9729319 3a0d5c885 c39a4b861 fcdfad3be d8326101c 06ec03c1f; do
  git merge-base --is-ancestor $c stage && echo "$c on stage" || echo "$c NOT on stage"
done

git branch -a --contains 06ec03c1f    # dev, origin/RSPA-719, origin/dev
```

`stage` and `dev` diverge by 725 commits across 55 tickets, the oldest dating to 2025-09-02.
`dev` has not been merged into `stage` since 2021 — feature branches are merged into each
independently, so landing in `dev` says nothing about landing on `stage`.

---

## Environment

```bash
# DB, read-only via tunnel — the MariaDB client needs --skip-ssl
mysql --skip-ssl -h 127.0.0.1 -P 3307 -u oners_read -p<pass from .mcp.json> oners_stage

# MiddleBy API — credentials in the local .env (values in .env.example are stale and return 401)
# base_url = https://productcatalog.middlebyapps.com/api/v1
# POST /token/generate → Bearer; GET /products/{uuid} needs X-Locale + X-Channel

# AutoQuotes API — key hardcoded in app/Traits/AutoQuote.php
curl -s -H 'ocp-apim-subscription-key: <key>' \
  'https://api.aq-fes.com/products-api/products/<products.external_id>'
```

**Triggers** — what each one actually covers:

| Trigger | Options | Certifications | Images | Documents |
|---|:---:|:---:|:---:|:---:|
| `php artisan product:import --product_id=` | ✅ | ✅ | ✅ | 🔴 |
| `php artisan product:images --product_id=` | 🔴 | 🔴 | ✅ | 🔴 |
| Vendors → **Update** (full vendor import) | ✅ | ✅ | ✅ | ✅ |

`Updater::updateByProduct()` ends with `//TODO: update pdf` — document cases **must** use the full
vendor import, or they produce a false negative.

Only **6 vendors** have MiddleBy mappings on stage: Imperial (311), BKI (78), ANETS (36),
Evo (220), Blodgett (81), Concordia (136).
