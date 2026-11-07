  # Invoices: implementation plan

Status: **built 2026-11-06** (uncommitted), with these owner decisions that override the plan below:
- Lifecycle draft → (edit) → finalize → cancel. No item preparer, no cancel requests, no banks list, no collection
  method, no pre-order logic, no extended warranty, no old data import.
- The draft form looks like the quotation form: the header is the quotation's (read-only); payment method (+ cheque /
  bank text), due date, notes and the pricing (lines: price, discount, qty, add/remove; service charge) can change.
  `InvoiceItem` keeps its own price and cost; the detail page shows the quotation's next to them.
- Stock in hand is checked on create, edit and finalize (no pre-order exception); finalize moves inHand → inTransit.
- `INVOICES.CREATE_DIRECT` + `POST /invoices/direct` allow an invoice without a quotation (button hidden otherwise).
- Old number format. The branch code is the `Role.branchCode` of the user who creates (draft number) or finalizes
  (final number); each branch has its own counter (`20261106120000_role_branch_code`). Shared quotation code is
  imported, not moved.
- The PDF is ported but not yet proven to the millimetre (§7 step 5 not done).

Written for an agent that will build the invoice feature in both repos. It brings over the **behaviour** of the old
system's invoices. The **structure, conventions and code** come from this system.

---

## 0. Read first (mandatory)

| What | Where |
|---|---|
| Rules for agents (git is read-only, ask before broad changes, verify) | `GP-ERP-Server/AGENTS.md`, `GP-ERP-Client/AGENTS.md` |
| How a feature is built end to end (model → migration → permissions → schema → service → routes → tests → frontend) | `GP-ERP-Server/ADDING-A-FEATURE.md` |
| The closest existing feature. Copy its patterns: lines, totals, types, per-action permissions, PDF | `GP-ERP-Server/docs/screens/quotations.md`, `src/modules/quotations/`, `GP-ERP-Client/src/pages/Quotations/` |
| Migration rules (ERP-DB is shared and holds real data) | `GP-ERP-Server/docs/migrations.md` |
| Cache triggers, live stock | `GP-ERP-Server/docs/automatic.md` |
| Modules that don't exist yet and must not be faked | `GP-ERP-Server/AGENTS.md` → "Modules not built yet" |

Hard rules that apply throughout:

- **Git is read-only.** Leave every change uncommitted.
- **ERP-DB is shared.**
  - Never run `prisma db push`, `migrate reset` or `db:seed`.
  - Don't run `npm run test:int` without asking.
  - Prove migrations on a throwaway database. `npx prisma dev` gives one; see how the quotation migrations were checked.
- **Build with Node 24:** `export PATH="/c/Users/madha/AppData/Local/Author Software/nvm/installs/v24.22.1:$PATH"`. The
  default Node 16 breaks the build.
- **No hard-coded business data or conditions.** The owner wants this rebuild to get rid of them. That includes:
  - category names in `if`s
  - bank lists
  - branch codes
  - fixed VAT percentages

  Such values become settings or data. Anything already hard-coded that you must copy for the PDF goes in one
  clearly named constant, and you list it in your report.
- **Ask before** you:
  - add a dependency
  - change infrastructure
  - change the quotation module beyond what §6.3 lists

---

## 1. Scope

**In scope**

1. Tables `Invoice` and `InvoiceItem`, the invoice-number counter, and the migration.
2. Creating an invoice **from a confirmed quotation**. This replaces today's placeholder Create invoice button.
3. The draft → finalize flow, including the warehouse step (item preparer).
4. Stock movements on finalize and on cancel.
5. Cancellation: a cancel request with a reason, then a cancel or a decline by someone with permission.
6. Screens:
   - invoice list
   - draft list
   - invoice detail with actions
   - create/edit-draft form
7. The printed **tax invoice PDF**. It must match the old one to the millimetre (verification method in §7).
8. Permissions, docs and tests.

**Out of scope.** Note each one where it hooks in, and don't build it.

- **Serial numbers** on invoice lines, and the serial-number page of the PDF. The Serial numbers module isn't built
  (§8).
