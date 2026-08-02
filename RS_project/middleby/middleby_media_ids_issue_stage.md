# Issue: MiddleBy media ids are time-based on stage — every import duplicates the files

- **Environment:** stage (`oners_stage`), branch `stage` @ `3aca91ddf`
- **Area:** MiddleBy import → media download and storage
- **Severity:** High — duplicate images accumulate on products and on disk with every import;
  a locally deleted file is never restored
- **Related:** RSPA-719. Fixed on dev by `06ec03c1f RSPA-719 Fix of the media upload [ids] + add
  check of existing media to reload`. Review of that fix: `RSPA-719_media_fix_TCs.md`
- **Verified:** 2026-07-31

## Summary

MiddleBy media arrives at `ImageHandler` with an empty `id`. `getExternalId()`
(`app/Models/Product/ImageHandler.php:119`) then substitutes `'image' . Carbon::now()->timestamp`,
so the `images.external_id` depends on **when the import ran**, not on the file. Every processing
pass in a new second creates another `images` row and downloads another copy of the same file.

On dev the same media is keyed deterministically as `mb_p_<slug>` / `mb_v_<slug>`.

## Evidence

```sql
SELECT COUNT(*)                                                   AS image_rows,
       COUNT(DISTINCT SUBSTRING_INDEX(remote_path,'?',1))         AS distinct_files,
       COUNT(*) - COUNT(DISTINCT SUBSTRING_INDEX(remote_path,'?',1)) AS surplus_rows,
       SUM(external_id REGEXP '^image[0-9]{10}$')                 AS timestamp_ids,
       SUM(external_id LIKE 'mb\_%')                              AS slug_ids
FROM images WHERE remote_path LIKE '%middleby-cdn%';
```

| | stage | dev |
|---|---|---|
| `images` rows (MiddleBy) | 176 | 2014 |
| distinct files | **85** | **2014** |
| **surplus rows** | **91** | **0** |
| `image<timestamp>` ids | 176 / 176 | 0 |
| `mb_*` slug ids | 0 | 2014 / 2014 |

Stage stores 176 rows for 85 files — **107 % duplication**. Dev holds 24× more media with **zero**
duplicates.

### Worst offenders on stage

```sql
SELECT COUNT(*) AS copies,
       SUBSTRING_INDEX(SUBSTRING_INDEX(remote_path,'?',1),'/',-1) AS file,
       MIN(created_at) AS first_seen, MAX(created_at) AS last_seen
FROM images WHERE remote_path LIKE '%middleby-cdn%'
GROUP BY SUBSTRING_INDEX(remote_path,'?',1)
HAVING copies > 1 ORDER BY copies DESC;
```

| copies | file | window |
|---|---|---|
| **36** | `Imperial_STAND36_Stand_PhotoMain_1_frontcenter.jpg` | 2026-02-17 12:01:39 → 12:30:30 |
| 13 | `Imperial_HR STAND_HDstand_PhotoMain_1_frontright.jpg` | 2026-02-17 18:10:31 → 18:35:23 |
| 8 | `BKI_2TSM_Warmer_PhotoMain_1_FrontRight.jpg` | 2026-02-13 13:24:42 → 13:25:12 |
| 8 | `BKI_SM-XX24_Warmer_PhotoMain_1_FrontLeft.jpg` | 2026-02-13 13:25:18 → 13:25:52 |
| 5 | `Imperial_IHEG-48S_Accessories_PhotoMain_1_Angled.jpg` | 2026-02-17 12:20:30 → 12:29:08 |

The mechanics are visible in the ids themselves — `image1771329697` → `image1771329820` is a
123-second gap between two rows for the same file.

Why 36 copies: `STAND36` is a shared accessory image used by 36 models. The import walks products
one by one and mints a fresh id on each, because the key depends on the clock rather than the file.
On dev this is one row `mb_p_imperial_stand36_stand_photomain_1_frontcenter` with 36 rows in
`image_product`.

### Why the existing de-duplication does not help

