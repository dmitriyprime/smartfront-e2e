# Issue: MiddleBy alternate photos and videos are never imported on stage

- **Environment:** stage (`oners_stage`), branch `stage` @ `3aca91ddf`
- **Area:** MiddleBy import → product media
- **Severity:** High — two of the four media types required by the spec never reach the product,
  and video is missing end-to-end (import, display, Shopify export)
- **Related:** RSPA-719, `middleby_task_13_07.md` §1 (Feature Photos, Alternate Photos, Marketing videos)
- **Verified:** 2026-07-31, after two full vendor imports of *Blodgett (Middleby)* — `log_id=7532` and `log_id=7533`

## Summary

Spec §1 requires importing **all** available MiddleBy media in addition to the AQ images:
Feature Photos, **Alternate Photos**, **Marketing videos** and 3D assets.

On stage only **Feature Photos** are imported. `MiddleByProductMapper::updatePictures()` reads a
single attribute — `MIDDLE_BY_PICTURES_ATTRIBUTE = 'PhotoFeature'` — and hard-codes
`'mediaType' => 'picture'` for every item. `PhotoAlt` and `VideoFeature` are never requested.

Storage-wide on stage:

```sql
SELECT COUNT(*) FROM images WHERE mimetype LIKE 'video%';              -- 0
SELECT COUNT(*) FROM images WHERE local_path LIKE '%.mp4';             -- 0
SELECT COUNT(*) FROM images WHERE remote_path LIKE '%/VideoFeature/%'; -- 0
SELECT COUNT(*) FROM images WHERE remote_path LIKE '%/PhotoAlt/%';     -- 0
```

Not a single video or alternate photo exists in the whole stage database.

## Evidence — product 663822

| | |
|---|---|
| product id | **663822** |
| SKU | `1048_P602HT` (Sveba Dahlen P602HT Deck Oven) |
| vendor | 81 — Blodgett (Middleby) |
| mapping `mfrModel` | `P602HT` |
| MiddleBy uuid | `dcac668a-e956-44eb-92e8-6baaffc19354` |
| handbook | `/handbook/product-view/663822` |

This product is a clean case: on dev **all of its media come from MiddleBy**, it has no AQ image at
all. If MiddleBy media does not arrive, the product is left with a single picture.

### On stage — 1 media item

```sql
SELECT i.external_id, i.mimetype, i.local_path,
       SUBSTRING_INDEX(SUBSTRING_INDEX(i.remote_path,'middleby-cdn.com/',-1),'/',1) AS cdn_dir
FROM image_product ip JOIN images i ON i.id = ip.image_id
WHERE ip.product_id = 663822;
```

| external_id | mimetype | local_path | cdn_dir |
|---|---|---|---|
| `image1785495534` | image/jpeg | `i/m/image1785495534.jpg` | PhotoFeature |

PhotoAlt — **0**. Video — **0**. AQ images — **0**.

### On dev — 5 media items (the target state)

| external_id | mimetype | source |
|---|---|---|
| `mb_p_blodgett_sveba_dahlen_p602ht_deckoven_photomain_1jpg` | image/jpeg | `…/PhotoFeature/Blodgett_Sveba-Dahlen-P602HT_DeckOven_PhotoMain_1.jpg.jpg` |
| `mb_p_..._photoalternate_1` | image/jpeg | `…/PhotoAlt/Blodgett_Sveba-Dahlen-P602HT_DeckOven_PhotoAlternate_1.jpg` |
| `mb_p_..._photoalternate_2` | image/jpeg | `…/PhotoAlt/…_PhotoAlternate_2.jpg` |
| `mb_p_..._photoalternate_3` | image/jpeg | `…/PhotoAlt/…_PhotoAlternate_3.jpg` |
| `mb_v_blodgett_john_arena_convectionoven_videomain_1` | **video/mp4** | `…/VideoFeature/Blodgett_John-Arena_ConvectionOven_VideoMain_1.mp4` |

**4 of 5 media items are lost on stage** — 3 alternate photos and 1 video.

### The source data exists — confirmed against the MiddleBy API

Queried directly (`GET {base_url}/products/dcac668a-e956-44eb-92e8-6baaffc19354`) on 2026-07-31.
Full media inventory returned for this product:

| category | count | files |
|---|---|---|
| PhotoFeature | 1 | `Blodgett_Sveba-Dahlen-P602HT_DeckOven_PhotoMain_1.jpg.jpg` |
| **PhotoAlt** | **3** | `…_PhotoAlternate_1.jpg`, `…_2.jpg`, `…_3.jpg` |
| **VideoFeature** | **1** | `Blodgett_John-Arena_ConvectionOven_VideoMain_1.mp4` |
| specsheets | 1 | `…_SpecSheet_1.pdf` |
| usermanuals | 1 | `…_Manual_1.pdf` |
| brochure | 1 | `…_Brochure_1.pdf` |
| warrantysheet | 1 | `Blodgett_Equipment_AllProducts_WarrantySheet_1.pdf` |
| brandcatalog | 1 | `2026 Blodgett-Combi-Marsal-Perfect Fry.pdf` |

