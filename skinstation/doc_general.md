# SkinStation — Prescription Flow: System Documentation

> Living reference for how the reworked **prescription (POM) journey** is built and behaves.
> Compiled from the scope doc, YouTrack tickets (73, 76, 77, 78, 79, 83,
> `additional_questions.md`), and empirical verification via the `?read=1` app-proxy
> endpoint. Companion to `test_cases.md` (the test suite). Last updated **2026-06-16**.

---

## 1. Purpose & high-level overview

SkinStation sells **POM (Prescription-Only Medicine)** skincare products. A patient may only
see and order these products after completing a **medical questionnaire** that a clinician
reviews. The rework moved the questionnaire to the **start** of the journey, **hid prices**
until a patient has earned access, and made prescription products **visible per-patient**.

Core principles:

- The medical questionnaire (Consultation Form) is shown only to **logged-in** users of the
  prescription service — never to anonymous visitors.
- Prescription **prices are hidden** in the questionnaire, on the PLP, and on the PDP.
- A patient sees POM products only after a clinician has approved them for that patient.
- The single add-to-basket CTA reads **"Request Repeat Prescription"** (never "Add to Cart").
- Post-CTA flows (checkout, portal order submission, clinician approval, e-pharmacy) are
  **unchanged** by this rework.

---

## 2. Architecture

| Component                            | Role                                                                                                                                                                                                |
| :----------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Shopify storefront + theme**       | Renders the Consultation Form, the prescription landing page, the POM PLP/PDP. Reads patient-specific product data from the questionnaire metaobject and shows/hides products & prices accordingly. |
| **Shopify questionnaire metaobject** | The system of record for a patient's questionnaire data on the Shopify side. **One metaobject per customer** (see §4).                                                                              |
| **SkinStation app (app-proxy)**      | Saves form submissions into the metaobject; exposes the read endpoint; runs webhooks (order → photo upload, order → `previously_used_products` update).                                             |
| **Laravel "Portal"**                 | Clinician/prescriber backend. Receives consultation data, stores **per-prescription historical snapshots**, lets prescribers review and process prescriptions.                                      |
| **AWS S3**                           | Stores patient-uploaded photos — but only **after order placement** (see §8).                                                                                                                       |
| **Email (orders@skinstation.co.uk)** | Receives questionnaires that need clinical review; a separate email confirms approved products to the patient.                                                                                      |

### App-proxy read endpoint

```
https://skinstation-2025.myshopify.com/apps/medical/questionnaire?read=1
```

Returns the questionnaire metaobject as JSON. **Keys = internal field names** (not the admin
display labels). This is the ground-truth tool for verifying what was actually saved.

---

## 3. Key pages

