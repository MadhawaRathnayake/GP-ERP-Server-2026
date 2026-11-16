# Serial numbers: implementation plan

Status (2026-11-12, uncommitted): **step 1 built and applied** (one stock figure, stock adjustments, packages
soft-deleted). **Step 2 built, server and client** (migration `20261112120000_serial_items` to apply): serial items,
accessories, Adjust stock by serial (add / remove / register), the Serial numbers and Accessories pages, the scan input.
**Step 3 built, server and client** (migration `20261112130000_grn_deliveries` to apply): GRNs one per order with
deliveries, no approval, serials added on the TC21 scan page. **Step 4 built, server and client** (migration
`20261112140000_invoice_serials_and_warranty` to apply): scanning on drafts, finalize needs every unit, warranty on
invoice lines and the delivery note, serials on the invoice PDF. Not done from §3.5: `PUT /invoices/:id/serials` (a
desktop picker; typing a serial into the scan box does the same) and the invoice list search by serial (the list loads
in the browser; the Serial numbers page finds a unit's invoice). **Step 5 built, server and client** (migration `20261112150000_reference_links` to apply): old invoice and old serial
as links with their numbers, picked by search (`ReferenceLinks.tsx`). **Phase A is built.** **Phase B scripts written 2026-11-13** (migrations `20261113090000_audit_columns_last` and
`20261113100000_invoice_imported` to apply first): `npm run import:old-invoices -- <dir>` then
`npm run import:old-serials -- <dir>`, each with a report, `--dry-run` and `--apply`; then the delivery notes,
`npm run import:old-delivery-notes -- <dir>` (migration `20261113110000_delivery_note_imported` first; see the script's
header), and the IRs, POs and GRNs, `npm run import:old-supply -- <dir>` (migration `20261113120000_supply_imported`
first). Duplicate-SKU merging (§8.2 rule 8)
isn't done: the serials settle on the SKU they were sold under, and products that get units switch to serial tracking.

Each physical unit of a `trackingType = serial` product becomes a row of its own, so a unit can be followed from the
GRN it arrived on to the invoice and delivery note it left on (warranty claims, supplier claims, returns). Two phases:
**A. the fundamentals** (§3–§7), then **B. the old data** (§8).

## Owner's decisions (2026-11-12)

1. **One stock figure.** `stockPreOrder`, `stockInTransit`, `stockOnArrival` go (copied from the old system).
2. **Serial products' stock comes from units.** For `trackingType = serial`, stock goes up when a unit's serial is
   saved; quantity products get their stock when the GRN delivery is saved.
3. **Serials are unique across all products, ignoring case**, stored exactly as on the product (digits, letters in
   either case, `-`).
4. **Accessories** (e.g. two WiFi modules in one inverter) have their own tables, linked to the product and to the unit
   (§3.9).
5. **GRNs: one per IR / PO, no approval**, received in batches; statuses **Partially completed**, **Need serial
   numbers**, **Completed**; serials are the last step of a delivery.
6. **Serials on a sale are added to the draft invoice by the warehouse, and are required to finalize.** The real
   process: Finance confirms payment or credit and creates the invoice as a **draft** (as the system does now); the
   warehouse team completes the draft by scanning a serial for every unit, on a mobile device, and finalizes it.
   Finalizing moves the stock. So **no finalized invoice is ever without its serials**, and the delivery note only shows
   them (no serial entry there).
7. **Warranty starts on the invoice.** `warrantyEndsAt` per invoice line, shown on the invoice and the delivery note.
8. **Stock fields on the product form** become "Adjust stock" (a permission nobody has by default).
9. **Old references are links**: `oldSerialNumberId` and `oldInvoiceId` hold the id and the number.
10. **Packages leave the products**; a packages module comes later.
11. **Old data**: import the old serials and the old invoices, and fix the data as far as the evidence allows (§8).

## What `ERP-DB` holds today (read-only counts, 2026-11-12)

| Table | Rows |
|---|---|
| GoodsReceivedNote, InternalRequisition, PurchaseOrder, Invoice, DeliveryNote | 0 |
| Product (quantity / serial) | 656 / 174; serial stock in hand 11,392 |
| Product with `stockInTransit` ≠ 0 / `stockPreOrder` ≠ 0 / `stockOnArrival` ≠ 0 | 216 (Σ 330,735, from the old-data import) / 0 / 0 |
| StockMovement `inHand` / `inTransit` | 433 / 216 |
| Package products ("System Package with Panels", CAT0018) | 26, stock 1; on 615 lines of 597 imported quotations. "System Packages" (CAT0008) is empty |
| Quotations with `oldSerialNumberId` / `oldInvoiceId` text | 299 / 299 |

So the GRN tables can change shape freely (the migration refuses to run if they have rows), and the in-transit
figures are only old-system data.

---

## 0. Read first

`AGENTS.md`, `ADDING-A-FEATURE.md`, `docs/migrations.md`, `docs/automatic.md` (live stock), `docs/plans/supply.md` §8
(the GRN design this replaces), the client's `AGENTS.md`. Code to copy: `invoices.service.ts` (`moveStock`, row
locks), `goods-received-notes.service.ts` (`loadOrder`), `delivery-notes.service.ts` (state-guarded updates),
`products.service.ts` (`recordMovements`).

