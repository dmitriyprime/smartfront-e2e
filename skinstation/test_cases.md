# SkinStation — Patient Prescription Flow: Manual Test Cases

**Sources of truth:** `skinstation_patient_prescription_flow_scope.md` plus the
implemented behavior confirmed in `subtasks_comments/` (YouTrack tickets 73, 76, 77,
78, 79, 83).
**Purpose:** UAT / QA manual test cases for the reworked pre-checkout prescription
journey (questionnaire moved to the start of the flow, prescription products and
pricing hidden, per-patient product visibility).

## How to use this document

- Test cases are grouped into the three scope scenarios:
  1. **Patient WITH previous prescription product orders** (Scenario A)
  2. **Patient WITHOUT previous prescription product orders** (Scenario B)
  3. **Edge case** — no history + no selection (Scenario C)
- Each case is a full-detail block: **Preconditions → Steps → Expected Result**, with
  a Priority.

### Legend

| Tag    | Meaning                                                                     |
| :----- | :-------------------------------------------------------------------------- |
| **P1** | Critical — core flow / compliance (price hiding, access gating). Must pass. |
| **P2** | High — important behavior, not release-blocking on its own.                 |
| **P3** | Medium — secondary / cosmetic / regression confidence.                      |

> **Recommended-products flow — contradiction resolved.** The scope doc originally
> implied that products a patient selects in the "previously recommended" section
> appear immediately on the PLP. Per tickets **73, 79 and 83** this was deliberately
> changed and is now the **final implemented behavior**: those selections are **NOT**
> auto-added to the patient's approved SKUs and do **NOT** open PLP access. They are
> saved separately (as "products requested by the customer"), the questionnaire is
> emailed to **orders@skinstation.co.uk** for clinical review, and only after the
> clinical team manually adds SKUs in Shopify Admin does the patient gain access — at
> which point the patient receives a confirmation email. The old "immediate PLP"
> behavior is obsolete and is not tested here.

### Field / terminology reference (from ticket 73)

Implementation uses these questionnaire metaobject fields; testers should recognise
them when verifying data:

| Field                                          | Type                   | Meaning                                                                                                                                                                                                                                                                                                                                          |
| :--------------------------------------------- | :--------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `previously_used_products_logic`               | bool                   | **Radio 1** — "I am an existing patient, and I am requesting repeat medication". **yes** → shows the "Previously used products" block; **no** → hides it                                                                                                                                                                                         |
| `previously_used_products`                     | list.product_reference | Products the patient was previously prescribed / wants to repeat                                                                                                                                                                                                                                                                                 |
| `previously_recommended_products_logic`        | bool                   | **Radio 2** — "Are you currently using medical skincare treatment for your concern?". **yes** → shows the "Previously recommended products" block (POM checkboxes); **no** → shows the blue box instead                                                                                                                                          |
| `recommended_products_requested`               | list.product_reference | **"Products requested by the customer"** — where the patient's "previously recommended" selection is actually saved (confirmed via `?read=1`). Visible to the clinical team for review; **not** approved SKUs                                                                                                                                    |
| `previously_recommended_products`              | list.product_reference | ⚠️ **Legacy / unused** — Kenny's original field. Not written on submit and **absent from the `?read=1` payload**; superseded by `recommended_products_requested` after ticket 83 (see ISSUE-1)                                                                                                                                                   |
| `consent_to_callback`                          | bool                   | The **"blue box"** — the single checkbox shown when **Radio 2 = no**. Patient consents to being called; ticking it triggers the orders@ email and saves the form                                                                                                                                                                                 |
| `prescribed_products` / `recommended_products` | approved lists         | Drive which products are shown on the PLP/PDP; recommended SKUs are added to `recommended_products` only by the clinical team. **`recommended_products` is shown in Shopify Admin as "Previously recommended products"** (confirmed via `?read=1`: `[]` → approved set after clinical edit). Changing it triggers the patient confirmation email |

> **⚠️ Naming collision — "Previously recommended products":** the same label is used for
> **two different fields**. On the **form** (frontend) the section "Previously recommended
> products" is where the _customer_ selects → saved to `recommended_products_requested`.
> In **Shopify Admin** the field labelled "Previously recommended products" is the
> _approved_ list with key `recommended_products`, which the _clinical team_ edits and
> which drives the PLP. They are not the same field — display name ≠ internal key.

> **Conditional form logic:** the two `_logic` radios drive block visibility on the
> Consultation Form. Radio 1 toggles the "Previously used products" block; Radio 2
> toggles between the "Previously recommended products" block (when **yes**) and the
> single `consent_to_callback` blue box (when **no**). See G2-TC12 / G2-TC13.

### Global rules these cases enforce

- Single add CTA must read **"Request Repeat Prescription"** (never "Add to Cart").
- Prescription **prices are hidden** in the questionnaire, on the PLP, and on the PDP.
- Post-CTA flows are **unchanged**: checkout, Portal order submission, clinician
  approval, and E-pharmacy.
- Prescription products/pricing are not exposed to users who have not earned access
  via the questionnaire flow.
- The questionnaire is shown only to **logged-in** users using the prescription
  service — never to all site visitors (ticket 73).

### Scenario B vs Scenario C — how they differ

These two groups **converged after ticket 83**. Originally a product selection in
Scenario B granted _immediate_ PLP access while Scenario C did not proceed at all.
Now a "previously recommended" selection is no longer auto-shown on the PLP — it is
emailed to orders@skinstation for clinical review, which is almost exactly what
Scenario C already did. Both now end in clinical review with **no immediate access**.

