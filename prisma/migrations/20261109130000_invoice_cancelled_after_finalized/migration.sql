-- hand-written: InvoiceStatus gets cancelledAfterFinalized, so a cancelled invoice's status says how far it got
-- (cancelled = cancelled while draft). The type is recreated instead of ALTER TYPE … ADD VALUE, because a value added
-- that way can't be used in the same transaction, and the column change below moves existing rows to it: a cancelled
-- invoice with an invoice number was finalized (only finalizing gives one).

-- These use the old type; recreated below.
DROP INDEX "Invoice_quotationId_live_key";
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_number_check";

-- AlterEnum
ALTER TYPE "InvoiceStatus" RENAME TO "InvoiceStatus_old";
CREATE TYPE "InvoiceStatus" AS ENUM ('draft', 'finalized', 'cancelled', 'cancelledAfterFinalized');
ALTER TABLE "Invoice" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Invoice" ALTER COLUMN "status" TYPE "InvoiceStatus" USING (
  CASE
    WHEN "status"::text = 'cancelled' AND "invoiceNumber" IS NOT NULL THEN 'cancelledAfterFinalized'
    ELSE "status"::text
  END
)::"InvoiceStatus";
ALTER TABLE "Invoice" ALTER COLUMN "status" SET DEFAULT 'draft';
DROP TYPE "InvoiceStatus_old";

-- hand-written: one invoice that isn't cancelled per quotation.
CREATE UNIQUE INDEX "Invoice_quotationId_live_key" ON "Invoice"("quotationId")
  WHERE "status" NOT IN ('cancelled', 'cancelledAfterFinalized');

-- hand-written: a draft, and a draft that was cancelled, have no final number; a finalized invoice, and one cancelled
-- after it was finalized, have one.
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_number_check" CHECK (
  ("status" NOT IN ('draft', 'cancelled') OR "invoiceNumber" IS NULL)
  AND ("status" NOT IN ('finalized', 'cancelledAfterFinalized') OR "invoiceNumber" IS NOT NULL)
);
