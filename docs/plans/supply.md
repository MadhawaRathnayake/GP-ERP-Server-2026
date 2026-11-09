# Procurement: internal requisitions, purchase orders, GRNs (porting brief)

Status: **internal requisitions built (server)**: `src/modules/internal-requisitions/`, with approval (`modules/approvals`)
instead of the old `poCreated`/`poApproved`/`grnCreated` IR statuses (see the comment on `InternalRequisitionStatus`).
Next: the client pages, then purchase orders and GRNs. Analyse the old system, fill in §5 with the owner, then build.

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