| Dimension                                     | Scenario B (no history, **with** selection)      | Scenario C (no history, **no** selection)      |
| :-------------------------------------------- | :----------------------------------------------- | :--------------------------------------------- |
| Radio 2 ("currently using medical skincare?") | **Yes** → POM checkboxes shown                   | **No** → blue box shown                        |
| Patient selects products                      | Yes (`recommended_products_requested` populated) | No                                             |
| Blue box (`consent_to_callback`)              | Not the trigger                                  | **Required** — must tick to save               |
| Email trigger                                 | Automatic on submit (products indicated)         | Ticking the blue box                           |
| Email content                                 | Questionnaire + requested product list           | Questionnaire only                             |
| Immediate PLP access                          | No                                               | No                                             |
| Route to access                               | Clinical reviews indicated products → adds SKUs  | Clinical calls patient, recommends → adds SKUs |

**Bottom line:** the difference is whether the patient hands the clinical team a
starting list of products, and the email trigger mechanism (automatic on submit vs.
the mandatory blue-box tick). The old "instant PLP access in Scenario B" difference no
longer exists post-ticket-83.

---

## Group 1 — Patient WITH previous prescription product orders (Scenario A)

### G1-TC01 — Previously prescribed products are listed (but NOT pre-selected) in the questionnaire

- **Priority:** P1
- **Preconditions:** Patient account exists and has historical prescription product
  orders in the Portal. Portal–Shopify sync has run. Patient is logged in.
- **Steps:**
  1. Log in as the patient and open the Medical Questionnaire.
  2. Navigate to the **Previous Prescriptions** section.
- **Expected Result:** The section **lists** the patient's previously prescribed products
  (from `previously_used_products` / Portal history). Per Tim Sebire's decision, **none of
  the products are pre-selected** — every checkbox starts **unchecked** on each visit. The
  list shown matches the patient's Portal prescription history.

### G1-TC02 — Patient sees full list of previously prescribed POM products

- **Priority:** P1
- **Preconditions:** As G1-TC01; patient has ≥2 historical prescribed products.
- **Steps:**
  1. Open the questionnaire and view the previously used products section.
- **Expected Result:** All previously prescribed POM products are listed with product
  image and name, all checkboxes **unchecked**. No prescription price is shown for any
  item.

### G1-TC03 — Active selection of a subset carries only selected products to PLP

- **Priority:** P1
- **Preconditions:** Patient has ≥3 previously prescribed products listed (unchecked).
- **Steps:**
  1. In the previously used products section, select a subset (e.g. 2 of 3).
  2. Submit the questionnaire / proceed.
  3. Observe the PLP.
- **Expected Result:** Only the actively selected products are passed forward and
  shown on the PLP. Unselected products do not appear.

### G1-TC04 — Select ALL previously used products

- **Priority:** P2
- **Preconditions:** Patient has multiple previously used products pre-filled.
- **Steps:**
  1. Select every product in the previously used products section.
  2. Submit and proceed to the PLP.
- **Expected Result:** All selected products appear on the PLP.

### G1-TC05 — Select NONE of the previously used products

- **Priority:** P1
- **Preconditions:** Patient has previously used products pre-filled.
- **Steps:**
  1. Deselect/leave unselected all previously used products.
  2. Also make no previously-recommended selection.
  3. Attempt to submit / proceed.
- **Expected Result:** With zero products selected there is nothing to carry forward,
  so the PLP cannot be populated from this selection.
  **⚠️ Open question — needs client clarification (Tim Sebire / Jess Lewis):** What the
  system should do _next_ for a patient who **has prescription history** but selects
  none of their pre-filled products is **not defined** in the scope doc or tickets
  73/77/79/83. Note that ticket 79's edge-case email path fires only when the patient
  has **no previous prescriptions**, so it does not cleanly apply to a Group-1 patient.
  Do not assume routing to the Scenario C path until this is confirmed.
  **Update:** the Radio 2 = yes branch now enforces ≥1 product (see G2-TC14), but this
  Radio 1 / Previous Prescriptions branch was **not** addressed by that fix — still open
  (see ISSUE-6).

### G1-TC06 — Prices hidden in the questionnaire

- **Priority:** P1
- **Preconditions:** Patient with previously used products in the questionnaire.
- **Steps:**
  1. Inspect each product entry in the questionnaire (used and recommended sections).
- **Expected Result:** No price is displayed for any prescription product anywhere in
  the questionnaire.

### G1-TC07 — Prices hidden on the PLP

- **Priority:** P1
- **Preconditions:** Patient has reached the PLP with selected prescription products.
- **Steps:**
  1. View the prescription PLP.
- **Expected Result:** No prescription product price is shown on the listing page.

### G1-TC08 — Prices hidden on the PDP

- **Priority:** P1
- **Preconditions:** Patient has reached a prescription PDP.
- **Steps:**
  1. Open a prescription product's detail page.
- **Expected Result:** No price is shown on the PDP.

### G1-TC09 — CTA label reads "Request Repeat Prescription"

- **Priority:** P1
- **Preconditions:** Patient on the PLP/PDP with selectable prescription products.
- **Steps:**
  1. Locate the add-to-basket call to action on PLP and PDP.
- **Expected Result:** The single CTA reads **"Request Repeat Prescription"** — never
  "Add to Cart" / "Add to Basket". The CTA leads to the cart/basket flow.

### G1-TC10 — PLP confirmation via the "Request Repeat Prescription" CTA

- **Priority:** P1
- **Preconditions:** Patient on the PLP with previously selected products.
- **Steps:**
  1. On the PLP, click the **"Request Repeat Prescription"** CTA for the selected
     products to add them to the basket (prescription request).
- **Expected Result:** The patient confirms the products a second time by clicking
  **"Request Repeat Prescription"** on the PLP, which adds them to the basket. This is
  the second confirmation step after the initial selection in the questionnaire; the
  basket reflects exactly the products confirmed.

### G1-TC11 — Edit Medical Questionnaire from the prescription listing page