## 3. Phase A: changes to what exists

### 3.1 One stock figure

- Drop `Product.stockPreOrder`, `stockInTransit`, `stockOnArrival`; keep the name `stockInHand`.
- Drop `StockMovement.bucket`, the `StockBucket` enum and `StockMovement.serialNumber`; hand-written: delete the 216
  `inTransit` movement rows first (the in-hand history doesn't change).
- Rewrite `set_stock_version()`, `notify_stock_change()` and `Product_set_stock_version` for one column. `GET /stock`
  and the stock events return `{ id, stockInHand, stockVersion }`.
- Invoice finalize `−stockInHand`; cancelling a finalized invoice `+stockInHand`.

### 3.2 Adjust stock instead of stock fields

- Stock leaves `createProductBody` / `updateProductBody` (new products start at 0).
- `POST /products/:id/stock-adjustments`, permission `PRODUCTS.ADJUST_STOCK`, `reason` required:
  - quantity product: `{ quantity: ±n, reason }`, not below 0;
  - serial product: `{ reason, add: [unit, …] }` (stock `+n`) or `{ reason, remove: [serialItemId, …] }` (units in
    stock → `removed`, stock `−n`);
  - serial product, `{ reason, register: [unit, …] }`: units for stock that is already counted but has no serials
    (old data, §3.8), stock unchanged, at most the product's "without serial" figure.
  - One `StockMovement` (remarks = reason) when stock changes, one `SerialItemMovement` per unit.

### 3.3 Tracking type is locked

`trackingType` can't change once the product has units (409), built with step 2. Not on stock or movements: every
imported product has an opening movement, and phase B may switch some old serial products to quantity tracking
(§8.2 rule 5).

### 3.4 Packages removed

Soft-delete the 26 products of "System Package with Panels" and both package categories (CAT0018, CAT0008). They stay
on the imported quotations and the old invoices as history, can't be picked or found, and the import scripts skip them
for new rows. The packages module takes them over later.

### 3.5 Invoices

The process stays: Finance creates the draft (`INVOICES.CREATE` from a confirmed quotation, or `CREATE_DIRECT`), and
can still edit prices and lines (`INVOICES.EDIT`). The warehouse team then completes it:

- **Add serials to a draft** (new `INVOICES.ADD_SERIALS`, so the warehouse doesn't need `EDIT`, which changes prices):
  - `POST /invoices/:id/serials/scan` `{ code }`: one scan, saved at once (nothing is lost if the phone drops). The
    code is matched against serials, accessory serials and pallet numbers of units in stock; the unit goes to the
    invoice's line for its product. A pallet code adds that pallet's in-stock units, up to what the line still needs.
    Refused with a clear reason: unknown, not in stock, product not on this invoice, line already full, already on
    another draft.
  - `DELETE /invoices/:id/serials/:serialItemId`: take a unit off (wrong scan).
  - `PUT /invoices/:id/serials` `{ items: [{ productId, serialItemIds }] }`: the same from a list (desktop picker).
- A unit picked on a draft is **reserved**: no other draft can pick it (partial unique index on the live
  `InvoiceSerialItem`); it stays `inStock` and in stock until finalize.
- A serial product may appear on **one line** per invoice, so a unit belongs to exactly one line.
- Editing a draft's lines (Finance) keeps the picks of a product while its line still has room for them; if the line
  is removed or its quantity falls below the picks, that product's picks are released (the client warns first).
- **Finalize** (`INVOICES.FINALIZE`) is refused until every serial line has exactly `quantity` units
  (`409 SERIALS_MISSING`, with the lines). Then, in one transaction with the units locked `FOR UPDATE`: units →
  `sold`, `invoiceId`; `−stock`; warranty dates; the delivery note is made.
- `InvoiceItem.warrantyMonths` (copied from the product with the line, like `unitCost`) and `warrantyEndsAt` (date, set
  on finalize: finalize date in the company timezone + months).
- Cancel a draft: its picks are released. Cancel a finalized invoice: its units → `inStock`, `invoiceId` NULL; `+stock`.
  The `InvoiceSerialItem` rows stay as history (`releasedAt` set).
- Detail and PDF show each line's units and warranty end. List search matches serials.
- Imported old invoices (§8) are exempt: some old sales of serial products were recorded without serials.

### 3.6 Delivery notes

No serial entry. The detail (and the PDF, when it is built) shows each line's units and warranty end, read from the
invoice. Service invoices have no delivery note, as now.

### 3.7 References become links (quotations and invoices)

| Now | Becomes |
|---|---|
| `oldSerialNumberId String?` | `oldSerialItemId Int?` (FK `SerialItem`) + `oldSerialNumber String?` |
| `oldInvoiceId String?` | `oldInvoiceId Int?` (FK `Invoice`) + `oldInvoiceNumber String?` |

The API takes the id and copies the number. The 299 imported texts move to the number columns (id NULL); phase B fills
the ids. The type CHECKs move to the new columns.

### 3.8 Stock and units: how they stay in step

For a serial product, at any time:

```
stockInHand = units in stock + units without a serial
```

"Units without a serial" is 0 for everything this system receives (stock only rises with a serial, and only falls when
a finalized invoice takes units that all have one). It is only above 0 for old stock that came without enough serials
(§8), and it falls as the warehouse registers serials (§3.2 `register`). Such stock can't be sold until it has serials,
because a draft can't be finalized without them.
`GET /serial-items/stock-check` lists every serial product whose figures don't add up or that still has stock without
serials; the product page shows the same.

### 3.9 Accessories: recommendation

Three ways were weighed:

| Option | Good | Bad |
|---|---|---|
| Free-text name on each accessory serial | no setup | names drift ("WiFi", "wifi stick"), the form can't know how many to ask for |
| Accessories as products (a WiFi module is a `Product`, its serial a `SerialItem` with a parent) | one table for everything | a module that comes in the box isn't stock: it would break the stock figures and fill product lists |
| **An accessory list, linked to products and to units** (recommended; the owner's idea) | consistent names; each product says what comes in its box and how many; the serial form shows that many fields; reports per accessory | one small admin screen |

So:
- `Accessory`: the list (e.g. "Solis S2-WL-ST WiFi module"), its own screen and permissions `ACCESSORIES.{VIEW,
  CREATE, EDIT, DELETE}`; optional `productId` when the same item is also sold on its own (e.g. the WiFi stick product),
  for reference only.
- `ProductAccessory`: what comes with a product and how many per unit (inverter X: 2 × WiFi module).
- `SerialItemAccessory`: the serials of a unit's accessories (unit, accessory, serial). Accessory serials are unique
  among accessory serials, ignoring case. Optional when entering a unit (a warning if fewer than the product expects).

### 3.11 Capturing serials on a mobile device

**How the old system did it** (`GP-System-Client`): no camera or barcode library. The scanner types into the web page
like a keyboard.
- Invoice draft, "Edit Draft & Add Serial Numbers" for the warehouse team (`components/invoices/serialNumberModal.js`):
  - a search box over the product's in-stock serials. Once more than 14 characters arrive, an exact match on the main,
    WiFi or battery serial ticks that unit, a partial pallet match ticks the whole pallet, and the box clears.
  - anything after `;` is ignored (a scanner suffix: 14 old serials still end in `;`).
  - Finalize checks the count per line in the browser only.
- Adding stock after a GRN (`components/grn/stockAddModal.js`, `utils/serialNumberValidator.js`):
  - a tags input (Enter adds a chip) and paste with one serial per line, with a "Count: n / qty" counter.
  - "Import the flash report" (`components/fetchExcel.js`): the supplier's Excel, columns `Barcode` + `CARTON NO` →
    serial + pallet.
  - Each entry is split on whitespace by category: an inverter or AC "main WiFi", a PV module "main pallet", a package
    "main WiFi battery".

**The device** (owner, 2026-11-12): a **Zebra TC21 (TC210K)** Android phone. Its built-in scanner and text extraction
(Zebra DataWedge) type what it reads into the focused field, as a keyboard would. No Excel import is needed.

**Here** (same idea, fewer traps):
- One **scan input** component used on every serial screen. A scan ends on Enter, Tab or `;`, or after a short pause
  (~300 ms) when a burst of keystrokes arrives with no terminator. There is no length rule: the 14-character trigger
  missed short serials such as `18120106010E`. The text is trimmed, and line breaks and repeated spaces from text
  extraction are collapsed. Typing by hand and an "Add" button still work.
- **DataWedge setup** (once per device, written up for the warehouse): a profile for the browser with Keystroke output
  and "Send ENTER key" on (Basic data formatting), so every scan ends cleanly.
- **Mobile-first pages** for the warehouse: `/invoices/:id/serials` and `/goods-received-notes/:id/serials`. The input
  is always focused and big. Each line shows "3 / 5". The last scan shows green or red with the reason, with a vibration
  (`navigator.vibrate`) and a beep. "Undo last" is one tap. Each scan is saved by the server at once (§3.5), so a
  dropped connection or closed tab loses nothing.
- **Invoice drafts**: scan anything (serial, accessory serial or pallet). The server finds the unit and its line, so
  the worker doesn't pick a line first.
- **GRN serials** create new units: the scan is the serial. For a product with accessories, the screen then asks for
  each accessory scan (main → WiFi module …) before the next unit. Paste of many lines (one per line) also works.
  The old flash-report Excel import isn't carried over (owner).
- No camera scanning: the TC21's scanner does it.

### 3.10 GRNs: one per order, deliveries in batches, no approval

Replaces supply.md §8.

- **One GRN per order** (IR, and its PO when local): partial unique index on `internalRequisitionId`. It shows every
  order line: ordered, received so far, outstanding, serials entered.
- **A delivery** (`GoodsReceivedNoteDelivery`): received date, supplier invoice number, remarks, a quantity per line
  (0…outstanding, at least one above 0). Creating the GRN saves delivery 1; later batches are more deliveries. Saving
  moves stock at once for quantity products; serial products wait for their serials. A saved delivery is final
  (corrections: Adjust stock).
- **Add serial numbers** (`GOODS_RECEIVED_NOTES.ADD_SERIALS`): per serial line, up to received − entered, in parts if
  needed, with the product's accessories (scan screen, §3.11). Each unit: `SerialItem` (`inStock`, its delivery), `+1`
  stock, movement.
- **Status**, worked out after every write: `needSerialNumbers` (a serial line has fewer units than received) → else
  `partiallyCompleted` (something outstanding) → else `completed`.
- PO → `completed` when nothing is outstanding. IR / PO can't be cancelled once they have a GRN.
- **Goes**: `pending`, `approved`, `rejected`, `cancelled`; the edit / approve / reject / cancel routes;
  `GOODS_RECEIVED_NOTES.{EDIT, APPROVE, REJECT, CANCEL}` (rows and grants deleted by the migration; boot sync never
  deletes); `GOODS_RECEIVED_NOTES` in `APPROVAL_SCREENS` and its `ApprovalRule` row; header `receivedDate` and
  `supplierInvoiceNumber` (they move to the delivery).
- Permissions: `VIEW`, `CREATE` ("Create GRNs and record deliveries"), `ADD_SERIALS`.
- PDF: the GRN with ordered / received / outstanding per line and its deliveries.

---

## 4. New tables

```prisma
enum SerialItemStatus {
  inStock
  sold           // on a finalized invoice (scanned on its draft)
  usedForRepair  // used as a repair part (repairs module, not built yet)
  removed        // taken out by a stock adjustment
}

// One physical unit of a serial-tracked product: its current state. SerialItemMovement is its history.
model SerialItem {
  id                          Int              @id @default(autoincrement())
  productId                   String
  serialNumber                String           // as on the product, trimmed; unique across all units, ignoring case
  palletNumber                String?
  status                      SerialItemStatus @default(inStock)
  goodsReceivedNoteDeliveryId Int?             // the delivery it arrived on; NULL = adjustment or imported
  invoiceId                   Int?             // set while sold
  accessories                 SerialItemAccessory[]
  movements                   SerialItemMovement[]
  … audit columns
}

model Accessory           { id String @id (ACC0001, next_accessory_id()), name @unique, description, productId?, … audit }
model ProductAccessory    { id, productId, accessoryId, quantity Int (per unit), … audit }  // unique (productId, accessoryId)
model SerialItemAccessory { id, serialItemId, accessoryId, serialNumber, … audit }

// Every change to a unit, appended, never edited (like StockMovement).
model SerialItemMovement {
  id, serialItemId, fromStatus SerialItemStatus?, toStatus SerialItemStatus,
  goodsReceivedNoteDeliveryId Int?, invoiceId Int?, remarks String?, … audit
}

// The units of an invoice, scanned on its draft. releasedAt is set when the pick is undone (taken off the draft, the
// draft's line changed, or the invoice cancelled); the row stays as history. createdBy = who scanned it.
model InvoiceSerialItem { id, invoiceId, productId, serialItemId, releasedAt DateTime?, … audit }

model GoodsReceivedNoteDelivery     { id, goodsReceivedNoteId, deliveryNo, receivedDate @db.Date,
                                      supplierInvoiceNumber?, remarks?, items, … audit }
model GoodsReceivedNoteDeliveryItem { id, deliveryId, productId, quantity, … audit }
// GoodsReceivedNoteItem keeps orderedQuantity; receivedQuantity becomes the running total of its deliveries.
// InvoiceItem: + warrantyMonths Int, warrantyEndsAt Date?
```

Hand-written SQL: unique `SerialItem (upper("serialNumber"))` and `SerialItemAccessory (upper("serialNumber"))` where
not deleted; CHECK `invoiceId` set iff `status = 'sold'`; unique `InvoiceSerialItem (serialItemId) WHERE "releasedAt" IS NULL AND
NOT "isDeleted"` (a unit is on one live invoice or draft at a time);
one GRN per IR; quantity CHECKs; `next_accessory_id()`; cache triggers.

## 5. Flows

| Step | What happens |
|---|---|
| GRN: delivery | quantity products `+stock`; status |
| GRN: add serial numbers | units `inStock` (+ accessories), `+1` stock each; status |
| Invoice draft (Finance) | created from the confirmed quotation, prices and lines editable, as now |
| Invoice draft (warehouse) | scans a serial for every unit on a mobile device; units reserved, still in stock |
| Invoice finalize | refused until every unit has a serial; units → `sold`; `−stock`; warranty dates; delivery note made (sales, warranty) |
| Delivery note | shows the invoice's units and warranty end; no serial entry |
| Invoice cancel | draft: picks released. Finalized: units → `inStock`; `+stock`; note cancelled |
| Adjust stock | §3.2 |
| Typo fix | `PATCH /serial-items/:id` (`SERIAL_ITEMS.EDIT`), recorded as a movement |
| Warranty claim | search a serial, accessory serial or pallet → unit, product, status, invoice, customer, warranty end, delivery note, GRN, supplier, history |

## 6. Server

Permissions: `SERIAL_ITEMS.{VIEW, EDIT}`, `ACCESSORIES.{VIEW, CREATE, EDIT, DELETE}`, `PRODUCTS.ADJUST_STOCK`,
`GOODS_RECEIVED_NOTES.{VIEW, CREATE, ADD_SERIALS}`, `INVOICES.ADD_SERIALS`. (The warehouse role gets
`INVOICES.{VIEW, ADD_SERIALS, FINALIZE}`; Finance keeps `CREATE` / `EDIT`.)

| Route | Permission | Does |
|---|---|---|
| `GET /serial-items?search=&productId=&status=` | SERIAL_ITEMS.VIEW | paged list; search matches serial, accessory serial, pallet |
| `GET /serial-items/:id` | SERIAL_ITEMS.VIEW | unit, accessories, GRN delivery + supplier, invoice + customer + warranty end, delivery note, movements |
| `POST /serial-items/check` | SERIAL_ITEMS.VIEW | `{ productId, serialNumbers[] }` → new / repeated / exists (live feedback while scanning) |
| `PATCH /serial-items/:id` | SERIAL_ITEMS.EDIT | fix serial, pallet, accessories |
| `GET /serial-items/stock-check` | SERIAL_ITEMS.VIEW | §3.8 per serial product |
| `GET/POST/PATCH/DELETE /accessories` | ACCESSORIES.* | the list |
| `PUT /products/:id/accessories` | PRODUCTS.EDIT | what comes with the product |

Plus the routes in §3. Every route in the access matrix; schema and integration tests.

Migrations (written here, applied by the owner), in order: `single_stock`, `remove_packages` (data), `serial_items`
(+ accessories), `grn_deliveries`, `invoice_serials_and_warranty`, `reference_links`.

## 7. Client (`../GP-ERP-Client`, handoff after each server step)

- **Scan input** and the **mobile scan pages** of §3.11 (invoice draft, GRN), plus paste; tested on the TC21's Chrome.
- **GRN**: form with every order line (ordered / received / outstanding / now); detail with deliveries, per-line
  progress, "Record delivery", "Add serial numbers"; status badges; no approve / reject / cancel / edit; PDF.
- **Invoice**: on a draft, "Add serial numbers" (opens the scan page) with per-line progress; Finalize disabled with the
  reason until every unit has a serial; units and warranty end on the page and PDF. Finance's edit warns before a line
  change releases picks.
- **Delivery note**: units and warranty end per line (read-only).
- **Product**: stock fields gone from the form; "Adjust stock" (add / remove / register); "Units" tab with counts and
  the stock check; accessories it comes with.
- **Accessories** admin screen. **Serial numbers** page (sidebar): search → unit card with a timeline linking to the
  documents; the stock check report.
- **Quotation / invoice forms**: old serial and old invoice become search selects (`referenceOptions`); picking a unit
  can fill the customer, old invoice and product model.
- `stockPreOrder` / `stockInTransit` / `stockOnArrival` removed (`types.ts`, `stock.ts`, product pages); Admin →
  Approvals no longer lists GRNs.

## 8. Phase B: old data

Sources: `C:\mongo-backups\import\*.json`, and the credit notes from `C:\mongo-backups\gp-system-backend\creditnotes.bson`
(`bsondump`, MongoDB Tools are installed). A script per step, like `scripts/import-old-data.ts`, each with a dry-run
report first; the owner runs `--apply`.

### 8.1 What the old serial data looks like

| Figure | Count |
|---|---|
| Serial products (packages left out) / distinct serials | 156 / 134,223 |
| Old lists: in stock / in transit / sold | 12,393 / 5,182 / 158,907 |
| Invoices / with serials / serial entries | 28,604 / 17,948 / 131,592 |
| Serials sold to more than one invoice (cancelled and resold) | 5,941 |
| Serials still in the in-stock list after being invoiced | 2,260 (21 explained by a credit note; the rest sold and never taken off the list) |
| Serials in stock under two SKUs | 6 (duplicate SKUs) |
| Main serial holding junk (`MAIN<tab>ACC`, `MAIN,ACC`, `MAIN;`, `WIFI STICK - …`) | 253 (233 carry an accessory serial) |
| Accessory serials (`complimentary`) / on two units | 26,761 / 43 |
| `batterySN` | 301, all on packages |
| Duplicate-SKU pairs (one SKU holds serials, its twin the invoices) | `PVMPHSP540XXXX`/`…XXXXX` (1,131), `INVSOL1P2000XX`/`…XXX` (28), `PVMYLSP320XXXX`/`…XXXXX` (19), 9 smaller |

### 8.2 Rules (evidence first)

1. **Clean** each serial: trim; split on tab, `,` or `;`; the first part is the serial, the second (minus "WIFI STICK -")
   an accessory serial. Leaves 1 odd serial for the report.
2. **Status and product of each unit**:
   - on a non-cancelled, non-draft invoice and not returned by a later credit note → `sold`, on that invoice, under that
     invoice line's product (**123,796**; this also settles the duplicate SKUs, since the unit goes to the SKU it was
     sold under);
   - returned by a credit note after its latest invoice, or only in an in-stock list → `inStock` under that product
     (**10,116**); in stock under two SKUs → the SKU with invoices (6);
   - sold on a package line only (**291**) → `sold` under the (soft-deleted) package product, so warranty lookups still
     find them;
   - on no live invoice and not in stock (14) → `removed`, remark "old system: no invoice found".
3. **History**: every invoice the serial appears on (including cancelled ones) becomes an `InvoiceSerialItem` +
   movement, so a resold unit shows both sales.
4. **Accessories**: one `Accessory` "WiFi / data logger (old system)" and a `ProductAccessory` (1 per unit) for each of
   the 97 products whose units had one; `complimentary` and the split-off serials → `SerialItemAccessory`. The 43 on
   two units go to the unit sold last; the rest are reported.
5. **Stock**: after the units are in, 108 of 156 serial products match their stock exactly. For the other 48 the report
   suggests one of: set stock to the units in stock (where the evidence is clear, e.g. `PVMPHSP540XXXX` 1,216 stock but
   1,131 of its serials were sold under its twin → 85), keep the stock and register the missing serials (§3.2), or
   switch the product to quantity tracking (e.g. `HWALWIFIS2WSUSB`: 247 stock, 1 serial ever recorded). Stock is never
   changed silently: the owner approves the list, ideally after a count of those 48 shelves.
6. **Old invoices** become `Invoice` rows (finalized or cancelled, old number, customer by code, lines by SKU),
   marked imported: read-only, no stock movement, no delivery note. One invoice table, so units, `oldInvoiceId` and the
   invoice search work across old and new. (Sales manager, types, number format and the CHECKs are planned in detail
   before this step.)
7. **References**: fill `oldSerialItemId` / `oldInvoiceId` on the 299 imported quotations from their text.
8. **Duplicate SKUs** aren't merged by the import (both have quotation lines); the report lists them for a later
   clean-up.

Order: invoices (6) → units (1–4) → stock report (5) → references (7).

## 9. Before building

All questions answered (2026-11-12). Phase A, one step at a time, each with its migration
(the owner applies it), server tests, `typecheck` / `lint` / `test` / `build`, and the frontend handoff; then phase B,
dry run first.

## 10. Docs to update when built

This Status; `AGENTS.md` ("Modules not built yet", `oldInvoiceId` note); supply.md §8 (replaced); `docs/database.md`,
`docs/migrations.md`, `docs/automatic.md` (live stock); the client's `AGENTS.md`.