- **Delivery notes.** The old system created one on finalize, and a "Delivered" note changed how a cancel restored
  stock.
- **Status updates on other documents.** Troubleshoot and repair statuses changed on finalize in the old system; those
  modules aren't built.
- **Other old screens and integrations:**
  - credit notes
  - payment receipts
  - bulk PDF download
  - the zero-value ("100 % discount") invoice list
  - WhatsApp sending
- **Moving old invoice data from MongoDB** into this system (§9, Q11).
- **The pro-forma invoice PDF** that the old system printed from a quotation (`GPPFI-…`). This is a quotation feature;
  plan it separately.

---

## 2. Where the old system is

Old frontend: `C:\Users\madha\Documents\Development-22-10-2026\GP-System-Client`. Old backend (Express + MongoDB):
`C:\Users\madha\Documents\Development-22-10-2026\Gunda-Power-System-Backend`.

| What | File |
|---|---|
| Data model, draft and final numbering, stock on save | `Gunda-Power-System-Backend/src/models/invoice.js` |
| API: create (one invoice per quotation), list/search, get, cancel request / reverse, cancel (stock reversal), item preparer, finalize | `Gunda-Power-System-Backend/src/routers/invoice.js` |
| Number parts (`YY`, month name, branch) and timezone (`Asia/Colombo`) | `Gunda-Power-System-Backend/src/utils.js` (`generateInvoiceNumberData`, `INVOICE_TIMEZONE`) |
| Monthly counter reset (cron) | `Gunda-Power-System-Backend/src/cron-jobs/invoice-counter-reset.js` |
| Who may cancel (`admin` + `canCancelInvoice`) | `Gunda-Power-System-Backend/src/middleware/auth.js` |
| "Create Invoice" on a confirmed quotation (what it copies) | `GP-System-Client/src/components/quotations/viewQuotation.js` (`createInvoiceHandler`) |
| New invoice form | `GP-System-Client/src/components/invoices/newInvoice.js` |
| Invoice list (cancel-request picker, columns, statuses) | `GP-System-Client/src/components/invoices/invoices.js` |
| Draft list | `GP-System-Client/src/components/invoices/draftInvoices.js` |
| Invoice view (cancel flow, warehouse draft editing, finalize) | `GP-System-Client/src/components/invoices/viewInvoice.js` |
| **Tax invoice PDF** (port this) | `GP-System-Client/src/components/invoices/invoicePDFGenerator.js` |
| Serial numbers per line (not now) | `GP-System-Client/src/components/invoices/serialNumberModal.js` |
| Redux state and API calls | `GP-System-Client/src/state/actions/invoice.js`, `src/state/reducers/invoice.js` |

---

## 3. Old behaviour, and what to do with each part

**B** = bring as is. **A** = adapt to this system. **U** = upgrade. **L** = leave out (for now).

