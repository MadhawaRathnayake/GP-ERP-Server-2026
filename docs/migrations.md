# Migrations

`ERP-DB` is shared and holds real data. Never run `prisma db push`, `prisma migrate reset` or `npm run db:seed` on it.

## Which way to make a migration

| Change | How |
|---|---|
| New table with a plain id | `npm run db:migrate -- --name <name>` |
| New table with a prefixed id (`SUP00001`) | write the id function by hand at the top of the migration (ADDING-A-FEATURE.md 2.2) |
| Change to an existing table | write or review the SQL by hand, test it on a throwaway database, apply with `npm run db:deploy` |

- `npm run db:migrate` runs `prisma migrate dev`. If Prisma finds that the database and the migrations disagree, it
  **offers to reset the database, deleting all data**. On `ERP-DB` always answer no, and stop.
- To see the SQL Prisma would write without changing anything:
  `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`.
- After applying: `npx prisma generate`, so the code sees the new columns.
- Apply a migration together with the code that uses it. Old code reading a dropped or renamed column fails.

## Rules

- **Never edit a migration that's applied.** Prisma checksums them. Write a new one. To see which are applied, look
  at the `_prisma_migrations` table.
- An unapplied migration may still be edited. `npx prisma migrate status` shows which are applied (read-only).
- A hand-written migration goes in `prisma/migrations/<YYYYMMDDHHMMSS>_<name>/migration.sql`, timestamped after the
  newest one. Don't use `npm run db:migrate` for it: that creates and applies in one step, with no chance to add data
  steps (e.g. copying values into a new column).
- **Agents don't apply migrations.** Claude Code's auto mode blocks writes to `ERP-DB`, so ask the user to run
  `! npm run db:deploy`, then check that the `migrate diff` above prints nothing. `npx prisma generate` before the
  migration is applied breaks the running dev server for every query on the changed tables, so say so when you hand over.
