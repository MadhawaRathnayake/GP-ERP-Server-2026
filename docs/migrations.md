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

Add a row for every new migration.
