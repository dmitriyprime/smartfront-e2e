# Issue: Videos don't appear in Shopify after product export

- **Environment:** dev (`oners_dev`) / RST Shopify store
- **Area:** Shopify product export → media (video)
- **Severity:** Medium — imported videos are not published to the storefront

## Summary

Products that have an imported MiddleBy video (e.g. Blodgett 611510, BKI 295882) export to
Shopify without the video — the video is missing from the Shopify product/storefront even though
it exists in the app (`images.mimetype = video/mp4`).

## Root cause (two factors)

1. **Standard export skips media for already-imaged products.** In
   `app/Models/Shopify/Entity/Product/Exporter.php:529`, the media-create loop returns early when
   the Shopify product already has `>= 2` non-video images **and** the export type is not
   `TYPE_IMG_FLUSH`:
   ```php
   if ($imageCount >= 2 && $this->getExportType() != ExportType::TYPE_IMG_FLUSH) { return; }
   ```
   A normal "Update All" export (vendor `export_type = 5`) therefore never pushes a newly-added
   video to a product that already has images. Only an **IMG Flush** export re-syncs media.

2. **Async ingestion failures are silent.** Even when the video is sent, Shopify ingests video
   **asynchronously**; `productCreateMedia` returns success immediately and the video can still
   end in `FAILED` processing (e.g. Shopify can't fetch the source URL
   `https://dev.oners.app/storage/images/…mp4`, or codec unsupported). The code checks neither
   `mediaUserErrors` nor the media processing status, so these failures are invisible — only
   **synchronous** exceptions are logged (`shopifyProductMedia` → `storage/logs/shopifyProduct/media.log`).

## Impact

Imported videos are not visible on the Shopify storefront; there is no error surfaced for the
async case, so it silently looks like the export succeeded.

## Fix direction

- Ensure video media is (re)sent on export — e.g. don't let the `imageCount >= 2` gate skip a
  product that has a **video** not yet on Shopify, or route video export through the IMG Flush
  path.
- Add observability for async ingestion: check `mediaUserErrors` on the mutation response and/or
  poll Shopify media `status`/`mediaErrors` after upload, logging failures.
- Verify the exported source URL (`config('core.url')` + `/storage/images/…mp4`) is publicly
  reachable by Shopify and returns `Content-Type: video/mp4`.

## Verification

- After a **standard** export: `rst_shopify_product_images` for the product contains only images,
  no video row → confirms the gate skipped it.
- After an **IMG Flush** export: check whether a video media row is recorded, and whether it
  actually displays on Shopify (if not → async ingestion failure).
- Logs: `storage/logs/shopifyProduct/media.log` (sync failures only).

## Reference

- `app/Models/Shopify/Entity/Product/Exporter.php:529` — the `imageCount >= 2` gate.
- `app/Models/Shopify/Entity/Product/Exporter.php:550-566` — `productCreateMedia` try/catch (sync-only logging).
- `Modules/ShopifyProduct/app/Listeners/Media.php` — media type resolved by mimetype (`video/mp4` → VIDEO).
- Related: RSPA-719 (video import + "export media to shopify" commits). See `middleby_doc.md` §5.
