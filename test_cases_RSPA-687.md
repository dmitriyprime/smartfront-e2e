# Test Cases: RSPA-687 — Collection Dictionary API Endpoint

## What was changed

Before this task, the `category_collection_dictionaries` table (3,916 rows mapping AQ product types → SEO-friendly collection names, e.g. `"Air Curtain"` → `"Air Curtain Refrigerators"`) was only used internally by the product app. The Shopify app had this mapping **hardcoded**, which meant any dictionary update in the product app would silently go out of sync.

**What was built:**
- New route: `POST /api/v1/shopify/collection/dictionaries` (module: `ShopifyCollection`)
- New controller: `Modules/ShopifyCollection/app/Http/Controllers/Api/Dictionaries.php`
- New model: `Modules/ShopifyCollection/app/Models/CollectionDictionaries` → reads `category_collection_dictionaries`

The endpoint accepts an optional JSON query descriptor and returns matching dictionary records. External apps (Shopify) now call this endpoint instead of using hardcoded values.

**Endpoint:**
```
POST https://dev.oners.app/api/v1/shopify/collection/dictionaries
Content-Type: application/json
```

**Response structure (always):**
```json
{ "status": "success", "message": "Ok", "data": [...] }
```
Each item in `data`: `{ "product_type": "...", "collection_title": "..." }`
Results are always sorted alphabetically by `product_type`.

---

## Test Cases

### TC-01 — Empty body returns all records

**Payload:** _(no body / empty)_

**Expected:**
- HTTP 200
- `status: "success"`, `message: "Ok"`
- `data` array contains all 3,916 dictionary entries
- Results sorted A→Z by `product_type`

---

### TC-02 — Empty JSON object returns all records

**Payload:**
```json
{}
```

**Expected:** Same as TC-01 — all 3,916 entries returned.

---

### TC-03 — Empty `queries` node returns all records

**Payload:**
```json
{ "queries": {} }
```

**Expected:** Same as TC-01 — all 3,916 entries returned.

---

### TC-04 — Empty `dictionary` node returns all records

**Payload:**
```json
{ "queries": { "dictionary": {} } }
```

**Expected:** Same as TC-01 — all 3,916 entries returned.

---

### TC-05 — Filter by a single existing `product_type`

**Payload:**
```json
{
  "queries": {
    "dictionary": {
      "filter": {
        "product_type": { "in": ["Air Curtain"] }
      }
    }
  }
}
```

**Expected:**
- HTTP 200
- `data` contains exactly 1 record:
  ```json
  { "product_type": "Air Curtain", "collection_title": "Air Curtain Refrigerators" }
  ```

---

### TC-06 — Filter by multiple existing `product_type` values

**Payload:**
```json
{
  "queries": {
    "dictionary": {
      "filter": {
        "product_type": {
          "in": [
            "Air Diffuser, Parts & Accessories",
            "Air Freshener Dispenser, Parts & Accessories",
            "Chemicals: Sealant",
            "Chemicals: Garbage Disposal Cleaner / Deodorizer",
            "Bowl, Metal, 11 qt (352 oz) and up"
          ]
        }
      }
    }
  }
}
```

**Expected:**
- HTTP 200
- `data` contains exactly 5 records
- Each `product_type` from the filter appears in the response
- Response is sorted by `product_type` (alphabetical), so order is:
  1. `Air Diffuser, Parts & Accessories`
  2. `Air Freshener Dispenser, Parts & Accessories`
  3. `Bowl, Metal, 11 qt (352 oz) and up`
  4. `Chemicals: Garbage Disposal Cleaner / Deodorizer`
  5. `Chemicals: Sealant`

---

### TC-07 — Filter by a `product_type` that does not exist in the dictionary

**Payload:**
```json
{
  "queries": {
    "dictionary": {
      "filter": {
        "product_type": { "in": ["Nonexistent Product Type XYZ"] }
      }
    }
  }
}
```

**Expected:**
- HTTP 200
- `data: []` (empty array)
- `status: "success"`, `message: "Ok"`

---

### TC-08 — Filter with mix of existing and non-existing `product_type` values

**Payload:**
```json
{
  "queries": {
    "dictionary": {
      "filter": {
        "product_type": {
          "in": ["Adapter Bar", "DOES NOT EXIST", "Adaptive Utensils"]
        }
      }
    }
  }
}
```

**Expected:**
- HTTP 200
- `data` contains exactly 2 records: `Adapter Bar` and `Adaptive Utensils`
- The non-existent type is silently ignored (no error)

---

### TC-09 — Limit only

