# Manual Test Cases — RSPA-873

**Ticket:** RSPA-873 — Add `custitem_send_to_shopify` field to NetSuite product create/update; batch range export command  
**Branch:** `RSPA-873` (merged into `dev` via MR !1647, commit `116ff209`)  
**Primary commit:** `5641fb36`  
**Tester environment:** Docker container (`feda_php`), connected with `docker exec -it -u www-data feda_php bash`

---

## Scope of Changes

| #   | Area             | Change                                                                                     |
| --- | ---------------- | ------------------------------------------------------------------------------------------ |
| 1   | NetSuite payload | `custitem_send_to_shopify: true` added unconditionally to every product create/update      |
| 2   | CLI command      | `netsuite:export:product` now accepts a range `{from}...{to}` in addition to a single ID   |
| 3   | Error logging    | `Product.php` `update()` and `create()` errors now include file path, line, and full trace |
| 4   | API logging      | `Request.php` logs outgoing payload and response body (debug level)                        |

---

## Pre-conditions

1. Connect to the app container:
    ```bash
    docker exec -it -u www-data feda_php bash
    ```
2. Ensure NetSuite API credentials are configured in `config/netsuite.php` (or `.env`).
3. Tail the netsuite log in a second terminal window:
    ```bash
    docker exec -it -u www-data feda_php bash -c "tail -f storage/logs/netsuite*.log"
    ```

---

## TC-RSPA-873-01 — `custitem_send_to_shopify` is sent in product **update** payload

**Prerequisite:** Use a product that already has a `net_suite_id` (existing product in NetSuite).  
**Test product:** ID `1000`, SKU `1006_94-24-80-36R`, `net_suite_id = 125180` (confirmed in `oners_dev`).

**Steps:**

1. Inside the container, run:
    ```bash
    php artisan netsuite:export:product 1000
    ```
2. In the log tail, locate the line containing `"Request Body:"`.
3. Find the JSON payload sent to NetSuite.

**Expected result:**

- Command outputs:
    ```
    Processing product #1000 export to NetSuite...
    Product #1000: success.
    ```
- The log payload contains the field:
    ```json
    "custitem_send_to_shopify": true
    ```
- The field is present alongside other `custitem_*` fields (e.g. `custitem_netsuite_item_status`).

**Pass criteria:** `custitem_send_to_shopify: true` is present in the outgoing PUT/PATCH request body.

---

## TC-RSPA-873-02 — `custitem_send_to_shopify` is sent in product **create** payload

**Prerequisite:** Use a product that has `net_suite_id = NULL` (not yet in NetSuite — triggers create path).  
**Test product:** ID `1`, SKU `9971465_167HNDLHLDBK`, `net_suite_id = NULL`, `net_suite_status = 2` (confirmed in `oners_dev`).

**Steps:**

1. Inside the container, run:
    ```bash
    php artisan netsuite:export:product 1
    ```
2. In the log tail, locate the `"Request Body:"` line for the POST request.

**Expected result:**

- Command outputs:
    ```
    Processing product #1 export to NetSuite...
    Product #1: success.
    ```
- The log payload contains:
    ```json
    "custitem_send_to_shopify": true,
    "recordtype": "inventoryitem"
    ```

**Pass criteria:** `custitem_send_to_shopify: true` is present in the outgoing POST request body.

---

## TC-RSPA-873-03 — Range export: valid ascending range

**Test products:** IDs `1000...1002` (SKUs `1006_94-24-80-36R`, `1006_94-24-80-36RL`, `1006_94-3-54`).

**Steps:**

1. Inside the container, run:
    ```bash
    php artisan netsuite:export:product "1000...1002"
    ```

**Expected result:**

```
Processing product #1000 export to NetSuite...
Product #1000: success.
Processing product #1001 export to NetSuite...
Product #1001: success.
Processing product #1002 export to NetSuite...
Product #1002: success.
```

- Exactly 3 products are processed in ascending ID order.
- Each product's payload includes `custitem_send_to_shopify: true`.

**Pass criteria:** All 3 products exported; no errors; IDs processed in order 1000 → 1001 → 1002.

---

## TC-RSPA-873-04 — Range export: reversed range auto-corrects

**Steps:**

1. Inside the container, run:
    ```bash
    php artisan netsuite:export:product "1002...1000"
    ```

**Expected result:**

- Same output as TC-RSPA-873-03 — the command internally swaps `from` and `to` so processing order is still `1000 → 1001 → 1002`.
- No error about invalid range.

**Pass criteria:** Reversed range produces identical result to the ascending range; all 3 products processed successfully.

---

## TC-RSPA-873-05 — Single ID export (backward compatibility)

**Steps:**

1. Inside the container, run:
    ```bash
    php artisan netsuite:export:product 1000
    ```

**Expected result:**

```
Processing product #1000 export to NetSuite...
Product #1000: success.
```

- Only product `1000` is processed.

**Pass criteria:** Single-ID usage still works as before; exactly 1 product exported.

---

## TC-RSPA-873-06 — Non-existent product ID returns error

**Steps:**

1. Inside the container, run:
    ```bash
    php artisan netsuite:export:product 999999999
    ```

**Expected result:**

```
Product not found
```

- Command exits without attempting any API call.
- No NetSuite API request appears in the log.

**Pass criteria:** Error message shown; exit without export.

---

## TC-RSPA-873-07 — Non-existent range returns error

**Steps:**

1. Inside the container, run:
    ```bash
    php artisan netsuite:export:product "999999990...999999999"
    ```

**Expected result:**

```
Product not found
```

- No NetSuite API request is made.

**Pass criteria:** Range with no matching products shows error and exits cleanly.

---

## TC-RSPA-873-08 — Error log contains file path, line, and trace

**Purpose:** Verify the enhanced error logging introduced in `Product.php` `update()` / `create()`.

**Steps:**

1. Temporarily break the NetSuite connection (e.g. set an invalid `NETSUITE_HOST` in `.env` or use a product with a deliberately malformed SKU that the NS API will reject).
2. Run:
    ```bash
    php artisan netsuite:export:product 1000
    ```
3. Check `storage/logs/netsuite_error*.log`.

**Expected result:**

- The error log entry contains:
    - `Product Update Request Error:` (or `Product Create Request Error:`)
    - `line:` with format `path/to/File.php::42`
    - `trace:` with a multi-line stack trace

**Pass criteria:** Error log includes file/line and full exception trace (not just the message string).

---

## Regression Check

| Scenario                                                                            | Expected                                                                                                                   |
| ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Export a product not configured for any active bridge                               | Command runs; `custitem_netsuite_item_status` uses the default (no bridge prices), `custitem_send_to_shopify` still `true` |
| Export via UI trigger (not CLI)                                                     | Same payload — `custitem_send_to_shopify: true` present regardless of trigger path                                         |
| Existing automated `netsuite:export:product` calls with a single ID in scripts/cron | No regression — single-ID syntax still valid                                                                               |

---

## Files Changed (Reference)

| File                                            | Lines                                           |
| ----------------------------------------------- | ----------------------------------------------- |
| `Modules/Netsuite/app/Listeners/Collector.php`  | L64 — `custitem_send_to_shopify` added          |
| `Modules/Netsuite/app/Console/Export.php`       | L31–76 — range parsing + loop                   |
| `Modules/Netsuite/app/Services/Api/Request.php` | L293 — `unset($curl)`; L295–312 — debug logging |
| `Modules/Netsuite/app/Services/Product.php`     | L83–90, L108–115 — enhanced error logs          |
