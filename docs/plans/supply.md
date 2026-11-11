# Procurement: internal requisitions, purchase orders, GRNs (porting brief)

Status: **internal requisitions built (server and client)**: `src/modules/internal-requisitions/`, with approval
(`modules/approvals`) instead of the old `poCreated`/`poApproved`/`grnCreated` IR statuses (see the comment on
`InternalRequisitionStatus`). **Purchase orders built (server and client, §7)**: `src/modules/purchase-orders/`,
migration `20261110090000_purchase_orders` (to apply), the IR and PO PDFs ported. **GRNs built (server and client, §8)**: `src/modules/goods-received-notes/`,
migration `20261111090000_goods_received_notes` (to apply), with the recommended answers to §8.6.

## 0. Read first

- Server `AGENTS.md`, `ADDING-A-FEATURE.md`, `docs/database.md`, `docs/migrations.md`. Client `../GP-ERP-Client/AGENTS.md` and its
  skills (`new-page`, `add-feature-data`, `top-bar-actions`).
- [invoices.md](invoices.md): the worked example of a port. Copy its structure: old behaviour table with
  **B** bring / **A** adapt / **U** upgrade / **L** leave out, target behaviour, server design, client design, open
  questions, order of work. Its §7 is the method for porting a PDF exactly and proving it.
- Code to copy, not reinvent:
  - `src/modules/invoices/`: a document with a status lifecycle, its own number function, lines, and stock moved with
    `StockMovement` rows inside a transaction with row locks.
  - `src/modules/delivery-notes/`: a document made by another document's action, state-guarded conditional updates,
    and people picked from Admin → Dropdowns (`dropdowns.ts`).
  - `src/modules/suppliers/`: the supplier master data the documents point to.
  - Client: `pages/Invoices/` (list with a progress bar, detail with `ConfirmButton` actions, form, lazy-loaded PDF)
    and `pages/DeliveryNotes/`.

## 1. Scope

A new sidebar section **Procurement**: `section: "Procurement"` on each link in `src/app/layout/navigation.ts` (the sidebar draws
the heading). The old chain, in order:

1. **Internal requisition (IR)**: a request to buy.
2. **Purchase order (PO)**: to a supplier, from an IR or on its own; approved, completed, cancelled.
3. **Goods received note (GRN)**: from a PO; the received goods go into stock.

"Etc.": ask the owner which other old screens belong here (see "Related" in §2).

Each document gets its own permission group (`INTERNAL_REQUISITIONS.*`, `PURCHASE_ORDERS.*`, `GRNS.*`), with only the
actions it has. Old role checks in code (`admin` on GRN approve and PO delete) become permissions.

## 2. Where the old system is

Backend (Express + MongoDB): `C:\Users\madha\Documents\Development-22-10-2026\Gunda-Power-System-Backend\src`.
Client (Gatsby + Redux): `C:\Users\madha\Documents\Development-22-10-2026\GP-System-Client\src`.

| What | Backend | Client |
|---|---|---|
| IR | `models/internalRequisition.js`, `routers/internalRequisition.js` | `components/internalRequisition/`, `state/actions/internalRequisition.js` |
| PO | `models/purchaseOrder.js`, `routers/purchaseOrder.js` | `components/purchaseOrders/`, `state/actions/purchaseOrder.js` |
| GRN | `models/grn.js`, `routers/grn.js`, `lib/grnSerialNumbers.js` | `components/grn/`, `state/actions/grn.js` |
| PDFs | | `irPdfGenerator.js`, `poPdfGenerator.js`, `grnPdfGenerator.js` in those folders |
| Routes and menu | | `pages/app.js` (`/app/ir-forms`, `/app/purchase-orders`, `/app/grns`), `components/navDrawer.js` |
| Related (ask first) | `routers/replacementProduct.js`, `routers/issueReplacement.js` | `components/inventory/` (add/remove stock, assemble package) |

## 3. Already known (checked 2026-11-09; confirm the details in the files)