**Payload:**
```json
{ "queries": { "dictionary": { "limit": 5 } } }
```

**Expected:**
- HTTP 200
- `data` contains exactly 5 records
- First 5 entries alphabetically by `product_type` (starting with "Action Station, Countertop")

---

### TC-10 — Offset only

**Payload:**
```json
{ "queries": { "dictionary": { "offset": 5 } } }
```

**Expected:**
- HTTP 200
- `data` contains 3,911 records (3,916 total − 5 skipped)
- First record is the 6th alphabetically (after "Adaptive Utensils")

---

### TC-11 — Limit + offset (pagination)

**Payload:**
```json
{ "queries": { "dictionary": { "limit": 5, "offset": 5 } } }
```

**Expected:**
- HTTP 200
- `data` contains exactly 5 records
- Records are entries 6–10 alphabetically — verify the first item matches the 6th item from TC-09

**Pagination verification:** TC-09 (limit 5, no offset) + TC-11 (limit 5, offset 5) together should cover 10 distinct records with no overlap.

---

### TC-12 — Filter + limit

**Payload:**
```json
{
  "queries": {
    "dictionary": {
      "filter": {
        "product_type": {
          "in": [
            "Air Diffuser, Parts & Accessories",
            "Air Freshener Dispenser, Parts & Accessories",
            "Adapter Bar",
            "Adapter Frame",
            "Adapter Plate"
          ]
        }
      },
      "limit": 3
    }
  }
}
```

**Expected:**
- HTTP 200
- `data` contains exactly 3 records (limit takes effect even when filter matches 5)
- The 3 records are the first 3 alphabetically from the filtered set:
  1. `Adapter Bar`
  2. `Adapter Frame`
  3. `Adapter Plate`

---

### TC-13 — Filter + offset

**Payload:**
```json
{
  "queries": {
    "dictionary": {
      "filter": {
        "product_type": {
          "in": [
            "Adapter Bar",
            "Adapter Frame",
            "Adapter Plate",
            "Adaptive Dinnerware",
            "Adaptive Utensils"
          ]
        }
      },
      "offset": 2
    }
  }
}
```

**Expected:**
- HTTP 200
- `data` contains 3 records (5 matched by filter − 2 skipped by offset)
- First record is `Adapter Plate` (3rd alphabetically in the filtered set)

---

### TC-14 — Filter + limit + offset

**Payload:**
```json
{
  "queries": {
    "dictionary": {
      "filter": {
        "product_type": {
          "in": [
            "Adapter Bar",
            "Adapter Frame",
            "Adapter Plate",
            "Adaptive Dinnerware",
            "Adaptive Utensils"
          ]
        }
      },
      "limit": 2,
      "offset": 1
    }
  }
}
```

**Expected:**
- HTTP 200
- `data` contains exactly 2 records
- Records are entries 2–3 alphabetically from the filtered set:
  1. `Adapter Frame`
  2. `Adapter Plate`

---

### TC-15 — `in` filter with empty array

**Payload:**
```json
{
  "queries": {
    "dictionary": {
      "filter": { "product_type": { "in": [] } }
    }
  }
}
```

**Expected:**
- HTTP 200
- `data` contains all 3,916 records (empty `in` array is treated as no filter — the `if (!empty($productType))` guard lets it fall through to the unfiltered query)

---

### TC-16 — Response structure verification

For any successful request, verify the exact response shape:
- Top-level keys: `status`, `message`, `data` — no extra keys
- `status` value: string `"success"`
- `message` value: string `"Ok"`
- Each item in `data`: exactly two keys — `product_type` (string) and `collection_title` (string)
- No `id`, `created_at`, or other model fields leak into the response (model has `$timestamps = false` and no integer PK)

---

### TC-17 — Malformed JSON body

**Payload:** `{ "queries": { "dictionary": { "filter": `  _(truncated / invalid JSON)_

**Expected:**
- Laravel returns a 400 or 422 error before reaching the controller
- OR: HTTP 200 with `status: "success"`, `data: []` if the payload parser ignores malformed input

> **Note for tester:** Record the actual behaviour — the route has no validation middleware (`[]`) so Laravel's default behaviour applies.

---

## Known issue to verify

In `Dictionaries.php:70`, the catch block writes:
```php
$response['success'] = 'error';  // wrong key — should be 'status'
```
If an exception is thrown, the response will still show `"status": "success"` (the original value) while also containing a `"success": "error"` key. **Verify this does not mask real errors during testing** — if you trigger an error (e.g., DB connection down), check the raw response JSON for both keys.