`ImageManager::createByApiProduct()` has a fallback that reuses an existing `external_id` matched by
`remote_path`. MiddleBy URLs carry a `?update_date=<ts>` query string, so the match only holds while
the supplier has not touched the file. As soon as `update_date` changes, the lookup misses and the
whole set is duplicated again.

## Impact

| | |
|---|---|
| MiddleBy media on disk (stage) | **401.7 MB** |
| of which redundant copies | **≈ 207 MB** |
| products carrying MiddleBy media | 169 |
| `image<timestamp>` rows across all vendors | 578 |

Duplicates are linked to products, so they are visible on the storefront as repeated images, and
they are exported downstream.

## Second half of the same fix is also missing

`06ec03c1f` has two parts; stage lacks both.

Besides the id scheme, `ImageHandler::isShouldDownload()` on dev checks that the local file is
actually present before comparing sizes:

```php
$isExists = Storage::disk('public')
    ->exists(Image::IMAGES_DIRECTORY . '/' . $imageModel->getAttribute('local_path'));

if (!$isExists) {
    return true;
}
```

Without it, a file deleted from disk is never re-downloaded: the method compares the remote
`Content-Length` with the stored `size`, they match, and it returns `false`. The product keeps a
broken image.

## Steps to reproduce

1. Note the current counts:
   ```sql
   SELECT COUNT(*), COUNT(DISTINCT SUBSTRING_INDEX(remote_path,'?',1))
   FROM images WHERE remote_path LIKE '%middleby-cdn%';
   ```
2. Run a full vendor import for a MiddleBy vendor whose CDN files have changed since the last run
   (a changed `?update_date=` is what defeats the fallback).
3. Re-run the query.

**Expected:** the row count matches the distinct-file count.
**Actual:** the row count grows while the file count does not.

For the second half — delete one file from
`storage/app/public/products/i/m/` and run `php artisan product:images --product_id=<id>`
(this path uses `is_redownload = false`, which is the only one where the check is observable).
The file is not restored.

## Suggested fix

Port `06ec03c1f` in full:

1. `Modules/ImportMiddleBy/app/Services/MiddleByProductMapper.php` — emit a deterministic
   `'id' => 'mb_' . <p|v> . '_' . Str::slug($fileName, '_')`.
2. `app/Models/Product/ImageHandler.php` — add the `exists()` check at the top of
   `isShouldDownload()`.

Two caveats carried over from the review of that fix (`RSPA-719_media_fix_TCs.md`):

- The slug is built from the base file name only; the CDN directory and the extension are dropped,
  while `images.external_id` is UNIQUE. Two different files sharing a base name across
  `PhotoFeature/` and `PhotoAlt/` collapse into one row. Including `dirname()` and the extension in
  the key avoids this.
- All ids start with `mb_`, and `getLocalBasePath()` shards by the first two characters, so every
  MiddleBy file lands in a single directory `products/m/b/`.

**Cleanup after the fix.** The existing rows are not migrated by the code change:

```sql
-- MiddleBy duplicates on stage
SELECT COUNT(*) FROM images WHERE remote_path LIKE '%middleby-cdn%';                  -- 176 rows / 85 files
-- legacy time-based ids across all vendors
SELECT COUNT(*) FROM images WHERE external_id REGEXP '^image[0-9]{10}$';              -- 578
```

They need a separate migration or command, together with the orphaned files on disk.

## Verification after the fix

```sql
-- must be equal
SELECT COUNT(*) AS rows_, COUNT(DISTINCT SUBSTRING_INDEX(remote_path,'?',1)) AS files
FROM images WHERE remote_path LIKE '%middleby-cdn%';

-- no time-based ids should be created any more
SELECT COUNT(*) FROM images
WHERE remote_path LIKE '%middleby-cdn%' AND external_id REGEXP '^image[0-9]{10}$';
```

Run a vendor import twice in a row and confirm neither count grows.

Test case covering this: **TC-MBS-05** in `middleby_TCs_staging.md`.