| # | Old behaviour | Do |
|---|---|---|
| 1 | "Create Invoice" appears on a quotation that is payment- or credit-confirmed and not cancelled. It copies the customer, sales manager, payment terms, delivery location, type, the type's references, the service charge and the lines (at the quotation's unit price) into the new invoice form. | **A**: the Create invoice button (already on `QuotationPage`, permission `INVOICES.CREATE`) opens `/invoices/create?quotationId=…`, filled from the quotation. |
| 2 | Before that, the browser blocks the invoice if any line's quantity is above the product's stock. The server check is commented out. | **U**: the server checks stock when it moves stock, on finalize (§9, Q3). |
| 3 | Only one live invoice per quotation (409 "already exists"). | **B**: 409 `INVOICE_EXISTS`, backed by a partial unique index (§5.1). |
| 4 | Creating the invoice soft-deletes the quotation. Cancelling a **draft** invoice restores it. | **A**: the quotation's status becomes `invoiceCreated`, which already locks it. Cancelling a draft puts back the status it had before. |
| 5 | Fields: date; due date; payment method (Cash / Credit / Cheque / Bank Transfer, required unless the invoice is warranty); "Cheque number - bank name" when Cheque; bank (fixed list of 5) when Bank Transfer; sales manager (free text); payment terms; collection method (Delivery / Pickup, warranty only, required); delivery location; transport (field commented out). | **A**: typed columns. Sales manager is a user, as on quotations. Banks come from data, not code (§9, Q5). Transport is left out. |
| 6 | Sales / Warranty / Service types, with old S/N, old invoice no., model, troubleshoot ref, repair note ref and service charge. A service invoice has no product lines and is priced by its charge plus VAT. | **B**: the same rules as quotations (`quotations.types.ts`). Reuse that code; don't copy it (§5.3). |
| 7 | Save as **draft** (no serial numbers needed) or finalize straight from the preview. A draft gets the number `YYMON_GP01_N-draft`, a final invoice `YYMON_GP01_N` (e.g. `26NOV_GP01_14`). Both counters reset on the 1st of each month (cron). Month and year are in Asia/Colombo time. | **A**: the same formats, made by a database function with one counter row per (kind, month). No cron. Branch code and timezone come from settings (§5.2). |
| 8 | **Finalize** a draft: for non-service invoices an item preparer name is required. It gets a new final number and moves stock: `stock − qty`, `stockInTransit + qty`, and the serials move to "in transit". It also creates a delivery note and updates the troubleshoot/repair status. | **A**: finalize moves `stockInHand → stockInTransit` with `StockMovement` rows. Delivery note, serials and troubleshoot/repair statuses: **L** (hooks noted). Item preparer: §9, Q4. |
| 9 | **Cancel request**: a user without cancel rights writes a reason → `isCanceled = true`, shown as "Request for cancel". Users who can cancel see a "cancel requests" picker on the list (last 3 months) and can **Cancel** the invoice or say **Don't cancel** (clears the request). | **B**: request / decline / cancel as separate actions with their own permissions. The picker becomes a status filter on the list (no 3-month cut-off; §9, Q9). |
| 10 | **Cancel** (admin + `canCancelInvoice`): for finalized, non-service invoices, the stock goes back (`stockInTransit − qty`, `stock + qty`, or from "sold" when the delivery note was delivered). It records cancelledBy/At. | **A**: reverse the finalize movements (`stockInTransit → stockInHand`). The "delivered" branch waits for delivery notes. |
| 11 | Pre-order quotations: a draft from one adds the quantities to `preOrderQuantity`, finalizing or cancelling the draft takes them off again, and cancelling a finalized one adds them back. | **§9, Q2**: depends on what `stockPreOrder` means here. Don't guess. |
| 12 | List columns: Invoice No., Quotation No., Type, Customer Code, Customer Name, Amount (LKR, with VAT; a cancelled invoice shows 0.00), Date (finalized date, else date), Status (Cancelled / Request for cancel / Draft / Active). Search: invoice no., quotation no., customer code, serial numbers, product name or category. | **A**: `DataGrid` with the same columns. Search by number, quotation no., customer and product. Serial-number search waits for serials. |
| 13 | A technical-team user without office rights only sees zero-value invoices. | **L** for now (§9, Q8). It was a role check in code; if needed, it gets its own permission. |
| 14 | The view page shows created/finalized/cancelled by and when, and when the quotation was created and by whom. | **B**: detail rows. The audit columns and user names come from the API. |
| 15 | The tax invoice PDF: "TAX INVOICE" / "DRAFT INVOICE", invoice details, payment method with cheque/bank, due date, collection method for warranty, old S/N and invoice no. for warranty and service, terms, banks, and a serial-number section. Product-specific text is hard-coded by category ("Solar Inverter" → WiFi stick serial, "Air Conditioners", "System Packages" → battery S/N), plus "18 %" and the cable warranty line. | **B** for layout and wording, to the millimetre. **L** for the category-specific and cable conditions: no hard-coded conditions; serials are out of scope anyway. Use the saved VAT rate, as the quotation PDF does. |

---

## 4. Target behaviour (summary)

1. A confirmed quotation (`paymentConfirmed` / `creditConfirmed`, not deleted, no live invoice) → **Create invoice**.
   The form opens, filled from the quotation. The user completes payment method, due date and so on, and saves
   **as a draft**. The draft gets the next draft number, and the quotation becomes `invoiceCreated`.
