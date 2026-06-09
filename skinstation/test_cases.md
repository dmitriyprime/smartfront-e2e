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

| Tag | Meaning |
| :--- | :--- |
| **P1** | Critical — core flow / compliance (price hiding, access gating). Must pass. |
| **P2** | High — important behavior, not release-blocking on its own. |
| **P3** | Medium — secondary / cosmetic / regression confidence. |

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

| Field | Type | Meaning |
| :--- | :--- | :--- |
| `previously_used_products_logic` | bool | "I am an existing patient requesting repeat medication" |
| `previously_used_products` | list.product_reference | Products the patient was previously prescribed / wants to repeat |
| `previously_recommended_products_logic` | bool | "Are you currently using medical skincare treatment for your concern?" |
| `previously_recommended_products` | list.product_reference | Products the patient currently uses / says were recommended (requires clinical review) |
| `consent_to_callback` | bool | The **"blue box"** — patient consents to being called; ticking it triggers the orders@ email and saves the form |
| `prescribed_products` / `recommended_products` | approved lists | Drive which products are shown on the PLP/PDP; recommended SKUs are added here only by the clinical team |

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
Scenario B granted *immediate* PLP access while Scenario C did not proceed at all.
Now a "previously recommended" selection is no longer auto-shown on the PLP — it is
emailed to orders@skinstation for clinical review, which is almost exactly what
Scenario C already did. Both now end in clinical review with **no immediate access**.

| Dimension | Scenario B (no history, **with** selection) | Scenario C (no history, **no** selection) |
| :--- | :--- | :--- |
| Patient selects products | Yes (`previously_recommended_products` populated) | No |
| Blue box (`consent_to_callback`) | Not the trigger | **Required** — must tick to save |
| Email trigger | Automatic on submit (products indicated) | Ticking the blue box |
| Email content | Questionnaire + requested product list | Questionnaire only |
| Immediate PLP access | No | No |
| Route to access | Clinical reviews indicated products → adds SKUs | Clinical calls patient, recommends → adds SKUs |

**Bottom line:** the difference is whether the patient hands the clinical team a
starting list of products, and the email trigger mechanism (automatic on submit vs.
the mandatory blue-box tick). The old "instant PLP access in Scenario B" difference no
longer exists post-ticket-83.

---

## Group 1 — Patient WITH previous prescription product orders (Scenario A)

### G1-TC01 — Previously used products pre-filled from Portal into questionnaire
- **Priority:** P1
- **Preconditions:** Patient account exists and has historical prescription product
  orders in the Portal. Portal–Shopify sync has run. Patient is logged in.
- **Steps:**
  1. Log in as the patient and open the Medical Questionnaire.
  2. Navigate to the **previously used / prescribed products** section.
- **Expected Result:** The section is pre-populated from the patient's Portal history
  (`previously_used_products`), with `previously_used_products_logic = true`. The list
  matches the patient's Portal prescription history.

### G1-TC02 — Patient sees full list of previously prescribed POM products
- **Priority:** P1
- **Preconditions:** As G1-TC01; patient has ≥2 historical prescribed products.
- **Steps:**
  1. Open the questionnaire and view the previously used products section.
- **Expected Result:** All previously prescribed POM products are listed with product
  image and name. No prescription price is shown for any item.

### G1-TC03 — Active selection of a subset carries only selected products to PLP
- **Priority:** P1
- **Preconditions:** Patient has ≥3 previously used products pre-filled.
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
  system should do *next* for a patient who **has prescription history** but selects
  none of their pre-filled products is **not defined** in the scope doc or tickets
  73/77/79/83. Note that ticket 79's edge-case email path fires only when the patient
  has **no previous prescriptions**, so it does not cleanly apply to a Group-1 patient.
  Do not assume routing to the Scenario C path until this is confirmed.

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

---

## Group 2 — Patient WITHOUT previous prescription product orders (Scenario B)

> See **[Scenario B vs Scenario C](#scenario-b-vs-scenario-c--how-they-differ)** above
> for how this group differs from Group 3.

### G2-TC01 — Previously used / prescribed section is empty
- **Priority:** P1
- **Preconditions:** Patient account with NO historical prescription product orders
  in the Portal. Patient logged in.
- **Steps:**
  1. Open the Medical Questionnaire and view the previously used products section.
- **Expected Result:** The previously used products section is empty (not pre-filled),
  because no prescription history exists.

### G2-TC02 — Previously recommended section shows the full POM list
- **Priority:** P1
- **Preconditions:** As G2-TC01.
- **Steps:**
  1. Navigate to the **previously recommended products** section of the questionnaire.
- **Expected Result:** The full list of POM products is displayed (with images/names,
  no prices), available for manual selection.

### G2-TC03 — Patient selection is saved as "requested", not approved
- **Priority:** P1
- **Preconditions:** As G2-TC02.
- **Steps:**
  1. Manually select the products the patient currently uses / was recommended.
  2. Submit the questionnaire.
  3. Inspect the metaobject and the patient's approved `recommended_products`.
- **Expected Result:** The selection is stored in `previously_recommended_products`
  and saved separately as "products requested by the customer" (visible to the
  clinical team). The approved `recommended_products` list is **unchanged**.

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
- **Preconditions:** Clinical team manually updates the patient's recommended products
  in the questionnaire metaobject.
- **Steps:**
  1. After the clinical update, check the patient's email inbox.
- **Expected Result:** The patient receives a confirmation email listing exactly which
  items were added to their recommended list of SKUs.

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

---

## Group 3 — Edge case: no history + no selection (Scenario C)

> See **[Scenario B vs Scenario C](#scenario-b-vs-scenario-c--how-they-differ)** above
> for how this group differs from Group 2.

> **Trigger (ticket 79):** the edge-case path applies when the patient has **no
> previous prescriptions**, indicates **no previously used products**, and indicates
> **no previously recommended products** — i.e. completes only the main part of the
> medical questionnaire.

### G3-TC01 — No history + no selection does NOT proceed to PLP
- **Priority:** P1
- **Preconditions:** Patient with no prescription history. Logged in.
- **Steps:**
  1. Complete the questionnaire WITHOUT selecting any previously used or previously
     recommended products.
  2. Attempt to proceed.
- **Expected Result:** The system does NOT proceed to the PLP. No prescription
  products are shown.

### G3-TC02 — Blue box (consent_to_callback) is displayed when no products are selected
- **Priority:** P1
- **Preconditions:** As G3-TC01, at the point of attempting to submit with no
  selection.
- **Steps:**
  1. Observe the questionnaire submission area.
- **Expected Result:** The **blue box** (the `consent_to_callback` checkbox) is
  displayed, prompting the patient to tick it to save the form and be contacted.

### G3-TC03 — Ticking the blue box saves the form and sends the email
- **Priority:** P1
- **Preconditions:** As G3-TC02.
- **Steps:**
  1. Tick the blue box (`consent_to_callback = true`).
  2. Submit / save.
  3. Check the orders@skinstation.co.uk inbox.
- **Expected Result:** The form is saved successfully and an email is sent to
  orders@skinstation.co.uk.

### G3-TC04 — Form NOT saved when blue box is left unticked
- **Priority:** P2
- **Preconditions:** As G3-TC02.
- **Steps:**
  1. Leave the blue box unticked.
  2. Attempt to submit / save.
- **Expected Result:** The form is not saved and the patient cannot proceed; the UI
  indicates the blue box must be ticked.

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