- **Chain statuses.**
  - Creating a PO from an IR sets the IR to `poCreated` (and stores the PO number).
  - Approving the PO sets the IR to `poApproved`.
  - Creating a GRN sets the IR and the PO to `grnCreated`.
  - Cancelling a PO cancels its IR.
  - The old links are number strings (`irNumber`, `poNumber`). Here they become foreign keys.
- **Statuses.** IR: `pending, poCreated, poApproved, grnCreated, cancelled`. PO: `pending, approved, completed,
  cancelled`. GRN: `pending, approved, rejected, incomplete, completed`.
- **Numbers.** `GPIR-0001`, `GPPO-0001`, `GPGRN-0001` (padded to 4). Keep the formats with a hand-written number
  function, as `GPDN-` delivery notes do.
- **Stock.** The old product has only `stock`, `stockInTransit` (sold, not yet delivered), `stockSold` and
  `preOrderQuantity`.
  - A GRN must be approved before `add-to-stock`, which adds the received quantity straight to `stock`.
  - It can be added in parts: `addedToStockQty` per line, and the delivered quantity can't go below it.
  - It also adds serial numbers, and has a separate `add-to-replacement-stock`.
  - Nothing tracks goods on their way from a supplier.

## 4. Constraints in this project

- **Serial numbers aren't built** (`AGENTS.md` → "Modules not built yet"). Leave GRN serial capture out and note it.
  Don't fake it.
- Stock changes only go through `StockMovement` rows in a transaction (copy `moveStock` in `invoices.service.ts`).
  Browsers update by themselves through live stock.
- Migrations are written, not applied: the owner applies them.

## 5. Decide with the owner before building (ask; don't guess)

1. **Stock buckets.** `Product` has `stockInHand`, `stockPreOrder`, `stockInTransit` and `stockOnArrival`. Invoices
   use `inTransit` for goods sold and on their way to the customer (finalize: `inHand → inTransit`). The comment above
   `StockMovement` in `schema.prisma`, though, describes `inTransit` as goods shipped by a supplier. Agree which
   buckets supply moves (e.g. PO approved → `+onArrival`, GRN received → `onArrival → inHand`), then correct that
   comment.
2. Which "etc." screens to include (§2 "Related").
3. Does a GRN update `Product.cost` (a `CostMovement`)? Which currency do imports use?
4. Port the IR / PO / GRN PDFs now (invoices.md §7 method) or later?
5. Approvers and checkers: permissions only, or people from Admin → Dropdowns as well?

## 6. Order of work

1. Analyse §2 and write the plan here, in invoices.md's shape. Keep it short.
2. Get the owner's answers to §5 and approval.
3. Build one document at a time (IR → PO → GRN), each end to end: server module, tests and access matrix, then the
   client pages. Run the checks in both `AGENTS.md` files.
4. Then update this file's Status line, the client's "Current pages" table, `README.md`, and the "not built yet" notes.

## 7. Purchase orders (built 2026-11-10)

Owner's brief: a PO is made only from a **local** IR (`isInternational = false`); the IR's Approve button becomes
**"Approve & create purchase order"**, which opens the new-PO form; nothing is saved until that form is, and saving it
approves the IR and creates the PO in one transaction. An international IR gets no PO: its printed IR is the document.
The IR and PO PDFs are exact ports of the old ones.

### 7.1 Old behaviour (`routers/purchaseOrder.js`, `components/purchaseOrders/`) → **B**ring / **A**dapt / **U**pgrade / **L**eave out

