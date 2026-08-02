# MiddleBy Import — Functional Documentation

> Module: `Modules/ImportMiddleBy`
> Tickets: RSPA-707 / RSPA-718 / **RSPA-719** (data mapping & import) / RSPA-720
> Business spec: `middleby_task_13_07.md`

---

## 1. Overview

The **ImportMiddleBy** module enriches AutoQuotes (AQ) product data with content pulled from
the **MiddleBy** product catalog, for products that belong to MiddleBy brands.

Key design principles:

- **It is not a separate import job.** MiddleBy enrichment hooks into the *existing* AutoQuotes
  import flow through a single event (`ModifyImportProductData`). To test it, you run a normal
  vendor / product import.
- **It mutates the AQ product array in place** *before* the product is persisted. The enriched
  array then travels through the normal AQ → `Updater` → database pipeline. There is no separate
  "MiddleBy product" record; MiddleBy content is folded into the regular product.
- **It is fallback-safe.** Every mapping step only overwrites AQ data when MiddleBy data is
  actually present, and the whole mapping is wrapped in a `try/catch` that logs and returns
  silently. If there is no brand mapping, no MiddleBy match, or no content — the original AQ
  data is kept untouched. This is the single most important guarantee (see §7).

Content covered (per `middleby_task_13_07.md`):

| Content        | Rule                                                                    |
| -------------- | ----------------------------------------------------------------------- |
| Images         | **Merge** AQ images + all available MiddleBy images                     |
| Videos         | Import all MiddleBy marketing videos                                    |
| Specifications | Keep the first AQ groups, **append** MiddleBy specification groups      |
| Certifications | Import **only missing** certifications                                  |
| Warranty       | **Replace** AQ warranty with MiddleBy warranty                          |
| PDFs           | Import MiddleBy documents (Parts List, Brochure, Spec Sheet, Manual, …) |
| Fallback       | If no MiddleBy match / content — retain the current AQ content          |

---

## 2. Architecture & Data Flow

```
AutoQuotes fetch (App\Traits\AutoQuote::getProduct / getProductList)
        │
        │  event(new ModifyImportProductData($body))          app/Traits/AutoQuote.php:70, :101
        ▼
ModifyImportProductData  (Event)                              Modules/ImportMiddleBy/app/Events/
        │  registered in EventServiceProvider
        ▼
ModifyImportProductData  (Listener::handle)                   Modules/ImportMiddleBy/app/Listeners/
        │  for each product in event->data['data']:
        │   1. read mfrId, models.mfrModel, mfrName
        │   2. brand = BrandMapping::getMiddleByBrand(mfrName) → autoquote_to_middleby_brands
        │   3. middleByData = Product::getData(mfrId, mfrModel, productData)
        │   4. MiddleByProductMapper::mapProduct($productData, $middleByData)   ← mutates in place
        ▼
MiddleByProductMapper::mapProduct                            Modules/ImportMiddleBy/app/Services/
        │  update* / copy* methods rewrite $aqProductData
        ▼
Normal AQ persistence  →  app/Models/Product/Updater.php  →  DB
        │
        ├─► images / image_product          (images + video)
        ├─► documents / document_product     (PDFs)
        └─► products.certifications / .warranty / .specs, product_option_values (specs)
        │
        ▼
Downstream consumers
        ├─► Handbook product view (renders <video> for mp4)   resources/views/pages/handbook/...
        └─► Shopify export (image → IMAGE, video → VIDEO)      Modules/ShopifyProduct + Exporter
```

### Fetch / caching (`Services/Product::getData`)

1. Look up `autoquote_middleby_product_mappings` by `(mfrId, mfrModel)`.
2. If a mapping row exists → fetch MiddleBy product by its `middlebyUuid`
   (`ImportMiddleBy::getProduct`).
3. If not → resolve the UUID via the MiddleBy API (`getProductByUuid`), store the mapping
   (`AutoQuoteMiddleByProductMapping::createOrUpdate`), then fetch the product.

This mapping table is a **cache** so that repeated imports don't re-search the MiddleBy API.

---

## 3. Configuration

### `.env`
```
MIDDLE_BY_CLIENT_ID=your_client_id
MIDDLE_BY_CLIENT_SECRET=your_secret
MIDDLE_BY_SUBSCRIPTION_KEY=key
MIDDLE_BY_BASE_URL='https://apim-ami-webservices-dev-eus.azure-api.net/databridge-service/v1'
MIDDLE_BY_FILE_IMPORT_CHUNK_SIZE=100
```

### Database tables