2. Warehouse: they open the draft and add the item preparer (non-service). Then they **Finalize**: the invoice gets
   the next final number, stock moves `inHand → inTransit` (non-service), and the invoice can no longer be edited.
3. A draft can still be edited (fields and lines) and can be **cancelled**. Cancelling a draft puts the quotation back
   to the status it had.
4. On a finalized invoice, a user can **request cancellation** with a reason. A user with `INVOICES.CANCEL` can
   **cancel** it (stock goes back `inTransit → inHand`) or **decline** the request.
5. The detail page shows the tax invoice PDF (draft or final). It's downloadable as `<number> <customer>.pdf`.

Whether invoices can also be made without a quotation (the old New Invoice page had a customer picker): §9, Q1.

---

## 5. Server design (`GP-ERP-Server`)

### 5.1 Database (`prisma/schema.prisma`, one hand-written migration)

The owner has started a draft `model Invoice` and `enum InvoicePaymentMethod` (no migration yet). **Replace them** with
the models below. The draft doesn't follow the conventions: `InvoiceNumber` is capitalised, `paymentmethod` is lower
case, `dueDate` has no `@db.Date`, and `check` should be `cheque`. Check with the owner before you remove anything else.

```prisma
enum InvoiceStatus {
  draft
  finalized
  cancelled
}

enum InvoicePaymentMethod {
  cash
  credit
  cheque
  bankTransfer
}

enum InvoiceCollectionMethod {
  delivery
  pickup
}

model Invoice {
  id                  Int                      @id @default(autoincrement())
  draftNumber         String                   @unique   // 26NOV_GP01_3-draft, set on create
  invoiceNumber       String?                  @unique   // 26NOV_GP01_14, set on finalize; show this ?? draftNumber
  status              InvoiceStatus            @default(draft)
  type                QuotationType                        // same enum and rules as quotations
  quotationId         Int?                                 // see the partial unique index below
  quotation           Quotation?               @relation(...)
  quotationStatusBefore QuotationStatus?                    // restored when a draft is cancelled
  customerId          String
  salesManagerId      String                               // a user, like Quotation.salesManagerId
  invoiceDate         DateTime                 @db.Date
  dueDate             DateTime                 @db.Date
  paymentMethod       InvoicePaymentMethod?                // required unless warranty
  chequeDetails       String?                              // cheque only
  bankId / bankName   …                                    // bank transfer only; source of banks: §9 Q5
  paymentTerms        QuotationPaymentTerms?
  collectionMethod    InvoiceCollectionMethod?             // warranty only, required there
  deliveryLocation    String?
  repairReceiveNoteId, troubleshootId, oldInvoiceId, oldSerialNumberId, productModel   // as on Quotation (not built yet)
  serviceCharge       Decimal? @db.Decimal(14, 2)
  serviceTaxRate      Decimal? @db.Decimal(5, 2)
  subtotal, discountTotal, taxTotal, grandTotal          // Decimal(14, 2), from the lines or the service charge
  itemPreparer…                                           // §9 Q4: user id (dropdown) or text
  finalizedAt / finalizedBy, cancelRequestedAt / cancelRequestedBy / cancelReason, cancelledAt / cancelledBy
  items               InvoiceItem[]
  createdBy · createdAt · modifiedBy · modifiedAt · isDeleted   // audit columns last (test/schema.test.ts)
}

model InvoiceItem { … }   // the same columns and formulas as QuotationItem (lineNo, productId, description, quantity,
                          // unitPrice, unitCost, discountType/Value, taxRate, subtotal, discountAmount, taxAmount,
                          // lineTotal, audit columns). Lines are copied from the quotation, not repriced.
```

In the hand-written SQL of the same migration:

- **One live invoice per quotation:**
  `CREATE UNIQUE INDEX … ON "Invoice"("quotationId") WHERE "status" <> 'cancelled' AND "quotationId" IS NOT NULL`.
- **CHECK constraints** for the same per-type rules as `Quotation`: references by type, and service charge only on
  service. Also:
  - `collectionMethod` only on warranty
  - `chequeDetails` only with `cheque`
  - `invoiceNumber` set exactly when the invoice is not a draft

  Remember the quotation lesson: a CHECK must not break rows that already exist. The table is new, so it can be strict.