- **Priority:** P2
- **Preconditions:** Existing patient who has already submitted a questionnaire and
  reached the PLP.
- **Steps:**
  1. Use the **Edit Medical Questionnaire** CTA from the prescription listing page.
  2. Confirm existing answers and selections are retained for editing.
- **Expected Result:** The questionnaire reopens pre-populated with the patient's
  existing answers and product selections, ready to update.

### G1-TC12 — Extending selection via the "previously recommended" section → clinical email flow

- **Priority:** P1
- **Preconditions:** Patient editing the questionnaire (G1-TC11).
- **Steps:**
  1. In the **previously recommended** section, add one or more POM products.
  2. Re-submit the questionnaire.
  3. Observe the PLP, the patient profile / approved SKUs, and the
     orders@skinstation.co.uk inbox.
- **Expected Result:** The newly selected recommended products are **NOT** shown on
  the PLP and are **NOT** added to the patient's approved `recommended_products`.
  They are saved separately as "products requested by the customer", and the full
  medical questionnaire is emailed to **orders@skinstation.co.uk** for clinical
  review.

### G1-TC13 — Placing a prescription order auto-updates previously_used_products (ticket 77)

- **Priority:** P2
- **Preconditions:** Patient completes checkout for a prescription product.
- **Steps:**
  1. Place an order containing a prescription product via "Request Repeat
     Prescription".
  2. Inspect the questionnaire metaobject `previously_used_products` and the Portal
     consultation data.
- **Expected Result:** The purchased product is added to `previously_used_products`
  (with the logic field set to true), existing products are preserved, and no
  duplicate entry is created. The updated list syncs to the Portal. If no prescription
  products were selected, the Portal receives an empty list.

### G1-TC14 — Post-CTA checkout / Portal / clinician flow unchanged (regression)

- **Priority:** P2
- **Preconditions:** Patient has a prescription request in the basket.
- **Steps:**
  1. Proceed through checkout after "Request Repeat Prescription".
  2. Confirm the order reaches the Portal and enters the clinician approval flow.
- **Expected Result:** Checkout, Portal order submission, clinician approval, and
  E-pharmacy flows behave exactly as before the change (no regression).

### G1-TC15 — Historical migration populates previously_used_products correctly (ticket 78)

- **Priority:** P2
- **Preconditions:** Existing (pre-go-live) patient whose history was migrated by the
  migration script.
- **Steps:**
  1. Log in as the migrated patient and open the questionnaire.
  2. In the Portal, open the customer profile and an individual past prescription.
- **Expected Result:** `previously_used_products` is populated from migrated Portal
  history and matches the patient's actual records. In the Portal, the **customer
  profile shows the full current list**, while each individual prescription shows only
  the products the customer had at that prescription's `processed_at` date (historical
  snapshot, per ticket 78 option 3) — e.g. the first prescription shows an empty
  previously-used list.

### G1-TC16 — Existing patient routed from landing page to the PLP

- **Priority:** P1
- **Preconditions:** Logged-in **existing** patient (has prescription history /
  completed questionnaire).
- **Steps:**
  1. Navigate to the prescription service landing page (`/pages/prescription-area`).
  2. Observe which state the landing page renders (its "Page restrictions" state) and
     where the patient is routed.
- **Expected Result:** The landing page renders the existing-patient state (ticket 73)
  and routes the patient to the prescription product listing page (PLP) showing their
  assigned products, with the **"Edit Medical Questionnaire"** option available (see
  G1-TC11). The patient is not forced back through the full questionnaire first.

### G1-TC17 — Photo upload flow: temporary `Photo` metafield → order → S3 → `Photos`

- **Priority:** P2
- **Preconditions:** Logged-in patient on `pages/questionnaire`. Access to the customer's
  questionnaire data in admin and/or via the `?read=1` app-proxy endpoint.
- **Steps:**
  1. On the form, select a photo and click **Save** (do **not** place an order yet).
  2. Inspect the questionnaire data in admin / via `?read=1`.
  3. Place a prescription order so the order webhook fires.
  4. Re-inspect the questionnaire data and reopen the form.