| Table                                   | Purpose                                                        |
| --------------------------------------- | ------------------------------------------------------------- |
| `autoquote_to_middleby_brands`          | Maps AQ brand name → MiddleBy brand (used to decide enrich)   |
| `autoquote_middleby_product_mappings`   | Cache: `(mfrId, mfrModel)` → `middlebyUuid`                   |
| `middleby_file_history_load`            | History of CSV mapping-file loads                            |

### CSV mapping import

`Import` → `Vendors Merge Files` → `MiddleByFile`. CSV format:
```csv
mfrId,mfrModel,middlebyUuid
8bc6e7a0-be0d-dd11-a23a-00304834a8c9,B8003106,5cf7e179-c27f-4086-a1b1-22e1df48a310
```
Rows are inserted into `autoquote_middleby_product_mappings` (queued for correctness).

---

## 4. Mapping rules per content type

All logic lives in `Modules/ImportMiddleBy/app/Services/MiddleByProductMapper.php`.
Attribute extraction helpers live in `Services/AttributeValue.php`.

### 4.1 Media — images & video (task §1)
- Method: `updatePictures()`.
- Source MiddleBy attributes: `PhotoFeature` (feature photos), `PhotoAlt` (alternate photos),
  `VideoFeature` (marketing videos). They are **merged** together and appended to
  `aqProductData['pictures']` — AQ images are **not** removed.
- Each merged item gets a `mediaType`: file extension in `['mp4','webm']` → `video`, otherwise
  `picture`. (Introduced by the July fixes — commits `fcdfad3be`, `2e801c5f2`.)
- Persisted to `images` + `image_product`. Video rows carry `mimetype = video/mp4`,
  `name = video`.

### 4.2 Specifications (task §2)
- Methods: `copyAttributes()` (single attributes: GTIN, residential/commercial, country of
  origin, energy star) and `copyAttributesByGroup()` (whole groups:
  `function_and_features`, `energy_specs_attribute_group`, `water_specs_attribute_group`,
  `installation_details_attribute_group`, `other`).
- MiddleBy attribute groups are **appended** to `aqProductData['categoryValues']`; the first AQ
  groups are kept as-is (AQ specs are not deleted).
- `updateAqSpecification()` fills `AQSpecification` from MiddleBy `long_description` **only when
  the AQ specification is empty** (pure fallback).
- Persisted to `product_options` / `product_option_values` (and `products.specs` for the
  AQSpecification blob).
- `global_trade_item_number` is special-cased into `aqProductData['GTIN']['each']`.

### 4.3 Certifications (task §3)
- Method: `updateProductCertifications()`.
- Source: `product_certifications` (`regulation_compliance_certifications_attribute_group`).
- Rule: for each MiddleBy certification, **skip if already present** in
  `aqProductData['certifications']`, otherwise append. Only *missing* certs are added.
- Persisted to `products.certifications` as a JSON array.

### 4.4 Warranty (task §4)
- Method: `copyWarrantyByGroup()`.
- Source group: `warranty_and_disclaimers_attribute_group`.
- Rule: writes `aqProductData['warranties']` (property/value pairs). `Updater` formats them into
  HTML (`<p><b>property</b>: value</p>`) → `products.warranty`. This **replaces** the AQ warranty
  text.

### 4.5 Documents / PDFs (task §5)
- Method: `updateDocuments()`.
- Source attributes: `Parts_List`, `Brochure`, `Spec_Sheets`, `User_Manuals`, `warranty_sheet`.
- For each, resolves a media label + URL, then derives the internal `mediaType` from the URL:
  `brochure` → brochure, `usermanuals` → manual, `warrantysheet` → warrantysheet, else
  `cutsheet` (see `App\Models\Product\PdfHandler::$specialMediaTypes`).
- Appended to `aqProductData['documents']`; persisted to `documents` + `document_product`.

### Other fields mapped
`updateListPrice` (MiddleBy `list_price`), `updateListPriceDate`
(`Pricing_Accurate_As_Of_Date`), `updateDimensions` (`weights_dimensions_attribute_group`,
with `product_weight` → `shippingWeight`), `updateFreightClass` (`freight_class__NMFC_`),
`updateShippingOriginZipCode` (`shipping_origin_zip_code`).

---

## 5. Media pipeline (images + video) — RSPA-719 July fixes

The July work made the whole media path video-aware. End to end:

1. **Import / mapping** — `updatePictures()` tags each media item as `picture` or `video`
   (see §4.1).
2. **Validation** — `app/Models/Product/ImageHandler.php`: `mp4` added to `VALID_IMAGE_TYPES`;
   the extension is now taken from the URL *path* (`parse_url(... PHP_URL_PATH)`) so query
   strings don't break detection.
