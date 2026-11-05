# Quotations screen

Sales quotations: a quotation for a customer with one or more product lines. Backend built 2026-11-04; the
migration `20261104074925_sale_quotations` is applied.

## Files

| Area | File |
|---|---|
| Tables | `prisma/schema.prisma`: `Quotation`, `QuotationItem` (were `SaleQuotation`, `SaleQuotationItem`), enums `QuotationType`, `QuotationStatus`, `DiscountType`; `Setting.vatRate` |
| Permissions | `src/platform/security/permissions.ts`: `QUOTATIONS.VIEW/CREATE/EDIT/DELETE/RESTORE/CONFIRM_PAYMENT/CONFIRM_CREDIT/UNDO_CONFIRMATION/CANCEL/REOPEN`; which action needs which: `src/modules/quotations/quotations.permissions.ts` (+ `.test.ts`) |
| Amounts | `src/modules/quotations/quotations.amounts.ts` (+ `.test.ts`) |
| API | `src/modules/quotations/quotations.schema.ts` · `.service.ts` · `.routes.ts` · `.errors.ts` · `.int.test.ts` |
| VAT setting | `src/modules/settings/*`, `DEFAULT_VAT_RATE` in `src/config/env.ts` |
| Sales manager dropdown | `src/modules/dropdowns/*` (`UserDropdown` table, `DROPDOWNS.VIEW/EDIT`) |
| Frontend | `../GP-ERP-Client/src/pages/Quotations/`, `../GP-ERP-Client/src/pages/Admin/DropdownsCard.tsx` |

## Rules

- **Ids** are integers (`autoincrement()`): quotations are high-volume, unlike the master tables with `CUST…`-style ids.
  They have gaps, so they aren't fit for numbers the law needs without gaps (invoices).
- **Status.** Every saved quotation is `active`. Users may set `active`, `cancelled`, `creditConfirmed` or
  `paymentConfirmed` (`PATCH { status }`), in any order, each with its own permission (see **Permissions per action**). Sending `cancelled` for a
  `creditConfirmed` or `paymentConfirmed` quotation stores `cancelledAfterCredit` or `cancelledAfterPayment`, so the
  status still shows how far it got (clients can't send those two; `active` reopens any of them). Only an `active` quotation can have
  its details or lines changed, or be deleted (409 `QUOTATION_NOT_ACTIVE`); restoring a deleted one is always allowed.
  `invoiceCreated` is for the invoice feature; from then on nothing can change (409 `QUOTATION_INVOICED`). The other enum values (`draft`,
  `pending`, `approved`, `rejected`, `accepted`, `declined`, `expired`) are reserved: no route sets them. An approval
  step, if added, gets its own table pointing at `Quotation.id`.
- **Types.** `type` is `sales` (default; every quotation before 20261105140000), `service` or `warranty`. Each type
  has its own optional reference fields; the others must be null (400 on create/update, and the CHECK constraint
  `Quotation_type_fields_check`). Rules in `src/modules/quotations/quotations.types.ts` (+ `.test.ts`):
  service → `repairReceiveNoteId`, `oldInvoiceId`, `oldSerialNumberId`; warranty → `troubleshootId`, `oldInvoiceId`,
  `oldSerialNumberId`, `productModel` (text the user types). Changing the type is an edit (`EDIT`, active only) and
  must send null for the fields the new type can't have. **The referenced modules aren't built yet** (see AGENTS.md →
  "Modules not built yet"): the ids are unchecked text with no foreign key. `GET /?type=` filters by type.
- **Payment and delivery** (every type, optional): `paymentTerms` (`cashOnDelivery` | `advancePayment` | null) and
  `deliveryLocation` (text the user types).
- **Permissions per action.** `PATCH` checks each change in the service, so a role can be allowed to confirm but not to
  undo, which makes confirming final for it. Details or lines: `EDIT`. Delete: `DELETE`; restore: `RESTORE`.
  To `paymentConfirmed` / `creditConfirmed`: `CONFIRM_PAYMENT` / `CONFIRM_CREDIT`. Cancel: `CANCEL`. Out of a cancelled
  status: `REOPEN`. Out of a confirmed status other than by cancelling, including reopening `cancelledAfterCredit` /
  `cancelledAfterPayment`: `UNDO_CONFIRMATION`. A change can need several (e.g. `paymentConfirmed` → `creditConfirmed`).
  Missing one: 403 `FORBIDDEN` naming it. Migration `20261105120000_quotation_action_permissions` gave the new keys to every
  role that had `EDIT`, which used to allow all of these.
- **Amounts are the server's.** Per line: `subtotal = quantity × unitPrice`, discount from the subtotal (percentage of
  it, or a fixed amount off the whole line), tax on what's left, each rounded half-up to 2 decimals. The quotation's
  totals are the sums of its lines. Clients never send amounts, `unitCost` or `taxRate`.
- **Copied when a line is saved:** `description` (product title, unless sent), `unitPrice` (product price, unless sent),
  `unitCost` (product cost) and `taxRate` (`Setting.vatRate`). Later changes to the product or the VAT rate don't
  touch saved lines.
- **Editing lines.** `PATCH { items }` replaces every line: the old ones get `isDeleted = true` and new ones are
  written with the current cost and VAT rate. Every product on the new lines must exist and not be deleted.
- **Cost is shown to everyone** who can view quotations (`unitCost` on each line). `QUOTATIONS.VIEW_COST` used to hide
  it; migration `20261105130000_remove_quotation_view_cost` removed that permission.
- **Invoices.** `INVOICES.VIEW` (for the invoice pages to come) and `INVOICES.CREATE` are defined; `CREATE` is for the Create invoice button on a confirmed quotation. There is no
  invoice API yet; the frontend button calls a placeholder.
