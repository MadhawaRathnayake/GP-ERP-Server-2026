-- hand-written:
--   1. Names and codes are unique among the rows that aren't deleted, so a deleted row's name can be used again:
--      Customer and Supplier codes (ignoring case; they weren't unique at all), Category, Accessory and Role names
--      (ignoring case; were unique over every row), Product slugs. Stops on duplicates already there.
--   2. Enums shared by quotations and invoices get neutral names (renamed, so no data moves):
--      QuotationType → SalesDocumentType, QuotationPaymentTerms → PaymentTerms.
--   3. QuotationStatus loses the values nothing uses (draft, pending, approved, rejected, accepted, declined, expired):
--      recreated, as in 20261109130000_invoice_cancelled_after_finalized. Stops if a row has one of them.
--   4. Every reference to a user that isn't an audit column is ON DELETE RESTRICT, like the sales manager and the
--      delivery-note people: Customer.salesPersonId, Quotation.confirmedById, Invoice.finalizedBy / cancelledBy,
--      InternalRequisition.cancelledBy, PurchaseOrder.cancelledBy.

-- 1. Unique names and codes
DROP INDEX "Category_name_key";
DROP INDEX "Accessory_name_key";
DROP INDEX "Role_name_key";
CREATE UNIQUE INDEX "Customer_code_key" ON "Customer"(upper("code")) WHERE NOT "isDeleted";
CREATE UNIQUE INDEX "Supplier_code_key" ON "Supplier"(upper("code")) WHERE NOT "isDeleted";
CREATE UNIQUE INDEX "Category_name_key" ON "Category"(lower("name")) WHERE NOT "isDeleted";
CREATE UNIQUE INDEX "Accessory_name_key" ON "Accessory"(lower("name")) WHERE NOT "isDeleted";
CREATE UNIQUE INDEX "Role_name_key" ON "Role"(lower("name")) WHERE NOT "isDeleted";
CREATE UNIQUE INDEX "Product_slug_key" ON "Product"("slug") WHERE NOT "isDeleted";

-- 2. Enum names
ALTER TYPE "QuotationType" RENAME TO "SalesDocumentType";
ALTER TYPE "QuotationPaymentTerms" RENAME TO "PaymentTerms";

-- 3. QuotationStatus without the unused values
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Quotation" WHERE "status"::text IN ('draft', 'pending', 'approved', 'rejected', 'accepted', 'declined', 'expired'))
    OR EXISTS (SELECT 1 FROM "Invoice" WHERE "quotationStatusBefore"::text IN ('draft', 'pending', 'approved', 'rejected', 'accepted', 'declined', 'expired')) THEN
    RAISE EXCEPTION 'A quotation or invoice uses a QuotationStatus value that is being removed';
  END IF;
END $$;
ALTER TYPE "QuotationStatus" RENAME TO "QuotationStatus_old";
CREATE TYPE "QuotationStatus" AS ENUM ('active', 'cancelled', 'cancelledAfterCredit', 'cancelledAfterPayment', 'creditConfirmed', 'paymentConfirmed', 'invoiceCreated');
ALTER TABLE "Quotation" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Quotation" ALTER COLUMN "status" TYPE "QuotationStatus" USING ("status"::text::"QuotationStatus");
ALTER TABLE "Quotation" ALTER COLUMN "status" SET DEFAULT 'active';
ALTER TABLE "Invoice" ALTER COLUMN "quotationStatusBefore" TYPE "QuotationStatus" USING ("quotationStatusBefore"::text::"QuotationStatus");
DROP TYPE "QuotationStatus_old";

-- 4. User references: RESTRICT
ALTER TABLE "Customer" DROP CONSTRAINT "Customer_salesPersonId_fkey";
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_salesPersonId_fkey" FOREIGN KEY ("salesPersonId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Quotation" DROP CONSTRAINT "Quotation_confirmedById_fkey";
ALTER TABLE "Quotation" ADD CONSTRAINT "Quotation_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_finalizedBy_fkey", DROP CONSTRAINT "Invoice_cancelledBy_fkey";
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_finalizedBy_fkey" FOREIGN KEY ("finalizedBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_cancelledBy_fkey" FOREIGN KEY ("cancelledBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InternalRequisition" DROP CONSTRAINT "InternalRequisition_cancelledBy_fkey";
ALTER TABLE "InternalRequisition" ADD CONSTRAINT "InternalRequisition_cancelledBy_fkey" FOREIGN KEY ("cancelledBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PurchaseOrder" DROP CONSTRAINT "PurchaseOrder_cancelledBy_fkey";
ALTER TABLE "PurchaseOrder" ADD CONSTRAINT "PurchaseOrder_cancelledBy_fkey" FOREIGN KEY ("cancelledBy") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