| Old | Here |
|---|---|
| IR view "Create Purchase Order" opens the new-PO form filled from the IR; saving sets the IR to `poCreated` | **A**: "Approve & create purchase order" opens `/purchase-orders/create?internalRequisitionId=`; saving approves the IR (needs `INTERNAL_REQUISITIONS.APPROVE` too) and creates the PO. An IR approved on its own (approval off) gets "Create purchase order" |
| International IR: no PO | **B** |
| API allowed a PO without an IR (the form refused) | **L**: `internalRequisitionId` required and unique; no Create button on the PO list |
| `GPPO-0001` | **B**: sequence + `next_purchase_order_number()` |
| `date` picked in the form | **B**: `purchaseOrderDate`, today by default |
| Supplier changeable on the form | **B** while pending or rejected |
| Lines: qty, unit price (> 0), discount `%` / `LKR`; remove; no adding | **B**: `DiscountType` percentage / fixed; removed IR lines can be added back on the form |
| VAT 18 % hard-coded from 8 Jan 2024 | **A**: `Setting.vatRate` per line, totals by the server |
| `comments` (printed), `remarks` (not printed) | **B** |
| `pending → approved` (admin) `→ completed` (manual); `cancelled` | **A**: `pending → approved / rejected` through `modules/approvals` (screen `PURCHASE_ORDERS`); `completed` reserved for the GRN, no manual button |
| Edit only while pending | **A**: pending and rejected (editing a rejected one resubmits it) |
| Approving the PO sets the IR to `poApproved` | **L**: the IR stays `approved` and shows its PO and the PO's status |
| Cancel with a reason; also cancels the IR | **B**: `cancelled` / `cancelledAfterApproved`; IR → `cancelledAfterApproved`, same reason. **U**: cancelling an IR cancels its PO |
| Delete pending PO (admin) | **L**: cancel instead |
| `GET /purchase-orders/supplier/:code` | **L**: the list search covers it |
| PO PDF shown once approved; IR PDF always | **B** |

### 7.2 Built

- Server: `PurchaseOrderStatus`, `PurchaseOrder`, `PurchaseOrderItem` and migration `20261110090000_purchase_orders`;
  `src/modules/purchase-orders/` (list, detail, create, update, approve, reject, cancel, with schema and integration
  tests); the IR's cancel cascades and its detail returns `purchaseOrder` and the supplier's address fields;
  `PURCHASE_ORDERS` in `APPROVAL_SCREENS`; permissions `PURCHASE_ORDERS.{VIEW, CREATE, EDIT, APPROVE, REJECT, CANCEL}`.
- Client: `pages/PurchaseOrders/` (list, detail, create from an IR, edit, `PurchaseOrderDocument.tsx`);
  `pages/InternalRequisitions/InternalRequisitionDocument.tsx`; IR page buttons, PO row and Print.
- PDFs proven against the old files with the invoices.md §7 method (one- and two-page IRs and POs): identical, except
  page 2+ of a multi-page PO, whose rows are 1pt higher (react-pdf v4 doesn't redraw a split view's top border). The
  adaptations for react-pdf v4 are listed in each document's header comment.
- Stock: a PO moves none. Whether approval adds `+onArrival` is still §5.1, to decide with GRNs.

## 8. Goods received notes (plan, 2026-11-11)

Status: **built 2026-11-11** (uncommitted), with the recommended answer to every §8.6 question: one GRN per delivery;
approval adds `+inHand` only (`onArrival` stays unused); no more than outstanding; no "close order", no undo of an
approved GRN, no replacement stock, no cost update, no GRN without an order; the PDF ported (not yet proven with the
invoices.md §7 method). Names: `GOODS_RECEIVED_NOTES.*`, `/goods-received-notes`, `GoodsReceivedNote.grnNumber`.
What changed from §8.3–8.4 while building:
- The form's starting lines come from `GET /goods-received-notes/orders/:internalRequisitionId` (the "order receipt":
  ordered, received, outstanding per line, the order's GRNs, `blockedReason`), not a `/new` route; the IR and PO detail
  responses are unchanged, and their pages read the order receipt (`OrderReceiptSection.tsx`) instead.
- The PO and IR pages hide Cancel once goods have been received; the server refuses it (`409 GOODS_ALREADY_RECEIVED`).
- The printed company lines (`company`, `deliverTo`) moved to `pages/PurchaseOrders/types.ts`, shared by the PO and GRN
  PDFs.