- **Cache triggers:** `Invoice_notify_change` and `InvoiceItem_notify_change`. `npm run db:migrate` adds them; for a
  hand-written migration, add them yourself (`docs/migrations.md`).
- **Numbering** (§5.2).

Add a row to `docs/migrations.md` and to `docs/database.md`, and a `docs/screens/invoices.md` written like
`quotations.md`.

### 5.2 Invoice numbers

The old format is kept exactly: `YY` + month name (`JAN`…`DEC`) + `_` + branch + `_` + sequence. Drafts end in
`-draft`. The sequence restarts at 1 every month, separately for drafts and final numbers.

- **Counter table:** `InvoiceNumberCounter(kind text, period text, value int, PRIMARY KEY (kind, period))`. `kind` is
  `draft` or `final`, `period` is e.g. `26NOV`.
- **SQL function** `next_invoice_number(kind text, day date)`. It does
  `INSERT … ON CONFLICT (kind, period) DO UPDATE SET value = value + 1 RETURNING value` and builds the string.
  - It's safe with concurrent requests.
  - No cron job is needed: a new month is a new row.
- **Month and timezone:** the month comes from the invoice date (draft) or the finalize date (final), in
  **`Setting.timezone`**.
- **Branch code:** comes from a new setting (`Setting.invoiceBranchCode`, default `GP01`), not from code. Add it to
  the settings API and the company-settings form in Admin.
- **Function vs column default:** call the function from the service inside the create/finalize transaction, because
  it needs arguments. That's unlike `next_quotation_number()`, which is a column default.

### 5.3 Module `src/modules/invoices/`

The same files as quotations:

| File | Contents |
|---|---|
| `invoices.schema.ts` | zod request and response shapes. Reuse `money`, `dateOnly`, `pageQuery`. |
| `invoices.service.ts` | business logic |
| `invoices.routes.ts` | routes |
| `invoices.errors.ts` | `InvoiceExistsError` 409, `InvoiceNotDraftError` 409, `InvoiceCancelledError` 409, `InsufficientStockError` 409 with the lines in `details` |
| `invoices.types.ts` or shared code | the per-type rules |
| `invoices.int.test.ts` | integration tests |
| `*.test.ts` | unit tests for the pure functions |

- **Don't copy quotation code; share it.**
  - The per-type rules (`fieldsNotAllowed`, `contentProblems`) and the amount functions (`lineAmounts`,
    `quotationTotals`, `serviceTotals`) apply to invoices too.
  - Move what both need into a shared place, e.g. `src/modules/sales-documents/` with neutral names, and import it
    from both modules.
  - Keep the quotation tests passing.