| Page                       | Purpose                                                                                                                                                                                                                                                           |
| :------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/pages/prescription-area` | Prescription service landing page. Renders different states ("Page restrictions") and routes the patient: an **existing** patient goes to the PLP with their assigned products + "Edit Medical Questionnaire"; a **new** patient is gated into the questionnaire. |
| `/pages/questionnaire`     | The **Consultation Form** (medical questionnaire) with the conditional logic in §5.                                                                                                                                                                               |
| POM collection page (PLP)  | Lists the patient's approved prescription products (from `prescribed_products` / `recommended_products`). Prices hidden. CTA "Request Repeat Prescription" → basket.                                                                                              |
| PDP                        | Individual prescription product page. Prices hidden.                                                                                                                                                                                                              |

### POM product — how it's identified

A POM product is distinguished primarily by **collection membership**, not by a dedicated
"is POM" flag (no such attribute is documented in the tickets):

- **Prescription/POM collection (the mechanism).** POM products live in the prescription
  collection (e.g. `/collections/obagi-medical-prescription-skincare`). The theme applies the
  POM rules — hidden prices, the "Request Repeat Prescription" CTA, per-patient visibility —
  via this collection's PLP/PDP template, "for all POM products" (ticket 73).
- **Naming convention (de-facto marker).** Their title/handle contain **"Prescription Only" /
  "Rx"** (e.g. `obagi-nu-derm-blender-rx-prescription-only-57g`). This is a convention, not a
  technical visibility attribute.
- **Addressed by SKU.** Throughout the logic a POM product is referenced by **SKU /
  `product_reference`**; the app resolves a selected Shopify product to its SKU to link it to
  the portal (ticket 77). The approved/requested metaobject lists are `list.product_reference`
  over these products.

What follows from being a POM product (and does **not** apply to ordinary products): prices
hidden (§1), CTA renamed, **per-patient visibility** gated by `prescribed_products` /
`recommended_products` (§7.1), access gated behind the questionnaire + clinical review, and
order-time sync to the portal (§7.3).

> **Open question:** whether Shopify Admin also marks POM products with a **tag or metafield
> flag** is not documented — the only mechanism seen is the collection. Verify in admin (see
> §10).

---

## 4. The questionnaire metaobject — one per customer

There is **exactly one questionnaire metaobject per customer** in Shopify. It is
**cumulative / overwritten** on each form save — submitting again does not create a new
record:

- On order placement, the ordered prescription product is appended to
  `previously_used_products` of the customer's questionnaire metaobject; **existing entries
  are preserved and duplicates are not added** (ticket 77).
- The migration script (ticket 78) and the portal sync all reference "the corresponding
  **customer** questionnaire metaobject" — singular.

> **Shopify vs Portal cardinality:** Shopify keeps **one live metaobject per customer**
> (current state). The **Portal** keeps a **historical snapshot per prescription**
> (see §7.4) — these snapshots are derived data, not multiple questionnaires.

---

## 5. The Consultation Form — conditional logic

The form (`/pages/questionnaire`) contains the main medical questionnaire plus **two yes/no
radio buttons** that drive which product sections are shown:

### Radio 1 — `previously_used_products_logic`

"**I am an existing patient, and I am requesting repeat medication**"

- **yes** → shows the **"Previously used products"** block.
- **no** → hides it.

### Radio 2 — `previously_recommended_products_logic`

"**Are you currently using medical skincare treatment for your concern?**"

- **yes** → shows the **"Previously recommended products"** block (POM products as checkboxes).
- **no** → shows the **blue box** instead (a single `consent_to_callback` checkbox).

### The blue box (`consent_to_callback`)

Shown only when Radio 2 = no. Exact copy:

> _"Please can you complete the rest of the medical consultation form to help our clinicians
> make any informed decision in treating your medical concern. We will call you to arrange a
> suitable time for consultation. Please tick here if you're happy for us to call you to
> arrange a consultation."_

### Validation & pre-selection rules (Tim Sebire + Serhii's fix)

- **No checkbox is ever pre-selected.** Every time the form opens, all listed products show
  with checkboxes **unchecked** — including an existing patient's previously prescribed
  products. (Closes ISSUE-1 as "by design".)
- **Radio 2 = yes** → at least **one** product must be selected before the form can be
  submitted (validation).
- **Radio 2 = no** → ticking the **blue box is mandatory**; the form cannot be submitted
  until it is ticked.
- **Open question:** whether **Radio 1 = yes** likewise requires ≥1 "Previously used" product
  is **not** yet confirmed (see §10, ISSUE-6 / G1-TC05).

The "Previously recommended products" block lists **all POM products sold on the site,
excluding** those already shown in the patient's "Previous Prescriptions" section.

---

## 6. The three patient scenarios

|                            | Scenario A                                                                               | Scenario B                                                                                       | Scenario C                                                                           |
| :------------------------- | :--------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------------------- | :----------------------------------------------------------------------------------- |
| **Who**                    | Patient **with** previous prescription orders                                            | Patient **without** history, **with** a selection                                                | Edge case: **no history + no selection**                                             |
| **Radio 1**                | yes (repeat medication)                                                                  | —                                                                                                | no                                                                                   |
| **Radio 2**                | (may also select recommended)                                                            | **yes** → POM checkboxes                                                                         | **no** → blue box                                                                    |
| **Flow**                   | Selects a subset of previously prescribed products → PLP → "Request Repeat Prescription" | Selects "previously recommended" products → saved as **requested** → emailed for clinical review | Completes only the main questionnaire → ticks blue box → emailed for clinical review |
| **Immediate PLP access**   | Yes (already-approved products)                                                          | **No**                                                                                           | **No**                                                                               |
| **Route to (more) access** | Already has it                                                                           | Clinical reviews requested list → adds SKUs                                                      | Clinical calls patient, recommends → adds SKUs                                       |

### Scenario B vs C — how they converged (ticket 83)

Originally Scenario B granted **immediate** PLP access on selection; Scenario C did not
proceed. After ticket 83, a "previously recommended" selection is **no longer auto-shown** on
the PLP — it is emailed to `orders@skinstation` for clinical review. So **both B and C now end
in clinical review with no immediate access**. The remaining differences:

- B hands the clinical team a **starting list of requested products**; C does not.
- **Email trigger:** B = automatic on submit (products indicated); C = ticking the mandatory
  blue box.
- **Email content:** B = questionnaire + requested product list; C = questionnaire only.

---

## 7. Data flows

### 7.1 Requested vs approved products (the key model)

There are **two distinct product lists** that are easy to confuse:

| Field (key)                      | Admin label                              | Who writes it                              | Meaning                                                                                                                                      |
| :------------------------------- | :--------------------------------------- | :----------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------- |
| `recommended_products_requested` | **"Products requested by the customer"** | The **patient** (on submit)                | The patient's "previously recommended" picks. A **wish/indication list** for the clinical team — **not** approved, **not** shown on the PLP. |
| `recommended_products`           | **"Previously recommended products"**    | The **clinical team** (manually, in admin) | The **approved** subset. Drives which POM products the patient sees on the PLP. Changing it triggers the patient confirmation email.         |

Flow: patient selects products → saved to **`recommended_products_requested`** → questionnaire
emailed for review → clinical team picks a subset → adds it to **`recommended_products`** →
patient now sees those approved products on `/pages/prescription-area` (ticket 83,
`additional_questions.md`).

> **⚠️ Naming collision:** the label **"Previously recommended products"** is used for TWO
> different things — the **form section** (customer selection → `recommended_products_requested`)
> and the **admin field** (clinical approved → `recommended_products`). Display name ≠ internal
> key. Always verify against the metaobject key or `?read=1`.

### 7.2 Email flows

- **Clinical-review email** → `orders@skinstation.co.uk`. Sent on submit when the patient
  indicates products (Scenario B) or ticks the blue box (Scenario C). Contains the
  questionnaire data (+ requested products in B).
- **Patient confirmation email** → sent when the clinical team changes the approved
  `recommended_products` list, telling the patient which items were added. **No duplicate**
  email on re-saves with an unchanged approved set; a new email only when the list changes
  (ticket 83).

### 7.3 Portal ⇄ Shopify sync (tickets 77, 78)

- "Previously used products" selected in the form are saved to the metaobject at **order
  placement** and sent to the portal with the consultation data, where they appear in the
  prescription form and the customer profile (name + SKU).
- **Auto-update on future orders:** placing an order containing a prescription product adds
  that product to `previously_used_products` and sets the logic flag true (dedup preserved),
  then re-syncs to the portal.

### 7.4 Historical snapshots in the portal (ticket 78)

The portal stores a **historical snapshot per prescription**, computed from the Shopify order
`processed_at` date. Opening a specific prescription shows only the products the customer had
from **earlier** prescription orders at the time that prescription was created — so an old
prescription does not display the patient's _current_ product list. A migration script
backfills these snapshots for existing prescriptions.

---

## 8. Photo handling

The questionnaire has **two photo metafields** with different roles:

| Metafield    | Role                                                                                                                                                                                          |
| :----------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`Photo`**  | **Temporary** holder. Written when the patient selects a photo and clicks **Save**. The file stays in Shopify and is **not** yet on S3.                                                       |
| **`Photos`** | **Final** list of relative S3 links. Populated **only at order placement**, when the order webhook uploads the file(s) to AWS S3. The "Previously uploaded photos" section renders from here. |

Flow: select photo + Save → held in `Photo` → place order → webhook uploads to S3 → relative
link written to `Photos` → photo displayed on the form. This deferral avoids pushing files to
S3 for patients who save the form but never order. Consequently `photos: []` is **empty until
an order is placed** — by design (this explains ISSUE-3).

> **Open question:** whether the **face photo** and the **prescription photo** are stored in
> the **same** `Photos` list (the field is an array) or separate fields is **not documented** —
> only one photo mechanism exists in `?read=1`. To be verified empirically (see §10).

---

## 9. Field reference (questionnaire metaobject)

| Field (key)                             | Type                   | Meaning                                                                                                           |
| :-------------------------------------- | :--------------------- | :---------------------------------------------------------------------------------------------------------------- |
| `previously_used_products_logic`        | bool                   | Radio 1 — repeat-medication toggle; shows/hides "Previously used products".                                       |
| `previously_used_products`              | list.product_reference | Products the patient was previously prescribed / wants to repeat. Synced to portal.                               |
| `previously_recommended_products_logic` | bool                   | Radio 2 — "currently using medical skincare" toggle; shows POM checkboxes (yes) or the blue box (no).             |
| `recommended_products_requested`        | list.product_reference | "Products requested by the customer" — patient's selection; for clinical review, **not** approved.                |
| `recommended_products`                  | list.product_reference | Admin "Previously recommended products" — clinical-**approved** list; drives PLP; changing it emails the patient. |
| `previously_recommended_products`       | list.product_reference | ⚠️ **Legacy/unused** — Kenny's original field; not written on submit, absent from `?read=1`.                      |
| `prescribed_products`                   | list.product_reference | Approved prescribed products; drives PLP/PDP visibility.                                                          |
| `consent_to_callback`                   | bool                   | The "blue box" — shown when Radio 2 = no; mandatory; ticking it saves + emails.                                   |
| `photo_last_uploaded_at`                | datetime               | Timestamp of last photo upload.                                                                                   |
| `photos`                                | list                   | Final S3 links to uploaded photos (populated at order placement).                                                 |
| `send_photos` / `upload_photo`          | bool                   | Photo-related flags.                                                                                              |

Plus the main medical questionnaire fields (`skin_type`, `medical_condition`,
`current_medications`, `dob`, `confirm_age`, `consent_to_prescribe`, etc.).

---

## 10. Known issues & open questions

See `test_cases.md` → "Issues found" for full detail. Current status:

| Ref     | Topic                                                      | Status                                                                                   |
| :------ | :--------------------------------------------------------- | :--------------------------------------------------------------------------------------- |
| ISSUE-1 | "Previously recommended" checkboxes not restored on reopen | ✅ By design — nothing is ever pre-selected.                                             |
| ISSUE-2 | "Please go here" link redirects to the same page           | 🛠️ Fixed by dev — needs retest.                                                          |
| ISSUE-3 | "Previously uploaded photos" empty after submit            | ℹ️ By design — S3 upload only at order placement; retest **with an order** (G1-TC17).    |
| ISSUE-4 | Broken images for an existing customer                     | ℹ️ Likely stale S3-migration data; retest with **new** photos.                           |
| ISSUE-5 | Blue box left unticked — what happens?                     | ✅ Resolved — blue box is mandatory (validation); retest (G3-TC04).                      |
| ISSUE-6 | `_logic` = yes but zero products selected                  | 🟡 Partial — Radio 2 branch enforced (G2-TC14); **Radio 1 branch (G1-TC05) still open**. |

**Other open questions**

- Does **Radio 1 = yes** require ≥1 "Previously used" product before submit? (ISSUE-6 / G1-TC05)
- Are **face photo** and **prescription photo** stored in the same `photos` field or separate
  fields? (§8 — not documented; verify via `?read=1` after uploading two photos + ordering.)
- Is a POM product marked by a **tag or metafield flag** in Shopify Admin, or only by
  **collection membership**? (§3 — only the collection mechanism is documented; verify in admin.)
- Exact unticked-blue-box save/email behavior should be reconfirmed against ticket 79 vs 73
  semantics during retest.

---

## 11. Glossary

- **POM** — Prescription-Only Medicine.
- **PLP / PDP** — Product Listing Page / Product Detail Page.
- **Consultation Form / questionnaire** — `/pages/questionnaire`.
- **Blue box** — the `consent_to_callback` consent checkbox shown when Radio 2 = no.
- **Requested** — what the patient asks for (`recommended_products_requested`).
- **Approved** — what the clinician grants (`recommended_products` / `prescribed_products`).
- **Portal** — the Laravel prescriber backend.
- **`?read=1`** — the app-proxy endpoint returning the questionnaire metaobject JSON.
