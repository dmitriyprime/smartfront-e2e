# NetSuite Product Export

How the FEDA App pushes product data **into** NetSuite (the ERP). This is the
*outbound* direction (FEDA → NetSuite); the inbound direction (importing changes
*from* NetSuite back into FEDA) is handled separately by the **Actualizer** and
`netsuite:data:actualize` / `net_suite_data:actualize_via_csv` and is only
touched on here where the two flows meet.

> Code lives mostly in `Modules/Netsuite`, with a legacy tail still in
> `App\Models\Product\NetSuite\*` and `App\Models\Product\Data\Collector\NetSuite`.
> The module classes carry `@todo`/`@deprecated` notes — the export is mid-migration
> from the old `App\…` namespace into the `Modules\Netsuite\…` module. New code
> should target the module + its facades.

---

## 1. High-level flow

```
Trigger (calc finished / manual CLI / AllPoints discontinue)
        │
        ▼
App\Models\Product\NetSuite\Dispatcher::dispatchUpdate($product)
        │   guards: is_export_allowed + not already scheduled
        │   sets net_suite_status, net_suite_export_scheduled_at = now()
        ▼
Job: Modules\Netsuite\Jobs\Export   (connection: database, queue: "netsuite", timeout 60s)
        │   clears scheduled_at, applies additional_export_data
        ▼
Modules\Netsuite\Services\Request::processProduct($product)   (via Request facade)
        │
        ├─ get()  → look up the item in NetSuite by SKU (RESTlet GET, flag=1)
        │
        ├─ record.id found ──► update()  → PUT
        │                         └─ Product facade ::update → Collector pipeline → payload
        │
        └─ "NO_ITEM_FOUND" ──► create()  → POST
                                  └─ Product facade ::create → Collector pipeline → payload
        ▼
Modules\Netsuite\Services\Api\Request::send()   (OAuth1.0 HMAC-SHA256 RESTlet call)
        ▼
NetSuite RESTlet  ──► response
        ▼
Persist back: saveProduct() + saveNetSuiteData() (writes product_net_suite_data,
              net_suite_status = READY, net_suite_exported_at, net_suite_imported_at)
        ▼
GTIN sync (separate RESTlet) unless item is "Discontinued"
```

---

## 2. Entry points / triggers

The export is **never** triggered by writing to a model directly — everything funnels
through `App\Models\Product\NetSuite\Dispatcher::dispatchUpdate()`.

| Trigger | Where | Sync/Async |
|---|---|---|
| **Price/content recalculation** (the main one) | `App\Models\Product\Actualizer::actualize()` / `actualizeRequiredProducts()` → `dispatchUpdate()`. Driven by the scheduled `products:actualize` command (runs **every minute**, `app/Console/Kernel.php`). | Async (queued) |
| **Calculator finished** | `Modules\Calculator\Services\Product` → `dispatcher->dispatchUpdate()` | Async |
| **AllPoints discontinue** | `app/Jobs/VendorMergeAllPoints/ProcessAllPoints.php` (+ `DiscontinueAllPoints`) | Async |
| **Manual single/range export** | CLI `php artisan netsuite:export:product {id}` (`Modules/Netsuite/app/Console/Export.php`) | **Synchronous** — bypasses the queue, calls `RequestFacade::processProduct()` directly |
| **Individual product / vendor export from UI** | `app/Models/Product/Bridge/SingleExporter.php`, `app/Models/Product/Updater.php` (dispatch the same job) | Async |

### `is_export_allowed` gate
A product is only eligible for export after a **successful price recalculation**:
`Actualizer::actualizePricesOnly()` sets `$product->is_export_allowed = true` (an
unsaved, virtual attribute). `Dispatcher::dispatchUpdate()` checks it first and
`unset()`s it before dispatching. So a recalculation that throws will *not* schedule
an export.