Old code read: backend `models/grn.js`, `routers/grn.js`, `lib/grnSerialNumbers.js`; client `components/grn/`
(`grns.js`, `newGRN.js`, `editGRN.js`, `viewGRN.js`, `stockAddModal.js`, `grnPdfGenerator.js`), `state/actions/grn.js`
(`loadGRNFromPO`, `loadGRNFromIR`), and the GRN buttons in `components/internalRequisition/viewInternalRequisition.js`.

### 8.1 Old behaviour → **B**ring / **A**dapt / **U**pgrade / **L**eave out

| # | Old | Here |
|---|---|---|
| 1 | IR view: "Create GRN from PO" once the local IR's PO is `approved`; "Create GRN from IR" on an international IR while `pending`. Both fill the new-GRN form from the order (`loadGRNFromPO` / `loadGRNFromIR`) | **A**: "Create GRN" on an approved PO and on an approved international IR opens `/goods-received-notes/create?internalRequisitionId=`. An international IR must be approved first (the old one skipped approval) |
| 2 | GRN list "Create new": any supplier, any products from the product modal, no PO or IR | **L** (§8.6 Q8): a GRN always comes from an order, as a PO always comes from an IR. No Create button on the list |
| 3 | `GPGRN-0001` from a counter | **B**: `grnNumber`, sequence + `next_grn_number()`, as `next_purchase_order_number()` |
| 4 | Fields: `date` (picked, today by default), supplier, supplier invoice no.; PO and IR numbers read-only | **B**: `receivedDate`, `supplierInvoiceNumber`. **A**: supplier copied from the order, read-only (it's the order's supplier) |
| 5 | Lines: item code, description, **order qty editable**, delivered qty, remaining, remarks, "unfulfilled" tick; lines removable and addable | **A**: one line per order line, ordered qty copied and read-only, received qty 0…outstanding, remarks. No add or remove: a line with nothing received stays at 0, as the old PDF printed it |
| 6 | Two buttons: "Create GRN" (`pending`) and "Create Incomplete GRN" (`incomplete`) | **A**: one Save. A partial delivery is simply a GRN that doesn't cover the outstanding quantity |
| 7 | Saving sets the IR and the PO to `grnCreated` | **L**: those statuses aren't copied (as `poCreated` wasn't, §7.1). **U**: the PO becomes `completed` when its approved GRNs have received every line in full; the IR and PO pages show what has arrived |
| 8 | Approve: `admin` role, sets `approvedBy/At`; no reject route though `rejected` is in the enum | **A**: `modules/approvals`, screen `GOODS_RECEIVED_NOTES`, `GOODS_RECEIVED_NOTES.APPROVE` / `.REJECT` (reason required); can be switched off in Admin → Approvals (then approved on save) |
| 9 | Edit while `pending` or `incomplete`; the body could set `status`; delivered qty can't go below `addedToStockQty` | **A**: edit while pending or rejected (editing a rejected one resubmits it): date, supplier invoice no., received qty, remarks. Status is never accepted from the client |
| 10 | "Add to Stock", a separate step after approval: adds `deliveredQty − addedToStockQty` to `stock`, then `completed` or `incomplete`. A later delivery is added by editing the GRN and adding again, **without a new approval** | **U**: approving adds the received quantities to stock in the same transaction (`StockMovement` rows, reference = GRN number). Each delivery is its own GRN with its own approval, so nothing reaches stock unapproved. No `addedToStockQty`, no `incomplete` / `completed` GRN status |
| 11 | "Add to Replacement Stock" (the technical team's `ReplacementProduct` stock) | **L** (§8.6 Q6): there is no replacement stock here |
| 12 | Serial numbers per unit when adding to stock (`stockAddModal.js`, duplicate checks in `grnSerialNumbers.js`) | **L**: the Serial numbers module isn't built. Hook: approving a GRN line of a `trackingType = serial` product will need one serial per unit (`StockMovement.serialNumber`) once it is |
| 13 | `PATCH /grns/:id/complete` (approved → completed, by hand; no button) | **L** for the GRN. Closing an order that will never be delivered in full: §8.6 Q4 |
| 14 | No cancel | **U**: cancel a pending or rejected GRN with a reason (`cancelled`); no stock has moved. An approved GRN: §8.6 Q5 |
| 15 | List: GRN no., PO no., IR no., supplier, date, status, prepared by; search GRN / PO / IR no., supplier code, supplier invoice no. | **B**: `DataGrid` with the same columns and search (supplier by code or name) |
| 16 | `GET /grns/supplier/:code`, `GET /grns/purchase-order/:poNumber` | **L**: the list search covers the first; the PO and IR detail return their GRNs |
| 17 | View: details, supplier block, lines with remaining and a line status (Not delivered / Partial / Complete) | **B**, plus "received before" (the order's other approved GRNs) and the approval history, as on the PO page |
| 18 | PDF "GOODS RECEIVED NOTE" (date, GRN / PO / IR no., supplier code, supplier invoice, supplier VAT; supplier and "Received By" blocks; item code, description, ordered, delivered, remarks; created / approved by and when; confirmation sentence; footer) | **B**: exact port with the invoices.md §7 method (§8.6 Q9). The company addresses are the same lines as `deliverTo` / the header in `PurchaseOrderDocument.tsx`; reuse them, don't copy them a third time |

Old weaknesses not carried over: a GRN could change the ordered quantity and add products that weren't ordered;
later deliveries reached stock without approval; stock was found by SKU text; any signed-in user could add to stock.

### 8.2 Target behaviour

1. A local IR's PO is approved, or an international IR is approved → **Create GRN** (needs
   `GOODS_RECEIVED_NOTES.CREATE`). The form shows the order's lines with ordered, received before and outstanding; the
   user enters what arrived, the date and the supplier's invoice number, and saves. Not offered while the order has an
   open GRN or nothing is outstanding.
2. The GRN is `pending` (or `approved` at once when Admin → Approvals says GRNs don't need approval). It can be edited,
   approved, rejected (with a reason; then edited and resubmitted) or cancelled (with a reason).
3. **Approve** adds each line's received quantity to stock and is final. If the order is now received in full, its PO
   becomes `completed`.
4. More goods arrive → another GRN for the outstanding quantities, as in step 1.
5. The order can no longer be cancelled once any of its GRNs is approved; cancelling an order cancels its open GRN.

### 8.3 Server design (`GP-ERP-Server`)

**Database.** The model is in `schema.prisma` (read its comments). One hand-written migration,
`<timestamp>_goods_received_notes`, timestamped after `20261110090000_purchase_orders`:

```sql
-- hand-written: GPGRN-0001, GPGRN-0002, … (padded to 4), before the table whose default calls it.
CREATE SEQUENCE "grn_number_seq" AS bigint;
CREATE FUNCTION next_grn_number() RETURNS text LANGUAGE sql AS $$
  SELECT 'GPGRN-' || lpad(n::text, greatest(4, length(n::text)), '0')
  FROM (SELECT nextval('grn_number_seq') AS n) AS next
$$;
-- … Prisma's CREATE TYPE / TABLE / INDEX / FOREIGN KEY …
-- hand-written: one open GRN per order, so outstanding quantities can't be received twice.
CREATE UNIQUE INDEX "GoodsReceivedNote_one_open_per_requisition" ON "GoodsReceivedNote"("internalRequisitionId")
  WHERE "status" IN ('pending', 'rejected') AND NOT "isDeleted";
-- hand-written: as PurchaseOrder_cancel_check.
ALTER TABLE "GoodsReceivedNote" ADD CONSTRAINT "GoodsReceivedNote_cancel_check" CHECK (…);
ALTER TABLE "GoodsReceivedNoteItem" ADD CONSTRAINT "GoodsReceivedNoteItem_quantity_check"
  CHECK ("orderedQuantity" >= 1 AND "receivedQuantity" >= 0);
-- GoodsReceivedNote_notify_change, GoodsReceivedNoteItem_notify_change triggers
```

Rows in `docs/migrations.md` (history) and `docs/database.md`.

**Permissions** (`permissions.ts`): `GOODS_RECEIVED_NOTES.{VIEW, CREATE, EDIT, APPROVE, REJECT, CANCEL}`.
`APPROVAL_SCREENS` gets `GOODS_RECEIVED_NOTES: "Goods received notes"`.

**Module** `src/modules/goods-received-notes/` (copy `purchase-orders/`): `.schema.ts`, `.service.ts`, `.routes.ts`,
`.errors.ts`, `.schema.test.ts`, `.int.test.ts`. Every route in the access matrix (`test/app.test.ts`).

| Method, path | Permission | Does |
|---|---|---|
| `GET /goods-received-notes` | VIEW | paged list, search (numbers, supplier code / name, supplier invoice no.), status filter |
| `GET /goods-received-notes/:id` | VIEW | detail: IR, PO, supplier with address, lines with product, received before, outstanding, approvals, people |
| `GET /goods-received-notes/orders/:internalRequisitionId` | VIEW | the order receipt: lines with ordered, received, outstanding; the order's GRNs; `blockedReason` |
| `POST /goods-received-notes` | CREATE | `{ internalRequisitionId, receivedDate, supplierInvoiceNumber?, items: [{ productId, receivedQuantity, remarks? }] }` |
| `PATCH /goods-received-notes/:id` | EDIT | same body without `internalRequisitionId`; pending or rejected only |
| `POST /goods-received-notes/:id/approve` | APPROVE | approve + stock + maybe complete the PO |
| `POST /goods-received-notes/:id/reject` | REJECT | `{ reason }` |
| `POST /goods-received-notes/:id/cancel` | CANCEL | `{ reason }`; pending or rejected only |

GETs list in `cache` every table they read (`GoodsReceivedNote`, `GoodsReceivedNoteItem`, `InternalRequisition`,
`InternalRequisitionItem`, `PurchaseOrder`, `PurchaseOrderItem`, `Supplier`, `Product`, `User`, `Approval`, as used).

**Service rules** (each in one transaction, the IR row locked `FOR UPDATE` first, the order the IR and PO services use):

- *Source*: the IR isn't deleted or cancelled; international → IR `approved`; local → its PO `approved`. The order's
  lines are the PO's (local) or the IR's (international), one per product (both forms already refuse duplicates).
- *Lines*: exactly the order's products, each once. `orderedQuantity` is copied from the order line.
  `receivedQuantity` ≤ outstanding = ordered − Σ received on the order's **approved** GRNs. At least one line > 0.
- *Create*: no open GRN for the IR (the partial unique index backs this; map its violation to a 409), something
  outstanding, supplier copied. Then `approvals` decides pending or approved at once (as `createPurchaseOrder`).
- *Approve* (also the automatic one): re-check outstanding under the lock, add stock, record the `Approval`, and set
  the PO `completed` when nothing is outstanding.
- *Stock*: a local `receiveStock(tx, lines, reference, actor)` written like `moveStock` in `invoices.service.ts`
  (`update … increment` + one `StockMovement` per product with `balanceAfter`). Lines with 0 move nothing. Which
  bucket: §8.6 Q2. Live stock updates browsers by itself.
- *Changes to existing modules* (small, in the same change): PO and IR cancel refuse once the order has an approved
  GRN, and cancel its open GRN in the same transaction; the PO and IR detail return their GRNs with status and a
  received total per line; replace the "NOT BUILT YET: GRNs" comments in both services and on `PurchaseOrderStatus`.

### 8.4 Client design (`GP-ERP-Client`, skills `new-page`, `add-feature-data`, `top-bar-actions`)

- `pages/GoodsReceivedNotes/`: `types.ts`, `api.ts`, `GoodsReceivedNotesPage.tsx` (DataGrid, no Create button),
  `CreateGoodsReceivedNotePage.tsx` (`?internalRequisitionId=`; exports `GoodsReceivedNoteForm`: order header
  read-only, date, supplier invoice no., lines with ordered / received before / outstanding / received now / remarks),
  `EditGoodsReceivedNotePage.tsx`, `GoodsReceivedNotePage.tsx` (detail, line status, approval history; Approve,
  Reject, Cancel with `ConfirmButton` and reason dialogs, Edit; Print), `GoodsReceivedNoteDocument.tsx` (react-pdf,
  lazy-loaded).
- `router.tsx`: `/goods-received-notes`, `/create`, `/:id`, `/:id/edit`, each in `<RequirePermission>`.
  `navigation.ts`: "Goods received notes", `section: "Procurement"`, `GOODS_RECEIVED_NOTES.VIEW`.
  `PermissionKey` in `app/auth.ts`.
- `PurchaseOrderPage.tsx` and `InternalRequisitionPage.tsx` (international): a "Create GRN" button and a GRNs row with
  each GRN's number and status, and received / ordered per line.
- Update the client `AGENTS.md` "Current pages" table.

### 8.5 Not in this step

Serial numbers (§8.1 #12), replacement stock (#11), direct GRNs (#2), cost updates (§8.6 Q7), and anything on the
"Related" screens (§2).

### 8.6 Questions for the owner (the recommended answer first)

1. **One GRN per delivery** (drafted): each delivery is a new GRN with its own approval; approving adds it to stock.
   *Or the faithful port*: one GRN per order, edited for each delivery, approved once, with a separate "Add to stock"
   step. That needs `addedToStockQty` on the line, statuses `incomplete` / `completed`, one GRN per IR (a plain unique
   on `internalRequisitionId`) and an `add-to-stock` route, and keeps the old gap of unapproved later deliveries.
2. **Stock bucket.** (a) Approve adds `+inHand` only, as the old system did; `onArrival` stays unused for now.
   (b) Track goods on order: PO approved (and international IR approved) → `+onArrival`; GRN approved →
   `onArrival → inHand`; order cancelled or closed short → `−onArrival` for what's outstanding. (b) touches the PO and
   IR services too. Either way, correct the `StockMovement` comment (§5.1).
3. **More than ordered** delivered: refuse (recommended), or allow and show the excess?
4. **Supplier never delivers the rest.** A "Close order" action on the PO (the old manual `complete`), which sets it
   `completed`? An international IR has no `completed` status: add one, or only show "received in full" on its page?
5. **Undo an approved GRN** (goods returned, wrong quantity): not now (recommended; a return to supplier is its own
   document later), or a cancel that takes the stock back out and needs that much in hand?
6. **Replacement stock** ("Add to Replacement Stock"): leave out (no replacement products here), or plan it with the
   "Related" screens?
7. **Cost.** Should approving a local GRN set `Product.cost` (a `CostMovement`) from the PO line's net unit price?
   International IRs have no prices. Recommended: no, for now.
8. **GRN without an order** (the old list's "Create new"): leave out (recommended)?
9. **PDF** now, with the invoices.md §7 proof, or after the screens?
10. **Names**: `GOODS_RECEIVED_NOTES.*`, `/goods-received-notes`, `GoodsReceivedNote`, in line with
    `INTERNAL_REQUISITIONS` and `PURCHASE_ORDERS`, rather than §1's `GRNS.*`. The UI still says "GRN".

### 8.7 Order of work

1. Owner's answers to §8.6; adjust the model if Q1 or Q2 change it.
2. Hand-written migration; the owner applies it (`! npm run db:deploy`), then `npx prisma generate`.
3. Server: permissions, approval screen, module, schema and integration tests, access matrix, the PO / IR changes.
   `typecheck`, `lint`, `test`, `build`.
4. Client: pages, routes, link, PO / IR buttons. `npm run build`, `npm run lint`.
5. PDF (if Q9 says now), proven with the invoices.md §7 method.
6. Docs: this file's Status, server `AGENTS.md` / `README.md`, `docs/database.md`, `docs/migrations.md`, client
   `AGENTS.md` "Current pages".