- Mark SQL written by hand with `-- hand-written:`.
- Every table needs a `<Table>_notify_change` trigger, or the cache is never cleared for it
  ([automatic.md](automatic.md#cache-invalidation)). `npm run db:migrate` adds it; add it yourself to a hand-written
  migration that creates or recreates a table.
- **New columns on an existing table** go after `isDeleted`, which breaks the "audit columns last" rule. On an empty
  table, drop and recreate it (guard the drop so it stops if rows exist, as in `20261102100000_customer_details`). On a
  table with data, ask first.
- `ALTER COLUMN … DROP NOT NULL` and `RENAME COLUMN` keep a column's position.

## History

| Migration | What it did |
|---|---|
| `20261029000100_init` | First tables, `next_user_id()`, `notify_change()` and the cache triggers |
| `20261029104829_catalogue` | Category and the new Product (recreated), movement tables, `PROD` and `CAT` ids |
| `20261030060000_product_price_cost` | Product price and cost, PriceMovement and CostMovement |
| `20261102090000_is_deleted_and_access_ids` | `isActive` → `isDeleted` everywhere (values flipped), `ROLE` and `PMSN` ids, RolePermission reduced to the two ids |
| `20261102100000_customer_details` | Customer recreated with the real fields and `CUST` ids; refuses to run if Customer has rows |
| `20261103090000_customer_optional_address` | Customer `city`, `district`, `province` optional; index changes |
| `20261103090100_add_suppliers` | Supplier table and `SUP` ids |
| `20261103120000_customer_contacts_and_activity` | Customer recreated with contact person, contact phones, notes and the system-set `isActive`, `isDormant`, `lastInvoiceDate`, `totalInvoices`; refuses to run if Customer has rows |
| `20261103150000_system_role` | `Role.isSystem`, set on Super Admin. Added, not recreated (Role has data), so it sits after the audit columns in the database |
| `20261104074925_sale_quotations` | SaleQuotation, SaleQuotationItem and UserDropdown tables (integer ids for the quotation tables), their enums and cache triggers; `Setting.vatRate` (default 18), added after the audit columns like `Role.isSystem` |
| `20261105060935_quotation_cancelled_statuses` | `QuotationStatus` values `cancelledAfterCredit` and `cancelledAfterPayment` |
| `20261105090000_product_stock_version` | `Product.stockVersion` (bigint, default 0, added after the audit columns like `Role.isSystem`), `stock_version_seq`, and the live-stock triggers `Product_set_stock_version` and `Product_notify_stock_change` ([automatic.md](automatic.md#live-stock)) |

| `20261105120000_quotation_action_permissions` | Data only: the `QUOTATIONS` permissions `RESTORE`, `CONFIRM_PAYMENT`, `CONFIRM_CREDIT`, `UNDO_CONFIRMATION`, `CANCEL`, `REOPEN`, granted to every role that had `QUOTATIONS.EDIT` |
| `20261105130000_remove_quotation_view_cost` | Data only: deletes the `QUOTATIONS.VIEW_COST` permission and its grants (unit cost is now shown to everyone) |
| `20261105140000_quotation_types` | `SaleQuotation` → `Quotation`, `SaleQuotationItem` → `QuotationItem` (renamed with their sequences, constraints, indexes and cache triggers, so no data moves); enum `QuotationType`; `Quotation.type` (default `sales`) and the nullable `repairReceiveNoteId`, `troubleshootId`, `oldInvoiceId`, `oldSerialNumberId`, `productModel` (after the audit columns, like `Role.isSystem`; no foreign keys: those modules aren't built yet); CHECK `Quotation_type_fields_check` |
| `20261105150000_quotation_payment_delivery` | enum `QuotationPaymentTerms`; nullable `Quotation.paymentTerms` and `Quotation.deliveryLocation` (after the audit columns, like `Role.isSystem`) |
| `20261105160000_quotation_number` | `Quotation.quotationNumber` (unique, `GPQ-0000001`) from `next_quotation_number()` and `quotation_number_seq`; existing quotations numbered from their id, the sequence set past the highest |
| `20261105170000_quotation_service_charge` | `Quotation.serviceCharge`, `serviceTaxRate` (service only) and `isPreOrdered` (sales only, default false), after the audit columns like `Role.isSystem`; CHECKs `Quotation_service_charge_check` and `Quotation_pre_order_check` |
| `20261106090000_invoices` | Replaces the never-migrated draft `Invoice` model: enums `InvoiceStatus`, `InvoicePaymentMethod`; tables `Invoice`, `InvoiceItem` (integer ids) and `InvoiceNumberCounter`; `next_invoice_number(kind, day, branch)`; partial unique index `Invoice_quotationId_live_key`; CHECKs `Invoice_type_fields_check`, `Invoice_service_charge_check`, `Invoice_payment_details_check`, `Invoice_number_check`; cache triggers; `Setting.invoiceBranchCode` (default `GP01`, after the audit columns like `Setting.vatRate`) |
| `20261106120000_role_branch_code` | Moves the invoice branch code from `Setting.invoiceBranchCode` (dropped) to `Role.branchCode` (default `GP01`, after the audit columns like `Role.isSystem`); existing roles take the setting's value. `InvoiceNumberCounter` gets `branch` in its key, existing rows the setting's value, and `next_invoice_number()` counts per branch. |
| `20261109120000_number_sequence` | `InvoiceNumberCounter` → `NumberSequence` (renamed with its key and cache trigger, so the counters keep their values), `kind` → `code` (`draft` → `invoice.draft`, `final` → `invoice.final`); generic `next_sequence_value(code, period, branch)`, which `next_invoice_number()` now calls ([automatic.md](automatic.md#document-numbers)) |
| `20261109130000_invoice_cancelled_after_finalized` | `InvoiceStatus` recreated with `cancelledAfterFinalized` (not `ADD VALUE`, so the same migration can use it); cancelled invoices with an invoice number move to it; `Invoice_quotationId_live_key` and `Invoice_number_check` recreated for both cancelled statuses |
| `20261109140000_approvals` | Enum `ApprovalDecision`; tables `ApprovalRule` (id = screen code) and `Approval` (integer ids; `screen` + `documentId`, no foreign key to the document); CHECKs `Approval_reason_check` and `Approval_automatic_check`; cache triggers |
| `20261109150000_role_hierarchy` | `Role.parentRoleId` (after the audit columns, like `Role.isSystem`), existing roles put under Super Admin; CHECK `Role_parent_check`, partial unique index `Role_one_system_key`. Data: `ADMIN.*` replaced by `USERS.*` / `ROLES.*` (VIEW → both VIEWs, MANAGE_USERS → USERS.CREATE + EDIT, MANAGE_ROLES → ROLES.CREATE + EDIT); grants of `ADMIN.EDIT_SETTINGS`, `SETTINGS`, `DROPDOWNS` and `APPROVALS` removed; `ADMIN` permission rows deleted |
| `20261109160000_internal_requisitions` | Enum `InternalRequisitionStatus`; tables `InternalRequisition` (`internalRequisitionNumber` `GPIR-0001` from `next_internal_requisition_number()` and `internal_requisition_number_seq`) and `InternalRequisitionItem` (integer ids); CHECKs `InternalRequisition_cancel_check`, `InternalRequisitionItem_quantity_check`; cache triggers |
| `20261110090000_purchase_orders` | Enum `PurchaseOrderStatus`; tables `PurchaseOrder` (`purchaseOrderNumber` `GPPO-0001` from `next_purchase_order_number()` and `purchase_order_number_seq`; `internalRequisitionId` unique) and `PurchaseOrderItem` (integer ids); CHECKs `PurchaseOrder_cancel_check`, `PurchaseOrderItem_amounts_check`; cache triggers |
| `20261111090000_goods_received_notes` | Enum `GoodsReceivedNoteStatus`; tables `GoodsReceivedNote` (`grnNumber` `GPGRN-0001` from `next_grn_number()` and `grn_number_seq`) and `GoodsReceivedNoteItem` (integer ids); partial unique index `GoodsReceivedNote_one_open_per_requisition` (one pending or rejected GRN per IR); CHECKs `GoodsReceivedNote_cancel_check`, `GoodsReceivedNoteItem_quantity_check`; cache triggers |
| `20261111120000_customer_sea_and_sales_person` | Nullable `Customer.seaRegistrationNumber` and `Customer.salesPersonId` (FK to `User`, SET NULL), after the audit columns like `Role.isSystem` |
| `20261112090000_quotation_confirmed_by` | Nullable `Quotation.confirmedById` (FK to `User`, SET NULL): who confirmed the payment or credit; after the audit columns like `Role.isSystem` |
| `20261112100000_single_stock` | One stock figure: drops `Product.stockPreOrder`, `stockInTransit`, `stockOnArrival`, `StockMovement.bucket` (and enum `StockBucket`) and `StockMovement.serialNumber` (and its index); deletes the movements of the dropped buckets first (the in-transit figures imported from the old system). `Product_set_stock_version` recreated for `stockInHand` only, `notify_stock_change()` sends `{ id, stockInHand, stockVersion }` |
| `20261112100100_remove_packages` | Data only: soft-deletes the products of the categories "System Package with Panels" and "System Packages", and those categories (packages get their own module later) |
| `20261112120000_serial_items` | Serial numbers step 2: enum `SerialItemStatus`; tables `SerialItem`, `SerialItemMovement`, `Accessory` (`ACC0001` from `next_accessory_id()` and `accessory_number_seq`), `ProductAccessory`, `SerialItemAccessory` (integer ids otherwise); unique indexes on `upper(serialNumber)` of units and of accessory serials and on a product's live accessory rows; CHECKs `SerialItem_invoice_check` (invoiceId iff sold), the not-blank serial checks, `ProductAccessory_quantity_check`; cache triggers. `goodsReceivedNoteDeliveryId` has no foreign key yet (GRN deliveries come with step 3) |
| `20261112130000_grn_deliveries` | GRNs one per order, received in batches, without approval: stops if `GoodsReceivedNote` has rows, then drops and recreates `GoodsReceivedNote` and `GoodsReceivedNoteItem` (`receivedQuantity` is now the running total; no dates, invoice, remarks or cancel columns) with enum `GoodsReceivedNoteStatus` (`partiallyCompleted`, `needSerialNumbers`, `completed`); new tables `GoodsReceivedNoteDelivery`, `GoodsReceivedNoteDeliveryItem`; foreign keys from `SerialItem` / `SerialItemMovement.goodsReceivedNoteDeliveryId`; partial unique index `GoodsReceivedNote_one_per_requisition`, quantity CHECKs, cache triggers. Data: deletes the `GOODS_RECEIVED_NOTES` permissions `EDIT`, `APPROVE`, `REJECT`, `CANCEL` (and their grants), its `ApprovalRule` row and its `Approval` rows |
| `20261112140000_invoice_serials_and_warranty` | `InvoiceItem.warrantyMonths` (existing lines take their product's) and `warrantyEndsAt`, added after the audit columns like `Role.isSystem`; table `InvoiceSerialItem` (units scanned on invoices) with the partial unique index `InvoiceSerialItem_serialItemId_live_key` (one live pick per unit) and its cache trigger |
| `20261112150000_reference_links` | `Quotation` and `Invoice`: `oldInvoiceId` → `oldInvoiceNumber` and `oldSerialNumberId` → `oldSerialNumber` (renamed, so imported text stays), new `oldInvoiceId` (FK `Invoice`) and `oldSerialItemId` (FK `SerialItem`) after the audit columns like `Role.isSystem`; `Quotation_type_fields_check` and `Invoice_type_fields_check` recreated for the four columns, with "a link has its number" |
| `20261113090000_audit_columns_last` | No data change: the audit columns of `Setting`, `Role`, `Customer`, `Product`, `Quotation`, `Invoice`, `InvoiceItem` and `NumberSequence` are added again at the end of the table and the old ones dropped (with their `createdBy` / `modifiedBy` foreign keys, made again), so every table ends with them; then every table is `CLUSTER`ed on its primary key (rows in id order) |
| `20261113100000_invoice_imported` | `Invoice.isImported` (default false): invoices imported from the old system, read only and never cancelled here; `Invoice`'s audit columns moved back to the end after it (the table is empty then) |
| `20261113110000_delivery_note_imported` | `DeliveryNote.isImported` (default false), `oldItemVerifierName`, `oldItemIssuerName`: notes imported from the old system keep its typed names, linked to users only where one has that name; `DeliveryNote_issued_check` lets an imported issued note lack the users; the audit columns moved back to the end (the table is empty then) |
| `20261113120000_supply_imported` | `GoodsReceivedNoteDelivery.isImported` (default false): deliveries recorded in the old system, already in stock, so their serial-tracked units aren't asked for serials; `GoodsReceivedNoteItem_quantity_check` no longer caps `receivedQuantity` at `orderedQuantity` (an old order received more, GPIR-0105; the service still holds new deliveries to what's outstanding); the delivery's audit columns moved back to the end (the table is empty then) |
| `20261114090000_links` | Ids where rows pointed at each other by value: `GoodsReceivedNoteDeliveryItem.goodsReceivedNoteItemId` (FK, filled from the delivery's GRN and product; stops if a row has no line) with the partial unique index `GoodsReceivedNoteItem_product_key` (one line per product per GRN); `StockMovement.invoiceId` / `goodsReceivedNoteId` (FKs, filled by matching `reference` to the invoice or GRN number; CHECK `StockMovement_source_check`, at most one); `NumberSequence` `createdBy` / `modifiedBy` foreign keys; `UserDropdown.userIds` / `roleIds` arrays moved to the new link tables `UserDropdownUser` / `UserDropdownRole` (no audit columns; ids that no longer exist dropped) and the arrays dropped. The delivery item's and the stock movement's audit columns moved back to the end, as in `20261113090000_audit_columns_last` |
| `20261114090100_uniques_enums_on_delete` | Partial unique indexes where not deleted: `upper(code)` on `Customer` and `Supplier`, `lower(name)` on `Category`, `Accessory` and `Role` (replacing their plain unique names), `Product.slug`. Enums renamed `QuotationType` → `SalesDocumentType`, `QuotationPaymentTerms` → `PaymentTerms`; `QuotationStatus` recreated without the unused `draft`, `pending`, `approved`, `rejected`, `accepted`, `declined`, `expired` (stops if a row has one). `ON DELETE RESTRICT` for `Customer.salesPersonId`, `Quotation.confirmedById`, `Invoice.finalizedBy` / `cancelledBy`, `InternalRequisition.cancelledBy`, `PurchaseOrder.cancelledBy` |
| `20261114090200_countries_and_defaults` | `Customer`, `Supplier` and `Setting` `country` → ISO alpha-3 `CHAR(3)` (names in use mapped, e.g. Sri Lanka → `LKA`; stops and lists any other value); `Product.description` nullable with no default, `'N/A'` → NULL |
| `20261114090300_indexes` | Indexes on the foreign keys that had none and on `Invoice.finalizedAt` / `dueDate`; `(status, id)` replaces `status` on the document tables; `Quotation_type_idx`, `Customer_id_idx`, `Supplier_id_idx` dropped; extension `pg_trgm` and GIN trigram indexes for the `contains` searches (`Customer` code, name, email; `Supplier` name, email; `Product` sku, title) |
| `20261114100000_serial_item_used_for_repair` | `SerialItemStatus` gets `usedForRepair` (a unit used as a repair part; set by the repairs module, not built yet) |
| `20261116090000_invoice_change_events` | Live invoices: `notify_invoice_change()` and trigger `Invoice_notify_invoice_change` (after every insert or update, the invoice's id on channel `invoice_change`; [automatic.md](automatic.md#live-updates)) |
| `20261116100000_quotation_change_events` | Live quotations: `notify_quotation_change()` and trigger `Quotation_notify_quotation_change` (after every insert or update, the quotation's id on channel `quotation_change`) |
| `20261116110000_document_change_events` | Live delivery notes, internal requisitions, purchase orders and GRNs: `notify_document_change()` (sends the row's id on the channel given as the trigger's argument) with a trigger on each table, and `notify_goods_received_note_delivery_change()` on `GoodsReceivedNoteDelivery` (announces its GRN) |

Add a row for every new migration.