### The manual CLI command
```bash
php artisan netsuite:export:product 12345          # single product id
php artisan netsuite:export:product 12345...12400  # inclusive id range (auto-sorted)
```
It loads products with `vendor` eager-loaded, clears `net_suite_export_scheduled_at`,
and calls `RequestFacade::processProduct()` **inline** (no queue). Useful for
debugging a single SKU.

---

## 3. The Dispatcher — scheduling & de-duplication

`App\Models\Product\NetSuite\Dispatcher::dispatchUpdate()`:

1. **Bail** if `!is_export_allowed`.
2. **Bail** if `net_suite_export_scheduled_at` is already set (a job is in flight —
   prevents duplicate jobs for the same product).
3. Set `net_suite_status`:
   - `STATUS_PENDING (3)` if the product already has a `net_suite_id` (it's an update),
   - `STATUS_NOT_EXIST (1)` otherwise (it's a create).
4. If it has a `net_suite_id`, stamp `net_suite_export_scheduled_at = now()` (the lock).
5. Dispatch `Modules\Netsuite\Jobs\Export` on connection `database`, queue **`netsuite`**.

### Anti-deadlock: `products:clear_scheduler_data`
Because `scheduled_at` is a lock, a job that is dispatched but never runs (worker
crash) would block that product forever. The scheduled command
`products:clear_scheduler_data` (hourly, `app/Console/Commands/ClearNetSuiteSchedulerData.php`)
nulls out any `net_suite_export_scheduled_at` older than **24h**, releasing the lock.

---

## 4. The export job

`Modules\Netsuite\Jobs\Export` (`$timeout = 60`):
```php
public function __construct(array $payload)   // ['product_id' => ..., 'additional_export_data' => [...]]
public function handle(): void
{
    $product = Product::find($this->productId);   // App\Models\Product
    $product->net_suite_export_scheduled_at = null;  // release the lock as we start
    $product->save();
    if (!empty($this->additionalExportData)) {
        $product->additional_export_data = $this->additionalExportData; // ad-hoc field overrides
    }
    RequestFacade::processProduct($product);
}
```

> `App\Jobs\Export\Product\NetSuiteExport` is a thin **deprecated** subclass of this
> job, kept only so old enqueued payloads / call sites keep working.

`additional_export_data` lets a caller inject raw NetSuite field values that get
merged verbatim into the payload (see `Collector\NetSuite::collect()` — it loops the
array first), used by non-standard flows like AllPoints discontinuation.

---

## 5. `Request::processProduct` — decide create vs update

`Modules\Netsuite\Services\Request` (use the `Request` facade, not the class directly).

### 5.1 Lookup — `get()`
Tries up to three SKU forms against the RESTlet (GET, `flag=1`, `type=nameid`):

1. **Essendant vendor-prefixed SKU** — only when the product's vendor number equals
   `VendorService::ESSENDANT_VENDOR_NUMBER`. Looks up `"{vendorNumber}_{prefix}{model}"`.
2. **General SKU** — the product's plain `sku`.
3. **Dashed SKU** — if the SKU contains spaces, retry with spaces replaced by `-`
   (and remembers `skuLogic = dash_sku`, which later also dashes the SKU attributes
   sent on update).

### 5.2 Branch
```php
$response = $this->get($product);
if ($response->get('record.id')) {            // found → UPDATE
    $product->net_suite_id = $response->get('record.id');
    $this->update($product, $response);
} elseif ($response->get('name') === 'NO_ITEM_FOUND') {  // not found → CREATE
    $this->create($product);
} else {
    throw new Exception(...);                 // ambiguous / API error
}
```

### 5.3 Update path
- `NetSuiteProductFacade::update()` → PUT with `buildUpdatePayload` (ensures `id`).
- `saveProduct()` — see §7.
- `saveNetSuiteData()` — writes the NS response fields back into FEDA (§7).
- **GTIN sync** (`Gtin::send`) unless the freshly-stored item status is `Discontinued`.

### 5.4 Create path
- `NetSuiteProductFacade::create()` → POST with `buildCreatePayload` (defaults
  `recordtype = inventoryitem`).
- Stores the returned `net_suite_id`, `saveProduct()`, then GTIN sync.

### 5.5 Error handling
`handleException()` runs on any thrown `Exception`:
- refresh the model,
- log to the `net_suite_update` log channel,
- append the message to the **`net_suite_log`** table via `NetSuiteLogManager::addErrorMessage($productId, $msg)`,
- set `net_suite_status = STATUS_ERROR (2)`,
- clear `net_suite_export_scheduled_at`.

---

## 6. Building the payload — the Collector pipeline

Payloads are assembled by `Modules\Netsuite\Services\Collector::collect()`, which runs
an **Illuminate Pipeline** of stages configured in `Modules/Netsuite/config/config.php`
under `collector.pipeline` (sorted by `priority`):

| Priority | Stage | Responsibility |
|---|---|---|
| 0 | `Modules\Netsuite\Pipelines\Collector` | Base fields: every key in `config('netsuite.default_data')`, the SKU triple (`custitem43`, `custitem_aq_vendor_number_vendor_sku`, `custitem_sku`), `custitem_rs_use_app_price = true`, and `itemid` (3-letter vendor prefix + model, else SKU). |
| 1 | `Modules\Netsuite\Pipelines\CollectorDeprecated` | Delegates to the legacy `App\Models\Product\Data\Collector\NetSuite::collect()`, then fires the `Collector` **event** so the `Listeners\Collector` can append per-bridge pricing + item status. |

The payload is a flat associative array of NetSuite field codes → values.

### 6.1 Legacy collector (`App\Models\Product\Data\Collector\NetSuite`)
- First merges any `additional_export_data` (raw overrides).
- Maps `config('netsuite.data')` (field code → `Pool` constant) through a
  `NetSuiteExtractor`. Examples (`config/netsuite.php`):
  - `custitem42` ← cost, `custitem55` ← net price, `custitem_listprice` ← list price
  - `custitem_stock_description` ← description, `custitem_manufacturer` ← manufacturer
  - `custitem_product_height/width/depth`, `custitem5` ← weight, `custitem_freight_class`
  - `custitem_must_ship_via_ltl` / `custitem_liftgate` ← ship-LTL
- **Priced-by / units** (`getPricedByData`): resolves the package's `priced_by`
  against the `net_suite_attribute_options` table to set `unitstype` and the
  `stockunit` / `purchaseunit` / `saleunit` internal IDs. (On update it's skipped if
  NetSuite already has a `unitstype`.)
- **Additional data** (`getAdditionalData`): manufacturer code (`itemvendor`) and
  `custitem_absi_prod_line` — only sent if NetSuite doesn't already hold them.
- `finalProcessing`: drops `custitem_liftgate` when falsy.

### 6.2 Per-bridge prices (`Modules\Netsuite\Listeners\Collector`)
For every active bridge whose config has `export_prices_to_ns = true`, emits the
`config('netsuite.bridge_data')` fields with the bridge code substituted into the
placeholder, e.g. `custitem_<code>_call_price`, `_login_price`, `_online_price`. It
also computes the **min login price** across bridges and derives
`custitem_netsuite_item_status` (this is what gates the GTIN sync / "Discontinued").

### 6.3 Static defaults (`config('netsuite.default_data')`)
`custitem20 = true`, `custitem41 = true`, `custitem_ns_displayinwebstore = true`,
`taxschedule = 1`, `isinactive = false`.

---

## 7. Persisting the result

After a successful create/update:

**`saveProduct()`**
- Re-reads `net_suite_id`, refreshes the model.
- `unlinkAlreadyLinkedProduct()` — if **another** product already points at the same
  `net_suite_id`, that other product is reset (`net_suite_id = null`,
  status `NOT_EXIST`, cleared timestamps). Guarantees a 1:1 product↔NS-item link
  (the `products.net_suite_id` column is `UNIQUE`).
- Sets `net_suite_status = STATUS_READY (4)`, `net_suite_exported_at = now()`.

**`saveNetSuiteData()` → `ActualizerFacade::actualizeProduct()`**
(`App\Models\Product\NetSuite\Actualizer`)
- Writes the NS response fields into the **`product_net_suite_data`** row
  (`netsuite_item_status`, `gtin_upc`, `available_on_hand`, dims/weight + overrides,
  `lift_gate`, `white_glove`, `ship_individually`, `ship_via_ltl`, `proposition_65`, …).
- If `lift_gate` is set **and** the vendor has `enable_lift_gate`, flips the product's
  `calculation->free_shipping = true`.
- Stamps `net_suite_imported_at = now()` (this is the "data echoed back from NS" marker).

---

## 8. The API layer (transport)

`Modules\Netsuite\Services\Api\Request::send()` is a builder that performs a signed
**RESTlet** call:

- **Auth:** OAuth 1.0, `HMAC-SHA256` signature over the sorted base-string params,
  `Authorization: OAuth …` header with realm/consumer/token/nonce/timestamp/signature.
- **Methods:** `METHOD_GET (0)` / `METHOD_POST (1)` / `METHOD_PUT (2)` → GET/POST/PUT.
- **URL:** `{endpoint}?script={scriptId}&deploy={deployId}` (+ GET params appended &
  signed). Body for POST/PUT is `json_encode`d.
- **cURL:** 60s timeout, follows redirects, `Content-Type: application/json`.
- **Logging:** every request+response is written to the `netsuiteRequests` log channel.
- **Errors:** throws via a response factory on cURL error or any non-`200` status.

Connection profiles live in `Modules/Netsuite/config/config.php → connection`:
- **`default`** — product create/update/lookup (`NS_API_SCRIPT_ID`).
- **`gtin`** — GTIN sync (`NS_API_GTIN_SCRIPT_ID` + its own consumer/token).
- **`taxExemption`** — tax exemption RESTlet.

> There is an older, near-duplicate cURL/OAuth implementation inside
> `Modules\Netsuite\Services\Request` (`prepareCurlRequest`, `sendRequest`,
> `handleErrors`) marked deprecated/`xdebug_break()`. Live traffic goes through the
> `Api\Request` builder via the `Product`/`Gtin` service facades.

### GTIN sync (`Modules\Netsuite\Services\Gtin`)
A separate POST to the `gtin` connection. It collects `gtin_each/inner/outer`, then
**de-duplicates** against all other products (any GTIN already used elsewhere is
dropped) before sending, expecting a literal `"success"` response. Failures are
logged (`netsuiteError`, `netsuiteGtin`) but don't fail the whole export hard in the
update path (the call is wrapped and only the GTIN step is lost).

---

## 9. Configuration reference

**`config/netsuite.php`**
- `api.*` — endpoint URL, per-method script IDs, deploy/realm, consumer & access keys (all `env()`).
- `data` — field code → `Pool` constant map (the bulk of the payload).
- `additional_data` — manufacturer code / prod line (conditional).
- `bridge_data` — per-bridge price field templates (`<BRIDGE_CODE>` placeholder).
- `default_data` — static defaults always sent.
- `csv_files` — inbound inventory CSV definitions (import side).

**`Modules/Netsuite/config/config.php`**
- `connection.{default,gtin,taxExemption}` — per-RESTlet credentials.
- `store.list.{rst,krs}` — store → NetSuite store-code mapping (used by the bridge-price listener).
- `collector.pipeline` — the payload-builder stage list.

**Queue:** the export runs on the **`netsuite`** queue
(`Modules\Supervisor\Services\Queue::NETSUITE = 'netsuite'`). Run a worker with:
```bash
php artisan queue:work --queue=netsuite
```

---

## 10. Status model & data sources

`net_suite_status` (`App\Models\Product\Source\NetSuiteStatus`, stored on `products`):

| Value | Const | Label | Meaning |
|---|---|---|---|
| 1 | `STATUS_NOT_EXIST` | "Not Exist" | No NS item yet (pending create) |
| 2 | `STATUS_ERROR` | "Error" | Last export threw — see `net_suite_log` |
| 3 | `STATUS_PENDING` | "Not Updated" | Has NS id, update queued/in flight |
| 4 | `STATUS_READY` | "Ready" | Successfully exported |

Relevant `products` columns: `net_suite_id` (UNIQUE), `net_suite_status`,
`net_suite_export_scheduled_at` (the in-flight lock), `net_suite_exported_at`
(last push), `net_suite_imported_at` (last echo-back).

The full NS field snapshot per product lives in **`product_net_suite_data`**
(1:1 with products); errors accumulate in **`net_suite_log`** (`product_id`, `message`).

### Live stage-DB snapshot (`oners_stage`, read-only MCP)

`products` (957,605 rows):

| Metric | Count |
|---|---|
| Total products | 957,605 |
| With `net_suite_id` | 943,618 |
| `net_suite_exported_at` set | 943,618 |
| `net_suite_imported_at` set | 917,405 |
| Currently scheduled (lock held) | 0 |

`net_suite_status` distribution:

| Status | Count |
|---|---|
| 1 — Not Exist | 549 |
| 2 — Error | 146,064 |
| 3 — Pending | 577 |
| 4 — Ready | 810,415 |

Most common `net_suite_log` messages (top of ~hundreds of thousands of rows) — useful
as a "what actually goes wrong" guide:

| Message | Count |
|---|---|
| `Product Request Error: The function ProductDataFacade::getTitle is not working correctly` | 229,023 |
| `You have entered an Invalid Field Value 0 for the following field: vendor` | 213,924 |
| `Get By SKU Request Error: The 403 error code` | 43,193 |
| `Record has been changed` | 41,485 |
| `Uniqueness error - there is already an item with that name or name/parent combination.` | 34,478 |
| `Cannot invoke "...NLSession.getCompany()" ... is null` | 27,173 |
| `The function ProductHelperFacade::getTitle is not working correctly` | 21,409 |
| `Undefined array key "export_prices_to_ns"` | 20,812 |

> These counts are historical/cumulative (the table isn't auto-pruned), so a high
> count doesn't mean those products are currently broken — many are status 4 now.
> The `export_prices_to_ns` and `getTitle` messages point at config/data gaps that
> are worth tracking down if they're still recurring.

---

## 11. Quick reference

```bash
# Export one product (synchronous, inline)
php artisan netsuite:export:product 12345

# Export an id range
php artisan netsuite:export:product 12345...12400

# Process queued exports
php artisan queue:work --queue=netsuite

# Release stuck scheduler locks (also runs hourly on cron)
php artisan products:clear_scheduler_data
```

**Key files**
- `Modules/Netsuite/app/Console/Export.php` — manual CLI command
- `Modules/Netsuite/app/Jobs/Export.php` — queued job
- `Modules/Netsuite/app/Services/Request.php` — create/update orchestration (`Request` facade)
- `Modules/Netsuite/app/Services/Product.php` — create/update/lookup payload entry (`Product` facade)
- `Modules/Netsuite/app/Services/Collector.php` + `app/Pipelines/*` — payload builder
- `Modules/Netsuite/app/Services/Api/Request.php` — signed RESTlet transport
- `Modules/Netsuite/app/Services/Gtin.php` — GTIN sync
- `App/Models/Product/NetSuite/Dispatcher.php` — scheduling/de-dup gate
- `App/Models/Product/NetSuite/Actualizer.php` — write NS response back into FEDA
- `App/Models/Product/Data/Collector/NetSuite.php` — legacy field mapping
- `config/netsuite.php`, `Modules/Netsuite/config/config.php` — configuration
```