- **Expected Result:**
  - After save (before any order): the photo is held in the temporary **`Photo`**
    metafield, and the **`Photos`** metafield is still **empty** — the file is **not** yet
    uploaded to AWS S3 (by design — S3 uploads are deferred so forms saved without an order
    do not push files to S3; Serhii).
  - After order placement: the webhook uploads the file to **AWS S3**, a **relative link**
    is written to **`Photos`**, and the photo is then **displayed** in the "Previously
    uploaded photos" section on the form.
  - This is the positive **retest path for [ISSUE-3](#issue-3--previously-uploaded-photos-section-does-not-display-the-customers-uploaded-photos-after-submit)**.

### G1-TC18 — "Previously recommended" block excludes already-prescribed products

- **Priority:** P1
- **Preconditions:** Existing patient with **≥1** product listed in **Previous
  Prescriptions**. On the questionnaire, **Radio 2** ("Are you currently using medical
  skincare treatment for your concern?") = **yes**, so the "Previously recommended
  products" block is shown.
- **Steps:**
  1. Open the questionnaire and note the products listed in the **Previous Prescriptions**
     section.
  2. View the **Previously recommended products** (POM) checkboxes.
  3. Compare the two lists.
- **Expected Result:** The "Previously recommended products" block shows all POM products
  sold on the site **excluding** those already listed in **Previous Prescriptions** — i.e.
  **no product appears in both sections** (Tim Sebire's rule, verified here on a patient who
  actually has prescription history). None of the checkboxes are pre-selected (see
  G1-TC01). This complements G2-TC02, which checks the same rule for a patient without
  history.

---

## Group 2 — Patient WITHOUT previous prescription product orders (Scenario B)

> See **[Scenario B vs Scenario C](#scenario-b-vs-scenario-c--how-they-differ)** above
> for how this group differs from Group 3.

### G2-TC01 — New patient gated into the questionnaire; previously used section is empty

- **Priority:** P1
- **Preconditions:** Patient account with NO historical prescription product orders
  in the Portal and no completed questionnaire. Patient logged in.
- **Steps:**
  1. Navigate to the prescription service landing page (`/pages/prescription-area`).
  2. Confirm the new patient is prompted to complete the Medical Questionnaire **first**
     (not redirected straight to the PLP — contrast with the existing-patient routing
     in G1-TC16).
  3. Open the Medical Questionnaire and check the **Radio 1** question ("I am an
     existing patient, and I am requesting repeat medication"). Toggle it yes/no.
- **Expected Result:** The landing page routes the new patient to the questionnaire
  before any product page. The "Previously used products" block is governed by Radio 1:
  a genuine new patient answers **no** → the block is **hidden**; if they answer
  **yes** → the block is shown but **empty** (not pre-filled), because no prescription
  history exists. See G2-TC12 for the full toggle behavior.
- **Note:** ❌ Defect found — see [ISSUE-2](#issue-2--please-go-here-link-redirects-to-the-same-page)
  in _Issues found_.

### G2-TC02 — Previously recommended section shows the full POM list

- **Priority:** P1
- **Preconditions:** As G2-TC01.
- **Steps:**
  1. Answer **Radio 2** ("Are you currently using medical skincare treatment for your
     concern?") = **yes** to reveal the "Previously recommended products" block.
  2. View the **previously recommended products** section of the questionnaire.
- **Expected Result:** **All** the prescription (POM) products sold on the site are
  displayed as checkboxes (with images/names, no prices), **excluding** those already
  shown in the Previous Prescriptions section (Tim Sebire). **None are pre-selected** —
  every checkbox starts unchecked. (If Radio 2 = **no**, this block is not shown — the
  blue box appears instead; see G2-TC13 / Group 3.)

### G2-TC03 — Patient selection is saved as "requested", not approved

- **Priority:** P1
- **Preconditions:** As G2-TC02.
- **Steps:**
  1. Manually select the products the patient currently uses / was recommended.
  2. Submit the questionnaire.
  3. Inspect `recommended_products_requested` ("Products requested by the customer"),
     `previously_recommended_products`, and the patient's approved `recommended_products`
     (e.g. via the `?read=1` endpoint).
- **Expected Result:** The selection is saved into **`recommended_products_requested`**
  ("Products requested by the customer", visible to the clinical team), per ticket 83.
  The approved `recommended_products` list is **unchanged** (no auto-approval). Note:
  `previously_recommended_products` (Kenny's original field) is **not** populated — it is
  absent from the `?read=1` payload; the data lives only in
  `recommended_products_requested` (see ISSUE-1).

### G2-TC04 — Selected recommended products are NOT shown on the PLP

- **Priority:** P1
- **Preconditions:** Patient submitted a previously-recommended selection (G2-TC03).
- **Steps:**
  1. After submission, observe the PLP / prescription area.
- **Expected Result:** None of the selected recommended products appear on the PLP;
  the patient does not automatically gain product access from this selection.

### G2-TC05 — Questionnaire emailed to orders@skinstation.co.uk for clinical review

- **Priority:** P1
- **Preconditions:** Patient submitted a previously-recommended selection.
- **Steps:**
  1. Submit the questionnaire with recommended products selected.
  2. Check the orders@skinstation.co.uk inbox.
- **Expected Result:** An email is sent to orders@skinstation.co.uk containing the
  medical questionnaire data and the list of products the patient selected.

### G2-TC06 — Profile NOT auto-updated; clinical team adds SKUs manually

- **Priority:** P1
- **Preconditions:** As G2-TC05, before clinical action.
- **Steps:**
  1. Inspect the patient's approved recommended SKUs / product access after
     submission.
- **Expected Result:** The patient's profile is NOT updated with the recommended SKUs
  automatically. Access is granted only after the clinical team manually adds the SKUs
  to `recommended_products` in Shopify Admin.

### G2-TC07 — Patient receives confirmation email when recommended list changes

- **Priority:** P2
- **Preconditions:** Clinical team manually adds approved SKUs into the
  **`recommended_products`** field (shown in Shopify Admin as **"Previously recommended
  products"**) of the patient's questionnaire metaobject. The approved set may be a
  **subset** of what the customer requested (e.g. 2 of the 4 in
  `recommended_products_requested`).
- **Steps:**
  1. After the clinical update, check the patient's email inbox.
  2. (Optional, to verify the field) re-run `?read=1` and confirm `recommended_products`
     went from `[]` to the approved set.
- **Expected Result:** Changing `recommended_products` triggers the confirmation email to
  the patient, listing exactly which items were added to their recommended list of SKUs.
  Note: the email is driven by `recommended_products` (approved), **not** by
  `recommended_products_requested` (the customer's request, which the clinical team does
  not edit).

### G2-TC08 — No duplicate confirmation email on unchanged re-saves (ticket 83)

- **Priority:** P2
- **Preconditions:** Patient already received a confirmation email for an approved set
  of recommended products.
- **Steps:**
  1. In Shopify Admin, re-save the questionnaire with the **same** approved set of
     previously-recommended products.
  2. Check the patient's inbox.
  3. Then change the approved set (add/remove a product) and save again.
- **Expected Result:** No email is sent on the unchanged re-save. A new confirmation
  email is sent only when the list of previously recommended products actually
  changes.

### G2-TC09 — Patient gains access after re-running the flow

- **Priority:** P2
- **Preconditions:** Clinical team has added recommended SKUs to the patient's
  approved list.
- **Steps:**
  1. Patient logs back in and re-enters the prescription service / re-runs the flow.
  2. Observe the PLP.
- **Expected Result:** The patient can now access the products the clinical team added
  to the approved recommended list.

### G2-TC10 — Prices hidden in questionnaire / PLP / PDP

- **Priority:** P1
- **Preconditions:** Patient progressing through the Scenario B flow.
- **Steps:**
  1. Inspect product entries in the questionnaire, on the PLP, and on the PDP.
- **Expected Result:** No prescription price is displayed anywhere across these three
  surfaces.

### G2-TC11 — CTA label reads "Request Repeat Prescription"

- **Priority:** P1
- **Preconditions:** Patient (Scenario B) reaches a PLP/PDP with selectable products
  (after clinical approval).
- **Steps:**
  1. Locate the add CTA.
- **Expected Result:** The CTA reads **"Request Repeat Prescription"**, not "Add to
  Cart".

### G2-TC12 — Radio 1 toggles the "Previously used products" block

- **Priority:** P1
- **Preconditions:** Patient on the Consultation Form (`pages/questionnaire`).
- **Steps:**
  1. Set **Radio 1** ("I am an existing patient, and I am requesting repeat
     medication") to **yes**.
  2. Set Radio 1 to **no**.
- **Expected Result:** With Radio 1 = **yes**, the "Previously used products" block is
  shown (empty for a new patient; for an existing patient it **lists** their prescribed
  products, all checkboxes **unchecked** — see G1-TC01). With Radio 1 = **no**, the block
  is **hidden**. The toggle updates `previously_used_products_logic` accordingly.

### G2-TC13 — Radio 2 toggles the "Previously recommended products" block vs the blue box

- **Priority:** P1
- **Preconditions:** Patient on the Consultation Form (`pages/questionnaire`).
- **Steps:**
  1. Set **Radio 2** ("Are you currently using medical skincare treatment for your
     concern?") to **yes**.
  2. Set Radio 2 to **no**.
- **Expected Result:**
  - Radio 2 = **yes** → the "Previously recommended products" block is shown with the
    full POM list as **checkboxes** the patient can select.
  - Radio 2 = **no** → that block is hidden and a single checkbox (the **blue box**,
    `consent_to_callback`) is shown instead, with the copy: _"Please can you complete
    the rest of the medical consultation form to help our clinicians make any informed
    decision in treating your medical concern. We will call you to arrange a suitable
    time for consultation. Please tick here if you're happy for us to call you to
    arrange a consultation."_ The toggle updates `previously_recommended_products_logic`
    accordingly. For the save + email behavior of the blue box, see Group 3.

### G2-TC14 — Radio 2 = yes requires at least one product before submit (validation)

- **Priority:** P1
- **Preconditions:** Patient on the Consultation Form with **Radio 2** ("Are you
  currently using medical skincare treatment for your concern?") = **yes**, so the
  "Previously recommended products" checkboxes are shown.
- **Steps:**
  1. Leave **all** "Previously recommended products" checkboxes unchecked.
  2. Attempt to submit the form.
- **Expected Result:** The form **cannot be submitted** — frontend validation requires
  **at least one** visible product to be selected in the "Previously recommended
  products" section when Radio 2 = yes (confirmed behavior, Tim Sebire + Serhii's fix).
  (Pairs with G3-TC04, which covers the mandatory blue box on the Radio 2 = no branch;
  see ISSUE-6.)

---

## Group 3 — Edge case: no history + no selection (Scenario C)

> See **[Scenario B vs Scenario C](#scenario-b-vs-scenario-c--how-they-differ)** above
> for how this group differs from Group 2.

> **Trigger (ticket 79):** the edge-case path applies when the patient has **no
> previous prescriptions**, indicates **no previously used products** (Radio 1 = no),
> and indicates **no previously recommended products** (Radio 2 = no). On the form,
> answering **Radio 2 = no** is what reveals the blue box (`consent_to_callback`)
> instead of the POM checkboxes — that is the concrete entry into this edge case.

### G3-TC01 — No history + no selection does NOT proceed to PLP

- **Priority:** P1
- **Preconditions:** Patient with no prescription history. Logged in.
- **Steps:**
  1. Complete the questionnaire with **Radio 1 = no** and **Radio 2 = no** (no
     previously used or previously recommended products indicated).
  2. Attempt to proceed.
- **Expected Result:** The system does NOT proceed to the PLP. No prescription
  products are shown.

### G3-TC02 — Blue box (consent_to_callback) is displayed when Radio 2 = no

- **Priority:** P1
- **Preconditions:** Patient on the Consultation Form, with **Radio 2** ("Are you
  currently using medical skincare treatment for your concern?") set to **no**.
- **Steps:**
  1. Observe the area where the "Previously recommended products" block would appear.
- **Expected Result:** The "Previously recommended products" block is hidden and the
  **blue box** (the `consent_to_callback` checkbox) is displayed instead, with the
  copy: _"Please can you complete the rest of the medical consultation form to help our
  clinicians make any informed decision in treating your medical concern. We will call
  you to arrange a suitable time for consultation. Please tick here if you're happy for
  us to call you to arrange a consultation."_ The patient must tick it to save the form
  and be contacted.

### G3-TC03 — Ticking the blue box saves the form and sends the email

- **Priority:** P1
- **Preconditions:** As G3-TC02.
- **Steps:**
  1. Tick the blue box (`consent_to_callback = true`).
  2. Submit / save.
  3. Check the orders@skinstation.co.uk inbox.
- **Expected Result:** The form is saved successfully and an email is sent to
  orders@skinstation.co.uk.

### G3-TC04 — Blue box is mandatory; form cannot be submitted while unticked

- **Priority:** P2
- **Preconditions:** As G3-TC02 (blue box is shown because Radio 2 = no).
- **Steps:**
  1. Leave the blue box (`consent_to_callback`) unticked.
  2. Attempt to submit / save.
- **Expected Result:** The form **cannot be submitted** — frontend validation blocks
  submission until the blue box is ticked (confirmed behavior, Tim Sebire + Serhii's fix).
  When the blue box is shown to the patient, ticking it is **mandatory**. (Resolves the
  former open question — outcome (a).)

### G3-TC05 — Email contains full medical questionnaire data

- **Priority:** P1
- **Preconditions:** Patient ticked the blue box and saved the form (G3-TC03); email
  received.
- **Steps:**
  1. Open the email sent to orders@skinstation.co.uk.
- **Expected Result:** The email contains the complete medical questionnaire data the
  patient provided, so the clinical team can verify the submission and contact the
  patient.

### G3-TC06 — Clinical-review loop grants access after re-completion

- **Priority:** P2
- **Preconditions:** Clinical team has reviewed the saved form, contacted the patient
  with recommendations, and manually added the approved SKUs in Shopify.
- **Steps:**
  1. Patient logs back in later and re-runs the flow.
  2. Observe the prescription area / PLP.
- **Expected Result:** The patient can now access the products the clinical team added
  to the approved recommended list. (Note: per the resolved flow, access comes from
  the clinical team's manual SKU addition, not from the patient's own selection.)

### G3-TC07 — No prescription products/pricing exposed at any point

- **Priority:** P1
- **Preconditions:** Edge-case patient throughout the no-history + no-selection flow.
- **Steps:**
  1. Traverse the entire flow before clinical approval.
- **Expected Result:** At no point are prescription products or prices exposed to this
  patient until access is granted via the clinical-review loop.

---

## Issues found

Defects and open questions surfaced during testing. Severity: 🔴 high / 🟠 medium /
🟡 low.

### ISSUE-1 — "Previously recommended" checkboxes are not restored on reopening the questionnaire

- **Status:** ✅ **Resolved — not a bug (by design).** Tim Sebire decided that **no
  product on the form should ever be pre-selected**: on every visit, both "Previous
  Prescriptions" and "Previously Recommended" are shown with **all checkboxes unchecked**.
  So "checkboxes not restored on reopen" is the intended behavior. The original Expected
  Result below (that selections should be restored) is therefore **invalid** and the open
  question is moot. Serhii also fixed a separate display glitch with preselected products.
- **Severity:** 🟠 medium
- **Related test case:** G2-TC02 / G2-TC03 / G2-TC13
- **Steps to reproduce:**
  1. As a patient, open the Consultation Form (`pages/questionnaire`) and set **Radio 2**
     ("Are you currently using medical skincare treatment for your concern?") = **yes**.
  2. Tick one or more products in the "Previously recommended products" section.
  3. Save / submit the questionnaire.
  4. Reopen the questionnaire page.
- **Expected Result:** The previously recommended products the patient selected are
  shown as **checked**, reflecting their saved request (`recommended_products_requested`,
  "Products requested by the customer"), so the patient can see / amend their request.
- **Actual Result:** ❌ On reopening, the checkboxes in the "Previously recommended
  products" section are **not checked**, even though the patient saved a selection.
- **Confirmed root cause (proven via two `?read=1` snapshots):** the checkbox
  re-population is bound to the **legacy `previously_recommended_products`** field, which
  is **always empty** (it is not even returned by `?read=1`) — not to
  `recommended_products_requested` (the customer's request) nor `recommended_products`
  (the clinically approved list). Therefore the checkboxes are **never** checked on
  reopen, regardless of the customer's selection or the clinical approval. Evidence:
  - Snapshot A (after customer submit): `recommended_products_requested` = **4 products**,
    `recommended_products` = `[]` → 0 checkboxes checked.
  - Snapshot B (after clinical approved a subset): `recommended_products_requested` = **4**,
    `recommended_products` = **2 products** → still **0 checkboxes checked**.
  - Both meaningful fields are populated yet nothing is checked ⇒ the form reads neither;
    it reads the always-empty legacy field.
    **Fix:** bind the re-population to the correct field (see open question below).
    **⚠️ Open question — product decision (dev/client):** on reopen, should the recommended
    section re-display the patient's own _requested_ selections
    (`recommended_products_requested`), or only the clinically _approved_ list
    (`recommended_products`)? Pick one and bind the checkboxes to it.

### ISSUE-2 — "Please go here" link redirects to the same page

- **Status:** 🛠️ **Fixed by dev — needs retest.** Serhii: the issue was an incorrect link
  and has been fixed (proof: https://drive.google.com/file/d/1q8d6mIvWqcyEKwPMChSuKgRwavrktvGJ/view?usp=sharing).
  Re-run G2-TC01 to verify the link now opens `pages/questionnaire`.
- **Severity:** 🔴 high
- **Related test case:** G2-TC01
- **Steps to reproduce:**
  1. As a new patient (no history, no questionnaire), navigate to the prescription
     service landing page (`/pages/prescription-area`).
  2. Click the **"Please go here"** link.
- **Expected Result:** The patient is taken to the Medical Questionnaire
  (`pages/questionnaire`).
- **Actual Result:** ❌ Clicking the **"Please go here"** link redirects to the same
  page the patient was already on — `pages/prescription-area` — instead of taking them
  to the Medical Questionnaire. (Blocks the new-patient entry into the questionnaire.)

### ISSUE-3 — "Previously uploaded photos" section does not display the customer's uploaded photos after submit

- **Status:** ℹ️ **Likely by design — retest with an order placed.** Serhii: photos are
  uploaded to AWS S3 **only at order placement** (to avoid sending S3 photos for customers
  who save the form without ordering). Flow: select photo + save → temporarily stored in
  the `Photo` metafield → at order placement a webhook uploads it to S3 → a relative link
  is stored in the `Photos` metafield → the photo is then shown on the form. So an empty
  `photos: []` **before** an order is expected. Retest by placing an order and confirming
  the photo then appears (dev proof: https://drive.google.com/file/d/1plYF_rdCsxZkEUcGD8BqRjFsQ1o5YLly/view?usp=sharing).
- **Severity:** 🟠 medium
- **Related test case:** —
- **Steps to reproduce:**
  1. As a patient, open the Medical Questionnaire (`pages/questionnaire`) and upload one
     or more photos.
  2. Save / submit the form.
  3. Reopen the questionnaire and view the **"Previously uploaded photos"** section.
- **Expected Result:** The photos the customer uploaded are displayed in the "Previously
  uploaded photos" section.
- **Actual Result:** ❌ After submitting the form, the "Previously uploaded photos"
  section on the frontend does **not** display the photos the customer uploaded — the
  section is empty / shows no images.
- **Evidence (`?read=1`):** the endpoint returns `"photo_last_uploaded_at":
"2026-06-10T13:44:30Z"` (an upload timestamp **was** recorded) but `"photos": []` is
  **empty** (and `upload_photo: false`, `send_photos: false`). So an upload happened, yet
  the actual files are not present in the read payload.
- **Notes:** The recorded timestamp but empty `photos` array suggests the **files
  themselves are not persisted/returned**, even though the upload event was registered —
  so this leans toward a save/storage issue rather than a pure rendering issue. Confirm
  with the dev where uploaded photos are stored and why `photos` is empty despite
  `photo_last_uploaded_at` being set. Related to ISSUE-4 (broken images).
- **Positive retest case:** [G1-TC17](#g1-tc17--photo-upload-flow-temporary-photo-metafield--order--s3--photos)
  — verify the `Photo` → order → S3 → `Photos` flow end to end.

### ISSUE-4 — "Previously uploaded photos" shows broken images for an existing customer

- **Status:** ℹ️ **Likely stale data — retest with new photos.** Serhii: probably caused
  by a migration between AWS S3 storages; the old data on the dev server was not migrated
  (test-only). The key check is that **newly uploaded** photos save and display correctly
  on the portal and the form page. Retest with fresh uploads rather than legacy data.
- **Severity:** 🟠 medium
- **Related test case:** —
- **Steps to reproduce:**
  1. Log in as an **existing** customer who has previously uploaded photos.
  2. Open the Medical Questionnaire (`pages/questionnaire`).
  3. View the **"Previously uploaded photos"** section.
- **Expected Result:** The customer's previously uploaded photos are displayed correctly.
- **Actual Result:** ❌ The "Previously uploaded photos" section renders **broken image
  placeholders** (images fail to load) instead of the actual photos.
- **Evidence:** screenshot — https://drive.google.com/file/d/1HeknH0DUYX69zgUUb2QnUpZpzOWC181p/view
- **Reproduces with customer:** https://admin.shopify.com/store/skinstation-2025/customers/9790936055923
- **Notes:** Broken-image icons mean the frontend is rendering `<img>` tags with URLs
  that do not resolve (missing/expired/incorrect src), as opposed to ISSUE-3 where the
  section is empty. Check the photo URLs the theme outputs vs. where the files are
  actually stored/served (and whether they require auth / signed URLs). Likely the same
  underlying photo storage/serving problem as ISSUE-3 — worth investigating together.

### ISSUE-5 — Undefined behavior when the blue box is left unticked (open question)

- **Status:** ✅ **Resolved.** Tim Sebire confirmed and Serhii implemented: when the blue
  box is shown (Radio 2 = no), ticking it is **mandatory** — frontend validation prevents
  the form from being submitted until it is ticked (outcome (a)). Captured in **G3-TC04**.
  Needs retest.
- **Severity:** 🟡 low (open question / spec gap)
- **Related test case:** [G3-TC04](#g3-tc04--blue-box-is-mandatory-form-cannot-be-submitted-while-unticked)
- **Summary:** The documentation defines only the positive case (tick blue box → save +
  email: scope doc Scenario C, ticket 73). The **unticked** behavior is undefined and the
  sources conflict: scope doc / ticket 73 imply the blue box gates the save, while ticket
  79 and the `consent_to_callback` semantics (consent to be called → email) suggest it
  only governs consent/email, not the save.
- **Action:** confirm with dev/client whether an unticked blue box (a) blocks the save,
  (b) saves without sending the email, or (c) saves and emails regardless. See G3-TC04.
- **Reply to dev (clarification):** This is **not** the case "the patient indicates they
  had products but selects none". It is about the **blue box** (`consent_to_callback`) in
  Scenario C. The blue box appears when the patient answers **no** to the questions
  (Radio 2 "Are you currently using medical skincare treatment for your concern?" = no,
  and Radio 1 = no) — at that point the product checkboxes are **hidden** and a single
  checkbox (the blue box) is shown instead. The open question is: if the patient **leaves
  the blue box unticked** and presses submit, what happens — (a) the form is not saved,
  (b) it saves without the email, or (c) it saves and sends the email? The docs conflict:
  scope doc / ticket 73 imply the blue box gates the save, while ticket 79 and the
  `consent_to_callback` semantics (consent to be called → email) suggest it only governs
  the consent/email, not the save. Please confirm the intended behavior.

### ISSUE-6 — Undefined behavior when a `_logic` answer is "yes" but zero products are selected (open question)

- **Status:** 🟡 **Partially resolved.** Tim Sebire confirmed and Serhii implemented: when
  **Radio 2 = yes**, selecting **at least one** product in "Previously recommended
  products" is **mandatory** — the form cannot be submitted otherwise (now covered by
  **G2-TC14**, needs retest). The **Radio 1 = yes** branch (existing patient deselects all
  "Previous Prescriptions" — **G1-TC05**) was **not** explicitly addressed by the fix and
  remains open: confirm whether selecting ≥1 previous prescription is likewise mandatory.
- **Severity:** 🟡 low (open question / spec gap)
- **Related test case:** G2-TC14 (Radio 2, resolved) / G1-TC05 (Radio 1, still open)
- **Summary:** A patient can answer **yes** to a radio (so the product block is shown) but
  then select **no products** and submit:
  - **Radio 1 = yes** ("requesting repeat medication") but all pre-filled products
    deselected → this is **G1-TC05** (already flagged open).
  - **Radio 2 = yes** ("currently using medical skincare") but **0** POM products ticked →
    **not covered by any case yet**. The blue box does **not** appear here (it only shows
    when Radio 2 = no), so there is no consent/email path either.
- **Core ambiguity:** ticket 79's edge-case trigger says the patient "does not indicate
  previously used / previously recommended products", but "indicate" is ambiguous — does
  the system key off the **`_logic` flag** (yes ⇒ treated as indicated) or the **actual
  product count** (empty ⇒ treated as not indicated)? The two readings lead to different
  routing (proceed with nothing vs. fall into Scenario C email path vs. block submit).
- **Action:** confirm with dev/client what happens when `_logic = yes` but the product
  selection is empty — does the system look at the flag or the selected products; does it
  route to Scenario C, block submit, or allow an empty submission? Distinct from ISSUE-5
  (which is the Radio 2 = no / blue box path).

---

## Last Changes

**2026-06-15 — Updates after dev/PM feedback** (source:
`subtasks_comments/additional_questions.md`, comments by Serhii Vietrov & Tim Sebire).
Summary of the clarified behavior and the corresponding edits made to this document.

### Clarified behavior (decisions)

- **No pre-selection on the questionnaire form (Tim Sebire).** Every time the patient
  opens `pages/questionnaire`, both sections are shown with **all checkboxes unchecked**:
  - _Previous Prescriptions_ — lists all of the patient's previously prescribed products;
    none pre-selected.
  - _Previously Recommended_ — shows all prescription (POM) products sold on the site,
    **excluding** those already in the Previous Prescriptions section; none pre-selected.
- **Requested vs approved flow (Tim Sebire).** The patient's "previously recommended"
  picks are saved to **"Products requested by the customer"** (`recommended_products_requested`)
  and emailed for review. The admin team picks a subset from that and adds it to the
  **"Previously recommended products"** field (`recommended_products`); those approved
  products are what the patient sees on `pages/prescription-area` to request a repeat
  prescription.
- **Mandatory-selection validation (Tim Sebire + Serhii's fix).**
  - Radio 2 = **yes** ("currently using medical skincare") → at least **one** product in
    "Previously recommended products" must be selected before submit.
  - Radio 2 = **no** → the **blue box** (`consent_to_callback`) checkbox is **mandatory**;
    the form cannot be submitted until it is ticked.

### Test-case edits made

- **G1-TC01 / G1-TC02 / G1-TC03** — reworded "pre-filled/pre-populated" to **"listed but
  not pre-selected"** (checkboxes start unchecked).
- **G2-TC02** — recommended section now described as **all POM products excluding previously
  prescribed**, none pre-selected.
- **G2-TC12 / G2-TC13** — aligned with the "no pre-selection" rule.
- **G2-TC14 (new)** — validation: Radio 2 = yes requires ≥1 product before submit.
- **G3-TC04** — rewritten from an open question to confirmed behavior: blue box is
  **mandatory**; submission blocked while unticked.

### Issue status changes

| Issue   | New status                                                                                                   |
| :------ | :----------------------------------------------------------------------------------------------------------- |
| ISSUE-1 | ✅ Resolved — **not a bug (by design)**; no pre-selection is intended                                        |
| ISSUE-2 | 🛠️ Fixed by dev (incorrect link) — **needs retest** (G2-TC01)                                                |
| ISSUE-3 | ℹ️ Likely **by design** — photos upload to S3 only at order placement; **retest with an order**              |
| ISSUE-4 | ℹ️ Likely **stale data** from S3 migration on dev — **retest with new photos**                               |
| ISSUE-5 | ✅ Resolved — blue box mandatory (frontend validation); **needs retest** (G3-TC04)                           |
| ISSUE-6 | 🟡 Partially resolved — Radio 2 = yes requires ≥1 product (G2-TC14); **Radio 1 branch (G1-TC05) still open** |

### Still open / to confirm

- **G1-TC05 / ISSUE-6 (Radio 1 branch):** is selecting ≥1 product in "Previous
  Prescriptions" mandatory when Radio 1 = yes? Not addressed by the current fix.
- **Retests pending:** ISSUE-2, ISSUE-3 (with order), ISSUE-4 (new photos), ISSUE-5 /
  G3-TC04, G2-TC14.

### 2026-06-16 — Coverage additions

- **Photo vs Photos clarified (Serhii, `additional_questions.md`).** The questionnaire has
  **two** photo metafields: **`Photo`** is a temporary holder written when the patient saves
  the form (file kept in Shopify, **not** yet on S3); **`Photos`** receives a relative S3
  link **only at order placement**, when the order webhook uploads the file to AWS S3. The
  photo shown in "Previously uploaded photos" comes from `Photos`, so it is empty until an
  order is placed (this is the by-design explanation behind ISSUE-3).
- **G1-TC17 (new)** — positive happy-path for the photo flow above (`Photo` → order → S3 →
  `Photos` → displayed); serves as the retest case for ISSUE-3, now cross-linked from it.
- **G1-TC18 (new)** — verifies the "Previously recommended" block **excludes** already-
  prescribed products for an **existing** patient (the Group 1 counterpart to G2-TC02,
  where the exclusion actually has products to act on).