3. **Storage** — `app/Models/Product/ImageProcessor.php`: files whose extension is not an image
   type **skip Imagick processing** (video is stored as-is, never rasterized/cropped), and the
   hash is still computed.
4. **Handbook display** — `app/Models/Product/View/PageConstructor.php` now passes the image
   `mimetype`; `resources/views/pages/handbook/partials/product/view.blade.php` renders a
   `<video controls>` element when `type === 'video/mp4'`, otherwise the usual `<img>`.
5. **Shopify export** —
   - `Modules/ShopifyProduct/app/Listeners/Media.php`: media type resolved by mimetype
     (`video/mp4` → `Source::PRODUCT_MEDIA_TYPE_VIDEO`, else `..._IMAGE`); a `FAILED` media
     response is no longer treated as an existing image to remove.
   - `app/Models/Shopify/Entity/Product/Source.php`: constants
     `PRODUCT_MEDIA_TYPE_IMAGE = 'IMAGE'`, `PRODUCT_MEDIA_TYPE_VIDEO = 'VIDEO'`.
   - `app/Models/Shopify/Entity/Product/Exporter.php`: each `productCreateMedia` mutation is
     wrapped in `try/catch`; a failing asset is logged to the `shopifyProductMedia` channel and
     **skipped**, so one bad asset can't abort the whole product export ("unlock" fix).

---

## 6. Log channels

| Channel                | Where                                    | What                                    |
| ---------------------- | ---------------------------------------- | --------------------------------------- |
| `importMiddleBy`       | `Listeners/ModifyImportProductData`      | Warnings: empty fields, brand not mapped, empty MiddleBy data; per-product errors |
| `importMiddleByErrors` | `Services/MiddleByProductMapper`         | Mapping failures (with stack trace)     |
| `shopifyProductMedia`  | `app/Models/Shopify/Entity/Product/Exporter` | Per-asset Shopify media export failures |

---

## 7. Fallback behavior

The original AQ content is retained whenever:

- the product's brand is **not mapped** in `autoquote_to_middleby_brands` (listener logs
  "Brand is not mapped" and continues);
- `mfrId` / `mfrModel` / `mfrName` are empty (logs "Empty one of the fields");
- no MiddleBy product matches (`Product::getData` returns `[]` → "MiddleBy data is empty");
- a specific section has no MiddleBy content (each `update*/copy*` method returns early / adds
  nothing);
- `mapProduct()` throws — the exception is caught, logged to `importMiddleByErrors`, and the AQ
  array is left as-is.

> **Spec note:** "If a matching MiddleBy product cannot be found or the requested content is
> unavailable, retain the existing AQ data."

---

## 8. How to trigger an import

### UI
`Import` → `List of vendors` → find a MiddleBy vendor (e.g. *Blodgett (Middleby)*) → click
**Load**. Enriched products appear in the `products` table; view them in the Handbook.

### CLI (inside the app container)
```bash
# Import a single product (AQ external_id) — runs the full flow incl. MiddleBy enrichment
php artisan product:import --external_id=0c218722-1048-df11-beff-001ec95274b6

# Raw MiddleBy API helpers (data inspection only)
php artisan middleby:get:product 829693a9-29c5-4e3a-abea-ff9697ab9fd0
php artisan middleby:get:products:list
php artisan middleby:get-token
```

---

## 9. Verification hooks (dev DB)

Read-only tunnel: host `127.0.0.1`, port `3307`, user `oners_read`, db `oners_dev`.

| Content        | Where to look                                                              |
| -------------- | ------------------------------------------------------------------------- |
| Images / video | `images` (`mimetype`, `name`) JOIN `image_product` (`product_id`)         |
| Documents      | `documents` (`title`, `mimetype`, `status`) JOIN `document_product`       |
| Specifications | `product_option_values` JOIN `product_options`                            |
| Certifications | `products.certifications` (JSON array)                                     |
| Warranty       | `products.warranty` (HTML)                                                 |
| AQSpecification| `products.specs`                                                           |
| Brand mapping  | `autoquote_to_middleby_brands`                                            |
| Product mapping| `autoquote_middleby_product_mappings` (`mfrId`, `mfrModel`, `middlebyUuid`)|

**Reference product** (used by the test cases): `id = 611510`,
`sku = 1048_ZEPH-200-E ADDL_220/60/1`, vendor `81` (Blodgett (Middleby)),
external_id `0c218722-1048-df11-beff-001ec95274b6`, MiddleBy uuid
`829693a9-29c5-4e3a-abea-ff9697ab9fd0` — the same product used as the example in
`middleby_task_13_07.md`.