The supplier does provide the alternate photos and the video — they match dev's imported set
exactly. Their absence on stage is purely a code gap, not missing source data.

> Side observation: the payload also carries a **`warrantysheet`** PDF, which stage does not import
> (only 3 of the 5 document types are mapped) — see `middleby_TCs_staging.md` TC-MBS-18.

### The import did reach the product

Import `log_id=7533` ran 14:10 → 15:12 and touched 663822 — `products.updated_at = 2026-07-31 14:26:53`.
The media set stayed at one image. The same holds for the earlier import `log_id=7532`.

The reference product from the spec, **611510** (`1048_ZEPH-200-E ADDL_220/60/1`), behaves
identically: 2 media on stage (1 AQ + 1 PhotoFeature) against 6 on dev (+3 PhotoAlt, +1 video).
Its certifications were extended by the same import run, which proves the MiddleBy mapper executed
for it — the media simply was never requested.

## Root cause — support is missing at four levels

All four commits below exist on `dev` only; none is an ancestor of `stage` or `master`.

| # | Level | Commit | State on stage |
|---|---|---|---|
| 1 | Import | `fcdfad3be` — read `PhotoAlt` + `VideoFeature` | only `PhotoFeature` is read; `mediaType` hard-coded to `'picture'` |
| 2 | Media typing | `2e801c5f2` — listener + mapper | no video mimetype handling |
| 3 | Display | `d817ab18c` — `PageConstructor.php` + handbook blade | `grep -n "video\|mp4" resources/views/pages/handbook/partials/product/view.blade.php` → no matches |
| 4 | Shopify export | `0560db054`, `790c86550` — `Listeners/Media.php`, `Source.php`, `Exporter.php` | `grep -n "video" Modules/ShopifyProduct/app/Listeners/Media.php` → no matches |

Even if the import were fixed in isolation, a video would still not be displayed in the handbook and
would not be exported to Shopify.

## ⚠️ Trap: a partial port will make things worse

`ImageHandler::VALID_IMAGE_TYPES` differs between branches:

```php
// stage and master
const array VALID_IMAGE_TYPES = ['jpg', 'jpeg', 'png', 'webp'];
// dev
const array VALID_IMAGE_TYPES = ['jpg', 'jpeg', 'png', 'webp', 'mp4'];
```

If only the mapper is ported (so `VideoFeature` starts being read) without updating `ImageHandler`,
then `getImageExtension()` will not find `mp4` in the list and will **fall back to `'jpg'`**
(`ImageHandler.php:109`). The video is then saved as `mb_v_<slug>.jpg`, and
`ImageProcessor::process()` — which dispatches on the file extension — will recognise `jpg` as a
processable type and run **Imagick against an mp4 file**.

Both changes must be deployed together.

## Steps to reproduce

1. Confirm the starting state:
   ```sql
   SELECT i.external_id, i.mimetype, i.remote_path
   FROM image_product ip JOIN images i ON i.id = ip.image_id
   WHERE ip.product_id = 663822;
   -- one row, PhotoFeature
   ```
2. MiddleBy does offer alternate photos and a video for this product — **already confirmed**, see
   the inventory above. To re-check:
   ```bash
   php artisan middleby:get:product dcac668a-e956-44eb-92e8-6baaffc19354 \
     | grep -oE 'PhotoFeature|PhotoAlt|VideoFeature' | sort | uniq -c
   ```
3. Run a full vendor import — Vendors → *Blodgett (Middleby)* → **Update** — and let the
   `auto_quote_images` process finish (`php artisan queue:work --queue=auto_quotes`).
4. Re-run the query from step 1.

**Expected:** 5 media items — 1 feature photo, 3 alternate photos, 1 video with `mimetype = video/mp4`.

**Actual:** still 1 media item. No error is logged; `failed_jobs` is empty and the
`importMiddleByErrors` channel is silent — the import reports success.

## Suggested fix

Port the media work from `dev` as a set:

1. `MiddleByProductMapper::updatePictures()` — read `PhotoAlt` and `VideoFeature` alongside
   `PhotoFeature`, and derive `mediaType` from the file extension instead of hard-coding `'picture'`.
2. `ImageHandler::VALID_IMAGE_TYPES` — add `'mp4'` (see the trap above). Consider `'webm'` too:
   the dev mapper classifies it as video, but it is absent from `VALID_IMAGE_TYPES` even on `dev`.
3. `app/Models/Product/View/PageConstructor.php` + the handbook blade — render video.
4. `Modules/ShopifyProduct/app/Listeners/Media.php`, `Shopify/Entity/Product/Source.php`,
   `Exporter.php` — export video to Shopify.

Note that even on `dev` the Shopify side has a known open defect — see
`middleby_shopify_video_issue.md`: a standard export skips media when the Shopify product already
has ≥ 2 images, so videos only reach the storefront through an IMG Flush export.

## Out of scope but related

3D / interactive assets (spec §1, *"when available"*) are not implemented on either branch — no
attribute for them is read anywhere.

Test cases covering this: **TC-MBS-02**, **TC-MBS-03**, **TC-MBS-16** in `middleby_TCs_staging.md`.
