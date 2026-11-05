-- hand-written: SaleQuotation becomes Quotation, with three types (sales, service, warranty).
-- 1. The tables are renamed, not recreated, so every quotation, line and id stays as it is. Their sequences,
--    constraints, indexes and cache triggers are renamed to the names Prisma gives the new models.
-- 2. "type" (existing quotations become sales) and the reference fields of the service and warranty types. They are
--    added, not recreated (the table has data), so in the database they sit after the audit columns, like
--    Role.isSystem; schema.prisma keeps the audit columns last.
-- The reference ids point at modules that aren't built yet (repairs, troubleshoots, invoices, serial numbers), so
-- they're plain text with no foreign key. When a module is built, its column gets that table's id type and a foreign key.

-- 1. Rename
ALTER TABLE "SaleQuotation" RENAME TO "Quotation";
ALTER TABLE "SaleQuotationItem" RENAME TO "QuotationItem";

ALTER SEQUENCE "SaleQuotation_id_seq" RENAME TO "Quotation_id_seq";
ALTER SEQUENCE "SaleQuotationItem_id_seq" RENAME TO "QuotationItem_id_seq";

-- Renaming a primary key constraint renames its index too.
ALTER TABLE "Quotation" RENAME CONSTRAINT "SaleQuotation_pkey" TO "Quotation_pkey";
ALTER TABLE "Quotation" RENAME CONSTRAINT "SaleQuotation_customerId_fkey" TO "Quotation_customerId_fkey";
ALTER TABLE "Quotation" RENAME CONSTRAINT "SaleQuotation_salesManagerId_fkey" TO "Quotation_salesManagerId_fkey";
ALTER TABLE "Quotation" RENAME CONSTRAINT "SaleQuotation_createdBy_fkey" TO "Quotation_createdBy_fkey";
ALTER TABLE "Quotation" RENAME CONSTRAINT "SaleQuotation_modifiedBy_fkey" TO "Quotation_modifiedBy_fkey";
ALTER TABLE "QuotationItem" RENAME CONSTRAINT "SaleQuotationItem_pkey" TO "QuotationItem_pkey";
ALTER TABLE "QuotationItem" RENAME CONSTRAINT "SaleQuotationItem_quotationId_fkey" TO "QuotationItem_quotationId_fkey";
ALTER TABLE "QuotationItem" RENAME CONSTRAINT "SaleQuotationItem_productId_fkey" TO "QuotationItem_productId_fkey";
ALTER TABLE "QuotationItem" RENAME CONSTRAINT "SaleQuotationItem_createdBy_fkey" TO "QuotationItem_createdBy_fkey";
ALTER TABLE "QuotationItem" RENAME CONSTRAINT "SaleQuotationItem_modifiedBy_fkey" TO "QuotationItem_modifiedBy_fkey";

ALTER INDEX "SaleQuotation_customerId_idx" RENAME TO "Quotation_customerId_idx";
ALTER INDEX "SaleQuotation_salesManagerId_idx" RENAME TO "Quotation_salesManagerId_idx";
ALTER INDEX "SaleQuotation_status_idx" RENAME TO "Quotation_status_idx";
ALTER INDEX "SaleQuotation_quotationDate_idx" RENAME TO "Quotation_quotationDate_idx";
ALTER INDEX "SaleQuotationItem_quotationId_lineNo_idx" RENAME TO "QuotationItem_quotationId_lineNo_idx";
ALTER INDEX "SaleQuotationItem_productId_idx" RENAME TO "QuotationItem_productId_idx";

-- The triggers send TG_TABLE_NAME, so after the rename they already report "Quotation" / "QuotationItem" (the names
-- in the routes' cache config). Renamed so scripts/migrate.ts finds them by name and doesn't add a second one.
ALTER TRIGGER "SaleQuotation_notify_change" ON "Quotation" RENAME TO "Quotation_notify_change";
ALTER TRIGGER "SaleQuotationItem_notify_change" ON "QuotationItem" RENAME TO "QuotationItem_notify_change";

-- 2. Types
CREATE TYPE "QuotationType" AS ENUM ('sales', 'service', 'warranty');

ALTER TABLE "Quotation"
  ADD COLUMN "type" "QuotationType" NOT NULL DEFAULT 'sales',
  ADD COLUMN "repairReceiveNoteId" TEXT,
  ADD COLUMN "troubleshootId" TEXT,
  ADD COLUMN "oldInvoiceId" TEXT,
  ADD COLUMN "oldSerialNumberId" TEXT,
  ADD COLUMN "productModel" TEXT;

-- Each type's reference fields are null on the other types (the API checks the same, see quotations.types.ts).
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_type_fields_check" CHECK (
  ("type" = 'service' OR "repairReceiveNoteId" IS NULL)
  AND ("type" = 'warranty' OR ("troubleshootId" IS NULL AND "productModel" IS NULL))
  AND ("type" IN ('service', 'warranty') OR ("oldInvoiceId" IS NULL AND "oldSerialNumberId" IS NULL))
);

CREATE INDEX "Quotation_type_idx" ON "Quotation"("type");
