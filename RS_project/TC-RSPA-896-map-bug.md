# Manual Test Case — RSPA-896: MAP collapses to Login (manual MAP lost)

| Field                   | Value                                                                                   |
| ----------------------- | --------------------------------------------------------------------------------------- |
| **TC ID**               | TC-RSPA-896-MAP-01                                                                      |
| **Title**               | After recalculation, a manual MAP (> Login) is wrongly replaced with Login              |
| **Module / Area**       | Calculator → bridge prices (MAP) · `Modules/Calculator/app/Services/Calculator.php`     |
| **Related**             | RSPA-896 · commit `843c0e300` · MR !1788 (→dev), !1791 (→master)                        |
| **Type**                | Regression / negative                                                                   |
| **Severity / Priority** | Major / High (distorts the public MAP price)                                            |
| **Environment**         | dev (`oners_dev`) and master — both branches contain the buggy commit. `stage` does NOT |

---

## Bug description

In `calculateBridgePricesModifier()` the MAP zero-out line for Special Quote items has its ternary
operands swapped:

```php
$mapPrice = $mapPrice ? ($netPrice && $listPrice) : 0;   // CORRECT: ($netPrice && $listPrice) ? $mapPrice : 0;
```

`($netPrice && $listPrice)` is a boolean in PHP, so with non-zero net/list the MAP is zeroed to `1`.
The price protection `protectBridgePrice` (`Calculator.php:261`) then raises `1` up to `Login`.
As a result, **a manual MAP that used to be higher than Login is lost and becomes equal to Login.**

---

## Preconditions

1. Access to the App admin (page **Calculation → Pricing Table**, `/calculation`).
2. Access to the server console for `php artisan calculator:calculate` (or wait for the
   `products:actualize` cron auto-recalculation).
3. The test product matches the conditions under which the bug is observable:
    - `List Price > 0` and `Net Price > 0` (not a Special Quote item);
    - manual MAP (`product_calculations.map`) **> Login** on the bridges;
    - vendor: `remove_protection = 0`, `map_as_login = 0`;
    - `netsuite_item_status ≠ Discontinued` (otherwise the product leaves the grid).

---

## Test data — product ID 94

| Parameter                               | Value                                                   |
| --------------------------------------- | ------------------------------------------------------- |
| Product ID                              | **94**                                                  |
| SKU / Model                             | `1006_1014A-10A` / `1014A-10A`                          |
| Vendor                                  | Advance Tabco (`remove_protection=0`, `map_as_login=0`) |
| List / Net                              | 910.00 / 350.35                                         |
| Cost                                    | 304.80                                                  |
| Manual MAP (`product_calculations.map`) | **409.50**                                              |
| Lift Gate / Free Shipping / Freight     | No / No / 0                                             |
| NetSuite status                         | Available (not Discontinued)                            |

Current (correct) bridge prices — **MAP = 409.50 everywhere, and it is higher than Login**:

| Store   | MAP        | Login  | Call   |
| ------- | ---------- | ------ | ------ |
| IMP (3) | **409.50** | 316.23 | 316.23 |
| KRS (4) | **409.50** | 354.18 | 354.18 |
| RST (5) | **409.50** | 363.66 | 355.76 |

---

## Steps to reproduce

1. Open **Calculation → Pricing Table**, set the search mode to **SKU (Model)** and enter `1014A-10A`
   (or mode **ID** → `94`).
2. Record the current MAP / Login / Call values for IMP, KRS, RST (see table above:
   MAP = 409.50 on all bridges).
3. On the server, run the recalculation for the product:
    ```
    php artisan calculator:calculate --productId=94
    ```
4. Refresh the grid (or re-query the prices via SQL — see snippet below).
5. Compare the new MAP values with step 2.

**Verification SQL** (run before step 3 and after step 4, compare `map_price`):

```sql
SELECT b.bridge_id,
       CASE b.bridge_id WHEN 3 THEN 'IMP' WHEN 4 THEN 'KRS' WHEN 5 THEN 'RST' END AS store,
       pc.map AS manual_map,
       b.map_price, b.login_price, b.call_price,
       CASE WHEN ABS(b.map_price - pc.map)        < 0.01 THEN 'OK (manual MAP kept)'
            WHEN ABS(b.map_price - b.login_price) < 0.01 THEN 'BUG (collapsed to Login)'
            ELSE 'other' END AS verdict
FROM product_bridge_calculations b
JOIN product_calculations pc ON pc.product_id = b.product_id
WHERE b.product_id = 94
ORDER BY b.bridge_id;
```

Before recalc → all rows `OK (manual MAP kept)`; after recalc on the buggy build → all rows `BUG (collapsed to Login)`.

---

## Expected result (correct behavior)

MAP does not change and stays equal to the manual MAP, because it is higher than Login:

| Store | MAP (expected) | Login  |
| ----- | -------------- | ------ |
| IMP   | **409.50**     | 316.23 |
| KRS   | **409.50**     | 354.18 |
| RST   | **409.50**     | 363.66 |

Login and Call are unchanged.

## Actual result (bug)

MAP collapses to Login on every bridge (the manual MAP 409.50 is lost):

| Store | MAP (actual, bug) | = Login?   |
| ----- | ----------------- | ---------- |
| IMP   | **316.23**        | = Login ❌ |
| KRS   | **354.18**        | = Login ❌ |
| RST   | **363.66**        | = Login ❌ |

Login and Call are unchanged (confirms the problem is in MAP specifically).

---

## Pass / Fail criteria

- **PASS:** after recalculation MAP = 409.50 on all bridges (manual MAP preserved).
- **FAIL (current state):** after recalculation MAP = Login (316.23 / 354.18 / 363.66).

---

## Notes

- **Masking:** the raw `map = 1` is never stored in the DB — protection (§6) always raises it to Login
  (dev has no vendors with `remove_protection=1`). The visible symptom is the loss of the manual MAP.
- **Side effect:** `calculator:calculate` triggers a NetSuite sync. If NetSuite returns `Discontinued`,
  the product disappears from the grid — in that case use one of the backup products below.

### Backup test products (same preconditions, currently still correct, status Available)

| Product ID | SKU             | Vendor                     | Manual MAP | IMP Login |
| ---------- | --------------- | -------------------------- | ---------- | --------- |
| 97         | `1006_SGCC-36`  | Advance Tabco              | 3008.70    | 2323.46   |
| 15247      | `2004_APR13-26` | American Panel Corporation | 4076.80    | 2727.14   |
| 15637      | `2002_5005246`  | Alto-Shaam                 | 622.40     | 513.48    |
| 16934      | `1034_R3103A`   | Bakers Pride (Middleby)    | 77.00      | 67.00     |

For each: manual MAP > Login on all bridges, so the same FAIL (MAP → Login after recalc) is expected.
Use the verification SQL above with the corresponding `product_id`.

- **Scale (as of 2026-06-18):** of 119,444 products with "manual MAP > Login", 13,402 are already
  collapsed to Login (recalculated with the buggy code), and 99,284 are still correct (not recalculated
  since the 2026-06-16 deploy).
- **Fix (proposed, not applied):** replace the line with
  `$mapPrice = ($netPrice && $listPrice) ? $mapPrice : 0;` (via a flag
  `$isSpecialQuoteItem = !$netPrice && !$listPrice;`). Details — `prices_calc.md` §5.5.