- **Delete is soft** (only the quotation row; its lines stay as they are), and `PATCH { isDeleted: false }` restores it.
- **Sales manager** is required and must be one of the users the `SALES_MANAGER` dropdown offers (Admin → Dropdowns,
  [README → User dropdowns](../../README.md#user-dropdowns)). It's checked only when it's set or changed, so a quotation
  keeps a manager who has since been removed from the dropdown. Until an admin saves the dropdown it offers no one, and
  no quotation can be created. A user who is a sales manager on a quotation can't be removed from the database
  (`Restrict`); users are only ever deactivated, so this matters only to tests.

## API

All under `/api/v1/quotations`. Money is a JSON number; dates (`quotationDate`, `validUntil`) are `"YYYY-MM-DD"`.

| Method | Path | Permission | Body | Response |
|---|---|---|---|---|
| GET | `/` | `QUOTATIONS.VIEW` | query: `page`, `limit`, `customerId`, `salesManagerId`, `status`, `from`, `to`, `includeDeleted` | `{ data: QuotationSummary[], total }` |
| GET | `/sales-managers` | `QUOTATIONS.VIEW` | | `{ id, name }[]`, by name |
| GET | `/:id` | `QUOTATIONS.VIEW` | | `Quotation` |
| POST | `/` | `QUOTATIONS.CREATE` | `{ customerId, salesManagerId, quotationDate?, validUntil?, notes?, terms?, items }` | 201 `Quotation` |
| PATCH | `/:id` | `QUOTATIONS.VIEW`, plus each change's own (**Permissions per action**) | any of the create fields, `status`, `isDeleted` | `Quotation` |
| DELETE | `/:id` | `QUOTATIONS.DELETE` | | 204 |

- `items[]`: `{ productId, quantity (int ≥ 1), unitPrice?, description?, discountType? ("none" | "percentage" |
  "fixed", default "none"), discountValue? (default 0) }`, 1–200 lines, in display order.
- `QuotationSummary`: `id, customerId, customer { id, code, name }, salesManagerId, salesManager { id, name },
  quotationDate, validUntil, status, subtotal, discountTotal, taxTotal, grandTotal, notes, terms` + audit columns.
- `Quotation` = `QuotationSummary` + `items[]`: `id, lineNo, productId, product { sku }, description, quantity,
  unitPrice, unitCost, discountType, discountValue, taxRate, subtotal, discountAmount,
  taxAmount, lineTotal`.
- 400s: discount over the line subtotal, percentage over 100, a `discountValue` with `discountType: "none"`,
  `validUntil` before `quotationDate`, an unknown or deleted customer or product, a sales manager the dropdown doesn't
  offer.
- `GET/PATCH /api/v1/settings` now include `vatRate` (percent, 0–100, at most 2 decimals).

## Printed quotation (PDF)

- `../GP-ERP-Client/src/pages/Quotations/QuotationDocument.tsx` draws it with `@react-pdf/renderer`, ported point for
  point from the old system's `GP-System-Client/src/components/pdfGenerator.js` (document `quotation`): same A4 layout,
  styles, company details, terms and bank accounts (hard-coded, typos included). The detail page shows it and offers
  the download (`GPQ-<id> <customer name>.pdf`); cancelled quotations have none, as before.
- The number is `GPQ-<id>`, the old format. New ids start at 1, so they repeat old numbers unless the `Quotation`
  id sequence is moved past the last old `GPQ-` number before go-live.
- Checked against the old library (v1.6.17, rendered under Node 16) with the same data: every text item at the same
  position, font and size (0.000 mm), on one-page and three-page quotations. Two known differences: the old library
  ignored `fontWeight`, so neither PDF has bold text; and where the totals start a new page, the old one drew an empty
  bordered strip at the foot of the previous page and started the next 0.7 mm lower.
- Left out on purpose: the Payment Terms row (no such field), inverter "Warranty Period" lines and the Suntree cable
  warranty line (no warranty text on products yet).
- The detail response (`GET /quotations/:id`) carries what the document needs: the customer's address, phones, email,
  contact person and VAT number, and each product's description and image URL. Product images must be PNG or JPEG
  (WebP shows "N/A") and the R2 bucket must allow `GET` from the frontend origin (CORS), or they show as blank.

## Roll out

1. Review `prisma/schema.prisma`.
2. **`Setting.vatRate` is a new column on a table with data.** Added with `ALTER TABLE`, it lands after `isDeleted` in
   the database (like `Role.isSystem`). The existing row gets the default, 18.
3. `npm run db:migrate -- --name sale_quotations` (also creates `UserDropdown`) (on `ERP-DB` answer **no** if Prisma offers a reset). Add the
   migration to the history table in [../migrations.md](../migrations.md).
4. Settings are cached in Redis without `vatRate` until the `Setting` cache is cleared, and `GET /api/v1/settings`
   fails its response check until then. After migrating, run `redis-cli INCR "cache:ver:Setting"` (or change any setting).
5. `npm run test:int` (uses `ERP-DB`; ask first).
6. Grant the `QUOTATIONS.*` and `DROPDOWNS.*` permissions to roles in Admin → Roles (Super Admin has them at once).
7. In Admin → Dropdowns, choose the sales managers. Until then nobody can create a quotation.

## Not built yet

- Invoices (`SaleInvoice`, `SaleInvoiceItem`) and setting `invoiceCreated`; the invoice should keep the quotation's id.
- A printed or PDF quotation.
- Expiring quotations past `validUntil` (the `expired` value is reserved for it).