- **Endpoints** (mounted at `/api/v1/invoices`; route-level permission in brackets):

  | Method | Path | Permission | What |
  |---|---|---|---|
  | GET | `/` | `INVOICES.VIEW` | paginated list. Filters: `status`, `type`, `customerId`, `quotationId`, `from`, `to`, `cancelRequested`. Cache tags `Invoice`, `Customer`, `User` |
  | GET | `/:id` | `INVOICES.VIEW` | detail with lines, customer (document fields like the quotation detail), sales manager, the user names for created/finalized/cancelled/requested, and the quotation's number |
  | POST | `/` | `INVOICES.CREATE` | create a draft. Body: `quotationId` plus the invoice's own fields. Lines, type, references and charge are copied from the quotation on the server, not taken from the client |
  | PATCH | `/:id` | `INVOICES.EDIT` | edit a **draft** (fields; lines only if §9 Q1 allows invoices without quotations, or if the owner wants drafts' lines editable) |
  | POST | `/:id/finalize` | `INVOICES.FINALIZE` | number, stock, finalizedAt/By |
  | POST | `/:id/cancel-request` | `INVOICES.REQUEST_CANCEL` | `{ reason }`; finalized invoices only |
  | DELETE | `/:id/cancel-request` | `INVOICES.CANCEL` | decline the request |
  | POST | `/:id/cancel` | `INVOICES.CANCEL` | cancel a draft or a finalized invoice |

  These are action endpoints rather than one PATCH with a status, because each action has side effects (numbers,
  stock, the quotation).
- **Transactions:** every write is one transaction. It locks the invoice row (`SELECT … FOR UPDATE`, as
  `updateQuotation` does) and the product rows in id order before it moves stock.
- **Stock moves** go through one small function: change the bucket columns and write `StockMovement` rows with
  `reference` = the invoice number (`reference` is the existing placeholder text column). Live stock (SSE) then
  updates every open screen by itself. Don't touch `stockVersion`.
- **Quotation side:**
  - Creating the invoice sets the quotation to `invoiceCreated` in the same transaction.
  - Cancelling a draft sets it back to `quotationStatusBefore`.
  - Add an internal function in the quotations service for this. The quotation PATCH route's permission checks are
    for users, not for this.

### 5.4 Permissions (`src/platform/security/permissions.ts`)

`INVOICES.VIEW` and `INVOICES.CREATE` already exist. Add:

| Key | Description | Old equivalent |
|---|---|---|
| `INVOICES.EDIT` | Edit draft invoices | anyone with access |
| `INVOICES.FINALIZE` | Finalize draft invoices (warehouse) | anyone with access |
| `INVOICES.REQUEST_CANCEL` | Ask for an invoice to be cancelled, with a reason | users without cancel rights |
| `INVOICES.CANCEL` | Cancel invoices and decline cancel requests | `admin` + `canCancelInvoice` |

Super Admin gets them automatically. Say in the report that other roles must be ticked in Admin → Roles. Don't
write a grant migration unless the owner asks.

---

## 6. Client design (`GP-ERP-Client`)

### 6.1 Files (`src/pages/Invoices/`)

| File | What |
|---|---|
| `types.ts` | `Invoice`, `InvoiceSummary`, `InvoiceItem`, `NewInvoice`, status/method labels (old wording: "Cash", "Credit", "Cheque", "Bank Transfer", "Delivery", "Pickup") |
| `api.ts` | fetch + TanStack Query hooks (`useInvoices`, `useInvoice`, `useCreateInvoice`, `useUpdateInvoice`, `useFinalizeInvoice`, `useRequestCancel`, `useDeclineCancel`, `useCancelInvoice`); invalidate `["invoices"]`, `["quotations"]` and, after finalize/cancel, nothing for stock (live stock does it) |
| `InvoicesPage.tsx` | `/invoices`: `DataGrid` with the old columns (§3 #12), status filter (All / Drafts / Cancel requested / Cancelled) instead of separate pages; search box in the top bar |
| `CreateInvoicePage.tsx` | `/invoices/create?quotationId=…`: exports `InvoiceForm` (also used to edit a draft). Shows the quotation's customer (with the **commissioned** warning, as on the quotation form), lines (read-only when copied from a quotation), payment method → cheque details / bank, due date, payment terms, collection method (warranty), delivery location. Type-specific cards like `QuotationForm` |
| `EditInvoicePage.tsx` | `/invoices/:id/edit`: drafts only |
| `InvoicePage.tsx` | `/invoices/:id`: details, lines, status, who/when rows, actions by permission (Edit draft, Add item preparer, Finalize, Request cancel, Cancel, Decline request), the reason of a pending request, and the PDF |
| `InvoiceDocument.tsx` | the tax invoice PDF, lazy-loaded like `QuotationDocument.tsx` |

Add the routes in `router.tsx` with `<RequirePermission>`, a sidebar link with `INVOICES.VIEW` in
`app/layout/navigation.ts`, and the new keys in `PermissionKey` (`src/app/auth.ts`). Update the "Current pages" table
in `AGENTS.md`.

### 6.2 Conventions to follow

Everything in `GP-ERP-Client/AGENTS.md` applies. In particular:
- `DataGrid`, `TopBarActions`, `SearchInput`, shadcn components and theme tokens.
- `useFormat()` for money and dates.
- No new UI libraries.
- `npm run build` and `npm run lint` must pass.

### 6.3 Quotation screen changes (the only ones allowed)

1. The **Create invoice** button on `QuotationPage.tsx` navigates to `/invoices/create?quotationId=<id>` instead of
   calling the placeholder.
2. Delete the placeholder `createInvoice` / `useCreateInvoice` in `pages/Quotations/api.ts`.
3. Delete the "Create invoice button calls a placeholder" notes in both `AGENTS.md` files.
4. When a quotation is `invoiceCreated`, the quotation page shows a link to its invoice. Add the invoice's id and
   number to the quotation detail response.

---

## 7. The tax invoice PDF: exact port and how to prove it

- Port `invoicePDFGenerator.js` the way `QuotationDocument.tsx` ported `pdfGenerator.js`:
  - same style names and values
  - same structure and wording, typos included
  - no `fontWeight` (the old react-pdf 1.6.17 ignored it for Helvetica)
  - amounts from the server

  The header comment in `QuotationDocument.tsx` lists every adaptation; write the same kind of list.
- **Not ported**, as the owner decided for quotations:
  - the hard-coded category conditions ("Solar Inverter", "Air Conditioners", "System Packages")
  - the Suntree cable line
- The serial-number section waits for the Serial numbers module.
- **Prove it** by rendering the real old file and the new one from the same data, and comparing every text item. The
  quotation PDF was verified this way on 2026-11-05; all items were at 0.000 mm.
  1. **Old side.** Run with Node 16: `"/c/Users/madha/AppData/Local/Author Software/nvm/installs/v16.20.2/node.exe"`.
     - Load the old file with the old project's `@babel/core`, `@babel/preset-env` (target node 16) and
       `@babel/preset-react` through a `Module._extensions[".js"]` hook for files under the old `src/`.
     - Make `.png` imports return `{ data: <Buffer>, format: "png" }`. A file path is skipped by the old library.
     - In the source text, replace the component's inner `const MyDocument = () => (` with
       `const MyDocument = globalThis.__MyDocument = () => (`.
     - `renderToStaticMarkup(<Generator data={…} />)` with the old `react-dom/server` runs the component body.
     - Then `ReactPDF.renderToFile(<globalThis.__MyDocument />, file)` with the old `@react-pdf/renderer`.
  2. **New side.** Run with Node 24.
     - Bundle a tiny entry that imports `InvoiceDocument` with esbuild (`platform: "node"`, `format: "esm"`,
       `packages: "external"`, a plugin that resolves `@/…` to the client's `src/`).
     - Write the output into a folder whose `node_modules` is a junction to the client's `node_modules`
       (`New-Item -ItemType Junction`).
     - Pass images as `{ data, format }` too.
     - `renderToFile`.
  3. **Compare** with `pdfjs-dist` (legacy build). For each page, take every text item's string, x, y, size and font
     name (`page.commonObjs.get(fontName).name` after `getOperatorList()`), plus image positions. Then compare
     pairwise.
     - Report the largest offset in mm.
     - The target is 0.000 mm and identical strings, fonts and sizes.
     - Cover sales, warranty and service invoices, draft and final, and a multi-page invoice.

  Put the scratch tools (esbuild, pdfjs-dist) in a scratch folder, **not** in the repos. Ask the owner before adding
  any of this to a repo.

---

## 8. Not built yet: what the invoice must not fake

| Module | Old invoice used it for | Here |
|---|---|---|
| Serial numbers | per-line serials (main, complimentary, battery, pallet), the "in transit" serial lists, PDF serial page, search by serial | no serial columns or UI. Leave a note at the line model and the PDF |
| Delivery notes | created on finalize; "Delivered" changes how a cancel restores stock | nothing. Note it in the finalize and cancel functions |
| Repairs, Troubleshoots | refs on service/warranty invoices; status → Issued on finalize | references stay unchecked text, copied from the quotation, as on quotations |
| Credit notes, payment receipts | invoice lookups by customer | nothing |

Add each one to the "Modules not built yet" section of `GP-ERP-Server/AGENTS.md` and the "Not built yet" section of
`GP-ERP-Client/AGENTS.md`.

---

## 9. Open questions (owner decides before step 1)

My recommendation is in **bold**.

1. **Invoices without a quotation?** The old New Invoice page also let users pick a customer and add products directly.
   **Recommendation: quotations only**, with lines copied and read-only.
2. **Pre-orders and `stockPreOrder`.** Ignore the old systems pre-order logic completely. For the quotations which have pre-order enabled means, we can create the quotation even if the stock not available for those selected products. But when it comes to invoices, we do not let the user to create the invoice without the stock available in the system. 
3. **Stock check on finalize.** Old: only the browser checked, when the invoice was created; the server check is
   commented out. **Recommendation: on finalize the server refuses (409, with the lines) when `stockInHand` is lower
   than the quantity.**
4. **Item preparer.** Old: a free-text name, required before finalizing non-service invoices. **Recommendation: a user
   picked from a new `ITEM_PREPARER` dropdown**, using the existing Admin → Dropdowns feature (`UserDropdown`), stored
   as a user id.
5. **Banks for "Bank Transfer".** Old: 5 names hard-coded in the form. They must not be in code. **Recommendation: a
   small editable list in Admin (company settings)**, stored as data. The bank accounts printed on the documents could
   move there later too (§10).
6. **Branch code `GP01`.** **Recommendation: a company setting** (`invoiceBranchCode`, default `GP01`).
7. **Invoice date.** Old: a free date field, defaulting to today. The quotation form no longer asks for a date.
   **Recommendation: no such a field since createdAt already contains the date.**
8. **Technical team sees only zero-value invoices** (old role check). **Recommendation: remove all unnecessary garbages like these**
9. **Cancel-request list.** Old: a picker of requests from the last 3 months. **Recommendation: Remove all unnecesssary components and keep only the essential components. I only need the create invoice from the quotation, listing page for invoices, View invoice, Download and preview of the invoice like quotation, and permissions for actions with all the actions.**
10. **Extended warranty per line** (`newWarranty`, e.g. "5 Years", which changed how fixed discounts were counted in
    the old maths). New quotation lines don't have it. **Recommendation: Again remove them. Only bring what necessary**
11. **Old invoice data.** Should invoices from the old MongoDB be imported? NO. Big fat no is the answer.
12. **Remove the owner's draft `Invoice` model** and replace it as in §5.1? **Recommendation: yes.**

---

## 10. Order of work and checkpoints

Stop and report at each ☐. Don't continue past a checkpoint the owner hasn't seen if anything surprised you.

1. Server: shared sales-document code (§5.3), refactored out of quotations. Quotation unit tests stay green.
   ☐ Report.
2. Server: models, migration (counter table, function, partial unique index, CHECKs, triggers) and settings
   (branch code, banks). Prove it on a throwaway database: `migrate deploy` + `migrate diff` is empty.
   ☐ Report with the SQL.
3. Server: permissions, schema, service (create, edit draft, finalize, cancel request/decline/cancel), routes and
   errors. Unit tests for numbering, the rules and stock moves; integration tests written but **not run** without
   permission. Typecheck, lint, `npm test`.
   ☐ Report.
4. Client: types, API hooks, list, create/edit form, detail with actions, sidebar, routes, quotation hand-off (§6.3).
   Build and lint. ☐ Report.
5. Client: `InvoiceDocument.tsx` and the old-vs-new PDF proof (§7). ☐ Report with the comparison output.
6. Docs:
   - `docs/screens/invoices.md`
   - `docs/migrations.md`
   - `docs/database.md`
   - README
   - both `AGENTS.md` files (pages table, not-built-yet lists, remove the placeholder notes)

   Final report: what was checked, what wasn't, and what the owner must do: `npm run db:deploy`, `db:generate`,
   restart the server, grant the new permissions to roles, choose item preparers and banks in Admin.

## 11. Hard-coded values still in the documents (for a later task)

The quotation PDF still has hard-coded:
- company address, phones, VAT/TIN numbers
- bank accounts and terms text
- "valid for 3 days"
- the VAT start date 2024-01-08

The invoice PDF will have the same kinds of values. Port them as named constants and list them in the report. Moving
all of them into company settings, with output kept identical, is a separate task the owner has been offered.
